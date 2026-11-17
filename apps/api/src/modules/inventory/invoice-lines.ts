import type { Prisma } from '@kavach/db';
import {
  type ConversionContext,
  type ConversionRow,
  Decimal,
  type DuplicateHitDto,
  type LineIssue,
  type MatchConflict,
  type ProposedMaterial,
  convert,
  isValidQuantity,
} from '@kavach/shared';
import type { Db } from '../../common/prisma/prisma.service';

/**
 * Backend validation of a draft receipt line (PRD §22.4: the backend validates material identity,
 * units and quantities; §10.2 screens 3–4). One function decides what blocks a line. The review
 * screen shows its answer and Confirm & Receive enforces it, so the two can never disagree.
 */
export const ITEM_INCLUDE = {
  material: { include: { category: true, stockUnit: true, packUnit: true } },
  invoiceUnit: true,
} satisfies Prisma.InvoiceItemInclude;

export type ItemRow = Prisma.InvoiceItemGetPayload<{ include: typeof ITEM_INCLUDE }>;

export interface LineUnit {
  id: string;
  code: string;
  name: string;
  decimalPlaces: number;
}

export interface LineMasters {
  units: Map<string, LineUnit>;
  conversions: ConversionRow[];
}

export async function loadLineMasters(db: Db, projectId: string): Promise<LineMasters> {
  const [units, conversions] = await Promise.all([
    db.unit.findMany({ where: { OR: [{ projectId: null }, { projectId }] } }),
    db.unitConversion.findMany({
      where: { OR: [{ projectId: null }, { projectId }], isActive: true },
    }),
  ]);
  return {
    units: new Map(
      units.map((u) => [
        u.id,
        { id: u.id, code: u.code, name: u.name, decimalPlaces: u.decimalPlaces },
      ]),
    ),
    conversions: conversions.map((c) => ({
      fromUnitId: c.fromUnitId,
      toUnitId: c.toUnitId,
      factor: c.factor.toString(),
      materialId: c.materialId,
    })),
  };
}

export interface LineAssessment {
  issues: LineIssue[];
  warnings: string[];
  /** What will enter stock, in the stock unit. null while the line cannot be converted. */
  stock: {
    unitId: string;
    unitCode: string;
    accepted: Decimal;
    damaged: Decimal;
    factor: Decimal;
  } | null;
}

const d = (v: Prisma.Decimal | null | undefined): Decimal => new Decimal(v?.toString() ?? '0');

export function proposalOf(item: Pick<ItemRow, 'proposedMaterial'>): ProposedMaterial | null {
  return (item.proposedMaterial as unknown as ProposedMaterial | null) ?? null;
}

export function assessLine(item: ItemRow, masters: LineMasters): LineAssessment {
  const issues: LineIssue[] = [];
  const warnings: string[] = [];
  const add = (code: LineIssue['code'], message: string) => issues.push({ code, message });

  if (item.lineStatus === 'EXCLUDED') return { issues, warnings, stock: null };

  // ── Material: an existing one, or a complete new-material proposal ─────────
  const proposal = proposalOf(item);
  let stockUnitId: string | null = null;
  let materialUnits: ConversionContext['material'];
  if (item.material) {
    if (item.material.status !== 'ACTIVE') {
      add('MATERIAL_INACTIVE', `${item.material.name} is inactive. Choose another material.`);
    }
    stockUnitId = item.material.stockUnitId;
    materialUnits = {
      id: item.material.id,
      stockUnitId: item.material.stockUnitId,
      packSize: item.material.packSize?.toString() ?? null,
      packUnitId: item.material.packUnitId,
      isVariableWeight: item.material.isVariableWeight,
    };
  } else if (proposal) {
    const missing: string[] = [];
    if (!proposal.name?.trim()) missing.push('name');
    if (!proposal.categoryId) missing.push('category');
    if (!proposal.stockUnitId) missing.push('unit');
    if ((proposal.packSize === null) !== (proposal.packUnitId === null))
      missing.push('pack size and its unit');
    if (missing.length > 0) {
      add('NEW_MATERIAL_INCOMPLETE', `New material: enter the ${missing.join(', ')}.`);
    }
    stockUnitId = proposal.stockUnitId;
    if (proposal.stockUnitId) {
      materialUnits = {
        id: `new:${item.id}`,
        stockUnitId: proposal.stockUnitId,
        packSize: proposal.packSize,
        packUnitId: proposal.packUnitId,
        isVariableWeight: proposal.isVariableWeight,
      };
    }
  } else {
    add('MATERIAL_REQUIRED', 'Choose the material, or create a new one.');
  }

  // ── Unit ───────────────────────────────────────────────────────────────────
  const unit = item.invoiceUnitId ? masters.units.get(item.invoiceUnitId) : undefined;
  if (!unit) {
    add(
      'UNIT_REQUIRED',
      item.invoiceUnitRaw
        ? `"${item.invoiceUnitRaw}" is not in the unit list. Choose the unit.`
        : 'Choose the unit.',
    );
  }

  // ── Quantities: invoice quantity and actual received quantity are separate (PRD §10.2 screen 4)
  const accepted = d(item.acceptedQty);
  const damaged = d(item.damagedQty);
  const rejected = d(item.rejectedQty);
  const received = accepted.plus(damaged).plus(rejected);
  if (item.acceptedQty === null || received.lte(0)) {
    add('QUANTITY_REQUIRED', 'Enter the quantity actually received, or exclude the line.');
  }
  if (unit) {
    for (const [label, qty] of [
      ['Accepted', accepted],
      ['Damaged', damaged],
      ['Rejected', rejected],
    ] as const) {
      if (!isValidQuantity(qty.toString(), unit.decimalPlaces)) {
        add('QUANTITY_NOT_WHOLE', `${label} quantity: ${unit.name} are counted in whole numbers.`);
        break;
      }
    }
  }
  if (item.invoiceQty !== null) {
    const invoiced = d(item.invoiceQty);
    const differs = !received.equals(invoiced) || damaged.gt(0) || rejected.gt(0);
    if (differs && !item.discrepancyReason) {
      add('REASON_REQUIRED', 'The received quantity differs from the document. Choose the reason.');
    }
    if (received.gt(invoiced) && item.discrepancyReason && item.discrepancyReason !== 'EXCESS') {
      warnings.push('More was received than the document states.');
    }
  }

  // ── Conversion to the stock unit: approved conversions only (PRD §12.4) ────
  let stock: LineAssessment['stock'] = null;
  if (unit && stockUnitId && materialUnits && masters.units.has(stockUnitId)) {
    const ctx: ConversionContext = {
      units: new Map(
        [...masters.units].map(([id, u]) => [id, { id, decimalPlaces: u.decimalPlaces }]),
      ),
      conversions: masters.conversions,
      material: materialUnits,
      // Receipts may use a material's own approved conversions (DECISIONS Q10).
      allowMaterialSpecific: true,
    };
    const a = convert(accepted, unit.id, stockUnitId, ctx);
    const dm = convert(damaged, unit.id, stockUnitId, ctx);
    const stockUnit = masters.units.get(stockUnitId)!;
    if (a.ok && dm.ok) {
      stock = {
        unitId: stockUnitId,
        unitCode: stockUnit.code,
        accepted: a.qty,
        damaged: dm.qty,
        factor: a.factor,
      };
    } else {
      const reason = !a.ok ? a.reason : !dm.ok ? dm.reason : 'INCOMPATIBLE';
      if (reason === 'NOT_REPRESENTABLE') {
        add(
          'QUANTITY_NOT_WHOLE',
          `This quantity in ${unit.code} is not a whole number of ${stockUnit.code}. Correct the quantity or the unit.`,
        );
      } else {
        add(
          'UNIT_INCOMPATIBLE',
          `${unit.code} cannot be converted to ${stockUnit.code} for this material. Only approved conversions are used.`,
        );
      }
    }
  }

  // ── Soft checks (DECISIONS Q35): never blocking ────────────────────────────
  if (item.invoiceQty !== null && item.unitPrice !== null && item.lineTotal !== null) {
    const expected = d(item.invoiceQty).mul(d(item.unitPrice));
    const total = d(item.lineTotal);
    const tolerance = Decimal.max(new Decimal(1), total.abs().mul('0.005'));
    if (expected.minus(total).abs().gt(tolerance)) {
      warnings.push(
        `Quantity × rate is ${expected.toDecimalPlaces(2).toString()}, but the line total reads ${total.toString()}. Check the quantity.`,
      );
    }
  }
  const conflicts = (item.specConflicts as unknown as MatchConflict[] | null) ?? [];
  if (item.material && conflicts.length > 0) {
    warnings.push(
      `Differs from the document: ${conflicts.map((c) => `${c.key} ${c.line} vs ${c.material}`).join('; ')}.`,
    );
  }

  if (issues.length === 0 && item.lineStatus !== 'CONFIRMED') {
    add('NOT_CONFIRMED', 'Check this line and tick it to confirm.');
  } else if (item.lineStatus !== 'CONFIRMED') {
    // Listed last, so the user sees what to fix before the tick.
    add('NOT_CONFIRMED', 'Tick the line once it is correct.');
  }

  return { issues, warnings, stock };
}

// ── Duplicate invoice protection (PRD §13) ───────────────────────────────────

export interface DuplicateProbe {
  projectId: string;
  invoiceId: string;
  supplierId: string | null;
  normalizedInvoiceNo: string | null;
  invoiceDate: Date | null;
  normalizedChallanNo: string | null;
  documentFingerprint: string | null;
}

/**
 * Earlier receipts that look like this document. Checked on Project ID, Supplier ID, Invoice
 * Number, Invoice Date and Document Fingerprint (PRD §13.2), plus the challan number, so a
 * challan and the invoice that follows it are not both received (DECISIONS Q8).
 * A reversed receipt does not count: the reversal freed the invoice (DECISIONS Q15).
 */
export async function findDuplicateInvoices(db: Db, p: DuplicateProbe): Promise<DuplicateHitDto[]> {
  const or: Prisma.InvoiceWhereInput[] = [];
  if (p.documentFingerprint) or.push({ documentFingerprint: p.documentFingerprint });
  if (p.supplierId && p.normalizedInvoiceNo) {
    or.push({
      supplierId: p.supplierId,
      normalizedInvoiceNo: p.normalizedInvoiceNo,
      invoiceDate: p.invoiceDate,
    });
  }
  if (p.supplierId && p.normalizedChallanNo) {
    or.push({ supplierId: p.supplierId, normalizedChallanNo: p.normalizedChallanNo });
  }
  if (or.length === 0) return [];

  const rows = await db.invoice.findMany({
    where: { projectId: p.projectId, status: 'POSTED', id: { not: p.invoiceId }, OR: or },
    include: { supplier: { select: { name: true } }, posting: { select: { referenceNo: true } } },
    orderBy: { postedAt: 'desc' },
    take: 5,
  });
  return rows.map((r) => ({
    kind:
      p.documentFingerprint && r.documentFingerprint === p.documentFingerprint
        ? 'FINGERPRINT'
        : p.normalizedInvoiceNo &&
            r.normalizedInvoiceNo === p.normalizedInvoiceNo &&
            r.supplierId === p.supplierId
          ? 'HEADER'
          : 'CHALLAN',
    invoiceId: r.id,
    invoiceNo: r.invoiceNo,
    challanNo: r.challanNo,
    supplierName: r.supplier?.name ?? r.supplierNameRaw,
    receivedAt: r.postedAt?.toISOString() ?? null,
    referenceNo: r.posting?.referenceNo ?? null,
  }));
}

/** The unique keys a posted invoice holds, so two confirmations in a race cannot both post. */
export function duplicateKeys(p: DuplicateProbe & { supplierId: string }) {
  return {
    dupHeaderKey: p.normalizedInvoiceNo
      ? `${p.supplierId}:${p.normalizedInvoiceNo}:${p.invoiceDate?.toISOString().slice(0, 10) ?? ''}`
      : null,
    dupFingerprintKey: p.documentFingerprint ? `${p.projectId}:${p.documentFingerprint}` : null,
    dupChallanKey: p.normalizedChallanNo ? `${p.supplierId}:${p.normalizedChallanNo}` : null,
  };
}
