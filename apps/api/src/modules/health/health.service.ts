import type { DependencyStatus, HealthResponse } from '@gsc/contracts';
import { getPrisma, isDatabaseConfigured } from '../../database/client';
import { getRedis, isRedisConfigured } from '../../queues/connection';
import { SERVICE_NAME, SERVICE_VERSION } from '../../shared/constants';

const CHECK_TIMEOUT_MS = 2_000;

async function check(
  configured: boolean,
  probe: () => Promise<unknown>,
): Promise<DependencyStatus> {
  if (!configured) return 'not_configured';
  try {
    await Promise.race([
      probe(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS).unref(),
      ),
    ]);
    return 'up';
  } catch {
    return 'down';
  }
}

export async function getHealth(): Promise<HealthResponse> {
  const [database, redis] = await Promise.all([
    check(isDatabaseConfigured(), () => getPrisma().$queryRaw`SELECT 1`),
    check(isRedisConfigured(), () => getRedis()!.ping()),
  ]);
  return {
    status: database === 'down' || redis === 'down' ? 'degraded' : 'ok',
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    dependencies: { database, redis },
  };
}
