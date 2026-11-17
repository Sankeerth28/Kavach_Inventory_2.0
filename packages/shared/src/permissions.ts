/**
 * Permission codes and the fixed role → permission map (PRD §3.1, §3.2; ARCHITECTURE §6.2).
 * The backend checks this map on every request. The `roles`, `permissions` and `role_permissions`
 * tables mirror it. Roles are not editable in the MVP (DECISIONS Q19).
 */
export const ROLE_CODES = ['PROJECT_ADMIN', 'STORE_MANAGER'] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export const ROLE_NAMES: Record<RoleCode, string> = {
  PROJECT_ADMIN: 'Project Admin',
  STORE_MANAGER: 'Store Manager',
};

const PA: readonly RoleCode[] = ['PROJECT_ADMIN'];
const SM: readonly RoleCode[] = ['STORE_MANAGER'];
const BOTH: readonly RoleCode[] = ['PROJECT_ADMIN', 'STORE_MANAGER'];

interface PermissionDef {
  module: string;
  description: string;
  roles: readonly RoleCode[];
}

/** Every permission the system knows. Codes for later phases are defined now so the matrix is whole. */
export const PERMISSION_DEFS = {
  'dashboard:view_full': { module: 'Dashboard', description: 'Full dashboard', roles: PA },
  'dashboard:view_operational': {
    module: 'Dashboard',
    description: 'Operational dashboard',
    roles: SM,
  },

  'project:view': { module: 'Settings', description: 'View project details', roles: BOTH },
  'settings:manage': { module: 'Settings', description: 'Manage project settings', roles: PA },
  'store:view': { module: 'Stores', description: 'View stores', roles: BOTH },
  'store:manage': { module: 'Stores', description: 'Create and edit stores', roles: PA },
  'location:view': { module: 'Location Management', description: 'View locations', roles: BOTH },
  'location:manage': {
    module: 'Location Management',
    description: 'Create and edit locations',
    roles: PA,
  },
  'category:view': { module: 'Category Management', description: 'View categories', roles: BOTH },
  'category:manage': {
    module: 'Category Management',
    description: 'Create and edit categories',
    roles: PA,
  },
  'unit:view': { module: 'Unit Master', description: 'View units and conversions', roles: BOTH },
  'unit:manage': {
    module: 'Unit Master',
    description: 'Create units and approve conversions',
    roles: PA,
  },

  'material:view': { module: 'Material Master', description: 'View materials', roles: BOTH },
  'material:create': {
    module: 'Material Master',
    description: 'Create a material manually (PRD §6.4 method A)',
    roles: PA,
  },
  'material:create_via_receipt': {
    module: 'Material Master',
    description: 'Create a material during Material In (PRD §3.3)',
    roles: SM,
  },
  'material:update': { module: 'Material Master', description: 'Edit a material', roles: PA },
  'material:deactivate': {
    module: 'Material Master',
    description: 'Deactivate or reactivate a material',
    roles: PA,
  },

  'material_in:view': { module: 'Material In', description: 'View receipts', roles: BOTH },
  'material_in:create': { module: 'Material In', description: 'Receive materials', roles: SM },
  'material_out:view': { module: 'Material Out', description: 'View issues', roles: BOTH },
  'material_out:create': { module: 'Material Out', description: 'Issue materials', roles: SM },
  'material_return:view': { module: 'Material Return', description: 'View returns', roles: BOTH },
  'material_return:create': {
    module: 'Material Return',
    description: 'Record returns',
    roles: SM,
  },

  'contractor:view': { module: 'Contractors', description: 'View contractors', roles: BOTH },
  'contractor:create': {
    module: 'Contractors',
    description: 'Add a contractor, also inline while issuing (DECISIONS Q31)',
    roles: BOTH,
  },
  'contractor:manage': {
    module: 'Contractors',
    description: 'Edit, merge and deactivate contractors',
    roles: PA,
  },

  'stock:reconcile': {
    module: 'Current Stock',
    description: 'Check stock balances against the ledger',
    roles: PA,
  },
  'stock:view': { module: 'Current Stock', description: 'View current stock', roles: BOTH },
  'stock_verification:submit': {
    module: 'Stock Verification',
    description: 'Submit a physical count',
    roles: SM,
  },
  'stock_verification:review': {
    module: 'Stock Verification',
    description: 'Approve or reject a physical count',
    roles: PA,
  },
  'stock_adjustment:create': {
    module: 'Stock Adjustment',
    description: 'Adjust stock and dispose of damaged stock',
    roles: PA,
  },

  'transaction:view': { module: 'Transactions', description: 'View transactions', roles: BOTH },
  'transaction:reverse': {
    module: 'Transactions',
    description: 'Reverse a posted transaction',
    roles: PA,
  },
  'invoice:duplicate_override': {
    module: 'Material In',
    description: 'Authorise a duplicate invoice',
    roles: PA,
  },

  'report:view_all': { module: 'Reports', description: 'All reports', roles: PA },
  'report:view_operational': { module: 'Reports', description: 'Operational reports', roles: SM },
  'report:export': { module: 'Reports', description: 'Export reports', roles: BOTH },

  'user:manage': { module: 'User Management', description: 'Manage users', roles: PA },

  'supplier:view': { module: 'Suppliers', description: 'View suppliers', roles: BOTH },
  'supplier:manage': { module: 'Suppliers', description: 'Manage suppliers', roles: PA },
  'supplier:create_via_receipt': {
    module: 'Suppliers',
    description: 'Create a supplier during Material In (DECISIONS Q7)',
    roles: SM,
  },
  'supplier_mapping:manage': {
    module: 'Supplier Mapping',
    description: 'Edit or disable supplier mappings',
    roles: PA,
  },

  'ai_log:view_all': { module: 'AI Processing Logs', description: 'All AI activity', roles: PA },
  'ai_log:view_own': { module: 'AI Processing Logs', description: 'Own AI activity', roles: SM },
  'audit_log:view': { module: 'Audit Logs', description: 'View audit logs', roles: PA },
} as const satisfies Record<string, PermissionDef>;

export type PermissionCode = keyof typeof PERMISSION_DEFS;

export const PERMISSION_CODES = Object.keys(PERMISSION_DEFS) as PermissionCode[];

export function permissionsForRole(role: RoleCode): PermissionCode[] {
  return PERMISSION_CODES.filter((code) =>
    (PERMISSION_DEFS[code].roles as readonly RoleCode[]).includes(role),
  );
}

export function roleHasPermission(role: RoleCode, code: PermissionCode): boolean {
  return (PERMISSION_DEFS[code].roles as readonly RoleCode[]).includes(role);
}

export function isRoleCode(value: string): value is RoleCode {
  return (ROLE_CODES as readonly string[]).includes(value);
}
