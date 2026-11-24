export type ThemePreference = 'light' | 'dark' | 'system';

const KEY = 'gs-theme';
const EVENT = 'gs-theme-change';

export function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(pref: ThemePreference): void {
  const dark =
    pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export function setPreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* storage unavailable: theme still applies for this page view */
  }
  applyTheme(pref);
  window.dispatchEvent(new Event(EVENT));
}

/*
 * Shared, ref-counted watcher so the OS colour scheme and cross-tab changes keep the theme in
 * sync without duplicate listeners (e.g. React strict-mode double effects, toggle + ThemeSync).
 * Explicit light/dark preferences are never touched by OS changes.
 */
let watchers = 0;
let detach: (() => void) | null = null;

export function watchSystemTheme(): () => void {
  if (watchers === 0) {
    const mql = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => {
      if (readPreference() === 'system') applyTheme('system');
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === KEY) {
        applyTheme(readPreference());
        window.dispatchEvent(new Event(EVENT));
      }
    };
    mql.addEventListener('change', sync);
    window.addEventListener('storage', onStorage);
    detach = () => {
      mql.removeEventListener('change', sync);
      window.removeEventListener('storage', onStorage);
    };
  }
  watchers += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    watchers -= 1;
    if (watchers === 0) {
      detach?.();
      detach = null;
    }
  };
}

export function subscribePreference(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  const release = watchSystemTheme();
  return () => {
    window.removeEventListener(EVENT, cb);
    release();
  };
}

/** Inline script run before paint to avoid a theme flash. */
export const themeInitScript = `try{var t=localStorage.getItem('${KEY}')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch(e){}`;
