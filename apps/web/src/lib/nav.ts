import type { PermissionCode } from '@kavach/shared';

/**
 * Left navigation (PRD §20.2, §20.3). The permission matrices in PRD §3 decide what appears
 * (DECISIONS Q30). Hiding a link is convenience only: the API enforces every permission.
 */
export interface NavItem {
  label: string;
  href: string;
  /** Shown when the member holds any of these. */
  anyOf: PermissionCode[];
  /** Set for modules of later phases: listed, but not yet available. */
  phase?: 2 | 3 | 5;
  group: 'Daily work' | 'Inventory' | 'Setup' | 'Oversight';
}

export const NAV: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    anyOf: ['dashboard:view_full', 'dashboard:view_operational'],
    group: 'Daily work',
  },
  {
    label: 'Material In',
    href: '/material-in',
    anyOf: ['material_in:view'],
    group: 'Daily work',
  },
  {
    label: 'Material Out',
    href: '/material-out',
    anyOf: ['material_out:view'],
    group: 'Daily work',
  },
  {
    label: 'Return Material',
    href: '/material-return',
    anyOf: ['material_return:view'],
    group: 'Daily work',
  },

  { label: 'Material Master', href: '/materials', anyOf: ['material:view'], group: 'Inventory' },
  { label: 'Current Stock', href: '/stock', anyOf: ['stock:view'], group: 'Inventory' },
  {
    label: 'Stock Verification',
    href: '/stock-verification',
    anyOf: ['stock_verification:submit', 'stock_verification:review'],
    group: 'Inventory',
  },
  {
    label: 'Transactions',
    href: '/transactions',
    anyOf: ['transaction:view'],
    group: 'Inventory',
  },
  {
    label: 'Reports',
    href: '/reports',
    anyOf: ['report:view_all', 'report:view_operational'],
    group: 'Inventory',
  },

  { label: 'Categories', href: '/categories', anyOf: ['category:manage'], group: 'Setup' },
  { label: 'Units', href: '/units', anyOf: ['unit:manage'], group: 'Setup' },
  { label: 'Locations', href: '/locations', anyOf: ['location:manage'], group: 'Setup' },
  { label: 'Stores', href: '/stores', anyOf: ['store:manage'], group: 'Setup' },
  { label: 'Contractors', href: '/contractors', anyOf: ['contractor:manage'], group: 'Setup' },
  { label: 'Suppliers', href: '/suppliers', anyOf: ['supplier:manage'], group: 'Setup' },
  { label: 'User Management', href: '/users', anyOf: ['user:manage'], group: 'Setup' },
  { label: 'Settings', href: '/settings', anyOf: ['settings:manage'], group: 'Setup' },

  {
    label: 'AI Processing',
    href: '/ai-processing',
    anyOf: ['ai_log:view_all', 'ai_log:view_own'],
    group: 'Oversight',
  },
  { label: 'Audit Logs', href: '/audit-logs', anyOf: ['audit_log:view'], group: 'Oversight' },
];

export function navFor(permissions: readonly PermissionCode[]): NavItem[] {
  const held = new Set(permissions);
  return NAV.filter((item) => item.anyOf.some((p) => held.has(p)));
}

/** May this member open `pathname`? Used to keep people off pages their role has no use for. */
export function canOpen(pathname: string, permissions: readonly PermissionCode[]): boolean {
  const item = NAV.find((n) => pathname === n.href || pathname.startsWith(n.href + '/'));
  if (!item) return true;
  return !item.phase && navFor(permissions).includes(item);
}
