# ADR-0013 · Farmer-controlled logbook, not an authority

**Status:** Accepted | **Date:** 2026-08-20 | **Decider:** JP van Vuuren (product owner)

## Context

Phases 3 and 4 grew from useful farm records into an enforcement system. Werf selected products
from centrally maintained veterinary and crop-chemical registers, treated those sources as
authoritative, and refused sales, slaughter, sprays or harvests when its own compliance calculation
said no. That made ordinary record-keeping depend on expensive, continuously maintained regulatory
datasets and made Werf act as if it could authorise farm decisions.

That is not the product. Werf is a private farm logbook, planner and calculator. The farmer supplies
the facts they want recorded and remains responsible for decisions made from those facts.

## Decision

- Product details belong to the farm. A farmer may create a chemical or veterinary product from the
  label while recording work, including optional registration, ingredient and interval facts.
- Werf preserves a snapshot of those farmer-entered facts on the event and may calculate dates,
  quantities, costs and reminders from them. It does not verify the label, decide whether a product
  is lawful, prescribe what to use or represent a result as approval.
- Interval and planning overlaps are advisory. They must be conspicuous and explain their inputs,
  but they never prevent the farmer recording a spray, harvest, sale, slaughter or tally.
- Werf validates data integrity and security: tenant ownership, farm membership and role, valid
  references, supported event shapes, finite/non-negative values, money representation,
  append-only history and idempotency. Those are software correctness boundaries, not compliance
  judgements.
- Werf never reports farm activity to an authority, Werf staff or another third party. A theft pack,
  export or other disclosure is assembled only after an authorised farm member explicitly asks for
  it. No behavioural analytics or telemetry payload may contain farm records.
- Farm records are available through the product only to current members the farm has explicitly
  invited. Forced Postgres RLS and independently scoped sync streams remain mandatory. There is no
  staff/support record-browser role.
- The unfinished generic **Compliance** home tile is dropped. Useful farmer-owned registers and
  reminders may remain in their operational context, but no module may present Werf as a regulator.

This decision supersedes requirements and checklist text that mandates official crop/veterinary
product resolution, jurisdiction policing, compliance overrides or hard withdrawal/PHI blocks.
Historical tests and documentation must be rewritten to prove advisory behaviour instead.

## Privacy boundary — an important limitation

The current cloud architecture is tenant-private, encrypted in transit and protected by forced RLS,
but it is **not end-to-end encrypted**. Farm rows and object attachments must be readable by the
server to sync, project and render them. Consequently, a tightly controlled infrastructure operator
holding production database or object-store credentials can technically access plaintext. Werf must
not claim that even the service operator is cryptographically unable to read the data.

Provider-blind privacy would require a separate end-to-end-encryption architecture: keys controlled
by the farm, encrypted event payloads and attachments, client-side projections/search/reports, key
recovery and multi-user key sharing. That is a future owner decision, not something this ADR claims
the current system already provides.

## Consequences

- No production chemical/veterinary register source or continuous licensing programme is needed for
  Phases 3–4.
- Advice can be wrong when the farmer enters the label incorrectly. The UI states the source of the
  calculation and keeps inputs editable; Werf does not hide this uncertainty behind authoritative
  language.
- Existing global reference tables and legacy override fields may remain temporarily for migration
  compatibility, but current capture and UI paths do not depend on them.
- Structural validation remains strict. “Logbook, not guard dog” is not permission for cross-farm
  references, corrupt dates, invalid money or fabricated ownership.

## Revisit if

The owner chooses provider-blind end-to-end encryption · a customer explicitly buys a separate,
professionally maintained compliance product · a law imposes a reporting duty directly on Werf
rather than on the farmer · farmer research shows advisory reminders themselves are not useful.
