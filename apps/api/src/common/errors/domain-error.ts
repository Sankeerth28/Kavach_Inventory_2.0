import type { ErrorCode } from '@kavach/shared';

/** A business-rule failure with a stable code the clients can map to plain language (PRD §25.4). */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const unauthenticated = (message = 'Please sign in.') =>
  new DomainError('UNAUTHENTICATED', message, 401);

export const forbidden = (message = 'You do not have permission to do this.') =>
  new DomainError('FORBIDDEN', message, 403);

/** Also used for rows of another project: their existence is never revealed. */
export const notFound = (what: string) => new DomainError('NOT_FOUND', `${what} not found.`, 404);

export const conflict = (message: string, details?: unknown) =>
  new DomainError('CONFLICT', message, 409, details);

export const invalid = (message: string, details?: unknown) =>
  new DomainError('VALIDATION_FAILED', message, 400, details);
