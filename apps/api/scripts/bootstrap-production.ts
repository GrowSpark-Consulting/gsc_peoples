/**
 * First-time company setup (PRD W1). Run by an operator from their own terminal, never by a deployment.
 *
 *   tsx scripts/bootstrap-production.ts --config <file.json> --confirm-company "<exact company name>"
 *       dry run (default): checks the database and reports what would be created; changes nothing
 *   ... --web-url https://app.<domain> --execute
 *       creates it and prints a one-time activation link for the first Super Admin
 *
 * No password is chosen or seen by the operator. The link is shown once, on an interactive terminal only (the run
 * refuses redirected output), is stored only as a hash, works once and expires after 7 days. Running --execute
 * again before it is used voids it and prints a new one.
 *
 * Connection: DB_TARGET=supabase uses SUPABASE_DIRECT_URL (hr_migrator) with verified TLS against
 * SUPABASE_CA_CERT_PATH. Otherwise DIRECT_URL is used and must point at localhost (rehearsal). No credential is
 * printed. See docs/development/production-migration-and-bootstrap.md.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { assertMigrated, bootstrapCompany, bootstrapConfigSchema } from '../src/database/bootstrap/bootstrap';
import { parseDatabaseUrl } from '../src/database/connection-url';
import { INVITATION_TTL_DAYS } from '../src/integrations/mail/messages';
import { secureToken, tokenHash } from '../src/modules/auth/password';

loadEnv({ path: path.resolve(import.meta.dirname, '../../../.env'), quiet: true });

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function parseArgs(argv: string[]) {
  const out = { config: '', confirm: '', webUrl: '', execute: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--config') out.config = argv[++i] ?? '';
    else if (argv[i] === '--confirm-company') out.confirm = argv[++i] ?? '';
    else if (argv[i] === '--web-url') out.webUrl = argv[++i] ?? '';
    else if (argv[i] === '--execute') out.execute = true;
    else throw new Error(`Unknown argument "${argv[i]}"`);
  }
  if (!out.config || !out.confirm) throw new Error('Usage: bootstrap-production.ts --config <file.json> --confirm-company "<company name>" [--web-url <https://app...> --execute]');
  if (out.execute) {
    if (!/^https:\/\/[^\s/]+\/?$/.test(out.webUrl) && !/^http:\/\/localhost(:\d+)?\/?$/.test(out.webUrl)) throw new Error('--execute needs --web-url, the https origin of the web app');
    if (!process.stdout.isTTY) throw new Error('--execute needs an interactive terminal: the activation link must not be written to a file or a log');
  }
  return out;
}

function connection(): { client: pg.Client; label: string } {
  if (process.env.DB_TARGET === 'supabase') {
    const url = process.env.SUPABASE_DIRECT_URL;
    const ca = process.env.SUPABASE_CA_CERT_PATH;
    if (!url || !ca) throw new Error('SUPABASE_DIRECT_URL and SUPABASE_CA_CERT_PATH are required for DB_TARGET=supabase');
    const u = new URL(url);
    return {
      label: `hosted database ${u.hostname}`,
      client: new pg.Client({
        host: u.hostname,
        port: Number(u.port || 5432),
        database: u.pathname.slice(1),
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        ssl: { ca: readFileSync(path.resolve(ca), 'utf8'), rejectUnauthorized: true },
      }),
    };
  }
  const url = process.env.DIRECT_URL;
  if (!url) throw new Error('DIRECT_URL is not set');
  const { connectionString } = parseDatabaseUrl(url);
  const u = new URL(connectionString);
  if (!LOCAL_HOSTS.has(u.hostname)) throw new Error('SAFEGUARD: without DB_TARGET=supabase this only runs against localhost');
  return { label: `local database ${u.pathname.slice(1)}`, client: new pg.Client({ connectionString }) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = readFileSync(path.resolve(args.config), 'utf8');
  if (raw.includes('REPLACE') || raw.includes('replace@example.com')) throw new Error('The configuration still contains example placeholders');
  const parsed = bootstrapConfigSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n')}`);
  }
  const config = parsed.data;
  if (args.confirm !== config.company.name) throw new Error('--confirm-company does not match the company name in the configuration');
  const migrations = readdirSync(path.resolve(import.meta.dirname, '../src/database/migrations'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const { client, label } = connection();
  await client.connect();
  try {
    await assertMigrated(client, migrations);
    console.log(`${args.execute ? 'Bootstrapping' : 'DRY RUN against'} ${label}`);
    const token = args.execute ? secureToken() : undefined;
    const report = await bootstrapCompany(client, {
      config,
      dryRun: !args.execute,
      invitation: token ? { tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000) } : undefined,
    });
    console.table(report.created);
    if (!args.execute) {
      console.log('Dry run only: nothing was changed.');
      return;
    }
    console.log(`Done. Company id (needed for the retention job): ${report.companyId}`);
    if (token && report.awaitingActivation) {
      console.log(`\nActivation link for the Super Admin. It is shown only now, works once and expires in ${INVITATION_TTL_DAYS} days.`);
      console.log('Send it over a trusted channel:\n');
      console.log(`${args.webUrl.replace(/\/+$/, '')}/accept-invitation?token=${encodeURIComponent(token)}\n`);
    } else {
      console.log('The Super Admin account is already activated; no link was issued.');
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
