'use client';

import { X } from 'lucide-react';
import { useId } from 'react';
import { useModalBehavior } from '@/hooks/use-modal-behavior';
import { cn } from '@/lib/utils';
import { Button } from './button';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** Extra content on the right of the header (e.g. a status badge). */
  headerExtra?: React.ReactNode;
  /** Sticky footer, usually form actions. */
  footer?: React.ReactNode;
  /** Design system: 480-640px. */
  size?: 'md' | 'lg';
  children: React.ReactNode;
}

/**
 * Right-side drawer for record details and forms (design system section 5): the list stays visible
 * behind it. Escape and backdrop close it; focus is trapped and restored; body scroll is locked.
 */
export function Drawer({ open, onClose, title, description, headerExtra, footer, size = 'md', children }: DrawerProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useModalBehavior<HTMLDivElement>({ open, onClose });
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200]">
      <div
        data-testid="drawer-backdrop"
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 animate-in bg-ink/40 duration-200 fade-in"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          'absolute inset-y-0 right-0 flex w-full animate-in flex-col bg-surface shadow-lg outline-none duration-200 ease-out slide-in-from-right',
          size === 'md' ? 'max-w-[520px]' : 'max-w-[640px]',
        )}
      >
        <header className="flex items-start gap-3 border-b border-line px-4 py-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-h2 font-semibold text-ink">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-0.5 text-small text-muted">
                {description}
              </p>
            ) : null}
          </div>
          {headerExtra}
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose} className="-mr-2 size-8 pointer-coarse:size-11">
            <X strokeWidth={1.75} />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">{children}</div>
        {footer ? (
          <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
