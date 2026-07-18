import { describe, expect, it } from 'vitest';
import { IMPLEMENTED_JURISDICTIONS } from './index';

describe('@werf/domain jurisdiction seam', () => {
  it('implements exactly one jurisdiction, ZA — no stubbed second country (ADR-0006)', () => {
    expect(IMPLEMENTED_JURISDICTIONS).toEqual(['ZA']);
  });
});
