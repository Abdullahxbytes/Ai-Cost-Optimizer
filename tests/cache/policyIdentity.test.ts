import {
  cachePolicySchema,
  DEFAULT_CACHE_POLICY,
} from '../../src/features/optimization/cache/cache.policy';
import {
  evaluateCacheRequest,
  isCurrentCacheEntry,
} from '../../src/features/optimization/cache/cache.identity';
import { allowed, body, context, input, policy } from './fixtures';

describe('cache policy and identity foundation', () => {
  it('defaults off; missing, unknown-version and malformed policies fail closed', () => {
    for (const value of [
      null,
      {},
      { ...input.policy, schemaVersion: 1 },
      { ...input.policy, revision: 0 },
      { ...input.policy, policy: DEFAULT_CACHE_POLICY },
      { ...input.policy, policy: { ...policy, unexpected: true } },
    ]) {
      expect(evaluateCacheRequest({ ...input, policy: value }).outcome).toBe('cache_bypassed');
    }
  });
  it.each([
    { storageAllowed: false },
    { risk: 'sensitive' },
    { risk: 'side_effecting' },
    { freshness: 'live' },
    { semanticApproved: false },
    { ttlSeconds: 0 },
    { ttlSeconds: 86401 },
    { ttlSeconds: 1.5 },
    { similarityThreshold: 0.79 },
    { similarityThreshold: 1.01 },
    { knowledgeVersion: '' },
  ])('rejects unsafe/invalid policy configuration %j', (change) => {
    expect(cachePolicySchema.safeParse({ ...policy, ...change }).success).toBe(false);
  });
  it('only normalizes object key order, never text, arrays, punctuation or role ordering', () => {
    const original = allowed();
    expect(
      allowed({ body: { temperature: 0, messages: body.messages, model: body.model } }).exactKey
    ).toBe(original.exactKey);
    for (const text of [
      'How do I sign in? ',
      'how do i sign in?',
      'How do I sign in',
      'How  do I sign in?',
    ]) {
      expect(
        allowed({
          body: { ...body, messages: [body.messages[0], { role: 'user', content: text }] },
        }).exactKey
      ).not.toBe(original.exactKey);
    }
    const systems = [
      { role: 'system', content: 'A' },
      { role: 'system', content: 'B' },
    ];
    expect(
      allowed({ body: { ...body, messages: [...systems, body.messages[1]] } }).exactKey
    ).not.toBe(
      allowed({ body: { ...body, messages: [...systems.reverse(), body.messages[1]] } }).exactKey
    );
  });
  it('varies only a single question in a semantic partition; exact key still differs', () => {
    const changed = allowed({
      body: { ...body, messages: [body.messages[0], { role: 'user', content: 'Where is login?' }] },
    });
    expect(changed.partitionKey).toBe(allowed().partitionKey);
    expect(changed.exactKey).not.toBe(allowed().exactKey);
    expect(changed.question).toBe('Where is login?');
  });
  it.each([
    { orgId: '00000000-0000-4000-8000-000000000003' },
    { agentId: '00000000-0000-4000-8000-000000000004' },
    { environment: 'staging' },
    { providerCredentialVersion: 'key-v2' },
    { providerApiVersion: 'v2' },
    { modelRevision: 'release-2' },
    { transformationVersion: 'autocorrect-v2' },
    { endUser: { subject: 'alice', authorizationVersion: '1' } },
  ])('partitions both keys by trusted context %j', (change) => {
    const changed = allowed({ context: { ...context, ...change } });
    expect(changed.exactKey).not.toBe(allowed().exactKey);
    expect(changed.partitionKey).not.toBe(allowed().partitionKey);
  });
  it.each([
    { workload: 'other' },
    { workloadVersion: '2' },
    { knowledgeVersion: 'docs-2' },
    { promptVersion: 'prompt-2' },
    { similarityThreshold: 0.99 },
    { ttlSeconds: 10 },
  ])('invalidates identity when policy changes %j', (change) => {
    const changed = allowed({ policy: { ...input.policy, policy: { ...policy, ...change } } });
    expect(changed.exactKey).not.toBe(allowed().exactKey);
    expect(changed.partitionKey).not.toBe(allowed().partitionKey);
  });
  it('partitions settings, system instructions, endpoint and model changes', () => {
    for (const change of [
      { body: { ...body, model: 'other' } },
      { body: { ...body, temperature: 0.9 } },
      {
        body: {
          ...body,
          messages: [{ role: 'system', content: 'Different rules' }, body.messages[1]],
        },
      },
      { path: '/chat/completions' },
      { policy: { ...input.policy, revision: 2 } },
    ]) {
      const changed = allowed(change);
      expect(changed.exactKey).not.toBe(allowed().exactKey);
      expect(changed.partitionKey).not.toBe(allowed().partitionKey);
    }
  });
  it('requires trusted subject and authorization version for personalized reuse', () => {
    const personalized = { ...input.policy, policy: { ...policy, scope: 'end_user' } };
    expect(evaluateCacheRequest({ ...input, policy: personalized }).outcome).toBe('cache_bypassed');
    expect(
      evaluateCacheRequest({ ...input, context: { ...context, endUser: { subject: 'alice' } } })
        .outcome
    ).toBe('cache_bypassed');
    const alice = allowed({
      policy: personalized,
      context: { ...context, endUser: { subject: 'alice', authorizationVersion: '1' } },
    });
    for (const endUser of [
      { subject: 'bob', authorizationVersion: '1' },
      { subject: 'alice', authorizationVersion: '2' },
    ]) {
      const other = allowed({ policy: personalized, context: { ...context, endUser } });
      expect(other.partitionKey).not.toBe(alice.partitionKey);
      expect(other.exactKey).not.toBe(alice.exactKey);
    }
  });
  it('allows conversation only by exact opt-in, never semantic similarity', () => {
    const history = {
      ...body,
      messages: [
        ...body.messages,
        { role: 'assistant', content: 'Prior answer' },
        { role: 'user', content: 'Why?' },
      ],
    };
    expect(evaluateCacheRequest({ ...input, body: history }).outcome).toBe('cache_bypassed');
    const optedIn = { ...input.policy, policy: { ...policy, allowConversationExact: true } };
    expect(allowed({ body: history, policy: optedIn })).toMatchObject({
      outcome: 'exact_cache_allowed',
      partitionKey: null,
    });
    expect(
      allowed({
        body: {
          ...history,
          messages: [
            body.messages[0],
            { role: 'user', content: 'Different context' },
            ...history.messages.slice(2),
          ],
        },
        policy: optedIn,
      }).exactKey
    ).not.toBe(allowed({ body: history, policy: optedIn }).exactKey);
  });
  it('exact-only policies never generate semantic search material', () => {
    expect(
      allowed({
        policy: { ...input.policy, policy: { ...policy, mode: 'exact', semanticApproved: false } },
      })
    ).toMatchObject({ outcome: 'exact_cache_allowed', question: null, partitionKey: null });
  });
  it('rejects expiry, future dates, legacy rows, partition mismatch and invalidated revisions', () => {
    const decision = allowed();
    const now = new Date('2026-10-07T00:30:00Z');
    const entry = {
      ...decision,
      createdAt: new Date('2026-10-07T00:00:00Z'),
      expiresAt: new Date('2026-10-07T01:00:00Z'),
    };
    expect(isCurrentCacheEntry(entry, decision, 'exact', now)).toBe(true);
    expect(isCurrentCacheEntry(entry, decision, 'semantic', now)).toBe(true);
    for (const change of [
      { schemaVersion: 1 },
      { policyRevision: 2 },
      { expiresAt: now },
      { createdAt: new Date('2026-10-08') },
      { expiresAt: new Date(NaN) },
      { createdAt: new Date('2026-10-06') },
    ]) {
      expect(isCurrentCacheEntry({ ...entry, ...change }, decision, 'exact', now)).toBe(false);
    }
    expect(isCurrentCacheEntry({}, decision, 'exact', now)).toBe(false);
    expect(
      isCurrentCacheEntry({ ...entry, partitionKey: 'another' }, decision, 'semantic', now)
    ).toBe(false);
    expect(isCurrentCacheEntry({ ...entry, exactKey: 'another' }, decision, 'exact', now)).toBe(
      false
    );
  });
});
