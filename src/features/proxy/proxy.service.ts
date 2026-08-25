import axios from 'axios';
import { randomUUID } from 'crypto';
import { env } from '../../config/env';
import { DEFAULT_RATE_LIMIT_PER_MINUTE } from '../../config/constants';
import { redis } from '../../config/redis';
import { AuthenticatedAgent } from '../../middleware/agentAuth';
import {
  AppError,
  BudgetExceededError,
  ForbiddenError,
  ProviderError,
  RateLimitError,
} from '../../utils/errors';
import { logger } from '../../utils/logger';
import { Budget, BudgetScope, budgetsRepository } from '../budgets/budgets.repository';
import { optimizationRepository } from '../optimization/optimization.repository';
import { pricingRepository } from '../pricing/pricing.repository';
import { anthropicProvider } from './providers/anthropic.provider';
import { geminiProvider } from './providers/gemini.provider';
import { openaiProvider } from './providers/openai.provider';
import { ProviderAdapter, ProviderName, ProviderResponse } from './providers/provider.types';
import { proxyRepository } from './proxy.repository';
import { extractPromptText, injectOptimizedText } from './proxy.prompt-extractor';
import { extractUsage } from './proxy.usage-extractor';

type ProviderConfiguration = {
  adapter: ProviderAdapter;
  apiKey: string | undefined;
};

export type ProxyForwardResult = {
  response: ProviderResponse;
  latencyMs: number;
  cacheHit: boolean;
  originalTokenCount?: number;
  optimizedTokenCount?: number;
};

type ApplicableBudget = { scope: BudgetScope; scopeId: string; budget: Budget };

export type UsageLoggingInput = {
  agent: AuthenticatedAgent;
  provider: ProviderName;
  path: string;
  body: unknown;
  taskId: string;
  environment: 'dev' | 'staging' | 'prod';
  isTest: boolean;
  response: ProviderResponse;
  latencyMs: number;
  originalTokenCount?: number;
  optimizedTokenCount?: number;
};

export type FailedUsageLoggingInput = Omit<
  UsageLoggingInput,
  'response' | 'latencyMs'
> & {
  latencyMs: number;
  status: 'error' | 'timeout';
};

const providers: Record<ProviderName, ProviderConfiguration> = {
  openai: { adapter: openaiProvider, apiKey: env.OPENAI_API_KEY },
  anthropic: { adapter: anthropicProvider, apiKey: env.ANTHROPIC_API_KEY },
  gemini: { adapter: geminiProvider, apiKey: env.GEMINI_API_KEY },
};

function getProviderConfiguration(provider: string): ProviderConfiguration {
  if (!Object.prototype.hasOwnProperty.call(providers, provider)) {
    throw new AppError(404, `Unsupported provider: ${provider}`, 'UNSUPPORTED_PROVIDER');
  }

  return providers[provider as ProviderName];
}

function normalizePath(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (normalizedPath.startsWith('//') || normalizedPath.includes('://')) {
    throw new AppError(400, 'Invalid provider path', 'INVALID_PROVIDER_PATH');
  }

  return normalizedPath;
}

function getModel(body: unknown, path: string): string | undefined {
  if (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { model?: unknown }).model === 'string'
  ) {
    return (body as { model: string }).model;
  }

  return path.match(/\/models\/([^/:?]+)/)?.[1];
}

function calculateCostUsd(
  inputTokens: number,
  outputTokens: number,
  rate: { inputPricePer1k: number; outputPricePer1k: number }
): string {
  const cost =
    (inputTokens / 1000) * rate.inputPricePer1k + (outputTokens / 1000) * rate.outputPricePer1k;
  return cost.toFixed(4);
}

function getPeriodKey(period: Budget['period'], timezone: string, date = new Date()): string {
  const values = new Map(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');

  if (!year || !month || !day) throw new Error(`Unable to calculate budget period for ${timezone}`);
  return period === 'monthly' ? `${year}-${month}` : `${year}-${month}-${day}`;
}

function getSpendKey(scope: BudgetScope, scopeId: string, budget: Budget): string {
  return `budget:spend:${scope}:${scopeId}:${getPeriodKey(budget.period, budget.resetTimezone)}`;
}

function getBudgetTtlSeconds(period: Budget['period']): number {
  return period === 'monthly' ? 32 * 24 * 60 * 60 : 25 * 60 * 60;
}

function getRateLimitWindow(now = Date.now()): { keySuffix: number; retryAfter: number } {
  const minuteWindow = Math.floor(now / 60_000);
  return {
    keySuffix: minuteWindow,
    retryAfter: Math.max(1, 60 - Math.floor((now % 60_000) / 1_000)),
  };
}

function estimateTokens(text: string): number {
  // Approximate English token estimate for savings comparison; provider usage remains authoritative.
  return Math.ceil(text.length / 4);
}

function optimizePromptText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const sentences = normalized.split(/(?<=[.!?])\s+/);
  return sentences.filter((sentence, index) => index === 0 || sentence !== sentences[index - 1]).join(' ');
}

async function optimizeRequestBody(
  provider: ProviderName,
  body: unknown,
  agent: AuthenticatedAgent
): Promise<{ body: unknown; originalTokenCount?: number; optimizedTokenCount?: number }> {
  const settings = await optimizationRepository.getSettings(agent.id);
  if (!settings?.promptOptimizationEnabled) return { body };
  const originalText = extractPromptText(provider, body);
  if (!originalText) return { body };
  const optimizedText = optimizePromptText(originalText);
  return {
    body: optimizedText === originalText ? body : injectOptimizedText(provider, body, optimizedText),
    originalTokenCount: estimateTokens(originalText),
    optimizedTokenCount: estimateTokens(optimizedText),
  };
}

async function enforceRateLimit(agentId: string): Promise<void> {
  const window = getRateLimitWindow();
  const key = `ratelimit:agent:${agentId}:${window.keySuffix}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 60);
  if (count > DEFAULT_RATE_LIMIT_PER_MINUTE) throw new RateLimitError(window.retryAfter);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isTimeoutError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ECONNABORTED'
  );
}

async function forwardWithRetries(
  adapter: ProviderAdapter,
  path: string,
  body: unknown,
  apiKey: string,
  startedAt: number
): Promise<ProviderResponse> {
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await adapter.forward(path, body, apiKey);
      if (response.status >= 200 && response.status < 300) return response;
      if (response.status >= 400 && response.status < 500) {
        throw new ProviderError(Date.now() - startedAt);
      }
      lastError = new Error(`Provider returned ${response.status}`);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      lastError = error;
    }

    if (attempt < maxAttempts) await delay(200 * 2 ** (attempt - 1));
  }

  throw new ProviderError(Date.now() - startedAt, isTimeoutError(lastError));
}

async function getApplicableBudgets(agent: AuthenticatedAgent): Promise<ApplicableBudget[]> {
  const scopes: Array<{ scope: BudgetScope; scopeId: string | null }> = [
    { scope: 'agent', scopeId: agent.id },
    { scope: 'team', scopeId: agent.teamId },
    { scope: 'org', scopeId: agent.orgId },
  ];

  const applicableBudgets: ApplicableBudget[] = [];
  for (const { scope, scopeId } of scopes) {
    if (!scopeId) continue;
    const budget = await budgetsRepository.getBudget(scope, scopeId);
    if (budget) applicableBudgets.push({ scope, scopeId, budget });
  }

  return applicableBudgets;
}

async function incrementBudgetCounter(applicableBudget: ApplicableBudget, costUsd: string): Promise<void> {
  const key = getSpendKey(
    applicableBudget.scope,
    applicableBudget.scopeId,
    applicableBudget.budget
  );
  await redis.incrByFloat(key, Number(costUsd));
  if ((await redis.ttl(key)) === -1) {
    await redis.expire(key, getBudgetTtlSeconds(applicableBudget.budget.period));
  }
}

async function createEmbedding(prompt: string): Promise<number[] | null> {
  if (!env.GEMINI_API_KEY) return null;
  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${env.EMBEDDING_MODEL}:embedContent`,
    {
      model: `models/${env.EMBEDDING_MODEL}`,
      taskType: 'SEMANTIC_SIMILARITY',
      outputDimensionality: 768,
      content: { parts: [{ text: prompt }] },
    },
    { headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' } }
  );
  const embedding = response.data?.embedding?.values;
  return Array.isArray(embedding) && embedding.length === 768 && embedding.every((value) => typeof value === 'number')
    ? embedding
    : null;
}

function reconstructCachedResponse(responseText: string): unknown | null {
  try {
    const parsed: unknown = JSON.parse(responseText);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return parsed;
    const response = { ...(parsed as Record<string, unknown>) };
    if (typeof response.id === 'string') response.id = `cache-${randomUUID()}`;
    if (typeof response.created === 'number') response.created = Math.floor(Date.now() / 1000);
    if (typeof response.created_at === 'string') response.created_at = new Date().toISOString();
    return response;
  } catch {
    return null;
  }
}

async function findCachedResponse(
  provider: ProviderName,
  body: unknown,
  agent: AuthenticatedAgent
): Promise<ProviderResponse | null> {
  const settings = await optimizationRepository.getSettings(agent.id);
  if (!settings?.semanticCacheEnabled) return null;

  const prompt = extractPromptText(provider, body);
  if (!prompt) return null;

  try {
    const embedding = await createEmbedding(prompt);
    if (!embedding) return null;
    const match = await optimizationRepository.findClosestMatch(agent.orgId, agent.id, embedding);
    if (!match || match.similarity < settings.cacheSimilarityThreshold) return null;
    const data = reconstructCachedResponse(match.responseText);
    if (data === null) return null;
    await optimizationRepository.incrementHitCount(match.id);
    return { status: 200, data, headers: { contentType: 'application/json' } };
  } catch (error) {
    logger.warn({ error, agentId: agent.id }, 'Semantic cache lookup failed; forwarding request');
    return null;
  }
}

export const proxyService = {
  async forward(
    provider: string,
    path: string,
    body: unknown,
    agent: AuthenticatedAgent,
    isTest: boolean
  ): Promise<ProxyForwardResult> {
    if (await redis.get(`killswitch:agent:${agent.id}`)) {
      throw new ForbiddenError('Agent killed');
    }

    if (!isTest) {
      const applicableBudgets = await getApplicableBudgets(agent);
      for (const applicableBudget of applicableBudgets) {
        const currentSpend = Number(
          (await redis.get(
            getSpendKey(applicableBudget.scope, applicableBudget.scopeId, applicableBudget.budget)
          )) ?? '0'
        );
        if (currentSpend >= applicableBudget.budget.limitAmount) {
          throw new BudgetExceededError(applicableBudget.scope);
        }
      }
    }

    await enforceRateLimit(agent.id);

    const configuration = getProviderConfiguration(provider);
    const providerName = provider as ProviderName;
    const cachedResponse = await findCachedResponse(providerName, body, agent);
    if (cachedResponse) return { response: cachedResponse, latencyMs: 0, cacheHit: true };

    const optimizedRequest = await optimizeRequestBody(providerName, body, agent);

    const { adapter, apiKey } = configuration;
    if (!apiKey) {
      throw new AppError(503, `Provider ${provider} is not configured`, 'PROVIDER_NOT_CONFIGURED');
    }

    const normalizedPath = normalizePath(path);
    const startedAt = Date.now();

    // Agents authenticate only with our X-Agent-Key. Provider keys stay in platform configuration.
    const response = await forwardWithRetries(adapter, normalizedPath, optimizedRequest.body, apiKey, startedAt);
    return {
      response,
      latencyMs: Date.now() - startedAt,
      cacheHit: false,
      originalTokenCount: optimizedRequest.originalTokenCount,
      optimizedTokenCount: optimizedRequest.optimizedTokenCount,
    };
  },

  async recordSuccessfulUsage(input: UsageLoggingInput): Promise<void> {
    if (input.response.status < 200 || input.response.status >= 300) return;

    const model = getModel(input.body, input.path);
    if (!model) {
      logger.warn(
        { provider: input.provider, agentId: input.agent.id },
        'Skipping usage logging: model is missing'
      );
      return;
    }

    const usage = extractUsage(input.provider, input.response.data);
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;

    if (!usage) {
      logger.warn(
        { provider: input.provider, model, agentId: input.agent.id },
        'Provider response has no usable token usage; recording zero-token usage event'
      );
    }

    let costUsd = '0.0000';
    try {
      const rate = await pricingRepository.getRate(input.agent.orgId, input.provider, model);
      if (!rate) {
        logger.warn(
          { provider: input.provider, model, orgId: input.agent.orgId },
          'No pricing rate configured; recording zero cost'
        );
      } else {
        costUsd = calculateCostUsd(inputTokens, outputTokens, rate);
      }

      await proxyRepository.insertUsageEvent({
        orgId: input.agent.orgId,
        agentId: input.agent.id,
        taskId: input.taskId,
        provider: input.provider,
        model,
        environment: input.environment,
        inputTokens,
        outputTokens,
        costUsd,
        latencyMs: input.latencyMs,
        isTest: input.isTest,
        originalTokenCount: input.originalTokenCount,
        optimizedTokenCount: input.optimizedTokenCount,
      });

      if (!input.isTest) {
        const applicableBudgets = await getApplicableBudgets(input.agent);
        await Promise.all(
          applicableBudgets.map((applicableBudget) => incrementBudgetCounter(applicableBudget, costUsd))
        );
      }
    } catch (error) {
      logger.warn(
        { error, provider: input.provider, model, agentId: input.agent.id },
        'Unable to record proxy usage event'
      );
    }
  },

  async recordFailedUsage(input: FailedUsageLoggingInput): Promise<void> {
    const model = getModel(input.body, input.path) ?? 'unknown';
    try {
      await proxyRepository.insertUsageEvent({
        orgId: input.agent.orgId,
        agentId: input.agent.id,
        taskId: input.taskId,
        provider: input.provider,
        model,
        environment: input.environment,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: '0.0000',
        latencyMs: input.latencyMs,
        isTest: input.isTest,
        status: input.status,
      });
    } catch (error) {
      logger.warn(
        { error, provider: input.provider, model, agentId: input.agent.id },
        'Unable to record failed proxy usage event'
      );
    }
  },

  async recordCacheHitUsage(input: Omit<UsageLoggingInput, 'response' | 'latencyMs'>): Promise<void> {
    const model = getModel(input.body, input.path) ?? 'unknown';
    try {
      await proxyRepository.insertUsageEvent({
        orgId: input.agent.orgId,
        agentId: input.agent.id,
        taskId: input.taskId,
        provider: input.provider,
        model,
        environment: input.environment,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: '0.0000',
        latencyMs: 0,
        isTest: input.isTest,
        cacheHit: true,
      });
    } catch (error) {
      logger.warn(
        { error, provider: input.provider, model, agentId: input.agent.id },
        'Unable to record semantic cache usage event'
      );
    }
  },

  async cacheSuccessfulResponse(input: UsageLoggingInput): Promise<void> {
    if (input.isTest || input.response.status < 200 || input.response.status >= 300) return;

    try {
      const settings = await optimizationRepository.getSettings(input.agent.id);
      if (!settings?.semanticCacheEnabled) return;

      const prompt = extractPromptText(input.provider, input.body);
      if (!prompt) return;

      const embedding = await createEmbedding(prompt);
      if (!embedding) return;
      await optimizationRepository.insertCacheEntry({
        orgId: input.agent.orgId,
        agentId: input.agent.id,
        embedding,
        queryText: prompt,
        responseText: JSON.stringify(input.response.data),
        expiresAt: new Date(Date.now() + settings.cacheTtlSeconds * 1000),
      });
    } catch (error) {
      logger.warn(
        { error, provider: input.provider, agentId: input.agent.id },
        'Unable to write semantic cache entry'
      );
    }
  },
};
