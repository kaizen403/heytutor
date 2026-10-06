# W2 UCM whole-field guards — 6 October 2026

Disposition: **integration_pending**. Topic: `physics|2|uniform-circular-motion`
(CH-01c, 2026 matrix). No accepted-topic or readiness-count change.

## Assignment and scope

Worker: fresh bounded UCM implementer in this session. Integration owner: parent
W2. No subagents were spawned; no Astral agent was used.
Worktree: `/Users/kaizen/heytutor-cov-wt/w2-ucm-whole-guards-fix-20261006`.
Branch: `w2-ucm-whole-guards-fix-20261006`.
Frozen combined base: `2314ec33b6fb421028bca597f819bca17cc2b168`, from
`/Users/kaizen/heytutor`. The base includes the parent's plan admission/export
repair from `8b40735`; this assignment changes none of those seams.
Read AGENTS, coverage plan, matrix index/progress/readiness, ownership, prior
worker evidence and the independent F1–F4 review at:
`/Users/kaizen/heytutor-claude-coord/reviews/w2-ucm-final-20261006/REPORT.md`.

Production ownership is **only**
`packages/scene-engine/src/physics/uniformCircularAuthority.ts`.
New session-owned gate/runner/fixtures and this log/receipt are the other files.
No existing gate, captured car/stone/clockwise fixture, index, registry, core,
app, synthesis, ledger, environment file, provider, runtime service, remote,
main, stash or another worktree's dist was changed. Drawing/engine/core builds
use this worktree's own offline dependencies and Node 24.21.0.

This is actual full-IR admission for one source actor on a circle, with positive
radius and speed/period, SI derived circular identities, and completely read
requests. Source-only admission and the broader historical positional, interval,
angular-input, mass/force and symbolic profiles are **outside** this declared
actual-full-IR scope. Their existing behavior is not certification that a
missing original IR was retained. Unsupported whole statements decline.

## Fixes and independent regression signal

- **F1:** Exact unchanged source statements remain admissible. Other given
  statements must completely match the bounded role/literal/unit grammar,
  including the source actor and path qualifiers when explicit. Request
  statements and quotes must consume the same complete role set; unknown
  operations, negation, added actors, units, numbers and remainders decline.
  Evidence offsets are also checked against the question. No bag of numbers
  or substring grants statement authority.
- **F2:** The existing exported plan checker audits complete bounded claims and
  assumptions: constant speed, circle laws, inward direction, perpendicularity,
  tangency, source sense and the supported point-particle/display conventions.
  Claim equation chains check structural circular identities, unit-owned exact
  values and explicitly marked rounding. Unknown prose and known outward,
  zero-acceleration, increasing-speed and reversed/invented-sense claims decline;
  their text remains in the returned plan. Nonzero invented uncertainty
  declines. Nongiven zero uncertainty requires an exact deterministic value;
  an unknown without such a value cannot carry it.
- **F3:** Requested-plan coverage runs even with `unknowns=[]`; both source input
  roles must also remain. Supplied IR cannot omit the body/path or their setup
  intent. The empty plan also declines when IR is absent. The remaining missing
  original-IR *presence* hook is parent owned (below).
- **F4:** Constraints/intents need setup evidence containing the radius and no
  requested-only or mixed-request setup proof. A uniform-motion assumption may
  participate only when its entire evidence is the verified source setup.
  Every expression evidence fact must supply a required operand role or be
  explicitly consumed by a matching evaluate request whose result binding
  covers the expression's complete evidence set. Requested facts never supply
  operands. This preserves the older saved stone IR's full request/formula
  binding; appending a requested fact to the new captures remains fatal.

No scene factory, English topic router, authored question template, per-case
runtime ID/metadata exception, validator bypass or narrower replacement IR was
introduced. The existing law AST matcher, exact operands, identities, units and
source precision remain intact.

The dedicated gate runs the real production normalizer with all six original
channels/IDs, solver, normal synthesis, source-authority compile, live/save,
reordered JSONB raw read, sanitizer and presentation restore. It exercises all
review mutation classes and independent whole-field negatives. It also observes
missing-original-IR source-only admission as `PARENT_HOOK`, outside positive
controls, rather than asserting it as a successful full-IR case. The compiler
is also exercised with the actual plan option: it currently does not run the
UCM whole-plan guard. Its acceptance of plan-only mutations is recorded as a
parent central-hook gap, not counted as correct plan compilation. IR negatives
reject compilation atomically; correct full-IR controls compile. Plan negatives
reject the helper, source correction, synthesis and app lifecycle seams.

Independent numerical oracles, separate from the runtime implementation:

| Profile | Inputs | Independent requested outputs (SI) |
| --- | --- | --- |
| Captured car | r=50 m, v=20 m/s | a=8; T=5π |
| Captured stone | r=0.8 m, T=2 s | v=0.8π; a=0.8π² |
| Captured clockwise body | r=12 m, v=6 m/s | omega=0.5; a=3; signed omega negative |
| New clockwise bead | r=3 cm, v=9 cm/s | omega=3; a=0.27 |
| New anticlockwise particle | r=5 m, v=10 m/s | omega=2; a=20 |
| New kilometre car | r=0.4 km, v=36 km/h | omega=0.025; a=0.25 |
| New period stone | r=1.5 m, T=3 s | v=π; a=2π²/3 |

The three captured fixtures and the previous worker's four holdouts are
unchanged. Native bank coverage is not inferred from these authored profiles.

## Verification

With the Node 24 bin directory specified by the assignment first in PATH:

```sh
pnpm install --offline --frozen-lockfile
pnpm --filter @heytutor/drawing build
pnpm --filter @heytutor/scene-engine build
pnpm --filter @heytutor/tutor-core build
node packages/scene-engine/scripts/verify/run-w2-ucm-whole-guards.mjs source
node packages/scene-engine/scripts/verify/run-w2-ucm-whole-guards.mjs esm
node packages/scene-engine/scripts/verify/run-w2-ucm-whole-guards.mjs baseline
pnpm --filter @heytutor/scene-engine typecheck
pnpm exec tsc -p /tmp/w2-ucm-whole-gate-tsconfig.json
pnpm --filter @heytutor/scene-engine exec eslint src/physics/uniformCircularAuthority.ts scripts/verify/verify-w2-ucm-whole-guards.ts
node --check packages/scene-engine/scripts/verify/run-w2-ucm-whole-guards.mjs
git diff --check
```

Install: 666 packages, zero downloads. Own drawing/engine/core builds ran
sequentially and passed. Engine typecheck, the gate's full app import-graph
TypeScript check, scoped ESLint, runner syntax and diff whitespace pass.
The temporary tsconfig extends the own app tsconfig with incremental disabled,
only this gate included and Node types from the own app. No runtime/env setup.

The runner bundles the offline app graph using existing esbuild. `source` uses
the current engine TS index; `esm` externalizes that index to the freshly built
own engine's native public ESM, including app connector imports. `baseline`
overlays only this helper from the frozen combined base in memory. It does not
restore files or use another tree's dependencies/dist.

| Gate | Result |
| --- | --- |
| New gate, frozen combined helper | 238 groups; 175 failures; actual F1–F4 admissions reproduced |
| New gate, current TypeScript source | 238 groups; zero failures |
| New gate, current native public ESM | 238 groups; zero failures |
| Unchanged previous worker gate, public ESM | 246 groups; zero failures |
| Unchanged parent actual plan gate, public ESM | 48 checks pass |
| Unchanged motion source gate, public ESM | 47/47 groups pass, including older saved stone |
| Unchanged selection gate, public ESM | 33 checks pass |
| Inherited ready / identity / source-trust / precision | Each fails at its inherited first assertion; complete assertion message and actual/expected/operator properties have identical SHA256s before/after |

The four inherited early-stop failures do not establish later assertions pass.
Full logs and normalized assertion comparisons are in
`/Users/kaizen/heytutor-claude-coord/reviews/w2-ucm-whole-guards-fix-20261006/diagnostics/`.
The adjacent evidence receipt records log hashes and fixture invariance.
Self-review used the code-review-and-quality skill; no independent reviewer was
spawned or claimed. The parent retains independent review.

## Required parent hooks and lifecycle handoff

1. For the actual bounded runtime lane, enforce original full-IR presence before
   live regeneration and before save/read/restore. In the parent's
   `apps/tutor/lib/scene/sourcePlanAdmission.ts` bounded UCM branch, reject
   `rawProblemIR == null`, validate it against the actual question, then call
   the already-exported `uniformCircularRuntimeProblemIssues(contract, problem)`
   and reject its fatal issues **in addition to** plan conflicts and scalar
   staleness. The current parent guard checks the plan but does not require IR.
   All three captured complete-plan/no-IR payloads still use legacy source-only
   admission; this worker does not claim them as full-IR successes.
2. Apply the same presence rule at the parent-owned normal teaching/scene
   generation entry, so a missing planner IR cannot become a successful actual
   turn by source-only regeneration. Preserve source-only legacy profiles under
   an explicit policy outside this scope; do not fabricate a small IR.
3. In parent-owned `packages/scene-engine/src/ir/sceneSourceAuthority.ts`, when
   the caller supplies a plan for a bound UCM source, validate it and reuse
   `uniformCircularRuntimePlanConflicts` plus `stalePlanQuantities`, mapping any
   conflict to a fatal issue. `compileSceneDocument` already passes
   `sourceAuthority.turnPlan` to that function. This central seam currently
   checks UCM IR but not the UCM plan; direct compile can still pair a correct
   source document with a false plan. Add the actual-lane presence rule for
   supplied runtime authority there as appropriate, retaining explicitly scoped
   legacy compilation separately. No central edits are included in this commit.
4. Retain caller IDs and join original requests/result bindings to plan rows
   before source regeneration. This helper now rejects supplied IR lacking
   body/path, setup intents or requests; normalization loss still belongs to
   the parent. Do not delete obligations to obtain a scene.
5. Parent integrates/reviews the owned commit, then runs fresh student car,
   stone and clockwise turns, inspects narration/writing/reveal, saves,
   reopens and replays. No browser, HTTP/DB persistence, audio or new runtime
   evidence was run here. Offline imported-graph results are not lifecycle
   acceptance.

| Exact topic | Checked scope | Proposed state | Remaining owner |
| --- | --- | --- | --- |
| physics\|2\|uniform-circular-motion | Three unchanged actual full-IR controls, four new independent profiles, F1–F4 and whole-field mutations | integration_pending | Parent full-IR presence and compile-plan seams, independent review, fresh student lifecycle and acceptance |

Commit requested by the user; author RishiVhavle <rishivhavle21@gmail.com>,
`core.hooksPath=/dev/null`, no coauthor. No push/merge/publication.
Integration-owner disposition: pending. No ledger or central count edits.
