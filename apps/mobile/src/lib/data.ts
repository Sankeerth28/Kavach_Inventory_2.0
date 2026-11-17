import {
  type ConversionDto,
  type MaterialDto,
  type StockStatus,
  type TransactionDto,
  type UnitDto,
  convert,
} from '@kavach/shared';
import { useQuery } from '@tanstack/react-query';
import type { Tone } from '../ui';
import { api } from './api';

/** Master lists the forms need. Loaded once and cached; they change rarely. */
export function useMasters() {
  const materials = useQuery({
    queryKey: ['materials', 'active'],
    queryFn: () => api.materials.list({ status: 'ACTIVE', pageSize: 500 }),
    staleTime: 60_000,
  });
  const units = useQuery({ queryKey: ['units'], queryFn: api.units.list, staleTime: 300_000 });
  const conversions = useQuery({
    queryKey: ['conversions'],
    queryFn: api.conversions.list,
    staleTime: 300_000,
  });
  const locations = useQuery({
    queryKey: ['locations'],
    queryFn: api.locations.list,
    staleTime: 60_000,
  });
  const contractors = useQuery({
    queryKey: ['contractors'],
    queryFn: api.contractors.list,
    staleTime: 60_000,
  });
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: api.categories.list,
    staleTime: 300_000,
  });
  return {
    materials: materials.data?.items ?? [],
    units: (units.data ?? []).filter((u) => u.isActive),
    conversions: (conversions.data ?? []).filter((c) => c.isActive),
    locations: (locations.data ?? []).filter((l) => l.isActive),
    contractors: (contractors.data ?? []).filter((c) => c.isActive && !c.mergedIntoId),
    categories: (categories.data ?? []).filter((c) => c.isActive && !c.parentId),
    loading: materials.isPending || units.isPending || locations.isPending,
    error: materials.error ?? units.error ?? locations.error ?? null,
  };
}

export interface Converted {
  ok: boolean;
  /** Quantity in the stock unit, when it converts. */
  qty: string | null;
  /** What to tell the user. */
  text: string | null;
  /** Why it does not convert. */
  reason?: 'INCOMPATIBLE' | 'NOT_REPRESENTABLE' | 'UNKNOWN_UNIT';
}

/**
 * Shows what a typed quantity becomes in the stock unit before the user confirms (DECISIONS Q10).
 * The server converts again and is the authority; this is the same shared function.
 * `receipt` allows a material's own approved conversions; issue and return do not.
 */
export function toStockUnit(
  quantity: string,
  unitId: string | null,
  material: MaterialDto | undefined,
  units: UnitDto[],
  conversions: ConversionDto[],
  receipt: boolean,
): Converted {
  if (!material || !quantity || !/^\d+(\.\d{1,3})?$/.test(quantity) || Number(quantity) <= 0) {
    return { ok: false, qty: null, text: null };
  }
  const from = unitId ?? material.stockUnitId;
  const code = (id: string) => units.find((u) => u.id === id)?.code ?? '?';
  const result = convert(quantity, from, material.stockUnitId, {
    units: new Map(units.map((u) => [u.id, { id: u.id, decimalPlaces: u.decimalPlaces }])),
    conversions: conversions.map((c) => ({
      fromUnitId: c.fromUnitId,
      toUnitId: c.toUnitId,
      factor: c.factor,
      materialId: c.materialId,
    })),
    material: {
      id: material.id,
      stockUnitId: material.stockUnitId,
      packSize: material.packSize,
      packUnitId: material.packUnitId,
      isVariableWeight: material.isVariableWeight,
    },
    allowMaterialSpecific: receipt,
  });
  if (!result.ok) {
    return {
      ok: false,
      qty: null,
      reason: result.reason,
      text:
        result.reason === 'NOT_REPRESENTABLE'
          ? `${quantity} ${code(from)} is not a whole number of ${material.stockUnitCode}.`
          : `${code(from)} cannot be converted to ${material.stockUnitCode} for this material.`,
    };
  }
  const qty = result.qty.toString();
  return {
    ok: true,
    qty,
    text: from === material.stockUnitId ? null : `= ${qty} ${material.stockUnitCode}`,
  };
}

export const STOCK_STATUS: Record<StockStatus, { label: string; tone: Tone }> = {
  AVAILABLE: { label: 'In stock', tone: 'success' },
  LOW: { label: 'Low stock', tone: 'warning' },
  OUT: { label: 'Out of stock', tone: 'danger' },
  INACTIVE: { label: 'Inactive', tone: 'neutral' },
};

export const TXN_LABEL: Record<TransactionDto['type'], string> = {
  MATERIAL_IN: 'Material In',
  MATERIAL_OUT: 'Material Out',
  MATERIAL_RETURN: 'Return',
  STOCK_ADJUSTMENT: 'Adjustment',
  REVERSAL: 'Reversal',
};

export function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return today
    ? `Today ${time}`
    : `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${time}`;
}

/** "+490 BAG" / "−25 KG": the signed movement of a ledger row. */
export function movement(t: TransactionDto): string {
  const n = Number(t.quantity);
  return `${n > 0 ? '+' : '−'}${t.quantity.replace('-', '')} ${t.unitCode}`;
}

/** Units a quantity of this material may be typed in: the stock unit first, then every unit with an approved path to it. */
export function unitChoices(
  material: MaterialDto | undefined,
  units: UnitDto[],
  conversions: ConversionDto[],
  receipt: boolean,
): UnitDto[] {
  if (!material) return [];
  const usable = units.filter((u) => {
    if (u.id === material.stockUnitId) return false;
    // "1000" converts under any approved factor; a failure here means there is no approved path.
    const probe = toStockUnit('1000', u.id, material, units, conversions, receipt);
    return probe.ok || probe.reason === 'NOT_REPRESENTABLE';
  });
  const stock = units.find((u) => u.id === material.stockUnitId);
  return stock ? [stock, ...usable] : usable;
}

/** Available stock of every material in one store, for pickers and checks before posting. */
export function useStoreStock(storeId: string | undefined) {
  const query = useQuery({
    queryKey: ['stock', 'store', storeId],
    queryFn: () => api.stock.list({ storeId, pageSize: 500 }),
    enabled: !!storeId,
  });
  const byMaterial = new Map((query.data?.items ?? []).map((r) => [r.materialId, r]));
  return { byMaterial, loading: query.isPending, error: query.error };
}

/** "Cement OPC 53 · 50 KG" style one-line description of a material's variant. */
export function materialDetail(
  m: Pick<MaterialDto, 'code' | 'brand' | 'grade' | 'size' | 'stockUnitCode'>,
): string {
  return [m.code, m.brand, m.grade, m.size, m.stockUnitCode].filter(Boolean).join(' · ');
}

export const isQuantity = (v: string): boolean => /^\d{1,15}(\.\d{1,3})?$/.test(v) && Number(v) > 0;
