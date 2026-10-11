# H3R8 source completion and independent safety review

Date: 11 October 2026. Owner: `r8_safety_review`. Scope: uncommitted source
recovery, linear scalar selection, production selection, and Cartesian frame
changes against `e248b38`. No topic ledger or accepted count changes.

The review did not read the fresh held-out packet, evaluation questions, grades,
or images. It made no model calls, server calls, commits, or PRs.

## Initial concrete failures

- `The lines x+y=6 and x-y=2 meet at P. Graph both lines. Mark Q=(1,1) and find the x-coordinate of Q.`
  initially certified `x=4` and `x_P=4` as scalar authority although the requested
  point has `Q.x=1`. Square, twice, negative, and unit suffix variations also
  escaped the original query check. Reported to the solver binding owner; that
  owner's query target fix passed its 63-check gate in this review.
- `Graph x+y<=8, excluding P=(1,1).` initially built and compiled a whole source
  document that marked the excluded point as included.
- `Graph x+y<=8 and plot x+2.` initially built and compiled only the half-plane.
  The affine expression without a comparison disappeared during lexical flush.
  `plot z` also escaped because the unknown standalone symbol never entered the
  math chunk.
- `The lines x+y=6 and x-y=2 meet at P. Find x squared.` initially built a source
  system while discarding the unsupported requested transformation.
- Production selection with `problemIR:null` and a derived `Z=999` admitted the
  original question `Maximize Z=3x+2y subject to x>=0,y>=0,x+y<=8 and x<=5. Show the feasible region and all corners.`
  as `linear_source`, with no save failure. The independent maximum is 21 at
  `(5,3)`: `3*5+2*3=21`. An initial review message incorrectly said 31; the native
  agreement owner caught that arithmetic error before adding the acceptance
  gate. The `999` admission failure is unchanged.
- The first native guard accepted planned `Z=0` for
  `Maximize Z=1e-16*x subject to x>=0,y>=0,x+y<=1. Show the feasible region.`
  Its unit-sized tolerance floor admitted the incorrect zero. The worker removed
  that floor, preserved exact zero/sign checks, and refused numerical underflow
  or nonfinite display projections. The original RED observation is in the tool
  transcript, not a separately saved receipt.
- The first native guard also accepted a correct `Z=21` alongside stale
  requested `x=999,y=999` for the same bounded LP with `Find x and y.` The worker
  now requires an explicitly requested unique attained optimal point for native
  LP coordinate roles; an optimal edge or an unattained limit cannot prove them.
- A strict `Maximize Z=x` with `x<1` initially authorized planned `Z=1` although
  its exact result is an unattained supremum. The integration owner required an
  attained extremum for a planned maximum/minimum scalar.
- The native guard's original alias-only scope ignored a finite requested
  unknown `Z=999` for the unlabeled `Maximize 3x+2y` source, or `maximum=999` for
  its labeled counterpart. The integration owner accepted this blocker and
  assigned a fail-closed check for finite derived unknown IDs lacking a proved
  native role, while retaining the existing audit for unrelated intermediates.
- A requested system answer spelled `xP` or `x(P)` with value `999` also bypassed
  the canonical-symbol-only native check. The same valid source and requested
  ID using `answer` or `perimeter` bypassed it too. The final native check requires
  both the declared unknown and its finite derived result to preserve one proved
  original-source coordinate role; it does not guess an alias from notation.

## Assigned source completion fix

The assigned implementation changes are `src/compile/linearRegionSource.ts`,
`src/compile/linearSourcePoints.ts`, and the new
`scripts/verify/verify-linear-source-completion.ts`.
The source reader now refuses unsupported exclusions and unconsumed mathematics,
including unknown standalone plot symbols. Bounded coordinate and literal
number-line membership requests remain admissible. Requested transformations
or unit suffixes cannot disappear as prose. Proven source point labels remain
available as point references.

The shared pure intersection-name reader now also binds a named intersection
tuple to the exact unique system result at normal compilation. A contradictory
tuple or nonunique pair refuses; an equal named tuple and unrelated reference
points remain admissible. The initial conflicting `P` example failed its new
gate before this fix and passed as an atomic refusal afterward.
The same contract covers `point P`, `the point P`, crossing, and explicit
intersection-point descriptions. Phrase capitalization now preserves the
captured label's spelling: the `Meet at P` contradiction failed its new gate
before the case fix, then refused in both builder and raw normal compilation.

The exclusion, omitted `plot x+2`, unknown `plot z`, and `Find x squared`
regressions each failed before the respective fix and passed afterward. RED
assertion failures and GREEN results are present in this review's tool transcript.

## Verification

- `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-linear-source-completion.ts`: 72 checks passed.
- `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-linear-source-equivalence.ts`: 95 cases passed.
- `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-linear-source-points.ts`: 41 checks passed.
- `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-linear-composite-contract.ts`: 189 checks passed after the final source changes.
- `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-linear-solver-binding.ts`: 64 checks passed after the final source and query changes.
- `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-linear-source-plan.ts`: 264 native agreement checks passed after the final requested-role changes.
- `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-cartesian-reveal-frame.ts`: 343 checks passed, including the root's explicit two-frame extension.
- `pnpm --filter @heytutor/scene-engine typecheck`: passed after the final source changes.
- `git diff --check`: passed.
- Root rebuilt `@heytutor/scene-engine` and ran the production integration gate:
  `apps/tutor/scripts/verify/verify-linear-source-representation.ts`: 134 checks
  passed. This review inspected its count receipt at
  `.context/h3r8/finish-regions/live-source-final-binding.log`; the preceding
  built-package requested-role RED receipt is
  `.context/h3r8/finish-regions/live-requested-role-red.log`.

The integration owner owns stored source replay, package rebuilds, production
gates, and the final acceptance decision. These synthetic checks do not increase
coverage counts or certify the held-out packet.

## Final independent review

The concrete native scalar failures above now refuse. Direct final probes kept
correct `x_P=3,y_P=8.5` for the existing exact-coordinates source, `x=4,y=2` for a
bounded pair variable request, and ordinary coordinate-plane setup prose.
The initial native tuple grammar had rejected those positive forms; its final
native-only tuple/variable semantics preserve them while the solver scalar
selector still refuses a tuple request's set-to-scalar cast.

Native agreement preserves the original plan and checks exact source roles.
It refuses stale objective or coordinate values, wrong/unsupported units,
unattained maximum/minimum scalars, nonunique optimal coordinates, and finite
requested unknown IDs whose declared/result roles cannot be proved. Unrelated
intermediates and givens remain under their existing audit. These are bounded
source roles, not a claim of authority over arbitrary English requests.

The final source selection policy preserves the shared qualitative tier rule,
recompiles a fresh original document, and retains raw candidate refusals. The
native fatal-conflict check runs before fallbacks; the direct source builder
throws on a conflict. Shared save admission repeats that check for caller-supplied
fast representations and persistence. An explicit upstream solver contradiction
still blocks the final production commit. The reviewed Cartesian change keeps
one implicit axes frame registered across reveal groups while multiple axes
retain explicit construction ownership. No remaining blocker was found within
these reviewed contracts. The rebuilt app gate's 134-check GREEN receipt closes
the integration evidence for selection, direct fallback, fast representation,
and shared save admission. The integration owner owns final acceptance.

The additional named source relation concern was fixed at the root's request:
`The lines x+y=6 and x-y=2 meet at P. P=(1,1). Graph both lines and mark P.`
now refuses in both the source builder and raw normal compilation. No scalar
selection or planner role binding is needed to enforce that source conflict.
