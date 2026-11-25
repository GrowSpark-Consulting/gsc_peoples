'use client';

import { Building2, ChevronDown, LogOut, Menu } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ThemeToggle } from '@/components/shared/theme-toggle';
import { Avatar } from '@/components/ui/avatar';
import { buttonVariants } from '@/components/ui/button';
import { useCurrentUser } from '@/hooks/use-current-user';
import { ROLE_LABELS } from '@/lib/role-labels';
import { cn } from '@/lib/utils';
import { NotificationsMenu } from '@/modules/notifications/notifications-menu';
import { PlaceholderMenu } from './placeholder-menu';

export interface TopBarProps {
  title: string;
  /** Shows the hamburger (< 1024px). */
  showMenuButton: boolean;
  menuOpen: boolean;
  menuControlsId: string;
  onMenuClick: () => void;
  menuButtonRef: React.Ref<HTMLButtonElement>;
}

/** 56px top bar. Company switcher, notifications and user menu are marked placeholders. */
export function TopBar({
  title,
  showMenuButton,
  menuOpen,
  menuControlsId,
  onMenuClick,
  menuButtonRef,
}: TopBarProps) {
  const router = useRouter();
  const me = useCurrentUser();
  const who = me ? `${me.displayName} · ${ROLE_LABELS[me.roleKey]}` : null;
  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b border-line bg-surface px-4 sm:gap-3 sm:px-6">
      {showMenuButton ? (
        <button
          ref={menuButtonRef}
          type="button"
          aria-label="Open navigation menu"
          aria-expanded={menuOpen}
          aria-controls={menuControlsId}
          aria-haspopup="dialog"
          onClick={onMenuClick}
          className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), '-ml-2')}
        >
          <Menu className="size-[18px]" strokeWidth={1.75} aria-hidden />
        </button>
      ) : null}

      <h1 className="min-w-0 flex-1 truncate text-h1 font-semibold text-ink">{title}</h1>

      <PlaceholderMenu
        label="Company switcher"
        title="Company switcher"
        description="Switching between companies is not connected yet. It will appear here once multi-company access is built."
        triggerClassName={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'max-md:px-2')}
        trigger={
          <>
            <Building2 aria-hidden strokeWidth={1.75} />
            <span className="max-md:hidden">Company</span>
            <ChevronDown aria-hidden strokeWidth={1.75} className="max-md:hidden" />
          </>
        }
      />

      <NotificationsMenu />

      <ThemeToggle className="max-sm:hidden" />

      <button
        type="button"
        aria-label="Sign out"
        title="Sign out"
        onClick={async () => {
          const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
          const csrf = document.cookie.split('; ').find((row) => row.startsWith('gsc_csrf='))?.slice('gsc_csrf='.length) ?? '';
          await fetch(`${api}/auth/logout`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'X-CSRF-Token': csrf },
          }).catch(() => undefined);
          router.replace('/login');
          router.refresh();
        }}
        className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'rounded-full')}
      >
        <LogOut className="size-[18px]" strokeWidth={1.75} aria-hidden />
      </button>
      <Link
        href="/profile"
        title={who ?? 'Your profile'}
        aria-label={who ? `Your profile: ${who}` : 'Your profile'}
        className="shrink-0 rounded-full"
      >
        <Avatar name={me?.displayName ?? 'Account'} size="lg" />
      </Link>
    </header>
  );
}
