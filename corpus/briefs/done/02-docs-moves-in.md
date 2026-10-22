# Task 02 — Docs moves in

## Context

Docs is the first app to move, chosen because it is small (about 450 lines of
UI; SuperDoc does the editing) and exercises everything the suite needs: open
from Files, save over the opened file, conflicts, several windows, Open With.
The built-in lives in the OS repo at `apps/add-ons/docs` (checked 2026-10-21):
`Docs.tsx`, `engine/superdoc.ts`, `engine/docxNormalize.ts`, `lib/formats.ts`,
`lib/saveOutcome.ts`, `lib/wordCount.ts`, with tests for the last four. Its
manifest: id `docs`, `opens: ['docx']`, `multiInstance: true`, default size
860×680, minimum 480×380.

Depends on brief 01 (the scaffold) and, for acceptance in a real window, on OS
briefs 162 and 163. When this brief reaches parity, the OS runs brief 164 for
Docs, which retires the built-in. That is an OS commit, not part of this brief.

## Files you OWN

- `apps/docs/**`
- `apps/smoke/**` (delete it; Docs replaces it as the proof)
- `os/descriptor.template.json` (swap `office-smoke` for `office-docs`)
- `THIRD-PARTY-NOTICES.md` if anything new needs a notice (SuperDoc is a
  dependency, not copied code, so it should not)
- corpus: `status.md`, `log.md`, the parity outcome note

## Files you must NOT touch

- The OS's built-in Docs. It keeps working, unchanged, until brief 164 retires
  it.

## What to do

1. Copy the built-in's `src/` into `apps/docs/src/` from a named OS commit and
   record the commit in the log entry. Its tests come with it.
2. Replace the add-on manifest (`index.ts`, which imports `AddonManifest` from
   `@imbatranim/core`) with the kit-app module: `export const App`, a component
   taking `{ windowId, host }` that renders `Docs`. Nothing here imports
   `@imbatranim/core`.
3. Keep SuperDoc at the version the built-in pins (1.45.0 resolved on
   2026-10-21) and `fflate` at its version; exact pins.
4. Point the "open it elsewhere" messages at the suite's names: `lib/formats.ts`
   says `PDF Viewer` for `.pdf`; it should say `PDF`.
5. The descriptor entry: id `office-docs`, name `Docs`, `opens: ["docx"]`,
   `multiInstance: true`, the built-in's sizes, icon `file-text`, capabilities
   the code actually uses (read them off `useSystem()` calls: at least `fs`,
   `intents`, `shortcuts`; add `notify` only if something calls it).
6. Walk the parity checklist below in Chrome with the suite installed from a
   local descriptor, the built-in beside it, and record each line's result in
   the outcome note.

## Parity checklist (against the built-in, same files)

- [ ] Opens a `.docx` from Files (double-click after choosing it in Open With,
      and Open With → Docs (Office)), and from its own Open button.
- [ ] Opens from a recents entry, and the entry is attributed to the suite app.
- [ ] Refuses `.doc`, `.odt`, `.rtf` and the rest by name, before the engine
      sees them, and points `.pdf` at PDF.
- [ ] The SuperDoc toolbar renders inside the window with every control the
      built-in shows.
- [ ] Ctrl+F opens the find bar in the top window only; next and previous wrap;
      Escape closes it.
- [ ] Edits mark the window dirty (`•`); Ctrl+S saves over the opened file; the
      dirty mark clears only if nothing changed during the save.
- [ ] A save over a file changed on disk since it was read asks (the conflict
      dialog), and both answers do what they say.
- [ ] Save as goes through the OS's Save dialog.
- [ ] Closing a dirty window asks first.
- [ ] A document saved by the suite reopens in the built-in, and the reverse,
      with text, tables, styles and tracked changes intact (the normalizer's
      silent-save-loss case included: use the built-in's test fixture).
- [ ] The word count matches the built-in's on the same file.
- [ ] Three windows with three documents work at once.
- [ ] New → Document in Files still works (it opens the built-in until 164
      changes that; check the file itself is fine in the suite app).

## Acceptance

- `npm run typecheck`, `npm run lint`, `npm test` (the moved tests pass
  unchanged apart from imports) and `npm run build:os` pass.
- Every parity line is ticked, or the brief stays in `todo/` with the failing
  lines named in the log.
- The OS can run brief 164 for Docs: the outcome note says so in one line.

## Outcome (2026-10-22)

**Built in `4686b34`, `92fb703` (smoke retired) and `1ca83c0` (several
windows); walked in the OS dev container and in its production image.** The
built-in's `src/` was copied from imbatranimOS `56e23b7`; SuperDoc 1.45.0 and
fflate 0.4.8 keep its pins, and SuperDoc's stylesheet ships as a checked vendor
stylesheet ([stylesheets.md](../../wiki/stylesheets.md)). Capabilities are
`fs`, `intents`, `notify`: Ctrl+S and Ctrl+F are window listeners, so
`shortcuts` is not needed.

**Parity, with the built-in beside it:** every line passes in both apps except
two. Save as is n/a, since the built-in has none. "Three windows" failed in
both: SuperDoc's input bridge listens on `window` in the capture phase and
takes focus from every other instance, so typing reached no window. Since
`1ca83c0` the suite marks each instance's active editor surface with
`data-editor-ui-surface` (it follows header and footer sessions). Walked: three
windows type and save their own files, and header editing, find, tracked
changes and typing after a reload behave as before. No CSP violation under the
production image.

**Known, not fixed.** With the built-in and the suite both open, keystrokes
typed in the built-in land in the suite's document; OS brief 164 removes the
built-in. Find-as-you-type keeps only the first character, in both apps
(brief [10](../todo/10-docs-find-as-you-type.md)). Every Docs window keeps a
blinking caret when more than one is open (a todo).

**The OS can run brief 164 for Docs.**
