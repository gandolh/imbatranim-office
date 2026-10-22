# Task 04 — Slides that edit

## Context

The OS's built-in Slides (`apps/add-ons/slides` in the OS repo, about 630
lines) only views: it renders `.pptx` with `pptx-preview` (best effort, with a
"layout may differ" note and a Download original button), and has a thumbnail
rail, speaker notes, zoom with fit width or page, Present (fullscreen, Escape to
leave, arrow keys), and Export slide as PNG (`html-to-image`). Editing is the
gap. The behaviour reference is DeckCraft (see
[craft-reference.md](../../wiki/craft-reference.md)): its `docs/ui-parity.md`
(direct manipulation, keyboard, panes), `docs/parity-checklist.md` and
`docs/file-format-parity.md`.

Depends on brief 01. Spike-gated like CAD. When it reaches parity with the
built-in viewer **and** edits, the OS runs brief 164 for Slides.

## The question the spike answers

How a saved file keeps what the editor does not understand. Two ways:

- **Regenerate from a model.** Read the deck into JSON (`pptxtojson`), edit the
  model, write a new file (`PptxGenJS`). Simple, but anything the model lacks
  (masters, themes, animations, transitions, embedded objects, custom XML) is
  lost on the first save.
- **Patch the package in place.** Unzip (`fflate`, already in the OS), parse
  only the parts the editor touches (`fast-xml-parser` or a DOM parser), write
  those parts back, and copy every other part byte for byte. More work per
  feature, but a save changes only what the user changed. This is how the OS's
  Docs keeps `.docx` files whole (its normalizer guarantees parts rather than
  regenerating them).

The brief expects in-place patching, with a typed model over slides, shapes,
text, images and notes. The spike confirms it on real decks before anything
else is built.

## Library shortlist (surveyed 2026-10-21)

| Job | Candidate | License | Latest release | Note |
|---|---|---|---|---|
| Read a deck into a model | `pptxtojson` | MIT | 2.2.0, 2026-09 | Built for PPTist's import; its README says layout fidelity is not exact |
| Write a new deck | `PptxGenJS` | MIT | 4.0.1, 2025-06 | Writes from scratch only; good for New presentation |
| Unzip and zip | `fflate` | MIT | 0.4.8 (the OS's pin) | Already in the OS's Docs and Slides |
| Parse XML | `fast-xml-parser` | MIT | 5.11.2, 2026-09 | Or the browser's `DOMParser` |
| Render (today) | `pptx-preview` | ISC | 1.0.7, 2025-10 | The built-in viewer's renderer; no public repo listed |
| Editor UX reference | PPTist | AGPL-3.0 | — | A full web PowerPoint in Vue; license compatible with ours, framework not. A reference for the editing model, not a dependency |

## Files you OWN

- `apps/slides/**`
- `os/descriptor.template.json` (the `office-slides` entry)
- corpus: a new `wiki/slides.md` (the model, what a save preserves),
  `decisions.md` if the spike locks the approach, `status.md`, `log.md`

## What to do

1. **Spike (the gate).** Take three real decks: the 11-slide deck the OS's
   brief 19 used, one with a custom master and theme, one with animations and
   speaker notes. For each: change a title's text, move and resize a shape, add
   a slide from a layout, delete a slide, reorder two, save. Then confirm the
   saved file opens in LibreOffice Impress (headless convert to PDF in a scratch
   environment, outside this repo) and that every untouched part is byte
   identical to the original (compare the zip entries). Record what failed.
   If in-place patching cannot keep masters and animations through these edits,
   stop and return to the owner with the finding.
2. **Viewer parity first.** Everything the built-in does, listed above, in the
   new app. Keep `pptx-preview` for rendering only if the editor's own renderer
   is not ready; the goal is one renderer that both views and edits.
3. **Editing, v1.** Select, move, resize and rotate shapes, text boxes and
   images; edit text in place with bold, italic, underline, size, colour and
   alignment; insert a text box, an image (through the OS's Open dialog) and a
   basic shape; add, duplicate, delete and reorder slides in the rail (drag);
   edit speaker notes; undo and redo; keyboard nudges and shortcuts as
   DeckCraft's `ui-parity.md` lists them.
4. **Files.** Save over the opened file with `saveOverRead` and the conflict
   dialog, Save as through the OS's dialog, dirty mark, close guard, several
   windows. New presentation writes a blank deck (PptxGenJS is fine here).
   `.ppt` (the old binary format) is refused by name, as Docs refuses `.doc`.
5. **Descriptor entry.** `office-slides`, name `Slides`, `opens: ["pptx"]`
   (not `ppt`, which it refuses), `multiInstance: true`, icon `presentation`,
   the built-in's sizes (960×560, minimum 620×380).

## Acceptance

- The spike's results are in the log, and its gate passed.
- `npm run typecheck`, `npm run lint`, `npm test` (round-trip tests: untouched
  parts byte identical after an edit and a save) and `npm run build:os` pass.
- In Chrome, in the OS, each viewer feature of the built-in works on the same
  files, and the three spike decks survive an edit, a save and a reopen in the
  app and in LibreOffice with their masters, themes, notes and animations.

## Outcome (2026-10-22)

**Built in `2acbe13` (+ `898578d`); the spike passed; the in-OS walk moves to
brief [07](../todo/07-slides-walk-in-the-os.md).** On three real decks (an
11-slide deck with animations and transitions, one with a custom master and
theme, one with 14 notes pages and animations) and three generated twins, each
of the brief's edits and a save left every untouched part byte identical; the
edited slide's timing, transitions and `mc:AlternateContent` came back
identical, and LibreOffice opened every save with the right page count and the
edited text. Saves patch the package in place
([decisions.md](../../wiki/decisions.md)). One renderer of our own views and
edits, so pptx-preview is gone. Viewer parity and editing v1 were exercised in
a standalone page in Chrome. The walk inside the OS was cut off by the session
limit, and its notes were lost in a restart.

**Known gaps** ([slides.md](../../wiki/slides.md)): no save has been opened in
PowerPoint itself; charts draw as boxes; EMF and WMF pictures are not drawn;
shapes inside groups move only as a group; the slide show does not play
transitions or animations; `docProps/app.xml` is left stale.
