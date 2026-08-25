import { NotFoundError } from '../../utils/errors';
import { OrganizationUpdate, orgsRepository } from './orgs.repository';

export const orgsService = {
  async get(orgId: string) {
    const organization = await orgsRepository.findById(orgId);
    if (!organization) throw new NotFoundError('Organization not found');
    return organization;
  },

  async update(orgId: string, update: OrganizationUpdate) {
    const organization = await orgsRepository.update(orgId, update);
    if (!organization) throw new NotFoundError('Organization not found');
    return organization;
  },
};
