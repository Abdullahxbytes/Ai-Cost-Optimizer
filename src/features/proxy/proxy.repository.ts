import { count, eq } from 'drizzle-orm';
import { db } from '../../config/database';
import { usageEvents } from './proxy.schema.db';

export type UsageEventInput = {
  orgId: string;
  agentId: string;
  taskId: string;
  provider: string;
  model: string;
  environment: 'dev' | 'staging' | 'prod';
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
  latencyMs: number;
  isTest: boolean;
};

export const proxyRepository = {
  async insertUsageEvent(input: UsageEventInput) {
    const [{ existingSteps }] = await db
      .select({ existingSteps: count() })
      .from(usageEvents)
      .where(eq(usageEvents.taskId, input.taskId));

    await db.insert(usageEvents).values({
      orgId: input.orgId,
      agentId: input.agentId,
      taskId: input.taskId,
      stepNumber: Number(existingSteps) + 1,
      provider: input.provider,
      model: input.model,
      callType: 'llm_call',
      environment: input.environment,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      costUsd: input.costUsd,
      latencyMs: input.latencyMs,
      status: 'success',
      isTest: input.isTest,
      cacheHit: false,
      originalTokenCount: input.inputTokens,
      optimizedTokenCount: input.inputTokens,
    });
  },
};
