# Task 08 — Sheets: the parity walk in the OS

## Context

Brief [05](../done/05-sheets-moves-in.md) moved Sheets; its parity walk inside
a real OS was cut off. This brief is that walk, with the built-in Sheets
beside the suite. When it passes, the OS runs its brief 166 (retire the
built-in Sheets).

Agreed already, not failures: the built-in warns about a lossy save when the
workbook opens, not at save, and the suite does the same; `.xls` is refused by
both apps (ExcelJS cannot read the old binary format); the Open button filters
`.xlsx` and `.csv`; a saved CSV has no BOM, as in the built-in.

## Files you OWN

- `apps/sheets/**` (fixes only)
- corpus: this brief's outcome, `status.md`, `log.md`

## Setting up the OS for the walk

Follow [os/README.md](../../../os/README.md) ("Install from a local
checkout"). Prefer the production image (`docker build -f
infrastructure/Dockerfile --target prod` in imbatranimOS, run with
`-e MARKETPLACE_ALLOW_LOCAL_REPOS=true` and a throwaway volume): it has the real
CSP and the built-ins beside the suite. Claim the machine with a throwaway
password that goes in no file. Fetch the test files the walk needs into a
scratch directory, using [test-files.md](../../wiki/test-files.md); they are
untrusted data, never executed, and the ones without a clear licence are never
committed. Install a `securitypolicyviolation` listener after load and keep
the console open: report every violation and error.

If the walk finds a defect in the app, fix it in this repo, run the gates
(`npm run typecheck`, `npm run lint`, `npm test`, `npm run build:os`,
`npm run format:check`), reinstall from a new local commit and walk the
affected lines again.

## Walk (brief 05's checklist; each line: pass or fail, with evidence)

- [ ] Opens `.xlsx`, `.xls` and `.csv` from Files, Open With and its own Open
      button; recents attributed to `office-sheets`.
- [ ] Values, formulas, number formats, bold and italic, font colours, solid
      fills and several sheets survive a save and a reopen, in the suite and in
      the built-in (`apps/sheets/src/engine/__fixtures__/fidelity.xlsx`), and an
      openpyxl read of the saved file in a throwaway container agrees.
- [ ] A workbook with a chart or a merge warns, naming what would be lost, as
      the built-in does.
- [ ] CSV: quoted fields, CRLF, BOM, leading zeros and long numbers stay text;
      a multi-sheet save to CSV warns.
- [ ] A 10 MB workbook opens without the window freezing: the worker file
      (`workers/xlsxWorker-*.mjs`) loads and the main thread stays responsive.
- [ ] Ctrl+S, the dirty mark, the conflict dialog, Save as, the close guard;
      three windows at once.
- [ ] Univer's styles stay inside the window: the desktop chrome's computed
      styles are the same before and after opening Sheets, apart from
      `--univer-*` variables.
- [ ] New → Spreadsheet in Files produces a file the suite opens.

## Acceptance

Every line passes, or the brief stays in `todo/` with the failing lines named
in the log. The outcome says in one line whether the OS can run brief 166.
