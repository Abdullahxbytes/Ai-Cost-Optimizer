import { z } from 'zod';
import { AuthenticatedUser } from '../../middleware/auth';
import { ValidationError } from '../../utils/errors';
import { superAdminsService } from './super-admins.service';

const createSchema = z.object({ email: z.string().trim().email(), password: z.string().min(8) }).strict();
export const superAdminsController = {
  create(user: AuthenticatedUser, body: unknown) {
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid Super Admin input');
    return superAdminsService.create(user.id, parsed.data.email, parsed.data.password);
  },
  remove(id: string) { return superAdminsService.remove(id); },
};
