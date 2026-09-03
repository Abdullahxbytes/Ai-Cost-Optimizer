import 'dotenv/config';
import { randomUUID } from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db, client } from '../src/config/database';
import { env } from '../src/config/env';
import { orgs } from '../src/features/orgs/orgs.schema.db';
import { users } from '../src/features/user/user.schema.db';
import { notifications } from '../src/features/notifications/notifications.schema.db';

const baseUrl = 'http://127.0.0.1:3000';
async function call(path: string, init: RequestInit) { const response = await fetch(`${baseUrl}${path}`, init); return { status: response.status, body: await response.json() }; }
async function main() {
  let orgId: string | undefined; let userId: string | undefined;
  try {
    const oldPassword = 'OldPassword9!'; const newPassword = 'NewPassword9!'; const suffix = randomUUID();
    const [org] = await db.insert(orgs).values({ name: `Profile test ${suffix}`, timezone: 'UTC' }).returning(); orgId = org.id;
    const [user] = await db.insert(users).values({ orgId, email: `profile-${suffix}@example.test`, passwordHash: await bcrypt.hash(oldPassword, 12), role: 'org_admin' }).returning(); userId = user.id;
    const token = jwt.sign({ user_id: userId, org_id: orgId, role: 'org_admin', token_version: 0 }, env.JWT_SECRET, { expiresIn: '5m' }); const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const profile = await call('/auth/me', { method: 'GET', headers });
    const [notification] = await db.insert(notifications).values({ userId, orgId, eventType: 'budget_alert_triggered', channel: 'in_app', message: 'Budget alert click-through test', severity: 'P3', priority: 'info', read: false }).returning();
    const read = await call(`/notifications/${notification.id}`, { method: 'PATCH', headers, body: JSON.stringify({ read: true }) });
    const change = await call('/auth/change-password', { method: 'POST', headers, body: JSON.stringify({ currentPassword: oldPassword, newPassword }) });
    const oldLogin = await call('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: user.email, password: oldPassword }) });
    const newLogin = await call('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: user.email, password: newPassword }) });
    if (profile.status !== 200 || profile.body.orgName !== org.name || read.status !== 200 || change.status !== 200 || oldLogin.status !== 401 || newLogin.status !== 200) throw new Error('Profile/password/notification verification failed');
    console.log(JSON.stringify({ profile: { status: profile.status, orgName: profile.body.orgName }, notificationRead: read.status, password: { change: change.status, oldLogin: oldLogin.status, newLogin: newLogin.status } }, null, 2));
  } finally { if (orgId) await db.delete(notifications).where(eq(notifications.orgId, orgId)); if (userId) await db.delete(users).where(eq(users.id, userId)); if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId)); await client.end(); }
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
