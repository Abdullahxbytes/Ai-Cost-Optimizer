import axios from 'axios';
import { jest } from '@jest/globals';
import { and, eq } from 'drizzle-orm';
import { db } from '../../src/config/database';
import { auditLog } from '../../src/features/audit/audit.schema.db';
import { encryptProviderKey } from '../../src/features/provider-keys/provider-keys.crypto';
import { orgProviderKeys } from '../../src/features/provider-keys/provider-keys.schema.db';
import { testApp } from '../helpers/auth';
import { geminiRequest, geminiSuccess, seedFinancialFixture } from '../helpers/financial';

describe('BYOK deletion effects', () => {
  it('immediately blocks only the deleted provider and logs the removal', async () => {
    const f = await seedFinancialFixture({ agentCount: 1 }); const app = await testApp(); const spy = jest.spyOn(axios, 'post').mockResolvedValue(geminiSuccess() as never); const headers = { authorization: `Bearer ${f.adminToken}` };
    try {
      await db.insert(orgProviderKeys).values({ orgId: f.org.id, provider: 'openai', encryptedKey: encryptProviderKey('org-openai-test-key'), keyLastFour: 'n-key', addedBy: f.admin.id });
      const removed = await app.inject({ method: 'DELETE', url: `/orgs/${f.org.id}/provider-keys/gemini`, headers }); expect(removed.statusCode).toBe(200);
      expect((await app.inject(geminiRequest(f.agents[0].rawKey))).statusCode).toBe(400);
      const openai = await app.inject({ method: 'POST', url: '/proxy/openai/v1/chat/completions', headers: { 'x-agent-key': f.agents[0].rawKey }, payload: { model: 'gpt-4o', messages: [{ role: 'user', content: 'still configured' }] } }); expect(openai.statusCode).toBe(200);
      const logs = await db.select().from(auditLog).where(and(eq(auditLog.orgId, f.org.id), eq(auditLog.eventType, 'provider_key_removed'))); expect(logs).toHaveLength(1); expect(logs[0].metadata).toMatchObject({ provider: 'gemini' });
    } finally { spy.mockRestore(); await app.close(); }
  });
});
