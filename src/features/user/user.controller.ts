import { z } from 'zod';
import { ValidationError } from '../../utils/errors';
import { userService } from './user.service';
const signup = z.object({
  orgName: z.string().trim().min(2),
  email: z.string().trim().email(),
  password: z.string().min(8),
  timezone: z.string().trim().min(1).optional(),
});
const login = z.object({ email: z.string().trim().email(), password: z.string().min(1) });
const verify = z.object({ code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits') });
const parse = <T>(s: z.ZodType<T>, v: unknown): T => {
  const p = s.safeParse(v);
  if (!p.success) throw new ValidationError(p.error.issues[0]?.message ?? 'Invalid request body');
  return p.data;
};
export const userController = {
  signup: (b: unknown) => userService.signup(parse(signup, b)),
  login: (b: unknown) => userService.login(parse(login, b)),
  setup: (a: string | undefined) => userService.setupTwoFactor(a),
  verify: (a: string | undefined, b: unknown) =>
    userService.verifyTwoFactor(a, parse(verify, b).code),
};
