import { permissionsForRole } from '@kavach/shared';
import { describe, expect, it } from 'vitest';
import { canOpen, navFor } from './nav';

const labels = (role: 'PROJECT_ADMIN' | 'STORE_MANAGER') =>
  navFor(permissionsForRole(role)).map((n) => n.label);

describe('navigation follows the permission matrices (PRD §3, §20.2, §20.3, Q30)', () => {
  it('Store Manager: daily work and read-only inventory, no setup or audit', () => {
    expect(labels('STORE_MANAGER')).toEqual([
      'Dashboard',
      'Material In',
      'Material Out',
      'Return Material',
      'Material Master',
      'Current Stock',
      'Stock Verification',
      'Transactions',
      'Reports',
      'AI Processing',
    ]);
  });

  it('Project Admin: everything, including the pages the PRD list left out', () => {
    const admin = labels('PROJECT_ADMIN');
    for (const label of [
      'Dashboard',
      'Material Master',
      'Categories',
      'Units',
      'Locations',
      'Stores',
      'Contractors',
      'User Management',
      'Settings',
      'Audit Logs',
      'Stock Verification',
    ]) {
      expect(admin, label).toContain(label);
    }
  });

  it('keeps a Store Manager off the setup pages and everyone off unbuilt modules', () => {
    const sm = permissionsForRole('STORE_MANAGER');
    const pa = permissionsForRole('PROJECT_ADMIN');
    for (const path of [
      '/users',
      '/settings',
      '/audit-logs',
      '/categories',
      '/units',
      '/stores',
      '/contractors',
    ]) {
      expect(canOpen(path, sm), path).toBe(false);
      expect(canOpen(path, pa), path).toBe(true);
    }
    expect(canOpen('/materials', sm)).toBe(true);
    // Phase 2 active modules can be opened
    expect(canOpen('/stock', pa)).toBe(true);
    expect(canOpen('/material-out', sm)).toBe(true);
    expect(canOpen('/material-return', sm)).toBe(true);
    expect(canOpen('/transactions', pa)).toBe(true);
    // Phase 5: reports for both roles, including a report's own page
    expect(canOpen('/reports', pa)).toBe(true);
    expect(canOpen('/reports', sm)).toBe(true);
    expect(canOpen('/reports/material-movement', sm)).toBe(true);
    // Phase 3 modules: AI processing for both roles, suppliers for the admin, documents under Material In
    expect(canOpen('/ai-processing', pa)).toBe(true);
    expect(canOpen('/ai-processing', sm)).toBe(true);
    expect(canOpen('/suppliers', pa)).toBe(true);
    expect(canOpen('/suppliers', sm)).toBe(false);
    expect(canOpen('/material-in/invoices/some-id', sm)).toBe(true);
    expect(canOpen('/material-in/invoices/some-id', pa)).toBe(true);
  });
});
