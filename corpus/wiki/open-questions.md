---
summary: What is genuinely unresolved for imbatranim-office: DWG support, and which app first needs a server. (CAD's engine and Slides' save strategy were settled by briefs 03 and 04; see decisions.md.)
updated: 2026-10-22
---

# Open questions

Delete a question here the moment it is answered; its history goes to
`status.md` and `log.md`.

- **DWG.** No browser reader without WebAssembly exists. A suite server could
  convert DWG to DXF with LibreDWG (GPL-3.0, compatible with AGPL-3.0). Not
  planned; worth a brief only if the owner works with DWG files.
- **The first server.** No app in briefs 01–06 needs one yet: Docs, Sheets and
  PDF already run entirely in the browser, and CAD and Slides export in the
  browser too. The first one-off job that is too heavy for a tab (a thumbnail
  service for Files, a conversion) creates `server/` and its own brief.
