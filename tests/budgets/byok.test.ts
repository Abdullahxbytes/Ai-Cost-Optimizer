import axios from 'axios';
import { jest } from '@jest/globals';
import { and, eq } from 'drizzle-orm';
import { db } from '../../src/config/database';
import { orgProviderKeys } from '../../src/features/provider-keys/provider-keys.schema.db';
import { testApp } from '../helpers/auth';
import { geminiRequest, geminiSuccess, seedFinancialFixture } from '../helpers/financial';

describe('BYOK proxy integration', () => {
  it('rejects a proxy request with 400 when no org provider key is configured', async () => {
    const f = await seedFinancialFixture({ withProviderKey: false, agentCount: 1 }); const app = await testApp(); const spy = jest.spyOn(axios, 'post');
    try { const response = await app.inject(geminiRequest(f.agents[0].rawKey)); expect(response.statusCode).toBe(400); expect(response.json().error).toBe('No API key configured for this provider. Add one in your organization settings.'); expect(spy).not.toHaveBeenCalled(); }
    finally { spy.mockRestore(); await app.close(); }
  });
  it('uses the decrypted organization key at the provider adapter, with no env fallback', async () => {
    const f = await seedFinancialFixture({ agentCount: 1 }); const app = await testApp(); const spy = jest.spyOn(axios, 'post').mockResolvedValue(geminiSuccess() as never);
    try { expect((await app.inject(geminiRequest(f.agents[0].rawKey))).statusCode).toBe(200); expect((spy.mock.calls[0][2] as { params: { key: string } }).params.key).toBe('org-gemini-test-key'); }
    finally { spy.mockRestore(); await app.close(); }
  });
  it('rejects the next proxy call immediately after an org key is deleted', async () => {
    const f = await seedFinancialFixture({ agentCount: 1 }); const app = await testApp(); const spy = jest.spyOn(axios, 'post');
    try { await db.delete(orgProviderKeys).where(and(eq(orgProviderKeys.orgId, f.org.id), eq(orgProviderKeys.provider, 'gemini'))); const response = await app.inject(geminiRequest(f.agents[0].rawKey)); expect(response.statusCode).toBe(400); expect(spy).not.toHaveBeenCalled(); }
    finally { spy.mockRestore(); await app.close(); }
  });
});
