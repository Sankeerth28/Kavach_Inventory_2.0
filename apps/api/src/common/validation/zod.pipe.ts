import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Validates a request body or query with a zod schema from `@kavach/shared`.
 * A ZodError becomes a 400 VALIDATION_FAILED in AllExceptionsFilter.
 */
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    return this.schema.parse(value ?? {});
  }
}

export const zod = <S extends z.ZodType>(schema: S) => new ZodPipe(schema);
