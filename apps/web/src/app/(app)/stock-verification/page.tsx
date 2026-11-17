'use client';

import type { SubmitVerificationInput, VerificationDto, VerificationStatus } from '@kavach/shared';
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

export default function StockVerificationPage() {
  const { can } = useSession();
  const { selectedStoreId, authorizedStores } = useStore();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<VerificationStatus | 'ALL'>('ALL');

  // Submit physical count modal state
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [newStoreId, setNewStoreId] = useState(
    selectedStoreId !== 'ALL' ? selectedStoreId : (authorizedStores[0]?.id ?? ''),
  );
  const [newMaterialId, setNewMaterialId] = useState('');
  const [newPhysicalCount, setNewPhysicalCount] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Review modal state (Admin only)
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [targetVerification, setTargetVerification] = useState<VerificationDto | null>(null);
  const [reviewAction, setReviewAction] = useState<'APPROVE' | 'REJECT'>('APPROVE');
  const [reviewReason, setReviewReason] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  // Queries
  const verificationsQuery = useQuery({
    queryKey: ['stock-verifications', selectedStoreId, statusFilter],
    queryFn: () =>
      api.verifications.list({
        storeId: selectedStoreId === 'ALL' ? undefined : selectedStoreId,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        pageSize: 100,
      }),
  });

  const materialsQuery = useQuery({
    queryKey: ['materials', 'active'],
    queryFn: () => api.materials.list({ status: 'ACTIVE', pageSize: 200 }),
  });

  // Current store stock for system qty snapshot
  const stockQuery = useQuery({
    queryKey: ['stock', newStoreId],
    queryFn: () => api.stock.list({ storeId: newStoreId, pageSize: 200 }),
    enabled: !!newStoreId && submitModalOpen,
  });

  const items = verificationsQuery.data?.items ?? [];
  const materials = materialsQuery.data?.items ?? [];
  const stockRows = stockQuery.data?.items ?? [];

  const selectedMat = materials.find((m) => m.id === newMaterialId);
  const currentStockRow = stockRows.find((r) => r.materialId === newMaterialId);
  const systemQty = currentStockRow ? Number(currentStockRow.availableQty) : 0;
  const physicalQty = Number(newPhysicalCount);
  const variance = newPhysicalCount ? (physicalQty - systemQty).toFixed(2) : null;

  const canSubmit = can('stock_verification:submit');
  const canReview = can('stock_verification:review');

  // Submit physical count
  const handleSubmitCount = async () => {
    if (!newMaterialId || !newPhysicalCount) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload: SubmitVerificationInput = {
        storeId: newStoreId,
        materialId: newMaterialId,
        physicalQuantity: newPhysicalCount,
        reason: newNotes.trim() || 'Physical inventory audit',
      };
      await api.verifications.submit(payload);
      setSubmitModalOpen(false);
      setNewMaterialId('');
      setNewPhysicalCount('');
      setNewNotes('');
      void queryClient.invalidateQueries({ queryKey: ['stock-verifications'] });
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  // Review (Approve or Reject)
  const handleReview = async () => {
    if (!targetVerification) return;
    setReviewing(true);
    setReviewError(null);
    try {
      if (reviewAction === 'APPROVE') {
        await api.verifications.approve(targetVerification.id, {
          note: reviewReason.trim() || null,
        });
      } else {
        if (!reviewReason.trim()) {
          throw new Error('A reason is required to reject a stock verification.');
        }
        await api.verifications.reject(targetVerification.id, {
          note: reviewReason.trim(),
        });
      }
      setReviewModalOpen(false);
      setTargetVerification(null);
      setReviewReason('');
      void queryClient.invalidateQueries({ queryKey: ['stock-verifications'] });
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err) {
      setReviewError(errorMessage(err));
    } finally {
      setReviewing(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Verification"
        description="Physical stock count audits, discrepancy reviews, and approved inventory corrections (PRD §17)."
        actions={
          canSubmit ? (
            <Button size="sm" onClick={() => setSubmitModalOpen(true)}>
              + Submit Physical Count
            </Button>
          ) : undefined
        }
      />

      {/* Filter */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground uppercase">Status:</span>
            <Select
              className="h-8 text-xs py-1"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as VerificationStatus | 'ALL')}
            >
              <option value="ALL">All Counts</option>
              <option value="SUBMITTED">Pending Admin Review (SUBMITTED)</option>
              <option value="APPROVED">Approved & Adjusted</option>
              <option value="REJECTED">Rejected</option>
            </Select>
          </div>
          <span className="text-xs text-muted-foreground">
            Showing {items.length} verification record(s)
          </span>
        </div>
      </Card>

      <ListState
        loading={verificationsQuery.isLoading}
        error={verificationsQuery.error ? errorMessage(verificationsQuery.error) : null}
        empty={items.length === 0}
        emptyText="No stock count verifications found."
      />

      {items.length > 0 && (
        <Table
          head={[
            'Ref #',
            'Store',
            'Material',
            'System Qty',
            'Physical Count',
            'Variance (Diff)',
            'Submitted By',
            'Status',
            'Actions',
          ]}
        >
          {items.map((v: VerificationDto) => {
            const diff = Number(v.differenceQty);
            const isPending = v.status === 'SUBMITTED';

            return (
              <tr key={v.id} className="hover:bg-muted/40">
                <Td className="font-mono text-xs font-semibold">
                  {v.adjustmentReferenceNo ?? v.id.slice(0, 8)}
                </Td>
                <Td className="text-xs font-medium">{v.storeName}</Td>
                <Td>
                  <p className="font-medium text-xs leading-tight">{v.materialName}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">{v.materialCode}</p>
                </Td>
                <Td className="tabular-nums font-mono text-xs">
                  {v.systemQty} {v.unitCode}
                </Td>
                <Td className="tabular-nums font-mono text-xs font-bold text-foreground">
                  {v.physicalQty} {v.unitCode}
                </Td>
                <Td className="tabular-nums font-mono text-xs">
                  <span
                    className={cn(
                      'px-1.5 py-0.5 rounded font-semibold',
                      diff === 0
                        ? 'text-muted-foreground'
                        : diff > 0
                          ? 'bg-success/15 text-success'
                          : 'bg-danger/15 text-danger',
                    )}
                  >
                    {diff > 0 ? `+${v.differenceQty}` : v.differenceQty} {v.unitCode}
                  </span>
                </Td>
                <Td className="text-xs text-muted-foreground">
                  <p>{v.submittedByName}</p>
                  <p className="text-[10px]">
                    {new Date(v.submittedAt).toLocaleDateString([], {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </p>
                </Td>
                <Td>
                  <Badge
                    tone={
                      v.status === 'APPROVED'
                        ? 'success'
                        : v.status === 'SUBMITTED'
                          ? 'warning'
                          : v.status === 'REJECTED'
                            ? 'danger'
                            : 'neutral'
                    }
                  >
                    {v.status}
                  </Badge>
                </Td>
                <Td>
                  {isPending && canReview ? (
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="primary"
                        className="h-7 px-2 text-xs"
                        onClick={() => {
                          setTargetVerification(v);
                          setReviewAction('APPROVE');
                          setReviewModalOpen(true);
                        }}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7 px-2 text-xs text-danger"
                        onClick={() => {
                          setTargetVerification(v);
                          setReviewAction('REJECT');
                          setReviewModalOpen(true);
                        }}
                      >
                        Reject
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {v.reviewedAt ? `Reviewed by ${v.reviewedByName ?? 'Admin'}` : '—'}
                    </span>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      )}

      {/* ── Submit Physical Count Modal ───────────────────────────────────── */}
      {submitModalOpen && (
        <Modal title="Submit Physical Stock Count" onClose={() => setSubmitModalOpen(false)}>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Enter your physical on-site count. System balance will be compared automatically. Upon
              admin review, an approved count will post a stock correction adjustment.
            </p>

            {submitError && <Alert>{submitError}</Alert>}

            <Field label="Store">
              {(id) => (
                <Select
                  id={id}
                  value={newStoreId}
                  onChange={(e) => setNewStoreId(e.target.value)}
                  required
                >
                  {authorizedStores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="Material">
              {(id) => (
                <Select
                  id={id}
                  value={newMaterialId}
                  onChange={(e) => setNewMaterialId(e.target.value)}
                  required
                >
                  <option value="">Select material…</option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code} — {m.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            {selectedMat && (
              <div className="grid grid-cols-2 gap-3 p-3 rounded-md bg-muted/30 text-xs">
                <div>
                  <span className="text-muted-foreground">Current System Balance:</span>
                  <p className="font-mono font-bold text-sm">
                    {systemQty} {selectedMat.stockUnitCode}
                  </p>
                </div>
                {variance !== null && (
                  <div>
                    <span className="text-muted-foreground">Calculated Variance:</span>
                    <p
                      className={cn(
                        'font-mono font-bold text-sm',
                        Number(variance) === 0
                          ? 'text-foreground'
                          : Number(variance) > 0
                            ? 'text-success'
                            : 'text-danger',
                      )}
                    >
                      {Number(variance) > 0 ? `+${variance}` : variance} {selectedMat.stockUnitCode}
                    </p>
                  </div>
                )}
              </div>
            )}

            <Field label="Physical Count (On-Site Stock)">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  step="any"
                  min="0"
                  placeholder="0.00"
                  value={newPhysicalCount}
                  onChange={(e) => setNewPhysicalCount(e.target.value)}
                  required
                />
              )}
            </Field>

            <Field label="Notes / Explanation">
              {(id) => (
                <Textarea
                  id={id}
                  placeholder="e.g. Monthly physical audit count…"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                />
              )}
            </Field>

            <div className="flex justify-end gap-3 pt-3 border-t">
              <Button
                variant="secondary"
                onClick={() => setSubmitModalOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmitCount}
                disabled={submitting || !newMaterialId || !newPhysicalCount}
              >
                {submitting ? 'Submitting…' : 'Submit Count for Approval'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Admin Review Modal ────────────────────────────────────────────── */}
      {reviewModalOpen && targetVerification && (
        <Modal
          title={
            reviewAction === 'APPROVE'
              ? `Approve Count & Post Adjustment — ${targetVerification.materialCode}`
              : `Reject Count — ${targetVerification.materialCode}`
          }
          onClose={() => setReviewModalOpen(false)}
        >
          <div className="space-y-4">
            {reviewAction === 'APPROVE' ? (
              <Alert tone="info" title="Automatic Ledger Correction">
                Approving this physical count will immediately post a{' '}
                <strong>COUNT_CORRECTION</strong> adjustment of{' '}
                <span className="font-mono font-bold">
                  {Number(targetVerification.differenceQty) > 0
                    ? `+${targetVerification.differenceQty}`
                    : targetVerification.differenceQty}{' '}
                  {targetVerification.unitCode}
                </span>{' '}
                to bring system balance to exactly {targetVerification.physicalQty}{' '}
                {targetVerification.unitCode}.
              </Alert>
            ) : (
              <Alert tone="warning" title="Count Rejected">
                Rejecting this verification will not change any stock balances or ledger rows.
              </Alert>
            )}

            {reviewError && <Alert>{reviewError}</Alert>}

            <div className="rounded-md border p-3 text-xs space-y-1 bg-muted/20">
              <p>
                <strong>Material:</strong> {targetVerification.materialName} (
                {targetVerification.materialCode})
              </p>
              <p>
                <strong>Store:</strong> {targetVerification.storeName}
              </p>
              <p>
                <strong>System Snapshot:</strong> {targetVerification.systemQty}{' '}
                {targetVerification.unitCode}
              </p>
              <p>
                <strong>Physical Count:</strong> {targetVerification.physicalQty}{' '}
                {targetVerification.unitCode}
              </p>
              <p>
                <strong>Variance:</strong> {targetVerification.differenceQty}{' '}
                {targetVerification.unitCode}
              </p>
              {targetVerification.reason && (
                <p>
                  <strong>Submitter Reason:</strong> {targetVerification.reason}
                </p>
              )}
            </div>

            <Field
              label={
                reviewAction === 'APPROVE'
                  ? 'Review Notes (optional)'
                  : 'Rejection Reason (required)'
              }
            >
              {(id) => (
                <Textarea
                  id={id}
                  placeholder={
                    reviewAction === 'APPROVE'
                      ? 'e.g. Verified by site supervisor.'
                      : 'Provide justification for rejection…'
                  }
                  value={reviewReason}
                  onChange={(e) => setReviewReason(e.target.value)}
                  required={reviewAction === 'REJECT'}
                />
              )}
            </Field>

            <div className="flex justify-end gap-3 pt-3 border-t">
              <Button
                variant="secondary"
                onClick={() => setReviewModalOpen(false)}
                disabled={reviewing}
              >
                Cancel
              </Button>
              <Button
                variant={reviewAction === 'APPROVE' ? 'primary' : 'danger'}
                onClick={handleReview}
                disabled={reviewing || (reviewAction === 'REJECT' && !reviewReason.trim())}
              >
                {reviewing
                  ? 'Processing…'
                  : reviewAction === 'APPROVE'
                    ? 'Approve & Adjust Stock'
                    : 'Reject Verification'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
