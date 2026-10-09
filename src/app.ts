import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify from 'fastify';
import { corsOrigins, env } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { logRedactPaths, logger } from './utils/logger';
import { featureRoutes } from './features/features.routes';
import { trackEndpointResponse } from './middleware/endpointHealth';
import { alertScanner } from './jobs/alertScanner';
import { validateUuidRouteParams } from './middleware/security';
import { globalEmergencyLimit } from './middleware/rateLimits';

const ALERT_SCAN_INTERVAL_MS = 60_000;

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: { paths: logRedactPaths, censor: '[REDACTED]' },
    },
    trustProxy:
      env.TRUST_PROXY_HOPS === 0
        ? false
        : (_address: string, hop: number) => hop < env.TRUST_PROXY_HOPS,
  });
  let alertScanTimer: NodeJS.Timeout | undefined;
  let alertScanInProgress = false;

  const scanAlerts = async () => {
    if (alertScanInProgress) return;
    alertScanInProgress = true;
    try {
      const result = await alertScanner();
      if (result.triggered > 0) app.log.info(result, 'Budget alerts triggered');
    } catch (error) {
      app.log.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'Budget alert scan failed'
      );
    } finally {
      alertScanInProgress = false;
    }
  };

  await app.register(helmet);
  await app.register(cors, {
    origin: corsOrigins,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.setErrorHandler((error, request, reply) => errorHandler(error, request, reply));
  app.addHook('onRequest', globalEmergencyLimit);
  app.addHook('preValidation', validateUuidRouteParams);
  app.addHook('onResponse', trackEndpointResponse);
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));
  await app.register(featureRoutes);
  app.addHook('onReady', () => {
    void scanAlerts();
    alertScanTimer = setInterval(() => void scanAlerts(), ALERT_SCAN_INTERVAL_MS);
    alertScanTimer.unref();
  });
  app.addHook('onClose', () => {
    if (alertScanTimer) clearInterval(alertScanTimer);
  });
  return app;
}
async function start() {
  const app = await buildApp();
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    logger.info(`Server running at http://localhost:${env.PORT}`);
  } catch (error) {
    logger.error(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'Server startup failed'
    );
    process.exit(1);
  }
}
if (require.main === module) void start();
