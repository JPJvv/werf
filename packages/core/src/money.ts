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

/** Display only. Never feed the result back into arithmetic. */
export function formatZAR(a: Money): string {
  const sign = a < 0 ? '-' : '';
  const abs = Math.abs(a);
  const rand = Math.trunc(abs / 100);
  const cents = (abs % 100).toString().padStart(2, '0');
  return `${sign}R${rand.toLocaleString('en-ZA')}.${cents}`;
}
