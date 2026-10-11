# H3R6 linear-region math — 2026-10-11

Owner: linear-design worker. Root owns shared source binding, rendering,
compiler/document gates, capability/planner integration and accepted coverage.
This log does not update topic counts.

The independent evaluation was frozen by root before implementation at
`2026-10-11T00:47:53Z`, SHA
`7dd247caaa637b076fe32998b831b759d28d15315932843f35a9b92a3f6ebe4f`.
This worker did not inspect evaluation questions/rubrics, prior output contents
or images. All cases below were independently worked. No paid calls, builds,
commits, examples or shared compiler/planner edits were made by this worker.

## Owned changes

- `packages/scene-engine/src/math/exactRational.ts` supplies reduced rational
  arithmetic with bounded bigint internals and canonical JSON-safe exact
  metadata. Decimal, scientific and fraction inputs retain source precision.
  Binary64 conversion rounds once, ties to even, and rejects overflow or a
  nonzero exact value rounding to zero.
- `packages/scene-engine/src/math/linearRegion.ts` supplies bounded affine
  parsing and `solveLinearFigure` for Boolean number-line sets, half-planes,
  feasible linear regions and two-line systems. Inputs contain original
  expressions; model-authored vertices, shading and optima are rejected.
- `packages/scene-engine/scripts/verify/verify-linear-region-math.ts` preserves
  the pure math gate in tracked source. It does not import an eval corpus or
  the separate public compiler gate. Root owns script wiring.

The pure module exports constraint signatures and independently checkable
feasibility, nonnegative combination, objective bound, recession and complete
corner verifiers. A complete solver-result JSON rerun is not the sole region
proof. Source-row identity survives equality expansion. View clipping remains
separate from mathematical corner authority and is owned by root.

## Mathematical obligations

Mixed-strict Fourier–Motzkin elimination carries nonnegative original-row
weights. A positive multiplier from a strict row makes the combined row
strict. Exact lower/upper interval comparisons produce either a rational
witness or a contradiction of the form `0 <= negative` / `0 < 0`.

Corners are intersections of independent original boundaries that satisfy
every weak original constraint. Strict inclusion is recorded separately. The
verifier checks incidence, rank, inclusion, duplicates and completeness over
all boundary pairs. Empty actual regions emit no closure-corner geometry,
even if replacing strict constraints by weak ones would leave a nonempty set.

Objective range is obtained by exact projection, rather than evaluating only
vertices. Finite endpoints have original-row dual bounds and attainable or
closure-only witnesses. Unbounded endpoints require improving recession
directions from a feasible base. This handles strips and affine lines without
vertices, lower-dimensional sets, empty regions and attained open optimal
edges whose closure corners are all excluded.

Two-line systems use exact determinant and augmented-rank comparisons.
Parallel, coincident and unique cases remain distinct even when a nonzero
determinant is far below a floating epsilon.

Capacity limits: 4096-bit reduced rationals; 512-character literals; decimal
exponent magnitude at most 1024; 128 affine tokens and depth 24; 16 region
clauses / at most 32 rows after equality expansion; 512 projected rows; 128
Boolean nodes, depth 24 and 32 interval atoms. Capacity overflow fails
explicitly. At most 496 original-row pairs require corner checks, with
O(m^3) arithmetic including feasibility against every row.

## Validation

```sh
pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-linear-region-math.ts
# Exit 0: 361 pure solution/certificate checks.
pnpm --filter @heytutor/scene-engine typecheck
# Exit 0.
pnpm --filter @heytutor/scene-engine exec eslint src/math/exactRational.ts src/math/linearRegion.ts scripts/verify/verify-linear-region-math.ts
# Exit 0.
```

Independent scratch Python Fraction calculations passed 143 exact checks
before implementation. The tracked TypeScript gate covers:

- The polygon `x>=0,y>=0,2x+3y<=7,x+2y<=4`, including the exact maximum
  `3x+5y=11`, and its strict-boundary supremum variant.
- An attained open optimal edge with no included corners; vertex-free strips
  with finite/unbounded objectives; a constant objective on an affine line;
  an open segment; a singleton; rays; whole plane; strict and weak empty sets;
  exact decimal constraints; and max/min sign symmetry.
- Unique/parallel/coincident systems and a tiny nonzero determinant; interval
  unions, intersections, complements, singleton and empty endpoint cases.
- Wrong/omitted corners, negative contradiction weights, stale objective
  values, incorrectly paired extremum and bound values, unknown/nonlinear
  expressions, getter inputs, forbidden supplied vertices and invalid senses.
- Exact `1/3`, IEEE extremes, ties to even, overflow/underflow refusal and 100
  safe-integer quotient comparisons against native binary64 division.

Development began with a missing-module red, then a first-half-plane green,
then the remaining slices. Display checks found and fixed double rounding of
`1/3`. Invalid public certificate senses first returned true; the red gate
then passed after adding runtime sense checks. Distinct exact corners can
still round to identical doubles, so root adds a separate display separation
gate rather than weakening exact authority.

## Read-only adapter review

Root requested review of its `linearRegionSource.ts` and
`linearRegionGeometry.ts`; this worker made no edits to those files.
Reproductions used newly authored original statements and the public compiler.

The first review exposed dropped unknown/nonlinear terms, negation and prose
domains, omitted objectives, an unsafe trace copying an open endpoint into a
default filled point, and a model-selected sibling corner. A rerun after root
fixes confirmed those candidates fail atomically. The attained strict optimal
edge now re-emits excluded endpoint markers after its optimal face.

A second review reported these additional concrete cases before source freeze:

- `3z+x+y<=3` and `x+y<=3z` were accepted as `x+y<=3`, showing numeric-neighbor
  unknown variables could still be discarded.
- `Maximize x^2+y` and `Maximize x z` were accepted as objective `x` when
  followed by the same valid constraints, showing prefix truncation.
- `(complement of x<0) and x<2` accepted proposed `x>=0`; the correct set is
  `[0,2)`, so the local complement was incorrectly applied to the whole set.
- A [-1,1]^2 view for the vertex-free region `x>=5` or parallel system
  `x=5,x=7` compiled only axes/captions, hiding all required source geometry.
- With names `x,x1`, tuple source `x,x1>=0` became duplicate `x>=0` constraints
  because a domain-extraction regex matched the shorter identifier prefix.

These findings were sent immediately to root, which owns their fixes and
public mutation coverage. A complete prose-domain positive candidate did
compile correctly. Optional non-required sibling point ink was not rendered,
so that variant was not reported as a bypass. This log records review-time
evidence, not a claim that a subsequent root revision retains the defects.

The third read-only pass confirmed the second-round mutations were rejected
after root fixes. It then reported further independently authored variants:

- Undeclared first terms/function prefixes `z+x+y<=3`, `αx+y<=3` and
  `sin x+y<=3` initially accepted `x+y<=3`. The article whitelist also allowed
  `x+a+y<=3` to become `y<=3`, dropping both x and the parameter a.
- `union of (x>0 and x<2) and (x>3 and x<4)` initially became all real points
  because the whole-union cue changed the inner intersection connectives.
  Symbols ∨ and ¬, a postfix prose complement, ∖ difference and ⇒ implication
  initially lost their semantics. Symbolic integer domain `x∈ℤ` was dropped.
- A feasible region view clipped to a line or tangent point was accepted even
  though the actual region had dimension two. A vertex-free finite optimum
  could sit outside the view with no optimal face displayed. Those region
  variants were subsequently rejected during the same pass. The half-plane
  variant x>0 with xMax=0 still emitted a `feasible_segment` on its excluded
  boundary when reported; the guard needed to cover half-planes as well.
- Case-insensitive prose-domain matching followed by case-sensitive variable
  extraction erased `X and Y nonnegative` from a lowercase x,y request.
  Tuple source `x,y>=2+1` accepted only x>=2,y>=3 because the numeric tuple RHS
  regex distributed the prefix2 and left +1 on the final variable.
- Code review showed a strict source boundary x=0 drawn dashed over the solid
  coincident y-axis with the same ink/width; that fills the dashed gaps. No
  image inspection was used for this finding.

Each reproduction was sent to root immediately before the source freeze.
This worker did not edit root source/render files. Root fixed several cases
while the pass was running; the log describes the review-time sequence and
does not certify the final source revision. The pure math gate remains 361
checks and is unaffected by source-adapter revisions.

## Final bounded replay

After root's final fixes, replayed the previously reported concrete failures
and four valid independent source positives. Every adversarial source/view
candidate now fails atomically. Correct prose nonnegativity, nested interval
union, whole complement and inner not-group programs compile. Trace and
required sibling mutations reject; an optional sibling emits no ink.

Direct structural assertions confirm both excluded optimal-face endpoints
are emitted open after the face, and x>0 has a dashed source boundary without
a coincident solid y-axis. The extremely thin strip 0<=x<=1e-20 is refused
by the compiler display-area guard with a null RenderScene. The tracked pure
math gate still passes all 361 checks. No remaining counterexample was found
within this requested final replay; no broad new exploratory pass was run.
No root product files, eval contents or images were touched by this worker.

Primary mathematical reference: [Kevin Cheung's Carleton Fourier–Motzkin
notes](https://people.math.carleton.ca/~kcheung/math/notes/MATH5801/02/2_1_fourier_motzkin.html)
support the standard weak projection/nonnegative-combination argument.
Mixed-strict propagation and the exact witnesses above were independently
derived and checked. No source text was copied into implementation.
