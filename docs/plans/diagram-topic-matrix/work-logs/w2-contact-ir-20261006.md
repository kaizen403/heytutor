# W2 static contact triangle — full ProblemIR numerical joins

Worker: this W2 contact-IR session. Integration owner: parent session.
Author: Rishi Vhavle <rishivhavle21@gmail.com>.
Worktree: `/Users/kaizen/heytutor-cov-wt/w2-contact-ir-20261006`.
Frozen parent HEAD: `f9b590b12bf7ca3319969a6686eef7dfc00baee6`.
Date: 6 October 2026. Disposition: **integration_pending**.
**READY=0; accepted-count delta=0; FULLY-CERTIFIED=0.**

## Assignment, reuse and scope

Read AGENTS, the coverage plan, topic index/progress, session ownership and
the existing source resolver, ladder program, initial contact agreement,
solver, source-authority/compiler, synthesis and visual-obligation seams.
Announced ownership before creating the new verification script. Only the
three assigned TypeScript paths and this worklog were changed.

This is a bounded authored profile of `maths|14|heights-and-distances`, not
native exam-bank or holdout coverage and not acceptance of that compound row.
The source contract remains one static ladder, vertical wall, horizontal floor,
two independent positive compatible source sides L/d/h, an optional stated
left/right orientation, and one height/distance/length/floor-angle/cosine ask.
The whole-source `readStaticContactTriangle` guard is **byte-identical** to
parent HEAD; the source resolver/program and their geometry were reused.

Parent HEAD's initial agreement rejects every nonempty expression, constraint
and solve-request array. The final authored gate, run with that owned source
restored from `git show` in this same worktree, has **57 checks / 21 failures**.
The five complete numeric source cases decline, so their dependent candidate
checks cannot produce a baseline full-IR document. Full stdout/stderr, every
failure stack, input IRs and result JSON are retained under
`/tmp/w2-contact-ir-20261006/baseline*`. No foreign frozen worker gate was run.

## Owned implementation and authority

- `src/ir/staticContactTriangleProblemBinding.ts`: a deep binding module,
  retaining `problem` as the original complete caller object. Every entity,
  fact, expression, structural constraint, representation intent and requested
  result must join within the numeric contract. Unused facts, hidden expressions,
  missing side carriers, unknown solve kinds and unsupported intents decline.
- `src/ir/staticContactTriangle.ts`: calls the binding after existing source
  and ProblemIR validation, carries exact source values/raw given units/result
  units, actual numerical label entities and their required reveal membership.
  Uses the existing label operator and existing contact geometry. Body-name
  captions stay on the existing bodies; foot/top/corner use the actual points'
  labels. No arbitrary provided point-name/Q extension is introduced.
- `scripts/verify/verify-w2-contact-ir.ts`: actual synthetic complete IRs,
  independent ASTs and literal numeric oracles, normal synthesis/compiler,
  generic full-IR obligations and the local deterministic solver. No reduced
  surrogate is passed to admission, and caller IR/plan immutability is checked.

Given expression IDs are explicit side-role carriers (`eL`, `eD`, `eH`, or the
bounded length/distance/height aliases); a matching numeral cannot select a
different side. Each carrier needs a literal raw source value and given evidence
quoting that physical datum. The raw source unit remains on its scene quantity.
Metric source conversions are explicit AST multiplication by .01/1000; result
conversions are explicit division by the requested length scale.

Expected derivations are constructed from physical source roles: missing leg
`sqrt(L^2-d^2)` / `sqrt(L^2-h^2)`, missing length `sqrt(d^2+h^2)`, floor angle
`atan(h/d)` (radians, or `*180/pi` for degrees), and cosine `d/L`.
Only addition/multiplication association and commutation are canonicalized;
subtraction/division order, powers, calls, constants and unit conversions remain
structural obligations. Evaluation is a **secondary** finite relative audit,
never formula admission. The deliberately wrong `13-(5/5)` also returns 12
but declines against the height derivation. A constant correct answer declines.
Equivalent factored Pythagoras forms are outside this canonical AST contract.

Literal ASTs cannot distinguish identical source-side expressions in the same
raw unit, so that ambiguous numeric contract declines; source-only geometry
remains available. Different raw units retain their independent AST structure.
The existing resolver also declines length and foot-distance values in the same
setup sentence because its role reader finds both roles; that initial narrow
decision is preserved and tested, not repaired in a foreign source-owner file.

Requested bindings require the actual requested fact, role-consistent symbol
and explicit dimension/unit. With a plan, the exact result quantity ID must be
present in its unknown/derived index, roles and unit scale must agree, duplicates
and foreign entity IDs decline, and every numeric plan claim is independently
checked against source state (including cosine). An unknown's unit is checked
even without a numeric value. Plan values never supply geometry or missing sides.

Only wall/floor perpendicularity and foot/floor or top/wall incidence constraints
map to the existing fatal `wall_floor_perpendicular`, `foot_on_floor` and
`top_on_wall` proofs. Unsupported equations, inequalities or other relations
decline; no constraint disappears behind a blanket geometry exemption.
All intent-named physical objects are required and revealed. The initial
bodies/prose-only control is retained; stricter full numeric joins are not
claimed to support arbitrary prose fragments or other intent kinds.

Candidate checking regenerates the complete expected output from source plus
the caller's full IR. Schema/mode, quantities, geometry, labels, annotations,
proofs, required IDs, groups and timeline must agree. Source/provenance flags
grant no authority. A forged metadata flag cannot fix damaged geometry, wrong
numbers/units, wrong owners, removed labels/proofs or missing reveal membership.

## Independent source cases and negatives

| Source case | Independent oracle | Requested carrier / actual label |
| --- | --- | --- |
| L=13 m, d=5 m | h=12 m | 1200 cm / `h=1200 cm` |
| L=10 m, h=8 m | d=6 m | 6 m / `d=6 m` |
| Left foot 500 cm, h=12 m | L=13 m; foot x=-5 | 13 m / `L=13 m` |
| L=500 cm, d=300 cm | h=4 m; angle=53.13010235415598 degrees | degree / `θ≈53.1°` |
| Right foot 1 km, h=750 m | L=1250 m; foot x=1000; cos=0.8 | dimensionless 1 / `cosθ=0.8` |

All five use source-named ladder/wall/floor/foot/top/corner entities, complete
given expressions, constraints, conceptual intent and evaluate/result binding.
The actual raw-unit given labels, requested label, quantity owner, physical
point placement, fatal proofs, generic obligations and required reveal are checked.

Negative coverage includes stale height/cosine plans, wrong unknown units and
binding index/roles/evidence, foreign entity binding, same-answer wrong AST,
constant answer, wrong raw value/role, missing given/request/entity, orphan fact,
hidden expression, hidden tilted-wall statement, unsupported relation/equation/
intent/solve kind, wrong incidence and missing formula source evidence.
Twelve candidate mutations reject atomically with no renderScene, including
numeric label and label-reveal mutations. Unsupported whole-source suffixes
still decline. Initial bodies/prose and source-only controls remain green.

## Commands, complete outputs and results

All commands used this tree's own frozen dependencies and Node 24.21.0,
pnpm 10.32.0. No dependency/lockfile edit or install script execution occurred.

```sh
export PATH=/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin:$PATH
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @heytutor/drawing build
pnpm --filter @heytutor/scene-engine build
pnpm --filter @heytutor/scene-engine typecheck
pnpm --filter @heytutor/scene-engine lint
pnpm --filter @heytutor/scene-engine exec eslint src/ir/staticContactTriangle.ts src/ir/staticContactTriangleProblemBinding.ts scripts/verify/verify-w2-contact-ir.ts
pnpm --filter @heytutor/scene-engine exec tsc --noEmit --strict --esModuleInterop --target es2022 --module esnext --moduleResolution bundler --skipLibCheck --typeRoots ../../node_modules/.pnpm/node_modules/@types --types node scripts/verify/verify-w2-contact-ir.ts
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w2-contact-ir.ts /tmp/w2-contact-ir-20261006/final
git diff --check
```

Install, drawing/engine builds, package typecheck, package lint and owned-file
lint passed. Owned lint has zero warnings; package lint has four existing warnings
in untouched DSA files. The script also passes the explicit strict typecheck
using Node declarations from this tree's own installed dependency graph.
The first ad hoc script-typecheck command lacked Node type roots and strict mode;
its full failure output (missing Node declarations and unrelated circular-source
narrowing errors) is retained in `script-typecheck.log`, not described as a pass.

Final dedicated gate: **57 checks, 0 failures**, offline only. Complete source/
compiler outputs, actual submitted full IRs, mutation failures and SVGs are in
`/tmp/w2-contact-ir-20261006/final/`; complete final stdout/stderr is in
`final-verify-w2-contact-ir.log`. Baseline final-gate failure output SHA-256,
normalizing only this checkout path:
`de36fc7a7cca45eaced154a75b6b3a9543e457dd1177c9f7f08a8c908352662e`.
Final output SHA-256:
`ee01c71778616b38a421ad5e41f85f1104c85df033e237a42055f474d636d88e`.
Earlier failed iterations are retained in `first.log`, `second.log`, `labels.log`
and their artifact directories. The earlier 53-check comparison is archived in
`pre-label-comparison/`; the 55-check comparison is in `55-check-comparison/`. No failure output was replaced with a filtered summary.

Five existing shared gates ran against parent-owned source restored in this
same checkout, then against final source. Restoration was reversed in `finally`;
no main/foreign worktree/dependencies were read or changed. Each is exit0 with
the same complete output digest before and after:

| Shared gate | Complete normalized output SHA-256, base = final |
| --- | --- |
| verify-scene-engine | `8fb3dcb001c0bfdd32c30695667685116bb9c54476afc7b1d08261cbd8f3e2ea` |
| verify-problem-ir | `3193767a4af4acb107bdb81ca2da870a8917596cd730a6c9c53aaa0854a96b9f` |
| verify-family-synthesis | `9921327c49e9dc49e996efd4a899a6bbaba95a349ad7b1a2223522954259586c` |
| verify-visual-obligations | `2efe905d4c1124b23aee69f1ac04733af51c00ec1d435be3df63f3d76f2d3aff` |
| verify-right-angle-precision | `2a89bfdc650493a53d7c3fe80065f1e2ee8fdf6a57962339e32cc9771f8ff520` |

Commands are `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/<gate>.ts`.
Raw outputs/comparison and the exact subprocess commands are retained in
`/tmp/w2-contact-ir-20261006/comparison.json` and adjacent baseline/final logs.
This is a scoped regression comparison, not a full-suite equivalence claim.

## Parent S1/S2 coordination

The user reports independent parent review at
`coord/reviews/w2-source-program-acceptance-20261006.md`: S1 is conflicting
quantity ID `length` / symbol `height`; S2 is missing cosine scalar authority.
The parent owns the new known-scalar / `ambiguous` / null role union, known-only
SI conversion, ambiguous-source rejection and linked/transitive/unknown
withdrawals. Those helpers/registry/authority files are not edited here. This
binding does not call `rightTriangleQuantityRole` or `rightTriangleClaimSIValue`,
so there is no direct ambiguous-union call site to narrow. A full-IR S1 conflict
control is added alongside the existing stale-cosine control. The parent fixes
are distinct from this full-IR join and are not claimed as this worker's evidence.

## Render evidence, limits and parent handoff

Offline SVGs are compiled from the real full-IR documents. Quick Look square
wrappers prevent its thumbnail cropping the 1200x700 board. Visually inspected
the height/metres, mirrored mixed-unit two-leg, and right/km cosine boards under
`/tmp/w2-contact-ir-20261006/labels/*-square.svg.png`: physical contacts, correct
mirror, numeric requested/raw given labels, right angle and honest approximate
angle text are visible. Wrappers alter only the thumbnail canvas, not source SVGs.
Some body names and equal-unit dimensions repeat because the initial source
captions/dimension marks remain; student layout review is still pending.

| Exact topic ID | Checked scope | Proposed state | Remaining obligations |
| --- | --- | --- | --- |
| maths\|14\|heights-and-distances | Authored static perpendicular L/d/h numerical full-IR joins, five source cases | integration_pending | Parent independent review, native/holdout variants, student/Konva/narration, persistence and reopened whole replay |

The normal parent synthesis/compiler seams already invoke the existing contact
entry points, and all five complete inputs pass those paths here. No index,
compiler, familyScene, source-authority/capability, app or ledger edit is needed
to demonstrate this slice. The helper is not added to public exports; the parent
may export it if a separate consumer needs the retained binding object.
The parent retains tier decisions and any teaching-plan correction extension
(the existing source correction owner does not add cosine here; stale cosine
claims now decline admission rather than gaining authority).

Live student render, narration/WRITE/FOCUS, authenticated save/restart/reopen,
earliest whole replay and native/holdout evaluation are **NOT_RUN**. No browser,
provider/key, DB/runtime/server, remotes, stash, other worktree, agent/fork or
Astral use occurred. No ledger, accepted counter or READY declaration was edited.
Commit uses only owned paths, author Rishi Vhavle, and per-command
`core.hooksPath=/dev/null`; no shared git identity/hook configuration is changed.
Integration-owner acceptance remains unset pending independent/student review.
