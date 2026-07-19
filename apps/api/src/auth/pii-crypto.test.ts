/**
 * What an attacker holding a database dump can and cannot do with an encrypted TOTP seed.
 * Every test here is one of those two sentences.
 */

import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decryptPii, encryptPii, keysAreIdentical, parsePiiKey } from './pii-crypto';

const KEY = randomBytes(32);
const OTHER_KEY = randomBytes(32);
const USER_ID = '0190f3a0-0000-7000-8000-000000000001';
const SEED = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('PII envelope', () => {
  it('round-trips a TOTP seed', () => {
    expect(decryptPii(encryptPii(SEED, KEY, USER_ID), KEY, USER_ID)).toBe(SEED);
  });

  it('never writes the plaintext into the envelope', () => {
    const envelope = Buffer.from(encryptPii(SEED, KEY, USER_ID));
    expect(envelope.toString('utf8')).not.toContain(SEED);
    expect(envelope.toString('utf8')).not.toContain('GEZD');
  });

  it('produces a different ciphertext every time — equal seeds are not detectable', () => {
    // Two farmers with the same seed (or one farmer re-enrolling) must not produce
    // matching bytes, or the dump reveals the relationship without breaking anything.
    const a = Buffer.from(encryptPii(SEED, KEY, USER_ID));
    const b = Buffer.from(encryptPii(SEED, KEY, USER_ID));
    expect(a.equals(b)).toBe(false);
  });

  it('refuses to decrypt with the wrong key — the dump alone is useless', () => {
    const envelope = encryptPii(SEED, KEY, USER_ID);
    expect(() => decryptPii(envelope, OTHER_KEY, USER_ID)).toThrow();
  });

  it('refuses a seed copied onto another user‘s row', () => {
    // The attack: read the dump, paste a known-seed ciphertext into the owner's row, log
    // in with your own authenticator. Binding the ciphertext to the user id kills it.
    const envelope = encryptPii(SEED, KEY, USER_ID);
    const victim = '0190f3a0-0000-7000-8000-000000000002';
    expect(() => decryptPii(envelope, KEY, victim)).toThrow();
  });

  it('refuses a tampered envelope rather than returning garbage', () => {
    const envelope = Buffer.from(encryptPii(SEED, KEY, USER_ID));
    const last = envelope.length - 1;
    envelope.writeUInt8(envelope.readUInt8(last) ^ 0xff, last);
    expect(() => decryptPii(envelope, KEY, USER_ID)).toThrow();
  });

  it('refuses a truncated or unknown-version envelope', () => {
    const envelope = Buffer.from(encryptPii(SEED, KEY, USER_ID));
    expect(() => decryptPii(envelope.subarray(0, 10), KEY, USER_ID)).toThrow(/truncated/);

    const wrongVersion = Buffer.from(envelope);
    wrongVersion[0] = 99;
    expect(() => decryptPii(wrongVersion, KEY, USER_ID)).toThrow(/version/);
  });
});

describe('key handling', () => {
  it('rejects a key that is not 32 bytes, at parse time', () => {
    expect(() => parsePiiKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
    expect(() => parsePiiKey('')).toThrow(/32 bytes/);
    expect(parsePiiKey(KEY.toString('base64'))).toEqual(KEY);
  });

  it('detects a PII key that has been set to the same material as another secret', () => {
    expect(keysAreIdentical(KEY, Buffer.from(KEY))).toBe(true);
    expect(keysAreIdentical(KEY, OTHER_KEY)).toBe(false);
    expect(keysAreIdentical(KEY, randomBytes(16))).toBe(false);
  });
});
