/**
 * Herd / flock summary (FR-705) and the numbers the home-grid tiles carry (FR-017). A pure
 * reduction over the animal + mob records the caller already holds locally — given the herd, count
 * it. No I/O, no clock: the caller reads the animals and mobs from local state and passes them in.
 *
 * "Live" means status === 'alive'. Dead, sold, culled and missing animals are RETAINED forever
 * (soft-delete/tombstone is a different thing) but EXCLUDED from the live head count — a farmer's
 * "how many cattle do I have" must not include last year's slaughter (db.md, FR-705). A mob is the
 * group-only model (FR-102): a "Flock A: 300 head" record with no individual rows behind it, so its
 * head count is added to the live totals directly.
 *
 * `byEnterprise` is what feeds the home-grid tiles (FR-017: each enterprise tile carries one live
 * number). Age/sex CLASS (weaner, cow, steer…) is species-specific (ADR-0006) and is a later slice;
 * this summary gives the species / sex / camp / enterprise / status breakdowns that need no per-species rule.
 */

import { ANIMAL_SEXES, ANIMAL_STATUSES, type AnimalSex, type AnimalStatus } from '@werf/core';

/** The fields of an animal this summary reads — `Animal` satisfies it structurally. */
export interface HerdMember {
  readonly status: AnimalStatus;
  readonly species: string;
  readonly sex: AnimalSex;
  readonly enterpriseId: string | null;
  readonly landUnitId: string | null;
}

/** The fields of a mob this summary reads — `Mob` satisfies it structurally. */
export interface HerdMob {
  readonly species: string;
  readonly enterpriseId: string | null;
  readonly landUnitId: string | null;
  readonly headCount: number | null;
}

export interface HerdSummary {
  /** Live head across the whole herd: alive individual animals + mob head counts. */
  readonly liveTotal: number;
  /** Alive individual animals only (excludes mobs). */
  readonly animalsLive: number;
  /** Sum of mob head counts. */
  readonly mobHead: number;
  /** Every individual animal counted by status (all statuses, not just live) — the retained record. */
  readonly byStatus: Readonly<Record<AnimalStatus, number>>;
  /** Live head by species (alive animals + mobs). */
  readonly bySpecies: Readonly<Record<string, number>>;
  /** Live head by enterprise id — the FR-017 tile numbers. Null-enterprise head is not tiled. */
  readonly byEnterprise: Readonly<Record<string, number>>;
  /** Live head by camp (land_unit id). Null-location head is not bucketed. */
  readonly byLandUnit: Readonly<Record<string, number>>;
  /** Alive individual animals by sex (mobs have no sex). */
  readonly bySex: Readonly<Record<AnimalSex, number>>;
}

function add(into: Record<string, number>, key: string | null, n: number): void {
  if (key === null) return; // null enterprise/camp is real head but not a bucket
  into[key] = (into[key] ?? 0) + n;
}

export function summariseHerd(input: {
  readonly animals: readonly HerdMember[];
  readonly mobs?: readonly HerdMob[];
}): HerdSummary {
  const byStatus = Object.fromEntries(ANIMAL_STATUSES.map((s) => [s, 0])) as Record<
    AnimalStatus,
    number
  >;
  const bySex = Object.fromEntries(ANIMAL_SEXES.map((s) => [s, 0])) as Record<AnimalSex, number>;
  const bySpecies: Record<string, number> = {};
  const byEnterprise: Record<string, number> = {};
  const byLandUnit: Record<string, number> = {};

  let animalsLive = 0;
  for (const a of input.animals) {
    byStatus[a.status] += 1;
    if (a.status !== 'alive') continue; // only live head feeds the breakdowns below
    animalsLive += 1;
    bySex[a.sex] += 1;
    add(bySpecies, a.species, 1);
    add(byEnterprise, a.enterpriseId, 1);
    add(byLandUnit, a.landUnitId, 1);
  }

  let mobHead = 0;
  for (const m of input.mobs ?? []) {
    const head = m.headCount ?? 0;
    if (head <= 0) continue;
    mobHead += head;
    add(bySpecies, m.species, head);
    add(byEnterprise, m.enterpriseId, head);
    add(byLandUnit, m.landUnitId, head);
  }

  return {
    liveTotal: animalsLive + mobHead,
    animalsLive,
    mobHead,
    byStatus,
    bySpecies,
    byEnterprise,
    byLandUnit,
    bySex,
  };
}
