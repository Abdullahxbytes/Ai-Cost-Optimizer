import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { env } from '../../config/env';

const PREFIX = 'enc:v1:';
const key = createHash('sha256').update(env.TOTP_ENCRYPTION_SECRET).digest();

export function encryptTotpSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `${PREFIX}${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')}`;
}

export function decryptTotpSecret(stored: string): { secret: string; encrypted: boolean } {
  if (!stored.startsWith(PREFIX)) return { secret: stored, encrypted: false };
  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
  if (raw.length < 29) throw new Error('Invalid encrypted TOTP secret');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return {
    secret: Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'),
    encrypted: true,
  };
}
