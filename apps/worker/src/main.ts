import { type PrismaClient, createPrismaClient, withProjectScope } from '@kavach/db';
import { createStorage } from '@kavach/storage';
import { Worker } from 'bullmq';
import { createExtractor, loadWorkerConfig } from './config';
import { PipelineRunner } from './pipeline/runner';
import { processPing } from './processors/ping.processor';
import { DocumentJobSchema, QUEUES } from './queues/queues';
import { redisConnection } from './redis';

// Local development reads the repo-root .env; deployed environments inject real env vars.
try {
  process.loadEnvFile('../../.env');
} catch {
  // No .env file: rely on the process environment.
}

const config = loadWorkerConfig();
const raw = createPrismaClient();
// The same guard the API uses: a query on a project-scoped model must name its project.
const db = withProjectScope(raw) as unknown as PrismaClient;
const extractor = createExtractor();
const storage = createStorage();
const runner = new PipelineRunner({ db, storage, extractor, log: (m) => console.log(m) }, config);

// Redis is optional. Without it the worker polls the database, which is all the pipeline needs.
const bullWorkers: Worker[] = [];
if (config.queueMode === 'bullmq') {
  const connection = redisConnection();
  bullWorkers.push(
    new Worker(QUEUES.health, processPing, { connection }),
    new Worker(
      QUEUES.document,
      async (job) => runner.wake(DocumentJobSchema.parse(job.data).invoiceId),
      { connection, concurrency: config.concurrency },
    ),
  );
  for (const w of bullWorkers) {
    w.on('failed', (job, err) => console.error(`job ${job?.id ?? '?'} failed: ${err.message}`));
    w.on('error', (err) => console.error(`worker error: ${err.message}`));
  }
}

runner.start();
console.log(
  `worker ready: queue=${config.queueMode}, ai=${extractor.provider}/${extractor.model}, storage=${storage.driver}`,
);
if (extractor.provider === 'fixture') {
  console.warn(
    'AI_PROVIDER=fixture: only the sample documents in test-docs/ can be read. Development only.',
  );
}
if (extractor.provider === 'none') {
  console.warn(
    'No AI provider configured (OPENAI_API_KEY missing): uploaded documents will fail with a clear message.',
  );
}

async function shutdown(): Promise<void> {
  await Promise.all(bullWorkers.map((w) => w.close()));
  await runner.stop();
  await raw.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
