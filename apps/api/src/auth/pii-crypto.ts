/**
 * Envelope encryption for the small set of columns that must not be readable from a
 * database backup: the TOTP seed today, employees' ID and banking details from Phase 5
 * (.claude/rules/db.md).
 *
 * The key is the PII key, NOT the database key. That distinction is the entire control.
 * If the seed were encrypted with a key the database server holds, then anyone who can
 * read the database can read the seeds, and the encryption is decoration — a stolen dump
 * would hand over every farmer's second factor. Separating them means the dump alone is
 * useless (ADR-0007).
 *
 * AES-256-GCM: authenticated, so a tampered ciphertext fails loudly instead of decrypting
 * to plausible garbage that we then feed to an HMAC.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12; // 96 bits — the GCM standard, and what the NIST guidance assumes
const TAG_BYTES = 16;

/**
 * Envelope version. Stored as the first byte so the day we rotate to a new scheme, old
 * rows stay readable and the migration is "decrypt v1, encrypt v2" rather than a flag day
 * with a farmer's second factor on the wrong side of it.
 */
const ENVELOPE_V1 = 1;

/** Layout: [version:1][iv:12][tag:16][ciphertext:…] */
export function encryptPii(plaintext: string, key: Buffer, aad: string): Uint8Array {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return Buffer.concat([Buffer.from([ENVELOPE_V1]), iv, cipher.getAuthTag(), ciphertext]);
}

/**
 * Decrypts, or throws. There is no "best effort" here on purpose: a seed that fails its
 * authentication tag is a seed we must not use, and returning null would invite a caller
 * to treat it as "no 2FA enrolled" and wave the login through.
 *
 * `aad` binds the ciphertext to its owner — pass the user id. Without it, a ciphertext
 * copied from one user row into another decrypts perfectly, and whoever holds that seed
 * can satisfy the second factor for an account that never enrolled it.
 */
export function decryptPii(envelope: Uint8Array, key: Buffer, aad: string): string {
  assertKey(key);
  const buffer = Buffer.from(envelope);
  if (buffer.length < 1 + IV_BYTES + TAG_BYTES) {
    throw new Error('Encrypted PII value is truncated');
  }
  if (buffer[0] !== ENVELOPE_V1) {
    throw new Error(`Unsupported PII envelope version ${buffer[0]}`);
  }

  const iv = buffer.subarray(1, 1 + IV_BYTES);
  const tag = buffer.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const ciphertext = buffer.subarray(1 + IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Parses the configured key. Base64, exactly 32 bytes — a shorter key is not "weaker
 * encryption", it is a crash at the first enrolment, and it should happen at boot with an
 * operator watching rather than in front of a farmer.
 */
export function parsePiiKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  assertKey(key);
  return key;
}

/**
 * True when two keys are the same material. Used at boot to refuse a configuration where
 * the PII key has been set to the JWT secret — that reduces two independent compromises
 * to one, silently, while everything still appears to work.
 */
export function keysAreIdentical(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new Error(`PII encryption key must be ${KEY_BYTES} bytes; got ${key.length}`);
  }
}
