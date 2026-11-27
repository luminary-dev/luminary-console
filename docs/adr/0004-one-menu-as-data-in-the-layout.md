# 4. One menu, held as data, drawn by the root layout

Date: 2026-11-24

## Status

Accepted.

## Context

The console had three ways of getting around. Eleven screens shared a top bar.
The nine GitHub screens drew their own header with no menu and no Search, only
a link back to the dashboard. The installed app had a third, a seven-tab bar
with its own names ("Eng", "New"). Each screen also wrote its own title, so
what a screen was called depended on where you read it, and three different
things were called "Activity".

The names were tool names: Engineering, Publish, Send, Scripts, Social kit.
The owner's instruction for this change was that someone who knows nothing
about the console should understand all of it.

## Decision

1. **The menu is data, in one file: `lib/menu.ts`.** Every screen has an
   address, a name and one plain sentence saying what it is for. The side
   menu, the phone's bottom bar, Search, the trail above a page title, the
   sentence under it and the Help page are all read from that file. Nothing
   else is allowed to name a screen.
2. **Names are jobs; addresses did not move.** "Sales" became Find customers
   but `/sales` is still `/sales`, because addresses are in bookmarks, emails
   and notifications. Each entry keeps its old name as a search keyword. The
   one new address is `/publish/project`, so Portfolio projects could be its
   own menu entry.
3. **The root layout draws the menu, once** (`components/shell/ConsoleFrame`),
   instead of each page drawing it. The menu is then the same element before
   and after a navigation: it does not repaint, and a page's loading or error
   screen appears beside it.
4. **The frame is an allowlist.** The root layout also wraps the sign-in page,
   a client's own pages and document previews. `isConsolePath` lists the
   console's top-level folders, and the frame is never drawn on a client
   subdomain. A new kind of page is outside the frame until someone adds it.
5. **A page says where it is** with `<ConsoleShell current="…">`, which draws
   the same header on every screen from the menu entry.

## Consequences

- Adding a screen is two steps: an entry in `lib/menu.ts`, and
  `current` on its page. Tests fail if the entry has no page behind it, and if
  Help or Search cannot see it.
- The unread count on History is no longer rendered by each page. The frame
  fetches it from `/api/activity/unread` after the page is up and on each
  navigation. It can be a moment stale; no screen waits on it.
- Which entry is lit is worked out from the address (`currentFor`), on the
  server render and again in the browser, so it is in the first paint.
- The menu's markup is shipped on every console page as client JavaScript. It
  is a short list of links.
- `components/ConsoleTopbar.tsx`, `components/AppTabBar.tsx`,
  `components/sales/SalesNav.tsx` and the tab row in
  `components/github/GithubNav.tsx` are deleted.
