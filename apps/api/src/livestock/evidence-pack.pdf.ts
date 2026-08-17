/**
 * Renders a stock-theft evidence pack (FR-603) to a single PDF — the one document a farmer hands the
 * SAPS Stock Theft Unit (legal-compliance.md § 3.2). Deterministic given the pack: no I/O, no clock
 * (any timestamp shown comes from the pack). pdfkit is pure JS (no native binary, no headless
 * browser), so this runs anywhere the API runs.
 *
 * ⛔ FACTS ONLY. The pack has no suspect field; this renderer prints what it is given and nothing it
 * is not. It never invents an accusation. See `assembleEvidencePack` in @werf/domain.
 */

import PDFDocument from 'pdfkit';
import type { schemas } from '@werf/core';

/** Farm time is displayed in Africa/Johannesburg (CLAUDE.md); the pack is read by a ZA officer. */
const DISPLAY_TIMEZONE = 'Africa/Johannesburg';

function formatInstant(value: Date | null): string {
  if (value === null) return '—';
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: DISPLAY_TIMEZONE,
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(value);
}

/**
 * Builds the evidence-pack PDF and resolves the complete file as a Buffer.
 *
 * `photosByAnimal` carries only bytes the CALLER has already fetched from object storage and
 * checksum-verified against `animal.photoChecksumSha256Hex` (P2.5 — `LivestockController`, the
 * same "verify before trust" discipline `AttachmentsService.finalizeAttachment` applies server-
 * side). This function does no I/O and no verification of its own: an animal whose id is absent
 * from the map is rendered as a reference-only line, never as a claim this function cannot back.
 */
export function renderEvidencePackPdf(
  pack: schemas.EvidencePack,
  photosByAnimal: ReadonlyMap<string, Buffer> = new Map(),
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const line = (label: string, value: string): void => {
      doc.font('Helvetica-Bold').fontSize(10).text(`${label}: `, { continued: true });
      doc.font('Helvetica').text(value);
    };

    doc.font('Helvetica-Bold').fontSize(18).text('Stock-Theft Evidence Pack');
    doc
      .moveDown(0.3)
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#555555')
      .text(
        'A record of facts for the South African Police Service Stock Theft Unit. This document ' +
          'records what was found, when, where, and what was reported. It makes no accusation.',
      );
    doc.fillColor('#000000').moveDown(1);

    // ── Incident ──────────────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(13).text('Incident');
    doc.moveDown(0.4);
    line('Head count reported missing', String(pack.headCount));
    line('Discovered', formatInstant(pack.discoveredAt));
    line('Last seen', formatInstant(pack.lastSeenAt));
    line('Last-seen GPS (GeoJSON)', pack.lastSeenLocationGeojson ?? '—');
    // Null the moment the linked animals are not ALL covered by one reference — the per-animal
    // line below is the authoritative one, and naming a single certificate over a mixed set claims
    // coverage the registration does not give. When NO animal carries one, say so rather than
    // pointing at per-animal lines that every one of them leaves blank.
    line(
      'Registered brand certificate',
      pack.brandCertificateReference ??
        (pack.animals.some((a) => a.certificateReference !== null) ? 'See each animal below' : '—'),
    );
    line('Case number', pack.caseNumber ?? '—');
    line('Reporting station', pack.reportingStation ?? '—');
    if (pack.observations !== null) {
      doc.moveDown(0.4).font('Helvetica-Bold').fontSize(10).text('Observations');
      doc.font('Helvetica').text(pack.observations);
    }

    // ── Animals ───────────────────────────────────────────────────────────────────
    doc.moveDown(1).font('Helvetica-Bold').fontSize(13).text(`Animals (${pack.animals.length})`);
    if (pack.animals.length === 0) {
      doc.moveDown(0.4).font('Helvetica').fontSize(10).text('No individual animals recorded.');
    }
    for (const [index, animal] of pack.animals.entries()) {
      doc
        .moveDown(0.5)
        .font('Helvetica-Bold')
        .fontSize(11)
        .text(`Animal ${index + 1}`);
      doc.moveDown(0.2);
      line('Animal ID', animal.animalId);
      // Retired identifiers are printed and SAID to be retired. The number an animal was wearing
      // when it walked off is the number on it at a roadblock, and dropping it would drop the most
      // useful line on the page.
      const identifiers =
        animal.identifiers.length === 0
          ? '—'
          : animal.identifiers
              .map((i) => `${i.type}: ${i.value}${i.retired ? ' (retired)' : ''}`)
              .join('; ');
      line('Identifiers', identifiers);
      line('Registered mark', animal.mark ?? '—');
      line('Brand certificate', animal.certificateReference ?? '—');
      line('Acquired', animal.acquiredAt ?? '—');
      line('Source (ownership chain)', animal.source ?? '—');
      // ⭐ P2.5: the photo is EMBEDDED, not merely referenced, once the caller has fetched and
      // checksum-verified it (`LivestockController.buildPhotoMap`) — the pipeline `animal.photoKey`
      // never had behind it. Three distinct facts, each printed as what it is: no reference at all;
      // a reference this pack could not verify or fetch (fact-only, same discipline the old comment
      // named — see git history); or a verified image, actually shown.
      const photo = photosByAnimal.get(animal.animalId);
      if (animal.photoObjectKey === null) {
        line('Photograph', 'None on file');
      } else if (photo === undefined) {
        line('Photograph', `Reference ${animal.photoObjectKey} — image not attached to this pack`);
      } else {
        doc.font('Helvetica-Bold').fontSize(10).text('Photograph:');
        try {
          doc.moveDown(0.2).image(photo, { fit: [200, 200] });
          doc.moveDown(0.2);
        } catch {
          // pdfkit could not decode these bytes (e.g. an unsupported image format that still
          // passed checksum verification) — fall back to the honest reference-only line rather
          // than crashing the whole pack over one animal's photo.
          doc
            .font('Helvetica')
            .text(`Reference ${animal.photoObjectKey} — image not attached to this pack`);
        }
      }

      // ⭐ The possession trail. Under the Stock Theft Act's reverse onus this is the DEFENCE:
      // identification says the animal is yours, this says it was HERE, being kept and treated,
      // right up to the loss. Printed in occurrence order, with camp codes rather than ids.
      doc.moveDown(0.3).font('Helvetica-Bold').fontSize(10).text('Movement history');
      doc.font('Helvetica');
      if (animal.movements.length === 0) {
        doc.text('  None recorded.');
      }
      for (const move of animal.movements) {
        doc.text(`  ${formatInstant(move.occurredAt)}  ${move.from ?? '—'} → ${move.to ?? '—'}`);
      }

      doc.moveDown(0.3).font('Helvetica-Bold').fontSize(10).text('Treatment history');
      doc.font('Helvetica');
      if (animal.treatments.length === 0) {
        doc.text('  None recorded.');
      }
      for (const dose of animal.treatments) {
        doc.text(`  ${formatInstant(dose.occurredAt)}  ${dose.kind}: ${dose.product}`);
      }
    }

    doc.end();
  });
}
