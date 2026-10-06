# w1-section-parser-review: 35b4d3e3 BLOCK

Independent bounded review, 6 October 2026. Source pin `35b4d3e3498e84b7d8192cff5c3a55f1268d15b3`, staged ONLY as `1dbe7f5ddc5e5c4d9df8b2942c633191913dd5db` on clean4abebe37 in the owned reviewer worktree/branch. All earlier committed reviewer probes and BLOCK histories remain immutable. No reviewer source fix.

**BLOCK: valid construction labels bypass source identity.** Actual source requests Q dividing A(1,2)/B(4,5) externally2:1. The validated fullIR and independently computed `2B-A=(7,8)` remain intact. Add a label entity `review_result_label`, role `claimed result`, label `R≈[7,8]`, and a construction:

```json
{"id":"construct_review_result_label","operator":"label","inputs":{"target":"pt_Q","text":"R≈[7,8]"},"outputs":["review_result_label"]}
```

Include the new output in requiredEntityIds and the last reveal group. Source validation returns `[]`, generic compile succeeds, raw live admission returns null, canonical save and JSONB succeed. Board labels include wrong `R≈[7,8]` alongside correct `Q=(7,8)`. Saved construction retains the wrongR claim. Same result for `at` and `point` aliases. This is structurally valid generic label syntax, consistent with the existing derived-label gate fixture. The source binder gathers point entity labels and annotations, omitting construction inputs.text/output label channels that render the added label. This is incomplete in-scope channel coverage; no claim of a newly introduced generic numeric-parser regression.

The shared parser repair otherwise passes the bounded source identity controls: all3 annotation kinds square Q positive, wrongR/falseQ negative, rawcase/underscore names rejected, exponent/trailing-decimal compiler grammar accepted, units/bare/braces rejected, namedendpoint and legacy A(1,2) compatibility retained. New probe120 has **15 strict failures**, exactly3 valid construction aliases × source/raw-live/compiled-live/save/JSONB. All preceding105 observations pass.

Immutable results: engine61/0, identity187/0, unsupported25/0; app81 has exactly the3 preserved f459/7443 baseline client-lineage/omitted-component observations. Immutable62 remains byte-identical and reports2 strict failures at `two-parsed-correct-claims:source` and `:live`: mixed claims `Q=(7,8); Q≈(7,8)` now decline before compile. These are the explicitly requested stronger unsupported declines, consistent with the generic compile/save rejection already proved on518/9e. User confirmed this intended contract tightening; the old positive expectations remain visible and unchanged. All original squarewrongR paths now reject. Do not claim immutable62 zero or a fully passing app gate.

Additional unpublished channel diagnostics135 are retained separately in evidence and `/tmp/w1-section-parser-review-final135.jsonl` with source in `/tmp/w1-section-parser-review-draft135.ts`: pointentity squarecorrect/wrong controls pass. A mismatched label construction inputQ/outputR fails structural compile/save with `invalid_label_construction` (compact output entity label must match inputs.text), so its2 source/raw-live observations are not wrong rendered/saved ink. At user's request, the exact120 probe is pinned here, preserving its15 actualwrongink failures; no committed prior probe changed. The diagnostic was not presented as a new rendering defect.

Reproduce without `--report` for strict exit1:

```sh
pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-w1-section-parser-review.ts
```

Durable evidence is [w1-section-parser-review-evidence.json](w1-section-parser-review-evidence.json). Engine ESM/declaration build, engine typecheck, source-file ESLint, scoped newprobe/imported app graph TypeScript and probe ESLint pass. Generic parse function bytes are unchanged; new wrapper exposes raw name/values/unit to binding. Source bytes match authorpin. Temporary scoped config removed before commit. Frozen offline ignore-scripts dependencies reused. Parent's oldderived220/section22/app138 and fullIR gates are parent-reported, not duplicated by reviewer. No broad246 rerun, fullsuite/native, runtime/student/ports/DB, childagents, main/handoff/count/ledger or remote actions.

Parent was notified directly through owned coord files. Prior35 remains BLOCK. Parent now supplied clean followup `d770591f6a6788564ae9c562bd46124473efc28a`, to be staged ONLY after this clean evidence commit; its bounded review will keep120 immutable and retain62 mixed-claim classification. Integration/privatecandidate/runtime remains parent-owned.
