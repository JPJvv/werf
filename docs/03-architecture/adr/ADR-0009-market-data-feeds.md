# ADR-0009 · Market price feeds are tiered by licence, and every one of them is optional

**Status:** Accepted · **Date:** 2026-07 · **Deciders:** Tech lead, product
**Relates to:** FR-901…908 · [ADR-0005](ADR-0005-regulatory-rates.md) (reference data with effective dates)

## Context

Farmers asked for a board of the prices that decide whether the year worked: SAFEX grain, red meat carcass classes, weaners, and the diesel price they are about to pay. The request is obviously reasonable — a farmer who knows the December maize contract before they talk to the co-op is in a different negotiation.

The problem is that these four feeds are not one kind of thing. They differ in who owns the data, whether we may pass it to a device, how often it changes, and what happens when it is wrong. Treating them as one integration produces a dashboard that is either legally exposed or permanently broken.

**Three constraints shape the decision:**

1. **JSE/SAFEX market data is proprietary and licensed.** Even 15-minute-delayed data requires an agreement, and pushing it to a farmer's phone is *redistribution*, not consumption. An offline-first product syncing prices to 10,000 devices is a redistribution question, and getting that wrong is a commercial dispute with the exchange, not a bug.
2. **Red meat prices are weekly and in arrears.** RMAA collects abattoir prices through a voluntary price information system and publishes the following week. There is no real-time carcass price and pretending otherwise misleads.
3. **Fuel prices are government-published and free.** DMRE/DMPR sets the pump price monthly, announced on the first Wednesday. No licence, no ambiguity, no counterparty.

Meanwhile this product's defining constraint has not changed: it works with the network off. Prices are the one thing that genuinely cannot.

## Decision

**Three tiers, decided by licence rather than by convenience, and the tier is stored as data on the series rather than remembered by whoever writes the sync rule.**

| Tier | Feed | Source | Licence | Syncs to device? |
|---|---|---|---|---|
| **A — free & official** | Diesel, petrol, by pricing zone | DMRE/DMPR | Public | **Yes** |
| **B — licensed** | SAFEX white/yellow maize, wheat, soya, sunflower | JSE, or a licensed redistributor | Agreement required, end-of-day preferred | **Only if the agreement permits it** |
| **C — permissioned** | Beef & mutton carcass classes, weaners, feeder lambs | RMAA / AMT, by arrangement | Negotiated, attribution required | **Only if the arrangement permits it** |

`market_price_series.syncable` carries the answer per series, and the PowerSync rule filters on it. A series we may display but not redistribute is served from the API on demand and never lands in OPFS.

**Tier A ships first and alone if necessary.** It is the feed with no counterparty, it is the input cost every farm shares regardless of enterprise type, and it proves the whole surface — the card, the "as at" stamp, the offline degradation — before any commercial conversation starts.

**End-of-day over intraday for Tier B.** A farmer making a marketing decision does not need a live tick, an EOD mark-to-market price is materially cheaper to licence, and it removes the entire class of "is this price stale" ambiguity that a delayed intraday feed creates. If someone later argues for intraday, they are arguing for a trading tool, and that is the marketplace we deliberately excluded.

## The rules

1. **`as_at` is rendered, always, in the visible layout.** Not a tooltip, not on hover. A price without its date is a liability, because a farmer will act on it. A weekly carcass price fetched this morning is still last week's price.
2. **`as_at` and `fetched_at` are separate columns** so we can tell a stale market from a broken poller. A feed that has silently stopped updating looks identical to a quiet market unless you store both.
3. **Values are integer `value_micros`, never floats.** Same reasoning as `Money` — a price is arithmetic that ends up in a decision.
4. **No recommendation, ever.** FAIS ([legal-compliance.md §5.2](../../00-business/legal-compliance.md)). Render the number and stop. This is enforced in code review, and the fact that it is a *legal* line rather than a taste line is why it belongs in an ADR.
5. **Every feed degrades to a cached last-known value, and then to absence.** The Phase 6 gate already says it: kill any integration and the product still works. A price board that breaks the home grid when a poller fails has failed that gate.
6. **Attribution is data, not markup.** `market_price_series.attribution` renders whatever the licence obliges us to display, so a change in terms is a row update rather than a release.
7. **Polling is server-side.** The client never talks to a price source directly — credentials, rate limits, and attribution all live on the API, and one poll serves 10,000 farms instead of 10,000 polls serving one each.

## Alternatives considered

| Option | Why not |
|---|---|
| Scrape the weekly PDFs | Fragile by construction, and it takes data whose terms we have not agreed. It also breaks silently and in the direction of showing an old price as current — the exact failure mode rule 1 exists to prevent. |
| Link out to the source | Free and safe, but it is a bookmark, not a feature. The value is in one board filtered to what this farm actually farms (FR-906). |
| Licence full intraday SAFEX | Costs real money to serve a decision that does not need it, and pulls the product toward being a trading tool. |
| Build a price feed as a paid add-on | Premature. Prove farmers open the board daily on Tier A first. |

## Consequences

| | |
|---|---|
| ➕ | Tier A ships with no external dependency and no negotiation |
| ➕ | The licence is enforced by a column and a sync rule, not by memory |
| ➕ | Every price carries its own provenance and age |
| ➕ | Losing any feed degrades to grey, not to broken |
| ➖ | Tiers B and C are gated on commercial conversations we do not control |
| ➖ | Two timestamps per price is a thing every developer must understand |
| ➖ | A non-syncable series needs a network, which contradicts the product's instinct — and must be shown honestly rather than papered over |

## Revisit if

A licensed redistributor offers SAFEX EOD at a price that makes Tier B trivial — that changes the sequencing but none of the rules. Or if farmers ignore the board entirely in the pilot, in which case Tiers B and C should never be bought.
