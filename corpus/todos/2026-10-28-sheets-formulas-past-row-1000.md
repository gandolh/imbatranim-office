---
title: Sheets computes formulas past row 1000 as #NAME? and saves them so
created: 2026-10-28
status: promoted
tags: [sheets, univer, fidelity, bug]
---

Promoted 2026-10-28 into [brief 15](../briefs/done/15-sheets-formulas-past-row-1000.md), done the same day.

# Sheets computes formulas past row 1000 as #NAME?

Found in brief 13's walk (2026-10-28), in the suite before that brief as well
(`a9a054f`): a workbook of 2,000 rows (`=A{r}*2` in column B,
`=SUM(A$1:A{r})` in column C), opened, edited and saved. openpyxl reads B1001
to B2000 back as `#NAME?` with their formulas intact; column C is right.

`apps/sheets/src/engine/xlsxMapping.ts` builds each sheet with `columnCount`
from the data and no `rowCount`, so Univer keeps its default of 1000 rows.
A single-cell reference past that row evaluates to `#NAME?`, and the save
writes it as the cached value. Setting `rowCount: Math.max(maxRow + 1, 1000)`
in a scratch build fixed the case. CSV (`csv.ts`) should get the same
check. The built-in Sheets shares the mapping, so it likely has the bug too
(not checked).

It changes brief 13's numbers: the 220,000-formula workbook mostly errored
instead of computing.
