import { Throttle, minutes, seconds } from '@nestjs/throttler';

/**
 * Endpoint-specific limits for the authentication boundary.
 *
 * These are the in-process safety net, not the complete production control. The production
 * topology also applies an AWS WAF rate-based rule before traffic reaches Nest, and replaces the
 * default in-memory Throttler storage with the shared Redis store named in the security plan. If
 * either outer layer disappears, these limits still make one API process expensive to brute-force.
 *
 * Limits are deliberately exported so the security tests can pin the budgets. A future refactor
 * must not quietly turn ten login attempts per fifteen minutes into an effectively unlimited
 * endpoint.
 */
export const AUTH_RATE_LIMITS = {
  login: {
    burst: { limit: 3, ttl: seconds(10), blockDuration: seconds(30) },
    sustained: { limit: 10, ttl: minutes(15), blockDuration: minutes(15) },
  },
  register: {
    burst: { limit: 2, ttl: minutes(1), blockDuration: minutes(5) },
    sustained: { limit: 5, ttl: minutes(60), blockDuration: minutes(60) },
  },
  refresh: {
    burst: { limit: 5, ttl: seconds(10), blockDuration: seconds(30) },
    sustained: { limit: 30, ttl: minutes(1), blockDuration: minutes(5) },
  },
  secondFactor: {
    burst: { limit: 2, ttl: seconds(10), blockDuration: minutes(1) },
    sustained: { limit: 5, ttl: minutes(5), blockDuration: minutes(15) },
  },
  ceremony: {
    burst: { limit: 3, ttl: seconds(10), blockDuration: seconds(30) },
    sustained: { limit: 10, ttl: minutes(5), blockDuration: minutes(15) },
  },
} as const;

export const LoginRateLimit = (): MethodDecorator => Throttle(AUTH_RATE_LIMITS.login);
export const RegistrationRateLimit = (): MethodDecorator => Throttle(AUTH_RATE_LIMITS.register);
export const RefreshRateLimit = (): MethodDecorator => Throttle(AUTH_RATE_LIMITS.refresh);
export const SecondFactorRateLimit = (): MethodDecorator => Throttle(AUTH_RATE_LIMITS.secondFactor);
export const AuthCeremonyRateLimit = (): MethodDecorator => Throttle(AUTH_RATE_LIMITS.ceremony);
