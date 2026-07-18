# ADR-0004 · One shared schema with validated JSONB, not per-species tables

**Status:** Accepted · **Date:** 2026-07 · **Deciders:** Tech lead

## Context

Werf's product promise is that one farmer with cattle, maize, and a vineyard uses one app (BR-1, FR-002). How do we model an entity that is sometimes a Bonsmara cow, sometimes a Merino ewe, sometimes a block of Chardonnay — without either (a) a table per species or (b) a `data JSONB` free-for-all with no validation?

This is the central schema bet. Getting it wrong means either a migration per new species or a database nobody can query.

## Decision

**One `animals` table. One `blocks` table. Species- and crop-specific attributes in a `attributes JSONB` column, validated by a Zod schema selected on `species`.** The registry of Zod schemas lives in `packages/core/schemas/species/`.

```
animals
  id, farm_id, species, breed, sex, dob, status, ...   ← shared, indexed, queryable
  attributes JSONB                                      ← species-specific, validated
```

```ts
// packages/core/schemas/species/index.ts
export const speciesAttributes = {
  cattle: z.object({ hornStatus: z.enum(['horned','polled','dehorned']).optional(),
                     frameScore: z.number().min(1).max(9).optional() }),
  sheep:  z.object({ woolClass: z.string().optional(),
                     tailStatus: z.enum(['intact','docked']).optional() }),
  goat:   z.object({ ... }),
} as const;
```

Validation happens in **both** places using the identical schema object: client before local write, server before persist.

## Why

**Per-species tables (`cattle`, `sheep`, `pigs`) — rejected.** It is the "correct" relational answer and it is wrong here:
- Every query for a mixed farm becomes a UNION across N tables. "How many animals do I have?" should not be a five-way union.
- Every shared feature (weights, treatments, movements, financial attribution) is written N times or forced into polymorphic joins that are worse than JSONB.
- Adding "Game" or "Ostrich" is a migration, a deploy, and a sync-rule change. **It should be a config change.** This is the difference between a product that grows and one that requires us for every growth.
- The competitors that did this are exactly the ones that sell a module per species, which is the complaint their users have.

**Unvalidated `data JSONB` — rejected.** Unqueryable, undocumented, and it rots. Within a year `hornStatus`, `horn_status`, and `horns` all exist and nobody knows which is real.

**Single-table inheritance with 60 nullable columns — rejected.** `wool_class` is NULL on every cow forever. The table becomes unreadable and every new species widens it.

**The bet:** shared *behaviour* lives in typed columns; species *idiosyncrasy* lives in validated JSONB. The 90% of the product that is "record something that happened to an animal" works identically for a cow and an ostrich, because it genuinely is identical. The 10% that differs is data, not schema.

## Rules that make this survivable

These are not guidelines. Without them, JSONB rots.

1. **Anything queried, filtered, sorted, or reported on is a real column.** JSONB is for attributes that are displayed and captured, never for anything a report groups by. When an attribute graduates to being reported on, it gets promoted to a column with a migration. That promotion is expected and normal, not a failure.
2. **Every `attributes` write validates against the species schema.** No exceptions, both sides.
3. **Schemas are additive and versioned.** Never remove a key; deprecate it. A device offline for six weeks will write against an old schema, and that write must survive.
4. **GIN index on `attributes`** for the rare ad-hoc query.
5. **The species registry is code, not config.** Adding a species is a PR that adds a Zod schema, a terminology entry, and a sync-rule entry — reviewed, typed, tested. Not a database row an admin edits at midnight.

## Consequences

| | |
|---|---|
| ➕ | Mixed farms are the *natural* case, not a special case |
| ➕ | Shared features are written once |
| ➕ | New species ≈ one PR, no migration |
| ➕ | The product promise (BR-1) is structurally true, not a UI trick |
| ➖ | JSONB is not type-safe at the database level — Zod is the only guard |
| ➖ | Ad-hoc JSONB queries are awkward and slow |
| ➖ | Discipline required: rule 1 will be violated under deadline pressure |
| ➖ | Reviewers must know the promotion rule |

Rule 1 is the one that decays. The lint rule cannot catch it; only review can. It is called out in CLAUDE.md and in the schema doc for that reason.

## Same pattern, elsewhere

`blocks.attributes` (row crop vs orchard vs vineyard), `events.payload` (per event type). Same rules. `events.payload` is the one to watch — it is the highest-volume table and the most tempting place to hide a column.

## Revisit if

A species needs >20 JSONB keys (it wants tables) · A report needs to group by a JSONB key on 100k+ rows (promote the column) · JSONB validation errors appear in production (the discipline has failed; fix the process, not the schema).
