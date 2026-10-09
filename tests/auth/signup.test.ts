import { db } from '../../src/config/database';
import { users } from '../../src/features/user/user.schema.db';
import { testApp } from '../helpers/auth';

describe('signup', () => {
  it('creates an organization and Org Admin for valid input', async () => {
    const app = await testApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: {
          orgName: 'Signup org',
          email: 'signup@example.test',
          password: 'CorrectPassword9!',
        },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        orgId: expect.any(String),
        userId: expect.any(String),
        email: 'signup@example.test',
      });
    } finally {
      await app.close();
    }
  });
  it('rejects a duplicate email within the same organization', async () => {
    const app = await testApp();
    try {
      const first = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: { orgName: 'Same org', email: 'same@example.test', password: 'CorrectPassword9!' },
      });
      const created = first.json();
      const response = await db
        .insert(users)
        .values({
          orgId: created.orgId,
          email: 'same@example.test',
          passwordHash: 'ignored',
          role: 'developer',
        })
        .catch((error) => error);
      expect(response).toMatchObject({ message: expect.any(String) });
    } finally {
      await app.close();
    }
  });
  it('rejects a duplicate email across different organizations', async () => {
    const app = await testApp();
    try {
      await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: {
          orgName: 'First',
          email: 'duplicate@example.test',
          password: 'CorrectPassword9!',
        },
      });
      const second = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: {
          orgName: 'Second',
          email: 'duplicate@example.test',
          password: 'CorrectPassword9!',
        },
      });
      expect(second.statusCode).toBe(400);
      expect(second.json().error).toBe('An account with this email already exists');
    } finally {
      await app.close();
    }
  });
  it('rejects an invalid email with 400', async () => {
    const app = await testApp();
    try {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/auth/signup',
            payload: { orgName: 'Org', email: 'not-email', password: 'CorrectPassword9!' },
          })
        ).statusCode
      ).toBe(400);
    } finally {
      await app.close();
    }
  });
  it('rejects a password below the minimum length with 400', async () => {
    const app = await testApp();
    try {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/auth/signup',
            payload: { orgName: 'Org', email: 'short@example.test', password: 'short' },
          })
        ).statusCode
      ).toBe(400);
    } finally {
      await app.close();
    }
  });
});
