import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { db } from '../../src/config/database';
import { env } from '../../src/config/env';
import { users } from '../../src/features/user/user.schema.db';
import { createTenant, testApp } from '../helpers/auth';

const loadOtp = (): Promise<{ generate: (input: { secret: string }) => Promise<string> }> => new Function('modulePath', 'return import(modulePath)')('otplib');

async function pendingToken(app: Awaited<ReturnType<typeof testApp>>, email: string, password: string) {
  return (await app.inject({ method: 'POST', url: '/auth/login', remoteAddress: '10.1.0.1', payload: { email, password } })).json().pendingToken as string;
}
async function setup(app: Awaited<ReturnType<typeof testApp>>, token: string) {
  return app.inject({ method: 'POST', url: '/auth/2fa/setup', headers: { authorization: `Bearer ${token}` } });
}

describe('2FA setup and verification', () => {
  it('generates a secret and QR code', async () => {
    const { user, password } = await createTenant(); const app = await testApp();
    try { const response = await setup(app, await pendingToken(app, user.email, password)); expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ manualEntryKey: expect.any(String), qrCodeDataUrl: expect.stringContaining('data:image') }); } finally { await app.close(); }
  });
  it('rejects setup when 2FA is already configured', async () => {
    const { user, password } = await createTenant(); const app = await testApp();
    try { const pending = await pendingToken(app, user.email, password); expect((await setup(app, pending)).statusCode).toBe(200); const again = await setup(app, pending); expect(again.statusCode).toBe(400); } finally { await app.close(); }
  });
  it('returns a real session JWT for a correct TOTP and valid pending token', async () => {
    const { user, password } = await createTenant(); const app = await testApp();
    try { const pending = await pendingToken(app, user.email, password); await setup(app, pending); const [stored] = await db.select({ secret: users.twoFactorSecret }).from(users).where(eq(users.id, user.id)); const code = await (await loadOtp()).generate({ secret: stored.secret! }); const verified = await app.inject({ method: 'POST', url: '/auth/2fa/verify', headers: { authorization: `Bearer ${pending}` }, payload: { code } }); expect(verified.statusCode).toBe(200); expect(jwt.decode(verified.json().token)).toMatchObject({ user_id: user.id, org_id: user.orgId, role: 'org_admin' }); } finally { await app.close(); }
  });
  it('rejects an incorrect TOTP with 401', async () => {
    const { user, password } = await createTenant(); const app = await testApp();
    try { const pending = await pendingToken(app, user.email, password); await setup(app, pending); const response = await app.inject({ method: 'POST', url: '/auth/2fa/verify', headers: { authorization: `Bearer ${pending}` }, payload: { code: '000000' } }); expect(response.statusCode).toBe(401); } finally { await app.close(); }
  });
  it('rejects an expired pending token with 401', async () => {
    const { user } = await createTenant(); const app = await testApp();
    try { const expired = jwt.sign({ user_id: user.id, org_id: user.orgId, purpose: '2fa_pending' }, env.JWT_SECRET, { expiresIn: -1 }); const response = await setup(app, expired); expect(response.statusCode).toBe(401); } finally { await app.close(); }
  });
  it('rate-limits the sixth failed 2FA verification attempt in the window', async () => {
    const { user, password } = await createTenant(); const app = await testApp();
    try { const pending = await pendingToken(app, user.email, password); await setup(app, pending); for (let attempt = 1; attempt <= 5; attempt += 1) expect((await app.inject({ method: 'POST', url: '/auth/2fa/verify', headers: { authorization: `Bearer ${pending}` }, payload: { code: '000000' } })).statusCode).toBe(401); const sixth = await app.inject({ method: 'POST', url: '/auth/2fa/verify', headers: { authorization: `Bearer ${pending}` }, payload: { code: '000000' } }); expect(sixth.statusCode).toBe(429); } finally { await app.close(); }
  });
});
