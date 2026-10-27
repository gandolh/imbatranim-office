# Task 07 — Slides: the acceptance walk in the OS

## Context

Brief [04](../done/04-slides-that-edit.md) built Slides and passed its spike;
its walk inside a real OS was cut off. This brief is that walk, with the OS's
built-in Slides viewer beside the suite. When it passes, the OS runs its brief
165 (retire the built-in Slides).

## Files you OWN

- `apps/slides/**` (fixes only)
- corpus: this brief's outcome, `status.md`, `log.md`

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

## Walk (each line: pass or fail, with one line of evidence)

- [ ] Viewer parity on the same decks as the built-in: rendering, the "layout
      may differ" note, Download original, thumbnail rail, speaker notes, fit
      width and fit page, Present (fullscreen, Escape, arrows), Export slide as
      PNG through the OS's save dialog (the PNG is not blank).
- [ ] Opens from Files (Open With → Slides (Office), and after "Always use"),
      from its own Open button, and from recents (attributed to
      `office-slides`); `.ppt` is refused by name.
- [ ] On each of the three test decks (test-files.md: the 11-slide deck, the
      custom-theme deck, the animations-and-notes deck): change a title, move
      and resize a shape, add a slide from a layout, delete one, drag two into
      a new order, edit a note, save, close, reopen. The edits are there.
- [ ] Each saved deck converts with LibreOffice headless (throwaway container)
      to a PDF with one page per slide and the edited text; every zip entry the
      edits did not touch is byte identical to the original.
- [ ] Dirty mark, the save-conflict dialog (each answer), Save as, the close
      guard, New presentation (opens in LibreOffice), three windows at once.
- [ ] No CSP violation (PNG export, pictures, fonts).

## Acceptance

Every line passes, or the brief stays in `todo/` with the failing lines named
in the log. The outcome says in one line whether the OS can run brief 165.

## Outcome (2026-10-27)

**Walked; every line passes after one fix (`8f5b2f6`).** The OS was imbatranimOS
`74dfe27` in its production image, run in a container of its own on a
throwaway volume, with the built-in Slides beside the suite; Office was
installed from the Marketplace pane in 58 s (suite `2176219`, then the fix).
Headless Chrome, driven over CDP. The decks were the three in
[test-files.md](../../wiki/test-files.md) plus `WithLinks.ppt`.

- **Viewer parity: pass.** Both apps drew all three decks (the suite with the
  masters and fonts the built-in leaves out), and both showed the "layout may
  differ" note. In both, Download original gave the file byte for byte, the
  rail toggled, fit width and fit page switched, and Present went
  fullscreen, stepped with the arrows and left on Escape. Notes matched on
  stress013 and aptia. Export slide as PNG went through the OS's save dialog
  (suite 1920×1440, 5,633 colours; built-in 926×695).
- **Opening: pass.** Open With, then "Always use" and a double-click, the
  suite's own Open button (the OS dialog, filtered to `.pptx`), and Start's
  Recent all opened `office-slides`. The recents were attributed to it.
  `WithLinks.ppt` was refused by name: "PowerPoint 97-2003 (.ppt) is not
  supported."
- **Edits on the three decks: pass.** Title, a shape moved and resized, a
  "Title and Content" slide added, the last slide deleted, two slides dragged
  into a new order, a note, save, close, reopen: all there, in the window and
  in the XML.
- **LibreOffice and untouched entries: pass.** The saves converted to 23, 11
  and 9 pages with the edited titles. 151 of 160, 85 of 97 and 67 of 75
  entries were byte identical. The rest were the edited slide (and its rels),
  `presentation.xml` and its rels, `[Content_Types].xml`, an edited or new
  notes page, and what only a deleted slide used (its notes, an OLE object
  and its VML drawing, a picture).
- **File chrome: pass.** Dirty mark; the conflict dialog's Overwrite (window
  copy written), Reload from disk (disk copy shown, clean) and Cancel
  (nothing written, still dirty); Save as adding `.pptx`; the close guard's
  Save, Don't Save and Cancel; New presentation, saved and opened by
  LibreOffice and python-pptx; three decks edited and saved in three windows
  at once, each save holding only its own edits.
- **CSP: pass.** No violation and no console error through the walk (PNG
  export, pictures, fonts). A probe image from another origin showed the
  listener was live.

**Fixed.** The notes box threw away the first key typed after a pause:
"ab", a pause, then " cd" left "abcd". `NotesPane` never recorded its own
commits coming back, so the next key looked like an undo. `8f5b2f6` fixes it,
with a test. All five gates passed, and notes typed with pauses were re-walked
on the three decks.

**Seen, not suite defects.** Open With lists both apps as "Slides" with no
"(Office)"; the duplicate goes when OS brief 165 removes the built-in. The
built-in shows a notes page's date placeholder as its notes (45541), where
the suite shows only the body text. The suite opens at fit page, the built-in
at fit width. Save as through the OS dialog leaves a second recents entry
without the extension the app adds.

**The OS can run brief 165.**
