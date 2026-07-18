// Placeholder for db:migrate / db:generate / db:seed. There is no schema in Phase 0.
// Real Drizzle migrations and the synthetic-only seed (obviously fake, invalid SA ID
// checksums) arrive in Phase 1. See docs/03-architecture/database-schema.md.
const task = process.argv[2] ?? 'db';
console.log(`[@werf/db] "${task}" is a Phase 1+ task — no schema exists yet in Phase 0.`);
process.exit(0);
