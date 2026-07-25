/**
 * The herds a session carries (FR-113). One read, shared by the two places that assemble a
 * `SessionFarm` — the auth session and the farms module — so the client is never told about a
 * farm's herds by one path and left guessing by the other.
 *
 * ACTIVE enterprises only. A retired one (the farmer stopped growing maize) keeps its rows and its
 * history forever, but must not be offered as a herd to file a new capture under.
 */

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { enterprises, type AppDb } from '@werf/db';
import type { schemas } from '@werf/core';

type Tx = Parameters<Parameters<AppDb['asUser']>[1]>[0];

/** The active enterprises of each given farm, keyed by farm id. Farms with none map to nothing. */
export async function enterprisesByFarm(
  tx: Pick<Tx, 'select'>,
  farmIds: readonly string[],
): Promise<Map<string, schemas.SessionEnterprise[]>> {
  const byFarm = new Map<string, schemas.SessionEnterprise[]>();
  if (farmIds.length === 0) return byFarm;

  const rows = await tx
    .select({
      id: enterprises.id,
      farmId: enterprises.farmId,
      name: enterprises.name,
      type: enterprises.type,
    })
    .from(enterprises)
    .where(
      and(
        inArray(enterprises.farmId, [...farmIds]),
        eq(enterprises.active, true),
        isNull(enterprises.deletedAt),
      ),
    );

  for (const row of rows) {
    const list = byFarm.get(row.farmId) ?? [];
    list.push({ id: row.id, name: row.name, type: row.type });
    byFarm.set(row.farmId, list);
  }
  return byFarm;
}
