/** Minimal REST client for platform integrations: timeout + retry on transient failures. */
export interface HttpClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createHttpClient({
  baseUrl,
  timeoutMs = 5_000,
  retries = 2,
  headers = {},
}: HttpClientOptions) {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(new URL(path, baseUrl), {
          ...init,
          headers: { 'content-type': 'application/json', ...headers, ...init.headers },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new HttpError(res.status, `${res.status} ${res.statusText}`);
        return (await res.json()) as T;
      } catch (err) {
        lastError = err;
        // Do not retry client errors (4xx); they will not succeed on a second try.
        if (err instanceof HttpError && err.status < 500) throw err;
        if (attempt < retries) await sleep(200 * 2 ** attempt);
      }
    }
    throw lastError;
  }
  return { get: <T>(path: string) => request<T>(path) };
}
