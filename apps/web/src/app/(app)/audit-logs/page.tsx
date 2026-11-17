'use client';

import type { AuditLogDto } from '@kavach/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Input, ListState, Modal, PageHeader, Select, Table, Td } from '@/components/ui';
import { api, errorMessage } from '@/lib/session';

const ENTITY_TYPES = [
  ['', 'Everything'],
  ['posting', 'Stock postings'],
  ['stock_verification', 'Stock counts'],
  ['invoice', 'Scanned documents'],
  ['invoice_item', 'Document lines'],
  ['material', 'Materials'],
  ['supplier', 'Suppliers'],
  ['supplier_mapping', 'Supplier mappings'],
  ['contractor', 'Contractors'],
  ['category', 'Categories'],
  ['unit', 'Units'],
  ['unit_conversion', 'Conversions'],
  ['location', 'Locations'],
  ['store', 'Stores'],
  ['user', 'Users'],
  ['project', 'Project and settings'],
  ['report', 'Report downloads'],
] as const;

/** "material.create" → "Material · create" */
const describe = (action: string) => {
  const [entity = '', verb = ''] = action.split('.');
  const words = (s: string) => s.replaceAll('_', ' ');
  return `${words(entity).replace(/^./, (c) => c.toUpperCase())} · ${words(verb)}`;
};

function Details({ log, onClose }: { log: AuditLogDto; onClose: () => void }) {
  const block = (title: string, value: unknown) =>
    value == null ? null : (
      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground uppercase">{title}</p>
        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
          {JSON.stringify(value, null, 2)}
        </pre>
      </div>
    );
  return (
    <Modal title={describe(log.action)} onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm">
        <p>
          {log.actorName ?? 'System'} · {new Date(log.createdAt).toLocaleString()}
        </p>
        {block('Before', log.before)}
        {block('After', log.after)}
        {block('Details', log.metadata)}
      </div>
    </Modal>
  );
}

export default function AuditLogsPage() {
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AuditLogDto | null>(null);
  const list = useQuery({
    queryKey: ['audit-logs', { entityType, from, to, page }],
    queryFn: () =>
      api.auditLogs.list({
        entityType: entityType || undefined,
        // Whole local days, both inclusive.
        from: from ? new Date(`${from}T00:00:00`) : undefined,
        to: to ? new Date(`${to}T23:59:59.999`) : undefined,
        page,
        pageSize: 50,
      }),
    placeholderData: keepPreviousData,
  });
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Audit Logs"
        description="Every change on this project: who, what and when. Entries cannot be edited or deleted."
        actions={
          <>
            <Input
              aria-label="From"
              type="date"
              className="w-40"
              value={from}
              max={to || undefined}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
            <Input
              aria-label="To"
              type="date"
              className="w-40"
              value={to}
              min={from || undefined}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
            <Select
              aria-label="Show"
              className="w-44"
              value={entityType}
              onChange={(e) => {
                setEntityType(e.target.value);
                setPage(1);
              }}
            >
              {ENTITY_TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </>
        }
      />
      <ListState
        loading={list.isPending}
        error={list.error ? errorMessage(list.error) : null}
        empty={data?.items.length === 0}
        emptyText="Nothing recorded yet."
      />
      {data && data.items.length > 0 && (
        <>
          <Table head={['When', 'Who', 'What', '']}>
            {data.items.map((log) => (
              <tr key={log.id}>
                <Td className="text-xs whitespace-nowrap text-muted-foreground">
                  {new Date(log.createdAt).toLocaleString()}
                </Td>
                <Td>{log.actorName ?? 'System'}</Td>
                <Td>
                  <span className="font-medium">{describe(log.action)}</span>
                  {typeof (log.after as { name?: unknown } | null)?.name === 'string' && (
                    <span className="ml-2 text-muted-foreground">
                      {(log.after as { name: string }).name}
                    </span>
                  )}
                </Td>
                <Td className="text-right">
                  <Button variant="ghost" size="sm" onClick={() => setOpen(log)}>
                    Details
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>{data.total} entries</span>
            <span className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Newer
              </Button>
              Page {page} of {pages}
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= pages}
                onClick={() => setPage(page + 1)}
              >
                Older
              </Button>
            </span>
          </div>
        </>
      )}
      {open && <Details log={open} onClose={() => setOpen(null)} />}
    </>
  );
}
