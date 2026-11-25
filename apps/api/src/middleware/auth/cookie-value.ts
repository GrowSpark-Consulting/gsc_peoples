/** Percent-decodes a cookie value. A malformed value is returned as is, so it simply fails to match any session. */
export function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
