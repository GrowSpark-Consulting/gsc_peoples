'use client';

import { CircleAlert, X } from 'lucide-react';
import { useId, useState } from 'react';
import { Input } from '@/components/ui/field';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { cn } from '@/lib/utils';
import type { ManagerOption } from '../filters';
import { fullName } from '../format';
import { useAsyncData } from '../hooks/use-async-data';
import { useEmployeesContext } from '../state/employees-context';

export interface ManagerPickerProps {
  label: string;
  value: ManagerOption | null;
  onChange: (value: ManagerOption | null) => void;
  /** Never offer this employee (an employee cannot manage themselves). */
  excludeId?: string;
  error?: string;
  helper?: string;
  placeholder?: string;
  searchDebounceMs?: number;
  /** Visually hide the label (it stays available to assistive tech), e.g. inside a toolbar. */
  hideLabel?: boolean;
  id?: string;
  containerClassName?: string;
}

/**
 * Searchable manager selector (ARIA 1.2 combobox with a listbox popup).
 * Keyboard: type to search, Down/Up to move, Enter to choose, Escape to close, Tab to leave.
 * Candidates come from the employee list endpoint (there is no dedicated "manager options" endpoint).
 */
export function ManagerPicker({
  label,
  value,
  onChange,
  excludeId,
  error,
  helper,
  placeholder = 'Search by name or employee number',
  searchDebounceMs = 250,
  hideLabel = false,
  id,
  containerClassName,
}: ManagerPickerProps) {
  const { service } = useEmployeesContext();
  const autoId = useId();
  const inputId = id ?? autoId;
  const listId = `${inputId}-list`;
  const errorId = `${inputId}-error`;
  const helperId = `${inputId}-helper`;

  const [text, setText] = useState(value?.label ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  // Keep the visible text in step when the selection is changed from outside (e.g. "Clear filters").
  const [seenValueId, setSeenValueId] = useState(value?.id ?? null);
  if ((value?.id ?? null) !== seenValueId) {
    setSeenValueId(value?.id ?? null);
    setText(value?.label ?? '');
  }

  const term = useDebouncedValue(text === value?.label ? '' : text.trim(), searchDebounceMs);
  const search = useAsyncData(
    `managers:${term}`,
    () => service.list({ q: term, limit: 8, status: ['ONBOARDING', 'ACTIVE', 'ON_LEAVE'] }),
    open,
  );
  const options: ManagerOption[] = (search.data?.data ?? [])
    .filter((e) => e.id !== excludeId)
    .map((e) => ({ id: e.id, label: `${fullName(e)} · ${e.employeeNumber}` }));

  const choose = (option: ManagerOption | null) => {
    onChange(option);
    setText(option?.label ?? '');
    setSeenValueId(option?.id ?? null);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) setOpen(true);
        else setActive((i) => Math.min(i + 1, options.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
        break;
      case 'Enter':
        if (open && active >= 0 && options[active]) {
          e.preventDefault(); // do not submit the surrounding form
          choose(options[active]!);
        }
        break;
      case 'Escape':
        if (open) {
          e.preventDefault();
          setOpen(false);
          setActive(-1);
        }
        break;
    }
  };

  const describedBy = [error ? errorId : null, helper ? helperId : null].filter(Boolean).join(' ');
  const activeId = open && active >= 0 ? `${listId}-opt-${active}` : undefined;
  const status =
    search.status === 'error'
      ? 'Could not load employees. Try again.'
      : search.status === 'loading'
        ? 'Searching…'
        : options.length === 0
          ? 'No matching employees'
          : null;

  return (
    <div className={cn('flex flex-col gap-1.5', containerClassName)}>
      <label
        htmlFor={inputId}
        className={cn('text-label font-medium text-ink', hideLabel && 'sr-only')}
      >
        {label}
      </label>
      <div className="relative">
        <Input
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-describedby={describedBy || undefined}
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          placeholder={placeholder}
          value={text}
          className={value ? 'pr-9' : undefined}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            setActive(-1);
            setText(value?.label ?? ''); // discard half-typed text that was never chosen
          }}
          onKeyDown={onKeyDown}
        />
        {value ? (
          <button
            type="button"
            aria-label={`Clear ${label.toLowerCase()}`}
            onClick={() => choose(null)}
            className="absolute right-1.5 top-1/2 inline-flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm text-muted transition-colors duration-[120ms] hover:text-ink"
          >
            <X className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        ) : null}
        {open ? (
          <ul
            id={listId}
            role="listbox"
            aria-label={`${label} suggestions`}
            // Keep focus in the input while the pointer picks an option.
            onMouseDown={(e) => e.preventDefault()}
            className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded-md border border-line bg-surface py-1 shadow-md"
          >
            {options.map((o, i) => (
              <li
                key={o.id}
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                onClick={() => choose(o)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'cursor-pointer px-3 py-2 text-body text-ink',
                  i === active && 'bg-hover',
                )}
              >
                {o.label}
              </li>
            ))}
            {status ? (
              <li role="presentation" className="px-3 py-2 text-small text-muted">
                {status}
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-small text-danger">
          <CircleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
          {error}
        </p>
      ) : null}
      {helper ? (
        <p id={helperId} className="text-small text-muted">
          {helper}
        </p>
      ) : null}
    </div>
  );
}
