import { createApp } from './app';
import { env } from './config/env';
import { disconnectDatabase, getPrisma, isDatabaseConfigured } from './database/client';
import { checkDatabaseConnectivity } from './database/startup';
import { startBackgroundJobs, stopBackgroundJobs } from './queues';
import { logger } from './shared/utils/logger';

const app = createApp();
startBackgroundJobs();

const server = app.listen(env.API_PORT, env.HOST, () => {
  logger.info(
    { host: env.HOST, port: env.API_PORT, env: env.NODE_ENV, auth: env.AUTH_MODE },
    'GSC Peoples API listening',
  );
  // Warm the pool after the port is open: liveness answers immediately, and a database outage is logged, not fatal.
  if (isDatabaseConfigured()) void checkDatabaseConnectivity(() => getPrisma().$queryRaw`SELECT 1`, logger);
});

// Render's load balancer keeps idle connections for 60 s; a Node default of 5 s would close them first and show up
// as sporadic 502s. The header timeout must be longer than the keep-alive timeout.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

let shuttingDown = false;
async function shutdown(signal: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  const force = setTimeout(() => {
    logger.error('Forced exit after shutdown timeout');
    process.exit(1);
  }, 10_000);
  force.unref();

  try {
    const closed = new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    server.closeIdleConnections(); // stop accepting, finish in-flight requests, drop idle keep-alive sockets
    await closed;
    await stopBackgroundJobs();
    await disconnectDatabase();
    process.exit(exitCode);
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'Unhandled rejection'));
process.on('uncaughtException', (err) => {
  // State is unknown after an uncaught exception: log it, exit non-zero and let the platform restart the process.
  logger.fatal({ err }, 'Uncaught exception');
  void shutdown('uncaughtException', 1);
});
