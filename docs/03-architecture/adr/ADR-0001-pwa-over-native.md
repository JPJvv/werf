# ADR-0001 · PWA, not native

**Status:** Accepted · **Date:** 2026-07 · **Deciders:** Tech lead

## Context

Werf must be installable on a phone, work offline, and reach ~40,000 commercial farmers with a small team. Options: native (Swift + Kotlin), cross-platform native (React Native / Flutter), or an installable PWA.

## Decision

**Installable PWA.** One codebase, one language, browser-delivered.

## Why

- **Distribution.** Play Store and App Store review add days to every release and a gatekeeper to every fix. A farmer with a broken payslip cannot wait for review. PWA ships when we ship.
- **Reach.** One codebase covers Android, iOS, and the manager's desktop. With a small team, two more codebases is not a cost, it is a decision to ship less.
- **The gap has closed.** Since Safari 16.4 (March 2023), iOS supports installable PWAs with push and OPFS. That was the last real blocker.
- **Offline is not the differentiator people think.** SQLite-over-WASM in OPFS is genuinely durable. The hard part of offline is the sync semantics, and those are identical in every option.
- **Upgrade path exists.** If we later need native, Capacitor wraps this PWA in a shell without a rewrite.

## What we give up, honestly

| Loss | Cost | Mitigation |
|---|---|---|
| iOS < 16.4 | Excludes iPhone 8/X on old iOS | Accepted. Commercial farmers replace phones. Measure it in Phase 5. |
| iOS push is weaker | Notifications less reliable than native | FR-802 is P2. Time-critical alerts also surface in-app and by SMS (Phase 7). |
| No app store presence | Lose store discovery | Our channel is farmers' days, co-ops, and word of mouth. Nobody browses the App Store for herd software. |
| Background sync limited on iOS | Sync only when the app is open | Acceptable. Farmers open the app daily. |
| Bluetooth (EID readers) | Web Bluetooth is Chrome/Android only, no iOS | FR-143 is P3, Android-only, with manual entry always present. Hardware is never a dependency (BC-5). |
| Store install friction | "Add to Home Screen" is less familiar | Guided install in onboarding (UC-001 step 7) with a *reason*, not a prompt. |

The iOS Bluetooth gap is the one that could bite. If EID reader support becomes a purchase blocker for large commercial farms, revisit with Capacitor — the PWA becomes the shell's webview and nothing is rewritten.

## Alternatives

- **React Native.** Better hardware access, real push. But: a second build pipeline, store review, and RN's offline-SQLite story is not better than what we get in the browser. The win is push and Bluetooth — both P2/P3.
- **Flutter.** Best-in-class offline. But Dart means a second language, and every Claude Code session, every hire, and every library decision gets harder. Rejected on team economics, not technology.
- **Native ×2.** Not with this team. Not ever, probably.

## Revisit if

iOS PWA install drops below 60% of iOS users · Push reliability blocks a paying customer · EID reader support blocks a large-commercial deal.
