# W2 UCM actual capture repair — 6 October 2026

Disposition: **integration_pending**. This is bounded offline repair evidence.
Fresh student runtime, acceptance and topic counts belong to the parent.

## Assignment and ownership

Worker: this bounded UCM repair session. Integration owner: parent W2.
No agents were spawned. Parent Ohm, W3 and section runtime lanes were untouched.

Worktree: `/Users/kaizen/heytutor-cov-wt/w2-ucm-live-fix-20261006`.
Branch: `cov/w2-ucm-live-fix-20261006`.
Frozen source/base: `/Users/kaizen/heytutor-cov-wt/w2-integration-20261006`
at `16b1783e6d690ae2abd54c01caffb840d89842ad`.
Topic: `physics|2|uniform-circular-motion` / CH-01c, 2026 matrix.
Read AGENTS, coverage plan, matrix index/progress, Physics row, ownership,
ucm-ready-20261004 and w1-ucm identity/precision contracts.

Production ownership:

- New `packages/scene-engine/src/physics/uniformCircularAuthority.ts`.
  That named file did not exist at the base; it now holds bounded source and
  whole-IR joins, not a scene factory or replacement formulation.
- Existing `uniformCircularIdentity.ts` and `uniformCircularSourceBinding.ts`.
- Additional precise physics path `uniformCircularSource.ts`, announced before
  editing: the authority lives here at this base. No concurrent overlap.
- New dedicated gate, runner, capture/oracle fixtures and these worklogs.

No registry, core, app, synthesis, general central guard, ledger, main,
remote, runtime service, browser, provider, DB or environment-file edits/access.

## Actual reproduction

All three completed captures were read only after their `*-live.json` existed;
the clockwise capture was consumed after the parent confirmed closure at
07:16:44Z. Evidence directory:
`/Users/kaizen/heytutor-claude-coord/runtime/runs/2026-10-06T0710-w2-1f53a1c0/evidence`.

The persisted artifacts are `retry_required`, with no scene, ProblemIR or
solver. Each planner exchange nevertheless contains a complete raw ProblemIR.
The exact extracted raw IR and canonical persisted plan are in
`packages/scene-engine/scripts/verify/fixtures/w2-ucm-live-20261006/`, together
with completion timestamps and SHA256s of live/planner/problem captures.
No account, auth, audio, provider or session payload is copied.

The production normalizer preserves every fact, entity, expression, constraint,
intent and request ID for all three inputs. Their local solver results audit
against their actual canonical plans. The baseline normal family declines:

- Car: actor label `car` has a speed quote without repeating the actor noun.
- Stone: actor has radius/period evidence; `horizontal circular path` names the
  source's horizontal circle.
- Clockwise: `moving body` and `circular path` identify the source's body/circle.

A direct UCM document compiles on the baseline, but the normal family and
live/save/read source admission reject these entity joins. This repair retains
all original IR channels and IDs and uses the source's single owner to prove
these aliases. No visual decision/archetype was forced; no narrower or fake IR
replaced the actual formulation.

## Reusable behavior and independent evidence

The bounded contract consumes all setup clauses and requests for one named
body, a positive radius and a speed or period. It proves owner, exact unit
literals, stated sense and every requested role. Full variable-free ASTs must
be built from certified source operands and circular-law operators; evaluated
numeric coincidence does not bind a formula. Input/output units and request
fact ownership are independent joins. Every fact, unused expression, hidden
constraint, entity and intent is reviewed. Unsupported obligations decline.
A source-proved uniform-motion assumption and a circle graph intent remain
supported, preserving the older actual saved stone full IR.

Supported stale plan scalars are corrected at full source precision, including
small discrepancies the historical rounding tolerance retained. Unknown roles,
units and requests remain in the plan and decline the bounded figure. Source
input literals are exact; derived scalars may use the existing gamma(8)
binary64 arithmetic error bound. The wider historical profile keeps its prior
correction policy. Source-bound scene relations now participate in structural
comparison, including after source markers are removed.

Independent oracles, separate from the implementation:

| Case | r (m) | v (m/s) | omega (rad/s) | a (m/s²) | Other expected |
| --- | ---: | ---: | ---: | ---: | --- |
| Actual car | 50 | 20 | 0.4 | 8 | T = 5π s; no invented sense |
| Actual stone | 0.8 | 0.8π | π | 0.8π² | T = 2 s; no invented sense |
| Actual clockwise body | 12 | 6 | 0.5 | 3 | Clockwise, signed omega negative |
| Independent car | 4 | 8 | 2 | 16 | T = π s |
| Independent centimetre bead | 0.02 | 0.4 | 20 | 8 | Explicit cm → m AST operators |
| Independent fractional period | 0.5 | π/4 | π/2 | π²/8 | r = 1/2 m, T = 4 s |
| Independent equal-value body | 2 | 2 | 1 | 2 | Anticlockwise; numeric equality cannot swap roles |

Final gate: **246 groups, zero failures**. It exercises normal synthesis,
source-authority compilation, live and save admission, reordered JSONB object
keys, raw stored-source admission, the read sanitiser and actual presentation
restore. It rejects extra/duplicate bodies, requested evidence used as body or
formula evidence, hidden topology/equations/expressions/requests, constant or
cancelling same-value ASTs, wrong role/rate/unit, lost binding/request, unsupported
intent, invented fact numerals/premises/requests, markerless geometry/label/unit
forgeries, unknown plan rows, source conditions/third bodies/unreadable units,
and reversal of the actual rotational angular-velocity input.

These are offline calls into the production imported graph; they are not a new
student runtime, HTTP persistence, DB read, audible reveal or browser replay.
The resulting scene uses the existing `qualitative_verified`, nonmetric UCM
presentation and source-certified scalar values. Rendered labels/reveal/pixel
placement code is unchanged.

## Commands and baseline comparison

All commands ran in the own worktree, with:

```sh
export PATH=/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin:/opt/homebrew/bin:$PATH
pnpm install --offline --frozen-lockfile --ignore-scripts
pnpm --filter @heytutor/drawing build
pnpm --filter @heytutor/scene-engine build
pnpm --filter @heytutor/tutor-core build
node packages/scene-engine/scripts/verify/run-w2-ucm-live.mjs
pnpm --filter @heytutor/scene-engine typecheck
pnpm exec tsc -p /tmp/w2-ucm-gate-tsconfig.json
pnpm --filter @heytutor/scene-engine exec eslint src/physics/uniformCircularAuthority.ts src/physics/uniformCircularSource.ts src/physics/uniformCircularSourceBinding.ts src/physics/uniformCircularIdentity.ts scripts/verify/verify-w2-ucm-live.ts
node --check packages/scene-engine/scripts/verify/run-w2-ucm-live.mjs
git diff --check
```

Install downloaded zero packages. Drawing, engine and core builds pass,
sequentially. Engine typecheck, scoped gate/import graph typecheck, scoped ESLint,
runner syntax and diff checks pass. The temporary gate tsconfig extends the own
app tsconfig, includes only the gate, disables incremental output and specifies
the own app's Node type roots. The runner bundles the existing app alias/JSON
import graph offline using the already-installed esbuild dependency, then
imports it from an isolated temporary directory and removes the directory.
Direct tsx hit the existing import-conditions/JSON-loader mismatch; no product
config or dependency was changed to work around this verification tooling issue.

Baseline comparison restored the three existing owned files from the frozen
base with `git show <base>:<path>`, built engine then core, ran the dedicated
runner against each existing gate, and restored the patched files in `finally`.
The new helper is inert in the old production path. The whole new gate on that
baseline reports 22 groups / 13 failures, including all three actual family
reproductions. Fixtures and all actual normalized IDs are unchanged.

The existing gates were run independently with:
`node packages/scene-engine/scripts/verify/run-w2-ucm-live.mjs file://<own-worktree>/<gate-path>`.
No other session's gate was edited or made dependent on this layer.

| Existing gate | Frozen base | Final patch | Meaningful comparison |
| --- | --- | --- | --- |
| verify-w2-motion-source | 47/47 | 47/47 | Older actual stone and relative cases remain green |
| verify-ucm-selection | 33 checks | 33 checks | Selection and presentation unchanged |
| verify-ucm-ready | FAIL | FAIL | Same first assertion and full assertion-message digest: normal family figure |
| verify-w1-ucm-identity | FAIL | FAIL | Same full assertion-message digest for positioned P full-IR normal family |
| verify-w1-source-trust | FAIL | FAIL | Same `assert.ok(carScene)` failure digest |
| verify-w1-ucm-precision | FAIL | FAIL | Same `assert.ok(scene)` failure digest |

The four inherited failing gates stop early; this is not a claim that all their
later assertions pass. Failure messages/digests, command log paths/hashes and
parent-seam output are in [the evidence receipt](w2-ucm-live-fix-20261006-evidence.json).
No full app/DB/remote/provider suite was run.

## Parent seams and remaining work

1. **Stored plan obligations:** the gate's `PARENT_SEAM` reproducer adds an
   `extraForce` unknown to the actual corrected car plan, while retaining its
   complete actual IR and verified source document. Normal synthesis declines.
   Live/save reject through engine-value admission, but raw read reports no
   issue and presentation restore admits it. Parent should audit UCM plans in
   `apps/tutor/lib/scene/sourcePlanAdmission.ts`, which all three lifecycle paths
   already call: validate the actual plan/question and run the whole bounded
   `uniformCircularRuntimePlanConflicts` join before reading/restoring ink.
   Export the helper through the parent-owned engine index as needed. Do not
   authorize unknowns merely because existing scene quantities match.
2. Parent retains responsibility for joining solver result-binding IDs to plan
   IDs at persistence and for detecting obligations discarded by a normalizer.
   The three actual captures lose no channels/IDs under the current normalizer;
   the worker never substituted a successful fallback IR.
3. Parent integrates/reviews this commit and runs fresh normal car, stone and
   clockwise student turns, saves/reopens/replays them, then owns count updates.
4. This bounded helper does not expand position, mass/force, interval, symbolic,
   angular-input or general compound-source certification. Historical broader
   UCM gaps remain separate. Four base gate failures remain documented above.

| Exact topic | Scope | Tier | Proposed state | Remaining |
| --- | --- | --- | --- | --- |
| physics\|2\|uniform-circular-motion | Three exact runtime captures + four independent speed/period oracles | Offline qualitative_verified source state | integration_pending | Parent plan-read seam, fresh runtime and acceptance |

Accepted/READY counts: unchanged. No ledger/root count edits. Commit authored as
RishiVhavle, `rishivhavle21@gmail.com`, with `core.hooksPath=/dev/null` and no coauthor.
Integration-owner disposition is pending.
