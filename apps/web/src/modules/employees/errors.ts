/**
 * Error raised by any EmployeesService adapter. Mirrors the API error body
 * `{ error: { code, message, details?, requestId? } }` so the UI handles demo and real adapters identically.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field -> message map from zod issues (VALIDATION_ERROR) or `{ field }` details (CONFLICT). */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (this.code === 'VALIDATION_ERROR' && Array.isArray(this.details)) {
      for (const issue of this.details as { path?: unknown[]; message?: string }[]) {
        const field = issue.path?.[0];
        if (typeof field === 'string' && issue.message && !(field in out))
          out[field] = issue.message;
      }
    }
    if (this.code === 'CONFLICT' && isObj(this.details) && typeof this.details.field === 'string') {
      out[this.details.field] = this.message;
    }
    return out;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

/** Human message safe to show in the UI. */
export function describeError(e: unknown): string {
  if (isApiError(e)) {
    if (e.status === 403) return 'You do not have permission to do that.';
    if (e.status === 404)
      return 'This employee could not be found, or you do not have access to it.';
    if (e.status >= 500) return 'Something went wrong on our side. Please try again.';
    return e.message;
  }
  return 'Something went wrong. Check your connection and try again.';
}
