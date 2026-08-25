# Luminary Design Language, adapted for the Console

Draft extracted on 2026-08-26 from `luminary-landing-page/app/globals.css` (2,754
lines, the identity source of truth) and compared against the console's current
`app/globals.css` (420 lines, which already inherits the core palette). This document
records the shared identity, then the adaptation rules that make it work for a dense
internal tool used for hours at a stretch. The exported token package
(`packages/design-tokens` or this repo's equivalent) is Phase 2 work; values below are
its contract.

## 1. Identity in one paragraph

Luminary is near-black and paper-white surfaces, one saturated lime accent used
sparingly and always as meaning (status, action, focus), JetBrains Mono for anything
data-like, Outfit for everything else, hairline alpha borders instead of filled
dividers, pill radii on controls and large soft radii on cards, and motion that is
quick, eased-out, and always explains something. Dark mode is the primary mood; light
mode is a true sibling, not an afterthought.

## 2. Color

Source of truth is hex; OKLCH given for ramp construction. The accent brightens in
dark mode instead of staying constant, and text-on-accent flips via `--on-accent`.

### Core, light

| Token | Hex | OKLCH |
| --- | --- | --- |
| `--bg` | `#ffffff` | `oklch(100% 0 0)` |
| `--off` (raised surface) | `#f7f7f5` | `oklch(97.6% 0.003 106.4)` |
| `--desk` (console page ground) | `#f0f0ee` | `oklch(95.5% 0.003 106.4)` |
| `--text` | `#0d0d0f` | `oklch(16.0% 0.004 285.9)` |
| `--muted` | `#6b7280` | `oklch(55.1% 0.023 264.4)` |
| `--subtle` | `#c4c4c8` | `oklch(82.2% 0.006 286.3)` |
| `--accent` | `#84cc16` | `oklch(76.8% 0.204 130.8)` |
| `--a-text` (accent as text on bg) | `#5a9e08` | `oklch(62.9% 0.176 133.4)` |
| `--a-dim` | `rgba(132,204,22,.09)` | accent at 9% |
| `--a-border` | `rgba(132,204,22,.28)` | accent at 28% |
| `--border` | `rgba(0,0,0,.07)` (landing) / `.09` (console) | hairline |
| `--border-hi` | `rgba(0,0,0,.13)` / `.14` | hover or emphasis hairline |
| `--danger` (console only) | `#dc2626` | `oklch(57.7% 0.215 27.3)` |
| `--on-accent` | `#0d0d0f` | text and icons on accent fills |

### Core, dark

| Token | Hex | OKLCH |
| --- | --- | --- |
| `--bg` | `#0b0b0d` | `oklch(15.1% 0.004 285.9)` |
| `--off` | `#111113` (landing) / `#141416` (console) | `oklch(17.9%–19.2%)` |
| `--desk` | `#050506` | `oklch(11.6% 0.003 285.9)` |
| `--text` | `#f4f4f5` | `oklch(96.7% 0.001 286.4)` |
| `--muted` | `#71717a` (landing) / `#8a8a92` (console) | see adaptation rule 6.2 |
| `--subtle` | `#3f3f46` | `oklch(37.0% 0.012 285.8)` |
| `--accent` | `#a3e635` | `oklch(84.9% 0.207 128.8)` |
| `--a-text` | `#a3e635` | accent doubles as text in dark |
| `--a-dim` | `rgba(163,230,53,.08)` | |
| `--a-border` | `rgba(163,230,53,.2)` | |
| `--border` | `rgba(255,255,255,.06)` / `.09` | |
| `--border-hi` | `rgba(255,255,255,.11)` / `.16` | |
| `--danger` | `#f87171` | `oklch(71.1% 0.166 22.2)` |

### Accent system

The landing page ships ten visitor-selectable accents (`lime` default, `violet`,
`cyan`, `ember`, `magenta`, `azure`, `gold`, `mint`, `maroon`, `silver`), each defined
as a quadruple per theme: `--accent`, `--a-text`, `--a-dim`, `--a-border`, plus
`--particle` (the accent's `r,g,b` triplet for rgba glows) and `--on-accent` overrides
for the two deep accents. Rule: light mode uses a deeper accent readable on white,
dark mode a brighter one readable on near-black. The console keeps lime as its fixed
identity; the accent-picker stays a landing-page feature.

### Status language (console addition, colorblind-safe rule)

Status is never hue alone: every status pairing is dot plus label text. Green/lime is
"live, published, paid, passing"; `--muted` is "draft, idle"; `--danger` is
"destructive, failed, overdue". Any new status color must also work as its label text
at AA contrast on both `--bg` values.

## 3. Typography

- Sans: **Outfit** (`--font-outfit`, next/font, swap). Weights in use: 500, 700, 800.
  Tight tracking at display sizes (`-.03em` to `-.05em`).
- Mono: **JetBrains Mono** (`--font-jetbrains-mono`) for code, document numbers,
  timestamps, table headers, meta rows, kbd hints. Mono at small sizes carries
  letterspacing (`.02em` to `.14em`) and frequently uppercase.
- Landing display scale (for reference): hero `clamp(3rem, 6.5vw, 6.25rem)/800`,
  section `clamp(2rem, 4vw, 3.25rem)/700`, card titles `1.1–1.2rem/700`, body
  `.875–1.05rem`, meta `.66–.82rem` mono.
- Console scale (adaptation): page title 1.25rem/800, card title 1rem/700, body
  .875rem, table cells .82rem, meta and labels .68–.72rem mono uppercase. Nothing in
  the console shell exceeds 1.5rem; density comes from the type scale first.

## 4. Shape, depth, glass

- Radius: landing `--r: 1.5rem` on cards; console `--r: 18px`. Controls and chips are
  full pills (`border-radius: 100px`). Inputs and small controls 5 to 9px.
- Borders do the separating; shadows are a light-mode-only whisper:
  `--sh: 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04)`,
  `--sh-md: 0 4px 20px rgba(0,0,0,.08), 0 2px 6px rgba(0,0,0,.04)`. Dark mode sets
  both to `none` and relies on surface steps (`--desk` under `--bg` under `--off`).
- Glass: nav and popovers use gradient-tinted panes of `--bg` via `color-mix`
  (40 to 56% opacity) with `backdrop-filter: blur(22px) saturate(1.7)`; the glass edge
  is an inset highlight (`inset 0 -1px 0 rgba(255,255,255,.08)`), not a border.
  Overlays: `rgba(10,10,12,.55)` plus `blur(6px)`.
- Glows are always the accent triplet at low alpha: hover
  `0 6px 20px rgba(var(--particle),.3)`, breathing glows animate box-shadow between
  `.3` and `.7` alpha. The console restricts glows to primary CTAs and live status.

## 5. Motion

- Signature easing: `--ease: cubic-bezier(0.16, 1, 0.3, 1)` (strong ease-out). Springy
  moments (theme knob, swatch pop-in) use `cubic-bezier(.34, 1.56, .64, 1)` or
  `cubic-bezier(0.85, 0.05, 0.18, 1.35)`.
- Durations: color and theme transitions .28s; hovers .2 to .25s; entrances .42 to
  .5s on the landing page. Console rule: nothing in the shell over 200ms, entrances
  .16 to .2s, transform and opacity only.
- Patterns worth keeping in the console: page enter (8px rise plus fade), staggered
  child entrances (`calc(var(--i) * 40ms)`), View Transitions for route changes,
  pulse-ring on live dots, blinking caret in terminal contexts.
- `prefers-reduced-motion` fully honored: the landing page disables the loader,
  scroll-driven motion, and orbits under reduce; the console must do the same for
  everything it adds.

## 6. Adaptation rules: marketing site to console

1. **Contrast inversion of attention.** The landing page spends contrast on display
   type; the console spends it on data and status. Large surfaces drop contrast
   (dark `--desk #050506` ground with `#0b0b0d` cards), while data text, statuses,
   and numbers hold full `--text` contrast.
2. **Muted got brighter on purpose.** Console dark `--muted` is `#8a8a92` versus the
   landing's `#71717a` because long-session reading of secondary text needs more
   contrast than marketing captions. Keep the console value; never ship `#71717a` on
   `#0b0b0d` for anything the operator must actually read (it is under 4.5:1).
3. **Tighter rhythm.** Landing sections breathe at `8rem`; console cards stack at
   1 to 1.5rem gaps with 1.1 to 1.5rem internal padding. Vertical rhythm inside
   tables: rows 40 to 44px comfortable, 32 to 36px compact.
4. **Type scale shrinks two steps** (see section 3). Mono expands its role: any
   identifier, count, timestamp, or key-value readout is mono.
5. **Motion budget shrinks.** No scroll-driven effects, no particles, no scramble,
   no splash loader in the console. Keep: eased entrances under 200ms, status pulse,
   command palette pop, View Transitions on route change.
6. **Accent discipline.** On the landing page the accent decorates; in the console it
   may only mean something: primary action, live or published state, focus, active
   filter. Decorative accent usage is a review-blocker.
7. **11pm test.** Dark is the default working theme; every new surface is checked at
   full-screen dark for glare (no pure-white fills above 100px square) and in light
   for washout (hairline borders must survive `#f7f7f5` on `#ffffff`).
8. **Focus rings** are the accent, 2px, offset 3px, radius 6px, on `:focus-visible`
   everywhere, same as the landing page.

## 7. Voice

Sentence case everywhere, including buttons and table headers rendered small-caps via
CSS rather than typed uppercase. Copy is direct and specific: "Publish to
eco-mech.luminary-dev.xyz", not "Are you sure?". Empty states name the first action.
Errors say what happened and what to do next. No exclamation marks, no emojis, no em
dashes; commas, colons, and full stops.

## 8. Current console deltas to reconcile (feeds the findings register)

- The console defines only 13 tokens; spacing, type sizes, durations, and easing are
  hardcoded per rule. The token package should export the full set above as CSS
  custom properties, a TypeScript object, a Tailwind preset, and a shadcn theme.
- Landing `--ease` exists but the console redefines transitions ad hoc.
- Table header contrast currently fails AA in dark mode (Lighthouse baseline,
  `docs/audit/BASELINE.md`); resolve against rule 6.2.
- `--on-accent` does not exist in the console; accent-filled buttons hardcode dark
  text, which is correct for lime but breaks the invariant if the accent ever changes.
