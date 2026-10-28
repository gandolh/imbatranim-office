---
title: Docs shows a blinking caret in every window when several are open
created: 2026-10-22
status: closed
tags: [docs, superdoc, polish]
---

Promoted 2026-10-23 into [brief 12](../briefs/done/12-docs-one-caret-with-several-windows.md).

**Closed 2026-10-28 as a known gap.** Brief 12 found that SuperDoc 1.46.3 has
no option to hide an instance's caret, and the owner chose to live with it.
What stays: with several Docs windows open, every window with a header or
footer session open paints its caret (in the body only the focused window
does), and a focused find bar keeps every window's caret painted. Typing
still goes to the focused window. No CSS rule on SuperDoc's classes, no
upstream issue.

# Docs shows a blinking caret in every window when several are open

Since `1ca83c0` marks each Docs window's active editor surface so keystrokes
stay in their window, SuperDoc's selection overlay reads focus inside a marked
element as "focus is on editor UI" and keeps its caret painted. With one
window open nothing changes; with three, all three blink. Typing goes to the
right window. Hiding it with CSS on SuperDoc's classes, or timing the marker
to keystrokes, were both left out on purpose; look for a SuperDoc option first.
