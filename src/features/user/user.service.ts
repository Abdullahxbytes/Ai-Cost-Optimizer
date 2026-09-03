import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { env } from '../../config/env';
import { AuthError, ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors';
import { AuthenticatedUser } from '../../middleware/auth';
import { userRepository } from './user.repository';
import { enforceAuthRateLimit } from '../../utils/authRateLimit';
type Pending = { user_id: string; org_id: string | null; purpose: '2fa_pending' };
// `otplib` currently ships ESM-only transitive dependencies. Keep this native dynamic import so
// the CommonJS build and Jest can load the authentication service under Node 22 as well.
const loadOtpLib = (): Promise<{
  generateSecret: () => string;
  generateURI: (input: { issuer: string; label: string; secret: string }) => string;
  verify: (input: { token: string; secret: string; epochTolerance?: number }) => Promise<{ valid: boolean }>;
}> =>
  new Function('modulePath', 'return import(modulePath)')('otplib');
type Principal = {
  id: string;
  orgId: string | null;
  email: string;
  role: 'super_admin' | 'org_admin' | 'team_lead' | 'developer' | 'finance' | 'auditor';
  twoFactorSecret: string | null;
  tokenVersion: number;
};
export type ManagedRole = 'org_admin' | 'finance' | 'auditor' | 'team_lead' | 'developer';
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
  async getProfile(user: AuthenticatedUser) {
    const profile = await userRepository.getProfile(user.id, user.orgId);
    if (!profile) throw new NotFoundError('User not found');
    return { ...profile, role: user.role, orgId: user.orgId };
  },
  async listOrganizationUsers(user: AuthenticatedUser, orgId: string) {
    if (user.orgId !== orgId) throw new ForbiddenError('Organization access denied');
    return userRepository.listOrganizationUsers(orgId);
  },
  signup: async (b: { orgName: string; email: string; password: string; timezone?: string }) =>
    userRepository.createOrganizationAndAdmin(
      b.orgName,
      b.timezone ?? 'UTC',
      b.email.toLowerCase(),
      await bcrypt.hash(b.password, 12)
    ),
  login: async (b: { email: string; password: string }, ip: string) => {
    await enforceAuthRateLimit(`auth:login:${b.email.toLowerCase()}:${ip}`, 5, 15 * 60);
    const rows = await userRepository.findUsersByEmail(b.email.toLowerCase());
    if (rows.length === 1) {
      const u = rows[0];
      if (!u.active || u.orgStatus !== 'active' || !(await bcrypt.compare(b.password, u.passwordHash)))
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
    const { generateSecret, generateURI } = await loadOtpLib();
    const secret = generateSecret();
    await userRepository.setTwoFactorSecret(u.id, u.orgId, secret);
    const url = generateURI({ issuer: 'AICostOptimizer', label: u.email, secret });
    return { qrCodeDataUrl: await QRCode.toDataURL(url), manualEntryKey: secret };
  },
  verifyTwoFactor: async (auth: string | undefined, code: string) => {
    const p = pending(auth);
    await enforceAuthRateLimit(`auth:2fa:${p.user_id}`, 5, 10 * 60);
    const raw = await userRepository.findPendingPrincipal(p.user_id, p.org_id);
    const u: Principal | undefined =
      raw &&
      (p.org_id === null
        ? { ...raw, orgId: null, role: 'super_admin' }
        : ({ ...raw } as Principal));
    if (!u || u.orgId !== p.org_id || !u.twoFactorSecret)
      throw new ValidationError('Complete /auth/2fa/setup first');
    const { verify } = await loadOtpLib();
    // Accept the adjacent 30-second TOTP period to tolerate small device/server
    // clock drift while retaining the normal six-digit authentication requirement.
    if (!(await verify({ token: code, secret: u.twoFactorSecret, epochTolerance: 30 })).valid)
      throw new AuthError('Invalid code');
    const token = jwt.sign({ user_id: u.id, org_id: u.orgId, role: u.role, token_version: u.tokenVersion }, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    });
    return { token, user: { id: u.id, email: u.email, role: u.role, orgId: u.orgId } };
  },
  async createOrganizationUser(user: AuthenticatedUser, orgId: string, input: { email: string; role: ManagedRole; initialPassword: string }) {
    if (user.orgId !== orgId) throw new ForbiddenError('Organization access denied');
    const email = input.email.toLowerCase();
    const existing = await userRepository.findUserByEmail(email);
    if (existing && existing.orgId !== orgId) throw new ValidationError('An account with this email already exists');
    if (existing?.active) throw new ValidationError('An account with this email already exists');
    const passwordHash = await bcrypt.hash(input.initialPassword, 12);
    const created = existing
      ? await userRepository.reactivateOrganizationUser({ id: existing.id, orgId, role: input.role, passwordHash })
      : await userRepository.createOrganizationUser({ orgId, email, role: input.role, passwordHash });
    if (!created) throw new NotFoundError('Removed user could not be reactivated');
    return created;
  },
  async updateOrganizationUserRole(user: AuthenticatedUser, orgId: string, userId: string, role: ManagedRole) {
    if (user.orgId !== orgId) throw new ForbiddenError('Organization access denied');
    const target = await userRepository.findOrganizationUser(userId, orgId);
    if (!target) throw new NotFoundError('User not found');
    if (target.active && target.role === 'org_admin' && role !== 'org_admin' && await userRepository.countActiveOrgAdmins(orgId) <= 1)
      throw new ValidationError('Cannot remove the last Org Admin from an organization');
    return userRepository.updateOrganizationUserRole(userId, orgId, role);
  },
  async removeOrganizationUser(user: AuthenticatedUser, orgId: string, userId: string) {
    if (user.orgId !== orgId) throw new ForbiddenError('Organization access denied');
    if (user.id === userId) throw new ValidationError('Org Admins cannot remove themselves');
    const target = await userRepository.findOrganizationUser(userId, orgId);
    if (!target || !target.active) throw new NotFoundError('User not found');
    if (target.role === 'org_admin' && await userRepository.countActiveOrgAdmins(orgId) <= 1)
      throw new ValidationError('Cannot remove the last Org Admin from an organization');
    return userRepository.deactivateOrganizationUser(userId, orgId);
  },
  async changePassword(user: AuthenticatedUser, input: { currentPassword: string; newPassword: string }) {
    const target = user.orgId ? await userRepository.findPasswordForActiveUser(user.id, user.orgId) : await userRepository.findPasswordForSuperAdmin(user.id);
    if (!target || !(await bcrypt.compare(input.currentPassword, target.passwordHash))) throw new AuthError('Invalid current password');
    const passwordHash = await bcrypt.hash(input.newPassword, 12);
    if (user.orgId) await userRepository.updatePassword(user.id, user.orgId, passwordHash);
    else await userRepository.updateSuperAdminPassword(user.id, passwordHash);
    return { changed: true };
  },
};
