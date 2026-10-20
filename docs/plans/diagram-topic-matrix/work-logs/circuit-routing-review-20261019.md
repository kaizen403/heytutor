# Circuit routing review fixes — 19 October 2026

**DRAFT REQUIRED — one original right-figure oracle remains rejected.**

Owner: Sentry/circuit lane. Review update to PR #212. Retry feedback and topology
inference moved to PR #215, independently based on main. This update contains
router review fixes only. Frozen replay baseline: main `6ca8b616a`. $0; no merge or production change.

## Final open review item — 20 October 2026

Automatic equal-length ticks were added after connector routing. The final ink
check correctly refused a wire crossing those marks, but the router had never
seen them and could not choose an available detour. Each routing pass now uses
the same corresponding-tick primitive generator and transform as the final
render. Panel isolation, logical contacts, 6px clearance and final ink validation
remain enforced.

An owned synthetic gate covers 12 scale, mirror and rotation variants (96
checks): the plain circuit compiles, both correspondence marks stay visible,
the wire reroutes with independently measured 6px clearance, exact terminals
are retained, and the logical input stays unchanged. It reproduces the late-ink
refusal before the fix. A mutation that removes the preview marks restores
that refusal and is caught by this gate; the mutation was reverted. The existing
2,731-check routing gate, all 31 space-view
gates (including G15), typecheck and lint pass.

The final replay recompiles all 1,709 candidates on this source. Every status
and complete render hash is identical to the prior corrected router, so the
existing blind judgments remain applicable without a new image judgment. The
original oracle is still 14/15 recovered overall and 8/9 recovered among the
originally production-admissible right figures. One right loss and two
production-admissible wrong gains remain. The open mark review item is fixed;
the PR does not meet its acceptance condition and must stay draft.

A separate replay against current main `565cb178` preserves all 1,709 baseline
compile statuses and fatal codes, with 1,245 draws. Its complete renders differ
from the frozen baseline in 468 cases, including label placements. Against
current main the branch comparison is 1189 identical, 492 changed, 6 gained
and 22 lost. The historical blind scores below are explicitly frozen-baseline
scores, not a new visual acceptance claim against current main.

## Review causes and changes

- Rendering and routing now share the exact component-panel packing decision,
  including connected-assertion and DSA guards.
- Open connector paths stay open through the thin planar-region check.
- Obstacles come from the actual visible primitives: relocated dimension bars
  and caps, clipped lines/rays, arcs and closed-outline closing edges. Hidden
  helpers are omitted; axes do not become fictitious diagonal barriers. Dashed
  measurement witnesses retain their nonconductive construction rendering.
- Safe legacy routes are preferred. Unrelated wire/symbol/bar ink retains6px
  clearance. Coordinate coincidence alone does not establish electrical contact;
  a terminal-lead tap needs the explicit wire net.
- A follow-up blind review found one right→partial apparatus. Its relocated
  dimension offset was reused as symmetric fit padding, shrinking all symbols.
  Preserve the initial fit reserve while retaining the relocated bar position
  and final clearance checks. The recovered complete render is byte-identical
  to main. A synthetic metamorphic fixture covers three world scales and checks
  unchanged apparatus primitives plus visible dimension ink.

## Verification

Routing gate:2,731 checks. Both open Greptile cases have dedicated checks (hidden
helper and closing edge). Space-view:31 gates, including all44 frozen G15 renders
unchanged; no refreeze. Engine build/typecheck, focused lint and diff checks pass.
The dimension-fit fixture fails before its fix and passes after it. Existing
topology, numeric and physical-label checks remain enforced.

## Full recorded replay and blind result

All1,709 frozen circuit candidates replayed: main1,245 compiled; branch1,229.
Final comparison:1,615 identical,66 changed,6 gained,22 lost. Every changed
distinct figure was blind judged: initial103 cards, followed by14 randomized
pairs after the fit correction. Exact unchanged/restored render hashes inherit
their recorded grades.

| Final94 delta candidates | Main R/P/W/E | Branch R/P/W/E |
| --- | --- | --- |
| Compile boundary |8/46/34/6|9/37/26/22|
| Production admission gate |8/27/30/29|9/22/20/43|

The fresh blind rubric gives higher right and lower wrong counts. It does not
close the original review acceptance condition: of9 originally production-
admissible right figures lost by the old router,8 are restored and1 remains
rejected. That capacitor branch ends inside a terminal lead without a declared
join to its port. The fresh judge called its baseline partial solely for missing
calculated results, despite its correct visible topology and givens. That
stricter rubric cannot replace the original diagram-right oracle.

The saved candidate has no typed source graph or terminal-tap assertion. Its
component-level `connected` assertion already holds through the other branch;
it cannot prove the missing return connection. Inferring the contact would merge
distinct nets and turn a dangling branch into a parallel branch. A safe recovery
needs an explicit source-grounded connection at the topology/planning boundary.
Contact and clearance guards stay enforced; PR #212 remains FIX FIRST.

Under the fresh rubric, the22 compile losses were
graded15 wrong/7 partial. The full104-candidate judged union (including10 renders
restored exactly to main) is9/48/41/6→10/39/33/22. Initial baseline grades remain
frozen; two partial/wrong baseline disagreements in the follow-up are retained
in the private evidence. Neither comparison has a right-loss disagreement.

All13,936 recorded noncircuit candidates retain identical full render hashes,
statuses and fatal codes against frozen main on the final router source.
Checkpoint keys were checked for duplicates and complete corpus coverage;
early keys were recompiled after the final fit correction.

These are candidate-level offline results. Remaining wrong figures include
planner-supplied switch-state, polarity and apparatus inconsistencies; two of
the four wrong compile gains pass the existing production admission gate.
The router does not establish chapter-wide physical correctness. No accepted
topic counts changed. Private questions, identifiers, manifests and judgments
stay outside git; all public regression fixtures are synthetic.
