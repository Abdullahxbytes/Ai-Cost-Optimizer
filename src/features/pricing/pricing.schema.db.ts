import { index, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
const ts = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
const money = (n: string) => numeric(n, { precision: 12, scale: 4 }).notNull();
export const pricingTable = pgTable(
  'pricing_table',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id'),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputPricePer1k: money('input_price_per_1k'),
    outputPricePer1k: money('output_price_per_1k'),
    currency: text('currency').default('USD').notNull(),
    effectiveDate: timestamp('effective_date', { withTimezone: true }).notNull(),
    ...ts(),
  },
  (t) => ({
    idxPricingTableOrgProviderModelEffectiveDate: index(
      'idx_pricing_table_org_id_provider_model_effective_date'
    ).on(t.orgId, t.provider, t.model, t.effectiveDate),
  })
);
export const pricingChangelog = pgTable('pricing_changelog', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull(),
  pricingTableId: uuid('pricing_table_id').notNull(),
  changedBy: uuid('changed_by').notNull(),
  oldValue: jsonb('old_value').notNull(),
  newValue: jsonb('new_value').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).defaultNow().notNull(),
  ...ts(),
});
