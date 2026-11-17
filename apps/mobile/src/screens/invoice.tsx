import {
  type DiscrepancyReason,
  type InvoiceDetailDto,
  type InvoiceItemDto,
  PROCESSING_STAGES,
  type ProcessingStage,
  type UpdateInvoiceHeaderInput,
  type UpdateInvoiceItemInput,
} from '@kavach/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Alert, Image, Modal, ScrollView, Text, type TextInputProps, View } from 'react-native';
import { ApiError, api, errorMessage } from '../lib/api';
import { materialDetail, useMasters, when } from '../lib/data';
import { useNav } from '../lib/nav';
import { postSafely } from '../lib/retry';
import { refreshAfterPosting, useSession } from '../lib/session';
import {
  Badge,
  Banner,
  Button,
  Card,
  Field,
  Loading,
  ModalHeader,
  type Option,
  Picker,
  QuantityField,
  Row,
  Screen,
  Segments,
  type Tone,
  colors,
  styles,
} from '../ui';
import { INVOICE_STATUS } from './material-in';
import {
  type NewMaterialValue,
  NewMaterialFields,
  emptyMaterial,
  materialComplete,
} from './quick-receive';

type ItemPatch = Omit<UpdateInvoiceItemInput, 'version'>;
type HeaderPatch = Omit<UpdateInvoiceHeaderInput, 'version'>;

const STAGE_LABEL: Record<ProcessingStage, string> = {
  UPLOADED: 'Uploaded',
  QUALITY_CHECK: 'Checking the photo',
  READING: 'Reading the document',
  IDENTIFYING: 'Finding the materials',
  MATCHING: 'Matching with your Material Master',
  PREPARING: 'Preparing the review',
  DONE: 'Done',
};

const REASONS: { id: DiscrepancyReason; label: string }[] = [
  { id: 'SHORT_SUPPLY', label: 'Short supply' },
  { id: 'DAMAGED', label: 'Damaged' },
  { id: 'REJECTED', label: 'Rejected' },
  { id: 'EXCESS', label: 'Excess' },
  { id: 'OTHER', label: 'Other' },
];

const MATCH: Record<InvoiceItemDto['matchStatus'], { label: string; tone: Tone }> = {
  MATCHED: { label: 'Matched', tone: 'success' },
  NEW_MATERIAL: { label: 'New material', tone: 'info' },
  REVIEW_REQUIRED: { label: 'Needs your choice', tone: 'warning' },
};

/**
 * Text fields save when the user leaves them. Confirm & Receive must not run on a value that is
 * typed but not saved yet, so every field registers a "save now" function here.
 */
const Flushers = createContext<Set<() => void> | null>(null);

function CommitField({
  value,
  onCommit,
  quantity,
  ...rest
}: Omit<TextInputProps, 'value' | 'onChangeText'> & {
  label: string;
  hint?: string;
  warn?: boolean;
  value: string;
  onCommit: (text: string) => void;
  quantity?: boolean;
}) {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    // The server answered: show what is saved.
    setSeen(value);
    setText(value);
  }
  const latest = useRef({ text, value, onCommit });
  useEffect(() => {
    latest.current = { text, value, onCommit };
  });
  const flushers = useContext(Flushers);
  useEffect(() => {
    const flush = () => {
      const now = latest.current;
      if (now.text.trim() !== now.value) now.onCommit(now.text.trim());
    };
    flushers?.add(flush);
    return () => {
      flushers?.delete(flush);
    };
  }, [flushers]);
  const Input = quantity ? QuantityField : Field;
  return (
    <Input
      {...rest}
      value={text}
      onChangeText={setText}
      onEndEditing={() => {
        if (text.trim() !== value) onCommit(text.trim());
      }}
    />
  );
}

/** The original document, shown on request beside what was read from it (PRD §11.4). */
function Pages({ invoice }: { invoice: InvoiceDetailDto }) {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<
    Record<number, { uri: string; headers: Record<string, string> }>
  >({});
  const images = invoice.pages.filter((p) => p.mimeType !== 'application/pdf' && !p.purged);
  const others = invoice.pages.length - images.length;

  const show = async () => {
    setOpen(true);
    const loaded: typeof sources = {};
    for (const p of images) loaded[p.pageNo] = await api.invoices.pageSource(invoice.id, p.pageNo);
    setSources(loaded);
  };

  if (invoice.pages.length === 0) return null;
  return (
    <>
      <Button
        label={`View the document (${invoice.pages.length} page${invoice.pages.length === 1 ? '' : 's'})`}
        variant="secondary"
        onPress={() => void show()}
      />
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.screen}>
          <ModalHeader title="Document" onClose={() => setOpen(false)} />
          <ScrollView contentContainerStyle={styles.body} maximumZoomScale={4} minimumZoomScale={1}>
            {images.map((p) =>
              sources[p.pageNo] ? (
                <Image
                  key={p.pageNo}
                  source={sources[p.pageNo]}
                  accessibilityLabel={`Page ${p.pageNo}`}
                  resizeMode="contain"
                  style={{ width: '100%', aspectRatio: 0.72, backgroundColor: colors.border }}
                />
              ) : (
                <Loading key={p.pageNo} text={`Page ${p.pageNo}…`} />
              ),
            )}
            {others > 0 ? (
              <Text style={styles.hint}>
                {others} PDF or removed page{others === 1 ? '' : 's'} cannot be shown here. Open
                this document in the web app to see {others === 1 ? 'it' : 'them'}.
              </Text>
            ) : null}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

function LineCard({
  item,
  locked,
  materialOptions,
  unitOptions,
  onPatch,
  onNewMaterial,
}: {
  item: InvoiceItemDto;
  locked: boolean;
  materialOptions: Option[];
  unitOptions: Option[];
  onPatch: (patch: ItemPatch) => void;
  onNewMaterial: (typed: string) => void;
}) {
  const unsure = (name: string) => item.uncertainFields.includes(name);
  const excluded = item.lineStatus === 'EXCLUDED';
  const confirmed = item.lineStatus === 'CONFIRMED';
  const candidateIds = new Set(item.candidates.map((c) => c.materialId));
  const options: Option[] = [
    ...item.candidates.map((c) => ({
      id: c.materialId,
      label: c.name,
      group: 'Possible matches',
      detail:
        `${c.code} · ${c.stockUnitCode} · ${Math.round(c.score * 100)}% alike` +
        (c.conflicts.length > 0
          ? ` · DIFFERENT ${c.conflicts.map((x) => `${x.key}: ${x.line} vs ${x.material}`).join(', ')}`
          : ''),
    })),
    ...materialOptions
      .filter((m) => !candidateIds.has(m.id))
      .map((m) => ({ ...m, group: 'All materials' })),
  ];
  const needsReason =
    !!item.discrepancyReason ||
    Number(item.damagedQty) > 0 ||
    Number(item.rejectedQty) > 0 ||
    Number(item.shortQty) > 0 ||
    item.issues.some((i) => i.code === 'REASON_REQUIRED');
  const unit = item.invoiceUnitCode ?? item.invoiceUnitRaw ?? '';
  const qty = (v: string) => (v === '' ? null : v);

  return (
    <Card
      tone={
        excluded
          ? 'neutral'
          : item.issues.length > 0
            ? 'warning'
            : confirmed
              ? 'success'
              : undefined
      }
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={[styles.hint, { flex: 1, marginTop: 0 }]}>
          Line {item.lineNo}
          {item.isManualEntry ? ' · typed by hand' : ''}
        </Text>
        {excluded ? (
          <Badge label="Left out" />
        ) : (
          <Badge label={MATCH[item.matchStatus].label} tone={MATCH[item.matchStatus].tone} />
        )}
        {confirmed ? <Badge label="Checked" tone="success" /> : null}
      </View>
      <Text style={[styles.text, { fontWeight: '700' }]}>{item.description}</Text>
      {excluded ? (
        <>
          <Text style={styles.hint}>This line will not be received.</Text>
          {!locked ? (
            <Button
              label="Put this line back"
              variant="secondary"
              onPress={() => onPatch({ lineStatus: 'PENDING' })}
            />
          ) : null}
        </>
      ) : (
        <>
          {item.uncertainFields.length > 0 ? (
            <Text style={[styles.hint, { color: colors.warning }]}>
              Hard to read, please check: {item.uncertainFields.join(', ')}
            </Text>
          ) : null}

          {item.proposedMaterial ? (
            <View style={{ gap: 4 }}>
              <Text style={styles.label}>New material to be created</Text>
              <Text style={styles.mono}>{item.proposedMaterial.name}</Text>
              {!locked ? (
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  <Button
                    label="Edit details"
                    variant="secondary"
                    onPress={() => onNewMaterial('')}
                  />
                  <Button
                    label="Use an existing material"
                    variant="ghost"
                    onPress={() => onPatch({ proposedMaterial: null })}
                  />
                </View>
              ) : null}
            </View>
          ) : null}
          {!item.proposedMaterial || !locked ? (
            <Picker
              label={
                item.proposedMaterial ? 'Or choose an existing material' : 'Material in your store'
              }
              placeholder={item.material?.name ?? 'Choose material…'}
              value={item.material?.id ?? null}
              options={options}
              disabled={locked}
              warn={!item.material && !item.proposedMaterial}
              onChange={(materialId) => onPatch({ materialId })}
              onCreate={onNewMaterial}
              createLabel="New material"
            />
          ) : null}
          {item.material ? (
            <Text style={styles.hint}>
              {item.material.code} · {item.material.categoryName} · stocked in{' '}
              {item.material.stockUnitCode}
              {item.material.packSize
                ? ` · pack ${item.material.packSize} ${item.material.packUnitCode ?? ''}`
                : ''}
            </Text>
          ) : null}
          {item.specConflicts.map((c) => (
            <Text key={c.key} style={[styles.hint, { color: colors.danger }]}>
              Not matched automatically: {c.key.toLowerCase()} on the document is {c.line}, the
              closest material has {c.material}.
            </Text>
          ))}

          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <CommitField
                quantity
                label="On the document"
                value={item.invoiceQty ?? ''}
                editable={!locked}
                warn={unsure('quantity')}
                onCommit={(t) => onPatch({ invoiceQty: qty(t) })}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Picker
                label="Unit"
                placeholder={item.invoiceUnitRaw ? `“${item.invoiceUnitRaw}”?` : 'Choose…'}
                value={item.invoiceUnitId}
                options={unitOptions}
                disabled={locked}
                warn={unsure('unit') || !item.invoiceUnitId}
                onChange={(invoiceUnitId) => onPatch({ invoiceUnitId })}
              />
            </View>
          </View>
          <CommitField
            quantity
            label={`Actually received in good condition${unit ? ` (${unit})` : ''}`}
            value={item.acceptedQty ?? ''}
            editable={!locked}
            warn={item.issues.some(
              (i) => i.code === 'QUANTITY_REQUIRED' || i.code === 'QUANTITY_NOT_WHOLE',
            )}
            onCommit={(t) => onPatch({ acceptedQty: qty(t) })}
          />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <CommitField
                quantity
                label="Damaged"
                value={Number(item.damagedQty) > 0 ? item.damagedQty : ''}
                editable={!locked}
                onCommit={(t) => onPatch({ damagedQty: qty(t) })}
              />
            </View>
            <View style={{ flex: 1 }}>
              <CommitField
                quantity
                label="Rejected"
                value={Number(item.rejectedQty) > 0 ? item.rejectedQty : ''}
                editable={!locked}
                onCommit={(t) => onPatch({ rejectedQty: qty(t) })}
              />
            </View>
          </View>
          {Number(item.shortQty) > 0 ? (
            <Text style={styles.hint}>
              Short by {item.shortQty} {unit}
            </Text>
          ) : null}
          {needsReason ? (
            <Segments<DiscrepancyReason>
              label="Why is it different from the document?"
              value={item.discrepancyReason}
              options={REASONS}
              disabled={locked}
              onChange={(discrepancyReason) => onPatch({ discrepancyReason })}
            />
          ) : null}

          {item.stock ? (
            <View style={{ backgroundColor: colors.successBg, borderRadius: 8, padding: 10 }}>
              <Text style={styles.mono}>
                Into available stock: {item.stock.acceptedQty} {item.stock.unitCode}
              </Text>
              {Number(item.stock.damagedQty) > 0 ? (
                <Text style={styles.hint}>
                  Kept apart as damaged: {item.stock.damagedQty} {item.stock.unitCode}
                </Text>
              ) : null}
            </View>
          ) : null}
          {item.issues
            .filter((i) => i.code !== 'NOT_CONFIRMED')
            .map((i) => (
              <Text key={i.code} style={[styles.text, { color: colors.danger }]}>
                {i.message}
              </Text>
            ))}
          {item.warnings.map((w) => (
            <Text key={w} style={[styles.hint, { color: colors.warning }]}>
              {w}
            </Text>
          ))}

          {!locked ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                {confirmed ? (
                  <Button
                    label="Checked ✓"
                    variant="secondary"
                    onPress={() => onPatch({ lineStatus: 'PENDING' })}
                  />
                ) : (
                  <Button
                    label="This line is correct"
                    onPress={() => onPatch({ lineStatus: 'CONFIRMED' })}
                  />
                )}
              </View>
              <Button
                label="Leave out"
                variant="ghost"
                onPress={() => onPatch({ lineStatus: 'EXCLUDED' })}
              />
            </View>
          ) : null}
        </>
      )}
    </Card>
  );
}

/**
 * One scanned document, from "being read" to received (PRD §21.2 steps 4–10, §10.2, §11).
 * Everything shown is a draft made by the AI. Stock changes only on Confirm & Receive, after
 * the server has checked every line again.
 */
export function InvoiceScreen({ id }: { id: string }) {
  const nav = useNav();
  const session = useSession();
  const queryClient = useQueryClient();
  const key = ['invoices', 'detail', id];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.invoices.get(id),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'UPLOADING' || s === 'QUEUED' || s === 'PROCESSING' ? 2500 : false;
    },
  });
  const invoice = query.data;
  const reviewing = invoice?.status === 'READY_FOR_REVIEW';
  const locked = !session.can('material_in:create');
  const masters = useMasters();
  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.suppliers.list(),
    enabled: reviewing,
    staleTime: 60_000,
  });

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(0);
  const [busy, setBusy] = useState(false);
  const [newLine, setNewLine] = useState('');
  const [draft, setDraft] = useState<{
    itemId: string;
    value: NewMaterialValue;
    extra: { specification: string | null; isVariableWeight: boolean };
  } | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [flushers] = useState(() => new Set<() => void>());

  /** Edits are sent one after another, each with the version the previous one returned. */
  const run = (change: (version: number) => Promise<InvoiceDetailDto>): Promise<unknown> => {
    const next = queue.current.then(async () => {
      const current = queryClient.getQueryData<InvoiceDetailDto>(key);
      if (!current) return;
      setSaving((n) => n + 1);
      try {
        queryClient.setQueryData(key, await change(current.version));
        setError(null);
      } catch (e) {
        setError(errorMessage(e));
        // Someone or something else changed the document: show it as it is now.
        if (e instanceof ApiError && e.code !== 'NETWORK') await query.refetch();
      } finally {
        setSaving((n) => n - 1);
      }
    });
    queue.current = next;
    return next;
  };
  const patchItem = (itemId: string, patch: ItemPatch) =>
    run((version) => api.invoices.updateItem(id, itemId, { version, ...patch }));
  const patchHeader = (patch: HeaderPatch) =>
    run((version) => api.invoices.updateHeader(id, { version, ...patch }));
  const act = (action: () => Promise<InvoiceDetailDto>) => {
    setBusy(true);
    return run(action).finally(() => setBusy(false));
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    // Save anything still being typed, and wait for every edit to be answered.
    for (const flush of flushers) flush();
    await queue.current;
    const latest = queryClient.getQueryData<InvoiceDetailDto>(key);
    if (!latest || latest.status !== 'READY_FOR_REVIEW' || !latest.summary.ready) {
      setBusy(false);
      setError(latest?.summary.blockers[0] ?? 'This document is not ready to be received yet.');
      return;
    }
    try {
      const posting = await postSafely(
        'invoice-confirm',
        { id, version: latest.version },
        (idempotencyKey) => api.invoices.confirm(id, latest.version, idempotencyKey),
      );
      refreshAfterPosting();
      void queryClient.invalidateQueries({ queryKey: ['materials'] });
      nav.replace({ name: 'posted', posting, title: 'Material received' });
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && (e.code === 'NETWORK' || e.status >= 500)) {
        setError(
          `${errorMessage(e)} Nothing is received twice: tap Confirm & Receive again to retry safely.`,
        );
      } else {
        setError(errorMessage(e));
        void query.refetch();
      }
    }
  };

  const askConfirm = () => {
    if (!invoice) return;
    const lines = invoice.summary.lines - invoice.summary.excluded;
    Alert.alert(
      'Receive this material?',
      `${lines} line${lines === 1 ? '' : 's'} will be added to the stock of ${invoice.storeName}.` +
        (invoice.summary.newMaterials > 0
          ? ` ${invoice.summary.newMaterials} new material${invoice.summary.newMaterials === 1 ? '' : 's'} will be created.`
          : ''),
      [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Confirm & Receive', onPress: () => void confirm() },
      ],
    );
  };

  const discard = () =>
    Alert.alert('Discard this document?', 'Nothing from it will be received.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () =>
          void act(() => api.invoices.discard(id)).then(() => {
            refreshAfterPosting();
            nav.back();
          }),
      },
    ]);

  if (query.isPending) {
    return (
      <Screen title="Document">
        <Loading />
      </Screen>
    );
  }
  if (!invoice) {
    return (
      <Screen title="Document">
        <Banner>{errorMessage(query.error)}</Banner>
        <Button label="Try again" variant="secondary" onPress={() => void query.refetch()} />
      </Screen>
    );
  }

  const title =
    `${invoice.supplierName ?? 'Document'} ${invoice.invoiceNo ?? invoice.challanNo ?? ''}`.trim();
  const status = INVOICE_STATUS[invoice.status];

  // ── Being read (PRD §10.2 screen 2) ────────────────────────────────────────
  if (
    invoice.status === 'UPLOADING' ||
    invoice.status === 'QUEUED' ||
    invoice.status === 'PROCESSING'
  ) {
    const at =
      invoice.status === 'UPLOADING' ? 0 : Math.max(1, PROCESSING_STAGES.indexOf(invoice.stage));
    return (
      <Screen
        title="Reading the document"
        subtitle="You can leave this screen. It will be waiting under Material In."
      >
        <Loading text={status.label} />
        <Card>
          {PROCESSING_STAGES.filter((s) => s !== 'DONE').map((s, i) => (
            <Text
              key={s}
              style={[
                styles.text,
                {
                  color: i < at ? colors.success : i === at ? colors.text : colors.muted,
                  fontWeight: i === at ? '700' : '400',
                },
              ]}
            >
              {i < at ? '✓ ' : i === at ? '● ' : '○ '}
              {STAGE_LABEL[s]}
            </Text>
          ))}
        </Card>
        <Button label="Back to Material In" variant="secondary" onPress={nav.back} />
      </Screen>
    );
  }

  // ── Needs a better photo, failed, discarded (PRD §7.3 step 2, §11.5) ───────
  if (
    invoice.status === 'NEEDS_RECAPTURE' ||
    invoice.status === 'FAILED' ||
    invoice.status === 'DISCARDED'
  ) {
    const recapture = invoice.status === 'NEEDS_RECAPTURE';
    return (
      <Screen title={title || 'Document'} subtitle={status.label}>
        {error ? <Banner>{error}</Banner> : null}
        {recapture ? (
          <Banner tone="warning" title="A better photo is needed">
            {(invoice.quality?.advice.length
              ? invoice.quality.advice
              : ['The photo is hard to read.']
            ).map((a) => (
              <Text key={a} style={styles.bannerText}>
                • {a}
              </Text>
            ))}
            {invoice.quality?.note ? <Text style={styles.hint}>{invoice.quality.note}</Text> : null}
          </Banner>
        ) : null}
        {invoice.status === 'FAILED' ? (
          <Banner title="The document could not be read">
            {invoice.failureMessage ?? 'Something went wrong while reading it.'}
          </Banner>
        ) : null}
        {invoice.status === 'DISCARDED' ? (
          <Banner tone="info">This document was discarded. Nothing was received from it.</Banner>
        ) : null}
        <Pages invoice={invoice} />
        {!locked && invoice.status !== 'DISCARDED' ? (
          <>
            {recapture ? (
              <>
                <Button
                  label="Take new photos"
                  big
                  busy={busy}
                  onPress={() =>
                    void act(() => api.invoices.discard(id)).then(() => {
                      refreshAfterPosting();
                      nav.back();
                    })
                  }
                />
                <Button
                  label="Read it anyway"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => void act(() => api.invoices.reprocess(id, true))}
                />
              </>
            ) : (
              <Button
                label="Try reading it again"
                big
                busy={busy}
                onPress={() => void act(() => api.invoices.reprocess(id, false))}
              />
            )}
            <Button
              label="Enter the lines by hand"
              variant="secondary"
              disabled={busy}
              onPress={() => void act(() => api.invoices.manualEntry(id))}
            />
            {!recapture ? (
              <Button label="Discard" variant="ghost" disabled={busy} onPress={discard} />
            ) : null}
          </>
        ) : null}
      </Screen>
    );
  }

  // ── Received (PRD §10.2 screen 6) ──────────────────────────────────────────
  if (invoice.status === 'POSTED' || invoice.status === 'REVERSED') {
    return (
      <Screen title={title || 'Document'} subtitle={status.label}>
        {error ? <Banner>{error}</Banner> : null}
        {invoice.status === 'REVERSED' ? (
          <Banner tone="warning">
            This receipt was reversed by a Project Admin. The stock it added was taken out again.
          </Banner>
        ) : (
          <Banner tone="success" title="Received">
            <Text style={styles.bannerText}>
              {invoice.receiptReferenceNo} {invoice.postedAt ? `· ${when(invoice.postedAt)}` : ''}
            </Text>
          </Banner>
        )}
        <Card>
          <Row label="Store" value={invoice.storeName} />
          <Row label="Supplier" value={invoice.supplierName ?? '—'} />
          <Row label="Invoice number" value={invoice.invoiceNo ?? '—'} />
          <Row label="Challan number" value={invoice.challanNo ?? '—'} />
          <Row label="Lines" value={String(invoice.lineCount)} />
        </Card>
        {invoice.postingId ? (
          <Button
            label="View receipt"
            variant="secondary"
            busy={busy}
            onPress={() => {
              setBusy(true);
              api.inventory
                .getPosting(invoice.postingId!)
                .then((posting) => nav.push({ name: 'posted', posting, title: 'Receipt' }))
                .catch((e: unknown) => setError(errorMessage(e)))
                .finally(() => setBusy(false));
            }}
          />
        ) : null}
        <Pages invoice={invoice} />
      </Screen>
    );
  }

  // ── Review (PRD §10.2 screens 3–5, §21.2 steps 7–10) ───────────────────────
  const unsureHeader = (name: string) => invoice.uncertainHeaderFields.includes(name);
  const materialOptions: Option[] = masters.materials.map((m) => ({
    id: m.id,
    label: m.name,
    detail: materialDetail(m),
  }));
  const unitOptions: Option[] = masters.units.map((u) => ({
    id: u.id,
    label: u.code,
    detail: u.name,
  }));
  const suggested = new Set(invoice.supplierSuggestions.map((s) => s.id));
  const supplierOptions: Option[] = [
    ...invoice.supplierSuggestions.map((s) => ({
      id: s.id,
      label: s.name,
      detail: [s.gstin, s.reason].filter(Boolean).join(' · '),
      group: 'Looks like',
    })),
    ...(suppliers.data ?? [])
      .filter((s) => s.isActive && !suggested.has(s.id))
      .map((s) => ({
        id: s.id,
        label: s.name,
        detail: s.gstin ?? undefined,
        group: 'All suppliers',
      })),
  ];
  const blocked = invoice.duplicates.length > 0 && !invoice.duplicateOverride;
  const draftItem = draft ? invoice.items.find((i) => i.id === draft.itemId) : undefined;

  return (
    <Flushers.Provider value={flushers}>
      <Screen
        title={title || 'Review document'}
        subtitle={`${invoice.storeName} · ${invoice.summary.lines} line${invoice.summary.lines === 1 ? '' : 's'}${saving > 0 ? ' · saving…' : ''}`}
        footer={
          locked ? undefined : (
            <>
              {!invoice.summary.ready && invoice.summary.blockers.length > 0 ? (
                <Text style={[styles.hint, { color: colors.warning, marginTop: 0 }]}>
                  Before receiving: {invoice.summary.blockers.slice(0, 2).join(' ')}
                  {invoice.summary.blockers.length > 2
                    ? ` (+${invoice.summary.blockers.length - 2} more)`
                    : ''}
                </Text>
              ) : null}
              <Button
                label="CONFIRM & RECEIVE"
                big
                busy={busy}
                disabled={!invoice.summary.ready || blocked || saving > 0}
                onPress={askConfirm}
              />
            </>
          )
        }
      >
        {error ? <Banner>{error}</Banner> : null}
        {locked ? (
          <Banner tone="info">Only a Store Manager can change and receive this document.</Banner>
        ) : null}
        {masters.error ? <Banner>{errorMessage(masters.error)}</Banner> : null}

        {invoice.duplicates.length > 0 ? (
          <Banner
            tone={blocked ? 'danger' : 'warning'}
            title={blocked ? 'This document looks already received' : 'Allowed by a Project Admin'}
          >
            {invoice.duplicates.map((d) => (
              <Text key={`${d.kind}-${d.invoiceId}`} style={styles.bannerText}>
                •{' '}
                {d.kind === 'FINGERPRINT'
                  ? 'The same file'
                  : d.kind === 'CHALLAN'
                    ? `Challan ${d.challanNo ?? ''}`
                    : `Invoice ${d.invoiceNo ?? ''}`}
                {d.supplierName ? ` from ${d.supplierName}` : ''}
                {d.referenceNo ? ` was received as ${d.referenceNo}` : ' is already in the system'}
                {d.receivedAt ? ` (${when(d.receivedAt)})` : ''}.
              </Text>
            ))}
            <Text style={styles.bannerText}>
              {blocked
                ? 'It cannot be received again. If it really is a different delivery, a Project Admin can allow it in the web app.'
                : `${invoice.duplicateOverride!.byName}: ${invoice.duplicateOverride!.note}`}
            </Text>
          </Banner>
        ) : null}
        {invoice.qualityOverridden ? (
          <Banner tone="warning">
            The photo was hard to read. Check every line against the paper.
          </Banner>
        ) : null}
        {invoice.warnings.map((w) => (
          <Banner key={w} tone="warning">
            {w}
          </Banner>
        ))}

        <Pages invoice={invoice} />

        <Card>
          <Text style={styles.h2}>Document</Text>
          <Picker
            label="Supplier"
            placeholder={
              invoice.supplierNameRaw
                ? `New supplier: ${invoice.supplierNameRaw}`
                : 'Choose supplier…'
            }
            value={invoice.supplierId}
            options={supplierOptions}
            disabled={locked}
            warn={unsureHeader('supplierName') || (!invoice.supplierId && !invoice.supplierNameRaw)}
            onChange={(supplierId) => void patchHeader({ supplierId })}
            onCreate={(typed) => {
              const name = typed || invoice.supplierNameRaw;
              if (name) void patchHeader({ supplierId: null, supplierName: name });
              else setError('Type the supplier name in the search box, then tap New supplier.');
            }}
            createLabel="New supplier"
          />
          {!invoice.supplierId && invoice.supplierNameRaw ? (
            <Text style={styles.hint}>
              “{invoice.supplierNameRaw}” will be added as a new supplier when you receive.
            </Text>
          ) : null}
          <CommitField
            label="Invoice number"
            value={invoice.invoiceNo ?? ''}
            editable={!locked}
            warn={unsureHeader('invoiceNo')}
            autoCapitalize="characters"
            autoCorrect={false}
            onCommit={(invoiceNo) => void patchHeader({ invoiceNo })}
          />
          <CommitField
            label="Invoice date"
            value={invoice.invoiceDate ?? ''}
            editable={!locked}
            warn={unsureHeader('invoiceDate')}
            hint="Year-month-day, for example 2026-11-13"
            keyboardType="numbers-and-punctuation"
            onCommit={(invoiceDate) => void patchHeader({ invoiceDate })}
          />
          <CommitField
            label="Challan number"
            value={invoice.challanNo ?? ''}
            editable={!locked}
            warn={unsureHeader('challanNo')}
            autoCapitalize="characters"
            autoCorrect={false}
            onCommit={(challanNo) => void patchHeader({ challanNo })}
          />
        </Card>

        <Text style={styles.h2}>
          Lines
          {invoice.summary.needsAttention > 0
            ? ` · ${invoice.summary.needsAttention} need${invoice.summary.needsAttention === 1 ? 's' : ''} attention`
            : ''}
        </Text>
        {invoice.items.map((item) => (
          <LineCard
            key={item.id}
            item={item}
            locked={locked}
            materialOptions={materialOptions}
            unitOptions={unitOptions}
            onPatch={(patch) => void patchItem(item.id, patch)}
            onNewMaterial={(typed) => {
              const seed = item.proposedMaterial ?? item.suggestedProposal;
              setDraft({
                itemId: item.id,
                extra: {
                  specification: seed?.specification ?? null,
                  isVariableWeight: seed?.isVariableWeight ?? false,
                },
                value: seed
                  ? {
                      name: typed || seed.name,
                      categoryId: seed.categoryId,
                      brand: seed.brand ?? '',
                      grade: seed.grade ?? '',
                      size: seed.size ?? '',
                      stockUnitId: seed.stockUnitId,
                      packSize: seed.packSize ?? '',
                      packUnitId: seed.packUnitId,
                      confirmNotDuplicate: seed.confirmNotDuplicate,
                    }
                  : emptyMaterial(typed || item.description),
              });
            }}
          />
        ))}

        {!locked ? (
          <Card>
            <Text style={styles.label}>A line is missing?</Text>
            <Field
              label="What is written on the document"
              value={newLine}
              onChangeText={setNewLine}
              maxLength={500}
            />
            <Button
              label="Add this line"
              variant="secondary"
              disabled={newLine.trim().length === 0}
              onPress={() => {
                const description = newLine.trim();
                setNewLine('');
                void run((version) => api.invoices.addItem(id, { version, description }));
              }}
            />
          </Card>
        ) : null}
        {!locked ? (
          <Button label="Discard this document" variant="ghost" disabled={busy} onPress={discard} />
        ) : null}

        <Modal visible={!!draft} animationType="slide" onRequestClose={() => setDraft(null)}>
          {draft ? (
            <View style={styles.screen}>
              <ModalHeader
                title="New material"
                closeLabel="Cancel"
                onClose={() => setDraft(null)}
              />
              <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                {draftItem ? (
                  <Text style={styles.hint}>On the document: {draftItem.description}</Text>
                ) : null}
                <NewMaterialFields
                  value={draft.value}
                  onChange={(value) => setDraft({ ...draft, value })}
                  categories={masters.categories}
                  units={masters.units}
                  askDuplicate={
                    (draftItem?.candidates.length ?? 0) > 0 ||
                    !!draftItem?.issues.some((i) => i.code === 'NEW_MATERIAL_INCOMPLETE')
                  }
                />
                <Text style={styles.hint}>
                  The material is created only when you tap Confirm & Receive.
                </Text>
              </ScrollView>
              <View style={styles.footer}>
                <Button
                  label="Use this new material"
                  big
                  disabled={!materialComplete(draft.value)}
                  onPress={() => {
                    const v = draft.value;
                    void patchItem(draft.itemId, {
                      proposedMaterial: {
                        name: v.name.trim(),
                        categoryId: v.categoryId,
                        brand: v.brand.trim() || null,
                        specification: draft.extra.specification,
                        grade: v.grade.trim() || null,
                        size: v.size.trim() || null,
                        stockUnitId: v.stockUnitId,
                        packSize: v.packSize || null,
                        packUnitId: v.packSize ? v.packUnitId : null,
                        isVariableWeight: draft.extra.isVariableWeight,
                        confirmNotDuplicate: v.confirmNotDuplicate,
                      },
                    });
                    setDraft(null);
                  }}
                />
              </View>
            </View>
          ) : null}
        </Modal>
      </Screen>
    </Flushers.Provider>
  );
}
