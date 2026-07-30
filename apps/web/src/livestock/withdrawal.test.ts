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
import { meatWithdrawalForMob } from './withdrawal';
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
      meatWithdrawalForMob(MOB_B, '2026-07-25', [doseOnX], [tickaway], [x], arrayOppositeToIdOrder)
        .blocked,
    ).toBe(false);
    // ...while mob C holds X, individually dosed and still inside its withdrawal.
    expect(
      meatWithdrawalForMob(MOB_C, '2026-07-25', [doseOnX], [tickaway], [x], arrayOppositeToIdOrder)
        .blocked,
    ).toBe(true);
  });

  it('does not block the dip camp for a dose given AFTER the ox left it', () => {
    // The other direction of the same reconstruction: membership is by day, so an animal that has
    // walked out is not held by a dose the mob received after it went, and one that never received
    // the dose is not blocked for it. Here the ox is no longer in the dip camp on the disposal day,
    // and no head-count dose reaches the dip camp itself, so the dip camp is clear.
    const status = meatWithdrawalForMob(
      DIP_CAMP,
      '2026-08-16',
      [
        {
          ...dipOnDipCamp,
          id: '0190f3a0-0000-7000-8000-00000000f002',
          mobId: OXEN,
          administeredOn: '2026-07-25',
          occurredAt: '2026-07-25T06:00:00.000Z',
        },
      ],
      [tickaway],
      [ox],
      [movedIntoOxen],
    );
    expect(status.blocked).toBe(false);
  });
});
