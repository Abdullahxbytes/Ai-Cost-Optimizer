import { createTenant, testApp } from '../helpers/auth';

describe('login', () => {
  it('returns a pending token and the correct twoFactorConfigured flag for valid credentials', async () => {
    const { user, password } = await createTenant(); const app = await testApp();
    try { const response = await app.inject({ method: 'POST', url: '/auth/login', remoteAddress: '10.0.0.1', payload: { email: user.email, password } }); expect(response.statusCode).toBe(200); expect(response.json()).toEqual({ pendingToken: expect.any(String), twoFactorConfigured: false }); } finally { await app.close(); }
  });
  it('returns a generic 401 for a wrong password', async () => { const { user } = await createTenant(); const app = await testApp(); try { const response = await app.inject({ method: 'POST', url: '/auth/login', remoteAddress: '10.0.0.2', payload: { email: user.email, password: 'WrongPassword9!' } }); expect(response.statusCode).toBe(401); expect(response.json().error).toBe('Invalid credentials'); } finally { await app.close(); } });
  it('returns the same generic 401 for a nonexistent email', async () => { const app = await testApp(); try { const response = await app.inject({ method: 'POST', url: '/auth/login', remoteAddress: '10.0.0.3', payload: { email: 'missing@example.test', password: 'WrongPassword9!' } }); expect(response.statusCode).toBe(401); expect(response.json().error).toBe('Invalid credentials'); } finally { await app.close(); } });
  it('rate-limits the sixth failed login attempt in the window', async () => {
    const { user } = await createTenant(); const app = await testApp();
    try { for (let attempt = 1; attempt <= 5; attempt += 1) expect((await app.inject({ method: 'POST', url: '/auth/login', remoteAddress: '10.0.0.4', payload: { email: user.email, password: 'WrongPassword9!' } })).statusCode).toBe(401); const sixth = await app.inject({ method: 'POST', url: '/auth/login', remoteAddress: '10.0.0.4', payload: { email: user.email, password: 'WrongPassword9!' } }); expect(sixth.statusCode).toBe(429); expect(sixth.json()).toMatchObject({ code: 'RATE_LIMIT' }); } finally { await app.close(); }
  });
  it('applies the account failure limit even when attempts use different IP addresses', async () => {
    const { user } = await createTenant(); const app = await testApp();
    try {
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const response = await app.inject({ method: 'POST', url: '/auth/login', remoteAddress: `10.20.0.${attempt}`, payload: { email: user.email, password: 'WrongPassword9!' } });
        expect(response.statusCode).toBe(401);
      }
      const blocked = await app.inject({ method: 'POST', url: '/auth/login', remoteAddress: '10.20.0.99', payload: { email: user.email, password: 'WrongPassword9!' } });
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json()).toMatchObject({ code: 'RATE_LIMIT', scope: 'account', retryAfter: expect.any(Number) });
      expect(blocked.headers['retry-after']).toBeDefined();
    } finally { await app.close(); }
  });
  it('does not count successful logins as failed attempts', async () => {
    const { user, password } = await createTenant(); const app = await testApp();
    try {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const response = await app.inject({ method: 'POST', url: '/auth/login', remoteAddress: '10.30.0.1', payload: { email: user.email, password } });
        expect(response.statusCode).toBe(200);
      }
    } finally { await app.close(); }
  });
});
