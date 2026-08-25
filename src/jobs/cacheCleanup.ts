import { optimizationRepository } from '../features/optimization/optimization.repository';
import { logger } from '../utils/logger';

// Scheduler wiring is shared deferred work across the jobs directory.
export async function cacheCleanup(): Promise<number> {
  const deletedCount = await optimizationRepository.deleteExpiredEntries();
  logger.info({ deletedCount }, 'Expired semantic cache entries removed');
  return deletedCount;
}
