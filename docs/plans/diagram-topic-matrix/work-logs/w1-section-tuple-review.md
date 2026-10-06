# w1-section-tuple-review: 9e7ecfca BLOCK

Independent bounded corrective review, 6 October 2026. Reviewed parent source pin `9e7ecfcaa426aa53315c0aa4807a8399822390a3`, atop 518c047b/90fd9830/7443b2f9. Staged ONLY the new followup as local `1e13e80bb3259b6a9bd84ac4989b7dab5367930b` in `/Users/kaizen/heytutor-cov-wt/w1-section-review`, branch `cov/w1-section-review-20261006`. Earlier 518 BLOCK history is committed as `1bc5accb`; all committed reviewer probes remain immutable. Source staging and own script/log/evidence/coord writes were announced before editing. No reviewer source fix or original author gate edit.

## Blocking finding and exact repro

**BLOCK: a wrong-name square coordinate tuple renders and saves.** Actual question:

```text
Find coordinates of Q which divides the join of A(1,2) and B(4,5) externally in the ratio 2:1.
```

Use the independently validated full ProblemIR containing A/B/Q and grounded Ax/Ay/Bx/By literals. The oracle is independently `2B-A=(7,8)`. Keep Q's entity, construction, coordinates, IR, quantities and obligations. Change only Q's anchored result annotation to:

```text
kind=callout, targetIds=[pt_Q], text=R≈[7,8]
```

A forged client source.pointNameEvidence names R; the actual source question still explicitly requests Q. Source validation returns `[]`, generic compile succeeds, raw live admission returns null, canonical save succeeds and JSONB revalidation succeeds. Presentation commands show `A(1,2)`, `B(4,5)`, **`R≈[7,8]`**. Saved annotation retains that wrong R text and Q target.

Both ANNOTATED_POINT and ANNOTATION_PAIR in `packages/scene-engine/src/ir/sectionFormulaSource.ts` match only parentheses. The new coverage equality is zero=zero on square tuples. The general derived-coordinate parser in `compile/derivedValueLabels.ts` accepts square delimiters, so this is an actual admitted wrong identity, unlike the 518 unsupported-separator concern where generic compile/save rejected the claim. Expected: bind square coordinate claims to source Q or honestly decline before certification/admission.

The exact square mutation also passes source validation and generic compile on 518c047b. Classification: incomplete in-scope annotation repair, **not a newly introduced 9e7 delta regression**. The original f459-to-7443 requested-name regression and its baseline evidence remain preserved in bec1a065; the original 90/518 BLOCK histories remain preserved in 31802675/1bc5accb. Parent's private integrated candidate 6121320d is outside this pinned review and was not staged or mutated.

## Independent results

| Probe | Result | Strict exit |
| --- | --- | --- |
| Immutable engine original, captured fullIR + independent oracles | 61 observations, 0 failures | 0 |
| Immutable app original | 81 observations, exactly 3 preserved baseline observations | 1 |
| Immutable identity supplement | 187 observations, 0 failures | 0 |
| Immutable 25-observation unsupported-separator probe | 25 observations, 0 failures | 0 |
| New bounded tuple-capacity probe | 62 observations, 5 failures, all square-tuple wrong-name paths | 1 |

The app baseline observations remain exactly `client-lineage:compiled-live-accepted`, `client-lineage:save-accepted`, `client-omitted-equal-component:save`. Their identical f459df7b/7443b2f9 boundary evidence is retained. No expectation was suppressed or full app passing gate claimed.

All ten malformed parenthesized controls reject at source/raw-live/compiled-live/save/JSONB: equal-valued fraction, symbol, extra coordinate, bare tuple, mixed parsed+unknown, mixed parsed+symbol, and four named-endpoint controls. The immutable 25 now rejects R~ and R\\approx source/raw-live, while compile/save/JSON reject as before; zero-pair prose remains valid/saveable. New zero-pair ratio caption remains source/raw-live positive. The immutable numeric/name probes retain explicit Q versus IR R, three matching Q prose forms, entity/annotation renames, false coordinates, shape/type controls, anonymous names, repeating-rational geometry and independently recomputed supported cases. Unrelated obligations and legacy documents remain covered by the original engine probe. The broad 246 annotation matrix was NOT rerun.

A new two-fully-parsed-correct-Q-claim control passes source/raw-live but generic compile rejects it with `invalid_derived_value_label: Derived quantity label has incompatible physical dimensions`. A one-fixture source archive comparison confirms the same compile issue on 518 and 9e7: the generic parser reads the trailing second claim as a unit. The initial experimental positive save expectation failed; raw output is preserved as `/tmp/w1-section-tuple-review-capacity-initial.jsonl`. The final new probe explicitly checks this existing generic decline while keeping source-positive coverage strict. No committed probe changed, and the new square wrong-name rejection expectations remain strict.

## Reproduce and checks

```sh
SECTION_FULLIR_AUDIT=/Users/kaizen/heytutor-claude-coord/runtime/w1-runtime-audit/section-fullir pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w1-section-review.ts
pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-w1-section-review.ts
pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-w1-section-identity-review.ts
pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-w1-section-annotation-grammar-review.ts
pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-w1-section-tuple-review.ts
```

Without `--report`, the new tuple probe exits 1 on its five unsuppressed square-tuple failures. `--report` only changes assertion exit behavior. Compact durable evidence is [w1-section-tuple-review-evidence.json](w1-section-tuple-review-evidence.json); local raw logs use `/tmp/w1-section-tuple-review-*`.

Scene-engine ESM/declaration build and typecheck pass. Source-file and new-probe ESLint pass. Scoped TypeScript for the new script/imported app graph passes. The temporary scoped config/source-archive runner is removed before commit. Offline frozen ignore-scripts dependencies from the original assignment were reused. Source bytes match the pinned author correction. Diff checks pass. Parent reports captured/fullIR, old22/138 and integration-focused checks independently; they were not duplicated or represented as this reviewer's runs.

## Handoff and limits

Gauss/parent was notified directly through the owned coord review/status files as soon as the square claim reproduced. Do not land 9e7 as independently PASS for source annotation identity. Bind or decline square tuples at named result/endpoint without weakening original controls or changing source question grammar. Reviewer makes no source correction.

No full three-package suites, broad formatting/native matrix, child agents, real student/runtime/ports/DB work, ledger/count/READY updates, main/handoff writes, stash, push, PR or remote merge. All review commands are complete; release the reviewer slot after the clean evidence commit. Parent and Laplace own any eventual actual integrated-head runtime.
