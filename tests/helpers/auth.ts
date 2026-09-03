import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { buildApp } from '../../src/app';
import { db } from '../../src/config/database';
import { env } from '../../src/config/env';
import { agents } from '../../src/features/agents/agents.schema.db';
import { orgs } from '../../src/features/orgs/orgs.schema.db';
import { superAdmins, users } from '../../src/features/user/user.schema.db';
import { hashAgentKey } from '../../src/utils/agentKey';

export async function testApp() {
  return buildApp();
}

export async function createTenant(input: { email?: string; password?: string; role?: 'org_admin' | 'team_lead' | 'developer' | 'finance' | 'auditor'; status?: 'active' | 'blocked'; tokenVersion?: number } = {}) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const password = input.password ?? 'CorrectPassword9!';
  const [org] = await db.insert(orgs).values({ name: `Test org ${suffix}`, timezone: 'UTC', status: input.status ?? 'active' }).returning();
  const [user] = await db.insert(users).values({ orgId: org.id, email: input.email ?? `user-${suffix}@example.test`, passwordHash: await bcrypt.hash(password, 12), role: input.role ?? 'org_admin', tokenVersion: input.tokenVersion ?? 0 }).returning();
  return { org, user, password };
}

export async function createSuperAdmin(input: { email?: string; password?: string; tokenVersion?: number } = {}) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const password = input.password ?? 'CorrectPassword9!';
  const [admin] = await db.insert(superAdmins).values({ email: input.email ?? `super-${suffix}@example.test`, passwordHash: await bcrypt.hash(password, 12), tokenVersion: input.tokenVersion ?? 0 }).returning();
  return { admin, password };
}

export function tenantToken(user: { id: string; orgId: string; role: string; tokenVersion: number }, expiresIn: jwt.SignOptions['expiresIn'] = '1h') {
  return jwt.sign({ user_id: user.id, org_id: user.orgId, role: user.role, token_version: user.tokenVersion }, env.JWT_SECRET, { expiresIn });
}

export function superAdminToken(admin: { id: string; tokenVersion: number }, expiresIn: jwt.SignOptions['expiresIn'] = '1h') {
  return jwt.sign({ user_id: admin.id, org_id: null, role: 'super_admin', token_version: admin.tokenVersion }, env.JWT_SECRET, { expiresIn });
}

export async function createAgent(input: { orgId: string; ownerUserId: string; status: 'active' | 'paused' | 'pending_approval' | 'pending_deletion'; teamId?: string | null }) {
  const rawKey = `agt_test_${Math.random().toString(36).slice(2)}${Date.now()}`;
  const [agent] = await db.insert(agents).values({ orgId: input.orgId, ownerUserId: input.ownerUserId, teamId: input.teamId ?? null, name: 'Test agent', apiKey: hashAgentKey(rawKey), status: input.status }).returning();
  return { agent, rawKey };
}
