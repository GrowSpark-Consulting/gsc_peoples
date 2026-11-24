'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface PlaceholderMenuProps {
  /** Trigger content. Render it inside the provided button via children. */
  trigger: React.ReactNode;
  /** Accessible name of the trigger button. */
  label: string;
  /** Heading inside the popover. */
  title: string;
  /** What will live here later. */
  description: string;
  triggerClassName?: string;
  align?: 'left' | 'right';
}

/**
 * A clearly marked placeholder interaction: opens a small popover labelled "Placeholder"
 * explaining that the feature is not connected yet. Escape and outside click close it.
 */
export function PlaceholderMenu({
  trigger,
  label,
  title,
  description,
  triggerClassName,
  align = 'right',
}: PlaceholderMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={title}
          className={cn(
            'absolute top-full z-[100] mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface p-4 shadow-md',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          <Badge variant="neutral">Placeholder</Badge>
          <p className="mt-2 text-body font-medium text-ink">{title}</p>
          <p className="mt-1 text-small text-muted">{description}</p>
        </div>
      ) : null}
    </div>
  );
}
