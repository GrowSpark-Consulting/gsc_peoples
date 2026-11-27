'use client';

import { useId } from 'react';
import { useModalBehavior } from '@/hooks/use-modal-behavior';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** Action buttons, right-aligned. Put the primary action last. */
  footer?: React.ReactNode;
  children?: React.ReactNode;
}

/** Centered modal for short, focused decisions (e.g. change status, confirm). Stacks above a Drawer. */
export function Dialog({ open, onClose, title, description, footer, children }: DialogProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useModalBehavior<HTMLDivElement>({ open, onClose });
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <div
        data-testid="dialog-backdrop"
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
        className="relative max-h-[calc(100dvh-2rem)] w-full max-w-md animate-in overflow-y-auto overscroll-contain rounded-lg border border-line bg-surface p-5 shadow-lg outline-none duration-200 fade-in zoom-in-95 sm:p-6"
      >
        <h2 id={titleId} className="text-h3 font-semibold text-ink">
          {title}
        </h2>
        {description ? (
          <p id={descId} className="mt-1 text-small text-muted">
            {description}
          </p>
        ) : null}
        {children ? <div className="mt-4">{children}</div> : null}
        {footer ? (
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:flex-wrap sm:justify-end [&>*]:max-sm:w-full">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
