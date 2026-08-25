import { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { canAccessTeam } from '../../middleware/rbac';
import { ForbiddenError, ValidationError } from '../../utils/errors';
import { teamsService } from './teams.service';

type TeamParams = { teamId: string };
const createSchema = z.object({ name: z.string().trim().min(1), teamLeadId: z.string().uuid().optional() }).strict();
const updateSchema = z.object({ name: z.string().trim().min(1).optional(), teamLeadId: z.string().uuid().optional() }).strict();

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new ValidationError(result.error.issues[0]?.message ?? 'Invalid team request');
  if (Object.keys(result.data as object).length === 0) throw new ValidationError('At least one team field is required');
  return result.data;
}

async function requireTeamAccess(request: FastifyRequest<{ Params: TeamParams }>) {
  if (!(await canAccessTeam(request.user, request.params.teamId))) throw new ForbiddenError('Team access denied');
}

export const teamsController = {
  async create(request: FastifyRequest) {
    const body = parse(createSchema, request.body);
    return teamsService.createTopLevel(request.user.orgId!, request.user.id, body.name, body.teamLeadId);
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
    return teamsService.createSubTeam(request.params.teamId, request.user.id, body.name, body.teamLeadId);
  },
};
