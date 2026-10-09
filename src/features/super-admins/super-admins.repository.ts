import { count, eq } from 'drizzle-orm';
import { db } from '../../config/database';
import { superAdmins } from '../user/user.schema.db';

const publicFields = {
  id: superAdmins.id,
  email: superAdmins.email,
  createdBy: superAdmins.createdBy,
  createdAt: superAdmins.createdAt,
};

export const superAdminsRepository = {
  list: () => db.select(publicFields).from(superAdmins).orderBy(superAdmins.createdAt),
  async count() {
    const [row] = await db.select({ total: count() }).from(superAdmins);
    return Number(row?.total ?? 0);
  },
  async create(input: { email: string; passwordHash: string; createdBy: string | null }) {
    const [admin] = await db.insert(superAdmins).values(input).returning(publicFields);
    return admin;
  },
  async remove(id: string) {
    return db.transaction(async (tx) => {
      // Explicitly clear successor references as well as relying on the FK's
      // ON DELETE SET NULL behavior. This keeps removals safe for databases
      // created before that constraint was introduced.
      await tx.update(superAdmins).set({ createdBy: null }).where(eq(superAdmins.createdBy, id));
      const [admin] = await tx
        .delete(superAdmins)
        .where(eq(superAdmins.id, id))
        .returning(publicFields);
      return admin ?? null;
    });
  },
};
