import { pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const providerKeyProviderEnum = pgEnum('provider_key_provider', ['openai', 'anthropic', 'gemini']);

// encrypted_key format: base64(iv[12] || authTag[16] || ciphertext), AES-256-GCM.
export const orgProviderKeys = pgTable('org_provider_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull(),
  provider: providerKeyProviderEnum('provider').notNull(),
  encryptedKey: text('encrypted_key').notNull(),
  keyLastFour: text('key_last_four').notNull(),
  addedBy: uuid('added_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({ uniqueOrgProvider: uniqueIndex('org_provider_keys_org_provider_unique').on(table.orgId, table.provider) }));
