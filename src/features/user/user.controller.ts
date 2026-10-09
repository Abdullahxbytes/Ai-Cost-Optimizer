import { z } from 'zod';
import { ValidationError } from '../../utils/errors';
import { userService } from './user.service';
import { AuthenticatedUser } from '../../middleware/auth';
const signup = z.object({
  orgName: z.string().trim().min(2),
  email: z.string().trim().email(),
  password: z.string().min(8),
  timezone: z.string().trim().min(1).optional(),
});
const login = z.object({ email: z.string().trim().email(), password: z.string().min(1) });
const verify = z.object({ code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits') });
const managedRole = z.enum(['org_admin', 'finance', 'auditor', 'team_lead', 'developer']);
const createOrganizationUser = z.object({ email: z.string().trim().email(), role: managedRole, initialPassword: z.string().min(8) }).strict();
const updateOrganizationUser = z.object({ role: managedRole }).strict();
const changePassword = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) }).strict();
const parse = <T>(s: z.ZodType<T>, v: unknown): T => {
  const p = s.safeParse(v);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? 'Invalid request body');
  return p.data;
};
export const userController = {
  me: (user: AuthenticatedUser) => userService.getProfile(user),
  listOrganizationUsers: (user: AuthenticatedUser, orgId: string) => userService.listOrganizationUsers(user, orgId),
  signup: (b: unknown) => userService.signup(parse(signup, b)),
  login: (b: unknown, ip: string) => userService.login(parse(login, b), ip),
  setup: (a: string | undefined) => userService.setupTwoFactor(a),
  verify: (a: string | undefined, b: unknown, ip: string) =>
    userService.verifyTwoFactor(a, parse(verify, b).code, ip),
  createOrganizationUser: (user: AuthenticatedUser, orgId: string, b: unknown) => userService.createOrganizationUser(user, orgId, parse(createOrganizationUser, b)),
  updateOrganizationUserRole: (user: AuthenticatedUser, orgId: string, userId: string, b: unknown) => userService.updateOrganizationUserRole(user, orgId, userId, parse(updateOrganizationUser, b).role),
  removeOrganizationUser: (user: AuthenticatedUser, orgId: string, userId: string) => userService.removeOrganizationUser(user, orgId, userId),
  changePassword: (user: AuthenticatedUser, b: unknown) => userService.changePassword(user, parse(changePassword, b)),
};
