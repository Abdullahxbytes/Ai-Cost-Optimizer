import { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '../../utils/errors';
import { agentsService } from './agents.service';

type AgentParams = { agentId: string };
const registerSchema = z.object({ name: z.string().trim().min(1), teamId: z.string().uuid() }).strict();
const rejectSchema = z.object({ reason: z.string().trim().min(1).max(1000).optional() }).strict();
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new ValidationError(result.error.issues[0]?.message ?? 'Invalid agent request');
  return result.data;
}

export const agentsController = {
  register: (request: FastifyRequest) => {
    const body = parse(registerSchema, request.body);
    return agentsService.register(request.user, body.name, body.teamId);
  },
  list: (request: FastifyRequest) => agentsService.list(request.user),
  async get(request: FastifyRequest<{ Params: AgentParams }>) {
    await agentsService.assertAgentAccess(request.user, request.params.agentId);
    return agentsService.get(request.params.agentId);
  },
  async approve(request: FastifyRequest<{ Params: AgentParams }>) {
    await agentsService.assertAgentAccess(request.user, request.params.agentId);
    return agentsService.approve(request.params.agentId, request.user);
  },
  async reject(request: FastifyRequest<{ Params: AgentParams }>) {
    await agentsService.assertAgentAccess(request.user, request.params.agentId);
    return agentsService.reject(request.params.agentId, request.user, parse(rejectSchema, request.body).reason);
  },
  async pause(request: FastifyRequest<{ Params: AgentParams }>) {
    await agentsService.assertAgentAccess(request.user, request.params.agentId);
    return agentsService.changePausedState(request.params.agentId, true);
  },
  async resume(request: FastifyRequest<{ Params: AgentParams }>) {
    await agentsService.assertAgentAccess(request.user, request.params.agentId);
    return agentsService.changePausedState(request.params.agentId, false);
  },
  async requestDeletion(request: FastifyRequest<{ Params: AgentParams }>) {
    await agentsService.assertAgentAccess(request.user, request.params.agentId);
    return agentsService.requestDeletion(request.params.agentId, request.user);
  },
  async downloadDeletionExport(
    request: FastifyRequest<{ Params: { deletionId: string } }>,
    reply: FastifyReply
  ) {
    const { deletion, content } = await agentsService.downloadDeletionExport(request.params.deletionId, request.user.id);
    return reply
      .type('text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="agent-usage-${deletion.agentId}.csv"`)
      .send(content);
  },
  async confirmDeletion(request: FastifyRequest<{ Params: { deletionId: string } }>) {
    await agentsService.confirmDeletion(request.params.deletionId, request.user.id);
    return { deleted: true };
  },
};
