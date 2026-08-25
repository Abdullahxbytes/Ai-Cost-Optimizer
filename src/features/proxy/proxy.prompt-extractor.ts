import { ProviderName } from './providers/provider.types';

function textFromContent(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const text = content
    .map((part) =>
      typeof part === 'object' && part !== null && typeof (part as { text?: unknown }).text === 'string'
        ? (part as { text: string }).text
        : ''
    )
    .filter(Boolean)
    .join('\n');
  return text || null;
}

export function extractPromptText(provider: ProviderName, requestBody: unknown): string | null {
  if (typeof requestBody !== 'object' || requestBody === null) return null;
  const body = requestBody as { messages?: unknown; contents?: unknown };

  if (provider === 'openai' || provider === 'anthropic') {
    if (!Array.isArray(body.messages)) return null;
    for (let index = body.messages.length - 1; index >= 0; index -= 1) {
      const message = body.messages[index];
      if (typeof message !== 'object' || message === null) continue;
      const text = textFromContent((message as { content?: unknown }).content);
      if (text) return text;
    }
    return null;
  }

  if (!Array.isArray(body.contents)) return null;
  for (let index = body.contents.length - 1; index >= 0; index -= 1) {
    const content = body.contents[index];
    if (typeof content !== 'object' || content === null) continue;
    const parts = (content as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) continue;
    const text = parts
      .map((part) =>
        typeof part === 'object' && part !== null && typeof (part as { text?: unknown }).text === 'string'
          ? (part as { text: string }).text
          : ''
      )
      .filter(Boolean)
      .join('\n');
    if (text) return text;
  }
  return null;
}

function replaceTextInParts(parts: unknown[], newText: string): unknown[] {
  let replaced = false;
  return parts.map((part) => {
    if (
      typeof part === 'object' &&
      part !== null &&
      typeof (part as { text?: unknown }).text === 'string'
    ) {
      if (!replaced) {
        replaced = true;
        return { ...(part as Record<string, unknown>), text: newText };
      }
      return { ...(part as Record<string, unknown>), text: '' };
    }
    return part;
  });
}

export function injectOptimizedText(
  provider: ProviderName,
  requestBody: unknown,
  newText: string
): unknown {
  if (typeof requestBody !== 'object' || requestBody === null) return requestBody;
  const body = { ...(requestBody as Record<string, unknown>) };
  const collectionKey = provider === 'gemini' ? 'contents' : 'messages';
  const collection = body[collectionKey];
  if (!Array.isArray(collection)) return requestBody;

  const updated = [...collection];
  for (let index = updated.length - 1; index >= 0; index -= 1) {
    const entry = updated[index];
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const contentKey = provider === 'gemini' ? 'parts' : 'content';
    const content = record[contentKey];
    if (typeof content === 'string') {
      updated[index] = { ...record, [contentKey]: newText };
      return { ...body, [collectionKey]: updated };
    }
    if (Array.isArray(content) && textFromContent(content)) {
      updated[index] = { ...record, [contentKey]: replaceTextInParts(content, newText) };
      return { ...body, [collectionKey]: updated };
    }
  }
  return requestBody;
}
