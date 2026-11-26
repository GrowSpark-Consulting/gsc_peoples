/**
 * Classifies errors that mean "the database is unavailable right now" (as opposed to a bug or an ordinary SQL error),
 * so the API can answer 503 + Retry-After instead of a generic 500, and log the failure without leaking anything.
 *
 * Every rule below was checked against the real error objects produced by @prisma/client 7.10 + @prisma/adapter-pg
 * 7.10 + pg 8.23 / pg-pool 3.14 against a real PostgreSQL (see database-errors.integration.test.ts):
 *
 *  - Model queries surface socket and server failures as PrismaClientKnownRequestError with a P1xxx code, the raw
 *    socket code (e.g. `ECONNREFUSED`), or `meta.driverAdapterError.cause.kind`.
 *  - Raw queries wrap the same failures as P2010 with `meta.driverAdapterError.cause`.
 *  - pg / pg-pool timeouts are NOT converted by the adapter (`convertDriverError` rethrows them unchanged), so they
 *    reach the app as plain `Error`s whose only identifier is a fixed message defined in the driver source.
 */

export type DatabaseFailureKind =
  | 'unreachable' // DNS, refused, host/network unreachable, TLS handshake failure
  | 'connect_timeout' // TCP/TLS/auth did not complete within connectionTimeoutMillis
  | 'acquire_timeout' // every pool connection was busy for connectionTimeoutMillis
  | 'query_timeout' // statement_timeout (server) or query_timeout (client) fired
  | 'transaction_timeout' // a Prisma interactive transaction exceeded its timeout
  | 'connection_lost' // an established connection was closed or reset
  | 'unavailable'; // the server refused service: shutting down, too many connections, credentials/database rejected

/** Prisma engine / client error codes that mean the database could not be used. */
const PRISMA_CODES: Record<string, DatabaseFailureKind> = {
  P1000: 'unavailable', // authentication failed
  P1001: 'unreachable', // can't reach database server
  P1002: 'connect_timeout', // database server timed out
  P1003: 'unavailable', // database does not exist
  P1008: 'query_timeout', // operations timed out
  P1010: 'unavailable', // access denied
  P1011: 'unreachable', // error opening a TLS connection
  P1017: 'connection_lost', // server closed the connection
  P2024: 'acquire_timeout', // timed out fetching a connection from the pool
  P2037: 'unavailable', // too many database connections
};

/** Node socket error codes (also used verbatim as the Prisma error code for model queries). */
const SOCKET_CODES: Record<string, DatabaseFailureKind> = {
  ECONNREFUSED: 'unreachable',
  ENOTFOUND: 'unreachable',
  EAI_AGAIN: 'unreachable',
  EHOSTUNREACH: 'unreachable',
  ENETUNREACH: 'unreachable',
  ETIMEDOUT: 'connect_timeout',
  ECONNRESET: 'connection_lost',
  EPIPE: 'connection_lost',
};

/** `kind` values set by @prisma/adapter-pg's convertDriverError. */
const ADAPTER_KINDS: Record<string, DatabaseFailureKind> = {
  DatabaseNotReachable: 'unreachable',
  TlsConnectionError: 'unreachable',
  ConnectionClosed: 'connection_lost',
  SocketTimeout: 'query_timeout',
  TooManyConnections: 'unavailable',
  AuthenticationFailed: 'unavailable',
  DatabaseAccessDenied: 'unavailable',
  DatabaseDoesNotExist: 'unavailable',
};

/** Fixed messages from the pg / pg-pool source (they carry no code). Matched exactly, never by substring. */
const DRIVER_MESSAGES: Record<string, DatabaseFailureKind> = {
  'timeout exceeded when trying to connect': 'acquire_timeout', // pg-pool: waited connectionTimeoutMillis for a slot
  'Connection terminated due to connection timeout': 'connect_timeout', // pg-pool: new connection exceeded the timeout
  'Query read timeout': 'query_timeout', // pg: query_timeout
  'Connection terminated unexpectedly': 'connection_lost', // pg: socket closed mid-conversation
  'Connection terminated': 'connection_lost', // pg: client ended while queries were queued
  'Client has encountered a connection error and is not queryable': 'connection_lost',
};

/** PostgreSQL SQLSTATE codes (on a pg DatabaseError, or on the adapter's `kind: "postgres"` cause). */
function sqlStateKind(code: string): DatabaseFailureKind | undefined {
  if (code === '57014') return 'query_timeout'; // query_canceled (statement_timeout)
  if (code === '57P01' || code === '57P02' || code === '57P03') return 'unavailable'; // shutdown / cannot connect now
  if (code === '53300') return 'unavailable'; // too_many_connections
  if (code.startsWith('08')) return 'connection_lost'; // connection_exception class
  return undefined;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null;
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

function adapterCause(err: Obj): Obj | undefined {
  const meta = isObj(err.meta) ? err.meta : undefined;
  const driver = meta && isObj(meta.driverAdapterError) ? meta.driverAdapterError : undefined;
  return driver && isObj(driver.cause) ? driver.cause : undefined;
}

function classifyOne(err: Obj): DatabaseFailureKind | undefined {
  const name = str(err.name) ?? '';
  const code = str(err.code);
  const prisma = name.startsWith('PrismaClient');

  if (prisma && code) {
    if (PRISMA_CODES[code]) return PRISMA_CODES[code];
    if (SOCKET_CODES[code]) return SOCKET_CODES[code];
    // An interactive transaction that ran past its `timeout` (meta carries the configured timeout).
    if (code === 'P2028' && isObj(err.meta) && typeof err.meta.timeout === 'number') return 'transaction_timeout';
  }
  if (prisma && name === 'PrismaClientInitializationError') return 'unavailable';

  const cause = adapterCause(err);
  if (cause) {
    const kind = str(cause.kind);
    if (kind && ADAPTER_KINDS[kind]) return ADAPTER_KINDS[kind];
    const sqlState = str(cause.originalCode) ?? str(cause.code);
    if (kind === 'postgres' && sqlState) return sqlStateKind(sqlState);
    return undefined;
  }

  if (!prisma) {
    // A pg DatabaseError (raw pg clients) carries a 5-character SQLSTATE and a severity.
    if (code && /^[0-9A-Z]{5}$/.test(code) && typeof err.severity === 'string') return sqlStateKind(code);
    if (code && SOCKET_CODES[code]) return SOCKET_CODES[code];
    const message = str(err.message);
    if (message && DRIVER_MESSAGES[message]) return DRIVER_MESSAGES[message];
  }
  return undefined;
}

/** Returns the failure kind when `err` (or one of its causes) means the database is unavailable, else undefined. */
export function classifyDatabaseError(err: unknown): DatabaseFailureKind | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && isObj(current); depth++) {
    const kind = classifyOne(current);
    if (kind) return kind;
    current = current.cause;
  }
  return undefined;
}

const CONNECTION_STRING = /\b(postgres(?:ql)?):\/\/[^\s'"`]+/gi;

/**
 * Fields that are safe to log for a database failure: no connection string, no credentials, no query parameters.
 * Driver and Prisma messages can quote the host or role name, which is acceptable; any URL is redacted anyway.
 */
export function safeDatabaseErrorFields(err: unknown): Record<string, unknown> {
  if (!isObj(err)) return { type: typeof err };
  const cause = adapterCause(err);
  const nested = isObj(err.cause) ? err.cause : undefined;
  const message = str(err.message)?.split('\n').filter(Boolean).pop()?.replace(CONNECTION_STRING, '$1://[redacted]');
  return {
    name: str(err.name),
    code: str(err.code),
    message: message?.slice(0, 300),
    ...(cause ? { driverKind: str(cause.kind), sqlState: str(cause.originalCode) ?? str(cause.code) } : {}),
    ...(nested && !cause ? { cause: str(nested.message)?.replace(CONNECTION_STRING, '$1://[redacted]').slice(0, 200) } : {}),
  };
}

/** Seconds a client should wait before retrying after a 503 caused by database unavailability. */
export const DATABASE_RETRY_AFTER_SECONDS = 5;
