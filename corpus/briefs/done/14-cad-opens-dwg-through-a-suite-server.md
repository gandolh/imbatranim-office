# Task 14 — CAD opens DWG files through the suite's first server

## Context

The owner decided on 2026-10-28 that they work with DWG files and CAD should
open them ([open-questions.md](../../wiki/open-questions.md) records the
answer). No browser reader exists without WebAssembly, and the desktop's CSP
forbids WebAssembly in the apps. So a server converts DWG to DXF with
**LibreDWG** (GPL-3.0-or-later, compatible with this repo's AGPL-3.0-only), and
CAD opens the DXF with the reader it already has (dxf-viewer's parser,
[cad.md](../../wiki/cad.md)). This is the suite's first server, which also
settles the old "which app first needs a server" question
([architecture.md](../../wiki/architecture.md): `server/` arrives with the
first one-off job).

The invariants in `corpus/CLAUDE.md` bound how LibreDWG can run:

- **TypeScript only**, no compiled binaries or prebuilt artifacts committed
  for the build; the OS builds this repo from source in a container with Node
  and **no compiler**. Building LibreDWG's C there is out.
- **No WebAssembly in the apps**, but "a library that needs wasm runs on the
  server". A LibreDWG build compiled to WebAssembly and published on npm (for
  example `@mlightcad/libredwg-web`; check what exists, its licence, size and
  upkeep) would run in Node on the server with no compiler. That is the first
  route to try.
- A distro package (`apk add libredwg`) would change the OS image, which the
  OS treats as lightweight by invariant. If the wasm route fails, **stop and
  bring the alternatives to the owner**; do not change the OS image.

On the OS side, a suite descriptor gets **one server at most** (imbatranimOS
brief 162, its `glossary-marketplace.md`), and a kit app leases it through
`useServerLease` (`apps/core/src/modules/marketplace/KitAppHost.tsx` in that
repo). Read how a descriptor declares the server and how it is started and
stopped before writing it.

## Files you OWN

- A new `server/` workspace (Fastify, TypeScript), added to `package.json`'s
  workspaces, with its tests
- `apps/cad/` (opening a `.dwg`: send it to the server, load the DXF that
  comes back; the save rules below)
- `os/descriptor.template.json` and its test (the server and `.dwg` in CAD's
  `opens`)
- the OS build in `packages/shared/` only as far as building `server/` needs
- `THIRD-PARTY-NOTICES.md` (LibreDWG and the wasm package)
- corpus: this brief's outcome, `corpus/wiki/cad.md`,
  `corpus/wiki/architecture.md` (the server), `corpus/wiki/test-files.md`,
  `corpus/wiki/status.md`, `corpus/log.md`, and a `decisions.md` entry for how
  LibreDWG runs

## Files you must NOT touch

- imbatranimOS. If the OS needs a change to start a suite server or to pass a
  file to it, stop and write that down as a brief for the OS.
- Docs, Sheets, Slides, PDF.

## What to do

1. **Spike: how LibreDWG runs.** Try the wasm route in Node: convert three
   DWG files of different versions (R2000, R2007, R2018) to DXF, and check the
   DXF opens in CAD with its lines, arcs, text, layers and blocks. Record the
   package, its version, its licence, its size in the build and the time per
   file in the outcome. If no wasm build works, stop here (see Context).
2. **The server.** One route takes a DWG (size-capped, say 50 MB) and answers
   the DXF, converting in memory or a temp directory that is always cleaned.
   One conversion at a time is enough; a time limit ends a stuck one.
3. **CAD.** Opening a `.dwg` (Open, Files' Open With, recents) shows
   "Converting…", then the drawing. The title says the original name. CAD
   cannot write DWG, so a DWG drawing is never saved over: **Save** on one
   asks for a `.dxf` name next to it (Save as). The dirty mark, close guard
   and conflict dialog behave as for DXF.
4. **Failures say so**: the server not running, a DWG version LibreDWG can't
   read, a file over the cap, a timeout. Each is a plain sentence in CAD's
   window, never a blank canvas.
5. **Record the decision** (how LibreDWG runs, what was rejected) in
   `decisions.md`, and the test files with their sources and licences in
   `test-files.md`.

## Acceptance

- Three DWG versions open in CAD inside the OS (production image, under its
  CSP), each with its geometry and layers, and the times recorded.
- Saving one writes a `.dxf` beside it and leaves the `.dwg` untouched (same
  checksum).
- With the server stopped, opening a DWG says so; DXF still opens.
- No compiler in the build, no binary committed, no wasm in the browser
  bundle (the CSP shows no violation).
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build:os` pass.

## Outcome (2026-10-28)

**Done**, with one acceptance line that the OS's design cuts short and a
question for the owner. The spike passed, the server and CAD's side are
built, and the walk ran in imbatranimOS `31a248c`'s production image. The
machine restarted mid-walk; the walk was redone from a fresh container. After
the walk the owner ruled out heavy tests for the rest of the run, so nothing
heavier than the changed code's tests ran after that.

**Step 1, the spike: the wasm route works.** `@mlightcad/libredwg-web` 0.8.2
(GPL-3.0; LibreDWG GPL-3.0-or-later, its DXF signed `0.14.8608.68_25bfb_dirty`)
is LibreDWG compiled to WebAssembly: 12.4 MB unpacked, 10.8 MB of it the
wasm, no install scripts, Node ≥ 20. It runs in Node with no compiler. Its
`dwg_write_dxf` is in the npm build even though its README says DXF writing
is left out. On LibreDWG's own samples (`example_2000/2007/2018.dwg`, see
[test-files.md](../../wiki/test-files.md)), in one process each: R2000 845 ms
(1.30 MB of DXF), R2007 399 ms (1.47 MB), R2018 400 ms (0.64 MB); 264–324 MB
of memory per process (the build reserves 1 GB of wasm memory). The package's
other route, `convert()` to its own `DwgDatabase`, traps on the R2000 sample
("memory access out of bounds") and would need a DXF writer of our own; it is
not used. CAD's reader opened all three DXFs: 69 entities each (lines, arcs,
LWPOLYLINEs, text, MTEXT, 10 inserts and the rest kept as drawn), 5 layers,
13 blocks. R2000's DXF names a layer `ADSK_SYSTEM_LIGHTS` where the others
have `*ADSK_SYSTEM_LIGHTS`, and LibreDWG prints `BAD_CONTINUATION_BYTE`
warnings on it; both are cosmetic.

**Step 2, the server** (`server/`, Fastify 5.12.7, @fastify/websocket
11.3.4; see [architecture.md](../../wiki/architecture.md)). The OS proxies a
service app's HTTP for GET and HEAD only (`marketplace.controller.ts`), so
the DWG cannot be POSTed; its WebSocket proxy forwards binary messages both
ways (ws 8.22.0, 100 MiB a message). So `/dwg-to-dxf` is a WebSocket: one
binary message in (at most 50 MB; over that, a JSON `too-large`, or ws closes
with 1009), one binary message out (the DXF gzipped, 10–20% of its size, so
a 50 MB DWG's DXF still fits a message), or a JSON failure, then close. A
non-DWG is refused before any conversion. Each conversion is a child process
(`converter.ts`) with its own wasm instance, killed after 60 s; one runs at a
time and three may queue. `/health` answers without loading LibreDWG. It
runs from source (`node server/src/index.ts`, Node 24 strips the types), and
the protocol is shared with CAD as `@imbatranim-office/shared/dwg`. Through
the server, locally at load about 20: R2000 1.34 s, R2007 1.03 s, R2018 0.90 s,
byte for byte the spike's DXF.

**Step 3, CAD.** A `.dwg` from Open (now `extensions: ['dxf', 'dwg']`, the
button "Open… (DXF, DWG)"), Files' Open With (`opens: ["dxf", "dwg"]`) or
recents shows "Converting…", then the drawing, titled with the DWG's name; the
command line says which release it came from and what Save will do. Save
confirms ("CAD cannot write DWG, so plan.dwg stays as it is. The drawing is
saved as plan.dxf beside it.", or "…already exists beside it and will be
replaced" with Replace, saved against that file's version) and writes
`<name>.dxf` in the same folder; the window then edits the DXF. The OS's save
dialog cannot start in a folder, so it is not used for this
([todo](../../todos/2026-10-28-os-save-dialog-start-folder.md)); Save as is
unchanged. The dirty mark, close guard and conflict dialog are the DXF ones.

**Step 4, failures** are one sentence in the window and an error
notification: no server or no answer ("The Office server is not answering,
so plan.dwg could not be converted. DXF drawings still open."), over 50 MB,
not a DWG, unreadable (naming the release), over 60 s, busy.

**Step 5**: [decisions.md](../../wiki/decisions.md) has the call and what it
rejected; [test-files.md](../../wiki/test-files.md) the samples.

**Acceptance, line by line** (headless Chrome, suite at this brief's tree,
production image, a fresh volume, load 27–34 from other agents):

- **Pass: three DWG versions open in CAD.** From double-click in the Open
  dialog to the drawing: R2000 1.83 s and 4.32 s, R2007 2.01 s, R2018 0.72–5.81 s
  over 7 opens; "Converting…" showed each time. The Layers dialog listed 0,
  Tavolo 2 (yellow), Tavolo 3 (cyan), Defpoints and the lights layer. A zoom
  window on the drawing showed its lines, arcs, circles, ellipse, polylines,
  text, block inserts and hatches in their layer colours. The opening view
  and zoom extents show one LWPOLYLINE millions of units wide and the rest as
  a speck; LibreDWG's own SVG export of the file looks the same, so that is
  the drawing, not the reader.
- **Pass: saving writes a `.dxf` beside it and leaves the `.dwg` untouched.**
  `example_2018.dxf` (253,306 bytes) appeared beside the DWG, the title moved
  to it; a second window saving the same DWG asked to Replace. The DWG's
  sha256 stayed `7bc77212…5a65a` throughout.
- **Pass, with the OS's limit: with the server stopped.** With CAD open, the
  server was killed until the OS stopped restarting it; opening
  `example_2007.dwg` then gave the sentence above, and `apartment.dxf` opened.
  But the server is the descriptor's, so a window opened while it **cannot
  start** never reaches CAD: with the catalog's command pointed at a missing
  file, a Sheets window showed "Sheets stopped working". A new window after
  the OS gave up on a crashing server opened normally (it tries once more).
- **Pass: no compiler, no binary committed, no wasm in the browser.** The
  wasm comes from npm into `node_modules` at `npm ci` and runs only in the
  server's child processes; `npm run build:os` emits no `.wasm` (a test
  checks); no CSP violation in any run.
- **Gates:** typecheck, lint (the old CAD warning), format:check, build:os,
  and the tests of the changed code: server (11, plus the real-DWG test with
  `DWG_FIXTURES`, which converted all three), CAD's App (14), the shared
  protocol (2), the OS build (21). The one full-suite run, before the owner's
  rule, passed 535 and timed out 2 PDF tests at load 33; they pass alone, as
  in briefs 10 and 11.
- Console lines seen, all the browser logging a network status: a 404 when
  Save looks for an existing `.dxf` (the kit has no stat), and 503s while the
  server was down.

**The cost, for the owner** (one Sheets window, double-click to its "Open a
spreadsheet" button, load 27–32): static install 1,023–1,152 ms; service
install with no server running 2,745–5,027 ms, "Starting its server…"
shown; with the server already up 1,083–1,516 ms. The server idles at about
100 MB and holds one of the OS's four server slots while any Office window
is open. Keep `service` or ship `static` until the OS can lease per app: see
[open-questions.md](../../wiki/open-questions.md) and the
[todo](../../todos/2026-10-28-os-suite-server-for-every-window.md). Nothing
in imbatranimOS was changed.
