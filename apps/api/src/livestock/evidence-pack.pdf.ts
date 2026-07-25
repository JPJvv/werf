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

/** Builds the evidence-pack PDF and resolves the complete file as a Buffer. */
export function renderEvidencePackPdf(pack: schemas.EvidencePack): Promise<Buffer> {
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
    line('Registered brand certificate', pack.brandCertificateReference ?? '—');
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
      const identifiers =
        animal.identifiers.length === 0
          ? '—'
          : animal.identifiers.map((i) => `${i.type}: ${i.value}`).join('; ');
      line('Identifiers', identifiers);
      line('Registered mark', animal.mark ?? '—');
      line('Acquired', animal.acquiredAt ?? '—');
      line('Source (ownership chain)', animal.source ?? '—');
      line('Photograph on file', animal.photoKey === null ? 'No' : 'Yes');
    }

    doc.end();
  });
}
