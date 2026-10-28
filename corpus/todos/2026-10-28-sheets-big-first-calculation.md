---
title: Sheets freezes for 1–4 s while a big workbook's first calculation lands
created: 2026-10-28
status: open
tags: [sheets, univer, performance, owner]
---

# Sheets freezes for 1–4 s while a big workbook's first calculation lands

Found by [brief 15](../briefs/done/15-sheets-formulas-past-row-1000.md) on
2026-10-28, once the row-1000 fix let all 220,000 formulas of
`big-formulas.xlsx` compute instead of erroring. In imbatranimOS `31a248c`'s
production image (suite `028f5ca`), headless Chrome, a `longtask` observer
from the open until Univer's progress bar went away:

| Load (1 min) | Calculation, s after the grid | Tasks over 1 s | Longest |
|---|---|---|---|
| 19.7 → 40.7 | 17–319 | 15 | 4.0 s |
| 31.3 → 39.9 | 23–299 | 2 | 2.7 s |

The machine was shared with other agents' builds; no low-load run was
possible in this session, so the sizes at low load are not known. Brief 13's
30 s window ended long before any of this; its 210–285 ms (accepted) and
brief 15's re-measure in the same window still stand.

**Culprit** (CPU profile of the second run): the formula worker's results
arriving on the main thread. The long stretches are the RPC channel's message
listener (`@univerjs/rpc`, the `e.data` read that deserializes a batch: 25–76%
self time), Univer writing the values into the model (`forValue`,
`_cellValueToRange`), garbage collection, and redraws (`drawImage`, one of
1.75 s). The calculation itself stays in the worker.

**Also seen:**

- A save during that calculation writes the formulas with **no cached values**
  (all 220,000 empty in openpyxl): an edit at 40 s and Ctrl+S saved in 18 s,
  so `onCalculationResultApplied` resolved for the edit's own small
  calculation, not the first one. A save after the calculation wrote all
  220,000 values, every one right. Brief 13's "a save waits" holds only once
  the first calculation is done.
- While it runs, the formula bar shows the raw locale key
  `sheets-formula.progress.calculating`.

**For the owner:** accept it (the window answers between batches, and the
file the save writes is not wrong, only without cached values during the
first minutes), or have a brief look for Univer's knobs on how results come
back (batch size, a pause between batches) and make a save wait for the first
calculation, or report it upstream.
