import { SQL, and, count, desc, eq, gte, lte } from 'drizzle-orm';
import { db } from '../../config/database';
import { users } from '../user/user.schema.db';
import { auditLog } from './audit.schema.db';

export type AuditFilters = {
  from?: Date;
  to: Date;
  eventType?: string;
  actor?: string;
  limit: number;
  offset: number;
};
export type AuditEntryInput = {
  orgId: string;
  actorUserId: string | null;
  eventType: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
};
const fields = {
  id: auditLog.id,
  orgId: auditLog.orgId,
  actorUserId: auditLog.actorUserId,
  actorEmail: users.email,
  actorRole: users.role,
  eventType: auditLog.eventType,
  targetType: auditLog.targetType,
  targetId: auditLog.targetId,
  metadata: auditLog.metadata,
  createdAt: auditLog.createdAt,
};
function conditions(orgId: string, filters: AuditFilters) {
  const clauses: SQL[] = [eq(auditLog.orgId, orgId), lte(auditLog.createdAt, filters.to)];
  if (filters.from) clauses.push(gte(auditLog.createdAt, filters.from));
  if (filters.eventType) clauses.push(eq(auditLog.eventType, filters.eventType));
  if (filters.actor) clauses.push(eq(auditLog.actorUserId, filters.actor));
  return and(...clauses);
}

export const auditRepository = {
  record: (entry: AuditEntryInput) => db.insert(auditLog).values(entry),

  async query(orgId: string, filters: AuditFilters) {
    const where = conditions(orgId, filters);
    const [total] = await db.select({ count: count() }).from(auditLog).where(where);
    const rows = await db
      .select(fields)
      .from(auditLog)
      .leftJoin(users, eq(auditLog.actorUserId, users.id))
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(filters.limit)
      .offset(filters.offset);
    return { rows, total: Number(total?.count ?? 0) };
  },
  async createExportEntry(orgId: string, actorUserId: string, filters: AuditFilters) {
    await db.insert(auditLog).values({
      orgId,
      actorUserId,
      eventType: 'audit_export',
      targetType: 'audit_log',
      metadata: {
        filters: {
          ...(filters.from && { from: filters.from.toISOString() }),
          to: filters.to.toISOString(),
          ...(filters.eventType && { eventType: filters.eventType }),
          ...(filters.actor && { actor: filters.actor }),
          limit: filters.limit,
          offset: filters.offset,
        },
      },
    });
  },
};
