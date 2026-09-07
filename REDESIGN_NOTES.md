# Redesign notes: the workshop console

The console was re-skinned from its clean-minimal look into a comic-editorial
"lamp-lit repair workshop" aesthetic, with a Daylight / Paper light mode and a
Workshop Night dark mode. This is a theming pass. No business logic, route,
API or data shape changed. This file records where the system lives, what
was deliberately done differently from the brief, and what was checked.

## Where the design system lives

| Piece | Location |
| --- | --- |
| Tokens, both palettes, legacy aliases | `app/globals.css`, the two blocks at the top (`:root`, `html[data-theme="dark"]`) |
| Grain overlay and lamp vignette | `body::before` / `body::after` in `app/globals.css` (no markup) |
| Type: Anton display, Outfit body, JetBrains Mono, Unkempt hand | `app/layout.tsx` via `next/font` (self-hosted; the CSP blocks font CDNs) |
| Panel (`.card`), hero panel (`.panel--hero`), sticker button (`.btn`), lamp toggle (`.theme-toggle`), status stickers (`.pill`, `.pill.amber`, `.pill.coral`) | `app/globals.css`, re-skinned in place |
| Eyebrow + title block, illustrated header | `components/PageHead.tsx`, `.page-head*` and `.eyebrow` |
| Speech bubble | `.bubble`, `.bubble--left/right/bottom`, `.bubble--hand` |
| Empty state with mascot | `components/EmptyState.tsx` |
| Theme-aware picture | `components/Illustration.tsx`, `.illo--light/.illo--dark` |
| Illustration manifest and asset map | `lib/illustrations/image-prompts.ts`, `lib/illustrations/assets.ts` |
| Generation script | `scripts/generate-illustrations.ts` (`OPENAI_API_KEY` from the environment only) |
| 404 | `app/not-found.tsx` |
| Contrast guard | `tests/tokens-contrast.test.ts` |
| Gating of the pictures | `proxy.ts` (auth backdrop public, everything else gated), `tests/interaction/gating.spec.ts` |

The GitHub screens keep their own two stylesheets (`components/github/*.css`);
both were re-pointed at the new tokens and given the display face, shimmer
skeletons and the amber "running" state.

## Deviations from the brief, and why

1. **Text colours were deepened for WCAG AA.** Four of the brief's values do
   not reach 4.5:1 on paper: `--muted #8B8474` (3.5:1), the lime `#6FA80B`
   as text (2.7:1), coral `#D8551F` as text (3.8:1) and amber `#CF8A0F` as
   text (2.7:1). The brief's values are kept for fills, borders and dots,
   where contrast rules do not apply, and separate text tokens carry the
   readable forms: `--muted #5B5648`, `--a-text #3A6A06`, `--danger #A83C15`,
   `--amber-text #8A5A05`. `tests/tokens-contrast.test.ts` computes every
   text-on-surface pair from the stylesheet, including tinted surfaces, and
   fails under 4.5:1. 71 pairs pass in each palette.
2. **Legacy token names stay as aliases.** 36 components carry
   `var(--muted)`, `var(--text)`, `var(--border)` and friends in inline
   styles. Rather than rewrite them, `--text`, `--desk`, `--off`, `--border`,
   `--border-hi`, `--accent` and `--label` alias the new names. New CSS uses
   the new names. The contrast test asserts the aliases survive.
3. **The manifest lives in `lib/illustrations/`, and outputs go to
   `public/illustrations/`.** This repo has no `src/`, and a picture has to
   be under `public/` to be served. The manifest's `out` paths were changed
   accordingly; nothing else in it was touched.
4. **PNG masters are not committed.** Eighteen masters at 2 to 3 MB each is
   36 MB of repository for files nothing loads. The WebP variants the pages
   use (768/1536 for wide art, 512/1024 for spot art, about 5 MB in total)
   are committed; `public/illustrations/*.png` is gitignored. The 1536 and
   1024 variants are already full resolution, so a re-encode at a new width
   can read them; a genuinely new drawing is `--only <id>` or `--force`.
5. **The pictures are gated, except the sign-in backdrop.** Following
   `docs/adr/0003-the-comic-is-private.md`, illustrations sit behind the
   session gate and are served by a plain `<img>` with a pre-encoded
   `srcSet`, not `next/image`. The auth hero has to load before anyone has a
   session, so `proxy.ts` lists it by exact name prefix. The gating spec
   asserts both halves.
6. **Fonts.** Anton was added for display type. JetBrains Mono was already
   the mono face and matches the brief's list, so it stays. The hand face is
   Unkempt, already loaded for the hub comic's balloons; adding Gochi Hand
   would have meant two hand faces on one page. It is used only on the
   sign-in motto and `.bubble--hand`.
7. **The Activity timeline stayed a table.** The brief suggested a vertical
   strip of panels. The list is virtualised and paged, and re-shaping it is
   more than a skin; it got the illustrated header, the speech-bubble empty
   state and panel framing instead. The GitHub activity stream likewise.
8. **The hub comic is unchanged.** It already is the comic. Its balloons
   keep their pinned white-on-ink colours for the reason recorded in the
   stylesheet: they sit on printed artwork that has no dark mode.
9. **Every page now uses the shared `ConsoleTopbar`.** Six pages and all nine
   GitHub screens hand-rolled their own bar with two controls and a back
   link. They now carry the one menu (sections, lamp, alerts, settings, sign
   out, primary sticker). The skip-link target moved with it, so the GitHub
   pages no longer put the id on `<main>`.
10. **Every page carries an eyebrow and title.** Sections are numbered:
    Console No.00, Clients No.01, Engineering No.02, Activity No.03,
    Publish No.04, Settings No.05 (`SECTION_NO` in `components/PageHead.tsx`).
    Hub, Activity, Publish and the PR inbox use the illustrated header; the
    dense screens use the plain block.

## Illustrations

Generated with `gpt-image-2` from the shipped manifest, one light and one
dark pass per asset, mascot first and the two derived spot pieces via the
edits endpoint so the character stays the same. Nine assets, eighteen
pictures. Reviewed: no lettering, no resemblance to any existing character,
consistent palette and lighting, generous negative space where UI sits.

```
OPENAI_API_KEY=... npx tsx scripts/generate-illustrations.ts            # draw what is missing
OPENAI_API_KEY=... npx tsx scripts/generate-illustrations.ts --only mascot
npx tsx scripts/generate-illustrations.ts --encode-only                 # re-encode WebP from masters
```

## Screens (definition of done)

All re-skinned, checked in both palettes against a local production build
at 1440 px, and the sign-in, hub and clients screens at 390 px.

- [x] Global: layout, grain and lamp, topbar and nav, lamp toggle, skip link, PWA tab bar
- [x] Sign in (credentials and code steps): full-bleed workshop, floating hero panel, motto balloon
- [x] Hub: illustrated masthead with date stamp, four panel tiles with drawn headers and No.0X badges, outstanding hero panel, updates feed, comic
- [x] Clients list: eyebrow block, calm table, stickers, mascot empty state
- [x] Client detail: eyebrow block, status panel, documents table, designs, site, billing, handover, change orders, assistant, comments, uploads, notes, tasks, email history, activity, brief, delete
- [x] New client form
- [x] Engineering: PR inbox (illustrated), PR detail, repositories, CI, deployments, releases, security, insights, activity; sub-nav, metric tiles in display type, green/amber/coral status, shimmer skeletons, empty and error blocks with the mascot
- [x] Activity (illustrated header, entry-count stamp)
- [x] Publish (illustrated header, sticker publish, outline draft)
- [x] Settings and dense forms: framing and eyebrows only
- [x] Empty states, skeletons, error boundaries (segment, client, global), 404, notices, confirm dialog, command palette

## Accessibility and motion

- Body and UI text clears AA in both palettes; see deviation 1 and the test.
- Focus ring is `--focus` (2 px, offset 3 px) on `:focus-visible` everywhere.
- Illustrations behind text are `alt=""`; the mascot pieces are described.
  Text over a picture sits on a scrim (`.auth__art::after`, `.scrim`).
- The grain and vignette are two fixed pseudo-elements, composited once,
  `pointer-events: none`, removed for print.
- Route enter is a 160 ms fade and 6 px rise; the primary sticker breathes
  its glow at night over 4.5 s. Both are off under `prefers-reduced-motion`,
  as are the hover lifts.
- Hover rules stay inside the existing `(hover: hover) and (pointer: fine)`
  guard; touch targets are unchanged.
