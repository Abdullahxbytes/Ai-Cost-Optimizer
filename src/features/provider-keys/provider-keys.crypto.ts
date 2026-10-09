import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { env } from '../../config/env';
const key = createHash('sha256').update(env.PROVIDER_KEY_ENCRYPTION_SECRET).digest();
export function encryptProviderKey(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}
export function decryptProviderKey(value: string) {
  const raw = Buffer.from(value, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
