'use client';

import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function isVisible(el: HTMLElement): boolean {
  if (el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

/* Shared across every open modal surface (drawer, dialog) so stacking works:
   only the top-most one reacts to Escape/Tab, and the body is unlocked only when the last closes. */
const stack: symbol[] = [];
let lockCount = 0;
let savedOverflow = '';

function lockScroll() {
  if (lockCount++ === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
}
function unlockScroll() {
  if (--lockCount === 0) document.body.style.overflow = savedOverflow;
}

export interface ModalBehaviorOptions {
  open: boolean;
  onClose: () => void;
  /** Element that receives focus on open. Defaults to the first focusable element in the panel. */
  initialFocus?: () => HTMLElement | null | undefined;
}

/**
 * Accessible modal behaviour for drawers and dialogs: Escape closes (top-most only), Tab is trapped
 * inside the panel, body scroll is locked, focus moves in on open and returns to the opener on close.
 */
export function useModalBehavior<T extends HTMLElement>({ open, onClose, initialFocus }: ModalBehaviorOptions) {
  const panelRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  const initialFocusRef = useRef(initialFocus);
  useEffect(() => {
    onCloseRef.current = onClose;
    initialFocusRef.current = initialFocus;
  });

  useEffect(() => {
    if (!open) return;
    const id = Symbol('modal');
    stack.push(id);
    const opener = document.activeElement as HTMLElement | null;
    lockScroll();

    const panel = panelRef.current;
    const target = initialFocusRef.current?.() ?? panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
    target?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (stack[stack.length - 1] !== id) return;
      const root = panelRef.current;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      stack.splice(stack.indexOf(id), 1);
      unlockScroll();
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);

  return panelRef;
}
