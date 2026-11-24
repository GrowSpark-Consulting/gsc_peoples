'use client';

import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import {
  readPreference,
  setPreference,
  subscribePreference,
  type ThemePreference,
} from '@/lib/theme';
import { cn } from '@/lib/utils';

const OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export function ThemeToggle({ className }: { className?: string }) {
  const pref = useSyncExternalStore(subscribePreference, readPreference, () => 'system' as const);

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn('inline-flex rounded-md border border-line-strong bg-surface p-0.5', className)}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const checked = pref === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={label}
            onClick={() => setPreference(value)}
            className={cn(
              'inline-flex h-[30px] items-center gap-1.5 rounded-sm px-2 text-label sm:px-2.5 font-medium transition-colors duration-[120ms]',
              checked ? 'bg-primary text-on-primary' : 'text-ink hover:bg-hover',
            )}
          >
            <Icon className="size-4" strokeWidth={1.75} aria-hidden />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
