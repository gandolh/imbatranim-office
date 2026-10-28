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

The in-OS walks of Slides, Sheets and PDF were cut off by a session limit, and a restart wiped the session scratch (test files, walk notes). The owner paused the run to continue brief by brief. Those walks are now [07](briefs/done/07-slides-walk-in-the-os.md), [08](briefs/done/08-sheets-walk-in-the-os.md) and [09](briefs/done/09-pdf-walk-in-the-os.md); [10](briefs/done/10-docs-find-as-you-type.md) is a bug the Docs walk found in the built-in too. [test-files.md](wiki/test-files.md) records where every test file came from, so they can be fetched again. The resume point above is superseded by this entry.

## [2026-10-23] todo | Briefs 11 and 12 from the two walk todos

[11](briefs/done/11-cad-trim-picks-the-short-stub.md): TRIM and EXTEND rank every
candidate in the pick box and prefer the one whose nearer end is closer to the pick,
so a 0.2-unit stub at a corner wins over the wall; today `pick` keeps only the nearest
and the filter runs after. [12](briefs/done/12-docs-one-caret-with-several-windows.md):
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

[Brief 08](briefs/done/08-sheets-walk-in-the-os.md) walked Sheets in imbatranimOS
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

## [2026-10-28] build | Brief 09 walked: nine lines pass, the timing gate fails; stays in todo

[Brief 09](briefs/done/09-pdf-walk-in-the-os.md) walked PDF in imbatranimOS
`74dfe27`'s production image beside PDF Viewer and norPDF. **The timing gate
fails.** From the Open With click to ink on the 36-page NIST file, a fresh
browser per run, 7 runs each, alternating: PDF Viewer 513, 518, 521, 534, 534,
542, 720 ms (median 534); the suite 550, 567, 571, 574, 606, 607, 608 (median
574). Before `8880663` the medians were 518 and 571. That fix starts pdf.js and
its worker while the file downloads, as `warmUpPdfjs` intended; nothing called
it before. The rest of the gap comes before the download: the suite's `app.mjs`
and ten shared chunks load from the marketplace route after the window mounts
(about 70 ms, past Chrome's six connections), while PDF Viewer's chunk loads
when the window opens. Closing it is an OS change (start a kit app's import
when its window opens) or a build change (fewer first-path chunks), neither in
this brief's files. The numbers are in [pdf.md](wiki/pdf.md).

The other nine lines pass. Zoom steps by 25% as PDF Viewer's; paging and the
keyboard work (PDF Viewer has no keys). Outline, thumbnails and search (31
matches, previous and next wrap) work; Enter in the search box restarts at the
first match, as in norPDF. All nine annotate tools saved, showed after a
reopen, and a second save added only the new one. Organise reordered, rotated,
deleted, inserted a blank page and extracted two pages (pypdf agrees). A drawn
stamp and a typed signature in the field saved and render in poppler.
`Ctrl+S` on an untouched file left its checksum and mtime alone. Files, Open
With, recents (`office-pdf`), the dirty mark, the conflict dialog's three
answers, the close guard's three answers and three windows saving their own
files all pass. The Open button uses the OS's dialog. The worker loads as
`workers/pdf.worker-*.mjs`, and no CSP violation or console error came up.

**Fixed.** `184a761`: the W-9's one-letter field took "Walk LLC" and Save failed
("Attempted to set text with length=8 for TextField with maxLength=1"). Fields
now report their `/MaxLen`, `Forms.set` refuses longer values and the input
stops at the limit. The re-walk saved the W-9 with both prefilled fields intact.

Briefs 10 and 11 were not started: the owner paused the run on 2026-10-28.

## [2026-10-28] decision | Briefs 08 and 09's failures don't hold back OS 166 and 167

The owner answered both walks' questions. The formula freeze (a 10 MB workbook
with 220,000 formulas, which the built-in shares) and PDF's first page 40 ms
behind PDF Viewer do not hold back retiring the built-ins: OS 166 and 167 can
run. Each fix is its own brief: here, Univer's formula engine in a worker; in
imbatranimOS, the OS starting a kit app's import when its window opens, which
helps every kit app. Briefs 08 and 09 move to done at the next run.

## [2026-10-28] decision | CAD opens DWG through a suite server

The owner works with DWG files and wants CAD to open them. No browser reader
exists without WebAssembly, which the desktop's CSP forbids, so a suite server
converts DWG to DXF with LibreDWG. It is the suite's first server, which also
answers the "first server" question. The brief starts with how LibreDWG can run
under the TypeScript-only, no-compiler invariants; to be written.

## [2026-10-28] todo | Brief 14: CAD opens DWG through the suite's first server

[Brief 14](briefs/done/14-cad-opens-dwg-through-a-suite-server.md) starts with
a spike: LibreDWG compiled to WebAssembly from npm, run in Node on a new
`server/` workspace, which needs no compiler and keeps wasm out of the browser.
If that fails it stops for the owner rather than change the OS image. CAD then
opens a `.dwg` as DXF and never saves over it: Save becomes Save as `.dxf`.

## [2026-10-28] build | Briefs 08 and 09 closed: moved to done, the owner's answers recorded

[Brief 08](briefs/done/08-sheets-walk-in-the-os.md) and
[brief 09](briefs/done/09-pdf-walk-in-the-os.md) move to `done/` with an
outcome note each. Their walks stand as logged on 2026-10-27 and 2026-10-28.
The owner cleared both: Sheets' formula freeze became
[brief 13](briefs/done/13-sheets-formulas-in-a-worker.md), and PDF's 40 ms
first-page gap became imbatranimOS brief 182. The OS can run briefs 166 and
167. A brief run starts on 10, 11, 12, 13 and 14, one at a time.

## [2026-10-28] build | Brief 10 done: a word typed into Docs' find box stays there

[Brief 10](briefs/done/10-docs-find-as-you-type.md): SuperDoc's
`goToSearchResult` focuses the editor before selecting a match, so every key
after the first went into the document. `d5f0631` hands focus back in the
same task and marks the find bar `data-editor-ui-surface`, without which
SuperDoc's overlay stops painting the selected match once the box has focus.
Walked in imbatranimOS `31a248c`'s production image (Docker Desktop came back
mid-run): "hello" typed key by key stayed in the box, 31 matches, Enter and
Shift+Enter stepped and wrapped with focus kept, the document text unchanged
and not dirty, no CSP violation or console error. The marker extends brief
12's symptom: a focused find bar keeps every Docs window's caret painted.

## [2026-10-28] build | Brief 11 done: TRIM picks the short stub at a corner

[Brief 11](briefs/done/11-cad-trim-picks-the-short-stub.md): `2c1d254`. The
`entity` prompt now weighs every object in the pick box. It passes over what
its filter refuses, so a pick beside a point takes the curve, and an optional
`prefer` breaks near-ties (1.5 px). TRIM and EXTEND prefer the nearer end, so
the eight stubs of the offset room trim from a pick 2 px from the corner with
the wall nearer, at 30, 50 and 65 px per unit. A pick in a wall's middle
still trims the wall. Limit: a pick on a stub's outer side at 30 px per unit
ties with the parallel wall's end, and the nearest wins. The first PDF test
timed out at 5 s twice in full runs on a loaded machine and passed alone.

## [2026-10-28] build | Brief 12 done by its step 3: SuperDoc has no caret option

[Brief 12](briefs/done/12-docs-one-caret-with-several-windows.md): in
SuperDoc 1.46.3, `PresentationEditor#updateSelection` keeps the body caret
whenever the page's focused element is inside any `[data-editor-ui-surface]`.
`#updateHeaderFooterSelection` paints the header and footer caret with no
focus test at all. No option, method or exported registry controls either;
`setDocumentMode('viewing')` clears the layer only as part of a read-only
mode switch. Nothing in `apps/docs` changed, and the choice (CSS rule,
upstream issue, or live with it) goes to the owner. Three windows walked in
imbatranimOS `31a248c`'s production image: body typing, header typing and
brief 10's find box all went to the focused window. Only the focused window
painted a body caret, but every window with a header session open painted
its caret.

## [2026-10-28] build | Brief 13 built: Sheets' formulas in a worker; one line fails narrowly, stays in todo

[Brief 13](briefs/done/13-sheets-formulas-in-a-worker.md): `f4b26e3`
starts `formulaWorker.ts` as a module worker and hands it to
`UniverSheetsCorePreset({ workerURL })`. The worker runs
`UniverSheetsCoreWorkerPreset`, and a save waits for
`onCalculationResultApplied`. In imbatranimOS `31a248c`'s production image,
the 220,000-formula workbook's 6.8 s freeze after the grid is gone. One
210–285 ms task is left (8 runs): Univer's main-thread scan for formulas
without a value. The values workbook stays under 130 ms. Formulas recompute
after an edit, a save 100 ms after an edit wrote the new values, opening
does not dirty, and no CSP violation or console error came up. A scratch
build with `CalculationMode.FORCED` had no task over 63 ms, at the price of
the file's cached values; the owner decides. Found on the way: formulas past
row 1000 compute `#NAME?` (no `rowCount` in the xlsx mapping), before this
brief too ([todo](todos/2026-10-28-sheets-formulas-past-row-1000.md)).
The owner paused the run here; brief 14 was not started.

## [2026-10-28] decision | Brief 13 accepted and closed, Docs' caret lived with, the row-1000 bug becomes brief 15

The owner answered the two questions left by briefs 12 and 13. The 210–285 ms
main-thread task after the grid that Univer's formula scan leaves in
[brief 13](briefs/done/13-sheets-formulas-in-a-worker.md) is accepted; the
brief moves to done, with no switch to `CalculationMode.FORCED` and no upstream
report. Docs' caret in several windows (brief 12: SuperDoc has no option) is
lived with; the [todo](todos/2026-10-22-docs-caret-in-every-window.md) closes
as a known gap for header and footer editing. The row-1000 bug becomes
[brief 15](briefs/done/15-sheets-formulas-past-row-1000.md): the xlsx and CSV
mappings set `rowCount` from the data, and brief 13's 220,000-formula workbook
is re-measured in the OS once its formulas compute. Brief 13's numbers were
taken while about 95% of them errored; a freeze over 1 s at low load becomes a
todo for the owner, and brief 13 stays closed. The run goes on with 15, then 14.

## [2026-10-28] build | Brief 15 done: formulas past row 1000 compute; the big workbook's first real calculation is a todo

[Brief 15](briefs/done/15-sheets-formulas-past-row-1000.md): `028f5ca` sizes
each sheet to its data and to every cell a formula points at (Univer's 1,000
× 20 as the floor, Excel's grid as the ceiling), so `=A1001*2` computes
instead of `#NAME?`. A headless Univer in the tests shows it, with a control
that still errs without the sizes. In imbatranimOS `31a248c`'s production
image, `calc-small.xlsx` saved B1001 to B2000 right, and `big-formulas.xlsx`
saved all 220,000 values right once its first calculation ended, 4.6–5.3
minutes after the grid at load 20–40. In brief 13's 30 s window the task
after the grid is 287–1,305 ms over 8 runs at load 12–26 (no run found the
load under 6), the same scan over 22 times the rows. Watched to the end of
the calculation, the main thread froze 1–4 s in bursts while the results
landed (RPC deserialization, writing values, GC, a redraw), and a save during
it wrote no cached values: a
[todo](todos/2026-10-28-sheets-big-first-calculation.md) for the owner.
Brief 13 stays closed.

## [2026-10-28] build | Brief 14 done: CAD opens DWG through the suite's first server; service or static is the owner's

[Brief 14](briefs/done/14-cad-opens-dwg-through-a-suite-server.md): the spike
passed. `@mlightcad/libredwg-web` 0.8.2, LibreDWG as WebAssembly, runs in Node
with no compiler and writes DXF from R2000, R2007 and R2018 samples in
0.4–0.85 s, which CAD's reader opens whole. The new `server/` (Fastify, run
from source) takes the DWG over a `/dwg-to-dxf` WebSocket, because the
desktop proxies a service app's HTTP for GET and HEAD only, and converts in a
child process per file. In imbatranimOS `31a248c`'s production image the
three opened in CAD with their layers and geometry. Save wrote a `.dxf`
beside the `.dwg`, whose checksum never changed. With the server killed for
good, an open CAD window said so and still opened a DXF; no CSP violation,
and no wasm in `dist/os`. The cost: the OS leases a descriptor's server for
every Office window, so the first one took 2.7–5.0 s instead of 1.0–1.15 s,
and a server that cannot start crashes every Office window. Keep `service`
or ship `static` is the owner's call ([open-questions.md](wiki/open-questions.md));
the OS fixes are in two todos. The machine restarted mid-walk, and the walk
was redone. After it, the owner ruled out heavy tests for the rest of the run.
