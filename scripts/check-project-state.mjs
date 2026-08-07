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

const unanswered = [...status.matchAll(/→ _Answer:_\s*(?:\r?\n|$)/g)].length;
if (unanswered > 0) {
  problems.push(`STATUS.md contains ${unanswered} unanswered owner decision(s)`);
}

const roadmapPhases = phaseNames(roadmap);
const checklistPhases = phaseNames(checklist);
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
  `✓ project state is coherent: STATUS ${statusLines}/${STATUS_MAX_LINES} lines, no unanswered decisions, phase names agree`,
);
