/**
 * Token minting and hashing. Kept separate from session bookkeeping so the crypto is one
 * small, readable surface rather than something spread through business logic.
 */

import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { ACCESS_TOKEN_TTL_SECONDS, type AppConfig } from '../config/config';
import { APP_CONFIG } from '../db/db.module';

/**
 * Claims in the access token. Small on purpose: a JWT is a cache of an authorisation
 * decision, and every claim in it is a fact that keeps being true for 15 minutes after it
 * stops being true. Roles are NOT in here — a role revoked on a farm must take effect
 * now, so authorisation reads farm_users, which RLS is already enforcing anyway.
 */
export interface AccessTokenClaims {
  /** Subject: the user id. */
  sub: string;
  /** The session (refresh-token family member) this access token was minted from. */
  sid: string;
  /** The farm the session is currently acting on — a convenience, re-checked server-side. */
  farm: string | null;
}

/**
 * argon2id parameters. OWASP's baseline: 19 MiB, 2 passes, 1 lane. Tuned for a farmer on
 * a mid-range Android waiting to log in, not for a GPU cluster's convenience.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Note the explicit `@Inject()` on every constructor parameter, here and in every other
 * provider. Nest's implicit resolution reads `design:paramtypes`, which only TypeScript's
 * own emit and SWC produce — esbuild (which powers both Vitest and tsx) does not. Naming
 * the token keeps the API working identically under tsc, tsx, esbuild and swc, instead of
 * failing at runtime in whichever one we didn't test.
 */
@Injectable()
export class TokenService {
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Mints a 15-minute access token (ADR-0007). */
  async signAccessToken(claims: AccessTokenClaims): Promise<string> {
    return this.jwt.signAsync(claims, {
      secret: this.config.jwtSecret,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    return this.jwt.verifyAsync<AccessTokenClaims>(token, { secret: this.config.jwtSecret });
  }

  /**
   * A refresh token: 256 bits from the CSPRNG, base64url. It is an opaque bearer string,
   * not a JWT — deliberately. A JWT refresh token carries claims the server would be
   * tempted to trust without a lookup, and single-use rotation REQUIRES a lookup on every
   * use anyway. Opaque means the database is always the authority on whether it is live.
   */
  generateRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * SHA-256, hex. Correct here precisely because it would be wrong for a password: the
   * input is full-entropy random, so there is no guessing attack for a slow KDF to slow
   * down, and this runs on every refresh from a phone on a weak connection.
   */
  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Passwords get argon2id — memory-hard, because passwords ARE guessable. */
  async hashPassword(password: string): Promise<string> {
    return argonHash(password, ARGON2_OPTIONS);
  }

  /**
   * Verifies a password. Returns false rather than throwing on a malformed stored hash,
   * so a corrupt row is a failed login and not a 500 that tells the caller the account
   * exists.
   */
  async verifyPassword(storedHash: string, password: string): Promise<boolean> {
    try {
      return await argonVerify(storedHash, password, ARGON2_OPTIONS);
    } catch {
      return false;
    }
  }

  /**
   * Constant-time comparison of two hex digests. Used where a token is compared outside
   * an indexed lookup; a length mismatch short-circuits, which leaks only the length.
   */
  static safeEqualHex(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  }
}
