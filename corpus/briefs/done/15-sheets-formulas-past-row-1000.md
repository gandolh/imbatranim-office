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

## Outcome (2026-10-28)

**Done.** `028f5ca`. Every acceptance line passes or is recorded; the 1 s
line fired once the formulas really computed, so the owner has a
[todo](../../todos/2026-10-28-sheets-big-first-calculation.md).

**The fix.** A new `apps/sheets/src/engine/extent.ts` sizes each sheet:
`parse` notes every cell with data and every cell a formula anywhere in the
workbook points at by a single-cell reference (its own sheet or a named one,
`'Quoted sheet'!B3` too), and sets `rowCount` and `columnCount` from the
furthest, never under Univer's 1,000 × 20 and never past Excel's
1,048,576 × 16,384. Ranges are left out: Univer computes `SUM(A1:A5000)` and
`SUM(A2500:A2600)` past the edge, checked in a headless Univer.
`csvToUniver` gets rows for every line. String literals are skipped, so
`INDIRECT("A5000")` past the data still computes `#NAME?` (it cannot be known
without running it).

**Tests** (`extent.test.ts`): the reference scanner (absolute, quoted and
Unicode sheet names, ranges, `LOG10(`, `1E5`, string literals, Excel's
bounds); the sizes `parse` and `csvToUniver` give; and the formulas run in a
headless Univer (0.25.1's Node preset): B1001 to B1500 compute, `=A5000`,
`=AA1+1` and `='Other sheet'!B3000` past the data compute as Excel does (0,
1, 0), and a control without the sizes still computes `#NAME?` at B1001.

**In the OS** (imbatranimOS `31a248c`'s production image, suite at the
commit's tree, headless Chrome):

- `calc-small.xlsx`: open (title clean), A1 = 7 (dirty), Ctrl+S 100 ms later
  (clean). openpyxl reads B1001 to B2000 as 2 × A, every C row as its sum,
  C2000 = 2,001,006. No CSP violation, no console error.
- `big-formulas.xlsx` really computes, **once its first calculation is
  done**: saved after it, all 220,000 values in H and I came back as numbers,
  every one equal to `B×C` or `SUM(D:G)`; no `#NAME?`, no other error. That
  calculation now takes 4.6–5.3 minutes after the grid (load 20–40), against
  about 25 s when 95% of it erred. A save at 58 s, after an edit, wrote the
  formulas with no cached values at all (see the todo).
- **Re-measured as brief 13 did** (30 s after the grid, fresh browser each,
  `longtask` observer). No run found the 1-minute load under 6 in 25
  minutes, so these are at load 12–26:

| Run | Load | Grid after open | Longest before the grid | Longest after | Over 200 ms after |
|---|---|---|---|---|---|
| 1 | 18.0 → 13.8 | 10.9 s | 1,824 ms | 693 ms | 1 |
| 2 | 18.7 → 18.4 | 14.5 s | 1,979 ms | 611 ms | 1 |
| 3 | 18.4 → 12.3 | 6.6 s | 1,004 ms | 287 ms | 1 |
| 4 | 12.3 → 18.2 | 11.7 s | 2,443 ms | 893 ms | 1 |
| 5 | 18.2 → 22.0 | 16.5 s | 2,353 ms | 785 ms | 1 |
| 6 | 22.0 → 25.9 | 13.1 s | 1,952 ms | 1,305 ms | 1 |
| 7 | 25.9 → 16.9 | 6.4 s | 1,059 ms | 399 ms | 1 |
| 8 (profiled) | 14.2 → 12.4 | 12.1 s | 1,296 ms | 309 ms | 1 |
| `big-values.xlsx` | 16.2 → 13.7 | 7.6 s | 1,157 ms | 173 ms | 0 |

  Brief 13 had 210–285 ms after the grid and 0.72–0.86 s before it, at load
  16–33. The one task after the grid is the same `WHEN_EMPTY` scan
  (`getFormulaDirtyRanges`, `forValue`), now over 22,000 rows a sheet instead
  of 1,000; the profile has it at 204 ms. The task before the grid is the
  same work as brief 13's profile, `createWorkbook` posting the snapshot to
  the formula worker (`postMessage` 43% self), with row layout
  (`_generateRowMatrixCache`) at 1%: the load, not the new `rowCount`, is the
  likelier cause of its length, but no same-load baseline was taken.
- **Past brief 13's window**, two runs watched until the calculation ended:
  15 and 2 main-thread tasks over 1 s, the longest 4.0 s and 2.7 s, in bursts
  while the worker's results arrive (load 20–41). The profile names the RPC
  listener's deserialization, writing the values, GC and a redraw. Over 1 s,
  so the [todo](../../todos/2026-10-28-sheets-big-first-calculation.md) for
  the owner has the numbers; brief 13 stays closed.
- `far-ref.xlsx` (one `=A1048576`, so a 1,048,576-row sheet): the grid in
  1.6–2.1 s, no task over 366 ms (2 runs, load 11–13). Scrolling it was not
  tried.
- Opening never set the dirty mark (calc-small; big-formulas through 40 s);
  an edit did. No CSP violation and no console error in any of the 13 runs.

Gates: typecheck, lint (the one old CAD warning), test (518 passed),
build:os, format:check. The OS's built-in Sheets has the same two lines
(`apps/add-ons/sheets/src/engine/xlsxMapping.ts` and `csv.ts` at `31a248c`);
it is not fixed there and retires with OS brief 166.
