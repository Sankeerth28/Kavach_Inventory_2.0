import type {
  ContractorDto,
  IssueInput,
  ReturnCondition,
  ReturnInput,
  SimilarContractorsDetails,
} from '@kavach/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { ApiError, api, errorMessage } from '../lib/api';
import {
  isQuantity,
  materialDetail,
  toStockUnit,
  unitChoices,
  useMasters,
  useStoreStock,
} from '../lib/data';
import { useNav } from '../lib/nav';
import { postSafely } from '../lib/retry';
import { refreshAfterPosting, useSession } from '../lib/session';
import {
  Banner,
  Button,
  Card,
  Field,
  Loading,
  Picker,
  QuantityField,
  Row,
  Screen,
  Segments,
  styles,
} from '../ui';

interface Line {
  key: number;
  materialId: string | null;
  quantity: string;
  unitId: string | null;
  condition: ReturnCondition;
}

const CONDITIONS: { id: ReturnCondition; label: string }[] = [
  { id: 'GOOD', label: 'Good (usable)' },
  { id: 'DAMAGED', label: 'Damaged' },
  { id: 'SCRAP', label: 'Scrap' },
];

/**
 * Material Out (PRD §21.3, §14) and Return (PRD §15) share one form: choose the material, see
 * what is available, type the quantity, choose the site location, check, confirm.
 * The server checks stock again under a lock; what is shown here is advice, not the rule.
 */
export function MovementScreen({
  kind,
  materialId,
}: {
  kind: 'issue' | 'return';
  materialId?: string;
}) {
  const nav = useNav();
  const { store } = useSession();
  const queryClient = useQueryClient();
  const masters = useMasters();
  const stock = useStoreStock(store?.id);
  const nextKey = useRef(2);

  const [lines, setLines] = useState<Line[]>(() => [
    { key: 1, materialId: materialId ?? null, quantity: '', unitId: null, condition: 'GOOD' },
  ]);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [contractorId, setContractorId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [similar, setSimilar] = useState<{ name: string; names: string[] } | null>(null);

  const issue = kind === 'issue';
  const title = issue ? 'Material Out' : 'Return Material';
  const set = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const view = lines.map((l) => {
    const material = masters.materials.find((m) => m.id === l.materialId);
    const row = l.materialId ? stock.byMaterial.get(l.materialId) : undefined;
    const available = row?.availableQty ?? '0';
    const converted = toStockUnit(
      l.quantity,
      l.unitId,
      material,
      masters.units,
      masters.conversions,
      false,
    );
    const tooMuch = issue && converted.ok && Number(converted.qty) > Number(available);
    const problem = !material
      ? 'Choose a material.'
      : !isQuantity(l.quantity)
        ? 'Enter a quantity.'
        : !converted.ok
          ? (converted.text ?? 'This unit cannot be used for this material.')
          : tooMuch
            ? `Only ${available} ${material.stockUnitCode} is available.`
            : null;
    return { line: l, material, available, converted, problem };
  });
  const repeated =
    new Set(
      lines.map((l) => (issue ? l.materialId : `${l.materialId}:${l.condition}`)).filter(Boolean),
    ).size < lines.filter((l) => l.materialId).length;
  const ready = !!store && !!locationId && view.every((v) => !v.problem) && !repeated;

  const addContractor = async (name: string, confirmNotDuplicate: boolean) => {
    setError(null);
    try {
      const created = await api.contractors.create({ name, confirmNotDuplicate });
      queryClient.setQueryData<ContractorDto[]>(['contractors'], (old) => [
        ...(old ?? []),
        created,
      ]);
      setContractorId(created.id);
      setSimilar(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'POSSIBLE_DUPLICATE') {
        const details = e.details as SimilarContractorsDetails | undefined;
        setSimilar({ name, names: (details?.similar ?? []).map((s) => s.name) });
      } else {
        setError(errorMessage(e));
      }
    }
  };

  const post = async () => {
    if (!store || !locationId) return;
    setBusy(true);
    setError(null);
    const header = { storeId: store.id, locationId, contractorId, notes: notes.trim() || null };
    try {
      let posting;
      if (issue) {
        const input: IssueInput = {
          ...header,
          lines: lines.map((l) => ({
            materialId: l.materialId!,
            quantity: l.quantity,
            unitId: l.unitId,
          })),
        };
        posting = await postSafely('issue', input, (key) => api.inventory.issue(input, key));
      } else {
        const input: ReturnInput = {
          ...header,
          lines: lines.map((l) => ({
            materialId: l.materialId!,
            quantity: l.quantity,
            unitId: l.unitId,
            condition: l.condition,
          })),
        };
        posting = await postSafely('return', input, (key) => api.inventory.return(input, key));
      }
      refreshAfterPosting();
      nav.replace({ name: 'posted', posting, title: issue ? 'Material issued' : 'Return saved' });
    } catch (e) {
      // Stock may have moved since the form was opened: show the fresh numbers.
      refreshAfterPosting();
      setError(
        e instanceof ApiError && (e.code === 'NETWORK' || e.status >= 500)
          ? `${errorMessage(e)} Nothing is posted twice: tap Confirm again to retry safely.`
          : errorMessage(e),
      );
      setBusy(false);
    }
  };

  if (!store) {
    return (
      <Screen title={title}>
        <Banner tone="warning">No store is selected.</Banner>
      </Screen>
    );
  }
  if (masters.loading) {
    return (
      <Screen title={title}>
        <Loading />
      </Screen>
    );
  }

  const location = masters.locations.find((l) => l.id === locationId);
  const contractor = masters.contractors.find((c) => c.id === contractorId);

  if (checking) {
    return (
      <Screen
        title={issue ? 'Check and confirm issue' : 'Check and confirm return'}
        subtitle={`Store: ${store.name}`}
        footer={
          <>
            <Button
              label={issue ? 'Confirm Issue' : 'Confirm Return'}
              big
              busy={busy}
              onPress={() => void post()}
            />
            <Button
              label="Change something"
              variant="secondary"
              disabled={busy}
              onPress={() => setChecking(false)}
            />
          </>
        }
      >
        {error ? <Banner>{error}</Banner> : null}
        <Card>
          <Row label={issue ? 'Issue to' : 'Returned from'} value={location?.path ?? ''} />
          <Row label="Contractor" value={contractor?.name ?? 'Not given'} />
          {notes.trim() ? <Row label="Notes" value={notes.trim()} /> : null}
        </Card>
        {view.map((v) => (
          <Card key={v.line.key}>
            <Text style={[styles.text, { fontWeight: '700' }]}>{v.material?.name}</Text>
            <Row
              label={
                issue
                  ? 'Leaves the store'
                  : CONDITIONS.find((c) => c.id === v.line.condition)!.label
              }
              value={`${v.converted.qty} ${v.material?.stockUnitCode}`}
            />
            {v.converted.text ? (
              <Text style={styles.hint}>
                Entered as {v.line.quantity}{' '}
                {masters.units.find((u) => u.id === v.line.unitId)?.code}
              </Text>
            ) : null}
            {issue ? (
              <Row
                label="Left in the store after this"
                value={`${(Number(v.available) - Number(v.converted.qty)).toFixed(3).replace(/\.?0+$/, '')} ${v.material?.stockUnitCode}`}
              />
            ) : v.line.condition !== 'GOOD' ? (
              <Text style={styles.hint}>Kept apart from usable stock.</Text>
            ) : null}
          </Card>
        ))}
      </Screen>
    );
  }

  return (
    <Screen
      title={title}
      subtitle={`Store: ${store.name}`}
      footer={
        <Button
          label="Check"
          big
          disabled={!ready}
          onPress={() => {
            setError(null);
            setChecking(true);
          }}
        />
      }
    >
      {masters.error || stock.error ? (
        <Banner>{errorMessage(masters.error ?? stock.error)}</Banner>
      ) : null}
      {error ? <Banner>{error}</Banner> : null}

      {view.map((v, i) => {
        const l = v.line;
        const choices = unitChoices(v.material, masters.units, masters.conversions, false);
        return (
          <Card key={l.key}>
            <Picker
              label={lines.length > 1 ? `Material ${i + 1}` : 'Material'}
              placeholder="Search material…"
              value={l.materialId}
              options={masters.materials.map((m) => {
                const have = stock.byMaterial.get(m.id)?.availableQty ?? '0';
                return {
                  id: m.id,
                  label: m.name,
                  detail: `${materialDetail(m)} · ${have} ${m.stockUnitCode} available`,
                };
              })}
              onChange={(id) => set(l.key, { materialId: id, unitId: null })}
            />
            {v.material ? (
              <Text style={styles.mono}>
                Available: {v.available} {v.material.stockUnitCode}
              </Text>
            ) : null}
            <QuantityField
              label={`Quantity${v.material ? ` (${masters.units.find((u) => u.id === (l.unitId ?? v.material!.stockUnitId))?.code ?? ''})` : ''}`}
              value={l.quantity}
              onChangeText={(t) => set(l.key, { quantity: t })}
              warn={!!v.material && l.quantity !== '' && !!v.problem}
              hint={
                l.quantity !== '' && v.material
                  ? (v.problem ?? v.converted.text ?? undefined)
                  : undefined
              }
            />
            {choices.length > 1 ? (
              <Segments
                label="Unit"
                value={l.unitId ?? v.material!.stockUnitId}
                options={choices.map((u) => ({ id: u.id, label: u.code }))}
                onChange={(id) =>
                  set(l.key, { unitId: id === v.material!.stockUnitId ? null : id })
                }
              />
            ) : null}
            {!issue ? (
              <Segments<ReturnCondition>
                label="Condition"
                value={l.condition}
                options={CONDITIONS}
                onChange={(c) => set(l.key, { condition: c })}
              />
            ) : null}
            {lines.length > 1 ? (
              <Button
                label="Remove"
                variant="ghost"
                onPress={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
              />
            ) : null}
          </Card>
        );
      })}
      {repeated ? (
        <Banner tone="warning">The same material is listed twice. Put it on one line.</Banner>
      ) : null}
      <Button
        label="Add another material"
        variant="secondary"
        onPress={() => {
          const key = nextKey.current++;
          setLines((ls) => [
            ...ls,
            { key, materialId: null, quantity: '', unitId: null, condition: 'GOOD' },
          ]);
        }}
      />

      <Picker
        label={issue ? 'Issue to (site location)' : 'Returned from (site location)'}
        placeholder="Choose location…"
        value={locationId}
        options={masters.locations.map((loc) => ({ id: loc.id, label: loc.path }))}
        onChange={setLocationId}
      />
      <Picker
        label="Contractor (optional)"
        placeholder="Choose contractor…"
        value={contractorId}
        options={masters.contractors.map((c) => ({
          id: c.id,
          label: c.name,
          detail: c.phone ?? undefined,
        }))}
        onChange={setContractorId}
        onCreate={(typed) => {
          if (typed.length >= 2) void addContractor(typed, false);
          else setError('Type the contractor name in the search box, then tap Add.');
        }}
        createLabel="Add contractor"
      />
      {contractorId ? (
        <Button label="Clear contractor" variant="ghost" onPress={() => setContractorId(null)} />
      ) : null}
      {similar ? (
        <Banner tone="warning" title="A similar contractor exists">
          <Text style={styles.bannerText}>
            {similar.names.join(', ') || 'A contractor with a similar name'} is already in the list.
            Choose it from the list, or add “{similar.name}” if it really is someone else.
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Button
              label={`Add “${similar.name}” anyway`}
              variant="secondary"
              onPress={() => void addContractor(similar.name, true)}
            />
            <Button label="Cancel" variant="ghost" onPress={() => setSimilar(null)} />
          </View>
        </Banner>
      ) : null}
      <Field label="Notes (optional)" value={notes} onChangeText={setNotes} maxLength={500} />
    </Screen>
  );
}
