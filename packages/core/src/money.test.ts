import { describe, expect, it } from 'vitest';
import { addMoney, formatZAR, money, scaleMoney, subMoney, ZERO } from './money';
import { InvalidMoneyError } from './errors';

describe('money', () => {
  it('is integer cents — a farmer earning R241.84 is 24184, never a float', () => {
    expect(money(24184)).toBe(24184);
  });

  it('rejects fractional cents rather than silently rounding', () => {
    expect(() => money(241.84)).toThrow(InvalidMoneyError);
  });

  it('adds and subtracts in cents', () => {
    expect(addMoney(money(16000), money(8184))).toBe(24184);
    expect(subMoney(money(24184), money(16000))).toBe(8184);
  });

  it('scales by whole units only', () => {
    expect(scaleMoney(money(2500), 8)).toBe(20000);
    expect(() => scaleMoney(money(2500), 1.5)).toThrow(InvalidMoneyError);
  });

  it('ZERO is 0 cents', () => {
    expect(ZERO).toBe(0);
  });

  // Display is the only place we cross into rand-and-cents.
  it.each([
    [24184, 'R241.84'],
    [8184, 'R81.84'],
    [0, 'R0.00'],
    [-15000, '-R150.00'],
    [4820411, 'R48 204.11'],
  ])('formats %d cents as %s', (cents, expected) => {
    expect(formatZAR(money(cents))).toBe(expected);
  });
});
