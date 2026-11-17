import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { type DocumentStorage, createStorage } from '@kavach/storage';
import { Queue } from 'bullmq';

/** Private storage for uploaded invoices and challans (PRD §25.2 "Secure document storage"). */
export const DOCUMENT_STORAGE = Symbol('DOCUMENT_STORAGE');
export type { DocumentStorage };

export const documentStorageProvider = {
  provide: DOCUMENT_STORAGE,
  useFactory: (): DocumentStorage => createStorage(),
};

/**
 * Tells the worker a document is waiting (ARCHITECTURE §7.2).
 *
 * The queue of record is the database: `invoices.status = 'QUEUED'`. The worker polls it, so a
 * document is never lost if this notification is. With DOCUMENT_QUEUE=bullmq a job is also put on
 * Redis so pick-up is immediate; with the default (`db`) there is nothing to do here.
 *
 * The API never processes a document itself and holds no AI key (ARCHITECTURE §7.5).
 */
@Injectable()
export class DocumentQueue implements OnModuleDestroy {
  private readonly logger = new Logger('DocumentQueue');
  private queue: Queue | null = null;

  private get enabled(): boolean {
    return process.env.DOCUMENT_QUEUE === 'bullmq';
  }

  private connect(): Queue {
    if (!this.queue) {
      const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
      this.queue = new Queue('document', {
        connection: {
          host: url.hostname,
          port: Number(url.port || 6379),
          username: url.username || undefined,
          password: url.password || undefined,
          tls: url.protocol === 'rediss:' ? {} : undefined,
          // Fail fast: the request must not hang on Redis. The worker's poll covers a miss.
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        },
      });
      this.queue.on('error', (e) => this.logger.warn(`Redis: ${e.message}`));
    }
    return this.queue;
  }

  async notify(invoiceId: string, extractionVersion: number): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.connect().add(
        'process',
        { invoiceId },
        {
          // Same document and version → same job: a repeated request does not enqueue twice.
          jobId: `${invoiceId}-v${extractionVersion}`,
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      );
    } catch (e) {
      this.logger.warn(
        `Could not notify the worker about ${invoiceId}; it will be picked up by polling. ${e instanceof Error ? e.message : ''}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close().catch(() => undefined);
  }
}
