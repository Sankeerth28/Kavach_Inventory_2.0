import { HealthResponseSchema } from '@kavach/shared';
import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('GET /api/health', () => {
  it('returns ok for the web service', async () => {
    const res = GET();

    expect(res.status).toBe(200);
    expect(HealthResponseSchema.parse(await res.json())).toEqual({ status: 'ok', service: 'web' });
  });
});
