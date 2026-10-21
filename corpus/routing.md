# Routing — how work routes in this project
<!-- Read by the orchestrate skill at work-intake. Tune freely; keep it short. -->

**Implement skill:** `plan-split-dispatch` for briefs with three or more
independent chunks; smaller briefs are implemented inline.
**Review skill:** `code-review` for correctness; an adversarial security review
before committing anything that touches files, the server or the build.
**PR skill:** none. Local commits on `main`, one per brief plus one for the
corpus record. The owner pushes; never push.
**Issue tracker:** none. `corpus/briefs/` is the tracker; `wiki/status.md` holds
one line per brief.
**Code host:** GitHub, origin only. No hosted CI.

## Intent routing

| Signal | Intent | Route to |
|---|---|---|
| New idea or task to capture | capture | `corpus-flow` §1, add a todo |
| Ready to build, three or more independent chunks | build | brief → `plan-split-dispatch` |
| Ready to build, one indivisible piece | build | brief → implement inline |
| "work on brief NN" | build | `corpus-flow` §3: grill → plan → implement |
| "done" | closeout | `corpus-flow` §4: move brief, log, fold into wiki |
| A change that needs the OS to grow (descriptor, kit, marketplace) | cross-repo | a brief in the imbatranimOS corpus, not here |
| Big or contentious design | design | `grill-me`; decisions to [wiki/decisions.md](wiki/decisions.md), terms to [wiki/glossary.md](wiki/glossary.md) |
| UI polish | design | `impeccable`, inside the OS's locked identity only |
| "how does the craft do X" | reference | [wiki/craft-reference.md](wiki/craft-reference.md), then the craft's own docs |
| "what does the wiki say about X" | query | `corpus-flow` §5, index first, at most three pages |

## Knowledge routing

| Question shape | Route to |
|---|---|
| "Why is it built this way?" | [wiki/decisions.md](wiki/decisions.md) |
| "What do we call this?" | [wiki/glossary.md](wiki/glossary.md) |
| "Where do things stand?" | [wiki/status.md](wiki/status.md) |
| "What is the planned layout?" | [wiki/architecture.md](wiki/architecture.md) |
| "What is still open?" | [wiki/open-questions.md](wiki/open-questions.md) |
| "How should feature X behave?" | [wiki/craft-reference.md](wiki/craft-reference.md) → the matching craft's parity docs |
| "How does an app talk to the OS?" | the OS repo: `packages/ui/src/system.ts` is the spec; `marketplace/README.md` for kit apps |
| "Did I get every usage?" | `grep -rnw`; nothing else is complete |
| "Does it still work?" | `npm run typecheck`, `npm test`, `npm run build:os` |
