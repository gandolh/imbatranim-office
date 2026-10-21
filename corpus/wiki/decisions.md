---
summary: The locked calls behind imbatranim-office: its own repo installed as one suite descriptor, TypeScript with editing in the browser, kit apps on the desktop's shared kit, the crafts as reference only, PDF Viewer and norPDF merged, and office-* app ids, with what each rejected and why. Read before proposing an alternative.
updated: 2026-10-21
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
