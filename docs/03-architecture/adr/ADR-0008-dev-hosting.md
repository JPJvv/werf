# ADR-0008 · Free US/EU hosting during the build; af-south-1 before real data

**Status:** Accepted · **Date:** 2026-07 · **Deciders:** Solo dev
**Amends:** [ADR-0002](ADR-0002-data-residency.md) (data residency) for the pre-production period only.

## Context

Two goals are in tension. [ADR-0002](ADR-0002-data-residency.md) locks production data to
`af-south-1` because Werf's data subjects are South African and POPIA governs their PII. But the build
must cost as close to zero as possible, and almost every free tier hosts in the US or EU. Cape Town
hosting is not free.

The resolving fact: **POPIA governs personal information. The build has none.** Seed and test data are
synthetic and obviously fake by design — invalid SA ID checksums, `Test Farm 1`
([github-strategy.md](../../04-delivery/github-strategy.md), [security.md](../../05-operations/security.md)).
Synthetic data in Ohio is not a residency problem, because there is no data subject and nothing to
protect. The residency obligation attaches the moment a real farm worker's ID number enters the system —
not before.

## Decision

**Host the build on free US/EU tiers with synthetic data only. Migrate to `af-south-1` before the first
real farm onboards.**

Concretely:

- Frontend on Cloudflare Pages, database on Neon, sync on PowerSync Cloud, API on Render — all free,
  all US/EU, all fed exclusively synthetic data. See
  [hosting-and-cost-control.md](../../05-operations/hosting-and-cost-control.md).
- **A hard gate:** no real personal information is entered into, or synced to, any hosted service until
  the production stack in `af-south-1` exists. The first real farm is the trigger to stand up
  [ADR-0002](ADR-0002-data-residency.md)'s production environment — and it is a decision, not a config
  flip.
- Cost safety is a first-class requirement of this decision, not an afterthought: prefer services that
  cap by pausing, keep cards off wherever possible, and set every available hard spend cap. The one
  usage-metered service (the Anthropic API, if used) gets a hard monthly cap and a disposable key.

## Why not just host in af-south-1 from day one

Because it buys residency you do not yet need, at a cost that slows the thing that matters. There is no
real PII in the build, so `af-south-1` protects nothing during Phases 0–6. Paying for always-on Cape
Town infrastructure — and the AWS surprise-bill exposure that comes with it — to guard data that does
not exist is spending the scarce resource (money and attention) on the wrong risk.

## Why not treat "US/EU now" as permanent

Because the moment real PII arrives, [ADR-0002](ADR-0002-data-residency.md) is correct and binding, and
the US/EU stack becomes a live compliance problem. This ADR does not overturn ADR-0002; it defers it to
the point where it bites. The gate in the decision above is what keeps "temporary" from silently becoming
"forever" — the same failure mode the naming ADR warns about with the codename.

## Consequences

| | |
|---|---|
| ➕ | The build costs ~$0 and carries near-zero surprise-bill risk |
| ➕ | No AWS exposure (no hard spend cap) until production, behind budget actions |
| ➕ | The app is local-first, so most hosted services aren't even needed until Phase 3+ |
| ➖ | A migration to `af-south-1` is required before launch — real work, planned in ADR-0002 |
| ➖ | The synthetic-data gate must be enforced by discipline; a seed script pointed at a hosted DB with one real ID number breaches it |
| ➖ | Free tiers drift (limits, card requirements, regions); the numbers need re-checking |

## The rule that keeps this honest

**No real personal information touches a hosted service before `af-south-1` exists.** Synthetic data is
the entire justification for hosting offshore; the day that stops being true, this ADR stops applying and
ADR-0002 takes over.

## Revisit if

The first real farm is ready to onboard (→ execute the ADR-0002 production migration) · a free tier adds
a card requirement or a hard-to-cap billing mode · you decide to self-host earlier to consolidate.
