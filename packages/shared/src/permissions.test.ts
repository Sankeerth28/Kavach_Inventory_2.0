import { describe, expect, it } from 'vitest';
import {
  PERMISSION_CODES,
  type PermissionCode,
  permissionsForRole,
  roleHasPermission,
} from './permissions';
import { CreateUserSchema, PasswordSchema, PhoneSchema } from './schemas';

describe('role → permission map (PRD §3.1, §3.2)', () => {
  const sm = new Set(permissionsForRole('STORE_MANAGER'));
  const pa = new Set(permissionsForRole('PROJECT_ADMIN'));

  it('denies the Store Manager everything marked No Access / No Direct Access / admin-only', () => {
    const adminOnly: PermissionCode[] = [
      'dashboard:view_full',
      'material:create',
      'material:update',
      'material:deactivate',
      'stock_verification:review',
      'stock_adjustment:create',
      'transaction:reverse',
      'invoice:duplicate_override',
      'report:view_all',
      'user:manage',
      'location:manage',
      'category:manage',
      'unit:manage',
      'store:manage',
      'settings:manage',
      'supplier:manage',
      'supplier_mapping:manage',
      'ai_log:view_all',
      'audit_log:view',
    ];
    for (const code of adminOnly) {
      expect(sm.has(code), code).toBe(false);
      expect(pa.has(code), code).toBe(true);
    }
  });

  it('gives the Store Manager the operational permissions', () => {
    for (const code of [
      'material:view',
      'material:create_via_receipt',
      'material_in:create',
      'material_out:create',
      'material_return:create',
      'stock:view',
      'stock_verification:submit',
      'transaction:view',
      'report:view_operational',
      'ai_log:view_own',
    ] as PermissionCode[]) {
      expect(sm.has(code), code).toBe(true);
    }
  });

  it('does not let the Project Admin post receipts, issues or returns (View All only)', () => {
    for (const code of [
      'material_in:create',
      'material_out:create',
      'material_return:create',
    ] as PermissionCode[]) {
      expect(roleHasPermission('PROJECT_ADMIN', code)).toBe(false);
    }
  });

  it('assigns every permission to at least one role', () => {
    for (const code of PERMISSION_CODES) expect(sm.has(code) || pa.has(code), code).toBe(true);
  });
});

describe('user schemas', () => {
  it('requires an e-mail or a phone number', () => {
    const base = { name: 'A', roleCode: 'PROJECT_ADMIN', password: 'Passw0rd1' };
    expect(CreateUserSchema.safeParse(base).success).toBe(false);
    expect(CreateUserSchema.safeParse({ ...base, phone: '+91 98765 43210' }).success).toBe(true);
    expect(CreateUserSchema.parse({ ...base, email: ' A@B.Com ' }).email).toBe('a@b.com');
  });

  it('requires a store for a Store Manager', () => {
    const base = { name: 'A', email: 'a@b.com', roleCode: 'STORE_MANAGER', password: 'Passw0rd1' };
    expect(CreateUserSchema.safeParse(base).success).toBe(false);
  });

  it('normalises phone numbers and rejects weak passwords', () => {
    expect(PhoneSchema.parse('+91-98765 43210')).toBe('9876543210');
    expect(PhoneSchema.safeParse('12345').success).toBe(false);
    expect(PasswordSchema.safeParse('short1').success).toBe(false);
    expect(PasswordSchema.safeParse('allletters').success).toBe(false);
    expect(PasswordSchema.safeParse('Passw0rd1').success).toBe(true);
  });
});
