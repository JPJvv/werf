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

/** One identified animal's facts, as gathered from the herd + identifier + brand rows. */
export interface EvidencePackAnimalInput {
  readonly animalId: string;
  readonly identifiers: ReadonlyArray<{ readonly type: string; readonly value: string }>;
  /** The registered mark this animal carries, or null if unmarked. */
  readonly mark: string | null;
  readonly photoKey: string | null;
  /** Acquisition record — the start of the ownership chain (YYYY-MM-DD). */
  readonly acquiredAt: string | null;
  readonly source: string | null;
}

export interface EvidencePackInput {
  readonly farmId: string;
  readonly discoveredAt: Date;
  readonly lastSeenAt: Date | null;
  readonly lastSeenLocationGeojson: string | null;
  readonly headCount: number;
  /** The registered brand certificate reference — the ownership proof. */
  readonly brandCertificateReference: string | null;
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
export function assembleEvidencePack(input: EvidencePackInput): schemas.EvidencePack {
  return schemas.evidencePackSchema.parse({
    farmId: input.farmId,
    discoveredAt: input.discoveredAt.toISOString(),
    lastSeenAt: input.lastSeenAt === null ? null : input.lastSeenAt.toISOString(),
    lastSeenLocationGeojson: input.lastSeenLocationGeojson,
    headCount: input.headCount,
    animals: input.animals.map((a) => ({
      animalId: a.animalId,
      identifiers: a.identifiers.map((i) => ({ type: i.type, value: i.value })),
      mark: a.mark,
      photoKey: a.photoKey,
      acquiredAt: a.acquiredAt,
      source: a.source,
    })),
    brandCertificateReference: input.brandCertificateReference,
    observations: input.observations,
    caseNumber: input.caseNumber,
    reportingStation: input.reportingStation,
  });
}
