# Maintenance Runbook

Operational procedures. Written to be followed at 2am by someone who did not write the code.

---

## 0. The calendar that is not optional 🇿🇦

**Read this first. It is the part of running Werf that has a deadline set by someone else.**

| When | What | Miss it and… |
|---|---|---|
| **Early February** | Watch for the national minimum wage Gazette. Load the new rate. Verify. | **Every farm on Werf underpays every worker from 1 March.** |
| **Late February** | Change freeze on payroll code. Verify a real run against a hand-calculation. | You cannot tell a wage bug from an unrelated deploy on 2 March. |
| **1 March** | New rate live. Watch `payroll_warnings_total` and the first runs. | |
| **Mid-April** | BCEA earnings threshold Gazette → load before 1 May. | Managers above the threshold get overtime they are not owed, or vice versa. |
| **Nov–Dec** | Next year's public holidays, incl. any once-off proclaimed days. | Public holiday pay computes wrong. |
| **Quarterly** | **Restore drill** (§4). | Your RTO is fiction. |
| **Quarterly** | Review farmer-product entry and reminder usability with pilot farms. | The logbook becomes harder to use or misleading. |
| **Annually** | POPIA review: retention, DPIA, operator contracts. | |
| **Annually** | Rotate the PII encryption key (re-encrypt). | |

**The February deadline is the highest-severity non-outage risk this product has.** It is not an engineering task that slipped; it is a legal deadline. Put it in the on-call calendar in January, with a named owner, and treat it like a release.

---

## 1. The annual wage update — step by step 🇿🇦

The most important procedure in this document.

```
□ 1. The Gazette lands (typically early February, effective 1 March).
     Get the actual Gazette. Not a news article. Not a payroll blog.
     Not this documentation pack — every figure in it has decayed.

□ 2. Read it. Note: the rate, the effective date, the Gazette number,
     and whether the farm-worker rate still equals the national minimum.
     (It has not always. Do not assume.)

□ 3. Check whether anything else moved: deduction caps, UIF ceiling.

□ 4. Load into STAGING first:
     POST /v1/admin/regulatory-rates
     { "jurisdiction": "ZA", "code": "NMW_FARM", "value": "31.85",
       "unit": "ZAR_PER_HOUR", "effectiveFrom": "2027-03-01",
       "gazetteReference": "GG XXXXX, 2027-02-XX" }

     The API rejects a POST without gazetteReference. That is deliberate.
     It also rejects an overlapping effective_from for the same code.

□ 5. Verify the previous rate got its effective_to set. If two rates
     both have effective_to = NULL, the lookup is ambiguous and will
     silently pick one. Check this. Every year.

□ 6. Run a payroll on staging for a period spanning 1 March.
     ⭐ Assert BOTH rates appear as separate lines. This is the case
        that happens every single year and is the one people miss.

□ 7. Hand-calculate one payslip. On paper. Compare.

□ 8. Load into PRODUCTION. Same POST. No deploy. That is the point
     of ADR-0005 — February must not need a release.

□ 9. Verify: rates.lookup('ZA','NMW_FARM','2027-03-01') returns the new rate
             rates.lookup('ZA','NMW_FARM','2027-02-28') returns the old one

□ 10. Watch the first production runs on 1–3 March.
      payroll_warnings_total{code="PIECE_RATE_TOPPED_UP"} will SPIKE.
      That is correct — the floor moved, so more piece rates fall below it.
      A spike is the system working, not breaking.

□ 11. Tell customers. "The March minimum wage is loaded. Your payroll
      will use it automatically for work done from 1 March."
      This is a trust-building email. Send it.
```

**If step 6 fails**, stop. Do not load production. A rate that resolves wrong across the boundary is worse than a rate that is late, because late is visible and wrong is not.

---

## 2. Incident response

### Severity

| | Meaning | Response | Examples |
|---|---|---|---|
| **SEV1** | Data loss, or a breach, or everyone is down | **Immediate, all hands** | Records lost · PII exposed · database down · **payroll computing wrong** |
| **SEV2** | Major function broken for many | < 1h | Sync failing across farms · payroll unavailable at month end |
| **SEV3** | Degraded, or one farm | < 4h business hours | One farm's sync stuck · slow reports |
| **SEV4** | Minor | Next sprint | Cosmetic |

**Payroll computing a wrong number is SEV1**, not SEV2, even though nothing is "down". A silent wrong payslip is worse than an outage: an outage is visible and recoverable; a wrong payslip is invisible, gets paid, and becomes a CCMA matter.

### The loop

```
DETECT → ASSESS → COMMUNICATE → MITIGATE → RESOLVE → LEARN
```

1. **Detect** — alert, or a customer. (If it is always the customer, §Monitoring is broken.)
2. **Assess** — severity, scope, how many farms.
3. **Communicate** — status page + affected customers. **Before** you have a fix. Silence is worse than bad news.
4. **Mitigate** — stop the bleeding. Rollback, feature flag, scale, block.
5. **Resolve** — fix it properly.
6. **Learn** — blameless post-mortem within 5 days, written down.

---

## 3. Runbooks

Every alert in [monitoring-logging.md §8](monitoring-logging.md) links here.

### Replication slot lag

**Alert:** `replication_slot_lag_bytes > 1GB`
**Why it matters:** PowerSync has stopped consuming WAL. Postgres retains it. **The disk fills and the database stops.** Hours, not minutes.

```bash
# 1. Is PowerSync alive?
aws ecs describe-services --cluster werf-prod --services powersync --region af-south-1

# 2. What does the slot say?
psql $PROD_URL -c "
  SELECT slot_name, active, restart_lsn,
         pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS lag
  FROM pg_replication_slots;"

# 3. If active = false, PowerSync is not consuming. Restart it:
aws ecs update-service --cluster werf-prod --service powersync \
  --force-new-deployment --region af-south-1

# 4. Watch the lag fall. It should.

# 5. If it does NOT fall, or PowerSync cannot restart, you are now
#    trading data against uptime. Check disk headroom:
#      FreeStorageSpace on the RDS dashboard
#    If < 5GB and falling, you have maybe an hour.
```

**The decision nobody wants:** if PowerSync cannot be restarted and the disk is about to fill, dropping the slot saves the database and **forces every client to a full resync**. Queued client writes are safe (they are on the devices) but every farm re-downloads everything.

```bash
# ⚠️ LAST RESORT. Forces a full resync for every farm.
# Do this only to prevent the database filling. Announce it first.
psql $PROD_URL -c "SELECT pg_drop_replication_slot('powersync_slot');"
```

**Prevention:** `wal_sender_timeout = 0` in the parameter group ([deployment-guide.md §2](deployment-guide.md)). If someone refactors the parameter group and loses that line, this alarm fires a week later and nobody connects the two.

### Repeated sync failures

Operations receives aggregate failure-rate and queue-depth signals without a stable farm identifier.
The farmer's device shows its own unsent work, retry state and sign-in recovery steps. If the farmer
asks support for help, an authorised farm member can preview and deliberately share a diagnostic
export. Support must not query farm records or derive a contact list from telemetry.

### Payroll computing wrong — SEV1

```
□ 1. STOP. Do not deploy a fix yet.
□ 2. Scope: how many runs, how many farms, which periods?
     SELECT farm_id, count(*) FROM payroll_runs
     WHERE created_at > '<suspect date>' AND status = 'approved';
□ 3. Was money paid? Check EFT export timestamps.
□ 4. Feature-flag payroll OFF. A payroll that won't run beats one that
     runs wrong.
□ 5. Reproduce in a test. Table-driven, from the real data shape.
□ 6. Fix the domain function. Add the case to the table.
□ 7. Verify against a hand-calculation.
□ 8. Deploy. Re-run affected periods as CORRECTIONS —
     never overwrite an original payslip (UC-020 A9.1).
□ 9. Notify every affected farm IN WRITING. Explain:
     what was wrong, who was affected, what the correct figure is,
     what they must do. They may have a legal obligation to top up.
□ 10. Post-mortem. This one goes deep — how did the tests pass?
```

**Step 9 is not optional and it is not a support ticket.** If a farm underpaid a worker because of our bug, that farmer has an obligation under the BCEA, and they cannot discharge it if they do not know. Tell them.

### Suspected breach — SEV1

```
□ 1. CONTAIN (target: 1 hour)
     - Revoke sessions:  UPDATE refresh_tokens SET revoked_at = now();
     - Rotate: DB credentials, PII key, API keys
     - Isolate the affected component
     - PRESERVE EVIDENCE. Snapshot before you clean anything.
□ 2. ASSESS (24h)
     - What data? Whose? How much? Still ongoing?
     - ⭐ Run the "who was affected" query. If you have never run it
       before today, you are already late. It is built in Phase 5.
□ 3. DECIDE (72h — NFR-605)
     - Reasonable grounds to believe unauthorised access? → POPIA s22
     - Tech lead + legal. Written decision either way.
□ 4. NOTIFY (POPIA s22)
     - The Information Regulator
     - EACH affected data subject, IN WRITING
     - ⭐ For a farm worker: in a language they read. Their contact
       details may only exist in their employer's records — so you may
       need to notify through the farmer. Work this out NOW, not then.
     - Content: what happened, possible consequences, what we are doing
□ 5. RECOVER
□ 6. POST-MORTEM (5 days, blameless, written)
```

**Rehearse this.** A breach runbook that has never been executed is a document, not a capability. Run it on staging with a fabricated incident and find out that step 2's query takes forty minutes — before it matters.

### Database down

```bash
# Multi-AZ should fail over automatically in 1-2 minutes.
aws rds describe-events --source-identifier werf-prod \
  --source-type db-instance --duration 60 --region af-south-1

# If it didn't:
aws rds reboot-db-instance --db-instance-identifier werf-prod --force-failover

# Meanwhile: clients keep working. They are offline-first.
# Writes queue. Nothing is lost. This is the architecture paying rent.
# Say so on the status page — it is genuinely reassuring and it is true.
```

### High API latency

```
□ 1. Which route? Check the p95 by route.
□ 2. Database?  SELECT * FROM pg_stat_activity WHERE state = 'active';
     Long queries → EXPLAIN ANALYZE → missing index?
□ 3. Connection pool exhausted? Check pool metrics.
□ 4. Payroll? It is CPU-heavy by nature. Is a farm running 500 employees?
□ 5. Scale ECS if it is load. Fix the query if it is not.
```

---

## 4. The quarterly restore drill

**Not optional (NFR-109). A backup that has never been restored is a hope.**

```
□ 1. Latest snapshot → new instance
     aws rds restore-db-instance-from-db-snapshot \
       --db-instance-identifier werf-drill-$(date +%s) \
       --db-snapshot-identifier <latest> --region af-south-1

□ 2. Point a staging API at it

□ 3. Verify — not "does it start", but "is it right":
     - farm count matches
     - animal count matches
     - a payroll run for a known period reproduces the known result
     - a spray's PHI still computes
     - RLS still works (query as a user from farm A, see only farm A)

□ 4. ⭐ TIME IT. RTO is 4 hours (NFR-107). Was it?

□ 5. Write down what went wrong. Something always does.
     Missing parameter group. Wrong security group. Forgot the
     PII key is in Secrets Manager and the restore has no access.

□ 6. Destroy the instance. (Actually destroy it. They cost money.)
```

If this has slipped a quarter, NFR-107 is a number in a document, not a capability.

---

## 5. Routine

### Staging refresh (monthly)

```bash
# ⭐ ANONYMISE. Never copy production personal data to staging.
# A staging environment holding real workers' ID numbers is a POPIA
# breach waiting for a misconfigured security group.
pnpm db:anonymise --source=<prod-snapshot> --target=staging
```

The anonymiser is tested code, not a script someone wrote once. It must: replace names, null the encrypted columns, fuzz GPS (a real farm's GPS in staging is still a stock theft map), and keep the *shape* — same row counts, same distributions — so performance testing means something.

### Dependencies (weekly)

```bash
pnpm audit --audit-level=critical   # blocks release (NFR-208)
pnpm outdated
```

Patch and minor: batch weekly. Major: its own PR with its own testing. **Never bump PowerSync or Drizzle in a batch** — those are the two dependencies whose breakage is subtle rather than loud.

### Reference data (quarterly)

```
□ Chemical registrations + PHIs → chemical_products (new version rows)
□ Veterinary withdrawal periods → veterinary_products
□ Notifiable disease list
□ Never UPDATE a reference row. Insert a new version with effective_from.
  A treatment in 2026 must forever resolve against 2026's withdrawal period.
```

---

## 6. Regular checks

**Daily (5 min):** sync health dashboard — any farm not synced 48h with a queue? · error rate · overnight alerts · queue depth.

**Weekly (30 min):** SLO burn · `pnpm audit` · quarantined writes · payroll warning trends · replication slot lag trend.

**Monthly (2h):** staging refresh · cost review · capacity vs NFR-3xx · alert noise audit (**an alert that fires and is always ignored is worse than no alert** — it trains you to ignore the one that matters) · runbook accuracy.

**Quarterly (1 day):** restore drill · reference data · dependency majors · access review (who still has production access, and why?) · DR review.

**Annually:** pen test · POPIA review · PII key rotation · GlobalGAP/SIZA standard versions · ADR review (are they still true?).

---

## 7. On-call

| | |
|---|---|
| Hours | 06:00–20:00 SAST business days; SEV1 always |
| Page | SEV1, SEV2 |
| Escalate | 30 min unacknowledged |
| **Peak** | **Last week of February · first week of March · month-end** |

**February and month-end are the peaks, not Black Friday.** Month-end is when every farm runs payroll simultaneously. The first week of March is when the new wage rate meets reality. Staff accordingly.

---

## 8. Contacts

| | |
|---|---|
| AWS Support | af-south-1, Business tier |
| PowerSync | Support channel — **have this before you need it** |
| Labour law | The practitioner who signs off the labour phase's final compliance slice |
| Information Regulator | POPIA s22 notifications — **have the contact and the form template ready** |
| Status page | status.werf.co.za |

Fill these in before launch. Looking up the Information Regulator's notification process during a breach is not a plan.
