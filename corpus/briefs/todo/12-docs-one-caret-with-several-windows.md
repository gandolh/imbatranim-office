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

Run this after [brief 10](10-docs-find-as-you-type.md), which owns `apps/docs/**`.

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
