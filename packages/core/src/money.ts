/**
 * Money is integer cents in TypeScript, `numeric(14,2)` in Postgres. Never a JS float.
 * A branded number keeps a raw `number` from being passed where money is expected, and
 * keeps money out of arithmetic that would produce fractional cents.
 *
 * Display formatting (rand-and-cents) is the ONLY place we divide by 100. All arithmetic
 * stays in integer cents. See CLAUDE.md § "Money".
 */

import { InvalidMoneyError } from './errors';

export type Money = number & { readonly __brand: 'Money' };

/** Construct Money from an integer number of cents. Throws on non-integers. */
export function money(cents: number): Money {
  if (!Number.isInteger(cents)) {
    throw new InvalidMoneyError(cents);
  }
  return cents as Money;
}

export const ZERO: Money = money(0);

export function addMoney(a: Money, b: Money): Money {
  return money(a + b);
}

export function subMoney(a: Money, b: Money): Money {
  return money(a - b);
}

/** Scale money by an integer factor (e.g. hours worked). Fractional factors are rejected. */
export function scaleMoney(a: Money, factor: number): Money {
  if (!Number.isInteger(factor)) {
    throw new InvalidMoneyError(factor);
  }
  return money(a * factor);
}

export function isNegative(a: Money): boolean {
  return a < 0;
}

/**
 * Parse a rand amount as a farmer types it (a sale/purchase price field) into Money.
 * String-based, not `Number(x) * 100` — that crosses a float boundary on the way to cents,
 * and a third typed decimal digit (a likely typo, e.g. "150.999") would silently round away
 * a farmer's own figure instead of refusing it. Returns null for anything that is not a plain
 * non-negative decimal with at most two fraction digits: blank, negative, scientific notation,
 * `Infinity`, or extra precision.
 */
export function parseRandsToCents(rands: string): Money | null {
  const trimmed = rands.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }
  const [wholePart, fractionPart = ''] = trimmed.split('.');
  const cents = Number(wholePart) * 100 + Number(fractionPart.padEnd(2, '0'));
  return money(cents);
}

/** Display only. Never feed the result back into arithmetic. */
export function formatZAR(a: Money): string {
  const sign = a < 0 ? '-' : '';
  const abs = Math.abs(a);
  const rand = Math.trunc(abs / 100);
  const cents = (abs % 100).toString().padStart(2, '0');
  return `${sign}R${rand.toLocaleString('en-ZA')}.${cents}`;
}
