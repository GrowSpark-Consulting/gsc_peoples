'use client';

import { notificationListResponseSchema, type notificationSchema } from '@gsc/contracts';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { z } from 'zod';
import { buttonVariants } from '@/components/ui/button';
import { Button } from '@/components/ui/button';
import { apiRequest, describeApiError } from '@/lib/api-client';
import { demoModeEnabled } from '@/lib/dev-auth/config';
import { cn } from '@/lib/utils';
import { formatTimestamp } from '@/modules/employees/format';

type Notification = z.infer<typeof notificationSchema>;
type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: Notification[]; unread: number };

const load = () =>
  apiRequest('/notifications', { query: { page: 1, pageSize: 10 }, schema: notificationListResponseSchema });

/** Only same-site paths are followed; anything else is shown as plain text. */
export const safeLink = (link: string | null | undefined): string | null =>
  link && link.startsWith('/') && !link.startsWith('//') ? link : null;

/**
 * Top-bar notifications (NOTIF-001): list of the caller's own notifications, unread badge, mark one or all as read.
 * The API returns only the signed-in user's notifications; this component never selects a recipient.
 */
export function NotificationsMenu() {
  const demo = demoModeEnabled({
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_EMPLOYEES_ADAPTER: process.env.NEXT_PUBLIC_EMPLOYEES_ADAPTER,
  });
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ status: 'loading' });
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const refresh = useCallback(async () => {
    try {
      const r = await load();
      setState({ status: 'ready', items: r.data, unread: r.unreadCount });
    } catch (e) {
      setState({ status: 'error', message: describeApiError(e) });
    }
  }, []);

  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    load().then(
      (r) => !cancelled && setState({ status: 'ready', items: r.data, unread: r.unreadCount }),
      (e: unknown) => !cancelled && setState({ status: 'error', message: describeApiError(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [demo]);

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

  const unread = state.status === 'ready' ? state.unread : 0;
  const [busy, setBusy] = useState(false);

  async function markRead(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      await apiRequest(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
      await refresh();
    } catch (e) {
      setState({ status: 'error', message: describeApiError(e) });
    } finally {
      setBusy(false);
    }
  }
  async function markAllRead() {
    if (busy) return;
    setBusy(true);
    try {
      await apiRequest('/notifications/read-all', { method: 'PATCH' });
      await refresh();
    } catch (e) {
      setState({ status: 'error', message: describeApiError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen((o) => !o);
          if (!open && !demo) void refresh();
        }}
        className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'relative')}
      >
        <Bell className="size-[18px]" strokeWidth={1.75} aria-hidden />
        {unread > 0 ? (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-caption font-medium text-on-primary"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Notifications"
          className="fixed inset-x-4 top-16 z-[100] max-h-[calc(100dvh-5rem)] overflow-y-auto rounded-lg border border-line bg-surface p-4 shadow-md sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-none sm:w-80 sm:max-w-[calc(100vw-2rem)] sm:overflow-visible"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-body font-medium text-ink">Notifications</p>
            {unread > 0 ? (
              <Button size="sm" variant="ghost" onClick={markAllRead} disabled={busy}>
                Mark all as read
              </Button>
            ) : null}
          </div>
          <div className="mt-2">
            {demo ? (
              <p className="text-small text-muted">Notifications need the API and are off in demo mode.</p>
            ) : state.status === 'loading' ? (
              <p role="status" className="text-small text-muted">
                Loading
              </p>
            ) : state.status === 'error' ? (
              <div role="alert" className="flex flex-col items-start gap-2">
                <p className="text-small text-danger">{state.message}</p>
                <Button size="sm" variant="secondary" onClick={refresh}>
                  Try again
                </Button>
              </div>
            ) : state.items.length === 0 ? (
              <p className="text-small text-muted">You are all caught up.</p>
            ) : (
              <ul className="max-h-80 divide-y divide-line overflow-y-auto">
                {state.items.map((n) => {
                  const href = safeLink(n.link);
                  return (
                    <li key={n.id} className="flex items-start justify-between gap-2 py-2.5">
                      <div className="min-w-0">
                        {href ? (
                          <Link
                            href={href}
                            onClick={() => {
                              if (!n.isRead) void markRead(n.id);
                              setOpen(false);
                            }}
                            className={cn('text-body underline', n.isRead ? 'text-muted' : 'font-medium text-ink')}
                          >
                            {n.title}
                          </Link>
                        ) : (
                          <p className={cn('text-body', n.isRead ? 'text-muted' : 'font-medium text-ink')}>{n.title}</p>
                        )}
                        {n.message ? <p className="text-small text-muted">{n.message}</p> : null}
                        <p className="text-caption text-muted">
                          {formatTimestamp(n.createdAt)}
                          {n.isRead ? '' : ' · Unread'}
                        </p>
                      </div>
                      {!n.isRead ? (
                        <Button size="sm" variant="ghost" onClick={() => markRead(n.id)} disabled={busy}>
                          Mark read
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
