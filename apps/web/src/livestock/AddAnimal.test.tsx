/**
 * Capturing an animal, as a farmer meets it: tap through to "Record an animal", save, and the
 * home tile's head count moves — with nothing touching the network, and still there after the
 * app is closed and reopened. This is the offline-first promise for a capture (FR-101, FR-017,
 * FR-705, NFR-007) proved end to end.
 *
 * Like App.test.tsx, these seed `localStorage` and render the real `<App/>` rather than
 * injecting a store: the local herd is read through the same boot path a reload uses, so a
 * test that bypassed it would prove nothing about a cold start. If any assertion here ever
 * needs a server, the offline promise has been broken.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { schemas } from '@werf/core';
import { App } from '../App';
import { storedCaptures, getCurrentFakeLocalDatabase } from '../test-support/local-db';

const SESSION_KEY = 'werf-session';
const HERD_KEY = 'werf-herd:0190f3a0-0000-7000-8000-0000000000f1';

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

/**
 * Signs in a cattle farm (so the animals tile reads "Herd") with no signal, via cached state.
 *
 * `enterprises` defaults to EMPTY on purpose: that is what a session cached before herd scoping
 * (FR-113) existed looks like, and the tests below that leave it empty are exercising exactly that
 * device — it must still capture, falling back to asking for a species.
 */
function cachedSession(
  enterpriseTypes: string[] = ['beef_cattle'],
  enterprises: Array<{ id: string; name: string; type: string }> = [],
): void {
  const payload = {
    accessToken: 'access-token',
    expiresIn: 900,
    refreshToken: 'refresh-token',
    refreshExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    user: SESSION_USER,
    farms: [
      {
        id: '0190f3a0-0000-7000-8000-0000000000f1',
        name: 'Rietfontein',
        enterpriseTypes,
        enterprises,
        role: 'owner',
      },
    ],
    activeFarmId: '0190f3a0-0000-7000-8000-0000000000f1',
    secondFactor: 'complete',
  };
  window.localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ payload, confirmedAt: new Date().toISOString() }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  window.localStorage.clear();
});

describe('recording an animal', () => {
  it('starts a new farm at zero head, honestly', () => {
    cachedSession();
    render(<App />);

    const herd = screen.getByRole('link', { name: /herd/i });
    expect(within(herd).getByText('0')).toBeTruthy();
  });

  it('counts a captured animal on the home tile, with no network in the path', async () => {
    cachedSession();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/new');
    render(<App />);

    // Species is pre-set to the farm's one species (cattle); sex defaults. Just save.
    await user.click(screen.getByRole('button', { name: /save animal/i }));

    // The confirmation the farmer needs to see — never the word "sync", always "saved". (Its
    // full text distinguishes it from the shell's save-status strip, also a live region.)
    expect(screen.getByText(/saved — your work is saved/i)).toBeTruthy();

    // Through the list…
    await user.click(screen.getByRole('link', { name: /done/i }));
    // Scoped to the LIST: the screen also shows a per-species class breakdown (FR-705) now.
    expect(
      within(screen.getByRole('list', { name: /^animals$/i })).getByText('Cattle'),
    ).toBeTruthy();

    // …and home, where the Herd tile now reads one.
    await user.click(screen.getByRole('link', { name: /back to home/i }));
    const herd = screen.getByRole('link', { name: /herd/i });
    expect(within(herd).getByText('1')).toBeTruthy();
  });

  it('keeps the captured animal after the app is closed and reopened (offline durability)', async () => {
    cachedSession();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/new');
    const { unmount } = render(<App />);
    await user.click(screen.getByRole('button', { name: /save animal/i }));

    // Tear the whole app down and boot it fresh — a phone closed in the veld and opened the
    // next morning. localStorage is all it has; nothing was ever sent anywhere.
    unmount();
    window.history.pushState({}, '', '/');
    render(<App />);

    // findByText waits out the fresh render's async hydration before this positive assertion —
    // even against the same in-memory fake database, the read-back is a real await.
    await waitFor(() => {
      const herd = screen.getByRole('link', { name: /herd/i });
      expect(within(herd).getByText('1')).toBeTruthy();
    });
  });

  it('[P1.1] does not report "Saved" until the local write is durable', async () => {
    cachedSession();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/new');
    render(<App />);

    // Hold the actual SQLite INSERT open — simulates the real, non-zero window between a farmer
    // tapping Save and the write genuinely landing. Nothing else (migration, hydration reads) is
    // touched, so this isolates the one call the fix is about.
    const db = await getCurrentFakeLocalDatabase();
    const realExecute = db.execute.bind(db);
    let releaseWrite!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    db.execute = async (sql: string, params?: readonly unknown[]) => {
      if (sql.startsWith('INSERT OR REPLACE INTO capture_records')) await held;
      return realExecute(sql, params);
    };

    await user.click(screen.getByRole('button', { name: /save animal/i }));

    // The write is deliberately held — the confirmation must not appear, and nothing must be
    // readable back, while the record is still only in memory.
    expect(screen.queryByText(/saved — your work is saved/i)).toBeNull();
    expect(await storedCaptures<Record<string, unknown>>(HERD_KEY)).toHaveLength(0);

    releaseWrite();
    await waitFor(() => {
      expect(screen.getByText(/saved — your work is saved/i)).toBeTruthy();
    });
    expect(await storedCaptures<Record<string, unknown>>(HERD_KEY)).toHaveLength(1);
  });

  it('records a known or estimated birth date instead of silently leaving both blank', async () => {
    cachedSession();
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/new');
    render(<App />);

    await user.type(screen.getByLabelText(/date of birth/i), '2024-09-17');
    await user.click(screen.getByRole('checkbox', { name: /date is an estimate/i }));
    await user.click(screen.getByRole('button', { name: /save animal/i }));

    // append() commits to the in-memory snapshot synchronously (NFR-007) AND the screen's `save`
    // handler awaits durable SQLite persistence before reporting "Saved" (P1.1) — by the time
    // userEvent.click's promise resolves, the row is already there. No waitFor needed, but one
    // costs nothing and keeps this robust to a future async boundary.
    await waitFor(async () => {
      expect(await storedCaptures<Record<string, unknown>>(HERD_KEY)).toHaveLength(1);
    });
    const [captured] = await storedCaptures<Record<string, unknown>>(HERD_KEY);
    expect(captured).toMatchObject({ dob: '2024-09-17', dobEstimated: true });
  });

  it('offers only the species the farm actually runs', () => {
    cachedSession(['sheep']);
    window.history.pushState({}, '', '/animals/new');
    render(<App />);

    const species = within(screen.getByLabelText(/species/i)).getAllByRole('option');
    expect(species.map((o) => o.textContent)).toEqual(['Sheep']);
  });

  // ── Herd scoping (FR-113) ───────────────────────────────────────────────────────────────
  const CATTLE_HERD = {
    id: '0190f3a0-0000-7000-8000-00000000e001',
    name: 'Bonsmara cows',
    type: 'beef_cattle',
  };
  const FEEDLOT = {
    id: '0190f3a0-0000-7000-8000-00000000e002',
    name: 'Feedlot',
    type: 'beef_cattle',
  };
  const FLOCK = { id: '0190f3a0-0000-7000-8000-00000000e003', name: 'Dorper flock', type: 'sheep' };

  /** The herd the last captured animal was filed under. */
  async function capturedHerdId(): Promise<unknown> {
    const herd = await storedCaptures<Record<string, unknown>>(HERD_KEY);
    return herd[0]?.['enterpriseId'];
  }

  it('asks which herd on a mixed farm, and files the animal under it', async () => {
    cachedSession(['beef_cattle', 'sheep'], [CATTLE_HERD, FLOCK]);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/new');
    render(<App />);

    // The herd is the only subject question — the species follows from it, so a sheep can no
    // longer be filed under the cattle enterprise by picking the wrong one of two controls.
    expect(screen.queryByLabelText(/species/i)).toBeNull();
    await user.selectOptions(screen.getByLabelText(/herd/i), FLOCK.id);
    await user.click(screen.getByRole('button', { name: /save animal/i }));

    expect(await capturedHerdId()).toBe(FLOCK.id);
    await user.click(screen.getByRole('link', { name: /done/i }));
    // Scoped to the LIST: the screen now also shows a per-species class breakdown (FR-705), so a
    // bare getByText('Sheep') would match the breakdown heading too.
    // The species was derived from the herd, never asked for.
    expect(
      within(screen.getByRole('list', { name: /^animals$/i })).getByText('Sheep'),
    ).toBeTruthy();
  });

  it('tells two herds of the SAME species apart — which a species picker never could', async () => {
    cachedSession(['beef_cattle'], [CATTLE_HERD, FEEDLOT]);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/new');
    render(<App />);

    await user.selectOptions(screen.getByLabelText(/herd/i), FEEDLOT.id);
    await user.click(screen.getByRole('button', { name: /save animal/i }));

    expect(await capturedHerdId()).toBe(FEEDLOT.id);
  });

  it('asks nothing on a single-herd farm, but says where the animal is filed', async () => {
    cachedSession(['beef_cattle'], [CATTLE_HERD]);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/new');
    render(<App />);

    // A question with one answer is an obstacle in a crush, not a decision. It is still stated.
    expect(screen.queryByRole('combobox', { name: /herd/i })).toBeNull();
    expect(screen.getByText(/bonsmara cows/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /save animal/i }));
    expect(await capturedHerdId()).toBe(CATTLE_HERD.id);
  });

  // ── Species-specific attributes (FR-107) ────────────────────────────────────────────────
  /** The whole attributes record on the last captured animal. */
  async function capturedAttributes(): Promise<Record<string, unknown>> {
    const herd = await storedCaptures<Record<string, unknown>>(HERD_KEY);
    return (herd[0]?.['attributes'] ?? {}) as Record<string, unknown>;
  }

  it('⭐ asks a cattle farm about horns and never about wool', async () => {
    // A wool class field on a cattle capture is a question nobody can answer and one more thing to
    // skip in a crush. The screen renders what the SPECIES schema says, not a fixed list.
    cachedSession(['beef_cattle'], [CATTLE_HERD]);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/new');
    render(<App />);

    expect(screen.queryByLabelText(/wool class/i)).toBeNull();

    await user.selectOptions(screen.getByLabelText(/horns/i), 'polled');
    await user.click(screen.getByRole('button', { name: /save animal/i }));

    expect(await capturedAttributes()).toEqual({ hornStatus: 'polled' });
  });

  it('asks a sheep farm about both, because a sheep can be horned too', async () => {
    cachedSession(['sheep'], [FLOCK]);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/new');
    render(<App />);

    await user.type(screen.getByLabelText(/wool class/i), 'bfy');
    await user.click(screen.getByRole('button', { name: /save animal/i }));

    // Typed lower case, stored as the classer writes it.
    expect(await capturedAttributes()).toEqual({ woolClass: 'BFY' });
  });

  it('saves an animal with nothing said about either, which is the crush case', async () => {
    cachedSession(['sheep'], [FLOCK]);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/new');
    render(<App />);

    await user.click(screen.getByRole('button', { name: /save animal/i }));

    expect(await capturedAttributes()).toEqual({});
  });

  it('refuses a wool class that is not a code, on the device rather than days later', async () => {
    cachedSession(['sheep'], [FLOCK]);
    const user = userEvent.setup();
    window.history.pushState({}, '', '/animals/new');
    render(<App />);

    await user.type(screen.getByLabelText(/wool class/i), 'good stuff');

    expect(screen.getByText(/classer’s code/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /save animal/i }));
    // Nothing captured: a refusal that let the animal through would be no refusal at all.
    expect(
      JSON.parse(
        window.localStorage.getItem('werf-herd:0190f3a0-0000-7000-8000-0000000000f1') ?? '[]',
      ),
    ).toHaveLength(0);
  });
});
