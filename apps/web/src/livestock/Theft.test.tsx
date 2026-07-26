/**
 * Filing a stock-theft incident and getting the evidence pack (FR-603/605) — COMPLIANCE-GATED
 * (legal-compliance.md § 3.2). These assert what a FARMER and an AUDITOR would observe, never the
 * implementation: that an incident files with no signal at a cut fence, that the pack is offered
 * only when it can actually be produced, and that no name of a suspect can enter the record by any
 * path the screen offers.
 *
 * Like the other capture journeys these seed `localStorage` and render the real `<App/>`. The one
 * test that does touch the network stubs `fetch` — because the pack is the one action in livestock
 * that genuinely needs it, and the point of the test is that the screen says so honestly.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7, type schemas } from '@werf/core';
import { App } from '../App';

const SESSION_KEY = 'werf-session';
const FARM_ID = '0190f3a0-0000-7000-8000-0000000000f1';
const HERD_KEY = `werf-herd:${FARM_ID}`;
const THEFT_KEY = `werf-theft:${FARM_ID}`;
const SENT_KEY = `werf-sent:${FARM_ID}`;
const IDENTIFIERS_KEY = `werf-identifiers:${FARM_ID}`;

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
    farms: [{ id: FARM_ID, name: 'Rietfontein', enterpriseTypes: ['beef_cattle'], role: 'owner' }],
    activeFarmId: FARM_ID,
    secondFactor: 'complete',
  };
  window.localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ payload, confirmedAt: new Date().toISOString() }),
  );
}

function seedHerd(...animals: Array<Record<string, unknown>>): void {
  window.localStorage.setItem(HERD_KEY, JSON.stringify(animals));
}

function animal(id: string): Record<string, unknown> {
  return { id, farmId: FARM_ID, species: 'cattle', sex: 'female', breed: null, status: 'alive' };
}

function seedIncident(extra: Record<string, unknown> = {}): string {
  const id = uuidv7();
  window.localStorage.setItem(
    THEFT_KEY,
    JSON.stringify([
      {
        id,
        farmId: FARM_ID,
        discoveredAt: '2026-07-20T10:00:00.000Z',
        lastSeenAt: '2026-07-18T10:00:00.000Z',
        lastSeenLocationGeojson: '{"type":"Point","coordinates":[26.21,-29.12]}',
        landUnitId: null,
        headCount: 12,
        caseNumber: null,
        reportingStation: null,
        observations: 'Fence cut on the eastern boundary',
        animalIds: [],
        ...extra,
      },
    ]),
  );
  return id;
}

/** Mark an id as confirmed by the server, the way a completed flush would. */
function markSent(id: string): void {
  window.localStorage.setItem(SENT_KEY, JSON.stringify([id]));
}

function storedIncidents(): Array<Record<string, unknown>> {
  return JSON.parse(window.localStorage.getItem(THEFT_KEY) ?? '[]') as Array<
    Record<string, unknown>
  >;
}

/** A phone that gives a fix, or refuses to. */
function stubGeolocation(result: 'ok' | 'denied'): void {
  const getCurrentPosition = vi.fn(
    (success: PositionCallback, failure?: PositionErrorCallback | null) => {
      if (result === 'ok') {
        success({
          coords: { longitude: 26.21, latitude: -29.12 },
        } as unknown as GeolocationPosition);
      } else {
        failure?.({ code: 1, PERMISSION_DENIED: 1 } as unknown as GeolocationPositionError);
      }
    },
  );
  Object.defineProperty(window.navigator, 'geolocation', {
    value: { getCurrentPosition },
    configurable: true,
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('filing a stock-theft incident (FR-603)', () => {
  it('files an incident with no signal, anchored to where the farmer is standing', async () => {
    cachedSession();
    stubGeolocation('ok');
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/theft/new');
    render(<App />);

    await user.type(screen.getByLabelText(/how many are gone/i), '12');
    await user.type(screen.getByLabelText(/what did you find/i), 'Fence cut on the east boundary');
    await user.click(screen.getByRole('button', { name: /file this incident/i }));

    await waitFor(() => expect(storedIncidents()).toHaveLength(1));
    const [incident] = storedIncidents();
    expect(incident).toMatchObject({
      farmId: FARM_ID,
      headCount: 12,
      observations: 'Fence cut on the east boundary',
    });
    // GeoJSON is [longitude, latitude] — the opposite of how everyone says it out loud. Getting
    // this backwards puts a Free State camp in Somalia, on a document handed to the police.
    expect(JSON.parse(incident!['lastSeenLocationGeojson'] as string)).toEqual({
      type: 'Point',
      coordinates: [26.21, -29.12],
    });
  });

  it('is reachable on a farm with no individual animals at all', () => {
    // A great many of the farms most exposed to stock theft run their stock as groups and have no
    // animal rows to tick. The one screen that produces a police document must not sit behind a
    // data-entry exercise nobody has done at the moment they need it.
    cachedSession();
    window.history.pushState({}, '', '/animals');
    render(<App />);

    expect(screen.getByRole('link', { name: /stock theft/i })).toBeTruthy();
  });

  it('does not silently file without a GPS point — it says so, and asks again', async () => {
    cachedSession();
    stubGeolocation('denied');
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/theft/new');
    render(<App />);

    await user.type(screen.getByLabelText(/how many are gone/i), '3');
    await user.click(screen.getByRole('button', { name: /file this incident/i }));

    // Nothing filed, and the reason is named — "denied" and "no sky" need different actions from
    // the person holding the phone.
    expect(storedIncidents()).toHaveLength(0);
    expect(screen.getByText(/not allowing the app to use its location/i)).toBeTruthy();
  });

  it('files anyway on a second, deliberate tap — a report is worth more filed than not', async () => {
    cachedSession();
    stubGeolocation('denied');
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/theft/new');
    render(<App />);

    await user.type(screen.getByLabelText(/how many are gone/i), '3');
    await user.click(screen.getByRole('button', { name: /file this incident/i }));
    await user.click(screen.getByRole('button', { name: /file it without a gps point/i }));

    await waitFor(() => expect(storedIncidents()).toHaveLength(1));
    expect(storedIncidents()[0]).toMatchObject({ headCount: 3, lastSeenLocationGeojson: null });
  });

  it('offers no way to name a suspect, and warns against it in the one box that could', async () => {
    // ⛔ The absence IS the requirement (legal-compliance.md § 3.2, POPIA s26). If a field for this
    // is ever added, this test is what should stop it.
    cachedSession();
    stubGeolocation('ok');
    window.history.pushState({}, '', '/animals/theft/new');
    render(<App />);

    expect(screen.queryByLabelText(/suspect/i)).toBeNull();
    expect(screen.queryByLabelText(/who took/i)).toBeNull();
    expect(screen.getByText(/do not name anyone you suspect/i)).toBeTruthy();
  });

  it('records the animals a farmer can identify, for the ownership chain', async () => {
    cachedSession();
    stubGeolocation('ok');
    const a1 = uuidv7();
    seedHerd(animal(a1), animal(uuidv7()));
    window.localStorage.setItem(
      IDENTIFIERS_KEY,
      JSON.stringify([
        { id: uuidv7(), farmId: FARM_ID, animalId: a1, type: 'visual_tag', value: '0417' },
      ]),
    );
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/theft/new');
    render(<App />);

    await user.type(screen.getByLabelText(/how many are gone/i), '2');
    await user.click(screen.getByRole('button', { name: /0417/ }));
    await user.click(screen.getByRole('button', { name: /file this incident/i }));

    await waitFor(() => expect(storedIncidents()).toHaveLength(1));
    expect(storedIncidents()[0]!['animalIds']).toEqual([a1]);
  });
});

describe('the evidence pack (FR-603)', () => {
  it('does not offer a pack for an incident the server has never seen, and says why', () => {
    cachedSession();
    seedIncident();
    window.history.pushState({}, '', '/animals/theft');
    render(<App />);

    // The incident IS saved, and the copy says so rather than reading as a failure. What has not
    // happened is the part that genuinely needs a signal.
    expect(screen.getByText(/saved on this phone/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /get the evidence pack/i })).toBeNull();
  });

  it('offers the pack once the incident has been sent', () => {
    cachedSession();
    const id = seedIncident();
    markSent(id);
    window.history.pushState({}, '', '/animals/theft');
    render(<App />);

    expect(screen.getByRole('button', { name: /get the evidence pack/i })).toBeTruthy();
  });

  it('says the connection failed without blaming the record, when there is no signal', async () => {
    cachedSession();
    const id = seedIncident();
    markSent(id);
    // A transport failure — `fetch` rejects. This is the one action in livestock that legitimately
    // needs a network, and the farmer must be told which of the two problems they have.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/theft');
    render(<App />);

    await user.click(screen.getByRole('button', { name: /get the evidence pack/i }));

    expect(await screen.findByText(/there is no connection right now/i)).toBeTruthy();
    expect(screen.getByText(/the incident is safe/i)).toBeTruthy();
  });

  it('shows the incident’s own facts — head taken, when found, the case number', () => {
    cachedSession();
    seedIncident({ caseNumber: 'CAS 114/07/2026' });
    window.history.pushState({}, '', '/animals/theft');
    render(<App />);

    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('CAS 114/07/2026')).toBeTruthy();
    // The farm's day, not the device's or UTC's: `toISOString().slice(0,10)` is wrong for two
    // hours out of every twenty-four in South Africa.
    expect(screen.getByText('2026-07-20')).toBeTruthy();
  });

  it('names an incident that has no GPS point rather than letting it look complete', () => {
    cachedSession();
    seedIncident({ lastSeenLocationGeojson: null });
    window.history.pushState({}, '', '/animals/theft');
    render(<App />);

    expect(screen.getByText(/no gps point on this one/i)).toBeTruthy();
  });
});
