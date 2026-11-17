'use client';

import type { IssueInput, PostingDto, StockRowDto } from '@kavach/shared';
import { convert } from '@kavach/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
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

interface IssueLineItem {
  id: string;
  materialId: string;
  quantity: string;
  unitId: string;
  notes: string;
}

export default function MaterialOutPage() {
  const { can } = useSession();
  const { selectedStoreId, authorizedStores } = useStore();
  const queryClient = useQueryClient();

  const defaultStoreId =
    selectedStoreId !== 'ALL' ? selectedStoreId : (authorizedStores[0]?.id ?? '');

  const [storeId, setStoreId] = useState(defaultStoreId);
  const [locationId, setLocationId] = useState('');
  const [contractorId, setContractorId] = useState('');
  const [workOrder, setWorkOrder] = useState('');
  const [notes, setNotes] = useState('');

  const [lines, setLines] = useState<IssueLineItem[]>([
    { id: '1', materialId: '', quantity: '', unitId: '', notes: '' },
  ]);

  // Master data queries
  const materialsQuery = useQuery({
    queryKey: ['materials', 'active'],
    queryFn: () => api.materials.list({ status: 'ACTIVE', pageSize: 200 }),
  });
  const locationsQuery = useQuery({ queryKey: ['locations'], queryFn: api.locations.list });
  const contractorsQuery = useQuery({ queryKey: ['contractors'], queryFn: api.contractors.list });
  const unitsQuery = useQuery({ queryKey: ['units'], queryFn: api.units.list });
  const conversionsQuery = useQuery({ queryKey: ['conversions'], queryFn: api.conversions.list });

  // Current stock balances for selected store
  const activeStoreId = storeId || defaultStoreId;
  const stockQuery = useQuery({
    queryKey: ['stock', activeStoreId],
    queryFn: () => api.stock.list({ storeId: activeStoreId, pageSize: 200 }),
    enabled: !!activeStoreId,
  });

  const materials = useMemo(() => materialsQuery.data?.items ?? [], [materialsQuery.data?.items]);
  const locations = useMemo(
    () => (locationsQuery.data ?? []).filter((l) => l.isActive),
    [locationsQuery.data],
  );
  const contractors = useMemo(
    () => (contractorsQuery.data ?? []).filter((c) => c.isActive),
    [contractorsQuery.data],
  );
  const units = useMemo(() => unitsQuery.data ?? [], [unitsQuery.data]);
  const conversions = useMemo(() => conversionsQuery.data ?? [], [conversionsQuery.data]);
  const stockRows = useMemo(() => stockQuery.data?.items ?? [], [stockQuery.data?.items]);

  // Stock balance lookup by materialId
  const stockMap = useMemo(() => {
    const map = new Map<string, StockRowDto>();
    for (const r of stockRows) map.set(r.materialId, r);
    return map;
  }, [stockRows]);

  // Conversion context
  const conversionMap = useMemo(() => {
    const unitMap = new Map(units.map((u) => [u.id, { id: u.id, decimalPlaces: u.decimalPlaces }]));
    const convRows = conversions
      .filter((c) => c.isActive)
      .map((c) => ({
        fromUnitId: c.fromUnitId,
        toUnitId: c.toUnitId,
        factor: c.factor,
        materialId: c.materialId,
      }));
    return { units: unitMap, conversions: convRows };
  }, [units, conversions]);

  // Inline contractor add modal state (Q31)
  const [contractorModalOpen, setContractorModalOpen] = useState(false);
  const [newContractorName, setNewContractorName] = useState('');
  const [newContractorPhone, setNewContractorPhone] = useState('');
  const [newContractorWarning, setNewContractorWarning] = useState<string | null>(null);
  const [creatingContractor, setCreatingContractor] = useState(false);

  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [postedIssue, setPostedIssue] = useState<PostingDto | null>(null);

  const hasLineError = useMemo(() => {
    for (const line of lines) {
      if (!line.materialId || !line.quantity || !line.unitId) continue;
      const selectedMat = materials.find((m) => m.id === line.materialId);
      if (!selectedMat) continue;
      const stockBalance = stockMap.get(selectedMat.id);
      const availableQty = stockBalance ? Number(stockBalance.availableQty) : 0;
      let qtyInStockUnit = Number(line.quantity) || 0;
      if (line.unitId !== selectedMat.stockUnitId) {
        const res = convert(line.quantity, line.unitId, selectedMat.stockUnitId, {
          ...conversionMap,
          material: {
            id: selectedMat.id,
            stockUnitId: selectedMat.stockUnitId,
            packSize: selectedMat.packSize,
            packUnitId: selectedMat.packUnitId,
            isVariableWeight: selectedMat.isVariableWeight,
          },
          allowMaterialSpecific: false,
        });
        if (!res.ok) return true;
        qtyInStockUnit = res.qty.toNumber();
      }
      if (qtyInStockUnit > availableQty) return true;
    }
    return false;
  }, [lines, materials, stockMap, conversionMap]);

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      { id: String(Date.now()), materialId: '', quantity: '', unitId: '', notes: '' },
    ]);
  };

  const removeLine = (id: string) => {
    if (lines.length <= 1) return;
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const updateLine = (id: string, updates: Partial<IssueLineItem>) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, ...updates };
        if (updates.materialId && updates.materialId !== l.materialId) {
          const mat = materials.find((m) => m.id === updates.materialId);
          if (mat) next.unitId = mat.stockUnitId;
        }
        return next;
      }),
    );
  };

  // Inline contractor save (Q31)
  const handleSaveContractor = async () => {
    if (!newContractorName.trim()) return;
    setCreatingContractor(true);
    setNewContractorWarning(null);
    try {
      const created = await api.contractors.create({
        name: newContractorName.trim(),
        phone: newContractorPhone.trim() || undefined,
        confirmNotDuplicate: true,
      });
      await queryClient.invalidateQueries({ queryKey: ['contractors'] });
      setContractorId(created.id);
      setContractorModalOpen(false);
      setNewContractorName('');
      setNewContractorPhone('');
    } catch (err) {
      setNewContractorWarning(errorMessage(err));
    } finally {
      setCreatingContractor(false);
    }
  };

  // Post Issue
  const handlePostIssue = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const idempotencyKey = `ik-iss-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const combinedNotes = workOrder
        ? `WO: ${workOrder.trim()}. ${notes.trim()}`.trim()
        : notes.trim();
      const payload: IssueInput = {
        storeId: activeStoreId,
        locationId,
        contractorId: contractorId || null,
        notes: combinedNotes || null,
        lines: lines.map((l) => ({
          materialId: l.materialId,
          quantity: l.quantity,
          unitId: l.unitId || null,
        })),
      };

      const result = await api.inventory.issue(payload, idempotencyKey);
      setPostedIssue(result);
      setConfirmModalOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setPostedIssue(null);
    setLocationId('');
    setContractorId('');
    setWorkOrder('');
    setNotes('');
    setLines([{ id: String(Date.now()), materialId: '', quantity: '', unitId: '', notes: '' }]);
  };

  const canPost = can('material_out:create');
  if (!canPost) {
    return (
      <Alert tone="warning" title="Access Restricted">
        Only Store Managers with outward permissions can issue materials.
      </Alert>
    );
  }

  // ── Success State ───────────────────────────────────────────────────────────
  if (postedIssue) {
    return (
      <div className="mx-auto max-w-2xl py-8 text-center space-y-6">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-info/15 text-3xl text-primary">
          ✓
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Material Issue Successfully Posted!</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Ledger posting completed. Reference:{' '}
            <span className="font-mono font-semibold text-foreground">
              {postedIssue.referenceNo}
            </span>
          </p>
        </div>

        <Card className="p-6 text-left space-y-3">
          <div className="flex justify-between border-b pb-2 text-sm">
            <span className="text-muted-foreground">Posting Reference</span>
            <span className="font-mono font-semibold">{postedIssue.referenceNo}</span>
          </div>
          <div className="flex justify-between border-b pb-2 text-sm">
            <span className="text-muted-foreground">Store</span>
            <span className="font-medium">{postedIssue.storeName}</span>
          </div>
          <div className="flex justify-between border-b pb-2 text-sm">
            <span className="text-muted-foreground">Lines Issued</span>
            <span className="font-medium">{postedIssue.lines.length} items</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Stock Deduction</span>
            <Badge tone="info">AVAILABLE BUCKET DEDUCTED</Badge>
          </div>
        </Card>

        <div className="flex flex-wrap justify-center gap-3">
          <Button onClick={resetForm}>Issue More Materials</Button>
          <Link href="/stock">
            <Button variant="secondary">View Current Stock</Button>
          </Link>
          <Link href="/transactions">
            <Button variant="secondary">View Ledger Transactions</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Material Out (Issue)"
        description="Issue materials from the store to construction site locations and approved contractors."
      />

      {submitError && <Alert>{submitError}</Alert>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setConfirmModalOpen(true);
        }}
        className="space-y-6"
      >
        {/* Header card */}
        <Card className="p-5 space-y-4">
          <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
            Issue Details
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Issuing Store">
              {(id) => (
                <Select
                  id={id}
                  value={activeStoreId}
                  onChange={(e) => setStoreId(e.target.value)}
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

            <Field label="Destination Location">
              {(id) => (
                <Select
                  id={id}
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  required
                >
                  <option value="">Select site location…</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} ({loc.type})
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="contractor-select" className="text-sm font-medium">
                  Contractor
                </label>
                <button
                  type="button"
                  onClick={() => setContractorModalOpen(true)}
                  className="text-xs text-primary hover:underline font-medium"
                >
                  + Add New
                </button>
              </div>
              <Select
                id="contractor-select"
                value={contractorId}
                onChange={(e) => setContractorId(e.target.value)}
              >
                <option value="">None / Direct Site Issue</option>
                {contractors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.phone ? `(${c.phone})` : ''}
                  </option>
                ))}
              </Select>
            </div>

            <Field label="Work Order / Indent # (optional)">
              {(id) => (
                <Input
                  id={id}
                  placeholder="e.g. WO-8812"
                  value={workOrder}
                  onChange={(e) => setWorkOrder(e.target.value)}
                />
              )}
            </Field>
          </div>
        </Card>

        {/* Line Items Card */}
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
              Materials to Issue ({lines.length})
            </h2>
            <Button type="button" size="sm" variant="secondary" onClick={addLine}>
              + Add Item
            </Button>
          </div>

          <div className="space-y-4">
            {lines.map((line, index) => {
              const selectedMat = materials.find((m) => m.id === line.materialId);
              const selectedUnit = units.find((u) => u.id === line.unitId);
              const stockUnit = units.find((u) => u.id === selectedMat?.stockUnitId);
              const stockBalance = selectedMat ? stockMap.get(selectedMat.id) : null;
              const availableQty = stockBalance ? Number(stockBalance.availableQty) : 0;

              // Check conversion and available stock
              let convertedQtyInStockUnit = Number(line.quantity) || 0;
              let conversionMessage: string | null = null;
              let conversionError = false;

              if (
                selectedMat &&
                line.quantity &&
                line.unitId &&
                line.unitId !== selectedMat.stockUnitId
              ) {
                const res = convert(line.quantity, line.unitId, selectedMat.stockUnitId, {
                  ...conversionMap,
                  material: {
                    id: selectedMat.id,
                    stockUnitId: selectedMat.stockUnitId,
                    packSize: selectedMat.packSize,
                    packUnitId: selectedMat.packUnitId,
                    isVariableWeight: selectedMat.isVariableWeight,
                  },
                  allowMaterialSpecific: false,
                });

                if (res.ok) {
                  convertedQtyInStockUnit = res.qty.toNumber();
                  conversionMessage = `${line.quantity} ${selectedUnit?.code ?? ''} = ${res.qty.toFixed(stockUnit?.decimalPlaces ?? 2)} ${stockUnit?.code ?? ''}`;
                } else {
                  conversionError = true;
                  conversionMessage = `⚠️ No approved exact conversion between ${selectedUnit?.code ?? ''} and ${stockUnit?.code ?? ''} (Q10)`;
                }
              }

              const isOverStock =
                selectedMat &&
                Boolean(line.quantity) &&
                !conversionError &&
                convertedQtyInStockUnit > availableQty;

              return (
                <div
                  key={line.id}
                  className={cn(
                    'rounded-md border p-4 space-y-3',
                    isOverStock ? 'border-danger bg-danger/5' : 'border-border bg-muted/20',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-muted-foreground">
                        Line #{index + 1}
                      </span>
                      {selectedMat && (
                        <Badge tone={availableQty > 0 ? 'success' : 'danger'}>
                          Available: {availableQty} {stockUnit?.code}
                        </Badge>
                      )}
                    </div>
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLine(line.id)}
                        className="text-xs text-danger hover:underline"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <div className="lg:col-span-2">
                      <Field label="Material">
                        {(id) => (
                          <Select
                            id={id}
                            value={line.materialId}
                            onChange={(e) => updateLine(line.id, { materialId: e.target.value })}
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
                    </div>

                    <div>
                      <Field label="Issue Quantity">
                        {(id) => (
                          <Input
                            id={id}
                            type="number"
                            step="any"
                            min="0.0001"
                            placeholder="0.00"
                            value={line.quantity}
                            onChange={(e) => updateLine(line.id, { quantity: e.target.value })}
                            required
                          />
                        )}
                      </Field>
                    </div>

                    <div>
                      <Field
                        label="Unit"
                        hint={stockUnit ? `Stock unit: ${stockUnit.code}` : undefined}
                      >
                        {(id) => (
                          <Select
                            id={id}
                            value={line.unitId}
                            onChange={(e) => updateLine(line.id, { unitId: e.target.value })}
                            required
                          >
                            <option value="">Select unit…</option>
                            {units.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.code} ({u.name})
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                    </div>

                    <div>
                      <Field label="Notes (optional)">
                        {(id) => (
                          <Input
                            id={id}
                            placeholder="e.g. Column 4 casting"
                            value={line.notes}
                            onChange={(e) => updateLine(line.id, { notes: e.target.value })}
                          />
                        )}
                      </Field>
                    </div>
                  </div>

                  {conversionMessage && (
                    <div
                      className={cn(
                        'text-xs font-mono px-3 py-1.5 rounded',
                        conversionError ? 'bg-danger/10 text-danger' : 'bg-primary/10 text-primary',
                      )}
                    >
                      {conversionMessage}
                    </div>
                  )}

                  {isOverStock && (
                    <p className="text-xs font-semibold text-danger">
                      ⚠️ Insufficient Stock: entered {convertedQtyInStockUnit} {stockUnit?.code},
                      but only {availableQty} {stockUnit?.code} available in store.
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="pt-2">
            <Button type="button" variant="secondary" size="sm" onClick={addLine}>
              + Add Line
            </Button>
          </div>
        </Card>

        <Field label="General Notes / Remarks">
          {(id) => (
            <Textarea
              id={id}
              placeholder="Any additional details regarding this material issue…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          )}
        </Field>

        <div className="flex justify-end gap-3">
          <Button
            type="submit"
            disabled={
              submitting ||
              hasLineError ||
              !locationId ||
              lines.some((l) => !l.materialId || !l.quantity || !l.unitId)
            }
          >
            Review & Issue Material →
          </Button>
        </div>
      </form>

      {/* ── Pre-confirmation Modal ────────────────────────────────────────── */}
      {confirmModalOpen && (
        <Modal title="Confirm Material Issue" onClose={() => setConfirmModalOpen(false)} wide>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Please verify the items and quantities below. This will deduct stock from the{' '}
              <strong>AVAILABLE</strong> bucket immediately.
            </p>

            <div className="rounded-md border p-3 text-sm space-y-1 bg-muted/20">
              <p>
                <strong>Issuing Store:</strong>{' '}
                {authorizedStores.find((s) => s.id === activeStoreId)?.name}
              </p>
              <p>
                <strong>Destination Location:</strong>{' '}
                {locations.find((l) => l.id === locationId)?.name}
              </p>
              {contractorId && (
                <p>
                  <strong>Contractor:</strong>{' '}
                  {contractors.find((c) => c.id === contractorId)?.name}
                </p>
              )}
              {workOrder && (
                <p>
                  <strong>Work Order:</strong> {workOrder}
                </p>
              )}
            </div>

            <Table head={['#', 'Material', 'Issued Qty', 'Unit', 'Stock Deduction Equivalent']}>
              {lines.map((l, i) => {
                const m = materials.find((mat) => mat.id === l.materialId);
                const u = units.find((un) => un.id === l.unitId);
                const su = units.find((un) => un.id === m?.stockUnitId);
                return (
                  <tr key={l.id}>
                    <Td>{i + 1}</Td>
                    <Td className="font-medium">{m?.name ?? '—'}</Td>
                    <Td className="tabular-nums font-semibold text-danger">−{l.quantity}</Td>
                    <Td>{u?.code ?? '—'}</Td>
                    <Td className="font-mono text-xs text-muted-foreground">
                      {l.unitId === m?.stockUnitId
                        ? `−${l.quantity} ${su?.code}`
                        : `Converts to stock unit (${su?.code})`}
                    </Td>
                  </tr>
                );
              })}
            </Table>

            <div className="flex justify-end gap-3 pt-3 border-t">
              <Button
                variant="secondary"
                onClick={() => setConfirmModalOpen(false)}
                disabled={submitting}
              >
                Back & Edit
              </Button>
              <Button onClick={handlePostIssue} disabled={submitting}>
                {submitting ? 'Posting Issue…' : 'Confirm & Deduct Stock'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Inline Contractor Add Modal (Q31) ─────────────────────────────── */}
      {contractorModalOpen && (
        <Modal title="Add New Contractor Inline" onClose={() => setContractorModalOpen(false)}>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Add a new contractor inline. Admins can later merge or update contractor details.
            </p>

            {newContractorWarning && <Alert tone="warning">{newContractorWarning}</Alert>}

            <Field label="Contractor / Vendor Name">
              {(id) => (
                <Input
                  id={id}
                  placeholder="e.g. Ramesh Constructions"
                  value={newContractorName}
                  onChange={(e) => setNewContractorName(e.target.value)}
                  required
                />
              )}
            </Field>

            <Field label="Phone (optional)">
              {(id) => (
                <Input
                  id={id}
                  placeholder="e.g. +91 98765 43210"
                  value={newContractorPhone}
                  onChange={(e) => setNewContractorPhone(e.target.value)}
                />
              )}
            </Field>

            <div className="flex justify-end gap-3 pt-3 border-t">
              <Button
                variant="secondary"
                onClick={() => setContractorModalOpen(false)}
                disabled={creatingContractor}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveContractor}
                disabled={creatingContractor || !newContractorName.trim()}
              >
                {creatingContractor ? 'Adding…' : 'Add & Select Contractor'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
