# Task 05 — Sheets moves in

## Context

The OS's built-in Sheets (`apps/add-ons/sheets` in the OS repo, checked
2026-10-21) is Univer for the grid and an ExcelJS bridge for `.xlsx`, run in a
module worker (`engine/xlsxWorker.ts`) so large workbooks don't block the UI.
`engine/xlsxScan.ts` reads the zip before ExcelJS does and warns when a save
would drop what the bridge cannot map (charts, images, pivots, conditional
formatting, validation, names, comments, merges, frozen panes): "Some of this
workbook cannot be saved". CSV is parsed and written by `engine/csv.ts`, with a
"CSV saves one sheet only" warning. Manifest: id `sheets`,
`opens: ['xlsx', 'xls', 'csv']`, `multiInstance: true`, 900×560, minimum
600×380. Tests: `csv.test.ts`, `fidelity.test.ts`.

The behaviour reference for anything beyond parity is GridCraft (see
[craft-reference.md](../../wiki/craft-reference.md)); this brief is a move, not
new features.

Depends on brief 01, and in practice on 02 (Docs proves the move pattern
first). When it reaches parity, the OS runs brief 164 for Sheets.

## Files you OWN

- `apps/sheets/**`
- `os/descriptor.template.json` (the `office-sheets` entry)
- corpus: `status.md`, `log.md`, the parity outcome note

## What to do

1. Copy the built-in's `src/` from a named OS commit; record it in the log.
2. Replace the add-on manifest with the kit-app module (`export const App`), as
   brief 02 did for Docs.
3. Pin `@univerjs/presets` and `@univerjs/preset-sheets-core` (0.25.1 resolved
   on 2026-10-21), `exceljs` (4.4.0) and `fflate` (0.4.8) exactly.
4. **The worker must be a file.** The OS's CSP refuses `blob:` workers, which is
   why the scan uses fflate's synchronous API. Make sure `build:os` emits
   `xlsxWorker` as its own file beside `app.mjs` and that the app loads it by
   URL relative to the module (`new URL(..., import.meta.url)`), not inlined.
5. **Univer's CSS.** Univer ships its own stylesheet. It goes in the app's
   `styles` list, scoped as the built-in scopes it, and must not restyle the
   desktop outside the window. Check the desktop's chrome before and after.
6. Descriptor entry: `office-sheets`, name `Sheets`,
   `opens: ["xlsx", "xls", "csv"]`, `multiInstance: true`, icon `table`, the
   built-in's sizes.
7. Walk the parity checklist in Chrome with the suite installed and the
   built-in beside it.

## Parity checklist

- [ ] Opens `.xlsx`, `.xls` and `.csv` from Files, Open With and its own Open
      button; recents attributed to the suite app.
- [ ] The fidelity bar the built-in passed: values, formulas, number formats,
      bold and italic, font colours, solid fills, several sheets, all surviving
      a save and a reopen (the moved `fidelity.test.ts` passes, and an openpyxl
      read of a saved file in a scratch environment agrees).
- [ ] A workbook with a chart or a merge warns before saving, naming what
      would be lost, and both answers work.
- [ ] CSV: quoted fields, CRLF, BOM, leading zeros and long numbers stay text;
      a multi-sheet save to CSV warns.
- [ ] A 10 MB workbook opens without the window freezing (the worker is in
      use: check the Performance panel).
- [ ] Ctrl+S, the dirty mark, the save conflict dialog, Save as, the close
      guard: as in Docs.
- [ ] Three windows at once.
- [ ] Univer's styles stay inside the window.
- [ ] New → Spreadsheet in Files produces a file the suite app opens.

## Acceptance

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build:os` pass;
  `dist/os/sheets/` holds the worker as a separate file.
- Every parity line is ticked, or the brief stays in `todo/` with the failures
  named in the log.
- The outcome note says whether the OS can run brief 164 for Sheets.

## Outcome (2026-10-22)

**Built in `592e358`; the in-OS parity walk moves to brief
[08](../todo/08-sheets-walk-in-the-os.md).** Copied from imbatranimOS
`56e23b7`; Univer 0.25.1, ExcelJS 4.4.0 and fflate 0.4.8 keep the built-in's
pins. The xlsx worker is a file in `dist/os/workers/`. It is shared by every
Sheets window, so it is now refcounted and stopped only when no window holds
it and nothing is in flight: closing a window during a save no longer loses
the write. Univer's stylesheet needed two declared allowances, its `--univer-`
namespace and one dropped scrollbar reset
([stylesheets.md](../../wiki/stylesheets.md)). Gates and the OS's install
container pass. The in-OS walk was cut off by the session limit.
