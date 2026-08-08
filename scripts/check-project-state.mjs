import { readFile } from 'node:fs/promises';

const STATUS_MAX_LINES = 300;

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function phaseNames(markdown) {
  const phases = new Map();
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^## Phase (\d+)\s*(?:[—·-])\s*([^🇿]+?)(?:\s+🇿🇦.*)?$/u);
    if (!match) continue;
    phases.set(Number(match[1]), match[2].replace(/\s+—.*$/, '').trim());
  }
  return phases;
}

const [status, roadmap, checklist] = await Promise.all([
  read('STATUS.md'),
  read('docs/04-delivery/roadmap.md'),
  read('docs/04-delivery/phase-checklists.md'),
]);

const problems = [];
const statusLines = status.split(/\r?\n/).length;
if (statusLines > STATUS_MAX_LINES) {
  problems.push(
    `STATUS.md is ${statusLines} lines (limit ${STATUS_MAX_LINES}); keep it as a current handoff and rely on git history for old sessions`,
  );
}

// ⛔ An unanswered owner decision is a WARNING, never a failure. CLAUDE.md says STATUS.md
// "carries questions addressed to the repo owner — ask them, do not guess the answers", and this
// check used to exit 1 on exactly that marker: the only recorded way to leave a question open
// broke the definition of done. The pressure that creates is to delete the question or invent an
// answer to get the gate green, which is the precise failure the rule exists to prevent. CI can
// opt in with `--strict` for a release gate; a working session must be able to leave a question
// standing. Found by the tenth pass.
const strict = process.argv.includes('--strict');
const unanswered = [...status.matchAll(/→ _Answer:_\s*(?:\r?\n|$)/g)].length;
if (unanswered > 0) {
  const message = `STATUS.md contains ${unanswered} unanswered owner decision(s) — ask them, do not guess`;
  if (strict) problems.push(message);
  else console.warn(`! ${message}`);
}

const roadmapPhases = phaseNames(roadmap);
const checklistPhases = phaseNames(checklist);
// ⛔ A cross-check over an empty map PASSES. Both headings parse today, but a heading-style edit
// would make this gate silently vacuous rather than red — the "gate claims that cannot fail"
// class this repo has already been bitten by twice. Assert there is something to compare.
if (roadmapPhases.size === 0 || checklistPhases.size === 0) {
  problems.push(
    `phase headings did not parse (roadmap ${roadmapPhases.size}, checklist ${checklistPhases.size}) — the phase-name cross-check would pass without comparing anything`,
  );
}
for (const [number, name] of checklistPhases) {
  const roadmapName = roadmapPhases.get(number);
  if (roadmapName !== undefined && roadmapName !== name) {
    problems.push(
      `Phase ${number} disagrees: roadmap says "${roadmapName}", checklist says "${name}"`,
    );
  }
}

if (problems.length > 0) {
  console.error('Project-state check failed:\n');
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log(
  `✓ project state is coherent: STATUS ${statusLines}/${STATUS_MAX_LINES} lines, ${unanswered} open owner decision(s), ${checklistPhases.size} phase names agree with the roadmap`,
);
