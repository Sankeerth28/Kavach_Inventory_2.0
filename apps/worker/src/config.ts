import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  type DocumentExtractor,
  ExtractorError,
  type ExtractorResponse,
} from './extractors/document-extractor';
import { FixtureExtractor } from './extractors/fixture.extractor';
import { OpenAIExtractor } from './extractors/openai.extractor';

/** Worker configuration. The AI key is read here and nowhere else (ARCHITECTURE §7.5). */
export interface WorkerConfig {
  /** `db`: poll the database (no Redis needed). `bullmq`: also consume wake-up jobs from Redis. */
  queueMode: 'db' | 'bullmq';
  pollMs: number;
  concurrency: number;
  /** Days after which discarded and failed uploads are purged (DECISIONS Q25). */
  retentionDays: number;
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const mode = env.DOCUMENT_QUEUE ?? 'db';
  if (mode !== 'db' && mode !== 'bullmq') {
    throw new Error(`Unknown DOCUMENT_QUEUE "${mode}". Use "db" or "bullmq".`);
  }
  return {
    queueMode: mode,
    pollMs: Math.max(250, Number(env.DOCUMENT_POLL_MS ?? 2000)),
    concurrency: Math.min(16, Math.max(1, Number(env.DOCUMENT_CONCURRENCY ?? 4))),
    retentionDays: Math.max(1, Number(env.DOCUMENT_RETENTION_DAYS ?? 30)),
  };
}

export function repoRoot(from = process.cwd()): string {
  let dir = path.resolve(from);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(from);
}

/** Used when no provider is configured: every document fails with a clear message. */
class UnconfiguredExtractor implements DocumentExtractor {
  readonly provider = 'none';
  readonly model = 'none';
  readonly promptVersion = 'none';

  private refuse(): never {
    throw new ExtractorError(
      'NOT_CONFIGURED',
      'AI_NOT_CONFIGURED',
      'AI reading is not set up on this server (OPENAI_API_KEY is missing). Enter the lines by hand, or ask the administrator.',
    );
  }

  async extract(): Promise<ExtractorResponse> {
    return this.refuse();
  }

  async resolveCandidates(): Promise<ExtractorResponse> {
    return this.refuse();
  }
}

/**
 * AI_PROVIDER = `openai` (default when OPENAI_API_KEY is set) or `fixture` (offline answers for
 * the sample documents in test-docs/, development only).
 */
export function createExtractor(env: NodeJS.ProcessEnv = process.env): DocumentExtractor {
  const provider = env.AI_PROVIDER || (env.OPENAI_API_KEY ? 'openai' : 'none');
  if (provider === 'fixture') {
    if (env.NODE_ENV === 'production') {
      throw new Error('AI_PROVIDER=fixture is a development aid and cannot run in production.');
    }
    return new FixtureExtractor(env.AI_FIXTURE_DIR ?? path.join(repoRoot(), 'test-docs'));
  }
  if (provider === 'openai') {
    if (!env.OPENAI_API_KEY) throw new Error('AI_PROVIDER=openai needs OPENAI_API_KEY.');
    return new OpenAIExtractor({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL || 'gpt-4.1',
      baseUrl: env.OPENAI_BASE_URL || undefined,
      timeoutMs: Number(env.OPENAI_TIMEOUT_MS ?? 90_000),
    });
  }
  if (provider === 'none') return new UnconfiguredExtractor();
  throw new Error(`Unknown AI_PROVIDER "${provider}". Use "openai" or "fixture".`);
}
