---
summary: What is genuinely unresolved for imbatranim-office. Nothing as of 2026-10-28: the owner wants DWG opened, through a suite server converting DWG to DXF with LibreDWG, which makes CAD the first app with a server (brief 14). CAD's engine and Slides' save strategy were settled by briefs 03 and 04; see decisions.md.
updated: 2026-10-28
---

# Open questions

Delete a question here the moment it is answered; its history goes to
`status.md` and `log.md`.

Nothing is open. On 2026-10-28 the owner answered the last two together: they
work with DWG files, so CAD should open them through a suite server that
converts DWG to DXF with LibreDWG (GPL-3.0, compatible with AGPL-3.0). That
makes CAD the first app with a `server/`. How LibreDWG runs under this repo's
invariants (TypeScript only, no compiled binaries in the build, the OS builds
in a container with Node and no compiler) is the first step of
[brief 14](../briefs/todo/14-cad-opens-dwg-through-a-suite-server.md).
