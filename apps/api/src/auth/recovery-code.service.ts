/**
 * Recovery codes (FR-014a) — the way back in when the second factor is gone.
 *
 * Its own service because BOTH factors need it and neither owns it. The scenario is
 * concrete and it is the reason the feature exists: one owner, one device, the factor
 * lives on that device, and the phone drowns in a dam. Without recovery, that farm's
 * entire record system is inaccessible and we cannot help them — because the whole point
 * is that we cannot (ADR-0007).
 *
 * Elevated throughout: these hashes are credential state and no request path may read them.
 */

import { Inject, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { users, type ElevatedDb } from '@werf/db';
import { InvalidCredentialsError } from '@werf/core';
import { ELEVATED_DB } from '../db/db.module';
import { TokenService } from './token.service';

/** FR-014a: ten codes, single-use, shown once. */
const RECOVERY_CODE_COUNT = 10;

/**
 * The alphabet for recovery codes. No 0/O, no 1/I/L: these get printed and put in a safe,
 * then retyped a year later by someone reading their own handwriting under pressure,
 * having lost their phone. Ambiguity here is a support call at the worst possible moment.
 */
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const RECOVERY_GROUP_LENGTH = 5;
const RECOVERY_GROUPS = 2;

@Injectable()
export class RecoveryCodeService {
  constructor(
    @Inject(ELEVATED_DB) private readonly elevated: ElevatedDb,
    @Inject(TokenService) private readonly tokens: TokenService,
  ) {}

  /**
   * Mints a fresh set, replacing any that exist. Returns them in plaintext — the ONLY
   * time they exist that way anywhere. We store argon2id hashes, so this is not a policy
   * we could relax later even if asked: the codes are genuinely gone after this returns.
   */
  async issue(userId: string): Promise<string[]> {
    const plain = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
    const hashed = await Promise.all(
      plain.map((code) => this.tokens.hashPassword(normalise(code))),
    );

    await this.elevated.db
      .update(users)
      .set({ recoveryCodesHashed: hashed })
      .where(eq(users.id, userId));

    return plain;
  }

  /**
   * Mints a set only if the account has none, for the first factor a user enrols.
   *
   * Returns null when they already had codes, so the caller can tell "here are your
   * recovery codes, print them" apart from "you already have some". Enrolling a second
   * factor must not silently invalidate the printed page in the safe.
   */
  async issueIfNone(userId: string): Promise<string[] | null> {
    const [user] = await this.elevated.db
      .select({ codes: users.recoveryCodesHashed })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)));
    if (!user) throw new InvalidCredentialsError();

    if ((user.codes ?? []).length > 0) return null;
    return this.issue(userId);
  }

  /** How many are left — for the "you have 3 codes remaining" nudge. */
  async remaining(userId: string): Promise<number> {
    const [user] = await this.elevated.db
      .select({ codes: users.recoveryCodesHashed })
      .from(users)
      .where(eq(users.id, userId));
    return (user?.codes ?? []).length;
  }

  /**
   * Verifies a code and consumes it — FR-014a's "single-use", enforced by removing the
   * hash rather than by a flag, so there is nothing left to un-delete.
   *
   * Every stored hash is checked even after a match, because argon2id is slow and
   * returning on the first hit makes a code stored early in the array verify measurably
   * faster than one stored late.
   *
   * The removal is done by the database with `array_remove`, gated on the hash still
   * being present, rather than by writing back a filtered copy of the array we read.
   * Writing back a copy is a lost update: two concurrent redemptions of DIFFERENT codes
   * each compute nine elements from the same ten-element snapshot, and the second write
   * silently resurrects the code the first one burned.
   */
  async consume(userId: string, code: string): Promise<boolean> {
    const [user] = await this.elevated.db
      .select({ codes: users.recoveryCodesHashed })
      .from(users)
      .where(eq(users.id, userId));

    const stored = user?.codes ?? [];
    if (stored.length === 0) return false;

    const supplied = normalise(code);
    let matched: string | undefined;

    for (const hash of stored) {
      if (await this.tokens.verifyPassword(hash, supplied)) matched ??= hash;
    }
    if (matched === undefined) return false;

    const consumed = await this.elevated.db
      .update(users)
      .set({ recoveryCodesHashed: sql`array_remove(${users.recoveryCodesHashed}, ${matched})` })
      .where(and(eq(users.id, userId), sql`${matched} = ANY(${users.recoveryCodesHashed})`))
      .returning({ id: users.id });

    // Lost the race: someone else redeemed this same code first. It is spent either way.
    return consumed.length === 1;
  }
}

/** `A7K2M-9PQRS`. Two groups of five: ~49 bits, and readable off a printed page. */
function generateRecoveryCode(): string {
  const group = () =>
    Array.from(
      { length: RECOVERY_GROUP_LENGTH },
      () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)],
    ).join('');

  return Array.from({ length: RECOVERY_GROUPS }, group).join('-');
}

/**
 * Case and separators are presentation, not secret. Someone retyping a code off paper will
 * lower-case it, add a space, or drop the hyphen, and none of those should cost them their
 * only way back into the account.
 */
function normalise(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}
