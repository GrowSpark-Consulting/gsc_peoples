'use client';

import { usePathname } from 'next/navigation';
import { useId, useRef, useState, useSyncExternalStore } from 'react';
import { ThemeToggle } from '@/components/shared/theme-toggle';
import { visibleNavSections, findNavItem, titleFor } from '@/config/navigation';
import { useSession } from '@/hooks/use-session';
import { useShellMode } from '@/hooks/use-shell-mode';
import {
  readSidebarCollapsed,
  subscribeSidebarCollapsed,
  writeSidebarCollapsed,
} from '@/lib/sidebar-preference';
import { MobileNav } from './mobile-nav';
import { Sidebar } from './sidebar';
import { TopBar } from './top-bar';

const PRODUCT = { name: 'Grow Spark People', initial: 'P' } as const;

/**
 * Responsive application shell.
 *  >= 1280px  expanded 240px sidebar (user can collapse to 64px)
 *  1024-1279  sidebar auto-collapsed to 64px
 *  < 1024px   sidebar hidden; hamburger opens an overlay menu
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const mode = useShellMode();
  const sessionState = useSession();
  const navSections = visibleNavSections(
    sessionState.status === 'ready' ? sessionState.session.permissions : undefined,
  );
  const menuId = useId();
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Persisted desktop preference (localStorage). Server render and first paint assume expanded.
  const userCollapsed = useSyncExternalStore(
    subscribeSidebarCollapsed,
    readSidebarCollapsed,
    () => false,
  );
  const [menuOpenState, setMenuOpen] = useState(false);
  const [menuPath, setMenuPath] = useState(pathname);

  // Derived-state resets (React-approved "adjust state while rendering" pattern):
  // close the overlay when leaving mobile or after navigating.
  if (menuOpenState && (mode !== 'mobile' || menuPath !== pathname)) {
    setMenuOpen(false);
  }
  if (menuPath !== pathname) setMenuPath(pathname);
  const menuOpen = menuOpenState && mode === 'mobile';

  const active = findNavItem(pathname);
  const collapsed = mode === 'tablet' || (mode === 'desktop' && userCollapsed);

  return (
    <div className="min-h-dvh lg:flex">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[500] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-body focus:text-ink focus:shadow-md"
      >
        Skip to main content
      </a>

      <div className="sticky top-0 hidden h-dvh shrink-0 lg:block">
        <Sidebar
          product={PRODUCT}
          sections={navSections}
          activeId={active?.id}
          collapsed={collapsed}
          onCollapsedChange={writeSidebarCollapsed}
          showToggle={mode === 'desktop'}
        />
      </div>

      <MobileNav id={menuId} open={menuOpen} onClose={() => setMenuOpen(false)}>
        <Sidebar
          product={PRODUCT}
          sections={navSections}
          activeId={active?.id}
          collapsed={false}
          showToggle={false}
          onSelect={() => setMenuOpen(false)}
          footer={
            <div className="flex flex-col gap-2">
              <span className="px-3 text-caption font-medium text-on-sidebar-muted">Theme</span>
              <ThemeToggle className="self-start" />
            </div>
          }
        />
      </MobileNav>

      <div className="min-w-0 flex-1">
        <TopBar
          title={titleFor(pathname)}
          showMenuButton={mode === 'mobile'}
          menuOpen={menuOpen}
          menuControlsId={menuId}
          onMenuClick={() => setMenuOpen(true)}
          menuButtonRef={menuButtonRef}
        />
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1440px] px-4 py-5 outline-none sm:px-6 lg:p-6"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
