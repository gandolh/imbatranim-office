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

## Outcome (2026-10-28)

**Done; walked in the OS.** `d5f0631`.

**Chosen: give focus back after `goToSearchResult`, not "go to the match on
Enter only".** SuperDoc 1.46.3's `goToSearchResult` command (the Search
extension in `dist/chunks/src-*.es.js`) calls `editor.view.focus()` before it
selects the match, and Enter has to go to a match too, so a box that only
searched on each key would still lose focus on the first Enter; typing after
an Enter went into the document as well. `goToMatch` in
`engine/superdoc.ts` now notes the focused element, calls SuperDoc and
focuses it again in the same task, so no key event can run in between. The
match is still selected and scrolled to on every key, as before. SuperDoc
emits `update` (Docs' `onEditorUpdate`) only on `docChanged`, so the
selection change leaves the document clean.

**The find bar carries `data-editor-ui-surface`.** SuperDoc's selection
overlay paints the selection only while the editor has focus or the focused
element is inside such a surface (`PresentationEditor`, the `isOnEditorUi`
check in the same chunk). Without the marker the selected match vanished as
soon as focus came back to the box (walked: 0 selection rects, against 1
with it). With several windows open, a focused find bar keeps every Docs
window's caret painted, the symptom brief 12 is about.

`stepMatch` keeps the current index in a ref and goes to the match outside
the state updater, which React may run twice.

**Test:** `App.test.tsx` "keeps a word typed into the find box there": the
SuperDoc fake's `goToSearchResult` focuses a stand-in editor that records
any key reaching it; "hello" typed key by key, Enter and Enter again leave
focus and every character in the box and the title clean. It fails on the
old engine (focus on the stand-in after "h").

**Walk:** imbatranimOS `31a248c`'s production image on a throwaway volume,
Office installed from the Marketplace route (suite `d5f0631`, 51 s),
headless Chrome driven by Playwright. A 32-paragraph `.docx` with a header
(python-docx, see [test-files.md](../../wiki/test-files.md)). Ctrl+F, then
"hello" typed at 120 ms a key: the box held "hello", focus stayed in it,
"1 of 31", one selection rect painted, Save disabled and no dirty mark.
Enter went to 2 of 31, Shift+Enter back to 1, again to 31 of 31 (wrap),
focus still in the box. The ProseMirror text was the same before and after.
Escape closed the bar. No CSP violation, no console error.

Gates: typecheck, lint, test, build:os and format:check pass. Lint's one
warning (an unused disable in `apps/cad/src/shell/useCadFile.tsx:140`) was
there before this brief.
