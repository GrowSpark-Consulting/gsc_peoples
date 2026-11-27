'use client';

import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface MobileNavProps {
  id: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Modal overlay menu for < 1024px. Provides: backdrop + Escape dismissal, focus moved into the
 * panel on open, Tab focus trap, focus restored to the opener on close, and body scroll lock.
 */
export function MobileNav({ id, open, onClose, children }: MobileNavProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the active nav link if present, otherwise the close button.
    const panel = panelRef.current;
    const target =
      panel?.querySelector<HTMLElement>('[aria-current="page"]') ??
      panel?.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panelRef.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] lg:hidden">
      <div
        data-testid="mobile-nav-backdrop"
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 animate-in bg-ink/40 duration-200 fade-in"
      />
      <div
        ref={panelRef}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className="absolute inset-y-0 left-0 w-60 max-w-[85vw] animate-in shadow-lg duration-200 ease-out slide-in-from-left"
      >
        <div className="h-full">{children}</div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close navigation menu"
          onClick={onClose}
          className="absolute right-2 top-2.5 size-9 text-on-sidebar-muted hover:bg-sidebar-active hover:text-on-sidebar focus-visible:outline-sidebar-indicator pointer-coarse:top-1.5 pointer-coarse:size-11"
        >
          <X strokeWidth={1.75} />
        </Button>
      </div>
    </div>
  );
}
