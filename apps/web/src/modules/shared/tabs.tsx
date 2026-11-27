'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils';

export interface TabItem<K extends string> {
  key: K;
  label: string;
}

/**
 * Minimal accessible tab list built from the existing design tokens (underline style, no new colours).
 * Arrow keys move between tabs; the panel is rendered by the caller with `role="tabpanel"`.
 */
export function Tabs<K extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: readonly TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  label: string;
}) {
  const id = useId();
  return (
    <div
      role="tablist"
      aria-label={label}
      className="mb-4 flex gap-1 overflow-x-auto border-b border-line"
      onKeyDown={(e) => {
        // Roving tabindex: arrow keys / Home / End select a tab AND move focus to it (WAI-ARIA tabs).
        const i = items.findIndex((t) => t.key === value);
        let next = -1;
        if (e.key === 'ArrowRight') next = (i + 1) % items.length;
        else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = items.length - 1;
        if (next < 0) return;
        e.preventDefault();
        const key = items[next]!.key;
        onChange(key);
        document.getElementById(`${id}-${key}`)?.focus();
      }}
    >
      {items.map((t) => {
        const selected = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`${id}-${t.key}`}
            aria-selected={selected}
            aria-controls={`${id}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.key)}
            className={cn(
              '-mb-px min-h-10 shrink-0 cursor-pointer whitespace-nowrap rounded-t-md border-b-2 px-3 py-2 text-body font-medium transition-colors duration-[120ms] focus-visible:-outline-offset-2 pointer-coarse:min-h-11',
              selected
                ? 'border-primary text-ink'
                : 'border-transparent text-muted hover:border-line-strong hover:text-ink',
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
