/**
 * The client meat-withdrawal guard (FR-131), at the seam where it has to AGREE with the server.
 *
 * The rule that matters is not "does this device compute a clear date" — it is "does the device
 * refuse exactly what the server refuses, at capture, offline". Every case here is a case where the
 * two once disagreed, and a disagreement is not a rounding error: it is a truck loaded on the
 * device's word and turned back days later on the server's.
 */

import { describe, expect, it } from 'vitest';
import { schemas } from '@werf/core';
import {
  animalDisposalSubjects,
  meatWithdrawalFor,
  meatWithdrawalForMob,
  mobDisposalSubjects,
} from './withdrawal';
import type { StoredAnimal } from './LocalHerd';
import type { StoredHealthEvent } from './LocalHealth';
import type { StoredMove } from './LocalMoves';
import type { StoredVetProduct } from './LocalVetProducts';

const FARM = '0190f3a0-0000-7000-8000-0000000000f1';
const DIP_CAMP = '0190f3a0-0000-7000-8000-00000000b001';
const OXEN = '0190f3a0-0000-7000-8000-00000000b002';
const OX = '0190f3a0-0000-7000-8000-00000000a001';
const PRODUCT = '0190f3a0-0000-7000-8000-00000000d001';

const tickaway: StoredVetProduct = {
  id: PRODUCT,
  name: 'Tickaway',
  registrationNumber: 'G4321 Act 36/1947',
  species: ['cattle'],
  meatWithdrawalDays: 28,
  milkWithdrawalHours: null,
  route: 'topical',
};

// As FIRST captured: in the dip camp. The append-only herd store never rewrites this, which is why
// `mobMembership` can trust it as the opening mob.
const ox: StoredAnimal = schemas.newAnimalSchema.parse({
  id: OX,
  farmId: FARM,
  species: 'cattle',
  sex: 'male',
  mobId: DIP_CAMP,
});

/** The dip camp plunge-dipped on the 20th — a MOB dose, `animalId = NULL`. */
const dipOnDipCamp: StoredHealthEvent = {
  id: '0190f3a0-0000-7000-8000-00000000f001',
  farmId: FARM,
  animalId: null,
  mobId: DIP_CAMP,
  kind: 'dip',
  occurredAt: '2026-07-20T06:00:00.000Z',
  administeredOn: '2026-07-20',
  productId: PRODUCT,
  batchId: null,
};

/** The ox walked from the dip camp into the ox mob on the 22nd. */
const movedIntoOxen: StoredMove = {
  id: '0190f3a0-0000-7000-8000-00000000c001',
  farmId: FARM,
  animalId: OX,
  occurredAt: '2026-07-22T06:00:00.000Z',
  toMobId: OXEN,
  batchId: null,
};

describe('a HYDRATED animal — mobId is the CURRENT position, not the opening one (compliance-checker finding, phase-checklists.md 3e)', () => {
  // `ox`/`movedIntoOxen` above are the LOCAL shape: `ox.mobId` is DIP_CAMP because a local animal
  // row is append-only and frozen at capture (the opening mob, honestly). A HYDRATED animal reads
  // `animals.mob_id` straight off the server, which is DENORMALISED to the animal's CURRENT
  // position — `livestock.service.ts`'s `recordMove` overwrites it on every move that lands as the
  // latest. Seeding `mobMembership`'s `openMob` from that field made the loop skip pushing the
  // animal's true opening interval outright — its first move's `toMobId` matched the wrongly-seeded
  // CURRENT mob — so a dose given to the animal's REAL opening mob became invisible: a false CLEAR.
  const hydratedOx: StoredAnimal = schemas.newAnimalSchema.parse({
    id: OX,
    farmId: FARM,
    species: 'cattle',
    sex: 'male',
    mobId: OXEN, // CURRENT, as the server denormalises it — NOT the dip camp it opened in.
  });
  // A HYDRATED move carries `fromMobId` — the wire's own record of where the animal actually was —
  // which a LOCAL move (`movedIntoOxen`, above) never has, because the app never sends it.
  const hydratedMovedIntoOxen: StoredMove = {
    ...movedIntoOxen,
    fromMobId: DIP_CAMP,
  };

  it('⭐ still finds a dose given to the TRUE opening mob, via the move’s own fromMobId', () => {
    const status = meatWithdrawalFor(
      hydratedOx,
      '2026-08-16',
      [dipOnDipCamp],
      [tickaway],
      [hydratedMovedIntoOxen],
    );
    expect(status.blocked).toBe(true);
    expect(status.clearFrom).toBe('2026-08-17');
  });

  it('the subject set the outbox holds on also reaches back to the true opening mob', () => {
    const subjects = animalDisposalSubjects(hydratedOx, [hydratedMovedIntoOxen]);
    expect([...subjects].sort()).toEqual([DIP_CAMP, OX, OXEN].sort());
  });

  it('without fromMobId (a genuinely local-only move), falls back to animal.mobId — unchanged behaviour', () => {
    // The regression guard: a LOCAL animal + a LOCAL move must still work exactly as before this
    // fix — `ox`/`movedIntoOxen` never carry a wrong "current" mobId, so falling back to
    // `animal.mobId` when no move supplies `fromMobId` is correct, not merely tolerated.
    const status = meatWithdrawalFor(ox, '2026-08-16', [dipOnDipCamp], [tickaway], [movedIntoOxen]);
    expect(status.blocked).toBe(true);
    expect(status.clearFrom).toBe('2026-08-17');
  });
});

describe('meatWithdrawalForMob — agreeing with the server', () => {
  it('⭐ blocks the ox mob for a dose the ox carried IN from another mob', () => {
    // Mirrors livestock.integration.test.ts:2326. The dip names the dip camp, not the ox mob, and
    // the ox was never dosed individually — so the old guard, which returned false for every mob
    // dose belonging to another mob, previewed the ox mob CLEAR. The server refused it. Dip runs to
    // 2026-08-17 (20 July + 28 days), so a slaughter tally on 2026-08-16 is inside the withholding.
    const status = meatWithdrawalForMob(
      OXEN,
      '2026-08-16',
      [dipOnDipCamp],
      [tickaway],
      [ox],
      [movedIntoOxen],
      [],
    );
    expect(status.blocked).toBe(true);
    expect(status.clearFrom).toBe('2026-08-17');
  });

  it('clears the same ox mob the day the carried-in withholding runs out', () => {
    // The bound: the guard must release, not refuse everything forever.
    const status = meatWithdrawalForMob(
      OXEN,
      '2026-08-17',
      [dipOnDipCamp],
      [tickaway],
      [ox],
      [movedIntoOxen],
      [],
    );
    expect(status.blocked).toBe(false);
  });

  it('⭐ resolves two same-day moves by (occurredAt, id), matching the server, not array order', () => {
    // §2f MED. Day-grained moves tie on the instant by construction. The server orders
    // (occurredAt, id); the client sorted on occurredAt alone, so a stable sort left the
    // last-move-wins outcome to capture-store append order. Ox X is walked twice on ONE day — the
    // move with the LARGER id is the later one, so X ends where THAT move points. The array below is
    // deliberately in the OPPOSITE order, which is what the old sort would have honoured.
    const MOB_B = '0190f3a0-0000-7000-8000-00000000b010';
    const MOB_C = '0190f3a0-0000-7000-8000-00000000b011';
    const x = schemas.newAnimalSchema.parse({
      id: '0190f3a0-0000-7000-8000-00000000a020',
      farmId: FARM,
      species: 'cattle',
      sex: 'male',
      mobId: null,
    });
    const toB: StoredMove = {
      id: '0190f3a0-0000-7000-8000-00000000c001', // smaller id → earlier
      farmId: FARM,
      animalId: x.id,
      occurredAt: '2026-07-22T12:00:00.000Z',
      toMobId: MOB_B,
      batchId: null,
    };
    const toC: StoredMove = {
      id: '0190f3a0-0000-7000-8000-00000000c002', // larger id → LATER, so X's true final mob is C
      farmId: FARM,
      animalId: x.id,
      occurredAt: '2026-07-22T12:00:00.000Z',
      toMobId: MOB_C,
      batchId: null,
    };
    const doseOnX: StoredHealthEvent = {
      id: '0190f3a0-0000-7000-8000-00000000f010',
      farmId: FARM,
      animalId: x.id,
      mobId: null,
      kind: 'treatment',
      occurredAt: '2026-07-24T06:00:00.000Z',
      administeredOn: '2026-07-24',
      productId: PRODUCT,
      batchId: null,
    };
    const arrayOppositeToIdOrder = [toC, toB];

    // X's true final mob is C, so mob B holds no member and is clear...
    expect(
      meatWithdrawalForMob(
        MOB_B,
        '2026-07-25',
        [doseOnX],
        [tickaway],
        [x],
        arrayOppositeToIdOrder,
        [],
      ).blocked,
    ).toBe(false);
    // ...while mob C holds X, individually dosed and still inside its withdrawal.
    expect(
      meatWithdrawalForMob(
        MOB_C,
        '2026-07-25',
        [doseOnX],
        [tickaway],
        [x],
        arrayOppositeToIdOrder,
        [],
      ).blocked,
    ).toBe(true);
  });

  it('does not block the dip camp for a dose given AFTER the ox left it', () => {
    // The other direction of the same reconstruction: membership is by day, so an animal that has
    // walked out is not held by a dose the mob received after it went, and one that never received
    // the dose is not blocked for it. Here the ox is no longer in the dip camp on the disposal day,
    // and no head-count dose reaches the dip camp itself, so the dip camp is clear.
    const doseOnOxenAfterMove: StoredHealthEvent = {
      ...dipOnDipCamp,
      id: '0190f3a0-0000-7000-8000-00000000f002',
      mobId: OXEN,
      administeredOn: '2026-07-25',
      occurredAt: '2026-07-25T06:00:00.000Z',
    };
    const status = meatWithdrawalForMob(
      DIP_CAMP,
      '2026-08-16',
      [doseOnOxenAfterMove],
      [tickaway],
      [ox],
      [movedIntoOxen],
      [],
    );
    expect(status.blocked).toBe(false);
  });
});

describe('a carried withholding is a floor, not a ceiling', () => {
  // The counted-flock path, and the one no other route can cover: no `animals` rows exist, so the
  // only thing that can withhold the joined flock is the fact the head arrived withheld.
  const transferredIn = {
    mobId: OXEN,
    occurredAt: '2026-07-22T12:00:00.000Z',
    reason: 'transfer_in',
    counterpartMobId: DIP_CAMP,
    // Captured on a phone that had never seen the dip, so it carried NOTHING. This is the ordinary
    // case, not a corrupted one: the other phone held the dip and had not reconnected yet.
    carriedWithholdUntil: undefined,
  };

  it('⭐ blocks the joined flock when the dip on the SOURCE landed after the transfer', () => {
    // The device must reach the same answer the server does. If it reads only the frozen preview,
    // the capture screen says CLEAR, the farmer loads the truck, and the refusal arrives days later
    // — which is the whole reason this guard runs on the device at all.
    const status = meatWithdrawalForMob(
      OXEN,
      '2026-08-01',
      [dipOnDipCamp],
      [tickaway],
      [],
      [],
      [transferredIn],
    );
    expect(status.blocked).toBe(true);
    expect(status.clearFrom).toBe('2026-08-17');
  });

  it('releases the joined flock once the source’s withholding has run out', () => {
    // The bound in the other direction: a guard that never releases teaches the workaround.
    const status = meatWithdrawalForMob(
      OXEN,
      '2026-08-17',
      [dipOnDipCamp],
      [tickaway],
      [],
      [],
      [transferredIn],
    );
    expect(status.blocked).toBe(false);
  });

  it('terminates on an A → B → A transfer chain', () => {
    // Two camps and a fortnight makes a cycle. A hang here is a frozen capture screen in a crush.
    const backAgain = {
      mobId: DIP_CAMP,
      occurredAt: '2026-07-24T12:00:00.000Z',
      reason: 'transfer_in',
      counterpartMobId: OXEN,
      carriedWithholdUntil: undefined,
    };
    const status = meatWithdrawalForMob(
      DIP_CAMP,
      '2026-08-01',
      [dipOnDipCamp],
      [tickaway],
      [],
      [],
      [transferredIn, backAgain],
    );
    expect(status.blocked).toBe(true);
  });
});

describe('a dose given AFTER the day being judged — the bound the server has', () => {
  it('⭐ does not judge a disposal against a dose given after it, exactly as the server does not', () => {
    // Mirrors livestock.integration.test.ts:2579. `58fed1d` gave the SERVER this bound and left both
    // client readers unbounded, so the device refused a capture the server would have accepted:
    // sell on the 15th, write it up later, and the dip on the 20th made the sale UNSAVEABLE — with
    // "Died" one tap away and never refused, which is the workaround a guard must not teach.
    const status = meatWithdrawalForMob(
      DIP_CAMP,
      '2026-07-15', // the sale happened five days BEFORE the dip
      [dipOnDipCamp], // administered 2026-07-20
      [tickaway],
      [],
      [],
      [],
    );

    expect(status.blocked).toBe(false);
    // And it claims no clear date either: head that left before the needle carry nothing from it.
    expect(status.clearFrom).toBeNull();
  });

  it('still blocks on the day the dose was given — the boundary is INCLUSIVE', () => {
    // Dipped-and-sold on one day is a real residue question, and a food-safety boundary fails
    // toward blocking. This is the case the bound must NOT swallow.
    const status = meatWithdrawalForMob(
      DIP_CAMP,
      '2026-07-20',
      [dipOnDipCamp],
      [tickaway],
      [],
      [],
      [],
    );

    expect(status.blocked).toBe(true);
    expect(status.clearFrom).toBe('2026-08-17');
  });
});

describe('a day the guard cannot read — the boundary fails toward BLOCKING', () => {
  // The eighth pass closed a false PASS here: with `disposalOn = ''`, `administeredOn > ''` is true
  // for every dose, so every one was skipped and an animal deep inside a withholding read CLEAR.
  // The ninth pass found the fix sat inside `latestClearAcross`, whose own caller RECOMPUTES
  // `blocked` when an arrival is present and discards it. `''` survived only by coincidence —
  // `latestArrivedWithhold` also skips everything on an empty day, so the recomputing branch was
  // never taken. A malformed day that sorts HIGH takes it, and came back CLEAR.
  //
  // Neither case had a test on the mob arm. That is why the guard could move and nobody would know.
  const arrivedWithheld = {
    mobId: OXEN,
    occurredAt: '2026-07-22T12:00:00.000Z',
    reason: 'transfer_in',
    counterpartMobId: DIP_CAMP,
    carriedWithholdUntil: undefined,
  };

  it('blocks on an EMPTY day — a cleared date input is an ordinary state, not a defect', () => {
    const status = meatWithdrawalForMob(OXEN, '', [dipOnDipCamp], [tickaway], [], [], []);

    expect(status.blocked).toBe(true);
    // No date to show: the screen that asked for the day is the one that must ask again.
    expect(status.clearFrom).toBeNull();
  });

  it('⭐ blocks on a MALFORMED day even when an arrival is present — the branch that discarded it', () => {
    // `'2026-7-5'` sorts ABOVE '2026-07-22', so `latestArrivedWithhold` does NOT skip the arrival,
    // `arrived` is non-null, and the old placement recomputed `blocked` from a string comparison
    // that says '2026-7-5' < '2026-08-17' is false. CLEAR, for a flock inside a live withholding.
    const status = meatWithdrawalForMob(
      OXEN,
      '2026-7-5',
      [dipOnDipCamp],
      [tickaway],
      [],
      [],
      [arrivedWithheld],
    );

    expect(status.blocked).toBe(true);
    expect(status.clearFrom).toBeNull();
  });

  it('does NOT block a well-formed day — the bound, so the guard cannot just always refuse', () => {
    // A guard that refuses everything is not a guard, and this is the direction a fail-closed rule
    // breaks in. Every day a native date input can emit is `YYYY-MM-DD` and must still be judged.
    const status = meatWithdrawalForMob(OXEN, '2026-09-01', [dipOnDipCamp], [tickaway], [], [], []);

    expect(status.blocked).toBe(false);
  });
});

describe('disposal subject sets — what the outbox must hold on', () => {
  it('⭐ an animal disposal is held by its OWN id and EVERY mob it has stood in, not just the current one', () => {
    // The fifth-pass finding (all three agents): the flush held a sale only by the animal's current
    // mob, so a refused dose on a mob it walked OUT of did not hold the sale. The subject set must be
    // the whole history — here the ox began in the dip camp and moved to the ox mob, so a refused dip
    // on the dip camp (subject = dip camp) must still intersect and hold the sale.
    const subjects = animalDisposalSubjects(ox, [movedIntoOxen]);
    expect(subjects).toContain(OX); // its own doses
    expect(subjects).toContain(DIP_CAMP); // a mob it has LEFT still withholds it
    expect(subjects).toContain(OXEN); // and the mob it is in now
  });

  it('⭐ a mob disposal is held by every member standing in it AND their mob histories, not just the mob', () => {
    // The mirror gap: a tally held only by `[mobId]` missed an individual dose on a registered member
    // and a dose that member carried in from another mob. The ox stands in the ox mob on the disposal
    // day, so the ox mob's held set must include the ox and the dip camp it came from.
    const subjects = mobDisposalSubjects(OXEN, '2026-08-16', [ox], [movedIntoOxen], []);
    expect(subjects).toContain(OXEN); // the mob's own head-count doses
    expect(subjects).toContain(OX); // an individual member's own doses
    expect(subjects).toContain(DIP_CAMP); // a withholding the member carried in
  });

  it('⭐ a mob disposal is held by the SOURCE of a transfer into it, and so on up the chain', () => {
    // The route `mobDisposalSubjects` could not see, found by `compliance-checker`. Since §2.3b the
    // mob guard RECURSES into the source of every `transfer_in` (the carried date is a floor, so the
    // source is asked again live). The subject set did not, while its own docstring claimed it read
    // "the exact set" — true when written, false once the world widened.
    //
    // What it cost, and it is the one shape here where meat reaches a truck rather than a farmer
    // being blocked: dip the dip camp Monday; transfer head dip camp → oxen and slaughter out of the
    // oxen on a phone that has not recorded the dip yet. The dip is refused and taints DIP_CAMP; the
    // slaughter's set was [OXEN, ...members] and did not contain DIP_CAMP, so it was NOT held. It
    // posted, the server asked the dip camp live, the dose was set aside — 201 for dipped meat.
    const arrival = {
      mobId: OXEN,
      occurredAt: '2026-07-22T12:00:00.000Z',
      reason: 'transfer_in',
      counterpartMobId: DIP_CAMP,
    };

    const subjects = mobDisposalSubjects(OXEN, '2026-08-16', [], [], [arrival]);

    expect(subjects).toContain(OXEN);
    // The source the guard walks into. Without this the refused dose on it holds nothing.
    expect(subjects).toContain(DIP_CAMP);
  });

  it('terminates on a transfer cycle rather than walking A → B → A forever', () => {
    // Head really does go back and forth in a fortnight. `mobWithdrawal` guards this with `visited`;
    // the subject walk has to as well, or the flush hangs building its queue.
    const there = {
      mobId: OXEN,
      occurredAt: '2026-07-22T12:00:00.000Z',
      reason: 'transfer_in',
      counterpartMobId: DIP_CAMP,
    };
    const back = {
      mobId: DIP_CAMP,
      occurredAt: '2026-07-24T12:00:00.000Z',
      reason: 'transfer_in',
      counterpartMobId: OXEN,
    };

    const subjects = mobDisposalSubjects(OXEN, '2026-08-16', [], [], [there, back]);

    expect([...subjects].sort()).toEqual([DIP_CAMP, OXEN].sort());
  });

  it('does not hold a mob for a member that is no longer standing in it on the disposal day', () => {
    // The bound: membership is by day. If the ox has left the ox mob before the disposal day it is
    // not on that truck, so its subjects do not hold the ox mob's tally.
    const leftOxen: StoredMove = {
      id: '0190f3a0-0000-7000-8000-00000000c050',
      farmId: FARM,
      animalId: OX,
      occurredAt: '2026-07-30T06:00:00.000Z',
      toMobId: '0190f3a0-0000-7000-8000-00000000b099',
      batchId: null,
    };
    const subjects = mobDisposalSubjects(OXEN, '2026-08-16', [ox], [movedIntoOxen, leftOxen], []);
    expect(subjects).toEqual([OXEN]);
  });
});

describe('a HYDRATED dose — no productId, an already-resolved meatWithholdUntil', () => {
  // The animals/moves/health hydration slice (phase-checklists.md 3e, extended past mobs/tallies).
  // The wire payload for a treatment/vaccination/dip event never carries `productId` — only
  // `product` (a NAME string) and the server-computed `meatWithholdUntil` (see withdrawal.ts's
  // module header). A dose read back through `HydratedLivestock` therefore satisfies `WithholdDose`
  // via `meatWithholdUntil`, not `productId` — this proves `meatWithdrawalForMob` reads that field
  // directly and does NOT need the local product register at all to honour it, unlike a LOCAL
  // capture's preview. Fails against the pre-widening code: `StoredHealthEvent`-only typing forced
  // every hydrated dose through a `productId` lookup that could never resolve (the field does not
  // exist on the wire), silently dropping the dose from the fold — a false CLEAR.
  it('⭐ blocks a mob for a hydrated dose carrying meatWithholdUntil, with NO matching product in the local register', () => {
    const hydratedDip = {
      id: '0190f3a0-0000-7000-8000-00000000f099',
      animalId: null,
      mobId: DIP_CAMP,
      administeredOn: '2026-07-20',
      meatWithholdUntil: '2026-08-17',
      // Deliberately no `productId` — the field a hydrated dose can never honestly carry.
    };
    const status = meatWithdrawalForMob(
      DIP_CAMP,
      '2026-08-16',
      [hydratedDip],
      // The local product register is EMPTY — proving the guard does not need it once the dose
      // already carries the server's own resolved date.
      [],
      [],
      [],
      [],
    );
    expect(status.blocked).toBe(true);
    expect(status.clearFrom).toBe('2026-08-17');
  });

  it('clears the mob the day the hydrated withholding runs out, same as a local one', () => {
    const hydratedDip = {
      id: '0190f3a0-0000-7000-8000-00000000f098',
      animalId: null,
      mobId: DIP_CAMP,
      administeredOn: '2026-07-20',
      meatWithholdUntil: '2026-08-17',
    };
    const status = meatWithdrawalForMob(DIP_CAMP, '2026-08-17', [hydratedDip], [], [], [], []);
    expect(status.blocked).toBe(false);
  });

  it('a dose with neither productId nor meatWithholdUntil contributes nothing, honestly', () => {
    // Neither shape — a malformed or genuinely unresolved row. The fold must not guess, exactly as
    // a local dose against an unknown product contributes nothing (the existing rule this mirrors).
    const bareDip = {
      id: '0190f3a0-0000-7000-8000-00000000f097',
      animalId: null,
      mobId: DIP_CAMP,
      administeredOn: '2026-07-20',
    };
    const status = meatWithdrawalForMob(DIP_CAMP, '2026-08-16', [bareDip], [], [], [], []);
    expect(status.blocked).toBe(false);
    expect(status.clearFrom).toBeNull();
  });
});
