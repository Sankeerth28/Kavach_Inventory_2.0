import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { FeatureFlags } from '@kavach/db';
import type { FeatureFlag } from '@kavach/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Nest wrapper around the shared `FeatureFlags` helper. Every v2.1 code path asks
 * `isFeatureEnabled(ctx.projectId, '<flag>')`; nothing reads FEATURE_* variables directly.
 */
@Injectable()
export class FeatureFlagsService implements OnApplicationBootstrap {
  private readonly flags: FeatureFlags;

  constructor(prisma: PrismaService) {
    // `projects` is not project-scoped; the unscoped client avoids the scope guard's overhead.
    this.flags = new FeatureFlags(prisma.unscoped);
  }

  /** Refuses to start when a project override turns on a feature whose env is missing. */
  async onApplicationBootstrap(): Promise<void> {
    await this.flags.assertProjectOverridesConfigured();
  }

  isFeatureEnabled(projectId: string, flag: FeatureFlag): Promise<boolean> {
    return this.flags.isFeatureEnabled(projectId, flag);
  }

  flagsFor(projectId: string): Promise<Record<FeatureFlag, boolean>> {
    return this.flags.flagsFor(projectId);
  }

  assertCanEnable(flag: FeatureFlag): void {
    this.flags.assertCanEnable(flag);
  }

  invalidate(projectId?: string): void {
    this.flags.invalidate(projectId);
  }
}
