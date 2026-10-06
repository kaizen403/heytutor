# Wave 2 point-line source program — integration owner

Base: PR91 merge `dcb9be95403e5ec19da1b3c1f6f87c2b0ae9d523`; owned branch
`cov/w2-integration-20261006`. Chemistry excluded. Protected dirty main untouched.
No READY or accepted-count change; student/lifecycle checks remain unrun.

The source program reads one complete coordinate point and one linear equation,
then reuses `point`, `line_equation`, `project`, and `point_line_distance` in world
coordinates. It carries the source point, infinite line, foot, and connector in
required/reveal groups; zero distance is a point rather than a fictitious segment.
Full IR facts, entities, constraints and requested results must bind; unsupported
or additional obligations decline. Given coordinates/coefficients bind by role,
value and exact quoted source evidence rather than matching scalar membership.
Requested numeric results are independently recomputed from the source. The
source program reports availability through the existing capability seam.

Analytic validation and source lineage can resolve composed infinite lines,
with a bounded acyclic producer graph. Finite substitutes and different parallel
lines decline. Point/foot coordinate captions are checked through label
descendants and annotations. A removed projection producer cannot bless a false
literal foot. Normalized-line comparison keeps distant intercepts from enlarging
slope tolerance; only binary64-scale comparison is allowed. Direct compile now
runs point-line and section source checks before any render output.

Offline Node24 checks in the owned tree:

- New `verify-w2-point-line.ts`: five composed-line controls, five independently
  specified source cores, full-IR normal family admission, and eight negative
  controls pass. Cases include general, slope, vertical and point-slope forms,
  and distance zero. See external `integration/w2-point-line-program8.log`.
- Unchanged `verify-point-line-ready.ts`: five cases, 19 controls, 113 checks pass
  after direct source compile registration; no student claim from that gate.
- Engine typecheck passed before the final small compile registration; repeat
  on the integrated head. `git diff --check` passed before this log addition.
- `verify-parallel-point-line-topic.ts` did not run: it requires the private
  frozen checklist directory. The missing-argument failure is not coverage proof.

Remaining: fresh independent review, numeric source authority/live-plan joins,
source quantity admission with actual IR, normal student pixel/narration/WRITE
inspection and authenticated save/restart/reopen/whole replay. Arbitrary foot
names/result spellings, duplicate statements, fractional caption notation,
multibody/3D/parameter/intersection/two-point definitions and native holdouts
remain outside this bounded program. Strict declines are availability limits.

Independent review at `a8a1e9c6` requested changes: incomplete request consumption,
changed source literals inside a scale tolerance, and underflow to zero. The
integration owner fixed these: whole-request grammar shares the source literal
spans; given coordinates match exactly; proportional numeric coefficients use
exact dyadic cross products; polynomial evaluation retains bounded exact
rationals until supported decimal conversion. Lost coordinate/coefficient digits,
nonterminating source conversions and underflow decline explicitly. Derived
caption comparisons scale each component separately, never by the other axis.
New regression controls cover all three exact review reproductions, unreadable
extra bodies/requirements, tiny nonzero coefficients, cancellation, and supported
terminating fractions/whitespace. `w2-point-line-reviewfix5.log` passes these and
all existing new controls. Final compile/source-question equality and the
integrated head still require fresh review, checks and actual student lifecycle.
