import { count, eq, sql } from 'drizzle-orm';
import { db } from '../../config/database';
import { redis } from '../../config/redis';
import { agents, orgs } from '../../db/schema';

const HEALTH_CHECK_TIMEOUT_MS = 2_000;

async function independent(check: () => Promise<unknown>) {
  try {
    await Promise.race([
      check(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Health check timed out')), HEALTH_CHECK_TIMEOUT_MS)
      ),
    ]);
    return 'healthy' as const;
  } catch {
    return 'unhealthy' as const;
  }
}

export const adminHealthService = {
  async system() {
    const postgres = await independent(() => db.execute(sql`select 1`));
    const redisStatus = await independent(() => redis.ping());
    let activeOrgs = 0;
    let activeAgents = 0;
    if (postgres === 'healthy') {
      const [orgCount, agentCount] = await Promise.all([
        db.select({ total: count() }).from(orgs).where(eq(orgs.status, 'active')),
        db.select({ total: count() }).from(agents).where(eq(agents.status, 'active')),
      ]);
      activeOrgs = Number(orgCount[0]?.total ?? 0);
      activeAgents = Number(agentCount[0]?.total ?? 0);
    }
    return {
      postgres,
      redis: redisStatus,
      activeOrgs,
      activeAgents,
      timestamp: new Date().toISOString(),
    };
  },
  async endpoints() {
    try {
      const keys = await redis.keys('endpoint:health:*');
      const routes = await Promise.all(
        keys.map(async (key) => {
          const samples = (await redis.lRange(key, 0, -1)).map(
            (value) => JSON.parse(value) as { statusCode: number; durationMs: number }
          );
          const count = samples.length;
          const errors = samples.filter(
            (sample) => sample.statusCode < 200 || sample.statusCode >= 300
          ).length;
          return {
            route: key.slice('endpoint:health:'.length),
            requestCount: count,
            averageResponseTimeMs: count
              ? samples.reduce((sum, sample) => sum + sample.durationMs, 0) / count
              : 0,
            errorRate: count ? (errors / count) * 100 : 0,
          };
        })
      );
      return { redis: 'healthy' as const, routes };
    } catch {
      return { redis: 'unhealthy' as const, routes: [] };
    }
  },
};
