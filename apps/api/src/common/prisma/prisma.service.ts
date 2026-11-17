import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { type Prisma, PrismaClient, withProjectScope } from '@kavach/db';

/** A scoped client or a transaction opened on it. Services accept either. */
export type Db = Prisma.TransactionClient;

/**
 * Database access for the API.
 *
 * - `db` is the client every module uses. It refuses queries on project-scoped models that do not
 *   name a project (CLAUDE.md invariant 6).
 * - `unscoped` exists for the few places that work across projects by design: authentication and
 *   building the request context. A test keeps the list of files that use it short.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly unscoped: PrismaClient = new PrismaClient();
  // The extension only adds query checks, so the client keeps the plain PrismaClient surface.
  readonly db: PrismaClient = withProjectScope(this.unscoped) as unknown as PrismaClient;

  async onModuleDestroy(): Promise<void> {
    await this.unscoped.$disconnect();
  }
}
