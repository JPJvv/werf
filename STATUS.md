# STATUS — where this build actually is

> **Read this first, before planning anything.** It is the live pointer between sessions.
> `CLAUDE.md` links here. Update it at the end of every session and commit it with the work.

**Last updated:** 2026-08-05 (EIGHTEENTH session — the NINTH pass; **§7 clause 4 FIRED**; two SEV-2s
fixed by REPLACING the outbox hold mechanism rather than widening it a sixth time) ·
**Branch:** `phase-2/livestock`, **ahead of origin** (this file's own commit moves HEAD —
re-read with `git log`).
`pnpm verify` green LOCALLY, exit 0, re-run this session on a quiet machine: **84** files /
**952** tests, bundle **147.77 KB** gz (a real execution, 221s — not a turbo cache replay, and the
distinction is checked below).
`pnpm test:e2e` **NOT re-run this session** — the last figure was 27/27 cold, twice, and it is now
one session stale against a diff that changes the outbox's network shape. Treat it as unverified.
**CI last green at `34e0685`** (run `30807663310`, `gh run view`). ⛔ **Commits since then are NOT
yet CI-verified — push and watch.** See §6 for the compliance operating model, **§7 for the STOPPING
RULE and §7a for the gap using it exposed.**

> ⚠️ **A GATE CAN BE GREEN WITHOUT HAVING RUN.** The first `pnpm verify` this session reported
> `FULL TURBO`, 7 cached, **112ms** — a legitimate cache replay of §2q's inputs, and no test
> executed. The one uncached run that session FAILED on `Port 5432/tcp not bound` because three
> review agents were competing for Docker at the time. **Do not schedule the gate alongside agents,
> and read the duration: a verify that returns in milliseconds proved nothing today.**

> ⚠️ **The figures in this header were STALE when the sixteenth session opened** — it claimed 934
> tests and 146.45 KB, both superseded by §2o's own numbers one section below. **Fourth consecutive
> session in which something in §1 was stale.** The tree/SHA claim is now checked every session; the
> FIGURES were not, and they are the same class. Check both.

> ⭐ **THE SIXTEENTH SESSION (2026-08-04) AUDITED THE DOCUMENTS AND FOUND SIX LIVE CONTRADICTIONS
> WITH THE BUILT SYSTEM — see §2p.** The sharpest is `offline-sync.md` §5 invariant 3, which said
> *"the queue drains in `occurred_at` order"* under a heading reading *"these are not aspirations"*.
> That is the shape of a SEV-1 this repo already shipped and fixed (§2d `16fbb6a`), sitting in the
> document CLAUDE.md points at for "anything about sync". **No agents were run** (not asked; the
> standing rule is owner-triggered only).

> ⛔⭐ **THE NINTH PASS RAN (2026-08-05) AND §7 CLAUSE 4 FIRED — see §2r.** Two SEV-2s, both fixed.
> One was **inside the eighth pass's own fix**: the `head:<mobId>` subject held decreases that needed
> no held head, for ever, and a held capture was reported in NO surface the product had. The other
> was the theft-record fix stopping at the screen while its own comment documented the open boundary.
> **Nine for nine.** ⭐ **No tenth pass was spawned — that is the rule working, not the rule being
> ignored.** JP's call was to REPLACE the mechanism: head availability is now arithmetic (the
> device runs the server's own fold) rather than a subject, and held captures are surfaced.
>
> ⛔ **The sharpest finding is not either SEV-2. §2q claimed "all 14 pre-existing outbox tests still
> pass, which is the check that no false hold crept in" — and NOT ONE of them refuses an increase, so
> that check was impossible.** A gate claim that cannot fail is worse than a test that cannot fail,
> because it is the sentence that ends the argument. §2q is corrected in place.
>
> ⚠️ **The agents SPLIT on severity: `reviewer` rated the head-hold defect MED and returned
> APPROVABLE.** It was rated SEV-2 against that vote — `reviewer`'s own finding text says the
> captures are held "indefinitely" with no discard path, which contradicts its rating. **Severity is
> the reviewer's call, not the agent's.**

> ⭐ **THE EIGHTH PASS RAN (2026-08-05) UNDER A STOPPING RULE, AND EVERY SEV-2 IS FIXED (§2q).**
> Three SEV-2s, all inside the seventh pass's own fix commit `34e0685`, one of them two variables
> along from the line it fixed. **Eight for eight.** ⭐ **§7 is the new thing and it matters more than
> the findings: the review loop now has a TERMINAL CONDITION.** A pass clears on no SEV-1/SEV-2;
> MED/LOW are tracked, not blockers; a pass returning only MED/LOW merges its own fixes without
> another pass; hard ceiling of two passes. **Written and committed BEFORE the findings were read.**
> ⛔ **One MED is deliberately unfixed under that rule — the untested batch-link seam. `reviewer`
> wanted it closed; the rule says otherwise. Change the RULE if you disagree, not the one case.**

> ⭐ **THE FOURTEENTH SESSION CLOSED THE LAST OF THE PHASE 2 BUILD LIST.** §2m #1 (the transfer
> batch link, `d0dd571`) and the non-SEV leftovers §2m #2/#3/#5/#6 (`6abb6cf`). **There is now no
> unblocked BUILD work left in Phase 2** — see §2n. **No agents were run** (not asked; the standing
> rule is owner-triggered only).

> ⭐ **AND §4 A9 IS DIAGNOSED AFTER SIX SESSIONS (`3ca3a2c`) — it was never an app defect.** The
> trace `40ea435` captured shows both failing tests requesting the JS bundle 4 ms apart, both
> stalling TEN SECONDS, one returning `net::ERR_CONNECTION_RESET`. The shell loaded (hence the theme
> background and the passing `data-theme` assertion); the React bundle never arrived, so the tree
> rendered nothing and every control was "not found". Contention on a single-process `vite preview`
> serving two cold workers plus a 561 KiB service-worker precache. The lane is serialised.

> ⭐ **THE THIRTEENTH SESSION RAN THE BATCHED PASS JP TRIGGERED, AND ALL THREE AGENTS RETURNED NOT
> APPROVABLE FOR THE SIXTH CONSECUTIVE TIME.** Fourteen findings over `beb3dc9..HEAD`, including the
> fifth pass's own two fix commits. **Every SEV-1, SEV-2 and MED is now FIXED** (`eb97045`,
> `6ae9dfa`, `03ddf4e`, `122f9b0`, `b326321`) — see §2l for the findings and §2m for what is left.
> ⛔ **THE FIXES ARE THEMSELVES UNREVIEWED, and so is everything this session added. Six passes
> running have each found a real defect inside the previous pass's fixes; the SEVENTH pass is now
> the ONLY thing between this branch and merge-ready, and it is JP's call.**

> ✅ **The TWELFTH session closed §4 B7 — walking a camp boundary by GPS (`f6d4c0e`).** It was the
> largest named remainder and the only build work left that a session could do on its own. **NOT
> regulated**, which is why it was done BEFORE the batched pass rather than after: doing it after
> would have owed a second one. See §2k. **No agents were run** (instructed).

> ✅ **THE ELEVENTH SESSION CLOSED §5's ITEMS 1 AND 2 — the last two BUILD loops on that list.**
> `58fed1d` the residue register (§2f #6 + §2.3c as one slice, as §5 prescribed); `2e35e94` the
> transfer reason + declared purchase withdrawal (§2.3b). Both regulated, both with client routes,
> both UNREVIEWED. See §2j. **No agents were run** (instructed, and §6's cadence says the pass is
> batched at Phase 2 close anyway).

> ✅ **The ninth session opened by reconciling both claims. Tree clean; the SHA half was STALE as
> usual** (header said `65616c4`, HEAD was `b95eb09`). Reconciled. Keep checking.

> ✅ **THE FIFTH REVIEW PASS RAN (2026-07-30, JP-triggered) and its findings are FIXED (§2h).** All
> three agents over `b95eb09..HEAD`, output read directly. **All three returned NOT APPROVABLE** and
> the pattern held a fifth time: two findings, one raised by ALL THREE agents independently (the
> outbox held-set was narrower than the guard it backstops), one a regression this session's own
> back-dating fix introduced (a death saveable with an empty day → stranded capture). Both fixed,
> tests watched to fail first (`4978bad`, `e874b79`).
>
> ⛔ **STILL NOT MERGE-READY, and this is the point of the new cadence (§6): the SIXTH review is not
> run now — it is the BATCHED per-phase pass, at Phase 2 close / before the PR is marked ready.** Five
> passes have each found a defect in the previous pass's fixes; a fix author still cannot self-clear.
> One §2f finding (#6, the `withinWithdrawal` reader) remains, deferred to the §2.3c slice.

> ⚠️ **The commit pointers in this file were STALE when the seventh session opened** — §1's header
> said `e5792d3` and its tree diagram said `395b658`, while HEAD was `b3f4878`. The working-tree
> claim reconciled; the SHAs did not. Two different things, and only one of them was being checked.

> **Gate note, and it matters more than it looks:** the e2e lane was reporting green against a stale
> bundle until the fifth session. Fixed — see §4 A7. If you see e2e fail and then pass on a re-run,
> that is not a flake and it is not this bug either; read A7 before assuming.

> ⛔ **THE FOURTH REVIEW PASS RAN (2026-07-28) AND RETURNED NOT APPROVABLE** — eleven findings over
> `7c2acd9..HEAD` (§2f). **Ten are now fixed (§2g, 2026-07-30); one remains** — the `withinWithdrawal`
> reader (§2f SEV-3 #6), deliberately deferred to the §2.3c slice it shares a surface with. The
> verdict CANNOT be lifted by these fixes: only a fresh (fifth) pass JP asks for can retire it.
>
> ⭐ **The pattern is measured FOUR passes running and has not weakened once:** pass two found 12
> defects; pass three found 8 more inside those 12 fixes; pass four found 7 more (11 once fully
> enumerated), three of the four most severe inside pass three's fixes. **This session wrote ten more
> fixes. Do not assume pass five finds nothing — assume it finds defects in THESE.**

> ⛔ **The third review pass RAN (2026-07-27) and the verdict was STILL NOT APPROVABLE** — on a NEW
> SEV-1 in the code written to close the previous SEV-1s. That finding and seven others are fixed in
> `16fbb6a`…`e5792d3` (§2d).

---

## 1. Position

| | |
|---|---|
| **Phase 0** — scaffold | ✅ Merged to `main`. Repo public, CI green, branch protection on |
| **Phase 1** — auth, sync, onboarding | ✅ Merged to `main` as `9452ebc` (PR #2). **All four of its named gaps are now closed** — the last one, client passkey enrolment + management, went in this session. Phase 1 has no open gaps |
| **Phase 2** — livestock & crops | 🟡 **NOT merged. THE BUILD LIST IS EMPTY** — everything still named in §4 B2/B4/B5 is blocked on something that does not exist (§2n). ⭐ **NINE review passes have run. All nine returned NOT APPROVABLE; the ninth's two SEV-2s are FIXED (§2r).** `pnpm verify` green LOCALLY, real execution: **84** files / **952** tests, bundle **147.77 KB** gz. ⛔ **Not merge-ready, and the reason is now a RULE QUESTION rather than a work question: §7 clause 4 fired, so no tenth pass may be spawned, while clause 1 says these SEV-2 fixes earn one. See §7a and answer §2 item 9.** The outbox hold mechanism was REPLACED this session, not widened — head availability is arithmetic now. ⚠️ `pnpm test:e2e` **not re-run this session** and the diff changes the outbox's network shape; the 27/27 figure is stale. ⚠️ `pnpm verify` needs Docker, and must not run alongside agents. **Do not mark the PR ready; do not merge** |
| **Phase 3** — labour & wages 🇿🇦 | ⬜ Not started. **Critical path** |
| **Phases 4–7** | ⬜ Not started. Scope expanded 2026-07-25 (fuel + refund, photo flag, price board) |

**Working tree is CLEAN as of the fourteenth session**, and this was verified with `git status` as
the first action of the session (§5 item 1). The thirteenth session's claim was accurate — the only
thing stale was the SHA in this header, as usual: it said `74053c2` while HEAD was `b0f0c89`.

**Earlier note, still true:** The tooling changes that had sat
uncommitted since the tenth session are committed (`5a8db20`), and `.claude/settings.json.doctor-backup`
is deleted — git is the reversibility mechanism now that the change is in history. They could NOT go
on a branch off `main`: `main` has neither `defect-classes.sh` nor `ensure-docker.sh`, both commits on
THIS branch, so the doctor fixes are edits on top of this branch's own tooling and a separate branch
would have to be stacked here and merge in the same PR anyway. **That reverses the tenth session's
"leave them uncommitted" decision, deliberately and with the reason recorded; say so if it was wrong.**

⚠️ **Still run `git status` first and reconcile it against this paragraph.** It asserted a clean tree
through an entire session once while eighteen files sat uncommitted, and that is why this is the first
instruction in §5.

No stashes. Verified with `git status` at both the start and the end of the tenth session.

> ⚠️ **That sentence was FALSE for the whole of the fourth session and nobody noticed until a review
> caught it.** Sixteen modified files and two new ones — a half-built B1 breeding slice — sat
> uncommitted underneath a document asserting a clean tree. **Do not trust this line; verify it.**
> Reconciling `git status` against this section is now the literal first instruction in §5.

```
main                   9452ebc   (Phase 0 + 1)
phase-2/livestock      (HEAD)    Draft PR #3 open, DO NOT MERGE. Ten fix commits ahead
                                 of origin at time of writing — PUSH with this file.
                                 ⭐ Re-read the SHA with `git log` rather than trusting
                                 this diagram — it has been wrong every session but one.
phase-2/breeding       —         ✅ DELETED 2026-07-30 (local AND origin). Was spent
                                 (squash-merged into this branch). Gone; do not recreate.
docs/phase-3-6-scope   1331b60   pushed, no PR yet. Stacked on phase-2 @ 86f9330, well
                                 behind this branch. NOTE: ADR-0009/0010 were cherry-
                                 picked onto THIS branch (§4 A11), so if you cherry-pick
                                 the scope branch after the merge, those two ADR files
                                 already exist here — expect them to conflict or skip.
```

---

## 2. ⚠️ Decisions needed from JP before work continues

**These block the next session. Nothing below should be guessed.**

1. ~~**Phase 2 PR — open it now?**~~ ✅ **DONE 2026-07-26 (fifth session).** The three agents ran
   first, as owed. The PR is open **as a DRAFT** — CI signal without committing to merge, since CI
   has never run on this code at all (G5). ⛔ **It must still not be marked ready — §2.1d.**

1b. ~~**How do you want §3b's SEV-1 findings handled?**~~ ✅ **RESOLVED 2026-07-27 by doing option
   (b), the widest one** — both SEV-1s fixed, plus every other finding in §3b except the two halves
   of finding 5 that are argued against below. §5 already prescribed this order, so it was followed
   rather than re-asked. Seven commits, §2c. **What this does NOT resolve is 1d.**

1d. ~~**The third review-agent pass.**~~ ✅ **RAN 2026-07-27**, all three agents over
   `5c769b4..HEAD`, output read directly. ⛔ **Verdict: still NOT APPROVABLE.** Eight findings, §2d,
   all now fixed — including a **new SEV-1** nobody had looked at: the outbox flush sent doses
   AFTER the disposals the guard judges against them, so the boundary returned 201 for meat inside
   an active withholding.

1g. ~~**How should the review agents be triggered?**~~ ✅ **ANSWERED 2026-07-28 by JP: OWNER-TRIGGERED
   ONLY.** `compliance-checker` runs only when JP asks for it, and `reviewer`/`sync-auditor` follow
   the same rule. **The earlier "MUST run before the commit, no exceptions" gate is replaced**
   (`CLAUDE.md`, and the Phase 3 per-slice line is amended to match). The obligation moves rather
   than disappearing: regulated code may be written, tested and committed, but is **not merge-ready**
   until a pass has been asked for and its findings closed — and whoever writes it must SAY SO, so
   the call is JP's and never made by silence. Also decided: `agent-context.md` carries **no
   "already cleared" list**, because such a list goes stale the way this repo's comments do and
   would suppress the finding that matters. It is a map, not a filter.

1f. ~~**§2f's findings.**~~ ✅ **TEN OF ELEVEN FIXED (§2g); the FIFTH pass RAN 2026-07-30 and its two
   findings are FIXED (§2h).** The one §2f finding left — SEV-3 #6, `withinWithdrawal` read by
   nothing — is deferred to the §2.3c slice it shares a surface with (§5 item 1). Review is now
   BATCHED per-phase under §6, so the next pass is at Phase 2 close, not now. **The live JP decision
   is §2.3b** (below).

1e. ~~**The FOURTH pass.**~~ ✅ **RAN 2026-07-28 (eighth session)**, all three agents over
   `7c2acd9..HEAD`, output read directly. ⛔ **Verdict: still NOT APPROVABLE**, and `reviewer`
   said so independently. Seven findings, §2f. Original note follows.
   The evidence is no longer procedural. Pass two found twelve defects; pass three found eight more,
   **every one of them inside the fixes for those twelve** — a new SEV-1, two guards that disagreed
   with the server, a `??` that reintroduced the very bug it was written to fix, and an axe lane
   auditing seventeen screens with almost no widgets on them. There is no reason to believe pass
   four finds nothing. Run all three over `7c2acd9..HEAD` and read the output.
   → _Answer:_ ✅ **CLOSED — the fourth pass RAN on 2026-07-28 (§2f) and three more have run since
   (§2h fifth, §2l sixth, §2o seventh).** This "STILL OPEN" line was stale from the eighth session
   until the sixteenth, in the block of the file that exists to say what is open. The live request
   is now the **EIGHTH** pass — see §5.

1c. **NEW — install the defect-class hook?** Proposed at the end of the fifth session, **not
   installed**, awaiting your call. A `PostToolUse` hook on `Edit|Write` that greps the changed
   file for the most-repeated defect classes and warns without blocking:

   ```bash
   # .claude/hooks/defect-classes.sh
   case "$FILE" in *.test.ts|*.test.tsx|*.spec.ts) exit 0 ;; esac
   grep -nE 'navigator\.onLine' "$FILE" | grep -vE 'useSyncStatus|// *display'
   grep -nE 'toISOString\(\)\.slice\(0, *10\)' "$FILE"
   ```

   **Recommendation: install these two patterns only.** A third pattern for hardcoded wage-shaped
   numbers was proposed and I argued against it — a wage-shaped number is hard to tell from a test
   fixture, and a hook that cries wolf gets ignored, which is worse than no hook. Leave regulated
   numbers to the NFR-507 lint rule, which can see types. Note the awkwardness that argues for the
   exemption on line 2: `toISOString().slice(0,10)` most recently reappeared **in test assertions**
   (§3b finding 11), which is exactly what the first line skips.
   → _Answer:_

2. **`docs/phase-3-6-scope` — cherry-pick after the merge.** ✅ **ANSWERED 2026-07-26:** cherry-pick.
   ⚠️ One correction to the earlier note: the branch has **three** commits, not two. `85ffaa7` and
   `86b40c9` are the docs-scope work and cherry-pick cleanly. The third, `1331b60`, adds `STATUS.md`
   — which `phase-2/livestock` now also carries and has since rewritten (195 insertions / 54
   deletions apart), so it will conflict. Drop it or resolve by hand; nothing in it is still wanted.

3. **What is the next slice?** §3b is now done, so this is a live question again. In order of my
   own preference: **(i) the third agent pass (§2.1d) — not a slice, but it gates the PR**;
   ~~**(ii) finishing B1**~~ ✅ **DONE 2026-07-28, seventh session — see §2e;**
   **(iii) walking a camp boundary by GPS** (§4 B7), which is now the largest named remainder. Everything else is blocked on something that
   does not exist, named in §4. **Phase 3's checklist is written** (G2 closed), so `/loop` has
   something to consume — but §2.4 and §2.5 gate its very first line.
   → _Answer:_

3c. **NEW — the CROSS-DEVICE withdrawal race. Ordering cannot close it; this needs a decision.**
   `16fbb6a` fixed the single-device case: doses and moves now flush before any disposal, so one
   phone's own captures are judged in the right order. Two phones cannot be fixed that way. Device A
   records the dip; device B, which has never seen it, tallies to the abattoir. Both captures are
   honest, both are offline, and neither device can know. The server sees them in arrival order and
   the disposal may legitimately arrive first.
   My view: a REFUSAL is wrong here — the disposal already happened, and refusing it days later just
   loses the record. The answer is a retroactive compliance flag on the stored disposal event plus
   something that surfaces it (the treatment register, or the "needs your attention" screen), which
   is the same shape as the `withinWithdrawal` flag `e5792d3` added for a death. That is a slice.
   → _Answer:_ ✅ **ANSWERED 2026-07-28: FLAG, NEVER REFUSE.** The disposal already happened; a
   refusal days later only loses the record. Write a retroactive compliance flag onto the STORED
   disposal event when a later-arriving dose proves it was inside a withholding, and surface it on
   the treatment register and the "needs your attention" screen. **NOT BUILT YET** — the seventh
   session built B1 instead. This is now a fully specified slice waiting for a session, and it is
   the first candidate after the fourth agent pass.

3b. **NEW — a `transfer` tally reason, and what a `purchase` is allowed to clear.** Raised by §3b
   finding 5 and deliberately NOT built this session, because it is a modelling decision rather
   than a defect. With no transfer reason in the group model, splitting a dipped flock has to be
   expressed as sale-out + purchase-in — which trips the withdrawal guard on the way out and
   launders the withholding on the way in, since head arriving by `purchase` is unconditionally
   clear. Two questions, and the second is the one I cannot answer alone: does the group model get
   a `transfer` reason (mob → mob, same farm, withholding carried across)? And should a purchase
   be able to record a DECLARED withdrawal from the seller, or is "unknown history" the honest
   answer for bought-in stock? Inventing a withdrawal for an animal whose treatment we never saw
   is the same class of defect as hardcoding a regulated number.
   → _Answer:_ ✅ **BOTH, decided 2026-07-30 (JP).** Add a `transfer` tally reason (mob→mob, same
   farm, withholding carried across, no food-chain guard trip) AND let a purchase record an OPTIONAL
   declared seller withdrawal, defaulting to "unknown history" — never invent one. **A build slice,
   not built yet** (§5 item 2, §6).

4. **🇿🇦 Has the labour-law review been booked?** It gates Phase 3 (sub-phase 3l) and is on someone
   else's calendar. Open since the second session.
   → _Answer:_ ◐ **Reframed by §6 (2026-07-30):** under the compliance operating model this gates
   Phase 3 *deploy*, not its first line. **Book it in parallel while Phase 3 is built.** Still an
   external booking; not blocking the build.

5. **🇿🇦 Have the SA wage figures been re-verified against the current Gazette?**
   `legal-compliance.md §2.2` is dated July 2026 and self-describes as decaying. Phase 3 must not
   start against stale numbers. Open since the second session.
   → _Answer:_ ◐ **Reframed by §6 (2026-07-30):** build Phase 3 against PLACEHOLDER figures now;
   verify in ONE batch before *deploy*, tracked in `compliance-register.md`. A production seed-gate
   (Phase-3 opener) refuses unverified rows, so stale numbers cannot reach a payslip.

6. **Should the SAFEX / red-meat data licence conversations start now?** ADR-0009 says start them in
   Phase 4, for the same reason the legal review starts early. Open since the second session.
   → _Answer:_ ✅ **Defer to Phase 4 per ADR-0009 (JP, 2026-07-30).** No action now.

7. **Phone-only invitations.** Email invitations are delivered now (FR-005). A phone-only invitation
   records the membership and reaches nobody, deliberately: SMS is ruled out for the same SIM-swap
   reason it is ruled out as a second factor, and an invitation link is credential-shaped. Is
   "handed over in person" the answer, or does this need a channel we do not operate yet?
   → _Answer:_ ✅ **In-person handover (JP, 2026-07-30).** No new delivery channel; SMS stays ruled
   out. The membership is recorded and the owner hands the invite over.

9. ⛔ **NEW AND IT BLOCKS THE MERGE — clause 4 fired and left a gap. What clears Phase 2 now?**
   The ninth pass returned a SEV-2 in the outbox hold mechanism, so §7 clause 4 forbade a tenth pass
   and sent it to you as a scope decision. You chose redesign; the redesign is built and tested
   (§2r). **Clause 1 says a SEV-2 fix earns another pass. Clause 4 says do not spawn one. They now
   contradict, and no pass has ever returned APPROVABLE on this branch.** Full argument in §7a.
   My recommendation, and the reasoning is in §7a: **(a) ONE pass scoped to the new mechanism only**
   — `bd78e53..HEAD` is a different design, not another patch, and clause 4 was aimed at patching.
   The alternatives are **(b)** merge on clause 3's logic extended to this diff (every fix watched
   to fail first, confined to the named files) and **(c)** Phase 2 stays blocked pending you.
   ⚠️ **Whichever you pick, amend §7 rather than making an exception for this one case — that is
   what §7's own closing paragraph demands.**
   → _Answer:_

8. **NEW — object storage.** FR-108 photos cannot be built without it, and it is not a design
   question but a missing tier: `architecture.md` plans presigned direct-from-client upload to S3
   in af-south-1 and none of it exists. It also blocks storing generated evidence packs. Does this
   become a Phase 3 infrastructure slice, or does it wait?
   → _Answer:_

---

## 2b. Four slices built (2026-07-26, fourth session)

The gate ran green after every one. All four came off the named-remainder list in §4; none widened
the phase. **The three review agents were deliberately NOT run — see §4 A6.**

| Commit | What |
|---|---|
| `06884c7` | **A flock of 300 can become 297, and say why (FR-102) — closes B9.** The last gap a farmer walked INTO rather than merely missed. A group-only mob has no `animals` rows, and every way out of the herd is recorded against an `animals.id`, so a flock created at 300 stayed 300 through a lambing, a drought and an abattoir run |
| `00f1016` | **Sale weight, dose value/unit/route, dip method (FR-106/130/133) — closes most of B7.** Four fields that existed in the payload schema, on the wire and in the server's write path, and that no screen ever asked for — so all four were null in every record the product had produced |
| `bb17b24` | **Passkeys from the client (FR-014/014c) — closes B6, the last Phase 1 gap.** Enrolment, sign-in, and Settings → Security to list/add/revoke |
| `5e279b1` | **A cow has horns and a sheep has wool (FR-107) — closes B3.** The `attributes` JSONB has existed since migration 0009 with nothing validating a byte of it |

**Rules that came out of this session, worth not relearning:**

- **Deltas compose; an edited field does not.** Two people each record three deaths on their own
  phone in a dead zone. Deltas land on 294, which is the truth; an edited head count is
  last-write-wins, lands on 297, and silently keeps three dead sheep in the count with nothing
  anywhere to show what was lost. Any number this product lets a farmer change needs this question
  asked of it, because two offline devices is the normal case here, not the edge case.
- **A RECOUNT is the one absolute, and it resets rather than adds.** "I walked the camp and counted
  297" is a stronger fact than arithmetic on a number just shown to be wrong. It cannot be modelled
  as a delta: that would need the device to know the true previous count, which is exactly what the
  farmer has just discovered it did not.
- **Arrival order is not `occurred_at` order, and a server that steps a stored value by each
  incoming delta will be wrong.** The tally count is RE-DERIVED from the whole log over an immutable
  baseline (`mobs.initial_head_count`), so the server and the offline client run the identical
  projection and cannot drift. This is the general shape for any denormalised aggregate this product
  adds later.
- **A field that exists everywhere except on a screen is null in every record you have.** Four of
  them this session. The schema, the wire contract and the server write path all carried sale
  weight, dose, route and dip method; the data has none of it, because nothing ever asked.
- **A hand-written duplicate of a schema drifts silently and in one direction.** The client's dip
  `method` type offered `'injectable'`, which the server refuses. It had never fired because the
  field was on no screen — the moment it appeared, a plausible choice would have queued a capture
  that could never be sent, and it would have read as a sync bug rather than a typo in a type.
- **Ask whether the device CAN before offering the button, not after.** A mandatory-2FA screen
  offering only a passkey to a browser with no authenticator is a dead end for someone with no other
  route into their own account.
- **`NotAllowedError` is a cancellation, not a failure.** The WebAuthn spec uses it for both
  "dismissed" and "timed out" and withholds which, so a site cannot probe what a person did.
  Treating it as an error puts a red panel in front of someone who tapped the wrong thing — and, on
  sign-in, would spend a challenge token they never actually spent.
- **Not every seam is the seam it looks like.** FR-107 was pencilled in behind ADR-0006's
  `AnimalIdentityRules`. That seam is for what the LAW varies; a horn is a horn in Namibia. Putting
  a husbandry vocabulary behind a jurisdiction interface is the mirror image of the mistake ADR-0006
  warns about — shared biology leaking into a jurisdiction pack instead of a statute leaking into
  shared code.
- **Refusing to half-build is a decision, not a delay.** FR-108 photos and FR-120/121 breeding were
  both left alone on purpose (§4). The photo case is the sharp one: building only the local half
  would set `photo_key` with no image behind it, and `evidence-pack.pdf.ts` prints "Photograph on
  file: Yes" off exactly that field — the pack would claim a photograph the Stock Theft Unit cannot
  be shown.

---

## 2e. B1 finished — breeding (2026-07-28, seventh session)

**Instruction for this session: build slices, run NO agents.** So `reviewer`, `sync-auditor` and
`compliance-checker` were all deliberately skipped, §2.1e is still owed, and **this session's own
work is unreviewed too.** The fourth pass now has more to cover than it did.

One commit. `pnpm verify` green: 78 files / **806** tests (was 781), bundle **138.72 KB** gz. e2e
27, green on the second run — see A9.

**What B1 needed and now has:** the server half had been parked since the fourth session with zero
integration tests and no client route at all — "a complete server capability with no client route
reads to a farmer as missing functionality", which is the rule §2b wrote and then nearly broke.

**The modelling decision the slice rests on — a service is a WINDOW as often as it is a day.** An AI
technician knows the date to the hour; an extensive herd running a bull with the cows for six weeks
knows the six weeks and nothing finer. A date field alone would make the farmer name a day the
service did not happen on — fabricating a precision they never had, in the record a calving date is
later projected from. "A bull ran with them" is a first-class answer and the DEFAULT for natural
service; bull-out is optional, because "he is still with them" is an ordinary October state.

**The due date never crosses the wire, and that is the contract rather than an omission.** The
device previews one from its cached gestation figures so the farmer sees a date standing at the
gate; the server projects and freezes the one that is STORED (ADR-0005 — the same division of labour
as the withdrawal period). `recordPregnancyTestRequestSchema` omits `dueDate` and a test proves the
strip.

**⛔ A species with no gestation row refuses the PROJECTION and keeps the FACT.** `poultry`
incubates rather than gestates; `game` spans a hundred days between a springbok and a kudu. The
server throws rather than falling back to a nearby species — the missing-regulated-rate discipline —
but the diagnosis is still recorded, and the screen says plainly why no date can be worked out.
Refusing the diagnosis would lose a real observation to protect a projection that was never
available.

**The rules that came out of this session:**

- **Ask which way the error runs, then choose the default.** The pregnancy screen prefills the
  service date from the latest mating on the device, and for a window it prefills BULL-IN — the
  earliest she could have been served, so the earliest she could calve. Watching an empty camp a
  week early costs a week; the other direction is an unattended calving. Same shape as §3b's
  withdrawal-boundary rule, in a different domain.
- **A textually clean rebase is not a semantically clean one, and only the second matters.** The
  parked commit rebased across sixteen commits with ZERO conflicts, over code that had changed the
  health payload, the move write path and the outbox ordering underneath it. What had to be checked
  by hand was what git cannot see: where the new capture belongs in the send order. It belongs on
  foreign keys alone — and §2d's rule is that the SECOND question must be asked explicitly, so the
  comment now records that nothing in this pair creates evidence a guard reads or is judged by one.
- **A hand-maintained truncate list is a silent coupling.** `reset()` in `packages/db/src/testing.ts`
  names its tables one by one, and `species_gestation` is absent — correctly, since the migration
  seeds it and no farm writes it. Nothing said so, so the next person to "complete" that list would
  have emptied the table and reddened every projection for a reason that looks nothing like the
  cause. It says so now.
- **The defect class found a FOURTH home.** `toISOString().slice(0, 10)` was in the e2e SEED
  (`session.ts`), stamping `administeredOn` in UTC — so the fixture and the screen under audit
  disagreed about what day it is for two hours out of twenty-four. Twice in production code, once in
  test assertions, now once in a fixture. **This is the argument for installing §2.1c's hook**, and
  note that its line-1 exemption for test files would have skipped this one too.
- **Both new screens took an empty-state branch, so both went into the POPULATED a11y sweep.** §2d's
  lesson applied prospectively rather than after the fact, which is the first time that has happened
  here.

**Every fix verified in BOTH directions, and this claim was checked rather than asserted** (§2d's
correction to §2c is why). Five defects were introduced deliberately and each watched to fail the
test that names it: a silent fallback to 283 for an unknown species; the species read from the
request instead of the animal's own row; a stored `dueDate`; a collapsed service window; and a
prefill from bull-OUT.

---

## 2f. The FOURTH review-agent pass (2026-07-28, eighth session) — seven findings, NOTHING FIXED

All three agents over `7c2acd9..HEAD`, run in parallel, output read directly.
**`compliance-checker`: NOT APPROVABLE. `reviewer`: NOT APPROVABLE, reached independently.**

⚠️ **Read this differently from §2c and §2d: those sections list findings that were FIXED in the
same session. This one lists findings that are OPEN.** The eighth session was an audit and wrote no
feature code, by instruction. Every row below is live.

⭐ **The headline is the same as last time, one level deeper: three of the four most severe findings
are inside pass three's own fixes** — `3b0d2e8`, `713634b` and `16fbb6a`, the commits written to
close pass three. The fourth is in the B1 slice that had never been reviewed at all.

| Sev | Found by | What is wrong | Where |
|---|---|---|---|
| **SEV-1** | `reviewer` | **A second tally on the same mob on the same day is silently lost.** `const captureId = useMemo(() => uuidv7(), [selectedId, day])` — but `reset()` does not clear `selectedId` and re-sets `day` to the value it already had, so the id is REUSED. The capture store appends blindly, the flush skips the duplicate id forever (`sentLog.has`), and `onConflictDoNothing` would drop it anyway. Farmer records "Died, 3" then "Sold, 40" on one screen: both say "saved", the second reaches nobody. The as-at fold then excludes the first tally from the second's baseline, so the banner says 260 and the list says 257 while the server says 297. **A 40-head food-chain disposal exists on one phone and nowhere else.** Introduced by `3b0d2e8`, a pass-three fix | `AdjustMobScreen.tsx:128` |
| **SEV-2** ⭐⭐⭐ | **all three** | **A pregnancy diagnosis for a species with no gestation row can NEVER be sent.** The client sends `matingDate` without consulting the gestation cache; the server projects from it, throws `ValidationError` for `game`/`poultry`, returns 400, and FR-009 sets the capture aside permanently. The screen meanwhile prints *"The test itself is still recorded"* — which is true of `localStorage` and false of the wire. §2e's own headline claim ("refuses the PROJECTION and keeps the FACT") is therefore false on the path the screen actually produces. The client test asserts the local store; the server test omits `matingDate`, a body the screen cannot produce once a service exists. **Neither test crosses the seam** | `RecordPregnancyScreen.tsx:116,140` · `livestock.service.ts:722-751` |
| **SEV-2** ⭐⭐ | `reviewer` + `compliance-checker` | **The client group guard is blind to a mob dose carried in from ANOTHER mob.** `reaches()` returns false when `event.animalId === null` and the event's `mobId` is not this mob. The server does the third thing the client does not: per member, `latestMeatClearForAnimal` picks up mob-subject doses from every mob that animal has ever stood in. Dip flock A Monday, move 40 head A→B Wednesday, tally B to the abattoir Friday offline → **device says CLEAR, server refuses days later, truck already loaded.** `713634b` reconciled two of the three routes and the file's own header claims all of them | `withdrawal.ts:146-153` |
| **SEV-2** | `compliance-checker` | **A refused evidence capture does not hold back the disposal it is evidence for.** `16fbb6a` orders evidence before the act — but only among DELIVERABLE items. A 4xx on a dose or a move is set aside and the flush proceeds straight to the disposal that depended on it, which then passes the server guard because the evidence is missing. One device; ordering was supposed to have closed this | `Outbox.tsx:494-507` |
| SEV-3 ⭐⭐ | `sync-auditor` + `compliance-checker` | **A death cannot be back-dated, which defeats the `withinWithdrawal` flag `e5792d3` just added.** The day input is rendered only under `intoFoodChain`, so `died` always writes today. A death inside a withholding, written up after the clear date, carries no flag — and there is no way in the product to record the true day. The GROUP path already asks when; the individual path does not | `RecordLossScreen.tsx:163,341-356` |
| SEV-3 | `compliance-checker` | **`withinWithdrawal` is written, read by nothing, and asserted by no test.** A repo-wide grep finds it in the service, the schema, two domain modules and copy — no test, no report, no screen. An auditor would need hand-written SQL. It is the "field that is null in every record because nothing ever asked" class, inverted | `livestock.service.ts:317,569` |
| SEV-3 ⭐ | `reviewer` + `sync-auditor` | **Cold cache tells a cattle farmer that cattle have no carrying period.** `useGestationDays` conflates "never synced" with "no figure for this species", and the copy asserts the second. The product already has the right pattern and did not follow it — `health.noProducts` says "has not reached this phone yet" | `LocalSpeciesGestation.tsx:110-114` |
| MED ⭐⭐ | `reviewer` + `sync-auditor` | **The client's `mobMembership` orders by `occurredAt` alone**; the server orders `(occurredAt, id)`. Day-grained captures all stamp `T12:00:00.000Z`, so ties are ordinary BY CONSTRUCTION. `mob-tally.ts` had `localeCompare` replaced with byte comparison three commits earlier in this same range for exactly this invariant | `withdrawal.ts:60-62` |
| MED | `reviewer` | **`matingDate` and the gestation figure are computed and thrown away.** The stored `pregnancy_test` event carries the projected date and neither input — verbatim §2c's rule that a value used for arithmetic and then discarded is one the next guard cannot check. `administeredOn` was added to the health payload for this reason; breeding did not inherit it | `packages/core/src/schemas/events.ts:141-146` |
| LOW | `reviewer` | The test that "proves the `dueDate` strip" does not: `recordPregnancyDiagnosis` overwrites `payload.dueDate` unconditionally, so restoring the key to the request schema leaves the test green. **An assertion that cannot fail is not a test** — §2d's rule, recurring | `livestock.integration.test.ts` |
| LOW | `sync-auditor` + `reviewer` | No server-side `bullOutAt >= bullInAt` refinement; the only guard is the screen. The client guard is what reaches the farmer, **and** the server is still the boundary | `events.ts:125-131` |

**Verified clean by this pass and NOT to be re-audited:** three-layer tenancy for `species_gestation`
(RLS `FORCE` + `GRANT SELECT` only + `reference-global` sync classification + three real
`tenancy.spec.ts` assertions, and the seeding INSERT is safe because the migration role is
`BYPASSRLS`); `tenancy.spec.ts` still derives from the drizzle schema and still fails on an
unclassified table; the outbox safety ordering itself and its tests; the 4xx/5xx discipline; the
queue is never cleared on auth failure; idempotency-before-validation on the two captures that need
it; no `navigator.onLine` in any write path; **no new `toISOString().slice(0,10)` anywhere**; the due
date never crosses the wire; species read from the animal's own row, not the request; **no hardcoded
regulated number**; money integer cents; gestation figures sourced to the Merck Veterinary Manual
rather than invented, with no silent fallback to a nearby species; POPIA clean, and
`SLAUGHTER_CAUSE = 'slaughtered'` genuinely fixed an Afrikaans device writing "Geslag" into a
residue-traceback register; B1's client route is end to end and not half-built; `f38af66` and
`e5792d3` are correct as far as they go.

**The rules that came out of this pass:**

- **Never derive an identity from `useMemo`.** It is a performance hint, not a cache guarantee — React
  may discard it — and its dependency array is a claim about renders, not about saves. Generate the
  id in the save handler. `AdjustMobScreen` was the only screen in the client doing this; every other
  one calls `uuidv7()` at save time.
- **A test on each side of a seam is not a test of the seam.** The breeding SEV-2 has full coverage
  on both halves: the client test asserts the local store, the server test asserts the refusal, and
  the two use different request bodies. Both pass, and the capture is unsendable. **Ask of any pair of
  tests: could both be green while the thing they describe is broken end to end?**
- **"Set aside and continue" is right for the refused item and wrong for what depends on it.** FR-009
  keeps the poison capture instead of dropping it, which is correct — but the round then proceeds to
  the very disposal that capture was evidence for. Ordering answers "which first"; it does not answer
  "and what if the first one never lands".
- **A claim in a module header ages exactly like a comment.** `withdrawal.ts` says both entry points
  read both routes; it was true of one of them. Third time in this repo that a comment survived the
  premise it rested on.

---

## 2g. Ten of §2f's eleven findings fixed (2026-07-30, ninth session) — UNREVIEWED

**A CLOSING session.** No new features started. Every fix has a test that was **watched to fail
against the old code first**, and the claim of that discipline was itself checked (§2c's correction).
The gate ran green after the set: `pnpm verify` 79 files / 816 tests, bundle 139.16 KB gz.

⛔ **These ten fixes are UNREVIEWED and this branch is NOT merge-ready.** Agents are owner-triggered;
the fifth pass (§5 item 2) is a REQUEST to JP. This is regulated code (FR-131, breeding, disposal).

| Commit | §2f | What |
|---|---|---|
| `e614f37` | SEV-1 | **Tally capture id minted at save, not in a `useMemo`.** `reset()` re-set `day` to the value it held and never cleared `selectedId`, so a second tally on the same mob/day reused the first id — flush skipped it forever, and the as-at fold's `id < captureId` dropped the first from the second's baseline. Cut is now `occurredAt <= at` |
| `2d34066` | SEV-2 | **Client group guard reads a dose carried IN from another mob.** `reaches()` returned false for every `animal_id = NULL` dose not on this mob; now mirrors the server per member via `reachedAnimal`. Mirrors `livestock.integration.test.ts:2326` |
| `5f7a6ce` | SEV-2 + MED | **A figureless-species pregnancy test records instead of 400-ing.** `gestationDaysFor` returns `null`, not throw; the diagnosis is kept with `matingDate` and a `warning`; **`matingDate`/`gestationDays` now stored on the payload** (the MED). Test uses the body the screen actually sends |
| `1a8b059` | SEV-2 | **A refused dose/move holds back the disposal it is evidence for.** Evidence declares `provides`, disposals declare `guardedBy` (incl. the animal's current mob); a disposal tainted this round is HELD (pending, not refused) |
| `af7e4ad` | SEV-3 | **A death can be back-dated.** The "What day?" input now renders for `died`, so the server can flag `withinWithdrawal` from the true day |
| `8849a46` | SEV-3 | **Cold gestation cache says "syncing", not "no such figure".** `useGestationDays` returns a discriminated `GestationLookup`; new copy mirrors `health.noProducts`. Game/poultry still read "no figure" |
| `b67c28a` | MED | **Client mob membership ordered by `(occurredAt, id)`** — byte compare, like `mob-tally.ts` — so day-grained moves cannot resolve to a different mob than the server |
| `74aa1d4` | 2×LOW | **Bull window enforced server-side** (`matingPayloadSchema` refine + request refine), and **the dueDate-strip test can now fail** (asserts `'dueDate' in parsed` is false at the schema) |

Also done (cheap, unblocked): `513da32` cherry-picked **ADR-0009/0010** onto this branch (§4 A11);
`phase-2/breeding` **deleted** local + origin; `40ea435` gave the e2e lane a **DOM snapshot +
screenshot on failure** (§4 A9 — `retain-on-failure`, since retries stay 0).

**The one §2f finding NOT fixed — SEV-3 #6, `withinWithdrawal` read by nothing.** Deliberately
deferred, not missed. Its only honest reader is a residue/treatment compliance surface — the
"treatment register" or "needs your attention" screen §2.3c names — and §5 already couples #6 with
the §2.3c slice for exactly this reason. Cramming it into the stock-theft evidence pack would be the
half-build the repo forbids. **Build #6 and §2.3c together as one deliberate slice, and run the
compliance pass on it.** See §5 item 6.

**Rules that came out of this session:**

- **A memo dependency array is a claim about renders, not about saves.** `reset()` restoring a value
  to what it already was left the deps unchanged, so the "new" id was the old one. Identity is minted
  at the write, never memoised.
- **A subject-graph belongs in the flush, not just the guard.** The server refuses a disposal without
  evidence; the client must not SEND one whose evidence it just watched get refused. `provides` /
  `guardedBy` is that graph, and "held" (pending) is the right state — not "refused", which would
  blame the farmer for a capture the server never rejected.
- **Two absences are two facts.** An empty cache ("not synced") and a populated cache with no row
  ("no such figure") owe the farmer different sentences. Merging them told a cattle farmer cattle
  have no carrying period.
- **Defer over half-build, and say which.** #6's reader is a real slice with a client route, coupled
  to §2.3c. Naming it as deferred (with the reason) is a decision; a reader crammed into the wrong
  document would be the defect.

---

## 2h. The FIFTH review-agent pass (2026-07-30, ninth session) — two findings, BOTH FIXED

JP-triggered (decision recorded in §6). All three agents over `b95eb09..HEAD` (the ten §2g fixes),
run in parallel, output read directly. **All three returned NOT APPROVABLE.** The pattern held a
fifth consecutive time: every pass finds a real defect inside the previous pass's fixes.

| Finding | Raised by | What | Fix |
|---|---|---|---|
| **A** ⭐⭐⭐ | **all three, independently** | **The outbox held-set was narrower than the withdrawal guard it backstops.** A disposal was held only by the animal's CURRENT mob (or `[tally.mobId]`), but the guard — and the at-capture guard widened in `2d34066` THIS session — reads doses on every mob a member/animal has stood in. So the carried-in class reappeared one layer over: dip the dip camp (refused, healable 4xx), move the ox into the sale mob, tally/sell it → not held → 201 → residue to the abattoir once the dose heals next round | `4978bad` — `animalDisposalSubjects`/`mobDisposalSubjects` exported from `withdrawal.ts` and reused by the flush, so the two client mechanisms compute ONE subject set and cannot drift again |
| **B** | reviewer | **A regression THIS session's back-dating fix introduced.** `af7e4ad` rendered the day input for `died` and it is clearable, but `canSave` for a death checked only the cause. A cleared date → `new Date('T12:...')` = Invalid Date → `occurredAt: null` → the death stranded in the outbox forever (400 on `timestampSchema`), losing the record the day was added for | `e874b79` — the `died` branch now requires `disposalDay !== ''`, like the slaughter branch already did |

⭐ **Finding A is the one to trust most by this repo's own rule** — two-plus agents finding the same
defect independently. It is also the sharpest lesson of the session: the SEV-2 carried-in fix
(`2d34066`) and this backstop fix touched the SAME food-safety boundary in two files, and leaving one
narrower than the other is how they silently disagree. They now share `withdrawal.ts`'s subject
computation — the root-cause fix, not just the symptom.

**Verified sound by this pass (named, so the batched sixth pass knows what was covered):** SEV-1 tally
id; the client group guard mirrors the server end to end; the breeding seam is actually crossed
(client sends `matingDate`, server records + warns, integration test uses the real body); membership
ordering; the gestation cold-cache split; the bull-window refine; the dueDate strip; no hardcoded or
fabricated regulated number; `dueDate`/`gestationDays` never cross the wire; back-dating a slaughter
cannot evade the block (server judges the true day); money integer cents; POPIA clean.

**Non-blocking follow-ups the pass named (NOT fixed — for a later session):**
- `RecordPregnancyScreen.tsx:105` sorts matings with `localeCompare` — but it is a UI PREFILL, not a
  cross-device regulated projection, and was not touched this session. The recurring `localeCompare`
  pattern; worth a follow-up, not a blocker.
- `RecordLossScreen.pick()` does not reset `disposalDay` when switching animals — preview-only,
  cosmetic (save uses the live field).
- `LocalSpeciesGestation` `notSynced` is a whole-cache heuristic — sound here because the reference
  cache does an ATOMIC `replace` (all-or-nothing, never partial), so empty = never synced. Left as is.

---

## 2j. Both open BUILD loops closed (2026-08-01, eleventh session) — UNREVIEWED

**A BUILD session, and the first in a while that is not a closing one.** §5's items 1 and 2 were the
only loops left that a session could close; both are done, each with a client route, each with every
assertion watched to fail against the old code first. `pnpm verify` green after each: **80 files /
847 tests** (was 79/821), bundle **142.09 KB** gz. **No agents run** — instructed, and §6 puts the
pass at Phase 2 close regardless.

| Commit | Loop | What |
|---|---|---|
| `58fed1d` | §5 item 1 (§2f #6 + §2.3c) | **The residue register.** `withinWithdrawal` now has a reader — a "Needs your attention" screen at `/attention`, reached from home only when there is something on it. And the cross-device race is closed the way JP decided (FLAG, NEVER REFUSE) |
| `2e35e94` | §5 item 2 (§2.3b) | **`transfer_out` / `transfer_in` carry a withholding across, and a purchase may record a DECLARED seller withdrawal** (optional; blank = unknown history, never invented) |

**The decisions inside these that are worth not re-litigating:**

- ⭐ **The retroactive flag is DERIVED on read, not stamped on arrival — and this is a deliberate
  departure from the mechanism §2.3c sketched.** JP decided the BEHAVIOUR (flag, never refuse) and
  sketched "write a flag onto the stored disposal event". Stamping when the dose arrives is the exact
  shape CLAUDE.md's promoted rule already forbids for head counts: it steps a stored value on
  arrival, so it depends on the order captures land in, and it goes stale the moment a dose is
  corrected or soft-deleted. Re-deriving from the whole log answers from scratch every time. It also
  keeps the log append-only. **The behaviour JP asked for is delivered; the mechanism is the one the
  repo's own general rule prescribes. Flagged here so it is JP's to overrule.**
- ⭐ **The register runs the SAME `latestMeatClearForAnimal` / `latestMeatClearForMob` the guards
  run.** §2h finding A was two client mechanisms judging one food-safety boundary through two
  computations, one narrower. There is one here, so the register cannot contradict the refusal it
  exists to explain — that lesson applied up front rather than after a review found the drift.
- ⭐ **A disposal was being judged against doses given AFTER it.** Found while building the register,
  which cannot be correct without the fix: sell five head on the 1st, remember on the 20th, and a dip
  on the 10th made the record unsaveable. Head that left before the needle cannot carry that residue.
  INCLUSIVE at the same-day boundary, because dipped-and-sold on one day is a real residue question.
- ⭐ **`transfer` had to become TWO reasons.** A tally has one subject mob and one delta, so a single
  reason would mean minus here and plus there — and the sign is derived from the reason precisely so
  it is never the farmer's to type. The farmer still performs one action; the screen writes both
  halves. `transfer_in` is never offered, and the completeness check now forces a new reason to be
  either OFFERED or explicitly named as DERIVED.
- **`ResidueFlagJson` vs `ResidueFlag`.** `timestampSchema` parses a string INTO a Date, so the
  parsed type describes the shape only after a parse. A cache typed as the parsed shape compiles and
  crashes on a COLD START, because JSON has no Date and localStorage returns what it was given. Every
  capture store in this app keeps instants as strings for the same reason.
- **`knownAtCapture` and `withinWithdrawal` stay uncollapsed.** The pair separates "the product
  warned them and they proceeded" from "no device could have known", and the second is the one that
  says a guard was structurally unable to fire.
- **An undeclared purchase claims NOTHING.** Not clear, not withheld. Inventing a period is the
  fabricated-regulated-number defect; assuming clear is the laundering. It is not evidence either way,
  and the screen says so rather than letting the app decide quietly.

**⚠️ A test flake worth carrying forward, because it will recur.** One new integration test failed
about half the time until it was dated. The fixtures in `livestock.integration.test.ts` share a
single `occurredAt`, so the as-at cut falls through to the id — and `randomUUID()` is a **v4**,
random rather than time-ordered like the client **UUIDv7** the whole `(occurredAt, id)` ordering is
built around. The tie-break is sound; the fixture was leaning on a property real ids have and test
ids do not. **Any same-instant fixture in that file has this hazard.** It is also a live candidate
for §4 A8, which is still unexplained.

⛔ **Both slices are REGULATED and UNREVIEWED. Saying so out loud is the obligation §6 sets**: they
touch FR-131, disposal, and residue traceback. Under the batched cadence the pass runs at Phase 2
close, not per slice — so this is not a request to run it now, it is the record that it is owed.

**⭐ AND THE LANE THAT CAUGHT THE ONE REAL DEFECT WAS CI, NOT THE GATE.** `pnpm verify` was green
through both slices and stayed green — it does not run e2e. The push turned the e2e lane red on a
deterministic assertion: `offline-capture.spec.ts` routes `**/api/livestock/**` and counts every
match as a capture that "went up", and the residue register is the FIRST INBOUND read that folder
has ever had, fired by a cache provider on every mount with a signal. So a GET was recorded as a
re-send and the "a second open sends nothing" assertion failed. Fixed in `490b5bb` — POSTs only,
which is what `sent` always meant.

⛔ **This is NOT §4 A9 and must not be filed as it.** A9 is two light-theme a11y tests timing out on
a cold run; this was a different spec failing an assertion every time. **Both CI lanes are green at
`490b5bb`** (run `30693389012`), verified with `gh run view` rather than inferred.

**The rule out of it:** *a green local gate is not a green branch when the gate does not run every
lane.* `pnpm verify` omits e2e by design, so any change touching the network shape of a screen — a
new fetch, a new provider, a new route pattern — can only be proved by pushing. Push and watch,
rather than reading `verify` as the whole answer.

---

## 2l. The SIXTH review pass — the BATCHED one (2026-08-02, thirteenth session) — ALL FIXED

**JP TRIGGERED IT.** All three agents over `beb3dc9..HEAD`, run in parallel, output read directly.
The range deliberately STARTS at `4978bad` so it includes the fifth pass's own two fix commits —
excluding them would have skipped the highest-probability defect site in the whole range, which is
this repo's most reliable measured fact.

**`compliance-checker`: NOT APPROVABLE. `sync-auditor`: NOT APPROVABLE. `reviewer`: NOT APPROVABLE.**
Sixth consecutive pass, and the pattern did not weaken.

⭐ **ONE ROOT CAUSE UNDER MOST OF IT, and it is the lesson worth carrying into Phase 3:**
`2e35e94` introduced a THIRD way a withholding can exist — arriving WITH the head rather than being
given to it — and **every reader written for the two-source world was left standing.** Not one of
them was wrong when it was written. The commit that widened the world did not go back for them.

| Sev | Found by | What was wrong | Fix |
|---|---|---|---|
| **SEV-1** | `sync-auditor` | **A carried withholding was FROZEN at arrival, so a late dose laundered a counted flock.** Computed from the source mob's log as it stands when the transfer LANDS — stepping a stored value on arrival, the exact shape this repo ruled out for head counts and boundaries, applied to residue. Dip A on the 20th offline; another phone moves 40 head A→B on the 22nd having never seen the dip; B is clear FOREVER. A counted flock has no `animals` rows, so no other route catches it, and the register missed it too by running the same read | `eb97045` — the stored date is a FLOOR, never a ceiling; the source is asked again live, with a `visited` set for the A→B→A cycle |
| **SEV-1** | `compliance-checker` | **`dosedSpan` scanned only health events**, so a farm whose only withholding was bought or transferred in got an EMPTY register — on the farm least likely to have a second system catching the mistake | `eb97045` — `withholdingSpan`, reading every source the per-subject derivation reads |
| **SEV-2** ⭐⭐⭐ | **all three** | **`residue.ts` passed six of seven arguments to `meatWithdrawalForMob`**, so the screen that exists to explain a refusal judged by a narrower rule than the one that refused — the exact defect its own header claims is closed | `eb97045` — argument passed, and the parameter is REQUIRED so omission cannot compile |
| **SEV-2** ⭐⭐ | `sync-auditor` + `compliance-checker` | **`transfer_out` joined `TALLY_DECREASES`**, widening the constant underneath a reader asking the wrong question of it. A camp-to-camp move was filed as a disposal and rendered "Died" / "Gevrek" | `eb97045` — `TALLY_TRANSFERS` subtracted on both sides; the default label arm is a neutral "Left the herd" |
| **SEV-2** ⭐⭐ | `sync-auditor` + `compliance-checker` | **A refused `transfer_in` held nothing back.** A tally CREATES evidence now and declared no `provides`, so the slaughter behind it posted to a server that had never heard of the arrival. The fifth pass's own finding, one route along | `6ae9dfa` — `provides` on arrivals, and arrivals ordered ahead of disposals |
| **SEV-2** | `reviewer` | **An hour of walking discarded in silence.** `selectedId` snapshotted `?camp=` once; the farm switcher sits in the shell header on every screen and does not navigate, so Save stayed ENABLED and returned with no error. `?camp=A`→`?camp=B` filed the walk against A — and a boundary RESETS, so that overwrites A's correct fence | `03ddf4e` — reconciled every render against `units`; Save disabled when there is no camp |
| **MED** | `reviewer` | **`/attention` — the newest REGULATED screen — had zero axe coverage** in either theme or state, masked by a heading collision with `/not-sent` that the checklist line named while claiming both | `122f9b0` — in both sweeps; the populated seed carries a flagged death |
| **MED** | `reviewer` | **The tie-break test asserted array order, not the tie-break.** Delete the id comparison and it stayed green | `03ddf4e` — loser seeded first; verified it now reds when the tie-break is deleted |
| **MED** | `reviewer` | **Two FR-131 checklist remainders closed by this branch were still marked open**, in the document the exit gate is measured against. Fourth occurrence of that class | `b326321` |
| **MED** | `sync-auditor` | **`tallyPayloadSchema` claimed the two transfer halves are "tied by the envelope's `batch_id`"** — always written `null`. False the day it was written | `b326321` — claim removed, the real cost recorded as a KNOWN GAP (§2m #1) |
| **MED** | `sync-auditor` | **Invariant 5 (a 401 must never discard captures) had no test**, though `offline-sync.md` §5 says it gets one. The behaviour was correct | `6ae9dfa` — a regression pin, recorded as such rather than claimed as a fix |
| LOW → **two bugs** | `reviewer` | **`d1 === 0` on a computed float** in `segmentsCross`. Chasing it found the half the review missed: the STRICT-SIGN branch reads the same ~2e-17 dust as a real sign flip, so it could refuse a fence that never crossed anything | `03ddf4e` — one `sideOf` with a noise floor, for both branches |
| LOW | `reviewer` | The area header said planar degrees are "a 13% under-read" — wrong in direction AND number. They over-read east–west by 1/cos(φ), ~14% | `03ddf4e` |
| LOW | `reviewer` | A test comment inverted against its own fixture | `03ddf4e` |

**Rules that came out of this pass:**

- **Widening a shared constant is a change to every reader of it.** `TALLY_DECREASES` gained one
  member and three readers silently began answering a different question. Adding to a shared enum is
  not an additive change: grep every use and ask what question each was really asking of it.
- **A default arm that picks a NOUN will eventually pick the wrong one.** `default: 'died'` told a
  farmer that forty head had died when they had walked through a gate.
- **An optional parameter is a silent narrowing waiting to happen.** `tallies = []` let a new caller
  compile against the old contract and answer a narrower question than the guard it mirrors.
- **A snapshot of a route parameter is a bug the moment anything else can change the world.** The farm
  switcher does not navigate, so no remount ever corrected it.
- **`=== 0` on a computed float is wrong in BOTH directions**, and the second is the one that is easy
  to miss: it fails to catch what you meant to catch, AND strict sign comparisons elsewhere read the
  same dust as signal. Third `=== 0` defect in this module's short life.
- **A round-number fixture can make a broken implementation look correct.** With 0.7/0.25 the old
  collinear code returned the right answer by accident, through dust in a different branch. The test
  only became directional at 0.7000001/0.2500001 — established by enumerating 2401 disagreeing cases
  rather than by argument.
- **Two screens with near-identical headings will eventually be confused in a checklist**, and the
  one that loses is the one nobody audits.

---

## 2o. The SEVENTH review pass (2026-08-03, fifteenth session) — ALL FIXED

**JP TRIGGERED IT and asked for the phase to be made merge-ready.** All three agents over
`beb3dc9..HEAD` (24 commits, including the sixth pass's own fix commits and the fourteenth session's
four), run in parallel, output read directly.

**`reviewer`: NOT APPROVABLE. `sync-auditor`: NOT APPROVABLE. `compliance-checker`: NOT APPROVABLE.**
Seventh consecutive pass. Every SEV-2 was inside code the range added or touched.

⭐ **TWO findings were raised by two agents INDEPENDENTLY**, which is the signal this repo trusts
most — and both had the same root shape: *a rule was added to the server and its client twin was
left standing.*

| Sev | Found by | What was wrong | Fix |
|---|---|---|---|
| **SEV-2** ⭐⭐ | `reviewer` + `compliance-checker` | **The client withdrawal guard had no dose-day bound.** `58fed1d` gave the SERVER `onOrBefore` and left both client readers unbounded. Sell five head on the 1st, write it up on the 20th, and a dip on the 10th made the sale UNSAVEABLE — with "Died" one tap away and never refused, which is the workaround a guard must not teach. The server would have accepted the identical capture. It also put false rows on the residue register, which reads the same functions | `34e0685` — the bound is in `latestClearAcross`, where every route funnels, INCLUSIVE at the boundary like the server's |
| **SEV-2** ⭐⭐ | `reviewer` + `compliance-checker` | **A reason change kept the previous reason's fields, and the capture was LOST.** Pick "moved to another group", pick a destination, change to "Sold": the sale went out with a `counterpartMobId` and a batch id, the domain refused it, `save()` returned — **the sale was never written.** Not queued, gone, with a message about a move the farmer did not make. `reset()` only runs on success, so every later Save failed identically until reload | `34e0685` — every reason-scoped field DERIVED from `reason`, and the reason buttons clear their state. Both halves, because clearing alone is one missed `setX` from writing a forbidden field |
| **SEV-2** | `compliance-checker` | **`mobDisposalSubjects` never walked the TRANSFER CHAIN.** The only shape in that file where meat reaches a truck rather than a farmer being blocked: dip flock A, transfer A→B and slaughter out of B on a phone that has not recorded the dip. The dip is refused and taints A; the slaughter's subject set was `[B, …members]` — **201 for meat inside an active withholding.** Its own docstring claimed it read "the exact set" the guard reads; true when written, false once §2.3b widened the world | `34e0685` — the SAME traversal the guard runs (`collectMobSubjects`), not a parallel one that agrees today |
| **SEV-2** | `sync-auditor` | **A chained move A→B→C got a FALSE refusal** — a regression inside the fourteenth session's own fix. Hoisting every departure meant `out_B` was posted before `in_B` had landed, the server saw no head in B, and refused a valid capture. Worse than a retry: the `/not-sent` copy says *"Record it again"*, and a recount RESETS — following it corrupts the count permanently | `34e0685` — capture order is CAUSAL and is preserved; only a departure is pulled forward to just before its OWN arrival, never to the front |
| MED | `reviewer` + `sync-auditor` | **The server refused an unlinked transfer half**, which it cannot verify and `offline-sync.md` §6 forbids tightening | `34e0685` — the rule moved to the capture path, where it is knowable. **The gap is now STATED in the schema** rather than implied closed |
| MED | `compliance-checker` | **`/attention` dropped `withinWithdrawal`**, so a row the server's own derivation says is CLEAR still said "meat from this must not go into the food chain" | `34e0685` — carried onto `Row`; the row stays (an audit fact), the warning goes |
| MED | **all three** | **The two halves of a move were written non-atomically** — a throw on the second left an orphan departure in the append-only log, head out of the source into nothing | `34e0685` — `useRecordTallies` builds and validates all before appending any |
| MED | `reviewer` | **The exit-gate paragraph in `phase-checklists.md` was stale in four ways**, in the document the gate is measured against, one commit after `b326321` closed two stale lines in that same file. Fifth occurrence | `34e0685` — rewritten to state CLAUSES and defer every figure to this file |
| MED | `reviewer` | **The FR-131 checklist line was ◐ with NO remainder named** — satisfying neither arm of the gate clause | `34e0685` — ☑ |
| LOW×4 | various | Three premise-outlived-comment fixes (`SentCaptures` "gates one thing", `withdrawal.ts`'s two-source header, `herd-scope`'s escape list); one truthiness mismatch on `provides` | `34e0685` |

**Gate after: 84 files / 941 tests** (was 934), bundle **146.79 KB** gz, `pnpm test:e2e` **27/27 cold**.
**Both CI lanes green at `34e0685`** (run `30807663310`, `gh run view`). Every fix has a test watched
to fail against the old code first.

**The rules that came out of this pass:**

- ⭐ **When you bound a rule on one side of a seam, go and bound it on the other IN THE SAME COMMIT.**
  Both independently-confirmed SEV-2s are one shape: a server gained a constraint, its client twin
  did not. That is the "read path fixed, write path left standing" class, and it is now the most
  reproducible defect this repo has.
- **A guard that fails toward blocking is still a defect.** The dose-day bound made the device refuse
  an honest back-dated sale. Nothing unsafe reached the food chain — and a farmer who cannot record
  what happened stops recording, which is how you lose the register entirely.
- **State that clears only on SUCCESS is state that survives every failure.** `reset()` ran on save;
  the reason buttons did not, so a field belonging to an abandoned reason poisoned the next capture
  and the screen refused it forever.
- ⭐ **A subject set that shadows a guard must be the SAME TRAVERSAL, not a parallel one.** Two
  computations of one food-safety boundary have now drifted twice, both times because the guard
  learned a route and its shadow did not.
- **Enforcing a rule where it cannot be checked costs a record and buys nothing.** The server cannot
  see a transfer's sibling, so refusing an unlinked half only lost data. The rule belongs at capture;
  the residual gap belongs in writing.
- ⭐ **Closing a false positive can open a false negative, and the second is worse.** `/attention`
  suppressing a stale warning had to be checked in the other direction — a row still inside a
  withholding must never lose its warning.

---

## 2p. The documentation audit (2026-08-04, sixteenth session) — six live contradictions

**A DOCS session, asked for as a high-level soundness audit of the architecture and specification
documents.** No agents were run. The working tree was clean and in sync with origin at `b20fdf9`;
`pnpm verify` was re-run cold and is green (84 files / 941 tests, bundle **146.79 KB** gz — which is
how §1's stale 146.45 was caught).

⭐ **The finding that matters is the first one, and it is the repo's own recurring class one tier
higher than it has been found before.** Every previous instance was a stale COMMENT or a stale
CHECKLIST LINE. These are stale CONTRACTS, in the four documents `CLAUDE.md`'s "Where to look"
section sends you to.

| # | Document | What it claimed | Reality |
|---|---|---|---|
| **1** ⭐⭐⭐ | `offline-sync.md` §5, invariant 3 | **"The queue drains in `occurred_at` order."** Stated under *"Invariants. These are not aspirations."* | **False, and deliberately so.** The flush orders by the FK graph, then puts the EVIDENCE a guard reads ahead of the act it judges, then keeps causal capture order. An `occurred_at` drain is *exactly* §2d's SEV-1 (`16fbb6a`): dip Monday, tally to the abattoir Tuesday, reconnect Friday → the tally POSTs first and gets a **201** for meat inside an active withholding. `Outbox.tsx`'s own header comment has said "ordered by the FOREIGN KEY graph, **not** by when things were captured" since that fix. **A reader who trusted the invariant would reintroduce the SEV-1 and think they were fixing a bug.** Rewritten as the five rules the flush actually applies, incl. the departure/arrival hoist limit (§2o) and taint-on-hold (§2n) |
| **2** | `database-schema.md` §5 | The `event_type` enum DDL lists 24 values | **Three missing**: `rainfall` (0014), `tally` (0017), `boundary_walk` (0020). The document's own PROSE discusses `boundary_walk` and `tally` two hundred lines further down — the DDL block and the paragraph explaining it disagreed |
| **3** ⭐⭐ | `database-schema.md` §4 | `mobs` has `head_count` | **`initial_head_count` (0018) was absent entirely** — the IMMUTABLE baseline the tally log folds over. §3b finding 7 was precisely the defect of folding over the mutable `head_count` instead, and it "detonates the moment PowerSync hydrates `mobs` in Phase 3". The canonical schema document still showed only the dangerous column. Both are now documented, each labelled with what it is for |
| **4** | `database-schema.md` | — | **`species_gestation` (0019) was undocumented.** Added, with the reasons that are load-bearing: global rather than farm-scoped (gestation is biology, not tenancy), safe because `GRANT SELECT` only + RLS FORCE + `reference-global`, and the deliberate absence from `testing.ts`'s truncate list |
| **5** ⭐⭐ | `api-specification.md` §1 | **"Animals, events, blocks, and camps do not have REST endpoints… if you find yourself adding `POST /animals`, stop."** | The API has **24 REST capture endpoints**, incl. `POST /api/livestock/animals`. They are correct — PowerSync is Phase 3, so this is the interim transport — but that reconciliation lived ONLY in `phase-checklists.md`'s scope-boundary paragraph. **Read on its own, the API spec says the livestock controller is a defect.** Also: base path is `/api`, not `/v1`, so every path in the document has the wrong prefix; the auth routes were never built under the names given; `species-gestation` and `residue-register` are undocumented. A TARGET-vs-today warning added, matching the one `ci-cd.md` and `testing-strategy.md` already carry |
| **6** | `roadmap.md` Phase 2 gate | ✓ `pnpm test:e2e:offline`, ✓ `pnpm test:tenancy` | **Neither script exists.** G1 corrected four documents for exactly this in the fifth session and `roadmap.md` was not one of them — so a phase GATE was still measured against two commands that cannot be run. Both now point at what actually runs them |
| **7** | `ci-cd.md`, the ⚠️ warning at the top | "neither has ever run… no PR has been opened yet" | **The correction note had itself gone stale.** Draft PR #3 opened 2026-07-26; CI has run on every push since and both lanes are green. G5 is closed. Corrected, keeping the fact worth keeping (CI does not run on a feature branch with no PR) |
| **8** | `STATUS.md` §1 and §5 | 934 tests / 146.45 KB; "the SEVENTH pass is the ONLY thing left" | Superseded by §2o **in this same file** — 941 tests / 146.79 KB, and the seventh pass ran and is fixed. §5's whole resume block was written for the pre-seventh-pass world |

### The slice: §4 G4, the user guide — half done

**G4 was the only unblocked Phase 2 work left** (§5's option (iv)), and the audit made it the obvious
one: `user-guide.md` is the farmer-facing twin of the documents that had just been found contradicting
the code. It did the same thing, and worse, because a farmer cannot read the source to check.

**Three of its claims were false, and one of them is a food-safety claim:**

| What it told farmers | Reality |
|---|---|
| ⛔ **"You can override it. You will have to give a reason, and it is recorded."** — of the withholding-period block | **There is no override anywhere in the product**, and there never has been — `grep -ri override` over `apps/`, `packages/domain/` returns nothing but a theme comment and two NestJS reflector calls. A farmer told they may override a meat withholding "with a reason" has been told something both false and dangerous. Rewritten to say what is actually true: no override, and a death is never refused |
| **"Take a photo — it is what you will hand the police if the animal is stolen"** | **Photos are not built** (§4 B2, blocked on object storage). The evidence pack was fixed in `511cf3c` to stop claiming "Photograph on file: Yes"; the user guide kept promising the farmer the photo itself |
| **"Werf keeps both and asks you which is right"** — of two people recording one calving | There is no such screen. Events are append-only and never merged; entity FIELDS are last-write-wins. Rewritten to describe both, and to point at why counts are deltas |

**Added, all of it built and none of it previously documented:** counted flocks (`/animals/groups/count`
— why you never type the new total, why a recount RESETS, transfers as one action, an undeclared
purchase claiming nothing); "Needs your attention" (`/attention`) and the cross-device residue race
in a farmer's words, incl. the warned/could-not-have-known split; "Not sent" (`/not-sent`) and the
warning that "record it again" is not free when a recount replaces a total; walking a fence
(`/land/walk`); breeding (`/animals/mating`, `/animals/pregnancy`), incl. why a service window is a
first-class answer and why poultry/game get no due date; tags and retired identifiers; births,
weaning, moves, losses; rainfall; passkey management under Settings → Security.

**And an "as at today" block at the top**, which is the audit's own lesson applied to the file: the
guide describes Phases 3–6 (payroll, sprays, harvest, GlobalGAP) in the present tense, and that is
how it came to promise an override for a screen that does not exist.

⚠️ **G4 IS ONLY HALF CLOSED. `ux-design-system.md` (480 lines) was NOT touched** — it is the other
half of the gap and it is still stale for the same fourteen-plus screens. Named here rather than
quietly left: **G4 stays OPEN in §4.** The grievance flow that G4 says "needs real UX care" is
Phase 3 work and is untouched.

**The rules that came out of this session:**

- ⭐ **A document that states a CONTRACT ages exactly like a comment, and costs more when it does.**
  This repo has caught five stale comments and five stale checklist lines. Invariant 3 is the same
  failure at the tier where a reader goes to learn what is true — and unlike a comment, nothing sits
  next to the code to contradict it. **When a review pass changes a mechanism, grep the docs for the
  old mechanism in the same commit**, exactly as §2o's rule says to bound both sides of a seam.
- ⭐ **The dangerous stale document is the one that is RIGHT about the destination.** `api-specification.md`
  and `offline-sync.md` are both accurate descriptions of the Phase-3 system. Neither says so, so
  both read as descriptions of today — and one of them forbids code that is already merged and
  correct. **A design document with no "as at today" line is a claim about the present.**
- **A stale correction note is worse than the staleness it corrected**, because it has already been
  audited once and reads as freshly checked. `ci-cd.md`'s warning was written to fix a false claim
  and became one.
- **Figures in a header are the same defect class as SHAs in a header.** §1's tree/SHA claim is
  reconciled every session by §5's first instruction; its TEST COUNT and BUNDLE SIZE were not, and
  had drifted from a section of the same file. Both are checked now.
- **A gate measured against a command that does not exist is not a gate.** Fifth-session G1 found
  this in four documents; `roadmap.md` kept it for eleven more sessions because nothing greps the
  docs for `pnpm <script>` against `package.json`. **That grep is cheap and is the obvious hook.**
- ⭐ **The farmer-facing document is where a stale claim does the most damage**, because the reader
  cannot check it against the source. The withholding "override" is the sharpest thing this session
  found in any document: false, and false in the direction that puts residue in the food chain.
  **Every review pass so far has audited code. None has audited what the product TELLS the farmer** —
  and `user-guide.md` ships as in-app help.

---

## 2q. The EIGHTH review pass (2026-08-05, seventeenth session) — three SEV-2s, ALL FIXED

**JP TRIGGERED IT, and asked for a STOPPING RULE first so the phase could not loop forever.** The
rule is §7, and it was written and committed (`bd78e53`) BEFORE any finding was read, deliberately.

**Scope was NARROWED under §7 clause 1: `34e0685^..HEAD` only** — the seventh pass's own fix commit
(one code commit, 12 source files) plus the four docs commits. Previous passes re-read 24 commits;
everything before `34e0685` has now been read seven times and is not where the next defect is. This
is what made the pass affordable.

**`reviewer`: NOT APPROVABLE. `sync-auditor`: NOT APPROVABLE. `compliance-checker`: NOT APPROVABLE.**
Eighth consecutive pass.

> ⚠️ **THREE CLAIMS IN THIS SECTION WERE CORRECTED BY THE NINTH PASS (§2r). Read them as a warning
> about how a write-up flatters itself, because the third one cost a SEV-2.**
>
> 1. ~~"All three SEV-2s were inside `34e0685` itself"~~ — **SEV-2 #1 was not.** `transfer_out`,
>    `death` and `theft` never had a `guardedBy`; that is a hole `34e0685` failed to close, not one
>    it opened. Overstating it strengthens the "always in the previous fix" narrative that the
>    scope-narrowing of clause 1 rests on, which is the one claim that must not be inflated.
> 2. ~~"`34e0685` removed that throw and updated three of the four sites"~~ — if three of four had
>    been updated, ONE comment would have been stale, not three. The fourth site needed nothing.
> 3. ⛔ ~~"All 14 pre-existing outbox tests still pass, which is the check that no false hold crept
>    in."~~ **THAT CHECK WAS IMPOSSIBLE. Not one of those tests refuses an INCREASE**, so none of
>    them could have detected a false hold in the `head:` namespace — and there was one, rated SEV-2
>    by the ninth pass. An assertion that cannot fail is not a test; a GATE CLAIM that cannot fail
>    is worse, because it is the sentence that ends the argument. **Ask of any "and these tests
>    prove it did not regress": what edit would those tests have caught?**

| Sev | Found by | What was wrong | Fix |
|---|---|---|---|
| **SEV-2** ⭐⭐ | `sync-auditor` + `compliance-checker` | **A departure was SENT when the arrival that funded it was held.** `transfer_out`, `death` and `theft` declared no `guardedBy` at all. Offline chain A→B→C, another phone recounts A, `out_A` refused, `in_B` correctly held — and `out_B` went anyway, to a server whose fold of B has no head in it. The refusal says *"count the group and record what you find"* and `/not-sent` says *"Record it again"*; **a recount RESETS**, so following either corrupts B's count permanently. The seventh pass closed the ORDERING route to this harm; the HOLD route reached it | `0b2adc6` |
| **SEV-2** | `reviewer` | **`counterparty` and `priceCents` survived a reason change.** Neither derived from `reason` nor cleared by the reason buttons — the one arm the reason-scoping fix missed. Type a buyer and a price under "Sold", switch to "Stolen", and the append-only log permanently held *"5 head stolen, buyer Willem Botha, R5 000"*. Nothing refuses it: `recordMobTally` copies both for any reason and `tallyPayloadSchema` constrains neither. A named third party on a theft record is what `.claude/rules/domain.md` bans outright | `0b2adc6` |
| **SEV-2** | `compliance-checker` | **A blank disposal day disarmed the FR-131 sale guard.** `administeredOn > disposalOn` is true for every dose when `disposalOn` is `''`, so `latestClearAcross` skipped them all and returned CLEAR for an animal deep inside a withholding — the red panel vanished and Save went live. The sale then threw `Invalid Date` out of the click handler and was LOST. **The bound added by `34e0685` to stop a false REFUSAL had opened a false PASS**, on the arm adjacent to the one it fixed and tested | `0b2adc6` |
| MED×3 | `sync-auditor` + `reviewer` | Three comments claiming the domain refuses an unlinked transfer half — `34e0685` removed that throw and updated three of the four sites | `0b2adc6` |
| MED | `compliance-checker` | **Three FALSE NAVIGATION CLAIMS in `user-guide.md`**, introduced by `faf0c19` — the commit whose purpose was to stop that file lying. A "Settings → Not sent" that does not exist; Settings → Security described as managing authenticators (passkeys only); a tally reason the screen deliberately never offers | `0b2adc6` |
| MED | `reviewer` | **The batch-link rule has ZERO test coverage anywhere.** `34e0685` moved it from two tested sites to one untested one and rewrote both tests to assert the opposite. Correct today (`canSave` always mints the id) | ⬜ **TRACKED, not fixed — §7 clause 2.** See below |

⛔ **AND THE FIX FOR THAT FIRST SEV-2 WAS ITSELF A SEV-2 — see §2r.** The `head:<mobId>` subject
held a decrease whenever ANY increase on the mob was tainted, whether or not the decrease needed it,
and a held capture was reported nowhere. It has been replaced by the server's own arithmetic. Ninth
for ninth.

⭐ **THE AGENTS DISAGREED ON THE FIX FOR THE FIRST SEV-2, AND ONE OF THEM WAS WRONG.**
`compliance-checker` proposed `guardedBy: [tally.mobId]`. `sync-auditor` had specifically shown that
regresses: a refused mob dose ALREADY taints that id (`health` → `provides: nonNull(animalId,
mobId)`), and a transfer is deliberately not judged against a withholding — so every departure out of
a dipped camp would be falsely held, turning a false pass into a false refusal. **The fix uses a
separate subject namespace (`head:<mobId>`).** Two different questions about one mob — *is its
residue status settled* and *does it have head available* — need two subjects. All 14 pre-existing
outbox tests still pass, which is the check that no false hold crept in. **Do not accept an agent's
proposed fix without reconciling it against the other agents' findings.**

**A consequence worth not rediscovering:** `guardedBy` is now a UNION. A `sale` is both a food-chain
disposal and a head-count dependant, so the comment claiming "at most one of these two, never both"
became false in the same commit that made it so — corrected there rather than left for the ninth pass.

**⬜ THE ONE FINDING DELIBERATELY NOT FIXED, and the reasoning is the point.** `reviewer` rated the
untested batch-link seam MED and said it would not close the gate without it. **§7 clause 2 says a
MED is not a merge blocker, and the rule was written before the findings precisely so it could not be
renegotiated under pressure.** The behaviour is correct today, and testing it needs a store+auth
harness for a hook. It is a tracked issue on `main`, not a Phase 2 blocker. **If JP prefers the
reviewer's judgment over the rule, say so and build the harness — but change the RULE, not this one
case.**

**Gate after: 84 files / 944 tests** (was 941), bundle **146.92 KB** gz — superseded by §2r's
952 / 147.77 KB. Every fix has a test watched
to fail against the old code first, and **each red was confirmed for the RIGHT REASON** rather than
banked: `expected false to be true` on the Save-disabled assertion; the theft tally coming back
carrying `counterparty: "Willem Botha"`; `OUT_B` and `IN_C` present in the sent log while their
funding arrival was held.

**Also this session, before the pass:** `036300b` bound the dev database to loopback. `'5432:5432'`
publishes on `0.0.0.0` AND `::`, so the development Postgres — credentials `werf`/`werf`, in the same
file — was reachable from every network the laptop joins. Confirmed live with `netstat`, not
inferred. A container audit found NOTHING unauthorised: two images, both pinned in this repo, and the
"other containers" that appear during a session are testcontainers' own ephemeral Postgres instances
and its `ryuk` reaper.

**The rules that came out of this pass:**

- ⭐ **Two agents proposing the same fix is not two agents agreeing.** One proposal here would have
  reintroduced a false refusal. Reconcile proposed fixes against each other, not just findings.
- ⭐ **A shared subject space eventually conflates two questions.** The outbox hold mechanism has been
  widened five times and each widening exposed the next reader; the fifth was not another reader but
  the SPACE ITSELF being too narrow to distinguish "residue settled" from "head available".
- **Closing a false refusal can open a false pass**, which is the sharper direction, and it lands on
  the arm ADJACENT to the one that was fixed. §2o's own lesson ran the other way; both are live.
- **A stale correction is created by the correction commit.** `faf0c19` existed to stop `user-guide.md`
  lying and introduced three new false claims. Same class as `ci-cd.md` in §2p, one session later.
- **A `python3` patch bypasses the format hook.** Four files failed `prettier --check` in the gate
  because the PostToolUse formatter only fires on Edit/Write. Run prettier on anything patched by
  script.

---

## 2r. The NINTH review pass (2026-08-05, eighteenth session) — two SEV-2s, and §7 clause 4 FIRED

**JP triggered it. Scope narrowed under §7 clause 1 to `bd78e53..HEAD`** — the eighth pass's own fix
commit `0b2adc6` (11 source files) plus the §2q write-up. Nothing else on the branch was unreviewed.
All three agents in parallel, output read directly, **ninth consecutive NOT APPROVABLE.**

⛔ **THIS WAS THE LAST PASS §7 ALLOWS (clause 4: hard ceiling of two).** It returned SEV-2s, so the
rule's instruction was followed: **no tenth pass was spawned**, and the question went to JP as a
scope decision. JP chose to replace the mechanism rather than descope it.

### The agents SPLIT on severity, and the adjudication is the point

| Agent | On the head-hold defect | Verdict |
|---|---|---|
| `sync-auditor` | **SEV-2** | NOT APPROVABLE |
| `reviewer` | **MED-1** — "a hold that retries and keeps everything" | **APPROVABLE** |
| `compliance-checker` | did not find it; argued clause 4 had NOT fired | NOT APPROVABLE (own SEV-2) |

**Rated SEV-2, against `reviewer`'s vote.** Two agents found the defect independently, which is this
repo's own strongest signal. On severity: `reviewer`'s own finding text says the captures are *"held
every round, indefinitely"* and that *"a refused capture has no edit or discard path in the product,
so 'indefinitely' is literal"* — the rating and the analysis contradict each other. §7's calibration
says SEV-1/SEV-2 is *"meat reaching a truck inside a withholding, or a capture silently lost"*, and
the precedent is §2f's breeding SEV-2, rated exactly this way for the same shape: "recorded" in
`localStorage`, unsendable on the wire.

⭐ **`compliance-checker`'s "clause 4 has not fired" was true of its OWN finding and wrong overall.**
It verified the `head:` namespace is disjoint from residue subjects — correct, and that is what would
have caused a false REFUSAL of a departure from a dipped camp. `sync-auditor` asked a different
question: a decrease funded by the mob's own baseline, held by an unrelated refused increase. Not a
contradiction; one is narrower. **Two agents checking "the same" mechanism can be checking different
questions — reconcile what each actually tested, not what each concluded.**

| Sev | Found by | What was wrong | Fix |
|---|---|---|---|
| **SEV-2** ⭐⭐ | `sync-auditor` + `reviewer` (as MED) | **The `head:<mobId>` subject held decreases that needed no held head, for ever, invisibly.** Camp of 100 on the server, a refused purchase of 10, three unrelated deaths — the server folds 100, takes 3, returns 201. Held instead: the refusal is permanent by this file's own definition, there is no edit or discard path, `blocked` is derived from the refusal map so a held item was in NO list, and the strip returned early on the refusal count so it was not even in the pending total. **"1 not sent" while three dead ewes sat on the phone.** Introduced by `0b2adc6`, the eighth pass's fix | `head:` replaced by `needsHead` — the device runs `projectHeadCount` over the baseline and the captures the server actually holds, cut at `(occurredAt, id)`, and holds only on a real underflow. **The same projection `deriveHeadCount` runs**, so the two sides cannot disagree |
| **SEV-2** | `compliance-checker` | **The theft-record fix stopped at the screen.** `0b2adc6` scoped `counterparty`/`priceCents` to a trade in `AdjustMobScreen` and its own comment documented the boundary as still open: `mob-tally.ts:152` copies both for any reason, `tallyPayloadSchema` constrained neither. A named third party on a theft record is banned outright by `.claude/rules/domain.md` — POPIA s26, in an append-only log with no edit path | Reason-scoped in `tallyPayloadSchema.superRefine`, mirrored on `recordMobTallyRequestSchema` so the wire refusal names the field. Enforced BEFORE the recount early-return |
| MED | `reviewer` + `sync-auditor` | **The fail-closed day check was discarded by its own caller.** `latestClearAcross` returned `{blocked: true}` for an unreadable day, but `mobWithdrawal` recomputed `blocked` whenever an arrival was present. `''` survived only because `latestArrivedWithhold` also skips everything on an empty day; a malformed day that sorts HIGH (`'2026-7-5'`) took the other branch and came back **CLEAR** for a flock inside a live withholding | Moved to the two public entry points. Watched to fail: `expected false to be true` |
| MED | `sync-auditor` + `compliance-checker` | **A food-safety block with nothing on screen saying why.** `blocked` no longer implied `clearFrom !== null`, and all five explanation panels were gated on the date being present — so clearing the date field made the red panel VANISH while Save stayed disabled | `loss.needDay` / `tally.needDay` in both locales, on both screens |
| MED | `sync-auditor` | A tally on a mob the server has not accepted earned a 404 **per capture** — six "needs your attention" rows for one cause | `mobrow:<mobId>` — a third, disjoint namespace, because a foreign key genuinely IS a graph question |
| MED×2 | `reviewer` | Four comments in `Outbox.tsx` the fix made false, one three lines above the change (*"a death… is not held for evidence"*); `offline-sync.md` invariant 5 still described the narrower mechanism | Corrected; the doc now states all three namespaces, the arithmetic rule, and that a hold is reported |
| LOW×4 | all three | `user-guide.md` "tap the 'not sent' line" (it is a `role="status"` div; the control is a separate **See what** link); `Settings → Export data` and `Settings → Storage`, neither of which exists — Settings has four children and always has; `mob-tally.ts`'s summary line contradicting its own correction ten lines down | All fixed. The as-at block now says an UNCLASSIFIED section is where a false claim hides |

### ⛔ The meta-finding, which matters more than either SEV-2

**§2q claimed "all 14 pre-existing outbox tests still pass, which is the check that no false hold
crept in". Not one of those tests refuses an INCREASE.** The check was structurally incapable of
detecting the defect that was there. This is the "assertion that cannot fail" class promoted one
level: not a test that cannot fail, but a **gate claim** that cannot fail — the sentence that ends
the argument and licenses the merge. §2q's three factual slips are corrected in place above.

**Ask of any "and the existing tests prove it did not regress": what edit would those tests catch?**

### What the fix actually changed, and why it is not a sixth widening

The hold mechanism had been widened five times, each widening exposing the next reader. The ninth
pass's diagnosis is that **head availability was never a graph question.** The server refuses a
decrease only when its own fold goes negative; a subject can only say "something this mob's count
depends on did not land", which is a different and much broader claim. So the device now runs the
server's test instead of approximating it — the repo's own general rule for aggregates (§2b),
applied to the hold. `recount` needs no special case: `projectHeadCount` already RESETS on one.

**Three namespaces remain and they are deliberately disjoint:** bare ids for a withholding, a batch
id for the two halves of a move, `mobrow:` for the mob row. Each answers one question.

**And a held capture is now REPORTED** — `/not-sent` lists it under "Waiting on one of the above",
the strip shows `1 not sent — needs your attention · 3 to send`. Not styled as a problem, because it
is not one and the farmer can do nothing about it. **A hold nobody can see is a lost record.**

### Discipline

**Gate after: 84 files / 952 tests** (was 944), bundle **147.77 KB** gz. A real execution — 221s,
exit 0, run alone with no agents competing for Docker.

Every fix has a test watched to fail against the old code first, **and each red was confirmed for
the RIGHT reason rather than banked.** The head-hold bound test first went red on the strip WORDING,
which masked the assertion it exists for; the wait was loosened to a regex and the red moved to
`expected '[…]' to contain '…c3'` — the death missing from the sent log. **A test whose failure
names the wrong cause is most of the way to a test that cannot fail.**

The four pre-existing hold tests that asserted the strip's exact string were relaxed to an anchored
regex, NOT rewritten to match new output: each still pins "exactly one refusal", which is its own
subject. The two tests whose subject IS the strip assert the full string.

⭐ **The bound tests are the deliverable as much as the fix is.** `SENDS a death the mob can fund`
and `still HOLDS a decrease the mob genuinely cannot fund` are the same guard with one number
changed. A suite that only ever asserted the holding direction is what let the over-broad version
look correct for a whole pass.

### The rules that came out of this pass

- ⭐ **A gate claim can be unfalsifiable too.** "These N tests still pass" is worthless unless at
  least one of them could have failed. Name the edit it would catch.
- ⭐ **Severity is the reviewer's call, not the agent's.** Two agents found this defect; one rated it
  MED on a premise its own finding text contradicted. Read the analysis, not the label.
- ⭐ **Agents checking "the same mechanism" may be checking different questions.** One verified no
  false refusal and concluded the mechanism was sound; the false HOLD was a different question, and
  the conclusion did not cover it.
- **When a mechanism has been widened five times, stop widening.** Ask what question it is
  approximating and whether the exact answer is available. Here it was, on the device, already
  imported by a screen two files away.
- **A comment three lines from the change is the one that goes stale.** Fourth-plus occurrence.

---

## 2n. The Phase 2 build list is empty (2026-08-03, fourteenth session) — UNREVIEWED

**A BUILD session.** Four commits. `pnpm verify` green after each: **84 files / 934 tests** (was
83/922), bundle **146.45 KB** gz. **No agents run** — not asked, and the rule is owner-triggered.

| Commit | What |
|---|---|
| `d0dd571` | **§2m #1 — the two halves of a move are ONE action (FR-102/FR-112).** A shared batch id, REQUIRED on a transfer half and refused on every other reason |
| `6abb6cf` | **§2m #2, #3, #5, #6** — the non-SEV leftovers. Three of the four were a screen or a projection stating something untrue |
| `3ca3a2c` | **§4 A9 DIAGNOSED and fixed.** Not an app defect; see §4 A9 |
| this one | STATUS |

**The decisions inside the transfer link worth not re-litigating:**

- ⭐ **The batch id IS sent, unlike `carriedWithholdUntil`, and the distinction is the useful part.**
  A withholding is a regulated value the server must own — a phone with a stale product register
  must never shorten one by being the one that did the arithmetic. A batch id is not that: it is the
  FACT that two captures were one action, and only the device that performed the action knows it.
  The halves reach the server as separate requests, possibly days apart, with nothing else in the
  second to recognise the first by. The server cannot invent it, so the server must be told it.
- ⭐ **REQUIRED, not optional, and enforced in `recordMobTally` rather than at the wire.** An
  optional link is one a caller forgets — which is exactly what happened: `batchId: null` was
  written for a year under a comment claiming the halves were "tied by the envelope's `batch_id`".
  `recordMobTally` is the one function BOTH the device and the server build a tally through, so a
  rule there cannot hold on one side and not the other. Restating it in the request schema would be
  the hand-written duplicate that drifts; the wire field is nullable and the capture refuses a null.
- ⭐ **The flush now sends DEPARTURES, then arrivals, then everything else** — one pass more than
  the arrivals-before-disposals rule needed. `tallyPass` is a total function rather than three
  filters, so a reason added later cannot fall out of the queue silently.
- ⭐ **A HELD item now taints what it provides, and this is the sharper half of the slice.** `taint`
  means "the server does not have this"; a refusal is only one way to get there. No queue item had
  ever had BOTH `provides` and `guardedBy`, so this could not bite — a held `transfer_in` has both,
  and without it the destination mob stayed clean and the slaughter behind it posted to a server
  that had never heard of the arrival. **This is the fifth pass's finding A and the sixth pass's
  `transfer_in`-provides finding, arriving a third time one layer further in.** Worth expecting a
  fourth: this mechanism has now been widened three times and each widening exposed the next reader.

**⚠️ A test-fixture bug found by refusing to accept a green test, and it generalises.** The outbox
test was directional — it went red against the old code — but it failed on an assertion named
`IN_ID`, which did not match how the mechanism was supposed to work. Chasing that rather than
banking the red found that `IN_ID` had been given the same value as the file's existing `TALLY_ID`,
so ONE seeded id stood for two captures and the assertion was firing under the wrong name. **A test
that goes red for a reason you cannot explain is not yet evidence.** Both halves are now proven
separately: the old ordering sends the arrival, and deleting the taint-on-hold line sends the
slaughter.

**The rules out of this session:**

- **A comment that describes a mechanism is a claim, and this repo's comments have been wrong about
  their own mechanism four times now.** `batch_id` "ties the halves"; `withdrawal.ts`'s header said
  both entry points read both routes; `residue.ts` claimed a closed defect it still had; the
  `/land/walk` a11y comment counted two panels where one renders. Every one was written in good
  faith and outlived its premise.
- **Three absences are sometimes three facts.** The land list had learned "walked vs not walked" and
  still collapsed "no shape at all" into "shape typed in but never walked". The gestation cold-cache
  lesson keeps generalising one state further than it was learned.
- **A false sentence on a compliance screen is worse than a missing one**, because an auditor reads
  it as a fact. `/attention` told a farmer a capture was "not sent yet" when the server had it and
  had merely not flagged it — which the server is entitled to do, holding more of the log.

⛔ **Both the transfer link and `/attention` are REGULATED (FR-131 — a withholding carried across a
transfer, and the residue register). Saying so out loud is the §6 obligation: they are UNREVIEWED,
and the SEVENTH pass now has them to cover as well.**

---

## 2m. What the THIRTEENTH session did not fix — ALL NOW CLOSED except #4

Kept for the record. #1, #2, #3, #5 and #6 are built (§2n, `d0dd571` and `6abb6cf`); **#4 stands as
the recorded decision it always was, not as a defect.**

Named so the next session does not re-derive them. None is a SEV.

1. ✅ **CLOSED (`d0dd571`) — the two halves of a transfer were not linked (MED, `sync-auditor`).** `recordMobTally` writes
   `batchId: null`. They are two queue items with two ids, so a refused `transfer_out` — the as-at
   fold finding the source short — does not hold back the `transfer_in`, and the destination gains
   head that never left anywhere. **This is a BUILD SLICE and it is the top of the next session's
   list:** a shared batch id on the wire (schema + service + domain + client) and a flush that holds
   the second half when the first is refused, through the `provides`/`guardedBy` mechanism that
   already exists. The false comment is gone; the gap is now stated in the schema itself.
2. ✅ **CLOSED (`6abb6cf`).** `herd.ts` `positionByAnimal` ordered by `localeCompare` on `occurredAt` alone — outside
   the review range, and the sibling of a projection corrected inside it.
3. ✅ **CLOSED (`6abb6cf`).** `LandScreen` said "fence not walked yet" for a camp with a TYPED `boundaryGeojson`, collapsing
   three states into two — the "two absences are two facts" rule again.
4. ◐ **STANDS — a decision, not a defect.** `DraftStore` is last-write-wins across tabs (no `storage` listener). Consistent with
   `capture-store.ts`, so not new; a walk is a single-tab act in practice.
5. ✅ **CLOSED (`6abb6cf`).** `AttentionScreen` kept "Saved on this phone. Not sent yet." on a row the server legitimately
   omits. Fails toward blocking, so not a safety issue, but it is a false statement on a compliance
   screen.
6. ✅ **CLOSED (`6abb6cf`).** The a11y comment for `/land/walk` said "the two tinted warning panels"; the act renders one.

---

## 2k. B7 closed — a fence can be walked (2026-08-02, twelfth session) — UNREVIEWED

**A BUILD session.** One commit, `f6d4c0e`, closing **§4 B7** — the largest named Phase 2 remainder
and the only build work a session could still do alone. `pnpm verify` green: **83 files / 909 tests**
(was 80/847), bundle **145.82 KB** gz. `pnpm test:e2e` **27/27 on a cold run**. **No agents run**
(instructed).

⭐ **B7 was chosen over asking for the batched review deliberately, and §5 had already prescribed
it: B7 is NOT regulated, so it adds nothing the pass must cover. Doing it BEFORE the pass costs one
pass; doing it after would have owed a second.**

**The gap it closes.** `land_units.boundary` (PostGIS) and `boundary_geojson` (the client's mirror)
have existed since migration 0008, and `POST /land-units` has accepted and converted a polygon since
the land slice. Nothing in the product had ever produced one — a boundary could only be TYPED, which
in practice means no farm has ever had a boundary at all. It is the same class as §2b's "a field
that exists everywhere except on a screen is null in every record you have", one level up: a whole
COLUMN, a trigger, a dual-write and an integration test, all correct, all about a value nothing
could author.

**The decisions inside it that are worth not re-litigating:**

- ⭐ **A boundary is an ABSOLUTE THAT RESETS — a recount of a shape — so it is a log with a
  re-derived column, not a column write.** `land_units.boundary` is the denormalised current value
  of the `boundary_walk` log, re-selected after every arrival by the total order
  `(occurred_at, id)`. Two phones offline in one week can both walk a camp; arrival order is not
  `occurred_at` order, and a server that wrote each arrival straight onto the column would leave the
  boundary at whichever phone reconnected LAST rather than at whichever walk HAPPENED last. This is
  CLAUDE.md's promoted rule applied at the design stage instead of after a review found the drift.
  **The superseded walk is kept** — it is a true fact about a fence that really was there.
- ⭐ **The `(occurred_at, id)` cut runs identically on the device.** §2f's MED finding was the client
  ordering by `occurredAt` alone while the server used the pair; §2h finding A was two client
  mechanisms computing one boundary two ways. Both lessons are applied up front here: one comparison,
  written once, byte-compared (not `localeCompare`), on both sides.
- ⭐ **Area is spherical excess, not a flat grid.** Treating degrees as flat over-reads east–west by
  1/cos(29°) — about 14% — and a grazing figure wrong by a quarter is a camp overgrazed. **The tests
  are written to fail against that implementation rather than merely to pass against this one:** the
  same 0.01° box must measure LARGER at the equator than in the Free State, which no flat-grid
  implementation can satisfy.
- ⭐ **Every refusal is computed ON THE DEVICE.** Too few corners, a fence crossing itself (including
  via the closing leg, which is the crossing nobody sees coming), corners enclosing nothing. A
  server-side-only rule would refuse a fence days later when nobody is near the corner that was
  wrong — CLAUDE.md's "a guard only the server can run arrives after the truck has left", in a
  non-regulated domain. PostGIS `ST_IsValid` still runs server-side as the boundary behind it.
- ⭐ **The walk is durable from the FIRST corner, not from Save.** A 200 ha camp takes the better
  part of an hour; phones lock and browsers discard backgrounded tabs. A new `DraftStore` in
  `@werf/sync` — a THIRD sibling, not a widening of the append-only capture store and not the
  reference cache — persists each corner as it is marked. The three-way distinction is in its header:
  captures are facts, reference data is a copy of something the server owns, a draft is one
  unfinished thing that stops existing when it is finished or abandoned.
- **The wire carries the CORNERS and never the ring.** The server rebuilds the polygon with the same
  `@werf/domain` function the device ran, so a shape and its own evidence cannot disagree — the
  discipline the projected due date already follows. There is a test that CAN fail on it: restoring
  `boundaryGeojson` to the request schema reds it (§2f's LOW finding, that an assertion which cannot
  fail is not a test).
- **The corners keep their fix accuracy.** A boundary walked at 40 m under trees and one walked at
  4 m in the open are the same polygon and are NOT the same claim. Stored, surfaced while walking,
  and never used to block a save: the farmer at the corner knows things the screen does not.
- **`land_units.hectares` is never overwritten by a walk.** One is the farmer's declared figure,
  often off a title deed; the other is where the fence actually runs. Both are shown side by side and
  neither quietly replaces the other — the same posture as `knownAtCapture` vs `withinWithdrawal`.
- **`boundary_walk` is FARM-scoped (FR-113's second exception, after `rainfall`).** A camp is ground:
  the same camp carries cattle this winter and sheep next, so filing its shape under one enterprise
  would hide it from the other side of a mixed farm.
- **`geolocation.ts` moved from `livestock/` to `geo/`.** Three unrelated captures ask it the same
  question now (theft, loss, land). A land screen reaching into `livestock/` for its GPS is the
  wrong-home mistake in another costume.

**Two defects were introduced by this session's own code and caught by tests watched to fail first:**

- **`no_area` compared the measured area to exactly zero.** Three collinear fixes sum to ~1.1e-10 ha
  of floating-point dust, not to nothing, so a straight fence line was accepted as a piece of ground.
  Now compared against a NOISE FLOOR (1e-6 ha = 0.01 m²) — four orders above the noise and eleven
  below anything a person could walk around, so it refuses nothing real. **The rule: an `=== 0` test
  on a computed float is a bug wearing a correctness costume.**
- **A test parsed a BUILT event with `newEventSchema`.** `timestampSchema` parses a string INTO a
  Date, so the envelope schema describes what arrives on the wire and not what a builder returns —
  the same `ResidueFlagJson` / `ResidueFlag` distinction §2j had to make, found again one session
  later in a different shape. The assertion now uses the payload schema, which is what the domain
  actually validates against.

**Both order-dependence tests were watched to fail against the naive implementation**, which is the
discipline and not a formality: the server's re-derivation was temporarily switched to arrival order
(`created_at desc`) and the ⭐ test reported 108 ha where 325 was correct; the client's fold was
switched to last-captured-wins and both ordering tests red. Restored, both green.

**⚠️ One thing to distrust in this section.** `pnpm test:e2e` ran **27/27 on a cold run** here, and
§4 A9 says the cold run fails two light-theme a11y tests. **That is not a fix and must not be filed
as one** — nothing was done to A9, the snapshot-on-failure instrumentation `40ea435` added never
fired because nothing failed, and a bug that does not reproduce once is a bug that did not reproduce
once. A9 stays open.

⛔ **This slice is UNREVIEWED, like everything since `b95eb09`.** It is NOT regulated — no payroll,
no animal ID, no withdrawal, no POPIA surface — so under §6 it adds nothing the batched pass must
newly cover, but it is still one author's ~2,600 lines with no second reader.

---

## 2i. Two live defects in OUR OWN TOOLING (2026-07-31, tenth session) — found by `/doctor`, fixed, UNCOMMITTED

No phase work this session. A harness health-check read 46 session transcripts (2026-07-05 → 07-31,
44,365 lines) and the timing data exposed two defects in `.claude/` that no test could ever have
caught, because `pnpm verify` does not check whether the hooks themselves do what they claim.

| # | What was wrong | Evidence | Fix |
|---|---|---|---|
| **A** ⭐⭐ | **The migration-immutability guard was SILENTLY NOT RUNNING.** `guard-migrations.sh` was configured with a repo-relative path, so it failed with `No such file or directory` on every Edit/Write issued while the cwd was not the repo root — e.g. the `packages/db` migration renames. It is a non-blocking hook, so those edits proceeded **unguarded**. The rule it enforces ("NEVER edit an applied migration") is one this repo calls non-negotiable | **71 failures** in the window (52 Edit + 19 Write), every one silent | All four hook paths now resolve via `${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}`. Verified blocking correctly from a subdirectory |
| **B** | **The PostToolUse formatter never once formatted the edited file.** It read `$CLAUDE_FILE_PATH`, which the harness does not set — tool input arrives as JSON on stdin, which is exactly how the sibling `guard-migrations.sh` reads it. So `prettier --write ""` fell back to **the whole repo** (~300 files) after every single edit, and `eslint --fix ""` errored out, meaning **autofix has never run** | 1,884 runs, 4.75s median — matching a measured whole-repo prettier run (4.66s) almost exactly | New `.claude/hooks/format-edited.sh`: parses stdin, guards on extension, single file, direct binary. **4.75s → 0.64s measured** |

⭐ **Finding A is the one that mattered.** A guard that fails open and says nothing is worse than no
guard, because the branch protection it represents was assumed to be holding for ten sessions.
**Audited: all 20 migrations are clean** — every one written in a single commit and never modified
after, no uncommitted changes. The one rename (`0004_known_dreadnoughts` → `0004_membership_acceptance`)
happened while the file was still untracked, which the guard explicitly permits. **Nothing slipped
through**, but that was luck, not the guard.

**Finding B has a side effect worth knowing:** every edit reformatted the entire repo, so any
unrelated formatting churn that appeared in a diff during phases 1–2 came from this, not from a
stray edit.

**Also changed:**
- `verify-gate.sh` (Stop hook) now fingerprints the working tree (HEAD + tracked diff + untracked
  contents) and skips only when it is byte-identical to a state that ALREADY passed. Only passes are
  cached; a failure clears it. Same guarantee, **2m52s → 0.417s** on a turn that changed nothing. It
  was costing 81s median (p90 155s, worst 218s) × 84 runs to re-prove known results.
- `Read(./.env.*)` in `.claude/settings.json` was blocking `.env.example` — a checked-in template
  with no secrets, and the cause of 5 of the month's 11 permission denials. Replaced with the
  enumerated real variants, mirroring `.gitignore`'s `.env` / `.env.*` / `!.env.example`.
  ⚠️ **Trade-off: a novel name like `.env.whatever` is no longer denied by pattern.** Deny rules have
  no negation operator, so this is enumeration or nothing.
- `CLAUDE.md`: the `pnpm` commands block removed (all ten are `package.json` scripts, and the list had
  already gone stale — it was missing `db:up`/`db:down`), plus two bullets that `.claude/rules/frontend.md`
  already carries. ~186 fewer tokens resident in every session.
- `defect-classes.sh`: the comment asserting the harness sets `CLAUDE_FILE_PATH` — the claim that
  finding B's hook trusted — corrected. That hook itself was always fine; it has a stdin fallback.

⛔ **ALL OF THE ABOVE IS UNCOMMITTED, by JP's decision this session** — it is tooling config, and
landing it inside the phase-2 PR's history was not wanted. `pnpm verify` was run cold against these
changes and passed (79 files / 821 tests). **Review with `git diff` and decide where it lands.**
Two backup files were deliberately left in place for reversibility and are still there:
`.claude/settings.json.doctor-backup` (untracked, will show in `git status`) and
`~/.claude/settings.json.doctor-backup`.

**Not done, offered and declined this session:** pruning the 186 accumulated `permissions.allow`
entries in `.claude/settings.local.json`; re-enabling background auto-updates (`autoUpdates: false`,
currently on 2.1.220 which IS latest).

---

## 3. The review-agent pass (2026-07-26, second session)

`reviewer`, `sync-auditor` and `compliance-checker` were run over the whole branch **as it stood at
`a6c8eff`**, in parallel. Everything below was found by an agent and FIXED in that session, not filed
for later. Two of the three found the same top defect independently, which is the finding to trust
most.

| # | What was wrong | Where |
|---|---|---|
| 1 | **One refused capture stranded every capture behind it, permanently.** The flush `return`ed on a server refusal instead of continuing. The queue rebuilds in the same FK order every round, so the poison item was always first: 60 tags captured in a crush, one with a misread duplicate digit, and nothing behind it could ever be sent again. Found by `sync-auditor` **and** `compliance-checker` independently | `apps/web/src/sync/Outbox.tsx` |
| 2 | **Seven client-settable cross-farm foreign keys were unchecked** — `enterpriseId`, `brandId`, `parentId`, `incidentId` across animals, mobs, camps, theft incidents and events. Sharpest was `animals.brand_id`: a brand register IS the ownership claim an evidence pack rests on | `event-capture.ts`, `livestock.service.ts`, `land.service.ts` |
| 3 | **A whole-mob dip's meat withdrawal was invisible to the sale guard.** The guard filtered `events.animal_id` only, but a plunge dip — the canonical whole-flock operation — is captured against the MOB, so its `meatWithholdUntil` lands on an event with `animal_id = NULL` | `livestock.service.ts` |
| 4 | **The health screen stamped the treatment date with `now()`**, turning ADR-0005's dated product lookup back into a `now()` lookup | `RecordHealthScreen.tsx` |
| 5 | **The capture screens were axe-audited in ONE theme** while three places claimed both. `WCAG_TAGS` includes `wcag2aa`, so axe runs `color-contrast` — the one rule whose result is theme-dependent | `apps/web/e2e/a11y.spec.ts` |
| 6 | Two remaining instant→day conversions bypassed the farm's zone: the rainfall screen used the DEVICE's zone, and the reference endpoint defaulted `onDay` with `toISOString().slice(0,10)` | `RecordRainfallScreen.tsx`, `reference.controller.ts` |
| 7 | **`LoggingMailer` wrote the invitee's address and the full invitation body to the log**, selected purely on `SMTP_HOST === undefined` (POPIA s19). Production now refuses to boot instead | `mail.module.ts`, `mailer.ts` |

**Rules that came out of that pass:**

- **A 4xx and a 5xx are different animals in a flush.** A 4xx is the server refusing this record on
  its merits — it will refuse it again tomorrow, so the item is set ASIDE (kept, never dropped) and
  the round continues. A 5xx or an unrecognised error is transient and aborts the round.
- **`insertEvent` is where a write-path invariant belongs**, not the twelve call sites.
- **A "one theme is enough" shortcut in an a11y test is only ever true of markup.**

**What was verified clean and should not be re-audited:** migrations 0008–0016 (every domain table
carries `farm_id` under `FORCE ROW LEVEL SECURITY`, no `DELETE` granted anywhere, all PKs client
UUIDv7); `tenancy.spec.ts` genuinely derives its table list from the drizzle schema and compares in
both directions; no `navigator.onLine` in any write path; no hardcoded regulated number anywhere on
the branch; capture authorship is audit logging, not the worker tracking ADR-0010 refused.

---

## 2c. Seven commits closing §3b (2026-07-27, sixth session)

The gate ran green after every one, and **each fix was verified in BOTH directions** — the new test
was watched to fail against the old expression before being kept. That discipline is the point of
the section; a test written after a fix that was never seen to fail proves only that it compiles.

| Commit | Finding | What |
|---|---|---|
| `6690d85` | **SEV-1 #1** | **A dip and a move on the same day cleared meat still in withdrawal.** Membership was rebuilt from real move INSTANTS and compared against a dose instant that is partly fabricated. Now compared in farm-local DAYS, inclusive at BOTH ends. Also: `administeredOn` is now STORED on the health payload — the dose day was used for the arithmetic and then thrown away, so the guard had nothing to read but the invented instant |
| `4f552e8` | MED #7 | **The device folded the tally log over its own output.** `initialHeadCount` is a field on `mobSchema`/`newMobSchema` now, not a property of a comment |
| `7b17c2e` | SEV-2 #4, #5, MED #6, #8 | **Individual SLAUGHTER is guarded** (a flag on the death payload, both halves built); **the as-at cut** takes the whole `(occurredAt, id)` pair; **a move's FROM side** is reconstructed from the log instead of stamped from `animals.mob_id`, and a back-dated move no longer walks the animal backwards |
| `7197d80` | SEV-2 #3 | **A mob could be tallied to slaughter with an individually-treated animal in it.** The guard now asks "is anything standing in this mob still inside a withholding" rather than "was this mob dosed" |
| `511cf3c` | SEV-3 #9, #11, LOW #12 | The pack states a photo REFERENCE instead of claiming "Yes"; the translated refusal is what the farmer reads with the domain's English underneath; `toISOString().slice(0,10)` is out of the test assertions |
| `8812347` | **SEV-1 #2** | **Dip a whole flock, and refuse to send a dipped one to the abattoir.** The slice — see the note below |
| `395b658` | SEV-3 #10 | The evidence pack carries the possession trail, a per-animal certificate, and retired identifiers |

**⭐ The finding-2 slice was bigger than the finding said, and the reason generalises.** §3b filed it
as "the guard is server-only; mob-subject health events must reach the device first." The real hole
was one level down: the device could not RECORD a whole-flock dose at all — `StoredHealthEvent`
required an `animalId` and the screen fanned a dose out per animal, so a flock run by head count,
which has no animal rows and never will, could not be dipped from the phone. The guard had nothing
to read because the capture did not exist. **When a review says "X cannot see Y", check that Y is
something the product can produce before believing the fix is a read path.**

**Finding 5 is CLOSED WITH AN ARGUMENT, not with code, and the argument is the deliverable:**

- **`death`, `theft` and `recount` are deliberately NOT guarded.** They reduce head identically, but
  none of them puts meat into the food chain, and refusing to record a death would refuse to record
  a FACT — which is worse than recording it, and is how a guard teaches people to work around it.
  Both bounds are tested: a dipped flock can still record a death.
- **The `purchase`/`transfer` half is a modelling decision, not a defect**, and it is now §2.3b for
  the repo owner. It needs a tally reason that does not exist and an answer about bought-in stock
  whose treatment history we never saw.

**The rules that came out of this session:**

- **A boundary between two clocks of different precision must be compared at the COARSER one.** A
  dose is day-grained and a move is instant-grained; comparing them with `<` decides a residue
  question on which of two arbitrary readings is larger. This is the general form of finding 1, and
  it will recur wherever a captured DAY meets a captured INSTANT.
- **A value used for arithmetic and then discarded is a value the next guard cannot check.**
  `administeredOn` computed the withdrawal and was thrown away; every later question about the dose
  had to be answered from an instant invented to store it.
- **Verify a fix in BOTH directions or it is a guess.** Every fix here was watched to fail before it
  was kept — the exclusive boundary failing exactly two tests, `mob.headCount` rendering exactly the
  predicted 318, dropping `!withheld` failing the abattoir test alone.
- **"The read path is wrong" and "the write path is wrong" are two findings.** `cc1b149` fixed
  reading `animals.mob_id`; the write path kept stamping it into an append-only log. Finding 8 was
  the same bug wearing the other hat.
- **The author of a fix cannot close the review that found it.** Recorded here because this session
  produced seven commits against a NOT APPROVABLE verdict and cannot itself lift it (§2.1d).

---

## 2d. The THIRD review-agent pass (2026-07-27) — eight findings, all in §2c's own fixes

All three agents over `5c769b4..HEAD`. **`compliance-checker`: still NOT APPROVABLE.** Every finding
below is now fixed, each verified in both directions.

⭐ **The headline is not any one finding — it is that pass three found eight defects inside pass
two's twelve fixes.** Two of them were found by two agents independently, which by §3's rule is the
signal to trust most.

| Commit | Sev | What |
|---|---|---|
| `16fbb6a` | **SEV-1** | **The flush sent the dose AFTER the disposal it had to be judged against.** The queue was ordered by foreign keys alone, so health events — which CREATE a withholding — went second-to-last. The server's guard is a point-in-time query and cannot refuse what it has not received: dip the flock Monday offline, tally forty to the abattoir Tuesday, reconnect Friday, and the tally POSTs first and gets a **201**. It also falsified the invariant §2c had just written into `withdrawal.ts` — "the server still refuses what the client lets through" |
| `713634b` | SEV-2 ⭐⭐ | **Both client guards disagreed with the server, in opposite directions.** `reviewer` found the individual path blind to MOB doses; `sync-auditor` found the group path blind to INDIVIDUAL ones. Health events are animal-XOR-mob; each guard read one column. Membership is now reconstructed on the device from the move log, the same shape the server runs |
| `713634b` | SEV-3 | **A slaughter/sale was stamped `new Date()` and the day never asked** — so one inside a withholding, written up after the clear date, passed and left a record saying it was legal. Same defect class as the health screen's `now()`. Also: `t('loss.slaughtered')` was writing **farmer-facing copy into an audit field** |
| `3b0d2e8` | MED | **The `??` reintroduced finding 7 as a fallback.** `initialHeadCount ?? headCount` fires on both `undefined` (legacy, safe) and `null` (explicit, dangerous) — so a hydrated row with no baseline would fold the log over its own output, silently, on every counted mob at once |
| `3b0d2e8` | MED | **The client refused to record a true back-dated fact.** It folded the whole log then judged a past capture against the present: sell the flock on the 20th, remember five ewes died on the 18th, and Save is disabled. The server was fixed for exactly this; the screen was not, so the capture never reached it |
| `f38af66` | SEV-3 ⭐⭐ | **The possession trail dropped every whole-flock dose** (both agents). An animal dipped with its mob monthly printed "Treatment history: None recorded" in the document whose value is showing continuous husbandry — the smallholder's animal, and the reverse-onus defence |
| `f38af66` | SEV-3 | **The certificate still over-claimed, one case along.** Nulls were filtered before counting distinct values, so one marked animal among two unmarked printed its certificate at the head of the pack |
| `e5792d3` | SEV-2 | **A blocked "Slaughtered" sat one tap from a silent "Died".** A death must never be refused — but saying nothing taught the workaround. It is now recorded AND flagged `withinWithdrawal`, on the event and on the screen |
| `e5792d3` | SEV-2 | **axe was auditing seventeen screens and almost no widgets.** The e2e seed wrote only the session, so every capture screen rendered its empty state — and the spec's own "assert it rendered" guard passed, because the heading sits outside the conditional |

**⚠️ A correction to §2c, which overstated its own rigour.** §2c claimed *each* fix was verified in
both directions. That was false for findings 9 and 10: the pack tests asserted `%PDF-` and a
non-zero length, so the entire renderer could be reverted — including "Photograph on file: Yes" —
without a single test noticing, and `possessionTrail` had no coverage at all. Both now have real
assertions. **A claim about test rigour is itself a claim that needs checking.**

**The rules that came out of this pass:**

- **A guard's inputs must arrive before the thing it guards.** FK ordering answers "will this row
  insert"; it does not answer "will the check have the evidence". Any queue feeding a server-side
  rule needs the second question asked of it explicitly.
- **When a premise changes, go back for the comments that rested on it.** "The device cannot see mob
  doses" was true when written and false three commits later, in the same branch, by my own change —
  and the guard built on it stayed narrow.
- **`??` is not `=== undefined`.** Where `null` and `undefined` mean opposite things, a nullish
  fallback silently picks the dangerous reading.
- **An assertion that cannot fail is not a test.** `%PDF-` proves a file exists, not that it says
  anything. Ask of every test: what edit would this catch?
- **An empty-state audit is not a screen audit.** A heading rendering outside a conditional will
  satisfy a "did it render" guard while the controls under test are absent.
- **A checklist line is part of the diff that makes it stale.** Three lines described pre-fix
  behaviour for a whole session, one of them documenting a defect as the design.

---

## 3b. The SECOND review-agent pass (2026-07-26, fifth session) — ✅ ALL TWELVE CLOSED IN CODE 2026-07-27

> ⛔ **"Closed in code" is not "cleared."** Every fix is in §2c with a test, and the gate is green —
> but `compliance-checker`'s NOT APPROVABLE verdict was the AGENT's, and only a fresh agent pass can
> retire it. §2.1d. Do not read the table below as a clean bill of health.

`reviewer`, `sync-auditor` and `compliance-checker` were run over `a6c8eff..HEAD` (the ten commits
§4 A6 owed). **Unlike the first pass, these findings are CARRIED, not fixed** — the two SEV-1s need
slices rather than edits, and this session was scoped to docs, review and reconciliation.

**`compliance-checker` verdict: NOT APPROVABLE** — and it STANDS until §2.1d runs, whatever the
Fixed column below says.

⭐ **Two of the three agents independently found the same top defect**, which by this repo's own
rule (§3) is the finding to trust most.

| # | Sev | What is wrong | Fixed |
|---|---|---|---|
| 1 | **SEV-1** | **Mob membership is compared as INSTANTS; dosing is day-precise. False CLEAR.** `mobMembership`/`latestMeatClearForAnimal` (`livestock.service.ts`) reconstruct intervals from real move instants, but a dose's `occurredAt` is fabricated — `RecordHealthScreen` stamps a back-dated dose `T12:00:00.000Z` and a same-day dose `now()`. So: dip the flock at 06:00, move them out of the dip camp at 12:00, record the dip that evening → the dip lands after the interval closed, the animal is CLEAR the next morning. A back-dated dip at midday loses to any morning move. And an exact tie (two events back-dated to the same day) is excluded from the source mob by `<` and attributed only to the destination. **This is the exact workflow `cc1b149`'s own commit message says it fixed.** The integration tests cannot catch it — they dip and move on DIFFERENT days. **Fix:** compare farm-local DAYS, inclusive at BOTH ends, using the dose's `administeredOn` rather than the fabricated instant. On the day of a move the animal counts as having been in both mobs — over-withholding costs a farmer a day, under-withholding is a residue traceback. Found by `compliance-checker` **and** `sync-auditor` independently | `6690d85` |
| 2 | **SEV-1** | **The new group guard does not run at capture, and offline is the default state.** `AdjustMobScreen` has no withdrawal check; the guard is server-only. Flock dipped Monday; Tuesday, no signal, farmer tallies 40 to slaughter; the screen says "saved, 260 head"; the truck loads; Friday the flush 400s and FR-009 sets it aside permanently. The individual path's own header says catching this at capture "is the only version of this rule that reaches the person who can still act on it" — and the group path is where the exposure is WORST (smallholders, no second system). **Not fixable by a screen change alone:** `withdrawal.ts` is keyed on `animalId` and mob-subject health events never reach the device, so they must be synced first. Raised by all three agents | `8812347` |
| 3 | SEV-2 | **The group guard is blind to individually-dosed animals in the same mob.** It filters `eq(events.mobId, mobId)`, but health events are animal-XOR-mob, so an individual treatment stores `mob_id = NULL`. Cow treated individually, moved into a counted mob, tallied to slaughter → nothing fires | `7197d80` |
| 4 | SEV-2 | **Individual slaughter is still unguarded.** `recordDeath` has no withdrawal assertion and `cause` is free text, so "slaughter for the workers' rations" is an ordinary death. The group path now blocks `slaughter` and the individual path does not — the mirror image of the hole `cc1b149` closed | `7b17c2e` |
| 5 | SEV-2 | **The group guard is routed around by the other tally reasons.** It fires only on `sale`/`slaughter`; `death`, `theft` and `recount` reduce head identically and are unchecked. And with no transfer reason in the group model, splitting a dipped flock is expressed as sale-out/purchase-in — and head arriving by `purchase` is unconditionally clear | ⚖️ §2c |
| 6 | MED | **The as-at fold cuts on `occurred_at` alone while the projection orders on `(occurred_at, id)`.** So validation folds in same-instant tallies the projection places AFTER the event being validated — and can refuse an honest back-dated capture with a 400, which is set aside permanently. `cc1b149` fixed this ordering in the projection and left it in the cut | `7b17c2e` |
| 7 | MED | **The client folds over a MUTABLE baseline; the server folds over the immutable one.** `herd.ts` uses `mob.headCount`; the server uses `mobs.initialHeadCount` (which is what migration 0018 exists for). Harmless today only because nothing writes back into the local store — **it detonates the moment PowerSync hydrates `mobs` in Phase 3**, double-counting every tally. `schemas.NewMob` cannot even express the right baseline. Fix it now while it is one field, not a migration under load | `4f552e8` |
| 8 | MED | **`fromMobId` is stamped from `animals.mob_id`** at write time — the very column `cc1b149` stopped trusting at read time — and it is then baked permanently into an append-only log that `mobMembership` reconstructs from | `7b17c2e` |
| 9 | SEV-3 | **The evidence pack prints "Photograph on file: Yes" off a client-writable `photoKey` with no object storage behind it.** Known (§4 B2), but it is an unverifiable assertion in a document handed to the SAPS Stock Theft Unit. Print the reference and its state, or omit the line — never a bare "Yes" | `511cf3c` |
| 10 | SEV-3 | **The pack is missing "movement history, treatment history establishing continuous possession"**, which `legal-compliance.md §3.2` requires and which IS the reverse-onus defence. It also prints ONE brand certificate for the whole incident (first non-null), which over-claims when stock carries different marks; and it excludes tombstoned identifiers — a tag reissued after the theft is exactly the number the animal was wearing | `395b658` |
| 11 | SEV-3 | **`toISOString().slice(0,10)` is back — in TEST assertions this time** (`RecordHealth.test.tsx`, `ReadModels.test.tsx`, `Lifecycle.test.tsx`), asserting regulated dates in UTC against code that computes in SAST. **This is a concrete candidate for §4 A8's one unexplained failure: it fires for two hours out of twenty-four.** Production code is clean | `511cf3c` |
| 12 | LOW | Raw English domain error text is shown to the farmer on an Afrikaans device — `AdjustMobScreen` prefers `error.message` over the translated `tally.refused`, so the translated string is only the fallback | `511cf3c` |

**Verified clean by this pass, and recorded so it is not re-audited:** tenancy across all three
layers for 0017/0018 (no new table to classify; both `direct` on `farm_id`); `tenancy.spec.ts` still
derives from the drizzle schema and fails on an unclassified table; `user_passkeys` is `server-only`
and the credential-column guard fails the build on a new `passkey|token|secret` column; no
`navigator.onLine` in any write path; the outbox never clears the queue on auth failure; UUIDv7
client-generated with `onConflictDoNothing` idempotency; soft-delete respected everywhere; **no
hardcoded regulated number in the diff**; vet-product lookup resolves by the treatment day and the
FARM's jurisdiction, with the clear date frozen onto the event; money is integer cents throughout;
no `suspect` field anywhere in the theft chain; the `(occurred_at, id)` total order itself is
correct and symmetric on both sides; all thirteen commits authored by the repo owner's email.

**The rules that came out of this pass:**

- **A boundary in a food-safety guard must fail toward BLOCKING.** Over-withholding costs a farmer
  a few days of a sale; under-withholding reaches a plate. When an interval is half-open, ask which
  direction the error runs before choosing the inequality.
- **Do not compare a real instant with a fabricated one.** Day-grained captures invent an instant
  (`T12:00:00.000Z`); real captures carry a true one. Comparing the two with `<` is a coin flip
  dressed as logic. Compare the DAYS, which is the precision the data actually has.
- **A test that exercises the happy geometry proves nothing about the boundary.** The withdrawal
  tests dip and move on different days, so the entire same-day class — the ordinary case — was
  untested. When a fix is about ordering, the test must put the events in the awkward order.
- **A gate has clauses, and "the easy clause is true" is not "the gate is true."** §1 read "every
  checklist line is ☑ or ◐, **so** the exit gate reads true". That "so" was a non-sequitur, and it
  survived a session.
- **Fixing a read path without fixing the matching write path leaves the bug in the data.**
  `cc1b149` stopped trusting `animals.mob_id` when reading and kept stamping `fromMobId` from it
  when writing, into an append-only log.

---

## 3c. Earlier sessions

- **Fourteen feature commits** before this session (see git log from `0194939` to `30ac2b6`). The
  four from the third session closed B8 (stock-theft client path, FR-603), B11 (a twin birth records
  two lambs, FR-104), B12 (which capture the server refused, and why, FR-009) and B10 (head per
  camp, FR-705).
- **Four real defects were found by tests rather than confirmed by them, and must not return:**
  animals could reference a NEIGHBOUR'S camp (closed by `assertOwnedReferences`); a re-flushed move
  jammed the whole queue (any capture that CHANGES THE STATE ITS OWN VALIDATION READS must check
  idempotency BEFORE validating — the FR-102 tally follows this rule for the same reason); a read
  model crashed the Animals screen on a stored animal with no `dob` FIELD; and
  `toISOString().slice(0,10)` is wrong for two hours a day in South Africa.
- **Three decisions not to relitigate:** the Health tile carries "N withholding", not "N due"; no
  SMS anywhere, ever; `createReferenceCache` is a sibling of the capture store, not a widening of it.

---

## 4. Known gaps — carried forward, not forgotten

**Owed before the Phase 2 PR:**

| # | Gap |
|---|---|
| A1–A3 | ✅ All three agents run 2026-07-26 over the branch at `a6c8eff`. Findings fixed, not filed — §3 |
| A4 | ◐ **CI GREEN 2026-07-28 AT HEAD** — run `30374965420` at `7917645`, both lanes: `Lint · Typecheck · Test · Build` and `E2E · axe (both themes)`. **This is the first run to cover `f38af66`, `e5792d3` and the B1 slice `2590c9f`**, so no commit on this branch is now unrun by CI. Verified against `gh run list`, not inferred. ⭐ **Note the asymmetry worth keeping in mind: CI's e2e lane passes while a cold LOCAL `pnpm test:e2e` fails (A9). Whatever A9 is, CI does not reproduce it.** Earlier note: CI green 2026-07-27 on the §2c commits — run `30259203581` at `395b658`: `Lint · Typecheck · Test · Build` 3m49s, `E2E · axe (both themes)` 1m25s. So the fixes are verified on a real CI machine, not only locally. Earlier note stands: **CI HAS NOW RUN, AND BOTH LANES PASS.** Draft PR #3, run `30211760029`, 2026-07-26: `Lint · Typecheck · Test · Build` green in 3m00s, `E2E · axe (both themes)` green in 1m31s. **This is the first time CI has ever executed against this code.** It also settles two things that were open: the e2e lane ran at HEAD (`664dc23`), so the "not re-run since `cc1b149`" worry is closed and it did NOT need a separate local run; and the shared-testcontainer change (A5) survived a real CI machine under real contention. The remaining half of this clause is CI green **on `main`**, which can only go true at merge |
| A6 | ✅ **THREE passes now run.** 2026-07-26 over `a6c8eff..HEAD` (twelve findings, §3b, all closed in §2c) and 2026-07-27 over `5c769b4..HEAD` (eight findings, §2d, all closed). ⛔ **Still NOT APPROVABLE, and a FOURTH pass is owed over `7c2acd9..HEAD` — §2.1e.** The empirical case for it: pass three found eight defects inside pass two's twelve fixes. Original note: Pass done 2026-07-26; **the work it produced is now done too — all twelve findings closed in code 2026-07-27, §2c.** ⛔ **But a THIRD pass over `5c769b4..HEAD` is owed and is the last thing gating the PR — §2.1d.** `compliance-checker` said NOT APPROVABLE and only `compliance-checker` can withdraw it |
| A7 | ✅ **FIXED 2026-07-26 — the e2e lane could report green against code that no longer existed.** `vite preview` serves `dist`, and `turbo.json`'s `build` task declared no `outputs`, so turbo cached only LOGS: a cache hit printed "FULL TURBO" and wrote no files, leaving whatever bundle was already on disk. Proven rather than theorised — a screen's heading was replaced with a literal and the suite stayed 25-green, then kept FAILING for five consecutive runs after the source was restored, because the broken bundle was never replaced either way. Two changes: `outputs: ["dist/**"]` in `turbo.json`, and `pnpm test:e2e` now builds first (turbo-cached, so free when nothing changed). Verified in both directions — breaking a heading now fails 2 tests, restoring it returns 25 green. **This is why the earlier "2 failed then clean on a re-run" was never a flake; do not re-diagnose it as one.** |
| A10 | ⛔ **NEW 2026-07-28 — `pnpm verify` CANNOT BE RUN on a machine with no Docker, and it fails LOUDLY rather than skipping.** 13 test files die on `Could not find a working container runtime strategy`; **272 of the 806 tests — the entire testcontainers integration tier — never execute**, and the gate exits 1. Locally the real figure was 534/806 passing. This is an environment condition, not a defect. ✅ **RESOLVED THE SAME DAY, two ways.** (1) With Docker started, `pnpm verify` was re-run and exits **0 — 78 files / 806 tests, all passing, 157s**, so the 806 figure is now confirmed LOCALLY as well as on CI. (2) A `SessionStart` hook (`.claude/hooks/ensure-docker.sh`, wired in `.claude/settings.json`) now checks the runtime at session start, launches Docker Desktop if it is down, waits up to 60s, and **never blocks** — worst case it prints a warning saying the integration tier cannot run, which beats thirteen confusing failures later. Silent and instant when Docker is already up |
| A11 | ✅ **FIXED 2026-07-30 (`513da32`).** Both ADRs cherry-picked from `docs/phase-3-6-scope` onto this branch — they reference only ADR-0001/0005/0007, all already here, so nothing new dangles. The three citations (`STATUS.md` §2.6, §3, `phase-checklists.md`) now resolve. ⚠️ Consequence for the post-merge cherry-pick of the scope branch (§2.2): those two ADR files now exist on BOTH branches and will conflict/skip — drop them from that cherry-pick |
| A9 | ✅ **DIAGNOSED AND CLOSED 2026-08-03 (`3ca3a2c`) — AND IT WAS NEVER AN APP DEFECT.** The trace `40ea435` captured was opened, which is what the thirteenth session said was the cheap next step, and it ended six sessions of hypotheses. **Both failing tests requested `/assets/index-*.js` within 4 ms of each other** — the two workers starting together — **both requests STALLED FOR TEN SECONDS, and one returned `net::ERR_CONNECTION_RESET`.** The page's own CSS and `registerSW.js` stalled the same ten seconds; a later load of the identical assets took 3–30 ms. That explains every symptom, including the ones that killed the earlier candidates: the HTML shell loaded, so the pre-paint theme script ran and the background painted (**the blank screenshot, and why the sibling `data-theme` assertion always passed**); the React bundle never arrived, so the tree rendered NOTHING and the entire choice UI was absent rather than one button; it is cold/load dependent; and the LIGHT theme is simply the one that runs first. `passkeysAvailable()` being synchronous was always irrelevant, as the eighth session had already worked out. **The cause is contention on a single-process static server:** two cold workers each fetch the page assets AND install a service worker precaching 561 KiB, all at once, and `vite preview` resets a connection rather than serving them. Going from "however many cores" to two workers narrowed it from "a different test each run" to "the first two on a cold run"; two is still concurrent. **The lane is now serialised (`workers: 1`)** — the suite is ~8s warm, so racing for sockets wins nothing. Two cold runs after: 27/27 and 27/27, 46s. ⚠️ **This reduces CONTENTION rather than making the server robust, and two green runs are weak evidence by this bug's own history — it ran 27/27 green once while completely unfixed. The DIAGNOSIS is what closes it, not the green.** Original note follows. ◐ **STILL OPEN, BUT IT FINALLY LEFT EVIDENCE (2026-08-02, thirteenth session) — READ THIS BEFORE THEORISING ABOUT A9 AGAIN.** It reproduced (25/27, `a11y.spec.ts:50` and `:64`, light theme, second factor — the same two, again), and this is the FIRST reproduction since `40ea435` added failure instrumentation, so the screenshot and trace actually fired. **The captured screenshot is COMPLETELY BLANK** — the light theme's background colour and nothing else on the page. That is a much stronger fact than anything A9 has had, and it kills the standing hypothesis: this is NOT a missing button, and it is NOT the route guard redirecting (a redirect renders the sign-in screen; a guard failure renders something). The page background proves `index.html`'s pre-paint theme script RAN and `data-theme` was set — which is also why the sibling `toHaveAttribute('data-theme', theme)` assertion has always passed. So the HTML shell loaded and the React tree rendered NOTHING. ⛔ **That is evidence, not a diagnosis, and it must not be written up as one.** No top-level `return null` was found in `App`/`AuthProvider` to explain it. The leading unconfirmed candidate is now the PWA service worker (`sw.js`, workbox precache) serving a partial or stale precache on a COLD run under load, which would fit "load/cold-start dependent" better than anything proposed so far — but the trace zip has not been opened. **Next step, and it is cheap: `pnpm exec playwright show-trace` on the captured trace, and check for a console error or a failed chunk request.** The artefacts live under `test-results/` (git-ignored) and are overwritten by the next run, so read them before re-running. Original note follows. ◐ **2026-08-02 (twelfth session): a COLD `pnpm test:e2e` ran 27/27 GREEN, and CI's e2e lane was green too — with two NEW audits added to it (`/land/walk`, empty and populated, both themes). ⛔ Do NOT read that as a fix: nothing was done to A9, the snapshot-on-failure instrumentation `40ea435` added never fired because nothing failed, and a load-dependent failure that does not reproduce once has not been diagnosed. It is one more data point that the failure is load/cold-start dependent rather than deterministic. Original note follows.** ◐ **NOW DIAGNOSABLE. 2026-07-30 (`40ea435`): the e2e config captures a DOM snapshot + screenshot ON FAILURE** (`trace: 'retain-on-failure'` + `screenshot: 'only-on-failure'`; retries stay 0). The root cause of the "no evidence" problem was that `trace: 'on-first-retry'` never fired against `retries: 0`. Next red run leaves a snapshot to read instead of another hypothesis. The candidate below (async session seed racing the route guard) is still unconfirmed — confirm it from the captured snapshot. Original note follows. ◐ **NARROWED 2026-07-28, AND A9'S OWN RECORDED SUSPICION IS RULED OUT.** Reproduced on a cold local run: **25 passed / 2 failed, exit 1, 53.9s** — the same two light-theme tests. Two things are now FACT that were not: (1) the failure is `element(s) not found`, and **BOTH** the passkey button and the "use an authenticator app instead" fallback are absent — so it is not one button, the entire choice UI is missing; (2) `passkeysAvailable()` (`apps/web/src/auth/passkeys.ts:42`) is a **synchronous** DOM check (`typeof window.PublicKeyCredential === 'function'`) consumed as `useState(passkeysAvailable)` — it has **no timing dependence whatsoever**, so **A9's recorded "async can-this-device-do-it probe" hypothesis is dead.** That leaves the screen either not mounting or mounting without a session, which points at the async session seed racing the route guard — `a11y.spec.ts:73` already comments that "the seed arrives asynchronously". ⛔ **That is a NARROWED CANDIDATE, NOT A DIAGNOSIS** — no page snapshot was captured to confirm what did render. Next step is cheap and specific: capture `page.content()` or a screenshot on failure. Original note follows. ◐ **THE FAILING TESTS NOW HAVE NAMES (2026-07-28), which is what A8 and A9 both asked for.** A full `pnpm test:e2e` reported **25 passed, exit 1** again — the same signature — and this time the names were captured before anything else: `a11y.spec.ts:50` *the second-factor choice has no accessibility violations in the **light** theme* and `a11y.spec.ts:64` *second-factor enrolment …* **in the light theme**. Both timed out on `getByRole('button', { name: /use this phone as the key/i })` — the PASSKEY button, which §2b's own rule puts behind an async "can this device do it" probe. **Evidence, not a diagnosis:** the failing run was COLD and took 53.2s; an immediate second full run was 27-green in 21.7s, and the two tests alone pass in 5.5s. So it is load/cold-start dependent and the 5s `expect` timeout inside a 30s test is the prime suspect, not a code fault. ⛔ **Do not close this on that reasoning — it has not been proven.** What IS now settled: it is not random, it is these two tests, and it is the light theme (which runs first). Original note follows. ⚠️ **IT IS THE SAME MISTAKE A8 RECORDS.** One `pnpm test:e2e` run on 2026-07-27 reported **25 passed with exit code 1** — so two failed — and **the failing test names were discarded**, because the command piped the run through `tail -4` while its exit code gated a commit. Three consecutive runs since are 27-green, and `pnpm verify` is green, so this is *probably* a build-cache race between a `prettier --write` and the `turbo build` that `test:e2e` runs first. **That is a guess and it is recorded as one.** ⚠️ **Never pipe a test run through `tail`/`grep` when its result decides whether to commit** — capture the failure first, exactly as A8 says and exactly as was not done here |
| A8 | ⚠️ **STILL OPEN, but there is now a live candidate.** §3b finding 11's `toISOString().slice(0,10)` in test assertions was fixed in `511cf3c`, and the two-hour SAST/UTC divergence was DEMONSTRATED rather than assumed — it fits the shape exactly (one run in nine, no reproduction). **That is a candidate, not a diagnosis:** the failing test name was never captured, so this cannot be closed on it. If the suite reds again, capture the test name FIRST. Original note follows. ⚠️ **ONE unexplained unit-suite failure, cause unknown — do not dismiss it.** A single `pnpm verify` run reported `1 failed | 76 passed` and the next EIGHT runs were clean (4 full-suite, 4 targeted). Which test it was is unknown, because the log was discarded before the failure detail was read. **What HAS been ruled out:** the flake recorded in memory as "`confirmTotpEnrolment` reds when a code straddles a 30s boundary" cannot be it — `TOTP_DRIFT_STEPS = 1`, so `verifyTotp` accepts ±1 step and a boundary crossing is tolerated by design. That recorded explanation is simply wrong and has been corrected. If this recurs, capture the failing test name FIRST; a one-in-nine failure in a suite the PR gate depends on is worth a real diagnosis, not a re-run. |
| A5 | ✅ **FIXED 2026-07-26 (fifth session).** `startWerfTestDatabase()` now memoises ONE container per worker process instead of one per suite (`packages/db/src/testing.ts`), so at most `maxWorkers` (4) exist at once rather than ten. `stop()` on the shared handle is a no-op — the first suite to finish must not pull the database out from under the three behind it in the same worker — and teardown happens on worker exit, with Ryuk reaping anything that outlives a crash. `bootWerfTestDatabase()` is the escape hatch for a suite that genuinely needs a private one. Verified: 77 files / 750 tests still green. Done before CI ever ran the suite, which was the point |

**Named Phase 2 remainders (the phase can close without them; they are not silent):**

| # | Gap |
|---|---|
| B1 | ✅ **CLOSED 2026-07-28 (seventh session).** Rebased onto sixteen commits of livestock work, then squash-merged as one finished slice. Twelve integration tests against a real Postgres, both capture screens, a client reference cache, routes and EN+AF copy. The parked branch is spent and should be deleted. See §2e
| B2 | **FR-108 photos — BLOCKED on infrastructure, not design.** ⚠️ Note the pack no longer over-claims because of it: `395b658`/`511cf3c` print the photo REFERENCE and say the image is not attached, instead of asserting "Yes". The gap is unchanged; what changed is that it can no longer make the pack lie. No S3/MinIO anywhere in the repo, no upload endpoint; `architecture.md` plans presigned direct-from-client upload and none of it exists. Building only the local half would set `photo_key` with no image behind it, and `evidence-pack.pdf.ts` prints "Photograph on file: Yes" off exactly that field — the pack would claim a photograph the Stock Theft Unit cannot be shown. See decision §2.8 |
| B3 | ✅ **CLOSED 2026-07-26 (`5e279b1`).** Strict per-species attribute schemas, enforced on the device and on the server from the same schema. The ADR-0006 seam assumption was wrong and the checklist line is corrected |
| B4 | **FR-132 due/overdue** — needs a vaccination programme schedule that does not exist. A tile carrying a number the app cannot compute is worse than one carrying none |
| B5 | **FR-602 unmarked-past-window flag** — the domain function is done and tested, but the prescribed window is dated reference data `regulatory_rates` does not carry, and inventing it in code is exactly the defect the domain rules forbid |
| B6 | ✅ **CLOSED 2026-07-26 (`bb17b24`).** The last Phase 1 gap. Enrolment offers the passkey first, sign-in uses it, Settings → Security lists/adds/revokes |
| B7 | ✅ **CLOSED 2026-08-02 (`f6d4c0e`), all four plus two that arrived unplanned.** The last part — **walking a camp boundary by GPS** — is built: `/land/walk`, migration 0020, event type `boundary_walk`, a `DraftStore` sibling in `@werf/sync`, and the boundary re-derived from an append-only walk log by `(occurred_at, id)` on BOTH sides. See §2k. Earlier: three of four closed by `00f1016` (sale weight, dose value/unit/route, dip method), and a fifth arrived unplanned in `8812347` — a counted flock can be dosed as a mob, which was missing rather than gapped |
| B8, B10, B11, B12 | ✅ Closed in the third session |
| B9 | ✅ **CLOSED 2026-07-26 (`06884c7`).** `/animals/groups/count`. Append-only `tally` events, migrations 0017/0018, deltas that compose, a recount that supersedes, and a server-side re-derivation that is order-independent |

**Older carry-forwards, still open:**

| # | Gap |
|---|---|
| G1 | ✅ **CLOSED 2026-07-26 (fifth session), both halves.** `scripts/test-trace.mjs` exists and is wired as `pnpm test:trace`. It parses the FR catalogue and greps FR IDs out of `describe`/`it`/`test` TITLES. **It is REPORT-ONLY and exits 0** (`--strict` exits 1; nothing in CI passes it) — the baseline had never been measured and it turns out to be **40 of 146 named**, so a strict gate would have failed on 91 P1/P2 requirements that are mostly unbuilt phases 3–7. It proves a test NAMES an FR, never that it exercises one. The claim was also wider than filed: `test:tenancy`, `test:e2e:offline`, `test:unit`, `test:integration`, `test:perf` and `test:coverage` are all claimed by `testing-strategy.md` and none exists. All four documents corrected — `functional-requirements.md`, `SRS.md`, `testing-strategy.md`, `ci-cd.md` |
| G2 | ✅ **CLOSED 2026-07-26 (fifth session).** Phase 3's checklist is written: 3a–3i mapped 1:1 from the roadmap, with the two external blockers (§2.4 legal review, §2.5 Gazette) raised to explicit ⛔ lines at the top instead of being implied, 3a flagged as a standalone session and review unit, and 3d–3e flagged as many small sessions with mandatory human review of every diff and **never batched**. Phases 4–7 remain deliberately unwritten |
| G3 | **Equipment register (FR-504) has no table.** `vehicles` carries a comment to add `equipment_id` additively. Phase 4i |
| G4 | ◐ **HALF CLOSED 2026-08-04 (§2p).** `user-guide.md` is updated for every Phase 2 screen that exists — counted flocks, `/attention`, `/not-sent`, fence walking, breeding, tags, births/weaning/moves/losses, rainfall, Settings → Security — and **three false claims were removed, one of them a food-safety claim**: it told farmers they could override the withholding block "with a reason" (no override exists anywhere in the product), that they could photograph an animal for the police (B2 is unbuilt), and that Werf asks which of two conflicting records is right (no such screen). It also carries an "as at today" block, since it describes Phases 3–6 in the present tense. ⛔ **`ux-design-system.md` (480 lines) is UNTOUCHED and still stale for the same fourteen-plus screens — that is the open half.** The **grievance flow needs real UX care** when it lands (Phase 3) |
| G5 | ✅ **CLOSED 2026-07-26 (fifth session).** The draft PR opened and CI ran — both lanes green on the first ever run (§4 A4). The underlying fact still holds and is worth remembering: CI does not run on a feature branch with no PR, so "green locally" stays unproven until one exists. Open the PR as a draft EARLY next phase rather than at the end; it costs nothing and it is the only way to find out |

---

## 5. How to resume

```
1. RUN `git status` AND RECONCILE AGAINST §1 — tree AND SHA. §1 now claims the
   tree is CLEAN (the tooling landed in `5a8db20`). Verify it; this file has
   asserted a clean tree through a whole session while 18 files sat uncommitted.
   The SHA in §1's header is wrong most reads, because this file's own commit
   moves HEAD past it. `phase-2/breeding` is DELETED — do not recreate it.

1b. START DOCKER DESKTOP before running the gate (§4 A10). Without it
   `pnpm verify` exits 1 on the testcontainers tier.

1c. DO NOT run `pnpm verify` while review agents are running. They compete for
   Docker and the gate fails on `Port 5432/tcp not bound`, which looks like a
   defect and is not. Also: a verify that returns in ~100ms is a turbo CACHE
   REPLAY and executed nothing — check the duration before believing it.

2. Then read §2r (the ninth pass), §7 + §7a (the stopping rule and the gap it
   left), §6 (the compliance operating model), CLAUDE.md and
   docs/04-delivery/phase-checklists.md.

⛔ PHASE 2'S EXIT GATE STILL DOES NOT READ TRUE, and there is now exactly ONE
clause left that a session can act on. "No pass has run" was closed by the
sixth pass; "e2e is red" was closed by the A9 diagnosis; the BUILD list is
empty. What fails is **"the fixes are unreviewed"** — plus CI-green-on-`main`,
which is unmeetable before merge and always was.

╔══════════════════════════════════════════════════════════════════════════╗
║  ⛔ THE NINTH PASS RAN AND CLAUSE 4 FIRED. §7 IS THE RULE, §7a IS THE     ║
║  GAP IT LEFT — read both, and DO NOT SPAWN A TENTH PASS.                  ║
║                                                                          ║
║  It returned two SEV-2s (§2r), one of them created by the eighth pass's   ║
║  own fix. Under clause 4 that is a DESIGN signal, not a reason for more   ║
║  review. It was escalated; JP chose REDESIGN over descope, and the        ║
║  redesign is built: head availability is arithmetic (the device runs the  ║
║  server's own fold), not a subject, and held captures are surfaced.       ║
║                                                                          ║
║  ⛔ NOW THE RULE CONTRADICTS ITSELF AND ONLY JP CAN RESOLVE IT. Clause 1: ║
║  a SEV-2 fix earns another pass. Clause 4: do not spawn one. Nine passes, ║
║  zero APPROVABLE. → §2 item 9. Amend §7; do not make a one-off exception. ║
║                                                                          ║
║  ⛔ AND DO NOT READ "nine passes ran" AS "therefore merge."               ║
╚══════════════════════════════════════════════════════════════════════════╝

  OPEN LOOP                                    WHERE      WHOSE CALL
  ─────────────────────────────────────────────────────────────────────
  1. PUSH and watch CI. `pnpm verify` does     §2j        a session does it
     NOT run e2e, and this session changed                 — do it FIRST
     the outbox's network shape AND its
     copy. Green locally is not a green
     branch, and e2e was NOT re-run
  2. ANSWER §2 ITEM 9 — what clears Phase 2    §7a        ⭐ JP's call, and
     now that clause 4 has fired? This is                 it is the ONLY
     the whole critical path                              thing left
  3. §4 G4's OTHER HALF — `ux-design-system.md`  §2p      a session can do it
     still stale for 14+ screens. Not                     without JP
     regulated, genuinely unblocked
  4. The untested batch-link seam (§2q MED).   §2q        tracked issue, NOT
     Needs a store+auth harness for a hook                 a Phase 2 blocker
  5. §2.4 labour-law review — BOOK (external)  §2.4       gates Phase 3 DEPLOY
  6. §2.5 Gazette figures — VERIFY IN A BATCH  §2.5       gates Phase 3 DEPLOY

  ✅ ALL JP DECISIONS CLOSED. ✅ Working tree clean.

NEXT SESSION, IN ORDER:

  A. RECONCILE `git status`, the SHAs AND THE FIGURES against §1, as always.

  B. Then, in order:
       (i)  PUSH if not pushed, and read the CI result with `gh run view`
            rather than inferring it.
      (ii)  ASK FOR THE NINTH PASS over `0b2adc6`. Read its output DIRECTLY.
            Triage it against §7 — do not re-litigate the rule per finding.
     (iii)  MERGE once §7 says the gate clears. Mark PR #3 ready, merge,
            delete the branch, close the milestone. Then cherry-pick
            `docs/phase-3-6-scope` (take 85ffaa7 + 86b40c9, DROP 1331b60,
            expect ADR-0009/0010 to conflict or skip — §4 A11).
      (iv)  Finish §4 G4 (`ux-design-system.md`) if a session is spare.

  ⭐ EXPECT THE NINTH PASS TO FIND SOMETHING — eight for eight is the measured
  base rate. But §7 means finding something is no longer the same as blocking
  the merge: only a SEV-1/SEV-2 is.

Phase 1 has NO open gaps. **Phase 3 is UNBLOCKED to BUILD under §6** — the
mechanism is built with placeholder figures; §2.4/§2.5 gate the DEPLOY, not the
first line. The FIRST Phase 3 slice is the production seed-GATE that refuses
unverified rows (§6), plus one `compliance-checker` pass on the first payroll
slice. DO NOT seed regulatory_rates from the July 2026 table into a production
path; placeholders in dev/test only.
```

---

## 6. Compliance operating model (set 2026-07-30 by JP)

**The problem.** Reading the Government Gazette for wage/UIF/threshold figures every session is heavy
on tokens, and those figures change on KNOWN dates (minimum wage 1 March; threshold 1 May), not
daily. **The decision:** build the compliance *mechanism* now with placeholder figures, verify the
*figures* in batches, and let a gate stop an unverified figure ever reaching production.

Three things get called "compliance" and cost differently:

1. **The mechanism** — date-versioned `regulatory_rates`, lookup by `occurred_at`, jurisdiction from
   the farm, the `PayrollRules` seam, "never hardcode a regulated number." This is CODE. It needs no
   Gazette to build or test. **Build it now.**
2. **The figures** — the actual numbers. This is DATA in `regulatory_rates` / reference tables. It
   changes on known dates. **Verify in batches, tracked in
   [`docs/00-business/compliance-register.md`](docs/00-business/compliance-register.md).**
3. **The rules** — overtime against the right day's rate, a period spanning 1 March using both,
   "net below floor → reject." `pnpm verify` cannot catch these. **One owner-triggered
   `compliance-checker` pass on the first payroll slice, then batched per phase.**

**What this changes:**

- **Review cadence (was: fifth pass, per §5).** The fifth pass ran and is closed (§2h). From here,
  `reviewer`/`sync-auditor`/`compliance-checker` run **BATCHED — one pass per phase and before any
  deploy**, not per session or per slice. Still owner-triggered; still read the output directly.
- **§2.4 / §2.5 no longer gate Phase 3's first LINE — they gate its DEPLOY.** Build Phase 3 against
  placeholder figures now; book the labour-law review in parallel; verify the Gazette figures in one
  batch before deploy. The `compliance-register.md` is the standing status ledger.
- **A production seed-GATE (a Phase-3-opening slice) refuses `PLACEHOLDER`/unverified
  `regulatory_rates` rows;** dev/test seed allows them. Until that gate exists, "do not deploy
  unverified" is enforced by review, not code. This makes deferral SAFE — an unverified figure
  physically cannot reach a real payslip.
- **Verification is trigger-based:** when a figure's `next_review` passes, before a phase deploy, or
  every ~4 sessions as a backstop. Not every session.

**Decisions JP made this session (2026-07-30), for the record:**

| # | Decision |
|---|---|
| Compliance model | ✅ Adopt: register + placeholders + production deploy-gate (above). |
| Review cadence | ✅ Fifth pass now (done, §2h), then batched per-phase / pre-deploy. |
| §2.1c defect-class hook | ✅ Install both patterns, warn-only. Done — `e8c8155`, `.claude/hooks/defect-classes.sh`. |
| §2.8 object storage (FR-108 photos) | ✅ Defer to a dedicated Phase-3 infrastructure slice; photos stay unbuilt until then (the evidence pack already says "photo not attached", so nothing lies). |
| §2.3b transfer reason / purchase clearing | ✅ Add a `transfer` tally reason (mob→mob, same farm, withholding carried across) AND an OPTIONAL declared seller withdrawal on a purchase (default "unknown history"; never invent one). **A build slice — NOT built yet.** |
| §2.6 SAFEX / red-meat data licence | ✅ Defer to Phase 4 per ADR-0009. No action now. |
| §2.7 phone-only invitations | ✅ In-person handover; no new delivery channel, SMS stays ruled out. Records the membership; the owner hands the invite over. |

**All JP decisions are now closed.** What remains is BUILD work (a JP-owner or a session does it) and
two EXTERNAL bookings on someone's calendar (§2.4 labour-law review, §2.5 Gazette re-verification —
both now gate Phase 3 *deploy*, not its first line, per this section).

---

## 7. The review-pass STOPPING RULE (set 2026-08-05 by JP)

**The problem this solves, stated plainly.** Seven passes ran. All seven returned NOT APPROVABLE.
Every one found a real defect inside the previous pass's fixes — which is a genuine finding and not a
process failure. But the fixes for pass N are then unreviewed, and *that is the exact argument for
pass N+1*. The recursion has no terminal condition, so "Phase 2 is not merge-ready" could stay true
for ever while the code gets steadily better. **Seven-for-seven is not evidence that an eighth pass is
owed; it is evidence that the exit criterion was never defined.**

**The rule. Four clauses, and clause 3 is the one that actually breaks the loop.**

| # | Clause |
|---|---|
| **1** | **SCOPE NARROWS EVERY PASS.** A pass reviews only what is genuinely unreviewed: the previous pass's fix diff, plus anything committed since. **Never the accumulated range.** The commits before `34e0685` have been read seven times; an eighth reading is not where the next defect is, and re-reading them is most of what makes a pass expensive |
| **2** | **A SEVERITY FLOOR CLEARS THE GATE.** A pass CLEARS when it returns no SEV-1 and no SEV-2 in its range. MED and LOW findings are **fixed or filed as tracked issues on `main`** — they are not merge blockers. A MED has never been the thing that put residue in a food chain |
| **3** ⭐ | **THE TERMINAL CONDITION.** If a pass returns **only** MED/LOW, those fixes merge **WITHOUT another pass**, provided each fix is (i) mechanical, (ii) confined to the files the finding names, and (iii) covered by a test watched to FAIL against the old code first. **This is the clause that ends the recursion.** It is a bounded risk taken deliberately: the unreviewed final diff is small, mechanical, and directionally tested. A SEV-1/SEV-2 fix never qualifies — that always earns another pass under clause 1 |
| **4** | **HARD CEILING: TWO PASSES (the eighth and, if needed, the ninth).** If the ninth still returns a SEV-2, **do not spawn a tenth.** Three consecutive passes finding severe defects in a shrinking diff is evidence of a DESIGN problem in that surface — almost certainly the outbox hold mechanism, which has been widened four times and exposed a new reader each time. Escalate it to JP as a scope decision (redesign the mechanism, or descope it from Phase 2), not as more review |

**What the rule deliberately does NOT do.** It does not lower the bar on regulated code: a SEV-1 or
SEV-2 in FR-131 / animal ID / stock theft / POPIA still blocks the merge absolutely, and clause 1
still sends its fixes to another pass. It changes *when reviewing stops*, never *what a defect is*.

**Why the floor sits between SEV-2 and MED.** Read §2c–§2o and sort the findings by what they cost a
farmer. Every SEV-1 and SEV-2 in this repo's history is either meat reaching a truck inside a
withholding, or a capture silently lost. Every MED and LOW is a wrong label, a stale comment, a test
that cannot fail, or a missing axe sweep — all real, none of them worth holding a phase that is
otherwise complete. **Tracked on `main` they get fixed; blocking the merge on them is how a branch
sits unreviewable for nine sessions.**

⚠️ **The rule was written and committed BEFORE the eighth pass's findings were read**, deliberately,
so that it could not be bent to fit whatever came back. If a future session wants to relax it, say so
out loud and get JP's call — do not quietly re-interpret clause 3.

---

### ⛔ 7a. THE GAP CLAUSE 4 LEFT, found by using it (2026-08-05, eighteenth session)

**Clause 4 fired exactly as designed and then ran out of instructions.** The ninth pass returned a
SEV-2 in the outbox hold mechanism — the surface the clause named in advance. No tenth pass was
spawned. It was escalated to JP, who chose **redesign** over descope, and the redesign is built:
head availability is arithmetic now, not a subject, and held captures are surfaced.

**So what is the state of Phase 2?** Clause 4 says do not spawn a tenth pass. Clause 1 says a fix
for a SEV-2 always earns another pass. **Those two now contradict each other**, and the rule does
not say which wins after an escalation resolves. Nine passes have run and none has cleared the
branch.

**This is not a question to answer by silence, and it is not mine to answer.** ⛔ **It is a live
decision for JP — see §2 item 9.** My own view, argued rather than assumed:

> **Clause 4 exists to stop a mechanism being patched round after round, not to stop a NEW mechanism
> being read once.** The subject-graph approximation is gone; what replaced it is a different
> design that no agent has ever seen. Reviewing it once is the first review of a new thing, not the
> tenth review of an old one. **But that is an amendment to the RULE, and §7 says out loud that
> amendments are JP's and must not be a quiet re-interpretation.** So it is asked, not assumed.

**What must NOT happen is the rule being read as "nine passes ran, therefore merge".** No pass has
returned APPROVABLE on this branch, and the last one found a lost-capture defect inside the previous
one's fix.
