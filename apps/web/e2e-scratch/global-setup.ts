import { execFileSync } from 'node:child_process';
import path from 'node:path';

const apiDir = path.resolve(__dirname, '../../api');
const run = (cmd: string) =>
  execFileSync(process.execPath, [path.join(apiDir, 'node_modules/tsx/dist/cli.mjs'), 'scripts/e2e-scratch-db.ts', cmd], { cwd: apiDir, encoding: 'utf8' }).trim();

/** Builds the scratch database before the servers start and drops it afterwards. */
export default async function globalSetup() {
  run('create');
  return async () => {
    if (process.env.E2E_KEEP_DB === '1') return;
    run('drop');
  };
}
