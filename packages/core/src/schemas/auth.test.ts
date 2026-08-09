import { describe, expect, it } from 'vitest';
import { loginRequestSchema, passwordSchema } from './auth';

describe('password migration policy', () => {
  it('requires fifteen characters for a newly created migration password', () => {
    expect(passwordSchema.safeParse('fourteen-char!').success).toBe(false);
    expect(passwordSchema.safeParse('fifteen-chars!!').success).toBe(true);
  });

  it('still accepts a bounded legacy password at sign-in so policy changes do not lock users out', () => {
    expect(
      loginRequestSchema.safeParse({
        email: 'owner@example.test',
        password: 'old-short',
        deviceLabel: null,
      }).success,
    ).toBe(true);
  });
});
