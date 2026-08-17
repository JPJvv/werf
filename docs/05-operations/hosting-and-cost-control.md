# Hosting & Cost Control

**Two goals, held together:** run Werf on free tiers for as long as the build allows, and make it
*impossible* for any service to quietly rake up a bill. This document is the second goal's contract —
every service we touch, what its free ceiling is, the hard cap we set, and the kill switch that stops it.

The governing principle: **prefer services that cap by pausing, not by billing.** A database that
sleeps when it hits its free limit cannot surprise you. A database that autoscales and invoices you can.
Where a card is required, every available hard spend cap is set to its floor and an alert is wired.

> Residency note: during the build we host on free US/EU regions with **synthetic data only** — no real
> worker or farm PII ever leaves your machine until we move to `af-south-1`. See
> [ADR-0008](../03-architecture/adr/ADR-0008-dev-hosting.md). This is what makes free hosting POPIA-safe
> for now.

> **Price/limit warning (2026-08-09):** the table below is a planning snapshot, not a current vendor
> quote. Free tiers change without an architecture decision. Re-verify each official pricing page,
> region, card requirement, data-processing term and hard-cap behaviour immediately before creating
> or upgrading an account. The architecture decisions are synthetic-only offshore development and
> `af-south-1` before real data; no vendor limit can override those gates.

---

## 1. The stack, and why each piece can't surprise-bill you

| Layer | Service | Free ceiling | Card? | How it caps | Surprise-bill risk |
|---|---|---|---|---|---|
| Source + CI | **GitHub** (public repo) | Actions unlimited on public repos, standard runners | No | Fair-use throttle only | **None** |
| Frontend PWA | **Cloudflare Pages** | Unlimited static bandwidth, 500 builds/mo | No | Won't cut traffic or charge overage; asks you to upgrade | **None** (static) |
| Database | **Neon** (Postgres + PostGIS) | 0.5 GB/project, 100 CU-hrs/mo, 5 GB egress | No (free plan) | Autosuspends; free plan is hard-capped | **None** on free plan |
| Sync | **PowerSync Cloud** | 2 GB synced/mo, 50 connections | No | Free project deactivates after 1 week idle | **None** |
| Backend API | **Render** (free web service) | 750 hrs/mo, sleeps after 15 min idle | No | Free instance cannot bill; just sleeps | **None** |
| AI (Claude Code) | **Anthropic API** *(if used)* | Usage-based — **the one real risk** | Yes | You must set a hard spend cap | **HIGH — see §3** |
| Later: files/photos | **Cloudflare R2** | 10 GB storage, **zero egress fees** | Yes | Set cap; egress-free removes the classic bill bomb | Low if capped |

**What we deliberately do NOT use in the build phase:** raw AWS (EC2/RDS/S3). AWS has no hard spend
cap — only budgets and alerts that fire *after* spend — and is the classic source of five-figure
surprise bills from a misconfigured resource or a leaked key. AWS re-enters the picture only at
production, in `af-south-1`, behind billing alarms and a budget action that stops resources. Until then,
every service above either needs no card or caps by pausing.

**The cold-start trade-off:** Render's free API sleeps after 15 minutes and takes ~30–60 s to wake.
That is fine for a dev/demo backend and irrelevant while the app is local-first (early phases don't need
the hosted API at all — see §5). If cold starts annoy you at demo time, the smallest paid step is a
single ~$7/mo Render instance, capped, and nothing else changes.

---

## 2. Bring services online only when a phase needs them

The cheapest service is the one you never turn on. Werf is local-first, so for the first phases the app
runs entirely against local SQLite and needs **no** hosted database, sync, or API.

| Turn on… | Only when you reach… |
|---|---|
| GitHub + CI | Now (Phase 0) |
| Cloudflare Pages | First time you want a live demo URL (end of Phase 1) |
| Neon + PowerSync Cloud | Phase 3, when you actually test sync against a server |
| Render (API) | When a feature needs the server (payroll/compliance/PDF — Phase 5+) |
| AWS af-south-1 | Before the first real farm onboards — not before |

Every service left off is a service that cannot bill you.

---

## 3. The Anthropic API — the only real cost risk, handled

Claude Code is what builds this project, and if it runs on the **API** (pay-as-you-go) rather than a
flat-rate Claude subscription, it is the single service here that bills by usage and can run up cost. Treat
it as the crown-jewel kill switch.

**If you use a Claude subscription (Pro/Max) for Claude Code:** it's flat-rate — there is no usage bill
to cap. You're done; skip to §4. *(Recommended for predictable cost.)*

**If you use an API key:**

1. **Set a hard monthly spend limit.** Anthropic Console → **Settings → Limits** (on the AWS-billed
   console it's **Settings → Billing**). Set the organisation monthly spend cap to a number you can
   absorb, e.g. $20. This is a hard cap, not just an alert.
2. **Use a dedicated, disposable dev key** — never your main key. Set a per-key/per-workspace spend
   limit so a runaway loop can only burn that key's budget.
3. **Wire a usage alert** well below the cap so you hear about it early.
4. **Kill switch:** disable or roll the key in Console → **API Keys**. One click stops all API spend
   instantly.
5. Keep the key out of the repo — `.claude/settings.json` already denies reading `.env*`, and
   `gitleaks` runs in CI and pre-commit.

---

## 4. Per-service hard caps and kill switches

For each service: the cap to set now, and the one action that stops it dead.

**GitHub** — Settings → Billing → **set a spending limit of $0** on Actions/Storage (blocks any paid
overage; public-repo Actions stay free regardless). Kill switch: disable Actions in repo settings.

**Cloudflare (Pages, later R2/Workers)** — you can run Pages without a card. If you add R2/Workers,
Billing → **Notifications**: set a usage alert; keep Workers on the Free plan (no $5 paid plan unless you
opt in). Kill switch: delete the Pages project / R2 bucket, or remove the payment method.

**Neon** — stay on the **Free plan** (no card = cannot bill). If you ever upgrade, set a **billing
budget/cap** in Billing. Kill switch: the project autosuspends; to hard-stop, suspend or delete the
project in the console.

**PowerSync** — Free plan, no card. Kill switch: pause or delete the instance in the dashboard (free
instances also self-deactivate after a week idle).

**Render** — Free web service cannot bill. If you add a paid instance, set a **spend limit** in Account
Settings → Billing. Kill switch: suspend or delete the service.

**Anthropic** — see §3. Kill switch: disable the API key.

**AWS (production only)** — before creating anything: **Billing → Budgets** with a **budget action** that
stops/terminates resources at the threshold, plus a **CloudWatch billing alarm**, plus **IAM** limits on
what keys can create. Never put an uncapped-permission key anywhere near a repo. Kill switch: the budget
action, and an IAM policy that denies resource creation.

---

## 5. Your standing controls — "full authority to stop everything"

**The master kill switch (stops all possible spend in ~2 minutes):**

1. Anthropic Console → disable the dev API key. *(Stops the only usage-metered service.)*
2. Render → suspend the API service.
3. Neon → suspend the project. PowerSync → pause the instance.
4. Cloudflare → nothing needed (static, capped), or delete the R2 bucket if used.
5. Nuclear option: **remove the saved payment method** from any service that has one. With no card on
   file, no service can charge you — the worst case becomes a paused service, never a bill.

**Keep cards off wherever possible.** Every service in §1 except Anthropic (API mode) and optional
Cloudflare R2 works with **no card at all**. A service with no card cannot bill you — that is the
strongest cost control there is, stronger than any cap.

**The 5-minute monthly audit** (put it on a recurring reminder):

- GitHub, Render, Neon, PowerSync, Cloudflare, Anthropic → open each billing page, confirm $0 (or within
  cap), confirm spend limits still set.
- Anthropic → check the usage graph for anything unexpected; roll the dev key quarterly.
- Confirm no card crept onto a service that doesn't need one.

**One-time setup checklist:**

```
□ GitHub: spending limit $0; branch protection on main
□ Claude Code: use a subscription, OR a dedicated API key with a hard monthly cap + usage alert
□ Cloudflare Pages: connect repo, no card
□ Neon: free plan, no card, PostGIS enabled
□ PowerSync: free instance, no card
□ Render: free web service, no card (defer until a feature needs the API)
□ Every service: note its kill switch (above) somewhere you'll find it
□ AWS: do NOT create anything until production; then budget action + billing alarm FIRST
```

---

## 6. When free stops being enough

You will outgrow a free tier in exactly one of these ways, and each has a cheap next step — never a
cliff:

- **Neon 0.5 GB** → Neon Launch (~$5/mo min) or move Postgres to the af-south-1 production box you'll
  stand up anyway.
- **PowerSync 2 GB synced/mo** → self-host **PowerSync Open Edition** (free, source-available) on your
  own box, or the Pro plan.
- **Render cold starts** → one small capped paid instance (~$7/mo).

None of these is triggered by traffic you don't control, and none happens without you choosing it. The
architecture (local-first, one Postgres, one API) is deliberately cheap to run — the moat is the
compliance work, not a big server bill.

---

*Every price and free-tier figure here was accurate in July 2026 and will drift. Re-check the numbers
before you rely on them — the same rule the pack applies to wage rates applies to cloud pricing.*
