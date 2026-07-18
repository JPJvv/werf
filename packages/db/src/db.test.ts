import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from './index';

describe('@werf/db', () => {
  it('is an empty scaffold in Phase 0 — no domain tables yet', () => {
    expect(SCHEMA_VERSION).toBe(0);
  });
});
