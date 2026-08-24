import { env } from '../../config/env';
import { AuthenticatedAgent } from '../../middleware/agentAuth';
import { AppError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { pricingRepository } from '../pricing/pricing.repository';
import { anthropicProvider } from './providers/anthropic.provider';
import { geminiProvider } from './providers/gemini.provider';
import { openaiProvider } from './providers/openai.provider';
import { ProviderAdapter, ProviderName, ProviderResponse } from './providers/provider.types';
import { proxyRepository } from './proxy.repository';
import { extractUsage } from './proxy.usage-extractor';

type ProviderConfiguration = {
  adapter: ProviderAdapter;
  apiKey: string | undefined;
};

export type ProxyForwardResult = {
  response: ProviderResponse;
  latencyMs: number;
};

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

export const proxyService = {
  async forward(provider: string, path: string, body: unknown): Promise<ProxyForwardResult> {
    const { adapter, apiKey } = getProviderConfiguration(provider);
    if (!apiKey) {
      throw new AppError(503, `Provider ${provider} is not configured`, 'PROVIDER_NOT_CONFIGURED');
    }

    const normalizedPath = normalizePath(path);
    const startedAt = Date.now();

    // Agents authenticate only with our X-Agent-Key. Provider keys stay in platform configuration.
    try {
      const response = await adapter.forward(normalizedPath, body, apiKey);
      return { response, latencyMs: Date.now() - startedAt };
    } catch {
      throw new AppError(502, `Unable to reach ${provider}`, 'PROVIDER_UNAVAILABLE');
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
      });
    } catch (error) {
      logger.warn(
        { error, provider: input.provider, model, agentId: input.agent.id },
        'Unable to record proxy usage event'
      );
    }
  },
};
