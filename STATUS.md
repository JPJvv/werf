# STATUS — where this build actually is

> **Read this first, before planning anything.** It is the live pointer between sessions.
> `CLAUDE.md` links here. Update it at the end of every session and commit it with the work.

**Last updated:** 2026-07-28 (eighth session — AUDIT ONLY, no feature work) · **Branch:**
`phase-2/livestock` @ `7917645`, PUSHED

> ✅ **The eighth session opened by reconciling both claims and BOTH held** — working tree clean,
> and `git rev-parse HEAD` = `7917645` = the SHA this file names = the SHA PR #3 points at. First
> time the SHA half has been true on read. Keep checking anyway; it has been wrong twice.

> ⚠️ **The commit pointers in this file were STALE when the seventh session opened** — §1's header
> said `e5792d3` and its tree diagram said `395b658`, while HEAD was `b3f4878`. The working-tree
> claim reconciled; the SHAs did not. Two different things, and only one of them was being checked.

> **Gate note, and it matters more than it looks:** the e2e lane was reporting green against a stale
> bundle until the fifth session. Fixed — see §4 A7. If you see e2e fail and then pass on a re-run,
> that is not a flake and it is not this bug either; read A7 before assuming.

> ⛔ **THE FOURTH REVIEW PASS RAN (2026-07-28) AND THE VERDICT IS STILL NOT APPROVABLE.** Seven
> findings over `7c2acd9..HEAD`, including a **NEW SEV-1** and three SEV-2s. `compliance-checker`
> did not withdraw its verdict and `reviewer` returned NOT APPROVABLE independently. **Nothing in
> §2f is fixed** — the eighth session was an audit and deliberately wrote no feature code. §2f.
>
> ⭐ **The pattern is now measured FOUR passes running, and it has not weakened once:**
> pass two found 12 defects; pass three found 8 more inside those 12 fixes; pass four found 7 more,
> and THREE OF THE FOUR most severe are inside pass three's fixes. The author of a fix cannot close
> the finding that produced it. Do not assume pass five finds nothing.

> ⛔ **The third review pass RAN (2026-07-27) and the verdict was STILL NOT APPROVABLE** — on a NEW
> SEV-1 in the code written to close the previous SEV-1s. That finding and seven others are fixed in
> `16fbb6a`…`e5792d3` (§2d).

---

## 1. Position

| | |
|---|---|
| **Phase 0** — scaffold | ✅ Merged to `main`. Repo public, CI green, branch protection on |
| **Phase 1** — auth, sync, onboarding | ✅ Merged to `main` as `9452ebc` (PR #2). **All four of its named gaps are now closed** — the last one, client passkey enrolment + management, went in this session. Phase 1 has no open gaps |
| **Phase 2** — livestock & crops | 🟡 **NOT merged. B1 is CLOSED — breeding is no longer half-built.** `pnpm verify` green **on CI**: **78** files / **806** tests, bundle **138.72 KB** gz. CI green on both lanes at HEAD (run `30374965420`, 2026-07-28). ⛔ **The FOURTH agent pass ran 2026-07-28 and returned NOT APPROVABLE — a new SEV-1 and three SEV-2s, none of them fixed (§2f).** ⚠️ `pnpm test:e2e` is **NOT** green — 25/27, exit 1, cold (§4 A9). ⚠️ `pnpm verify` cannot run at all without Docker: 272 of the 806 tests are the testcontainers tier. **Do not mark the PR ready; do not merge** |
| **Phase 3** — labour & wages 🇿🇦 | ⬜ Not started. **Critical path** |
| **Phases 4–7** | ⬜ Not started. Scope expanded 2026-07-25 (fuel + refund, photo flag, price board) |

**Working tree is clean as at this commit. No stashes.** Verified with `git status` at the start of
the sixth session (it reconciled — the first time this line has been true when read) and again here.

> ⚠️ **That sentence was FALSE for the whole of the fourth session and nobody noticed until a review
> caught it.** Sixteen modified files and two new ones — a half-built B1 breeding slice — sat
> uncommitted underneath a document asserting a clean tree. **Do not trust this line; verify it.**
> Reconciling `git status` against this section is now the literal first instruction in §5.

```
main                   9452ebc   (Phase 0 + 1)
phase-2/livestock      (HEAD)    PUSHED. Draft PR #3 open, DO NOT MERGE.
                                 ⭐ Re-read the SHA with `git log` rather than trusting
                                 this diagram — it has been wrong twice.
phase-2/breeding       80a9fc3   ✅ SPENT. Rebased onto this branch and SQUASH-MERGED
                                 into it as one finished slice. Its own WIP commit said
                                 "do not merge as it stands", and it never was. Nothing
                                 on it is still wanted — DELETE IT (local and origin).
docs/phase-3-6-scope   1331b60   pushed, no PR yet. Stacked on phase-2 @ 86f9330,
                                 so it is now well behind this branch
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

1f. **⛔ NEW AND NOW THE LIVE ONE — §2f's seven findings. Nothing is fixed.**
   The fourth pass ran and produced a NEW SEV-1 plus three SEV-2s, and the eighth session was an
   audit that deliberately wrote no feature code, so every one of them is open. The SEV-1 loses a
   farmer's capture silently and the device and server end up disagreeing about head count; two of
   the SEV-2s put meat inside a withholding on a truck. **This is the next session's work and it is
   not optional.** Order and reasoning in §5.
   → _Answer:_

1e. ~~**The FOURTH pass.**~~ ✅ **RAN 2026-07-28 (eighth session)**, all three agents over
   `7c2acd9..HEAD`, output read directly. ⛔ **Verdict: still NOT APPROVABLE**, and `reviewer`
   said so independently. Seven findings, §2f. Original note follows.
   The evidence is no longer procedural. Pass two found twelve defects; pass three found eight more,
   **every one of them inside the fixes for those twelve** — a new SEV-1, two guards that disagreed
   with the server, a `??` that reintroduced the very bug it was written to fix, and an axe lane
   auditing seventeen screens with almost no widgets on them. There is no reason to believe pass
   four finds nothing. Run all three over `7c2acd9..HEAD` and read the output.
   → _Answer (say the word and it runs):_ **STILL OPEN.** The seventh session was instructed to
   run no agents at all, so this was deliberately skipped rather than forgotten, and the
   seventh session's own work is now ALSO unreviewed — the fourth pass should run over
   `7c2acd9..HEAD`, which now includes the breeding slice.

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
   → _Answer:_

4. **🇿🇦 Has the labour-law review been booked?** It gates Phase 3 (sub-phase 3l) and is on someone
   else's calendar. Open since the second session.
   → _Answer:_

5. **🇿🇦 Have the SA wage figures been re-verified against the current Gazette?**
   `legal-compliance.md §2.2` is dated July 2026 and self-describes as decaying. Phase 3 must not
   start against stale numbers. Open since the second session.
   → _Answer:_

6. **Should the SAFEX / red-meat data licence conversations start now?** ADR-0009 says start them in
   Phase 4, for the same reason the legal review starts early. Open since the second session.
   → _Answer:_

7. **Phone-only invitations.** Email invitations are delivered now (FR-005). A phone-only invitation
   records the membership and reaches nobody, deliberately: SMS is ruled out for the same SIM-swap
   reason it is ruled out as a second factor, and an invitation link is credential-shaped. Is
   "handed over in person" the answer, or does this need a channel we do not operate yet?
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
| A11 | ⛔ **NEW 2026-07-28 — `ADR-0009` and `ADR-0010` DO NOT EXIST on this branch.** They exist only on `docs/phase-3-6-scope`. This branch cites them three times: `STATUS.md` §2.6, `STATUS.md` §3 (the worker-tracking note), and `phase-checklists.md:867` (a Phase 3 line resting on "ADR-0010 refused tracking"). **If Phase 2 merges before the scope branch is cherry-picked, `main` carries three references to decision records a reader cannot open** — and one of them is the justification for a refusal, which is the kind of decision that most needs its record. Either cherry-pick the two ADRs ahead of the merge or soften the references |
| A9 | ◐ **NARROWED 2026-07-28, AND A9'S OWN RECORDED SUSPICION IS RULED OUT.** Reproduced on a cold local run: **25 passed / 2 failed, exit 1, 53.9s** — the same two light-theme tests. Two things are now FACT that were not: (1) the failure is `element(s) not found`, and **BOTH** the passkey button and the "use an authenticator app instead" fallback are absent — so it is not one button, the entire choice UI is missing; (2) `passkeysAvailable()` (`apps/web/src/auth/passkeys.ts:42`) is a **synchronous** DOM check (`typeof window.PublicKeyCredential === 'function'`) consumed as `useState(passkeysAvailable)` — it has **no timing dependence whatsoever**, so **A9's recorded "async can-this-device-do-it probe" hypothesis is dead.** That leaves the screen either not mounting or mounting without a session, which points at the async session seed racing the route guard — `a11y.spec.ts:73` already comments that "the seed arrives asynchronously". ⛔ **That is a NARROWED CANDIDATE, NOT A DIAGNOSIS** — no page snapshot was captured to confirm what did render. Next step is cheap and specific: capture `page.content()` or a screenshot on failure. Original note follows. ◐ **THE FAILING TESTS NOW HAVE NAMES (2026-07-28), which is what A8 and A9 both asked for.** A full `pnpm test:e2e` reported **25 passed, exit 1** again — the same signature — and this time the names were captured before anything else: `a11y.spec.ts:50` *the second-factor choice has no accessibility violations in the **light** theme* and `a11y.spec.ts:64` *second-factor enrolment …* **in the light theme**. Both timed out on `getByRole('button', { name: /use this phone as the key/i })` — the PASSKEY button, which §2b's own rule puts behind an async "can this device do it" probe. **Evidence, not a diagnosis:** the failing run was COLD and took 53.2s; an immediate second full run was 27-green in 21.7s, and the two tests alone pass in 5.5s. So it is load/cold-start dependent and the 5s `expect` timeout inside a 30s test is the prime suspect, not a code fault. ⛔ **Do not close this on that reasoning — it has not been proven.** What IS now settled: it is not random, it is these two tests, and it is the light theme (which runs first). Original note follows. ⚠️ **IT IS THE SAME MISTAKE A8 RECORDS.** One `pnpm test:e2e` run on 2026-07-27 reported **25 passed with exit code 1** — so two failed — and **the failing test names were discarded**, because the command piped the run through `tail -4` while its exit code gated a commit. Three consecutive runs since are 27-green, and `pnpm verify` is green, so this is *probably* a build-cache race between a `prettier --write` and the `turbo build` that `test:e2e` runs first. **That is a guess and it is recorded as one.** ⚠️ **Never pipe a test run through `tail`/`grep` when its result decides whether to commit** — capture the failure first, exactly as A8 says and exactly as was not done here |
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
| B7 | ◐ **Three of four closed** (`00f1016`): sale weight, dose value/unit/route, dip method. ⭐ A fifth arrived unplanned in `8812347` — **a counted flock can now be dosed as a mob**, which was missing rather than gapped: the screen could only dose individual animals, so a group-only flock could not be dipped from the phone at all. **Remaining: walking a camp boundary by GPS.** The land API accepts a GeoJSON polygon and dual-writes it to PostGIS; nothing in the client produces one, so boundaries can only be typed. Needs a capture screen that collects points by walking and closes the ring — a real slice, not a field |
| B8, B10, B11, B12 | ✅ Closed in the third session |
| B9 | ✅ **CLOSED 2026-07-26 (`06884c7`).** `/animals/groups/count`. Append-only `tally` events, migrations 0017/0018, deltas that compose, a recount that supersedes, and a server-side re-derivation that is order-independent |

**Older carry-forwards, still open:**

| # | Gap |
|---|---|
| G1 | ✅ **CLOSED 2026-07-26 (fifth session), both halves.** `scripts/test-trace.mjs` exists and is wired as `pnpm test:trace`. It parses the FR catalogue and greps FR IDs out of `describe`/`it`/`test` TITLES. **It is REPORT-ONLY and exits 0** (`--strict` exits 1; nothing in CI passes it) — the baseline had never been measured and it turns out to be **40 of 146 named**, so a strict gate would have failed on 91 P1/P2 requirements that are mostly unbuilt phases 3–7. It proves a test NAMES an FR, never that it exercises one. The claim was also wider than filed: `test:tenancy`, `test:e2e:offline`, `test:unit`, `test:integration`, `test:perf` and `test:coverage` are all claimed by `testing-strategy.md` and none exists. All four documents corrected — `functional-requirements.md`, `SRS.md`, `testing-strategy.md`, `ci-cd.md` |
| G2 | ✅ **CLOSED 2026-07-26 (fifth session).** Phase 3's checklist is written: 3a–3i mapped 1:1 from the roadmap, with the two external blockers (§2.4 legal review, §2.5 Gazette) raised to explicit ⛔ lines at the top instead of being implied, 3a flagged as a standalone session and review unit, and 3d–3e flagged as many small sessions with mandatory human review of every diff and **never batched**. Phases 4–7 remain deliberately unwritten |
| G3 | **Equipment register (FR-504) has no table.** `vehicles` carries a comment to add `equipment_id` additively. Phase 4i |
| G4 | **`user-guide.md` and `ux-design-system.md` not updated** for the 2026-07-25 scope, nor for the fourteen screens added since. Now also missing `/animals/groups/count` and Settings → Security. The **grievance flow needs real UX care** when it lands |
| G5 | ✅ **CLOSED 2026-07-26 (fifth session).** The draft PR opened and CI ran — both lanes green on the first ever run (§4 A4). The underlying fact still holds and is worth remembering: CI does not run on a feature branch with no PR, so "green locally" stays unproven until one exists. Open the PR as a draft EARLY next phase rather than at the end; it costs nothing and it is the only way to find out |

---

## 5. How to resume

```
1. RUN `git status` AND RECONCILE AGAINST §1. First, before reading anything
   else and before planning. §1 asserted "Working tree is clean. No stashes."
   through an entire session in which sixteen modified files and a half-built
   breeding slice sat underneath it. It has reconciled on the last two readings;
   keep checking anyway.
   Also RECONCILE THE SHAs, not just the tree — §1's pointers were stale for a
   whole session while its "working tree is clean" line was true. Two claims,
   and only one was being checked.
   `phase-2/breeding` is SPENT (squash-merged) and should be deleted.

1b. START DOCKER DESKTOP before running the gate (§4 A10). Without it
   `pnpm verify` exits 1 on 13 files that have nothing to do with your work,
   and 272 of the 806 tests silently never run.

2. Then read STATUS.md, CLAUDE.md, and docs/04-delivery/phase-checklists.md.
   Answer §2 with me before planning. §2.1f is the live one.

⛔ PHASE 2'S EXIT GATE DOES NOT READ TRUE. THREE clauses of five are unmet now,
not two: the agents clause, CI-green-on-`main` (unmeetable before merge), and
`pnpm test:e2e`, which was DEMOTED on 2026-07-28 after a cold run failed 2/27.

THE FOURTH AGENT PASS IS DONE (§2f). It found seven defects and fixed NONE of
them, because the eighth session was an audit. So:

THE FIRST WORK OF THE NEXT SESSION IS FIXING §2f, IN THIS ORDER. The order is
by what a farmer loses, not by severity label:

  1. SEV-1 `AdjustMobScreen.tsx:128` — the memoised capture id. Generate the id
     inside `save()`. This one SILENTLY LOSES A CAPTURE and leaves the device
     and the server disagreeing about head count, with no error anywhere.
     Test: two saves, same mob, same day → two distinct ids, two POSTs.
  2. SEV-2 `withdrawal.ts:146-153` — the client group guard must run the same
     per-member reconstruction the server runs, so a dose carried in from
     another mob blocks AT CAPTURE. Mirror `livestock.integration.test.ts:2326`.
  3. SEV-2 the breeding refusal — fix it on the SERVER: record the diagnosis
     with `matingDate` and no `dueDate` plus a warning, rather than 400-ing it
     into permanent set-aside. Pin BOTH tests to the same contract; today they
     pass on either side of a seam that is broken through the middle.
  4. SEV-2 `Outbox.tsx:494-507` — a refused move/health item must suppress the
     disposals for that subject in the same round.
  5. Then the three SEV-3s: the back-datable death (which is what makes the
     `withinWithdrawal` flag work at all), giving that flag a reader and a test,
     and splitting the cold-cache gestation copy from the no-figure copy.
  6. MED: the `(occurredAt, id)` tiebreaker in `withdrawal.ts:62`, and storing
     `matingDate`/`gestationDays` on the pregnancy payload.

SAME DISCIPLINE AS EVERY PASS: write the test, WATCH IT FAIL against the old
code, then keep it. And check the CLAIM as well as the code — §2c said "each
fix verified in both directions" and that was false for two of them.

THEN RUN A FIFTH PASS. Four passes have now each found real defects in the
previous pass's fixes; there is no evidence this has bottomed out.

Only after §2f is closed:

  1. §2.3c — the CROSS-DEVICE withdrawal race. ✅ ANSWERED (flag, never refuse)
     and NOT YET BUILT. Fully specified, so it is the first real slice.
     ⭐ Note it now shares a surface with §2f's `withinWithdrawal` finding —
     both need the same "needs your attention" reader. Build them together.
  2. §2.3b — the `transfer` tally reason and what a `purchase` may clear. A
     modelling decision, mine to raise and STILL YOURS TO MAKE.
  3. Then a feature again: B7's GPS boundary walk — B1 is closed (§2e), so
     that is the largest named remainder left in the phase.

CHEAP AND UNBLOCKED, can be done any time:
  - §4 A11 — cherry-pick ADR-0009/0010 ahead of the merge, or this branch
    merges into `main` carrying three references to ADRs that do not exist.
  - §4 A9 — capture a page snapshot on e2e failure. One line, and it would
    likely end a question that has been open for four sessions.
  - Delete `phase-2/breeding` (local AND origin). It is spent and it still
    exists in both places.

Phase 1 has NO open gaps. Phase 3's checklist EXISTS, so /loop has something to
consume — but §2.4 (labour-law review booked) and §2.5 (Gazette figures
re-verified) gate its very first line, and both have been open for four
sessions. DO NOT seed regulatory_rates from the July 2026 table.

Also open and cheap: §2.1c (the defect-class hook — yes or no). Note it would
currently be silent, since the tree has no `toISOString().slice(0,10)` left.
That is an argument for installing it now rather than after a fourth relapse.
```
