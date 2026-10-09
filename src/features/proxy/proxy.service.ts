import { randomUUID } from 'crypto';
import { providerKeysService } from '../provider-keys/provider-keys.service';
import { redis } from '../../config/redis';
import { AuthenticatedAgent } from '../../middleware/agentAuth';
import {
  AppError,
  BudgetExceededError,
  ForbiddenError,
  ProviderError,
} from '../../utils/errors';
import { logger } from '../../utils/logger';
import { Budget, BudgetScope, budgetsRepository } from '../budgets/budgets.repository';
import { getBudgetCounterTtlSeconds, getBudgetSpendKey } from '../budgets/budget.redis';
import { optimizationRepository } from '../optimization/optimization.repository';
import { pricingRepository } from '../pricing/pricing.repository';
import { anthropicProvider } from './providers/anthropic.provider';
import { geminiProvider } from './providers/gemini.provider';
import { openaiProvider } from './providers/openai.provider';
import { ProviderAdapter, ProviderName, ProviderResponse } from './providers/provider.types';
import { autocorrectPromptText } from './prompt-autocorrect.service';
import { proxyRepository } from './proxy.repository';
import { cacheEngine, CacheOptions, CacheResult } from '../optimization/cache/cache.engine';

type ProviderConfiguration = {
  adapter: ProviderAdapter;
};

export type ProxyForwardResult = {
  response: ProviderResponse;
  latencyMs: number;
  cacheHit: boolean;
  cacheResult?: CacheResult;
  originalTokenCount?: number;
  optimizedTokenCount?: number;
  budgetReservation?: BudgetReservation;
};

type ApplicableBudget = { scope: BudgetScope; scopeId: string; budget: Budget };
type BudgetLock = { key: string; token: string };
type BudgetReservation = { applicableBudgets: ApplicableBudget[]; locks: BudgetLock[] };
type TokenUsage = { inputTokens: number; outputTokens: number };

function textFromContent(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const text = content.map((part) => typeof part === 'object' && part !== null && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '').filter(Boolean).join('\n');
  return text || null;
}

function extractPromptText(provider: ProviderName, requestBody: unknown): string | null {
  if (typeof requestBody !== 'object' || requestBody === null) return null;
  const body = requestBody as { messages?: unknown; contents?: unknown };
  const entries = provider === 'gemini' ? body.contents : body.messages;
  if (!Array.isArray(entries)) return null;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as { content?: unknown; parts?: unknown };
    const text = textFromContent(provider === 'gemini' ? record.parts : record.content);
    if (text) return text;
  }
  return null;
}

function injectOptimizedText(provider: ProviderName, requestBody: unknown, newText: string): unknown {
  if (typeof requestBody !== 'object' || requestBody === null) return requestBody;
  const body = { ...(requestBody as Record<string, unknown>) };
  const collectionKey = provider === 'gemini' ? 'contents' : 'messages';
  const entries = body[collectionKey];
  if (!Array.isArray(entries)) return requestBody;
  const updated = [...entries];
  for (let i = updated.length - 1; i >= 0; i -= 1) {
    const entry = updated[i];
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const contentKey = provider === 'gemini' ? 'parts' : 'content';
    const content = record[contentKey];
    if (typeof content === 'string') { updated[i] = { ...record, [contentKey]: newText }; return { ...body, [collectionKey]: updated }; }
    if (Array.isArray(content) && textFromContent(content)) {
      let replaced = false;
      updated[i] = { ...record, [contentKey]: content.map((part) => {
        if (typeof part !== 'object' || part === null || typeof (part as { text?: unknown }).text !== 'string') return part;
        if (replaced) return { ...(part as Record<string, unknown>), text: '' };
        replaced = true; return { ...(part as Record<string, unknown>), text: newText };
      })};
      return { ...body, [collectionKey]: updated };
    }
  }
  return requestBody;
}

function extractUsage(provider: ProviderName, response: unknown): TokenUsage | undefined {
  if (typeof response !== 'object' || response === null) return undefined;
  const usage = (response as Record<string, unknown>)[provider === 'gemini' ? 'usageMetadata' : 'usage'];
  if (typeof usage !== 'object' || usage === null) return undefined;
  const row = usage as Record<string, unknown>;
  const input = provider === 'openai' ? row.prompt_tokens : provider === 'anthropic' ? row.input_tokens : row.promptTokenCount;
  const output = provider === 'openai' ? row.completion_tokens : provider === 'anthropic' ? row.output_tokens : row.candidatesTokenCount;
  return typeof input === 'number' && Number.isInteger(input) && input >= 0 && typeof output === 'number' && Number.isInteger(output) && output >= 0 ? { inputTokens: input, outputTokens: output } : undefined;
}

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
  budgetReservation?: BudgetReservation;
};

export type FailedUsageLoggingInput = Omit<
  UsageLoggingInput,
  'response' | 'latencyMs'
> & {
  latencyMs: number;
  status: 'error' | 'timeout';
};

const providers: Record<ProviderName, ProviderConfiguration> = {
  openai: { adapter: openaiProvider },
  anthropic: { adapter: anthropicProvider },
  gemini: { adapter: geminiProvider },
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
  const correctedText = await autocorrectPromptText(originalText);
  const optimizedText = optimizePromptText(correctedText);
  return {
    body: optimizedText === originalText ? body : injectOptimizedText(provider, body, optimizedText),
    originalTokenCount: estimateTokens(originalText),
    optimizedTokenCount: estimateTokens(optimizedText),
  };
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

function safeErrorMetadata(error: unknown) {
  if (typeof error !== 'object' || error === null) return { errorName: 'UnknownError' };
  return {
    errorName: error instanceof Error ? error.name : 'UnknownError',
    errorCode: 'code' in error && typeof error.code === 'string' ? error.code : undefined,
  };
}

function providerMessage(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const error = (data as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return undefined;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== 'string') return undefined;
  return message
    .replace(/(?:sk|AIza|agt_)[A-Za-z0-9_\-]{8,}/g, '[REDACTED]')
    .replace(/(api[_ -]?key|authorization|bearer|token|secret)\s*[:=]?\s*[^\s,;]+/gi, '$1 [REDACTED]')
    .slice(0, 500);
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
  let lastProviderResponse: ProviderResponse | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await adapter.forward(path, body, apiKey);
      if (response.status >= 200 && response.status < 300) return response;
      lastProviderResponse = response;
      if (response.status >= 400 && response.status < 500) {
        throw new ProviderError(
          Date.now() - startedAt,
          false,
          response.status,
          providerMessage(response.data)
        );
      }
      lastError = new Error(`Provider returned ${response.status}`);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      lastError = error;
    }

    if (attempt < maxAttempts) await delay(200 * 2 ** (attempt - 1));
  }

  throw new ProviderError(
    Date.now() - startedAt,
    isTimeoutError(lastError),
    lastProviderResponse?.status,
    lastProviderResponse && providerMessage(lastProviderResponse.data)
  );
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
  const key = getBudgetSpendKey(
    applicableBudget.scope,
    applicableBudget.scopeId,
    applicableBudget.budget
  );
  await redis.eval(
    "local value = redis.call('INCRBYFLOAT', KEYS[1], ARGV[1]); if redis.call('TTL', KEYS[1]) == -1 then redis.call('EXPIRE', KEYS[1], ARGV[2]); end; return value",
    { keys: [key], arguments: [costUsd, String(getBudgetCounterTtlSeconds(applicableBudget.budget.period))] }
  );
}

async function releaseBudgetLocks(locks: BudgetLock[]): Promise<void> {
  await Promise.all(locks.map(({ key, token }) => redis.eval(
    "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0",
    { keys: [key], arguments: [token] }
  )));
}

async function acquireBudgetReservation(agent: AuthenticatedAgent, isTest: boolean): Promise<BudgetReservation | undefined> {
  if (isTest) return undefined;
  const applicableBudgets = await getApplicableBudgets(agent);
  const lockKeys = applicableBudgets.map((item) => `budget:lock:${item.scope}:${item.scopeId}`).sort();
  const token = randomUUID();
  const deadline = Date.now() + 5_000;
  let locks: BudgetLock[] = [];
  while (Date.now() < deadline) {
    locks = [];
    for (const key of lockKeys) {
      if (await redis.set(key, token, { NX: true, PX: 120_000 })) locks.push({ key, token });
      else break;
    }
    if (locks.length === lockKeys.length) break;
    await releaseBudgetLocks(locks);
    await delay(50);
  }
  if (locks.length !== lockKeys.length) {
    await releaseBudgetLocks(locks);
    throw new AppError(503, 'Budget enforcement is busy; retry shortly', 'BUDGET_ENFORCEMENT_BUSY');
  }
  for (const applicableBudget of applicableBudgets) {
    const currentSpend = Number((await redis.get(getBudgetSpendKey(applicableBudget.scope, applicableBudget.scopeId, applicableBudget.budget))) ?? '0');
    if (currentSpend >= applicableBudget.budget.limitAmount) {
      await releaseBudgetLocks(locks);
      throw new BudgetExceededError(applicableBudget.scope);
    }
  }
  return { applicableBudgets, locks };
}

export const proxyService = {
  async forward(
    provider: string,
    path: string,
    body: unknown,
    agent: AuthenticatedAgent,
    isTest: boolean,
    cacheOptions?: CacheOptions
  ): Promise<ProxyForwardResult> {
    if (await redis.get(`killswitch:agent:${agent.id}`)) {
      throw new ForbiddenError('Agent killed');
    }

    const budgetReservation = await acquireBudgetReservation(agent, isTest);
    let cacheResult: CacheResult | undefined;
    try {
      const configuration = getProviderConfiguration(provider);
      const providerName = provider as ProviderName;
      const { adapter } = configuration;
      const credential = await providerKeysService.getCredential(agent.orgId, providerName);
      if (!credential) throw new AppError(400, 'No API key configured for this provider. Add one in your organization settings.', 'PROVIDER_KEY_MISSING');
      const startedAt = Date.now();
      const normalizedPath = normalizePath(path);
      if (cacheOptions && !isTest) {
        cacheResult = await cacheEngine.prepare({ agent, provider: providerName, path: normalizedPath, body, credentialVersion: credential.version, options: cacheOptions });
        if (cacheResult.response) {
          if (budgetReservation) await releaseBudgetLocks(budgetReservation.locks);
          await cacheEngine.record(cacheResult);
          return { response: cacheResult.response, latencyMs: Date.now() - startedAt, cacheHit: true, cacheResult };
        }
      }
      const optimizedRequest = await optimizeRequestBody(providerName, body, agent);
      const response = await forwardWithRetries(adapter, normalizedPath, optimizedRequest.body, credential.plaintext, startedAt);
      if (cacheResult) {
        await cacheEngine.afterProvider({ agent, provider: providerName, result: cacheResult, response });
        await cacheEngine.record(cacheResult);
      }
      return { response, latencyMs: Date.now() - startedAt, cacheHit: false, cacheResult, originalTokenCount: optimizedRequest.originalTokenCount, optimizedTokenCount: optimizedRequest.optimizedTokenCount, budgetReservation };
    } catch (error) {
      if (cacheResult) {
        await cacheEngine.abort(cacheResult);
        cacheResult.diagnostic.outcome = 'provider_error';
        cacheResult.diagnostic.reason = 'provider_failed_after_cache_miss';
        await cacheEngine.record(cacheResult);
      }
      if (budgetReservation) await releaseBudgetLocks(budgetReservation.locks);
      throw error;
    }
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
        const applicableBudgets = input.budgetReservation?.applicableBudgets ?? await getApplicableBudgets(input.agent);
        await Promise.all(
          applicableBudgets.map((applicableBudget) => incrementBudgetCounter(applicableBudget, costUsd))
        );
      }
    } catch (error) {
      logger.warn(
        { ...safeErrorMetadata(error), provider: input.provider, model, agentId: input.agent.id },
        'Unable to record proxy usage event'
      );
    } finally {
      if (input.budgetReservation) await releaseBudgetLocks(input.budgetReservation.locks);
    }
  },

  async recordCacheHitUsage(input: UsageLoggingInput): Promise<void> {
    const model = getModel(input.body, input.path);
    if (!model) return;
    try {
      await proxyRepository.insertUsageEvent({
        orgId: input.agent.orgId, agentId: input.agent.id, taskId: input.taskId,
        provider: input.provider, model, environment: input.environment,
        inputTokens: 0, outputTokens: 0, costUsd: '0.0000',
        latencyMs: input.latencyMs, isTest: input.isTest, cacheHit: true,
        originalTokenCount: 0, optimizedTokenCount: 0,
      });
    } catch (error) {
      logger.warn({ ...safeErrorMetadata(error), provider: input.provider, model, agentId: input.agent.id }, 'Unable to record cache hit usage');
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
        { ...safeErrorMetadata(error), provider: input.provider, model, agentId: input.agent.id },
        'Unable to record failed proxy usage event'
      );
    }
  },

};
