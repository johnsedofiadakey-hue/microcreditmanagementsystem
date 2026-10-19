import type { RejectReason } from '@susu/shared';

/**
 * A business rule said no. Safe to show to the caller; never retried.
 * Anything that is not a DomainError is treated as an infrastructure failure and retried.
 */
export class DomainError extends Error {
  constructor(
    readonly reason: RejectReason,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
