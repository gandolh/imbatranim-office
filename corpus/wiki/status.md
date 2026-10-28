---
summary: Current snapshot (2026-10-28): all five apps built on main and walked in the OS; briefs 01–13 done (10 Docs find box, 11 CAD TRIM pick, 12 Docs caret: no SuperDoc option, the owner lives with it; 13 Sheets' formulas in a worker, its 210–285 ms scan accepted); 15 (Sheets' formulas past row 1000, and 13's re-measure) and 14 (CAD DWG through a suite server) to build, in that order; no open todos; nothing pushed.
updated: 2026-10-28
---

# Status — 2026-10-28

**Phase: built and walked.** `main` has the scaffold and all five apps;
`npm run build:os` builds them into `dist/os`, and `os/descriptor.template.json`
lists them. All five were walked inside a real OS (dev container and the
production image, under its CSP); the last two walks, briefs 08 and 09, closed
on 2026-10-28. What is left are fixes and one feature, one brief at a time.

## Order

Each walk brief unblocks one imbatranimOS brief that retires a built-in:
Docs is ready (OS 164, which also commits the catalog's Office entry);
Slides is ready (07 → OS 165); Sheets and PDF are ready too (08 → OS 166,
09 → OS 167): on 2026-10-28 the owner let the formula freeze and the 40 ms
first-page gap through, each fix its own brief (13 here, 182 in the OS).
Briefs 14 and 15 are independent; 15 runs first.

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
| 08 | [sheets-walk-in-the-os](../briefs/done/08-sheets-walk-in-the-os.md) | **done** (2026-10-28): seven lines pass; the 10 MB formula freeze, which the built-in shares, cleared by the owner → brief 13; fixes `e57a4ea`, `a4b6134` | — ; OS 166 can run |
| 09 | [pdf-walk-in-the-os](../briefs/done/09-pdf-walk-in-the-os.md) | **done** (2026-10-28): nine lines pass; the 40 ms first-page gap (574 vs 534 ms) cleared by the owner → imbatranimOS brief 182; fixes `8880663`, `184a761` | — ; OS 167 can run |
| 10 | [docs-find-as-you-type](../briefs/done/10-docs-find-as-you-type.md) | **done** (2026-10-28): focus handed back after SuperDoc's `goToSearchResult`, find bar marked as editor UI; walked in the OS (`d5f0631`) | — |
| 11 | [cad-trim-picks-the-short-stub](../briefs/done/11-cad-trim-picks-the-short-stub.md) | **done** (2026-10-28): the object prompt passes over refused objects; TRIM and EXTEND break near-ties by the nearer end (`2c1d254`) | — |
| 12 | [docs-one-caret-with-several-windows](../briefs/done/12-docs-one-caret-with-several-windows.md) | **done** (2026-10-28) by its step 3: SuperDoc 1.46.3 has no caret option, nothing changed; three windows walked (typing, header, find all go to the focused window; carets stay in every window with a header session open); the owner lives with it, a known gap ([todo](../todos/2026-10-22-docs-caret-in-every-window.md), closed) | — |
| 13 | [sheets-formulas-in-a-worker](../briefs/done/13-sheets-formulas-in-a-worker.md) | **done** (2026-10-28, `f4b26e3`): the formula engine runs in `workers/formulaWorker-*.mjs`, the 6.8 s freeze is gone and saves wait for results; one 210–285 ms task after the grid (Univer's main-thread `WHEN_EMPTY` scan), **accepted by the owner**. Measured while the row-1000 bug made most formulas error; 15 re-measures | — |
| 14 | [cad-opens-dwg-through-a-suite-server](../briefs/todo/14-cad-opens-dwg-through-a-suite-server.md) | **todo** (filed 2026-10-28, the owner's call): LibreDWG converts DWG to DXF on the suite's first server; spike the wasm route first, stop before changing the OS image. Runs after 15 | — |
| 15 | [sheets-formulas-past-row-1000](../briefs/todo/15-sheets-formulas-past-row-1000.md) | **todo** (filed 2026-10-28 from a todo): `rowCount` from the data so single-cell references past row 1000 compute instead of `#NAME?`; re-measure brief 13's 220,000-formula workbook in the OS; over 1 s → a todo for the owner | — |

Open todos: none.
Test files for the walks: [test-files.md](test-files.md).

## Owed by the owner

- ~~Decide on the formula worker's 210–285 ms task (brief 13)~~ **answered
  2026-10-28:** accepted; [brief 13](../briefs/done/13-sheets-formulas-in-a-worker.md)
  is closed, and [brief 15](../briefs/todo/15-sheets-formulas-past-row-1000.md)
  fixes the row-1000 bug and re-measures.
- ~~Decide on the 40 ms first-page gap (brief 09)~~ **answered 2026-10-28:**
  it does not hold back OS 167. The fix is imbatranimOS brief 182: the OS
  starts a kit app's import when its window opens, which helps every kit app.
- ~~Decide on the formula freeze (brief 08)~~ **answered 2026-10-28:** it does
  not hold back OS 166. [Brief 13](../briefs/done/13-sheets-formulas-in-a-worker.md) moves Univer's
  formula engine into a worker, not urgent.
- Push this repo's `main` before imbatranimOS's: the OS's Office catalog entry
  (from its brief 164) pins a commit of this repo, and the OS clones it from
  GitHub at install.
- After the OS is deployed, install Office from Settings → Marketplace on the
  live machine; until then it has no office editor once a built-in retires.
