import { AuthenticatedUser } from '../../middleware/auth';
import { NotFoundError } from '../../utils/errors';
import { pricingRepository } from './pricing.repository';

type PricingInput = {
  provider: string;
  model: string;
  inputPricePer1k: number;
  outputPricePer1k: number;
  effectiveDate: Date;
};

export const pricingService = {
  list: (user: AuthenticatedUser) => pricingRepository.listOrganizationRates(user.orgId!),

  create(user: AuthenticatedUser, input: PricingInput) {
    return pricingRepository.createOrganizationRate(
      { ...input, orgId: user.orgId!, currency: 'USD' },
      user.id
    );
  },

  async update(
    user: AuthenticatedUser,
    pricingId: string,
    input: Pick<PricingInput, 'inputPricePer1k' | 'outputPricePer1k' | 'effectiveDate'>
  ) {
    const rate = await pricingRepository.updateOrganizationRate(
      user.orgId!,
      pricingId,
      input,
      user.id
    );
    if (!rate) throw new NotFoundError('Pricing rate not found');
    return rate;
  },

  async remove(user: AuthenticatedUser, pricingId: string) {
    const rate = await pricingRepository.deleteOrganizationRate(user.orgId!, pricingId, user.id);
    if (!rate) throw new NotFoundError('Pricing rate not found');
    return rate;
  },
};
