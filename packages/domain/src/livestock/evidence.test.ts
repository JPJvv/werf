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
  observations: 'Two heifers missing from Camp 3; fence cut on the northern boundary.',
  caseNumber: 'CAS 123/07/2026',
  reportingStation: 'Senekal SAPS',
  animals: [
    {
      animalId: '01900000-0000-7000-8000-0000000000a1',
      identifiers: [
        { type: 'visual_tag', value: 'FS-1024', retired: false },
        // The tag it was wearing before it was re-tagged. The pack must keep it.
        { type: 'visual_tag', value: 'FS-0311', retired: true },
      ],
      mark: 'FR',
      certificateReference: 'AIS-FS-0042',
      photoObjectKey: 'farm/01900000-0000-7000-8000-000000000011/attachments/a1.jpg',
      photoChecksumSha256Hex: 'a'.repeat(64),
      acquiredAt: '2024-03-01',
      source: 'Bought at Senekal auction',
      movements: [
        {
          occurredAt: new Date('2026-06-02T08:00:00.000Z'),
          from: 'NOORD',
          to: 'CAMP 3',
        },
      ],
      treatments: [
        {
          occurredAt: new Date('2026-06-18T06:00:00.000Z'),
          kind: 'dip',
          product: 'Tickaway',
        },
      ],
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
      mark: 'FR',
      certificateReference: 'AIS-FS-0042',
      acquiredAt: '2024-03-01',
      source: 'Bought at Senekal auction',
    });
  });

  it('⭐ keeps a RETIRED identifier, flagged — it is the number the animal was wearing', () => {
    // Every other read in the product excludes tombstones. This document is the exception, and the
    // reason is concrete: a tag replaced after the loss is the number on the animal at a roadblock
    // or in a sale yard. Excluding it drops the most useful line on the page.
    const pack = assembleEvidencePack(base);

    expect(pack.animals[0]!.identifiers).toEqual([
      { type: 'visual_tag', value: 'FS-1024', retired: false },
      { type: 'visual_tag', value: 'FS-0311', retired: true },
    ]);
  });

  it('⭐ carries the possession trail — the reverse-onus defence, not decoration', () => {
    // legal-compliance.md § 3.2. Identification proves the animal is yours; movement and treatment
    // history prove it was HERE, being kept, right up to the loss. A pack without them has left
    // out the part that does the legal work.
    const pack = assembleEvidencePack(base);

    expect(pack.animals[0]!.movements).toEqual([
      { occurredAt: new Date('2026-06-02T08:00:00.000Z'), from: 'NOORD', to: 'CAMP 3' },
    ]);
    expect(pack.animals[0]!.treatments).toEqual([
      { occurredAt: new Date('2026-06-18T06:00:00.000Z'), kind: 'dip', product: 'Tickaway' },
    ]);
  });

  it('[P2.5] carries the finalised attachment reference and checksum, never animals.photo_key', () => {
    const pack = assembleEvidencePack(base);
    expect(pack.animals[0]).toMatchObject({
      photoObjectKey: 'farm/01900000-0000-7000-8000-000000000011/attachments/a1.jpg',
      photoChecksumSha256Hex: 'a'.repeat(64),
    });
  });

  it('[P2.5] carries a null photo reference honestly when no photo was ever captured', () => {
    const pack = assembleEvidencePack({
      ...base,
      animals: [{ ...base.animals[0]!, photoObjectKey: null, photoChecksumSha256Hex: null }],
    });
    expect(pack.animals[0]!.photoObjectKey).toBeNull();
    expect(pack.animals[0]!.photoChecksumSha256Hex).toBeNull();
  });

  it('⭐ names ONE incident certificate only when every mark agrees, never a winner', () => {
    // Printing the first non-null over mixed marks asserts that every animal listed is covered by
    // a registration that may cover only some of them — an over-claim in the one document whose
    // value is that each line is a fact.
    const mixed = assembleEvidencePack({
      ...base,
      animals: [
        base.animals[0]!,
        {
          ...base.animals[0]!,
          animalId: '01900000-0000-7000-8000-0000000000a2',
          certificateReference: 'AIS-FS-0099',
        },
      ],
    });
    expect(mixed.brandCertificateReference).toBeNull();
    expect(mixed.animals.map((a) => a.certificateReference)).toEqual([
      'AIS-FS-0042',
      'AIS-FS-0099',
    ]);

    // The ordinary case — one farm mark — still gets the convenience line.
    expect(assembleEvidencePack(base).brandCertificateReference).toBe('AIS-FS-0042');
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
