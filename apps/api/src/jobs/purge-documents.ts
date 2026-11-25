/**
 * Retention purge for soft-deleted documents (PRD DOC-005): removes the object and the row once `purgeAfterAt`
 * (30 days after deletion) has passed. Idempotent and tenant-scoped; see modules/documents/retention.ts.
 *
 *   node dist/purge-documents.js --company <uuid>             dry run (default): counts what is due
 *   node dist/purge-documents.js --company <uuid> --execute   removes due objects and rows
 *   options: --limit <n>  documents per company per run (default 100, max 1000)
 *
 * It runs with exactly the API's runtime configuration (the `hr_app` role and the storage service key): no
 * migration credential is needed. The company ids come from `--company` (repeatable) or from PURGE_COMPANY_IDS
 * (comma separated), because the runtime role deliberately cannot enumerate companies.
 * Nothing is scheduled by this repository; see docs/development/render-deployment-guide.md.
 */
import { env } from '../config/env';
import { disconnectDatabase, getPrisma } from '../database/client';
import { createTenantRunner } from '../database/tenant';
import { createDocumentStorage } from '../integrations/storage';
import { purgeAllCompanies } from '../modules/documents/retention';
import { logger } from '../shared/utils/logger';
import { parsePurgeArgs } from './purge-args';

async function main() {
  const options = parsePurgeArgs(process.argv.slice(2), process.env.PURGE_COMPANY_IDS);
  const results = await purgeAllCompanies(options.companyIds, {
    runner: createTenantRunner(getPrisma()),
    storage: createDocumentStorage(env),
    dryRun: !options.execute,
    limit: options.limit,
    log: logger,
  });
  const sum = (pick: (r: (typeof results)[number]) => number) => results.reduce((n, r) => n + pick(r), 0);
  console.log(JSON.stringify({ mode: options.execute ? 'execute' : 'dry-run', companies: results.length, scanned: sum((r) => r.scanned), purged: sum((r) => r.purged), failed: sum((r) => r.failed) }));
  return results.some((r) => r.failed > 0) ? 1 : 0;
}

try {
  process.exitCode = await main();
} catch (err) {
  logger.error({ err }, 'document purge could not start');
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
