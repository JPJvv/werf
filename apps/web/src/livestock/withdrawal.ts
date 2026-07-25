/**
 * The client's meat-withdrawal guard (FR-131) — COMPLIANCE-GATED.
 *
 * The server already refuses a sale inside an active withholding, and that refusal is the
 * authoritative one. This exists because of what happens WITHOUT it, offline: a farmer sells a
 * treated animal in a dead zone, the capture commits locally, and days later the flush is refused
 * forever. The queue jams behind it, the strip says "not sent — will retry", and nothing on the
 * phone explains why — least of all that the animal should not have been loaded onto the truck.
 * By then the transaction has happened. Catching it at capture is not duplicated validation; it is
 * the only version of this rule that reaches the person who can still act on it.
 *
 * The clear date is derived HERE from the device's health log and its cached product register,
 * using the same pure domain functions the server uses. It is a PREVIEW — the authoritative date is
 * the one computed server-side and stored on the treatment event at the time of treatment
 * (ADR-0005) — so a device with a stale register can be wrong at the margin. That asymmetry is
 * deliberate and it is safe in the direction that matters: the server still refuses what the client
 * lets through, and the client warns about what the server would refuse.
 */

import { isWithinWithdrawal, withholdUntil } from '@werf/domain';
import type { StoredHealthEvent } from './LocalHealth';
import type { StoredVetProduct } from './LocalVetProducts';

export interface WithdrawalStatus {
  /** The day this animal clears its meat withholding, or null when nothing is withholding it. */
  readonly clearFrom: string | null;
  /** True when a disposal on the given day would fall inside an active withholding. */
  readonly blocked: boolean;
}

/**
 * Whether an animal may be sold for slaughter on `disposalOn`, and from when if not.
 *
 * The LATEST clear date across every health event on the animal wins: an animal dosed twice is held
 * by whichever withholding runs longest, and taking the most recent event instead would release it
 * early whenever the second product had a shorter period than the first.
 */
export function meatWithdrawalFor(
  animalId: string,
  disposalOn: string,
  events: readonly StoredHealthEvent[],
  products: readonly StoredVetProduct[],
): WithdrawalStatus {
  const withdrawalDays = new Map(products.map((p) => [p.id, p.meatWithdrawalDays]));

  let latest: string | undefined;
  for (const event of events) {
    if (event.animalId !== animalId) continue;
    const days = withdrawalDays.get(event.productId);
    // A product the device does not know about contributes nothing. That is the honest answer —
    // guessing a withdrawal would be inventing a regulated number — and the server still holds the
    // real one, so the animal is protected even when this device cannot say so.
    if (days === undefined || days === null) continue;
    const clear = withholdUntil(event.administeredOn, days);
    if (latest === undefined || clear > latest) latest = clear;
  }

  return {
    clearFrom: latest ?? null,
    blocked: isWithinWithdrawal(latest, disposalOn),
  };
}
