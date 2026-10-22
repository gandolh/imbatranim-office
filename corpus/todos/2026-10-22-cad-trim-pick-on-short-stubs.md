---
title: CAD's TRIM misses short segments at normal zoom
created: 2026-10-22
status: open
tags: [cad, input]
---

# CAD's TRIM misses short segments at normal zoom

In brief 03's walk, trimming the 0.2-unit overhangs of an offset 10×8 room
missed at a window-filling zoom: a stub is about 6–13 px against a 5 px pick
box, and picks near the corner selected the long wall instead. FILLET with
radius 0 on the inner lines did the job. AutoCAD prefers the nearer segment
end and highlights the piece that will go; a pick that weighs the segment
under the cursor would fix it.
