---
summary: How imbatranim-office is laid out and built (brief 01): npm workspaces with one package per app, packages/shared (externals plugin, CSS rule, vendor stylesheets, OS build, fake system for tests), the kit snapshot and kit:sync, what `npm run build:os` writes to dist/os, the OS descriptor template and the test that keeps it in step with the build, and how a window gets from the OS's catalog to an app component.
updated: 2026-10-21
---

# Architecture

Built by brief 01; the `process.env` replacement and the
smoke app's removal by brief 02. The code wins over this page:
`packages/shared/src/build/osBuild.ts` is the build.

## Layout

```
apps/<name>/                  one workspace package per app (@imbatranim-office/<name>)
  src/App.tsx                 exports App, the component the desktop renders
  src/app.css                 optional: extra Tailwind directives, checked like the rest
  package.json                `imbatranimOffice.vendorStyles`: library CSS copied beside app.css
packages/shared/              @imbatranim-office/shared
  src/index.ts                types for apps: the kit's KitAppProps and NativeHostContext, re-exported
  src/build/                  Node only: externals, CSS rule, OS build, kit snapshot
  src/testing/                createFakeSystem, renderWithSystem: the test harness
  test/fixtures/              fixture modules and fixture repos the build tests use
vendor/imbatranim-ui/
  src/                        the OS's packages/ui/src at one commit, byte for byte
  COMMIT                      that commit, SHARED_KIT_VERSION, the token file's path
os/
  descriptor.template.json    the OS's catalog entry for the suite, without its pin
  README.md                   how the pinned copy is made; installing from a local checkout
tools/kit-sync.ts             npm run kit:sync
vite.config.ts                npm run build:os (calls osBuildConfig)
vitest.config.ts              tests; maps @imbatranim/ui to the snapshot
dist/os/                      what build:os writes and the OS serves (not committed)
```

`apps/smoke`, brief 01's throwaway app, proved a kit app opens in a window and
was deleted by brief 02; the build fixtures under `packages/shared/test/fixtures/os`
still prove workers and shared chunks. A `server/` workspace arrives only with the
first app that needs a one-off job on the server.

## The build the OS runs

The descriptor's `build.install` is `npm ci` and `build.command` is
`npm run build:os`, argv only. The script is `vite build`: no shell, no network.
No install script downloads anything: the only ones are vue-demi's (under
SuperDoc, via pinia; a local file switch) and fsevents' (macOS only). Tailwind's
oxide and Rolldown come from npm as optional platform packages. Checked in
`node:24.14.1-alpine`, no compiler: `npm ci`, then the build with
`--network none` (brief 02, with SuperDoc).

- **Entries.** Every `apps/<name>` with `src/App.tsx` is an app
  (`discoverApps`). Adding a workspace with that file adds it to the build. The
  name is lowercase letters, digits and `-`.
- **Output.** One Vite library build, ES only, `base: './'`:
  `dist/os/<app>/app.mjs`, `dist/os/<app>/app.css`, the app's vendor
  stylesheets beside them (`dist/os/docs/superdoc.css`), code two apps share in
  `dist/os/chunks/`, workers in `dist/os/workers/`. Entries reach them through
  `../`. The OS serves `dist/os` (the v2 descriptor's `build.output`, OS brief 162).
- **Workers.** `new Worker(new URL('./x.ts', import.meta.url), { type: 'module' })`
  is emitted as a file and loaded by a relative URL. The desktop's CSP has no
  `worker-src`, so `script-src 'self'` applies: file workers only, never blob or
  data. A worker that imports a shared module fails the build (a worker cannot
  see the page's global).
- **Checks** (`osOutputChecks`, after Vite's own plugins): each entry exports
  `App`; no emitted module imports a shared specifier by name or reads
  `process.env`. `define` replaces `process.env.NODE_ENV` (library mode leaves
  it alone) and then `process.env` itself with `{}`: bundled libraries read it
  behind a check for Node (SuperDoc's colour helpers read `FORCE_COLOR`), and in
  the browser those reads are dead code either way.

## The externals

`sharedKitExternals` resolves `react`, `react/jsx-runtime`, `react-dom`,
`react-dom/client` and `@imbatranim/ui`, from app code and from bundled
libraries alike, to generated modules. Each export is a `@__PURE__` read:
`export const useState = sharedExport("react", "useState")`, which reads
`globalThis.__imbatranimShared.modules["react"].useState` when the module is
evaluated, so after the desktop has set the global. Named, default (the whole
module for React's CommonJS packages), namespace, re-export and dynamic imports
all go through them. Values are the desktop's own; unused ones are tree-shaken.
A missing global throws a sentence naming it. A name the desktop's module lacks
reads as `undefined`: a namespace import reads every name up front, and one the
app never calls must not stop it loading.

The export lists come from the pinned packages (React's production build, read
with `NODE_ENV=production` in a child Node) and from the snapshot's `index.ts`.
A name an app imports that is not listed fails the build. The plugin pins
production JSX (`react/jsx-runtime`); `react/jsx-dev-runtime` is a build error.

## Stylesheets

Each app ships `app.css` (Tailwind utilities only, against the kit's token
names) and may declare vendor stylesheets that are copied beside it after a
check that they cannot restyle the desktop. The rules, the check and its
per-library allowances are in [stylesheets.md](stylesheets.md).

## The kit snapshot

`vendor/imbatranim-ui` is imbatranimOS `4e233b9` (briefs 162 and 163 built):
`SHARED_KIT_VERSION=1`, tokens from the kit's own `src/theme.css` (one
`@theme static` block). The shared types (`KitAppProps`, `NativeHostContext`)
come from the kit too; `packages/shared` re-exports them and mirrors nothing.

`npm run kit:sync -- <os-checkout> <commit>` reads `packages/ui/src` at the
commit from git objects (`ls-tree` + `cat-file`, never the working tree),
replaces `vendor/imbatranim-ui/src`, checks every file hashes to its blob, and
writes `COMMIT`. It reads `SHARED_KIT_VERSION` off `sharedKit.ts` and the
tokens from `src/theme.css`. For an OS commit older than 163, which has
neither, it still writes the `@theme` block of `apps/core/src/index.css` as
`theme.provisional.css` and records the version as `absent`. It also moves the
root `devDependencies` pins of the shared modules and the kit's imports to what
the OS lockfile resolves at the commit (then `npm install`). `--check` writes
nothing and exits 1 on any difference.

TypeScript (`paths`) and Vitest (`alias`) map `@imbatranim/ui` to the snapshot.
The snapshot is ignored by ESLint and Prettier and its tests never run here.

## The descriptor

`os/descriptor.template.json` is the OS's catalog entry for the suite
(`schemaVersion: 2`, id `imbatranim-office`, shown as "Office"), with a
placeholder `source.ref` the OS refuses. The OS commits it as
`marketplace/imbatranim-office.json` with a pinned 40-hex ref; `os/README.md`
says how, and how to install from a local checkout. Its `sharedKit` is the
snapshot's version and `minSystemVersion` the kit's `PROTOCOL_VERSION` (2).

The test "this repo's own build" in `osBuild.test.ts` builds the repo and holds
the template to it: one entry per discovered app, id `office-<name>`, `entry`
`<name>/app.mjs`, `styles` equal to `appStylePaths()`, every one of those files
emitted, `build` equal to `npm ci` + `npm run build:os` writing `dist/os`, and
`sharedKit` equal to `COMMIT`'s. An app added without its entry, or a vendor
stylesheet added without listing it, fails there.

## Tests

Vitest, Node by default, `// @vitest-environment jsdom` per file as in the OS.
An app test renders `App` with `renderWithSystem(ui, createFakeSystem({ files,
intent }).system)` from `@imbatranim-office/shared/testing` and calls
`cleanupRendered()` in `afterEach` (it also clears `useOpenIntent`'s
module-level latch). The build tests build fixture modules and fixture repos
and import the output with a fake global set.

## From the catalog to a window

1. The OS's suite descriptor pins a commit of this repo. Installing clones it in
   the OS container and runs `npm ci`, then `npm run build:os`.
2. When a window opens, the desktop checks the descriptor's `sharedKit` against
   its own version, links each of the app's `styles` once per build
   (`<link data-kit-build="imbatranim-office@<buildId>">`), sets
   `globalThis.__imbatranimShared` (frozen, version 1), imports `app.mjs`, and
   renders `App` with `{ windowId, host }` inside the window's
   `SystemProvider` with a scoped handle (OS brief 163).

Walked end to end on 2026-10-21 (brief 01 step 7, brief 02 step 6), at OS
`4e233b9`. In the dev container: one install of `npm ci` + `build:os` in about
20 seconds, the smoke app in three windows with one stylesheet link, the kit's
button and dialog following the accent and theme, Open With handing it a file,
its worker loaded from `workers/`, and Docs beside the built-in. In the
production image, installed from the Marketplace pane on a fresh volume (28
seconds, a cold npm cache): smoke, its worker, and Docs opening, editing and
saving a `.docx` raised no CSP violation under `script-src 'self'`,
`connect-src 'self'`.

SuperDoc 1.45 allows one editable instance per page: each instance's input
bridge listens on `window` and takes keystrokes aimed at any other instance's
editor, so with two Docs windows open (built-in or suite, any mix) typing
reaches neither. The built-in has the same defect.

## Dependency direction

Apps depend on `packages/shared` and on the kit (external at build time). An
app never imports another app. `packages/shared` never imports an app. Nothing
imports `@imbatranim/core` (lint and the externals refuse it), and nothing
reaches the OS repo except the kit snapshot.
