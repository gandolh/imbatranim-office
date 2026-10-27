# Log

## [2026-10-21] decision | The repo starts: the office apps leave imbatranimOS

The owner created the repo after a grilling held in the imbatranimOS corpus (its `corpus/wiki/decisions-office-suite.md`). The ArtCraft crafts were not brought into the OS as sandboxed canvases (OS brief 161, superseded). Instead the OS's office apps move here: Docs, Sheets, Slides, PDF (PDF Viewer and norPDF merged) and a new CAD app, in TypeScript with editing in the browser, installed by one suite descriptor in the OS repo, and rendered with the desktop's own React and kit. The crafts stay as the behaviour reference. The calls, from this side, are in [decisions.md](wiki/decisions.md); the vocabulary in [glossary.md](wiki/glossary.md). The owner picked the name after openBureau turned out to be taken.

## [2026-10-21] todo | Corpus bootstrapped; briefs 01–06 filed

The corpus follows the imbatranimOS one (same lint, same rules) with this repo's invariants in [CLAUDE.md](CLAUDE.md): AGPL-3.0, TypeScript only, no WebAssembly in the apps, the shared kit, the crafts as reference, no hosted CI. [craft-reference.md](wiki/craft-reference.md) maps each app to its craft and names the parity documents to read. Six briefs: [01](briefs/done/01-scaffold-and-a-smoke-app.md) the scaffold, the kit snapshot, the externals and a smoke app; [02](briefs/done/02-docs-moves-in.md) Docs moved with a parity checklist; [03](briefs/done/03-cad-a-2d-drafting-app.md) CAD, spike-gated, with a library shortlist (DXF read via dxf-parser or dxf-viewer's parser, write via @tarikjabiri/dxf, geometry via @flatten-js/core and clipper2-ts, rbush, our own Canvas 2D renderer) and DWG out of scope because every browser reader needs wasm; [04](briefs/done/04-slides-that-edit.md) Slides editing, spike-gated on saving by patching the package in place (pptxtojson as a reading aid, PptxGenJS for new decks, PPTist as a UX reference); [05](briefs/done/05-sheets-moves-in.md) Sheets moved; [06](briefs/done/06-one-pdf-app.md) one PDF app whose first page must be as fast as PDF Viewer's. The OS side is imbatranimOS briefs 162, 163 and 164.

## [2026-10-21] build | Brief 01 done: the scaffold, the OS build and a smoke app

npm workspaces, exact pins, and `npm run build:os`: one Vite library build with an entry per app, shared chunks and workers as files, run as is in the OS's install container (`2c57c37`). React, React DOM and `@imbatranim/ui` become reads from the global the desktop lends; app CSS is Tailwind utilities only against the kit snapshot's tokens. The snapshot was provisional until imbatranimOS brief 163 landed, then pinned to OS `4e233b9` with `kit:sync` (`92fb703`), which also added the descriptor template and its in-step test. The smoke app opened in three windows in the OS dev container, followed the accent and read its file in a worker; in the production image, under the real CSP, the Marketplace pane installed the suite in 28 s with no violation. The stylesheet rules moved to their own page, [stylesheets.md](wiki/stylesheets.md), when architecture.md passed its line cap. [Brief 01](briefs/done/01-scaffold-and-a-smoke-app.md) carries the outcome.

## [2026-10-22] pause | Resume point for the office-suite run

Paused by the owner mid-run. The owner's calls for the run (2026-10-21): retire each built-in (OS brief 164) on the agent's own parity pass, one commit per app; the agent sources the test files; commit freely, never push. Push order owed by the owner: imbatranim-office, then imbatranimOS, deploy, then install Office from the Marketplace pane.

**Done.** OS briefs 162 (`9394ea6`) and 163 (`5f3f5aa`), each with a corpus commit, version 1.24.0. Office brief 01 (closed out), and on `main` (`141e5aa`) the code for 02 Docs, 03 CAD, 04 Slides, 05 Sheets and 06 PDF, with all five apps in `os/descriptor.template.json`. Docs' parity walk passed 12 lines, Save as is n/a, and "three windows" fails, in the built-in too: SuperDoc 1.45's window-level input bridge steals keystrokes between instances. CAD's in-OS walk passed every acceptance line under the production CSP.

**In flight when paused** (working copies, nothing committed): the SuperDoc multi-window fix (worktree `wt-docsfix`); the in-OS walks of Slides, Sheets and PDF, each in its own production-image container (`walk-slides` 8092, `walk-sheets` 8093, `walk-pdf` 8094, image `imbatranimos:walk-4e233b9`) with fixes in worktrees `wt-walk-<app>`. Worktrees and test files are under the session scratchpad (`/tmp/claude-1000/…/scratchpad/`: `wt/`, `fixtures/MANIFEST.md`, `progress/` walk plans and descriptor entries).

**Next, in order.** Merge the docs fix and any walk fixes into `main`. Close out briefs 02–06 (decision entries for CAD's engine and Slides' save strategy are drafted in `progress/cad-decision.md` and `progress/slides-decision.md`). Then OS brief 164 per app, one commit each: Docs first, which also commits `marketplace/imbatranim-office.json` (the template pinned to the tested office commit); then Slides, Sheets, and the PDF pair. Known for 164: the duplicate "Docs"/"Sheets" labels until each built-in goes; an OS todo to file: activating a window from the taskbar leaves focus on the taskbar button.

## [2026-10-22] build | Briefs 02–06 built; the rest split into four small briefs

All five apps are on `main` and in the descriptor template. **Docs** (02) walked its parity checklist in the OS; "three windows" failed in the built-in too, because SuperDoc's window-level input bridge takes keystrokes from every other instance, and `1ca83c0` fixes it in the suite by marking each instance's active editor surface. **CAD** (03) passed its spike (Canvas 2D at 60 fps on 10,053 lines, so no WebGL) and its in-OS walk: a 10×8 room drawn with typed coordinates, saved and read back by ezdxf and LibreCAD. **Slides** (04) passed its spike: a save patches the package in place, and on three real decks every untouched part came back byte identical. **Sheets** (05) needed two declared allowances for Univer's stylesheet. **PDF** (06) draws its first page in a median 237 ms against PDF Viewer's 492 ms, outside the OS. The calls for CAD's engine and Slides' save strategy are in [decisions.md](wiki/decisions.md).

The in-OS walks of Slides, Sheets and PDF were cut off by a session limit, and a restart wiped the session scratch (test files, walk notes). The owner paused the run to continue brief by brief. Those walks are now [07](briefs/done/07-slides-walk-in-the-os.md), [08](briefs/todo/08-sheets-walk-in-the-os.md) and [09](briefs/todo/09-pdf-walk-in-the-os.md); [10](briefs/todo/10-docs-find-as-you-type.md) is a bug the Docs walk found in the built-in too. [test-files.md](wiki/test-files.md) records where every test file came from, so they can be fetched again. The resume point above is superseded by this entry.

## [2026-10-23] todo | Briefs 11 and 12 from the two walk todos

[11](briefs/todo/11-cad-trim-picks-the-short-stub.md): TRIM and EXTEND rank every
candidate in the pick box and prefer the one whose nearer end is closer to the pick,
so a 0.2-unit stub at a corner wins over the wall; today `pick` keeps only the nearest
and the filter runs after. [12](briefs/todo/12-docs-one-caret-with-several-windows.md):
one blinking caret with several Docs windows; reading SuperDoc 1.46.3 for an option is
step one, and if there is none it stops and reports. It runs after 10, which owns
`apps/docs/**`.

## [2026-10-27] build | Brief 07 done: Slides walked in the OS

[Brief 07](briefs/done/07-slides-walk-in-the-os.md) walked Slides in imbatranimOS
`74dfe27`'s production image, with the built-in beside it. Every line passes:
viewer parity, opening from Files, Open With, the Open button and Recent, the
`.ppt` refusal, the full edit round on the three test decks, LibreOffice
conversions with every untouched zip entry byte identical, the conflict
dialog's three answers, Save as, the close guard, New presentation, three
windows, and no CSP violation. The walk found one defect: the notes box dropped
the first key typed after a pause. It is fixed in `8f5b2f6` and was re-walked.
The image was a local build run in a container of its own (port 8092, a
throwaway volume), not the dev profile. The OS can run its brief 165.

## [2026-10-27] build | Brief 08 walked: seven lines pass, a formula-heavy workbook freezes the window; stays in todo

[Brief 08](briefs/todo/08-sheets-walk-in-the-os.md) walked Sheets in imbatranimOS
`74dfe27`'s production image, with the built-in beside it. It found two
defects, both in the built-in too, and fixed them in the suite. `e57a4ea`: an
`.xls` opened as an empty grid that a save would write over (ExcelJS loads it
as a workbook with no sheets); the suite now refuses it by name, and refuses
an OLE2 or non-zip file named `.xlsx` from its first bytes. `a4b6134`: every
`.xlsx` save failed ("Value at index 0 does not have a transferable type"),
because the worker put ExcelJS's Buffer in its transfer list; it now hands
back an ArrayBuffer. The built-in Sheets in this image cannot save an
`.xlsx` at all.

After the fixes, seven lines pass. Opening from Files, Open With, the Open
button and Recent works, attributed to `office-sheets`. Fidelity holds:
openpyxl reads back values, formulas, number formats, bold, italic, colours,
fills and both sheets of `fidelity.xlsx` and `styles.xlsx`; the built-in's
round trip could not be compared, since it cannot save. The chart and merge
warnings name the same features as the built-in's. CSV keeps quoted fields,
CRLF, leading zeros and 20-digit numbers as text, drops the BOM, and warns
before a multi-sheet save (both answers walked). The conflict dialog's
three answers, the close guard's three answers and three windows saving
their own files all pass; Save as is n/a, since neither app has one, as in
Docs' brief 02. Univer's styles stay in the window: twelve desktop elements
kept every computed property apart from stacking. New Spreadsheet in Files
opened, saved and read back.

**Fails: the 10 MB line.** The parse runs in `workers/xlsxWorker-*.mjs` and a
values-only 10.2 MB workbook opens with one 323 ms task. A 10.6 MB workbook
with 220,000 row-local formulas blocks the main thread for 5.6 s after the
grid appears (the built-in 4.4 s), and 4.1 s with LibreOffice's cached values.
Univer's formula engine runs on the main thread. Moving it into a worker
(`UniverSheetsCorePreset({ workerURL })`) is a new brief, not a walk fix; the
owner decides whether the freeze, which the built-in shares, holds back OS
brief 166.

Also seen: a running-total formula on every row (`=SUM(C$2:Cn)`) hung the tab
for minutes in the suite. `[redi]` "loaded more than once" console errors
appeared in pages where the built-in Sheets had also loaded; a freshly loaded
page with two suite windows logged nothing. The lossy warning reads "lose
it" for "charts", in both apps. test-files.md names `47813-real-chart.xlsx`,
which POI does not have; the walk used `47813.xlsx` and `WithChart.xlsx`.
