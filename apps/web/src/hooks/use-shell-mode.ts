'use client';

import { useSyncExternalStore } from 'react';

/**
 * desktop: >= 1280px (sidebar expanded, user can collapse)
 * tablet:  1024-1279px (sidebar auto-collapsed to icons)
 * mobile:  < 1024px (sidebar becomes an overlay menu)
 */
export type ShellMode = 'desktop' | 'tablet' | 'mobile';

const DESKTOP = '(min-width: 1280px)';
const TABLET = '(min-width: 1024px)';

function subscribe(cb: () => void): () => void {
  const queries = [matchMedia(DESKTOP), matchMedia(TABLET)];
  queries.forEach((q) => q.addEventListener('change', cb));
  return () => queries.forEach((q) => q.removeEventListener('change', cb));
}

function getSnapshot(): ShellMode {
  if (matchMedia(DESKTOP).matches) return 'desktop';
  if (matchMedia(TABLET).matches) return 'tablet';
  return 'mobile';
}

export function useShellMode(): ShellMode {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'desktop' as const);
}
