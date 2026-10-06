# w1-section-identity-review: 90fd9830 BLOCK

## Pin, isolation and disposition

Independent corrective review by Sagan, 6 October 2026. Author pin `90fd9830884c7487b3cff9ed20396f5b751af2a2`, base `7443b2f91db1b6dd132159e005d4f20a40f6e3ec`. Own worktree `/Users/kaizen/heytutor-cov-wt/w1-section-review`, branch `cov/w1-section-review-20261006`.

Staged only the author's correction with `git cherry-pick -x 90fd9830`, yielding local staging commit `bc51612e`, while retaining `bec1a065` independent evidence. The original engine/app `verify-w1-section-review.ts` files remain byte-for-byte identical to their bec1a065 blobs. No parent, handoff or main source was included. Reviewer made no source fixes or original-gate edits. The new supplemental reviewer script is `apps/tutor/scripts/verify/verify-w1-section-identity-review.ts`; this log and its evidence JSON are reviewer-owned. Writes were announced in the conversation and own coordination status before editing.

**BLOCK: the original normal-selection mismatch is repaired, but submitted non-label coordinate annotations can still replace the explicitly requested identity.** Parent owns the subsequent annotation-only source repair. No READY, accepted-topic or runtime claim is made.

## Remaining source-identity defect

Code: `packages/scene-engine/src/ir/sectionFormulaSource.ts:517`. `resultLabelAgrees` checks every label annotation with the identity matcher. Other annotation kinds use NAMED_POINT. That pattern recognizes bare/equals coordinate tuples and does not recognize the general coordinate-claim separators `≈` and `:`. An empty match array succeeds with `every()`.

Exact source:

```text
Find coordinates of Q which divides the join of A(1,2) and B(4,5) externally in the ratio 2:1.
```

Start with the normal exact scene from a **validated full ProblemIR** whose points and intent are A/B/Q. The independently derived answer is `2B−A=(7,8)`. Keep result entity Q and all geometry, quantities, source facts and intents unchanged. Mutate its anchored annotation `coordinates_pt_Q` to either:

| Kind | Text | Compiled live admission | Canonical save | JSON revalidation |
| --- | --- | --- | --- | --- |
| callout | `R≈(7,8)` | accepts | accepts | accepts |
| badge | `R: (7,8)` | accepts | accepts | accepts |

The callout renders board labels `A(1,2)`, `B(4,5)`, **`R≈(7,8)`**, replacing the correct Q coordinate label. The badge yields labels including `R:` and `Q (outside)`; the saved annotation retains the false tuple text `R: (7,8)`. Server canonicalization does not remove or correct either submitted annotation. The probe additionally forges source.pointNameEvidence to R; the actual source reader ignores that metadata correctly, but the alternate annotation syntax still bypasses the result identity check.

Expected: all recognized coordinate-claim annotation kinds must retain the source result identity and numeric claim. A correct tuple for a different named point is not a faithful verified scene. This is an **incomplete repair of the reviewed identity contract**, not a new regression introduced by the corrective delta: the same mutation cases also accept on `7443b2f9`. The distinct earlier scalar-lineage and omitted-component gaps remain outside this source identity correction and are reported separately below. Parent was notified directly in `coord/reviews/w1-section-review.md`; parent is taking an annotation-only corrective branch. Reviewer does not fix shared source.

## Repaired behavior and independent controls

The immutable original engine probe has **61 observations, zero failures, strict exit 0**. Explicit Q versus IR R now declines for all three original word forms and the lowercase control. Matching Q passes. The immutable app probe has **81 observations**, zero requested-name failures, strict exit 1 only for the same three baseline observations:

- `client-lineage:compiled-live-accepted`
- `client-lineage:save-accepted`
- `client-omitted-equal-component:save`

These were independently reproduced on both f459df7b and 7443b2f9 in bec1a065 evidence. They remain visible; no expectation was weakened, suppressed or changed to produce a fake fully passing gate. App observation count falls from 87 to 81 because rejected wrong-name selections no longer enter conditional live/save checks.

The new supplement has **187 observations and 6 failures**, covering compile/live, save and JSON revalidation for the two remaining annotation formats. The other 181 observations pass. Normal entity rename, label annotation rename, both renamed, false Q coordinates, false endpoint coordinates, and removing the result label all reject through the actual compile/admit, canonical save and JSON revalidation paths. Wrong IR result kind, coordinate tuple used as an IR name, missing IR result label, missing requested-fact role, invalid scalar shape, unsupported uppercase source role, and conflicting source names reject. Source identity witnesses have actual question quotes and offsets. Source metadata cannot replace them.

Four independently derived core numeric cases remain exact and admit/save/revalidate: external 2:1 `(7,8)`, internal 2:3 `(2,-1)`, midpoint `(-2,-2)`, and external ratio-reading `1:2` at `(-2,-3)`. Matching explicit Q word forms pass. Anonymous requested IR R remains allowed; anonymous nullIR documents preserve their empty quantities/annotations and still compile. Two additional adversarial numeric cases with integer source coordinates produce exact geometry at `(1/3,1/3)` and `(10/7,17/7)`, retain Q, and save/revalidate. Their result labels intentionally show the name alone because the result has a repeating decimal. An initial supplemental assertion required a coordinate-tuple label even for those cases; inspection of the unchanged original formatter established the intended behavior, and that supplemental formatting assertion was corrected before pinning the probe. No identity or false-annotation rejection control was relaxed. The first supplemental fixture ID also used a hyphen unsupported by the IR schema; the new helper sanitizes reviewer case IDs before validation. Neither probe setup issue is a product defect.

## Commands and evidence

```sh
SECTION_FULLIR_AUDIT=/Users/kaizen/heytutor-claude-coord/runtime/w1-runtime-audit/section-fullir pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w1-section-review.ts
pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-w1-section-review.ts
pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-w1-section-identity-review.ts --report
```

Report mode prints all outcomes and exits 0, which does not mean PASS. Supplemental strict mode exits 1 on the six identity observations. All fullIR fixtures, oracle values and rejection expectations are independently authored in reviewer probes; no author gate fixture helpers are imported.

| Narrow check | Result |
| --- | --- |
| Scene-engine ESM/declaration build | pass |
| Immutable reviewer engine/app probes | 61/0 failures; 81/3 classified baseline failures |
| Supplemental reviewer probe | 187 observations, 6 in-scope identity failures |
| Existing engine section-ready | 22 checks pass |
| Existing app section-ready | 7 cases, 8 declines, 138 checks pass |
| Existing visual-obligations | 299 checks pass |
| Engine typecheck and source-file ESLint | pass |
| Supplemental script/imported graph scoped TypeScript and ESLint | pass |
| git diff --check and immutable probe diff against bec1a065 | pass; no probe differences |

Existing frozen offline ignore-scripts dependencies from the original reviewer assignment were reused. Drawing/core source is unchanged and their previous per-package build evidence remains; only the changed scene-engine package was rebuilt. Scoped TypeScript extends apps/tutor/tsconfig.json with incremental=false, baseUrl=./apps/tutor, typeRoots=./apps/tutor/node_modules/@types, types=[node], and includes the supplemental script/import graph. Temporary config removed before commit. No root typecheck/build or full package suites.

Baseline isolation: archive `7443b2f9` engine src and package.json into a temporary directory, symlink only this reviewer's frozen node_modules, preserve the app's aliases as absolute paths, and map @heytutor/scene-engine to the archived index. Run the same final supplemental script with that temporary tsconfig. The six alternate-annotation observations are identical in head and base. Other baseline failures include the original Q/IR-R and ordinary annotation-name controls now repaired by 90fd9830. No worktree source was swapped. Archive location is in `/tmp/w1-section-identity-review-base-path.txt`.

Raw logs: `/tmp/w1-section-identity-review-immutable-{engine,app}.jsonl`, `/tmp/w1-section-identity-review-supplement{,-base}.jsonl`, strict/build/type/lint/narrow-gate logs with the same prefix. Durable compact outcomes and actual board/saved annotation evidence are in [w1-section-identity-review-evidence.json](w1-section-identity-review-evidence.json).

## Final handoff

90fd9830 remains **BLOCK and not landed** pending the parent-owned annotation identity correction. Preserve both bec1a065 probes and this finalized supplemental probe. No source fix is included in reviewer evidence. Once the next author pin is available, rerun the bounded probes and compare classified failures; do not interpret the three known scalar-lineage/omission observations as newly introduced source regressions.

Reviewer slot is released after the clean user-only evidence commit. No child agents, student runtime, servers/ports, DB, authenticated save/reopen, whole replay, native-bank certification, ledger counts, stash, push, PR, remote merge, or parent/main/handoff writes. Laplace owns the actual integrated-head runtime. The same reviewer can resume on a subsequent clean corrective pin.
