import type { PrismaClient } from '@kavach/db';
import type { WorkerConfig } from '../config';
import {
  type PipelineDeps,
  type PipelineOutcome,
  claimNext,
  processInvoice,
  reapStaleClaims,
} from './process-invoice';
import { purgeExpiredDocuments } from './retention';

/**
 * Drives the pipeline from the database. `invoices.status = QUEUED` is the queue: a worker takes
 * a document with `FOR UPDATE SKIP LOCKED`, so several workers can run and none takes the same
 * one. A BullMQ job, when Redis is used, is only a wake-up call that makes pick-up immediate;
 * a lost job costs one poll interval, never a lost document (ARCHITECTURE §7.2).
 */
export class PipelineRunner {
  private active = 0;
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;
  private lastReap = 0;
  private lastPurge = 0;
  private readonly idle: (() => void)[] = [];

  constructor(
    private readonly deps: PipelineDeps,
    private readonly config: WorkerConfig,
  ) {}

  private get db(): PrismaClient {
    return this.deps.db;
  }

  private log(message: string): void {
    (this.deps.log ?? console.log)(message);
  }

  start(): void {
    const tick = async () => {
      if (this.stopped) return;
      try {
        await this.housekeeping();
        await this.drain();
      } catch (e) {
        this.log(`pipeline tick failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!this.stopped) this.timer = setTimeout(() => void tick(), this.config.pollMs);
    };
    void tick();
  }

  /** Takes waiting documents until the queue is empty or every slot is busy. */
  async drain(): Promise<void> {
    while (!this.stopped && this.active < this.config.concurrency) {
      const claim = await claimNext(this.db);
      if (!claim) return;
      this.run(() => processInvoice(this.deps, claim));
    }
  }

  /** Wake-up for one document (BullMQ job). Does nothing if it was already taken. */
  async wake(invoiceId: string): Promise<PipelineOutcome | 'NOT_WAITING'> {
    const claim = await claimNext(this.db, invoiceId);
    if (!claim) return 'NOT_WAITING';
    this.active += 1;
    try {
      return await processInvoice(this.deps, claim);
    } finally {
      this.release();
    }
  }

  private run(job: () => Promise<PipelineOutcome>): void {
    this.active += 1;
    void job()
      .catch((e: unknown) =>
        this.log(`document job crashed: ${e instanceof Error ? e.message : String(e)}`),
      )
      .finally(() => this.release());
  }

  private release(): void {
    this.active -= 1;
    if (this.active === 0) for (const resolve of this.idle.splice(0)) resolve();
  }

  private async housekeeping(): Promise<void> {
    const now = Date.now();
    if (now - this.lastReap > 60_000) {
      this.lastReap = now;
      const reaped = await reapStaleClaims(this.db);
      if (reaped > 0) this.log(`recovered ${reaped} stalled document(s)`);
    }
    if (now - this.lastPurge > 3_600_000) {
      this.lastPurge = now;
      const purged = await purgeExpiredDocuments(
        this.db,
        this.deps.storage,
        this.config.retentionDays,
      );
      if (purged > 0) this.log(`purged ${purged} expired document file(s)`);
    }
  }

  /** Stops taking work and waits for documents in flight. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.active > 0) await new Promise<void>((resolve) => this.idle.push(resolve));
  }
}
