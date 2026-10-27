---
summary: PDF (apps/pdf), the OS's PDF Viewer and norPDF merged into one app, and @pdfcore/engine (packages/pdfcore-engine), moved from imbatranimOS 56e23b7 — what each module owns, the fast first page (pdf.js alone, the engine and editing tools after it), the shared pdf.js worker file, the save→reload cache contract, what the write path is proven to preserve, the timing (standalone, and in the OS where the suite is 40 ms behind PDF Viewer), and what is deliberately not supported.
updated: 2026-10-27
---

# PDF and `@pdfcore/engine`

Brief 06 merged the OS's two PDF apps, PDF Viewer (light, one canvas) and
norPDF (outline, thumbnails, search, annotate, forms, organise, visual
signature, save), into `apps/pdf`, and moved norPDF's engine into
`packages/pdfcore-engine`. Source: imbatranimOS `56e23b7`
(`apps/add-ons/norpdf/src`, `apps/add-ons/pdf-viewer/src`,
`packages/pdfcore-engine`); the OS's `corpus/wiki/norpdf.md` (2026-08-03) is
where this page started. The decision is in [decisions.md](decisions.md), "PDF
Viewer and norPDF become one app".

## The split: app vs engine

**`packages/pdfcore-engine`** keeps its name, `@pdfcore/engine`: the whole PDF
capability, isomorphic, no React. pdf-lib (1.17.1) writes, pdf.js (6.1.200)
reads. It imports nothing of the OS or of this repo, so its source stayed the
OS's bytes except for the worker (below: `adapters/pdfjs/document.ts` and
`worker.browser.ts` changed, `browser/pdf-worker.ts` and `pdf.worker.ts`
added) and `package.json` (exact pins, the `./worker` export, `#pdfjs`). Its
tests run as they did there (`npm test` picks up `src/__tests__/`). It keeps the OS's
formatting (prettier defaults, its own `.prettierrc.json`) and its stricter
tsconfig (`noUncheckedIndexedAccess`), checked by `tsc -b` as its own project.

**`apps/pdf`** is the React app around it (modules below).

## Engine: entry points

| Entry | Binds | Used by |
|---|---|---|
| `index.ts` | nothing | consumers that only need types |
| `index.browser.ts` (`@pdfcore/engine/browser`) | pdf.js render, the text layer | the app (its runtime imports name it) |
| `index.node.ts` (`@pdfcore/engine/node`) | pdf.js render onto `@napi-rs/canvas` | the engine's own tests |
| `browser/pdf-worker.ts` (`@pdfcore/engine/worker`) | the pdf.js worker, nothing else | the app's first page, and the engine |

The bare `@pdfcore/engine` resolves by condition (`node` → the Node entry,
`browser`/default → the browser one); Vite's browser build never takes `node`.
pdf.js itself is the engine's `#pdfjs` subpath import: its legacy build under
`node`, the modern build otherwise. Before brief 06 both builds were literal
dynamic imports chosen at runtime, and the browser build emitted pdf.js's
600 KB legacy build as a chunk nothing loads. An ESLint rule keeps
`@pdfcore/engine/node` out of `apps/`.

## The pdf.js worker

One worker per page, a file: `new Worker(new URL('./pdf.worker.ts',
import.meta.url))` in `browser/pdf-worker.ts`, which `build:os` emits as
`dist/os/workers/pdf.worker-<hash>.mjs` and the app loads by a URL relative to
its chunk. No CDN, no `blob:` or `data:` worker. Every document is opened with
`getDocument({ data, worker: sharedPdfWorker(pdfjs) })`: one `PDFWorker` over
that worker, which no document owns.

The OS's way (`GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/…",
import.meta.url)`) does not survive this repo's build: library mode inlines a
`new URL` asset as a `data:` URL, which put the 1.2 MB worker, base64, in the
engine chunk and gave pdf.js a worker the desktop's CSP refuses. A shared
`GlobalWorkerOptions.workerPort` was tried and fails too: destroying any
document marks the port's `PDFWorker` as being destroyed, and the next
`getDocument` (the reload after every save) throws "the worker is being
destroyed". `configureWorker(src)` remains the engine's escape hatch.

## The fast first page

The merged app must paint the first page as fast as PDF Viewer did (the
decision's condition; norPDF was 1.1 s slower in OS brief 65 because it parsed
the file with pdf-lib and painted its thumbnail rail first). Opening is two
steps (`app/useReaderController.ts`):

1. **pdf.js alone** (`reader/pdfjs.ts`): the worker starts first (its 1.2 MB
   script is the longest download), the library loads while the file is read,
   then pdf.js opens the bytes and measures page 1. That gives the reader a
   `render` (the engine's `Render` capability over this pdf.js document), the
   page count and a layout, and it draws page 1 at its fitted scale, once.
2. **After the first paint** (`painted`, then the frame after it), the engine
   chunk loads and `PdfDoc.load(bytes, readerPlatform(first))` parses the same
   bytes with pdf-lib. The platform hands the engine the reader's own renderer,
   so `doc.render` is the document already drawn: no second parse, no redraw.
   Then the text layer, search, outline, page sizes for every page (pdf.js,
   rotation and crop box applied) and the editing tools arrive.

What loads after the first page, as chunks (`lazy.ts`): the Thumbnails,
Outline and Forms panels (the rail's frame and tabs are there from the first
frame, so the page does not move when it fills in), the annotate toolbar (its
row's height is kept), the per-page annotation overlay, the signature pad (on
first use) and the organise view (on first use), and the engine
(`app/engine.ts`). ESLint holds the modules on the first page's path to type
imports of the engine and pdf.js and to no static import of those chunks
(`eslint.config.js`, the `apps/pdf/src` block). The window's own code on the
way to the page is `pdf/app.mjs` (41 KB, 12 KB gzip) plus small shared chunks.

A PDF the engine cannot open (pdf-lib refuses it, an encrypted file for one)
stays readable: the notice says it cannot be searched, annotated or saved.

## Reading

Continuous scroll, virtualised (pages within a screen of the viewport are
drawn). From PDF Viewer: previous/next page buttons and zoom in 25% steps (from
a fitted 92%, in goes to 100%). Fit width fits the page in view when the fit
is chosen, as PDF Viewer and pdf.js's viewer do; norPDF fitted the widest page,
which halved NIST SP 800-218 (1224 pt spreads on pages 14-28 among 612 pt
pages). Keys, top window only and never while typing: ↑/↓, PageUp/PageDown, Space,
Home/End, `+`/`-`/`0`, and ←/→ for the previous/next page while the page in
view fits the width. Ctrl+F focuses search, Ctrl+S saves.

## Engine: read vs write, and the cache contract

Read capabilities — `render`, `text`, `outline` — read the **current bytes** and
are cached per document. Write capabilities — `annotate`, `forms`, `pages`,
`sign` — mutate in-memory models (`model/annotations.ts`, `model/forms.ts`);
nothing touches the PDF until `PdfDoc.save()`, which commits every model and
returns new bytes. A second `save()` with no further edits is a no-op.

**The contract:** after `save()` the read caches are stale, so the app calls
`reloadDocument()`, which takes the new `doc.render` as the reader's renderer
(the old one is released once its pages are gone), re-measures the pages and
re-reads outline and metadata. Every save path does it before anything else
draws: Save, Export a copy, and the raster syncs of forms, organise and sign
(`editor/EditorProvider.tsx`).

## Saving

Save writes back to the file the document was opened from through the kit's
`saveOverRead` with the version read: a file changed on disk since asks
Overwrite / Reload from disk / Cancel, as Docs does (norPDF wrote over it).
Ctrl+S on a document with nothing unsaved writes nothing, so the file stays
byte for byte as it was (norPDF re-wrote it through pdf-lib). An edit made
while the bytes were on their way keeps the document dirty. A dropped file
(no home in the OS) downloads a copy. Export a copy downloads the document as
it stands (the opened bytes when untouched). There is no Save as, in norPDF
or here.

## App modules

| Path | Owns |
|---|---|
| `App.tsx`, `Pdf.tsx` | the kit entry; the shell, file I/O (intent, OS picker, drop), the replace and close guards |
| `app/` | `useReaderController` (state, the two-step open, save target, reload), `engine.ts` (the engine loader), context, `EmptyState`, `useReplaceGate` |
| `reader/` | `pdfjs.ts` (the first page's pdf.js), `Reader`, `PageView` |
| `shell/` | `TopBar`, `SidePanel`, `ToolButton` |
| `panels/` | `ThumbnailsPanel`, `OutlinePanel` (lazy) |
| `editor/` | `EditorProvider` (edits, save, export); `AnnotateToolbar`, `PageAnnotateLayer`, `SignatureDialog` (lazy) |
| `forms/`, `organize/` | `FormsPanel`, `OrganizeView` (lazy) |

norPDF's `norpdf.css` became Tailwind utilities (the suite takes no CSS from
JS); sticky notes, which have no appearance stream for pdf.js to draw, are
drawn by the overlay so they show after a reopen.

## What the write path is proven to preserve

`preservation.node.test.ts` (OS brief 66, unchanged) runs a fixture with three
pages, full Info metadata and two filled form fields through annotate, forms,
sign and page reorder/delete/rotate/extract, and asserts the change landed and
everything else survived: page count and order, other pages' text, metadata,
untouched field values, annotations on their own page, no duplicates on a
second save, an untouched save that damages nothing. The harness walk of
brief 06 repeated it end to end on real files (below).

## Timing (brief 06, 2026-10-21, standalone)

Method: each app built for production in a harness page with the desktop's
CSP, a fresh headless Chrome per run, runs interleaved; first inked page by
sampling canvas pixels each frame (OS brief 65), from the window mounting to
ink. PDF Viewer at 720×640, PDF at 1040×560 with the rail open.

| File | PDF Viewer (56e23b7) | PDF (suite) |
|---|---|---|
| NIST SP 800-218, 36 pages, 7 runs each | median **492 ms** | median **237 ms** |
| NIST AI 100-1, 48 pages, 5 runs each | median **508 ms** | median **248 ms** |

**In the OS (brief 09, 2026-10-27):** OS `74dfe27`'s production image, the
same sampling from the Open With click, 36-page file, 7 runs each. Before `8880663`: PDF Viewer median
518 ms, the suite 571. After it (pdf.js and its worker load beside the
download): PDF Viewer 534, the suite 574 (550–608). The gap is before the
download: the suite's `app.mjs` and ten shared chunks come from the
marketplace route after the window mounts (about 70 ms, six connections),
while PDF Viewer's chunk loads when the window opens.

## `@napi-rs/canvas`

Test-only (the engine's Node render tests), the engine's devDependency. No
install script, prebuilt per platform: in `node:24.14.1-alpine` `npm ci` took
the musl build, the tests passed offline, and `build:os` passed without it.

## Not supported, deliberately

- **Cryptographic signing.** `sign` places a visual mark (a stamp, or ink in a
  signature field's rect). No PKI.
- **OCR.** Rejected in OS brief 66.
- **A second renderer.** pdf.js is the only one.
- **JPEG2000 / JBIG2 images.** pdf.js decodes them with WebAssembly, which the
  desktop's CSP refuses; no `wasmUrl` is set and no wasm is shipped.

## Known gaps

- **XFA.** pdf-lib drops a form's XFA when the form is first read (IRS W-9
  carries both); the AcroForm fields save. No open-time warning for what the
  engine cannot round-trip (encrypted files, XFA, attachments): OS brief 66
  listed it, not built.
- **A note at the page's right edge** opens its entry box clipped by the
  page; Ctrl+Enter still adds it (as in norPDF).
