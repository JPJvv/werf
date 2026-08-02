/**
 * The half of the residue register the DEVICE can answer for itself (FR-131) — COMPLIANCE-GATED.
 *
 * The server derives the authoritative register from the whole log, including doses recorded on a
 * phone this one has never heard of. But a capture made five minutes ago in a dead zone has not
 * reached the server and cannot be in that answer, and it is exactly the capture a farmer wants to
 * see: a death recorded inside a withholding this morning is a fact about a carcass that is still
 * on the farm.
 *
 * ⭐ It runs `meatWithdrawalFor` / `meatWithdrawalForMob` — the same functions the at-capture guard
 * runs — rather than a second, similar-looking rule. §2h's sharpest lesson in this repo was two
 * client mechanisms judging one food-safety boundary through two computations, one of them
 * narrower; there is one here, so this screen cannot quietly say a disposal is clear that the
 * capture screen refused.
 *
 * ⛔ It is a PREVIEW, exactly as the capture guard is. The clear date comes from the device's cached
 * product register, and the authoritative one is computed server-side at treatment time (ADR-0005).
 * A device with a stale cache can be wrong at the margin, and the server's answer — when it arrives
 * — supersedes this one row for row.
 */

import { useMemo } from 'react';
// A VALUE import, not just a type: `TALLY_DECREASES` is read from the schema below rather than
// restated, so a reason added later cannot silently miss the one screen built to show what nothing
// else asks about.
import { schemas } from '@werf/core';
import { farmDay } from '../farmTime';
import { useAnimals, type StoredAnimal } from './LocalHerd';
import { useHealthEvents, type StoredHealthEvent } from './LocalHealth';
import { useLifecycleEvents, type StoredLifecycleEvent } from './LocalLifecycle';
import { useMoves, type StoredMove } from './LocalMoves';
import { useTallies, type StoredTally } from './LocalTallies';
import { useVetProducts, type StoredVetProduct } from './LocalVetProducts';
import { meatWithdrawalFor, meatWithdrawalForMob } from './withdrawal';

/**
 * A flagged disposal the device worked out itself. Deliberately the SERVER's shape minus the two
 * fields only the server can honestly fill.
 *
 * `knownAtCapture` is absent because it is a claim about what the SERVER could see when it stored
 * the row, and this device has no idea — asserting either value would be inventing an audit fact.
 * `withinWithdrawal` is always true here: a row is only produced when it is.
 */
export type LocalResidueFlag = Omit<schemas.ResidueFlagJson, 'knownAtCapture' | 'withinWithdrawal'>;

/**
 * The reasons that take head OUT OF THE HERD, and which of them put it into the food chain. Taken
 * from the schema's own constant so a reason added later cannot silently miss this screen — the
 * register exists precisely to show what nothing else was asking about.
 *
 * ⛔ A TRANSFER is subtracted from `TALLY_DECREASES` rather than being caught by it, and reading the
 * constant was not enough on its own. `transfer_out` JOINED `TALLY_DECREASES` after this file was
 * written (§2.3b), which widened the constant's meaning underneath a reader that had asked it the
 * wrong question: it decreases a MOB, and this register is about head leaving the HERD. Moving
 * dipped head between two of your own camps is ordinary husbandry — the withholding travels with it
 * — so filing it here would bury the lines that matter under camp moves, and, worse, would render
 * as a death. `TALLY_TRANSFERS` exists for exactly this distinction.
 */
const decreases = (reason: schemas.TallyReason): boolean =>
  (schemas.TALLY_DECREASES as readonly string[]).includes(reason) &&
  !(schemas.TALLY_TRANSFERS as readonly string[]).includes(reason);

const intoFoodChain = (reason: schemas.TallyReason): boolean =>
  reason === 'sale' || reason === 'slaughter';

/**
 * Every disposal on this device that its own log says was inside a meat withholding.
 *
 * Pure, so it can be tested without a React tree — the hook below is the thin wrapper that feeds it
 * the stores.
 */
export function localResidueFlags(input: {
  readonly animals: readonly StoredAnimal[];
  readonly lifecycle: readonly StoredLifecycleEvent[];
  readonly tallies: readonly StoredTally[];
  readonly health: readonly StoredHealthEvent[];
  readonly products: readonly StoredVetProduct[];
  readonly moves: readonly StoredMove[];
}): readonly LocalResidueFlag[] {
  const { animals, lifecycle, tallies, health, products, moves } = input;
  const byId = new Map(animals.map((a) => [a.id, a]));
  const flags: LocalResidueFlag[] = [];

  for (const event of lifecycle) {
    // A death and a sale are the two individual ways head leaves. A birth, a weaning or a purchase
    // does not take head out, so no residue question arises for them.
    if (event.type !== 'death' && event.type !== 'sale') continue;
    const animal = byId.get(event.animalId);
    // An animal this device has no row for cannot have its mob history reconstructed, and guessing
    // one would be worse than the honest omission: the server holds the whole log and will say so.
    if (animal === undefined) continue;

    const occurredOn = farmDay(new Date(event.occurredAt));
    const status = meatWithdrawalFor(animal, occurredOn, health, products, moves);
    if (!status.blocked) continue;

    flags.push({
      eventId: event.id,
      eventType: event.type,
      animalId: event.animalId,
      mobId: null,
      occurredAt: event.occurredAt,
      occurredOn,
      // ⭐ A death is not a food-chain event and must never read as one. Refusing to record a death
      // would refuse a FACT, which is worse than recording it — this row is the record, not a
      // reprimand. A slaughter is the other thing entirely, and the flag says which.
      intoFoodChain: event.type === 'sale' || event.slaughtered === true,
      clearFrom: status.clearFrom,
    });
  }

  for (const tally of tallies) {
    if (!decreases(tally.reason)) continue;
    const occurredOn = farmDay(new Date(tally.occurredAt));
    // ⭐ `tallies` is the seventh argument and it is not optional in spirit: it is the route that
    // reads a withholding which ARRIVED WITH the head (§2.3b) rather than being given to it. Omit
    // it and this screen answers a narrower question than the capture guard that refused the same
    // disposal — which is the two-mechanisms-one-boundary defect the header above claims is closed.
    // For a counted flock it is the ONLY route that can fire, because there are no `animals` rows.
    const status = meatWithdrawalForMob(
      tally.mobId,
      occurredOn,
      health,
      products,
      animals,
      moves,
      tallies,
    );
    if (!status.blocked) continue;

    flags.push({
      eventId: tally.id,
      eventType: 'tally',
      animalId: null,
      mobId: tally.mobId,
      reason: tally.reason,
      occurredAt: tally.occurredAt,
      occurredOn,
      intoFoodChain: intoFoodChain(tally.reason),
      clearFrom: status.clearFrom,
    });
  }

  return flags;
}

/** The device's own flagged disposals, reactive over every store the derivation reads. */
export function useLocalResidueFlags(): readonly LocalResidueFlag[] {
  const animals = useAnimals();
  const lifecycle = useLifecycleEvents();
  const tallies = useTallies();
  const health = useHealthEvents();
  const products = useVetProducts();
  const moves = useMoves();
  return useMemo(
    () => localResidueFlags({ animals, lifecycle, tallies, health, products, moves }),
    [animals, lifecycle, tallies, health, products, moves],
  );
}
