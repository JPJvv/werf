/**
 * "Needs your attention" — the residue register (FR-131), as a farmer meets it. Renders the real
 * `<App/>` against a seeded `localStorage`, so everything is read back through the same boot path a
 * cold start uses.
 *
 * Two things are being proved here and they are not the same thing:
 *
 *  1. The field `withinWithdrawal` — written by the server for two releases and read by NOTHING —
 *     now reaches a screen. A flag no surface displays is a flag an auditor would need hand-written
 *     SQL to find, which is the same defect as a field nobody writes wearing the other hat.
 *  2. The cross-device race. One phone records Monday's dip; another, which has never heard of it,
 *     tallies to the abattoir on Tuesday. Nothing on either device could catch that, and no
 *     send-ordering can — only the server sees both. It must reach the farmer, and it must not read
 *     as an accusation, because they could not have known.
 */

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';
import { farmDay, farmToday } from '../farmTime';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const MOBS_KEY = `werf-mobs:${FARM_ID}`;
const TALLIES_KEY = `werf-tallies:${FARM_ID}`;
const HEALTH_KEY = `werf-health:${FARM_ID}`;
const PRODUCTS_KEY = `werf-vet-products:${FARM_ID}`;
const REGISTER_KEY = `werf-residue-register:${FARM_ID}`;
const MOB_ID = '0190f3a0-0000-7000-8000-00000000b001';
const MOB_B_ID = '0190f3a0-0000-7000-8000-00000000b002';
const PRODUCT_ID = '0190f3a0-0000-7000-8000-00000000d001';
const TALLY_ID = '0190f3a0-0000-7000-8000-00000000c001';

const FLOCK = { id: '0190f3a0-0000-7000-8000-00000000e002', name: 'Dorper flock', type: 'sheep' };

const SESSION_USER: schemas.AuthSession['user'] = {
  id: '0190f3a0-0000-7000-8000-000000000001',
  email: 'thabo@rietfontein.test',
  phone: null,
  fullName: 'Thabo Mokoena',
  locale: 'en-ZA',
  theme: 'light',
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

function cachedSession(): void {
  const payload = {
    accessToken: 'access-token',
    expiresIn: 900,
    refreshToken: 'refresh-token',
    refreshExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    user: SESSION_USER,
    farms: [
      {
        id: FARM_ID,
        name: 'Rietfontein',
        enterpriseTypes: ['sheep'],
        role: 'owner',
        enterprises: [FLOCK],
      },
    ],
    activeFarmId: FARM_ID,
    secondFactor: 'complete',
  };
  window.localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ payload, confirmedAt: new Date().toISOString() }),
  );
}

function seedFlock(): void {
  window.localStorage.setItem(
    MOBS_KEY,
    JSON.stringify([
      {
        id: MOB_ID,
        farmId: FARM_ID,
        name: 'Flock A',
        species: 'sheep',
        landUnitId: null,
        enterpriseId: FLOCK.id,
        headCount: 300,
      },
    ]),
  );
}

/** The flock dipped TODAY with a 28-day meat withdrawal, and the register that says so. */
function seedDip(): void {
  window.localStorage.setItem(
    PRODUCTS_KEY,
    JSON.stringify([
      {
        id: PRODUCT_ID,
        name: 'Tickaway',
        registrationNumber: 'G4321 Act 36/1947',
        species: ['sheep'],
        meatWithdrawalDays: 28,
        milkWithdrawalHours: null,
        route: 'topical',
      },
    ]),
  );
  window.localStorage.setItem(
    HEALTH_KEY,
    JSON.stringify([
      {
        id: '0190f3a0-0000-7000-8000-00000000f001',
        farmId: FARM_ID,
        animalId: null,
        mobId: MOB_ID,
        kind: 'dip',
        occurredAt: new Date().toISOString(),
        administeredOn: farmToday(),
        productId: PRODUCT_ID,
        method: 'plunge',
      },
    ]),
  );
}

/**
 * A tally already in the device's append-only log. Seeded directly, which is the honest shape of
 * the case: the farmer recorded the disposal first and the dip afterwards — both true captures, in
 * that order, on one phone in one afternoon. The at-capture guard judges what the device knew AT
 * THE TIME, so it had nothing to refuse.
 */
function seedTally(reason: string, count: number): void {
  window.localStorage.setItem(
    TALLIES_KEY,
    JSON.stringify([
      {
        id: TALLY_ID,
        farmId: FARM_ID,
        mobId: MOB_ID,
        occurredAt: new Date().toISOString(),
        reason,
        count,
        // The sign follows the reason, exactly as the domain derives it — a purchase adds head.
        delta: reason === 'purchase' || reason === 'birth' ? count : -count,
      },
    ]),
  );
}

/**
 * Two counted flocks, so head can be moved between them. A transfer needs somewhere to go, and a
 * flock with `headCount` and no `animals` rows is the shape the arrived-withholding route exists
 * for — it is the only one that can carry the fact.
 */
function seedTwoFlocks(): void {
  seedFlock();
  const flocks = JSON.parse(window.localStorage.getItem(MOBS_KEY) ?? '[]') as unknown[];
  window.localStorage.setItem(
    MOBS_KEY,
    JSON.stringify([
      ...flocks,
      {
        id: MOB_B_ID,
        farmId: FARM_ID,
        name: 'Flock B',
        species: 'sheep',
        landUnitId: null,
        enterpriseId: FLOCK.id,
        headCount: 120,
      },
    ]),
  );
}

/** A farm-local day `days` from today, for a clear date that is still running. */
function farmDayIn(days: number): string {
  return farmDay(new Date(Date.now() + days * 86_400_000));
}

/** Head arriving INTO Flock B, carrying whatever withholding came with it. */
function arrived(
  reason: 'transfer_in' | 'purchase',
  count: number,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: '0190f3a0-0000-7000-8000-00000000c010',
    farmId: FARM_ID,
    mobId: MOB_B_ID,
    occurredAt: new Date(Date.now() - 86_400_000).toISOString(),
    reason,
    count,
    delta: count,
    counterpartMobId: MOB_ID,
    ...extra,
  };
}

/** Head leaving a flock. `transfer_out` leaves Flock A; everything else leaves Flock B. */
function disposal(reason: string, count: number): Record<string, unknown> {
  const out = reason === 'transfer_out';
  return {
    id: TALLY_ID,
    farmId: FARM_ID,
    mobId: out ? MOB_ID : MOB_B_ID,
    occurredAt: new Date().toISOString(),
    reason,
    count,
    delta: -count,
    ...(out ? { counterpartMobId: MOB_B_ID } : {}),
  };
}

function seedTallies(rows: readonly Record<string, unknown>[]): void {
  window.localStorage.setItem(TALLIES_KEY, JSON.stringify(rows));
}

/** The server's own answer, as the last refresh left it in the cache. */
function seedServerRegister(flags: readonly Partial<schemas.ResidueFlagJson>[]): void {
  window.localStorage.setItem(
    REGISTER_KEY,
    JSON.stringify(
      flags.map((flag) => ({
        eventId: TALLY_ID,
        eventType: 'tally',
        animalId: null,
        mobId: MOB_ID,
        reason: 'slaughter',
        occurredAt: new Date().toISOString(),
        occurredOn: farmToday(),
        intoFoodChain: true,
        clearFrom: '2026-12-31',
        withinWithdrawal: true,
        knownAtCapture: false,
        ...flag,
      })),
    ),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  window.localStorage.clear();
});

describe('the residue register (FR-131)', () => {
  it('⭐ shows a disposal this phone captured before it recorded the dip, and says it is unsent', async () => {
    // The half the server cannot possibly know about: it has not been sent yet. Every other guard
    // in this app runs on the device for exactly this reason.
    cachedSession();
    seedFlock();
    seedDip();
    seedTally('slaughter', 40);
    window.history.pushState({}, '', '/attention');
    render(<App />);

    expect(await screen.findByRole('heading', { name: /needs your attention/i })).toBeTruthy();
    expect(screen.getByText(/slaughtered/i)).toBeTruthy();
    // The line that does the compliance work, and it is a sentence rather than a colour (NFR-411).
    expect(screen.getByText(/must not go into the food chain/i)).toBeTruthy();
    expect(screen.getByText(/not sent yet/i)).toBeTruthy();
  });

  it('⭐ stops saying "not sent yet" about a capture the server has confirmed', async () => {
    // §2m #5. Every locally-derived row said "Saved on this phone. Not sent yet." — including ones
    // the server had stored and simply not flagged, which it is entitled to do: it holds strictly
    // more of the log than this phone and may have judged the disposal clear. A false sentence on a
    // compliance screen is worse than a missing one, because an auditor reads it as a fact.
    cachedSession();
    seedFlock();
    seedDip();
    seedTally('slaughter', 40);
    // The sent-log the outbox writes when the server confirms it stored a capture.
    window.localStorage.setItem(`werf-sent:${FARM_ID}`, JSON.stringify([TALLY_ID]));
    window.history.pushState({}, '', '/attention');
    render(<App />);

    expect(await screen.findByRole('heading', { name: /needs your attention/i })).toBeTruthy();
    // Still on the register — the device's own flag is a fact and the row does not disappear.
    expect(screen.getByText(/must not go into the food chain/i)).toBeTruthy();
    expect(screen.queryByText(/not sent yet/i)).toBeNull();
    expect(screen.getByText(/this phone flagged it from the records it holds/i)).toBeTruthy();
  });

  it('⭐ stops warning about the food chain once the derivation says it was never withheld', async () => {
    // Found by `compliance-checker`. The server keeps a row whose STORED flag stands but whose live
    // re-derivation now says the disposal was outside any withholding — the longer dose behind it
    // was corrected away. `withinWithdrawal` and `knownAtCapture` are two facts for exactly this
    // reason, and this screen carried only the second. So the row rendered identically to a live
    // one, including "Meat from this must not go into the food chain."
    //
    // An auditor reading a screen that contradicts the system's own authoritative derivation is
    // worse off than with no screen at all. The row STAYS — the flag is a fact about the audit
    // trail — but the warning goes.
    cachedSession();
    seedFlock();
    seedServerRegister([{ withinWithdrawal: false, knownAtCapture: true }]);
    window.history.pushState({}, '', '/attention');
    render(<App />);

    expect(await screen.findByRole('heading', { name: /needs your attention/i })).toBeTruthy();
    expect(screen.queryByText(/must not go into the food chain/i)).toBeNull();
    expect(
      screen.getByText(/on the records we hold now, it was not inside a withdrawal/i),
    ).toBeTruthy();
  });

  it('⭐ says plainly that a late discovery could not have been caught on this phone', async () => {
    // The cross-device race. Device A recorded the dip; this device tallied to the abattoir having
    // never seen it. The row must not read as an accusation — nothing here could have known.
    cachedSession();
    seedFlock();
    seedServerRegister([{ knownAtCapture: false }]);
    window.history.pushState({}, '', '/attention');
    render(<App />);

    expect(await screen.findByText(/only found later/i)).toBeTruthy();
    expect(screen.getByText(/nothing on your phone could have known/i)).toBeTruthy();
    expect(screen.queryByText(/not sent yet/i)).toBeNull();
  });

  it('⭐ surfaces a flag the server stamped at capture — the field nothing used to read', async () => {
    // A death inside a withholding is recorded and flagged, never refused: refusing to record a
    // fact is worse than recording it, and a blocked "Slaughtered" sits one tap from an unblocked
    // "Died". Until this screen existed the flag went nowhere a farmer or an auditor could see.
    cachedSession();
    seedFlock();
    seedServerRegister([
      { reason: 'death', intoFoodChain: false, knownAtCapture: true, clearFrom: '2026-12-31' },
    ]);
    window.history.pushState({}, '', '/attention');
    render(<App />);

    expect(await screen.findByText(/you were told about this when you recorded it/i)).toBeTruthy();
    // A death is NOT a food-chain event, and the register must never blur the two.
    expect(screen.getByText(/did not go into the food chain/i)).toBeTruthy();
    expect(screen.queryByText(/must not go into the food chain/i)).toBeNull();
  });

  it('lets the server’s answer replace this device’s for the same event', async () => {
    // Both sources hold the same tally. The server has strictly more of the log — including the
    // dose from the other phone — so it is not a tie to break, it is a better answer replacing a
    // partial one. One event that happened is one row, not two.
    cachedSession();
    seedFlock();
    seedDip();
    seedTally('slaughter', 40);
    seedServerRegister([{ knownAtCapture: false }]);
    window.history.pushState({}, '', '/attention');
    render(<App />);

    expect(await screen.findByText(/only found later/i)).toBeTruthy();
    expect(screen.queryByText(/not sent yet/i)).toBeNull();
    expect(screen.getAllByText(/slaughtered/i)).toHaveLength(1);
  });

  it('says nothing needs attention when nothing does, and hides the link on home', async () => {
    // A permanent "Needs your attention" beside a zero teaches people it never means anything, and
    // then the one week it does they walk past it. Absent is the honest state.
    cachedSession();
    seedFlock();
    seedDip();
    // A THEFT tally would be on the register; a purchase adds head and raises no residue question
    // at all, so nothing should appear for it.
    seedTally('purchase', 12);
    const { unmount } = render(<App />);

    expect(screen.queryByRole('link', { name: /needs your attention/i })).toBeNull();

    unmount();
    window.history.pushState({}, '', '/attention');
    render(<App />);
    expect(await screen.findByText(/nothing needs your attention/i)).toBeTruthy();
  });

  it('puts the count on home only when the register has something on it', async () => {
    cachedSession();
    seedFlock();
    seedDip();
    seedTally('slaughter', 40);
    render(<App />);

    expect(await screen.findByRole('link', { name: /needs your attention/i })).toBeTruthy();
  });

  it('⭐ shows a disposal out of a flock whose withholding ARRIVED WITH THE HEAD', async () => {
    // The third way a withholding can exist (§2.3b): not given to this flock, but carried in on
    // head that walked through the gate. A counted flock has no `animals` rows, so nothing else on
    // this device can carry the fact — which makes this the ONLY route that can fire, and it is the
    // smallholder's flock. There is deliberately no health event anywhere in this fixture: if the
    // register can only see withholdings it can trace to a dose, it is blind to bought-in and
    // transferred-in residue entirely.
    cachedSession();
    seedTwoFlocks();
    seedTallies([
      arrived('transfer_in', 40, { carriedWithholdUntil: farmDayIn(20) }),
      disposal('slaughter', 10),
    ]);
    window.history.pushState({}, '', '/attention');
    render(<App />);

    expect(await screen.findByRole('heading', { name: /needs your attention/i })).toBeTruthy();
    expect(screen.getByText(/slaughtered/i)).toBeTruthy();
    expect(screen.getByText(/must not go into the food chain/i)).toBeTruthy();
  });

  it('⭐ never files a camp-to-camp transfer as a death', async () => {
    // Moving dipped head between two of your own camps is ordinary husbandry — it is the very thing
    // the sale-out/purchase-in workaround was being used to express, and the reason `transfer_out`
    // exists. It takes head out of a MOB, not out of the herd, so no residue question arises: the
    // withholding travels with it. Filing it here would fill the one screen whose value is that
    // every line is worth reading — and, falling through the label switch, would tell a farmer that
    // forty head DIED.
    cachedSession();
    seedTwoFlocks();
    seedDip();
    seedTallies([disposal('transfer_out', 40)]);
    window.history.pushState({}, '', '/attention');
    render(<App />);

    expect(await screen.findByText(/nothing needs your attention/i)).toBeTruthy();
    expect(screen.queryByText(/died/i)).toBeNull();
  });
});
