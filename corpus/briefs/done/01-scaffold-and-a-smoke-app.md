# Task 01 — The scaffold, the build the OS runs, and a smoke app

## Context

The repo is empty apart from the corpus, README and LICENSE. This brief builds
the skeleton every app brief depends on: the workspaces, the build the OS's
marketplace runs at install, the kit snapshot, the externals, the CSS rule, the
descriptor template, and one throwaway app that proves a window opens. Read
[architecture.md](../../wiki/architecture.md) and
[decisions.md](../../wiki/decisions.md) first.

**Depends on the OS.** Building and testing this repo does not. The acceptance
step that opens a window does: it needs imbatranimOS briefs 162 (one descriptor,
several apps) and 163 (the shared kit) built in the OS. Do steps 1–6 any time;
step 7 waits for them. If 163 changed the contract while it was built (the
global's name, the module keys, `App`'s props), its outcome note and the OS's
`marketplace/README.md` win over this brief.

## Files you OWN

- `package.json`, `package-lock.json`, `.npmrc`, `.gitignore`, `tsconfig*.json`,
  `eslint.config.js`, `.prettierrc`
- `packages/shared/**`
- `vendor/imbatranim-ui/**`
- `apps/smoke/**` (deleted again by brief 02)
- `os/descriptor.template.json`
- `vite.config.ts` (or `tools/build-os.ts`), `THIRD-PARTY-NOTICES.md` (created
  empty, with its header)
- corpus: `architecture.md` (to match what was built), `status.md`, `log.md`

## Files you must NOT touch

- The OS repo, except step 7's descriptor, which goes in through an OS commit
  of its own.

## What to do

1. **Workspaces.** npm workspaces with `apps/*` and `packages/*`. Exact pins
   everywhere (`save-exact=true` in `.npmrc`). Package names
   `@imbatranim-office/<name>`, all `private`, all `AGPL-3.0-only`. Node 24,
   TypeScript, ESM.
2. **The kit snapshot.** Copy the OS's `packages/ui/src` into
   `vendor/imbatranim-ui/src` from a named OS commit, with
   `vendor/imbatranim-ui/COMMIT` holding that commit and `SHARED_KIT_VERSION`.
   Map `@imbatranim/ui` to it for TypeScript and Vitest. Add
   `npm run kit:sync -- <os-checkout> <commit>` that refreshes the copy from a
   local OS checkout and rewrites `COMMIT`. Pin `react`, `react-dom`,
   `@types/react`, `tailwindcss` and `@base-ui/react` to the versions the OS's
   lockfile resolves at that commit (on 2026-10-21: React 19.2.7, Tailwind
   4.3.3; check again).
3. **The externals.** In `packages/shared`, a Vite plugin that marks `react`,
   `react/jsx-runtime`, `react-dom`, `react-dom/client` and `@imbatranim/ui`
   external and rewrites every import of them, named, default and namespace, to
   a read from `globalThis.__imbatranimShared.modules['<specifier>']`. Test it
   on a fixture module: the output has no bare import of those five.
4. **The build.** `npm run build:os` runs one Vite library build, ES format,
   with one entry per app, writing `dist/os/<app>/app.mjs`, the app's
   `app.css`, and shared chunks beside them. The build must run in the OS's
   install container: argv only (no shell features), Node from the image, no
   network beyond `npm ci`, no postinstall scripts that download binaries.
   Workers are emitted as files next to the entries (Sheets and PDF use them).
5. **The CSS rule.** Each app's stylesheet is Tailwind utilities only, built
   against the token names in the snapshot's `theme.css`, with no preflight and
   no `@theme` values of its own. A check fails the build if `app.css`
   contains a preflight rule or redefines a `--color-*` token.
6. **The smoke app.** `apps/smoke` exports `App` that renders a kit `Button`,
   reads the window's intent file through `useSystem().fs.readWithVersion`, and
   shows its size; a `ConfirmDialog` opens from the button. Unit-test it under
   Vitest with a fake `SystemProvider`.
7. **The descriptor and a real window.** Write `os/descriptor.template.json`:
   `schemaVersion: 2`, `id: "imbatranim-office"`, `name: "Office"`, `sharedKit`,
   `build.install: ["npm", "ci"]`, `build.command: ["npm", "run", "build:os"]`,
   `build.output: "dist/os"`, and an `apps` entry for `office-smoke` (in
   development only) with `multiInstance: true` and `styles`. In the OS dev
   container, put a copy with a `file:` repo and the current commit in the OS's
   `marketplace/` (local only, never committed there), install it from the
   Marketplace pane, and open the smoke app.

## Acceptance

- `npm ci`, `npm run typecheck`, `npm run lint`, `npm test` and
  `npm run build:os` pass from a clean clone.
- `dist/os/smoke/app.mjs` imports none of the five shared specifiers;
  `app.css` has no preflight and no token values.
- In the OS dev container (after OS 162 and 163): the suite installs from a
  local descriptor in one build; the smoke app opens in three windows at once;
  its button and dialog are the desktop's own (same accent, follows a change in
  Settings); it reads the file it was opened with; its stylesheet is added once.
- `vendor/imbatranim-ui/COMMIT` names the OS commit, and `kit:sync` reproduces
  the snapshot byte for byte from it.

## Outcome (2026-10-21)

**Built in `2c57c37` (steps 1–6) and `92fb703` (step 7), walked in the OS.**
npm workspaces with exact pins; `npm run build:os` is one Vite library build
with an entry per `apps/<name>/src/App.tsx`, shared chunks and workers as
files, run unchanged in the OS's install container (`node:24.14.1-alpine`, no
network for the build, argv only). The externals plugin turns imports of the
five shared specifiers into reads from `globalThis.__imbatranimShared`, named,
default and namespace; `@imbatranim/core`, deep kit paths and
`react/jsx-dev-runtime` are refused at build time. The kit snapshot is OS
`4e233b9` (`SHARED_KIT_VERSION` 1, `src/theme.css`); `kit:sync --check`
reproduces it byte for byte from git objects.

**In the OS dev container** (OS 4e233b9, suite installed from a local
descriptor): one build (one fetch, `npm ci`, `build:os`, about 21 s); the smoke
app opened in three windows; its button and ConfirmDialog were the desktop's
own and followed an accent change; Open With on a `.txt` gave its size and line
count, counted in its worker; one stylesheet `<link>` for three windows and
after an update. **In the production image** (real CSP, fresh volume): the
Marketplace pane installed the suite in 28 s, and smoke and Docs ran with no
CSP violation.

The descriptor template is `os/descriptor.template.json` (its ref is a
non-hex placeholder, so the OS refuses an unpinned copy), kept in step with
the build by a test; `os/README.md` is the local-install recipe. Smoke was
added `opens: ["txt"]` for the walk (Open With lists only apps that declare
`opens`) and was deleted by brief 02.
