---
summary: The locked calls behind imbatranim-office: its own repo installed as one suite descriptor, TypeScript with editing in the browser, kit apps on the desktop's shared kit, the crafts as reference only, PDF Viewer and norPDF merged, and office-* app ids, with what each rejected and why. Read before proposing an alternative; CAD's engine (dxf-viewer's parser, @tarikjabiri/dxf, Canvas 2D) and Slides saving by patching the package in place; and DWG through the suite server, LibreDWG as WebAssembly in Node, one child process per file (brief 14).
updated: 2026-10-28
---

# Decisions

Settled with the owner on 2026-10-21, in a grilling held in the imbatranimOS
corpus (its `corpus/wiki/decisions-office-suite.md` records the OS side).
Restated here from the suite's side. Changing one needs an explicit revisit and
a `log.md` entry.

## The office apps are their own repo, installed as one suite descriptor
_2026-10-21_ — Docs, Sheets, Slides, PDF and CAD live here, not in the OS's
`apps/add-ons`. The OS installs them from one catalog descriptor
(`schemaVersion: 2`, an `apps` array) that lives in the **OS** repo and pins a
commit of this one: one clone, one build, five apps, each switchable on its own.
Rejected: the ArtCraft crafts in sandboxed frames (OS brief 161); keeping the
apps built in; five descriptors, each cloning and building this repo again.
**Why**: the owner wants an OS whose apps are all web UI, with the office suite
as its own product, the way game-engine's games are. The descriptor stays in the
OS repo because the catalog is the OS's trust anchor: only code at a commit the
OS reviewed runs natively in its page.
- *Consequence*: AGPL-3.0, because Docs uses SuperDoc.
- *Consequence*: shipping a change means a commit here, then a commit in the OS
  repo that moves the descriptor's pin.

## TypeScript, editing in the browser, a server only for one-off jobs
_2026-10-21_ — Every app is TypeScript. The engine that edits a document runs
in the browser. A Fastify server, where an app needs one, does jobs that run
once per request: conversion, PDF export, thumbnails.
Rejected: the crafts' Rust engines behind an API with a TypeScript rewrite
later; all the work in an API with every edit sent over a WebSocket.
**Why**: the cost is the UI, which is rebuilt either way. Editors call their
engine on every keystroke and pointer move, so a network hop makes page layout
and CAD lag. The OS image has no compiler and forbids prebuilt binaries. The
craft engines (93k–201k lines each) have no stable API and change daily. A later
rewrite would build every app twice.
- *Consequence*: no WebAssembly in an app, because the desktop's CSP refuses it.
  A library that needs wasm (a DWG reader, for one) can only run on the server.

## Kit apps, on the desktop's shared kit
_2026-10-21_ — Each app exports a React component. The desktop renders it in
its own tree and lends it React, React DOM and `@imbatranim/ui` at runtime (OS
brief 163). This repo builds against a snapshot of the kit taken at a named OS
commit and keeps those modules external.
Rejected: bundling a copy of the kit (a React per app, restyles arrive only on
a pin bump); a kit of our own styled with the OS's theme variables (most
drift, and the moved apps' kit code rewritten).
**Why**: the apps must stay OS apps. The moved ones use `useSystem()`, the kit's
dialogs and the save helpers, which only work against the desktop's instances.
The coupling is acceptable because the owner controls both repos.
- *Consequence*: a kit snapshot older than the OS's `SHARED_KIT_VERSION` stops
  the apps from opening until this repo is rebuilt against a new snapshot.

## The crafts are the reference, never a dependency
_2026-10-21_ — The ArtCraft crafts show how each feature behaves and how it
can be built. Nothing of theirs is imported, and their name and logos are never
used. Translated code keeps its notice. See
[craft-reference.md](craft-reference.md).
Rejected: wrapping their engines (see above); forking them.
**Why**: they are the most complete open clones of the apps we are building,
and MIT/Apache lets us learn from them freely. Depending on code that changes
daily with no stable API would chain every release here to theirs.

## PDF Viewer and norPDF become one app
_2026-10-21_ — The suite has one PDF app. The owner's call during the grill.
Rejected: keeping two apps, the OS's 2026-08-03 call (norPDF owns `.pdf`; PDF
Viewer stays as the light option).
**Why**: two apps for one file type was a workaround for norPDF's slower first
page, not a product choice. The merged app has to keep what justified the light
one: a first page as fast as PDF Viewer's, with the editing tools loaded only
when used. Brief 06 holds the measurement.

## App ids are `office-*`, not the built-ins' ids
_2026-10-21_ — The descriptor is `imbatranim-office`, shown as "Office". The
apps are `office-docs`, `office-sheets`, `office-slides`, `office-pdf` and
`office-cad`.
Rejected: reusing the built-ins' ids (`docs`, `sheets`, `slides`, `norpdf`).
**Why**: a built-in id always wins in the OS's registry, so a suite app with the
same id would be invisible until its built-in was deleted, and parity could not
be checked side by side. OS brief 164 moves the owner's choices (associations,
desktop icons, the disabled set) from the old id to the new one when a built-in
retires.

## CAD's engine: dxf-viewer's parser to read, @tarikjabiri/dxf to write, our own Canvas 2D renderer
_2026-10-21_ — The DXF reader is dxf-viewer 1.0.50's parser, imported by path
(its `src/parser`, MIT inside an MPL-2.0 package), plus our own raw pass that
adds the layer fields both readers drop (linetype, locked, lineweight) and
keeps every group code of the entities the parser skips. The writer is
@tarikjabiri/dxf 2.9.0 (AC1021), with its extended-data, layer, entity-header
and attribute output replaced by ours, and unmodelled entities written from
their raw group codes. Rendering is Canvas 2D, batched by style and culled with
an rbush index.
Rejected: dxf-parser 1.1.2 (unmaintained, reads no HATCH); dxf-writer 1.18.4
(no MTEXT, INSERT or entity colour); a writer of our own; WebGL (Canvas 2D held
60 fps on 10,053 lines and on 11,088 mixed entities).
**Why**: the fewest losses on the test files, an active parser, a typed writer,
and frame time to spare (brief 03's spike).
- *Consequence*: `npm ci` installs three.js and opentype.js as dxf-viewer's
  dependencies; nothing of them is bundled.
- *Consequence*: entity handles change on every save.

## Slides saves by patching the package in place
_2026-10-21_ — A `.pptx` is opened as its OPC package. Each part the editor
touches is parsed into a lossless XML tree whose untouched nodes write back
their source bytes; an edit changes only the elements it names, and a save
copies every other part byte for byte. The editor's renderer draws from the
same model.
Rejected: regenerating the file from a model (pptxtojson in, PptxGenJS out),
which loses masters, themes, animations and embedded objects on the first
save; DOMParser and XMLSerializer (jsdom's serializer is not Chrome's, and a
worker has no DOM); keeping pptx-preview as the viewer.
**Why**: brief 04's spike: on three real decks, untouched parts came back byte
identical and LibreOffice opened every save.
- *Consequence*: what the editor does not model (charts, OLE, custom XML)
  survives untouched but cannot be edited.
- *Consequence*: deleting a shape prunes the animations on it; deleting a slide
  removes the parts only it used.

## DWG opens through the suite server: LibreDWG as WebAssembly, in Node
_2026-10-28_ (brief 14) — CAD opens a `.dwg` by sending it to the suite's
server, which converts it to DXF with LibreDWG and answers the DXF; CAD reads
it with its own DXF reader. LibreDWG comes from npm as WebAssembly
(`@mlightcad/libredwg-web` 0.8.2, GPL-3.0), runs in Node, and gets a fresh
child process per file. The exchange is a WebSocket (`/dwg-to-dxf`), because
the desktop proxies a service app's HTTP for GET and HEAD only. A DWG is never
written: Save puts a `.dxf` of the same name beside it.
Rejected: LibreDWG from Alpine (`apk add libredwg`), which changes the OS
image; building LibreDWG's C, which needs a compiler the image lacks; any
reader in the browser, where the CSP forbids wasm; the package's own
`DwgDatabase` conversion, which traps on an R2000 sample and would need a DXF
writer of our own; the ODA File Converter, a proprietary binary; a POST route,
which the desktop's proxy does not forward.
**Why**: the spike converted R2000, R2007 and R2018 samples in 0.4–0.85 s
each, and CAD's reader opened all three with every entity, layer and block.
- *Consequence*: the suite is a `service` descriptor. A server belongs to the
  descriptor, so every Office window (Docs, Sheets, Slides, PDF as well as
  CAD) leases it and waits for its health check, and the OS shows an error in
  any Office window whose lease fails. See brief 14's outcome for the cost.
- *Consequence*: one conversion takes 260–320 MB while it runs (the build
  reserves 1 GB of wasm memory); the process ends with the file.
