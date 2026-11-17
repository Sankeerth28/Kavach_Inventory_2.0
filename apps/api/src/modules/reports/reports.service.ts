import { Injectable } from '@nestjs/common';
import { Prisma } from '@kavach/db';
import {
  Decimal,
  REPORTS,
  type ReportCell,
  type ReportColumn,
  type ReportDefinition,
  type ReportDto,
  type ReportKey,
  type ReportQuery,
  type TxnType,
  reportsFor,
} from '@kavach/shared';
import { type RequestContext, assertStoreAccess } from '../../common/context/request-context';
import { forbidden, notFound } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';

type Row = Record<string, ReportCell>;

interface Scope {
  projectId: string;
  /** null = every store of the project (Project Admin, no store chosen). */
  stores: string[] | null;
  /** Inclusive start and exclusive end of the period, as instants. */
  from: Date;
  to: Date;
  query: ReportQuery;
  /** One more than the caller wants, to know whether there is more. */
  take: number;
}

interface Built {
  columns: ReportColumn[];
  rows: Row[];
  notes?: string[];
}

const col = (key: string, label: string, kind: ReportColumn['kind'] = 'text'): ReportColumn => ({
  key,
  label,
  kind,
});

const SOURCE_LABEL: Record<string, string> = {
  MANUAL: 'Entered by hand',
  AI_INVOICE: 'From a scanned document',
  QUICK_RECEIVE: 'Quick Receive',
  SEED: 'Initial data',
};

const INVOICE_STATUS_LABEL: Record<string, string> = {
  UPLOADING: 'Uploading',
  QUEUED: 'Waiting to be read',
  PROCESSING: 'Being read',
  NEEDS_RECAPTURE: 'Better photo needed',
  READY_FOR_REVIEW: 'Ready for review',
  POSTED: 'Received',
  REVERSED: 'Reversed',
  FAILED: 'Could not be read',
  DISCARDED: 'Discarded',
};

const title = (v: string): string => v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ');

/** Today as YYYY-MM-DD in a time zone. */
function today(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Reports (PRD §19). Read-only: every report is computed from the ledger, the balances and the
 * masters, inside the caller's project and stores. Nothing here changes stock.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  available(ctx: RequestContext): ReportDefinition[] {
    return reportsFor(ctx.permissions);
  }

  async run(
    ctx: RequestContext,
    key: ReportKey,
    query: ReportQuery,
    limit: number,
  ): Promise<ReportDto> {
    const def = REPORTS[key];
    // Admin-only reports are refused here, not just hidden (CLAUDE.md invariant 7, DECISIONS Q18).
    if (!this.available(ctx).some((r) => r.key === key)) {
      throw forbidden('You do not have permission to see this report.');
    }
    if (query.storeId) assertStoreAccess(ctx, query.storeId);

    const db = this.prisma.db;
    const project = await db.project.findUniqueOrThrow({
      where: { id: ctx.projectId },
      select: { name: true, timezone: true },
    });
    let timezone = project.timezone;
    try {
      today(timezone);
    } catch {
      timezone = 'UTC';
    }

    const uses = (f: ReportDefinition['filters'][number]) => def.filters.includes(f);
    const toDay = query.to ?? today(timezone);
    const fromDay = query.from ?? addDays(toDay, -29);
    const [range] = await db.$queryRaw<{ from: Date; to: Date }[]>`
      SELECT (${fromDay}::date)::timestamp AT TIME ZONE ${timezone} AS "from",
             (${toDay}::date + 1)::timestamp AT TIME ZONE ${timezone} AS "to"`;

    const scope: Scope = {
      projectId: ctx.projectId,
      stores: query.storeId ? [query.storeId] : ctx.storeIds === 'ALL' ? null : [...ctx.storeIds],
      from: range!.from,
      to: range!.to,
      query,
      take: limit + 1,
    };

    const built = await this.build(key, scope);
    const filters = await this.describeFilters(ctx, def, scope, fromDay, toDay);

    return {
      key,
      title: def.title,
      projectName: project.name,
      timezone,
      generatedAt: new Date().toISOString(),
      generatedByName: ctx.userName,
      filters: uses('dates') ? filters : filters.filter((f) => f.label !== 'Period'),
      columns: built.columns,
      rows: built.rows.slice(0, limit),
      truncated: built.rows.length > limit,
      notes: built.notes ?? [],
    };
  }

  private build(key: ReportKey, s: Scope): Promise<Built> {
    switch (key) {
      case 'current-stock':
        return this.currentStock(s);
      case 'material-in':
        return this.ledger(s, 'MATERIAL_IN');
      case 'material-out':
        return this.ledger(s, 'MATERIAL_OUT');
      case 'material-return':
        return this.ledger(s, 'MATERIAL_RETURN');
      case 'material-movement':
        return this.movement(s);
      case 'supplier-wise':
        return this.supplierWise(s);
      case 'low-stock':
        return this.lowStock(s);
      case 'stock-discrepancy':
        return this.discrepancy(s);
      case 'ai-processing':
        return this.aiProcessing(s);
      case 'new-materials':
        return this.newMaterials(s);
    }
  }

  private async describeFilters(
    ctx: RequestContext,
    def: ReportDefinition,
    s: Scope,
    fromDay: string,
    toDay: string,
  ): Promise<{ label: string; value: string }[]> {
    const db = this.prisma.db;
    const q = s.query;
    const out: { label: string; value: string }[] = [
      { label: 'Period', value: `${fromDay} to ${toDay}` },
    ];
    if (def.filters.includes('store')) {
      if (s.stores === null) out.push({ label: 'Store', value: 'All stores (project-wide)' });
      else {
        const stores = await db.store.findMany({
          where: { projectId: ctx.projectId, id: { in: s.stores } },
          select: { name: true },
          orderBy: { name: 'asc' },
        });
        out.push({ label: 'Store', value: stores.map((x) => x.name).join(', ') || 'None' });
      }
    }
    if (def.filters.includes('byStore') && q.byStore) {
      out.push({ label: 'Shown', value: 'Store-wise' });
    }
    if (def.filters.includes('material') && q.materialId) {
      const m = await db.material.findFirst({
        where: { projectId: ctx.projectId, id: q.materialId },
        select: { code: true, name: true },
      });
      if (!m) throw notFound('Material');
      out.push({ label: 'Material', value: `${m.code} ${m.name}` });
    }
    if (def.filters.includes('supplier') && q.supplierId) {
      const sup = await db.supplier.findFirst({
        where: { projectId: ctx.projectId, id: q.supplierId },
        select: { name: true },
      });
      if (!sup) throw notFound('Supplier');
      out.push({ label: 'Supplier', value: sup.name });
    }
    if (def.filters.includes('category') && q.categoryId) {
      const c = await db.materialCategory.findFirst({
        where: { projectId: ctx.projectId, id: q.categoryId },
        select: { name: true },
      });
      if (!c) throw notFound('Category');
      out.push({ label: 'Category', value: c.name });
    }
    return out;
  }

  /** Available stock of every material across the whole project: what LOW and OUT are judged on (Q21). */
  private async projectAvailable(projectId: string): Promise<Map<string, Decimal>> {
    const sums = await this.prisma.db.stockBalance.groupBy({
      by: ['materialId'],
      where: { projectId },
      _sum: { availableQty: true },
    });
    return new Map(
      sums.map((r) => [r.materialId, new Decimal((r._sum.availableQty ?? 0).toString())]),
    );
  }

  private status(
    material: { status: string; minimumStock: Prisma.Decimal | null },
    projectAvailable: Decimal,
  ): 'Available' | 'Low stock' | 'Out of stock' | 'Inactive' {
    if (material.status === 'INACTIVE') return 'Inactive';
    if (projectAvailable.lte(0)) return 'Out of stock';
    if (material.minimumStock && projectAvailable.lte(material.minimumStock.toString())) {
      return 'Low stock';
    }
    return 'Available';
  }

  // ── 1. Current Stock ───────────────────────────────────────────────────────

  private async currentStock(s: Scope): Promise<Built> {
    const db = this.prisma.db;
    const byStore = s.query.byStore;
    const [materials, projectAvail] = await Promise.all([
      db.material.findMany({
        where: {
          projectId: s.projectId,
          ...(s.query.categoryId ? { categoryId: s.query.categoryId } : {}),
        },
        include: {
          category: { select: { name: true } },
          stockUnit: { select: { code: true } },
          balances: {
            where: { projectId: s.projectId, ...(s.stores ? { storeId: { in: s.stores } } : {}) },
            include: { store: { select: { name: true } } },
          },
        },
        orderBy: { name: 'asc' },
        take: s.take,
      }),
      this.projectAvailable(s.projectId),
    ]);

    const rows: Row[] = [];
    for (const m of materials) {
      const base = {
        code: m.code,
        material: m.name,
        category: m.category.name,
        brand: m.brand,
        grade: m.grade,
        size: m.size,
        unit: m.stockUnit.code,
        minimum: m.minimumStock ? m.minimumStock.toString() : null,
        status: this.status(m, projectAvail.get(m.id) ?? new Decimal(0)),
      };
      if (byStore) {
        for (const b of [...m.balances].sort((x, y) => x.store.name.localeCompare(y.store.name))) {
          rows.push({
            ...base,
            store: b.store.name,
            available: b.availableQty.toString(),
            damaged: b.damagedQty.toString(),
            scrap: b.scrapQty.toString(),
          });
        }
        continue;
      }
      // An inactive material with nothing in stock is of no interest here.
      const sum = (pick: (b: (typeof m.balances)[number]) => Prisma.Decimal) =>
        m.balances.reduce((acc, b) => acc.plus(pick(b).toString()), new Decimal(0));
      const available = sum((b) => b.availableQty);
      const damaged = sum((b) => b.damagedQty);
      const scrap = sum((b) => b.scrapQty);
      if (m.status === 'INACTIVE' && available.isZero() && damaged.isZero() && scrap.isZero()) {
        continue;
      }
      rows.push({
        ...base,
        available: available.toString(),
        damaged: damaged.toString(),
        scrap: scrap.toString(),
      });
    }

    return {
      columns: [
        col('code', 'Material ID'),
        col('material', 'Material'),
        col('category', 'Category'),
        col('brand', 'Brand'),
        col('grade', 'Grade'),
        col('size', 'Size'),
        ...(byStore ? [col('store', 'Store')] : []),
        col('unit', 'Unit'),
        col('available', 'Available', 'quantity'),
        col('damaged', 'Damaged', 'quantity'),
        col('scrap', 'Scrap', 'quantity'),
        col('minimum', 'Minimum stock', 'quantity'),
        col('status', 'Status'),
      ],
      rows,
      notes: [
        'Stock as it is now; this report has no date filter.',
        'Damaged and scrap are kept apart and are not part of available stock.',
        'Status is judged on the available stock of the whole project against the minimum stock.',
        ...(byStore
          ? ['Store-wise: a material appears for a store once it has had stock there.']
          : []),
      ],
    };
  }

  // ── 2–4. Material In, Out, Return ──────────────────────────────────────────

  private async ledger(s: Scope, type: Extract<TxnType, `MATERIAL_${string}`>): Promise<Built> {
    const rows = await this.prisma.db.materialTransaction.findMany({
      where: {
        projectId: s.projectId,
        type,
        createdAt: { gte: s.from, lt: s.to },
        ...(s.stores ? { storeId: { in: s.stores } } : {}),
        ...(s.query.materialId ? { materialId: s.query.materialId } : {}),
        ...(type === 'MATERIAL_IN' && s.query.supplierId
          ? { posting: { supplierId: s.query.supplierId } }
          : {}),
      },
      include: {
        material: { select: { code: true, name: true } },
        store: { select: { name: true } },
        unit: { select: { code: true } },
        enteredUnit: { select: { code: true } },
        location: { select: { path: true } },
        contractor: { select: { name: true } },
        createdBy: { select: { name: true } },
        posting: {
          select: {
            referenceNo: true,
            supplierName: true,
            externalRef: true,
            supplier: { select: { name: true } },
          },
        },
        reversedBy: { select: { id: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { seq: 'desc' }],
      take: s.take,
    });

    const common = (t: (typeof rows)[number]): Row => ({
      date: t.createdAt.toISOString(),
      txn: t.txnNo,
      reference: t.posting.referenceNo,
      store: t.store.name,
      code: t.material.code,
      material: t.material.name,
      // Issues are stored as negative changes; the report shows how much moved.
      quantity: new Decimal(t.quantity.toString()).abs().toString(),
      unit: t.unit.code,
      entered:
        t.enteredQty && t.enteredUnit ? `${t.enteredQty.toString()} ${t.enteredUnit.code}` : null,
      by: t.createdBy.name,
      status: t.reversedBy ? 'Reversed' : 'Posted',
      notes: t.notes,
    });
    const reversedNote =
      'Reversed lines are listed and marked "Reversed"; the stock they moved was put back.';

    if (type === 'MATERIAL_IN') {
      return {
        columns: [
          col('date', 'Date', 'datetime'),
          col('txn', 'Transaction ID'),
          col('reference', 'Receipt No'),
          col('store', 'Store'),
          col('supplier', 'Supplier'),
          col('document', 'Invoice / challan No'),
          col('code', 'Material ID'),
          col('material', 'Material'),
          col('kind', 'Received as'),
          col('quantity', 'Quantity', 'quantity'),
          col('unit', 'Unit'),
          col('entered', 'Entered as'),
          col('by', 'Received by'),
          col('status', 'Status'),
        ],
        rows: rows.map((t) => ({
          ...common(t),
          supplier: t.posting.supplier?.name ?? t.posting.supplierName,
          document: t.posting.externalRef,
          kind: t.bucket === 'AVAILABLE' ? 'Good (available)' : 'Damaged on delivery',
        })),
        notes: [
          'Quantities are what was actually received, not what the invoice said.',
          'Damaged on delivery is kept apart and is not available stock.',
          reversedNote,
        ],
      };
    }
    if (type === 'MATERIAL_OUT') {
      return {
        columns: [
          col('date', 'Date', 'datetime'),
          col('txn', 'Transaction ID'),
          col('reference', 'Issue No'),
          col('store', 'Store'),
          col('code', 'Material ID'),
          col('material', 'Material'),
          col('quantity', 'Quantity', 'quantity'),
          col('unit', 'Unit'),
          col('entered', 'Entered as'),
          col('location', 'Issued to'),
          col('contractor', 'Contractor'),
          col('by', 'Issued by'),
          col('status', 'Status'),
        ],
        rows: rows.map((t) => ({
          ...common(t),
          location: t.location?.path ?? null,
          contractor: t.contractor?.name ?? null,
        })),
        notes: [reversedNote],
      };
    }
    return {
      columns: [
        col('date', 'Date', 'datetime'),
        col('txn', 'Transaction ID'),
        col('reference', 'Return No'),
        col('store', 'Store'),
        col('code', 'Material ID'),
        col('material', 'Material'),
        col('condition', 'Condition'),
        col('quantity', 'Quantity', 'quantity'),
        col('unit', 'Unit'),
        col('entered', 'Entered as'),
        col('location', 'Returned from'),
        col('contractor', 'Contractor'),
        col('by', 'Received by'),
        col('status', 'Status'),
      ],
      rows: rows.map((t) => ({
        ...common(t),
        condition:
          t.returnCondition === 'GOOD'
            ? 'Good (reusable)'
            : t.returnCondition === 'DAMAGED'
              ? 'Damaged'
              : 'Scrap',
        location: t.location?.path ?? null,
        contractor: t.contractor?.name ?? null,
      })),
      notes: ['Only returns in good condition go back into available stock.', reversedNote],
    };
  }

  // ── 5. Material Movement (PRD §19.1, DECISIONS Q16) ────────────────────────

  private async movement(s: Scope): Promise<Built> {
    const db = this.prisma.db;
    const byStore = s.query.byStore;
    const storeFilter = s.stores
      ? Prisma.sql`AND t.store_id = ANY(${s.stores}::uuid[])`
      : Prisma.empty;
    const materialFilter = s.query.materialId
      ? Prisma.sql`AND t.material_id = ${s.query.materialId}::uuid`
      : Prisma.empty;
    const categoryFilter = s.query.categoryId
      ? Prisma.sql`AND m.category_id = ${s.query.categoryId}::uuid`
      : Prisma.empty;
    const storeColumn = byStore ? Prisma.sql`t.store_id` : Prisma.sql`NULL::uuid`;
    // A reversal counts under the type of the row it reverses, so the formula still adds up.
    const eff = Prisma.sql`(CASE WHEN t.type = 'REVERSAL' THEN COALESCE(o.type, t.type) ELSE t.type END)`;
    const inPeriod = Prisma.sql`t.created_at >= ${s.from} AND t.bucket = 'AVAILABLE'`;

    const sums = await db.$queryRaw<
      {
        material_id: string;
        store_id: string | null;
        opening: Prisma.Decimal;
        received: Prisma.Decimal;
        returns: Prisma.Decimal;
        issued: Prisma.Decimal;
        adjustments: Prisma.Decimal;
        closing: Prisma.Decimal;
        damaged: Prisma.Decimal;
        scrap: Prisma.Decimal;
      }[]
    >`
      SELECT t.material_id,
             ${storeColumn} AS store_id,
             COALESCE(SUM(t.quantity) FILTER (WHERE t.created_at < ${s.from} AND t.bucket = 'AVAILABLE'), 0) AS opening,
             COALESCE(SUM(t.quantity) FILTER (WHERE ${inPeriod} AND ${eff} = 'MATERIAL_IN'), 0) AS received,
             COALESCE(SUM(t.quantity) FILTER (WHERE ${inPeriod} AND ${eff} = 'MATERIAL_RETURN'), 0) AS returns,
             COALESCE(-SUM(t.quantity) FILTER (WHERE ${inPeriod} AND ${eff} = 'MATERIAL_OUT'), 0) AS issued,
             COALESCE(SUM(t.quantity) FILTER (WHERE ${inPeriod} AND ${eff} NOT IN ('MATERIAL_IN', 'MATERIAL_RETURN', 'MATERIAL_OUT')), 0) AS adjustments,
             COALESCE(SUM(t.quantity) FILTER (WHERE t.bucket = 'AVAILABLE'), 0) AS closing,
             COALESCE(SUM(t.quantity) FILTER (WHERE t.bucket = 'DAMAGED'), 0) AS damaged,
             COALESCE(SUM(t.quantity) FILTER (WHERE t.bucket = 'SCRAP'), 0) AS scrap
      FROM material_transactions t
      JOIN materials m ON m.id = t.material_id
      LEFT JOIN material_transactions o ON o.id = t.reverses_transaction_id
      WHERE t.project_id = ${s.projectId}::uuid
        AND t.created_at < ${s.to}
        ${storeFilter} ${materialFilter} ${categoryFilter}
      GROUP BY 1, 2`;

    const [materials, stores] = await Promise.all([
      db.material.findMany({
        where: { projectId: s.projectId, id: { in: [...new Set(sums.map((r) => r.material_id))] } },
        select: { id: true, code: true, name: true, stockUnit: { select: { code: true } } },
      }),
      db.store.findMany({ where: { projectId: s.projectId }, select: { id: true, name: true } }),
    ]);
    const material = new Map(materials.map((m) => [m.id, m]));
    const store = new Map(stores.map((x) => [x.id, x.name]));

    const rows: Row[] = sums
      .map((r) => {
        const m = material.get(r.material_id)!;
        return {
          code: m.code,
          material: m.name,
          store: r.store_id ? (store.get(r.store_id) ?? '') : null,
          unit: m.stockUnit.code,
          opening: r.opening.toString(),
          received: r.received.toString(),
          returns: r.returns.toString(),
          issued: r.issued.toString(),
          adjustments: r.adjustments.toString(),
          closing: r.closing.toString(),
          damaged: r.damaged.toString(),
          scrap: r.scrap.toString(),
        };
      })
      .sort(
        (a, b) =>
          a.material.localeCompare(b.material) ||
          String(a.store ?? '').localeCompare(String(b.store ?? '')),
      );

    return {
      columns: [
        col('code', 'Material ID'),
        col('material', 'Material'),
        ...(byStore ? [col('store', 'Store')] : []),
        col('unit', 'Unit'),
        col('opening', 'Opening stock', 'quantity'),
        col('received', 'Material In', 'quantity'),
        col('returns', 'Reusable returns', 'quantity'),
        col('issued', 'Material Out', 'quantity'),
        col('adjustments', 'Adjustments', 'quantity'),
        col('closing', 'Closing stock', 'quantity'),
        col('damaged', 'Damaged at close', 'quantity'),
        col('scrap', 'Scrap at close', 'quantity'),
      ],
      rows: rows.slice(0, s.take),
      notes: [
        'Opening stock + Material In + Reusable returns − Material Out + Adjustments = Closing stock.',
        'Opening, movement and closing are available (usable) stock only.',
        'A reversed transaction is taken out of the column of the transaction it reversed.',
        'Damaged and scrap are shown as they stood at the end of the period and are not part of closing stock.',
      ],
    };
  }

  // ── 6. Supplier-wise ───────────────────────────────────────────────────────

  private async supplierWise(s: Scope): Promise<Built> {
    const db = this.prisma.db;
    const storeFilter = s.stores
      ? Prisma.sql`AND t.store_id = ANY(${s.stores}::uuid[])`
      : Prisma.empty;
    const materialFilter = s.query.materialId
      ? Prisma.sql`AND t.material_id = ${s.query.materialId}::uuid`
      : Prisma.empty;
    const supplierFilter = s.query.supplierId
      ? Prisma.sql`AND p.supplier_id = ${s.query.supplierId}::uuid`
      : Prisma.empty;

    const sums = await db.$queryRaw<
      {
        supplier: string;
        material_id: string;
        accepted: Prisma.Decimal;
        damaged: Prisma.Decimal;
        receipts: bigint;
        last: Date;
      }[]
    >`
      SELECT COALESCE(sup.name, NULLIF(TRIM(p.supplier_name), ''), '(supplier not recorded)') AS supplier,
             t.material_id,
             COALESCE(SUM(t.quantity) FILTER (WHERE t.bucket = 'AVAILABLE'), 0) AS accepted,
             COALESCE(SUM(t.quantity) FILTER (WHERE t.bucket = 'DAMAGED'), 0) AS damaged,
             COUNT(DISTINCT p.id) AS receipts,
             MAX(t.created_at) AS last
      FROM material_transactions t
      JOIN postings p ON p.id = t.posting_id
      LEFT JOIN suppliers sup ON sup.id = p.supplier_id
      LEFT JOIN material_transactions r ON r.reverses_transaction_id = t.id
      WHERE t.project_id = ${s.projectId}::uuid
        AND t.type = 'MATERIAL_IN'
        AND r.id IS NULL
        AND t.created_at >= ${s.from} AND t.created_at < ${s.to}
        ${storeFilter} ${materialFilter} ${supplierFilter}
      GROUP BY 1, 2
      ORDER BY 1, 2
      LIMIT ${s.take}`;

    const materials = await db.material.findMany({
      where: { projectId: s.projectId, id: { in: [...new Set(sums.map((r) => r.material_id))] } },
      select: { id: true, code: true, name: true, stockUnit: { select: { code: true } } },
    });
    const material = new Map(materials.map((m) => [m.id, m]));

    return {
      columns: [
        col('supplier', 'Supplier'),
        col('code', 'Material ID'),
        col('material', 'Material'),
        col('unit', 'Unit'),
        col('accepted', 'Received in good condition', 'quantity'),
        col('damaged', 'Damaged on delivery', 'quantity'),
        col('receipts', 'Receipts', 'count'),
        col('last', 'Last receipt', 'date'),
      ],
      rows: sums
        .map((r) => {
          const m = material.get(r.material_id)!;
          return {
            supplier: r.supplier,
            code: m.code,
            material: m.name,
            unit: m.stockUnit.code,
            accepted: r.accepted.toString(),
            damaged: r.damaged.toString(),
            receipts: Number(r.receipts),
            last: r.last.toISOString(),
          };
        })
        .sort(
          (a, b) => a.supplier.localeCompare(b.supplier) || a.material.localeCompare(b.material),
        ),
      notes: [
        'Reversed receipts are left out.',
        'Quantities only: prices and invoice values are not part of this system.',
      ],
    };
  }

  // ── 7. Low Stock ───────────────────────────────────────────────────────────

  private async lowStock(s: Scope): Promise<Built> {
    const db = this.prisma.db;
    const [materials, projectAvail] = await Promise.all([
      db.material.findMany({
        where: {
          projectId: s.projectId,
          status: 'ACTIVE',
          ...(s.query.categoryId ? { categoryId: s.query.categoryId } : {}),
        },
        include: { category: { select: { name: true } }, stockUnit: { select: { code: true } } },
        orderBy: { name: 'asc' },
      }),
      this.projectAvailable(s.projectId),
    ]);
    const rows: Row[] = [];
    for (const m of materials) {
      const available = projectAvail.get(m.id) ?? new Decimal(0);
      const status = this.status(m, available);
      if (status !== 'Low stock' && status !== 'Out of stock') continue;
      const minimum = m.minimumStock ? new Decimal(m.minimumStock.toString()) : null;
      rows.push({
        code: m.code,
        material: m.name,
        category: m.category.name,
        unit: m.stockUnit.code,
        available: available.toString(),
        minimum: minimum ? minimum.toString() : null,
        shortfall: minimum && minimum.gt(available) ? minimum.minus(available).toString() : null,
        status,
      });
    }
    return {
      columns: [
        col('code', 'Material ID'),
        col('material', 'Material'),
        col('category', 'Category'),
        col('unit', 'Unit'),
        col('available', 'Available in the project', 'quantity'),
        col('minimum', 'Minimum stock', 'quantity'),
        col('shortfall', 'Below minimum by', 'quantity'),
        col('status', 'Status'),
      ],
      rows: rows.slice(0, s.take),
      notes: [
        'Stock as it is now; this report has no date filter.',
        'Judged on the available stock of all stores of the project together.',
        'A material with no minimum stock set appears only when it is out of stock.',
      ],
    };
  }

  // ── 8. Physical Stock Discrepancy ──────────────────────────────────────────

  private async discrepancy(s: Scope): Promise<Built> {
    const rows = await this.prisma.db.stockVerification.findMany({
      where: {
        projectId: s.projectId,
        submittedAt: { gte: s.from, lt: s.to },
        ...(s.stores ? { storeId: { in: s.stores } } : {}),
        ...(s.query.materialId ? { materialId: s.query.materialId } : {}),
      },
      include: {
        store: { select: { name: true } },
        material: { select: { code: true, name: true, stockUnit: { select: { code: true } } } },
        submittedBy: { select: { name: true } },
        reviewedBy: { select: { name: true } },
        adjustment: { select: { posting: { select: { referenceNo: true } } } },
      },
      orderBy: { submittedAt: 'desc' },
      take: s.take,
    });
    return {
      columns: [
        col('date', 'Counted on', 'datetime'),
        col('store', 'Store'),
        col('code', 'Material ID'),
        col('material', 'Material'),
        col('unit', 'Unit'),
        col('system', 'System stock', 'quantity'),
        col('physical', 'Physical count', 'quantity'),
        col('difference', 'Difference', 'quantity'),
        col('reason', 'Reason given'),
        col('status', 'Decision'),
        col('by', 'Counted by'),
        col('reviewer', 'Decided by'),
        col('reviewed', 'Decided on', 'datetime'),
        col('note', 'Review note'),
        col('adjustment', 'Adjustment No'),
      ],
      rows: rows.map((v) => ({
        date: v.submittedAt.toISOString(),
        store: v.store.name,
        code: v.material.code,
        material: v.material.name,
        unit: v.material.stockUnit.code,
        system: v.systemQty.toString(),
        physical: v.physicalQty.toString(),
        difference: v.differenceQty.toString(),
        reason: v.reason,
        status: v.status === 'SUBMITTED' ? 'Waiting for approval' : title(v.status),
        by: v.submittedBy.name,
        reviewer: v.reviewedBy?.name ?? null,
        reviewed: v.reviewedAt ? v.reviewedAt.toISOString() : null,
        note: v.reviewNote,
        adjustment: v.adjustment?.posting.referenceNo ?? null,
      })),
      notes: [
        'Difference = physical count − system stock at the moment of counting.',
        'Stock changes only when a Project Admin approves; the adjustment number is shown then.',
      ],
    };
  }

  // ── 9. AI Processing ───────────────────────────────────────────────────────

  private async aiProcessing(s: Scope): Promise<Built> {
    const db = this.prisma.db;
    const invoices = await db.invoice.findMany({
      where: {
        projectId: s.projectId,
        createdAt: { gte: s.from, lt: s.to },
        ...(s.stores ? { storeId: { in: s.stores } } : {}),
      },
      include: {
        store: { select: { name: true } },
        uploadedBy: { select: { name: true } },
        supplier: { select: { name: true } },
        posting: { select: { referenceNo: true } },
        _count: { select: { pages: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: s.take,
    });
    const ids = invoices.map((i) => i.id);
    const [items, calls] = await Promise.all([
      db.invoiceItem.groupBy({
        by: ['invoiceId', 'matchStatus', 'isManualEntry'],
        where: { projectId: s.projectId, invoiceId: { in: ids } },
        _count: { _all: true },
      }),
      db.aiProcessingLog.groupBy({
        by: ['invoiceId', 'status'],
        where: { projectId: s.projectId, invoiceId: { in: ids } },
        _count: { _all: true },
      }),
    ]);
    const count = new Map<string, Record<string, number>>();
    const add = (id: string | null, key: string, n: number) => {
      if (!id) return;
      const c = count.get(id) ?? {};
      c[key] = (c[key] ?? 0) + n;
      count.set(id, c);
    };
    for (const g of items) {
      add(g.invoiceId, 'lines', g._count._all);
      add(g.invoiceId, g.isManualEntry ? 'manual' : g.matchStatus, g._count._all);
    }
    for (const g of calls) {
      add(g.invoiceId, 'calls', g._count._all);
      if (g.status !== 'SUCCESS') add(g.invoiceId, 'failedCalls', g._count._all);
    }
    return {
      columns: [
        col('date', 'Uploaded', 'datetime'),
        col('store', 'Store'),
        col('by', 'Uploaded by'),
        col('supplier', 'Supplier'),
        col('document', 'Invoice / challan No'),
        col('status', 'Status'),
        col('pages', 'Files', 'count'),
        col('lines', 'Lines', 'count'),
        col('matched', 'Matched', 'count'),
        col('new', 'New material', 'count'),
        col('review', 'Needed a choice', 'count'),
        col('manual', 'Typed by hand', 'count'),
        col('calls', 'AI calls', 'count'),
        col('failedCalls', 'Failed AI calls', 'count'),
        col('receipt', 'Receipt No'),
        col('failure', 'Problem'),
      ],
      rows: invoices.map((i) => {
        const c = count.get(i.id) ?? {};
        return {
          date: i.createdAt.toISOString(),
          store: i.store.name,
          by: i.uploadedBy.name,
          supplier: i.supplier?.name ?? i.supplierNameRaw,
          document: i.invoiceNo ?? i.challanNo,
          status: INVOICE_STATUS_LABEL[i.status] ?? i.status,
          pages: i._count.pages,
          lines: c.lines ?? 0,
          matched: c.MATCHED ?? 0,
          new: c.NEW_MATERIAL ?? 0,
          review: c.REVIEW_REQUIRED ?? 0,
          manual: c.manual ?? 0,
          calls: c.calls ?? 0,
          failedCalls: c.failedCalls ?? 0,
          receipt: i.posting?.referenceNo ?? null,
          failure: i.status === 'FAILED' ? i.failureMessage : null,
        };
      }),
      notes: [
        'Matched, new material and needed a choice describe what the AI proposed, before the Store Manager reviewed it.',
        'Stock changed only for documents with a receipt number.',
      ],
    };
  }

  // ── 10. New Material Creation ──────────────────────────────────────────────

  private async newMaterials(s: Scope): Promise<Built> {
    const rows = await this.prisma.db.material.findMany({
      where: {
        projectId: s.projectId,
        createdAt: { gte: s.from, lt: s.to },
        ...(s.query.categoryId ? { categoryId: s.query.categoryId } : {}),
      },
      include: {
        category: { select: { name: true } },
        stockUnit: { select: { code: true } },
        packUnit: { select: { code: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: s.take,
    });
    return {
      columns: [
        col('date', 'Created', 'datetime'),
        col('code', 'Material ID'),
        col('material', 'Material'),
        col('category', 'Category'),
        col('brand', 'Brand'),
        col('grade', 'Grade'),
        col('size', 'Size'),
        col('unit', 'Stock unit'),
        col('pack', 'Pack size'),
        col('source', 'How it was created'),
        col('by', 'Created by'),
        col('status', 'Status'),
      ],
      rows: rows.map((m) => ({
        date: m.createdAt.toISOString(),
        code: m.code,
        material: m.name,
        category: m.category.name,
        brand: m.brand,
        grade: m.grade,
        size: m.size,
        unit: m.stockUnit.code,
        pack: m.packSize ? `${m.packSize.toString()} ${m.packUnit?.code ?? ''}`.trim() : null,
        source: SOURCE_LABEL[m.creationSource] ?? m.creationSource,
        by: m.createdBy.name,
        status: title(m.status),
      })),
      notes: [
        'Materials created from a scanned document were reviewed and confirmed by the person shown.',
      ],
    };
  }
}
