/**
 * Evidence-pack assembly (FR-603). The behaviour an auditor / investigator observes: the pack states
 * the identification, ownership chain, brand certificate, last-seen GPS and case reference — and it
 * can NEVER carry a suspect, by construction. legal-compliance.md § 3.2.
 */

import { describe, expect, it } from 'vitest';
import { assembleEvidencePack, type EvidencePackInput } from './evidence';

const base: EvidencePackInput = {
  farmId: '01900000-0000-7000-8000-000000000011',
  discoveredAt: new Date('2026-07-24T04:00:00.000Z'),
  lastSeenAt: new Date('2026-07-21T15:00:00.000Z'),
  lastSeenLocationGeojson: '{"type":"Point","coordinates":[26.15,-29.1]}',
  headCount: 2,
  brandCertificateReference: 'AIS-FS-0042',
  observations: 'Two heifers missing from Camp 3; fence cut on the northern boundary.',
  caseNumber: 'CAS 123/07/2026',
  reportingStation: 'Senekal SAPS',
  animals: [
    {
      animalId: '01900000-0000-7000-8000-0000000000a1',
      identifiers: [{ type: 'visual_tag', value: 'FS-1024' }],
      mark: 'FR',
      photoKey: 'photos/a1.jpg',
      acquiredAt: '2024-03-01',
      source: 'Bought at Senekal auction',
    },
  ],
};

describe('assembleEvidencePack (FR-603)', () => {
  it('states identification, ownership chain, brand certificate and last-seen facts', () => {
    const pack = assembleEvidencePack(base);

    expect(pack.headCount).toBe(2);
    expect(pack.brandCertificateReference).toBe('AIS-FS-0042');
    expect(pack.caseNumber).toBe('CAS 123/07/2026');
    expect(pack.lastSeenAt?.toISOString()).toBe('2026-07-21T15:00:00.000Z');
    expect(pack.animals[0]).toMatchObject({
      identifiers: [{ type: 'visual_tag', value: 'FS-1024' }],
      mark: 'FR',
      acquiredAt: '2024-03-01',
      source: 'Bought at Senekal auction',
    });
  });

  it('carries an open loss where the stock was never re-sighted (null last-seen)', () => {
    const pack = assembleEvidencePack({ ...base, lastSeenAt: null, lastSeenLocationGeojson: null });
    expect(pack.lastSeenAt).toBeNull();
    expect(pack.lastSeenLocationGeojson).toBeNull();
  });

  it('STRIPS any suspect-like field — the pack can never carry an accusation (POPIA s26)', () => {
    // Someone adds a suspect field upstream in a future refactor. It must not survive assembly.
    const smuggled = { ...base, suspect: 'The neighbour', accusedBy: 'me' } as EvidencePackInput;
    const pack = assembleEvidencePack(smuggled);

    expect(pack).not.toHaveProperty('suspect');
    expect(pack).not.toHaveProperty('accusedBy');
    expect(Object.keys(pack)).not.toContain('suspect');
  });
});
