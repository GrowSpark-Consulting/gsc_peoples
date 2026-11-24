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
        const i = items.findIndex((t) => t.key === value);
        if (e.key === 'ArrowRight') onChange(items[(i + 1) % items.length]!.key);
        if (e.key === 'ArrowLeft') onChange(items[(i - 1 + items.length) % items.length]!.key);
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
              '-mb-px shrink-0 cursor-pointer whitespace-nowrap border-b-2 px-3 py-2 text-body font-medium transition-colors',
              selected ? 'border-primary text-ink' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
