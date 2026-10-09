import bcrypt from 'bcrypt';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { superAdminsRepository } from './super-admins.repository';

const MAX_SUPER_ADMINS = 3;

export function assertCanRemoveSuperAdmin(total: number): void {
  if (total <= 1) throw new ValidationError('Cannot remove the last remaining Super Admin');
}

async function assertCapacity() {
  if ((await superAdminsRepository.count()) >= MAX_SUPER_ADMINS)
    throw new ValidationError(
      'Super Admin cap reached (3); remove an existing admin before adding another'
    );
}

export const superAdminsService = {
  async bootstrap(email: string, password: string) {
    if ((await superAdminsRepository.count()) > 0)
      throw new ValidationError('Bootstrap refused: a Super Admin already exists');
    return superAdminsRepository.create({
      email: email.trim().toLowerCase(),
      passwordHash: await bcrypt.hash(password, 12),
      createdBy: null,
    });
  },
  async create(actorId: string | null, email: string, password: string) {
    await assertCapacity();
    return superAdminsRepository.create({
      email: email.trim().toLowerCase(),
      passwordHash: await bcrypt.hash(password, 12),
      createdBy: actorId,
    });
  },
  async remove(id: string) {
    assertCanRemoveSuperAdmin(await superAdminsRepository.count());
    const removed = await superAdminsRepository.remove(id);
    if (!removed) throw new NotFoundError('Super Admin not found');
    return removed;
  },
};
