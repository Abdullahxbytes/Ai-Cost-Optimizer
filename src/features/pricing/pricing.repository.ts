import { and, desc, eq, isNull, lte, or } from 'drizzle-orm';
import { db } from '../../config/database';
import { auditLog } from '../audit/audit.schema.db';
import { pricingChangelog, pricingTable } from './pricing.schema.db';

export type PricingRate = { inputPricePer1k: number; outputPricePer1k: number; currency: string };
export type OrganizationPricingRate = PricingRate & {
  id: string;
  orgId: string;
  provider: string;
  model: string;
  effectiveDate: Date;
  createdAt: Date;
  updatedAt: Date;
};

const pricingFields = {
  id: pricingTable.id,
  orgId: pricingTable.orgId,
  provider: pricingTable.provider,
  model: pricingTable.model,
  inputPricePer1k: pricingTable.inputPricePer1k,
  outputPricePer1k: pricingTable.outputPricePer1k,
  currency: pricingTable.currency,
  effectiveDate: pricingTable.effectiveDate,
  createdAt: pricingTable.createdAt,
  updatedAt: pricingTable.updatedAt,
};

function normalizeRate(row: Record<string, unknown>): OrganizationPricingRate {
  return {
    id: row.id as string,
    orgId: row.orgId as string,
    provider: row.provider as string,
    model: row.model as string,
    inputPricePer1k: Number(row.inputPricePer1k),
    outputPricePer1k: Number(row.outputPricePer1k),
    currency: row.currency as string,
    effectiveDate: row.effectiveDate as Date,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

async function findLatestRate(orgId: string | null, provider: string, model: string) {
  return db
    .select({
      inputPricePer1k: pricingTable.inputPricePer1k,
      outputPricePer1k: pricingTable.outputPricePer1k,
      currency: pricingTable.currency,
    })
    .from(pricingTable)
    .where(
      and(
        eq(pricingTable.provider, provider),
        eq(pricingTable.model, model),
        lte(pricingTable.effectiveDate, new Date()),
        orgId === null ? isNull(pricingTable.orgId) : eq(pricingTable.orgId, orgId)
      )
    )
    .orderBy(desc(pricingTable.effectiveDate))
    .limit(1);
}

export const pricingRepository = {
  async getRate(orgId: string, provider: string, model: string): Promise<PricingRate | null> {
    const [organizationRate] = await findLatestRate(orgId, provider, model);
    const [globalRate] = organizationRate ? [] : await findLatestRate(null, provider, model);
    const rate = organizationRate ?? globalRate;
    return rate
      ? {
          inputPricePer1k: Number(rate.inputPricePer1k),
          outputPricePer1k: Number(rate.outputPricePer1k),
          currency: rate.currency,
        }
      : null;
  },

  async listEffectiveRates(
    orgId: string
  ): Promise<Array<PricingRate & { provider: string; model: string }>> {
    const rows = await db
      .select({
        orgId: pricingTable.orgId,
        provider: pricingTable.provider,
        model: pricingTable.model,
        inputPricePer1k: pricingTable.inputPricePer1k,
        outputPricePer1k: pricingTable.outputPricePer1k,
        currency: pricingTable.currency,
        effectiveDate: pricingTable.effectiveDate,
      })
      .from(pricingTable)
      .where(
        and(
          or(eq(pricingTable.orgId, orgId), isNull(pricingTable.orgId)),
          lte(pricingTable.effectiveDate, new Date())
        )
      )
      .orderBy(desc(pricingTable.effectiveDate));
    const organization = new Map<string, (typeof rows)[number]>();
    const global = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const key = `${row.provider}\u0000${row.model}`;
      const target = row.orgId === orgId ? organization : global;
      if (!target.has(key)) target.set(key, row);
    }
    return [...new Set([...global.keys(), ...organization.keys()])]
      .map((key) => organization.get(key) ?? global.get(key)!)
      .map((row) => ({
        provider: row.provider,
        model: row.model,
        inputPricePer1k: Number(row.inputPricePer1k),
        outputPricePer1k: Number(row.outputPricePer1k),
        currency: row.currency,
      }));
  },

  async listOrganizationRates(orgId: string): Promise<OrganizationPricingRate[]> {
    const rows = await db
      .select(pricingFields)
      .from(pricingTable)
      .where(eq(pricingTable.orgId, orgId))
      .orderBy(desc(pricingTable.effectiveDate), pricingTable.provider, pricingTable.model);
    return rows.map((row) => normalizeRate(row));
  },

  async findOrganizationRate(
    orgId: string,
    pricingId: string
  ): Promise<OrganizationPricingRate | null> {
    const [row] = await db
      .select(pricingFields)
      .from(pricingTable)
      .where(and(eq(pricingTable.id, pricingId), eq(pricingTable.orgId, orgId)))
      .limit(1);
    return row ? normalizeRate(row) : null;
  },

  async createOrganizationRate(
    input: Omit<OrganizationPricingRate, 'id' | 'createdAt' | 'updatedAt'>,
    changedBy: string
  ) {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .insert(pricingTable)
        .values({
          orgId: input.orgId,
          provider: input.provider,
          model: input.model,
          inputPricePer1k: String(input.inputPricePer1k),
          outputPricePer1k: String(input.outputPricePer1k),
          currency: input.currency,
          effectiveDate: input.effectiveDate,
        })
        .returning(pricingFields);
      const result = normalizeRate(row);
      await tx.insert(pricingChangelog).values({
        orgId: input.orgId,
        pricingTableId: result.id,
        changedBy,
        oldValue: {},
        newValue: result,
      });
      await tx.insert(auditLog).values({
        orgId: input.orgId,
        actorUserId: changedBy,
        eventType: 'pricing_rate_added',
        targetType: 'pricing_rate',
        targetId: result.id,
        metadata: { provider: result.provider, model: result.model },
      });
      return result;
    });
  },

  async updateOrganizationRate(
    orgId: string,
    pricingId: string,
    update: Pick<OrganizationPricingRate, 'inputPricePer1k' | 'outputPricePer1k' | 'effectiveDate'>,
    changedBy: string
  ) {
    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select(pricingFields)
        .from(pricingTable)
        .where(and(eq(pricingTable.id, pricingId), eq(pricingTable.orgId, orgId)))
        .limit(1);
      if (!existing) return null;
      const oldValue = normalizeRate(existing);
      const [row] = await tx
        .update(pricingTable)
        .set({
          inputPricePer1k: String(update.inputPricePer1k),
          outputPricePer1k: String(update.outputPricePer1k),
          effectiveDate: update.effectiveDate,
          updatedAt: new Date(),
        })
        .where(eq(pricingTable.id, pricingId))
        .returning(pricingFields);
      const newValue = normalizeRate(row);
      await tx
        .insert(pricingChangelog)
        .values({ orgId, pricingTableId: pricingId, changedBy, oldValue, newValue });
      await tx.insert(auditLog).values({
        orgId,
        actorUserId: changedBy,
        eventType: 'pricing_rate_updated',
        targetType: 'pricing_rate',
        targetId: pricingId,
        metadata: { provider: newValue.provider, model: newValue.model },
      });
      return newValue;
    });
  },

  async deleteOrganizationRate(orgId: string, pricingId: string, changedBy: string) {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .delete(pricingTable)
        .where(and(eq(pricingTable.id, pricingId), eq(pricingTable.orgId, orgId)))
        .returning(pricingFields);
      if (!row) return null;

      const deletedRate = normalizeRate(row);
      await tx.insert(auditLog).values({
        orgId,
        actorUserId: changedBy,
        eventType: 'pricing_rate_deleted',
        targetType: 'pricing_rate',
        targetId: pricingId,
        metadata: {
          provider: deletedRate.provider,
          model: deletedRate.model,
          effectiveDate: deletedRate.effectiveDate.toISOString(),
        },
      });
      return deletedRate;
    });
  },
};
