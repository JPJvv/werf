# Monitoring & Logging

---

## 1. The thing that makes this different

Most SaaS fails loudly. A farm app with an offline-first client **fails silently, on our side, while the farmer believes everything is fine** — because locally it is. Their write committed. The sync strip says "3 to send". They go on with their day.

If sync has been failing for that farm for six hours, nobody knows. Not the farmer, not us, not until they call having lost a week.

> **The single most important thing on the dashboard is not error rate. It is sync health, per farm.**

Everything below is arranged around that.

---

## 2. Signals

### 2.1 Golden signals (NFR-703)

| | Metric | Alert |
|---|---|---|
| Latency | API p95, p99 | p95 > 200ms for 5m · p99 > 800ms |
| Traffic | req/s, sync connections | — |
| Errors | 5xx rate, unhandled exceptions | > 1% for 5m |
| Saturation | CPU, memory, connections, queue depth | > 80% for 10m |

### 2.2 The sync signals — the ones that matter here

| Metric | Why | Alert |
|---|---|---|
| **`sync_queue_depth{farm_id}`** | A farm with a stuck queue is a farm losing confidence | p99 > 500 for 30m |
| **`sync_failure_rate{farm_id}`** | The silent failure | > 1% for 15m |
| **`sync_last_success_age{farm_id}`** | **A farm that hasn't synced in 24h is either offline (fine) or broken (not fine)** | > 48h for an active farm |
| `sync_conflict_rate` | Rising conflicts = a data model problem | > 5% of writes |
| `sync_quarantine_count` | Writes we couldn't apply | > 0 → investigate |
| **`replication_slot_lag_bytes`** | **The WAL footgun — see §5** | **> 1GB** |
| `powersync_connected_clients` | Capacity | — |
| `sync_upload_duration_p95` | Is EDGE actually working? | > 60s |

**`sync_last_success_age` is the highest-value alert in this system.** A farmer who is genuinely in a dead zone for two days is normal and fine. A farmer whose device *thinks* it is syncing and is failing every attempt looks identical from the outside — and one of those two people is about to lose a week of records.

Distinguishing them requires the client to report attempts, not just successes. That is a client instrumentation requirement, and it is easy to forget because the happy path never needs it.

### 2.3 Business signals 🇿🇦

| Metric | Why |
|---|---|
| `payroll_runs_blocked_total{reason}` | **A spike in `NET_BELOW_MINIMUM` means either a real problem on farms or a bug in our engine.** Both need a human. |
| `payroll_warnings_total{code}` | `PIECE_RATE_TOPPED_UP` trending up = farms are getting piece rates wrong. That is a product insight, and possibly a support conversation. |
| `regulatory_rate_lookup_miss_total{jurisdiction,code}` | **> 0 is a page.** A missing rate means payroll is throwing. In February this is the fire. |
| `auth_2fa_enrolled_ratio{role}` | Owners without 2FA are the accounts holding wages and banking. Track it; nudge it. |
| `auth_recovery_code_used_total` | A spike means phones are being lost, or something worse |
| `phi_override_total{farm_id}` | Overrides are legal but they are non-conformances. Rising = something wrong on a farm. |
| `evidence_pack_generated_total{type}` | Is the wedge being used? This is BO-2 (BRD) in a metric. |
| `compliance_pack_duration_p95` | NFR-016: 15s |

`regulatory_rate_lookup_miss_total > 0` pages someone. [ADR-0005](../03-architecture/adr/ADR-0005-regulatory-rates.md) rule 6 says a missing rate throws rather than defaulting — which is correct, and it means the throw must reach a human immediately, especially in the last week of February.

---

## 3. Logging

Structured JSON. Correlation ID on every request (NFR-701).

```ts
// apps/api/src/logging/logger.ts
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    // ⭐ A deny-list, not an allow-list, because you cannot enumerate
    // every path a name might appear at. Tested — see below.
    paths: [
      'req.headers.authorization', 'req.headers.cookie',
      '*.idNumber', '*.id_number', '*.password', '*.token',
      '*.bankAccount', '*.bank_account',
      '*.fullName', '*.full_name', '*.phone', '*.email',
      '*.gps', '*.location', '*.coordinates',
    ],
    censor: '[redacted]',
  },
  formatters: { level: (l) => ({ level: l }) },
});
```

```json
{
  "level": "info",
  "time": "2026-07-17T09:30:00.000Z",
  "correlationId": "01HXYZ...",
  "userId": "019...",
  "farmId": "019...",
  "route": "POST /v1/farms/:farmId/payroll/runs",
  "durationMs": 4210,
  "status": 201,
  "payrollRunId": "019...",
  "warningCount": 3,
  "blocked": true
}
```

**Note what is not in there:** no employee name, no ID number, no amount. `warningCount: 3, blocked: true` is enough to debug with. Whose payslip was blocked is in the database, behind RLS, where it belongs — not in a log stream that a support engineer greps.

### The redaction test

```ts
// apps/api/test/logging/redaction.spec.ts
it('never emits an SA ID number', async () => {
  const sink = captureLogSink();
  await request(app).post('/v1/farms/x/employees')
    .send({ fullName: 'Thabo Mokoena', idNumber: '9001015800083' });

  expect(sink.raw()).not.toMatch(/9001015800083/);
  expect(sink.raw()).not.toMatch(/\b\d{13}\b/);      // the shape, not the value
  expect(sink.raw()).not.toContain('Thabo Mokoena');
});
```

This runs in CI. A redaction config is a promise; a test is a control.

### Levels

| | Use | Retention |
|---|---|---|
| `error` | Needs a human | 90d |
| `warn` | Degraded, self-healing | 30d |
| `info` | Requests, state changes | 30d |
| `debug` | Off in production | 7d (staging) |

**Audit log ≠ application log.** `audit_log` is a database table, immutable, 7-year retention (NFR-606), legally significant. CloudWatch is operational and ephemeral. Never conflate them: an auditor asking "who approved this payroll" gets the table, not a log search.

---

## 4. Tracing

OpenTelemetry (NFR-702). Trace the paths where latency actually hurts:

- `POST /sync/write` → validate → RLS → apply → checkpoint
- `POST /payroll/runs` → rate lookup → per-shift calc → warnings → persist
- Evidence pack → query → render → S3

```ts
const span = tracer.startSpan('payroll.calculate', {
  attributes: {
    'werf.farm_id': farmId,
    'werf.employee_count': employees.length,
    'werf.period_days': days,
    // ⭐ never an employee name, never an amount
  },
});
```

Span attributes leave the country if the tracing backend is offshore. Same rule as logs (NFR-212).

---

## 5. The two infrastructure alarms that will save you

### Replication slot lag

```hcl
resource "aws_cloudwatch_metric_alarm" "replication_slot_lag" {
  alarm_name          = "werf-prod-replication-slot-lag"
  metric_name         = "OldestReplicationSlotLag"
  namespace           = "AWS/RDS"
  threshold           = 1073741824          # 1GB
  evaluation_periods  = 2
  period              = 300
  alarm_description   = <<-EOT
    PowerSync's replication slot is falling behind. WAL is accumulating.
    If unaddressed this fills the disk and takes down the database.
    Runbook: docs/05-operations/maintenance-runbook.md#replication-slot-lag
  EOT
}
```

**This is the known footgun of logical replication** ([ADR-0003](../03-architecture/adr/ADR-0003-sync-engine.md)). If PowerSync stops consuming — crashed, wedged, misconfigured — Postgres retains WAL for the slot indefinitely. The disk fills. The database stops. The failure chain starts with something that looks harmless and ends with a total outage, and the window between them is hours, not minutes.

An idle database makes it worse, not better: fewer writes means slower slot advancement means the lag looks stable while the WAL grows.

### Free storage

```hcl
resource "aws_cloudwatch_metric_alarm" "free_storage" {
  metric_name       = "FreeStorageSpace"
  threshold         = 10737418240           # 10GB
  comparison_operator = "LessThanThreshold"
}
```

The second half of the same failure. Alert on both; they catch it at different stages.

---

## 6. SLOs

Alert on burn rate, not on raw thresholds (NFR-704).

| SLO | Target | Window |
|---|---|---|
| API availability | 99.5% | 30d rolling |
| Sync eventual success | 99.9% within 24h of connectivity | 30d |
| API latency p95 < 200ms | 99% | 30d |
| **Zero data loss** | **100%** | **always** |

**"Zero data loss" is not an SLO with an error budget.** It has no acceptable failure rate. One lost record is an incident, a post-mortem, and a personal phone call to the farmer.

```yaml
# Fast burn: 2% of a 30-day budget in 1 hour → page
- alert: SyncErrorBudgetFastBurn
  expr: |
    (1 - (sum(rate(sync_success_total[1h])) / sum(rate(sync_attempts_total[1h])))) > 14.4 * 0.001
  for: 2m
  labels: { severity: page }
  annotations:
    runbook: docs/05-operations/maintenance-runbook.md#sync-failures

# Slow burn: 10% in 6 hours → ticket
- alert: SyncErrorBudgetSlowBurn
  expr: |
    (1 - (sum(rate(sync_success_total[6h])) / sum(rate(sync_attempts_total[6h])))) > 6 * 0.001
  for: 15m
  labels: { severity: ticket }
```

---

## 7. Dashboards

### Sync health (per farm) — the one you actually look at

```
┌────────────────────────────────────────────────────────┐
│  SYNC HEALTH                              last 24h     │
├────────────────────────────────────────────────────────┤
│  Farms syncing normally              1,204             │
│  Farms with queue > 100                 12  ← look     │
│  Farms not synced in 48h                 3  ← CALL     │
│  Quarantined writes                      0             │
│  Conflict rate                        0.3%             │
├────────────────────────────────────────────────────────┤
│  Farms not synced in 48h:                              │
│    Rietfontein      last: 3d ago   queue: 247   ⚠      │
│    Kranskop         last: 5d ago   queue:  89   ⚠      │
│    Doornhoek        last: 2d ago   queue:   0   ok?    │
└────────────────────────────────────────────────────────┘
```

**Doornhoek has a queue of 0 and hasn't synced in two days — that farm is probably just offline, and that is fine.** Rietfontein has 247 records waiting and hasn't landed one in three days — **that farmer needs a phone call today**, and they do not know it yet.

That distinction is the entire reason this dashboard exists, and it is why `sync_queue_depth` and `sync_last_success_age` must be read together rather than alerted on separately.

### Compliance 🇿🇦

```
Payroll runs (30d)          247
  blocked                     3  ← by reason
  with warnings              89  ← PIECE_RATE_TOPPED_UP: 61
Rate lookup misses            0  ← MUST be 0
PHI overrides (30d)          12  ← by farm
Evidence packs               34  ← theft: 4 · GlobalGAP: 22 · SIZA: 8
```

`Evidence packs: 34` is BO-2 from the [BRD](../00-business/BRD.md) rendered as an operational metric. If that number is zero, the wedge is not landing and the product strategy is wrong — which is worth knowing from the dashboard rather than from churn.

---

## 8. Alert rules

| Alert | Severity | Response |
|---|---|---|
| **`regulatory_rate_lookup_miss > 0`** | **Page** | **Payroll is throwing. In February, this is the fire.** |
| Replication slot lag > 1GB | Page | Disk fills → total outage |
| Free storage < 10GB | Page | Same, later stage |
| Data-loss signal | Page | Zero tolerance |
| API 5xx > 1% | Page | |
| Sync fast burn | Page | |
| Farm not synced 48h + queue > 0 | Ticket | **Phone the farmer** |
| Quarantined writes > 0 | Ticket | Human review |
| Sync slow burn | Ticket | |
| Payroll blocked spike | Ticket | Real problem or our bug? |
| PHI overrides trending | Ticket | Farm conversation |

**Every alert has a runbook link (NFR-705).** No orphans. An alert without a runbook is a 2am guess.

---

## 9. Client-side

```ts
Sentry.init({
  tracesSampleRate: 0.1,
  beforeSend(event) {
    return scrubPii(event, { /* NFR-212 — see security.md §3.4 */ });
  },
});
```

**Client metrics we actually need:**

| Metric | Why |
|---|---|
| `local_write_duration` | NFR-007: 50ms. On a Galaxy A15, not a MacBook. |
| `sync_attempt_total{outcome}` | **Attempts, not just successes** — the only way to distinguish "offline" from "broken" |
| `opfs_bytes_used` | NFR-017: 200MB. Eviction warning. |
| `queue_depth` | What the farmer sees |
| `time_to_interactive_warm` | NFR-004: 1s |

Real user monitoring is sampled at 10% and **must not transmit GPS**. A farm's GPS trace is a stock theft map ([security.md §1](security.md)).

---

## 10. Retention

| | Retention | Where |
|---|---|---|
| App logs | 30d (errors 90d) | CloudWatch, af-south-1 |
| Metrics | 15 months | CloudWatch |
| Traces | 7d | 10% sampled |
| **Audit log** | **7 years** | **Postgres — NFR-606** |
| Sentry | 90d | Offshore, **PII-scrubbed** |

Audit log is the odd one out on purpose: it is a legal record in a database table, not telemetry, and it outlives every other signal here by six and a half years.
