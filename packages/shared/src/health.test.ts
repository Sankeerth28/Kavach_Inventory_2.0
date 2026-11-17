import { describe, expect, it } from 'vitest';
import { HealthResponseSchema, healthResponse } from './health';

describe('health contract', () => {
  it('builds a response that satisfies the schema', () => {
    expect(HealthResponseSchema.parse(healthResponse('api'))).toEqual({
      status: 'ok',
      service: 'api',
    });
  });

  it('rejects an unknown service', () => {
    expect(HealthResponseSchema.safeParse({ status: 'ok', service: 'nope' }).success).toBe(false);
  });
});
