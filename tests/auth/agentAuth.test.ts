import { createAgent, createTenant, testApp } from '../helpers/auth';
import { hashAgentKey } from '../../src/utils/agentKey';

async function proxyStatus(key: string) {
  const app = await testApp();
  try { return (await app.inject({ method: 'POST', url: '/proxy/gemini/v1beta/models/test:generateContent', headers: { 'x-agent-key': key }, payload: { contents: [] } })).statusCode; } finally { await app.close(); }
}

describe('agent authentication', () => {
  it('accepts a valid active agent key', async () => { const { org, user } = await createTenant(); const { rawKey } = await createAgent({ orgId: org.id, ownerUserId: user.id, status: 'active' }); expect(await proxyStatus(rawKey)).not.toBe(401); });
  it('rejects a paused agent key with 403', async () => { const { org, user } = await createTenant(); const { rawKey } = await createAgent({ orgId: org.id, ownerUserId: user.id, status: 'paused' }); expect(await proxyStatus(rawKey)).toBe(403); });
  it('rejects a pending-approval agent key with 403', async () => { const { org, user } = await createTenant(); const { rawKey } = await createAgent({ orgId: org.id, ownerUserId: user.id, status: 'pending_approval' }); expect(await proxyStatus(rawKey)).toBe(403); });
  it('still accepts a pending-deletion agent key by design', async () => { const { org, user } = await createTenant(); const { rawKey } = await createAgent({ orgId: org.id, ownerUserId: user.id, status: 'pending_deletion' }); expect(await proxyStatus(rawKey)).not.toBe(401); });
  it('rejects an invalid or nonexistent agent key with 401', async () => expect(await proxyStatus('agt_does_not_exist')).toBe(401));
  it('stores and resolves agent credentials via HMAC, never plaintext comparison', async () => {
    const { org, user } = await createTenant(); const { agent, rawKey } = await createAgent({ orgId: org.id, ownerUserId: user.id, status: 'active' });
    expect(agent.apiKey).toBe(hashAgentKey(rawKey)); expect(agent.apiKey).not.toBe(rawKey); expect(await proxyStatus(rawKey)).not.toBe(401);
  });
});
