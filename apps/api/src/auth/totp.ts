/**
 * TOTP (RFC 6238) over HOTP (RFC 4226). Pure functions: no clock of their own, no
 * database, no config — the caller passes the time in. That is what makes the drift
 * window testable against the RFC's published vectors instead of against a mock.
 *
 * Written out rather than pulled in as a dependency. It is forty lines of HMAC over a
 * counter, the RFC ships the test vectors that prove it, and a second factor is a poor
 * place to accept an unaudited transitive dependency tree.
 *
 * Why TOTP at all, given the users: it is the universal fallback to passkeys and — like
 * passkeys against a platform authenticator, and unlike SMS — it works with no signal.
 * The seed is on the phone and the code is computed locally, in a camp, with zero bars
 * (ADR-0007).
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** 30 seconds, 6 digits, SHA-1: what every authenticator app assumes when a URI omits them. */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_ALGORITHM = 'sha1';

/**
 * How many steps either side of "now" are accepted. One step = ±30s of tolerance for a
 * phone clock that has drifted and for the seconds a farmer spends typing with gloves on.
 *
 * Each extra step widens the guessing surface linearly (3 valid codes instead of 1), so
 * this stays at 1 and the rate limiter — not the window — is what makes brute force
 * hopeless.
 */
export const TOTP_DRIFT_STEPS = 1;

/**
 * A fresh 160-bit seed, base32 for the authenticator app. 160 bits is the RFC 4226
 * recommendation and matches the SHA-1 block used to consume it.
 */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/**
 * The `otpauth://` URI an authenticator app consumes, usually via QR code.
 *
 * The issuer appears twice — once as a label prefix, once as a parameter — because that
 * is what the de-facto spec requires for apps to show "Werf: thabo@..." rather than a
 * bare address in a list of a dozen accounts.
 */
export function totpEnrolmentUri(params: {
  secret: string;
  account: string;
  issuer: string;
}): string {
  const label = encodeURIComponent(`${params.issuer}:${params.account}`);
  const query = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: TOTP_ALGORITHM.toUpperCase(),
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

/** The code for one counter step — HOTP (RFC 4226 §5.3), dynamic truncation and all. */
export function deriveHotp(secret: string, counter: number): string {
  const counterBytes = Buffer.alloc(8);
  // Big-endian 64-bit. Written as two 32-bit halves because a JS number cannot hold the
  // full range exactly — irrelevant until the year 5000-something, correct regardless.
  counterBytes.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBytes.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac(TOTP_ALGORITHM, base32Decode(secret)).update(counterBytes).digest();

  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/** The code for a moment in time. `at` is a Date so the caller's clock stays injectable. */
export function deriveTotp(secret: string, at: Date): string {
  return deriveHotp(secret, Math.floor(at.getTime() / 1000 / TOTP_PERIOD_SECONDS));
}

/**
 * Checks a user-supplied code against the drift window.
 *
 * Every candidate is compared in constant time AND the loop always runs to completion —
 * returning early on the first match would make a code one step in the past verify
 * measurably faster than one in the future, which leaks where in the window the real
 * code sits.
 *
 * Returns the matched step (0 = current, -1 = previous) rather than a boolean, so the
 * caller can record it and refuse to accept the same step twice — a TOTP code is valid
 * for a full period, which is ample time to replay one read over a shoulder.
 */
export function verifyTotp(
  secret: string,
  code: string,
  at: Date,
): { valid: boolean; step: number } {
  const supplied = code.replace(/\s+/g, '');
  if (!/^\d+$/.test(supplied) || supplied.length !== TOTP_DIGITS) {
    return { valid: false, step: 0 };
  }

  const current = Math.floor(at.getTime() / 1000 / TOTP_PERIOD_SECONDS);
  let matched: number | undefined;

  for (let offset = -TOTP_DRIFT_STEPS; offset <= TOTP_DRIFT_STEPS; offset += 1) {
    const candidate = deriveHotp(secret, current + offset);
    if (timingSafeEqual(Buffer.from(candidate, 'ascii'), Buffer.from(supplied, 'ascii'))) {
      matched ??= current + offset;
    }
  }

  return matched === undefined ? { valid: false, step: 0 } : { valid: true, step: matched };
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, unpadded — what authenticator apps expect in an `otpauth` URI. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];

  return out;
}

/** Tolerates padding, whitespace and lower case — people retype these off paper. */
export function base32Decode(encoded: string): Buffer {
  const clean = encoded.replace(/[=\s]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 in TOTP secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(out);
}
