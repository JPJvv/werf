# Werf documentation authority map

**Status:** Active | **Owner:** JP | **Last reviewed:** 2026-08-09

This is the front door to Werf's planning pack. It prevents a delivery note, agent instruction or
old hosting estimate from silently overriding an accepted product or architecture decision.

## Precedence

When two documents disagree, use this order and open an explicit decision if the conflict remains:

1. An owner decision recorded in `STATUS.md`, or an accepted ADR for its specific concern.
2. `00-business/legal-compliance.md` for regulated behaviour and `compliance-register.md` for the
   evidence obligation. Current primary law still outranks our summary.
3. `01-requirements/functional-requirements.md` and `non-functional-requirements.md` for observable
   product behaviour; `SRS.md` supplies context, not a second requirement list.
4. The concern-specific architecture document: database schema, offline sync, API or security.
5. `02-design/ux-design-system.md` for interaction and visual rules.
6. Roadmap and phase checklists for sequence. They do not weaken a requirement.
7. `CLAUDE.md`, `AGENTS.md`, hooks and agent profiles for working method only. They may not invent
   product, legal or architecture decisions.

`STATUS.md` is the live delivery pointer and the only place for questions currently blocking the
next slice. Stable decisions must graduate to the relevant document or ADR.

## Pack map

| Question | Authoritative document |
|---|---|
| What problem and launch outcome? | `00-business/BRD.md` |
| What must the product do? | `01-requirements/functional-requirements.md` |
| What quality/security bar applies? | `01-requirements/non-functional-requirements.md` |
| What law or audit evidence applies? | `00-business/legal-compliance.md`, `compliance-register.md` |
| Why this system shape? | `03-architecture/architecture.md`, accepted ADRs |
| What is the database contract? | `03-architecture/database-schema.md` |
| How does offline reconciliation work? | `03-architecture/offline-sync.md` |
| What is the API contract? | `03-architecture/api-specification.md` |
| What is the security model? | `05-operations/security.md`, ADR-0007 and ADR-0011 |
| How should it look and behave? | `02-design/ux-design-system.md` |
| What is built next? | `STATUS.md`, then `04-delivery/roadmap.md` and `phase-checklists.md` |
| How is correctness proved? | `04-delivery/testing-strategy.md`, `ci-cd.md` |
| How is it deployed and operated? | `05-operations/deployment-guide.md`, runbooks |
| What should Claude Code do? | `CLAUDE.md`, then `.claude/rules/` |
| What should Codex do? | `AGENTS.md`, which delegates project authority to Claude-owned guidance |

## Document-state labels

- **Accepted/active:** binding until an explicit replacement is recorded.
- **Target:** intended end state; implementation may lag and the document must say where.
- **Mixed:** contains both implemented and target behaviour; every important section must identify
  which is which.
- **Historical/superseded:** kept for rationale, never used as the current contract.

The implementation is evidence, not permission to contradict the plan. Conversely, a target-state
document must not be presented as proof that a control is deployed.

## Planning quality controls

- Every regulated rule has a stable requirement/rule ID, owner, source and effective date.
- Every material architecture decision gets an ADR; later edits do not rewrite its history.
- Every phase exit names verification evidence and unresolved external gates.
- Every security control is labelled application, database, edge or operational so a local unit
  test is never mistaken for a production perimeter.
- Links, phase numbers and provider choices are checked when the phase map or an ADR changes.
