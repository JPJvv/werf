# STATUS — where this build actually is

> **Read this first, before planning anything.** It is the live pointer between sessions.
> `CLAUDE.md` links here. Update it at the end of every session and commit it with the work.

**Last updated:** 2026-07-25 · **Branch:** `docs/phase-3-6-scope` @ `86b40c9`

---

## 1. Position

| | |
|---|---|
| **Phase 0** — scaffold | ✅ Merged to `main`. Repo public, CI green, branch protection on |
| **Phase 1** — auth, sync, onboarding | ✅ Merged to `main` as `9452ebc` (PR #2, both CI lanes green) |
| **Phase 2** — livestock & crops | 🟡 **Code complete, NOT merged.** All checklist items closed on `phase-2/livestock` @ `86f9330`. `pnpm verify` green: 548 unit + 18 e2e |
| **Phase 3** — labour & wages 🇿🇦 | ⬜ Not started. **Critical path.** Spec expanded this session (3i/3j/3k added) |
| **Phases 4–7** | ⬜ Not started. Scope expanded this session (4i/4j fuel + refund, 5e/5f photo flag, 6 price board) |

**Working tree is clean. Every branch is pushed. No stashes.**

```
main                   9452ebc   (Phase 0 + 1)
phase-2/livestock      86f9330   pushed, no PR yet
docs/phase-3-6-scope   86b40c9   pushed, no PR yet   ← HEAD, stacked on phase-2
```

---

## 2. ⚠️ Decisions needed from JP before work continues

**These block the next session. Nothing below should be guessed.**

1. **Phase 2 PR — open it now, or run the review agents first?**
   The plan of record was `reviewer` + `sync-auditor`, *then* the PR. Neither agent has run.
   → _Answer:_

2. **`docs/phase-3-6-scope` — stacked PR, or wait?**
   It is stacked on `phase-2/livestock` because its edits build on Phase 2 content (FR-113,
   rainfall). A PR opened now must target `phase-2/livestock`, and shows ~37 commits until
   Phase 2 merges. The alternative is waiting for Phase 2 to merge, then cherry-picking these
   two commits onto `main` for a clean docs-only diff.
   → _Answer:_

3. **What is the next slice — Phase 3a, or the Phase 3 checklist first?**
   `phase-checklists.md` stops at Phase 2 ("Phases 3–7 — to be written"). The roadmap names
   sub-phases 3a…3l but no slice checklists exist behind them. Recommend writing Phase 3's
   checklist as the next slice, because `/loop` works a checklist item at a time and has
   nothing to consume otherwise.
   → _Answer:_

4. **🇿🇦 Has the labour-law review been booked?**
   The roadmap says book it *in Phase 2*, and it **gates Phase 3** (sub-phase 3l). It is on
   someone else's calendar. Phase 2 is ending now.
   → _Answer:_

5. **🇿🇦 Have the SA wage figures been re-verified against the current Gazette?**
   `legal-compliance.md §2.2` is dated July 2026 and self-describes as decaying. Phase 3
   must not start against stale numbers — this is stated as a precondition of the phase.
   → _Answer:_

6. **Should the SAFEX / red-meat data licence conversations start now?**
   The price board is Phase 6, but both feeds are blocked on commercial agreements. ADR-0009
   says start them in Phase 4 for the same reason the legal review starts early: someone
   else's calendar.
   → _Answer:_

---

## 3. Known gaps — carried forward, not forgotten

| # | Gap | Where it bites |
|---|---|---|
| G1 | **`pnpm test:trace` does not exist.** `functional-requirements.md` claims it fails CI when a P1/P2 FR has no covering test. Nothing implements it | 174 FRs now ride on a gate that is not there. Write it, or soften the claim |
| G2 | **`phase-checklists.md` stops at Phase 2** | Blocks `/loop` for Phase 3+. See decision 3 |
| G3 | **Equipment register (FR-504) has no table.** `vehicles` carries a comment to add `equipment_id` additively when it lands | Phase 4i |
| G4 | **`user-guide.md` and `ux-design-system.md` not updated** for this session's scope — deliberate, the features do not exist yet | Needs a pass when Phase 3/4 build them. The **grievance flow needs real UX care**: the confidentiality promise must be legible to a low-literacy user in their own language, or it is not a promise |
| G5 | **CI never runs on feature branches** (see env-gotchas). Green locally ≠ green in CI until the PR opens | Both open branches |

---

## 4. This session's output (2026-07-25)

Two docs-only commits on `docs/phase-3-6-scope`. FRs **125 → 174**. No code changed.

- `85ffaa7` — fuel & fleet (FR-509…518), SARS diesel refund (FR-616…619), market prices
  (FR-901…908, ADR-0009), delegation + worker voice + safety (FR-321…342, ADR-0010)
- `86b40c9` — propagated into SRS (§2.2, §2.3, SRS-14a…14d) and use-cases (UC-060, UC-070)

**Three decisions taken this session that should not be relitigated without reading the ADR:**

- **Worker tracking was refused** → [ADR-0010](docs/03-architecture/adr/ADR-0010-worker-monitoring.md).
  Three independent reasons: a PWA cannot do reliable background geolocation; POPIA minimality
  is not satisfied when event-stamped location serves the purpose; and worker surveillance
  contradicts the SIZA compliance this product sells. Replaced by a worker-initiated panic
  alert (FR-340). **"Can you track my workers" will be asked at every demo — the answer is
  the ADR, not a shrug.**
- **Market data is tiered by licence** → [ADR-0009](docs/03-architecture/adr/ADR-0009-market-data-feeds.md).
  DMRE fuel prices are public and ship alone if necessary; SAFEX and red meat are gated.
- **Fuel landed in Phase 4, after `regulatory_rates` exists in Phase 3.** The SARS refund
  percentage moved 80% → 100% on 2026-04-01, so a return spanning that date applies both —
  structurally identical to a pay period spanning 1 March. Building fuel capture earlier
  invites the hardcoded constant.

---

## 5. How to resume

```
Read STATUS.md, CLAUDE.md, and docs/04-delivery/phase-checklists.md.
Answer the decisions in STATUS.md §2 with me before planning.
```
