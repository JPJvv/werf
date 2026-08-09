# ADR-0007 · Passkeys and TOTP. Never SMS as a second factor.

**Status:** Partially superseded by [ADR-0011](ADR-0011-google-first-bff-authentication.md) for
primary login and browser session transport. Passkey/TOTP/recovery/no-SMS decisions remain active.
**Date:** 2026-07 · **Deciders:** Tech lead

## Context

Werf holds farm workers' ID numbers, banking details, wages, and injury records — data belonging to people who did not choose this software and cannot switch away from it ([security.md §1](../../05-operations/security.md)). It also holds a farm's animal inventory with GPS, which is a stock theft map.

The brief is "maximum modern security". The constraint is that the reference user is in a camp with no signal, wearing gloves, and a farm worker clocking in is not going to manage a passkey.

## Decision

**Passkeys (WebAuthn) preferred. TOTP as the universal fallback. SMS never used as a second factor.**

Mandatory for `owner` and `bookkeeper`. Optional for `manager`. Not applicable to `worker` (attendance is a PIN — see below).

| Factor | Role | Status |
|---|---|---|
| **Passkey (WebAuthn, platform authenticator)** | owner, bookkeeper | Preferred |
| **TOTP (RFC 6238, any authenticator app)** | owner, bookkeeper, manager | Universal fallback |
| **Recovery codes** (10, single-use, printable) | all 2FA users | Mandatory at enrolment |
| SMS OTP | — | **Registration bootstrap only. Never a second factor.** |
| Worker PIN | worker | Attendance capture only, not account auth |

## 🇿🇦 Why SMS is not a second factor — the local reason

This is the part that would get argued if it were not written down, because "just SMS them a code, every farmer has a phone" is an obvious and wrong idea.

**SIM swap fraud is endemic in South Africa.** It is not a theoretical attack here — it is an industry, and it is the standard route into South African bank accounts. The attacker port-outs the victim's number, receives the OTP, and is inside. Using SMS as the second factor on a product that holds banking details, in the country where SIM swap is most industrialised, is choosing the one factor that is locally broken.

There is a second reason, and it is the one that makes the decision easy rather than merely correct:

> **TOTP and passkeys work with no signal. SMS does not.**

TOTP is time-based — the seed is on the device, the code is computed locally, and it works in a camp with zero bars. SMS requires the exact thing our users do not have. The insecure option is *also* the one that fails in the field.

So SMS 2FA is worse on security **and** worse on usability **and** worse on our specific reference environment. There is no axis on which it wins.

SMS survives only as a **registration bootstrap** — proving control of a phone number at sign-up, before any sensitive data exists in the account. That is a weak claim being used for a weak purpose, which is fine.

## Why passkeys, given the environment

The obvious objection: passkeys are new, and this user base is not early-adopter.

But the platform authenticator on a modern Android or iPhone *is* a fingerprint sensor, and a farmer already unlocks their phone with it forty times a day. "Use this phone's fingerprint" is not a new concept to them — it is the concept they already use. The unfamiliar word is "passkey", so we do not use the word.

And the security case is real: phishing-resistant, no shared secret on our server, nothing to leak in a breach, nothing to type with gloves on.

**Constraint:** passkey *registration* needs a network round trip. Authentication against a platform authenticator does not. So enrolment happens at onboarding, in the office, online — not in a camp.

**Fallback is not optional.** Web Bluetooth-style platform gaps are real; a cheap Android may lack a usable authenticator; a farmer may use a shared office desktop. TOTP covers all of it and works everywhere.

## Why not biometrics for the worker

Already decided in [legal-compliance.md §1.3](../../00-business/legal-compliance.md) and restated here because this is where someone will propose it:

**A fingerprint scanner on the attendance tablet is the obvious feature and it is a trap.** Biometric data is special personal information under POPIA s26. Processing requires a s27 justification, and the usual one is consent — but **consent obtained from a farm worker by their employer is of questionable voluntariness given the power asymmetry.** A worker who "declines" biometric clock-in on a farm where their housing is tied to their job has not made a free choice, and the Information Regulator would be right to say so.

PIN plus optional GPS does the same job with none of that. Revisit only with a full DPIA and a genuine non-biometric alternative offered without disadvantage.

Note the asymmetry with the passkey decision: an *owner* choosing to use their own phone's fingerprint to protect their own account is free consent. A *worker* being required to fingerprint into their employer's tablet to get paid is not. Same technology, completely different consent posture. That is why one is preferred and one is refused.

## Recovery — the failure mode nobody plans for

**A farmer who loses their phone must not lose their farm.**

The scenario is concrete: one owner, one device, TOTP seed on that device, phone drowns in a dam. Without recovery, that farm's entire record system is inaccessible and we cannot help them, because the whole point is that we cannot.

| | |
|---|---|
| Recovery codes | 10, single-use, generated at enrolment, **shown once** |
| Copy | "Print these and put them in the safe." Not "screenshot these." |
| Second factor | Users are encouraged to enrol both a passkey *and* TOTP |
| Support reset | Identity verification + **48-hour delay** + email to every farm admin |

The 48-hour delay is deliberate friction. A support-channel 2FA reset with no delay is a social-engineering hole that makes the whole scheme decorative — it is how attackers bypass 2FA at most companies. Two days is long enough that a real attack is noticed and short enough that a real farmer survives it.

## Sessions, and the 30-day offline window

Unchanged from [api-specification.md §3](../api-specification.md), restated because it interacts:

- Access token: 15 min
- Refresh token: **30 days**, rotating, single-use
- 2FA is required at **login**, not at every refresh

A farmer offline for three weeks must not be locked out of their own local data. The 30-day window is the reason, and 2FA-at-login rather than 2FA-at-refresh is what makes it survivable — otherwise every reconnection after a fortnight in the veld demands an authenticator app while standing next to a broken windmill.

**And the rule that outranks all of this:** if a refresh token expires with writes in the queue, **the queue is held, not cleared** ([offline-sync.md §5](../offline-sync.md), invariant 5). Security must never be the reason a farmer's month of work is discarded. There is no version of "secure" that includes destroying user data on an auth failure.

## Consequences

| | |
|---|---|
| ➕ | Phishing-resistant primary factor |
| ➕ | **Both factors work offline** — TOTP by design, passkeys against a platform authenticator |
| ➕ | No SMS cost, no SIM-swap exposure, no SMS gateway dependency |
| ➕ | Nothing 2FA-related to steal from our database (passkeys are public keys; TOTP seeds are encrypted) |
| ➖ | Passkeys need explaining, so the copy does the work ("use this phone's fingerprint") |
| ➖ | Recovery codes get lost — hence the support path, hence the 48h delay |
| ➖ | WebAuthn is more implementation than "send an SMS" |
| ➖ | TOTP seeds must be encrypted at rest with the PII key, not the DB key |

## Revisit if

Passkey enrolment on real farms drops below ~50% of eligible users (then the copy is wrong, not the technology) · A pilot farmer is locked out despite recovery codes · Someone proposes SMS 2FA again — send them here.
