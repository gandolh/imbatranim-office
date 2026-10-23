---
title: Docs shows a blinking caret in every window when several are open
created: 2026-10-22
status: promoted
tags: [docs, superdoc, polish]
---

Promoted 2026-10-23 into [brief 12](../briefs/todo/12-docs-one-caret-with-several-windows.md).

# Docs shows a blinking caret in every window when several are open

Since `1ca83c0` marks each Docs window's active editor surface so keystrokes
stay in their window, SuperDoc's selection overlay reads focus inside a marked
element as "focus is on editor UI" and keeps its caret painted. With one
window open nothing changes; with three, all three blink. Typing goes to the
right window. Hiding it with CSS on SuperDoc's classes, or timing the marker
to keystrokes, were both left out on purpose; look for a SuperDoc option first.
