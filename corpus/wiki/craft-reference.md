---
summary: How to use ArtCraft's crafts (WordCraft, GridCraft, CADCraft, PdfCraft, DeckCraft) as the behaviour and feature reference for each app: which craft maps to which app, where each keeps its parity checklists and command lists, and the license rules for reading or translating their code.
updated: 2026-10-21
---

# The crafts as a reference

The owner's call on 2026-10-21: learn from the crafts how a feature behaves
and how it is built, then build our own in TypeScript. They are never a
dependency of this repo. The repos are under
[github.com/storytold](https://github.com/storytold), MIT OR Apache-2.0, alpha,
and change daily. Quote a number or a file with the commit it came from.

## Which craft for which app

| Our app | Craft | It clones | Checked at (2026-10-21) |
|---|---|---|---|
| Docs | [WordCraft](https://github.com/storytold/wordcraft) | Word | `e05b7fe` |
| Sheets | [GridCraft](https://github.com/storytold/gridcraft) | Excel | `37e4142` |
| Slides | [DeckCraft](https://github.com/storytold/deckcraft) | PowerPoint | `63831cd` |
| PDF | [PdfCraft](https://github.com/storytold/pdfcraft) | Acrobat | `4164951` |
| CAD | [CADCraft](https://github.com/storytold/cadcraft) | AutoCAD (2D only) | `0cf3bde` |

## Where to look in a craft

Every craft keeps the same set of documents in `docs/`:

- `target-app-parity.md`: the headline, how close the craft is to the app it
  clones, by audience. Their numbers are their own estimates.
- `ui-parity.md`: the interaction checklist (shell, panes, direct manipulation,
  keyboard). The best single source for "how should this behave".
- `parity-checklist.md`: the row-by-row feature list behind their breadth
  number. PdfCraft has none; it keeps `pdf-spec-parity.md` and a `parity/`
  directory instead.
- `file-format-parity.md`: what each format keeps on a round trip.
- `gaps.md`: what the craft knows it lacks. Read it before copying a behaviour,
  in case they flag their own version as wrong.
- `architecture.md` and `mcp.md`: how the engine is split, and the list of
  commands an agent can run (`list_commands`). The command list is a ready
  inventory of features.

Per craft, also:

- **CADCraft:** `geometry-parity.md` (trim, extend, offset, fillet and the
  rest), `ui-parity.md`'s sections on point entry, object snaps, tracking,
  dynamic input, grips, selection and the command line, and
  `examples/apartment.dxf`.
- **DeckCraft:** `slideshow-parity.md` and `animation-parity.md`.
- **WordCraft:** `layout-parity.md` and `typing-parity.md`.
- **GridCraft:** `function-parity.md`, `formula-input.md`, `chart-parity.md`.
- **PdfCraft:** `editing-existing-text.md`, `editing-images.md`.

## License rules

- **Reading and copying a behaviour needs nothing.** Building our own version of
  what we saw is ours.
- **Translating code needs its notice.** If a function is ported from a craft
  (an algorithm, a table, a parser), keep the craft's copyright line and the
  MIT license text in `THIRD-PARTY-NOTICES.md` at the repo root, with the file
  it went into and the craft commit it came from. Their `NOTICE` reads
  "Copyright (c) 2026 ArtCraft Team and the <craft> contributors". MIT and
  Apache-2.0 code may go into this AGPL repo.
- **No brand.** The ArtCraft name, wordmark and logos (`docs/brand/` in each
  repo) are excluded from their license (`docs/brand/LICENSE-brand.txt`). Never
  use them, in code, docs or UI.
- **Assets have their own terms.** Each craft lists every asset in
  `ATTRIBUTION.md`; shared fonts live in a separate repo
  (`storytold/craft-fonts`) under their own licences. Check before taking any
  file that is not code.
- **Nothing from their dependencies.** CADCraft's DWG support uses an MPL-2.0
  Rust crate; none of it applies to us, since we take no Rust.
