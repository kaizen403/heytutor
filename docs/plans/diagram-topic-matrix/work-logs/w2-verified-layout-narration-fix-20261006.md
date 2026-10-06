# W2 generic verified layout narration brief — 6 October 2026

Disposition: **integration_pending; offline implementation only**. The parent
must independently review the patch, then run and manually inspect a fresh
normal-provider Ohm lesson before any student-facing acceptance. No READY,
FULLY-CERTIFIED, chapter, ledger or accepted-count change is proposed.

Owner: isolated W2 app worker. Base:
`dabbf91d0c3f3c82cff9785872b1e135004bba92`. Worktree:
`/Users/kaizen/heytutor-cov-wt/w2-verified-layout-narration-fix-20261006`.
Scope: generic verified-scene-to-teacher guidance, applicable to the authorized
Maths/Physics continuation. No engine geometry/layout, numerical authority,
question hook, provider, DB, runtime, Chemistry or remote work.

## Source failure and diagnosis

Original evidence:
`/Users/kaizen/heytutor-claude-coord/runtime/runs/2026-10-06T1232-w2-fb6ee26c/evidence/w2-ohm-single-live.json`.
The parent disposition is in that run's `ohm-semantic-parent-disposition.md`.
Saved segment 5 says “battery on the left” and “resistor on the right”. The
original t04 capture inspected by this worker shows resistor above battery;
the parent reports the same t04/final geometry and correct 2 A mathematics.
Parent disposition remains narration FAIL, no READY or lifecycle acceptance.

The reproducible offline seam recompiles the exact saved scene document and
calls `buildVerifiedDiagramPresentation`. Before this fix its teaching addon
names “resistor 6 Ω” and “battery 12 V”, lists their meaning and mark types,
but supplies no positions. Its figure-reading instruction asks for direction
or location anyway. The base tutor prompt repeats that demand. This permits
a customary arrangement to fill the missing layout context.

Ranked hypotheses were omitted layout facts, dropped prompt delivery, and
conflicting planner prose. Source inspection and offline delivery checks show
the addon is retained by `buildTurnTeachingPrompt`, normal/continuation prompt
assembly and `serverChatBody`; `injectStreamOptions` uses that body. Saved
planner reveal prose is “series resistor network with the stated values”,
not a left/right claim. Thus the demonstrated defect is missing compiled-layout
guidance plus an unsupported-position demand. The exact original teaching HTTP
request was not captured: this diagnosis does not claim observed live provider
input bytes or guaranteed model compliance.

The saved artifacts declare `question_representation`, `nonMetric: true`,
while the saved scene document's source lacks those fields. Reconstructing
from that document alone produces the existing metric opening. The gate also
tests the non-metric addon with the saved tier metadata explicitly supplied.
This patch preserves tier handling; the parent should capture the fresh actual
teaching request to check its tier wording rather than treating the offline
reconstruction as the historical request.

## Change and preserved authority

`verifiedLayoutNarration.ts` reads the engine's compiled `entityBounds` and
emits strictly separated whole-bound left-of/above relations for actually
lettered parts with geometric marks. Screen y grows downwards. It does not
create coordinates, move ink, use world positions as screen positions, or
infer subject topology, polarity, physical direction or numerical results.
Label-only targets, annotations, invisible extents, absent/invalid bounds,
overlapping/touching bounds yield no asserted relation. At most 32 facts are
emitted so dense scenes do not flood the prompt. Unlisted relations stay
unsupported.

`verifiedScenePresentation.ts` delivers those facts with existing named FOCUS
targets. The teacher is told to use listed spoken labels, omit unsupported
spatial claims, and override any competing instruction demanding placement
or direction without evidence. Non-metric screen placement never becomes a
physical, scale, connectivity or solver claim. Code-lesson frames receive no
static layout-fact block.

No per-question/topic router, template, regex question match, model diagram
ink or teacher focus coordinates were introduced. No hook/core/engine edit
was needed. The fixture contains exact copies of the captured scene document,
turn plan, ProblemIR and solver result; no captured numeric input is corrected
by this worker. An external pre-fix snapshot is compared with all post-fix
presentation transport except `promptAddon`: commands, anchors, groups,
reveals, intro narration and cue timing are identical.

## Offline checks and artifacts

All artifacts are under:
`/Users/kaizen/heytutor-claude-coord/reviews/w2-verified-layout-narration-fix-20261006`.

Node 24.21.0 / pnpm 10.32.0 used the authorized Node PATH prefix:
`/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin`.
Dependencies were installed in this tree with
`pnpm install --frozen-lockfile --offline` (PASS, `install.log`). No environment
file was copied or parent artifact/runtime modified.

From `apps/tutor`, the red-capable command is:

```sh
pnpm exec tsx scripts/verify/verify-verified-layout-narration.ts
```

Before the patch it failed with “the real teaching brief must carry the compiled
above/below layout”; `gate-red.log` preserves the failing addon. After the patch
it passes against the same captured inputs. This loop catches the deterministic
brief omission, not a generated-model narration error; only a fresh live lesson
can close that latter item.

For the external transport comparison and reconstructed teaching context:

```sh
pnpm exec tsx scripts/verify/verify-verified-layout-narration.ts \
  --baseline /Users/kaizen/heytutor-claude-coord/reviews/w2-verified-layout-narration-fix-20261006/baseline-transport.json \
  --report /Users/kaizen/heytutor-claude-coord/reviews/w2-verified-layout-narration-fix-20261006/reconstructed-teaching-context.json
```

The gate also tests translated/scaled, quarter-turn and half-turn versions of
the saved scene through the real compiler; independent circles, overlap,
touching, invalid bounds, missing/label-only targets, annotations and invisible
extents; the dense-scene bound; named labels/FOCUS meanings; non-metric limits;
and normal, continuation, doubt and provider-message delivery. The fixture is
an oracle only. `source-integrity.json` records original evidence hash and
exact fixture-copy checks. The report is explicitly an offline reconstruction
without a solver projection, not a captured provider request.

Existing focused gates PASS: verified-scene presentation, turn teaching prompt,
representation fallback, label accuracy, label glossary, focus execution,
doubt prompt and teaching transport (`focused-gates.log`). Tutor typecheck and
lint passed initially. Dependency packages were built into this tree with
`pnpm exec turbo run build --filter='@heytutor/tutor^...' --concurrency=1 --cache=local:rw`
(`package-build.log`, 5 successful local-cache restores). Initial isolated
tutor production build passed (`tutor-build.log`). Final results are recorded
in the external handoff after the last bounded-brief review change: new gate PASS
(`final-gate.log`), tutor production build PASS (`final-tutor-build.log`), tutor
lint PASS with 9 existing warnings and no errors (`final-lint.log`), sequential
tutor typecheck PASS (`final-sequential-typecheck.log`). Existing presentation,
turn-teaching and doubt gates also passed after the last change. A concurrent
final typecheck raced Next's regeneration of this tree's `.next/types`
(`final-typecheck.log`, TS6053); rerun sequentially after build completion,
without changing source or relaxing checks; that sequential rerun passed.

The new gate is wired into the tutor's standard `verify` command. The entire
DB/provider-backed verify suite was not run; no DB/provider access is authorized.
No post-patch live render, narration, save/reopen/replay or student lifecycle
credit is claimed.

## Review and integration boundary

The requested diagnosing-bugs and code-review skills were read. The latter's
two axes were reviewed manually because the user prohibited spawning agents;
the explicit assignment is the spec. Standards review uses AGENTS.md, the layout
guide, session ownership and diagram authority architecture. Spec review checks
the generic authority brief, immutable geometry/IR, strict file scope and no
acceptance inflation. The prompt-size finding was fixed with the 32-fact cap.
No remaining local implementation finding is asserted; this self-review is not
the parent's required independent review.

Parent next steps: independently review this commit; integrate serially into
the parent's tree; rebuild its packages/app under its runtime schedule; capture
the fresh normal teaching request and full segments; manually compare every
placement claim against the actual Ohm render (battery below resistor, no
invented left/right); confirm named FOCUS, 2 A writing and tier limits; then run
the parent's affected saved/reopened/whole-replay acceptance work. Prompt tests
alone cannot override the existing parent FAIL or change READY counts.
