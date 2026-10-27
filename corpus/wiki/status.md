---
summary: Current snapshot (2026-10-27): all five apps built on main (Docs, CAD, Slides, Sheets, PDF) and in the descriptor template; briefs 01–07 done, Docs, CAD and Slides walked in the OS; Sheets and PDF walked (08 and 09 stay in todo: a formula freeze the built-in shares, and a first page 40 ms behind PDF Viewer; five fixes in); left 10 (Docs find-as-you-type), 11 (CAD TRIM pick) and 12 (Docs caret, waits on 10), the walks each unblocking one imbatranimOS retirement brief (165 is ready, 166 and 167 wait on the owner); run paused 2026-10-28; nothing pushed.
updated: 2026-10-27
---

# Status — 2026-10-27

**Phase: built, partly walked.** `main` has the scaffold and all five apps;
`npm run build:os` builds them into `dist/os`, and `os/descriptor.template.json`
lists them. Docs, CAD and Slides were walked inside a real OS (dev container
and the production image, under its CSP); the Sheets and PDF walks, cut off by
a session limit on 2026-10-22, are briefs 08–09. The run continues one brief
at a time.

## Order

Each walk brief unblocks one imbatranimOS brief that retires a built-in:
Docs is ready (OS 164, which also commits the catalog's Office entry);
Slides is ready (07 done → OS 165); 08 → OS 166 (Sheets) waits on the owner's
call on the formula freeze it found; 09 → OS 167 (PDF Viewer and norPDF) waits
on the owner's call on the 40 ms first-page gap it measured. Briefs 10 and 11 are independent; 12 waits on 10.

## Briefs

| # | Brief | State | Waits on |
|---|---|---|---|
| 01 | [scaffold-and-a-smoke-app](../briefs/done/01-scaffold-and-a-smoke-app.md) | **done** (2026-10-21) | — |
| 02 | [docs-moves-in](../briefs/done/02-docs-moves-in.md) | **done** (2026-10-22): parity walked; several windows fixed (`1ca83c0`) | — |
| 03 | [cad-a-2d-drafting-app](../briefs/done/03-cad-a-2d-drafting-app.md) | **done** (2026-10-22): spike passed; walked in the OS | — |
| 04 | [slides-that-edit](../briefs/done/04-slides-that-edit.md) | **done** (2026-10-22): built, spike passed; walk → 07 | — |
| 05 | [sheets-moves-in](../briefs/done/05-sheets-moves-in.md) | **done** (2026-10-22): built; walk → 08 | — |
| 06 | [one-pdf-app](../briefs/done/06-one-pdf-app.md) | **done** (2026-10-22): built, first page 237 ms vs 492 ms outside the OS; walk → 09 | — |
| 07 | [slides-walk-in-the-os](../briefs/done/07-slides-walk-in-the-os.md) | **done** (2026-10-27): every line passes; notes fix `8f5b2f6` | — ; OS 165 can run |
| 08 | [sheets-walk-in-the-os](../briefs/todo/08-sheets-walk-in-the-os.md) | **todo** (walked 2026-10-27): fails only on a formula-heavy 10 MB workbook (main thread blocked 4–6 s, in the built-in too); fixes `e57a4ea`, `a4b6134` | the owner's call on the freeze; then OS 166 |
| 09 | [pdf-walk-in-the-os](../briefs/todo/09-pdf-walk-in-the-os.md) | **todo** (walked 2026-10-27): fails only the timing gate (median 574 ms vs PDF Viewer's 534); fixes `8880663`, `184a761` | the owner's call on the gap; then OS 167 |
| 10 | [docs-find-as-you-type](../briefs/todo/10-docs-find-as-you-type.md) | **todo** | — |
| 11 | [cad-trim-picks-the-short-stub](../briefs/todo/11-cad-trim-picks-the-short-stub.md) | **todo** (filed 2026-10-23) | — |
| 12 | [docs-one-caret-with-several-windows](../briefs/todo/12-docs-one-caret-with-several-windows.md) | **todo** (filed 2026-10-23) | 10 |

Open todos: [Docs' caret in every window](../todos/2026-10-22-docs-caret-in-every-window.md),
[CAD's TRIM on short segments](../todos/2026-10-22-cad-trim-pick-on-short-stubs.md).
Test files for the walks: [test-files.md](test-files.md).

## Owed by the owner

- Decide whether PDF's first page, 40 ms behind PDF Viewer in the OS (brief
  09), holds back OS 167, and whether to brief the fix: the OS starting a kit
  app's import when its window opens, or fewer chunks on PDF's first path.
- Decide whether the formula freeze brief 08 found (a 10 MB workbook with
  220,000 formulas blocks Sheets for 4–6 s, the built-in too) holds back OS
  166, and whether to brief moving Univer's formula engine into a worker.
- Push this repo's `main` before imbatranimOS's: the OS's Office catalog entry
  (from its brief 164) pins a commit of this repo, and the OS clones it from
  GitHub at install.
- After the OS is deployed, install Office from Settings → Marketplace on the
  live machine; until then it has no office editor once a built-in retires.
