# imbatranim-office corpus — index

Start here. Triage on the summary lines; open at most 2–3 pages.

- [CLAUDE.md](CLAUDE.md) — the rules and conventions for this corpus
- [routing.md](routing.md) — intent/knowledge routing for work-intake
- [log.md](log.md) — chronological record of meaningful changes

## Wiki

- [architecture](wiki/architecture.md) — How imbatranim-office is laid out and built (brief 01): npm workspaces with one package per app, packages/shared (externals plugin, CSS rule, vendor stylesheets, OS build, fake system for tests), the kit snapshot and kit:sync, what `npm run build:os` writes to dist/os, the OS descriptor template and the test that keeps it in step with the build, and how a window gets from the OS's catalog to an app component.
- [cad](wiki/cad.md) — How CAD (brief 03) is built: the spike's picks and numbers (dxf-viewer's parser to read, @tarikjabiri/dxf to write, our own Canvas 2D renderer at 60 fps on 10k lines), the drawing model and its undo, the commands and their aliases, the snap and selection rules, files and exports, the harness, and the known gaps.
- [craft-reference](wiki/craft-reference.md) — How to use ArtCraft's crafts (WordCraft, GridCraft, CADCraft, PdfCraft, DeckCraft) as the behaviour and feature reference for each app: which craft maps to which app, where each keeps its parity checklists and command lists, and the license rules for reading or translating their code.
- [decisions](wiki/decisions.md) — The locked calls behind imbatranim-office: its own repo installed as one suite descriptor, TypeScript with editing in the browser, kit apps on the desktop's shared kit, the crafts as reference only, PDF Viewer and norPDF merged, and office-* app ids, with what each rejected and why. Read before proposing an alternative.
- [glossary](wiki/glossary.md) — The suite's vocabulary: suite, suite descriptor, kit app, shared kit, kit snapshot, built-in, parity, retire, craft, and the five app names (Docs, Sheets, Slides, PDF, CAD), with the synonyms each displaces.
- [open-questions](wiki/open-questions.md) — What is genuinely unresolved for imbatranim-office: the CAD engine pieces and the Slides save strategy (both settled by their briefs' spikes), DWG support, and which app first needs a server.
- [overview](wiki/overview.md) — What imbatranim-office is: the office apps of imbatranimOS (Docs, Sheets, Slides, PDF, CAD) in their own repo, installed from the OS's Marketplace as one entry and rendered with the desktop's own React and kit, and where it came from.
- [pdf](wiki/pdf.md) — PDF (apps/pdf), the OS's PDF Viewer and norPDF merged into one app, and @pdfcore/engine (packages/pdfcore-engine), moved from imbatranimOS 56e23b7 — what each module owns, the fast first page (pdf.js alone, the engine and editing tools after it), the shared pdf.js worker file, the save→reload cache contract, what the write path is proven to preserve, the timing, and what is deliberately not supported.
- [slides](wiki/slides.md) — How Slides (brief 04) is built — a .pptx opened as its OPC package with a lossless XML tree, edited in place and saved by copying every untouched part byte for byte — with the spike that proved it on three real decks, what a save keeps and changes, the renderer that both views and edits, undo, the file wiring, and the known gaps.
- [status](wiki/status.md) — Current snapshot (2026-10-21): nothing built; six briefs filed (scaffold, Docs, CAD, Slides, Sheets, PDF), the order they run in, and the imbatranimOS briefs (162, 163, 164) each one waits on.
- [stylesheets](wiki/stylesheets.md) — How an app's CSS reaches the desktop: app.css as Tailwind utilities only against the kit snapshot's tokens (no preflight, no --color-* values), and vendor stylesheets declared in package.json (imbatranimOffice.vendorStyles), copied byte for byte after a check that refuses rules not tied to the library, html/body/:root rules beyond custom properties, the desktop's tokens, @import, @font-face and remote url(); ownAttributes, ownCustomProperties (Univer's --univer-) and dropRules (Univer's scrollbar reset) as the declared exceptions.

## Work

- Brief states live one-per-line in [wiki/status.md](wiki/status.md);
  specs in [briefs/](briefs/), captures in [todos/](todos/).
