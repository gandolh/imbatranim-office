# Task 09 — PDF: the parity walk and first-page timing in the OS

## Context

Brief [06](../done/06-one-pdf-app.md) merged PDF Viewer and norPDF into one
app and measured its first page outside the OS; the walk inside a real OS was
cut off. This brief is that walk, with both built-ins beside the suite. When
it passes, the OS runs its brief 167 (retire PDF Viewer and norPDF).

Deliberate changes from the built-ins, not failures
([pdf.md](../../wiki/pdf.md)): saves go through the conflict dialog; Ctrl+S on
an untouched document writes nothing; fit width fits the page in view; zoom
moves in PDF Viewer's 25% steps; the side panel is a fixed 224 px; sticky notes
are drawn after a reopen; neither app has Save as.

## Files you OWN

- `apps/pdf/**`, `packages/pdfcore-engine/**` (fixes only)
- corpus: this brief's outcome, `pdf.md` (the in-OS numbers), `status.md`,
  `log.md`

## Setting up the OS for the walk

Follow [os/README.md](../../../os/README.md) ("Install from a local
checkout"). Prefer the production image (`docker build -f
infrastructure/Dockerfile --target prod` in imbatranimOS, run with
`-e MARKETPLACE_ALLOW_LOCAL_REPOS=true` and a throwaway volume): it has the real
CSP and the built-ins beside the suite. Claim the machine with a throwaway
password that goes in no file. Fetch the test files the walk needs into a
scratch directory, using [test-files.md](../../wiki/test-files.md); they are
untrusted data, never executed, and the ones without a clear licence are never
committed. Install a `securitypolicyviolation` listener after load and keep
the console open: report every violation and error.

If the walk finds a defect in the app, fix it in this repo, run the gates
(`npm run typecheck`, `npm run lint`, `npm test`, `npm run build:os`,
`npm run format:check`), reinstall from a new local commit and walk the
affected lines again.

## Walk (each line: pass or fail, with evidence)

- [ ] **Timing, the gate:** cold time to the first inked page on the 36-page
      NIST file (test-files.md), PDF Viewer against "PDF (Office)" through Open
      With, same machine, same session: a fresh browser per run, the first PDF
      opened in it, canvas pixels sampled every frame, at least five runs each,
      alternating. The suite's median is at or under PDF Viewer's. All runs in
      the log.
- [ ] Zoom and paging as PDF Viewer's, keyboard too.
- [ ] Outline, thumbnails, search.
- [ ] Every annotate tool, saved, visible after a reopen, not duplicated by a
      second save.
- [ ] AcroForm fill and save on the IRS W-9; untouched fields keep their values.
- [ ] Organise: reorder, insert, delete, rotate, extract.
- [ ] The visual signature, as a stamp and in a signature field.
- [ ] An untouched document is not changed by Ctrl+S (checksum before and after).
- [ ] Files and Open With, recents (`office-pdf`), Ctrl+S, the dirty mark, the
      conflict dialog, the close guard, several windows; the Open button uses
      the OS's dialog, never `input[type=file]`.
- [ ] The pdf.js worker loads as `workers/pdf.worker-*.mjs`; no CSP violation.

## Acceptance

Every line passes, or the brief stays in `todo/` with the failing lines named
in the log. The outcome says in one line whether the OS can run brief 167.
