/**
 * Species-specific animal attributes (FR-107) — the write-path guard over the `attributes` JSONB.
 *
 * The SHAPES live in `@werf/core/schemas` with every other schema, because that is the single
 * source of truth for validation and this package holds no zod. What lives here is the rule about
 * them: refuse an attribute the species does not have, and say which one, in words a capture screen
 * can render and an API can turn into a 400 the outbox knows how to explain.
 *
 * Pure (.claude/rules/domain.md): no I/O, no clock. Used by BOTH the offline capture screen and the
 * server write path, so a value the device accepts is one the server accepts.
 */

import { ValidationError, schemas, type Species } from '@werf/core';

/**
 * Validate an animal's attributes against its species, returning the parsed record.
 *
 * Throws a typed `ValidationError` naming the offending key rather than returning a boolean,
 * because every caller is a write path and the answer it needs is "which field, and why".
 *
 * ⭐ An EMPTY record is valid on every species, and that is not laziness. Attributes are optional by
 * nature: a farmer tagging fifty head in a crush is not stopping to record horn status on each one,
 * and demanding it would mean the animal does not get recorded at all. What is refused is a WRONG
 * attribute, never a missing one.
 */
export function validateAttributes(
  species: Species,
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  const result = schemas.attributeSchemaFor(species).safeParse(attributes);
  if (result.success) return result.data as Record<string, unknown>;

  const issue = result.error.issues[0];
  // `unrecognized_keys` is the interesting case, and the key is not in `path` — it is on the issue.
  const unrecognised =
    issue?.code === 'unrecognized_keys' ? (issue as { keys?: string[] }).keys?.[0] : undefined;
  if (unrecognised !== undefined) {
    throw new ValidationError(`A ${species} does not have a '${unrecognised}'`);
  }

  const key = issue?.path.join('.') ?? '';
  throw new ValidationError(
    key === '' ? `Invalid attributes for a ${species}` : `Invalid '${key}' for a ${species}`,
  );
}
