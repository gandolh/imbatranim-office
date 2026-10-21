# imbatranim-office corpus — index

Start here. Triage on the summary lines; open at most 2–3 pages.

- [CLAUDE.md](CLAUDE.md) — the rules and conventions for this corpus
- [routing.md](routing.md) — intent/knowledge routing for work-intake
- [log.md](log.md) — chronological record of meaningful changes

## Wiki

- [architecture](wiki/architecture.md) — The planned layout of imbatranim-office (not built yet): npm workspaces with one package per app, a shared package, the kit snapshot, the build the OS runs and the output it serves, and how a window gets from the OS's catalog to an app component.
- [craft-reference](wiki/craft-reference.md) — How to use ArtCraft's crafts (WordCraft, GridCraft, CADCraft, PdfCraft, DeckCraft) as the behaviour and feature reference for each app: which craft maps to which app, where each keeps its parity checklists and command lists, and the license rules for reading or translating their code.
- [decisions](wiki/decisions.md) — The locked calls behind imbatranim-office: its own repo installed as one suite descriptor, TypeScript with editing in the browser, kit apps on the desktop's shared kit, the crafts as reference only, PDF Viewer and norPDF merged, and office-* app ids, with what each rejected and why. Read before proposing an alternative.
- [glossary](wiki/glossary.md) — The suite's vocabulary: suite, suite descriptor, kit app, shared kit, kit snapshot, built-in, parity, retire, craft, and the five app names (Docs, Sheets, Slides, PDF, CAD), with the synonyms each displaces.
- [open-questions](wiki/open-questions.md) — What is genuinely unresolved for imbatranim-office: the CAD engine pieces and the Slides save strategy (both settled by their briefs' spikes), DWG support, and which app first needs a server.
- [overview](wiki/overview.md) — What imbatranim-office is: the office apps of imbatranimOS (Docs, Sheets, Slides, PDF, CAD) in their own repo, installed from the OS's Marketplace as one entry and rendered with the desktop's own React and kit, and where it came from.
- [status](wiki/status.md) — Current snapshot (2026-10-21): nothing built; six briefs filed (scaffold, Docs, CAD, Slides, Sheets, PDF), the order they run in, and the imbatranimOS briefs (162, 163, 164) each one waits on.

## Work

- Brief states live one-per-line in [wiki/status.md](wiki/status.md);
  specs in [briefs/](briefs/), captures in [todos/](todos/).
