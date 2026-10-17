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

## Free replay results

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
**not met**. Keep the PR draft and the flag off pending coordinator review.

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

## Validation

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
