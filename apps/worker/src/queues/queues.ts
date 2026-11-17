import { z } from 'zod';

/** Queue names. `document` carries wake-up jobs for the AI document pipeline (ARCHITECTURE §7.2). */
export const QUEUES = {
  health: 'health',
  document: 'document',
} as const;

export const PingJobSchema = z.object({
  message: z.string().min(1).default('ping'),
});

export type PingJob = z.infer<typeof PingJobSchema>;

/** The job says only which document is waiting. Its state lives in the database. */
export const DocumentJobSchema = z.object({ invoiceId: z.uuid() });
export type DocumentJob = z.infer<typeof DocumentJobSchema>;
