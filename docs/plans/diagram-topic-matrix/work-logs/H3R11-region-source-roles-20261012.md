# H3R11 finite region source roles — offline repair

Owner: region-role worker. Base: `348572850119c3e334777d2f0e7c1d971c9617ad`.
Branch: `h3r11/region-role-bindings`. Topic counts and the paused topic ledger are unchanged.
This is free offline evidence, with no provider, model, HTTP, image inspection, PR, or push.

Owned paths were announced before editing: `src/compile/linearSourceAgreement.ts`,
`src/ir/linearScalarBinding.ts`, and these new dedicated scripts/fixtures. No source
kernel, region solver, shading/corner/equivalence gate, shared gate, or package script changed.

## Red loop and hypotheses

Applied `.agents/skills/diagnosing-bugs/SKILL.md`. After the offline install and
private drawing build, the first actual bug loop was:

```sh
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-linear-region-source-roles.ts
```

It exited 1 on original branch-one `lpp01-bounded-unique`: the complete source
compiled, but original `Zmax=14` produced `linear_source_plan_role_unproved` at
`derived[2]`. Repeating with `--minimal` retained only the original question and
the `Zmax` unknown/result, clearing irrelevant dependency lists, and produced the
same role rejection at `derived[0]`. The complete original replay remained the gate.

Three falsifiable hypotheses were shown before probing:

1. Missing bounded extremum spelling: changing only `Zmax` to `maximum Z` on
   both sides should clear the rejection. The pre-fix probe accepted it.
2. Unknown/result role join: changing only the unknown spelling should locate
   the failed side. The pre-fix probe still rejected the original derived `Zmax`;
   IDs and the numeric recomputation were not the cause. A renamed value 99
   still produced `linear_source_plan_value_mismatch`, expected 14.
3. Point/boundary roles need additional source proof: removing the original
   `B=(2,1)` definition should refuse `C(B)=16` despite the correct number.
   The fixed reader accepted the complete source and refused that mutation.

The scalar loop also ran red before its repair:

```sh
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-linear-region-scalar-roles.ts
```

Original full `sys02` IR/TurnPlan returned `contradiction/value_type_mismatch` for
`ux`, although its exact singleton was `17/13`. The fixture also retains full
original `sys10` and separated-union IR and TurnPlans.

## Source-proved behavior and refusals

The repair adds finite symbol grammar, not routing or a question lookup:

- `Zmax` / `Zmaximum` / `Z minimum` preserve the actual original objective
  label and requested sense. Exact original labels take precedence over suffix
  interpretation, including a literal objective named `Zmin`.
- `maximizing x/y` and `minimizing x/y` require the matching source sense and
  an attained, independently proved singleton optimal face.
- `C(tuple)` requires an exact original reference point or independently
  computed closure corner; `C(B)` requires the actual original point definition.
  Affine evaluation includes the constant and preserves point identity when
  joining unknown/result roles. No planner point or numeric near-match joins.
- `x_intersection/y_intersection` are explicit global system coordinate roles.
  Conflicting original reference points named `intersection` stay refused.
- `x-intercept of L2` preserves the actual original line label, complete source
  equation, requested intercept semantics, and exact zero/nonzero coefficient.
- A whole intersection tuple can select a scalar component only with two
  explicit component requests: the singleton request is proved against the
  complete source and a separate scalar evaluate binding independently equals
  the other source coordinate. One-request `tupleOnly`, wrong/missing companions,
  wrong targets, units, forged evidence, and unsupported roots remain refused.
- A rearranged affine boundary difference may use a separate expression ID
  only after its exact global root matches a complete source-equivalent IR
  inequality with original quote, orientation, and strictness preserved.

Seven branch-one role/binding empties are newly admitted: `lpp01`, `lpp02`,
`lpp03`, `lpp04`, `sys05`, `multiple-optimum-edge`, and `vertical-line-system`.
The original `lpp07` remains refused: A/B occur only in planner claims, so the
original source does not prove the `x_A/y_A/x_B/y_B` name bindings. The two real
numeric mismatches remain refused: `sys01 y=-1` versus source 1 and `sys07
y_P=-33` versus source 7. No planner value, source, constraint, domain, or point
is rewritten.

## Verification

Portable original-plan gate: 60 recorded sources/plans, **57 accepted / 3 refused**;
57 complete native source documents compile. Three remaining source texts use
the captured planner path rather than `buildLinearSourceDocument`; their plan
agreement result is not a claim of native source compilation.

The fixture has 59 original complete TurnPlans and one explicitly labelled
summary reconstruction (`hp02`). It includes 22 exact original raw scene
responses for the focused role/numeric cases, parsed by the actual
`parseScenePlannerResponseJson`; **17 accepted / 5 refused**. No final normalized
or committed scene document was recorded, so these are raw-candidate replays.
The dedicated gate passed **52** wrong-value, identity, unit, sense, ambiguity,
and source-geometry checks.

The scalar gate passed **30** checks over three full original IR/TurnPlan
captures: `sys02` and `sys10` are `verified`, while separated union is
`incomplete` only for its unbound symbolic solution-set unknown S. The boundary
selections are exactly -1 and 23/5. Metadata, provider set outputs and plans are
unchanged. A finite unbound requested S requires the solver worker's separate
full-plan projection guard before integration; this worker does not own
`solverAuthority.ts` and does not relax audit statuses.

Commands/results:

```sh
pnpm install --offline --frozen-lockfile                # success, zero downloaded
pnpm --filter @heytutor/drawing build                   # success, private dist
pnpm --filter @heytutor/scene-engine verify:linear      # all existing gates pass
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-linear-region-source-roles.ts
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-linear-region-scalar-roles.ts
pnpm --filter @heytutor/scene-engine typecheck          # pass
pnpm --filter @heytutor/scene-engine lint               # pass, four existing DSA warnings
pnpm --filter @heytutor/scene-engine build              # pass, private dist
git diff --check                                       # pass
```

The existing run includes 4,015 public compiler checks, 64 solver-binding checks
(including unchanged one-request `tupleOnly` refusal), 264 source-plan checks,
and 293 numeric authority checks. Wrong-side/incomplete shading, missing or
perturbed corners, source equivalence, strictness, point completeness, and
numeric mismatch sensitivity stayed green.

## Full recorded audit and limits

`replay-linear-region-roles.ts` accepts repeated `--capture-dir=.../runs` arguments,
an optional `--baseline-source=.../src` frozen source copy, and `--output=...json`.
It computes capture and raw-response hashes and never calls a remote provider.
The frozen pre-fix copy contains base files obtained with `git show HEAD:path`.
The input arms are stock `branch1`, `MAIN1`, `MAIN2`, and excluded `branch2` under
`.context/h3r10/finish-measurement/evidence/`.

Pre-fix audit: branch1 native plan 50/10 accepted/refused (47 source-plan
accepted), MAIN1 reconstruction 51/9 (48 source-plan), MAIN2 reconstruction
48/12 (45 source-plan), branch2 native plan 52/8 (49 source-plan). All 491 exact
raw candidates replayed: 332 accepted and 159 refused. There are 119 original
complete TurnPlans and 121 explicit reconstructions across the 240 inputs.
The main-arm reconstructions are diagnostics, not original IR replays.

Post-fix audit:

| Arm | Plan accepted/refused before | After | Complete source + accepted plan before/after |
| --- | --- | --- | --- |
| branch1 (59 original, 1 reconstruction) | 50 / 10 | 57 / 3 | 47 / 54 |
| MAIN1 (60 reconstructions) | 51 / 9 | 51 / 9 | 48 / 48 |
| MAIN2 (60 reconstructions) | 48 / 12 | 50 / 10 | 45 / 47 |
| branch2 (60 original) | 52 / 8 | 55 / 5 | 49 / 52 |

Across all 240 inputs, **201 prior accepted plan inputs remain accepted**, **12
are newly accepted**, and **27 prior refused inputs remain refused**; there are
zero admission regressions. Complete native source-plus-plan acceptance is
189 before and 201 after; the other 12 source texts are outside native source
admission, so a no-issue plan result is not native source authority for them.
Ten newly accepted inputs have original TurnPlans (seven branch1 and three
branch2); two MAIN2 improvements are explicitly reconstructed diagnostics.
The three new branch2 inputs are `lpp02`, `lpp03`, and `sys05`; the two MAIN2
reconstructions are `lpp02` and `shifted-triangle-minimum`.

All **491 raw candidate outcomes are identical before/after**, including hashes
and issue details: 332 valid compiled responses and 159 refusals. One of the
332 is an explicit `text_only` candidate with an empty scene; 331 are scene
responses. These counts do not stand for committed/right figures. Branch1
solver contradictions fall from three to zero: two original exact system
captures become verified and the symbolic union becomes incomplete with its
unbound S still explicit. No status class was weakened.

Post-fix audit and preservation comparison are recorded in the accompanying
private `.context/role-before.json`, `.context/role-after.json`, and
`.context/role-preservation.json` artifacts.
This log is offline only: no new live provider turn, image grade, saved-turn
persistence, voice, or reopened student replay was run, and no topic row is
claimed accepted.
