import { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { canAccessTeam } from '../../middleware/rbac';
import { ForbiddenError, ValidationError } from '../../utils/errors';
import { teamsService } from './teams.service';

type TeamParams = { teamId: string };
const createSchema = z
  .object({ name: z.string().trim().min(1), teamLeadId: z.string().uuid().optional() })
  .strict();
const updateSchema = z
  .object({ name: z.string().trim().min(1).optional(), teamLeadId: z.string().uuid().optional() })
  .strict();
const memberSchema = z.object({ userId: z.string().uuid() }).strict();
const deletionSchema = z.object({ mode: z.enum(['purge_now', 'archive_15_days']) }).strict();

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success)
    throw new ValidationError(result.error.issues[0]?.message ?? 'Invalid team request');
  if (Object.keys(result.data as object).length === 0)
    throw new ValidationError('At least one team field is required');
  return result.data;
}

async function requireTeamAccess(request: FastifyRequest<{ Params: TeamParams }>) {
  if (!(await canAccessTeam(request.user, request.params.teamId)))
    throw new ForbiddenError('Team access denied');
}

export const teamsController = {
  async create(request: FastifyRequest) {
    const body = parse(createSchema, request.body);
    return teamsService.createTopLevel(
      request.user.orgId!,
      request.user.id,
      body.name,
      body.teamLeadId
    );
  },
  list: (request: FastifyRequest) => teamsService.list(request.user),
  async get(request: FastifyRequest<{ Params: TeamParams }>) {
    await requireTeamAccess(request);
    return teamsService.get(request.params.teamId);
  },
  async update(request: FastifyRequest<{ Params: TeamParams }>) {
    await requireTeamAccess(request);
    const body = parse(updateSchema, request.body);
    if (body.teamLeadId && request.user.role !== 'org_admin') {
      throw new ForbiddenError('Only an Org Admin can reassign a team lead');
    }
    return teamsService.update(request.params.teamId, body);
  },
  async createSubTeam(request: FastifyRequest<{ Params: TeamParams }>) {
    await requireTeamAccess(request);
    const body = parse(createSchema, request.body);
    return teamsService.createSubTeam(
      request.params.teamId,
      request.user.id,
      body.name,
      body.teamLeadId
    );
  },
  async listMembers(request: FastifyRequest<{ Params: TeamParams }>) {
    await requireTeamAccess(request);
    return teamsService.listMembers(request.params.teamId);
  },
  async listAvailableDevelopers(request: FastifyRequest<{ Params: TeamParams }>) {
    await requireTeamAccess(request);
    return teamsService.listAvailableDevelopers(request.params.teamId);
  },
  async addMember(request: FastifyRequest<{ Params: TeamParams }>) {
    await requireTeamAccess(request);
    const body = parse(memberSchema, request.body);
    await teamsService.addDeveloper(request.params.teamId, body.userId);
    return { ok: true };
  },
  async removeMember(request: FastifyRequest<{ Params: TeamParams & { userId: string } }>) {
    await requireTeamAccess(request);
    if (!z.string().uuid().safeParse(request.params.userId).success)
      throw new ValidationError('Invalid user id');
    await teamsService.removeDeveloper(request.params.teamId, request.params.userId);
    return { ok: true };
  },
  async requestDeletion(request: FastifyRequest<{ Params: TeamParams }>) {
    const body = parse(deletionSchema, request.body);
    return teamsService.requestDeletion(request.params.teamId, request.user, body.mode);
  },
  async listArchivedDeletions(request: FastifyRequest) {
    return teamsService.listArchivedDeletions(request.user);
  },
  async exportArchivedDeletion(
    request: FastifyRequest<{ Params: { deletionId: string } }>,
    reply: import('fastify').FastifyReply
  ) {
    const { team, csv } = await teamsService.exportArchivedTeam(
      request.params.deletionId,
      request.user
    );
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header(
        'Content-Disposition',
        `attachment; filename="${team.name.replace(/[^a-z0-9_-]/gi, '_')}-archive.csv"`
      );
    return reply.send(csv);
  },
};
