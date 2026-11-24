const KEY = 'gs-sidebar-collapsed';
const EVENT = 'gs-sidebar-change';

/** Desktop sidebar preference: true = collapsed to 64px. Defaults to expanded. */
export function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(KEY, collapsed ? '1' : '0');
  } catch {
    /* storage unavailable: preference applies for this page view only */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeSidebarCollapsed(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}
