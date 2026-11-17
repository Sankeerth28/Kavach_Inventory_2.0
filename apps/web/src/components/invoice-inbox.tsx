'use client';

import { ApiError } from '@kavach/api-client';
import {
  type InvoiceStatus,
  type InvoiceSummaryDto,
  UPLOAD_LIMITS,
  type UploadMimeType,
  sniffMimeType,
} from '@kavach/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type DragEvent, useRef, useState } from 'react';
import { Alert, Badge, Button, Card, Select, Table, Td } from '@/components/ui';
import { api, errorMessage, useSession } from '@/lib/session';
import { useStore } from '@/lib/store-context';
import { cn } from '@/lib/utils';

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  UPLOADING: 'Uploading',
  QUEUED: 'Waiting to be read',
  PROCESSING: 'Reading',
  NEEDS_RECAPTURE: 'Better photo needed',
  READY_FOR_REVIEW: 'Ready for review',
  POSTED: 'Received',
  REVERSED: 'Reversed',
  FAILED: 'Could not be read',
  DISCARDED: 'Discarded',
};

export function statusTone(
  status: InvoiceStatus,
): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'POSTED') return 'success';
  if (status === 'READY_FOR_REVIEW') return 'info';
  if (status === 'NEEDS_RECAPTURE') return 'warning';
  if (status === 'FAILED') return 'danger';
  return 'neutral';
}

export interface PickedFile {
  file: File;
  mimeType: UploadMimeType;
}

/** Checks type (from the bytes) and size before anything is sent. The server checks again. */
export async function checkFiles(files: File[]): Promise<{ ok: PickedFile[]; problems: string[] }> {
  const ok: PickedFile[] = [];
  const problems: string[] = [];
  for (const file of files) {
    if (file.size > UPLOAD_LIMITS.maxFileBytes) {
      problems.push(`${file.name} is larger than 15 MB.`);
      continue;
    }
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const mimeType = sniffMimeType(head);
    if (!mimeType) problems.push(`${file.name} is not a JPG, PNG or PDF file.`);
    else ok.push({ file, mimeType });
  }
  if (ok.length > UPLOAD_LIMITS.maxFiles) {
    problems.push(`A document can have at most ${UPLOAD_LIMITS.maxFiles} files.`);
    ok.length = UPLOAD_LIMITS.maxFiles;
  }
  return { ok, problems };
}

/**
 * Material In, screen 1 (PRD §10.2, §20.4 A): scan or upload a document, and see what is being
 * read, what waits for review and what was received.
 */
export function InvoiceInbox() {
  const { can } = useSession();
  const { selectedStoreId, authorizedStores } = useStore();
  const router = useRouter();
  const queryClient = useQueryClient();
  const canReceive = can('material_in:create');

  const [storeId, setStoreId] = useState('');
  const targetStoreId =
    storeId || (selectedStoreId !== 'ALL' ? selectedStoreId : (authorizedStores[0]?.id ?? ''));

  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const browseRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const listStore = selectedStoreId !== 'ALL' ? selectedStoreId : undefined;
  const active = useQuery({
    queryKey: ['invoices', 'active', listStore],
    queryFn: async () => {
      const [processing, review, problem] = await Promise.all([
        api.invoices.list({ group: 'PROCESSING', storeId: listStore, pageSize: 50 }),
        api.invoices.list({ group: 'REVIEW', storeId: listStore, pageSize: 50 }),
        api.invoices.list({ group: 'PROBLEM', storeId: listStore, pageSize: 50 }),
      ]);
      return { processing: processing.items, review: review.items, problem: problem.items };
    },
    // Processing is asynchronous: the list refreshes while anything is still being read.
    refetchInterval: (q) => ((q.state.data?.processing.length ?? 0) > 0 ? 3000 : false),
  });
  const recent = useQuery({
    queryKey: ['invoices', 'done', listStore],
    queryFn: () => api.invoices.list({ group: 'DONE', storeId: listStore, pageSize: 10 }),
  });

  const add = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    const result = await checkFiles([...picked.map((p) => p.file), ...Array.from(files)]);
    setPicked(result.ok);
    setProblems(result.problems);
    setError(null);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void add(e.dataTransfer.files);
  };

  const send = async () => {
    if (picked.length === 0 || !targetStoreId) return;
    setError(null);
    let invoiceId: string | null = null;
    try {
      setProgress('Starting…');
      const created = await api.invoices.create(targetStoreId);
      invoiceId = created.id;
      for (const [i, p] of picked.entries()) {
        setProgress(`Uploading ${i + 1} of ${picked.length}…`);
        await api.invoices.uploadPage(created.id, p.file, p.mimeType, p.file.name);
      }
      setProgress('Sending to be read…');
      await api.invoices.submit(created.id);
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      router.push(`/material-in/invoices/${created.id}`);
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'NETWORK'
          ? 'The connection dropped while uploading. Check the network and send again.'
          : errorMessage(e),
      );
      // A half-uploaded document is not left lying around.
      if (invoiceId) void api.invoices.discard(invoiceId).catch(() => undefined);
      setProgress(null);
    }
  };

  const rows = (items: InvoiceSummaryDto[]) =>
    items.map((inv) => (
      <tr key={inv.id}>
        <Td>
          <Link
            className="font-medium text-primary hover:underline"
            href={`/material-in/invoices/${inv.id}`}
          >
            {inv.invoiceNo ?? inv.challanNo ?? 'Document'}
          </Link>
          <div className="text-xs text-muted-foreground">
            {inv.supplierName ?? 'Supplier not read yet'}
          </div>
        </Td>
        <Td>{inv.storeName}</Td>
        <Td>
          <Badge tone={statusTone(inv.status)}>{STATUS_LABEL[inv.status]}</Badge>
          {inv.failureMessage && inv.status === 'FAILED' && (
            <div className="mt-1 max-w-xs text-xs text-muted-foreground">{inv.failureMessage}</div>
          )}
        </Td>
        <Td>{inv.lineCount > 0 ? `${inv.lineCount} lines` : '—'}</Td>
        <Td className="text-xs text-muted-foreground">
          {inv.uploadedByName}
          <br />
          {new Date(inv.createdAt).toLocaleString()}
        </Td>
        <Td>
          {inv.receiptReferenceNo && inv.postingId ? (
            <Link
              className="font-mono text-xs text-primary hover:underline"
              href={`/material-in/receipts/${inv.postingId}`}
            >
              {inv.receiptReferenceNo}
            </Link>
          ) : (
            <Link href={`/material-in/invoices/${inv.id}`}>
              <Button size="sm" variant="secondary">
                {inv.status === 'READY_FOR_REVIEW' ? (canReceive ? 'Review' : 'View') : 'Open'}
              </Button>
            </Link>
          )}
        </Td>
      </tr>
    ));
  const head = ['Document', 'Store', 'Status', 'Lines', 'Uploaded', ''];

  return (
    <div className="space-y-6">
      {canReceive && (
        <Card className="p-5">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              'rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors',
              dragging ? 'border-primary bg-primary/5' : 'border-border',
            )}
          >
            <p className="text-base font-medium">Drop the invoice or challan here</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Printed or handwritten. JPG, PNG or PDF, up to 15 MB each. For several pages, add
              every page.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              <Button onClick={() => cameraRef.current?.click()} disabled={progress !== null}>
                Scan Invoice
              </Button>
              <Button
                variant="secondary"
                onClick={() => browseRef.current?.click()}
                disabled={progress !== null}
              >
                Browse Files
              </Button>
            </div>
            {/* On a phone or tablet, `capture` opens the camera directly. */}
            <input
              ref={cameraRef}
              type="file"
              accept="image/jpeg,image/png"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                void add(e.target.files);
                e.target.value = '';
              }}
            />
            <input
              ref={browseRef}
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                void add(e.target.files);
                e.target.value = '';
              }}
            />
          </div>

          {problems.length > 0 && (
            <div className="mt-3">
              <Alert tone="warning">
                {problems.map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </Alert>
            </div>
          )}

          {picked.length > 0 && (
            <div className="mt-4 space-y-3">
              <ol className="space-y-1 text-sm">
                {picked.map((p, i) => (
                  <li
                    key={`${p.file.name}-${i}`}
                    className="flex items-center justify-between rounded-md bg-muted px-3 py-2"
                  >
                    <span>
                      Page {i + 1}: {p.file.name}{' '}
                      <span className="text-xs text-muted-foreground">
                        ({(p.file.size / 1024 / 1024).toFixed(1)} MB)
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={progress !== null}
                      onClick={() => setPicked((prev) => prev.filter((_, j) => j !== i))}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ol>
              <div className="flex flex-wrap items-center gap-3">
                {authorizedStores.length > 1 && (
                  <Select
                    aria-label="Receiving store"
                    className="w-56"
                    value={targetStoreId}
                    onChange={(e) => setStoreId(e.target.value)}
                  >
                    {authorizedStores.map((s) => (
                      <option key={s.id} value={s.id}>
                        Receive into: {s.name}
                      </option>
                    ))}
                  </Select>
                )}
                <Button onClick={() => void send()} disabled={progress !== null || !targetStoreId}>
                  {progress ??
                    `Read ${picked.length === 1 ? 'this document' : `these ${picked.length} pages`}`}
                </Button>
                <Button variant="ghost" disabled={progress !== null} onClick={() => setPicked([])}>
                  Clear
                </Button>
              </div>
            </div>
          )}
          {error && (
            <div className="mt-3">
              <Alert>{error}</Alert>
            </div>
          )}
        </Card>
      )}

      {active.error && <Alert>{errorMessage(active.error)}</Alert>}

      {(active.data?.review.length ?? 0) > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Pending reviews</h2>
          <Table head={head}>{rows(active.data!.review)}</Table>
        </section>
      )}
      {(active.data?.processing.length ?? 0) > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Being read</h2>
          <Table head={head}>{rows(active.data!.processing)}</Table>
        </section>
      )}
      {(active.data?.problem.length ?? 0) > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Need attention</h2>
          <Table head={head}>{rows(active.data!.problem)}</Table>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold">Recent receipts from documents</h2>
        {recent.data && recent.data.items.length > 0 ? (
          <Table head={head}>{rows(recent.data.items)}</Table>
        ) : (
          <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-sm text-muted-foreground">
            {recent.isPending
              ? 'Loading…'
              : 'Nothing has been received from a scanned document yet.'}
          </p>
        )}
      </section>
    </div>
  );
}
