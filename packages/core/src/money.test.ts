import { describe, expect, it } from 'vitest';
import { addMoney, formatZAR, money, parseRandsToCents, scaleMoney, subMoney, ZERO } from './money';
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

describe('parseRandsToCents', () => {
  it.each([
    ['5000', 500000],
    ['8500', 850000],
    ['0', 0],
    ['241.84', 24184],
    ['241.8', 24180],
    ['241.80', 24180],
    ['0.05', 5],
    ['  8500  ', 850000], // whitespace at the edges, exactly as a mobile keyboard leaves it
  ])('parses %s as %d cents', (typed, expected) => {
    expect(parseRandsToCents(typed)).toBe(expected);
  });

  it.each([
    [''],
    ['   '],
    ['-100'],
    ['abc'],
    ['1e3'], // scientific notation — never route through this to a rand amount
    ['Infinity'],
    ['150.999'], // a third decimal digit is a likely typo, not R150.999 rounded to R151.00
    ['1,234.56'], // no thousands separator support — matches the pre-existing screen behaviour
  ])('refuses %s rather than guessing', (typed) => {
    expect(parseRandsToCents(typed)).toBeNull();
  });

  it('never crosses a float boundary — a value Number()*100 would mis-round parses exactly', () => {
    // Number('0.1') * 100 === 10.000000000000002 in IEEE 754; the string-based parse avoids it.
    expect(parseRandsToCents('0.10')).toBe(10);
  });
});
