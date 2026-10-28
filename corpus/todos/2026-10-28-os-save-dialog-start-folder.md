---
title: The OS save dialog cannot start in a given folder
created: 2026-10-28
status: open
tags: [os, kit, files, cad]
---

# The OS save dialog cannot start in a given folder

Found in brief 14. `system.fs.pickSave` takes `title`, `extensions` and
`suggestedName` (`vendor/imbatranim-ui/src/system.ts`), and the OS's
`FilePicker` always opens at the home root (`apps/core/src/shared/components/files/FilePicker.tsx`
at imbatranimOS `31a248c`). So "Save a DWG drawing as a `.dxf` next to it"
cannot go through the dialog: CAD confirms a fixed name beside the DWG
instead (`saveBesideDwg` in `apps/cad/src/shell/useCadFile.tsx`), and Save
as still starts at home.

A `startIn: { root, path }` option on `pickSave` (and `pickOpen`) would let
CAD offer the dialog in the DWG's folder, and let every editor's Save as start
where its file is. It is an imbatranimOS change (the kit's `system.ts`, the
file portal and `FilePicker`), so it would be a brief there, then a kit sync
here.
