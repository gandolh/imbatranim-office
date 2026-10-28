---
summary: What is genuinely unresolved for imbatranim-office. One question as of 2026-10-28, from brief 14: keep the suite a service descriptor (DWG opens, but every Office window waits for the suite server's cold start and fails with it) or ship it static until the OS can lease a server per app. CAD's engine, Slides' save strategy and how LibreDWG runs are settled; see decisions.md.
updated: 2026-10-28
---

# Open questions

Delete a question here the moment it is answered; its history goes to
`status.md` and `log.md`.

## Keep the suite a `service` descriptor?

[Brief 14](../briefs/done/14-cad-opens-dwg-through-a-suite-server.md) made
DWG work through the suite's first server, and the OS ties a server to the
whole descriptor: every Office window leases it. In the production image the
first Office window of a session took 2.7–5.0 s instead of 1.0–1.15 s, and
with a server that cannot start every Office window shows its crash panel.
Keep `service` (DWG works; the cost above), or ship `static` and leave DWG
off until imbatranimOS can lease a server for one app or on demand. The
numbers and the OS options are in the todo
[os-suite-server-for-every-window](../todos/2026-10-28-os-suite-server-for-every-window.md).
