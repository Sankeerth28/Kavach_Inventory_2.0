import { Prisma, type PrismaClient } from '@prisma/client';

/**
 * Repository-layer project isolation (CLAUDE.md invariant 6, ARCHITECTURE §6.1).
 *
 * `withProjectScope(client)` returns a client that refuses any query on a project-scoped model
 * unless the query names the project explicitly. A forgotten `projectId` becomes an exception
 * instead of a cross-project read.
 */
export class ProjectScopeError extends Error {
  constructor(model: string, operation: string) {
    super(`${model}.${operation} must be scoped by projectId`);
    this.name = 'ProjectScopeError';
  }
}

/** Models whose rows always belong to one project. */
const STRICT = new Set<string>([
  'Store',
  'Location',
  'MaterialCategory',
  'Material',
  'ProjectMember',
  'ProjectMemberStore',
  'IdSequence',
  'Contractor',
  'Posting',
  'MaterialTransaction',
  'StockBalance',
  'StockVerification',
  'StockAdjustment',
  'Supplier',
  'SupplierAlias',
  'SupplierMaterialMapping',
  'Invoice',
  'InvoicePage',
  'InvoiceItem',
  'AiProcessingLog',
]);

/** Models where `projectId: null` is a real value (system units, auth audit events). It must still be explicit. */
const NULLABLE = new Set<string>(['Unit', 'UnitConversion', 'AuditLog']);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function isProjectValue(v: unknown, allowNull: boolean): boolean {
  if (typeof v === 'string' && v.length > 0) return true;
  if (v === null) return allowNull;
  if (isObj(v) && 'equals' in v) return isProjectValue(v.equals, allowNull);
  return false;
}

function whereIsScoped(where: unknown, allowNull: boolean): boolean {
  if (!isObj(where)) return false;
  if ('projectId' in where && isProjectValue(where.projectId, allowNull)) return true;
  // Compound unique selectors: { projectId_code: { projectId, code } }
  for (const [key, value] of Object.entries(where)) {
    if (key.includes('projectId_') || key.includes('_projectId')) {
      if (isObj(value) && isProjectValue(value.projectId, allowNull)) return true;
    }
  }
  const and = where.AND;
  if (
    Array.isArray(and)
      ? and.some((w) => whereIsScoped(w, allowNull))
      : whereIsScoped(and, allowNull)
  ) {
    return true;
  }
  const or = where.OR;
  return Array.isArray(or) && or.length > 0 && or.every((w) => whereIsScoped(w, allowNull));
}

function dataIsScoped(data: unknown, allowNull: boolean): boolean {
  if (Array.isArray(data)) return data.length > 0 && data.every((d) => dataIsScoped(d, allowNull));
  if (!isObj(data)) return false;
  if ('projectId' in data && isProjectValue(data.projectId, allowNull)) return true;
  const project = data.project;
  return isObj(project) && isObj(project.connect) && typeof project.connect.id === 'string';
}

const WHERE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
]);
const DATA_OPS = new Set(['create', 'createMany', 'createManyAndReturn']);

/** Throws ProjectScopeError when a query on a scoped model does not name its project. */
export function assertProjectScoped(model: string, operation: string, args: unknown): void {
  const strict = STRICT.has(model);
  if (!strict && !NULLABLE.has(model)) return;
  const allowNull = !strict;
  const a = isObj(args) ? args : {};

  let ok: boolean;
  if (WHERE_OPS.has(operation)) ok = whereIsScoped(a.where, allowNull);
  else if (DATA_OPS.has(operation)) ok = dataIsScoped(a.data, allowNull);
  else if (operation === 'upsert') {
    ok = whereIsScoped(a.where, allowNull) && dataIsScoped(a.create, allowNull);
  } else ok = false; // unknown operation on a scoped model: deny

  if (!ok) throw new ProjectScopeError(model, operation);
}

export function withProjectScope<T extends PrismaClient>(client: T) {
  return client.$extends(
    Prisma.defineExtension({
      name: 'project-scope',
      query: {
        $allModels: {
          $allOperations({ model, operation, args, query }) {
            assertProjectScoped(model, operation, args);
            return query(args);
          },
        },
      },
    }),
  );
}

export type ScopedPrismaClient = ReturnType<typeof withProjectScope<PrismaClient>>;
