# Task 11 — CAD: TRIM picks the short stub, not the long wall beside it

## Context

Promoted 2026-10-23 from the todo
[2026-10-22-cad-trim-pick-on-short-stubs](../../todos/2026-10-22-cad-trim-pick-on-short-stubs.md),
found in [brief 03](../done/03-cad-a-2d-drafting-app.md)'s walk.

Trimming the 0.2-unit overhangs of an offset 10×8 room missed at a
window-filling zoom. A stub is about 6–13 px long against a 5 px pick box, and
picks near the corner selected the long wall instead. FILLET with radius 0 on
the inner lines did the job, so the geometry is fine; the pick is wrong.

How a TRIM pick is chosen today (checked 2026-10-23):

- `trimOrExtend` in [`commands/modify.ts:315`](../../../apps/cad/src/engine/commands/modify.ts)
  yields an `entity` prompt with a `filter` (curves only).
- The editor answers it in [`editor.ts:685-698`](../../../apps/cad/src/engine/editor.ts):
  `this.pick(screen)` first, then the filter on the one it got.
- `pick` ([`editor.ts:784-801`](../../../apps/cad/src/engine/editor.ts)) takes the
  nearest entity within `PICKBOX` (5 CSS px, `editor.ts:50`), by
  `entityDistance`, ties going to the later one. At a corner the wall and the
  stub are both about 0 px away, so which one wins is luck.

AutoCAD prefers the segment whose nearer end is closer to the pick and highlights
the piece that will go. The highlight is not in this brief.

## Files you OWN

- `apps/cad/src/engine/editor.ts` (the `entity` prompt case and `pick`)
- `apps/cad/src/engine/commands/types.ts` (if the prompt gains a ranking hook)
- `apps/cad/src/engine/commands/modify.ts` (`trimOrExtend` only)
- `apps/cad/src/engine/editor.test.ts`, or a new test beside `modify.ts`

## Files you must NOT touch

- `apps/cad/src/engine/geom/edit.ts` (`trimCurve` works; leave it).
- `PICKBOX` and selection-click behaviour outside the `entity` prompt.

## What to do

1. Write the failing test first: the offset 10×8 room with 0.2 overhangs, the
   view at a window-filling scale, and a TRIM pick 2–3 px from a corner on the
   stub's side. Today it picks the wall.
2. Let the `entity` prompt look at every candidate in the pick box, not only the
   nearest: drop the ones its `filter` refuses, then rank the rest.
3. For TRIM and EXTEND, rank among candidates within about 1–2 px of the nearest:
   prefer the one whose nearer endpoint is closer to the pick. That is the stub at
   a corner and the wall in the middle of a wall. Outside that band, nearest
   still wins.
4. Other commands keep today's nearest-wins pick (the ranking hook is optional on
   the prompt).

## Acceptance

- The test from step 1 passes: picks on each of the eight stubs of the offset
  room trim the stub.
- A pick in the middle of a wall, away from corners, still trims the wall's piece
  there.
- A pick that lands on a non-curve next to a curve takes the curve, not "Cannot
  trim that object."
- `npm run typecheck`, `npm run lint`, `npm test` pass.

## Out of scope

- Hover highlighting the piece TRIM will remove (worth a todo if wanted).
- FILLET, OFFSET and selection picks.

## Outcome (2026-10-28)

**Done.** `2c1d254`.

The `entity` prompt gained an optional `prefer(e, at)` in `types.ts`: a
measure in world units, lower preferred. `Editor.pickFor` (`editor.ts`) takes
every selectable object in the pick box, drops the ones the prompt's `filter`
refuses, and starts from the nearest. With `prefer`, it looks at the objects
within `PICK_TIE` (1.5 CSS px) of the nearest and switches to the one ranked
lowest, but only when it ranks lower than the nearest by more than the tie.
Without that last rule, two parallel walls far from their ends would go to
whichever end was a fraction of a pixel closer. `pick` and the selection
click are unchanged (nearest wins, ties to the later object).

TRIM and EXTEND pass `nearerEndDistance` (`modify.ts`): the distance from the
pick to the curve's nearer end (line, arc, open polyline), `Infinity` for
circles and closed polylines.

**Tests** (`editor.test.ts`, "TRIM and EXTEND pick the short stub at a
corner"): the offset 10×8 room at 30, 50 and 65 px per unit (the walk's 6–13
px stubs). Each of the eight stubs is picked 2 px in from where it meets the
wall and 3 px beside it on the room's side, so the wall is the nearer object.
The stub goes and the walls are untouched. The test fails at all three scales
before the change. A pick in the middle of a wall at 20 px per unit, with the
inner wall 4 px away and inside the pick box, trims the wall. A pick nearer a
POINT than a line trims the line. A pick on a lone point still says "Cannot
trim that object.", and on nothing, "No object found there."

**Limit.** A pick on the outside of a stub at 30 px per unit, halfway to the
parallel wall, is as near that wall's end as the stub's. The nearest wins
there, and it may be the wall. EXTEND gets the same ranking, but no corner
case of its own was found: at a corner the end it would extend is the one
already on the wall.

Gates: typecheck, lint (the one warning predates the brief), test, build:os
and format:check pass. Under a loaded machine the first PDF test
(`apps/pdf/src/App.test.tsx`, "draws the first page…") timed out at 5 s in
two full runs. It passed alone three times and in the next full run.
