'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { Alert, Badge, Button, Card } from '@/components/ui';
import { api, errorMessage, useSession } from '@/lib/session';

/**
 * The receipt of a posting (PRD §10.2 screen 6: View Receipt, Download Receipt).
 * "Download" prints this page: the browser saves it as a PDF (DECISIONS Q39; a server-made PDF
 * arrives with report export in Phase 5).
 */
function Receipt() {
  const { id } = useParams<{ id: string }>();
  const print = useSearchParams().get('print') === '1';
  const { membership } = useSession();
  const posting = useQuery({
    queryKey: ['posting', id],
    queryFn: () => api.inventory.getPosting(id),
  });

  useEffect(() => {
    if (!print || !posting.data) return;
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [print, posting.data]);

  if (posting.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (posting.error || !posting.data) return <Alert>{errorMessage(posting.error)}</Alert>;
  const p = posting.data;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap gap-2 print:hidden">
        <Button onClick={() => window.print()}>Download / Print</Button>
        {p.invoiceId && (
          <Link href={`/material-in/invoices/${p.invoiceId}`}>
            <Button variant="secondary">View the document</Button>
          </Link>
        )}
        <Link href="/material-in">
          <Button variant="secondary">Back to Material In</Button>
        </Link>
      </div>
      <Card className="p-6 print:border-0 print:p-0">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase">Material receipt</p>
            <h1 className="font-mono text-2xl font-semibold">{p.referenceNo}</h1>
            <p className="text-sm text-muted-foreground">{membership?.projectName}</p>
          </div>
          <Badge tone={p.status === 'REVERSED' ? 'danger' : 'success'}>
            {p.status === 'REVERSED' ? 'Reversed' : 'Posted'}
          </Badge>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 py-4 text-sm sm:grid-cols-3">
          {[
            ['Supplier', p.supplierName ?? '—'],
            ['Invoice / challan no.', p.externalRef ?? '—'],
            ['Store', p.storeName],
            ['Received by', p.postedByName],
            ['Date and time', new Date(p.postedAt).toLocaleString()],
            [
              'Type',
              p.type === 'RECEIPT_INVOICE'
                ? 'Scanned document'
                : p.type === 'RECEIPT_QUICK'
                  ? 'Quick Receive'
                  : 'Manual receipt',
            ],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        <table className="w-full text-left text-sm">
          <thead className="border-y border-border text-xs text-muted-foreground uppercase">
            <tr>
              <th className="py-2">Transaction</th>
              <th className="py-2">Material</th>
              <th className="py-2">As on document</th>
              <th className="py-2 text-right">Into stock</th>
              <th className="py-2">Condition</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {p.lines.map((l) => (
              <tr key={l.id}>
                <td className="py-2 font-mono text-xs">{l.txnNo}</td>
                <td className="py-2">
                  {l.materialName}
                  <div className="text-xs text-muted-foreground">{l.materialCode}</div>
                </td>
                <td className="py-2">
                  {l.enteredQuantity ? `${l.enteredQuantity} ${l.enteredUnitCode}` : '—'}
                </td>
                <td className="py-2 text-right font-mono">
                  {l.quantity} {l.unitCode}
                </td>
                <td className="py-2">
                  {l.bucket === 'AVAILABLE'
                    ? 'Good'
                    : l.bucket === 'DAMAGED'
                      ? 'Damaged (not available)'
                      : 'Scrap'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {p.notes && <p className="mt-4 text-sm">Notes: {p.notes}</p>}
        {p.reversedBy && (
          <p className="mt-4 text-sm text-danger">Reversed by {p.reversedBy.referenceNo}.</p>
        )}
      </Card>
    </div>
  );
}

export default function ReceiptPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <Receipt />
    </Suspense>
  );
}
