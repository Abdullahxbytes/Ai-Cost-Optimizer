import { and, eq } from 'drizzle-orm';
import { db } from '../../config/database';
import { auditLog } from '../audit/audit.schema.db';
import { orgProviderKeys } from './provider-keys.schema.db';
export type ProviderKeyProvider = 'openai' | 'anthropic' | 'gemini';
const fields = {
  id: orgProviderKeys.id,
  provider: orgProviderKeys.provider,
  keyLastFour: orgProviderKeys.keyLastFour,
  addedBy: orgProviderKeys.addedBy,
  createdAt: orgProviderKeys.createdAt,
  updatedAt: orgProviderKeys.updatedAt,
};
export const providerKeysRepository = {
  find: async (orgId: string, provider: ProviderKeyProvider) =>
    (
      await db
        .select({ ...fields, encryptedKey: orgProviderKeys.encryptedKey })
        .from(orgProviderKeys)
        .where(and(eq(orgProviderKeys.orgId, orgId), eq(orgProviderKeys.provider, provider)))
        .limit(1)
    )[0] ?? null,
  list: (orgId: string) =>
    db.select(fields).from(orgProviderKeys).where(eq(orgProviderKeys.orgId, orgId)),
  upsert: async (input: {
    orgId: string;
    provider: ProviderKeyProvider;
    encryptedKey: string;
    keyLastFour: string;
    addedBy: string;
  }) => {
    const old = await providerKeysRepository.find(input.orgId, input.provider);
    const [row] = await db
      .insert(orgProviderKeys)
      .values(input)
      .onConflictDoUpdate({
        target: [orgProviderKeys.orgId, orgProviderKeys.provider],
        set: {
          encryptedKey: input.encryptedKey,
          keyLastFour: input.keyLastFour,
          addedBy: input.addedBy,
          updatedAt: new Date(),
        },
      })
      .returning(fields);
    return { row, updated: Boolean(old) };
  },
  remove: async (orgId: string, provider: ProviderKeyProvider) => {
    const [row] = await db
      .delete(orgProviderKeys)
      .where(and(eq(orgProviderKeys.orgId, orgId), eq(orgProviderKeys.provider, provider)))
      .returning(fields);
    return row ?? null;
  },
  audit: (
    orgId: string,
    actor: string,
    eventType: string,
    provider: string,
    keyLastFour?: string
  ) =>
    db.insert(auditLog).values({
      orgId,
      actorUserId: actor,
      eventType,
      targetType: 'provider_key',
      metadata: { provider, ...(keyLastFour && { keyLastFour }) },
    }),
};
