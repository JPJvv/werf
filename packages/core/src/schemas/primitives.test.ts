import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { uuidv7 } from '../uuid';
import { uuidSchema, uuidV7Schema } from './primitives';

describe('uuidV7Schema', () => {
  it('accepts a real client-generated UUIDv7', () => {
    expect(uuidV7Schema.safeParse(uuidv7()).success).toBe(true);
  });

  it('accepts a hand-written UUIDv7-shaped literal', () => {
    expect(uuidV7Schema.safeParse('018f8e2a-7b3c-7c4d-8e5f-0a1b2c3d4e5f').success).toBe(true);
  });

  it('rejects a well-formed UUIDv4 — the defect P2.9 exists to catch', () => {
    // Node's crypto.randomUUID() is v4. A capture id minted this way instead of with `uuidv7()`
    // is exactly the mistake found in three e2e specs while wiring this schema up.
    const v4 = randomUUID();
    expect(uuidSchema.safeParse(v4).success).toBe(true); // still a valid UUID...
    expect(uuidV7Schema.safeParse(v4).success).toBe(false); // ...but not a v7 one.
  });

  it('rejects a non-UUID string', () => {
    expect(uuidV7Schema.safeParse('not-a-uuid').success).toBe(false);
  });
});
