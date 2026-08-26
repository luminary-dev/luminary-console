# Keyboard shortcuts

This is an internal tool for engineers, so it should be operable without a
mouse. This document lists what is actually implemented. Anything not listed
here does not exist yet, and the gaps are named at the bottom rather than
implied.

Every shortcut below is verified by a test in `tests/a11y.test.tsx` or
`tests/github-ui.test.tsx`.

## Anywhere in the console

| Keys | Action |
| --- | --- |
| `Cmd+K` / `Ctrl+K` | Open the command palette |
| `Escape` | Close the palette, or close an open dialog |
| `Tab` (first press on a page) | Reveals "Skip to content", which jumps past the topbar |

## Command palette

| Keys | Action |
| --- | --- |
| Type | Filter clients by name or document number, and search document content, notes and comments |
| `Up` / `Down` | Move through results, including the content-search results below the name matches |
| `Enter` | Open the highlighted result |
| `Escape` | Close |

The palette is a combobox with a listbox and `aria-activedescendant`, so a
screen reader announces the highlighted option as you move.

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

- **`/` to focus search.** Only `Cmd+K` opens the palette.
- **`g` then a letter** for go-to navigation (`g h` home, `g p` pull
  requests).
- **`?` for a shortcut sheet.** This document is the reference, and it is not
  reachable from inside the app.
- **Single-key actions on a focused row** (approve, merge, label). Row actions
  currently need `Enter` to open the pull request first.
- **The command palette is navigation only.** It jumps to clients; it does not
  execute actions.

The first three are the ones worth doing next, in that order: `/` and `g` are
muscle memory for anyone who uses GitHub, and `?` is what makes the rest
discoverable.
