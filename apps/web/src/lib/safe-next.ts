/**
 * Where to go after sign-in. Only a same-origin path is accepted: the value must start with a single
 * "/", contain no backslash or control characters (browsers strip tabs/newlines, which could turn
 * "/<TAB>/host" into "//host"), and resolve to the given origin. Anything else falls back to the dashboard.
 */
export function safeNextPath(raw: string | null | undefined, origin: string): string {
  const fallback = '/dashboard';
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
