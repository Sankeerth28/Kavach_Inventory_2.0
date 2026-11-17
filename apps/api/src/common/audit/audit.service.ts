import { Injectable } from '@nestjs/common';
import type { Prisma } from '@kavach/db';
import type { AuthContext, RequestContext } from '../context/request-context';
import type { Db } from '../prisma/prisma.service';

export interface AuditEntry {
  /** "material.create", "user.password_reset", ... */
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

export type AuditActor = Pick<AuthContext, 'requestId' | 'ip' | 'userAgent'> & {
  userId: string | null;
};

const json = (v: unknown): Prisma.InputJsonValue | undefined =>
  v === undefined || v === null
    ? undefined
    : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

/**
 * Writes audit rows (CLAUDE.md invariant 10, PRD §18.3). Always called with the same transaction
 * as the change it records, so an action and its audit row commit together or not at all.
 * The table is append-only (trigger). Passwords and tokens are never passed in.
 */
@Injectable()
export class AuditService {
  /** A change made by a member inside a project. */
  async write(db: Db, ctx: RequestContext, entry: AuditEntry): Promise<void> {
    await this.insert(db, ctx.projectId, ctx, entry);
  }

  /** An account-level event with no project: login, password change. */
  async writeAccount(db: Db, actor: AuditActor, entry: AuditEntry): Promise<void> {
    await this.insert(db, null, actor, entry);
  }

  private async insert(
    db: Db,
    projectId: string | null,
    actor: AuditActor,
    entry: AuditEntry,
  ): Promise<void> {
    await db.auditLog.create({
      data: {
        projectId,
        actorType: 'USER',
        actorUserId: actor.userId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: json(entry.before),
        after: json(entry.after),
        metadata: json(entry.metadata),
        requestId: actor.requestId,
        ip: actor.ip,
        userAgent: actor.userAgent?.slice(0, 300) ?? null,
      },
    });
  }
}
