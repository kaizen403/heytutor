# W2 bounded SUVAT and ladder source programs — 6 October 2026

Worker: Sol implementation role. Integration owner: parent session. Author:
Rishi Vhavle. Assigned tree:
`/Users/kaizen/heytutor-cov-wt/w2-kinematics-ladder-20261006`.
Base: `5a3a9bbbf2b081505187fc23562d89df1135a2e5`.
Disposition: **integration_pending**, no READY/FULLY-CERTIFIED or accepted-count change.

## Contract and baseline

Read AGENTS, coverage plan, topic matrix/progress/readiness, continuation,
session ownership, coordination CHECKPOINT section 4 and old SUVAT submission,
review/status/runtime records. Historical records were read only; no foreign
frozen fixture/gate was loaded. This is a fresh bounded authored profile, not
native exam-bank or holdout coverage. Fraction/number-reader repair already
exists in the base; no shared number-reader change is made.

`physics|2|suvat-equations`: one forward straight-line constant-acceleration
interval, independently readable source roles, at least three of u/v/a/t/s,
common metric units, no internal reversal. Full native obligations remain open.
The ladder application is a **partial slice** of
`maths|14|heights-and-distances`, not acceptance of that compound row:
one static perpendicular wall/floor contact triangle, two independent source
sides, supported metric units, optional source orientation. FBD/load, dynamic,
multiple-ladder, numberless, conflicting, degenerate and unreadable roles decline.
No scope is inferred from a topic string.

The initial new gate ran before edits to existing implementation modules:
11 case-level checks, 6 failures. Five independent SUVAT cases were already
correct. Four ladder cases used stock L=4 and theta=60 degrees: the 13 m ladder
with foot 5 m from the wall drew foot x=2 instead of 5. A derived 60-degree
plan was accepted, and numberless ladder geometry was invented. Baseline raw
report/results: `/tmp/w2-kinematics-ladder-20261006-before/`.

## Owned changes

- `packages/scene-engine/src/archetypes/generators/constantAcceleration.ts`:
  source roles alone supply the solve; plan givens/derived rows are checked
  claims, never missing-source authority. Unsupported units, duplicate stale
  claims, forged cached slots, multi-interval/body/frame premises and unreadable
  extra roles decline. Source equality is finite and 1e-9 relative/absolute,
  replacing the earlier 0.5% SUVAT claim tolerance. Legacy `agrees` and free-fall
  code are unchanged. `constantAccelerationSourceProgram(question, quantities)`
  exposes the existing v-t program without requiring topic detection.
- `packages/scene-engine/src/ir/rightTriangleSource.ts` (new): reusable two-side
  right-triangle solve plus independently read ladder side-role bindings,
  original number/unit quotes/spans, converted units, orientation, and plan
  claim comparison. A quoted numeral does not bind a different role/unit.
- `packages/scene-engine/src/ir/ladderSourceProgram.ts` (new): engine-owned
  points/segments/dimensions/angle/right-angle, incidence, perpendicular and
  side-ratio proofs, and ordered reveal groups. No stock angle, force arrow,
  centre-of-mass assumption, model ink or pixel layout is introduced.
- `packages/scene-engine/src/archetypes/generators/fields.ts`:
  `ladderWallFromSource(context)` exposes the replacement to parent integration.
  The assignment's `src/archetypes/fields.ts` path does not exist at this base;
  this is its actual generators-directory path. All original field/circuit
  function and registry bytes after `function pageNormalGrid` are identical
  to base (explicit byte comparison passed).
- New gate `packages/scene-engine/scripts/verify/verify-w2-kinematics-ladder.ts`
  and independent literal fixtures in `scripts/verify/fixtures/w2-kinematics-ladder/core.ts`.
  No existing tests were edited.

The legacy mechanics ladder registry entry is **unchanged**. A trial fields-table
override exposed two parent seams: the old ladder picture contract demands
weight/normal forces for a geometry-only stem, and switching every ladder also
removed the old explicit mass/length/angle/friction probe. The trial was removed;
no blanket exemption, fake role or old-test change was used to get green.
Normal-path ladder replacement therefore remains a parent integration dependency.
The stock 60-degree defect is not claimed fixed in the normal application path.

## Independent cases and verification

SUVAT hand oracles: braking u20/a-2 gives v0/t10/s100; u2/a4/t3 gives
v14/s24; rest/a2/t5 gives v10/s25; 36 to72 km/h in5s gives u10/v20/a2/s75;
u4/a1/2/t4 gives v6/s20. Gate checks source quantities, declared units, domain,
analytic v-t samples, physical slope and trapezoid area independently of display
scale, and reveal order. The normal archetype path is also exercised for these
five cases.

Ladder hand oracles: length13/foot5 gives height12 and cos(theta)=5/13;
length10/top8 gives foot6; mirrored foot5/top12 gives length13 with foot x=-5;
500cm/300cm gives length5/foot3/height4 in metres. Foot/top dimensions and original
source spans are checked. Wrong 60-degree plan claims, wrong-source role/unit,
missing source, ambiguous orientation, contradictory third side/angle,
unsupported units/dynamics/multiple bodies and degenerate sides decline.
Damaged and partial ladder/SUVAT documents are compiled and must produce no
renderScene. Source-only programs do not satisfy or bypass full ProblemIR admission.

Commands use:

```sh
export PATH=/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin:$PATH
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @heytutor/drawing build
pnpm --filter @heytutor/scene-engine build
pnpm --filter @heytutor/tutor-core build
pnpm --filter @heytutor/scene-engine typecheck
pnpm --filter @heytutor/scene-engine lint
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w2-kinematics-ladder.ts /tmp/w2-kinematics-ladder-20261006-after /tmp/w2-kinematics-ladder-20261006-before/native-digests.json
pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-suvat-ready.ts /tmp/w2-kinematics-ladder-20261006-ready
```

Node24.21.0; pnpm10.32.0; own frozen ignore-scripts dependency install passed.
Drawing/scene-engine/tutor-core builds and scene-engine typecheck passed. Package
lint passed with four warnings in untouched DSA files; targeted lint on all six
owned TypeScript files passed without warnings. New gate: **54 case-level checks,
0 failures**; existing SUVAT readiness gate: **2206 assertions, exit0**. This is
an offline gate result, not a readiness declaration. `git diff --check` passed.

Six affected existing gates ran separately against this tree's base source and
patched source. Only checkout paths were normalized in stdout/stderr; whole-output
SHA256 was compared, including failure output. Temporary owned-source baseline
restoration was reversed in a finally block. No foreign tree/deps were used.
Final results match baseline status **and** complete output digest:

| Existing gate | Exit | Whole-output SHA256 (base = final) |
| --- | --- | --- |
| verify-kinematics-operators | 0 | 633318325ca71b75d02ec84f660e671a9d55931398c312dc427280e7b308d9eb |
| verify-stem-numbers | 0 | 22e56b893afad439f1549b63a67bbafbb94ea09013acf0e01e4343d0601953d6 |
| verify-archetype-pictures | 1 | 5ed6bf83535345ea39707972bde746cf66ad3ccf247e04e1bc4cf0b77f60bb5f |
| verify-archetype-point-ownership | 1 | 502d1d99bf93b54e66538a4d8d313865c0b99a776c8fbd1bc90cb780d99eb440 |
| verify-family-synthesis | 0 | 9921327c49e9dc49e996efd4a899a6bbaba95a349ad7b1a2223522954259586c |
| verify-visual-obligations | 0 | 2efe905d4c1124b23aee69f1ac04733af51c00ec1d435be3df63f3d76f2d3aff |

Raw comparison: `/tmp/w2-kinematics-ladder-20261006-regressions/comparison.json`.
The abandoned override's extra ladder failure/different digest is retained there;
final archetype-pictures again has the same three baseline failures and counts.
This fresh base is not described as the historical 77green/2red entire suite.

The two native compiler contradiction observations were freshly reproduced from
an authored trajectory/state document: contradictory source text and an omitted
contradictory supplied-position quantity both still compile. For **each** complete
compiler result, before/after SHA256 is
`929c42c1d7e57661780bfff4729a1fc4adb8d8d37124145cd74082c7b0f4abc3`.
Those known reds are retained, not waived; result bodies and digests live in both
new gate artifact directories. The old 618-check frozen SUVAT gate was **not run**
or loaded. No old full-suite equivalence is inferred from these bounded checks.

Offline SVGs from the source gate: `foot_distance.svg`, `two_legs_mirror.svg`,
`braking.svg` under `/tmp/w2-kinematics-ladder-20261006-after/` were rasterized
with local Quick Look and visually inspected. Square thumbnail wrappers prevent
Quick Look from cropping the 1200x700 board. Source SVGs stay unchanged. Inspected
13/5/12 dimensions, mirrored foot/top contacts, right angle, theta approximately
67.4 degrees, braking slope, t10/v0 endpoints and s100 area. These are **offline**
engine renders, not student/Konva/narration/replay evidence.

## Parent handoff and remaining seams

1. Export/select `constantAccelerationSourceProgram` for source-program availability
   through visual-need fallback, including the ordinary braking stem when the
   evaluated visual requirement is null. Existing source slot extraction already
   uses the stricter source resolution.
2. Export/admit `ladderSourceProgram` or `ladderWallFromSource` and use
   `resolveLadderSource` side evidence/state for parent authority/source quantities.
   Replace the stock path for supported static geometry; stale planner theta60
   cannot certify against 13/5 dimensions. Do not let an honest source decline
   reach the unsafe stock fallback.
3. Resolve the force-oriented ladder picture-contract mismatch structurally for
   geometry-only input. Check complete actual ProblemIR obligations, entities,
   names/roles, requested values and source quantity bindings. This packet does
   not provide planner/solver reconciliation, shared admission or persistence.
4. Independent shared-seam review, real student render/narration/WRITE/FOCUS,
   authenticated save/restart/reopen/earliest whole replay remain **NOT_RUN**.
   Native/holdout, symbolic and the remaining heights/distances variants stay open.

Parent exports/index, shared synthesis/capabilities, planner/solver, save/replay,
ledger/counters, mechanics generator, main checkout, environment keys, servers,
providers, browser, DB, ports, remotes and stash were not edited or used. No agent
spawn/fork/Astral or publication occurred. The work is committed as the user only;
exact final commit SHA is returned with the handoff. Integration-owner acceptance
remains unset until independent/shared/live review.
