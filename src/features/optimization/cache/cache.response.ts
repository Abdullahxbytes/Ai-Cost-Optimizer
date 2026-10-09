import { CacheDecision } from './cache.identity';
import { CacheProvider } from './cache.request';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function textOnly(parts: unknown, typed: boolean): boolean {
  return (
    Array.isArray(parts) &&
    parts.length > 0 &&
    parts.every((value) => {
      const part = record(value);
      return (
        part &&
        typeof part.text === 'string' &&
        part.text.length > 0 &&
        (!typed || part.type === 'text') &&
        Object.keys(part).every((key) => key === 'text' || (typed && key === 'type'))
      );
    })
  );
}

export function canStoreCacheResponse(
  decision: CacheDecision,
  provider: CacheProvider,
  status: number,
  data: unknown
): boolean {
  if (decision.outcome === 'cache_bypassed' || provider !== decision.provider || status !== 200)
    return false;
  const response = record(data);
  if (!response || response.error) return false;
  if (provider === 'openai') {
    if (!Array.isArray(response.choices) || response.choices.length !== 1) return false;
    const choice = record(response.choices[0]);
    const message = record(choice?.message);
    return !!(
      choice?.finish_reason === 'stop' &&
      message?.role === 'assistant' &&
      typeof message.content === 'string' &&
      message.content.length > 0 &&
      !message.refusal &&
      Object.keys(message).every((key) => ['role', 'content', 'refusal'].includes(key))
    );
  }
  if (provider === 'anthropic') {
    return (
      response.type === 'message' &&
      response.role === 'assistant' &&
      response.stop_reason === 'end_turn' &&
      textOnly(response.content, true)
    );
  }
  if (
    record(response.promptFeedback)?.blockReason ||
    !Array.isArray(response.candidates) ||
    response.candidates.length !== 1
  )
    return false;
  const candidate = record(response.candidates[0]);
  const content = record(candidate?.content);
  const blocked =
    Array.isArray(candidate?.safetyRatings) &&
    candidate.safetyRatings.some((rating) => record(rating)?.blocked === true);
  return !!(
    !blocked &&
    candidate?.finishReason === 'STOP' &&
    content?.role === 'model' &&
    textOnly(content.parts, false) &&
    !candidate.groundingMetadata &&
    !candidate.citationMetadata
  );
}
