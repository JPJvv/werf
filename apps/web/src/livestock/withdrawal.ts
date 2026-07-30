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
 *
 * Both entry points read BOTH routes a dose takes, because health events are animal-XOR-mob. An
 * asymmetry here is not a rounding error — it is this guard silently disagreeing with the one that
 * will actually refuse. The individual path was blind to mob doses and the group path was blind to
 * individual ones; each was found by a different review agent, from its own side. Membership is
 * reconstructed from the move log in farm-local days, the same shape the server runs, so the two
 * answer the same question rather than two similar-looking ones.
 */

import { isWithinWithdrawal, withholdUntil } from '@werf/domain';
import { farmDay } from '../farmTime';
import type { StoredAnimal } from './LocalHerd';
import type { StoredHealthEvent } from './LocalHealth';
import type { StoredMove } from './LocalMoves';
import type { StoredVetProduct } from './LocalVetProducts';

export interface WithdrawalStatus {
  /** The day this animal clears its meat withholding, or null when nothing is withholding it. */
  readonly clearFrom: string | null;
  /** True when a disposal on the given day would fall inside an active withholding. */
  readonly blocked: boolean;
}

/** One stretch of farm-local DAYS during which an animal belonged to a mob. `toDay` null = still in. */
interface MobInterval {
  readonly mobId: string;
  readonly fromDay: string;
  readonly toDay: string | null;
}

/**
 * When an animal was in which mob, from the device's own move log — the same reconstruction the
 * server runs, in the same farm-local DAYS, inclusive at BOTH ends (a move day belongs to both
 * mobs, and a food-safety boundary must fail toward blocking).
 *
 * The client log holds only the DESTINATION of each move, because that is all a capture sends. So
 * the opening mob is the animal's `mobId` AS FIRST CAPTURED, which is exactly what the herd store
 * keeps: it is append-only and never rewritten. Pass the RAW animal for that reason — a projected
 * one carries where it is NOW, which is the denormalised value this whole reconstruction exists to
 * stop trusting.
 */
function mobMembership(animal: StoredAnimal, moves: readonly StoredMove[]): readonly MobInterval[] {
  const mine = moves
    .filter((m) => m.animalId === animal.id && m.toMobId !== undefined)
    .sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0));

  const intervals: MobInterval[] = [];
  let openMob = animal.mobId ?? null;
  let openedOn = '0000-01-01';

  for (const move of mine) {
    const to = move.toMobId ?? null;
    if (to === openMob) continue;
    const movedOn = farmDay(new Date(move.occurredAt));
    if (openMob !== null) intervals.push({ mobId: openMob, fromDay: openedOn, toDay: movedOn });
    openMob = to;
    openedOn = movedOn;
  }
  if (openMob !== null) intervals.push({ mobId: openMob, fromDay: openedOn, toDay: null });
  return intervals;
}

/** Was this mob the animal's on that day? Inclusive at both ends, like the server. */
function inMobOn(wasIn: readonly MobInterval[], mobId: string, day: string): boolean {
  return wasIn.some(
    (m) => m.mobId === mobId && day >= m.fromDay && (m.toDay === null || day <= m.toDay),
  );
}

/** True when this dose reached this animal — its own, or its mob's while it was in that mob. */
function reachedAnimal(
  event: StoredHealthEvent,
  animal: StoredAnimal,
  wasIn: readonly MobInterval[],
): boolean {
  if (event.animalId === animal.id) return true;
  const mobId = event.mobId ?? null;
  // `administeredOn` is the recorded day. Nothing is derived from an instant here, deliberately.
  return mobId !== null && inMobOn(wasIn, mobId, event.administeredOn);
}

/**
 * Whether an animal may be sold or slaughtered on `disposalOn`, and from when if not.
 *
 * BOTH ROUTES A DOSE TAKES. Its own treatments, and every dose given to a mob WHILE IT WAS IN THAT
 * MOB — a plunge dip is captured against the flock and stores `animal_id = NULL`, so reading only
 * animal-subject events cleared every individual in a dipped mob. Membership comes from the move
 * log, never from where the animal is now: one dipped in the dip camp and since walked out must
 * stay withheld, and one that joined a dipped mob afterwards must not be blocked for a dose it
 * never received.
 *
 * The LATEST clear date wins: an animal dosed twice is held by whichever withholding runs longest.
 */
export function meatWithdrawalFor(
  animal: StoredAnimal,
  disposalOn: string,
  events: readonly StoredHealthEvent[],
  products: readonly StoredVetProduct[],
  moves: readonly StoredMove[] = [],
): WithdrawalStatus {
  const wasIn = mobMembership(animal, moves);
  return latestClearAcross(
    events.filter((e) => reachedAnimal(e, animal, wasIn)),
    disposalOn,
    products,
  );
}

/**
 * Whether head may be tallied out of a MOB for slaughter or sale on `disposalOn`.
 *
 * Both routes again, from the other side. The mob's own doses are the obvious half; the half that
 * was missing is an animal in the mob treated INDIVIDUALLY, whose event stores `mob_id = NULL`. A
 * tally takes head out without naming WHICH head, so the treated one is exactly as likely to be on
 * the truck as any other.
 *
 * This is the SMALLHOLDER path. A flock run by head count has no `animals` rows, so every
 * animal-keyed check was structurally incapable of firing for it. But a mob may ALSO hold
 * individually-registered animals, which is why the herd is read here rather than assumed empty.
 */
export function meatWithdrawalForMob(
  mobId: string,
  disposalOn: string,
  events: readonly StoredHealthEvent[],
  products: readonly StoredVetProduct[],
  animals: readonly StoredAnimal[] = [],
  moves: readonly StoredMove[] = [],
): WithdrawalStatus {
  // Every individually-registered animal STANDING IN this mob on the disposal day, with the mob
  // history that says which doses reached it. A tally takes head out without naming which, so any
  // one of them may be on the truck — and each carries whatever `reachedAnimal` carries, which is
  // exactly the per-member question the server asks: this is `meatWithdrawalFor` run from the mob
  // side rather than a second, narrower rule.
  const members = animals
    .map((animal) => ({ animal, wasIn: mobMembership(animal, moves) }))
    .filter((m) => inMobOn(m.wasIn, mobId, disposalOn));

  const reaches = (event: StoredHealthEvent): boolean => {
    // The COUNTED portion of the mob — head with no `animals` rows — is reached by the mob's own
    // doses. This is the only half that ever fires for a pure head-count flock.
    if ((event.mobId ?? null) === mobId) return true;
    // Any individually-registered member the dose reached: its own treatment, OR a mob dose given
    // to ANOTHER mob while it was standing in that mob and since walked in here. The old guard was
    // blind to that second case — it returned false for every `animal_id = NULL` dose whose mob was
    // not this one, so a dipped ox walked into the sale mob CLEAR on the device while the server,
    // reconstructing per member, refused it days after the truck had left.
    return members.some((m) => reachedAnimal(event, m.animal, m.wasIn));
  };
  return latestClearAcross(events.filter(reaches), disposalOn, products);
}

/**
 * The LATEST clear date across a set of doses wins: a subject dosed twice is held by whichever
 * withholding runs longest, and taking the most recent event instead would release it early
 * whenever the second product had a shorter period than the first.
 */
function latestClearAcross(
  events: readonly StoredHealthEvent[],
  disposalOn: string,
  products: readonly StoredVetProduct[],
): WithdrawalStatus {
  const withdrawalDays = new Map(products.map((p) => [p.id, p.meatWithdrawalDays]));

  let latest: string | undefined;
  for (const event of events) {
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
