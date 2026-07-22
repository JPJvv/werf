// Bundle size gate (NFR-009, .claude/rules/frontend.md): the shipped JS must stay
// under 250 KB gzipped, and going over FAILS the build — it does not merely warn.
//
// Phase 1 measured the bundle at ~99 KB gz but nothing enforced the ceiling, so a
// careless dependency could have quietly blown past it. This closes that gap.
//
// We measure every hashed JS chunk under dist/assets — the entry plus any lazy
// chunks a future code-split adds — because all of it is app code the farmer's
// phone must pull. The service-worker runtime (sw.js / workbox-*.js) is excluded:
// it is Workbox's own precache plumbing, not our bundle, and it is what makes the
// PWA offline in the first place. CSS is measured separately below for visibility
// but is not counted against the JS budget.
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
let cssTotal = 0;
for (const entry of entries) {
  if (!entry.isFile()) continue;
  if (entry.name.endsWith('.js')) js.push({ name: entry.name, gz: gzippedSize(entry.name) });
  else if (entry.name.endsWith('.css')) cssTotal += gzippedSize(entry.name);
}

if (js.length === 0) {
  console.error('✗ bundle-size gate: no JS chunks found in dist/assets. Did the build emit?');
  process.exit(1);
}

js.sort((a, b) => b.gz - a.gz);
const total = js.reduce((sum, chunk) => sum + chunk.gz, 0);

console.log('Bundle size (gzipped JS chunks):');
for (const chunk of js) console.log(`  ${chunk.name.padEnd(32)} ${fmt(chunk.gz).padStart(10)}`);
console.log(`  ${'—'.repeat(32)} ${'—'.repeat(10)}`);
console.log(`  ${'total JS'.padEnd(32)} ${fmt(total).padStart(10)}  (budget ${fmt(BUDGET_BYTES)})`);
if (cssTotal > 0) console.log(`  ${'(css, not counted)'.padEnd(32)} ${fmt(cssTotal).padStart(10)}`);

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
