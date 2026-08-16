# Testing Strategy

**The tests are not quality assurance. They are the thing that lets Claude Code work while you sleep.** Every autonomy technique in the [playbook](claude-code-playbook.md) reduces to "give Claude a fact to check against." This document defines the facts.

---

## 1. The shape

```
              ╱ Manual: the crush, the phone, the auditor
             ╱   Few. Irreplaceable. See §7.
            ╱────────────────────────────────
           ╱  E2E (Playwright) — ~40 specs
          ╱    Critical journeys. HALF ARE OFFLINE.
         ╱──────────────────────────────────
        ╱  Integration — ~200 specs
       ╱     API + real Postgres (testcontainers). Never mocked.
      ╱────────────────────────────────────
     ╱  Unit — ~800 specs
    ╱      Domain logic. Pure. Table-driven. ≥90%.
   ╱──────────────────────────────────────
```

Standard pyramid with two deliberate deformations:

1. **The offline layer is disproportionately heavy.** Roughly half the E2E suite runs with the network off. That is not over-testing; offline is the primary operating mode ([offline-sync.md §1](../03-architecture/offline-sync.md)), so testing it is testing the product.
2. **`packages/domain` is tested harder than anything else** (95% for payroll). It is pure functions with legal consequences — the cheapest place in the codebase to test and the most expensive place to be wrong.

---

## 2. Unit — `packages/domain`

Pure functions. No I/O. **The date is injected**, never read from a clock. That is the whole reason this package can be tested exhaustively.

### Table-driven, from the legal text

Payroll and compliance rules are tables in the Gazette. Test them as tables:

```ts
// packages/domain/payroll/__tests__/minimum-wage.spec.ts
import { calculatePayroll } from '../calculate';

const rates = [
  { jurisdiction: 'ZA', code: 'NMW_FARM', value: 2879, from: '2025-03-01',
    to: '2026-02-28', gazette: 'GG (2025)' },
  { jurisdiction: 'ZA', code: 'NMW_FARM', value: 3023, from: '2026-03-01',
    to: null, gazette: 'GG 54075, 2026-02-03' },
];

describe.each([
  // Source: legal-compliance.md §2.4 + user-stories.md US-020
  { name: 'piece rate below floor is topped up',
    shifts: [{ occurredAt: '2026-03-15', hours: 8, pieceUnits: 40, pieceRate: 400 }],
    expect: { gross: 24184, topUp: 8184, warnings: ['PIECE_RATE_TOPPED_UP'] } },

  { name: 'piece rate above floor paid as earned',
    shifts: [{ occurredAt: '2026-03-15', hours: 8, pieceUnits: 80, pieceRate: 400 }],
    expect: { gross: 32000, topUp: 0, warnings: [] } },

  { name: 'February work uses February rate',
    shifts: [{ occurredAt: '2026-02-15', hours: 8 }],
    expect: { gross: 23032, warnings: [] } },

  // ⭐ The one that happens every single year
  { name: 'period spanning 1 March uses BOTH rates',
    shifts: [{ occurredAt: '2026-02-27', hours: 8 },
             { occurredAt: '2026-03-02', hours: 8 }],
    expect: { gross: 23032 + 24184, rateLines: 2 } },

  { name: 'overtime over cap is PAID and flagged',
    shifts: [{ occurredAt: '2026-03-09', hours: 45, overtimeHours: 14 }],
    expect: { overtimePaidHours: 14, warnings: ['OVERTIME_EXCEEDS_CAP'], blocked: false } },

  { name: 'net below floor REJECTS the run',
    shifts: [{ occurredAt: '2026-03-15', hours: 40 }],
    deductions: [{ type: 'garnishee', amount: 420000 }],
    expect: { blocked: true, warnings: ['NET_BELOW_MINIMUM'], payslips: 0 } },
])('$name', ({ shifts, deductions, expect: exp }) => {
  it('matches the gazetted rule', () => {
    const result = calculatePayroll({
      farm: { jurisdiction: 'ZA' },   // ⭐ resolved from the FARM, never the user
      shifts, deductions, rates, now: '2026-07-17',
    });
    expect(result).toMatchObject(exp);
  });
});
```

### The jurisdiction test that is not about jurisdictions

```ts
// packages/core/test/naming.spec.ts — ADR-0006 § the naming rule
it('no South African statute names a generic thing', async () => {
  const src = await readAll('packages/core/**/*.ts');
  for (const term of ['bcea', 'popia', 'sd13', 'uif', 'sars', 'sapS', 'siza']) {
    expect(src.toLowerCase()).not.toContain(term);
  }
});
```

Crude, and it catches the exact defect that will happen: `bceaThreshold` typed into `packages/core` because South Africa is the only country you have. **No lint rule catches this** — a string match is what we have, and it is better than review alone.

**Rules:**
- Money in **integer cents**. `24184`, not `241.84`. A float in a payroll test is a bug in the test.
- Every case cites its source — a §, a US-, or a Gazette. A test without a source cannot be maintained, because in three years nobody will know whether the expected value is law or a typo.
- **Never mock our own code.** If a test needs a mock of another domain function, the boundary is wrong.
- `now` is a parameter. Any test that would break on 1 January is testing the clock, not the code.

### Coverage

| Package | Threshold | Enforced |
|---|---|---|
| `packages/domain/payroll` | **95%** | CI fails |
| `packages/domain/compliance` | **95%** | CI fails |
| `packages/domain/sync` | **95%** | CI fails |
| `packages/domain/*` | 90% | CI fails |
| `packages/core` | 90% | CI fails |
| Overall | 75% | CI fails |

Coverage is a floor, not a goal. 95% with tests that assert implementation is worse than 80% with tests that assert behaviour.

---

## 3. Integration — API + real Postgres

**Never mock the database.** RLS, partitioning, triggers, `numeric` semantics, and constraint behaviour are exactly what we need to test, and a mock has none of them. Testcontainers, every time.

```ts
// apps/api/test/setup.ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';

export async function setupDb() {
  const container = await new PostgreSqlContainer('postgis/postgis:16-3.4')
    .withDatabase('werf_test')
    .start();
  await migrate(container.getConnectionUri());
  return container;
}
```

### The tenancy suite — the one that cannot be skipped

```ts
// packages/sync/test/tenancy.spec.ts
import { syncRules } from '../rules';
import { rlsPolicies } from '@werf/db/policies';
import { syncedTables } from '../classification';

describe('sync rules and RLS agree', () => {
  // Generated from the classification table, so a new table cannot be forgotten
  it.each(syncedTables)('%s: sync rule grants exactly what RLS grants', async (table) => {
    const [farmA, farmB] = await seedTwoFarms();
    const userA = await userOn(farmA);

    const viaSync = await syncRules.rowsFor(table, userA);
    const viaRls  = await queryAs(userA, `SELECT id FROM ${table}`);

    expect(new Set(viaSync.map(r => r.id))).toEqual(new Set(viaRls.map(r => r.id)));
    expect(viaSync.every(r => r.farm_id === farmA.id)).toBe(true);
  });

  // ⭐ The test we write against ourselves
  it('a permissive sync rule is caught even when RLS is correct', async () => {
    const [farmA, farmB] = await seedTwoFarms();
    withPermissiveSyncRule('animals', async () => {
      const userA = await userOn(farmA);
      const rows = await syncRules.rowsFor('animals', userA);
      // This assertion FAILS with a permissive rule. That is the point.
      expect(rows.every(r => r.farm_id === farmA.id)).toBe(true);
    });
  });

  it('server-only tables are never in any sync rule', () => {
    for (const t of ['payroll_runs','payslips','financial_transactions',
                     'injury_records','audit_log']) {
      expect(syncRules.tables).not.toContain(t);
    }
  });
});
```

**Why this suite exists:** sync rules and RLS are two systems enforcing one invariant, and the failure mode is silent cross-tenant leakage — farm B's animals appearing on farm A's phone while every RLS policy is perfectly correct. There is no way to notice this by using the product. Only this test notices.

It is generated from the classification table, so **adding a table without adding it to the classification breaks the build**, which is exactly the behaviour we want.

---

## 4. The offline matrix

Playwright with `context.setOffline(true)`. **This suite is the product's insurance policy.** Every row maps to a scenario in [offline-sync.md §7](../03-architecture/offline-sync.md).

| # | Test | Asserts | Story | Phase 3 coverage (2026-08-14) |
|---|---|---|---|---|
| O-1 | Write offline → kill browser → reopen offline | Record present, still queued | US-010 | ✅ `offline-capture.spec.ts` (real browser, local-only — no server contact needed for this row) |
| O-2 | Write offline → **reboot device** → reopen | Record present | US-010 | ✅ `offline-capture.spec.ts` / `capture-migration.spec.ts` (real browser, local-only) |
| O-3 | Offline 6 weeks → sync | All applied, **`occurred_at` preserved**, reports use `occurred_at` | US-010 | ✅ `real-offline-matrix.spec.ts`, real Postgres + real PowerSync (`WERF_REAL_STACK`) — a back-dated capture's `occurred_at` verified byte-exact in Postgres, then a second device's fold reads the same date, not arrival order |
| O-4 | Kill connection mid-upload | Resumes from checkpoint, no dup, no loss | UC-050 A3.1 | ◐ Covered for attachments specifically (3i(c)'s interruption test: PUT succeeds, finalize fails, app restarts, retry completes) — not a general mid-upload-of-any-capture-kind test |
| O-5 | Two devices, different fields | Both survive, no audit row | US-040 | ◐ Partially — `real-sync-hydration.spec.ts` proves one two-device shape (a hydrated birth funding a decrease); the fake-driven 3e conflict-matrix suites cover more shapes, not against the real stack |
| O-6 | Two devices, same field | Later `occurred_at` wins + audit row | US-040 | ✅ **CLOSED 2026-08-15.** Migration 0026's immutable `audit_log`; `(occurred_at,id)` LWW resolves movement conflicts, proven against real Postgres in `livestock.integration.test.ts` |
| O-7 | Two devices, same birth | Two rows + review item, nothing deleted | US-040 | ✅ **CLOSED 2026-08-15.** `conflict_reviews` queue + `AttentionScreen.tsx`/`LocalConflictReviews.tsx`; legitimate-twin-batch handling distinguishes a real second litter from a duplicate capture |
| O-8 | Sale vs death | `dead`, sale flagged, audit row | US-040 | ✅ **CLOSED 2026-08-15.** Same mechanism as O-6; sale-outranks-death-outranks-sale projection in `apps/api/src/conflicts/conflicts.service.ts` |
| O-9 | **Refresh token expires with 47 queued writes** | **Queue HELD, uploaded after login** | UC-050 A2.1 | ✅ `Outbox.test.tsx`'s invariant-5 test (fake-driven, pins the behaviour precisely); no real-stack variant built |
| O-10 | Storage quota exceeded | Read set degrades, **queue intact** | UC-050 E7.1 | ✅ Unit/integration level (3f's durability coordinator); no real-browser-quota-exhaustion e2e |
| O-11 | Old client → new schema | Applied or quarantined, **never lost** | offline-sync §6 | ✅ `livestock.integration.test.ts`'s additive-migration test, against real Postgres (3g) |
| O-12 | PHI check offline | Blocked locally, no server round trip | US-030 | ⛔ Phase 4 (crops) — PHI does not exist yet |
| O-13 | Withdrawal check offline | Blocked locally | US-032 | ✅ FR-131 guard, extensively covered (`withdrawal.test.ts`, `AdjustMob.test.tsx`, `RecordLoss.test.tsx`) |
| O-14 | Mark missing offline | GPS + timestamp captured locally | US-031 | ✅ Phase 2, `RecordLossScreen`'s missing-report path |
| O-15 | Payroll offline | **Refuses, plainly, without losing attendance** | UC-020 E2 | ⛔ Phase 5 (labour) — not started |
| O-16 | **TOTP offline** | Code verifies with the radio off — it is time-based | ADR-0007 | ✅ Phase 1, `totp.ts` tested against RFC vectors, no network in the verify path |
| O-17 | **Passkey auth offline** | Platform authenticator works locally; only *registration* needs network | ADR-0007 | ✅ Phase 1 |
| O-18 | Reference data offline, jurisdiction-filtered | ZA device holds ZA withdrawal periods, nothing else | ADR-0006 | ✅ Phase 2/3, the reference-cache read path |

**Reading the coverage column**: ✅ = a real test exists and was verified this session (or in an earlier one, re-confirmed here); ◐ = partial — the mechanism is proven, but not every angle the row implies; ⛔ = not built, either because the row's own premise doesn't hold yet in this codebase or because it belongs to a phase that hasn't started (O-12/O-15). This replaces an unannotated table that read as a claim of blanket coverage it never had — `docs-contradict-the-code`'s own recurring failure mode in this repo.

```ts
// apps/web/e2e/offline/durability.spec.ts
test('O-2: a calving survives a device reboot', async ({ page, context }) => {
  await login(page);
  await context.setOffline(true);

  await recordCalving(page, { dam: 'COW-0142', sex: 'female', weightKg: 34 });
  await expect(page.getByTestId('sync-strip')).toHaveText(/1 to send/);

  await simulateReboot(context);          // close context, clear memory, keep OPFS

  const page2 = await context.newPage();
  await page2.goto('/');
  await expect(page2.getByText('COW-0142')).toBeVisible();
  await expect(page2.getByTestId('sync-strip')).toHaveText(/1 to send/);
});

test('O-9: an expired token holds the queue, never clears it', async ({ page, context }) => {
  await login(page);
  await context.setOffline(true);
  await recordManyEvents(page, 47);

  await expireRefreshToken(context);
  await context.setOffline(false);

  await expect(page.getByText(/sign in/i)).toBeVisible();
  await expect(page.getByTestId('sync-strip')).toHaveText(/47 to send/);  // ⭐ HELD

  await login(page);
  await expect(page.getByTestId('sync-strip')).toHaveText(/Synced/, { timeout: 30_000 });
  expect(await serverEventCount()).toBe(47);   // ⭐ nothing lost
});
```

**O-9 gets its own paragraph in this document because it is a two-line mistake that destroys a farmer's month of work.** `if (tokenExpired) queue.clear()` is a plausible line of code that someone will write. This test is why they won't ship it.

---

## 5. E2E — the journeys

~40 specs. Each maps to a use case.

| Journey | UC | Notes |
|---|---|---|
| Onboard livestock-only | UC-001 | Assert crop nav is **absent** |
| Onboard mixed | UC-001 | Both nav sets |
| Add enterprise later | UC-001 A4.1 | **Zero data loss** |
| Treat → withdrawal → blocked sale | UC-010, US-032 | **Offline** |
| Weigh session, 200 animals | US-050 | <50ms per commit |
| Spray → PHI → blocked harvest | UC-010, US-030 | **Offline** |
| Payroll happy path | UC-020 | Online |
| Payroll with all three warnings | UC-020, US-020/21/22 | Warnings **above** the numbers |
| Payroll blocked by deduction | UC-020 E7.1 | **Rejects** |
| BCEA inspector report | US-023 | <30s |
| Mark missing → evidence pack | UC-030, US-031 | Offline mark, queued pack |
| GlobalGAP checklist → pack | UC-040 | Evidence auto-mapped |
| Worker role sees no money | US-060 | 403 + **empty local DB** |
| Owner cannot skip 2FA | ADR-0007 | Enrolment enforced before money is visible |
| Recovery code works once | ADR-0007 | Second use rejected |
| Theme survives reload | FR-016 | No flash of light on a dark-mode cold start |
| Grid adapts to enterprise types | FR-017 | Cattle farm has no Sprays tile, in the DOM |
| Vet grant expires | US-061 | Day 31 revoked |
| Device back after a week | UC-050 | Full reconciliation |

---

## 6. Traceability — generated, not maintained

```bash
pnpm test:trace
```

Walks `docs/01-requirements/functional-requirements.md` for FR IDs and greps every test file for FR IDs **in `describe`/`it`/`test` titles** (not `@FR-xxx` tags — that convention was never adopted).

> **⚠️ It is a REPORT, not a gate. It exits 0 whatever it finds**, unless you pass `--strict`, and nothing in CI passes `--strict`. It lives at `scripts/test-trace.mjs`.
>
> **What it proves and what it does not.** It proves a test *names* an FR. It cannot prove the test exercises it — `it('FR-999 works')` with an empty body counts for nothing and scores here. Read it as "which requirements has nobody even claimed to cover", which is a real question, and not as evidence of coverage.
>
> **Baseline at the end of Phase 2: 40 of 146 requirements named.** Most of the gap is phases 3–7, which are not built. Turning `--strict` on today would fail on 91 P1/P2 requirements that nobody has written a line of code for, so the gate is deliberately off until the baseline is agreed. When it goes on, update this file, `ci-cd.md`, `functional-requirements.md` and `SRS.md` in the same commit — the claim and the behaviour move together or this gap simply reopens.

```ts
// tools/trace.ts
const frs   = parseRequirements('docs/01-requirements/functional-requirements.md');
const tests = await grepTestTags(['apps/**/test/**', 'packages/**/test/**']);

const uncovered = frs.filter(fr => fr.priority <= 2 && !tests.has(fr.id));
if (uncovered.length) {
  console.error('Uncovered P1/P2 requirements:');
  uncovered.forEach(fr => console.error(`  ${fr.id}  ${fr.title}`));
  process.exit(1);
}
```

```ts
test('records a calving offline @FR-104 @FR-101 @US-010', async () => { /* ... */ });
```

**A hand-maintained traceability matrix is a lie within two sprints.** Generate it, gate on it, and it stays true. This is also what lets a `/goal` condition say "every P1 FR in this phase has a covering test" and have that mean something checkable.

---

## 7. What cannot be automated

These are gates. They are in the roadmap because they cannot be in CI.

| Check | Phase | Why a human |
|---|---|---|
| **The crush test** — a real handler, a real crush, timed | 2 | If a weight takes >4s, the tests all pass and the product is dead |
| **The reboot test** — real Android, real aeroplane mode, real reboot | 1 | Emulator OPFS ≠ device OPFS |
| **The sunlight test** — real phone, midday, gloves | 1, 2 | `axe-core` measures contrast ratios, not glare |
| **The bookkeeper test** — a real payslip, a 20-year bookkeeper | 3 | They will spot in 5 seconds what the test suite cannot express |
| **The auditor test** — a real GlobalGAP auditor, a real pack | 4 | They know what is missing. We do not. |
| **The SAPS test** — a real Stock Theft Unit officer | 4 | Same |
| **The legal review** — a qualified labour-law practitioner | 3 | **The tests encode our understanding. If our understanding is wrong, the tests are confidently wrong too.** |

The last one is the important one. Everywhere else in this codebase, a passing test means the code is right. In payroll, a passing test means the code matches what we *believed* the law says. Those are not the same claim, and no amount of coverage closes the gap. Only a lawyer does.

---

## 8. Commands

```bash
pnpm test                 # unit + integration
pnpm test:unit
pnpm test:integration     # spins Postgres
pnpm test:e2e
pnpm test:e2e:offline     # ⭐ the offline matrix
pnpm test:tenancy         # ⭐ sync rules ≡ RLS
pnpm test:trace           # ⭐ FR coverage
pnpm test:perf            # NFR-0xx budgets
pnpm test:coverage

pnpm verify               # lint + typecheck + test + build — THE GATE
```

`pnpm verify` does not include E2E (too slow for the inner loop).

> **⚠️ The block above is the INTENDED script set, not the one that exists.** As at the end of Phase 2 the repo has `test`, `test:e2e`, `test:trace` (report-only) and `verify`. `test:unit`, `test:integration`, `test:e2e:offline`, `test:tenancy`, `test:perf` and `test:coverage` **do not exist as scripts** — the work behind several of them does exist and runs inside `pnpm test` (the offline e2e path is `apps/web/e2e/offline-capture.spec.ts`; the tenancy check is `packages/sync/test/tenancy.spec.ts`), it is just not reachable by the name printed here.
>
> **What CI actually runs on a PR** ([ci-cd.md](ci-cd.md), `.github/workflows/ci.yml`): `pnpm verify` and `pnpm test:e2e`. That is all. Two lanes, not seven.

---

## 9. Anti-patterns

| Don't | Do |
|---|---|
| Mock the database | Testcontainers |
| Mock our own domain code | Fix the boundary |
| Assert implementation (`expect(spy).toHaveBeenCalled()`) | Assert what a farmer or auditor observes |
| A test that breaks on 1 January | Inject `now` |
| `expect(gross).toBe(241.84)` | `expect(gross).toBe(24184)` — cents |
| Skip the offline suite because it's slow | It is the product |
| Skip the tenancy suite because it's fiddly | It is the security boundary |
| A test with no cited source | Cite the §, the US, or the Gazette |
| Chase coverage % | Cover the behaviour that matters |

**The one that will be tempting:** skipping `test:e2e:offline` in CI because it adds four minutes. Four minutes is the price of the entire product thesis. Pay it.
