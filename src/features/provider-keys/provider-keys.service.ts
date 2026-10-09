import axios from 'axios';
import { AppError, NotFoundError } from '../../utils/errors';
import { decryptProviderKey, encryptProviderKey } from './provider-keys.crypto';
import { ProviderKeyProvider, providerKeysRepository } from './provider-keys.repository';

async function verify(provider: ProviderKeyProvider, key: string): Promise<void> {
  try {
    if (provider === 'openai') {
      await axios.get('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
      });
    } else if (provider === 'anthropic') {
      await axios.get('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      });
    } else {
      await axios.get('https://generativelanguage.googleapis.com/v1beta/models', {
        params: { key },
      });
    }
  } catch {
    throw new AppError(400, 'This API key could not be verified with the provider', 'PROVIDER_KEY_INVALID');
  }
}

export const providerKeysService = {
  list: (orgId: string) => providerKeysRepository.list(orgId),

  async save(orgId: string, actor: string, provider: ProviderKeyProvider, apiKey: string) {
    await verify(provider, apiKey);
    const result = await providerKeysRepository.upsert({
      orgId, provider, encryptedKey: encryptProviderKey(apiKey),
      keyLastFour: apiKey.slice(-4), addedBy: actor,
    });
    await providerKeysRepository.audit(
      orgId, actor, result.updated ? 'provider_key_updated' : 'provider_key_added',
      provider, result.row.keyLastFour
    );
    return result.row;
  },

  async remove(orgId: string, actor: string, provider: ProviderKeyProvider) {
    const row = await providerKeysRepository.remove(orgId, provider);
    if (!row) throw new NotFoundError('Provider key not found');
    await providerKeysRepository.audit(orgId, actor, 'provider_key_removed', provider);
    return row;
  },

  async getCredential(orgId: string, provider: ProviderKeyProvider) {
    const row = await providerKeysRepository.find(orgId, provider);
    if (!row) return null;
    return {
      plaintext: decryptProviderKey(row.encryptedKey),
      version: `${row.id}:${row.updatedAt.toISOString()}`,
    };
  },

  async getPlaintext(orgId: string, provider: ProviderKeyProvider) {
    const credential = await providerKeysService.getCredential(orgId, provider);
    return credential?.plaintext ?? null;
  },
};
