'use client';

import { PanelLeftClose, PanelLeftOpen, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { cn } from '@/lib/utils';

export type SidebarProduct = 'people' | 'sales' | 'projects';

export interface SidebarItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Renders a link when set, otherwise a button (use onSelect). */
  href?: string;
  /** Count or short status shown on the right when expanded. */
  badge?: string | number;
}

export interface SidebarSection {
  heading?: string;
  items: SidebarItem[];
}

export interface SidebarProps {
  /** Product identity chip in the header. */
  product: { name: string; initial: string; kind?: SidebarProduct };
  sections: SidebarSection[];
  activeId?: string;
  onSelect?: (item: SidebarItem) => void;
  /** Controlled collapsed state. */
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Rendered at the bottom, above the collapse toggle (e.g. user chip). */
  footer?: React.ReactNode;
  /** Show the collapse/expand control. Hide it when collapse is automatic (tablet) or n/a (overlay). */
  showToggle?: boolean;
  className?: string;
}

const CHIP: Record<SidebarProduct, string> = {
  people: 'bg-product-people',
  sales: 'bg-product-sales',
  projects: 'bg-product-projects',
};

/** Dark navigation rail: 240px expanded, 64px collapsed. Dark in both themes. */
export function Sidebar({
  product,
  sections,
  activeId,
  onSelect,
  collapsed: collapsedProp,
  defaultCollapsed = false,
  onCollapsedChange,
  footer,
  showToggle = true,
  className,
}: SidebarProps) {
  const [inner, setInner] = useState(defaultCollapsed);
  const collapsed = collapsedProp ?? inner;

  function toggle() {
    const next = !collapsed;
    if (collapsedProp === undefined) setInner(next);
    onCollapsedChange?.(next);
  }

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        'flex h-full shrink-0 flex-col bg-sidebar text-on-sidebar transition-[width] duration-200 ease-out motion-reduce:transition-none',
        collapsed ? 'w-16' : 'w-60',
        className,
      )}
    >
      <div className={cn('flex h-14 items-center gap-3 px-[18px]', collapsed && 'justify-center px-0')}>
        <span
          aria-hidden
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md text-label font-semibold text-on-primary',
            CHIP[product.kind ?? 'people'],
          )}
        >
          {product.initial}
        </span>
        <span className={cn('truncate text-h3 font-semibold', collapsed && 'sr-only')}>
          {product.name}
        </span>
      </div>

      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 pb-3">
        {sections.map((section, i) => (
          <div key={section.heading ?? i} className={cn(i > 0 && 'mt-5')}>
            {section.heading ? (
              collapsed ? (
                <div aria-hidden className="mx-3 mb-2 h-px bg-sidebar-active" />
              ) : (
                <h2 className="mb-1 px-3 text-caption font-medium uppercase text-on-sidebar-muted">
                  {section.heading}
                </h2>
              )
            ) : null}
            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => (
                <li key={item.id}>
                  <NavItem
                    item={item}
                    active={item.id === activeId}
                    collapsed={collapsed}
                    onSelect={onSelect}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {footer ? <div className="px-3 pb-2">{footer}</div> : null}

      {showToggle ? (
      <div className="border-t border-sidebar-active p-3">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : undefined}
          className={cn(
            'flex h-9 w-full cursor-pointer items-center gap-3 rounded-md px-3 text-body text-on-sidebar-muted transition-colors duration-[120ms] hover:bg-sidebar-active hover:text-on-sidebar',
            collapsed && 'justify-center px-0',
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-[18px]" strokeWidth={1.75} aria-hidden />
          ) : (
            <>
              <PanelLeftClose className="size-[18px]" strokeWidth={1.75} aria-hidden />
              Collapse
            </>
          )}
        </button>
      </div>
      ) : null}
    </aside>
  );
}

function NavItem({
  item,
  active,
  collapsed,
  onSelect,
}: {
  item: SidebarItem;
  active: boolean;
  collapsed: boolean;
  onSelect?: (item: SidebarItem) => void;
}) {
  const Icon = item.icon;
  const className = cn(
    'flex h-9 w-full cursor-pointer items-center gap-3 rounded-md px-3 text-body transition-colors duration-[120ms]',
    active
      ? 'bg-sidebar-active font-medium text-on-sidebar'
      : 'text-on-sidebar hover:bg-sidebar-active/60',
    collapsed && 'justify-center px-0',
  );
  const content = (
    <>
      <Icon className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
      <span className={cn('flex-1 truncate text-left', collapsed && 'sr-only')}>{item.label}</span>
      {item.badge !== undefined && !collapsed ? (
        <span className="gs-num text-label font-normal text-on-sidebar-muted">{item.badge}</span>
      ) : null}
    </>
  );
  const shared = {
    className,
    title: collapsed ? item.label : undefined,
    'aria-current': active ? ('page' as const) : undefined,
  };

  if (item.href) {
    return (
      <Link href={item.href} onClick={() => onSelect?.(item)} {...shared}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={() => onSelect?.(item)} {...shared}>
      {content}
    </button>
  );
}
