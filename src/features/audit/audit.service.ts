import { AuthenticatedUser } from '../../middleware/auth';
import { ForbiddenError, ValidationError } from '../../utils/errors';
import { AuditFilters, auditRepository } from './audit.repository';

function scopeOrg(user: AuthenticatedUser, requestedOrgId?: string) {
  if (user.role === 'super_admin') {
    if (!requestedOrgId) throw new ValidationError('orgId is required for Super Admin audit access');
    return requestedOrgId;
  }
  if (!user.orgId) throw new ForbiddenError('Organization access denied');
  if (requestedOrgId && requestedOrgId !== user.orgId) throw new ForbiddenError('Organization access denied');
  return user.orgId;
}

function csvEscape(value: unknown) {
  const text = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const auditService = {
  query(user: AuthenticatedUser, requestedOrgId: string | undefined, filters: AuditFilters) {
    return auditRepository.query(scopeOrg(user, requestedOrgId), filters);
  },
  async export(user: AuthenticatedUser, requestedOrgId: string | undefined, filters: AuditFilters) {
    const orgId = scopeOrg(user, requestedOrgId);
    const { rows } = await auditRepository.query(orgId, { ...filters, limit: 500, offset: 0 });
    await auditRepository.createExportEntry(orgId, user.id, filters);
    const header = ['id', 'org_id', 'actor_user_id', 'event_type', 'target_type', 'target_id', 'metadata', 'created_at'];
    const csv = [header, ...rows.map((row) => [row.id, row.orgId, row.actorUserId, row.eventType, row.targetType, row.targetId, row.metadata, row.createdAt.toISOString()])]
      .map((row) => row.map(csvEscape).join(','))
      .join('\n');
    return { csv, orgId };
  },
};
