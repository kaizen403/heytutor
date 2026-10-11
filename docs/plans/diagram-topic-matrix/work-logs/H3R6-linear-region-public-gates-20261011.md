# H3R6 linear-region public gates

Date: 11 October 2026. Owner: `/root/shaded_eval`.

This implementation gate role followed independent authorship and freezing of the 40-row eval. The frozen eval, oracle, scope, manifest and original evidence were not changed or inspected during this code role. All seven frozen checksums still match. No topic ledger or accepted coverage count is updated by this log; the integration owner owns acceptance. Coverage/progress, session ownership, DESIGN-REVIEW and the TDD skill were read before the gate was authored.

Owned source: `packages/scene-engine/scripts/verify/verify-linear-region-operators.ts`. Separate detailed evidence: `.context/h3r6/shaded-regions/GATE-EVIDENCE.md`. Runtime, adapter, capability, planner, presentation and package integration edits belong to root; pure exact math belongs to the design worker. No paid API calls, builds, live lectures or saved-replay checks were run by this worker.

The first public half-plane test was written and run before integration. It was RED with `unsupported_operator`, no render, and exit status 1. Its independent wrong-side assertion already rejected a deliberately invalid polygon. The final gate imports `validateSceneDocument` and `compileSceneDocument` through the public index and uses no private solver or runtime mock. Every source mutation must be fatally refused with `renderScene:null`; an unknown-operator issue alone cannot pass.

The complete public command passes **4,015 checks**, exit status 0:

```sh
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-linear-region-operators.ts
```

Coverage includes all four reusable operators, using independently worked values separate from the frozen eval:

- Number lines: negative coefficients, exact rational endpoints, open/filled styles, touching and punctured unions, Boolean intersections/complements, singleton, empty and all-real outcomes, zero coefficients and renamed variables.
- Half-planes: analytic clipped-fill completeness and area, exact boundary residuals, correct shaded side, solid/strict styles, negative normals, vertical/horizontal boundaries, boundary through the origin, empty/all-plane constants, and no solid coincident axis beneath a strict source boundary.
- Feasible regions/objectives: all exact rational corners and active source incidences, corner objective values, finite attained optimum, unbounded region with finite optimum, improving-ray unbounded objective, unattained finite limit, attained optimal edge with zero included corners, no-vertex strip, empty, singleton, line, mixed-endpoint segment and constant objective. Equivalent scaled/reordered source forms preserve exact results.
- Systems: independent rational unique intersections, parallel/coincident classification, one shared geometric stroke for coincident equations, axis-parallel pairs and rejection of degenerate/nonlinear two-line inputs.

Actual compiled fill mutations to the wrong side or an incomplete clip must throw. Actual compiled corner authority with an omitted or perturbed mathematical corner must throw. Public mutations cover source coefficients and relation, objective coefficients/sense/omission, explicit nonnegativity, Boolean connective and whole-set negation, false corner/optimum/boundary claims and annotations, trace overlays, sibling model-authored points, dropped/inserted proof corners, forged objective values and zero exact denominators. Source guards cover unknown variables/addends, functions, powers, exact-case domains, continuous versus integer domains, complete arithmetic tuple RHS, and unsupported planar negation/set difference/implication. Numeric/string display windows may change the clip but cannot hide required endpoints, boundaries, exact corners or intersections, collapse four tiny corners, or collapse a thin no-vertex 2D strip into a line. Tangent windows with no 2D feasible interior safely refuse.

The gate also verifies actual SVG text origin/baseline/width against reserved label boxes for every positive public scene. Mutations to a central baseline or overflowing glyph width must throw. Development inspection identified attached equation labels and three label collisions; root fixed the label placement and actual reserved-box rendering.

Final development visual command:

```sh
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-linear-region-operators.ts --family=dev --visuals
node apps/tutor/scripts/lecture-lab/svg2png.mjs .context/h3r6/dev-visuals
```

The Chrome rasterizer, also used by paid measurement, produced **8/8** images at 1200×700. All **8** capture evidence records have successful SVG navigation/paint and matching current SVG/PNG SHA256 values. This worker locally inspected mixed number-line endpoints, union rays, strict negative-coefficient half-plane, strict boundary coincident with the y-axis, rational LPP with every corner value, unbounded LPP, unique and coincident systems. Geometry, labels, shading and boundary/endpoint styles are readable and correct, with no remaining label/stroke/leader collision and no artificial clipping border. Images were never emitted to root.

**Rasterizer limitation:** Sharp 0.35.5 / librsvg 2.63.2 ignores SVG `textLength`/`lengthAdjust` here. Removing those attributes produced byte-identical native PNGs and falsely suggested two remaining text collisions. Those reports were withdrawn. Earlier Sharp/Quick Look images are archived under `dev-visuals/sharp-prior/`; only the final Chrome images and `.render.json` records are final development visual evidence. This implementation worker is not a blind final image grader and claims no paid eval, live/replay or accepted coverage result.

Assigned work is complete. Root will commit owned files and freeze the candidate; this worker stops edits after handoff.

## Pre-paid independent review followup

The worker was explicitly resumed after independent review of provisional source HEAD `de5249f1`, before any paid calls. Two independent annotation-free conjunctive controls use region constraints `x>=-3,y>=4` (corner `(-3,4)`) and system equations `x=-4,y=6` (unique point `(-4,6)`). Both compile. Changing only the source to `union of ... and ...` for the region or `... or ...` for the equations exposed public **RED**, exit-1 failures: source Boolean meaning was incorrectly reduced to conjunction. After root's generic Boolean-AST fix, both are atomically refused. The new focused families are `source-union-region` and `source-or-system`.

A third `group-label` guard adds a semantic `title` group in the solution's reveal group and a label annotation falsely claiming `No solution` for a nonempty half-plane. Root's generic group/annotation fix landed concurrently before this worker captured that case, so **no independent pre-fix group RED is claimed**. The case now atomically refuses with fatal `untrusted_linear_annotation` and `untrusted_linear_claim`, explicitly identifying operator-owned marks and computed solution semantics. Its public refusal evidence is printed by the gate.

The final full gate passes **4,015 checks** without weakening any prior expectation. The existing **8/8** Chrome capture hashes and **7/7** frozen evaluation checksums still match. Rendering was unchanged, and no development pictures or frozen eval semantics were touched. No paid calls, builds, acceptance-count changes or further owned edits occur in this followup. Root owns the next candidate commit and immutable freeze.
