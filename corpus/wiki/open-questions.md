---
summary: What is genuinely unresolved for imbatranim-office: the CAD engine pieces and the Slides save strategy (both settled by their briefs' spikes), DWG support, and which app first needs a server.
updated: 2026-10-21
---

# Open questions

Delete a question here the moment it is answered; its history goes to
`status.md` and `log.md`.

- **CAD's engine pieces.** Which DXF reader and writer, and whether Canvas 2D
  holds 60 fps on a large drawing. Settled by brief 03's spike.
- **How Slides saves without losing what it doesn't understand.** The brief
  expects patching the package in place rather than regenerating it. Settled by
  brief 04's spike.
- **DWG.** No browser reader without WebAssembly exists. A suite server could
  convert DWG to DXF with LibreDWG (GPL-3.0, compatible with AGPL-3.0). Not
  planned; worth a brief only if the owner works with DWG files.
- **The first server.** No app in briefs 01–06 needs one yet: Docs, Sheets and
  PDF already run entirely in the browser, and CAD and Slides export in the
  browser too. The first one-off job that is too heavy for a tab (a thumbnail
  service for Files, a conversion) creates `server/` and its own brief.
