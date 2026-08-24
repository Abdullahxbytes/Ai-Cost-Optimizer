import { and, desc, eq, isNull, lte } from 'drizzle-orm';
import { db } from '../../config/database';
import { pricingTable } from './pricing.schema.db';

export type PricingRate = {
  inputPricePer1k: number;
  outputPricePer1k: number;
  currency: string;
};

async function findLatestRate(orgId: string | null, provider: string, model: string) {
  const conditions = [
    eq(pricingTable.provider, provider),
    eq(pricingTable.model, model),
    lte(pricingTable.effectiveDate, new Date()),
    orgId === null ? isNull(pricingTable.orgId) : eq(pricingTable.orgId, orgId),
  ];

  return db
    .select({
      inputPricePer1k: pricingTable.inputPricePer1k,
      outputPricePer1k: pricingTable.outputPricePer1k,
      currency: pricingTable.currency,
    })
    .from(pricingTable)
    .where(and(...conditions))
    .orderBy(desc(pricingTable.effectiveDate))
    .limit(1);
}

export const pricingRepository = {
  async getRate(orgId: string, provider: string, model: string): Promise<PricingRate | null> {
    const [organizationRate] = await findLatestRate(orgId, provider, model);
    const [globalRate] = organizationRate ? [] : await findLatestRate(null, provider, model);
    const rate = organizationRate ?? globalRate;

    if (!rate) return null;

    return {
      inputPricePer1k: Number(rate.inputPricePer1k),
      outputPricePer1k: Number(rate.outputPricePer1k),
      currency: rate.currency,
    };
  },
};
