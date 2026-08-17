import { describe, expect, it } from 'vitest';
import { AUTH_RATE_LIMITS } from './rate-limits';

describe('authentication rate-limit budgets', () => {
  it('keeps password guessing below eleven attempts in a fifteen-minute window', () => {
    expect(AUTH_RATE_LIMITS.login.sustained.limit).toBeLessThanOrEqual(10);
    expect(AUTH_RATE_LIMITS.login.sustained.ttl).toBeGreaterThanOrEqual(15 * 60_000);
    expect(AUTH_RATE_LIMITS.login.sustained.blockDuration).toBeGreaterThanOrEqual(15 * 60_000);
  });

  it('gives six-digit and passkey verification fewer attempts than login', () => {
    expect(AUTH_RATE_LIMITS.secondFactor.sustained.limit).toBeLessThan(
      AUTH_RATE_LIMITS.login.sustained.limit,
    );
    expect(AUTH_RATE_LIMITS.secondFactor.sustained.blockDuration).toBeGreaterThanOrEqual(
      AUTH_RATE_LIMITS.login.sustained.blockDuration,
    );
  });

  it('limits account creation much more tightly than ordinary API traffic', () => {
    expect(AUTH_RATE_LIMITS.register.sustained.limit).toBeLessThanOrEqual(5);
    expect(AUTH_RATE_LIMITS.register.sustained.ttl).toBe(60 * 60_000);
  });
});
