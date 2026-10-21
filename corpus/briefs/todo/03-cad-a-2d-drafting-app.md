# Task 03 — CAD, a 2D drafting app

## Context

The OS has no CAD app at all; this is the first of the two apps the suite adds
rather than moves. The behaviour reference is CADCraft, a Rust clone of
AutoCAD's 2D drafting (see [craft-reference.md](../../wiki/craft-reference.md)):
read its `docs/ui-parity.md` (point entry, object snaps, tracking and polar,
dynamic input, grips, selection, command line, palettes, navigation) and
`docs/geometry-parity.md` before designing a command. We build our own in
TypeScript. The app works the way AutoCAD and CADCraft do: a command line that
takes typed coordinates, plus toolbar buttons that start the same commands.

Depends on brief 01. Independent of 02, so it can run beside it, but the OS
order is Docs first, then CAD and Slides.

This is a spike-gated brief: step 1 decides the engine pieces and stops if the
gate fails.

## Library shortlist (surveyed 2026-10-21, npm registry and project pages)

| Job | Candidate | License | Latest release | Note |
|---|---|---|---|---|
| Read DXF | `dxf-parser` | MIT | 1.1.2, 2021-11 | The common choice; unmaintained since 2021 |
| Read DXF | the parser inside `dxf-viewer` | MPL-2.0 | 1.0.50, 2026-10 | Active; a fork of dxf-parser; take it as a dependency, not copied (MPL is file-level) |
| Write DXF | `@tarikjabiri/dxf` (dxfjs/writer) | MIT | 2.9.0, 2026-09 | TypeScript, active, entities and layers |
| Write DXF | `dxf-writer` | MIT | 1.18.4, 2022-11 | Smaller, older |
| Geometry | `@flatten-js/core` | MIT | 1.6.14, 2026-08 | Points, segments, arcs, circles, intersections, distances |
| Offsets, booleans | `clipper2-ts` | BSL-1.0 | 2.0.1-18, 2026-07 | Pre-release tag; check before pinning |
| Geometry and DXF export | `makerjs` (Microsoft) | Apache-2.0 | 0.19.2, 2026-01 | An alternative kit with its own model; heavier |
| Spatial index | `rbush` | MIT | 4.0.1, 2024-08 | For hit testing and snaps |
| Rendering | our own Canvas 2D renderer | ours | — | WebGL only if the spike shows Canvas 2D cannot hold 60 fps |
| Rendering reference | `dxf-viewer` | MPL-2.0 | 1.0.50, 2026-10 | three.js/WebGL viewer, read-only; a reference for batching, not our editor |

**DWG is out of scope.** The only browser DWG readers found are LibreDWG
compiled to WebAssembly (`@mlightcad/libredwg-web`, GPL-3.0), and the desktop
refuses wasm. GPL-3.0 can be combined with AGPL-3.0, so a later brief could
convert DWG to DXF on a suite server, which may run wasm in Node. Not here.

## Files you OWN

- `apps/cad/**`
- `os/descriptor.template.json` (the `office-cad` entry)
- `THIRD-PARTY-NOTICES.md` (anything translated from CADCraft)
- corpus: a new `wiki/cad.md` (the model, the commands, the snap rules),
  `decisions.md` if the spike locks a library, `status.md`, `log.md`

## What to do

1. **Spike (the gate).** In `apps/cad`, behind no UI polish:
   - load CADCraft's `examples/apartment.dxf` and one large real DXF (10,000+
     entities) with each DXF reader candidate; keep the one that reads both
     with the fewest losses on LINE, LWPOLYLINE, POLYLINE, CIRCLE, ARC, TEXT,
     MTEXT, INSERT and layers;
   - draw them on Canvas 2D and measure pan and zoom on the large file in Chrome
     (target: 60 fps on the laptop the owner uses, no frame over 50 ms);
   - write the drawing back with the writer candidate and read it again: every
     supported entity survives with its layer, colour and coordinates;
   - draw a line with typed coordinates (`0,0`, then `@4,0`, then `@3<90`) and
     snap its end to another line's endpoint.
   Record the numbers and the picks in the log. If Canvas 2D misses the frame
   target, say so and propose WebGL as its own brief. If no reader handles the
   test files, stop and return to the owner with what failed.
2. **The model.** A typed drawing model (entities with handles, layers, colour,
   linetype by name), with undo and redo as whole-command steps. Units:
   unitless drawing units with an architectural display option (feet-inches)
   and metric, as CADCraft does.
3. **Commands, v1.** LINE, PLINE, CIRCLE, ARC, RECTANG, TEXT, MOVE, COPY,
   ROTATE, SCALE, MIRROR, OFFSET, TRIM, EXTEND, FILLET (radius 0 and >0), ERASE,
   UNDO, REDO, ZOOM (extents, window), PAN, LAYER. Each runs from the command
   line (full name and AutoCAD's alias, `L`, `C`, `TR`…) and from a toolbar.
4. **Input.** Typed coordinates (absolute `x,y`, relative `@dx,dy`, polar
   `@d<a`), object snaps (endpoint, midpoint, center, intersection,
   perpendicular, nearest) with markers, ortho (F8), polar tracking, a
   crosshair, window and crossing selection, grips for move and stretch.
5. **Files.** Open and save `.dxf` through `system.fs` with the conflict check
   (`saveOverRead`), Save as through the OS's dialog, dirty mark and close guard
   as in Docs, several windows. Export to SVG and PDF from the model (PDF with
   `pdf-lib`, already used by the OS's norPDF) as one-off jobs in the browser.
6. **Descriptor entry.** `office-cad`, name `CAD`, `opens: ["dxf"]`,
   `multiInstance: true`, icon `drafting-compass`, a 1100×720 window.

## Acceptance

- The spike's numbers are in the log, and its gate passed.
- `npm run typecheck`, `npm run lint`, `npm test` (geometry and command tests:
  trim, extend, offset, fillet and the snap rules against known coordinates),
  `npm run build:os` pass.
- In Chrome, in the OS: `apartment.dxf` opens from Files; the owner can draw a
  10×8 room with typed coordinates, offset its walls by 0.2, trim the corners,
  put the walls on a `WALLS` layer, save, close and reopen it, and open the
  saved file in another DXF viewer (LibreCAD or dxf-viewer's demo) with nothing
  missing.
