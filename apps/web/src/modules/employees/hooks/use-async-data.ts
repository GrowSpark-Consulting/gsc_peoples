'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Result<T> =
  { token: string; ok: true; data: T } | { token: string; ok: false; error: unknown };

export interface AsyncData<T> {
  status: 'idle' | 'loading' | 'success' | 'error';
  data: T | undefined;
  error: unknown;
  reload: () => void;
}

/**
 * Minimal data loader. `key` identifies the request; a new key (or `reload()`) starts a new load and
 * any older in-flight result is ignored, so responses can never arrive out of order. Loading is derived
 * (no synchronous setState inside the effect).
 */
export function useAsyncData<T>(key: string, load: () => Promise<T>, enabled = true): AsyncData<T> {
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<Result<T> | null>(null);
  const token = `${key}#${nonce}`;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadRef.current().then(
      (data) => {
        if (!cancelled) setResult({ token, ok: true, data });
      },
      (error: unknown) => {
        if (!cancelled) setResult({ token, ok: false, error });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, enabled]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const current = result?.token === token ? result : null;
  const status = !enabled ? 'idle' : !current ? 'loading' : current.ok ? 'success' : 'error';
  return {
    status,
    data: current?.ok ? current.data : undefined,
    error: current && !current.ok ? current.error : undefined,
    reload,
  };
}
