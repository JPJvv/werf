// Bundle size gate (NFR-009, .claude/rules/frontend.md): the INTERACTIVE-PATH JS —
// what the farmer's phone must fetch and execute before the app can respond to a
// tap — must stay under 250 KB gzipped, and going over FAILS the build.
//
// Phase 1 measured the bundle at ~99 KB gz but nothing enforced the ceiling, so a
// careless dependency could have quietly blown past it. This closes that gap.
//
// Phase 3 (phase-checklists.md 3c) added the PowerSync/wa-sqlite local-database
// engine, code-split behind a dynamic import and PRECACHED by Workbox rather than
// fetched on demand — see vite.config.ts's `workbox.maximumFileSizeToCacheInBytes`
// comment for why on-demand caching is unsafe here (an evicted runtime-cache entry
// met by a farmer in a dead zone, with a migration marker already committed, is the
// exact "half of each" state that slice exists to prevent). Precached-but-not-on-
// the-interactive-path is a THIRD category this budget did not have before: it is
// downloaded once, during an SW install that already needs a network, never on a
// capture. Counting it against the same 250 KB as index.js would conflate "the app
// shell must be small enough to render fast" with "a one-time engine download is
// cheap enough" — two different NFRs wearing one number. So `ENGINE_CHUNK_BASENAMES`
// below (the exact set of chunks the wa-sqlite/PowerSync build graph produces,
// confirmed against a real build, not guessed) is excluded from the JS-gz sum and
// reported separately for visibility. This is a narrow, named exclusion — not "lazy
// chunks are free" — a future code-split of actual APP code still counts in full,
// per this script's original reasoning below.
//
// We measure every OTHER hashed JS chunk under dist/assets — the entry plus any
// lazy chunks a future code-split adds — because all of it is app code the farmer's
// phone must pull on the interactive path. The service-worker runtime (sw.js /
// workbox-*.js) is excluded: it is Workbox's own precache plumbing, not our bundle,
// and it is what makes the PWA offline in the first place. CSS is measured
// separately below for visibility but is not counted against the JS budget.
//
// gzip level 9 matches how bundlers report "gzip size"; a real CDN at level 6 will
// serve a hair larger, so the check is intentionally the optimistic-but-stable
// number rather than one that drifts with server config.

import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const KB = 1024;
const BUDGET_BYTES = 250 * KB;
const WARN_RATIO = 0.9; // heads-up once we are within 10% of the ceiling

// The exact chunk basenames the PowerSync/wa-sqlite build graph produces (confirmed against a
// real `vite build`, 2026-08-09) — every VFS backend the SDK feature-detects between at runtime,
// its worker, and the websocket transport `.connect()` needs. A basename not in this set is
// counted normally, so an unrelated future chunk that happens to load lazily is never silently
// exempted — only these specific, named, precached engine pieces are.
const ENGINE_CHUNK_BASENAMES = new Set([
  'local-database',
  'websockets',
  'worker',
  'wa-sqlite',
  'wa-sqlite-async',
  'mc-wa-sqlite',
  'mc-wa-sqlite-async',
  'OPFSWriteAheadVFS',
  'OPFSCoopSyncVFS',
  'IDBBatchAtomicVFS',
  'FacadeVFS',
  'AccessHandlePoolVFS',
  'MemoryVFS',
]);

/** Strips a Rollup content hash (`-XXXXXXXX.js`) to recover the chunk's source basename. */
function chunkBasename(fileName) {
  const match = /^(.+)-[A-Za-z0-9_-]{8}\.js$/.exec(fileName);
  return match ? match[1] : fileName;
}

const assetsDir = fileURLToPath(new URL('../dist/assets', import.meta.url));

const fmt = (bytes) => `${(bytes / KB).toFixed(2)} KB`;

let entries;
try {
  entries = readdirSync(assetsDir, { withFileTypes: true });
} catch {
  console.error(
    `✗ bundle-size gate: ${assetsDir} not found. Run \`vite build\` before the size check.`,
  );
  process.exit(1);
}

const gzippedSize = (name) =>
  gzipSync(readFileSync(fileURLToPath(new URL(`../dist/assets/${name}`, import.meta.url)), {}), {
    level: 9,
  }).length;

const js = [];
const engine = [];
let cssTotal = 0;
for (const entry of entries) {
  if (!entry.isFile()) continue;
  if (entry.name.endsWith('.js')) {
    const chunk = { name: entry.name, gz: gzippedSize(entry.name) };
    if (ENGINE_CHUNK_BASENAMES.has(chunkBasename(entry.name))) engine.push(chunk);
    else js.push(chunk);
  } else if (entry.name.endsWith('.css')) {
    cssTotal += gzippedSize(entry.name);
  }
}

if (js.length === 0 && engine.length === 0) {
  console.error('✗ bundle-size gate: no JS chunks found in dist/assets. Did the build emit?');
  process.exit(1);
}

js.sort((a, b) => b.gz - a.gz);
engine.sort((a, b) => b.gz - a.gz);
const total = js.reduce((sum, chunk) => sum + chunk.gz, 0);
const engineTotal = engine.reduce((sum, chunk) => sum + chunk.gz, 0);

console.log('Bundle size (gzipped JS chunks):');
for (const chunk of js) console.log(`  ${chunk.name.padEnd(32)} ${fmt(chunk.gz).padStart(10)}`);
console.log(`  ${'—'.repeat(32)} ${'—'.repeat(10)}`);
console.log(`  ${'total JS'.padEnd(32)} ${fmt(total).padStart(10)}  (budget ${fmt(BUDGET_BYTES)})`);
if (cssTotal > 0) console.log(`  ${'(css, not counted)'.padEnd(32)} ${fmt(cssTotal).padStart(10)}`);
if (engine.length > 0) {
  console.log(
    `\nPrecached local-database engine (gzipped, NOT counted against the interactive-path budget — see this script's header):`,
  );
  for (const chunk of engine)
    console.log(`  ${chunk.name.padEnd(32)} ${fmt(chunk.gz).padStart(10)}`);
  console.log(`  ${'—'.repeat(32)} ${'—'.repeat(10)}`);
  console.log(`  ${'total engine (precached)'.padEnd(32)} ${fmt(engineTotal).padStart(10)}`);
}

if (total > BUDGET_BYTES) {
  console.error(
    `\n✗ bundle-size gate FAILED: ${fmt(total)} gz exceeds the ${fmt(BUDGET_BYTES)} budget by ${fmt(
      total - BUDGET_BYTES,
    )} (NFR-009).`,
  );
  process.exit(1);
}

if (total > BUDGET_BYTES * WARN_RATIO) {
  console.warn(
    `\n⚠ bundle-size gate: ${fmt(total)} gz is within 10% of the ${fmt(
      BUDGET_BYTES,
    )} budget. Adding weight will start failing the build.`,
  );
}

console.log(`\n✓ bundle-size gate passed: ${fmt(total)} gz ≤ ${fmt(BUDGET_BYTES)}.`);
