/**
 * FR traceability — which functional requirements have a test that names them.
 *
 * `functional-requirements.md` and `SRS.md` both say every FR must be traceable to at least one
 * automated test. Until this script existed they said it and nothing checked it, which is the
 * failure mode this repo files as a doc/reality gap (STATUS.md G1): a claimed gate is worse than
 * an absent one, because a reader stops looking.
 *
 * ⚠️ THIS IS A REPORT, NOT A GATE. It exits 0 whatever it finds unless `--strict` is passed, and
 * nothing in CI passes `--strict` today. That is deliberate rather than timid: the baseline has
 * never been measured, and wiring an unmeasured gate into CI immediately before the first PR this
 * repo has ever opened would put a red tick on work that is actually fine. Measure first, agree a
 * baseline, then turn it on — and when you do, update the four documents listed at the bottom of
 * this file so the claim and the behaviour move together.
 *
 * ⭐ What it can and cannot tell you. It proves a test NAMES an FR. It cannot prove the test
 * exercises it — `it('FR-999 works')` with an empty body counts here and is worth nothing. Read
 * this as "which requirements nobody has even claimed to cover", which is a real and useful
 * question, and not as evidence of coverage.
 *
 * Usage:
 *   node scripts/test-trace.mjs            # report, always exits 0
 *   node scripts/test-trace.mjs --strict   # exit 1 if any P1/P2 FR is uncovered
 *   node scripts/test-trace.mjs --all      # list covered FRs too
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CATALOGUE = join(ROOT, 'docs', '01-requirements', 'functional-requirements.md');

/** Sub-IDs are real and load-bearing: FR-014a (recovery codes) is not FR-014 (2FA). */
const FR_ID = /FR-\d{3}[a-z]?/g;

/** A test title is what `describe`, `it` or `test` was called with. */
const TEST_TITLE = /\b(?:describe|it|test)\s*(?:\.\w+)?\s*\(\s*(['"`])([\s\S]*?)\1/g;

const TEST_FILE = /\.(test|spec)\.(ts|tsx|js|jsx|mts)$/;
const SKIP_DIR = new Set([
  'node_modules',
  'dist',
  '.git',
  '.turbo',
  'coverage',
  'playwright-report',
]);

/**
 * The catalogue rows: `| FR-101 | Some requirement | 1 |`. The priority is sometimes bolded
 * (`| **1** |`) for the ones the author wanted to shout about, so the stars are stripped rather
 * than matched — a formatting choice must not silently drop a requirement from the count.
 */
function readCatalogue() {
  const rows = [];
  for (const line of readFileSync(CATALOGUE, 'utf8').split('\n')) {
    const m = /^\|\s*(FR-\d{3}[a-z]?)\s*\|(.+)\|\s*\**\s*([123])\s*\**\s*\|?\s*$/.exec(line);
    if (m) rows.push({ id: m[1], priority: Number(m[3]), text: m[2].trim() });
  }
  return rows;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIR.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (TEST_FILE.test(entry)) yield full;
  }
}

/** FR id → the test files whose TITLES name it. */
function readCoverage() {
  const covered = new Map();
  let files = 0;
  for (const file of walk(ROOT)) {
    files++;
    const source = readFileSync(file, 'utf8');
    for (const [, , title] of source.matchAll(TEST_TITLE)) {
      for (const id of title.matchAll(FR_ID)) {
        const where = covered.get(id[0]) ?? new Set();
        where.add(relative(ROOT, file).split(sep).join('/'));
        covered.set(id[0], where);
      }
    }
  }
  return { covered, files };
}

const strict = process.argv.includes('--strict');
const showAll = process.argv.includes('--all');

const catalogue = readCatalogue();
if (catalogue.length === 0) {
  console.error(`test:trace: parsed 0 requirements from ${relative(ROOT, CATALOGUE)}.`);
  console.error('That is a parser failure, not an empty catalogue. Exiting 1.');
  process.exit(1);
}

const { covered, files } = readCoverage();
const uncovered = catalogue.filter((fr) => !covered.has(fr.id));
const byPriority = (p) => uncovered.filter((fr) => fr.priority === p);

console.log(`FR traceability — ${catalogue.length} requirements, ${files} test files scanned\n`);

for (const p of [1, 2, 3]) {
  const total = catalogue.filter((fr) => fr.priority === p).length;
  const missing = byPriority(p).length;
  const label = { 1: 'P1 (MVP, phases 1–3)', 2: 'P2 (launch, phases 4–5)', 3: 'P3 (post-launch)' }[
    p
  ];
  console.log(
    `  ${label.padEnd(26)} ${String(total - missing).padStart(3)}/${String(total).padEnd(3)} named by a test`,
  );
}

const naming = catalogue.length - uncovered.length;
console.log(
  `  ${'TOTAL'.padEnd(26)} ${String(naming).padStart(3)}/${String(catalogue.length).padEnd(3)}\n`,
);

for (const p of [1, 2, 3]) {
  const missing = byPriority(p);
  if (missing.length === 0) continue;
  console.log(`P${p} with no test naming them (${missing.length}):`);
  for (const fr of missing) {
    // The requirement text is truncated hard: this is a to-do list, not a second copy of the
    // catalogue. Go and read the real one.
    const text = fr.text.replace(/\s+/g, ' ').slice(0, 88);
    console.log(`  ${fr.id}  ${text}${fr.text.length > 88 ? '…' : ''}`);
  }
  console.log('');
}

if (showAll) {
  console.log('Named by at least one test:');
  for (const fr of catalogue.filter((f) => covered.has(f.id))) {
    console.log(`  ${fr.id}  ${[...covered.get(fr.id)].join(', ')}`);
  }
  console.log('');
}

// An FR id named by a test but absent from the catalogue is a typo or a deleted requirement, and
// it is worth surfacing: a test asserting FR-9999 is a test nobody can trace back to anything.
const known = new Set(catalogue.map((fr) => fr.id));
const orphans = [...covered.keys()].filter((id) => !known.has(id)).sort();
if (orphans.length > 0) {
  console.log(
    `Named by a test but NOT in the catalogue (${orphans.length}) — typo or removed requirement:`,
  );
  for (const id of orphans) console.log(`  ${id}  ${[...covered.get(id)].join(', ')}`);
  console.log('');
}

const blocking = byPriority(1).length + byPriority(2).length;
if (strict && blocking > 0) {
  console.error(`test:trace --strict: ${blocking} P1/P2 requirements have no test naming them.`);
  process.exit(1);
}

console.log(
  strict
    ? 'test:trace --strict: every P1/P2 requirement is named by a test.'
    : 'Report only — this does not fail the build. Pass --strict to make it exit 1.\n' +
        'Before turning --strict on in CI, update the claim in: docs/01-requirements/functional-requirements.md,\n' +
        'docs/01-requirements/SRS.md, docs/04-delivery/testing-strategy.md and docs/04-delivery/ci-cd.md.',
);
