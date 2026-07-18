# ADR-0002 · Self-host in af-south-1; not Supabase Cloud

**Status:** Accepted · **Date:** 2026-07 · **Deciders:** Tech lead, with legal input
**Amended by:** [ADR-0006](ADR-0006-multi-jurisdiction.md) — residency becomes a property of the jurisdiction

## Context

Werf processes employee personal information — names, SA ID numbers, wages, and (via injury-on-duty records) health data — on behalf of thousands of farms. Where does it live?

## Decision

**Self-host the entire data plane in AWS af-south-1 (Cape Town).** Postgres on RDS Multi-AZ, PowerSync Service and the API on ECS Fargate, objects in S3 af-south-1. No managed BaaS.

## Why

First, be precise about the law, because the internet is not: **POPIA does not mandate data residency.** Section 72 permits transfer outside the Republic on any of several grounds — adequate protection by law/BCR/binding agreement, data subject consent, necessity for contract performance, or the data subject's benefit. Offshore hosting is lawful if a ground is properly established. Many South African businesses run lawfully on offshore cloud.

We host in South Africa anyway, for three reasons that are not "the law says so":

1. **Risk transfer.** We process on behalf of thousands of small responsible parties who have no capacity to run their own s72 analysis. Keeping data in the Republic removes s72 from their compliance surface entirely. That is a feature we can sell, and it is genuinely valuable to them.
2. **Latency.** Rural SA → eu-west-1 is >150ms RTT. → af-south-1 is a fraction of that. For a sync engine on a marginal EDGE connection, this is the difference between completing and timing out.
3. **Trust.** "Your workers' data never leaves South Africa" closes deals in this market. Selling farm software is a trust business.

And a fourth, which is the sharpest: **special personal information raises the stakes.** Injury-on-duty records are health data (POPIA s26). If we ever add biometrics, that is s26 too. Transferring special personal information offshore requires the destination to have adequate protection — a harder bar. Not transferring it at all makes the question moot.

## Why not Supabase Cloud

We wanted to. It is the obvious choice: Postgres, auth, RLS, storage, and a first-class PowerSync integration. It would have saved months.

**Supabase Cloud does not offer a South African region.** They supported af-south-1 during alpha and withdrew it for new projects, citing the operational burden of special-casing the region. Community requests for its return have been open for years.

So the options were: accept offshore hosting (loses reasons 1–3 above), or self-host. Self-hosted Supabase on af-south-1 was considered and rejected — we would take on operating Supabase's whole stack (GoTrue, PostgREST, Realtime, Storage, Kong) to use maybe a third of it, and get their upgrade cadence as our problem. Plain Postgres plus our own NestJS API is *less* to operate, not more, because we only run what we use.

## Consequences

| | |
|---|---|
| ➕ | s72 is off our customers' compliance surface |
| ➕ | Sub-50ms RTT for SA users |
| ➕ | A sentence that closes deals |
| ➕ | No BaaS lock-in; Terraform is portable |
| ➖ | We operate Postgres, backups, and restore drills ourselves |
| ➖ | No free tier; ~R6–9k/month baseline before revenue |
| ➖ | af-south-1 is a smaller region — fewer services, occasional feature lag, higher per-unit cost |
| ➖ | We build auth ourselves |

The auth cost is real but bounded, and we would have paid it anyway: **30-day offline sessions and per-farm RBAC are not Auth0's model.** We would have fought a managed provider on both.

## Where data does leave

Sentry (error tracking) is offshore. Therefore **PII scrubbing before transmission is a code requirement with a test (NFR-212)**, not a settings checkbox in a dashboard that someone can toggle. Any future AI feature faces the same gate: scrub, or establish a s72 ground, or process locally.

## Multi-country amendment

[ADR-0006](ADR-0006-multi-jurisdiction.md) makes residency **a property of the jurisdiction**, not a constant. The reasoning above is *why South African data is in South Africa* — it is not a claim that all data belongs in af-south-1 forever.

| Second country | Residency | Difficulty |
|---|---|---|
| Namibia, Botswana, Zimbabwe | af-south-1 — no local region exists, no local law requires otherwise | ✅ Easy |
| Kenya | The Data Protection Act 2019 has localisation provisions. Needs a real analysis. | ⚠️ Work |
| Australia, EU | ap-southeast-2 / eu-central-1 + a different privacy regime entirely | ❌ A project |

**What we do about it now: the AWS region is a Terraform variable. That is all.** No multi-region, no data-router, no speculative sharding. **The first non-SADC country triggers a re-read of this ADR** — which is the correct outcome, because it is a decision, not a config change.

## Revisit if

Supabase ships af-south-1 · Our ops burden exceeds ~1 engineer-week/month · The Information Regulator publishes the pending transborder guidance note with an adequacy finding that changes the calculus · **A jurisdiction outside SADC is added.**
