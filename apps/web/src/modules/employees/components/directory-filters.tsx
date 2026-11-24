'use client';

import type { EmploymentStatus, EmploymentType } from '@gsc/contracts';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FilterMultiSelect } from '@/components/shared/filter-multi-select';
import { FilterSelect, ListToolbar } from '@/components/shared/list-toolbar';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { EMPTY_FILTERS, hasActiveFilters, type DirectoryFilters } from '../filters';
import { STATUS_LABEL, TYPE_LABEL } from '../format';
import { useDepartments } from '../hooks/use-employees';
import { useEmployeesContext } from '../state/employees-context';
import { ManagerPicker } from './manager-picker';

const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as EmploymentStatus[]).map((value) => ({
  value,
  label: STATUS_LABEL[value],
}));
const TYPE_OPTIONS = (Object.keys(TYPE_LABEL) as EmploymentType[]).map((value) => ({
  value,
  label: TYPE_LABEL[value],
}));

export interface DirectoryFiltersProps {
  value: DirectoryFilters;
  onChange: (next: DirectoryFilters) => void;
  /** Delay before typing in the search box updates the results. */
  searchDebounceMs?: number;
  /** The one primary action (e.g. "Add employee"), rendered right-most by the shared toolbar. */
  primary?: React.ReactNode;
}

/** Search + filters on the shared ListToolbar (order: search, filters, primary action). */
export function DirectoryFiltersBar({
  value,
  onChange,
  searchDebounceMs = 300,
  primary,
}: DirectoryFiltersProps) {
  const { caps } = useEmployeesContext();
  const departments = useDepartments();

  // Search text is local so typing feels instant; the committed filter follows after a pause.
  // The parent only RESETS it (clear filters / back to an unfiltered URL). Copying every parent
  // change back would overwrite characters typed since the last debounce.
  const [text, setText] = useState(value.q);
  const [seenQ, setSeenQ] = useState(value.q);
  if (value.q !== seenQ) {
    setSeenQ(value.q);
    if (value.q === '') setText('');
  }
  const debounced = useDebouncedValue(text, searchDebounceMs);
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  });
  useEffect(() => {
    const { value: v, onChange: change } = latest.current;
    if (debounced.trim() !== v.q.trim()) change({ ...v, q: debounced });
  }, [debounced]);

  const set = (patch: Partial<DirectoryFilters>) => onChange({ ...value, ...patch });

  return (
    <ListToolbar
      label="Employee filters"
      search={{
        value: text,
        onChange: setText,
        label: 'Search employees',
        placeholder: 'Search by name, employee number or work email',
      }}
      filters={
        <>
          <FilterMultiSelect
            label="Status"
            allLabel="All statuses"
            value={value.status}
            options={STATUS_OPTIONS}
            onChange={(status) => set({ status })}
          />
          <FilterMultiSelect
            label="Employment type"
            allLabel="All types"
            value={value.employmentType}
            options={TYPE_OPTIONS}
            onChange={(employmentType) => set({ employmentType })}
          />
          {caps.canUseOrgFilters ? (
            <>
              <FilterSelect
                label="Department"
                allLabel="All departments"
                value={value.departmentId}
                options={(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
                disabled={departments.status === 'loading' || departments.status === 'error'}
                onChange={(departmentId) => set({ departmentId })}
              />
              <ManagerPicker
                label="Manager"
                hideLabel
                placeholder="Any manager"
                value={value.manager}
                onChange={(manager) => set({ manager })}
                containerClassName="min-w-[220px]"
              />
            </>
          ) : null}
          {hasActiveFilters(value) ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<X />}
              onClick={() => {
                setText('');
                onChange(EMPTY_FILTERS);
              }}
            >
              Clear filters
            </Button>
          ) : null}
        </>
      }
      primary={primary}
    />
  );
}
