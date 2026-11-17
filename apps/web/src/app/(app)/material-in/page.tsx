'use client';

import type { PostingDto, QuickReceiveInput, ReceiptInput } from '@kavach/shared';
import { convert } from '@kavach/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { InvoiceInbox } from '@/components/invoice-inbox';
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
} from '@/components/ui';
import { api, errorMessage, useSession } from '@/lib/session';
import { useStore } from '@/lib/store-context';
import { cn } from '@/lib/utils';

interface ReceiptLineItem {
  id: string;
  materialId: string;
  acceptedQty: string;
  damagedQty: string;
  unitId: string;
  notes: string;
}

export default function MaterialInPage() {
  const { can } = useSession();
  const { selectedStoreId, authorizedStores } = useStore();
  const queryClient = useQueryClient();

  // AI-powered scanning is the primary receiving method (PRD §10.1).
  const [tab, setTab] = useState<'scan' | 'standard' | 'quick'>('scan');

  // Master data queries
  const materialsQuery = useQuery({
    queryKey: ['materials', 'active'],
    queryFn: () => api.materials.list({ status: 'ACTIVE', pageSize: 200 }),
  });
  const unitsQuery = useQuery({ queryKey: ['units'], queryFn: api.units.list });
  const conversionsQuery = useQuery({ queryKey: ['conversions'], queryFn: api.conversions.list });
  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: api.categories.list });

  const materials = useMemo(() => materialsQuery.data?.items ?? [], [materialsQuery.data?.items]);
  const units = useMemo(() => unitsQuery.data ?? [], [unitsQuery.data]);
  const conversions = useMemo(() => conversionsQuery.data ?? [], [conversionsQuery.data]);
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);

  const defaultStoreId =
    selectedStoreId !== 'ALL' ? selectedStoreId : (authorizedStores[0]?.id ?? '');

  // ── Standard Receipt Form State ───────────────────────────────────────────
  const [storeId, setStoreId] = useState(defaultStoreId);
  const [supplierName, setSupplierName] = useState('');
  const [externalRef, setExternalRef] = useState('');

  const [lines, setLines] = useState<ReceiptLineItem[]>([
    {
      id: '1',
      materialId: '',
      acceptedQty: '',
      damagedQty: '0',
      unitId: '',
      notes: '',
    },
  ]);

  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [postedReceipt, setPostedReceipt] = useState<PostingDto | null>(null);

  // ── Quick Receive Form State ──────────────────────────────────────────────
  const [qrStoreId, setQrStoreId] = useState(defaultStoreId);
  const [qrIsNewMaterial, setQrIsNewMaterial] = useState(false);
  const [qrMaterialId, setQrMaterialId] = useState('');
  const [qrName, setQrName] = useState('');
  const [qrCategoryId, setQrCategoryId] = useState('');
  const [qrStockUnitId, setQrStockUnitId] = useState('');
  const [qrPackSize, setQrPackSize] = useState('');
  const [qrDuplicateWarning, setQrDuplicateWarning] = useState<string | null>(null);
  const [qrConfirmNotDuplicate, setQrConfirmNotDuplicate] = useState(false);

  const [qrAcceptedQty, setQrAcceptedQty] = useState('');
  const [qrDamagedQty, setQrDamagedQty] = useState('0');
  const [qrUnitId, setQrUnitId] = useState('');
  const [qrSupplierName, setQrSupplierName] = useState('');
  const [qrExternalRef, setQrExternalRef] = useState('');
  const [qrNotes, setQrNotes] = useState('');

  // Conversion map for real-time preview
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

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        materialId: '',
        acceptedQty: '',
        damagedQty: '0',
        unitId: '',
        notes: '',
      },
    ]);
  };

  const removeLine = (id: string) => {
    if (lines.length <= 1) return;
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const updateLine = (id: string, updates: Partial<ReceiptLineItem>) => {
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

  // Check duplicate on blur for quick receive new material
  const checkQrDuplicates = async () => {
    if (!qrName.trim() || !qrCategoryId || !qrStockUnitId) return;
    try {
      const res = await api.materials.checkDuplicates({
        name: qrName.trim(),
        categoryId: qrCategoryId,
        stockUnitId: qrStockUnitId,
      });
      if (res.candidates.length > 0) {
        setQrDuplicateWarning(
          `Found ${res.candidates.length} similar existing material(s): ${res.candidates.map((c) => c.material.name).join(', ')}.`,
        );
      } else {
        setQrDuplicateWarning(null);
      }
    } catch {
      // ignore
    }
  };

  const canPost = can('material_in:create');

  // Submit Standard Receipt
  const handlePostReceipt = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const targetStoreId = storeId || defaultStoreId;
      const idempotencyKey = `ik-rec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const payload: ReceiptInput = {
        storeId: targetStoreId,
        supplierName: supplierName.trim(),
        externalRef: externalRef.trim(),
        lines: lines.map((l) => ({
          materialId: l.materialId,
          acceptedQuantity: l.acceptedQty || null,
          damagedQuantity: Number(l.damagedQty) > 0 ? l.damagedQty : null,
          unitId: l.unitId || null,
          notes: l.notes.trim() || null,
        })),
      };

      const result = await api.inventory.receipt(payload, idempotencyKey);
      setPostedReceipt(result);
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

  // Submit Quick Receive
  const handlePostQuickReceive = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const targetStoreId = qrStoreId || defaultStoreId;
      const idempotencyKey = `ik-qr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      const payload: QuickReceiveInput = {
        storeId: targetStoreId,
        materialId: qrIsNewMaterial ? null : qrMaterialId,
        newMaterial: qrIsNewMaterial
          ? {
              name: qrName.trim(),
              categoryId: qrCategoryId,
              stockUnitId: qrStockUnitId,
              packSize: qrPackSize ? qrPackSize : null,
              confirmNotDuplicate: qrConfirmNotDuplicate,
            }
          : null,
        quantity: qrAcceptedQty,
        unitId: qrUnitId || null,
        supplierName: qrSupplierName.trim(),
        externalRef: qrExternalRef.trim() || null,
        notes: qrNotes.trim() || null,
      };

      const result = await api.inventory.quickReceive(payload, idempotencyKey);
      setPostedReceipt(result);
      setConfirmModalOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      void queryClient.invalidateQueries({ queryKey: ['materials'] });
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setPostedReceipt(null);
    setSupplierName('');
    setExternalRef('');
    setLines([
      {
        id: String(Date.now()),
        materialId: '',
        acceptedQty: '',
        damagedQty: '0',
        unitId: '',
        notes: '',
      },
    ]);
    setQrName('');
    setQrAcceptedQty('');
    setQrDamagedQty('0');
    setQrSupplierName('');
    setQrDuplicateWarning(null);
    setQrConfirmNotDuplicate(false);
  };

  if (!canPost) {
    // A Project Admin views documents and receipts but does not receive (PRD §3.1, DECISIONS Q4).
    return (
      <div className="space-y-6">
        <PageHeader
          title="Material In"
          description="Documents scanned by Store Managers, and the receipts posted from them."
        />
        <Alert tone="info">
          Material is received by Store Managers. You can open every document and receipt.
        </Alert>
        <InvoiceInbox />
      </div>
    );
  }

  // ── Success State ───────────────────────────────────────────────────────────
  if (postedReceipt) {
    return (
      <div className="mx-auto max-w-2xl py-8 text-center space-y-6">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/15 text-3xl text-success">
          ✓
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Receipt Successfully Posted!</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Ledger posting completed. Reference:{' '}
            <span className="font-mono font-semibold text-foreground">
              {postedReceipt.referenceNo}
            </span>
          </p>
        </div>

        <Card className="p-6 text-left space-y-3">
          <div className="flex justify-between border-b pb-2 text-sm">
            <span className="text-muted-foreground">Type</span>
            <Badge tone="success">{postedReceipt.type}</Badge>
          </div>
          <div className="flex justify-between border-b pb-2 text-sm">
            <span className="text-muted-foreground">Store</span>
            <span className="font-medium">{postedReceipt.storeName}</span>
          </div>
          <div className="flex justify-between border-b pb-2 text-sm">
            <span className="text-muted-foreground">Supplier</span>
            <span className="font-medium">{postedReceipt.supplierName}</span>
          </div>
          <div className="flex justify-between border-b pb-2 text-sm">
            <span className="text-muted-foreground">Lines Recorded</span>
            <span className="font-medium">{postedReceipt.lines.length} lines</span>
          </div>
        </Card>

        <div className="flex flex-wrap justify-center gap-3">
          <Link href={`/material-in/receipts/${postedReceipt.id}`}>
            <Button>View Receipt</Button>
          </Link>
          <Link href={`/material-in/receipts/${postedReceipt.id}?print=1`}>
            <Button variant="secondary">Download Receipt</Button>
          </Link>
          <Button variant="secondary" onClick={resetForm}>
            Receive Another
          </Button>
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
        title="Material In"
        description="Scan the invoice or challan and let KAVACH read it, or enter a receipt by hand."
      />

      {/* Tabs */}
      <div className="flex flex-wrap border-b border-border">
        <button
          type="button"
          onClick={() => {
            setTab('scan');
            setSubmitError(null);
          }}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === 'scan'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          Scan / Upload Invoice
        </button>
        <button
          type="button"
          onClick={() => {
            setTab('standard');
            setSubmitError(null);
          }}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === 'standard'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          Manual Receipt
        </button>
        <button
          type="button"
          onClick={() => {
            setTab('quick');
            setSubmitError(null);
          }}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === 'quick'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          ⚡ Quick Receive
        </button>
      </div>

      {submitError && <Alert>{submitError}</Alert>}

      {tab === 'scan' && <InvoiceInbox />}

      {/* ── Standard Receipt Form ────────────────────────────────────────── */}
      {tab === 'standard' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setConfirmModalOpen(true);
          }}
          className="space-y-6"
        >
          <Card className="p-5 space-y-4">
            <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
              Shipment Information
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Receiving Store">
                {(id) => (
                  <Select
                    id={id}
                    value={storeId}
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

              <Field label="Supplier / Vendor Name">
                {(id) => (
                  <Input
                    id={id}
                    placeholder="e.g. UltraTech Cement Ltd."
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    required
                  />
                )}
              </Field>

              <Field label="Challan / Invoice Number">
                {(id) => (
                  <Input
                    id={id}
                    placeholder="e.g. DC-2026-904"
                    value={externalRef}
                    onChange={(e) => setExternalRef(e.target.value)}
                    required
                  />
                )}
              </Field>
            </div>
          </Card>

          {/* Line items table */}
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
                Line Items ({lines.length})
              </h2>
              <Button type="button" size="sm" variant="secondary" onClick={addLine}>
                + Add Line
              </Button>
            </div>

            <div className="space-y-3">
              {lines.map((line, index) => {
                const selectedMat = materials.find((m) => m.id === line.materialId);
                const selectedUnit = units.find((u) => u.id === line.unitId);
                const stockUnit = units.find((u) => u.id === selectedMat?.stockUnitId);

                let conversionNote: string | null = null;
                if (
                  selectedMat &&
                  line.acceptedQty &&
                  line.unitId &&
                  line.unitId !== selectedMat.stockUnitId
                ) {
                  const res = convert(line.acceptedQty, line.unitId, selectedMat.stockUnitId, {
                    ...conversionMap,
                    material: {
                      id: selectedMat.id,
                      stockUnitId: selectedMat.stockUnitId,
                      packSize: selectedMat.packSize,
                      packUnitId: selectedMat.packUnitId,
                      isVariableWeight: selectedMat.isVariableWeight,
                    },
                    allowMaterialSpecific: true,
                  });
                  if (res.ok) {
                    conversionNote = `Converted to stock unit: ${res.qty.toFixed(stockUnit?.decimalPlaces ?? 2)} ${stockUnit?.code ?? ''}`;
                  } else {
                    conversionNote = `⚠️ Cannot convert ${selectedUnit?.code ?? ''} to ${stockUnit?.code ?? ''}`;
                  }
                }

                return (
                  <div
                    key={line.id}
                    className="rounded-md border border-border p-3 space-y-3 bg-muted/20"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground">
                        Item #{index + 1}
                      </span>
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

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
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
                        <Field label="Accepted Qty" hint="Good condition">
                          {(id) => (
                            <Input
                              id={id}
                              type="number"
                              step="any"
                              min="0.0001"
                              placeholder="0.00"
                              value={line.acceptedQty}
                              onChange={(e) => updateLine(line.id, { acceptedQty: e.target.value })}
                              required
                            />
                          )}
                        </Field>
                      </div>

                      <div>
                        <Field label="Damaged on Delivery" hint="Damaged bucket">
                          {(id) => (
                            <Input
                              id={id}
                              type="number"
                              step="any"
                              min="0"
                              placeholder="0"
                              value={line.damagedQty}
                              onChange={(e) => updateLine(line.id, { damagedQty: e.target.value })}
                            />
                          )}
                        </Field>
                      </div>

                      <div>
                        <Field
                          label="Unit"
                          hint={stockUnit ? `Stock: ${stockUnit.code}` : undefined}
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
                              placeholder="e.g. Batch #4"
                              value={line.notes}
                              onChange={(e) => updateLine(line.id, { notes: e.target.value })}
                            />
                          )}
                        </Field>
                      </div>
                    </div>

                    {conversionNote && (
                      <p className="text-xs font-mono text-primary bg-primary/10 px-2 py-1 rounded">
                        {conversionNote}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="pt-2">
              <Button type="button" variant="secondary" size="sm" onClick={addLine}>
                + Add Another Material Line
              </Button>
            </div>
          </Card>

          <div className="flex justify-end gap-3">
            <Button
              type="submit"
              disabled={
                submitting ||
                !supplierName.trim() ||
                !externalRef.trim() ||
                lines.some((l) => !l.materialId || !l.acceptedQty || !l.unitId)
              }
            >
              Review & Post Receipt →
            </Button>
          </div>
        </form>
      )}

      {/* ── Quick Receive Form ───────────────────────────────────────────── */}
      {tab === 'quick' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setConfirmModalOpen(true);
          }}
          className="space-y-6"
        >
          <Card className="p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
              <div>
                <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
                  ⚡ Quick Receive (Single Item Fast Intake)
                </h2>
                <p className="text-xs text-muted-foreground">
                  Receive an urgent delivery or uncatalogued item without a prior PO.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Create new SKU inline?</span>
                <input
                  type="checkbox"
                  id="qr-is-new"
                  checked={qrIsNewMaterial}
                  onChange={(e) => setQrIsNewMaterial(e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Store">
                {(id) => (
                  <Select
                    id={id}
                    value={qrStoreId}
                    onChange={(e) => setQrStoreId(e.target.value)}
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

              <Field label="Supplier / Vendor">
                {(id) => (
                  <Input
                    id={id}
                    placeholder="e.g. Local Supplier"
                    value={qrSupplierName}
                    onChange={(e) => setQrSupplierName(e.target.value)}
                    required
                  />
                )}
              </Field>

              <Field label="Reference / Gate Pass #">
                {(id) => (
                  <Input
                    id={id}
                    placeholder="e.g. GP-0199"
                    value={qrExternalRef}
                    onChange={(e) => setQrExternalRef(e.target.value)}
                  />
                )}
              </Field>
            </div>

            {/* Material selector or creator */}
            {!qrIsNewMaterial ? (
              <div className="border-t pt-4">
                <Field label="Existing Material SKU">
                  {(id) => (
                    <Select
                      id={id}
                      value={qrMaterialId}
                      onChange={(e) => {
                        setQrMaterialId(e.target.value);
                        const mat = materials.find((m) => m.id === e.target.value);
                        if (mat) setQrUnitId(mat.stockUnitId);
                      }}
                      required
                    >
                      <option value="">Select existing material…</option>
                      {materials.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.code} — {m.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
            ) : (
              <div className="border-t pt-4 space-y-4 rounded-md bg-primary/5 p-4 border border-primary/20">
                <p className="text-xs font-semibold text-primary uppercase">
                  + Create New Material Inline
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Category">
                    {(id) => (
                      <Select
                        id={id}
                        value={qrCategoryId}
                        onChange={(e) => setQrCategoryId(e.target.value)}
                        required
                      >
                        <option value="">Select category…</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>

                  <Field label="Material Name">
                    {(id) => (
                      <Input
                        id={id}
                        placeholder="e.g. Steel Binding Wire 18G"
                        value={qrName}
                        onChange={(e) => setQrName(e.target.value)}
                        onBlur={checkQrDuplicates}
                        required
                      />
                    )}
                  </Field>

                  <Field label="Stock Unit">
                    {(id) => (
                      <Select
                        id={id}
                        value={qrStockUnitId}
                        onChange={(e) => {
                          setQrStockUnitId(e.target.value);
                          setQrUnitId(e.target.value);
                        }}
                        required
                      >
                        <option value="">Select stock unit…</option>
                        {units.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.code} ({u.name})
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>

                  <Field label="Pack Size (optional)" hint="e.g. 50 kg">
                    {(id) => (
                      <Input
                        id={id}
                        placeholder="e.g. 50"
                        value={qrPackSize}
                        onChange={(e) => setQrPackSize(e.target.value)}
                      />
                    )}
                  </Field>
                </div>

                {qrDuplicateWarning && (
                  <Alert tone="warning" title="Potential Duplicate Detected">
                    <p>{qrDuplicateWarning}</p>
                    <label className="mt-2 flex items-center gap-2 text-xs font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={qrConfirmNotDuplicate}
                        onChange={(e) => setQrConfirmNotDuplicate(e.target.checked)}
                      />
                      Confirm this is NOT a duplicate and proceed with creation.
                    </label>
                  </Alert>
                )}
              </div>
            )}

            {/* Quantities */}
            <div className="border-t pt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Accepted Quantity" hint="Placed in Available bucket">
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    step="any"
                    min="0.0001"
                    placeholder="0.00"
                    value={qrAcceptedQty}
                    onChange={(e) => setQrAcceptedQty(e.target.value)}
                    required
                  />
                )}
              </Field>

              <Field label="Damaged on Delivery" hint="Placed in Damaged bucket">
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    step="any"
                    min="0"
                    placeholder="0"
                    value={qrDamagedQty}
                    onChange={(e) => setQrDamagedQty(e.target.value)}
                  />
                )}
              </Field>

              <Field label="Received Unit">
                {(id) => (
                  <Select
                    id={id}
                    value={qrUnitId}
                    onChange={(e) => setQrUnitId(e.target.value)}
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

            <div className="border-t pt-4">
              <Field label="Remarks / Notes (optional)">
                {(id) => (
                  <Input
                    id={id}
                    placeholder="Delivery notes, vehicle number, or comments"
                    value={qrNotes}
                    onChange={(e) => setQrNotes(e.target.value)}
                  />
                )}
              </Field>
            </div>
          </Card>

          <div className="flex justify-end gap-3">
            <Button
              type="submit"
              disabled={
                submitting ||
                !qrSupplierName.trim() ||
                !qrAcceptedQty ||
                (!qrIsNewMaterial && !qrMaterialId) ||
                (qrIsNewMaterial &&
                  (!qrName.trim() ||
                    !qrCategoryId ||
                    !qrStockUnitId ||
                    (qrDuplicateWarning !== null && !qrConfirmNotDuplicate)))
              }
            >
              Review & Quick Receive →
            </Button>
          </div>
        </form>
      )}

      {/* ── Pre-confirmation Modal ────────────────────────────────────────── */}
      {confirmModalOpen && (
        <Modal
          title={tab === 'standard' ? 'Confirm Delivery Receipt' : 'Confirm Quick Receive'}
          onClose={() => setConfirmModalOpen(false)}
          wide
        >
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Please review the details below before posting to the inventory ledger. This action is
              append-only and updates stock balances immediately.
            </p>

            <div className="rounded-md border p-3 text-sm space-y-1 bg-muted/20">
              <p>
                <strong>Supplier:</strong> {tab === 'standard' ? supplierName : qrSupplierName}
              </p>
              <p>
                <strong>Challan / Ref:</strong>{' '}
                {tab === 'standard' ? externalRef : qrExternalRef || 'None'}
              </p>
              <p>
                <strong>Destination Store:</strong>{' '}
                {authorizedStores.find((s) => s.id === (tab === 'standard' ? storeId : qrStoreId))
                  ?.name ?? 'Store'}
              </p>
            </div>

            {tab === 'standard' ? (
              <Table head={['#', 'Material', 'Accepted Qty', 'Damaged Qty', 'Unit']}>
                {lines.map((l, i) => {
                  const m = materials.find((mat) => mat.id === l.materialId);
                  const u = units.find((un) => un.id === l.unitId);
                  return (
                    <tr key={l.id}>
                      <Td>{i + 1}</Td>
                      <Td className="font-medium">{m?.name ?? '—'}</Td>
                      <Td className="tabular-nums font-semibold text-success">{l.acceptedQty}</Td>
                      <Td className="tabular-nums font-semibold text-danger">
                        {l.damagedQty || '0'}
                      </Td>
                      <Td>{u?.code ?? '—'}</Td>
                    </tr>
                  );
                })}
              </Table>
            ) : (
              <div className="rounded-md border p-3 text-sm space-y-2">
                <p>
                  <strong>Material:</strong>{' '}
                  {qrIsNewMaterial
                    ? `${qrName} (New SKU)`
                    : materials.find((m) => m.id === qrMaterialId)?.name}
                </p>
                <p>
                  <strong>Accepted Quantity:</strong> {qrAcceptedQty}{' '}
                  {units.find((u) => u.id === qrUnitId)?.code}
                </p>
                {Number(qrDamagedQty) > 0 && (
                  <p className="text-danger">
                    <strong>Damaged on Delivery:</strong> {qrDamagedQty}{' '}
                    {units.find((u) => u.id === qrUnitId)?.code}
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-3 border-t">
              <Button
                variant="secondary"
                onClick={() => setConfirmModalOpen(false)}
                disabled={submitting}
              >
                Back & Edit
              </Button>
              <Button
                onClick={tab === 'standard' ? handlePostReceipt : handlePostQuickReceive}
                disabled={submitting}
              >
                {submitting ? 'Posting Ledger…' : 'Confirm & Post to Ledger'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
