---
summary: How Slides (brief 04) is built — a .pptx opened as its OPC package with a lossless XML tree, edited in place and saved by copying every untouched part byte for byte — with the spike that proved it on three real decks, what a save keeps and changes, the renderer that both views and edits, undo, the file wiring, and the known gaps.
updated: 2026-10-21
---

# Slides

`apps/slides` opens a `.pptx`, draws it with its own renderer, edits it, and
saves it by patching the package in place. There is no pptx-preview and no
PptxGenJS in it: the same code draws the stage, the thumbnails, the slide show
and the PNG export, and a new presentation is written from a template in
`engine/blank.ts`.

## The model

Four layers, each reading the one below:

| Layer | File | What it holds |
|---|---|---|
| Zip | `engine/zip.ts` | fflate's sync API (the async one spawns `blob:` workers the CSP refuses). The central directory is read first and the deck refused before inflating if it claims more than 20,000 entries or 1 GiB. |
| Package | `engine/opc.ts` | Parts by name, relationships, content types, and transactions. A part is parsed only when asked for. |
| XML | `engine/xml.ts` | A lossless tree: every node keeps the slice of source it came from. An untouched node serializes to that slice; a changed element is rebuilt from its attributes and children, and its untouched children are still copied from source. |
| Presentation | `engine/deck.ts`, `shapes.ts`, `edits.ts`, `textEdit.ts` | The slide list, layouts, masters, notes, placeholder inheritance, and every edit. |

On top of these, `engine/model.ts` resolves what a slide looks like (frames,
geometry, fills, lines, text runs and paragraphs through presentation default,
master style, master and layout placeholders, the shape, the paragraph and the
run; theme colours through the master's colour map; tables with their table
style; SmartArt from its cached drawing; OLE objects from their preview
picture). `view/SlideView.tsx` draws that model; nothing else draws slides.

The rule every edit follows: take the part with `pkg.rootForEdit(name)` (or a
helper that does) before changing it. That records its bytes in the running
transaction, which is what undo restores.

## What a save keeps

A save writes each part from the bytes it was read with unless an edit changed
it. So, after an edit:

- Parts nobody touched (masters, layouts, themes, media, charts, embedded
  objects, custom XML, comments, every other slide) are byte identical.
- Inside an edited slide, only the edited elements differ. `p:timing`,
  `p:transition`, `mc:AlternateContent` and extension lists come back exactly.
- Adding a slide writes the slide, its rels, a content-type override, a
  relationship and a `p:sldId` (and joins a PowerPoint 2010 section if the deck
  has them). Deleting one removes it, its rels and override, every part only it
  reached (its notes page, a picture only it used), hyperlinks elsewhere that
  jumped to it, and its entries in custom shows and sections. A deleted part's
  name is never reused.
- Deleting a shape removes the animation effects that target it; shortening a
  shape's text removes effects on paragraphs that no longer exist. PowerPoint
  repairs a file whose timing names a missing shape.
- Undo restores the exact bytes of every part a step touched, so undoing back
  to the saved state leaves the file clean and byte identical.
- Not updated: `docProps/app.xml` (slide count, titles). PowerPoint ignores it.

## The spike (2026-10-21)

On the three decks the brief named (stand-ins, kept in the scratchpad and not
committed: an 11-slide deck with animations, transitions, OLE objects and a
WMF; a deck with a custom master and theme; a 23-slide deck with 102
`mc:AlternateContent` blocks and 14 notes pages) and their three CC0 twins:
change a title, move and resize a shape (an inherited placeholder frame on
three of them), add a slide from a layout, delete a slide, reorder two, save.

- Every XML part of all six decks parses and re-serializes identically.
- After the edits, the only changed entries were `[Content_Types].xml`,
  `presentation.xml`, its rels and the edited slide. Masters, layouts and
  themes: all byte identical. The edited slide's timing and transition
  subtrees: identical.
- LibreOffice converts every saved file (and every intermediate step) to PDF
  with the expected page count and the edited text; python-pptx opens them;
  converted to ODP, the per-slide animation counts match the original's in
  the new slide order.
- Not tested: PowerPoint itself, whose schema-order checks are stricter than
  LibreOffice's. New elements are inserted at their schema position.

The gate (keep masters and animations through these edits) passed, so the save
strategy is in-place patching.

## Editing

- The stage draws the slide at 960 logical pixels and scales it, so text wraps
  the same at every zoom and in the thumbnails. Selection handles are drawn in
  screen pixels on top.
- Select (click, Shift/Ctrl+click, marquee, Tab), move (Shift keeps an axis,
  Ctrl drops a copy), resize from eight handles in the shape's own rotated axes
  (corners keep proportions with Shift and always for pictures; Ctrl from the
  centre), rotate (Shift snaps to 15°), drag a line's ends, nudge with the
  arrows (Ctrl or Alt for a point).
- Text is edited in place: the shape's text becomes a contentEditable block
  built with the view's CSS. On commit it is read back paragraph by paragraph;
  an unchanged paragraph keeps its original element, a changed one is rebuilt
  from its paragraph properties and its runs' original `a:rPr`, with only the
  formatting the user changed written on top. Fields (slide numbers) survive.
- Insert a text box, a picture (through the OS's Open dialog, or pasted from
  the clipboard), and seven basic shapes styled from the theme. Fill, outline,
  restack, delete, copy, cut, paste (across windows too, pictures included),
  duplicate.
- Slides: new from a layout, duplicate (its notes, charts and diagrams get
  their own copies), delete, reorder by dragging in the rail or Ctrl+arrows.
- Speaker notes as plain text, one undo step per pause in typing. A slide without
  a notes page gets one; a deck without a notes master gets one (and a theme for
  it) the first time notes are typed.
- Undo and redo: every action is one package transaction (`editor/store.ts`).

## Files

`shell/useDeckFile.tsx` holds the file wiring: the open intent, a read with its
version token, refusals by name (`.ppt`, `.pps`, `.pot`, `.odp`, `.key`) and by
first bytes (an OLE2 file named `.pptx`), Save over the file with
`saveOverRead` and the conflict dialog, Save as through the OS's dialog (adds
`.pptx`), the dirty mark and close guard (`useUnsavedGuard`), Ctrl+S, Download
original, and New presentation. Open while there are unsaved changes opens the
other file in a new window. Every save first commits what is still being typed
(slide text and notes), so Ctrl+S in the middle of a word saves the word.

## Known gaps

- Fonts: the browser draws with what it has. Without Calibri or Cambria, text
  wraps where LibreOffice's does, not where PowerPoint's does.
- Autofit is read (`normAutofit` font scale and line reduction) but not
  recomputed after an edit.
- Not drawn: charts (a labelled box), EMF/WMF/TIFF pictures, effects (shadows,
  glow, 3-D), text warp, gradients on text. Preset geometry covers the common
  shapes; the rest draw as their frame.
- Not edited: shapes inside groups (the group moves and resizes as one), table
  cells, chart data, animations and transitions (kept, not editable).
- The slide show steps slides; it does not play transitions or animations.
