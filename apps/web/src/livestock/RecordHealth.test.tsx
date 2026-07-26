/**
 * Recording a treatment as a farmer does it (FR-130/131) — COMPLIANCE-GATED. Renders the real
 * `<App/>` against a seeded `localStorage`, including a seeded product register, so the whole thing
 * runs with no network at all.
 *
 * Three assertions carry the compliance design:
 *  • The CLEAR DATE is on screen before the farmer leaves the crush. "When can I sell this animal?"
 *    answered three weeks later is answered too late.
 *  • The stored capture carries a `productId` and NO withdrawal period. The number is regulated;
 *    the server resolves it from the registration in force on the treatment day (ADR-0005), and a
 *    client that could send it could claim a shorter withhold by relabelling.
 *  • A dosing run is one action: one batch id across every animal, one event each.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7, type schemas } from '@werf/core';
import { App } from '../App';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const HERD_KEY = `werf-herd:${FARM_ID}`;
const HEALTH_KEY = `werf-health:${FARM_ID}`;
const PRODUCTS_KEY = `werf-vet-products:${FARM_ID}`;
const PRODUCT_ID = '0190f3a0-0000-7000-8000-00000000d001';

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
        enterpriseTypes: ['beef_cattle'],
        role: 'owner',
        enterprises: [],
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

/** The register, already on the device — which is the state a crush is actually in. */
function seedProducts(meatWithdrawalDays: number | null): void {
  window.localStorage.setItem(
    PRODUCTS_KEY,
    JSON.stringify([
      {
        id: PRODUCT_ID,
        name: 'Terramycin LA',
        registrationNumber: 'G1234 Act 36/1947',
        species: ['cattle'],
        meatWithdrawalDays,
        milkWithdrawalHours: 96,
        route: 'intramuscular',
      },
    ]),
  );
}

function seedHerd(count: number): string[] {
  const ids = Array.from({ length: count }, () => uuidv7());
  window.localStorage.setItem(
    HERD_KEY,
    JSON.stringify(
      ids.map((id) => ({
        id,
        farmId: FARM_ID,
        enterpriseId: null,
        species: 'cattle',
        breed: null,
        sex: 'female',
        dob: null,
        dobEstimated: false,
        status: 'alive',
        statusAt: null,
        damId: null,
        sireId: null,
        mobId: null,
        landUnitId: null,
        source: null,
        acquiredAt: null,
        brandId: null,
        brandAppliedAt: null,
        attributes: {},
        photoKey: null,
      })),
    ),
  );
  return ids;
}

function storedHealth(): Array<Record<string, unknown>> {
  return JSON.parse(window.localStorage.getItem(HEALTH_KEY) ?? '[]') as Array<
    Record<string, unknown>
  >;
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  window.localStorage.clear();
});

describe('recording a treatment (FR-130/131)', () => {
  it('tells the farmer when the animals may be sold, before they leave the crush', async () => {
    cachedSession();
    seedProducts(28);
    seedHerd(1);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/health');
    render(<App />);

    await user.selectOptions(screen.getByLabelText(/which product/i), PRODUCT_ID);

    // 28 days from today, computed through the same pure domain function the server uses.
    const clear = new Date(Date.now() + 28 * 86_400_000).toISOString().slice(0, 10);
    expect(screen.getByText(/may be sold for slaughter from/i)).toBeTruthy();
    expect(screen.getByText(clear)).toBeTruthy();
  });

  it('records the day the dose was GIVEN, not the day it was captured', async () => {
    // The normal case for a farm in a dead zone: dosed on Tuesday, back in signal on Friday. The
    // withdrawal clock and the treatment register both have to run from Tuesday. Stamping the
    // capture date instead turns the server's dated registration lookup (ADR-0005) back into a
    // `now()` lookup, and the register a residue traceback reads is dated wrong.
    cachedSession();
    seedProducts(28);
    seedHerd(1);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/health');
    render(<App />);

    const threeDaysBack = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    const dayField = screen.getByLabelText(/when was it given/i);
    await user.clear(dayField);
    await user.type(dayField, threeDaysBack);
    await user.selectOptions(screen.getByLabelText(/which product/i), PRODUCT_ID);

    // The clear date moves with it — 28 days from the TREATMENT day, not from today.
    const clear = new Date(Date.parse(`${threeDaysBack}T12:00:00.000Z`) + 28 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(screen.getByText(clear)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /select all shown/i }));
    await user.click(screen.getByRole('button', { name: /record it/i }));

    const [saved] = storedHealth();
    expect(saved!.administeredOn).toBe(threeDaysBack);
    // And the two clocks stay distinct: `occurredAt` is the treatment, not the capture.
    expect(String(saved!.occurredAt).slice(0, 10)).toBe(threeDaysBack);
  });

  it('says so when a product carries no meat withholding, rather than staying silent', async () => {
    // "No withholding" is an answer a farmer needs just as much as a date — silence reads as
    // "the app does not know", which is what sends someone back to a paper book.
    cachedSession();
    seedProducts(null);
    seedHerd(1);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/health');
    render(<App />);

    await user.selectOptions(screen.getByLabelText(/which product/i), PRODUCT_ID);
    expect(screen.getByText(/no meat withholding period/i)).toBeTruthy();
  });

  it('doses a whole group in one action, and stores a product id but never a withdrawal', async () => {
    cachedSession();
    seedProducts(28);
    seedHerd(3);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/health');
    render(<App />);

    await user.click(screen.getByRole('button', { name: /select all shown/i }));
    await user.selectOptions(screen.getByLabelText(/which product/i), PRODUCT_ID);
    await user.type(screen.getByLabelText(/who gave it/i), 'Thabo');
    await user.click(screen.getByRole('button', { name: /record it/i }));

    const saved = storedHealth();
    expect(saved).toHaveLength(3);
    // One action: one batch id, three events.
    expect(new Set(saved.map((e) => e['batchId'])).size).toBe(1);
    expect(new Set(saved.map((e) => e['id'])).size).toBe(3);

    for (const event of saved) {
      expect(event).toMatchObject({ kind: 'treatment', productId: PRODUCT_ID });
      // ⭐ The regulated number is NOT here. It is resolved server-side from the registration in
      // force on the treatment day; a client that stored one would freeze a cached figure into a
      // record that outlives it.
      expect(event).not.toHaveProperty('meatWithdrawalDays');
      expect(event).not.toHaveProperty('meatWithholdUntil');
      // The treatment DAY is stored, because the withdrawal arithmetic is based on it.
      expect(String(event['administeredOn'])).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('records the dose and the route a residue traceback needs (FR-130)', async () => {
    // "20" is not a dose and a dose is not a treatment record without a route. Neither is
    // inferable later, and nobody comes back to fill them in.
    cachedSession();
    seedProducts(28);
    seedHerd(1);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/health');
    render(<App />);

    await user.click(screen.getByRole('button', { name: /select all shown/i }));
    await user.selectOptions(screen.getByLabelText(/which product/i), PRODUCT_ID);
    await user.type(screen.getByLabelText(/^dose/i), '20');
    await user.type(screen.getByLabelText(/^unit/i), 'ml');
    await user.selectOptions(screen.getByLabelText(/how it was given/i), 'injection_im');
    await user.click(screen.getByRole('button', { name: /record it/i }));

    expect(storedHealth()[0]).toMatchObject({
      kind: 'treatment',
      doseValue: 20,
      doseUnit: 'ml',
      route: 'injection_im',
    });
  });

  it('will not silently drop a dose that was typed but is not a number', async () => {
    cachedSession();
    seedProducts(28);
    seedHerd(1);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/health');
    render(<App />);

    await user.click(screen.getByRole('button', { name: /select all shown/i }));
    await user.selectOptions(screen.getByLabelText(/which product/i), PRODUCT_ID);
    await user.type(screen.getByLabelText(/^dose/i), 'two');

    expect(screen.getByRole('button', { name: /record it/i }).hasAttribute('disabled')).toBe(true);
    expect(storedHealth()).toHaveLength(0);
  });

  it('records how a dip was applied (FR-133), and offers only methods the register accepts', async () => {
    // A plunge dip and a pour-on are different operations with different coverage, and the
    // dipping register in a controlled area has to say which (Animal Diseases Act 35 of 1984).
    cachedSession();
    seedProducts(28);
    seedHerd(1);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/health');
    render(<App />);

    await user.click(screen.getByRole('button', { name: /^dip$/i }));
    await user.click(screen.getByRole('button', { name: /select all shown/i }));
    await user.selectOptions(screen.getByLabelText(/which product/i), PRODUCT_ID);

    const methods = screen.getByLabelText(/how it was applied/i);
    // The choices come FROM the dip payload schema. The hand-written union this replaced offered
    // "injectable", which the server refuses — a capture that could never have been sent.
    expect([...methods.querySelectorAll('option')].map((o) => o.getAttribute('value'))).toEqual([
      '',
      'plunge',
      'spray',
      'pour_on',
      'hand',
    ]);

    await user.selectOptions(methods, 'plunge');
    await user.click(screen.getByRole('button', { name: /record it/i }));

    expect(storedHealth()[0]).toMatchObject({ kind: 'dip', method: 'plunge' });
  });

  it('does not ask for a dose on a vaccination or a dip, whose payloads carry none', async () => {
    cachedSession();
    seedProducts(28);
    seedHerd(1);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/health');
    render(<App />);

    await user.click(screen.getByRole('button', { name: /^vaccination$/i }));
    expect(screen.queryByLabelText(/^dose/i)).toBeNull();
    expect(screen.queryByLabelText(/how it was given/i)).toBeNull();
  });

  it('will not record without a product or without animals', async () => {
    cachedSession();
    seedProducts(28);
    seedHerd(1);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/health');
    render(<App />);

    expect(screen.getByRole('button', { name: /record it/i }).hasAttribute('disabled')).toBe(true);

    await user.selectOptions(screen.getByLabelText(/which product/i), PRODUCT_ID);
    // A product but no animals selected is still not a dosing run.
    expect(screen.getByRole('button', { name: /record it/i }).hasAttribute('disabled')).toBe(true);
    expect(storedHealth()).toHaveLength(0);
  });

  it('says what to do when the register has not reached this phone yet', () => {
    // Not the farmer's fault and not an error — an empty picker with no explanation is what makes
    // someone give up on the app in a crush.
    cachedSession();
    seedHerd(1);
    window.history.pushState({}, '', '/animals/health');
    render(<App />);

    expect(screen.getByText(/has not reached this phone yet/i)).toBeTruthy();
  });
});

describe('the withdrawal guard on a sale (FR-131)', () => {
  /** A treatment already on the device, `daysAgo` days back. */
  function seedTreatment(animalId: string, daysAgo: number): void {
    const administeredOn = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
    window.localStorage.setItem(
      HEALTH_KEY,
      JSON.stringify([
        {
          id: uuidv7(),
          farmId: FARM_ID,
          animalId,
          kind: 'treatment',
          occurredAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
          administeredOn,
          productId: PRODUCT_ID,
          batchId: null,
        },
      ]),
    );
  }

  it('refuses the sale of a treated animal, and says when it may be sold', async () => {
    // Without this the capture commits offline, the flush is refused forever, and the queue jams
    // with nothing on the phone explaining why — days after the truck has gone.
    cachedSession();
    seedProducts(28);
    const [animalId] = seedHerd(1);
    seedTreatment(animalId!, 3);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    await user.click(screen.getAllByRole('button', { name: /cattle/i })[0]!);
    await user.click(screen.getByRole('button', { name: /^sold$/i }));

    // It says no AND says when: a refusal with no way forward is what makes someone stop
    // recording treatments at all.
    expect(screen.getByText(/cannot be sold for slaughter yet/i)).toBeTruthy();
    const clear = new Date(Date.now() + 25 * 86_400_000).toISOString().slice(0, 10);
    expect(screen.getByText(clear)).toBeTruthy();

    await user.type(screen.getByLabelText(/buyer/i), 'Bloem Abattoir');
    await user.type(screen.getByLabelText(/price/i), '18450');
    expect(screen.getByRole('button', { name: /record sale/i }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('lets a cleared animal be sold, and never blocks a death', async () => {
    cachedSession();
    seedProducts(28);
    const [animalId] = seedHerd(1);
    // Treated well outside the withholding.
    seedTreatment(animalId!, 40);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    await user.click(screen.getAllByRole('button', { name: /cattle/i })[0]!);
    await user.click(screen.getByRole('button', { name: /^sold$/i }));

    expect(screen.queryByText(/cannot be sold for slaughter yet/i)).toBeNull();
    await user.type(screen.getByLabelText(/buyer/i), 'Bloem Abattoir');
    await user.type(screen.getByLabelText(/price/i), '18450');
    expect(screen.getByRole('button', { name: /record sale/i }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('never withholds a DEATH — an animal that dies inside a withdrawal still died', async () => {
    // The rule is about meat entering the food chain, not about recording what happened. Blocking
    // a death capture would lose the record entirely.
    cachedSession();
    seedProducts(28);
    const [animalId] = seedHerd(1);
    seedTreatment(animalId!, 3);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/loss');
    render(<App />);

    await user.click(screen.getAllByRole('button', { name: /cattle/i })[0]!);
    await user.click(screen.getByRole('button', { name: /^died$/i }));
    await user.type(screen.getByLabelText(/cause/i), 'Snakebite');

    expect(screen.getByRole('button', { name: /record death/i }).hasAttribute('disabled')).toBe(
      false,
    );
  });
});
