# Task 10 — Docs: find-as-you-type keeps typing in the find box

## Context

Found in brief 02's walk, in the built-in Docs as well as the suite's: type a
word into Docs' find bar (Ctrl+F) and only the first character stays in the
box; the rest goes into the document, and can be saved into the file.
SuperDoc 1.45.0's `goToSearchResult` calls `editor.view.focus()` (around line
46506 of its bundled `superdoc.es` chunk), so each search-as-you-type moves
focus to the editor.

## Files you OWN

- `apps/docs/**`
- corpus: this brief's outcome, `status.md`, `log.md`

## What to do

1. Keep focus in the find input while the user types: for example, search
   without moving the selection on each keystroke and go to the result only on
   Enter, or return focus to the input after `goToSearchResult` (and make sure
   no keystroke reaches the document in between). Read SuperDoc's search API
   before choosing; say which you chose and why.
2. Keep what works: Enter and Shift+Enter step and wrap, Escape closes, the
   find bar opens in the top window only, and the match is shown.
3. A unit test with SuperDoc mocked at the boundary, and a walk in the OS:
   type a whole word into the find box, and the document is unchanged.

## Acceptance

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build:os` pass; in
the OS, a word typed into the find box stays there and the document is not
dirty.
