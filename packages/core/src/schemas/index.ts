/**
 * Zod schemas are the single source of truth for validation. Derive TS types with
 * `z.infer`; never hand-write a type that duplicates a schema. Client and server
 * validate with the identical schema object.
 *
 * Primitives live in ./primitives, entity schemas in ./entities; this barrel re-exports
 * both. Entity modules import primitives directly (never through this barrel) to avoid a
 * cycle. Further entity schemas (animals, events, employees) arrive with their phases.
 */

export * from './primitives';
export * from './entities';
export * from './auth';
export * from './farms';
export * from './land';
