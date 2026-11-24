'use client';

import { useCallback, useRef, useState } from 'react';
import { describeApiError } from '@/lib/api-client';

/**
 * Runs one async mutation at a time (a second call while one is running is ignored, so a double click
 * cannot submit twice). Exposes `pending` for button state and a ready-to-show `error` message.
 */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; raw: unknown } | null>(null);
  const busy = useRef(false);
  const run = useCallback(
    async (...args: A): Promise<{ ok: true; value: R } | { ok: false; error: unknown }> => {
      if (busy.current) return { ok: false, error: new Error('Already submitting') };
      busy.current = true;
      setPending(true);
      setError(null);
      try {
        return { ok: true, value: await fn(...args) };
      } catch (e) {
        setError({ message: describeApiError(e), raw: e });
        return { ok: false, error: e };
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [fn],
  );
  return { run, pending, error, clearError: () => setError(null) };
}
