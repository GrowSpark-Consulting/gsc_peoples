/**
 * Production-mode smoke test of the BUILT API (`node dist/server.js`), configured the way Render runs it, but against
 * the disposable database `hr_itest_e2e` (never hr_db/hr_test/hosted). Run after `pnpm --filter @gsc/api build`:
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/e2e-scratch-db.ts create     # scratch DB + seed
 *   node scripts/production-smoke.mjs
 *
 * It starts the server with NODE_ENV=production, AUTH_MODE=session, CORS_ORIGINS=https://app.example.com and
 * COOKIE_DOMAIN=.example.com, then checks what the deployed browser/Vercel/Render combination depends on:
 * Secure/HttpOnly/SameSite/Domain on the session cookies, exact-origin CORS with credentials, CSRF, security headers,
 * rate limiting, liveness vs readiness, and that production refuses an unsafe configuration. Exits non-zero on any failure.
 * The TLS and proxy hop of the real platform cannot be reproduced here: X-Forwarded-* headers stand in for it.
 */
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';

const apiDir = path.resolve(import.meta.dirname, '..');
const tsx = path.join(apiDir, 'node_modules/tsx/dist/cli.mjs');
const urls = JSON.parse(execFileSync(process.execPath, [tsx, 'scripts/e2e-scratch-db.ts', 'urls'], { cwd: apiDir, encoding: 'utf8' }));
const PORT = 4590;
const ORIGIN = 'https://app.example.com';
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const PASSWORD = 'E2e-Scratch-Pass-1!';

const baseEnv = {
  ...process.env,
  NODE_ENV: 'production',
  AUTH_MODE: 'session',
  API_PORT: String(PORT),
  HOST: '127.0.0.1',
  DATABASE_URL: urls.DATABASE_URL,
  CORS_ORIGINS: ORIGIN,
  COOKIE_DOMAIN: '.example.com',
  LOG_LEVEL: 'warn',
  DOCUMENT_STORAGE_DRIVER: 'supabase', // never contacted: no document route is called here
  SUPABASE_STORAGE_URL: 'https://example-project.invalid',
  SUPABASE_STORAGE_SERVICE_KEY: 'smoke-test-not-a-real-key',
  AUTH_RATE_LIMIT_PER_15_MIN: '40',
  RATE_LIMIT_PER_MINUTE: '300',
  MAIL_DRIVER: 'disabled', // no mail server in the smoke test: invitations must then answer 503
  DB_TARGET: 'local',
};
delete baseEnv.DIRECT_URL;
delete baseEnv.DEV_AUTH_ENABLED;

const results = [];
const check = (name, ok, note = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  (${note})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Unsafe production configurations must not boot.
// The real entrypoint must exit early on an invalid configuration; a valid one keeps running.
async function startsAndStays(env, ms = 15_000) {
  // Waits for the process to exit by itself (an invalid configuration throws during start-up). Only if it is still
  // alive after `ms` is it considered to have started.
  const child = spawn(process.execPath, ['dist/server.js'], { cwd: apiDir, env, stdio: ['ignore', 'ignore', 'ignore'] });
  const exited = await Promise.race([new Promise((r) => child.on('exit', () => r(true))), sleep(ms).then(() => false)]);
  if (!exited) child.kill();
  return !exited;
}
check('production refuses to start with the local document driver', !(await startsAndStays({ ...baseEnv, DOCUMENT_STORAGE_DRIVER: 'local', PORT: '4591', API_PORT: '4591' })));
check('production refuses to start without CORS_ORIGINS', !(await startsAndStays({ ...baseEnv, CORS_ORIGINS: '', API_PORT: '4592' })));
check('production refuses AUTH_MODE=development', !(await startsAndStays({ ...baseEnv, AUTH_MODE: 'development', API_PORT: '4593' })));
check('production refuses to start without choosing an email driver', !(await startsAndStays({ ...baseEnv, MAIL_DRIVER: '', API_PORT: '4594' })));
check('production refuses a wildcard CORS origin', !(await startsAndStays({ ...baseEnv, CORS_ORIGINS: '*', API_PORT: '4595' })));
check('production refuses smtp without a web app address for the links', !(await startsAndStays({ ...baseEnv, MAIL_DRIVER: 'smtp', SMTP_HOST: 'smtp.invalid', MAIL_FROM: 'a@example.com', WEB_APP_URL: '', API_PORT: '4596' })));

// 2. The real configuration.
const server = spawn(process.execPath, ['dist/server.js'], { cwd: apiDir, env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));
try {
  for (let i = 0; i < 40; i += 1) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) break;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  const live = await fetch(`${BASE}/health`);
  const liveBody = await live.json();
  check('liveness is 200 and reports the database up', live.status === 200 && liveBody.dependencies.database === 'up');
  check('readiness is 200 with the database up', (await fetch(`${BASE}/health/ready`)).status === 200);
  check('API responses are Cache-Control: no-store', live.headers.get('cache-control') === 'no-store');
  check('HSTS, nosniff and frame protection are sent', /max-age=/.test(live.headers.get('strict-transport-security') ?? '') && live.headers.get('x-content-type-options') === 'nosniff' && !!live.headers.get('x-frame-options'));
  check('X-Powered-By is not sent', live.headers.get('x-powered-by') === null);

  const pre = await fetch(`${BASE}/me`, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-csrf-token,content-type' } });
  check('CORS preflight allows the exact web origin with credentials', pre.headers.get('access-control-allow-origin') === ORIGIN && pre.headers.get('access-control-allow-credentials') === 'true' && /x-csrf-token/i.test(pre.headers.get('access-control-allow-headers') ?? ''));
  for (const evil of ['https://evil.example.net', 'https://app.example.com.evil.net', 'http://app.example.com', 'null']) {
    const r = await fetch(`${BASE}/me`, { method: 'OPTIONS', headers: { Origin: evil, 'Access-Control-Request-Method': 'GET' } });
    check(`CORS refuses ${evil}`, r.headers.get('access-control-allow-origin') === null);
  }

  const login = (email, role, password = PASSWORD, ip = '203.0.113.7') =>
    fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'X-Forwarded-For': ip, 'X-Forwarded-Proto': 'https' }, body: JSON.stringify({ email, password, roleKey: role }) });
  const ok = await login('team@e2e.local', 'EMPLOYEE');
  const cookies = ok.headers.getSetCookie();
  const session = cookies.find((c) => c.startsWith('gsc_session='));
  const csrf = cookies.find((c) => c.startsWith('gsc_csrf='));
  check('login succeeds', ok.status === 200);
  check('session cookie: HttpOnly, Secure, SameSite=Lax, Domain=.example.com, Path=/', !!session && /HttpOnly/i.test(session) && /Secure/i.test(session) && /SameSite=Lax/i.test(session) && /Domain=\.example\.com/i.test(session) && /Path=\//.test(session), session ? session.replace(/=[^;]+/, '=<redacted>') : 'missing');
  check('CSRF cookie: readable by the web app (not HttpOnly) but Secure, SameSite=Lax, same Domain', !!csrf && !/HttpOnly/i.test(csrf) && /Secure/i.test(csrf) && /SameSite=Lax/i.test(csrf) && /Domain=\.example\.com/i.test(csrf));
  check('the login response never contains the session token in its body', !JSON.stringify(await ok.json()).includes(session?.split(';')[0].split('=')[1] ?? 'x-none'));

  const cookieHeader = cookies.map((c) => c.split(';')[0]).join('; ');
  const csrfToken = decodeURIComponent(csrf.split(';')[0].split('=')[1]);
  const me = await fetch(`${BASE}/me`, { headers: { Cookie: cookieHeader, Origin: ORIGIN } });
  check('/me works with the session cookie', me.status === 200 && (await me.json()).data.role === 'EMPLOYEE');
  const noCsrf = await fetch(`${BASE}/attendance/check-in`, { method: 'POST', headers: { Cookie: cookieHeader, Origin: ORIGIN } });
  check('a write without the CSRF header is refused (403)', noCsrf.status === 403);
  const badCsrf = await fetch(`${BASE}/attendance/check-in`, { method: 'POST', headers: { Cookie: cookieHeader, Origin: ORIGIN, 'X-CSRF-Token': `${csrfToken}x` } });
  check('a write with a wrong CSRF token is refused (403)', badCsrf.status === 403);
  check('no session cookie means 401', (await fetch(`${BASE}/me`, { headers: { Origin: ORIGIN } })).status === 401);
  const bearer = await fetch(`${BASE}/me`, { headers: { Authorization: 'Bearer dev:dev-hr-admin' } });
  check('development bearer tokens are rejected in production', bearer.status === 401);

  const wrong = [];
  for (let i = 0; i < 6; i += 1) wrong.push((await login('hr@e2e.local', 'HR_ADMIN', 'wrong-password-x', '198.51.100.9')).status);
  check('five wrong passwords for one account lock further attempts (per account and IP)', wrong.slice(0, 5).every((s) => s === 401) && wrong[5] === 401, `statuses ${wrong.join(',')}`);
  const lockedMsg = await (await login('hr@e2e.local', 'HR_ADMIN', PASSWORD, '198.51.100.9')).json();
  check('...even with the right password until the window passes', /Too many/i.test(lockedMsg?.error?.message ?? ''));

  let limited = 0;
  let sawHeader = false;
  for (let i = 0; i < 60; i += 1) {
    const r = await login(`nobody${i}@e2e.local`, 'EMPLOYEE', 'x', '192.0.2.55');
    sawHeader ||= r.headers.get('ratelimit-limit') === '40';
    if (r.status === 429) limited += 1;
  }
  check('per-IP auth limiter answers 429 after AUTH_RATE_LIMIT_PER_15_MIN requests', limited > 0 && sawHeader, `${limited} of 60 limited`);
  const other = await login('team@e2e.local', 'EMPLOYEE', PASSWORD, '192.0.2.99');
  check('a different client IP is not affected', other.status === 200);
  check('the health check is never rate limited', (await Promise.all(Array.from({ length: 30 }, () => fetch(`${BASE}/health`)))).every((r) => r.status === 200));

  // Nothing that grants access is ever returned by a production response.
  const forgot = await fetch(`${BASE}/auth/forgot-password`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '192.0.2.120' }, body: JSON.stringify({ email: 'team@e2e.local' }) });
  check('forgot-password returns no development token header', forgot.status === 200 && forgot.headers.get('x-development-reset-token') === null);
  const hrLogin = await login('sa@e2e.local', 'SUPER_ADMIN', PASSWORD, '192.0.2.121');
  const hrCookies = hrLogin.headers.getSetCookie().map((c) => c.split(';')[0]);
  const hrCsrf = decodeURIComponent(hrCookies.find((c) => c.startsWith('gsc_csrf=')).split('=')[1]);
  const invite = await fetch(`${BASE}/settings/users/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: hrCookies.join('; '), 'X-CSRF-Token': hrCsrf, 'X-Forwarded-For': '192.0.2.121' }, body: JSON.stringify({ email: 'smoke-invitee@e2e.local', roleKey: 'EMPLOYEE' }) });
  const inviteBody = await invite.text();
  check('without an email channel an invitation is refused (503) and returns no token', invite.status === 503 && !/invitationToken/.test(inviteBody), `status ${invite.status}`);
  const malformed = await fetch(`${BASE}/me`, { headers: { Cookie: 'gsc_session=%E0%A4%A', 'X-Forwarded-For': '192.0.2.122' } });
  check('a malformed cookie is 401, not 500', malformed.status === 401);
  const broken = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '192.0.2.122' }, body: '{"password":"hunter2-secret"' });
  check('broken JSON is a 400 that does not echo the body', broken.status === 400 && !(await broken.text()).includes('hunter2'));

  const err = await fetch(`${BASE}/nope`, { headers: { Cookie: cookieHeader } });
  check('unknown routes answer a JSON 404 without a stack', err.status === 404 && !JSON.stringify(await err.json()).includes('at '));
  check('the server log has no cookie, password or token values', !/gsc_session=|E2e-Scratch|smoke-test-not-a-real-key/.test(log));
} finally {
  server.kill();
}

// 3. Graceful shutdown. Windows cannot deliver SIGTERM to another process, so a preload raises it inside the server,
// which runs exactly the handler Render's SIGTERM would run.
{
  const preload = `data:text/javascript,setTimeout(()=>process.emit('SIGTERM'),4000)`;
  const child = spawn(process.execPath, ['--import', preload, 'dist/server.js'], { cwd: apiDir, env: { ...baseEnv, API_PORT: '4597', LOG_LEVEL: 'info' }, stdio: ['ignore', 'pipe', 'ignore'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  const code = await Promise.race([new Promise((r) => child.on('exit', r)), sleep(20_000).then(() => 'timeout')]);
  if (code === 'timeout') child.kill();
  check('SIGTERM closes the server and database and exits 0', code === 0 && /Shutting down/.test(out) && !/Forced exit/.test(out), `exit ${code}`);
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
