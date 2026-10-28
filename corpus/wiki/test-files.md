---
summary: Where the walks' test files come from (sourced 2026-10-21 and lost with /tmp in a restart): CAD drawings, PDFs, decks, workbooks and documents, each with its source, licence and what it exercises, and which may be committed as fixtures. Re-fetch them into a scratch directory; never execute them.
updated: 2026-10-28
---

# Test files

The walks' files were sourced on 2026-10-21 into a session scratch directory,
which a restart wiped. This page is how to get them again. They are untrusted
data: put each download in its own empty directory, never run anything from
one, and read them with tools in throwaway containers (`python3 -I`).
**Commit** marks the ones whose licence allows a test fixture here; the others
stay outside the repo.

## CAD

| File | Source | Licence | Exercises | Commit |
|---|---|---|---|---|
| `apartment.dxf` | CADCraft `examples/` at `896a390` | MIT OR Apache-2.0 | 58 mixed entities (DIMENSION, HATCH, MTEXT, LEADER, ACAD_TABLE), 9 layers | yes (already `apps/cad/fixtures/`) |
| `3_us_main.dxf` | ezdxf repo, `examples/edgeminer/` | MIT repo; map data origin unstated | 10,053 LINEs: the frame-time file | no |
| `0040000C01.DXF` | French cadastre, cadastre.data.gouv.fr, 2026-09-01 release, `dxf-010040000C01.tar.bz2` | Licence Ouverte (check the version) | 1,232 entities (POLYLINE, TEXT, INSERT), 110 layers | not unless the licence is checked |

No real drawing with 10,000+ mixed entities was found; the mixed stress file
was the cadastre sheet tiled 3×3 (11,088 entities).

## PDF

| File | Source | Licence | Exercises | Commit |
|---|---|---|---|---|
| `NIST.SP.800-218.pdf` | nvlpubs.nist.gov | US government work | 36 pages, outline, images: the timing file | yes |
| `NIST.AI.100-1.pdf` | nvlpubs.nist.gov | US government work | 48 pages, outline | yes |
| `fw9.pdf`, `f1040.pdf` | irs.gov | US government work | AcroForm, 27 and 229 fields | yes |
| an annotated PDF | generate with pypdf (Highlight, Text, FreeText, Square, Line on pages of a NIST file) | derived from public domain | existing annotations | yes |
| a signature-field PDF | generate with pdf-lib (one empty `/Sig` field) | ours | the visual signature in a field | yes |

## Slides

| File | Source | Licence | Exercises | Commit |
|---|---|---|---|---|
| `45541_Footer.pptx` | Apache POI `test-data/slideshow/` | Apache-2.0 repo; the deck's origin unverified | 11 slides, notes, real animations, transitions on all | no |
| `aptia.pptx` | POI `test-data/slideshow/` | as above | custom master and theme | no |
| `stress013.pptx` | POI `test-data/integration/` | as above | 23 slides, 14 notes pages, animations | no |
| `WithLinks.ppt` | POI `test-data/slideshow/` | as above | the `.ppt` refusal | no |
| generated twins | python-pptx plus hand-written `<p:timing>`, as in `apps/slides/src/engine/__fixtures__/` | CC0 | the same cases | yes (already) |

## Sheets

| File | Source | Licence | Exercises | Commit |
|---|---|---|---|---|
| `maxindextest.xls`, `WeekNumFunctionTestCaseData.xls` | POI `test-data/spreadsheet/` | Apache-2.0 repo | legacy BIFF8 | no |
| `47813-real-chart.xlsx` | POI `test-data/spreadsheet/` | as above | a real chart | no |
| a chart-and-merge workbook | generate with openpyxl (2 charts, 4 merged ranges) | CC0 | the lossy-save warning | yes |
| a 10 MB workbook | generate with openpyxl (5 sheets × 20,000 rows × 9 columns, formulas, a frozen pane) | CC0 | the worker keeps the window responsive | no (size) |
| `big-formulas.xlsx`, `big-values.xlsx` | generate with openpyxl 3.1.5 in a throwaway container (2026-10-28): 5 sheets, a frozen pane, an item text of about 35 characters, an integer, an unrounded float and four 2-decimal floats per row; then either `=B{r}*C{r}` and `=SUM(D{r}:G{r})` (22,000 rows, 220,000 formulas, no cached values, 10.3 MB) or the two results as values (20,000 rows, 9.6 MB) | CC0 | brief 13's timing | no (size) |
| `calc-small.xlsx` | generate with openpyxl 3.1.5: A1=2, B1=3, C1 `=A1*B1`, D1 `=C1+1`, then 1,999 rows of `A{r}`, `=A{r}*2`, `=SUM(A$1:A{r})` | CC0 | formulas recompute after an edit; the save waits; the row-1000 bug | yes |
| `edge.csv` | generate: BOM, CRLF, quoted commas and newlines, doubled quotes, `007`, 20-digit numbers, text dates, `=1+1` | CC0 | CSV fidelity | yes |
| `fidelity.xlsx`, `styles.xlsx` | the built-in's, in `apps/sheets/src/engine/__fixtures__/` | ours | the fidelity bar | yes (already) |

## Docs

| File | Source | Licence | Exercises | Commit |
|---|---|---|---|---|
| a tracked-changes `.docx` | generate with python-docx plus raw `w:ins`/`w:del` (a table, headings, lists, two authors) | CC0 | interop, tracked changes | yes |
| `.doc`, `.odt`, `.rtf` | LibreOffice conversions of it | CC0 | refusals by name | yes |
| the normalizer case | a `.docx` missing `styles.xml`, `document.xml.rels` and `docProps/custom.xml`, as the built-in's normalizer test builds it | ours | the silent-save-loss repair | yes |
| a `.docx` with a header | generate with python-docx | CC0 | header editing with several windows | yes |
| `find-walk.docx` | generate with python-docx 1.2.0 in a throwaway container (2026-10-28): a header, a heading, 30 paragraphs each with one "hello", a closing "hello" | CC0 | find-as-you-type (31 matches, the wrap), three windows with a header | yes |

## The crafts (reference only)

Shallow clones of `storytold/{cadcraft,deckcraft,pdfcraft,gridcraft,wordcraft}`
were read at `896a390`, `5a76518`, `4164951`, `2ebdf16` and `e05b7fe`; see
[craft-reference.md](craft-reference.md). They hold almost no test files.
