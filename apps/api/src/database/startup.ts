import { classifyDatabaseError, safeDatabaseErrorFields, type DatabaseFailureKind } from './errors';

export interface StartupLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export type ConnectivityResult = { ok: true; ms: number } | { ok: false; ms: number; kind: DatabaseFailureKind | 'error' };

/**
 * Opens the first database connection right after the server starts listening, so the first login does not pay for
 * the TCP + TLS + authentication round-trips, and an operator sees the database state in the startup logs.
 *
 * Never throws and never exits: a temporary database outage must not crash-loop the service. Liveness (/health)
 * stays independent of the database; readiness (/health/ready) reports it. The pool reconnects on demand, so the API
 * recovers on its own once the database is reachable again.
 */
export async function checkDatabaseConnectivity(
  probe: () => Promise<unknown>,
  log: StartupLogger,
): Promise<ConnectivityResult> {
  const started = Date.now();
  try {
    await probe();
    const ms = Date.now() - started;
    log.info({ event: 'db.startup_check', ok: true, ms }, 'Database connection established');
    return { ok: true, ms };
  } catch (err) {
    const ms = Date.now() - started;
    const kind = classifyDatabaseError(err) ?? 'error';
    log.warn(
      { event: 'db.startup_check', ok: false, ms, kind, db: safeDatabaseErrorFields(err) },
      'Database not reachable at startup; continuing (readiness reports degraded until it recovers)',
    );
    return { ok: false, ms, kind };
  }
}
