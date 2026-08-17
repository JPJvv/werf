/**
 * `mergeById` — the pure function `Outbox.tsx`'s `needsHead` and `herd.ts`'s `useEffectiveMobs`
 * both use to combine a device's own captures with what down-sync has hydrated. Tested in
 * isolation because it is the one piece of the tripwire-3e fix with no React, no fake database,
 * and no farm scoping to thread through — the property it has to hold (test 7 of the required
 * matrix: a pending local capture and its own hydrated copy never double-count) is a fact about
 * this function alone.
 */

import { describe, expect, it } from 'vitest';
import {
  attachAnimalIds,
  mapHydratedBrandingRegister,
  mergeById,
  mergeByIdPreferHydrated,
  type HydratedTheftIncidentAnimalLink,
} from './HydratedLivestock';
import type { StoredTheftIncident } from './LocalTheft';

interface Row {
  readonly id: string;
  readonly tag: string;
}

describe('mergeById', () => {
  it('returns the local array untouched when nothing has hydrated', () => {
    const local: readonly Row[] = [{ id: '1', tag: 'local' }];
    expect(mergeById(local, [])).toBe(local); // same reference — no needless copy
  });

  it('appends a hydrated row this device never captured', () => {
    const local: readonly Row[] = [{ id: '1', tag: 'local' }];
    const hydrated: readonly Row[] = [{ id: '2', tag: 'hydrated' }];
    expect(mergeById(local, hydrated)).toEqual([
      { id: '1', tag: 'local' },
      { id: '2', tag: 'hydrated' },
    ]);
  });

  it('⭐ test 7 of the required matrix: a shared id never appears twice, and local wins', () => {
    // The exact shape a hydration event produces once this device's OWN capture has been sent and
    // later replicated back down to it: the same row, now present in BOTH `local` and `hydrated`.
    const local: readonly Row[] = [{ id: 'shared', tag: 'local' }];
    const hydrated: readonly Row[] = [{ id: 'shared', tag: 'hydrated' }];
    const merged = mergeById(local, hydrated);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({ id: 'shared', tag: 'local' });
  });

  it('does not lose a local row that also happens to be hydrated, alongside one that is not', () => {
    const local: readonly Row[] = [{ id: 'shared', tag: 'local' }];
    const hydrated: readonly Row[] = [
      { id: 'shared', tag: 'hydrated' },
      { id: 'only-hydrated', tag: 'hydrated' },
    ];
    const merged = mergeById(local, hydrated);
    expect(merged).toEqual([
      { id: 'shared', tag: 'local' },
      { id: 'only-hydrated', tag: 'hydrated' },
    ]);
  });
});

describe('branding-register hydration (FR-601)', () => {
  it('maps the JSON-encoded Postgres species array into the shared register shape', () => {
    expect(
      mapHydratedBrandingRegister({
        id: '0190f3a0-0000-7000-8000-0000000000b1',
        farm_id: '0190f3a0-0000-7000-8000-0000000000f1',
        jurisdiction: 'ZA',
        mark: 'AM7',
        mark_type: 'hot_brand',
        species: '["cattle","sheep"]',
        body_position: 'left hip',
        certificate_reference: 'AIS-42',
        registered_at: '2026-07-01',
      }),
    ).toMatchObject({ mark: 'AM7', species: ['cattle', 'sheep'] });
  });

  it('skips an unreadable array rather than breaking the whole local register', () => {
    expect(
      mapHydratedBrandingRegister({
        id: '0190f3a0-0000-7000-8000-0000000000b1',
        farm_id: '0190f3a0-0000-7000-8000-0000000000f1',
        jurisdiction: 'ZA',
        mark: 'AM7',
        mark_type: 'hot_brand',
        species: 'not-json',
      }),
    ).toBeNull();
  });
});

/**
 * `mergeByIdPreferHydrated` — the second compliance-checker finding on the same 3e diff.
 * `mergeById`'s local-wins is right for most tables, but `StoredMove`/`WithholdDose` are NOT most
 * tables: the hydrated echo of a move/dose carries server-derived fields (`fromMobId`, `
 * meatWithholdUntil`) a local capture structurally cannot. Local-wins on a shared id permanently
 * shadowed that enrichment the moment a device's OWN capture round-tripped back down as its
 * hydrated twin — the ordinary two-device workflow, not an edge case.
 */
describe('mergeByIdPreferHydrated', () => {
  it('⭐ the shadow-copy trace: on a shared id, hydrated wins — the enrichment a local capture never carries survives the fold', () => {
    // Exactly the trace the compliance-checker re-pass described: THIS device captured the move
    // locally (no `fromMobId` — the app never sends it), and it has since round-tripped through the
    // server and back down as a hydrated row carrying `fromMobId`.
    const local: readonly Row[] = [{ id: 'shared', tag: 'local' }];
    const hydrated: readonly Row[] = [{ id: 'shared', tag: 'hydrated' }];
    const merged = mergeByIdPreferHydrated(local, hydrated);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({ id: 'shared', tag: 'hydrated' });
  });

  it('still appends a hydrated row this device never captured', () => {
    const local: readonly Row[] = [{ id: '1', tag: 'local' }];
    const hydrated: readonly Row[] = [{ id: '2', tag: 'hydrated' }];
    expect(mergeByIdPreferHydrated(local, hydrated)).toEqual([
      { id: '2', tag: 'hydrated' },
      { id: '1', tag: 'local' },
    ]);
  });

  it('⭐ a pending local-only capture (not yet synced, so no hydrated twin) survives untouched', () => {
    // The regression risk in swapping the winner: a move this device captured but has not yet
    // flushed — or flushed but the server has not yet echoed back — must not vanish from the fold.
    // It has no id collision, so neither `mergeById` nor `mergeByIdPreferHydrated` can drop it.
    const local: readonly Row[] = [
      { id: 'synced', tag: 'local-synced' },
      { id: 'pending', tag: 'local-pending' },
    ];
    const hydrated: readonly Row[] = [{ id: 'synced', tag: 'hydrated' }];
    const merged = mergeByIdPreferHydrated(local, hydrated);
    expect(merged).toHaveLength(2);
    expect(merged).toContainEqual({ id: 'pending', tag: 'local-pending' });
    expect(merged).toContainEqual({ id: 'synced', tag: 'hydrated' });
  });
});

/**
 * `attachAnimalIds` — the fold that closes issue #10 (P2.6): `theft_incident_animals` needed a
 * surrogate id (migration 0025) before PowerSync could sync it at all, which is why a hydrated
 * theft incident's `animalIds` was always `[]` on a second device. `mapHydratedTheftIncident`
 * still sets `[]` (a hydrated incident row carries no join) — this is the function that fills it
 * in from the separately watched link table.
 */
describe('attachAnimalIds', () => {
  const incident = (id: string): StoredTheftIncident => ({
    id,
    farmId: 'farm-a',
    discoveredAt: '2026-07-20T10:00:00.000Z',
    lastSeenAt: null,
    lastSeenLocationGeojson: null,
    landUnitId: null,
    headCount: 3,
    caseNumber: null,
    reportingStation: null,
    observations: null,
    animalIds: [],
  });
  const link = (incidentId: string, animalId: string): HydratedTheftIncidentAnimalLink => ({
    id: `link-${incidentId}-${animalId}`,
    farmId: 'farm-a',
    incidentId,
    animalId,
  });

  it('returns the incidents untouched when no links have hydrated', () => {
    const incidents = [incident('theft-1')];
    expect(attachAnimalIds(incidents, [])).toBe(incidents); // same reference — no needless copy
  });

  it('⭐ fills in animalIds for an incident known only via hydration — the bug this closes', () => {
    // Exactly the second-device case: this device never captured the incident OR the links
    // locally — both arrived purely through down-sync, as two separately watched tables.
    const incidents = [incident('theft-1')];
    const links = [link('theft-1', 'animal-a'), link('theft-1', 'animal-b')];
    const filled = attachAnimalIds(incidents, links);
    expect(filled).toHaveLength(1);
    expect(filled[0]?.animalIds).toEqual(['animal-a', 'animal-b']);
  });

  it('leaves an incident with no links of its own at [] even when other incidents have links', () => {
    const incidents = [incident('theft-1'), incident('theft-2')];
    const links = [link('theft-1', 'animal-a')];
    const filled = attachAnimalIds(incidents, links);
    expect(filled.find((i) => i.id === 'theft-1')?.animalIds).toEqual(['animal-a']);
    expect(filled.find((i) => i.id === 'theft-2')?.animalIds).toEqual([]);
  });

  it('never lets one incident’s links leak onto another’s animalIds', () => {
    const incidents = [incident('theft-1'), incident('theft-2')];
    const links = [link('theft-1', 'animal-a'), link('theft-2', 'animal-b')];
    const filled = attachAnimalIds(incidents, links);
    expect(filled.find((i) => i.id === 'theft-1')?.animalIds).toEqual(['animal-a']);
    expect(filled.find((i) => i.id === 'theft-2')?.animalIds).toEqual(['animal-b']);
  });
});
