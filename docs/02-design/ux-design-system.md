# UX & Design System

---

## 1. The design thesis

**Werf is an instrument, not a dashboard.**

The reference user is standing in a cattle crush at two in the afternoon in the Free State. The sun is directly overhead. They are wearing gloves. They have a phone in one hand and an animal in front of them that would like to leave. They have four seconds.

Every decision follows from that scene. Not from what agtech SaaS looks like on Dribbble.

The visual reference is the **stock card**: the printed record hanging in the dairy, the dip register, the movement book. Hard rules, high contrast, tabular numerals, no ornament. Those artifacts survived a century of farm use because they work in exactly these conditions. We are building the digital version of something that already works.

### Three principles that govern everything below

**1. One difficulty level: easy.** There is no simple mode and no advanced mode. There is no "phone version" that is easier than the "desktop version". A bookkeeper running payroll at a desk deserves the same clarity as a herdsman in the crush. Complexity on a large screen is not a feature — it is complexity we allowed because the screen was big enough to hide it in.

Screen size changes **density**, never **difficulty**. Desktop shows more at once; it never asks more of you. Same words, same patterns, same directness, everywhere.

**2. The home screen is a grid of doors, not a wall of charts.** Six to eight large tiles. Each is a place to go, and each tells you whether you need to go there. A farmer should never have to learn a navigation structure — they should see the whole product at once and touch the part they want.

**3. Legible in the sun and legible at night.** Both themes, no compromise on either.

---

## 2. Colour — South African earth

The palette is drawn from the ground the product is used on: Highveld winter grass, the iron-red soil of the Bushveld, Kalahari sand, aloe, weathered steel, the water in the dam.

### The one risk we take

**The primary action colour is tag ochre** — the colour of a plastic cattle ear tag.

Ear tags are that specific saturated ochre for one reason: it is the most visible colour against veld, hide, and dust, at distance, in full sun. A century of livestock practice converged on it as the solution to *exactly the visibility problem we have*. Using it as the primary action colour is not decoration — it is borrowing a solved problem, and it happens to be an earth pigment.

> **Rejected on the way here:** the warm-cream-and-terracotta palette a design tool produces when you type "farm app"; the sage-green agtech default all twelve competitors already use; and dark-with-neon-accent, which is unreadable in sunlight. Earth does not mean Tuscan. It means *this* ground.

### 2.1 Light — "Veld"

```css
:root, [data-theme="light"] {
  /* Soil — the ink. Warm-shifted, never pure #000 (harsh under glare) */
  --soil-900: #23190F;   /* primary text        ~17.9:1 on sand-50 */
  --soil-700: #4A3A28;   /* secondary text       ~9.2:1 */
  --soil-500: #7A6952;   /* tertiary, disabled   ~4.6:1 */
  --soil-300: #B3A48C;   /* placeholder */
  --soil-200: #D9CFBC;   /* rules, borders */
  --soil-100: #EDE6DA;   /* fills, zebra rows */

  /* Sand — the working surface. Warm, but light enough to stay a surface */
  --sand-50:  #FBF8F3;   /* paper */
  --sand-100: #F3EEE4;   /* raised, tiles */

  /* Tag ochre — the signature. PRIMARY ACTION ONLY. Never decorative. */
  --ochre-500: #D99A2B;  /* primary action     soil-900 on this ~8.9:1 */
  --ochre-600: #B87F1C;  /* pressed */
  --ochre-100: #FAEFD6;  /* selected row */

  /* Semantics — earth-derived, still high-chroma enough to alarm */
  --rooigrond-600: #A63A21;  /* blocked      (Bushveld iron soil)  ~6.1:1 */
  --rooigrond-100: #F7E5DF;
  --klei-700:      #8A5A16;  /* warning      (wet clay)            ~5.6:1 */
  --klei-100:      #FBF0DC;
  --aloe-700:      #3F5A32;  /* clear, compliant                   ~7.4:1 */
  --aloe-100:      #E8EFE3;
  --dam-700:       #2C4A63;  /* pending, syncing  (the farm dam)   ~9.1:1 */
  --dam-100:       #E4EBF1;
}
```

### 2.2 Dark — "Kraal"

Designed, not inverted. Inverting a light palette produces grey mush; a kraal wall at night is warm, not grey.

```css
[data-theme="dark"] {
  --sand-50:  #16110A;   /* surface — warm near-black */
  --sand-100: #1F1810;   /* raised, tiles */
  --soil-100: #2A2118;   /* fills */
  --soil-200: #3D3225;   /* rules */
  --soil-300: #7A6952;   /* placeholder */
  --soil-500: #B3A48C;   /* tertiary            ~4.8:1 on surface */
  --soil-700: #D2C7B4;   /* secondary          ~10.1:1 */
  --soil-900: #EDE6DA;   /* primary text       ~14.8:1 */

  /* Lifted — #D99A2B on a dark surface reads dim and muddy */
  --ochre-500: #E8B34F;  /* primary action     ~10.2:1; text on it = #16110A */
  --ochre-600: #D99A2B;  /* pressed */
  --ochre-100: #33260D;  /* selected row */

  --rooigrond-600: #E07A5F;  /* blocked          ~7.2:1 */
  --rooigrond-100: #3A1A12;
  --klei-700:      #C98A3A;  /* warning          ~6.9:1 */
  --klei-100:      #302108;
  --aloe-700:      #7FA36B;  /* clear            ~7.1:1 */
  --aloe-100:      #1D2A17;
  --dam-700:       #6B9BC4;  /* pending          ~7.8:1 */
  --dam-100:       #16232E;
}
```

**Token names are stable across themes.** `--soil-900` is always "the ink", light or dark. Components never branch on theme. If you write `theme === 'dark' ? x : y` in a component, the token system has failed and the fix is a token, not a conditional.

> Contrast figures above are design targets computed from the hexes. **`axe-core` is the arbiter** — if a pair fails in CI, the token moves. Do not argue with the checker.

### 2.3 Theme selection

```
Settings → Appearance
  ● Light          ← default
  ○ Dark
  ○ Match my phone
```

**Default is light, and it does not follow `prefers-color-scheme` unless the user asks it to.**

This is the one place we deliberately override a platform convention, and it needs the reason stated or someone will "fix" it. A farmer sets their phone to dark at night. At noon the next day they are in a crush, and a dark surface under direct sun becomes a mirror — they see their own face, not the weight field. Following the system preference silently produces exactly that, and the user has no idea a setting caused it.

So: explicit choice, light default, "Match my phone" for anyone who wants it. Dark mode is fully supported everywhere — the bookkeeper at 9pm, photosensitivity, migraine, preference. We just do not switch it on for you.

### 2.4 Colour rules

- **Never encode meaning in colour alone** (NFR-411). Blocked is `--rooigrond-600` **and** an octagon **and** the word "Blocked". Colour-blindness, sun glare, and cheap screens each defeat colour-only signalling independently.
- **Tag ochre is reserved for the primary action.** One per screen. Two ochre buttons in one view means one is wrong.
- **No gradients. No decorative shadows.** Elevation is a 1px `--soil-200` rule. Shadows are invisible in sunlight; rules are not.
- **Known tension, named:** ochre (action) and klei (warning) are neighbours on the wheel. They are separated by **form**, not hue — actions are *filled*; warnings are a *tinted panel with a left rule and an icon*. They never appear in the same shape. This is precisely why NFR-411 exists.

---

## 3. Type

```css
:root {
  --font-ui:   'Inter Tight', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-data: 'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace;
}
```

**The rule that carries the personality:**

> **Every identifier and every measurement is set in `--font-data`, tabular.**
> Tag numbers, EIDs, brand marks, weights, hectares, rands, hours, dates.

Not a stylistic tic. A farmer scanning a column of weights is doing a *comparison*, and proportional numerals defeat comparison — the digits do not line up, so the eye cannot find the outlier. A tag number is read as a *pattern*, not a word. This is how stock cards work, and it is why they work.

```css
.data { font-family: var(--font-data); font-variant-numeric: tabular-nums; }
```

**Scale** — 16px floor, no exceptions (NFR-408):

| Token | Size / line | Weight | Use |
|---|---|---|---|
| `--t-display` | 32/38 | 600 | The one number on a screen that matters |
| `--t-h1` | 24/30 | 600 | Screen title |
| `--t-h2` | 20/26 | 600 | Section |
| `--t-body` | 16/24 | 400 | Everything |
| `--t-body-strong` | 16/24 | 600 | Emphasis |
| `--t-label` | 14/18 | 600, +0.04em, caps | Field labels only |
| `--t-tile` | 18/22 | 600 | Grid tile labels |
| `--t-data-lg` | 28/32 | 500, tabular | The weight you just entered |
| `--t-data` | 16/24 | 400, tabular | Tags, IDs, money in tables |

`--t-label` at 14px is the smallest type in the system, used only for labels sitting directly above the thing they name. Nothing a user must *read* is below 16px.

---

## 4. Space & size

4px base. `--s-1: 4px` … `--s-8: 48px`, `--s-10: 64px`, `--s-12: 96px`.

| Token | Value | Rule |
|---|---|---|
| `--touch-min` | **48px** | Floor for any interactive element (NFR-402) |
| `--touch-primary` | **64px** | Primary capture actions. Gloves. |
| `--tile-min` | **96px** | Grid tiles. Well above the floor, on purpose. |
| `--radius` | 4px | One radius. Everything. |
| `--rule` | 1px solid var(--soil-200) | The only separator |
| `--thumb-zone` | bottom 33vh | Primary actions live here |

### Motion

```css
--ease: cubic-bezier(0.2, 0, 0, 1);
--dur-fast: 120ms;   /* state change */
--dur-base: 200ms;   /* transition */
```

State feedback only — a write committed, a sync completed. Never page entry, never delight. It costs frames on a Galaxy A15, and a person capturing their 140th weight of the afternoon does not want to be delighted; they want to be finished.

`prefers-reduced-motion: reduce` disables all of it. Non-negotiable.

---

## 5. The home grid

**The home screen is a grid of tiles. It is the whole product, visible at once.**

```
┌──────────────────────────────┐
│ ⌁ Offline — your work is saved│  ← sync strip, 32px, never modal
├──────────────────────────────┤
│  Rietfontein          ☀ 28°  │
├───────────────┬──────────────┤
│               │              │
│      🐄       │      🌾      │
│     HERD      │    BLOCKS    │
│      412      │      8       │
│               │              │
├───────────────┼──────────────┤
│               │              │
│      ⚕        │      👥      │
│    HEALTH     │    LABOUR    │
│    ● 3 due    │      23      │
│               │              │
├───────────────┼──────────────┤
│               │              │
│      R        │      ✓       │
│     MONEY     │  COMPLIANCE  │
│               │  ● 2 to fix  │
│               │              │
└───────────────┴──────────────┘
```

| | |
|---|---|
| Columns | 2 phone · 3 tablet · 4 desktop |
| Tile | ≥96px tall, `--radius`, 1px rule, `--sand-100` fill |
| Contents | icon · label (`--t-tile`) · one live number **or** one badge |
| Badge | `--rooigrond-600` dot + count, when the tile needs attention |
| Order | Fixed per enterprise type. **Never personalised, never reordered by usage.** |
| Max | 8. Beyond that, "More" absorbs the tail. |

### Why a grid and not a nav bar

A nav bar teaches you a structure. A grid shows you the product. For a user with low digital literacy, in gloves, in the sun, six large labelled doors beat a five-item bar plus a hamburger — because there is nothing to learn and nothing hidden.

**Order is fixed, never adaptive.** Muscle memory is the entire value. A tile that moves because an algorithm decided you use Labour more this month has destroyed the one thing the grid was for.

### Why the tiles carry numbers

**This is where "instrument, not dashboard" survives the grid.** A tile that says `HEALTH` is a menu item. A tile that says `HEALTH · ● 3 due` is an instrument reading — it answers *"do I need to go in there?"* without going in there. The grid is not a launcher with decoration; it is a status board where every cell is also a door.

**It is not a chart wall.** No sparklines, no graphs, no trends. One number or one badge. If a farmer wants analysis they open the module; the home screen's job is to route them in under two seconds.

### 🚨 The grid IS the enterprise adaptation

Tiles are **generated from `farm.enterprise_types`** ([FR-002](../01-requirements/functional-requirements.md), [SRS-1–4](../01-requirements/SRS.md)). This is the most visible expression of the product's central promise, and it is the first thing a farmer sees.

| Enterprise types | Tiles |
|---|---|
| Beef cattle | Herd · Camps · Health · Labour · Money · Compliance |
| Vineyards | Blocks · Sprays · Harvest · Labour · Money · Compliance |
| Beef + Maize | Herd · Blocks · Health · Sprays · Labour · Money · Compliance |
| Sheep + Goats | Flock · Camps · Health · Labour · Money · Compliance |

**A cattle farmer never sees a Sprays tile. Ever.** A vineyard owner never sees Herd. The word is "camp" for cattle and "block" for vines, from the terminology table — never hardcoded.

If you find yourself writing a static array of tiles, stop. That array is the bug.

---

## 6. Components that carry the product

### 6.1 Capture Card

The atomic unit. One entity, one screen, one decision.

```
┌───────────────────────────────┐
│ ┌───┐  COW-0142               │  ← --t-data, the identifier
│ │📷 │  Bonsmara · Cow · 6y    │  ← --t-body, --soil-700
│ └───┘  Camp 3 · 412kg         │
├───────────────────────────────┤
│  WEIGHT (KG)                  │  ← --t-label
│  ┌─────────────────────────┐  │
│  │ 418                     │  │  ← --t-data-lg, focused, keypad
│  └─────────────────────────┘  │
│  Last: 412kg · 14 Mar · +0.4  │  ← context that prevents errors
├───────────────────────────────┤
│  ┏━━━━━━━━━━━━━━━━━━━━━━━━━┓  │
│  ┃     Save & next  →      ┃  │  ← 64px, --ochre-500
│  ┗━━━━━━━━━━━━━━━━━━━━━━━━━┛  │
│         Skip this one         │
└───────────────────────────────┘
```

`Last: 412kg · 14 Mar · +0.4/day` is the most important line on this card. It is the context that lets a person notice 4180 is wrong *before* they save it. Validation catches errors; context prevents them.

### 6.2 Sync strip

Persistent, 32px, top. **Never modal, never blocking** (SRS-7).

| State | Appearance |
|---|---|
| Synced | `--aloe-100` · ✓ · "Synced 2 min ago" |
| Pending | `--dam-100` · ↑ · "3 to send" |
| Syncing | `--dam-100` · animated ↑ · "Sending 2 of 3" |
| Offline | `--soil-100` · ⌁ · **"Offline — your work is saved"** |
| Error | `--klei-100` · ! · "2 need attention" → tappable |

**The offline copy matters more than the icon.** "Offline — your work is saved" does the single most important job in this product: it tells a person the thing they just did is not lost. "No connection" would be accurate and would cause a farmer to write it on paper as well — and the moment they keep a paper backup, the app is extra work and will be abandoned, correctly.

### 6.3 Compliance banner

Above the content it concerns. Never a toast — toasts disappear and this must not.

```
┌───────────────────────────────────────┐
│ ⛔ BLOCKED                            │  ← rooigrond rule + icon + word
│ Harvest is inside the withholding     │
│ period for Dithane M-45.              │
│ Sprayed 1 Mar · 21-day PHI            │
│ Earliest safe harvest: 22 Mar         │
│                                       │
│ [ Override with reason ]              │  ← outline, not filled
└───────────────────────────────────────┘
```

Structure, always: **what happened · why · what now.** Never "Validation error". Name the product, the date, the rule, and the earliest date this becomes possible. The user's next question is always *"so when can I?"* — answer it before they ask.

### 6.4 Warning list (pre-approval)

Payroll's most important screen. Warnings **above** the numbers, never below, never collapsed.

```
┌───────────────────────────────────────┐
│  Before you approve — 3 things        │
├───────────────────────────────────────┤
│ ⚠ Thabo M · piece rate topped up      │
│   R160 earned → R241.84 minimum       │
│   +R81.84                       [Why?]│
├───────────────────────────────────────┤
│ ⚠ Maria S · overtime over the limit   │
│   14h worked, 10h is the weekly cap   │
│   Paid in full. Fix the roster. [Why?]│
├───────────────────────────────────────┤
│ ⛔ Sipho N · deductions too high      │
│   Net would fall below the minimum.   │
│   You cannot approve until this is    │
│   fixed.                     [Fix now]│
└───────────────────────────────────────┘
        ┏━━━━━━━━━━━━━━━━━━━━━━━┓
        ┃  Approve — R48,204.11 ┃   ← disabled while any ⛔ exists
        ┗━━━━━━━━━━━━━━━━━━━━━━━┛
```

Note the difference in voice between ⚠ and ⛔. The warning says what happened and that it is handled. The block says you cannot proceed, and gives you the door.

### 6.5 Two-factor prompts

2FA is mandatory for owner and bookkeeper ([security.md §3.5](../05-operations/security.md), [ADR-0007](../03-architecture/adr/ADR-0007-authentication.md)). It must not feel like a punishment.

```
┌───────────────────────────────────────┐
│  Protect the money                    │
│                                       │
│  You can see wages and bank details.  │
│  Add a second lock so a stolen        │
│  password isn't enough.               │
│                                       │
│  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓  │
│  ┃  Use this phone's fingerprint  ┃  │  ← passkey, preferred
│  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛  │
│  [ Use an authenticator app ]         │  ← TOTP
│                                       │
│  Both work with no signal.            │
└───────────────────────────────────────┘
```

**"Both work with no signal" is the line that gets it accepted.** A farmer's objection to 2FA is "what happens in the veld" — answer it in the prompt. Recovery codes are shown once, printable, and the copy says put them in the safe, not screenshot them.

---

## 7. Layout

### 7.1 The thumb zone

```
┌─────────────────────────┐
│ ▓▓ Sync ▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │  ← status, 32px, never modal
├─────────────────────────┤
│                         │
│      CONTEXT            │  ← what am I looking at
│      (read)             │
├─────────────────────────┤
│      INPUT              │  ← the field, focused, large
├─────────────────────────┤
│  ┏━━━━━━━━━━━━━━━━━━━┓  │  ← thumb zone, bottom third
│  ┃  PRIMARY ACTION   ┃  │     64px, full width, ochre
│  ┗━━━━━━━━━━━━━━━━━━━┛  │
│  [secondary]  [cancel]  │
└─────────────────────────┘
```

Primary actions live in the bottom third because that is where a thumb reaches on a 6.5" phone held one-handed. Measure it on the device; it is not a preference.

### 7.2 Density, not difficulty

| | Phone (<768px) | Desktop (≥1024px) |
|---|---|---|
| Home | 2-column grid | 4-column grid |
| Lists | Cards, one per row | Table, sortable |
| Capture | One field per screen | Same form, two columns |
| Primary action | Bottom, 64px | Top-right, 48px |
| Navigation | Grid + back | Grid + persistent sidebar |

**What does not change:** the vocabulary, the patterns, the components, the copy, the number of decisions per screen, or how much you have to know.

A desktop table shows forty animals instead of eight. It does not introduce a query builder. Tablet (768–1023px) uses the phone layout at three columns — a tablet in a bakkie is a big phone, not a small desktop.

---

## 8. Voice

Werf speaks like a competent colleague at the crush: plain, direct, no apology, no cheer.

| Don't | Do |
|---|---|
| "Oops! Something went wrong 😅" | "Couldn't save. Your entry is still here. Try again." |
| "Validation Error: PHI constraint violated" | "Can't harvest yet — sprayed 1 March, 21-day interval. Safe from 22 March." |
| "Submit" | "Save & next" |
| "No data available" | "No animals in Camp 3 yet. [Add one]" |
| "Are you sure?" | "Delete COW-0142's weight from 14 March?" |
| "Sync failed" | "2 records need attention. [Review]" |
| "Success!" | "Saved." |
| "Enable 2FA for enhanced security" | "Add a second lock so a stolen password isn't enough." |

**Rules:**
- An action keeps its name through the whole flow. The button says "Save & next"; the toast says "Saved."
- Errors never apologise and are never vague. What happened, why, what now.
- An empty screen is an invitation, with the action in it.
- Never blame the user. Never blame the network. State the situation.
- **Never say "sync" to a farmer.** Say "sent" and "saved". "Sync" is our word for our problem; *"is my work safe?"* is their question.

---

## 9. Accessibility = field-readiness

The same requirement arriving from two directions.

| WCAG says | The crush says | Threshold |
|---|---|---|
| Contrast 4.5:1 | Sun glare | 4.5:1 min, 7:1 critical — **in both themes** |
| Targets ≥ 24px | Gloves | **48px**, 64px primary, 96px tiles |
| Don't rely on colour | Cheap screen, glare | Icon + text + colour, always |
| Keyboard navigable | Office user, no mouse | Full tab order |
| Reduced motion | Cheap CPU | Honoured |
| Text ≥ 16px | Bifocals, dust, distance | 16px floor |

Building for a person with low vision and building for a person in direct sunlight produce the same interface. Which is why NFR-401 is not a compliance chore — it is the field requirement in different words.

**Both themes are audited.** A dark palette that passes on a designer's monitor and fails at 3.9:1 on a Galaxy A15 has failed. `axe-core` runs against both, in CI.

---

## 10. Screen inventory (v1)

**Home:** the grid (enterprise-adaptive)

**Capture:** Herd/Flock list · Animal detail · Birth · Death · Treatment · Weight · Weigh session · Move · Sale · Mob detail · Camp list/detail · Block list/detail · Spray · Harvest · Tasks · Attendance · Piece work · Search · Sync review

**Office:** Herd table · Breeding · Health · Blocks · Sprays · Employees · Attendance · **Payroll run** · Leave · Finance · Enterprise P&L · Inventory · Equipment · **Compliance** (Animal ID · Stock theft · GlobalGAP · SIZA · Obligations) · Reports · Users · Farm settings · Regulatory rates admin

**Shared:** Login · **2FA enrol / verify / recovery codes** · Onboarding (5 steps) · **Settings → Appearance** · Empty states · Error states · Offline states

---

## 11. Implementation

- React + Tailwind, **core utilities only**. Tokens in `@werf/ui` as a Tailwind theme extension, emitted as CSS custom properties scoped to `[data-theme]`.
- **No arbitrary values.** `w-[137px]` is a review rejection. If you need a value, add a token.
- **No theme conditionals in components.** `theme === 'dark' ? a : b` means the token system failed. Fix the token.
- Theme applied via `data-theme` on `<html>`, persisted locally, **set by an inline script in `index.html` before first paint** — otherwise a dark-mode user gets a white flash on every cold start, which at 5am is genuinely unpleasant.
- Components in `@werf/ui`. Storybook. Visual regression **in both themes**.
- `axe-core` in CI, zero violations, **both themes** (NFR-401).
- Lint rule: interactive element below 48px fails.

See [frontend rules](../../.claude/rules/frontend.md) for the enforced version of this document.
