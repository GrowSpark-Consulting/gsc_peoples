import {
  Building2,
  CalendarCheck,
  CalendarDays,
  ChartColumn,
  FileText,
  LayoutDashboard,
  Settings,
  UserPlus,
  Users,
} from 'lucide-react';
import type { SidebarItem, SidebarSection } from '@/components/layout/sidebar';

export const NAV_ITEMS: SidebarItem[] = [
  { id: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { id: 'employees', label: 'Employees', href: '/employees', icon: Users },
  { id: 'departments', label: 'Departments', href: '/departments', icon: Building2 },
  { id: 'attendance', label: 'Attendance', href: '/attendance', icon: CalendarCheck },
  { id: 'leave', label: 'Leave', href: '/leave', icon: CalendarDays },
  { id: 'onboarding', label: 'Onboarding', href: '/onboarding', icon: UserPlus },
  { id: 'documents', label: 'Documents', href: '/documents', icon: FileText },
  { id: 'reports', label: 'Reports', href: '/reports', icon: ChartColumn },
  { id: 'settings', label: 'Settings', href: '/settings', icon: Settings },
];

const byId = (...ids: string[]) => NAV_ITEMS.filter((i) => ids.includes(i.id));

export const NAV_SECTIONS: SidebarSection[] = [
  { items: byId('dashboard', 'employees', 'departments', 'attendance', 'leave', 'onboarding', 'documents') },
  { heading: 'Insights', items: byId('reports') },
  { heading: 'Workspace', items: byId('settings') },
];

export function findNavItem(pathname: string): SidebarItem | undefined {
  return NAV_ITEMS.find(
    (i) => i.href && (pathname === i.href || pathname.startsWith(`${i.href}/`)),
  );
}

/** Pages that exist but have no sidebar entry (reached from the top bar). */
const UNLISTED_TITLES: ReadonlyArray<readonly [string, string]> = [['/profile', 'My profile']];

/** Top-bar title for a path: the sidebar label, else an unlisted page's title, else the product name. */
export function titleFor(pathname: string): string {
  const listed = findNavItem(pathname)?.label;
  if (listed) return listed;
  const unlisted = UNLISTED_TITLES.find(([href]) => pathname === href || pathname.startsWith(`${href}/`));
  return unlisted?.[1] ?? 'GSC Peoples';
}
