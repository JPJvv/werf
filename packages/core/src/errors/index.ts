/**
 * Typed errors for domain code. Never `throw new Error("string")` in domain code —
 * a typed error carries a stable `code` that callers, logs, and the UI can branch on
 * without string-matching a message.
 */

export type WerfErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'TENANCY'
  | 'OFFLINE_UNAVAILABLE'
  | 'MISSING_RATE'
  | 'INVALID_MONEY'
  | 'INVALID_CREDENTIALS'
  | 'SESSION_INVALID'
  | 'SECOND_FACTOR_ENROLMENT_REQUIRED'
  | 'STEP_UP_REQUIRED'
  | 'CONFLICT'
  | 'QUOTA_EXCEEDED';

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

/**
 * Authentication failed. Carries no detail about WHY, on purpose: "no such user" and
 * "wrong password" must be indistinguishable to a caller, or the endpoint becomes an
 * oracle for enumerating who banks with which farm.
 */
export class InvalidCredentialsError extends WerfError {
  readonly code = 'INVALID_CREDENTIALS';

  constructor() {
    super('Invalid credentials');
  }
}

/**
 * A refresh token was rejected: expired, revoked, or already spent. `reason` is for OUR
 * logs, never for the response body.
 *
 * Note what this error must NOT cause: a client seeing it discards its tokens, never its
 * write queue. Security is not permitted to be the reason a farmer's month of work
 * disappears (ADR-0007, offline-sync invariant 5).
 */
export class SessionInvalidError extends WerfError {
  readonly code = 'SESSION_INVALID';

  constructor(readonly reason: 'expired' | 'revoked' | 'reused' | 'unknown') {
    super(`Session invalid: ${reason}`);
  }
}

/**
 * The caller is authenticated but holds a role that must have a second factor, and has
 * not enrolled one. Every route refuses them except enrolment itself and logout.
 *
 * Unlike the login errors above, this one is deliberately SPECIFIC. There is no oracle to
 * protect here — the caller has already proved who they are — and a client that cannot
 * tell "enrol your second factor" apart from a generic 403 has no way to send the farmer
 * anywhere useful. Vagueness here would strand an owner at a blank wall.
 */
export class SecondFactorEnrolmentRequiredError extends WerfError {
  readonly code = 'SECOND_FACTOR_ENROLMENT_REQUIRED';

  constructor() {
    super('This role requires a second factor before the account can be used');
  }
}

/**
 * The caller has a live session, but its human authentication is too old for a
 * credential-changing operation. Specific because the safe recovery is actionable:
 * perform a new full sign-in, including the account's existing second factor.
 */
export class StepUpRequiredError extends WerfError {
  readonly code = 'STEP_UP_REQUIRED';

  constructor() {
    super('Sign in again before changing sign-in methods');
  }
}

/** A uniqueness rule was violated — an email already registered, a farm name taken. */
export class ConflictError extends WerfError {
  readonly code = 'CONFLICT';
}

/**
 * A farm's attachment storage quota (P3.16, owner decision 2026-08-16) would be exceeded by
 * this write. Distinct from `ConflictError` — `ConflictError` on an attachment already covers
 * several unrelated shapes (an id reused with different content, a row the orphan sweep just
 * reclaimed), and a farmer told "already exists" for a quota refusal would be sent to fix
 * nothing that was ever wrong. This code gives the client an accurate, specific reason.
 */
export class QuotaExceededError extends WerfError {
  readonly code = 'QUOTA_EXCEEDED';
}

export class InvalidMoneyError extends WerfError {
  readonly code = 'INVALID_MONEY';

  constructor(readonly value: number) {
    super(`Money must be integer cents, received ${value}`);
  }
}
