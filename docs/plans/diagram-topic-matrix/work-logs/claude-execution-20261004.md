# Claude execution log (4 October 2026)

Integration owner log for the nine topic queue resumed under the
[readiness policy](../readiness.md). Coordination board and per agent records
live in `/Users/kaizen/heytutor-claude-coord/` and are copied into
`docs/agent/coverage-handoff-20261003/claude-execution-20261004/` at each batch.

Consolidated checkout: `/Users/kaizen/heytutor-claude-handoff`, branch
`handoff/diagram-coverage-20261003`, base tag `handoff-base-20261003` (3ff36cea).
Topic workers commit on `cov/<topic>` branches in their own worktrees; only the
integration owner writes this branch.

## Baseline at 3ff36cea

Built dists for design-tokens, drawing, scene-engine, tutor-core and whiteboard
(all exit 0). Typecheck and lint, then every `verify` step run individually so
one red does not hide the rest. Full table:
`/Users/kaizen/heytutor-claude-coord/integration/baseline.md`.

## PRIVATE06 reconciliation

Decision: **no application code change**. The handoff checkout already contains
the PRIVATE06 smoke baseline byte for byte, plus the owner's later chemistry work.

Evidence:

- `intro-coherent-candidate-06/source-pins.json` pins 700 source files. 696 hash
  equal to the handoff checkout. The 4 that differ are `chemistry/lewis.ts`,
  `chemistry/moDiagram.ts`, `chemistry/vsepr.ts` and
  `synthesize/visualObligations.ts`.
- The runtime bootstrap manifest (765 files, behavioural SHA b8ba6016...) lists
  `"user/Main chemistry changes"` under `explicitExclusions`. Of its 749 source
  pins, the same 4 files are the only mismatches; of its 16 dist pins only
  `scene-engine/dist/index.js` differs, which is the compiled form of those 4.
- Every hunk in `against-main-at-capture.patch` is a removal of MAIN's chemistry
  work (C03 bonding figures: `bondingFigures.ts` imports and cue patterns in
  Lewis/VSEPR/MO, and `sameObligationLabel`/`formulaIdentity` in
  `visualObligations.ts`, which lets a board formula like `SO_4^(2-)` satisfy a
  source label `SO4^2-`). PRIVATE06 removed nothing deliberately; it was frozen
  without the chemistry lane by policy.
- `formulaIdentity` only widens label equality for strings matching
  `^[A-Z][A-Za-z0-9+-]*$` after stripping `_`, `^( )`. Matrix labels such as `A`
  compare equal either way, so the proven Matrix smoke path is unaffected.

Result: the active application is PRIVATE06 plus the newer MAIN chemistry; it is
kept as is. The chemistry lane itself stays outside this programme's acceptance.

## Batches

### Batch 1: landed at 0a8d3ee9 (Ohm reviewed adapter layer)

- 31ce897b and 0a8d3ee9 are `cov/ohm` 7ed8042a and 75c1934a, byte equal to the
  reviewed `grounded-ohm-owned-files.patch` and `grounded-ohm-shared-seams.patch`.
- scene-engine typecheck 0, lint 0; tutor-core typecheck 0; tutor typecheck 2
  (baseline only); `verify-parallel-ohm-topic` 0. Every baseline green verify
  step stays green; the red set equals the baseline.
- This is the adapter layer only. Ohm is not READY: natural student stems do
  not reach the grounded adapter yet.

### Circle standard e7d6bded: sent back

The reviewed patch (tree identical to 0adaa13d) merges with Ohm, but its new
compiler preflight `validateCircleSourceBinding` turns four baseline green gates
red with `circle_source_mismatch`: `verify-scene-engine` (implicit curve),
`verify-constraint-region` (a disc region and a two circle annulus),
`verify-evaluation-compile` (parabola and circle) and the tutor
`verify-representation-corpus`. The guard fires whenever the question text
yields a circle source, even when the scene owns the locus through
`implicit_curve` or `constraint_region`. The merged attempt is kept on local
branch `integ/batch1-with-circle`. Worker #1 owns the scoped fix.

### Batch 2: landed at 29706b10

- SUVAT guard 1033163e plus scope follow-up f0b98b9f (a given relation with a free
  variable keeps base behaviour unless a side is result bound; reviewer PASS).
- Relative velocity d82d84cf: an identically zero polynomial is a non discrete
  solution set and throws instead of certifying no roots (reviewer PASS).
- Point-line reviewed layer 1d81d1f8 (reviewer PASS with the lineage gap open) and
  Sub17 persistence scalar admission 29706b10 (reviewer PASS with a save parity
  note: the quantity audit now runs for every tier at save time).
- Every verify step red set equals the baseline. Topic gates: SUVAT 618 checks
  with its 2 preserved compiler gaps; point-line 122 checks; kinematics 738;
  line operators 553; persistence gates 55, 248 and 185 controls, all exit 0
  except the SUVAT gate by design.
- Not adopted: Circle (sent back), Ohm natural stem path and stated circuit
  authority (reviewer BLOCK for a wrong grouping, internal resistance drawn as
  an external resistor, and correct values overwritten).

### Shared fix c0d1dc9a: stem fractions

The archetype slot reader took "1/2 m/s^2" as 2, which let an exact SUVAT
figure carry v = 12 instead of 6. The stem number grammar now reads fractions,
mixed numbers and vulgar fractions, never starts inside another token, and a
unit has to end where it matches. It is exported as `STEM_NUMBER` and
`parseStemNumber` for generators. Gate `verify-stem-numbers.ts` (33 checks)
fails against the old reader; every verify red set equals the baseline.

### Batch 3: landed at 327122d2

- 1a5e7146: a negative literal is parenthesised in ProblemIR safe source, so
  `(-3)^2` evaluates to 9 (reviewer sweep: 54 of 117 wrong before, 0 after).
- 904cbf74: Circle standard and general form (reviewed patch plus live family
  routing, guard scope, label split and far centre decline).
- 32e3b86f, d320056f, 327122d2: Matrices grammar, scalar and triangular types,
  and an engine drawn matrix source document when no planner candidate survives.
- Every verify red set equals the baseline; all topic gates listed in the
  integration log exit 0, except the SUVAT gate by design.
- Circle standard, circle general and Matrices are READY candidates pending
  the student render by the runtime verifier. READY count is unchanged until then.

### Regression in the stem number fix, fixed at bed3bc69

The first reader refused a number followed by a sentence full stop, so three
optics archetypes fell from exact to qualitative while the archetype pictures
gate stayed red for its old reason. The exit code comparison could not see a
baseline red step failing more. Fixed, with sentence end controls in the gate.
From here on every red step is compared by its first failure line and a
normalised output digest against a rerun baseline at 3ff36cea.

### Batch 4: landed at 778b5d6e

- Point-line lineage: the measured line and point are bound to the source,
  the compiler refuses a distance to an undrawn line, several stated literals
  decline, and restore marks a bad saved turn `retry_required`. The HEY88 gate
  expectation `d=7.211` became `d≈7.211` by design (a rounded value is marked).
- Matrices: fraction cells, a native indexed premise document, and matrix
  expression labels such as `2A` no longer read as amperes at save.
- Circle: a traced circle must be the source circle.
- SUVAT readiness: source bound constant acceleration archetype on the shared
  stem reader, with selection and fallback guards.
- Digest comparison against the baseline: only the new stem gate and the
  archetype pictures generator count (74 to 75) differ. Readiness gates:
  circle 159 and 176 checks, matrices 946, SUVAT 2206, point-line 113.

### Batch 5: landed at a9b3a294

- Circle: the equation label belongs to the source circle, and a non conic
  trace carrying the circle's equation is refused.
- Section formula: stem source, coordinate figure route, caller admission and
  a section formula numeric authority before the plan is used. Conflicts with
  the point-line batch were resolved by keeping both source validators.
- LaTeX math delimiters are unwrapped in WRITE ink and in speech; the new gate
  runs in the tutor-core verify chain.
- Two baseline red gates turned green from fixes to their fixtures, not to
  their assertions (turn save idempotency stub, mensuration fallback anchor).
- Readiness gates: circle 184 and 206 checks, section formula 138 and 22.

### Batch 6a: landed at f0db4820

- The stem reader reads thousands separators and refuses ambiguous groupings.
- Save and live now call one admission function, so a figure the lecture save
  would refuse declines before it is drawn. The merge added the point-line
  source check to it, which the branch predated.
- The matrix guard no longer blanks DSA traces and refuses lowercase stand-ins.
- Three baseline red gates are now green; no step got worse by output digest.

### Physics batch held

Ohm, UCM and the shared source quantity authority are merged on a local branch
but not landed. Two tutor-core gates changed: the UCM probe without a plan no
longer draws, and value-free concept circuit diagrams disappeared. Decision:
concept schematics without values stay, and the UCM probe gate passes a plan,
both to be reviewed before adoption.

### First READY: circle standard form (declared scope)

`maths|10|circle-standard-form` is READY for the scope recorded in
[readiness.md](../readiness.md), integrated at c876c08b. Evidence: reviewer
PASS with an independent oracle, the readiness gate, a live student run of
"Does the point (4,2) lie on, inside or outside the circle
(x-1)^2+(y+2)^2=25?" rendered and inspected (geometry and work area numbers
correct, math rows plain after the LaTeX fix), and an authenticated save,
Postgres restart, reopen and whole replay that matched exactly. Known gaps are
listed with the row. FULLY-CERTIFIED is not claimed and `topic-progress.csv`
is unchanged. READY 1, FULLY-CERTIFIED 0.
