# H4 scene placement prompt — unmeasured worker evidence

Owner: `/root/r8_ship_blind_a`. Parent announced ownership of `scenePlannerV2Prompt.ts`, `scenePlannerV2.ts` only where repair contracts needed compaction, the new `verify-h4-scene-placement.ts` gate, and this log. Scope is monitor item 45 plus the scene-prompt portion of item 44. C owns the TurnPlan V3 signed-reference prompt. Root owns script wiring/integration. No API/model calls, images, builds, measurement runs, ledgers/watchers/controllers, delegation, production actions, merge or PR by this worker. Accepted topic counts are unchanged.

The measured frozen region source remains `f2db27cb`. This follow-on prompt change is explicitly **unmeasured** and does not complete the stopped region comparison. Monitor requests 46–52 remain pending in other scope; this worker did not expand into them.

The shared scene authority contract now directs coordinate-free 3D representatives to choose off-axis anchors and generic directions, keep lines/plane intersections/normals distinct from XYZ axes, and avoid coordinate planes. It preserves explicit source numeric coordinates, equations and named axes; only unstated representative geometry may move. There is no stem detector, routing template, coordinate rewrite, or validator bypass.

The full and compact `curve_anchor` contracts specify an actual x/t/theta value in the curve's declared unit and domain, never a **domain fraction**. For radian parameters, `+/-pi/6` means `+/-0.5235987755982988`, never the normalized display-domain values `0.583/0.417`. Sign and actual value remain fixed across display-domain changes. Fractional-valued actual parameters remain valid: the gate includes `t=0.25` seconds on `0..2` seconds and independently verifies the resulting point `(0.0625,1.25)`.

The shared scene contract states that `|z-a|` is distance to reference `a`, and `|z+w|` is distance to reference `-w`. Literal source facts remain intact; computed reference negation has derived provenance. This agrees with C's separately owned TurnPlan V3 rule and does not relabel computed sign changes as quoted givens.

The new gate first failed on the missing off-axis contract. Its final 273 checks exercise full scoped contracts, universal compact contracts and mixed detailed/compact repair requests through 21 intercepted mock fetches. All requests retain the full original source. Independent deterministic neighbors verify both signed ellipse anchors, valid actual fractions, a nonzero-origin time domain, incompatible units and out-of-domain refusals, generic 3D projection/perpendicularity/intersection, and preservation of numeric 3D coordinates/axis directions through example compaction and response normalization. The legal parameters `0.583/0.417` evaluate to different points; this is a prompt guidance fix, not a new deterministic rejection of those numbers. Mock contracts do not establish model compliance or image quality.

Existing controls initially exposed initial-budget overflow (23,720 user characters plus the reserved 800) and a 27,671-character repair. Shortened repeated authority/repair wording preserves complete replacement, authoritative claims/proofs, correct IDs, helper ownership, label attachment, exact endpoint connectivity, one shared non-degenerate cycle and cardinal directions. All input/output schemas and existing linear contracts remain present. No request/search/normalization logic, transport cap, output-token limit or repair-count limit changed.

Completed commands, from repository root:

```sh
pnpm --filter @heytutor/tutor-core exec tsx scripts/verify/verify-h4-scene-placement.ts
pnpm --filter @heytutor/tutor-core exec tsx scripts/verify/verify-scene-planner-v2.ts
pnpm --filter @heytutor/tutor-core verify:symbolic-planner
pnpm --filter @heytutor/tutor-core verify:coverage
pnpm --filter @heytutor/tutor-core exec tsx scripts/verify/verify-scene-repair-pipeline.ts
pnpm --filter @heytutor/tutor-core typecheck
pnpm --filter @heytutor/tutor-core lint
git diff --check
```

Final results: H4 scene gate 273 checks/21 mock requests/zero network or model calls, with maximum captured initial request 23,624 characters and repair request 24,860 characters. The original scene-planner V2 budget/control gate passes with the unchanged 27,000-character repair cap. The universal linear prompt is 23,256 characters plus its unchanged 800-character reserve, below 24,500. Full/compact/repair linear and composite contracts pass with zero model calls. Coverage passes 33 requests/76 contracts plus the numeric 3D vector-offer gate; the repair pipeline passes 11 mocked scenarios. Root's wired H4 script also passes C's 148-check/16-mock-request gate. Scoped typecheck and whitespace checks pass; ESLint exits zero with one existing unrelated `givenValueIntro.ts` unused-function warning.

## Standalone draft validation on main — 12 October 2026

The prompt-only draft starts at `origin/main` `9e50dd3e12db6113de5dbd56520f944af4156058`;
this original worker evidence is retained above. The cherry-pick conflict
retains only the new compact `curve_anchor` contract, preserving main's
operator contracts without importing region contracts. The new mock gate
omits `linear_half_plane` from its offered operator list because main does
not provide that operator. Its other inputs and assertions remain unchanged.

The standalone H4 scene gate passes the same 273 checks and 21 intercepted
requests, with maximum initial 23,078 and repair 24,314 characters. Initial
24,500-character and repair 27,000-character gates, the 800-character system
reserve, 4,000-token scene output cap and two-round repair limit stay unchanged.
The wiring from `07f30bf8` adds `verify:h4-planner-prompts` after main's existing
symbolic diagnostics; no region gate or regions comparison report is copied.

`pnpm install --frozen-lockfile` completes without lockfile changes;
`pnpm exec turbo run build --filter=@heytutor/tutor-core...` completes all
three package builds (two dependency cache hits, one core build). Existing
scene-planner V2, turn-planner V3, symbolic-turn-plan, 11-scenario repair and
coverage gates (33 requests, 76 operator contracts plus numeric 3D vector
offer) pass. Core typecheck, core lint and ESLint on both new gates pass;
core lint retains the existing `givenValueIntro.ts` unused-function warning.
The wired `verify:symbolic-planner` command passes diagnostics and both new
mock gates. `git diff --check` passes. All model requests are mocked; no paid API calls,
images, region runtime changes or acceptance-count changes are involved.
