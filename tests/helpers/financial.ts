import { randomUUID } from 'crypto';
import bcrypt from 'bcrypt';
import { db } from '../../src/config/database';
import { redis } from '../../src/config/redis';
import { agents } from '../../src/features/agents/agents.schema.db';
import { budgets } from '../../src/features/budgets/budgets.schema.db';
import { getBudgetSpendKey } from '../../src/features/budgets/budget.redis';
import { orgs } from '../../src/features/orgs/orgs.schema.db';
import { pricingTable } from '../../src/features/pricing/pricing.schema.db';
import { encryptProviderKey } from '../../src/features/provider-keys/provider-keys.crypto';
import { orgProviderKeys } from '../../src/features/provider-keys/provider-keys.schema.db';
import { teams } from '../../src/features/teams/teams.schema.db';
import { users } from '../../src/features/user/user.schema.db';
import { hashAgentKey } from '../../src/utils/agentKey';
import { tenantToken } from './auth';

export async function seedFinancialFixture(options: { withProviderKey?: boolean; agentCount?: number } = {}) {
  const [org] = await db.insert(orgs).values({ name: `Financial ${randomUUID()}`, timezone: 'UTC' }).returning();
  const [admin] = await db.insert(users).values({ orgId: org.id, email: `financial-admin-${randomUUID()}@example.test`, passwordHash: await bcrypt.hash('CorrectPassword9!', 12), role: 'org_admin' }).returning();
  const [team] = await db.insert(teams).values({ orgId: org.id, name: 'Financial Team', teamLeadId: admin.id }).returning();
  const agentsToCreate = Array.from({ length: options.agentCount ?? 2 }, (_, index) => {
    const rawKey = `agt_financial_${index}_${randomUUID()}`;
    return { rawKey, values: { orgId: org.id, teamId: team.id, ownerUserId: admin.id, name: `Financial Agent ${index}`, apiKey: hashAgentKey(rawKey), status: 'active' as const } };
  });
  const createdAgents = await db.insert(agents).values(agentsToCreate.map((entry) => entry.values)).returning();
  if (options.withProviderKey ?? true) await db.insert(orgProviderKeys).values({ orgId: org.id, provider: 'gemini', encryptedKey: encryptProviderKey('org-gemini-test-key'), keyLastFour: 't-key', addedBy: admin.id });
  return {
    org, admin, team, agents: createdAgents.map((agent, index) => ({ ...agent, rawKey: agentsToCreate[index].rawKey })),
    adminToken: tenantToken(admin),
  };
}

export async function createBudget(input: { orgId: string; scope: 'org' | 'team' | 'agent'; scopeId: string; limitAmount: number; period?: 'daily' | 'monthly' }) {
  const [budget] = await db.insert(budgets).values({ ...input, limitAmount: String(input.limitAmount), period: input.period ?? 'monthly', resetTimezone: 'UTC' }).returning();
  return budget;
}

export async function setBudgetSpend(scope: 'org' | 'team' | 'agent', scopeId: string, budget: { period: 'daily' | 'monthly'; resetTimezone: string }, spend: number) {
  await redis.set(getBudgetSpendKey(scope, scopeId, { ...budget, limitAmount: 0 }), String(spend));
}

export async function addRate(orgId: string | null, inputPricePer1k: number, outputPricePer1k: number, model = 'gemini-3.6-flash') {
  return db.insert(pricingTable).values({ orgId, provider: 'gemini', model, inputPricePer1k: String(inputPricePer1k), outputPricePer1k: String(outputPricePer1k), effectiveDate: new Date() }).returning();
}

export function geminiRequest(rawKey: string, taskId = randomUUID(), isTest = false) {
  return {
    method: 'POST' as const,
    url: '/proxy/gemini/v1beta/models/gemini-3.6-flash:generateContent',
    headers: { 'x-agent-key': rawKey, 'x-task-id': taskId, ...(isTest ? { 'x-is-test': 'true' } : {}) },
    payload: { contents: [{ role: 'user', parts: [{ text: 'financial test prompt' }] }] },
  };
}

export const geminiSuccess = (input = 1000, output = 500) => ({ status: 200, data: { candidates: [{ content: { parts: [{ text: 'ok' }] } }], usageMetadata: { promptTokenCount: input, candidatesTokenCount: output } }, headers: { 'content-type': 'application/json' } });

export const waitFor = async <T>(fn: () => Promise<T | undefined>, attempts = 20): Promise<T> => {
  for (let i = 0; i < attempts; i += 1) { const value = await fn(); if (value !== undefined) return value; await new Promise((resolve) => setTimeout(resolve, 10)); }
  throw new Error('Timed out waiting for asynchronous proxy work');
};
