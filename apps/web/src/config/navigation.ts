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
import { PERMISSIONS, type Permission } from '@gsc/contracts';
import type { SidebarItem, SidebarSection } from '@/components/layout/sidebar';

export interface NavItemConfig extends SidebarItem {
  /** If set, the caller must hold at least one of these permissions to see the link. */
  anyPermission?: readonly Permission[];
}

export const NAV_ITEMS: NavItemConfig[] = [
  { id: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { id: 'employees', label: 'Employees', href: '/employees', icon: Users },
  { id: 'departments', label: 'Departments', href: '/departments', icon: Building2, anyPermission: [PERMISSIONS.ORGANIZATION_READ, PERMISSIONS.ORG_READ] },
  { id: 'attendance', label: 'Attendance', href: '/attendance', icon: CalendarCheck, anyPermission: [PERMISSIONS.ATTENDANCE_CHECK, PERMISSIONS.ATTENDANCE_READ_ALL, PERMISSIONS.ATTENDANCE_READ_TEAM, PERMISSIONS.ATTENDANCE_READ_SELF] },
  { id: 'leave', label: 'Leave', href: '/leave', icon: CalendarDays, anyPermission: [PERMISSIONS.LEAVE_READ_ALL, PERMISSIONS.LEAVE_READ_TEAM, PERMISSIONS.LEAVE_READ_SELF] },
  { id: 'onboarding', label: 'Onboarding', href: '/onboarding', icon: UserPlus, anyPermission: [PERMISSIONS.ONBOARDING_READ_ALL, PERMISSIONS.ONBOARDING_READ_SELF] },
  { id: 'documents', label: 'Documents', href: '/documents', icon: FileText, anyPermission: [PERMISSIONS.DOCUMENT_READ_ALL, PERMISSIONS.DOCUMENT_READ_TEAM, PERMISSIONS.DOCUMENT_READ_SELF] },
  { id: 'reports', label: 'Reports', href: '/reports', icon: ChartColumn, anyPermission: [PERMISSIONS.ATTENDANCE_REPORT] },
  { id: 'settings', label: 'Settings', href: '/settings', icon: Settings, anyPermission: [PERMISSIONS.SETTINGS_READ, PERMISSIONS.USER_ACCOUNT_READ, PERMISSIONS.AUDIT_READ] },
];

const byId = (...ids: string[]) => NAV_ITEMS.filter((i) => ids.includes(i.id));

export const NAV_SECTIONS: SidebarSection[] = [
  { items: byId('dashboard', 'employees', 'departments', 'attendance', 'leave', 'onboarding', 'documents') },
  { heading: 'Insights', items: byId('reports') },
  { heading: 'Workspace', items: byId('settings') },
];

export function visibleNavSections(permissions?: readonly string[]): SidebarSection[] {
  if (!permissions) return NAV_SECTIONS;
  const allow = (item: SidebarItem) => {
    const req = (item as NavItemConfig).anyPermission;
    return !req || req.some((p) => permissions.includes(p));
  };
  return NAV_SECTIONS.map((s) => ({ ...s, items: s.items.filter(allow) })).filter((s) => s.items.length > 0);
}

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
