# Task 13 — Sheets: run Univer's formula engine in a worker

## Context

[Brief 08](../done/08-sheets-walk-in-the-os.md) walked Sheets in the OS. Every line
passed except the 10 MB one: a 10.6 MB workbook with 220,000 row-local formulas
blocks the main thread for 5.6 s after the grid appears (4.1 s with
LibreOffice's cached values). The built-in Sheets blocks for 4.4 s on the same
file. Parsing is already off the main thread (`apps/sheets/src/engine/xlsxWorker.ts`,
loaded by `xlsxBridge.ts`); the freeze is Univer's formula engine, which runs on
the main thread.

The owner decided on 2026-10-28 that the freeze does not hold back retiring the
built-in (imbatranimOS brief 166), and that the fix is this brief. It is not
urgent.

Univer can run its formula engine in a web worker: `UniverSheetsCorePreset`
takes a `workerURL`, and the worker side boots its own `createUniver` with the
preset's worker half (`@univerjs/preset-sheets-core/worker` in recent
versions). The app is pinned to Univer **0.25.1** (`apps/sheets/package.json`);
check that version's docs and package exports, not the latest.

The engine is set up in `apps/sheets/src/engine/univer.ts` (`createSheetEngine`).

Constraints that bite here (see `corpus/CLAUDE.md` and
[architecture.md](../../wiki/architecture.md)):

- The desktop's CSP is `script-src 'self'` with no `'wasm-unsafe-eval'`. A
  module worker served from the app's own files works (the xlsx worker loads as
  `workers/xlsxWorker-*.mjs`); a `blob:` worker or wasm does not.
- React, React DOM and `@imbatranim/ui` are lent by the desktop at runtime and
  external at bundle time. The worker must not import them or anything that
  touches `window`; it must bundle what it needs.
- Dirty tracking in `univer.ts` latches only on `sheet.command.*`, so formula
  recalculation (`sheet.mutation.*`) never marks a workbook edited. With the
  engine in a worker, results come back as mutations too; that must still hold.

## Files you OWN

- `apps/sheets/src/engine/univer.ts`, a new worker entry beside it (for example
  `apps/sheets/src/engine/formulaWorker.ts`), and their tests
- `apps/sheets/package.json` (only if the worker half needs another Univer
  package, pinned exactly at 0.25.1)
- `packages/shared/` build code, only if the OS build does not already emit a
  second worker the way it emits `xlsxWorker`
- corpus: this brief's outcome, `wiki/status.md`, `wiki/architecture.md` (the
  worker), `log.md`

## Files you must NOT touch

- `xlsxWorker.ts` and `xlsxBridge.ts`: parsing stays as it is.
- Univer's version. If 0.25.1 cannot run the engine in a worker, stop and
  record why in the outcome; an upgrade is its own brief.

## What to do

1. Find how Univer 0.25.1 runs the formula engine in a worker (the preset's
   option, the worker preset, what the worker file must call). Record it in the
   outcome with the package paths.
2. Add the worker entry and pass it through `UniverSheetsCorePreset`, loaded as
   a module worker from the app's own files, as `xlsxBridge.ts` does.
3. Make sure the OS build (`npm run build:os`) emits it under `workers/` and the
   descriptor template still matches the build (its test says so).
4. Saving must wait for a pending recalculation, or save the values as they
   are and say which in the outcome; never a half-computed sheet without
   knowing it.

## Acceptance

- The 10 MB workbook from [test-files.md](../../wiki/test-files.md), and the
  10.6 MB one with 220,000 row-local formulas from brief 08's walk: after the
  grid appears, no main-thread task longer than 200 ms, measured in Chrome's
  performance panel inside the OS's production image (as brief 08 measured).
  Record the numbers beside brief 08's.
- Formulas still compute: edit a cell a formula reads, and the result updates.
- Opening a formula-heavy workbook does not mark it edited; an edit does.
- No CSP violation or console error in the OS.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build:os` pass.

## Status (2026-10-28): built, one line fails narrowly; stays in todo

Built 2026-10-28 (`f4b26e3`) and walked in imbatranimOS `31a248c`'s
production image. The run was paused before the owner's call below.

**How Univer 0.25.1 does it.** `UniverSheetsCorePreset({ workerURL })`
(`@univerjs/preset-sheets-core/lib/es/index.js`) adds
`UniverRPCMainThreadPlugin` and passes `notExecuteFormula` to the sheets and
formula plugins. `@univerjs/preset-sheets-core/worker` exports
`UniverSheetsCoreWorkerPreset` (sheets with formula mutations only, the
formula engine, `UniverRPCWorkerThreadPlugin`,
`UniverRemoteSheetsFormulaPlugin`). The worker file boots `createUniver` with
it. The RPC plugin (`@univerjs/rpc`) takes `string | URL | Worker` and starts
a URL with `new Worker(url)`, a classic worker. So `univer.ts` starts
`formulaWorker.ts` as a module worker itself, passes the `Worker`, and
terminates it in `destroy` (Univer only terminates workers it started). The
OS build emits `workers/formulaWorker-*.mjs` (3.0 MB), plus 78 small chunks
the worker loads on demand; `osBuild.test.ts` checks the file and its URL.

**Saving waits.** `snapshot()` awaits the formula facade's
`onCalculationResultApplied(120 s)` (`@univerjs/sheets-formula`): it resolves
when the latest calculation's results are in the model, or after Univer's
500 ms start window when none runs. So an idle save waits up to 500 ms.
Past 120 s the save fails like any other and the workbook stays dirty.
`Sheets.tsx` awaits it, which is one change outside this brief's files and
which step 4 needs. Walked: A1 typed and Ctrl+S 100 ms later saved
C1 `=A1*B1` as 21, D1 `=C1+1` as 22, and a `SUM` 2,000 rows down updated
(openpyxl, `data_only`).

**Acceptance, line by line** (headless Chrome, a `longtask`
PerformanceObserver, a fresh browser per run, the grid counted from the
moment the loading note goes):

- **Fails narrowly: the formula workbook.** The 10.3 MB workbook with
  220,000 row-local formulas and no cached values. After the grid, the
  longest task is **210–285 ms in all 8 runs**, one task, within 60 ms of the
  grid; nothing else over 200 ms in the next 30 s. Before (`a9a054f`, same
  machine): a **6.8 s** task, then about 200 tasks of 50–125 ms over 25 s
  (brief 08: 5.6 s). A CPU profile names it: `TriggerCalculationController.
  _initialExecuteFormula` → `getFormulaDirtyRanges` (`@univerjs/sheets-
  formula`), the main-thread half scanning every formula cell for a missing
  value under the default `initialFormulaComputing: WHEN_EMPTY`. It does not
  move into the worker.
- **Pass: the values workbook** (9.6 MB): longest task after the grid
  104–129 ms (3 runs; before, 105 ms).
- New, before the grid: the task that loads the workbook grew from 0.56 s to
  0.72–0.86 s (one run 1.1 s), because `createWorkbook` posts the whole
  snapshot to the formula worker (about 0.38 s of structured clone).
  The grid appears in 4.6–6.4 s, as before (5.8 s); one cold first run after
  the install took 41.7 s.
- **Pass:** formulas compute (above); opening the formula workbook leaves
  the title clean through 30 s of recalculation; an edit sets the dirty mark
  and the save clears it; no CSP violation and no console error in any run;
  typecheck, lint (the old CAD warning), test, build:os, format:check.

The machine was shared with other agents: load average 16–33 on 16 cores
for most runs, so the numbers are noisy.

**Found, not this brief's: formulas past row 1000 compute `#NAME?`**, in the
build before this brief too. The xlsx mapping never sets `rowCount`, so
Univer keeps its default of 1000 rows. A single-cell reference past it
(`=A1001*2`) computes and saves as `#NAME?`; ranges (`SUM(A$1:A2000)`) are
right. So 95% of the big workbook's formulas errored instead of computing,
here and in brief 08. See the todo
[sheets-formulas-past-row-1000](../../todos/2026-10-28-sheets-formulas-past-row-1000.md).

**Scratch experiments** (in a `/tmp` clone, not committed), at load average
2–5:

- `rowCount` from the data: the `#NAME?` is gone. After the grid: 238, 280,
  366 and 396 ms tasks, one run under load at 2.7 s, and one run at 192 ms.
- `rowCount` plus `formula: { initialFormulaComputing: 0 }`
  (`CalculationMode.FORCED`): no main-thread scan. After the grid the longest
  task was **50–63 ms in 3 of 3 runs** (40 s each). That nothing longer came
  is measured; whether all results had been applied by then was not checked.
  FORCED recalculates every formula on open and replaces the file's cached
  values with Univer's. Where Univer lacks a function that Excel has, a value
  Excel computed would become an error, and a save would write it.

**For the owner:** accept 210–285 ms; switch to FORCED (fixes the line,
costs the cached values); or report the scan upstream. Fix the 1000-row bug
first in any case: it changes what the engine computes.

## Outcome (2026-10-28): closed, the owner accepted the scan

**Done.** `f4b26e3`. The owner accepted the 210–285 ms main-thread task
after the grid (Univer's `WHEN_EMPTY` scan in
`TriggerCalculationController._initialExecuteFormula`), so the acceptance
line it fails is waived and the brief closes as built. No switch to
`CalculationMode.FORCED` and no upstream report.

**Caveat.** The row-1000 bug made most of the 220,000-formula workbook's
formulas compute `#NAME?` (about 95% of them; every sheet has 22,000 rows
and Univer saw 1,000), so the numbers above are for an engine that mostly
erred. Brief 15 (`15-sheets-formulas-past-row-1000.md`) fixes the
bug and re-measures this workbook in the OS the way this brief did. Its
numbers stand on their own and do not reopen this brief.
