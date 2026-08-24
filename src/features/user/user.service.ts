import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import { env } from '../../config/env';
import { AuthError, ValidationError } from '../../utils/errors';
import { userRepository } from './user.repository';
type Pending = { user_id: string; org_id: string | null; purpose: '2fa_pending' };
type Principal = {
  id: string;
  orgId: string | null;
  email: string;
  role: 'super_admin' | 'org_admin' | 'team_lead' | 'developer' | 'finance' | 'auditor';
  twoFactorSecret: string | null;
};
const pending = (authorization: string | undefined): Pending => {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new AuthError('Invalid or expired pending token');
  try {
    const p = jwt.verify(token, env.JWT_SECRET);
    if (
      typeof p === 'string' ||
      p.purpose !== '2fa_pending' ||
      typeof p.user_id !== 'string' ||
      (typeof p.org_id !== 'string' && p.org_id !== null)
    )
      throw new AuthError('Invalid or expired pending token');
    return { user_id: p.user_id, org_id: p.org_id, purpose: '2fa_pending' };
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw new AuthError('Invalid or expired pending token');
  }
};
export const userService = {
  signup: async (b: { orgName: string; email: string; password: string; timezone?: string }) =>
    userRepository.createOrganizationAndAdmin(
      b.orgName,
      b.timezone ?? 'UTC',
      b.email.toLowerCase(),
      await bcrypt.hash(b.password, 12)
    ),
  login: async (b: { email: string; password: string }) => {
    const rows = await userRepository.findUsersByEmail(b.email.toLowerCase());
    if (rows.length === 1) {
      const u = rows[0];
      if (u.orgStatus !== 'active' || !(await bcrypt.compare(b.password, u.passwordHash)))
        throw new AuthError('Invalid credentials');
      return {
        pendingToken: jwt.sign(
          { user_id: u.userId, org_id: u.orgId, purpose: '2fa_pending' },
          env.JWT_SECRET,
          { expiresIn: '5m' }
        ),
        twoFactorConfigured: u.twoFactorSecret !== null,
      };
    }
    if (rows.length > 1) throw new AuthError('Invalid credentials');
    const [a] = await userRepository.findSuperAdminByEmail(b.email.toLowerCase());
    if (!a || !(await bcrypt.compare(b.password, a.passwordHash)))
      throw new AuthError('Invalid credentials');
    return {
      pendingToken: jwt.sign(
        { user_id: a.id, org_id: null, purpose: '2fa_pending' },
        env.JWT_SECRET,
        { expiresIn: '5m' }
      ),
      twoFactorConfigured: a.twoFactorSecret !== null,
    };
  },
  setupTwoFactor: async (auth: string | undefined) => {
    const p = pending(auth);
    const raw = await userRepository.findPendingPrincipal(p.user_id, p.org_id);
    const u: Principal | undefined =
      raw &&
      (p.org_id === null
        ? { ...raw, orgId: null, role: 'super_admin' }
        : ({ ...raw } as Principal));
    if (!u || u.orgId !== p.org_id) throw new AuthError('Invalid or expired pending token');
    if (u.twoFactorSecret)
      throw new ValidationError('2FA already configured, use /auth/2fa/verify');
    const secret = generateSecret();
    await userRepository.setTwoFactorSecret(u.id, u.orgId, secret);
    const url = generateURI({ issuer: 'AICostOptimizer', label: u.email, secret });
    return { qrCodeDataUrl: await QRCode.toDataURL(url), manualEntryKey: secret };
  },
  verifyTwoFactor: async (auth: string | undefined, code: string) => {
    const p = pending(auth);
    const raw = await userRepository.findPendingPrincipal(p.user_id, p.org_id);
    const u: Principal | undefined =
      raw &&
      (p.org_id === null
        ? { ...raw, orgId: null, role: 'super_admin' }
        : ({ ...raw } as Principal));
    if (!u || u.orgId !== p.org_id || !u.twoFactorSecret)
      throw new ValidationError('Complete /auth/2fa/setup first');
    if (!(await verify({ token: code, secret: u.twoFactorSecret })).valid)
      throw new AuthError('Invalid code');
    const token = jwt.sign({ user_id: u.id, org_id: u.orgId, role: u.role }, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    });
    return { token, user: { id: u.id, email: u.email, role: u.role, orgId: u.orgId } };
  },
};
