---
summary: The planned layout of imbatranim-office (not built yet): npm workspaces with one package per app, a shared package, the kit snapshot, the build the OS runs and the output it serves, and how a window gets from the OS's catalog to an app component.
updated: 2026-10-21
---

# Architecture (planned)

Nothing here exists until brief 01 builds it. This page is the target that
brief works to; correct it when the build decides otherwise.

## Layout

```
apps/
  docs/   sheets/   slides/   pdf/   cad/     one workspace package per app
    src/App.tsx                              exports App, the component the desktop renders
    src/engine/                              the app's document engine (browser only)
packages/
  shared/                                    the externals plugin, helpers the kit lacks, test setup
  pdfcore-engine/                            moved from the OS with PDF (brief 06)
vendor/
  imbatranim-ui/                             the kit snapshot, with the OS commit it came from
os/
  descriptor.template.json                   the shape of the OS's suite descriptor, without its pin
dist/os/                                     what `npm run build:os` writes and the OS serves
  <app>/app.mjs  <app>/app.css  chunks…
```

A `server/` workspace arrives only with the first app that needs a one-off job
on the server.

## From the catalog to a window

1. The OS's suite descriptor pins a commit of this repo. Installing it clones
   the repo in the OS container and runs `npm ci`, then `npm run build:os`.
2. The build is one Vite library build with an entry per app, ES modules only.
   React, React DOM and `@imbatranim/ui` stay external: the externals plugin
   rewrites each import to a read from the global the desktop sets
   (`globalThis.__imbatranimShared`, OS brief 163).
3. Each app's CSS is Tailwind utilities only, built with the same Tailwind major
   as the desktop and the token names from the kit snapshot's `theme.css`. No
   preflight and no theme of its own.
4. When a window opens, the desktop checks the descriptor's `sharedKit` against
   its own version, adds the app's stylesheet once, imports `app.mjs`, and
   renders `App` inside the window's `SystemProvider` with a scoped handle.

## Dependency direction

Apps depend on `packages/shared` and on the kit (external at build time). An
app never imports another app. `packages/shared` never imports an app. Nothing
here imports from the OS repo except the kit snapshot.
