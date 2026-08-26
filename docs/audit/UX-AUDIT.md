# UX audit — screen by screen (2026-08-26)

Screenshots in `docs/audit/screenshots/` (1440x900 and 360x780, dark theme,
production data). This is the brief for the Phase 8 overhaul; every item is
either resolved there or explicitly deferred with a reason.

The headline: this is a well-made small app. It is coherent, it has real empty
states, it explains itself in plain language, and it does not look templated. The
gap is not polish — it is that it is built as a **series of stacked cards on one
long page**, which is the right shape for five clients and the wrong shape for a
console you live in.

## Dashboard (`screenshots/dashboard.png`, `dashboard-360.png`)

Works: the pipeline pill row reads instantly; the money line is a real sentence
("Nothing outstanding, every published invoice is settled") rather than a
zero-state number; the client table has search, stage filters, and sortable
columns; sessions are visible on the front page, which is unusual and good.

- **UX-01 (High) — The topbar is a flat row of seven equal-weight buttons.**
  Theme, alerts, sign out, activity, publish, export CSV, new client all compete;
  the only visual hierarchy is the accent on "+ New client". At 360px they wrap
  to two rows and push content down. Fix: persistent left nav + a top bar
  carrying search, connection/freshness state, and the notification bell
  (section 7.1); demote sign-out and theme into a user menu.
- **UX-02 (High) — There is no global search affordance on the page.** Search
  lives inside the Clients card and the palette is discoverable only if you know
  `⌘K` (the input's placeholder is the only hint). Fix: global search in the top
  bar, `/` and `⌘K`, scoped sub-commands.
- **UX-03 (Medium) — The dashboard is not "what needs you today".** It leads with
  Pipeline (counts) rather than with the work: unread updates, open tasks,
  overdue money. The pieces exist but are ordered by feature, not by urgency.
  Fix: personal home as the landing view (section 6.3).
- **UX-04 (Medium) — Recent updates and Open tasks are capped at 8/12 rows with
  no "see all"** on the dashboard; the only way to the rest is `/activity` (for
  updates) or opening each client (for tasks). Dead end.
- **UX-05 (Medium) — The client table scrolls horizontally at 360px** (visible in
  the screenshot: Stage is clipped mid-column). Correct behaviour for a table,
  but on a phone the row should collapse to a card, not sidescroll.
- **UX-06 (Low) — Sessions on the dashboard is a settings surface**, not daily
  work. It earns its place today because there is nowhere else; it belongs in
  admin/settings once that exists.
- **UX-07 (Low) — No density control** and no persisted table preferences
  (section 7.1).

## Client detail (`screenshots/client-detail.png`)

This is the screen the studio actually lives in, and it is the one that most
needs the rebuild. The screenshot is ~4,900px tall.

- **UX-10 (High) — Fourteen stacked cards on one page with no navigation.**
  Header, Documents, Design previews, Finalized site, Billing, Handover,
  Change orders, Assistant, Client questions, Client uploads, Notes, Tasks,
  Emails sent, Activity, Brief, Danger zone. Finding anything means scrolling
  past everything. Fix: tabs or a two-pane layout (list left, detail right) with
  the URL carrying the active pane (section 7.1/7.3).
- **UX-11 (High) — No way to see two clients at once, and no back-to-list
  context.** Triaging N clients is N full page loads.
- **UX-12 (Medium) — Action buttons repeat per row with no grouping.** A document
  row can show Unpublish, Revise, Delete, Email, plus History — five controls of
  equal visual weight, one of which is destructive. Fix: primary action inline,
  the rest behind an overflow menu; destructive always last and visually
  distinct.
- **UX-13 (Medium) — "Danger zone" sits at the bottom of the same scroll as
  everyday work.** It is styled distinctly (red border) which helps, but
  proximity to routine controls is a hazard.
- **UX-14 (Medium) — Long-running actions (20s to 2min) show only a button
  label** ("Working… ~20s", "Drafting… (takes ~1–2 min)"). Honest, which is
  good, but there is no progress, no cancel, and navigating away loses the
  result. Fix: background jobs with a visible queue (section 8 worker).
- **UX-15 (Low) — The Documents table's Actions column is 220px minimum inside a
  horizontally scrolling table**, so on narrow screens the actions are off-screen
  until you scroll right.
- **UX-16 (Low) — Copy-link rows and status pills repeat the same information**
  in the header card and the Documents table.

## Login (`screenshots/login.png`)

- **UX-20 (Medium) — The card is a small island in a large empty field** at
  1440px; the visual weight is fine but there is no product context (no version,
  no environment indicator, no "this is the internal console" framing beyond the
  eyebrow).
- **UX-21 (Medium) — Two authenticated API calls fire on the login page and 401**
  (baseline console errors). SessionGuard's ping is intentional self-disabling,
  but it costs two visible console errors on every load of the most-visited
  unauthenticated page. Fix: skip the ping when the page is `/login`.
- **UX-22 (Low) — No caps-lock hint, no "resend code" timer display** (the note
  says wait Ns but does not count down), and the OTP step has no paste-friendly
  6-box input.

## Activity (`screenshots/activity.png`)

- **UX-30 (Medium) — Opening the page marks everything seen** as a side effect
  of rendering (`markNotificationsSeen()` in the server component). Visiting to
  check one thing clears the team's unread state, for everyone, irreversibly.
- **UX-31 (Medium) — Read state is global, not per-operator.** With three people
  this is a deliberate simplification, but it means one person's triage silently
  clears another's inbox. Worth an explicit decision (it is the same call the
  insights ADR has to make).
- **UX-32 (Low) — No filters** (by client, actor, action type) and no date
  range; "See more" pages 20 at a time through a 500-entry cap.

## Publish (`screenshots/publish.png`) and New client (`screenshots/clients-new.png`)

- **UX-40 (Medium) — The project publish flow asks the operator to hand-edit raw
  JSON** in a textarea (`PublishStudio` ProjectForm). It is honest and it works,
  but a malformed brace is a lost draft with a generic parse error.
- **UX-41 (Medium) — Both flows are single-shot long operations** ("about a
  minute; don't close the tab"). Losing the tab loses the work; there is no
  draft persistence for the article body either.
- **UX-42 (Low) — New client's brief field carries the pricing hint in a
  paragraph of grey text** that is easy to miss, yet the figures in it are
  treated as authoritative by the model.

## Client portal (`screenshots/portal-preview.png`)

The best-designed surface in the product, and the only one with a real hero.
Progress stepper, plain-language captions, "New" badges, question box, upload
box, design selection all read well.

- **UX-50 (Medium) — The questionnaire loses everything on refresh** (LC-021).
  This is the single worst client-facing UX defect.
- **UX-51 (Low) — The portal has no way to see what was already sent/answered**
  beyond the document list; a client who submitted twice sees no confirmation of
  which submission is current.

## Cross-cutting

- **UX-60 (High) — URL is not the state.** Filters, sorts, the active stage
  filter, the search query, and expanded sections are component state; nothing is
  shareable between the three operators (section 7.3 requires URL state).
- **UX-61 (High) — Freshness is never shown.** Pages are server-rendered on
  navigation and refreshed via `router.refresh()` after actions; there is no
  "as of" timestamp, no live updates, no connection state (section 7.3 requires
  honest, always-visible freshness).
- **UX-62 (Medium) — No toast system.** Feedback is inline text per card
  (`Sent ✓`, `Copied ✓`, error divs), so an action confirmed at the bottom of a
  4,900px page can be invisible. Sonner is the mandated fix (section 7.2).
- **UX-63 (Medium) — Loading states are button labels and one "Loading…"
  string**, not layout-matched skeletons; content jumps when data arrives.
- **UX-64 (Medium) — Keyboard support is minimal**: `⌘K` palette (jump only),
  `⌘+Enter` in the assistant, Escape in dialogs. No j/k, no row actions, no
  shortcut sheet, no focus trap in the dialog.
- **UX-65 (Low) — Empty states are strong; error states are weak.** Errors are a
  red box with a server string and no recovery action.
- **UX-66 (Low) — Em dashes and authored emoji** in UI copy and notifications
  violate the house style (LC-050, LC-051).

## What to preserve in the rebuild

The plain-language voice (every card explains what it is for and what will
happen), the honest time estimates on slow actions, the two-step confirmation for
destructive document actions, the archive-before-delete guarantee, the portal's
progress stepper and its captions, the status-pill language (dot plus word, never
hue alone), and the document design system itself, which is genuinely good.
