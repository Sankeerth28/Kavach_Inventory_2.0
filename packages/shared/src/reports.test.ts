import { describe, expect, it } from 'vitest';
import { permissionsForRole } from './permissions';
import { REPORTS, REPORT_KEYS, ReportQuerySchema, formatReportCell, reportsFor } from './reports';

describe('reports (PRD §19)', () => {
  it('has the ten reports of §19 (DECISIONS Q37)', () => {
    expect(REPORT_KEYS).toHaveLength(10);
    for (const key of REPORT_KEYS) expect(REPORTS[key].key).toBe(key);
  });

  it('gives a Store Manager the operational reports only (DECISIONS Q18)', () => {
    expect(reportsFor(permissionsForRole('STORE_MANAGER')).map((r) => r.key)).toEqual([
      'current-stock',
      'material-in',
      'material-out',
      'material-return',
      'material-movement',
      'low-stock',
    ]);
    expect(reportsFor(permissionsForRole('PROJECT_ADMIN'))).toHaveLength(10);
    expect(reportsFor([])).toEqual([]);
  });

  it('every report with a date range has date filters, and both roles may export', () => {
    expect(permissionsForRole('STORE_MANAGER')).toContain('report:export');
    expect(permissionsForRole('PROJECT_ADMIN')).toContain('report:export');
    for (const key of ['material-in', 'material-out', 'material-return', 'material-movement']) {
      expect(REPORTS[key as keyof typeof REPORTS].filters).toContain('dates');
    }
  });

  it('validates filters', () => {
    expect(ReportQuerySchema.parse({ byStore: 'true' }).byStore).toBe(true);
    expect(ReportQuerySchema.parse({ byStore: true }).byStore).toBe(true);
    expect(ReportQuerySchema.parse({}).byStore).toBe(false);
    expect(ReportQuerySchema.safeParse({ from: '2026-13-01' }).success).toBe(false);
    expect(ReportQuerySchema.safeParse({ to: '2026-02-30' }).success).toBe(false);
    expect(ReportQuerySchema.safeParse({ to: '2028-02-29' }).success).toBe(true);
    expect(ReportQuerySchema.safeParse({ from: '2026-02-01', to: '2026-01-31' }).success).toBe(
      false,
    );
    expect(ReportQuerySchema.safeParse({ storeId: 'not-a-uuid' }).success).toBe(false);
  });

  it('shows dates in the project time zone and leaves quantities untouched', () => {
    expect(formatReportCell('2026-11-13T20:00:00.000Z', 'date', 'Asia/Kolkata')).toBe(
      '14 Nov 2026',
    );
    expect(formatReportCell('12.345', 'quantity', 'UTC')).toBe('12.345');
    expect(formatReportCell(null, 'text', 'UTC')).toBe('');
  });
});
