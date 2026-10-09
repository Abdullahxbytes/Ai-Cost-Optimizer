import { evaluateCacheRequest } from '../../src/features/optimization/cache/cache.identity';
import { canStoreCacheResponse } from '../../src/features/optimization/cache/cache.response';
import { allowed, body, input } from './fixtures';

describe('provider request and response eligibility', () => {
  it.each([
    { tools: [] },
    { tool_choice: 'auto' },
    { functions: [] },
    { function_call: 'auto' },
    { stream: true },
    { previous_response_id: 'state' },
    { user: 'untrusted-user' },
    { web_search_options: {} },
    { unknownExtension: true },
    { n: 2 },
    { response_format: { type: 'json_object' } },
    { messages: [{ role: 'tool', content: 'private result' }] },
    { messages: [{ role: 'assistant', content: 'unfinished assistant' }] },
    { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: 'image' }] }] },
    { messages: [{ role: 'user', content: 'q', extra: 'ignored context?' }] },
  ])('bypasses unsupported requests without guessing their intent %j', (change) => {
    expect(evaluateCacheRequest({ ...input, body: { ...body, ...change } }).outcome).toBe(
      'cache_bypassed'
    );
  });
  it.each([
    '/v1/responses',
    '/v1/chat/completions?foo=1',
    '//v1/chat/completions',
    '/v1/chat/completions/',
  ])('bypasses unapproved endpoint %s', (path) => {
    expect(evaluateCacheRequest({ ...input, path }).outcome).toBe('cache_bypassed');
  });
  it('supports approved Anthropic and Gemini plain text shapes and fixes system context', () => {
    const anthropic = {
      provider: 'anthropic' as const,
      path: '/v1/messages',
      body: {
        model: 'test-model',
        max_tokens: 100,
        system: 'Private rules',
        messages: [{ role: 'user', content: 'q' }],
      },
    };
    const a = allowed(anthropic);
    expect(a.outcome).toBe('semantic_cache_allowed');
    expect(
      allowed({ ...anthropic, body: { ...anthropic.body, system: 'New rules' } }).partitionKey
    ).not.toBe(a.partitionKey);
    const gemini = {
      provider: 'gemini' as const,
      path: '/v1beta/models/test-model:generateContent',
      body: {
        systemInstruction: { parts: [{ text: 'Rules' }] },
        contents: [{ role: 'user', parts: [{ text: 'q' }] }],
      },
    };
    const g = allowed(gemini);
    expect(g.outcome).toBe('semantic_cache_allowed');
    expect(
      allowed({ ...gemini, path: '/v1beta/models/other:generateContent' }).partitionKey
    ).not.toBe(g.partitionKey);
    expect(
      allowed({
        ...gemini,
        body: { ...gemini.body, systemInstruction: { parts: [{ text: 'Other rules' }] } },
      }).partitionKey
    ).not.toBe(g.partitionKey);
    for (const override of [
      { tools: [] },
      { cachedContent: 'external' },
      { contents: [{ role: 'user', parts: [{ functionResponse: {} }] }] },
    ]) {
      expect(
        evaluateCacheRequest({ ...input, ...gemini, body: { ...gemini.body, ...override } }).outcome
      ).toBe('cache_bypassed');
    }
  });
  it('accepts only completed plain-text provider responses', () => {
    const openai = {
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Answer' } }],
    };
    expect(canStoreCacheResponse(allowed(), 'openai', 200, openai)).toBe(true);
    for (const status of [201, 400, 429, 500])
      expect(canStoreCacheResponse(allowed(), 'openai', status, openai)).toBe(false);
    for (const data of [
      null,
      'text stream',
      { error: 'bad', ...openai },
      { choices: [] },
      {
        choices: [{ finish_reason: 'length', message: { role: 'assistant', content: 'Partial' } }],
      },
      {
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'Answer', tool_calls: [{}] },
          },
        ],
      },
      {
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'Answer', refusal: 'No' },
          },
        ],
      },
    ]) {
      expect(canStoreCacheResponse(allowed(), 'openai', 200, data)).toBe(false);
    }
    const a = allowed({
      provider: 'anthropic',
      path: '/v1/messages',
      body: { model: 'test', max_tokens: 10, messages: [body.messages[1]] },
    });
    const aResponse = {
      type: 'message',
      role: 'assistant',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Answer' }],
    };
    expect(canStoreCacheResponse(a, 'anthropic', 200, aResponse)).toBe(true);
    expect(
      canStoreCacheResponse(a, 'anthropic', 200, { ...aResponse, stop_reason: 'max_tokens' })
    ).toBe(false);
    expect(
      canStoreCacheResponse(a, 'anthropic', 200, {
        ...aResponse,
        content: [{ type: 'tool_use', text: 'unsafe' }],
      })
    ).toBe(false);
    const g = allowed({
      provider: 'gemini',
      path: '/v1beta/models/test:generateContent',
      body: { contents: [{ role: 'user', parts: [{ text: 'q' }] }] },
    });
    const gResponse = {
      candidates: [
        { finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'Answer' }] } },
      ],
    };
    expect(canStoreCacheResponse(g, 'gemini', 200, gResponse)).toBe(true);
    expect(
      canStoreCacheResponse(g, 'gemini', 200, {
        ...gResponse,
        promptFeedback: { blockReason: 'SAFETY' },
      })
    ).toBe(false);
    expect(
      canStoreCacheResponse(g, 'gemini', 200, {
        candidates: [
          { ...gResponse.candidates[0], content: { role: 'model', parts: [{ functionCall: {} }] } },
        ],
      })
    ).toBe(false);
    expect(
      canStoreCacheResponse({ outcome: 'cache_bypassed', reason: 'off' }, 'openai', 200, openai)
    ).toBe(false);
    expect(canStoreCacheResponse(a, 'openai', 200, openai)).toBe(false);
  });
});
