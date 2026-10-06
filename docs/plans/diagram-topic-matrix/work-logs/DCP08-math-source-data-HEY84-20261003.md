# DCP08 mathematical own-DATA correction / HEY-84

## Assignment and source contract

- Worker HEY-84; programme coordinator HEY-83; sole MAIN integrator HEY-88. Slot2 explicitly approved before runtime writes in `/Users/kaizen/heytutor/docs/plans/diagram-topic-matrix/work-logs/integrator-DCP05-12-HEY88-20261002.md`, SHA `5a776b8d35887ed395871c504c00f78dad585dd9b8b4f22566d90ecabb374cec`.
- New isolated corrective tree `/Users/kaizen/.capy/worktrees/HEY84-DCP08-own-data-20261003/heytutor`, detached base `eec2d36b151cf4950c9fcfadd7840f53b26415ec`. Owner created exact frozen source/gate copies and read-only dependency symlinks. Support links are untracked in this tree and will not be edited, staged or included in its diff.
- Only five allowed paths: new `compile/mathSourceData.ts`; entry/scalar/geometry hooks in copies of `compile/matrixArrayGeometry.ts` and `compile/indexedProgressionGeometry.ts`; new `scripts/verify/verify-math-source-data-hey84.ts`; this log. Source paths are under `packages/scene-engine/src/`; gates under `packages/scene-engine/`; log under `docs/plans/diagram-topic-matrix/work-logs/`.
- Frozen matrix source baseline `3da91298347ab849c57cb4cb4c5498dbefff4b00634e44dcb3fd24ccff3bc468`, immutable gate `d5118dcd76322826f1f3c826591af3784b854700ac9ba4e8c5f34a4491e155ae`; progression source `8e8f9870f159cc6959654fd6682e40a669a0fbe758b75a062b679d7ebd491c06`, immutable gate `8e7ee18f2d0f9ae313a75c5f85d911485d06f6160d2b26b8cb8690e4971bd39e`.
- Original frozen worker tree, its sources/gates/logs and artifacts remain byte-identical; original CH15 log `a55ffe3c29e283511e984eeaedeec33e6a9f3ef404fb82f5dd58cb6c38dc791e`. Changes here have separate correction hashes, not replacements of old evidence.
- S0 matrix profile unchanged: Main2026 Paper1/Advanced2026; NEET Mathematics not applicable. This is an input-data reliability correction, not a new question cohort, topic pass, S2/S3 source contract or scene/lifecycle admission.
- Affected exact topic IDs: `maths|3|matrices-and-types`, `maths|3|matrix-algebra`, `maths|3|transpose-symmetric-and-skew-symmetric`; `maths|6|arithmetic-and-geometric-progressions`, `maths|6|geometric-progression`, `maths|6|insertion-of-means`, `maths|6|properties-of-ap-and-gp`, `maths|6|mixed-ap-gp-problems`. Their existing complete-topic and graph/source/label/lifecycle obligations remain open.

## Reproduction / frozen baseline

Before this correction, independent worker/owner probes accepted inherited required source fields although JSON serialization omitted them and then failed. Own getters were executed1–4 times and accepted. Own plain-data controls passed. Original arithmetic tests passed; those were not descriptor tests.

Worker evidence: `/Users/kaizen/.capy/work/HEY-84/evidence/source-dossier/math-input-ownership-probe.log` and `math-input-data-finding.md`; owner reproduction `/Users/kaizen/.capy/work/HEY-88/math-input-ownership-review.{mts,json,log}`. This is a direct numerical input-seam defect; no live/student/DB failure or wrong numeric arithmetic is asserted.

Owner reran baselines before handoff: AP core9290/local100cases3000; matrix core9218/local100cases5298, all exit0. Corrective checks will rerun those exact immutable gates and independently prove descriptor failures become rejections without getter execution.

## Changes and checks

Implemented the five allowed paths only. `mathSourceData.ts` takes descriptor snapshots before value reads, producing deeply frozen own-data copies. Records use null prototypes internally so polluted Object.prototype cannot provide missing inputs. Every own descriptor is checked before traversal; getters/setters and symbols reject without executing getters. Arrays require all own indices/length and no extras; sparse/custom-prototype arrays decline. Nonenumerable own DATA fields are retained, including legitimate source wrappers; unknown hidden fields become visible to unchanged kernel field checks rather than being ignored.

Bounds: source path depth64, 16,384 visited nodes/array length, 65,536 own keys and1,048,576 aggregate string characters. Depth64 accommodates the original32-layer scalar wrappers and enclosing input/document structure; original arithmetic/unit/reference bounds are unchanged. True object cycles reject; repeated acyclic references preserve one immutable snapshot. The declared limits are not source-quality exclusions or topic-denominator pruning.

`captureMathSourceData` caches scalar and geometry values by source ID per construction and shares the same object-snapshot map with captured inputs. Resolver methods are trusted integration callbacks run deliberately; their returned values are checked before field reads. Repeated/missing IDs are cached, raw returned accessors are not executed, and alias/mutation controls prove values cannot drift between coefficient/operand reads. This is a data boundary, not a general JavaScript execution sandbox: arbitrary Proxy reflection traps/trusted callback code are not claimed sandboxed.

The two kernel diffs contain only imports and evaluator/render/validator entry hooks, plus producer-map snapshot before replay reads. Numeric formulas, original scalar/rational/root algorithms, arithmetic bounds, unit grammar, labels and primitives are unchanged. Entire validator input envelopes are captured locally at these mathematical entry points; no shared/generic validator file was edited.

RED command, expected exit1 and raw output preserved at `/Users/kaizen/.capy/work/HEY-84/evidence/math-source-data/red-original.log`:

```sh
export PATH="/opt/homebrew/bin:$PATH"
cd /Users/kaizen/.capy/worktrees/HEY84-DCP08-own-data-20261003/heytutor
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-math-source-data-hey84.ts --original-root /Users/kaizen/.capy/worktrees/jam_01M3Z0VA51QDZZD3E341V3VP3Q/heytutor
```

Actual RED: `matrix:entries getter must reject`; original code accepted it. Corrective GREEN passed95 initial controls; final expanded gate passes **295 controls**, including160 complete output/primitive/label JSON parity comparisons across40 matrix and40 AP/GP fixtures against untouched original modules.

Final command chain, exit0; raw output `math-source-data/final-checks.log`:

```sh
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-math-source-data-hey84.ts --reference-root /Users/kaizen/.capy/worktrees/jam_01M3Z0VA51QDZZD3E341V3VP3Q/heytutor &&
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-matrix-array-operators.ts &&
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-matrix-array-operators.ts --holdout &&
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-indexed-progression-operators.ts &&
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-indexed-progression-operators.ts --holdout &&
pnpm --filter @heytutor/scene-engine typecheck &&
pnpm --filter @heytutor/scene-engine lint &&
pnpm --filter @heytutor/scene-engine exec eslint src/compile/mathSourceData.ts src/compile/matrixArrayGeometry.ts src/compile/indexedProgressionGeometry.ts scripts/verify/verify-math-source-data-hey84.ts &&
pnpm --filter @heytutor/scene-engine exec tsc --noEmit --strict --module esnext --moduleResolution bundler --target ES2022 --esModuleInterop --skipLibCheck --typeRoots ../../node_modules/.pnpm/@types+node@20.19.43/node_modules/@types --types node scripts/verify/verify-math-source-data-hey84.ts &&
pnpm --filter @heytutor/scene-engine exec tsup src/compile/mathSourceData.ts src/compile/matrixArrayGeometry.ts src/compile/indexedProgressionGeometry.ts --format esm --dts --out-dir "$HOME/.capy/work/HEY-84/evidence/math-source-data/build"
```

Unchanged matrix core9,218 /100 synthetic holdout cases5,298; unchanged progression core9,290 /100 synthetic holdout cases3,000. Package source and new gate strict types/lints pass; standalone helper/two-consumer ESM/declaration builds pass. Engine lint retains the same four pre-existing DSA warnings; no DSA edits/tests. Dependency links/manifests/setup unchanged. No default package build/runtime exposure claim; owner must integrate/build MAIN afterward.

New gate covers all top required fields, nested scalar/unit/index/observation/witness accessors, unused setters/symbol/hidden extras, custom and polluted prototypes, valid own nonenumerable/null/frozen/JSON controls, scalar depth0–32, true cycles versus DAG aliases, string/node/depth/array limits, raw callback getter returns, resolve-once undefined/alias/geometry controls, resolver mutation isolation, render and validator entries and dependency-map producer data. Getter counters are zero in corrected controls. Original gates remain exact immutable copies and their mathematical holdouts are not relabeled as source/question cohort evidence.

Local verification friction: a source symbol-key index narrowing error was corrected in the new helper; separate gate CLI typechecking exposed unknown-object narrowing and was fixed with an explicit never-function type. Final strict checks passed after those changes. No existing test was renamed, weakened or deleted to pass. All mathematical JSON/primitive comparisons remain exact.

Render evidence is unchanged primitive/label JSON in80 before/after fixtures; existing original packet PNGs remain valid offline artifacts, not new live evidence. Actual source-need, bank cohort, scene registration, canonical saved turns/reveal/replay are still unverified by this corrective packet.

No generic validator, compiler, index/IR/planner/source parser, future packet, MAIN or original-frozen writes. No subworkers, staging, branch creation, commit, push, PR, merge or counter edits.

## Per-topic outcomes

This corrective packet proposes integration_pending only. No central topic state is changed; original topic logs/owner ledger remain authoritative. No topic is accepted from these boundary tests.

| Exact topic ID | Corrective evidence / unchanged oracle | Proposed correction state | Remaining complete-topic obligations |
| --- | --- | --- | --- |
| `maths\|3\|matrices-and-types` | Required/nested own-DATA/getter controls; matrix9218 core/5298 holdout; JSON/primitive parity. | integration_pending | Source/labels/model limits, full required variants and actual reveal/persistence/replay remain in original log. |
| `maths\|3\|matrix-algebra` | Scalar/geometry resolve-once and mutation isolation; unchanged product/add/scale oracles. | integration_pending | Full source/quantity/proof/compound/lifecycle acceptance, beyond bounded arithmetic inputs. |
| `maths\|3\|transpose-symmetric-and-skew-symmetric` | Input/renderer/validator own-DATA entry capture; unchanged transpose/type oracles. | integration_pending | Source/type/label completeness, broader limits and real lifecycle. |
| `maths\|6\|arithmetic-and-geometric-progressions` | Source inputs/quantity callbacks captured, scalar-depth parity; progression9290/3000 and primitive equality. | integration_pending | Coordinate graphs/symbolic inputs, source/cohort and actual turn/replay acceptance. |
| `maths\|6\|geometric-progression` | Required ratio/index/first and raw callback controls; unchanged zero/signed/unit recurrence. | integration_pending | Source graph/label/model-limit review, zero/irrational family gaps and lifecycle. |
| `maths\|6\|insertion-of-means` | Branch/observation data capture; original rational insertion and source-completeness checks unchanged. | integration_pending | Irrational roots/underdetermined zero-family, symbolic cases, source and lifecycle. |
| `maths\|6\|properties-of-ap-and-gp` | Witness/nested input capture and alias caching; original exact property proofs unchanged. | integration_pending | General source/parameter/compound review, graphs, full held-out source cohort and saved turns. |
| `maths\|6\|mixed-ap-gp-problems` | Descriptor correction does not change partial candidate validation. | integration_pending | Complete mixed constraint/branch solving remains unimplemented; source/graph/lifecycle also pending. |

## Handoff

Submit only the five allowed paths with separate corrected runtime hashes. Diff/hashes at `/Users/kaizen/.capy/work/HEY-84/evidence/math-source-data/`; all original source/gate/log/artifacts and baseline copies are preserved. Owner reviews/copies before MAIN changes or descriptor readiness; scalar/geometry adapter consumers must retain raw values/unit wrappers and use the captured per-construction resolvers. The trusted function-context API is not an untrusted-code sandbox.

Corrected helper `7ef9d6f8822d3340fe2117e20841b5fed241d915def9d23e05aaa186a97d930e`; matrix `16cda360b3d99fd7259e5b91fabf667dd25314a4c83380c9c000885d70bba419`; progression `b1f96e9dab396205d1428ab16b5c44efa19f89b61a7936db19237773aac5606b`; new gate `a0249dd41adb6b11929dee42b1c78c5599190d3eefa0331201b6123725de3029`. The log gets its final hash after this update; no self-referential log hash claim.

Source-led finite AP set/congruence and CH16 remain queued until a separate recorded packet/path/slot amendment. No source problem is routed by question ID, no limits prune topic denominators, and no original gate or central progress file is edited.

## Integration-owner disposition

Reserved for actual owner review. No accepted topic IDs, coverage transition or ledger update by HEY-84.
