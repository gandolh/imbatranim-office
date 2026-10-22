# Task 06 — One PDF app, from PDF Viewer and norPDF

## Context

The OS has two PDF apps (OS repo, checked 2026-10-21):

- **PDF Viewer** (`apps/add-ons/pdf-viewer`, about 290 lines of UI): one canvas,
  zoom and paging, on `pdfjs-dist`. Light and fast.
- **norPDF** (`apps/add-ons/norpdf`, about 3,900 lines) on `@pdfcore/engine`
  (`packages/pdfcore-engine`, about 7,100 lines, pdf-lib plus pdf.js): outline,
  thumbnails, search, annotate, forms, organise (reorder, insert, delete,
  rotate, extract), a visual signature, and save. The OS's
  `corpus/wiki/norpdf.md` describes its modules and the cache contract.

The OS decided on 2026-08-03 that norPDF owns `.pdf` and PDF Viewer stays as the
light option, because norPDF was about 1.2 s slower to the first inked page
(5.3 s against 4.2 s on a 40-page file, cold, production build): it painted its
thumbnail rail and fetched several times the code before the page. The owner's
call on 2026-10-21 is one app (see [decisions.md](../../wiki/decisions.md), "PDF
Viewer and norPDF become one app"). **The merge keeps what justified the light
app**: the merged app paints the first page as fast as PDF Viewer did, and
loads the rail and the editing tools after it, or when first used.

The behaviour reference beyond parity is PdfCraft (see
[craft-reference.md](../../wiki/craft-reference.md)). This brief is a merge, not
new features.

Depends on brief 01. When it reaches parity with **both** built-ins, the OS
runs brief 164 for the PDF pair, which also removes `packages/pdfcore-engine`
from the OS.

## Files you OWN

- `apps/pdf/**`
- `packages/pdfcore-engine/**` (moved here with its tests)
- `os/descriptor.template.json` (the `office-pdf` entry)
- corpus: a new `wiki/pdf.md` (from the OS's `norpdf.md`, updated for the merged
  app), `status.md`, `log.md`, the parity outcome note

## What to do

1. Move norPDF's `src/` into `apps/pdf/src/` and `packages/pdfcore-engine` into
   this repo's `packages/`, from a named OS commit; record it in the log. The
   engine's three entry points stay (`index.ts`, `index.browser.ts`,
   `index.node.ts`) and the browser build must never pull the node entry.
2. **Test-only native code stays out of the build.** The engine's node tests
   render through `@napi-rs/canvas`, a native module. `npm run build:os` must
   not need it, and the OS's install (`npm ci` in a container with no compiler)
   must not fail on it. Check that it installs there from its prebuilt musl
   package or move the node render tests into a workspace the marketplace
   install skips; say which in the log.
3. **The fast first page.** Open a document in a reader view that renders the
   first page with pdf.js before anything else: no thumbnails, no outline, no
   editor code on the critical path. The rail, outline, annotate, forms and
   organise load after the first page paints, or when their button is first
   pressed (dynamic imports). Measure time to first inked page on the same
   40-page file the OS used, cold, from the installed suite: it must be at or
   under PDF Viewer's on the same machine, measured the same day.
4. **The pdf.js worker is a file**, emitted beside `app.mjs` by `build:os` and
   resolved with `new URL(..., import.meta.url)` (the engine's
   `ensureBrowserWorker()` already does this). No CDN, no `blob:` worker.
5. Keep the cache contract: after `save()`, reload the document. Keep the
   preservation tests (`preservation.node.test.ts`) passing unchanged.
6. Keep what is deliberately unsupported unsupported: cryptographic signing,
   OCR, a second renderer, and JPEG2000/JBIG2 images (pdf.js decodes those with
   wasm, which the desktop's CSP refuses).
7. Descriptor entry: `office-pdf`, name `PDF`, `opens: ["pdf"]`,
   `multiInstance: true`, icon `file-pen`, norPDF's sizes (1040×560, minimum
   680×420).
8. Walk the parity checklist in Chrome with the suite installed and both
   built-ins beside it.

## Parity checklist

PDF Viewer's side:

- [ ] Time to first inked page at or under PDF Viewer's (step 3), numbers in
      the log.
- [ ] Zoom and paging behave as PDF Viewer's do, with the keyboard too.

norPDF's side:

- [ ] Outline, thumbnails and search.
- [ ] Annotate (every tool in `AnnotateToolbar`), saved and visible after a
      reopen, not duplicated by a second save.
- [ ] Fill and save AcroForm fields; untouched fields keep their values.
- [ ] Organise: reorder, insert, delete, rotate, extract.
- [ ] The visual signature, as a stamp and in a signature field.
- [ ] Saving an untouched document does not change it.
- [ ] Opening from Files and Open With, recents, Ctrl+S, the dirty mark, the
      save conflict dialog, Save as, the close guard, several windows.
- [ ] Drag and drop from the host still opens a file; the Open button uses the
      OS's dialog, never the browser's file input.

## Acceptance

- `npm run typecheck`, `npm run lint`, `npm test` (the engine's tests,
  preservation included) and `npm run build:os` pass.
- Every parity line is ticked, or the brief stays in `todo/` with the failures
  named in the log.
- The outcome note says whether the OS can run brief 164 for the PDF pair.

## Outcome (2026-10-22)

**Built in `a810d77` (+ `ded2bb6`); the in-OS walk and timing move to brief
[09](../todo/09-pdf-walk-in-the-os.md).** norPDF and `@pdfcore/engine` moved
from imbatranimOS `56e23b7`, preservation tests unchanged. First inked page in
a standalone production page, headless Chrome, cold, 5–7 runs each: a 36-page
NIST file took a median 237 ms against PDF Viewer's 492 ms, a 48-page one 248
against 508 (no 40-page public file was found). The pdf.js worker is one file
and one shared `PDFWorker`: the engine's `import.meta.url` worker became a
`data:` URL in a library build, which the CSP refuses. `@napi-rs/canvas` stays
test-only and installs from its musl prebuild. Deliberate changes from the
built-ins are in [pdf.md](../../wiki/pdf.md) (the conflict dialog on save, no
write for an untouched document, PDF Viewer's zoom steps, a fixed side panel).
Keep one `pdfjs-dist` in the tree (`npm dedupe` if SuperDoc's optional peer
nests a second copy).
