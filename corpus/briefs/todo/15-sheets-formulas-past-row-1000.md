# Task 15 — Sheets: formulas past row 1000 compute

## Context

Promoted 2026-10-28 from the todo
[2026-10-28-sheets-formulas-past-row-1000](../../todos/2026-10-28-sheets-formulas-past-row-1000.md),
found in [brief 13](../done/13-sheets-formulas-in-a-worker.md)'s walk and
present before it (`a9a054f`).

A workbook of 2,000 rows (`calc-small.xlsx` in
[test-files.md](../../wiki/test-files.md): `=A{r}*2` in column B,
`=SUM(A$1:A{r})` in column C), opened, edited and saved: openpyxl reads
B1001 to B2000 back as `#NAME?` with their formulas intact. Column C is right.

The cause (checked 2026-10-28): `parse` in
`apps/sheets/src/engine/xlsxMapping.ts` builds each sheet with `columnCount`
from the data (`Math.max(maxCol + 1, 20)`) and no `rowCount`, so Univer keeps
its default of 1,000 rows. A single-cell reference past that row computes
`#NAME?`, and the save writes it as the cached value. `csvToUniver` in
`apps/sheets/src/engine/csv.ts` has the same shape. In a scratch build,
`rowCount: Math.max(maxRow + 1, 1000)` made the case compute.

Brief 13's numbers for the 220,000-formula workbook (`big-formulas.xlsx`,
5 sheets × 22,000 rows) were taken with about 95% of its formulas erroring.
The owner accepted that brief's 210–285 ms task after the grid and closed
it; this brief re-measures the workbook once the formulas really compute.
In brief 13's scratch build with `rowCount` set, the longest task after the
grid was 192–396 ms, and one run under load reached 2.7 s.

The built-in Sheets in imbatranimOS has the same two lines
(`apps/add-ons/sheets/src/engine/xlsxMapping.ts` and `csv.ts` at
`31a248c`). That copy is the OS's and retires with OS brief 166.

## Files you OWN

- `apps/sheets/src/engine/xlsxMapping.ts` (`parse` only) and `csv.ts`
  (`csvToUniver` only), and their tests (`fidelity.test.ts`, `csv.test.ts`, or
  a new test beside them)
- corpus: this brief's outcome, `wiki/status.md`, `wiki/test-files.md`,
  `log.md`, and a todo if the last acceptance line asks for one

## Files you must NOT touch

- `apps/sheets/src/engine/univer.ts`'s formula options. Switching to
  `CalculationMode.FORCED` would reopen brief 13, which is closed.
- Univer's version.
- `xlsxWorker.ts` and `xlsxBridge.ts` (the worker imports the mapping; that
  is enough).
- imbatranimOS, including its built-in Sheets.

## What to do

1. Write the failing test first: a workbook mapped by `parse` with a formula
   in row 1,500 that reads a cell in row 1,500 has a `rowCount` that covers
   it. The same for `csvToUniver` with 1,500 rows. Then check in Univer itself
   (the fake system or a headless Univer in the test, whichever the existing
   tests already boot) that such a formula computes a number, if that can be
   done without a browser.
2. Track the last row as `parse` and `csvToUniver` already track the last
   column, and set `rowCount: Math.max(maxRow + 1, 1000)`. Keep Univer's
   1,000 rows and 20 columns as the floor, so a small file still has room to
   type in.
3. Check what a single-cell reference past the last row or column with data
   computes (`=A5000` in a 2,000-row sheet; `=AA1` when the data ends at
   column C). Excel gives 0 for an empty cell. Either the extent covers such
   references, or the outcome records the gap and its size. Do not set a
   million rows without measuring what it costs the grid.
4. Walk it in the OS (below), then re-measure.

## Acceptance

- `calc-small.xlsx` in the OS: open, edit A1, save. openpyxl (`data_only`)
  reads B1001 to B2000 back as numbers (`2 × A`), and C2000 as the sum.
- `big-formulas.xlsx` really computes: after it opens and settles, a save
  (or a copy saved under a new name) read with openpyxl has no `#NAME?` in
  columns H and I; any other error is counted and named in the outcome.
- **Re-measure brief 13's workbook**, inside imbatranimOS `31a248c`'s
  production image, the way brief 13 did: headless Chrome, a `longtask`
  PerformanceObserver, a fresh browser per run, the grid counted from the
  moment the loading note goes, 25–40 s watched after it. Record for each run
  the time to the grid, the longest task before the grid, the longest after
  it, and the count over 200 ms, with the 1-minute load average (`uptime`)
  beside each number. At least five runs, taken when the load is low where
  possible. `big-values.xlsx` once, as the control.
- A longest task after the grid above brief 13's 210–285 ms is recorded, not
  failed. If one over **1 s** comes back once the formulas compute, at low
  load, write a todo for the owner with the numbers and a CPU profile's
  culprit. Brief 13 stays closed either way.
- Opening a formula workbook does not mark it edited; an edit does. No CSP
  violation or console error.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build:os`,
  `npm run format:check` pass.
