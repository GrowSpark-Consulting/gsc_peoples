'use client';

import { Search, X } from 'lucide-react';
import { useId } from 'react';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface ListToolbarProps {
  /** Accessible name for the whole toolbar, e.g. "Employee filters". */
  label: string;
  search: {
    value: string;
    onChange: (value: string) => void;
    /** Accessible label of the search box. */
    label: string;
    placeholder?: string;
  };
  /** Filter controls (FilterSelect, pickers). */
  filters?: React.ReactNode;
  /** Secondary actions (export, import). Placed before the primary action. */
  actions?: React.ReactNode;
  /** The one primary action (e.g. Add employee). Right-most, per the design system toolbar order. */
  primary?: React.ReactNode;
  className?: string;
}

/**
 * Standard list toolbar. Order is fixed across every module: search, filters, (spacer),
 * secondary actions, primary action.
 */
export function ListToolbar({ label, search, filters, actions, primary, className }: ListToolbarProps) {
  const id = useId();
  return (
    <div role="search" aria-label={label} className={cn('mb-4 flex flex-wrap items-center gap-3', className)}>
      <div className="relative min-w-[200px] flex-1 sm:max-w-sm">
        <label htmlFor={id} className="sr-only">
          {search.label}
        </label>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" strokeWidth={1.75} aria-hidden />
        <input
          id={id}
          type="search"
          value={search.value}
          onChange={(e) => search.onChange(e.target.value)}
          placeholder={search.placeholder}
          autoComplete="off"
          className="h-9 w-full rounded-md border border-line-strong bg-surface pl-9 pr-9 text-body text-ink placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
        />
        {search.value ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => search.onChange('')}
            className="absolute right-2 top-1/2 inline-flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm text-muted hover:text-ink"
          >
            <X className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        ) : null}
      </div>
      {filters}
      {actions || primary ? (
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {actions}
          {primary}
        </div>
      ) : null}
    </div>
  );
}

export interface FilterSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  /** Text of the "no filter" option, e.g. "All statuses". */
  allLabel: string;
  disabled?: boolean;
}

/** Compact filter dropdown. The empty value means "no filter". */
export function FilterSelect({ label, value, onChange, options, allLabel, disabled }: FilterSelectProps) {
  return (
    <div className="min-w-[150px]">
      <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
