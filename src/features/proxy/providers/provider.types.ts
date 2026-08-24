export type ProviderName = 'openai' | 'anthropic' | 'gemini';

export type ProviderResponse = {
  status: number;
  data: unknown;
  headers: { contentType?: string };
};

export interface ProviderAdapter {
  readonly baseUrl: string;
  buildHeaders(apiKey: string): Record<string, string>;
  forward(path: string, body: unknown, apiKey: string): Promise<ProviderResponse>;
}
