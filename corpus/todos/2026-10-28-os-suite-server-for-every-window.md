---
title: Every Office window waits on, and fails with, the suite server
created: 2026-10-28
status: open
tags: [os, marketplace, server, cad, dwg, owner]
---

# Every Office window waits on, and fails with, the suite server

Found in [brief 14](../briefs/done/14-cad-opens-dwg-through-a-suite-server.md).
In imbatranimOS `31a248c`, `type` and `server` belong to the descriptor
(`apps/backend/src/modules/marketplace/catalog.ts`, schema 2), the lease is
keyed by the descriptor's id (`useServerLease`), and `KitAppHost` throws when
the lease fails. CAD's DWG server made the suite a `service`, so all five
apps pay for it. Measured in the production image (one Sheets window, time
from the double-click to its "Open a spreadsheet" button, load 27–32):

| Install | No server running yet | Server already up |
|---|---|---|
| `static` (before brief 14) | 1,023–1,152 ms | — |
| `service` (brief 14) | 2,745–5,027 ms, "Starting its server…" shown | 1,083–1,516 ms |

- The first Office window of a session waits 1.7–3.9 s longer (Node,
  Fastify and the health check; LibreDWG itself loads only per conversion).
- When the server cannot start, **every** Office window shows "Sheets
  stopped working" (seen with the catalog's command pointed at a missing
  file), not only CAD's DWG open.
- While any Office window is open the server holds one of the OS's four
  server slots (`MAX_SERVERS`) and about 100 MB.

What fixes it is an OS change, so it would be an imbatranimOS brief:

- a per-app flag (`server: true` on CAD only) so the other apps stay
  static and never lease; or
- leasing on demand: the kit lets an app ask for its server when it needs
  it (CAD on its first DWG) and handle a failure itself, instead of the host
  leasing before the app renders.

Until then the owner chooses: keep `service` (DWG works, every Office window
pays the cold start and shares the failure), or ship the suite `static` and
leave DWG off until the OS has one of the above.
