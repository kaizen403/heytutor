# DCP08 finite integer AP sets / HEY-84

## Assignment and source contract

- Worker HEY-84; programme coordinator HEY-83; sole MAIN integrator HEY-88. Actual START record read before code: `integrator-DCP05-12-HEY88-20261002.md` in main, SHA `74cfbca71905077df15cb119b47ca9cc866d7786fd200a5784e620b1988632a6`. The narrower authoritative amendment supersedes the earlier broader first/step/count/modulus proposal.
- Slot2 in current isolated `/Users/kaizen/.capy/worktrees/HEY84-DCP08-own-data-20261003/heytutor`, detached base eec2d36b. No new worker or worktree. Exactly three NEW writes: `packages/scene-engine/src/math/finiteProgressionSets.ts`, `packages/scene-engine/scripts/verify/verify-finite-progression-sets-hey84.ts`, this owned log. Reuse unchanged `compile/mathSourceData.ts` SHA `7ef9d6f8822d3340fe2117e20841b5fed241d915def9d23e05aaa186a97d930e`; prior corrective five paths, original gates and all frozen source/log/evidence stay immutable.
- S0 Main2026 Paper1 / Advanced2026 matrix profile unchanged; no NEET Mathematics. Existing MathsU6 associations only: `maths|6|arithmetic-and-geometric-progressions` and `maths|6|properties-of-ap-and-gp`, partial reusable prerequisite evidence. No invented topic ID or CH29 assignment; this is not complete-topic or source-cohort acceptance.
- Own-DATA input grammar: `{model:'integer_ap_sets',operation:'intersection'|'union',sets:[{first,step,count},{first,step,count}],congruence?:{modulus,residue}}`. Exactly two supplied sets. Primitive safe-integer numbers only, first/step abs<=1e6, count0..1e6, source endpoints abs<=1e12; optional modulus1..1e6 with canonical residue0..modulus-1. No callbacks, quantity/unit/parser/framework defaults. Exact distinct cardinality<=2e6; intermediate BigInts<=512 bits.
- Negative/zero steps, empty/zero-count sets, singleton/duplicate set semantics, signed floor/ceil and inconsistent CRT are mandatory. Runtime must be analytical GCD/generalizedCRT/bounded intervals; no range enumeration or truncation to64. Union filter applies to each operand before inclusion-exclusion. No GP/mixed/sums/CH16/source parser/IR/planner/scene/render/index/MAIN/global/manifests/setup or publication changes.

## Baseline and source calibration

Actual source dossier `/Users/kaizen/.capy/work/HEY-84/evidence/source-dossier/CH15-16-source-review.md` contains original-page inspection and manifest-matching PDF fingerprints. Calibrations are not source-cohort or blind-holdout acceptance:

- Main2026 `q_23195556a041dfc973a3585c9a1b75e446804e205c4b175a5efaecc7a202b880`: sets(1,5,101),(9,7,71), intersection divisibleby3 has5 elements. OriginalPDFpage3 confirms ∩ and options4/5/6/7; independent enumeration/congruence agree.
- Advanced2018 `q_59f5e5315c8f39e474a7312da8e6ecb7ca546664852d9ce0b85e468b3e422a12`: both counts2018, overlap288/union3748. ActualPDF physicalpage29/printed5/8/Q9 confirmed and independent enumeration/CRT agree.
- Current indexed-progression prototype intentionally supports indices<=64/16 displays and cannot close these larger finite-set cardinality questions. No existing prototype, source limit or frozen gate will be widened.

## Changes and checks

Implemented `evaluateFiniteProgressionSets` in the new math module. Only the three assigned new files changed. Inputs use frozen7ef9 own-DATA snapshot before reads; primitive safe integers and exact field/model/operation/tuple grammar are enforced. No source callbacks, units, expression parser or question-ID routing was added.

- Source AP descriptors are retained with their signed first/step/count. Zero count produces an empty pattern with null endpoints; positive zero-step count produces one distinct member; descending source progressions are normalized only for membership/CRT, not relabeled as ascending source sequences.
- Exact BigInt GCD and extended Euclidean inversion combine noncoprime congruences. Incompatible residues or disjoint bounds produce the empty set. Signed floor/ceil clipping handles negative intervals and exact boundary members. Intersection produces an exact bounded canonical progression/point pattern.
- Optional explicit residue filter is applied independently to both operands before union inclusion-exclusion. Returned source/filtered patterns, unfiltered/filtered intersections and cardinality show the actual mathematical decomposition. No hidden default modulus/residue or count truncation.
- Runtime loops are only Euclidean arithmetic over integer moduli; source ranges are never enumerated. Returned distinct cardinalities are exactly representable numbers<=2e6; source endpoints/strides are exact decimal strings, not float metric coordinates. Every bound/intermediate is checked;512-bit capacity remains explicit.

Final verification chain from the corrective isolated tree, exit0, raw output `/Users/kaizen/.capy/work/HEY-84/evidence/finite-ap-sets/final-checks.log`:

```sh
export PATH="/opt/homebrew/bin:$PATH"
cd /Users/kaizen/.capy/worktrees/HEY84-DCP08-own-data-20261003/heytutor
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-finite-progression-sets-hey84.ts &&
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-finite-progression-sets-hey84.ts --holdout &&
pnpm --filter @heytutor/scene-engine typecheck &&
pnpm --filter @heytutor/scene-engine exec eslint src/math/finiteProgressionSets.ts scripts/verify/verify-finite-progression-sets-hey84.ts &&
pnpm --filter @heytutor/scene-engine exec tsc --noEmit --strict --module esnext --moduleResolution bundler --target ES2022 --esModuleInterop --skipLibCheck --typeRoots ../../node_modules/.pnpm/@types+node@20.19.43/node_modules/@types --types node scripts/verify/verify-finite-progression-sets-hey84.ts &&
pnpm --filter @heytutor/scene-engine exec tsup src/math/finiteProgressionSets.ts --format esm --dts --out-dir "$HOME/.capy/work/HEY-84/evidence/finite-ap-sets/build"
```

Results: **848,025 core checks;128 prelisted synthetic holdout cases /2,486 checks; source/gate strict types/lints and standalone ESM/declaration build pass.** Existing package `pnpm --filter @heytutor/scene-engine lint` was also rerun: exit0, same four old DSA warnings and zero errors. No DSA work/gates or existing test modifications. Standard package entry/index untouched, so no public/scene runtime exposure or default-build integration is claimed.

Independent small oracle enumerates true JavaScript Sets only in the owned gate. Its60 distinct source-descriptor combinations cross both operations and six filter variants (43,200 request cases); membership, pattern endpoints, source retention, operand filtering and cardinality are checked. Prelisted128 cases are declared before evaluation in separate `--holdout` mode and use independent enumeration; they are not frozen exam/question-bank holdouts.

Source calibrations pass:2026 filtered intersection5, unfiltered14, filtered pattern51..471 stride105;2018 unfiltered overlap288/union3748. Independent large analytic controls include million-member identical intervals, incompatible even/odd sets with2e6 union, filters excluding an entire operand, negative bounds with1003 members modulo997, million repeated zero-step terms counting1, descending source endpoint-1e12, and coprime large steps whose common points are0/999962000357 without enumerating a million terms. Missing/unsafe/noninteger/oversized/extra/model/filter/operation mutations reject.

Own-data controls include top/nested/filter getters (read counters0), inherited/custom-prototype/symbol/cyclic/depth/node failures, nonenumerable/null/frozen/JSON/DAG alias controls and non-mutation of the source payload. Dependency and prior five correction-file hashes are unchanged and rechecked. Original progressions/gates/log/evidence remain frozen.

No render, scene or IR/planner consumer was built under this lease. Source-need/cohort and actual source/model co-grounding, scalar proof/label binding and live/persistence/saved-replay evidence remain an explicit owner handoff, not an offline scalar pass.

## Per-topic outcomes

| Exact existing topic association | Selected prerequisite | Proposed state | Remaining complete-topic obligations |
| --- | --- | --- | --- |
| `maths\|6\|arithmetic-and-geometric-progressions` | Signed/zero/empty finite integer AP sets, exact count/CRT, source101/71/2018 calibrations; no GP or all AP problems. | integration_pending | Owner actual numeric consumer/source/model/proof/label/lifecycle, rational/symbolic/unitful/out-of-bound sets, original coordinate graphs and complete frozen topic variants. |
| `maths\|6\|properties-of-ap-and-gp` | Integer AP membership, duplicate/singleton cardinality, generalized congruence/interval properties and correct filtered inclusion-exclusion. | integration_pending | Independent source/profile/cohort review and all GP/equidistant/unknown-parameter/mixed/graph/label/saved-turn obligations. This partial prerequisite cannot close the whole row. |

## Handoff and owner disposition

Return exactly the three new files/diff/hashes, all evidence above and declared integer-only limits. Source module SHA `5229e6d98c440593b1a4ecdebb134da33410ab23afc8fa8b22d6870e9a02c92f`; gate `4278301461356de84b3fdaf96f295db8e0d1ea58f81dc7fbed626da8a0ab9277`; log finalhash computed after update. Artifact directory `~/.capy/work/HEY-84/evidence/finite-ap-sets/`; no Drive copy.

Owner reviews/copies before any public/IR/source-parser/scene consumer or acceptance. A typed source-bound request must preserve set-versus-multiset semantics, every source first/step/count identity, the explicit queried operation and any residue filter; mathematical helper output alone does not establish those facts against an actual question. Do not remove valid larger/rational/symbolic source cases or mark them text-only merely because this model declines.

No staging, commit, push, PR, merge, MAIN change, counter, source-quality exclusion, required-visual relabel or denominator change. Next source-led cumulative-AP/prefix-sum and CH16 proposals require separate recorded contracts; no self-start or new worker. Actual integration-owner disposition remains pending with zero accepted topic IDs from this packet.
