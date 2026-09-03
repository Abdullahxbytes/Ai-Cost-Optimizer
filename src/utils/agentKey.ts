import { createHmac } from 'crypto';
import { env } from '../config/env';

/** Returns the deterministic database representation of an agent key; never log the raw key. */
export function hashAgentKey(apiKey: string): string {
  return createHmac('sha256', env.AGENT_KEY_HMAC_SECRET).update(apiKey).digest('hex');
}

export function isAgentKeyHash(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}
