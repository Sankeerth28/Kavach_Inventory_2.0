import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HealthResponseSchema } from '@kavach/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';

describe('GET /health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns ok for the api service', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);

    expect(HealthResponseSchema.parse(res.body)).toEqual({ status: 'ok', service: 'api' });
  });
});
