import { optimizationRepository } from '../features/optimization/optimization.repository';
import { cacheRepository } from '../features/optimization/cache/cache.repository';
import { logger } from '../utils/logger';

// Scheduler wiring is shared deferred work across the jobs directory.
export async function cacheCleanup(): Promise<number> {
  const deletedCount =
    (await optimizationRepository.deleteExpiredEntries()) + (await cacheRepository.deleteExpired());
  logger.info({ deletedCount }, 'Expired cache entries removed');
  return deletedCount;
}
