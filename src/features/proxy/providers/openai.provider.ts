import axios from 'axios';
import { PROVIDER_REQUEST_TIMEOUT_MS } from '../../../config/constants';
import { ProviderAdapter, ProviderResponse } from './provider.types';

const baseUrl = 'https://api.openai.com';

export const openaiProvider: ProviderAdapter = {
  baseUrl,

  buildHeaders(apiKey) {
    return {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
  },

  async forward(path, body, apiKey): Promise<ProviderResponse> {
    const response = await axios.post(path, body, {
      baseURL: baseUrl,
      headers: this.buildHeaders(apiKey),
      timeout: PROVIDER_REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
    });

    return {
      status: response.status,
      data: response.data,
      headers: {
        contentType:
          typeof response.headers['content-type'] === 'string'
            ? response.headers['content-type']
            : undefined,
      },
    };
  },
};
