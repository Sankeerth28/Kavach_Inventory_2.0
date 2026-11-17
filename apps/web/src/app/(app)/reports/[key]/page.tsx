'use client';

import {
  REPORTS,
  type ReportFormat,
  type ReportKey,
  type ReportQueryInput,
  formatReportCell,
  isReportKey,
} from '@kavach/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  ListState,
  PageHeader,
  Select,
  Table,
  Td,
} from '@/components/ui';
import { api, errorMessage, useSession } from '@/lib/session';
import { useStore } from '@/lib/store-context';

function isoDay(d: Date): string {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return z.toISOString().slice(0, 10);
}

function defaultFilters(): ReportQueryInput {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 29);
  return { from: isoDay(from), to: isoDay(to) };
}

/** Removes empty values, so the URL and the export carry only what was chosen. */
const clean = (q: ReportQueryInput): ReportQueryInput =>
  Object.fromEntries(
    Object.entries(q).filter(([, v]) => v !== undefined && v !== '' && v !== false),
  ) as ReportQueryInput;

function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export default function ReportPage() {
  const params = useParams<{ key: string }>();
  const key = isReportKey(params.key) ? params.key : null;
  return key ? <Report reportKey={key} /> : <Alert>This report does not exist.</Alert>;
}

function Report({ reportKey }: { reportKey: ReportKey }) {
  const def = REPORTS[reportKey];
  const { can } = useSession();
  const { authorizedStores, canSelectAll, selectedStoreId } = useStore();
  const uses = (f: (typeof def.filters)[number]) => def.filters.includes(f);

  const [draft, setDraft] = useState<ReportQueryInput>(() => ({
    ...defaultFilters(),
    storeId: selectedStoreId !== 'ALL' ? selectedStoreId : undefined,
  }));
  const [applied, setApplied] = useState<ReportQueryInput>(draft);
  const [exporting, setExporting] = useState<ReportFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const query = clean({
    from: uses('dates') ? applied.from : undefined,
    to: uses('dates') ? applied.to : undefined,
    storeId: uses('store') ? applied.storeId : undefined,
    byStore: uses('byStore') ? applied.byStore : undefined,
    materialId: uses('material') ? applied.materialId : undefined,
    supplierId: uses('supplier') ? applied.supplierId : undefined,
    categoryId: uses('category') ? applied.categoryId : undefined,
  });

  const report = useQuery({
    queryKey: ['report', reportKey, query],
    queryFn: () => api.reports.run(reportKey, query),
    placeholderData: keepPreviousData,
  });
  const materials = useQuery({
    queryKey: ['materials', 'report-picker'],
    queryFn: () => api.materials.list({ pageSize: 500 }),
    enabled: uses('material'),
    staleTime: 60_000,
  });
  const suppliers = useQuery({
    queryKey: ['suppliers', 'report-picker'],
    queryFn: () => api.suppliers.list({ includeInactive: true }),
    enabled: uses('supplier') && can('supplier:view'),
    staleTime: 60_000,
  });
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: api.categories.list,
    enabled: uses('category'),
    staleTime: 300_000,
  });

  const download = async (format: ReportFormat) => {
    setExporting(format);
    setExportError(null);
    try {
      const blob = await api.reports.export(reportKey, query, format);
      save(blob, `kavach-${reportKey}-${isoDay(new Date())}.${format}`);
    } catch (e) {
      setExportError(errorMessage(e));
    } finally {
      setExporting(null);
    }
  };

  const set = (patch: Partial<ReportQueryInput>) => setDraft((d) => ({ ...d, ...patch }));
  const data = report.data;

  return (
    <>
      <PageHeader
        title={def.title}
        description={def.description}
        actions={
          <>
            <Link href="/reports" className="self-center text-sm text-primary hover:underline">
              All reports
            </Link>
            {can('report:export') && (
              <>
                <Button
                  variant="secondary"
                  disabled={!data || exporting !== null}
                  onClick={() => void download('xlsx')}
                >
                  {exporting === 'xlsx' ? 'Preparing…' : 'Download Excel'}
                </Button>
                <Button
                  variant="secondary"
                  disabled={!data || exporting !== null}
                  onClick={() => void download('pdf')}
                >
                  {exporting === 'pdf' ? 'Preparing…' : 'Download PDF'}
                </Button>
              </>
            )}
          </>
        }
      />

      <Card className="mb-4 p-4">
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setApplied(draft);
          }}
        >
          {uses('dates') && (
            <>
              <Field label="From">
                {(id) => (
                  <Input
                    id={id}
                    type="date"
                    value={draft.from ?? ''}
                    max={draft.to}
                    onChange={(e) => set({ from: e.target.value })}
                  />
                )}
              </Field>
              <Field label="To">
                {(id) => (
                  <Input
                    id={id}
                    type="date"
                    value={draft.to ?? ''}
                    min={draft.from}
                    onChange={(e) => set({ to: e.target.value })}
                  />
                )}
              </Field>
            </>
          )}
          {uses('store') && (
            <Field label="Store">
              {(id) => (
                <Select
                  id={id}
                  value={draft.storeId ?? ''}
                  onChange={(e) => set({ storeId: e.target.value || undefined })}
                >
                  <option value="">
                    {canSelectAll ? 'All stores (project-wide)' : 'All my stores'}
                  </option>
                  {authorizedStores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {uses('byStore') && (
            <Field label="Show">
              {(id) => (
                <Select
                  id={id}
                  value={draft.byStore ? 'store' : 'total'}
                  onChange={(e) => set({ byStore: e.target.value === 'store' })}
                >
                  <option value="total">Stores together</option>
                  <option value="store">Store-wise</option>
                </Select>
              )}
            </Field>
          )}
          {uses('material') && (
            <Field label="Material">
              {(id) => (
                <Select
                  id={id}
                  value={draft.materialId ?? ''}
                  onChange={(e) => set({ materialId: e.target.value || undefined })}
                >
                  <option value="">All materials</option>
                  {(materials.data?.items ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.code})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {uses('supplier') && can('supplier:view') && (
            <Field label="Supplier">
              {(id) => (
                <Select
                  id={id}
                  value={draft.supplierId ?? ''}
                  onChange={(e) => set({ supplierId: e.target.value || undefined })}
                >
                  <option value="">All suppliers</option>
                  {(suppliers.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {uses('category') && (
            <Field label="Category">
              {(id) => (
                <Select
                  id={id}
                  value={draft.categoryId ?? ''}
                  onChange={(e) => set({ categoryId: e.target.value || undefined })}
                >
                  <option value="">All categories</option>
                  {(categories.data ?? [])
                    .filter((c) => !c.parentId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
          )}
          <div className="flex items-end">
            <Button type="submit" disabled={report.isFetching}>
              {report.isFetching ? 'Loading…' : 'Show report'}
            </Button>
          </div>
        </form>
      </Card>

      {exportError && <Alert>{exportError}</Alert>}
      <ListState
        loading={report.isPending}
        error={report.error ? errorMessage(report.error) : null}
        empty={false}
        emptyText=""
      />

      {data && (
        <>
          <p className="mb-2 text-xs text-muted-foreground">
            {data.filters.map((f) => `${f.label}: ${f.value}`).join(' · ')} · times in{' '}
            {data.timezone}
          </p>
          {data.truncated && (
            <Alert tone="warning">
              Only the first {data.rows.length} rows are shown. Narrow the filters, or download the
              file (up to 20,000 rows).
            </Alert>
          )}
          {data.rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nothing for these filters.
            </p>
          ) : (
            <Table head={data.columns.map((c) => c.label)}>
              {data.rows.map((row, i) => (
                <tr key={i}>
                  {data.columns.map((c) => (
                    <Td
                      key={c.key}
                      className={
                        c.kind === 'quantity' || c.kind === 'count'
                          ? 'text-right tabular-nums'
                          : c.kind === 'date' || c.kind === 'datetime'
                            ? 'whitespace-nowrap'
                            : undefined
                      }
                    >
                      {formatReportCell(row[c.key] ?? null, c.kind, data.timezone)}
                    </Td>
                  ))}
                </tr>
              ))}
            </Table>
          )}
          {data.notes.length > 0 && (
            <ul className="mt-3 list-disc pl-5 text-xs text-muted-foreground">
              {data.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
