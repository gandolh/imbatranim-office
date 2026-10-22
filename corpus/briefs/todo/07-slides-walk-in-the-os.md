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
