import { type HealthResponse, healthResponse } from '@kavach/shared';
import { PingJobSchema } from '../queues/queues';

export interface PingResult extends HealthResponse {
  echo: string;
}

/** Hello-world job: validates the payload and echoes it back. Pure, so it tests without Redis. */
export async function processPing(job: { data: unknown }): Promise<PingResult> {
  const { message } = PingJobSchema.parse(job.data);
  return { ...healthResponse('worker'), echo: message };
}
