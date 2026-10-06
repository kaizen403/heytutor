# w1-section-annotation-review: 518c047b BLOCK

Independent bounded review, 6 October 2026. Source pin `518c047b811ad367264016d2d558a06c60bd91d2`, atop 90fd9830. Own branch `cov/w1-section-review-20261006`, worktree `/Users/kaizen/heytutor-cov-wt/w1-section-review`. Staged only the parent correction as local `bb4173ad`, retaining bec1a065 and 31802675 evidence. Source staging and new reviewer-owned probes/logs were announced before edits. No source fix by reviewer.

## Disposition and layer distinction

**BLOCK for the requested fail-closed source-binding contract.** The =/≈/: annotation defect is repaired, but an unsupported coordinate separator still leaves the named result source check vacuously true. This is not a claim that unsupported syntax currently renders or saves wrong ink.

Source: `Find coordinates of Q which divides the join of A(1,2) and B(4,5) externally in the ratio 2:1.` Validated full ProblemIR contains A/B/Q and separately grounded Ax/Ay/Bx/By literals. The independent oracle is `2B−A=(7,8)`. Keep Q's entity, coordinates and all source/IR obligations, then change only its result annotation to `R\\approx(7,8)` or `R~(7,8)`, for callout or badge. Forge source.pointNameEvidence to R as a client control; the actual source question remains Q.

All four variants return no source issue and null raw live failure. ANNOTATED_POINT yields no match for an unsupported separator; the empty-array every() succeeds even though a numeric coordinate pair is present. Expected: an explicitly named result's coordinate claim must be parsed and bound, or decline at this source boundary. Parent identified the same concern and owns the pair-coverage followup.

Generic compile rejects all four with `invalid_derived_value_label`. Compile-plus-live, canonical save and JSONB submission therefore reject. **No rendered or saveable wrong R claim was reproduced for these forms.** This distinction is recorded in the probe and evidence JSON. Zero-pair prose `dividing point` remains source-valid and canonically saveable for both callout and badge.

## Immutable and additional results

The three previously committed reviewer probes remain byte-identical to their bec1a065/31802675 blobs. No control or baseline expectation was suppressed.

| Probe | Actual result |
| --- | --- |
| Immutable engine original | 61 observations, zero failures, strict exit 0 |
| Immutable app original | 81 observations, exactly 3 preserved baseline failures, strict exit 1 |
| Immutable 31802675 supplemental | 187 observations, zero failures, strict exit 0 |
| New supported annotation/metadata matrix | 246 observations, zero failures, strict exit 0 |
| New unsupported-separator probe | 25 observations, 8 source/raw-live failures; compile/save/JSON and zero-pair controls pass; strict exit 1 |

The app baseline observations are exactly `client-lineage:compiled-live-accepted`, `client-lineage:save-accepted`, `client-omitted-equal-component:save`. They were previously reproduced on f459df7b and 7443b2f9. They remain distinct from this source-binding completeness concern.

The new matrix independently checks label/callout/badge with =/≈/:, source-correct Q coordinates, wrong R at the same coordinates, swapped Q coordinates, endpoint identity/value mutations, appended/prose wrong-point claims, forged source witnesses, forged client accepted-candidate flags, canonical server candidate replacement, JSONB submission and saved JSON revalidation. Existing bare derived-tuple compiler declines are checked explicitly. The four core independent numeric oracles, repeating-rational geometry and anonymous naming remain covered by the immutable probes.

During unpublished matrix development, three positive label spellings exceeded the existing 16-character label limit, and bare derived tuples lacked the general compiler's supported quantitative claim separator. The initial 18 resulting declines were traced to `label_too_long` / `invalid_derived_value_label`, not this source delta. Before pinning this new matrix, label fixtures were shortened within the existing contract and bare-tuple compilation declines were recorded explicitly. Raw draft output is preserved at `/tmp/w1-section-annotation-review-matrix-draft.jsonl`. No committed original/supplemental probe changed, no source identity rejection expectation was weakened, and the unknown-separator source failures remain strict.

## Checks and commands

```sh
SECTION_FULLIR_AUDIT=/Users/kaizen/heytutor-claude-coord/runtime/w1-runtime-audit/section-fullir pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w1-section-review.ts
pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-w1-section-review.ts
pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-w1-section-identity-review.ts
pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-w1-section-annotation-review.ts
pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-w1-section-annotation-grammar-review.ts --report
```

Report mode prints all observations and exits 0; that exit does not imply PASS. The 25-observation script without report mode exits 1 on the eight source/raw-live failures. Source pin, prior probes and these newly committed controls are retained for the next corrective review.

Scene-engine ESM/declaration build, engine typecheck/source-file ESLint, both new probes' scoped TypeScript/imported app graph and ESLint, and diff checks pass. Frozen offline ignore-scripts dependencies from the original assignment were reused. The scoped config extends apps/tutor/tsconfig.json, disables incremental, sets app baseUrl and node typeRoots/types, and includes the two new probe scripts. It is removed before commit. Parent reported captured gates and old22/138/299 checks; this reviewer did not duplicate those checks on this pin, run full suites, or run a root/app build.

Raw logs are `/tmp/w1-section-annotation-review-{engine61,app81,supplement187,matrix,unknown}.jsonl` plus matching build/type/lint/strict logs. Durable compact evidence is in [w1-section-annotation-review-evidence.json](w1-section-annotation-review-evidence.json).

## Handoff

518c047b is not independently approved for the complete source annotation contract. Parent will supply a bounded tuple-coverage followup; reviewer will stage only that commit, keep the 25-observation script immutable, and rerun immutable plus bounded unparsed controls. No full formatting-matrix rerun is required for that followup. No source fixes, child agents, ports/student/DB/runtime, native bank, whole replay, ledger/count/READY changes, main/handoff writes, stash, push, PR or remote merge. Integration and actual-head student runtime remain with parent and Laplace.
