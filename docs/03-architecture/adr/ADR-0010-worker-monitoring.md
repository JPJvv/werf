# ADR-0010 · We locate work, not workers

**Status:** Accepted · **Date:** 2026-07 · **Deciders:** Tech lead, product
**Relates to:** [ADR-0001](ADR-0001-pwa-over-native.md) (PWA, not native) · [ADR-0007](ADR-0007-authentication.md) (no SMS, no biometrics posture) · FR-303, FR-331…336, FR-340…342

## Context

The request, stated plainly: workers carry farm-provided phones; can owners and managers see where they are, and get an alert when a phone leaves a perimeter?

It is a reasonable thing to ask. Farms are large, work is dispersed, theft is real, and an owner who cannot see what is happening on 2,000 hectares is managing blind. Fleet telematics vendors sell exactly this and farms buy it.

We are not building it, and this ADR records why — because the question will be asked again by the next person who joins, and by a pilot farm, and the answer needs to be a decision rather than a shrug.

## Decision

**Location is captured at a moment of work, attached to the record that work produced, and never as a continuous stream about a person.**

| We build | We do not build |
|---|---|
| GPS stamped at clock-in / clock-out (FR-303) | Continuous background location |
| GPS stamped on a task completion, spray, treatment, photo report | A live map of where staff are |
| GPS on a photo where the work record already captures location | Geofence alerts on a person leaving a perimeter |
| **Worker-initiated panic / lone-worker alert** (FR-340) | Movement history replayed for an individual |
| Geofences on **animals** and **assets** | Geofences on people |

The distinction is not cosmetic. A location fixed to an event answers *"where was this spray applied"* — a question about farming, with an auditor who wants the answer. A location stream answers *"where was Petrus at 14:20"* — a question about a person, which needs a different justification, and mostly does not have one.

## Why — three independent reasons, each sufficient on its own

### 1. The architecture forecloses it

We are a PWA ([ADR-0001](ADR-0001-pwa-over-native.md)). Browsers do not give a web app reliable background geolocation: the Geolocation API runs while the page is alive, and Android and iOS both suspend or kill it once the app is backgrounded. That ADR already concedes the weaker version of this — *"Background sync limited on iOS: sync only when the app is open"* — and background *location* is strictly harder than background *sync*.

A geofence alert that only fires when the worker happens to have the app open is not a geofence alert. It is a feature that appears to work in a demo and fails in the field, which is worse than absence because someone will rely on it.

Building it properly means Capacitor, a native shell, a second build pipeline, and app store review — the whole delivery model of the product changed for one feature. That trade might be worth making for EID reader support, which is a purchase blocker for large commercial farms. It is not worth making for this.

### 2. The law makes it hazardous, and consent does not fix it

POPIA permits processing on **legitimate interest** (s11), and current practitioner guidance is that legitimate interest — not consent — is the correct basis for most employment processing, precisely because the power imbalance in an employment relationship means consent is rarely freely given. That is the same reasoning already recorded in the exclusions table for biometric attendance, and it applies with more force to a farm worker than to an office employee.

Legitimate interest is not a free pass. It requires a documented **Legitimate Interests Assessment**: articulate the purpose, show the processing is necessary for it, and demonstrate the data subject's rights are not overridden. POPIA s10 requires minimality — processing no more intrusive than the purpose needs.

**Continuous tracking of a worker fails that balancing test in the ordinary case.** The legitimate purposes an owner actually names — was the work done, was the person on the farm, is the lone worker safe — are all served by event-stamped location, which is dramatically less intrusive. When a less intrusive means achieves the purpose, the more intrusive one is not necessary, and "not necessary" is where the assessment ends.

Two further exposures, both landing on our customer rather than us:

- **Covert monitoring is the worst version.** Monitoring an employee without informing them invites RICA problems where communications are involved, and under the LRA it colours any subsequent dismissal. Evidence gathered by surveillance the employee was never told about has cost employers CCMA cases.
- **We would be the operator.** If we build the tracking, we process the data on the farm's behalf. Their unlawful monitoring becomes our processing, our breach exposure, and our name in the Information Regulator's file.

### 3. It contradicts the product

The wedge is compliance: SIZA and GlobalGAP packs that prove a farm treats its workers correctly. **SIZA is an ethical trade standard about worker rights**, and its social standard requires — among much else — a confidential grievance mechanism.

Shipping worker surveillance inside the product whose selling proposition is *"prove you treat your people properly"* is a contradiction that a social auditor is professionally trained to notice. It also hands every competitor and every journalist the same sentence: *the farm app that tracks farm workers*. In a community where word travels faster at a Nampo stand than any marketing budget can outrun, that is not a risk we take for a feature we cannot technically deliver anyway.

## What we build instead, and why it is better

**The panic button (FR-340) is the feature this request was really reaching for.** Farm attacks are a real and specific South African risk, and a worker alone in a far camp with a phone is currently a worker alone in a far camp. A worker-initiated alert — press, and your location goes to the owner and manager now — serves safety, which is the strongest justification anyone offered for tracking in the first place.

And it inverts the power relationship. The worker decides when their location is shared. That is the difference between a tool the workforce accepts and a tool it resents and defeats, and defeated tools produce false data, which is worse than no data.

**Event-stamped location is not a consolation prize.** For every question an owner actually asked — was the spray done in the right block, was the worker on the farm at clock-in, where was this problem photographed — it is the *better* answer, because it is attached to the record the question is about and it survives in the audit trail.

## The rules

1. **No background location acquisition.** The app requests position when the user takes an action that records one. Never on a timer, never while backgrounded.
2. **No location without a record.** A GPS fix that is not attached to an attendance, task, event, or photo row is not written. There is no location table.
3. **Workers see their own captured locations**, in the same self-service view as their hours and payslips (FR-319). A monitoring system a worker cannot inspect is a covert one.
4. **Location capture is disclosed at capture**, in the worker's language, not buried in a policy signed at hire.
5. **No individual movement replay.** No screen reconstructs one person's day from their event locations. The data exists per record; the *product* does not assemble it into a track. If a feature request asks for a map of a person over time, it is this decision being relitigated.
6. **Geofences attach to animals and assets, never people.**
7. **Panic alerts are worker-initiated, always, and cannot be silently disabled by an employer** without it being visible to the worker.

Rule 5 is the one that will be pressed hardest, because the data is *there* and assembling it is easy. That is exactly why it is a written rule: the constraint is a product decision, not a technical limitation, and technical limitations are the only kind that enforce themselves.

## Alternatives considered

| Option | Why not |
|---|---|
| Full tracking with consent at hire | Consent from an employer to a farm worker is of questionable voluntariness — the settled position in this pack since the biometrics decision. A signature obtained as a condition of employment is not freely given. |
| Full tracking under legitimate interest + LIA | The LIA does not survive the necessity test when event-stamped location serves the stated purposes. We would be documenting our way to a conclusion the facts do not support. |
| Tracking during working hours only | Better, and still fails reasons 1 and 3. Also unenforceable in practice: a phone does not know when a seasonal worker's shift ended. |
| Vehicle telematics instead of phones | A different question, and a more defensible one — a bakkie is an asset. But it needs hardware (BC-5), and it becomes personal information the moment a trip is reconstructable to a driver. Out of scope for v1; revisit as an integration. |
| Ship it as opt-in, farm by farm | Opt-in by the *farmer* is not opt-in by the *worker*. This is the consent problem wearing a settings toggle. |

## Consequences

| | |
|---|---|
| ➕ | No background-location dependency, so the PWA bet holds |
| ➕ | The compliance story stays coherent — nothing in the product contradicts the SIZA pack it generates |
| ➕ | Workers have a reason to carry the phone rather than leave it in a shed |
| ➕ | The panic button is a genuine safety feature and a differentiator |
| ➖ | We will lose a deal to a competitor who ships tracking. This is accepted. |
| ➖ | "Can you track my workers" will be asked at every demo, and needs an answer that is not defensive |
| ➖ | Rule 5 must be actively defended in review, because the data makes violating it easy |

## Revisit if

The law changes materially, or a **worker representative body** asks for it — which would be a different fact pattern entirely and worth taking seriously. A farmer asking for it is not a revisit condition; it is the condition this ADR was written to answer.
