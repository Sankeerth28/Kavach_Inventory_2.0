import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import { IdempotencyKeySchema } from '@kavach/shared';
import type { Request } from 'express';
import { DomainError } from '../errors/domain-error';

/** Extracts and validates the required Idempotency-Key header (CLAUDE.md invariant 4). */
export const IdempotencyKey = createParamDecorator((_: unknown, host: ExecutionContext): string => {
  const req = host.switchToHttp().getRequest<Request>();
  const raw = req.headers['idempotency-key'] ?? req.headers['Idempotency-Key'];
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key) {
    throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required', 400);
  }
  const parsed = IdempotencyKeySchema.safeParse(key);
  if (!parsed.success) {
    throw new DomainError(
      'VALIDATION_FAILED',
      'Invalid Idempotency-Key format',
      400,
      parsed.error.issues,
    );
  }
  return parsed.data;
});
