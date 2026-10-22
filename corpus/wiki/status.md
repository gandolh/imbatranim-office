---
summary: Current snapshot (2026-10-22): all five apps built on main (Docs, CAD, Slides, Sheets, PDF) and in the descriptor template; briefs 01–06 done, Docs and CAD walked in the OS; four small briefs left (07–09 the Slides, Sheets and PDF walks in the OS, 10 Docs find-as-you-type), each unblocking one imbatranimOS retirement brief (164–167); nothing pushed.
updated: 2026-10-22
---

# Status — 2026-10-22

**Phase: built, partly walked.** `main` has the scaffold and all five apps;
`npm run build:os` builds them into `dist/os`, and `os/descriptor.template.json`
lists them. Docs and CAD were walked inside a real OS (dev container and the
production image, under its CSP); the Slides, Sheets and PDF walks were cut
off by a session limit on 2026-10-22 and are briefs 07–09. The run paused at
the owner's request, to continue one brief at a time.

## Order

Each walk brief unblocks one imbatranimOS brief that retires a built-in:
Docs is ready now (OS 164, which also commits the catalog's Office entry);
07 → OS 165 (Slides), 08 → OS 166 (Sheets), 09 → OS 167 (PDF Viewer and
norPDF). Brief 10 is independent.

## Briefs

| # | Brief | State | Waits on |
|---|---|---|---|
| 01 | [scaffold-and-a-smoke-app](../briefs/done/01-scaffold-and-a-smoke-app.md) | **done** (2026-10-21) | — |
| 02 | [docs-moves-in](../briefs/done/02-docs-moves-in.md) | **done** (2026-10-22): parity walked; several windows fixed (`1ca83c0`) | — |
| 03 | [cad-a-2d-drafting-app](../briefs/done/03-cad-a-2d-drafting-app.md) | **done** (2026-10-22): spike passed; walked in the OS | — |
| 04 | [slides-that-edit](../briefs/done/04-slides-that-edit.md) | **done** (2026-10-22): built, spike passed; walk → 07 | — |
| 05 | [sheets-moves-in](../briefs/done/05-sheets-moves-in.md) | **done** (2026-10-22): built; walk → 08 | — |
| 06 | [one-pdf-app](../briefs/done/06-one-pdf-app.md) | **done** (2026-10-22): built, first page 237 ms vs 492 ms outside the OS; walk → 09 | — |
| 07 | [slides-walk-in-the-os](../briefs/todo/07-slides-walk-in-the-os.md) | **todo** | — ; then OS 165 |
| 08 | [sheets-walk-in-the-os](../briefs/todo/08-sheets-walk-in-the-os.md) | **todo** | — ; then OS 166 |
| 09 | [pdf-walk-in-the-os](../briefs/todo/09-pdf-walk-in-the-os.md) | **todo** | — ; then OS 167 |
| 10 | [docs-find-as-you-type](../briefs/todo/10-docs-find-as-you-type.md) | **todo** | — |

Open todos: [Docs' caret in every window](../todos/2026-10-22-docs-caret-in-every-window.md),
[CAD's TRIM on short segments](../todos/2026-10-22-cad-trim-pick-on-short-stubs.md).
Test files for the walks: [test-files.md](test-files.md).

## Owed by the owner

- Push this repo's `main` before imbatranimOS's: the OS's Office catalog entry
  (from its brief 164) pins a commit of this repo, and the OS clones it from
  GitHub at install.
- After the OS is deployed, install Office from Settings → Marketplace on the
  live machine; until then it has no office editor once a built-in retires.
