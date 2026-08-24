import { ProviderName } from './providers/provider.types';

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

type UsageResponse = Record<string, unknown>;

function asNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function getUsageObject(response: unknown, key: string): UsageResponse | undefined {
  if (typeof response !== 'object' || response === null) return undefined;
  const usage = (response as UsageResponse)[key];
  return typeof usage === 'object' && usage !== null ? (usage as UsageResponse) : undefined;
}

export function extractUsage(provider: ProviderName, response: unknown): TokenUsage | undefined {
  const usage = getUsageObject(response, provider === 'gemini' ? 'usageMetadata' : 'usage');
  if (!usage) return undefined;

  const inputTokens = asNonNegativeInteger(
    provider === 'openai'
      ? usage.prompt_tokens
      : provider === 'anthropic'
        ? usage.input_tokens
        : usage.promptTokenCount
  );
  const outputTokens = asNonNegativeInteger(
    provider === 'openai'
      ? usage.completion_tokens
      : provider === 'anthropic'
        ? usage.output_tokens
        : usage.candidatesTokenCount
  );

  return inputTokens === undefined || outputTokens === undefined
    ? undefined
    : { inputTokens, outputTokens };
}
