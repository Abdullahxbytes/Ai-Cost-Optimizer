import { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '../../utils/errors';
import { orgsService } from './orgs.service';

type OrgParams = { orgId: string };
const updateSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    timezone: z.string().trim().min(1).optional(),
  })
  .strict();

function parseUpdate(body: unknown) {
  const result = updateSchema.safeParse(body);
  if (!result.success)
    throw new ValidationError(result.error.issues[0]?.message ?? 'Invalid organization update');
  if (Object.keys(result.data).length === 0)
    throw new ValidationError('At least one organization field is required');
  if (result.data.timezone) {
    try {
      Intl.DateTimeFormat('en-US', { timeZone: result.data.timezone });
    } catch {
      throw new ValidationError('timezone must be a valid IANA timezone');
    }
  }
  return result.data;
}

export const orgsController = {
  get: (request: FastifyRequest<{ Params: OrgParams }>) => orgsService.get(request.params.orgId),
  update: (request: FastifyRequest<{ Params: OrgParams }>) =>
    orgsService.update(request.params.orgId, parseUpdate(request.body)),
};
