# Keyboard shortcuts

This is an internal tool for engineers, so it should be operable without a
mouse. This document lists what is actually implemented. Anything not listed
here does not exist yet, and the gaps are named at the bottom rather than
implied.

Every shortcut below is verified by a test in `tests/a11y.test.tsx`,
`tests/quick-find.test.tsx`, `tests/shell.test.tsx` or
`tests/github-ui.test.tsx`.

## Anywhere in the console

| Keys | Action |
| --- | --- |
| `Cmd+K` / `Ctrl+K` | Open search (the command palette). **Search** at the foot of the menu does the same |
| `/` | Open search, unless you are typing in a field |
| `Escape` | Close the palette, or close an open dialog |
| `Tab` (first press on a page) | Reveals "Skip to content", which jumps past the menu to the page |

## Command palette

| Keys | Action |
| --- | --- |
| Type | Find a screen by its name or by a word for what is on it ("invoice" finds Clients, "posts" finds the social kit), filter clients by name or document number, and search document content, notes and comments |
| `Up` / `Down` | Move through results, across all three groups (clients, screens, document content) |
| `Enter` | Open the highlighted result |
| `Escape` | Close |

The palette is a combobox with a listbox and `aria-activedescendant`, so a
screen reader announces the highlighted option as you move.

Before anything is typed it lists the main screens, then the clients. Once
there is a query, clients whose name matches come first. The screens it knows
are the menu itself (`lib/menu.ts`), so a screen added to the menu is findable
without anyone adding it here too. Each one also matches on what it used to be
called ("sales", "engineering", "CI").

## The menu on a phone

| Keys | Action |
| --- | --- |
| `Enter` or `Space` on **Menu** | Opens the menu as a dialog. Focus stays inside it |
| `Escape` | Closes it and returns focus to **Menu** |
| `Enter` on a link | Goes there and closes it |

On a computer the menu is always on screen and is ordinary links: `Tab` moves
through it, and the Code group opens and closes with `Enter` or `Space`.

## Pull request inbox (`/github`)

| Keys | Action |
| --- | --- |
| `j` or `Down` | Select the next pull request |
| `k` or `Up` | Select the previous one |
| `Enter` | Open the selected pull request |
| `Escape` | Clear the selection and drop focus |

Selection is real focus (a roving tabindex over the row links), not a CSS
class, so a screen reader follows it and the selected row scrolls into view.
The list keeps exactly one tab stop, so `Tab` moves past the whole table
rather than through every row.

These keys are ignored while focus is inside an input, textarea, select or
contenteditable, and any chord with Cmd, Ctrl or Alt is left alone so
`Cmd+K` still opens the palette.

## Tables

| Keys | Action |
| --- | --- |
| `Tab` to a column header, then `Enter` or `Space` | Sort by that column, toggling direction |
| `Up` / `Down` | Move between rows in the virtualized client table |
| `Home` / `End` | Jump to the first or last row, including rows outside the rendered window |

Sortable headers are real buttons inside the `th`, and the `th` carries
`aria-sort`, so the current sort is announced rather than only drawn as an
arrow.

## Dialogs

| Keys | Action |
| --- | --- |
| `Tab` / `Shift+Tab` | Cycle within the dialog. Focus is trapped and cannot escape to the page behind |
| `Enter` | Confirm, when the dialog has a text or password input and it is non-empty |
| `Escape` | Cancel |

Closing a dialog returns focus to the control that opened it.

## Forms

| Keys | Action |
| --- | --- |
| `Cmd+Enter` / `Ctrl+Enter` | Send, in the studio assistant. Plain `Enter` inserts a newline, because the box is multi-line |
| `Enter` | Add, in the task input |

## Not implemented

Named so the gap is visible rather than assumed:

- **`g` then a letter** for go-to navigation (`g h` home, `g p` pull
  requests).
- **`?` for a shortcut sheet.** This document is the reference, and it is not
  reachable from inside the app.
- **Single-key actions on a focused row** (approve, merge, label). Row actions
  currently need `Enter` to open the pull request first.
- **The command palette is navigation only.** It jumps to screens and
  clients; it does not execute actions.

The first two are the ones worth doing next, in that order: `g` is muscle
memory for anyone who uses GitHub, and `?` is what makes the rest
discoverable.
