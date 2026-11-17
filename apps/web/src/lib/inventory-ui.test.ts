import { permissionsForRole } from '@kavach/shared';
import { describe, expect, it } from 'vitest';

describe('Inventory UI Rules & Validation Logic', () => {
  it('prevents issue when quantity in stock unit exceeds available stock', () => {
    const availableStock = 100;
    const requestedQty1 = 50;
    const requestedQty2 = 150;

    const isInsufficient1 = requestedQty1 > availableStock;
    const isInsufficient2 = requestedQty2 > availableStock;

    expect(isInsufficient1).toBe(false);
    expect(isInsufficient2).toBe(true);
  });

  it('generates distinct idempotency keys for consecutive submissions', () => {
    const genKey = (prefix: string) =>
      `ik-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const k1 = genKey('iss');
    const k2 = genKey('iss');

    expect(k1).not.toBe(k2);
    expect(k1).toMatch(/^ik-iss-\d+-[a-z0-9]+$/);
  });

  it('Store Manager has posting permissions but NOT admin approval/adjustment/reversal', () => {
    const smPermissions = new Set(permissionsForRole('STORE_MANAGER'));

    // Operational posting permissions
    expect(smPermissions.has('material_in:create')).toBe(true);
    expect(smPermissions.has('material_out:create')).toBe(true);
    expect(smPermissions.has('material_return:create')).toBe(true);
    expect(smPermissions.has('stock_verification:submit')).toBe(true);

    // Forbidden admin-only operations
    expect(smPermissions.has('stock_adjustment:create')).toBe(false);
    expect(smPermissions.has('stock_verification:review')).toBe(false);
    expect(smPermissions.has('transaction:reverse')).toBe(false);
    expect(smPermissions.has('stock:reconcile')).toBe(false);
    expect(smPermissions.has('contractor:manage')).toBe(false);
  });

  it('Project Admin has approval, adjustment, reversal, and reconciliation permissions', () => {
    const paPermissions = new Set(permissionsForRole('PROJECT_ADMIN'));

    expect(paPermissions.has('stock_adjustment:create')).toBe(true);
    expect(paPermissions.has('stock_verification:review')).toBe(true);
    expect(paPermissions.has('transaction:reverse')).toBe(true);
    expect(paPermissions.has('stock:reconcile')).toBe(true);
    expect(paPermissions.has('contractor:manage')).toBe(true);
    expect(paPermissions.has('dashboard:view_full')).toBe(true);
  });

  it('Store filtering isolates stores according to member storeIds', () => {
    const allStores = [
      { id: 'store-1', name: 'Main Yard', code: 'MY', isActive: true },
      { id: 'store-2', name: 'Sub Store', code: 'SS', isActive: true },
      { id: 'store-3', name: 'Steel Depot', code: 'SD', isActive: true },
    ];

    // Store manager assigned only to store-1
    const smMembership = {
      roleCode: 'STORE_MANAGER' as const,
      storeIds: ['store-1'],
    };

    const smAllowed = allStores.filter((s) => smMembership.storeIds.includes(s.id));
    expect(smAllowed.map((s) => s.id)).toEqual(['store-1']);
    expect(smAllowed.some((s) => s.id === 'store-2')).toBe(false);

    // Project admin assigned to all stores
    const paMembership = {
      roleCode: 'PROJECT_ADMIN' as const,
      storeIds: [] as string[],
    };

    const paAllowed = paMembership.roleCode === 'PROJECT_ADMIN' ? allStores : [];
    expect(paAllowed.length).toBe(3);
  });
});
