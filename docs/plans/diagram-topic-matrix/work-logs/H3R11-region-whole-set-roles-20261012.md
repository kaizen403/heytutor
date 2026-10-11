# H3R11 whole-set provenance guard — 12 October 2026

Owner: region-role worker. Follow-up to `724e1b70`. This closes a newly exposed
boundary-projection admission gap; accepted topic counts remain unchanged.
All work was offline, with no provider/model/HTTP/image/PR/push calls.

## Actual red and the narrow source fix

Read-only review of solver guard `237289d3` plus the role repair found valid
original union plans whose finite source set `S` was admitted as a given or
derived intermediate. Original source, ProblemIR and solver output were
unchanged. The audit was verified with two correct boundary projections, while
`selectProductionScene` admitted `linear_source`. Moving the boundary unknowns
to intermediates also exposed finite requested `S=99` and `S=-1` as incomplete
audits that the selector admitted. The solver worker owns that explicit audit
failure and exact-boundary tolerance fix; this worker did not edit solver code.

RED artifacts: private `.context/review-solver-guard-red.json` and
`.context/review-solver-provenance.mts`. The original union capture SHA-256 is
`458a322a5a4b12f0e3fc4b22bfd71b174cc76e18eaf2bc36b939229d43ac295e`.
The actual selector probe was run from `wt-solver`:

```sh
pnpm --filter @heytutor/tutor exec tsx <wt-roles>/.context/review-solver-probe.mts
```

It exited 1 with both finite set values admitted after boundary unknowns were
removed. A second probe reproduced verified/admitted finite `S=99` given and
intermediate disguises. The durable source-seam command was then run before
the source fix:

```sh
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-linear-source-set-roles.ts
```

It exited 1 on the complete original plan's given `S=99`: source compilation
was independently successful, but `validateLinearSourcePlan` returned no issue.

The source guard is deliberately limited to exact original whole-set aliases.
`readLinearSourceSetAliases` first requires complete native number-line source
admission. Existing named-set builder and interval grammars expose their parsed
names only after all prior checks succeed. A bounded explicit `solution set
<name>` noun also establishes that type. No point label or arbitrary planner
name joins. This reader does not alter expressions, domains, strictness,
solution geometry, shading, corners or source equivalence.

`validateLinearSourcePlan` refuses a finite numeric value attached to those
aliases in raw givens, derived quantities or unknowns, before schema
normalization can discard an unknown's value or fail an unrelated field. The
issue is `linear_source_plan_set_scalar`. A set stays a set when it is empty,
infinite, or contains a single member. Other number-line roles do not acquire
new admission requirements. A GIVEN that reuses an interval name may retain
an independently proved endpoint role only when its sourceText preserves the
complete original interval definition and explicitly states a left/right
endpoint or lower/upper bound value. Exact source endpoints, side, any stated inclusion, and
dimensionless numeric agreement are checked. A bare original interval quote
or a sole finite endpoint does not establish that role. Legitimate source
coefficients and boundary roles retain their previous behavior, and a symbolic
set has no finite value to refuse.

## Gates and preservation

The dedicated source gate passed **61 checks**: original `S=99` and `S=-1`
across given/intermediate/requested provenance, admitted rays, singleton/empty
sets, named builders and intervals, formatting/raw-field controls, and
preserved finite boundary roles, explicit original interval endpoint contracts,
wrong endpoint/side/inclusion controls, and bare single-endpoint quote refusal.
Precision controls reject -3+5e-10, zero changed to 1e-20, and 1e-8 changed to
zero; one ULP rounding remains accepted. Exact explicit ray endpoint quotes
using the existing infinity/∞ source syntax are accepted.
Exact source names matter; an unproved
planner-only S does not become a source set alias.

The new actual-selector gate passed **73 checks**, with no IR or provider:

```sh
pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-linear-source-set-admission.mts
```

It preserves the original symbolic S, coefficients and boundaries, while
refusing six finite provenance controls and their malformed-version and
conflicting-arithmetic variants. Each refusal carries the source type issue,
has `representation=null`, and leaves the supplied plan unchanged.

The full recorded-plan audit is the same immutable 240 captures used by the
role repair. `--skip-candidates` avoids repeating the unchanged 491 candidate
compiles; their before/after hashes and outcomes were already preserved by
`724e1b70`. Original and reconstructed plan labels remain separate. New audit
output is private `.context/set-role-after.json`.

The first alias-only audit exposed three interval-given encodings. Exact
diagnostics distinguish genuine endpoint provenance from a scalar set claim:

- Original branch1 `nl09` source: `Let A = [-3, 1)
  and B = (1, 4]. Represent A union B on a number line and state whether 1
  belongs to it.` Given A has value -3 and sourceText `A = [-3, 1); left
  endpoint -3 is included.` Given B has value 4 and sourceText `B = (1, 4];
  right endpoint 4 is included.` There are no numeric unknowns. These retain
  the explicit source-certified endpoint role; bare `A=-3` remains refused.
- MAIN1 `nl09` has the same original source, but its reconstructed givens only
  say `A = [-3, 1); -3 is included.` and `B = (1, 4]; 4 is included.` Neither
  carries explicit endpoint/boundary provenance, so those scalar set aliases
  remain refused. Membership plus a coincident endpoint number is insufficient.
- MAIN1 **reconstruction**, `nl10` source: `Let A = (-infinity, 3] and B = [3,
  infinity). Represent A intersection B on a number line.` It stores given
  A=3 with sourceText `A = (-infinity, 3]`, and given B=3 with sourceText `B =
  [3, infinity)`. The unknown is `A ∩ B` with no finite derived result. No
  explicit endpoint role is present, so both scalar set aliases remain
  refused despite their coincident correct sole endpoint. This diagnostic
  cannot stand for an original-plan regression because the original MAIN1
  TurnPlan/IR were not recorded.

Final 240-plan comparison with `724e1b70`: **211 accepted / 29 refused**,
including **two intended new safety refusals**, both MAIN1 reconstructions
(`nl09`, `nl10`). All **119 original complete TurnPlan outcomes are unchanged**;
the other 121 inputs are explicitly labelled reconstructions. Branch1 remains
57/3 accepted/refused, MAIN1 is 49/11, MAIN2 remains 50/10, and branch2 remains
55/5. Complete native source-plus-plan acceptance is 199, versus 201 after
`724e1b70`. No original current-plan admission regresses. The new source type
refusals are disclosed rather than counted as original-plan failures or hidden
to preserve a headline count. The proof comparison is private
`.context/set-role-preservation.json`.

Required checks: scene-engine typecheck, lint/build, unchanged `verify:linear`,
the two dedicated gates, and `git diff --check`. Lint retains four existing DSA
warnings. No live provider turn, narration, persistence, reopened lecture or
new figure grade was performed. These are source/selector contract results,
not a live success rate or topic acceptance claim.
