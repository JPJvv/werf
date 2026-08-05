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
 * Both entry points read BOTH routes a DOSE takes, because health events are animal-XOR-mob. An
 * asymmetry here is not a rounding error — it is this guard silently disagreeing with the one that
 * will actually refuse. The individual path was blind to mob doses and the group path was blind to
 * individual ones; each was found by a different review agent, from its own side. Membership is
 * reconstructed from the move log in farm-local days, the same shape the server runs, so the two
 * answer the same question rather than two similar-looking ones.
 *
 * ⭐ THERE IS A THIRD SOURCE, and this header did not mention it for two sessions after it landed.
 * Since §2.3b a withholding can ARRIVE WITH head rather than be given to it — a `transfer_in` out of
 * a dipped camp, or a purchase whose seller declared one — and for a counted flock that event is the
 * only place the fact can live, because there are no `animals` rows to hang a dose on. Only the MOB
 * entry point reads it (`latestArrivedWithhold`), and that asymmetry is CORRECT rather than the next
 * defect: the server's per-animal rule reads only health events too, so the two sides agree. It is
 * named here because the route that goes unmentioned is the route the next reader forgets, and this
 * file has now paid for that three times.
 *
 * ⭐ AND EVERY ROUTE IS BOUNDED BY THE DAY BEING JUDGED. A dose given after a disposal cannot
 * withhold it — see `latestClearAcross`, which had no such bound while the server did.
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
    // ⭐ (occurredAt, id), the same TOTAL order the server runs. Day-grained moves tie on the
    // instant by construction, so ordering on `occurredAt` alone left the last-move-wins outcome to
    // capture-store append order on one side and the query plan on the other — a silent
    // disagreement about which mob an animal ended in. The id is a client UUIDv7, identical on both
    // sides and time-ordered; compared by BYTE, never `localeCompare`, exactly as `mob-tally.ts`.
    .sort((a, b) =>
      a.occurredAt < b.occurredAt
        ? -1
        : a.occurredAt > b.occurredAt
          ? 1
          : a.id < b.id
            ? -1
            : a.id > b.id
              ? 1
              : 0,
    );

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
  // Before anything is read: an unreadable day cannot be judged. See `unreadableDay`.
  if (unreadableDay(disposalOn)) return { clearFrom: null, blocked: true };
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
  /**
   * ⭐ The tally log, for withholdings that ARRIVED WITH head rather than being given to it (§2.3b).
   *
   * Both routes above ask "was something standing here dosed". Neither can see head that walked in
   * already withheld — and for a counted flock nothing else can either, because there are no
   * `animals` rows to carry the fact. A `transfer_in` out of a dipped camp, or a purchase whose
   * seller declared a withdrawal, would otherwise be clear the moment it arrived. That is exactly
   * the laundering the sale-out/purchase-in workaround performed, one gate along.
   *
   * ⛔ REQUIRED, with no default, and that is deliberate. It defaulted to `[]` when it was added,
   * and the residue register was written against the six-argument signature and kept compiling —
   * so the screen that exists to explain a refusal quietly judged by a narrower rule than the one
   * that refused. A caller with no arrivals must say `[]` out loud.
   */
  tallies: readonly ArrivedHead[],
): WithdrawalStatus {
  // ⭐ HERE rather than inside, because `mobWithdrawal` recombines `blocked` with an arrival's date
  // and would discard a fail-closed verdict returned deeper in. See `unreadableDay`.
  if (unreadableDay(disposalOn)) return { clearFrom: null, blocked: true };
  return mobWithdrawal(mobId, disposalOn, { events, products, animals, moves, tallies }, new Set());
}

/** Everything the mob rule reads, threaded through the transfer chain unchanged. */
interface MobWithdrawalContext {
  readonly events: readonly StoredHealthEvent[];
  readonly products: readonly StoredVetProduct[];
  readonly animals: readonly StoredAnimal[];
  readonly moves: readonly StoredMove[];
  readonly tallies: readonly ArrivedHead[];
}

/**
 * The mob rule, with the chain of mobs already on the current path. Head can go A → B → A in a
 * fortnight, so the walk has to terminate; `visited` is what makes it.
 */
function mobWithdrawal(
  mobId: string,
  disposalOn: string,
  ctx: MobWithdrawalContext,
  visited: ReadonlySet<string>,
): WithdrawalStatus {
  const { events, products, animals, moves } = ctx;
  const seen = new Set(visited).add(mobId);
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
  const dosed = latestClearAcross(events.filter(reaches), disposalOn, products);
  const arrived = latestArrivedWithhold(mobId, disposalOn, ctx, seen);
  if (arrived === null) return dosed;

  const clearFrom =
    dosed.clearFrom === null || arrived > dosed.clearFrom ? arrived : dosed.clearFrom;
  return { clearFrom, blocked: isWithinWithdrawal(clearFrom, disposalOn) };
}

/**
 * ⛔ A DAY WE CANNOT READ IS NOT A DAY BEFORE EVERY DOSE — it is a question we cannot answer, and
 * this boundary fails toward BLOCKING.
 *
 * `disposalOn` comes from a native `<input type="date">`, which is clearable, so `''` is an
 * ordinary state rather than a defect elsewhere. Without this, every `administeredOn > disposalOn`
 * bound in this file reads `'2026-07-10' > ''` as true for EVERY dose, skips them all, and returns
 * CLEAR for an animal deep inside a withholding — a bound added to close a false refusal opening a
 * false pass, which is the worse direction.
 *
 * ⭐ IT LIVES AT THE ENTRY POINTS, not inside `latestClearAcross`, and that is the ninth pass's
 * finding rather than a preference. Inside, `mobWithdrawal` took the fail-closed verdict and then
 * RECOMPUTED `blocked` from `isWithinWithdrawal(clearFrom, disposalOn)` whenever an arrival was
 * present — discarding it. It survived only because `''` also happens to make
 * `latestArrivedWithhold` return null; a malformed day that sorts high (`'2026-7-5'`) took the
 * other branch and came back CLEAR. Fail-closed by lexical coincidence is not fail-closed.
 *
 * `clearFrom` stays null: there is no date to show, and the screen that asked for the day is the
 * one that must ask again.
 */
function unreadableDay(disposalOn: string): boolean {
  return !/^\d{4}-\d{2}-\d{2}$/.test(disposalOn);
}

/** A tally that may have brought a withholding into a mob with it. The device's own log, verbatim. */
export interface ArrivedHead {
  readonly mobId: string;
  /** ISO instant. Compared as a farm-local DAY, like every other boundary in this file. */
  readonly occurredAt: string;
  readonly reason: string;
  /**
   * The mob the head came FROM on a `transfer_in`. Read so the source can be asked again, live, as
   * at the day the head left it — `carriedWithholdUntil` is a snapshot and can be stale by a dose.
   */
  readonly counterpartMobId?: string | undefined;
  /** Carried out of the source mob on a transfer. A preview; the server stores its own. */
  readonly carriedWithholdUntil?: string | undefined;
  /** What the seller said about bought-in head. Absent = unknown history, never guessed. */
  readonly declaredWithdrawalUntil?: string | undefined;
}

/**
 * The latest withholding carried INTO a mob by head arriving on or before `disposalOn`.
 *
 * ⛔ An UNDECLARED purchase contributes nothing, and that is the decision rather than the gap it
 * looks like. "Unknown history" is the honest answer for an animal whose treatment nobody here
 * witnessed: inventing a period would be a fabricated regulated number, and assuming clear would be
 * the laundering this exists to stop. It is simply not evidence in either direction.
 *
 * Only the halves that bring head IN are read. A `transfer_out` carries the same date deliberately —
 * so a later reader can see what left under a withholding — but reading it here would withhold the
 * mob the residue departed FROM.
 */
function latestArrivedWithhold(
  mobId: string,
  disposalOn: string,
  ctx: MobWithdrawalContext,
  visited: ReadonlySet<string>,
): string | null {
  let latest: string | null = null;
  for (const tally of ctx.tallies) {
    if (tally.mobId !== mobId) continue;
    if (tally.reason !== 'transfer_in' && tally.reason !== 'purchase') continue;
    // Head that arrives after the day being judged cannot withhold what left before it.
    const arrivedOn = farmDay(new Date(tally.occurredAt));
    if (arrivedOn > disposalOn) continue;
    for (const candidate of [tally.carriedWithholdUntil, tally.declaredWithdrawalUntil]) {
      if (candidate !== undefined && (latest === null || candidate > latest)) latest = candidate;
    }

    // ⛔ THE CARRIED DATE IS A FLOOR, NEVER A CEILING. It is a PREVIEW computed when the transfer
    // was captured, from a log that may not yet hold the dip: one phone records the dip, another
    // walks the head through the gate, and whichever reconnects first decides what got frozen.
    // Trusting it alone leaves the joined flock clear forever — so the source mob is asked again,
    // as at the day the head left it. A back-dated dose that lands next week still reaches here.
    //
    // A purchase has no counterpart mob on this farm to ask, so the seller's declaration is all
    // there is. That is the honest limit of what anyone here witnessed, not an omission.
    if (tally.reason !== 'transfer_in') continue;
    const source = tally.counterpartMobId;
    if (source === undefined || visited.has(source)) continue;
    const live = mobWithdrawal(source, arrivedOn, ctx, visited).clearFrom;
    if (live !== null && (latest === null || live > latest)) latest = live;
  }
  return latest;
}

/**
 * The subjects (animal ids, mob ids) whose refused EVIDENCE must hold an individual animal's
 * food-chain disposal in the outbox. It is the exact set `meatWithdrawalFor` reads: the animal
 * itself, and every mob it has EVER stood in (a dose to any of them can be withholding it, and a
 * mob it has since left still counts). The flush taints `provides` against these, so the two client
 * mechanisms — the at-capture guard and the send-order guard — read the same graph and cannot drift.
 */
export function animalDisposalSubjects(
  animal: StoredAnimal,
  moves: readonly StoredMove[] = [],
): readonly string[] {
  return [animal.id, ...mobMembership(animal, moves).map((interval) => interval.mobId)];
}

/**
 * The subjects whose refused evidence must hold a MOB's food-chain tally — the exact set
 * `meatWithdrawalForMob` reads: the mob itself (its own head-count doses), plus every
 * individually-registered animal standing in it on the disposal day AND every mob each of those has
 * stood in (a carried-in dose withholds the member, and the member is on the truck). Without the
 * members, a refused individual dose on one of them would not hold the flock's tally.
 *
 * ⭐ AND THE TRANSFER CHAIN, which is the third route and the one that was missing. Since §2.3b the
 * mob rule recurses into the SOURCE of every `transfer_in` (`latestArrivedWithhold`), because the
 * carried date is a floor and the source must be asked again live. This function did not, and its
 * own docstring claimed it read "the exact set". It was true when written and stopped being true
 * when the world widened — the sixth pass's root cause, found for a fourth time, one route along.
 *
 * What that cost, and it is the one shape in this file where meat actually reaches a truck rather
 * than a farmer being blocked: dip counted Flock A Monday, transfer 40 head A→B and slaughter 10 out
 * of B on a phone that has not recorded the dip yet. The dip is refused (4xx) and taints `A`; the
 * slaughter's subject set was `[B, …members]`, which does not contain `A`, so it was NOT held. It
 * posted, the server asked A live, A has no dose because the dose was set aside — 201 for meat
 * inside an active withholding.
 *
 * ⛔ Written as the SAME traversal `mobWithdrawal` runs, not a parallel one that agrees today. Two
 * computations of one food-safety boundary is exactly how §2h finding A happened, and this is the
 * second time the two have drifted.
 */
export function mobDisposalSubjects(
  mobId: string,
  disposalOn: string,
  animals: readonly StoredAnimal[],
  moves: readonly StoredMove[],
  /** ⛔ REQUIRED, no default — see `meatWithdrawalForMob`. An optional one narrowed this silently. */
  tallies: readonly ArrivedHead[],
): readonly string[] {
  const subjects = new Set<string>();
  collectMobSubjects(mobId, disposalOn, { animals, moves, tallies }, new Set(), subjects);
  return [...subjects];
}

/** Just the parts of the mob context the subject walk needs; doses and products decide no subject. */
interface SubjectContext {
  readonly animals: readonly StoredAnimal[];
  readonly moves: readonly StoredMove[];
  readonly tallies: readonly ArrivedHead[];
}

/**
 * One step of the same walk `mobWithdrawal` performs, accumulating subjects instead of dates.
 * `visited` terminates the A → B → A cycle exactly as it does there.
 */
function collectMobSubjects(
  mobId: string,
  disposalOn: string,
  ctx: SubjectContext,
  visited: ReadonlySet<string>,
  out: Set<string>,
): void {
  if (visited.has(mobId)) return;
  const seen = new Set(visited).add(mobId);
  out.add(mobId);

  for (const animal of ctx.animals) {
    const intervals = mobMembership(animal, ctx.moves);
    if (inMobOn(intervals, mobId, disposalOn)) {
      out.add(animal.id);
      for (const interval of intervals) out.add(interval.mobId);
    }
  }

  // Every mob that sent head in here on or before the day being judged — and recursively whatever
  // sent head to THEM. A purchase has no counterpart mob on this farm, so it contributes no subject.
  for (const tally of ctx.tallies) {
    if (tally.mobId !== mobId) continue;
    if (tally.reason !== 'transfer_in') continue;
    const arrivedOn = farmDay(new Date(tally.occurredAt));
    if (arrivedOn > disposalOn) continue;
    const source = tally.counterpartMobId;
    if (source === undefined) continue;
    collectMobSubjects(source, arrivedOn, ctx, seen, out);
  }
}

/**
 * The LATEST clear date across a set of doses wins: a subject dosed twice is held by whichever
 * withholding runs longest, and taking the most recent event instead would release it early
 * whenever the second product had a shorter period than the first.
 *
 * ⭐ A DOSE GIVEN AFTER THE DAY BEING JUDGED CANNOT WITHHOLD IT, and until this bound existed the
 * client said otherwise. `58fed1d` gave the SERVER exactly this rule (`onOrBefore`,
 * `livestock.service.ts`) and left both client readers standing on the unbounded version — the
 * read-path-fixed-write-path-standing class, and the two-mechanisms-one-boundary class at once.
 *
 * What it cost: sell five head on the 1st, write it up on the 20th, and a dip on the 10th made the
 * sale UNSAVEABLE on the device — `canSave` false, no way to record it, and "Died" one tap away and
 * never refused, which is precisely the workaround a guard must not teach. The server would have
 * accepted the very same capture. It also put false rows on the residue register, which reads
 * through here: a disposal that left before the needle was listed as inside a withholding.
 *
 * Safe in the direction that matters — head that left five days before a dose was drawn cannot be
 * carrying that residue, so nothing is released early. INCLUSIVE at the boundary, because
 * dipped-and-sold on one day is a real residue question and a food-safety boundary fails toward
 * blocking. Identical to the server's comparison, deliberately.
 */
function latestClearAcross(
  events: readonly StoredHealthEvent[],
  disposalOn: string,
  products: readonly StoredVetProduct[],
): WithdrawalStatus {
  const withdrawalDays = new Map(products.map((p) => [p.id, p.meatWithdrawalDays]));

  let latest: string | undefined;
  for (const event of events) {
    // The day bound, before anything else: this is not about which product it was.
    if (event.administeredOn > disposalOn) continue;
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
