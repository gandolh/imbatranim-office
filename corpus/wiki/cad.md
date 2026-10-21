---
summary: How CAD (brief 03) is built: the spike's picks and numbers (dxf-viewer's parser to read, @tarikjabiri/dxf to write, our own Canvas 2D renderer at 60 fps on 10k lines), the drawing model and its undo, the commands and their aliases, the snap and selection rules, files and exports, the harness, and the known gaps.
updated: 2026-10-21
---

# CAD

A 2D drafting app in the AutoCAD mould, behaviour after CADCraft
([craft-reference.md](craft-reference.md)); no CADCraft code was translated.
Everything lives in `apps/cad`: `src/engine/` has no React and no DOM, `src/ui/`
draws it, `src/shell/useCadFile.tsx` holds the file wiring.

## The spike (2026-10-21)

**Readers**, field by field against a raw group-code pass, on apartment.dxf
(58 entities), a French cadastre sheet (1,232: POLYLINE, TEXT, INSERT; 109
layers) and a 10,053-LINE map:

| Reader | Not read | Field losses |
|---|---|---|
| dxf-parser 1.1.2 (MIT) | HATCH 5, LEADER 1, ACAD_TABLE 1 | layer linetype, locked, lineweight |
| dxf-viewer 1.0.50 parser (its `src/parser/`, MIT inside an MPL-2.0 package) | LEADER 1, ACAD_TABLE 1 | the same three |

None lost a coordinate, bulge, closed flag, colour, linetype or handle on LINE,
LWPOLYLINE, POLYLINE, CIRCLE, ARC, TEXT, MTEXT or INSERT. **Pick: dxf-viewer's
parser**, imported by path (`dxf-viewer/src/parser/DxfParser.js`, types in
`dxf-viewer-parser.d.ts`); only it and `loglevel` reach the bundle, though
`npm ci` also installs three.js and opentype.js as its package dependencies. Our
raw pass (`engine/dxf/tags.ts`) adds the layer fields and keeps every group code
of what the parser skips; records pair with parsed entities by handle, so a
record the parser drops stays foreign instead of borrowing a neighbour's
geometry.

**Writers**: dxf-writer 1.18.4 has no MTEXT, INSERT or per-entity colour. **Pick:
@tarikjabiri/dxf 2.9.0** (MIT, AC1021). Four of its parts are bypassed with our
own `dxfy`: extended data (it drops the last character of every string and wraps
each application's data in an extra list), the layer record (always lineweight
0), the entity header (no lineweight) and ATTRIB flags (always visible).

**Round trip** (read → write → read, numbers to 12 significant digits): the
cadastre, the map and a synthetic drawing of every modelled kind come back
identical; apartment.dxf too, except its table, written as a reference to its
block. ezdxf 1.4.3 (`recover` and `audit`) finds 0 errors and 0 fixes in all
three saved files.

**Frame times**, HeadlessChrome 150, 1100×680 canvas, 180 frames per phase
(`harness/perf.html`):

| Drawing | Pan | Zoom | Renderer CPU per frame (p50 / p95 / max) |
|---|---|---|---|
| 10,053 LINE | 60 fps, max 16.8 ms | 60 fps, max 16.8 ms | pan 4.4 / 6.7 / 10.4 ms |
| cadastre 1,232 | 60 fps, max 33.2 ms | 60 fps | 1.7 / 2.6 / 2.7 ms |
| cadastre tiled 3×3, 11,088 mixed (synthetic) | 58.1 fps, max 33.4 ms | 59.3 fps | 10.9 / 15.6 / 19.3 ms |

No frame over 50 ms; headless met the target, so no headed run was needed. What
made it: one `stroke()` per colour and linetype, flushed every 1,024 segments
(one huge dense path took 422 ms), vertices under half a pixel apart dropped,
text drawn from one font size through `setTransform`, text under 4 px drawn as
one stroke, and world→screen done in doubles so survey coordinates stay exact.

**Typed line and snap**: `0,0`, `@4,0`, `@3<90`, then a second line whose end,
clicked 0.1 unit off the corner, lands on (4,3). In `editor.test.ts`.

## The model

`engine/model/`. Entities are immutable values keyed by DXF handle in
insertion (draw) order: line, circle, arc (CCW, radians), polyline (vertices
with bulges, closed, constant width), text, mtext, insert (with attributes),
ellipse, point, and **foreign**. Every entity has layer, ACI colour (256 ByLayer,
0 ByBlock), optional true colour, linetype by name, lineweight and the extended
data it was read with. A foreign entity (DIMENSION, HATCH, LEADER, SPLINE,
SOLID, ACAD_TABLE, …) keeps its raw group codes and a preview (its block, or its
boundary loops); it is drawn, snapped to, erased and moved between layers, and
written back with only its handle, owner and object pointers replaced.

Layers carry colour, linetype, lineweight, on, frozen and locked. Units are
display and input only: decimal (unitless), architectural (1 unit = 1 inch,
`5'-6 1/2"`, typed as `5'6-1/2"`) and metric (mm, cm or m, with suffixes such as
`1.2m`), read from and written to `$INSUNITS`, `$LUNITS` and `$LUPREC`.

Undo: every change runs in a transaction; a command opens one when it starts
and closes it when it ends, so UNDO takes back the whole command (every segment
of a LINE). Each step stores (before, after) per entity, plus the layer table
when it changed. 500 steps.

Handles are kept while the drawing is open and renumbered on save (the writer
numbers everything).

## Commands

Typed by name or alias, or started from the toolbar; a toolbar button cancels
the running command first. Enter or Space on an empty line repeats the last one.

| Command | Aliases | Prompts and options |
|---|---|---|
| LINE | L | points; Undo, Close |
| PLINE | PL | points; Arc (tangent arcs), Line, Close, Undo |
| CIRCLE | C | centre, radius or Diameter; 2P, 3P |
| ARC | A | three points; Center (start, end or Angle); End |
| RECTANG | REC, RECTANGLE | two corners; Dimensions |
| TEXT | DT, DTEXT | start, height, rotation, lines until an empty one; Justify (Left, Center, Right, Middle) |
| MOVE, COPY | M; CO, CP | base and second point; MOVE Displacement; COPY repeats, Undo |
| ROTATE, SCALE | RO; SC | base, angle or factor (typed or picked); Reference |
| MIRROR | MI | two points; erase source Yes/No |
| OFFSET | O | distance or Through; object, side; repeats, Undo |
| TRIM, EXTEND | TR; EX | object to trim or extend, repeatedly; cuTting / Boundary edges (all objects by default), Undo |
| FILLET | F | two lines or arcs; Radius (0 corners them) |
| ERASE | E | objects (also the Delete key) |
| UNDO, U, REDO | | count for UNDO; Ctrl+Z, Ctrl+Y |
| ZOOM | Z | window corners, Extents, All, Previous, Window, `2x` |
| PAN | P | drag until Enter or Esc (middle drag and the wheel always work) |
| LAYER, -LAYER | LA; -LA | the Layers dialog; the command-line Make, Set, New, ON, OFF, Color, Freeze, Thaw, LOck, Unlock |
| UNITS, CHPROP | UN; CH | Decimal, Architectural, Metric; change Color or LAyer |

Objects selected before a command are its selection (noun-verb). Right-click is
Enter. Grips on selected objects: dragging one stretches every selected object
with a grip on that spot; a midpoint, centre or text grip moves; Enter switches
STRETCH and MOVE.

## Input rules

- Points: `x,y`, `@dx,dy`, `@d<a`, `d<a`, `@`, `#x,y`, a bare distance along the
  cursor. `@` is relative to the prompt's base point (the previous vertex),
  else to the last point entered.
- Snaps (`engine/input/snap.ts`), aperture 8 px: endpoint, midpoint and
  intersection when their point is in the aperture; centre when the centre is,
  or when the cursor rests on the circle; perpendicular from the prompt's base
  while resting on an object; nearest last. An earlier rule beats a later one,
  then the closest wins. Snaps work on locked layers; selection does not.
- Order: a snap wins, else ortho (F8: the larger axis), else polar tracking
  (F10, every 15/30/45/90°, within 6 px across the ray), else the cursor.
- Selection: pick box 5 px, the nearest object wins; a window dragged or
  clicked left to right takes what is wholly inside, right to left also what
  it touches; Shift removes.

## Files and exports

`useCadFile` reads through `readWithVersion` and saves through `saveOverRead`
(Overwrite, Reload from disk, Cancel), Save as through the OS dialog, Ctrl+S,
the dirty mark and the close guard. A DWG or binary DXF is refused with a
sentence. On open, the history says which objects are kept as drawn; on save, a
warning names anything converted or dropped. SVG and PDF exports run in
`export.worker.ts` from a plain copy of the drawing: SVG in drawing units with
true arcs, one group per layer; PDF on A3 with Béziers for arcs and Helvetica
text (pdf-lib 1.17.1, the OS's pin). Both put ACI 7 in black on white.

## The harness

`CAD_FIXTURES=<folder> npx vite --config apps/cad/harness/vite.config.ts --port 5181`:
`/` is the app in a fake desktop handle (`?open=<file>`, `?theme=light`,
`window.__cadHarness` answers the Save and Open dialogs and returns files),
`/perf.html?file=<name>&tile=<n>` the benchmark. Large real fixtures stay out
of the repo; `CAD_FIXTURES=<folder> npx vitest run apps/cad/src/engine/dxf`
round-trips them too.

## Known gaps

Hatch patterns draw as their boundary (solid fills fill); dimensions, hatches,
leaders, splines and tables are not editable; ACAD_TABLE is saved as a block
reference; entities needing a CLASS record (MULTILEADER, WIPEOUT, IMAGE) are
dropped on save, with a warning; paper space is kept but not drawn; FILLET does
not take polyline segments or circles; OFFSET does not clean up polyline
self-intersections; no TTR circle, no hatch or dimension commands, no
lineweight display, no text editing after placement; handles change on save;
saved files gain the writer's `Defpoints` layer; the kit's `Select` gives its
trigger no accessible name, so the layer and units dropdowns carry a `title`.
