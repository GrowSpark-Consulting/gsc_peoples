export interface PurgeArgs {
  companyIds: string[];
  execute: boolean;
  limit: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Command line of the retention job. Anything unexpected stops the run before it touches data. */
export function parsePurgeArgs(argv: readonly string[], envIds: string | undefined): PurgeArgs {
  const ids: string[] = [];
  let execute = false;
  let limit = 100;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === '--execute') execute = true;
    else if (a === '--company') ids.push(argv[++i] ?? '');
    else if (a === '--limit') limit = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (ids.length === 0) ids.push(...(envIds ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  if (ids.length === 0) throw new Error('Name the company with --company <uuid> or PURGE_COMPANY_IDS');
  const bad = ids.find((id) => !UUID.test(id));
  if (bad !== undefined) throw new Error('Company ids must be UUIDs');
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('--limit must be an integer from 1 to 1000');
  return { companyIds: [...new Set(ids)], execute, limit };
}
