import pino from 'pino';
import { env } from '../config/env';
export const logRedactPaths = [
  'req.headers.authorization',
  'req.headers["x-agent-key"]',
  'req.headers["x-costflow-user-context"]',
  'request.headers.authorization',
  'request.headers["x-agent-key"]',
  'request.headers["x-costflow-user-context"]',
  'headers.authorization',
  'headers["x-agent-key"]',
  'headers["x-costflow-user-context"]',
  'authorization',
  'apiKey',
  'password',
  'currentPassword',
  'newPassword',
  'twoFactorSecret',
  'manualEntryKey',
  '*.apiKey',
  '*.password',
  '*.twoFactorSecret',
];

const loggerOptions: pino.LoggerOptions = {
  level: env.LOG_LEVEL,
  redact: { paths: logRedactPaths, censor: '[REDACTED]' },
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
};

export const logger = pino(loggerOptions);
