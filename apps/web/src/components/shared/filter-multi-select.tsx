'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface FilterMultiSelectProps<T extends string> {
  /** Accessible name and visible label, e.g. "Status". */
  label: string;
  /** Selected values. Empty means "no filter". */
  value: readonly T[];
  onChange: (value: T[]) => void;
  options: readonly { value: T; label: string }[];
  /** Summary when nothing is selected, e.g. "All statuses". */
  allLabel: string;
  disabled?: boolean;
}

/**
 * Multi-value filter (the list endpoints accept comma-separated lists). A toggle button opens a panel
 * of native checkboxes: Escape or an outside click closes it and returns focus to the button.
 * The summary shows the count so a collapsed filter is never ambiguous.
 */
export function FilterMultiSelect<T extends string>({
  label,
  value,
  onChange,
  options,
  allLabel,
  disabled,
}: FilterMultiSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const selected = options.filter((o) => value.includes(o.value));
  const summary =
    selected.length === 0 ? allLabel : selected.length === 1 ? selected[0]!.label : `${label}: ${selected.length} selected`;

  const toggle = (v: T) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : options.map((o) => o.value).filter((x) => x === v || value.includes(x)));

  return (
    <div ref={rootRef} className="relative min-w-[150px]">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-md border bg-surface px-3 text-body text-ink transition-colors duration-[120ms] disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-60',
          selected.length > 0 ? 'border-primary' : 'border-line-strong',
        )}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className="size-4 shrink-0 text-muted" strokeWidth={1.75} aria-hidden />
      </button>
      {open ? (
        <fieldset
          id={panelId}
          className="absolute left-0 top-full z-20 mt-1 min-w-full rounded-md border border-line bg-surface p-2 shadow-md"
        >
          <legend className="sr-only">{label}</legend>
          <ul className="flex flex-col">
            {options.map((o) => (
              <li key={o.value}>
                <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-body text-ink hover:bg-hover">
                  <input
                    type="checkbox"
                    checked={value.includes(o.value)}
                    onChange={() => toggle(o.value)}
                    className="size-4 cursor-pointer accent-primary"
                  />
                  <span className="whitespace-nowrap">{o.label}</span>
                </label>
              </li>
            ))}
          </ul>
          {selected.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full cursor-pointer rounded-sm px-2 py-1.5 text-left text-label font-medium text-primary hover:bg-hover"
            >
              Clear {label.toLowerCase()}
            </button>
          ) : null}
        </fieldset>
      ) : null}
    </div>
  );
}
