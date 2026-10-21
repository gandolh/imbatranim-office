# imbatranim-office corpus — schema and conventions

This directory is the project's wiki and work tracker, maintained by the LLM.
The owner curates sources and asks questions; the LLM curates the synthesis and
tracks the work. Chat evaporates; reusable findings get folded back here.

## Layout

```
corpus/
  CLAUDE.md    this file, the rules
  index.md     content catalog (generated: bash corpus/lint.sh --index)
  routing.md   which question goes to which layer, which skill runs what
  lint.sh      health check; --index regenerates the catalog
  log.md       chronological record, newest last, absolute dates
  todos/       captured ideas as prose (pre-spec)
  briefs/      numbered, immutable work specs: todo/ done/ superseded/
  wiki/        the synthesis pages, the actual knowledge base
```

## Retrieval budget (a rule, not advice)

1. Read `index.md` first and triage on the `summary:` lines.
2. Open **at most 2–3 wiki pages**. Needing more means a page must split or a
   summary is not sharp. Fix the cause.
3. Never read `briefs/` or `todos/` wholesale. `wiki/status.md` has one line per
   brief.

## Two repos, one product

This repo holds the apps. The OS repo (imbatranimOS) holds the desktop, the
marketplace that installs this suite, and the catalog descriptor that pins a
commit of this repo. The calls that shaped the split were made in the OS's
corpus (`corpus/wiki/decisions-office-suite.md` there) and are restated, from
this side, in [wiki/decisions.md](wiki/decisions.md). When the two disagree, the
OS's decisions page wins for anything about the OS; this corpus wins for how
the apps are built.

## Project invariants (checked when grilling a brief)

- **AGPL-3.0-only.** Docs depends on SuperDoc (AGPL), and the OS is AGPL.
- **TypeScript only.** No Rust, no compiled binaries, no prebuilt artifacts
  committed for the build. The OS builds this repo from source in a container
  that has Node and no compiler.
- **Editing runs in the browser.** The engine that edits a document lives in the
  app. A server (Fastify), where an app needs one, does one-off jobs:
  conversion, PDF export, thumbnails. Never a round trip per keystroke.
- **The UI comes from the desktop's shared kit.** React, React DOM and
  `@imbatranim/ui` are the desktop's instances, lent at runtime and external at
  bundle time. The OS's house rules apply unchanged (its
  `corpus/wiki/ui-conventions.md` and the locked identity: Win7-classic, black
  and white plus one accent, no border radius).
- **No WebAssembly in the apps.** The desktop's CSP is `script-src 'self'` with
  no `'wasm-unsafe-eval'`. A library that needs wasm runs on the server, or not
  at all.
- **The ArtCraft crafts are a reference, never a dependency.** Read how they
  behave and how they build a feature. Code translated from them keeps its
  MIT/Apache notice in `THIRD-PARTY-NOTICES.md`. Their name and logos are never
  used. See [wiki/craft-reference.md](wiki/craft-reference.md).
- **No GitHub Actions or other hosted CI.** Checks run locally.
- **Exact version pins**, and the shared modules pinned to the versions the OS
  resolves at the commit the kit snapshot came from.

## Conventions

- Every wiki page opens with `summary:` and `updated:` frontmatter. `index.md` is
  generated from them; never hand-maintain it.
- Brief numbers are stable for the life of the file. Never renumber on a move.
- Briefs in `done/` and `superseded/` are immutable (an outcome note is added at
  move time only). New work is a new brief.
- Standard relative markdown links, absolute dates only.
- One concept per file; split a page past about 200 body lines.
- A decision is recorded only if it is hard to reverse, surprising without
  context, and a genuine trade-off. Record the call, the date, what was
  rejected, and why.
- Glossary entries are definitions only, each with the synonyms it displaces.
- Never commit corpus changes unless the owner asks or a brief run is under way
  (then one commit per brief plus one for the corpus record, on `main`, never
  pushed).

## Source-of-truth ordering

1. The actual code and build scripts win over any wiki claim.
2. A brief in `done/` wins over `wiki/` if the wiki has not caught up.
3. `wiki/decisions.md` wins over `status.md` for choices not formally revisited.
4. Verify any path or function a page names before acting on it.

## Workflow

Capture → `todos/`. Promote → `briefs/todo/NN-slug.md`. Build → move the brief
to `briefs/done/` with an outcome note, append a `log.md` entry, fold durable
findings into `wiki/` (always `status.md`).
