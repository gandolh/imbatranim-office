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
