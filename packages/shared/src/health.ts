import { z } from 'zod';

export const APP_NAME = 'KAVACH';

export const SERVICE_NAMES = ['api', 'worker', 'web', 'mobile'] as const;

/** Wire contract for the health check of each service. */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.enum(SERVICE_NAMES),
});

export type ServiceName = (typeof SERVICE_NAMES)[number];
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export function healthResponse(service: ServiceName): HealthResponse {
  return { status: 'ok', service };
}
