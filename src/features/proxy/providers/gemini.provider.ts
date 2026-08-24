import axios from 'axios';
import { ProviderAdapter, ProviderResponse } from './provider.types';

const baseUrl = 'https://generativelanguage.googleapis.com';

export const geminiProvider: ProviderAdapter = {
  baseUrl,

  buildHeaders() {
    return { 'Content-Type': 'application/json' };
  },

  async forward(path, body, apiKey): Promise<ProviderResponse> {
    const response = await axios.post(path, body, {
      baseURL: baseUrl,
      headers: this.buildHeaders(apiKey),
      params: { key: apiKey },
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
