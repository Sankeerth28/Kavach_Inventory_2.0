'use client';

import type { TransactionDto, TxnType } from '@kavach/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  ListState,
  Modal,
  PageHeader,
  Select,
  Table,
  Td,
  Textarea,
} from '@/components/ui';
import { api, errorMessage, useSession } from '@/lib/session';
import { useStore } from '@/lib/store-context';
import { cn } from '@/lib/utils';

export default function TransactionsPage() {
  const { can } = useSession();
  const { selectedStoreId } = useStore();
  const queryClient = useQueryClient();

  const [typeFilter, setTypeFilter] = useState<TxnType | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Reversal Modal state (Admin only, Q15)
  const canReverse = can('transaction:reverse');
  const [reverseModalOpen, setReverseModalOpen] = useState(false);
  const [targetTxn, setTargetTxn] = useState<TransactionDto | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const [reversing, setReversing] = useState(false);
  const [reverseError, setReverseError] = useState<string | null>(null);

  const effectiveStoreId = selectedStoreId === 'ALL' ? undefined : selectedStoreId;

  const txnsQuery = useQuery({
    queryKey: ['transactions', effectiveStoreId, typeFilter, search, page],
    queryFn: () =>
      api.transactions.list({
        storeId: effectiveStoreId,
        type: typeFilter === 'ALL' ? undefined : typeFilter,
        q: search.trim() || undefined,
        page,
        pageSize: 50,
      }),
  });

  const items = txnsQuery.data?.items ?? [];

  const handleReversePosting = async () => {
    if (!targetTxn || !reversalReason.trim()) return;
    setReversing(true);
    setReverseError(null);
    try {
      const idempotencyKey = `ik-rev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      await api.inventory.reverse(
        targetTxn.postingId,
        { reason: reversalReason.trim() },
        idempotencyKey,
      );
      setReverseModalOpen(false);
      setTargetTxn(null);
      setReversalReason('');
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err) {
      setReverseError(errorMessage(err));
    } finally {
      setReversing(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transaction Ledger"
        description="Immutable, append-only ledger of all stock receipts, issues, returns, and adjustments (PRD §18)."
      />

      {/* Filter toolbar */}
      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Field label="Search Txn # / Ref / Material">
            {(id) => (
              <Input
                id={id}
                placeholder="e.g. TXN-2026 or REC-0001"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            )}
          </Field>

          <Field label="Transaction Type">
            {(id) => (
              <Select
                id={id}
                value={typeFilter}
                onChange={(e) => {
                  setTypeFilter(e.target.value as TxnType | 'ALL');
                  setPage(1);
                }}
              >
                <option value="ALL">All Types</option>
                <option value="RECEIPT_MANUAL">Standard Receipt (IN)</option>
                <option value="RECEIPT_QUICK">Quick Receive (IN)</option>
                <option value="ISSUE">Material Issue (OUT)</option>
                <option value="RETURN">Return (IN)</option>
                <option value="ADJUSTMENT">Adjustment (±)</option>
                <option value="REVERSAL">Reversal</option>
              </Select>
            )}
          </Field>

          <div className="flex items-end">
            <Button
              variant="ghost"
              size="sm"
              className="h-10 w-full"
              onClick={() => {
                setSearch('');
                setTypeFilter('ALL');
                setPage(1);
              }}
            >
              Reset Filters
            </Button>
          </div>
        </div>
      </Card>

      <ListState
        loading={txnsQuery.isLoading}
        error={txnsQuery.error ? errorMessage(txnsQuery.error) : null}
        empty={items.length === 0}
        emptyText="No transactions recorded matching the selected criteria."
      />

      {items.length > 0 && (
        <Table
          head={[
            'Txn #',
            'Posting Ref',
            'Type',
            'Bucket',
            'Material',
            'Quantity',
            'Balance After',
            'Store',
            'Party / Location',
            'Status',
            'Date',
            canReverse ? 'Action' : '',
          ].filter(Boolean)}
        >
          {items.map((txn: TransactionDto) => {
            const isReversed = txn.status === 'REVERSED';
            const isReversalTxn = txn.postingType === 'REVERSAL';
            const isOut = Number(txn.quantity) < 0;

            return (
              <tr
                key={txn.id}
                className={cn('hover:bg-muted/40', isReversed && 'opacity-60 bg-muted/10')}
              >
                <Td className="font-mono text-xs font-semibold">{txn.txnNo}</Td>
                <Td className="font-mono text-xs text-muted-foreground">
                  {txn.postingReferenceNo}
                </Td>
                <Td>
                  <Badge
                    tone={
                      txn.postingType === 'RECEIPT_MANUAL' ||
                      txn.postingType === 'RECEIPT_QUICK' ||
                      txn.postingType === 'RECEIPT_INVOICE'
                        ? 'success'
                        : txn.postingType === 'ISSUE'
                          ? 'info'
                          : txn.postingType === 'RETURN'
                            ? 'warning'
                            : txn.postingType === 'REVERSAL'
                              ? 'danger'
                              : 'neutral'
                    }
                  >
                    {txn.postingType}
                  </Badge>
                </Td>
                <Td className="text-xs font-mono">{txn.bucket}</Td>
                <Td>
                  <p className="font-medium text-xs leading-tight">{txn.materialName}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">{txn.materialCode}</p>
                </Td>
                <Td className="tabular-nums font-mono text-xs font-semibold">
                  <span className={isOut ? 'text-danger' : 'text-success'}>
                    {isOut ? '' : '+'}
                    {txn.quantity} {txn.unitCode}
                  </span>
                </Td>
                <Td className="tabular-nums font-mono text-xs font-bold text-foreground">
                  {txn.balanceAfter}
                </Td>
                <Td className="text-xs">{txn.storeName}</Td>
                <Td className="text-xs text-muted-foreground">
                  {txn.contractorName ?? txn.locationPath ?? txn.supplierName ?? '—'}
                </Td>
                <Td>
                  <Badge tone={isReversed ? 'neutral' : 'success'}>{txn.status}</Badge>
                  {txn.reversesTxnNo && (
                    <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                      of {txn.reversesTxnNo}
                    </p>
                  )}
                </Td>
                <Td className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(txn.createdAt).toLocaleDateString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Td>
                {canReverse && (
                  <Td>
                    {!isReversed && !isReversalTxn ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7 text-xs text-danger"
                        onClick={() => {
                          setTargetTxn(txn);
                          setReverseModalOpen(true);
                        }}
                      >
                        Reverse Posting
                      </Button>
                    ) : null}
                  </Td>
                )}
              </tr>
            );
          })}
        </Table>
      )}

      {/* ── Reversal Confirmation Modal (Admin only, Q15) ──────────────────── */}
      {reverseModalOpen && targetTxn && (
        <Modal
          title={`Reverse Entire Posting — ${targetTxn.postingReferenceNo}`}
          onClose={() => setReverseModalOpen(false)}
        >
          <div className="space-y-4">
            <Alert tone="danger" title="Irreversible Ledger Action (Q15)">
              Reversing this posting will create matching <strong>REVERSAL</strong> transactions for
              all lines in this posting, restoring inventory stock balances back to their previous
              state. A posting can only be reversed once, and a reversal cannot be reversed.
            </Alert>

            {reverseError && <Alert>{reverseError}</Alert>}

            <div className="rounded-md border p-3 text-xs space-y-1 bg-muted/20">
              <p>
                <strong>Posting Reference:</strong> {targetTxn.postingReferenceNo}
              </p>
              <p>
                <strong>Posting Type:</strong> {targetTxn.postingType}
              </p>
              <p>
                <strong>Store:</strong> {targetTxn.storeName}
              </p>
              <p>
                <strong>Posted Date:</strong> {new Date(targetTxn.createdAt).toLocaleString()}
              </p>
            </div>

            <Field label="Mandatory Audit Justification / Reason">
              {(id) => (
                <Textarea
                  id={id}
                  placeholder="Explain why this entire posting is being reversed…"
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                  required
                />
              )}
            </Field>

            <div className="flex justify-end gap-3 pt-3 border-t">
              <Button
                variant="secondary"
                onClick={() => setReverseModalOpen(false)}
                disabled={reversing}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={handleReversePosting}
                disabled={reversing || !reversalReason.trim()}
              >
                {reversing ? 'Reversing Posting…' : 'Confirm & Reverse Posting'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
