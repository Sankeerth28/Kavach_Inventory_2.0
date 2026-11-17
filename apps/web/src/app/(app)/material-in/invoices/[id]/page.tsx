'use client';

import { ApiError } from '@kavach/api-client';
import {
  DISCREPANCY_REASONS,
  type DiscrepancyReason,
  type DuplicateCheckResult,
  type InvoiceDetailDto,
  type InvoiceItemDto,
  PROCESSING_STAGES,
  type PostingDto,
  type ProposedMaterial,
  type UpdateInvoiceHeaderInput,
  type UpdateInvoiceItemInput,
  confidenceBand,
} from '@kavach/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { STATUS_LABEL, statusTone } from '@/components/invoice-inbox';
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
  Textarea,
} from '@/components/ui';
import { api, errorMessage, useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

/** PRD §10.2 screen 2. */
const STAGE_LABELS = [
  'Uploading',
  'Checking Document Quality',
  'Reading Invoice',
  'Identifying Materials',
  'Matching Material Master',
  'Preparing Receipt',
];

const REASON_LABEL: Record<DiscrepancyReason, string> = {
  SHORT_SUPPLY: 'Short supply',
  DAMAGED: 'Damaged',
  REJECTED: 'Rejected',
  EXCESS: 'Excess supplied',
  OTHER: 'Other',
};

const newKey = () =>
  `inv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 8)}`;

/** A text input that saves when the user leaves it, and only if the value changed. */
function Commit({
  value,
  onCommit,
  disabled,
  uncertain,
  className,
  ...rest
}: {
  value: string;
  onCommit: (v: string) => void;
  disabled?: boolean;
  uncertain?: boolean;
  className?: string;
  type?: string;
  inputMode?: 'decimal' | 'text';
  placeholder?: string;
  id?: string;
  'aria-label'?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  return (
    <Input
      {...rest}
      value={draft}
      disabled={disabled}
      className={cn(uncertain && 'border-warning ring-1 ring-warning/60', className)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() !== value && onCommit(draft.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function Confidence({
  score,
  thresholds,
}: {
  score: number | null;
  thresholds: { auto: number; confirm: number };
}) {
  if (score === null) return null;
  const band = confidenceBand(score, thresholds);
  return (
    <Badge tone={band === 'HIGH' ? 'success' : band === 'MEDIUM' ? 'warning' : 'danger'}>
      {band === 'HIGH' ? 'High' : band === 'MEDIUM' ? 'Medium' : 'Low'} {Math.round(score * 100)}%
    </Badge>
  );
}

/** PRD §20.4 E: the original document beside the extracted data. */
function DocumentPreview({ invoice }: { invoice: InvoiceDetailDto }) {
  const [pageNo, setPageNo] = useState(invoice.pages[0]?.pageNo ?? 1);
  const page = invoice.pages.find((p) => p.pageNo === pageNo) ?? invoice.pages[0];
  const file = useQuery({
    queryKey: ['invoice-page', invoice.id, page?.pageNo],
    queryFn: () => api.invoices.pageContent(invoice.id, page!.pageNo),
    enabled: !!page && !page.purged,
    staleTime: Infinity,
    gcTime: 60_000,
  });
  const url = useMemo(() => (file.data ? URL.createObjectURL(file.data) : null), [file.data]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  if (!page) return <p className="text-sm text-muted-foreground">No pages.</p>;
  return (
    <div className="space-y-2">
      {invoice.pages.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {invoice.pages.map((p) => (
            <Button
              key={p.pageNo}
              size="sm"
              variant={p.pageNo === page.pageNo ? 'primary' : 'secondary'}
              onClick={() => setPageNo(p.pageNo)}
            >
              Page {p.pageNo}
            </Button>
          ))}
        </div>
      )}
      {page.purged ? (
        <Alert tone="info">The stored file was removed after the retention period.</Alert>
      ) : file.error ? (
        <Alert>{errorMessage(file.error)}</Alert>
      ) : !url ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading document…</p>
      ) : page.mimeType === 'application/pdf' ? (
        <iframe
          title={`Document page ${page.pageNo}`}
          src={url}
          className="h-[75vh] w-full rounded-md border border-border bg-white"
        />
      ) : (
        <a href={url} target="_blank" rel="noreferrer" title="Open full size">
          {/* eslint-disable-next-line @next/next/no-img-element -- a private blob URL, not an optimisable asset */}
          <img
            src={url}
            alt={`Document page ${page.pageNo}`}
            className="max-h-[75vh] w-full rounded-md border border-border object-contain"
          />
        </a>
      )}
    </div>
  );
}

interface Masters {
  materials: { id: string; code: string; name: string; stockUnitCode: string }[];
  units: { id: string; code: string; name: string }[];
  categories: { id: string; name: string }[];
}

function NewMaterialForm({
  value,
  masters,
  disabled,
  onSave,
}: {
  value: ProposedMaterial;
  masters: Masters;
  disabled: boolean;
  onSave: (p: ProposedMaterial) => void;
}) {
  const [similar, setSimilar] = useState<DuplicateCheckResult | null>(null);
  const set = (patch: Partial<ProposedMaterial>) => onSave({ ...value, ...patch });

  // PRD §6.5: show what already exists before a new material is created.
  const complete = !!value.name && !!value.categoryId && !!value.stockUnitId;
  const probe = `${value.name}|${value.categoryId}|${value.stockUnitId}|${value.grade}|${value.size}|${value.brand}|${value.packSize}|${value.packUnitId}`;
  useEffect(() => {
    if (!complete) return;
    let live = true;
    api.materials
      .checkDuplicates({
        name: value.name,
        categoryId: value.categoryId!,
        stockUnitId: value.stockUnitId!,
        brand: value.brand,
        grade: value.grade,
        size: value.size,
        specification: value.specification,
        packSize: value.packUnitId ? value.packSize : null,
        packUnitId: value.packSize ? value.packUnitId : null,
      })
      .then((r) => live && setSimilar(r))
      .catch(() => live && setSimilar(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `probe` stands for the fields above
  }, [probe, complete]);

  const shown = complete ? similar : null;
  return (
    <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 p-3">
      <p className="mb-2 text-xs font-semibold text-primary uppercase">
        New material — will be created when you confirm
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Material name" className="sm:col-span-2">
          {(id) => (
            <Commit
              id={id}
              value={value.name}
              disabled={disabled}
              onCommit={(name) => name && set({ name })}
            />
          )}
        </Field>
        <Field label="Category">
          {(id) => (
            <Select
              id={id}
              value={value.categoryId ?? ''}
              disabled={disabled}
              onChange={(e) => set({ categoryId: e.target.value || null })}
            >
              <option value="">Choose…</option>
              {masters.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Stock unit">
          {(id) => (
            <Select
              id={id}
              value={value.stockUnitId ?? ''}
              disabled={disabled}
              onChange={(e) => set({ stockUnitId: e.target.value || null })}
            >
              <option value="">Choose…</option>
              {masters.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Brand">
          {(id) => (
            <Commit
              id={id}
              value={value.brand ?? ''}
              disabled={disabled}
              onCommit={(v) => set({ brand: v || null })}
            />
          )}
        </Field>
        <Field label="Grade">
          {(id) => (
            <Commit
              id={id}
              value={value.grade ?? ''}
              disabled={disabled}
              onCommit={(v) => set({ grade: v || null })}
            />
          )}
        </Field>
        <Field label="Size">
          {(id) => (
            <Commit
              id={id}
              value={value.size ?? ''}
              disabled={disabled}
              onCommit={(v) => set({ size: v || null })}
            />
          )}
        </Field>
        <Field label="Specification">
          {(id) => (
            <Commit
              id={id}
              value={value.specification ?? ''}
              disabled={disabled}
              onCommit={(v) => set({ specification: v || null })}
            />
          )}
        </Field>
        <Field label="Pack size" hint="Only if printed on the pack. Never assumed.">
          {(id) => (
            <Commit
              id={id}
              inputMode="decimal"
              value={value.packSize ?? ''}
              disabled={disabled}
              onCommit={(v) =>
                set({ packSize: v || null, packUnitId: v ? value.packUnitId : null })
              }
            />
          )}
        </Field>
        <Field label="Pack unit">
          {(id) => (
            <Select
              id={id}
              value={value.packUnitId ?? ''}
              disabled={disabled || !value.packSize}
              onChange={(e) => set({ packUnitId: e.target.value || null })}
            >
              <option value="">—</option>
              {masters.units
                .filter((u) => u.id !== value.stockUnitId)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
      </div>
      {shown?.exact && (
        <div className="mt-2">
          <Alert>
            This material already exists: {shown.candidates[0]?.material.name} (
            {shown.candidates[0]?.material.code}). Choose it instead of creating a new one.
          </Alert>
        </div>
      )}
      {shown && !shown.exact && shown.needsConfirmation && (
        <div className="mt-2">
          <Alert tone="warning" title="A similar material exists">
            <ul className="list-disc pl-5">
              {shown.candidates
                .filter((c) => c.verdict === 'POSSIBLE_DUPLICATE')
                .map((c) => (
                  <li key={c.material.id}>
                    {c.material.name} ({c.material.code}, {c.material.stockUnitCode})
                  </li>
                ))}
            </ul>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={value.confirmNotDuplicate}
                disabled={disabled}
                onChange={(e) => set({ confirmNotDuplicate: e.target.checked })}
              />
              This is a different material. Create it.
            </label>
          </Alert>
        </div>
      )}
    </div>
  );
}

function LineCard({
  item,
  invoice,
  masters,
  editable,
  busy,
  onPatch,
}: {
  item: InvoiceItemDto;
  invoice: InvoiceDetailDto;
  masters: Masters;
  editable: boolean;
  busy: boolean;
  onPatch: (patch: Omit<UpdateInvoiceItemInput, 'version'>) => void;
}) {
  const excluded = item.lineStatus === 'EXCLUDED';
  const off = !editable || busy || excluded;
  const unsure = (f: string) => item.uncertainFields.includes(f);
  const blocking = item.issues.filter((i) => i.code !== 'NOT_CONFIRMED');
  const state = excluded
    ? { label: 'Excluded', tone: 'neutral' as const }
    : item.proposedMaterial
      ? { label: 'New', tone: 'info' as const }
      : item.material && blocking.length === 0
        ? { label: 'Matched', tone: 'success' as const }
        : { label: 'Review', tone: 'warning' as const };
  const candidateIds = new Set(item.candidates.map((c) => c.materialId));
  const proposal = item.proposedMaterial;

  return (
    <Card
      className={cn(
        'p-4',
        excluded && 'opacity-60',
        !excluded && blocking.length > 0 && 'border-warning',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Line {item.lineNo}</span>
            <Badge tone={state.tone}>{state.label}</Badge>
            <Confidence score={item.matchScore} thresholds={invoice.thresholds} />
            {item.matchMethod === 'SUPPLIER_MAPPING' && (
              <Badge tone="success">Known from this supplier</Badge>
            )}
            {item.matchMethod === 'AI_TIEBREAK' && <Badge tone="warning">AI suggestion</Badge>}
            {item.isManualEntry && <Badge>Typed by hand</Badge>}
            {item.hsnCode && <span>HSN {item.hsnCode}</span>}
          </div>
          <div className="mt-1">
            <Commit
              aria-label="Description as on the document"
              value={item.description}
              disabled={off}
              uncertain={unsure('description')}
              onCommit={(description) => description && onPatch({ description })}
            />
          </div>
        </div>
        {editable && (
          <div className="flex items-center gap-2">
            {!excluded && (
              <label
                className={cn(
                  'flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium',
                  item.lineStatus === 'CONFIRMED'
                    ? 'border-success/50 bg-success/10'
                    : 'border-border',
                )}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={item.lineStatus === 'CONFIRMED'}
                  disabled={busy}
                  onChange={(e) =>
                    onPatch({ lineStatus: e.target.checked ? 'CONFIRMED' : 'PENDING' })
                  }
                />
                Checked
              </label>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => onPatch({ lineStatus: excluded ? 'PENDING' : 'EXCLUDED' })}
            >
              {excluded ? 'Include' : 'Exclude'}
            </Button>
          </div>
        )}
      </div>

      {!excluded && (
        <>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <Field label="KAVACH material">
              {(id) => (
                <Select
                  id={id}
                  disabled={off}
                  value={proposal ? '__new' : (item.material?.id ?? '')}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '__new')
                      onPatch({
                        proposedMaterial: item.suggestedProposal ??
                          proposal ?? {
                            name: item.description,
                            categoryId: null,
                            brand: null,
                            specification: null,
                            grade: null,
                            size: null,
                            stockUnitId: item.invoiceUnitId,
                            packSize: null,
                            packUnitId: null,
                            isVariableWeight: false,
                            confirmNotDuplicate: false,
                          },
                      });
                    else if (v) onPatch({ materialId: v });
                    else onPatch({ materialId: null, proposedMaterial: null });
                  }}
                >
                  <option value="">Choose the material…</option>
                  <option value="__new">+ Create a new material</option>
                  {item.candidates.length > 0 && (
                    <optgroup label="Possible matches">
                      {item.candidates.map((c) => (
                        <option key={c.materialId} value={c.materialId}>
                          {c.name} ({c.stockUnitCode}) — {Math.round(c.score * 100)}%
                          {c.conflicts.length > 0
                            ? ` — differs: ${c.conflicts.map((x) => `${x.key} ${x.material}`).join(', ')}`
                            : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="All materials">
                    {masters.materials
                      .filter((m) => !candidateIds.has(m.id))
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.stockUnitCode}) — {m.code}
                        </option>
                      ))}
                  </optgroup>
                </Select>
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Invoice quantity">
                {(id) => (
                  <Commit
                    id={id}
                    inputMode="decimal"
                    value={item.invoiceQty ?? ''}
                    disabled={off}
                    uncertain={unsure('quantity')}
                    onCommit={(v) => onPatch({ invoiceQty: v || null })}
                  />
                )}
              </Field>
              <Field
                label="Unit"
                hint={
                  item.invoiceUnitRaw && !item.invoiceUnitId
                    ? `Written as "${item.invoiceUnitRaw}"`
                    : undefined
                }
              >
                {(id) => (
                  <Select
                    id={id}
                    disabled={off}
                    className={cn(
                      (unsure('unit') || !item.invoiceUnitId) &&
                        'border-warning ring-1 ring-warning/60',
                    )}
                    value={item.invoiceUnitId ?? ''}
                    onChange={(e) => onPatch({ invoiceUnitId: e.target.value || null })}
                  >
                    <option value="">Choose…</option>
                    {masters.units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          </div>

          {proposal && (
            <NewMaterialForm
              value={proposal}
              masters={masters}
              disabled={off}
              onSave={(p) => onPatch({ proposedMaterial: p })}
            />
          )}

          {/* PRD §10.2 screen 4: invoice quantity and actual received quantity are separate. */}
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
            <Field label="Received (good)">
              {(id) => (
                <Commit
                  id={id}
                  inputMode="decimal"
                  value={item.acceptedQty ?? ''}
                  disabled={off}
                  onCommit={(v) => onPatch({ acceptedQty: v || null })}
                />
              )}
            </Field>
            <Field label="Damaged">
              {(id) => (
                <Commit
                  id={id}
                  inputMode="decimal"
                  value={item.damagedQty === '0' ? '' : item.damagedQty}
                  placeholder="0"
                  disabled={off}
                  onCommit={(v) => onPatch({ damagedQty: v || '0' })}
                />
              )}
            </Field>
            <Field label="Rejected">
              {(id) => (
                <Commit
                  id={id}
                  inputMode="decimal"
                  value={item.rejectedQty === '0' ? '' : item.rejectedQty}
                  placeholder="0"
                  disabled={off}
                  onCommit={(v) => onPatch({ rejectedQty: v || '0' })}
                />
              )}
            </Field>
            <Field label="Reason for difference">
              {(id) => (
                <Select
                  id={id}
                  disabled={off}
                  value={item.discrepancyReason ?? ''}
                  onChange={(e) =>
                    onPatch({
                      discrepancyReason: (e.target.value || null) as DiscrepancyReason | null,
                    })
                  }
                >
                  <option value="">—</option>
                  {DISCREPANCY_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {REASON_LABEL[r]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Notes" className="col-span-2 sm:col-span-4 lg:col-span-1">
              {(id) => (
                <Commit
                  id={id}
                  value={item.notes ?? ''}
                  disabled={off}
                  onCommit={(v) => onPatch({ notes: v || null })}
                />
              )}
            </Field>
          </div>

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {item.shortQty !== '0' && (
              <span>
                Short by {item.shortQty} {item.invoiceUnitCode ?? ''}
              </span>
            )}
            {item.stock && (
              <span className="font-medium text-foreground">
                Into stock: {item.stock.acceptedQty} {item.stock.unitCode}
                {item.stock.damagedQty !== '0' &&
                  ` + ${item.stock.damagedQty} ${item.stock.unitCode} damaged (kept apart)`}
              </span>
            )}
            {item.uncertainFields.length > 0 && (
              <span>AI was unsure about: {item.uncertainFields.join(', ')}</span>
            )}
          </div>

          {item.issues.length > 0 && editable && (
            <ul className="mt-2 space-y-0.5 text-sm text-danger">
              {item.issues.map((i) => (
                <li key={i.code}>• {i.message}</li>
              ))}
            </ul>
          )}
          {item.warnings.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-sm">
              {item.warnings.map((w) => (
                <li key={w}>⚠ {w}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

function AddLine({
  masters,
  onAdd,
  busy,
}: {
  masters: Masters;
  onAdd: (line: { description: string; invoiceQty: string; invoiceUnitId: string }) => void;
  busy: boolean;
}) {
  const [description, setDescription] = useState('');
  const [qty, setQty] = useState('');
  const [unitId, setUnitId] = useState('');
  return (
    <Card className="p-4">
      <p className="mb-2 text-sm font-medium">Add a line by hand</p>
      <div className="grid gap-2 sm:grid-cols-[1fr_8rem_10rem_auto]">
        <Input
          aria-label="Material description"
          placeholder="Material as written on the document"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Input
          aria-label="Quantity"
          inputMode="decimal"
          placeholder="Quantity"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
        <Select aria-label="Unit" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
          <option value="">Unit…</option>
          {masters.units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <Button
          variant="secondary"
          disabled={busy || !description.trim() || !qty || !unitId}
          onClick={() => {
            onAdd({ description: description.trim(), invoiceQty: qty, invoiceUnitId: unitId });
            setDescription('');
            setQty('');
          }}
        >
          Add line
        </Button>
      </div>
    </Card>
  );
}

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const canReceive = can('material_in:create');

  const query = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api.invoices.get(id),
    // Asynchronous processing: poll while the worker has it (PRD §25.1).
    refetchInterval: (q) =>
      ['UPLOADING', 'QUEUED', 'PROCESSING'].includes(q.state.data?.status ?? '') ? 2000 : false,
  });
  const invoice = query.data;
  const reviewing = invoice?.status === 'READY_FOR_REVIEW';

  const materials = useQuery({
    queryKey: ['materials', 'active'],
    queryFn: () => api.materials.list({ status: 'ACTIVE', pageSize: 500 }),
    enabled: reviewing,
  });
  const units = useQuery({ queryKey: ['units'], queryFn: api.units.list, enabled: reviewing });
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: api.categories.list,
    enabled: reviewing,
  });
  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.suppliers.list(),
    enabled: reviewing,
  });
  const masters: Masters = useMemo(
    () => ({
      materials: (materials.data?.items ?? []).map((m) => ({
        id: m.id,
        code: m.code,
        name: m.name,
        stockUnitCode: m.stockUnitCode,
      })),
      units: (units.data ?? [])
        .filter((u) => u.isActive)
        .map((u) => ({ id: u.id, code: u.code, name: u.name })),
      categories: (categories.data ?? [])
        .filter((c) => c.isActive && !c.parentId)
        .map((c) => ({ id: c.id, name: c.name })),
    }),
    [materials.data, units.data, categories.data],
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [posted, setPosted] = useState<PostingDto | null>(null);
  const [overrideNote, setOverrideNote] = useState('');
  // One key per attempt to receive: a retry after a dropped connection reuses it (PRD §13.3).
  const confirmKey = useRef<string | null>(null);

  /** Runs a change and shows the document the server returns. */
  const run = async (action: () => Promise<InvoiceDetailDto>) => {
    setBusy(true);
    setError(null);
    try {
      queryClient.setQueryData(['invoice', id], await action());
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    } catch (e) {
      setError(errorMessage(e));
      if (
        e instanceof ApiError &&
        (e.code === 'STALE_VERSION' || e.code === 'INVOICE_NOT_EDITABLE')
      )
        void query.refetch();
    } finally {
      setBusy(false);
    }
  };

  if (query.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (query.error || !invoice) return <Alert>{errorMessage(query.error)}</Alert>;

  const title = invoice.invoiceNo ?? invoice.challanNo ?? 'Document';
  const back = (
    <Link href="/material-in">
      <Button variant="secondary">Back to Material In</Button>
    </Link>
  );

  // ── Screen 6: success ──────────────────────────────────────────────────────
  if (posted) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 py-8 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/15 text-3xl text-success">
          ✓
        </div>
        <h1 className="text-2xl font-bold tracking-tight">MATERIAL RECEIVED SUCCESSFULLY</h1>
        <Card className="space-y-3 p-6 text-left text-sm">
          {[
            ['Supplier', posted.supplierName ?? '—'],
            ['Invoice / challan number', posted.externalRef ?? '—'],
            ['Receipt reference', posted.referenceNo],
            ['Number of materials', String(new Set(posted.lines.map((l) => l.materialId)).size)],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-border pb-2">
              <span className="text-muted-foreground">{k}</span>
              <span className="font-medium">{v}</span>
            </div>
          ))}
          <div>
            <p className="mb-1 text-muted-foreground">Received quantities</p>
            <ul className="space-y-1">
              {posted.lines.map((l) => (
                <li key={l.id} className="flex justify-between">
                  <span>
                    {l.materialName}
                    {l.bucket === 'DAMAGED' && ' (damaged, kept apart)'}
                  </span>
                  <span className="font-mono">
                    {l.quantity} {l.unitCode}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href={`/material-in/receipts/${posted.id}`}>
            <Button>View Receipt</Button>
          </Link>
          <Link href={`/material-in/receipts/${posted.id}?print=1`}>
            <Button variant="secondary">Download Receipt</Button>
          </Link>
          <Link href="/material-in">
            <Button variant="secondary">Receive Another</Button>
          </Link>
        </div>
      </div>
    );
  }

  // ── Screen 2: processing ───────────────────────────────────────────────────
  if (['UPLOADING', 'QUEUED', 'PROCESSING'].includes(invoice.status)) {
    const at =
      invoice.status === 'UPLOADING' ? 0 : Math.max(1, PROCESSING_STAGES.indexOf(invoice.stage));
    return (
      <>
        <PageHeader
          title="Reading the document"
          description="This runs in the background. You can leave this page and come back; it will be under Material In."
          actions={back}
        />
        <Card className="max-w-xl p-6">
          <ol className="space-y-3">
            {STAGE_LABELS.map((label, i) => (
              <li key={label} className="flex items-center gap-3 text-sm">
                <span
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full text-xs',
                    i < at
                      ? 'bg-success text-white'
                      : i === at
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {i < at ? '✓' : i + 1}
                </span>
                <span
                  className={cn(i === at && 'font-semibold', i > at && 'text-muted-foreground')}
                >
                  {label}
                  {i === at && '…'}
                </span>
              </li>
            ))}
          </ol>
          {invoice.failureMessage && (
            <p className="mt-4 text-sm text-muted-foreground">
              Last attempt: {invoice.failureMessage} Trying again shortly.
            </p>
          )}
          {canReceive && (
            <Button
              className="mt-5"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void run(() => api.invoices.discard(id)).then(() => router.push('/material-in'))
              }
            >
              Cancel
            </Button>
          )}
        </Card>
      </>
    );
  }

  // ── Quality warning, failure, discarded ────────────────────────────────────
  if (
    invoice.status === 'NEEDS_RECAPTURE' ||
    invoice.status === 'FAILED' ||
    invoice.status === 'DISCARDED'
  ) {
    const recapture = invoice.status === 'NEEDS_RECAPTURE';
    return (
      <>
        <PageHeader title={title} description={STATUS_LABEL[invoice.status]} actions={back} />
        {error && (
          <div className="mb-4">
            <Alert>{error}</Alert>
          </div>
        )}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="space-y-4 p-5">
            {recapture && (
              <Alert tone="warning" title="A better image is needed">
                <ul className="mt-1 list-disc pl-5">
                  {(invoice.quality?.advice.length
                    ? invoice.quality.advice
                    : ['The document could not be read clearly.']
                  ).map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
                {invoice.quality?.note && <p className="mt-2">{invoice.quality.note}</p>}
              </Alert>
            )}
            {invoice.status === 'FAILED' && (
              <Alert title="The document could not be read">{invoice.failureMessage}</Alert>
            )}
            {invoice.status === 'DISCARDED' && (
              <Alert tone="info">This document was discarded. Nothing was received from it.</Alert>
            )}
            {canReceive && invoice.status !== 'DISCARDED' && (
              <div className="flex flex-wrap gap-3">
                {recapture ? (
                  <>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void run(() => api.invoices.discard(id)).then(() =>
                          router.push('/material-in'),
                        )
                      }
                    >
                      Retake the photo
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void run(() => api.invoices.reprocess(id, true))}
                    >
                      Read it anyway
                    </Button>
                  </>
                ) : (
                  <Button
                    disabled={busy}
                    onClick={() => void run(() => api.invoices.reprocess(id, false))}
                  >
                    Try again
                  </Button>
                )}
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void run(() => api.invoices.manualEntry(id))}
                >
                  Enter the lines by hand
                </Button>
                {!recapture && (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void run(() => api.invoices.discard(id))}
                  >
                    Discard
                  </Button>
                )}
              </div>
            )}
          </Card>
          <DocumentPreview invoice={invoice} />
        </div>
      </>
    );
  }

  // ── Screens 3–5: review and confirm (also the read-only view of a received document) ──
  const editable = reviewing && canReceive;
  const active = invoice.items.filter((i) => i.lineStatus !== 'EXCLUDED');
  const unsureHeader = (f: string) => reviewing && invoice.uncertainHeaderFields.includes(f);
  const patchHeader = (patch: Omit<UpdateInvoiceHeaderInput, 'version'>) =>
    void run(() => api.invoices.updateHeader(id, { version: invoice.version, ...patch }));

  const confirm = async () => {
    setBusy(true);
    setError(null);
    confirmKey.current ??= newKey();
    try {
      const posting = await api.invoices.confirm(id, invoice.version, confirmKey.current);
      confirmKey.current = null;
      setConfirmOpen(false);
      setPosted(posting);
      for (const key of [
        'invoices',
        'invoice',
        'stock',
        'transactions',
        'dashboard',
        'materials',
        'suppliers',
      ]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    } catch (e) {
      setError(errorMessage(e));
      // A network failure keeps the key, so pressing the button again cannot post twice.
      if (!(e instanceof ApiError && e.code === 'NETWORK')) {
        confirmKey.current = null;
        setConfirmOpen(false);
        void query.refetch();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={reviewing ? 'Review and confirm' : title}
        description={`${invoice.storeName} · uploaded by ${invoice.uploadedByName} · ${new Date(invoice.createdAt).toLocaleString()}`}
        actions={
          <>
            <Badge tone={statusTone(invoice.status)}>{STATUS_LABEL[invoice.status]}</Badge>
            {invoice.postingId && (
              <Link href={`/material-in/receipts/${invoice.postingId}`}>
                <Button variant="secondary">Receipt {invoice.receiptReferenceNo}</Button>
              </Link>
            )}
            {back}
          </>
        }
      />

      <div className="space-y-3">
        {error && <Alert>{error}</Alert>}
        {invoice.status === 'REVERSED' && (
          <Alert tone="info">
            This receipt was reversed by the Project Admin. The document can be received again by
            uploading it.
          </Alert>
        )}
        {reviewing && invoice.qualityOverridden && invoice.quality && !invoice.quality.ok && (
          <Alert tone="warning">
            The image quality was poor and you chose to go on. Check every value against the
            document.
          </Alert>
        )}
        {reviewing && invoice.quality?.handwritten && (
          <Alert tone="info">
            Handwritten document: check the highlighted fields against the original.
          </Alert>
        )}
        {invoice.duplicates.length > 0 && (
          <Alert
            tone={invoice.duplicateOverride ? 'info' : 'danger'}
            title="POSSIBLE DUPLICATE INVOICE"
          >
            {invoice.duplicates.map((d) => (
              <p key={d.invoiceId}>
                {d.invoiceNo ? `Invoice ${d.invoiceNo}` : `Challan ${d.challanNo ?? ''}`} ·{' '}
                {d.supplierName ?? 'Supplier'} · previously processed{' '}
                {d.receivedAt
                  ? new Date(d.receivedAt).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })
                  : ''}
                {d.referenceNo && ` (${d.referenceNo})`}
                {d.kind === 'FINGERPRINT' && ' — the same file'}
                {d.kind === 'CHALLAN' && ' — the same challan number'}.{' '}
                <Link className="underline" href={`/material-in/invoices/${d.invoiceId}`}>
                  Open it
                </Link>
              </p>
            ))}
            {invoice.duplicateOverride ? (
              <p className="mt-1 font-medium">
                Authorised by {invoice.duplicateOverride.byName}: “{invoice.duplicateOverride.note}”
              </p>
            ) : can('invoice:duplicate_override') ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <Input
                  className="max-w-md"
                  placeholder="Why is this a different document?"
                  value={overrideNote}
                  onChange={(e) => setOverrideNote(e.target.value)}
                />
                <Button
                  variant="danger"
                  disabled={busy || overrideNote.trim().length < 3}
                  onClick={() =>
                    void run(() => api.invoices.overrideDuplicate(id, overrideNote.trim()))
                  }
                >
                  Authorise as a different document
                </Button>
              </div>
            ) : (
              <p className="mt-1 font-medium">
                It cannot be received again. If it really is a different document, ask the Project
                Admin to authorise it.
              </p>
            )}
          </Alert>
        )}
        {invoice.warnings.map((w) => (
          <Alert key={w} tone="warning">
            {w}
          </Alert>
        ))}
      </div>

      <div className="mt-4 grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          <Card className="p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field
                label="Supplier"
                className="sm:col-span-2 lg:col-span-1"
                hint={
                  !invoice.supplierId && invoice.supplierNameRaw && reviewing
                    ? 'New supplier: it will be created when you confirm.'
                    : undefined
                }
              >
                {(fid) =>
                  editable ? (
                    <>
                      <Select
                        id={fid}
                        disabled={busy}
                        value={invoice.supplierId ?? ''}
                        onChange={(e) => patchHeader({ supplierId: e.target.value || null })}
                      >
                        <option value="">
                          {invoice.supplierNameRaw
                            ? `New: ${invoice.supplierNameRaw}`
                            : 'Type the name below…'}
                        </option>
                        {(suppliers.data ?? []).map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                      {!invoice.supplierId && (
                        <Commit
                          aria-label="Supplier name"
                          placeholder="Supplier name"
                          className="mt-1"
                          value={invoice.supplierNameRaw ?? ''}
                          disabled={busy}
                          uncertain={unsureHeader('supplierName')}
                          onCommit={(v) => patchHeader({ supplierName: v || null })}
                        />
                      )}
                    </>
                  ) : (
                    <Input id={fid} value={invoice.supplierName ?? ''} disabled />
                  )
                }
              </Field>
              <Field label="Invoice number">
                {(fid) => (
                  <Commit
                    id={fid}
                    value={invoice.invoiceNo ?? ''}
                    disabled={!editable || busy}
                    uncertain={unsureHeader('invoiceNo')}
                    onCommit={(v) => patchHeader({ invoiceNo: v || null })}
                  />
                )}
              </Field>
              <Field label="Invoice date">
                {(fid) => (
                  <Commit
                    id={fid}
                    type="date"
                    value={invoice.invoiceDate ?? ''}
                    disabled={!editable || busy}
                    uncertain={unsureHeader('invoiceDate')}
                    onCommit={(v) => patchHeader({ invoiceDate: v || null })}
                  />
                )}
              </Field>
              <Field label="Challan number">
                {(fid) => (
                  <Commit
                    id={fid}
                    value={invoice.challanNo ?? ''}
                    disabled={!editable || busy}
                    uncertain={unsureHeader('challanNo')}
                    onCommit={(v) => patchHeader({ challanNo: v || null })}
                  />
                )}
              </Field>
              <Field label="GSTIN">
                {(fid) => (
                  <Commit
                    id={fid}
                    value={invoice.supplierGstin ?? ''}
                    disabled={!editable || busy || !!invoice.supplierId}
                    uncertain={unsureHeader('gstin')}
                    onCommit={(v) => patchHeader({ supplierGstin: v || null })}
                  />
                )}
              </Field>
              <Field label="Document total" hint="For reference only.">
                {(fid) => <Input id={fid} value={invoice.invoiceTotal ?? ''} disabled />}
              </Field>
            </div>
            {editable && invoice.supplierSuggestions.length > 0 && (
              <div className="mt-3 text-sm">
                <span className="text-muted-foreground">Is this an existing supplier? </span>
                {invoice.supplierSuggestions.map((s) => (
                  <Button
                    key={s.id}
                    size="sm"
                    variant="secondary"
                    className="mr-2"
                    disabled={busy}
                    onClick={() => patchHeader({ supplierId: s.id })}
                  >
                    {s.name} ({s.reason})
                  </Button>
                ))}
              </div>
            )}
            {reviewing && invoice.uncertainHeaderFields.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Highlighted fields were hard to read. Check them against the document.
              </p>
            )}
          </Card>

          {invoice.items.length === 0 && (
            <Alert tone="info">
              No lines were read from this document. {editable && 'Add them by hand below.'}
            </Alert>
          )}
          {invoice.items.map((item) => (
            <LineCard
              key={item.id}
              item={item}
              invoice={invoice}
              masters={masters}
              editable={editable}
              busy={busy}
              onPatch={(patch) =>
                void run(() =>
                  api.invoices.updateItem(id, item.id, { version: invoice.version, ...patch }),
                )
              }
            />
          ))}
          {editable && (
            <AddLine
              masters={masters}
              busy={busy}
              onAdd={(line) =>
                void run(() => api.invoices.addItem(id, { version: invoice.version, ...line }))
              }
            />
          )}

          {reviewing && (
            <Card className="sticky bottom-2 z-10 flex flex-wrap items-center justify-between gap-3 p-4 shadow-lg">
              <div className="text-sm">
                <p className="font-medium">
                  {invoice.summary.lines} line(s) · {invoice.summary.newMaterials} new material(s) ·{' '}
                  {invoice.summary.needsAttention} need attention
                </p>
                {invoice.summary.blockers.map((b) => (
                  <p key={b} className="text-danger">
                    {b}
                  </p>
                ))}
              </div>
              {canReceive ? (
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void run(() => api.invoices.discard(id))}
                  >
                    Discard
                  </Button>
                  <Button
                    className="h-12 px-6 text-base"
                    disabled={busy || !invoice.summary.ready}
                    onClick={() => setConfirmOpen(true)}
                  >
                    CONFIRM &amp; RECEIVE
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Only a Store Manager receives material.
                </p>
              )}
            </Card>
          )}
        </div>

        <div className="xl:sticky xl:top-4 xl:self-start">
          <DocumentPreview invoice={invoice} />
        </div>
      </div>

      {confirmOpen && (
        <Modal title="Confirm & Receive" wide onClose={() => !busy && setConfirmOpen(false)}>
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
              <span className="text-muted-foreground">Supplier</span>
              <span className="font-medium">
                {invoice.supplierName ?? invoice.supplierNameRaw}
                {!invoice.supplierId && ' (new)'}
              </span>
              <span className="text-muted-foreground">Invoice number</span>
              <span className="font-medium">
                {invoice.invoiceNo ?? '—'}
                {invoice.challanNo && ` · Challan ${invoice.challanNo}`}
              </span>
              <span className="text-muted-foreground">Receiving store</span>
              <span className="font-medium">{invoice.storeName}</span>
              <span className="text-muted-foreground">Total material lines</span>
              <span className="font-medium">{invoice.summary.lines}</span>
              <span className="text-muted-foreground">New materials</span>
              <span className="font-medium">{invoice.summary.newMaterials}</span>
              <span className="text-muted-foreground">Items requiring review</span>
              <span className="font-medium">{invoice.summary.needsAttention}</span>
            </div>
            <table className="w-full text-left">
              <thead className="border-b border-border text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="py-1">Material</th>
                  <th className="py-1 text-right">Accepted</th>
                  <th className="py-1 text-right">Damaged / rejected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {active.map((i) => (
                  <tr key={i.id}>
                    <td className="py-1.5">
                      {i.material?.name ?? i.proposedMaterial?.name}{' '}
                      {i.proposedMaterial && <Badge tone="info">New</Badge>}
                    </td>
                    <td className="py-1.5 text-right font-mono">
                      {i.stock ? `${i.stock.acceptedQty} ${i.stock.unitCode}` : '—'}
                    </td>
                    <td className="py-1.5 text-right font-mono">
                      {i.damagedQty} / {i.rejectedQty} {i.invoiceUnitCode}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-muted-foreground">
              Only the accepted quantity is added to available stock. Damaged quantity is kept
              apart. Rejected and short quantities are not stocked.
            </p>
            {error && <Alert>{error}</Alert>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => setConfirmOpen(false)}>
                Go back
              </Button>
              <Button
                className="h-12 px-6 text-base"
                disabled={busy}
                onClick={() => void confirm()}
              >
                {busy ? 'Receiving…' : 'CONFIRM & RECEIVE'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {invoice.notes !== null || editable ? (
        <div className="mt-4 max-w-xl">
          <Field label="Notes on this receipt">
            {(fid) => (
              <NotesBox
                id={fid}
                value={invoice.notes ?? ''}
                disabled={!editable || busy}
                onCommit={(v) => patchHeader({ notes: v || null })}
              />
            )}
          </Field>
        </div>
      ) : null}
    </>
  );
}

function NotesBox({
  id,
  value,
  disabled,
  onCommit,
}: {
  id: string;
  value: string;
  disabled: boolean;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  return (
    <Textarea
      id={id}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() !== value && onCommit(draft.trim())}
    />
  );
}
