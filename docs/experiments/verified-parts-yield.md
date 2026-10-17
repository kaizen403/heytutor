# Verified parts yield experiment

`DIAGRAM_YIELD_POLICY=verified_parts` enables a default-off experiment in scene
admission. An unprovable optional label can otherwise discard an entire verified
path or vector diagram. This policy removes only localized proof-failed text,
records the original diagnostic, and recompiles the remaining document through
normal admission and persistence checks. It does not certify an incomplete scene
as a complete answer.

## Authority and behavior

- Explicit numeric contradictions remain fatal, including contradictions hidden
  behind missing units or another tuple component. Unknown diagnostics remain
  blocking. No geometry, quantities, assertions, or required entities are deleted.
- Supported demotions are entity labels, optional label/callout/badge annotations,
  unresolved optional annotation geometry, and unambiguous label-layout failures.
  Unproved positional answer points stay blocked. A missing-unit point label is
  eligible only when its scalar already agrees with evaluated geometry.
- Repair candidates retain the original seed's core geometry and requested named
  points through repair chains and revalidation. Other initial lanes also protect
  typed motion paths, including lanes that settle after a repair.
- Circular candidates can bind by source-proven geometry and values instead of
  exact identifiers. The certificate is recomputed on compilation and saving;
  arbitrary metadata grants no authority. Nonuniform motion is not certified by
  the uniform-motion proof.
- Only explicit, unambiguous trajectory aliases and unit spellings normalize.
  Conflicting fields and undeclared units are not guessed. Even analytic-curve
  sample counts can increase by one without changing formula or domain.
- Answer-label metadata is presentation-only. It grants no numeric authority.
  `source.answerLabelEntityIds` and `source.answerLabelAnnotationIds` mark values
  for delayed reveal. `VerifiedDeferredAnnotation.revealAfterLesson` prevents
  early FOCUS from revealing them; normal completion releases them. This ensures
  labels wait until teaching finishes, but does not prove narration derived each
  value. Unnamed numeric labels are conservatively delayed when answers exist.

The flag propagates from the server's billed-turn response and the lecture lab.
Existing independently compiled fallback paths retain their current boundary.
Model-supplied policy, audit and answer-marker metadata is stripped.
An admitted document records `source.diagramYieldPolicy` so persistence uses the
same compiler policy. `CompileOptions.yieldPolicy` explicitly overrides that
marker; off admission removes it. The marker enables additional validation and
placement rules, never bypasses source, numeric, geometry or save guards.

The launch hardening also runs under this flag. It checks explicit angle,
curvature, medium, optical path, named-operation, vector and contact-geometry
claims. Cross-component assertions and Cartesian axes retain a common world
transform. Optical incident paths stop at a declared refracting face, an empty
focus does not bend light, and diode symbols meet their cathodes. Label ownership
is preserved for secants, crossing endpoints and interval callouts. Semicircular
paths must traverse one monotonic half-turn; projectile paths cannot continue
below their uniquely declared terrain. These are reusable relation checks, not
question-ID exceptions or topic routing.


## Launch truth replay — 17 October 2026

**Ready for coordinator review, default off.** On the fixed main baseline
`e219b61ca32ca1eff8dbc2e44e191d35e09a3927`, observed wrong falls **80 → 0** and
right rises **282 → 299**. Right does not fall in any set. This is a static
recorded-candidate result, not a live-launch certification.

| Set | Rows | Pinned main: empty / right / partial / wrong | Flag on |
| --- | ---: | --- | --- |
| YouTube counted tries | 42 | 18 / 1 / 22 / 1 | 24 / 1 / 17 / 0 |
| Baseline lab | 964 | 261 / 177 / 488 / 38 | 292 / 187 / 485 / 0 |
| Additional strict lab | 780 | 272 / 104 / 363 / 41 | 308 / 111 / 361 / 0 |
| Production traces | 3 | 3 / 0 / 0 / 0 | 3 / 0 / 0 / 0 |
| **Total** | **1,789** | **554 / 282 / 873 / 80** | **627 / 299 / 863 / 0** |

The truth checks trade yield for refusal: empties rise **554 → 627** (+73).
Of 80 current-main wrong rows, 51 become empty, 19 partial and 10 right.
Two empty rows and seven partial rows become right. Twelve empty rows recover
(two right, ten partial), while 32 partial rows and two right rows are rejected.
No new wrong row is observed; no row remains ungraded.

The paired audit retains **two right → empty regressions**, despite the increase
in right totals. The glass-to-air refraction row (`refraction-at-surfaces|h9b`)
has medium placement requests opposite its constructed ray halfspaces. The
vector-components row (`vector-components|h11a`) binds θ to 315° while its
constructed mark takes the short 45° sweep. The new guards reject those candidate
contradictions. Their previous rendered images were judged right; that judgment
is retained. No claim of preserving every previously right row is made. These
are follow-up candidates for deterministic placement/sweep repair, not grounds
to weaken truth checks or revise the judge's grade.

### Original 99 cause accounting

All 99 original wrong rows retain their original grade and cause in the evidence
ledger. Counts: wrong angle 15; optical path 14; medium side 11; panel transform 9;
distractor association 8; representation substitution 8; annotation semantics 6;
curvature binding 6; direction/sense 6; source geometry relation 5; energy spacing
4; circuit topology 2; curve parameter 2; solid anchor 2; probability topology 1.
Each row names the check that should catch the defect and its actual disposition.
The mapping contains 65 new implementation assignments, two upstream direction
corrections from PR #196, and 32 adjudication-only rows. The latter are not code
fixes: valid but incomplete schematics were accepted on fresh blind review.
Final outcomes for the original 99 are **45 empty / 27 right / 27 partial / 0 wrong**.

Historical totals were 554 empty / 258 right / 878 partial / 99 wrong. Fresh
review of the same original 99 images found 59 wrong, 31 partial and nine right;
that is grading disagreement, not improvement. The full pinned-main denominator
above includes upstream changes and fresh paired judgments. Do not describe
99 → 0 as 99 code repairs.

### Method, gates and evidence

All 1,744 lab rows, 108 recorded YouTube candidates (42 counted lesson rows), and
three production traces were replayed offline. Network fetch is disabled in the
harness. Flag-off admission/winner/full render scenes match pinned main for all
1,744 lab rows and all 108 YouTube candidates; production output also matches.
The complete flag-on pass used `340a6b2e2`; subsequent changes were applied with
exhaustive impact scans: four possible analytic-semicircle rows and 26 possible
candidate-ranking rows were rerun and merged by exact path. Timeline dependency
repair affected no recorded candidate; prompt-only answer filtering changes no
static primitive. Final product code is `4e1066b39801a634fb2a340a09dd3b93d02c0cdc`.

Changed figures and both sides of changed pairs use fresh anonymous image
judgments, one subagent image judge at a time; the parent inspected no images.
Unchanged rows reuse grades only on exact question and rendered-primitive
fingerprints, inheriting the earlier SVG/image provenance below. Equal images
receive equal grades across arms. The final pass judged 148 unique cards plus
six controls, after the 119-card baseline and 51-card intermediate passes.
Four of six final controls agreed with the earlier judge; disagreements were
applied consistently to matching images on both sides. These are model-judge
consistency checks, not human accuracy measurements or a universal zero-error
claim.

Four engine yield gates, 14 launch truth gates and two tutor yield gates pass,
as do the 13 repair scenarios and focused derived-label, direction and persistence
regressions. Final engine/tutor typechecks, engine build and engine lint pass
(zero errors, four existing warnings); core build/typecheck passed earlier.
**65/65 actual yield/launch implementation mutations are killed.** Independent
standards and specification reviews found and closed policy containment,
terrain traversal, semicircle sampling, timeline ordering, answer-prompt leakage,
callout placement and candidate-quality gaps. Full-suite chemistry-routing and
board-restoration failures were reproduced on the earlier unchanged baseline;
no full-suite pass is claimed.

Workspace evidence is in `.context/figure-yield/`: `launch-final-grade-totals.json`,
`launch-final-row-grades-private.json`, `launch-final-paired-audit.json`,
`launch-final-original99-ledger.json`, `launch-wrong-causes.{json,md}`,
`launch-cause-coverage.{json,md}`, `launch-close-manifest.json`,
`launch-close-evidence-audit.md`, blind queues/judgments, mutation proofs and
`launch-close-*.log`. The raw recorded inputs remain local and are not committed.

### Stock numbers and next coverage work

[PR #201](https://github.com/kaizen403/heytutor/pull/201) isolates the archetype
stock-number and photoelectric unit/source-binding fixes from this default-off
experiment. Its validation is reported on that PR; its changes are not included
in the 1,789-row table above.

The original **554 empty + 878 partial** rows are classified once each (1,432
rows, none unassigned). Ranked counts: missing required construction 645;
downstream admission/readability 168; attachment/clipping/visibility 144; wrong
operator inputs 140; missing labels 85; numeric/source proof 71; explicit
text-only decline 70; geometry/physics proof 48; required row voted no figure 33;
no replayable candidate 18; rubric/representation mismatch 5; document
dependencies 5. `planner-mistake-ranking.{md,json}` retains two examples per class,
all partial judge evidence and fix ownership. H4 owns requested-construction and
label examples; H1 measures effort and numeric authority; this lane owns
unambiguous normalization/admission; H3 owns layout. Only `principal_rays` was
reported as an unsupported operator (39 empty rows, 194 attempt diagnostics);
first check whether existing optical composition suffices. These counts do not
increase accepted topic totals.

Spend is **$0**. No merge, production change or paid rerun. Live evaluation still
requires coordinator approval and the $10 cap. The static replay limitations
below continue to apply, including incomplete historical ProblemIR/repair-seed
context, first-admitted YouTube selection and no narrated-frame validation.

## Earlier yield-only replay results

Replay baseline: main `a0a029cbfdfd4948ee982a303670eb558e062de2`.
These are static replays of recorded planner candidates, not new lessons.

| Set | Rows | Before: empty / right / partial / wrong | Flag on |
| --- | ---: | --- | --- |
| YouTube counted tries | 42 | 18 / 0 / 23 / 1 | 16 / 0 / 25 / 1 |
| Baseline lab | 964 | 261 / 166 / 488 / 49 | 258 / 167 / 491 / 48 |
| Additional strict lab | 780 | 272 / 92 / 367 / 49 | 268 / 93 / 370 / 49 |
| Production traces | 3 | 3 / 0 / 0 / 0 | 3 / 0 / 0 / 0 |
| Total | 1,789 | 554 / 258 / 878 / 99 | 545 / 260 / 886 / 98 |

Every row is accounted for; no ungraded rows remain. All 1,744 lab rows are
marked figure-required. Wrong does not rise in any set. Empties fall by only nine
net rows (1.6% of prior empties), so the requested “empties fall a lot” bar is
**not met**. At that earlier checkpoint the PR stayed draft pending coordinator review.

The 18 YouTube empties split into 2 proof-only, 2 structural-only, 13 mixed, and
1 with no planner output. Five recover partial figures; three previously
admitted repairs now fail because they discarded required geometry. Seven lab
empties recover (two right, five partial). The old wrong toroid becomes an
incomplete/unclear partial; the existing YouTube impact-angle error remains.

All admitted YouTube candidates and all changed lab renderings were judged
anonymously by a subagent. To finish full-set counts, 963 lab rows were eligible
for historical-grade reuse only after exact complete SVG equality, verification
of the original graded card's PNG SHA256, and equivalent question text. Text
normalization was limited to explicit mathematical spelling changes (minus,
dash, superscripts, pi, multiplication and numeric square roots). This does not
transplant historical aggregate counts onto new renders. Remaining coverage
required 247 additional unique blind images, beyond the 27 changed lab images
and 31 admitted YouTube images already graded. One final projectile rendering
changed after the gate audit retained a correct label; it was freshly judged
partial. Equal render fingerprints share grades across arms.

Judges agreed with 33/40 reference anchors for the first YouTube pass, 5/8 for
the changed-lab pass, and 7/12 for the full-set completion pass. These measure
consistency with prior model judgments, not human accuracy. Historical cards
used the original board-zone crops; fresh images used complete static SVGs.
The totals therefore combine recorded and fresh blind judgments with explicit
provenance, rather than claiming one fresh human-calibrated panel.

Final reruns of both flag states completed without lab exceptions. Flag-off
admissions and rendered primitives are unchanged across all 1,744 lab rows and
all YouTube candidates. Compared with the pre-audit flag-on run, lab admissions
and primitives are unchanged; one YouTube candidate retained a correct label.

Replay limitations: historical lab rows lack exact chosen repair seeds and full
ProblemIR context. Lab replay reconstructs missing plan claim wording and checks
cross-lane path retention, but cannot certify original-seed survivorship. Strict
selection uses `ProblemIR=null`; existing solver contradiction status is retained
where recorded. YouTube replay uses each request's authoritative plan and exact
repair seed, but selects the first admitted recorded candidate rather than
reconstructing timing. Static renders include final labels, not narrated reveal
frames. Historical quality grades cannot be transferred to changed replay
outputs. Some YouTube rubric numerals predate reworded questions; judges use the
actual recorded question.

## Earlier yield-only validation

Focused engine and tutor yield gates, 13 planner repair scenarios, derived-label
regressions, package builds, and engine/core/tutor typechecks pass. Lint has zero
errors (14 existing warnings). Eighteen implementation mutations make their
associated gates fail, covering demotion, truth exclusion, numeric/unit checks,
unresolved optional annotation isolation, answer staging, normalization, circular
proof, repair preservation and early FOCUS leakage. The final audit added regressions for circular angle/renderer
agreement, conflicting nested circular units, preservation of correct sibling
labels, and answer-annotation intro narration. Each bug was reproduced before
its fix; the corresponding implementation mutation is killed by assertions.

Full engine/core/tutor verification was attempted. Existing chemistry-routing
expectations fail in the engine archetype and core planner suites; the tutor
suite stops at the unsaved-home-board restoration expectation. Each failure was
reproduced against the unchanged baseline snapshot. These full suites are not
reported as passing.

No paid model/audio calls, merges, or production changes are part of this free
result. A live rerun requires coordinator approval and a hard $10 cap. Keep the
flag off pending review and stronger evidence.
