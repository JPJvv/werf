/**
 * `renderEvidencePackPdf` is pure (no I/O, no clock) — these tests exercise the P2.5 photo-embedding
 * branches directly, without a database or object storage. `livestock.integration.test.ts` covers
 * the surrounding real-Postgres behaviour (assembling the pack itself); this file covers only what
 * the renderer does with a `photosByAnimal` map once it has one.
 */

import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { schemas } from '@werf/core';
import { renderEvidencePackPdf } from './evidence-pack.pdf';

/** A well-known, genuinely valid 1x1 PNG — pdfkit decodes PNG natively, no native binary needed. */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

/** The visible text of a pdfkit document — see `livestock.integration.test.ts`'s own copy for why:
 *  pdfkit deflates its content streams and kerns each run into hex-encoded `TJ` arrays. */
function extractPdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  let text = '';
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    const body = Buffer.from(match[1]!, 'latin1');
    let content: string;
    try {
      content = inflateSync(body).toString('latin1');
    } catch {
      content = body.toString('latin1');
    }
    for (const show of content.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      for (const hex of show[1]!.matchAll(/<([0-9A-Fa-f]+)>/g)) {
        text += Buffer.from(hex[1]!, 'hex').toString('latin1');
      }
      text += ' ';
    }
  }
  // pdfkit wraps long lines mid-string, splitting one logical run across two `TJ` arrays and
  // doubling up the space inserted between them above — collapsed so an assertion about the
  // WORDS never has to know where the renderer happened to break a line.
  return text.replace(/\s+/g, ' ');
}

/** A minimal valid pack with exactly one animal; overlay the animal fields a test cares about. */
function aPack(animalOver: Partial<schemas.EvidenceAnimal> = {}): schemas.EvidencePack {
  return schemas.evidencePackSchema.parse({
    farmId: randomUUID(),
    discoveredAt: '2026-07-21T15:00:00.000Z',
    lastSeenAt: null,
    lastSeenLocationGeojson: null,
    headCount: 1,
    animals: [
      {
        animalId: randomUUID(),
        identifiers: [],
        mark: null,
        certificateReference: null,
        photoObjectKey: null,
        photoChecksumSha256Hex: null,
        acquiredAt: null,
        source: null,
        movements: [],
        treatments: [],
        ...animalOver,
      },
    ],
    brandCertificateReference: null,
    observations: null,
    caseNumber: null,
    reportingStation: null,
  });
}

describe('renderEvidencePackPdf — P2.5 photo embedding', () => {
  it('says "None on file" when the animal never had a photo captured at all', async () => {
    const pack = aPack({ photoObjectKey: null, photoChecksumSha256Hex: null });

    const pdf = await renderEvidencePackPdf(pack);

    expect(extractPdfText(pdf)).toContain('None on file');
  });

  it('names the reference honestly, never claiming attachment, when the caller could not supply bytes', async () => {
    const pack = aPack({
      photoObjectKey: 'farm/abc/attachments/xyz.jpg',
      photoChecksumSha256Hex: 'a'.repeat(64),
    });

    // No `photosByAnimal` entry — the default empty map. This is the shape a controller passes
    // when `ObjectStorage.getObject` returned null (object missing) or the checksum didn't match.
    const pdf = await renderEvidencePackPdf(pack);
    const text = extractPdfText(pdf);

    expect(text).toContain('farm/abc/attachments/xyz.jpg');
    expect(text).toContain('image not attached to this pack');
  });

  it('EMBEDS the actual image once the caller has fetched and verified it', async () => {
    const [animal] = [{ animalId: randomUUID() }];
    const pack = aPack({
      animalId: animal!.animalId,
      photoObjectKey: 'farm/abc/attachments/xyz.jpg',
      photoChecksumSha256Hex: 'a'.repeat(64),
    });
    const photosByAnimal = new Map([[pack.animals[0]!.animalId, ONE_PIXEL_PNG]]);

    const pdf = await renderEvidencePackPdf(pack, photosByAnimal);
    const text = extractPdfText(pdf);

    // The reference-only fallback line must be ABSENT — the image was actually embedded, not
    // merely named. A PDF that embeds an image carries an `/Image` XObject; a text-only pack
    // never does, so this is a real assertion about what the renderer did, not just its length.
    expect(text).not.toContain('image not attached to this pack');
    expect(pdf.toString('latin1')).toContain('/Image');
  });

  it('falls back to a fact-only line, without crashing, when the supplied bytes are not a decodable image', async () => {
    const pack = aPack({
      photoObjectKey: 'farm/abc/attachments/xyz.jpg',
      photoChecksumSha256Hex: 'a'.repeat(64),
    });
    // Checksum-verified bytes that are simply not an image pdfkit can decode — e.g. a mimeType
    // pdfkit has no decoder for, even though the checksum matched what was captured.
    const photosByAnimal = new Map([[pack.animals[0]!.animalId, Buffer.from('not an image')]]);

    const pdf = await renderEvidencePackPdf(pack, photosByAnimal);
    const text = extractPdfText(pdf);

    expect(text).toContain('image not attached to this pack');
  });

  it('treats each animal in a multi-animal pack independently', async () => {
    const withPhoto = randomUUID();
    const withoutPhoto = randomUUID();
    const pack = schemas.evidencePackSchema.parse({
      farmId: randomUUID(),
      discoveredAt: '2026-07-21T15:00:00.000Z',
      lastSeenAt: null,
      lastSeenLocationGeojson: null,
      headCount: 2,
      animals: [
        {
          animalId: withPhoto,
          identifiers: [],
          mark: null,
          certificateReference: null,
          photoObjectKey: 'farm/abc/attachments/one.jpg',
          photoChecksumSha256Hex: 'a'.repeat(64),
          acquiredAt: null,
          source: null,
          movements: [],
          treatments: [],
        },
        {
          animalId: withoutPhoto,
          identifiers: [],
          mark: null,
          certificateReference: null,
          photoObjectKey: null,
          photoChecksumSha256Hex: null,
          acquiredAt: null,
          source: null,
          movements: [],
          treatments: [],
        },
      ],
      brandCertificateReference: null,
      observations: null,
      caseNumber: null,
      reportingStation: null,
    });
    const photosByAnimal = new Map([[withPhoto, ONE_PIXEL_PNG]]);

    const pdf = await renderEvidencePackPdf(pack, photosByAnimal);
    const text = extractPdfText(pdf);

    expect(text).toContain('None on file');
    expect(text).not.toContain('image not attached to this pack');
  });
});
