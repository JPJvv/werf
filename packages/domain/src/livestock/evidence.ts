/**
 * Stock-theft evidence pack (Phase 2, FR-603) — COMPLIANCE-GATED (legal-compliance.md § 3.2,
 * .claude/rules/domain.md). Pure assembly of the FACTS the server later renders into a single PDF
 * for the SAPS Stock Theft Unit: animal identification, the ownership chain (acquisition → current),
 * the registered brand certificate, the last-seen GPS + timestamp, and the case reference.
 *
 * ⛔ FACTS ONLY. There is no `suspect` field and there never will be — a farmer naming a neighbour is
 * a defamation exposure for them and a POPIA s26 criminal-behaviour processing problem for us. This
 * function funnels every pack through `evidencePackSchema`, which has no suspect field, so anything
 * of the sort in the input is STRIPPED, not just discouraged. Pure: no I/O; the caller fetches the
 * rows, this shapes and validates them.
 */

import { schemas } from '@werf/core';

/** One identified animal's facts, as gathered from the herd + identifier + brand + event rows. */
export interface EvidencePackAnimalInput {
  readonly animalId: string;
  /** Every identifier it has ever carried — RETIRED ONES INCLUDED, flagged. See the schema. */
  readonly identifiers: ReadonlyArray<{
    readonly type: string;
    readonly value: string;
    readonly retired: boolean;
  }>;
  /** The registered mark this animal carries, or null if unmarked. */
  readonly mark: string | null;
  /** The certificate for THIS animal's mark — per animal, because marks can differ in one loss. */
  readonly certificateReference: string | null;
  readonly photoKey: string | null;
  /** Acquisition record — the start of the ownership chain (YYYY-MM-DD). */
  readonly acquiredAt: string | null;
  readonly source: string | null;
  /** The possession trail: where it was walked and when, in occurrence order (camp codes). */
  readonly movements: ReadonlyArray<{
    readonly occurredAt: Date;
    readonly from: string | null;
    readonly to: string | null;
  }>;
  /** The possession trail: what it was dosed with and when, in occurrence order. */
  readonly treatments: ReadonlyArray<{
    readonly occurredAt: Date;
    readonly kind: string;
    readonly product: string;
  }>;
}

export interface EvidencePackInput {
  readonly farmId: string;
  readonly discoveredAt: Date;
  readonly lastSeenAt: Date | null;
  readonly lastSeenLocationGeojson: string | null;
  readonly headCount: number;
  readonly observations: string | null;
  readonly caseNumber: string | null;
  readonly reportingStation: string | null;
  readonly animals: ReadonlyArray<EvidencePackAnimalInput>;
}

/**
 * Assemble and validate a facts-only evidence pack. Timestamps are serialised to ISO strings because
 * `evidencePackSchema` parses them back to Dates (the same wire discipline as every capture); the
 * parse is also what enforces the no-suspect contract structurally.
 */
/**
 * The one certificate covering EVERY animal in the incident, or null.
 *
 * ⭐ Every animal, not every marked animal — and the difference is the whole point. Filtering the
 * unmarked ones out first meant three animals, one carrying `AIS-FS-0042` and two carrying no mark
 * at all, printed that certificate at the head of the pack: an assertion of registered ownership
 * over two animals it does not cover. That is the same over-claim the per-animal reference was
 * introduced to stop, one case further along.
 *
 * So: null unless the whole set is covered by a single reference. The per-animal lines carry the
 * truth in every other case, and the header says to read them.
 */
function soleCertificate(animals: ReadonlyArray<EvidencePackAnimalInput>): string | null {
  if (animals.length === 0) return null;
  const distinct = new Set(animals.map((a) => a.certificateReference ?? ''));
  const only = [...distinct][0] ?? '';
  return distinct.size === 1 && only !== '' ? only : null;
}

export function assembleEvidencePack(input: EvidencePackInput): schemas.EvidencePack {
  return schemas.evidencePackSchema.parse({
    farmId: input.farmId,
    discoveredAt: input.discoveredAt.toISOString(),
    lastSeenAt: input.lastSeenAt === null ? null : input.lastSeenAt.toISOString(),
    lastSeenLocationGeojson: input.lastSeenLocationGeojson,
    headCount: input.headCount,
    animals: input.animals.map((a) => ({
      animalId: a.animalId,
      identifiers: a.identifiers.map((i) => ({
        type: i.type,
        value: i.value,
        retired: i.retired,
      })),
      mark: a.mark,
      certificateReference: a.certificateReference,
      photoKey: a.photoKey,
      acquiredAt: a.acquiredAt,
      source: a.source,
      movements: a.movements.map((m) => ({
        occurredAt: m.occurredAt.toISOString(),
        from: m.from,
        to: m.to,
      })),
      treatments: a.treatments.map((tr) => ({
        occurredAt: tr.occurredAt.toISOString(),
        kind: tr.kind,
        product: tr.product,
      })),
    })),
    // Derived here rather than accepted, so the "one mark or none" rule cannot be got wrong by a
    // caller: distinct references across the linked animals, and null unless there is exactly one.
    brandCertificateReference: soleCertificate(input.animals),
    observations: input.observations,
    caseNumber: input.caseNumber,
    reportingStation: input.reportingStation,
  });
}
