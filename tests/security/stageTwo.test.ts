import pino from 'pino';
import { Writable } from 'stream';
import { logRedactPaths } from '../../src/utils/logger';
import { testApp } from '../helpers/auth';

describe('stage two deployment and logging controls', () => {
  it('allows configured browser origins and omits CORS permission for others', async () => {
    const app = await testApp();
    try {
      const allowed = await app.inject({
        method: 'OPTIONS',
        url: '/health',
        headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'GET' },
      });
      expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      const denied = await app.inject({
        method: 'OPTIONS',
        url: '/health',
        headers: { origin: 'https://attacker.example', 'access-control-request-method': 'GET' },
      });
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('redacts credentials from structured logs', () => {
    let output = '';
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const testLogger = pino(
      { redact: { paths: logRedactPaths, censor: '[REDACTED]' } },
      destination
    );
    testLogger.info(
      {
        req: { headers: { authorization: 'Bearer secret-session', 'x-agent-key': 'agt_secret' } },
        apiKey: 'provider-secret',
        password: 'password-secret',
      },
      'security-test'
    );
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('secret-session');
    expect(output).not.toContain('agt_secret');
    expect(output).not.toContain('provider-secret');
    expect(output).not.toContain('password-secret');
  });
});
