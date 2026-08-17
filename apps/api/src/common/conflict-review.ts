/** Deterministic US-040 conflict detection over the append-only event log. */

import { and, eq, gte, isNull, lte, ne, or } from 'drizzle-orm';
import { auditLog, conflictReviews, events, animals } from '@werf/db';
import { isMoreFinal } from '@werf/domain';
import type { CaptureTx, CapturedEvent } from './event-capture';

const DAY_MS = 24 * 60 * 60 * 1_000;

type EventFact = Pick<
  typeof events.$inferSelect,
  'id' | 'type' | 'occurredAt' | 'payload' | 'createdBy' | 'sourceSessionId' | 'batchId'
>;

function byteOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function eventOrder(a: EventFact, b: EventFact): number {
  const time = a.occurredAt.getTime() - b.occurredAt.getTime();
  return time === 0 ? byteOrder(a.id, b.id) : time;
}

function orderedPair(a: EventFact, b: EventFact): readonly [EventFact, EventFact] {
  return byteOrder(a.id, b.id) <= 0 ? [a, b] : [b, a];
}

function fact(event: EventFact) {
  return {
    eventId: event.id,
    type: event.type,
    occurredAt: event.occurredAt.toISOString(),
    recordedBy: event.createdBy,
    sourceSessionId: event.sourceSessionId,
    batchId: event.batchId,
    payload: event.payload,
  };
}

async function recordConflict(
  tx: CaptureTx,
  input: {
    farmId: string;
    userId: string;
    sourceSessionId?: string | undefined;
    kind: 'field_lww' | 'possible_duplicate_birth' | 'status_contradiction';
    subjectId: string;
    field?: string;
    a: EventFact;
    b: EventFact;
    winner?: EventFact;
    winnerValue?: unknown;
    rule: string;
  },
): Promise<void> {
  const [a, b] = orderedPair(input.a, input.b);
  const key = `${input.kind}:${input.field ?? '-'}:${a.id}:${b.id}`;
  const winner =
    input.winner === undefined ? null : { ...fact(input.winner), value: input.winnerValue ?? null };

  await tx
    .insert(auditLog)
    .values({
      farmId: input.farmId,
      userId: input.userId,
      sourceSessionId: input.sourceSessionId,
      tableName: 'events',
      recordId: input.subjectId,
      action: input.kind,
      rule: input.rule,
      conflictKey: key,
      facts: [fact(a), fact(b)],
      winner,
    })
    .onConflictDoNothing({ target: auditLog.conflictKey });

  await tx
    .insert(conflictReviews)
    .values({
      farmId: input.farmId,
      conflictKey: key,
      kind: input.kind,
      subjectId: input.subjectId,
      field: input.field,
      factAEventId: a.id,
      factBEventId: b.id,
      winnerEventId: input.winner?.id,
      rule: input.rule,
      createdBy: input.userId,
      updatedBy: input.userId,
    })
    .onConflictDoNothing({ target: conflictReviews.conflictKey });
}

function asFact(event: CapturedEvent & { sourceSessionId?: string | null }): EventFact {
  return {
    id: event.id,
    type: event.type,
    occurredAt: event.occurredAt,
    payload: event.payload,
    createdBy: event.createdBy,
    sourceSessionId: event.sourceSessionId ?? null,
    batchId: event.batchId,
  };
}

function payload(event: EventFact): Record<string, unknown> {
  return typeof event.payload === 'object' && event.payload !== null
    ? (event.payload as Record<string, unknown>)
    : {};
}

/** O-6: concurrent device edits of the same position field use (occurred_at,id) LWW. */
export async function detectMoveConflicts(
  tx: CaptureTx,
  stored: CapturedEvent,
  userId: string,
  sourceSessionId?: string,
): Promise<void> {
  if (sourceSessionId === undefined || stored.animalId === null) return;
  const current = { ...asFact(stored), sourceSessionId };
  const lower = new Date(stored.occurredAt.getTime() - DAY_MS);
  const upper = new Date(stored.occurredAt.getTime() + DAY_MS);
  const others = await tx
    .select({
      id: events.id,
      type: events.type,
      occurredAt: events.occurredAt,
      payload: events.payload,
      createdBy: events.createdBy,
      sourceSessionId: events.sourceSessionId,
      batchId: events.batchId,
    })
    .from(events)
    .where(
      and(
        eq(events.farmId, stored.farmId),
        eq(events.animalId, stored.animalId),
        eq(events.type, 'move'),
        ne(events.id, stored.id),
        gte(events.occurredAt, lower),
        lte(events.occurredAt, upper),
        isNull(events.deletedAt),
      ),
    );

  for (const other of others) {
    if (other.sourceSessionId === null || other.sourceSessionId === sourceSessionId) continue;
    const latest = eventOrder(current, other) >= 0 ? current : other;
    for (const field of ['toLandUnitId', 'toMobId'] as const) {
      const aValue = payload(current)[field] ?? null;
      const bValue = payload(other)[field] ?? null;
      if (aValue === bValue) continue;
      await recordConflict(tx, {
        farmId: stored.farmId,
        userId,
        sourceSessionId,
        kind: 'field_lww',
        subjectId: stored.animalId,
        field,
        a: current,
        b: other,
        winner: latest,
        winnerValue: payload(latest)[field] ?? null,
        rule: 'Later occurred_at wins; equal instants use the lexicographically later event id.',
      });
    }
  }
}

/** O-7: one calving batch may contain twins; a second similar batch within 24h needs review. */
export async function detectPossibleDuplicateBirth(
  tx: CaptureTx,
  stored: CapturedEvent,
  userId: string,
  sourceSessionId?: string,
): Promise<void> {
  if (stored.animalId === null) return;
  const current = { ...asFact(stored), sourceSessionId: sourceSessionId ?? null };
  const lower = new Date(stored.occurredAt.getTime() - DAY_MS);
  const upper = new Date(stored.occurredAt.getTime() + DAY_MS);
  const others = await tx
    .select({
      id: events.id,
      type: events.type,
      occurredAt: events.occurredAt,
      payload: events.payload,
      createdBy: events.createdBy,
      sourceSessionId: events.sourceSessionId,
      batchId: events.batchId,
    })
    .from(events)
    .where(
      and(
        eq(events.farmId, stored.farmId),
        eq(events.animalId, stored.animalId),
        eq(events.type, 'birth'),
        ne(events.id, stored.id),
        gte(events.occurredAt, lower),
        lte(events.occurredAt, upper),
        isNull(events.deletedAt),
      ),
    );

  for (const other of others) {
    // Calves intentionally emitted from one twin/triplet capture share this id.
    if (current.batchId !== null && current.batchId === other.batchId) continue;
    // Legacy twin captures had no batch id. Same session + same instant is the old legitimate shape.
    if (
      current.batchId === null &&
      other.batchId === null &&
      current.sourceSessionId === other.sourceSessionId &&
      current.occurredAt.getTime() === other.occurredAt.getTime()
    ) {
      continue;
    }
    const a = payload(current);
    const b = payload(other);
    if (a['easeScore'] !== b['easeScore'] || a['multiples'] !== b['multiples']) continue;
    await recordConflict(tx, {
      farmId: stored.farmId,
      userId,
      sourceSessionId,
      kind: 'possible_duplicate_birth',
      subjectId: stored.animalId,
      a: current,
      b: other,
      rule: 'Similar birth facts for the same dam in separate batches within 24 hours require review; neither fact is deleted.',
    });
  }
}

/** O-8: death outranks sale regardless of occurrence or arrival order; both facts remain. */
export async function detectStatusContradiction(
  tx: CaptureTx,
  stored: CapturedEvent,
  userId: string,
  sourceSessionId?: string,
): Promise<void> {
  if (stored.animalId === null || (stored.type !== 'sale' && stored.type !== 'death')) return;
  const opposite = stored.type === 'sale' ? 'death' : 'sale';
  const others = await tx
    .select({
      id: events.id,
      type: events.type,
      occurredAt: events.occurredAt,
      payload: events.payload,
      createdBy: events.createdBy,
      sourceSessionId: events.sourceSessionId,
      batchId: events.batchId,
    })
    .from(events)
    .where(
      and(
        eq(events.farmId, stored.farmId),
        eq(events.animalId, stored.animalId),
        eq(events.type, opposite),
        isNull(events.deletedAt),
      ),
    );
  const current = { ...asFact(stored), sourceSessionId: sourceSessionId ?? null };
  for (const other of others) {
    const winner = current.type === 'death' ? current : other;
    await recordConflict(tx, {
      farmId: stored.farmId,
      userId,
      sourceSessionId,
      kind: 'status_contradiction',
      subjectId: stored.animalId,
      field: 'status',
      a: current,
      b: other,
      winner,
      winnerValue: 'dead',
      rule: 'Status precedence is dead > sold > culled > missing > alive; both source facts remain.',
    });
  }
}

/** Rebuild the animal status projection from all status events, never from arrival order. */
export async function rederiveAnimalStatus(
  tx: CaptureTx,
  farmId: string,
  animalId: string,
  userId: string,
): Promise<void> {
  const rows = await tx
    .select({ id: events.id, type: events.type, occurredAt: events.occurredAt })
    .from(events)
    .where(
      and(
        eq(events.farmId, farmId),
        eq(events.animalId, animalId),
        or(eq(events.type, 'death'), eq(events.type, 'sale'), eq(events.type, 'missing')),
        isNull(events.deletedAt),
      ),
    );
  const mapped = rows.map((row) => ({
    ...row,
    status:
      row.type === 'death'
        ? ('dead' as const)
        : row.type === 'sale'
          ? ('sold' as const)
          : ('missing' as const),
  }));
  const winner = mapped.reduce<(typeof mapped)[number] | undefined>((best, candidate) => {
    if (best === undefined || isMoreFinal(candidate.status, best.status)) return candidate;
    if (candidate.status !== best.status) return best;
    return candidate.occurredAt > best.occurredAt ||
      (candidate.occurredAt.getTime() === best.occurredAt.getTime() && candidate.id > best.id)
      ? candidate
      : best;
  }, undefined);
  if (winner === undefined) return;
  await tx
    .update(animals)
    .set({
      status: winner.status,
      statusAt: winner.occurredAt,
      updatedAt: new Date(),
      updatedBy: userId,
    })
    .where(and(eq(animals.id, animalId), eq(animals.farmId, farmId)));
}

/** A death already present means a later-arriving offline sale is evidence, not a bad transition. */
export async function hasDeathFact(
  tx: CaptureTx,
  farmId: string,
  animalId: string,
): Promise<boolean> {
  const row = await tx
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.farmId, farmId),
        eq(events.animalId, animalId),
        eq(events.type, 'death'),
        isNull(events.deletedAt),
      ),
    )
    .limit(1);
  return row.length > 0;
}
