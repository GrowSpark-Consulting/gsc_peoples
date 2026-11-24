/**
 * REAL-SERVICE verification of the private document bucket. NOT run by any test and NOT run in this sprint:
 * it needs a bucket and credentials that only exist after you approve the hosted Supabase changes.
 * It talks only to the bucket named by SUPABASE_STORAGE_BUCKET and only touches objects under
 * `__verification__/<uuid>`, which it deletes at the end.
 *
 *   SUPABASE_STORAGE_URL=... SUPABASE_STORAGE_SERVICE_KEY=... SUPABASE_STORAGE_BUCKET=hr-documents \
 *     tsx scripts/verify-document-storage.ts --i-understand-this-uses-the-real-service
 *
 * Checks (what mocked tests cannot prove):
 *   1. upload succeeds and a second upload to the same key is refused (no overwrite);
 *   2. the bucket is private: the public object URL is refused (401/403/404), not served;
 *   3. a 60-second signed URL downloads the exact bytes (and with `download=` a Content-Disposition attachment);
 *   4. the same signed URL is refused after it expires (waits ~65 s);
 *   5. a signed URL with a tampered token is refused;
 *   6. delete removes the object and signing it afterwards fails.
 * Exit code 0 only if every check passes. Prints results, never the key or the URLs' tokens.
 */
import crypto from 'node:crypto';
import { createSupabaseDocumentStorage } from '../src/integrations/storage';

if (!process.argv.includes('--i-understand-this-uses-the-real-service')) {
  console.error('Refusing to run without --i-understand-this-uses-the-real-service');
  process.exit(2);
}
const url = process.env.SUPABASE_STORAGE_URL;
const serviceKey = process.env.SUPABASE_STORAGE_SERVICE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'hr-documents';
if (!url || !serviceKey) {
  console.error('SUPABASE_STORAGE_URL and SUPABASE_STORAGE_SERVICE_KEY are required');
  process.exit(2);
}

const storage = createSupabaseDocumentStorage({ url, serviceKey, bucket });
const key = `__verification__/${crypto.randomUUID()}`;
const body = Buffer.concat([Buffer.from('%PDF-1.4\n'), crypto.randomBytes(256)]);
const results: { check: string; ok: boolean; note?: string }[] = [];
const record = (check: string, ok: boolean, note?: string) => {
  results.push({ check, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${check}${note ? ` (${note})` : ''}`);
};

try {
  await storage.put({ key, body, contentType: 'application/pdf' });
  record('upload', true);
  const second = await storage.put({ key, body, contentType: 'application/pdf' }).then(() => 'accepted', () => 'refused');
  record('second upload to the same key is refused (no overwrite)', second === 'refused');

  const publicUrl = `${url.replace(/\/+$/, '')}/storage/v1/object/public/${encodeURIComponent(bucket)}/${key}`;
  const pub = await fetch(publicUrl);
  record('bucket is private: public object URL is not served', !pub.ok, `HTTP ${pub.status}`);

  const signed = await storage.createSignedDownloadUrl(key, { expiresInSeconds: 60, fileName: 'verify.pdf' });
  const got = await fetch(signed);
  const same = got.ok && Buffer.from(await got.arrayBuffer()).equals(body);
  record('signed URL downloads the exact bytes', same, `HTTP ${got.status}`);
  record('signed URL with download= sends Content-Disposition attachment', /attachment/i.test(got.headers.get('content-disposition') ?? ''), got.headers.get('content-disposition') ?? 'none');

  const tampered = new URL(signed);
  const token = tampered.searchParams.get('token') ?? '';
  tampered.searchParams.set('token', `${token.slice(0, -2)}xx`);
  const bad = await fetch(tampered);
  record('tampered token is refused', !bad.ok, `HTTP ${bad.status}`);

  console.log('waiting 65 s for the link to expire ...');
  await new Promise((r) => setTimeout(r, 65_000));
  const late = await fetch(signed);
  record('signed URL is refused after 60 seconds', !late.ok, `HTTP ${late.status}`);
} finally {
  await storage.remove(key).catch(() => undefined);
}
const gone = await storage.createSignedDownloadUrl(key, { expiresInSeconds: 60 }).then(() => 'signed', () => 'refused');
record('after delete the object can no longer be signed', gone === 'refused');
process.exit(results.every((r) => r.ok) ? 0 : 1);
