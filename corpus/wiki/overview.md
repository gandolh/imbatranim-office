---
summary: What imbatranim-office is: the office apps of imbatranimOS (Docs, Sheets, Slides, PDF, CAD) in their own repo, installed from the OS's Marketplace as one entry and rendered with the desktop's own React and kit, and where it came from.
updated: 2026-10-21
---

# Overview

imbatranim-office is the office suite of imbatranimOS, a web OS whose desktop
is a React app served from one container. It holds five apps:

| App | What it does | Where it comes from |
|---|---|---|
| Docs | Word documents (`.docx`), on SuperDoc | moved from the OS's built-in Docs |
| Sheets | Spreadsheets (`.xlsx`, `.xls`, `.csv`), on Univer and ExcelJS | moved from the OS's built-in Sheets |
| Slides | Presentations (`.pptx`), viewing and editing | the OS's Slides could only view; editing is new |
| PDF | Reading, annotating, forms, organising and saving PDFs | the OS's PDF Viewer and norPDF, merged |
| CAD | 2D drafting with DXF in and out | new; the OS had none |

## How it reaches the user

The OS's Marketplace installs the suite from one catalog descriptor in the OS
repo, pinned to a commit of this repo. The OS clones it, builds it on the
machine and lists the five apps in Start. Each opens in an OS window as a React
component rendered with the desktop's own React and `@imbatranim/ui`, so it
looks and behaves like a built-in app. The owner can switch off any app they
don't want.

## Lineage

On 2026-10-19 the owner asked to bring ArtCraft's "Crafting Apps"
(WordCraft, GridCraft, CADCraft, PdfCraft, DeckCraft) into the OS. They are
Rust apps drawn on a canvas, so a first plan put them in sandboxed frames (OS
brief 161). On 2026-10-21 the owner turned that down: the OS should behave like
an OS whose apps are all web UI. The office apps leave the OS for this repo, in
TypeScript, and the crafts stay as the reference for how each feature behaves.
The reasoning is in [decisions.md](decisions.md).

## Where things live

- `corpus/`: this wiki and the briefs. Start at [index.md](../index.md).
- The code layout is planned in [architecture.md](architecture.md) and built by
  brief 01.
