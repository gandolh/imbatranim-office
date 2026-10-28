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
