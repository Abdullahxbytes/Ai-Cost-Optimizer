import { z } from 'zod';

const text = z.string().min(1);
const textBlocks = z.array(z.object({ type: z.literal('text'), text }).strict()).min(1);
const message = z
  .object({
    role: z.enum(['system', 'developer', 'user', 'assistant']),
    content: z.union([text, textBlocks]),
  })
  .strict();
const temperature = z.number().finite().min(0).max(2).optional();
const topP = z.number().min(0).max(1).optional();
const positive = z.number().int().positive().optional();

const openai = z
  .object({
    model: text,
    messages: z.array(message).min(1),
    stream: z.literal(false).optional(),
    temperature,
    top_p: topP,
    max_tokens: positive,
    max_completion_tokens: positive,
    seed: z.number().int().optional(),
    n: z.literal(1).optional(),
    frequency_penalty: z.number().min(-2).max(2).optional(),
    presence_penalty: z.number().min(-2).max(2).optional(),
    stop: z.union([text, z.array(text)]).optional(),
    response_format: z
      .object({ type: z.literal('text') })
      .strict()
      .optional(),
  })
  .strict();
const anthropic = z
  .object({
    model: text,
    system: z.union([text, textBlocks]).optional(),
    messages: z.array(message.extend({ role: z.enum(['user', 'assistant']) })).min(1),
    max_tokens: z.number().int().positive(),
    stream: z.literal(false).optional(),
    temperature,
    top_p: topP,
    top_k: positive,
    stop_sequences: z.array(text).optional(),
  })
  .strict();
const parts = z.array(z.object({ text }).strict()).min(1);
const gemini = z
  .object({
    contents: z.array(z.object({ role: z.enum(['user', 'model']), parts }).strict()).min(1),
    systemInstruction: z.object({ parts }).strict().optional(),
    generationConfig: z
      .object({
        temperature,
        topP,
        topK: positive,
        maxOutputTokens: positive,
        candidateCount: z.literal(1).optional(),
        stopSequences: z.array(text).optional(),
        responseMimeType: z.literal('text/plain').optional(),
        seed: z.number().int().optional(),
      })
      .strict()
      .optional(),
    safetySettings: z.array(z.object({ category: text, threshold: text }).strict()).optional(),
  })
  .strict();

export type CacheProvider = 'openai' | 'anthropic' | 'gemini';
export type ParsedCacheRequest = {
  model: string;
  endpoint: string;
  // Object shape and text block boundaries are retained when only text is removed.
  semanticContext: unknown;
  question: string | null;
  conversation: boolean;
};

// Intentional allowlist: unknown extensions are forwarded normally but never
// cached. This is not a provider API validator and must not reject proxy traffic.
export function parseCacheRequest(
  provider: CacheProvider,
  path: string,
  body: unknown
): ParsedCacheRequest | null {
  if (!['openai', 'anthropic', 'gemini'].includes(provider)) return null;
  const endpoint = path.startsWith('/') ? path : `/${path}`;
  if (provider === 'gemini') {
    const match = /^\/(v1|v1beta)\/models\/([a-zA-Z0-9._-]+):generateContent$/.exec(endpoint);
    const parsed = gemini.safeParse(body);
    if (!match || !parsed.success) return null;
    const value = parsed.data;
    const last = value.contents[value.contents.length - 1];
    if (last.role !== 'user') return null;
    const conversation = value.contents.length !== 1;
    return {
      endpoint,
      model: match[2],
      conversation,
      question: !conversation && last.parts.length === 1 ? last.parts[0].text : null,
      semanticContext: {
        ...value,
        contents: value.contents.map((entry, index) =>
          index === value.contents.length - 1
            ? { ...entry, parts: entry.parts.map(() => ({ text: null })) }
            : entry
        ),
      },
    };
  }
  const expected = provider === 'openai' ? /^\/(v1\/)?chat\/completions$/ : /^\/(v1\/)?messages$/;
  const parsed = provider === 'openai' ? openai.safeParse(body) : anthropic.safeParse(body);
  if (!expected.test(endpoint) || !parsed.success) return null;
  const value = parsed.data;
  const last = value.messages[value.messages.length - 1];
  if (last.role !== 'user') return null;
  const conversation = value.messages
    .slice(0, -1)
    .some((entry) => entry.role === 'user' || entry.role === 'assistant');
  const question =
    typeof last.content === 'string'
      ? last.content
      : last.content.length === 1
        ? last.content[0].text
        : null;
  return {
    model: value.model,
    endpoint,
    conversation,
    question: conversation ? null : question,
    semanticContext: {
      ...value,
      messages: value.messages.map((entry, index) =>
        index === value.messages.length - 1
          ? {
              ...entry,
              content:
                typeof entry.content === 'string'
                  ? null
                  : entry.content.map((part) => ({ ...part, text: null })),
            }
          : entry
      ),
    },
  };
}
