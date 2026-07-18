/**
 * Typed errors for domain code. Never `throw new Error("string")` in domain code —
 * a typed error carries a stable `code` that callers, logs, and the UI can branch on
 * without string-matching a message.
 */

export type WerfErrorCode =
  'VALIDATION' | 'NOT_FOUND' | 'TENANCY' | 'OFFLINE_UNAVAILABLE' | 'MISSING_RATE' | 'INVALID_MONEY';

export abstract class WerfError extends Error {
  abstract readonly code: WerfErrorCode;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ValidationError extends WerfError {
  readonly code = 'VALIDATION';
}

export class NotFoundError extends WerfError {
  readonly code = 'NOT_FOUND';
}

/** A query or write that crossed a farm boundary. This is a security bug, surfaced loudly. */
export class TenancyError extends WerfError {
  readonly code = 'TENANCY';
}

/**
 * A server-authoritative operation was attempted with no network. This is the ONE place
 * a "no connection" path is legitimate — the API path (payroll, PDF export), never a
 * capture/write path. If you reach for this in a write path, that is the bug.
 */
export class OfflineUnavailableError extends WerfError {
  readonly code = 'OFFLINE_UNAVAILABLE';
}

/**
 * No regulated rate was found for the (jurisdiction, code, date). A missing rate THROWS.
 * Never fall back to the newest rate — a silent fallback underpays a farm for a year.
 */
export class MissingRateError extends WerfError {
  readonly code = 'MISSING_RATE';

  constructor(
    readonly jurisdiction: string,
    readonly rateCode: string,
    readonly occurredAt: Date,
  ) {
    super(`No rate for ${rateCode} in ${jurisdiction} effective ${occurredAt.toISOString()}`);
  }
}

export class InvalidMoneyError extends WerfError {
  readonly code = 'INVALID_MONEY';

  constructor(readonly value: number) {
    super(`Money must be integer cents, received ${value}`);
  }
}
