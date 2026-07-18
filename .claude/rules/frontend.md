---
paths: ["apps/web/**", "packages/ui/**"]
---
# Frontend rules

The reference user is in a cattle crush at 2pm, in the sun, wearing gloves,
holding a phone in one hand and an animal in the other. They have four seconds.
Design for that, not for a MacBook. See docs/02-design/ux-design-system.md.

## Absolute

- Offline is the default state, not the error state. If you write
  `if (!navigator.onLine)` in a write path, that is the bug.
- Reads and writes go to local SQLite via the packages/sync adapter.
  Never import the PowerSync SDK directly — the ADR-0003 exit depends on
  application code not knowing PowerSync exists.
- Local write commits in <50ms (NFR-007). No await on network in a capture path.

## Home grid

- The home screen is a GRID of >=96px tiles, GENERATED from farm.enterprise_types.
  A static array of tiles is the bug. A cattle farm never sees a Sprays tile.
- Fixed order. NEVER personalised or reordered by usage — muscle memory is the
  entire value of the grid.
- Each tile: icon, terminology-adapted label, and ONE live number or ONE badge.
  A tile that says "HEALTH" is a menu item; "HEALTH · ● 3 due" is an instrument.
- Not a chart wall. No sparklines, no graphs, no trends. 2 cols phone, 4 desktop.

## One difficulty level

- There is no simple mode and no advanced mode. There is no easier phone version.
- Screen size changes DENSITY, never DIFFICULTY. Desktop shows more at once; it
  never asks more of you. Same vocabulary, same patterns, same components, same
  number of decisions per screen.
- A desktop table shows 40 animals instead of 8. It does not add a query builder.

## Design system

- Tokens only. No arbitrary Tailwind values — `w-[137px]` is a review rejection.
  If you need a value, add a token to packages/ui.
- NO THEME CONDITIONALS IN COMPONENTS. `theme === 'dark' ? a : b` means the token
  system failed — fix the token, not the component. Token names are stable across
  themes (--soil-900 is always "the ink"); only their values change under [data-theme].
- Theme is set by an inline script in index.html BEFORE first paint. A dark-mode
  user getting a white flash on every cold start at 5am is a real defect.
- Touch targets ≥48px, primary capture actions 64px (NFR-402). Gloves.
- Text ≥16px. Never smaller. The 14px label token is for labels only.
- Every identifier and measurement uses --font-data, tabular-nums.
  Tag numbers, weights, hectares, rands, hours. This is the signature rule.
- Tag yellow (--tag-500) is the primary action colour. ONE per screen.
  Two tag-yellow buttons on one view means one of them is wrong.
- Never encode meaning in colour alone. Blocked is red AND an octagon AND
  the word "Blocked" (NFR-411). Sun glare defeats colour.
- No gradients. No decorative shadows. Elevation is a 1px rule.
- Light AND dark, both fully supported, both audited by axe-core in CI.
- Default is LIGHT and does NOT follow prefers-color-scheme unless the user picks
  "Match my phone". This overrides a platform convention on purpose: a farmer who
  set their phone dark at night would otherwise find a mirror in their hand at noon
  in a crush, with no idea a setting caused it. Do not "fix" this.
- Earth palette: soil / sand / tag-ochre / rooigrond / klei / aloe / dam.
  Tag ochre (--ochre-500) is the PRIMARY ACTION only — one per screen. It is the
  colour of a plastic ear tag, which is that colour because it is the most visible
  thing against veld in full sun. Borrowed, not invented.
- Ochre (action) and klei (warning) are neighbouring hues. They are separated by
  FORM, not colour: actions are filled, warnings are a tinted panel with a left
  rule and an icon. Never the same shape. This is why NFR-411 exists.

## Copy

- Never say "sync" to a farmer. Say "saved" and "sent".
- "Offline — your work is saved" — this exact string is doing the most important
  job in the product. A farmer who is unsure their entry survived keeps a paper
  backup, and then the app is extra work and gets abandoned.
- Errors: what happened, why, what now. Never "Validation error".
  Always answer the next question ("so when CAN I harvest?") before it is asked.
- Actions keep their name through the flow: "Save & next" → "Saved."
- Never apologise. Never blame the network. State the situation.

## State

- TanStack Query for the API path only.
- PowerSync watched queries for the sync path.
- useState/useReducer for UI state. No global store.

## Gates

- axe-core: 0 violations (NFR-401)
- Bundle ≤250KB gz — FAILS the build (NFR-009)
- Lighthouse a11y 100, performance ≥90 on a throttled 3G Galaxy A15
