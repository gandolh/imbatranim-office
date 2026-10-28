# Task 12 — Docs: one blinking caret when several windows are open

## Context

Promoted 2026-10-23 from the todo
[2026-10-22-docs-caret-in-every-window](../../todos/2026-10-22-docs-caret-in-every-window.md).

Since `1ca83c0`, when more than one Docs instance is on the page, Docs marks the
hidden-host wrapper of each instance's active editor with
`data-editor-ui-surface`, so SuperDoc's window-level input bridge stops pulling
focus to another instance's editor (the code is in
[`apps/docs/src/engine/superdoc.ts`](../../../apps/docs/src/engine/superdoc.ts),
around the `activeSurfaceChange` / `headerFooterModeChanged` listeners at
`:131`). Typing goes to the right window.

The side effect: SuperDoc's selection overlay reads focus inside a marked element
as "focus is on editor UI" and keeps its caret painted. With one window open
nothing changes; with three, all three blink.

SuperDoc is `@harbour-enterprises/superdoc` **1.46.3** now (the commit was written
against 1.45). Its bundle matches `[data-editor-ui-surface]` alongside its own
toolbar and tooltip selectors (`.sd-toolbar-dropdown-menu`,
`.toolbar-dropdown-menu`, `.sd-tooltip-content`) in
`dist/chunks/src-*.es.js` (checked 2026-10-23).

The todo ruled out two fixes on purpose: hiding the caret with CSS on SuperDoc's
classes, and timing the marker to keystrokes. Look for a SuperDoc option first.

Run this after [brief 10](../done/10-docs-find-as-you-type.md), which owns `apps/docs/**`.

## Files you OWN

- `apps/docs/src/engine/superdoc.ts`, `superdoc.test.ts`
- corpus: this brief's outcome, `status.md`, `log.md`

## Files you must NOT touch

- `node_modules/` or a patched SuperDoc: no `patch-package`.
- The `data-editor-ui-surface` marker logic's job: keystrokes must keep going to
  their own window.

## What to do

1. **Read SuperDoc first.** In the 1.46.3 bundle, find the code that decides the
   caret stays painted when focus is inside an editor-UI surface, and look for a
   documented option or API that controls it (a config flag, a per-instance
   "inactive" state, a method that hides the selection overlay). Write what you
   find in the outcome, with the bundle location.
2. If there is an option: drive it from which window is focused, so only the
   focused window's instance shows its caret. Focus is known from the window's own
   `focusin`/`focusout`, or from the OS's `system.window.isFocused()`.
3. If there is none: stop, record the finding, and leave the todo's two rejected
   fixes rejected. The owner decides between a CSS rule, an upstream issue, or
   living with it.
4. Check the find bar (brief 10) and header/footer editing still work with three
   windows open.

## Acceptance

- Three Docs windows open: only the focused one shows a blinking caret, and
  typing still goes to the focused window, body, header and footer alike.
- One window open: unchanged.
- Or, if step 3 applies, the outcome note says where SuperDoc decides this and
  that no option exists, and nothing in `apps/docs` changed.
- `npm run typecheck`, `npm run lint`, `npm test` pass.

## Outcome (2026-10-28)

**Step 3 applies: SuperDoc 1.46.3 has no option for this. Nothing in
`apps/docs` changed; the owner decides** between a CSS rule, an upstream
issue, or living with it. The todo's two rejected fixes stay rejected.

**Where SuperDoc decides** (`dist/chunks/src-CZNV1SVe.es.js`, line numbers
in 1.46.3):

- `PresentationEditor#updateSelection` (≈131789) paints the local selection
  layer (`.presentation-editor__selection-layer--local`, which holds the
  caret) for the body. It clears the layer in two cases only. The first is
  a view lock: `#isViewLocked() && !allowSelectionInViewMode` (≈131806;
  `#isViewLocked` ≈133848 is the viewing mode or enforced protection). The
  second is `!hasFocus && !contextMenuOpen && !isOnEditorUi &&
  !isDragDropIndicatorActive` (≈131820), where `isOnEditorUi` is
  `document.activeElement.closest("[data-editor-ui-surface],
  .sd-toolbar-dropdown-menu, .toolbar-dropdown-menu")` (≈131818). That is a
  page-wide test, not one about this instance's own surfaces.
- `#updateHeaderFooterSelection` (≈133730), used while a header or footer
  session is open, paints the caret with no focus test at all.

**No option.** `PresentationEditorOptions`
(`super-editor/src/editors/v1/core/presentation-editor/types.d.ts`) has
`allowSelectionInViewMode`, `presence` (remote cursors only),
`disableContextMenu` and `documentMode`, and nothing for the local caret.
None of `PresentationEditor`'s public methods hides the local selection
layer or marks an instance inactive. `registerUiSurface` (the WeakSet half of
the UI-surface registry) is not exported. The only documented call that
clears the layer is `setDocumentMode('viewing')`, a whole mode switch: the
document goes read-only, the toolbar and comment visibility change and the
page gets `presentation-editor--viewing`. It is not a caret option and was
not tried. It is listed here only so the owner knows it exists.

**Step 4, walked.** imbatranimOS `31a248c`'s production image, suite
`d5f0631` (Docs as at HEAD), three windows on `find-walk.docx` and two
copies, dragged apart:

- Typing went to the focused window, in the body (a marker typed in each
  window landed only in that window) and in the header (double-click the
  header, End, type: likewise).
- Brief 10's find box in window 1 with three open: "hello" stayed in the box
  with focus, 1 of 31, Enter stepped, and no window turned dirty.
- Carets, body: after a click and typing in each window in turn, only the
  focused window painted a caret. Each window's layer cleared when it lost
  focus, and neither scrolling the background windows nor a viewport resize
  repainted them, so the body symptom did not show in this walk. The code
  path is still there: any repaint of a background window while focus is
  in a marked surface (another window's active editor, or a find bar since
  brief 10) paints its caret.
- Carets, header: every window with a header session open painted its
  caret, three at once, focused or not. The sessions stayed open after
  Escape and after one click in the body (3 of 3). This comes from
  `#updateHeaderFooterSelection` having no focus test, and by that code a
  single window in a header session keeps its caret painted after focus
  leaves too, marker or not.
- No CSP violation and no console error.

Gates: typecheck, lint, test, build:os and format:check pass at `2c1d254`
(nothing in `apps/docs` changed after `d5f0631`).
