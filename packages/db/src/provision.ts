import { type RoleCode, normalise } from '@kavach/shared';
import type { Prisma, Project, SequenceScope } from '@prisma/client';

/**
 * Project provisioning (DECISIONS Q1: projects and their first admin are created by an operator
 * command, not through the UI). Used by the operator CLI, the seed and the tests.
 */

/** PRD §6.3 */
export const DEFAULT_CATEGORIES = [
  'Cement',
  'Steel',
  'Sand and Aggregate',
  'Bricks and Blocks',
  'Electrical',
  'Plumbing',
  'Tiles and Flooring',
  'Paint and Finishing',
  'Hardware',
  'Safety Equipment',
  'Tools and Equipment',
  'Other Materials',
] as const;

export const DEFAULT_STORE = { code: 'MAIN', name: 'Main Store' } as const;

type Tx = Prisma.TransactionClient;

export interface CreateProjectInput {
  code: string;
  name: string;
  address?: string | null;
  timezone?: string;
}

/** Creates a project with the default categories (PRD §6.3) and a default "Main Store" (Q2). */
export async function createProject(tx: Tx, input: CreateProjectInput): Promise<Project> {
  const project = await tx.project.create({
    data: {
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      address: input.address ?? null,
      timezone: input.timezone ?? 'Asia/Kolkata',
    },
  });
  await tx.materialCategory.createMany({
    data: DEFAULT_CATEGORIES.map((name, i) => ({
      projectId: project.id,
      name,
      normalizedName: normalise(name),
      sortOrder: (i + 1) * 10,
    })),
  });
  const store = await tx.store.create({
    data: { projectId: project.id, ...DEFAULT_STORE },
  });
  await tx.auditLog.create({
    data: {
      projectId: project.id,
      actorType: 'SYSTEM',
      action: 'project.create',
      entityType: 'project',
      entityId: project.id,
      after: {
        code: project.code,
        name: project.name,
        defaultStoreId: store.id,
      },
    },
  });
  return project;
}

export interface AddMemberInput {
  projectId: string;
  userId: string;
  roleCode: RoleCode;
  /** Stores a Store Manager operates. Ignored for Project Admins. */
  storeIds?: string[];
}

export async function addMember(tx: Tx, input: AddMemberInput) {
  const role = await tx.role.findUniqueOrThrow({
    where: { code: input.roleCode },
  });
  const member = await tx.projectMember.create({
    data: { projectId: input.projectId, userId: input.userId, roleId: role.id },
  });
  const storeIds = input.roleCode === 'STORE_MANAGER' ? (input.storeIds ?? []) : [];
  if (storeIds.length > 0) {
    await tx.projectMemberStore.createMany({
      data: storeIds.map((storeId) => ({
        projectId: input.projectId,
        memberId: member.id,
        storeId,
      })),
    });
  }
  return member;
}

/**
 * Allocates `count` consecutive numbers of a per-project sequence and returns the first.
 * Atomic: the upsert locks the row, so two concurrent transactions never receive the same number.
 * Gaps are possible after a rollback.
 */
export async function nextSequenceValue(
  tx: Pick<Tx, '$queryRaw'>,
  projectId: string,
  scope: SequenceScope,
  year = 0,
  count = 1,
): Promise<bigint> {
  const rows = await tx.$queryRaw<{ value: bigint }[]>`
    INSERT INTO id_sequences (project_id, scope, year, next_value)
    VALUES (${projectId}::uuid, ${scope}::"SequenceScope", ${year}, ${1 + count})
    ON CONFLICT (project_id, scope, year)
    DO UPDATE SET next_value = id_sequences.next_value + ${count}
    RETURNING next_value - ${count} AS value`;
  return rows[0]!.value;
}

/** PRD §6.2 Material ID: MAT-000123 */
export function formatMaterialCode(n: bigint): string {
  return `MAT-${n.toString().padStart(6, '0')}`;
}

/** Posting references and transaction IDs: RCV-2026-000045, TXN-2026-000123 (PRD §10.2 step 9, §18.2). */
export function formatYearlyNumber(prefix: string, year: number, n: bigint): string {
  return `${prefix}-${year}-${n.toString().padStart(6, '0')}`;
}
