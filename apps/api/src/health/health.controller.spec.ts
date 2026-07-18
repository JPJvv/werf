import { describe, expect, it } from 'vitest';
import { getHealth } from './health';

describe('health', () => {
  it('reports the api as ok', () => {
    expect(getHealth()).toEqual({ status: 'ok', service: 'werf-api' });
  });
});
