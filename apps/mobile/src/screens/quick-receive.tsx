import type { CategoryDto, QuickReceiveInput, UnitDto } from '@kavach/shared';
import { useState } from 'react';
import { Text } from 'react-native';
import { ApiError, api, errorMessage } from '../lib/api';
import { isQuantity, materialDetail, toStockUnit, unitChoices, useMasters } from '../lib/data';
import { useNav } from '../lib/nav';
import { postSafely } from '../lib/retry';
import { queryClient, refreshAfterPosting, useSession } from '../lib/session';
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

/** What the user fills in for a material that is not in the Material Master yet. */
export interface NewMaterialValue {
  name: string;
  categoryId: string | null;
  brand: string;
  grade: string;
  size: string;
  stockUnitId: string | null;
  packSize: string;
  packUnitId: string | null;
  confirmNotDuplicate: boolean;
}

export const emptyMaterial = (name = ''): NewMaterialValue => ({
  name,
  categoryId: null,
  brand: '',
  grade: '',
  size: '',
  stockUnitId: null,
  packSize: '',
  packUnitId: null,
  confirmNotDuplicate: false,
});

export const materialComplete = (v: NewMaterialValue): boolean =>
  v.name.trim().length > 0 &&
  !!v.categoryId &&
  !!v.stockUnitId &&
  (v.packSize === '' || (isQuantity(v.packSize) && !!v.packUnitId));

/**
 * The few fields that make a material what it is (PRD §6). Nothing is filled in by guessing:
 * a pack size is typed by the user or left empty.
 */
export function NewMaterialFields({
  value,
  onChange,
  categories,
  units,
  askDuplicate,
}: {
  value: NewMaterialValue;
  onChange: (v: NewMaterialValue) => void;
  categories: CategoryDto[];
  units: UnitDto[];
  /** A similar material exists: the user must say this one is different. */
  askDuplicate: boolean;
}) {
  const set = (patch: Partial<NewMaterialValue>) => onChange({ ...value, ...patch });
  return (
    <>
      <Field
        label="Material name"
        value={value.name}
        onChangeText={(name) => set({ name })}
        maxLength={160}
      />
      <Picker
        label="Category"
        value={value.categoryId}
        options={categories.map((c) => ({ id: c.id, label: c.name }))}
        onChange={(categoryId) => set({ categoryId })}
      />
      <Picker
        label="Stock unit (how it is counted in the store)"
        value={value.stockUnitId}
        options={units.map((u) => ({ id: u.id, label: u.code, detail: u.name }))}
        onChange={(stockUnitId) => set({ stockUnitId })}
      />
      <Field
        label="Brand (optional)"
        value={value.brand}
        onChangeText={(brand) => set({ brand })}
        maxLength={80}
      />
      <Field
        label="Grade (optional)"
        value={value.grade}
        onChangeText={(grade) => set({ grade })}
        maxLength={40}
      />
      <Field
        label="Size (optional)"
        value={value.size}
        onChangeText={(size) => set({ size })}
        maxLength={60}
        hint="For example 12 MM. Different sizes are different materials."
      />
      <QuantityField
        label="Pack size (optional)"
        value={value.packSize}
        onChangeText={(packSize) => set({ packSize })}
        hint="Only if it is printed on the pack, for example 50 for a 50 KG bag."
      />
      {value.packSize !== '' ? (
        <Picker
          label="Pack size unit"
          value={value.packUnitId}
          options={units.map((u) => ({ id: u.id, label: u.code, detail: u.name }))}
          onChange={(packUnitId) => set({ packUnitId })}
          warn={!value.packUnitId}
        />
      ) : null}
      {askDuplicate ? (
        <Segments<'no' | 'yes'>
          label="A similar material already exists. Is this a different one?"
          value={value.confirmNotDuplicate ? 'yes' : 'no'}
          options={[
            { id: 'no', label: 'Not sure' },
            { id: 'yes', label: 'Yes, it is different' },
          ]}
          onChange={(v) => set({ confirmNotDuplicate: v === 'yes' })}
        />
      ) : null}
    </>
  );
}

/** Quick Receive (PRD §10.3): one material that arrived without a readable document. */
export function QuickReceiveScreen() {
  const nav = useNav();
  const { store } = useSession();
  const masters = useMasters();
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [fresh, setFresh] = useState<NewMaterialValue | null>(null);
  const [quantity, setQuantity] = useState('');
  const [unitId, setUnitId] = useState<string | null>(null);
  const [supplierName, setSupplierName] = useState('');
  const [externalRef, setExternalRef] = useState('');
  const [notes, setNotes] = useState('');
  const [askDuplicate, setAskDuplicate] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const material = masters.materials.find((m) => m.id === materialId);
  const converted = toStockUnit(
    quantity,
    unitId,
    material,
    masters.units,
    masters.conversions,
    true,
  );
  const choices = unitChoices(material, masters.units, masters.conversions, true);
  const stockUnitCode = fresh
    ? (masters.units.find((u) => u.id === fresh.stockUnitId)?.code ?? '')
    : (material?.stockUnitCode ?? '');
  const ready =
    !!store &&
    isQuantity(quantity) &&
    (fresh
      ? materialComplete(fresh) && (!askDuplicate || fresh.confirmNotDuplicate)
      : !!material && converted.ok);

  const post = async () => {
    if (!store) return;
    setBusy(true);
    setError(null);
    const input: QuickReceiveInput = {
      storeId: store.id,
      notes: notes.trim() || null,
      supplierName: supplierName.trim() || null,
      externalRef: externalRef.trim() || null,
      quantity,
      unitId: fresh ? null : unitId,
      materialId: fresh ? null : materialId,
      newMaterial: fresh
        ? {
            name: fresh.name.trim(),
            categoryId: fresh.categoryId!,
            stockUnitId: fresh.stockUnitId!,
            brand: fresh.brand.trim() || null,
            grade: fresh.grade.trim() || null,
            size: fresh.size.trim() || null,
            packSize: fresh.packSize || null,
            packUnitId: fresh.packSize ? fresh.packUnitId : null,
            confirmNotDuplicate: fresh.confirmNotDuplicate,
          }
        : null,
    };
    try {
      const posting = await postSafely('quick-receive', input, (key) =>
        api.inventory.quickReceive(input, key),
      );
      if (posting.createdMaterialId)
        void queryClient.invalidateQueries({ queryKey: ['materials'] });
      refreshAfterPosting();
      nav.replace({ name: 'posted', posting, title: 'Material received' });
    } catch (e) {
      setBusy(false);
      setChecking(false);
      if (e instanceof ApiError && e.code === 'POSSIBLE_DUPLICATE' && fresh) {
        setAskDuplicate(true);
        setError(
          'A similar material already exists. Go back and choose it from the list, or say below that this one is different.',
        );
      } else if (e instanceof ApiError && (e.code === 'NETWORK' || e.status >= 500)) {
        setError(
          `${errorMessage(e)} Nothing is posted twice: check and confirm again to retry safely.`,
        );
      } else {
        setError(errorMessage(e));
      }
    }
  };

  if (!store) {
    return (
      <Screen title="Quick Receive">
        <Banner tone="warning">No store is selected.</Banner>
      </Screen>
    );
  }
  if (masters.loading) {
    return (
      <Screen title="Quick Receive">
        <Loading />
      </Screen>
    );
  }

  if (checking) {
    return (
      <Screen
        title="Check and confirm"
        subtitle={`Store: ${store.name}`}
        footer={
          <>
            <Button label="Confirm & Receive" big busy={busy} onPress={() => void post()} />
            <Button
              label="Change something"
              variant="secondary"
              disabled={busy}
              onPress={() => setChecking(false)}
            />
          </>
        }
      >
        <Card>
          <Text style={[styles.text, { fontWeight: '700' }]}>
            {fresh ? `${fresh.name.trim()} (new material)` : material?.name}
          </Text>
          <Row
            label="Goes into available stock"
            value={`${fresh ? quantity : converted.qty} ${stockUnitCode}`}
          />
          {!fresh && converted.text ? (
            <Text style={styles.hint}>
              Entered as {quantity} {masters.units.find((u) => u.id === unitId)?.code}
            </Text>
          ) : null}
          {supplierName.trim() ? <Row label="Supplier" value={supplierName.trim()} /> : null}
          {externalRef.trim() ? <Row label="Document number" value={externalRef.trim()} /> : null}
        </Card>
        {fresh ? (
          <Banner tone="info">This also adds a new material to the Material Master.</Banner>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen
      title="Quick Receive"
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
      {error ? <Banner>{error}</Banner> : null}
      {fresh ? (
        <Card>
          <Text style={styles.h2}>New material</Text>
          <NewMaterialFields
            value={fresh}
            onChange={setFresh}
            categories={masters.categories}
            units={masters.units}
            askDuplicate={askDuplicate}
          />
          <Button
            label="Choose an existing material instead"
            variant="ghost"
            onPress={() => {
              setFresh(null);
              setAskDuplicate(false);
            }}
          />
        </Card>
      ) : (
        <Picker
          label="Material"
          placeholder="Search material…"
          value={materialId}
          options={masters.materials.map((m) => ({
            id: m.id,
            label: m.name,
            detail: materialDetail(m),
          }))}
          onChange={(id) => {
            setMaterialId(id);
            setUnitId(null);
          }}
          onCreate={(typed) => {
            setMaterialId(null);
            setUnitId(null);
            setFresh(emptyMaterial(typed));
          }}
          createLabel="New material"
        />
      )}
      <QuantityField
        label={`Quantity received${stockUnitCode && !unitId ? ` (${stockUnitCode})` : unitId ? ` (${masters.units.find((u) => u.id === unitId)?.code})` : ''}`}
        value={quantity}
        onChangeText={setQuantity}
        warn={!fresh && !!material && quantity !== '' && !converted.ok}
        hint={!fresh && material && quantity !== '' ? (converted.text ?? undefined) : undefined}
      />
      {!fresh && material && choices.length > 1 ? (
        <Segments
          label="Unit"
          value={unitId ?? material.stockUnitId}
          options={choices.map((u) => ({ id: u.id, label: u.code }))}
          onChange={(id) => setUnitId(id === material.stockUnitId ? null : id)}
        />
      ) : null}
      <Field
        label="Supplier (optional)"
        value={supplierName}
        onChangeText={setSupplierName}
        maxLength={160}
      />
      <Field
        label="Invoice or challan number (optional)"
        value={externalRef}
        onChangeText={setExternalRef}
        maxLength={80}
        autoCapitalize="characters"
      />
      <Field label="Notes (optional)" value={notes} onChangeText={setNotes} maxLength={500} />
    </Screen>
  );
}
