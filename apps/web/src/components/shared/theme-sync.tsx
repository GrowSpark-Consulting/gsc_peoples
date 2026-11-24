'use client';

import { useEffect } from 'react';
import { applyTheme, readPreference, watchSystemTheme } from '@/lib/theme';

/** Mount once in the root layout so "System" follows live OS theme changes app-wide. */
export function ThemeSync() {
  useEffect(() => {
    applyTheme(readPreference());
    return watchSystemTheme();
  }, []);
  return null;
}
