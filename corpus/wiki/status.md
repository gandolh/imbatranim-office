---
summary: Current snapshot (2026-10-21): nothing built; six briefs filed (scaffold, Docs, CAD, Slides, Sheets, PDF), the order they run in, and the imbatranimOS briefs (162, 163, 164) each one waits on.
updated: 2026-10-21
---

# Status — 2026-10-21

**Phase: planned, nothing built.** The repo holds the corpus, a README and the
license. The decisions are in [decisions.md](decisions.md); the planned layout
in [architecture.md](architecture.md).

## Order

The OS's groundwork comes first: imbatranimOS brief 162 (one descriptor,
several apps) and 163 (the shared kit) must be built before any app here can
open in a window. Then Docs, to prove the move; then CAD and Slides, the two
apps the OS lacks; then Sheets and PDF. Each moved app ends with the OS running
its brief 164 for that app, which retires the built-in.

## Briefs

| # | Brief | State | Waits on |
|---|---|---|---|
| 01 | [scaffold-and-a-smoke-app](../briefs/done/01-scaffold-and-a-smoke-app.md) | **done** (2026-10-21) | — |
| 02 | [docs-moves-in](../briefs/todo/02-docs-moves-in.md) | **todo** | 01; then OS 164 for Docs |
| 03 | [cad-a-2d-drafting-app](../briefs/todo/03-cad-a-2d-drafting-app.md) | **todo**, spike-gated | 01 |
| 04 | [slides-that-edit](../briefs/todo/04-slides-that-edit.md) | **todo**, spike-gated | 01; then OS 164 for Slides |
| 05 | [sheets-moves-in](../briefs/todo/05-sheets-moves-in.md) | **todo** | 01, 02; then OS 164 for Sheets |
| 06 | [one-pdf-app](../briefs/todo/06-one-pdf-app.md) | **todo** | 01; then OS 164 for the PDF pair |

## Owed by the owner

- Push this repo's `main` when ready (the remote is set; nothing is pushed).
