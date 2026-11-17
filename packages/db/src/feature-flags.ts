import {
  FEATURE_FLAGS,
  type FeatureFlag,
  FeatureConfigError,
  assertFeatureEnv,
  parseFeatureDefaults,
  parseFeatureOverrides,
  resolveFlags,
} from '@kavach/shared';
import type { PrismaClient } from '@prisma/client';

type Env = Record<string, string | undefined>;

/** Only `projects` is read, and it is not a project-scoped model, so any client works. */
type ProjectReader = Pick<PrismaClient, 'project'>;

export interface FeatureFlagsOptions {
  env?: Env;
  /** How long a project's flags are cached in memory. */
  ttlMs?: number;
  now?: () => number;
}

/**
 * The single place that answers "is this v2.1 feature on for this project?" (change spec §0.2).
 *
 * Effective value = per-project override in `projects.settings.features`, else the FEATURE_* env
 * default; then a child flag is forced off while its parent is off (FEATURE_PARENT).
 * Results are cached per project for `ttlMs` (default 30 s); `invalidate(projectId)` after writing
 * an override makes the change visible immediately in this process.
 */
export class FeatureFlags {
  private readonly env: Env;
  private readonly defaults: Record<FeatureFlag, boolean>;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<
    string,
    { flags: Record<FeatureFlag, boolean>; expires: number }
  >();

  constructor(
    private readonly db: ProjectReader,
    options: FeatureFlagsOptions = {},
  ) {
    this.env = options.env ?? process.env;
    this.defaults = parseFeatureDefaults(this.env);
    this.ttlMs = options.ttlMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  async isFeatureEnabled(projectId: string, flag: FeatureFlag): Promise<boolean> {
    return (await this.flagsFor(projectId))[flag];
  }

  /** Every flag's effective value for one project. */
  async flagsFor(projectId: string): Promise<Record<FeatureFlag, boolean>> {
    const hit = this.cache.get(projectId);
    if (hit && hit.expires > this.now()) return hit.flags;
    const project = await this.db.project.findUnique({
      where: { id: projectId },
      select: { settings: true },
    });
    const flags = resolveFlags({
      ...this.defaults,
      ...parseFeatureOverrides(project?.settings),
    });
    this.cache.set(projectId, { flags, expires: this.now() + this.ttlMs });
    return flags;
  }

  invalidate(projectId?: string): void {
    if (projectId) this.cache.delete(projectId);
    else this.cache.clear();
  }

  /**
   * Refuses to turn a flag on for a project when the environment it needs is missing. Call before
   * saving an override, so the setting cannot get ahead of the server's configuration.
   */
  assertCanEnable(flag: FeatureFlag): void {
    assertFeatureEnv(this.env, [flag], ', requested for a project');
  }

  /**
   * Startup check: every flag that is on for some project through an override must have its
   * environment. Throws FeatureConfigError naming the variables and the projects.
   */
  async assertProjectOverridesConfigured(): Promise<void> {
    const projects = await this.db.project.findMany({
      select: { code: true, settings: true },
    });
    const byFlag = new Map<FeatureFlag, string[]>();
    for (const p of projects) {
      const flags = resolveFlags({
        ...this.defaults,
        ...parseFeatureOverrides(p.settings),
      });
      for (const f of FEATURE_FLAGS) {
        if (flags[f] && !this.defaults[f]) byFlag.set(f, [...(byFlag.get(f) ?? []), p.code]);
      }
    }
    const problems: string[] = [];
    for (const [flag, codes] of byFlag) {
      try {
        assertFeatureEnv(this.env, [flag], `, turned on for project ${codes.join(', ')}`);
      } catch (e) {
        problems.push((e as Error).message);
      }
    }
    if (problems.length > 0) throw new FeatureConfigError(problems.join('\n'));
  }
}
