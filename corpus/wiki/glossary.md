---
summary: The suite's vocabulary: suite, suite descriptor, kit app, shared kit, kit snapshot, built-in, parity, retire, craft, and the five app names (Docs, Sheets, Slides, PDF, CAD), with the synonyms each displaces.
updated: 2026-10-21
---

# Glossary

One canonical name per concept, with the synonyms it displaces. Definitions
only. Terms the OS defines (system handle, capability, kit, association,
intent, marketplace app) mean what its `corpus/wiki/glossary.md` and
`glossary-marketplace.md` say; the ones repeated here are the ones this repo
uses every day.

## The product

**Suite**:
This repo's five apps taken together, as the owner installs them.
_Avoid_: Office (that is the descriptor's display name), the craft suite,
bundle, package.

**Docs**, **Sheets**, **Slides**, **PDF**, **CAD**:
The five apps, by their display names. Their ids are `office-docs`,
`office-sheets`, `office-slides`, `office-pdf`, `office-cad`.
_Avoid_: WordCraft, GridCraft, DeckCraft, PdfCraft, CADCraft (those are the
crafts); norPDF or PDF Viewer for the merged app (those are the two built-ins
it replaces).

**Built-in**:
The OS's own version of an app, compiled into the desktop from its
`apps/add-ons` (Docs, Sheets, Slides, PDF Viewer, norPDF), as opposed to the
suite's version.
_Avoid_: old app, legacy app, native app (in the OS, "native" means a catalog
app run in the desktop's page).

**Parity**:
The state in which a suite app does everything its built-in did, checked item by
item against the parity checklist in that app's brief, in Chrome, with the suite
installed from the catalog.
_Avoid_: feature-complete, done.

**Retire**:
Remove a built-in from the OS once its suite app reaches parity, moving the
owner's choices to the new id (OS brief 164).
_Avoid_: delete, deprecate, sunset.

## How it plugs into the OS

**Suite descriptor**:
The one catalog file in the OS repo (`marketplace/imbatranim-office.json`) that
pins a commit of this repo and lists the five apps.
_Avoid_: Office entry, suite entry, manifest.

**Kit app**:
An app whose module exports a React component that the desktop renders in its
own tree with the shared kit. Every app in this repo is one.
_Avoid_: mount app, embedded app, plugin.

**Shared kit**:
React, React DOM and `@imbatranim/ui` as the desktop lends them at runtime,
versioned together as `SHARED_KIT_VERSION`.
_Avoid_: SDK, runtime, the kit (the kit is the component set inside it).

**Kit snapshot**:
The copy of the OS's `packages/ui/src`, taken at a named OS commit and
committed here, that this repo type-checks, tests and builds its CSS against.
_Avoid_: vendored UI, the kit package, a fork of the kit.

## Outside

**Craft**:
One of ArtCraft's Rust office clones (WordCraft, GridCraft, CADCraft, PdfCraft,
DeckCraft), used as the behaviour reference. See
[craft-reference.md](craft-reference.md).
_Avoid_: upstream (we take nothing from them), dependency.
