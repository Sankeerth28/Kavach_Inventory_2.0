import type { PipeTransform } from '@nestjs/common';
import { IdSchema } from '@kavach/shared';
import { notFound } from '../errors/domain-error';

/** Route ids must be UUIDs. Anything else cannot exist, so it is a 404, not a database error. */
export class IdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!IdSchema.safeParse(value).success) throw notFound('Record');
    return value;
  }
}
