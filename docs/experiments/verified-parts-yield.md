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


## Review follow-up — 18 October 2026

**Keep the flag off pending coordinator review. The previous zero-wrong claim
is withdrawn.** Independent review and fresh blind judgments find surviving
label-placement errors. A partial figure is not counted as safe when a visible
label identifies the wrong element.

The branch normally merges Fireworks main `7afb99772`, its gate-runner update
`2f62b94b5`, and current pinned main `614a3afaa`. Coordinator merge commits are
retained. Main verification commands remain in order; feature gates live in
`gates.d/figure-truth-182.txt`. The final replayed source is
`3867431c4b25575a3e037f19a5ffefb9d11ef6e6`, against main
`614a3afaa47c0ca889f20400544d0201329a2ba8`. The final diagnostic fix restores
main-shaped default-off errors, including one generic error per output;
richer per-label classification remains flag-only. Fresh replay confirms exact
default-off diagnostics, admission, winner and rendering across all 1,795 rows
(4,220 lab candidates, 108 YouTube candidates and seven production candidates).
Flag-on results match the fully judged `25bdd43e` source; no figure changed.


Review fixes:

- Angle claims use the engine's 0.5-degree tolerance (including the stated
  37-degree, 3–4–5 convention); large contradictions remain fatal.
- Lens-face curvature is relative to an explicit facing or the lens body.
  Default arcs are checked for actual contradictions. Missing proof alone does
  not establish a false curvature sign.
- Removed timeline actions memoize their surviving predecessors. A 36-level
  dependency graph is gated; cycles still fail.
- Answer staging also inspects compiler-generated labels such as a computed
  coordinate distance. Early focus cannot reveal those answer values.
- Explicit medium quantity IDs take precedence over symbol matching. Shared
  symbols cannot bind unrelated quantities to both interfaces.
- A conservative label-owner check omits optional labels that are much closer
  to another stroke, including ambiguous line leaders starting inside another
  body. Reveal groups do not separate the shared canvas. A bare numeric summary
  must identify its owner; a named equation can stand independently. It is not
  a complete attachment proof; some wrong figures remain.
- Optical-train rays must meet the aperture of a uniquely bound drawn lens.
  Missing bodies do not establish an aperture claim.
- Plain quantity identifiers such as `u`, `v₀` and relative-velocity aliases
  are accepted by construction; attachment and repair checks still apply. Equations and numeric labels still require
  the existing proof; the identifier grammar does not normalize superscripts
  into digits or accept arithmetic expressions.
- Production admission reuses the final verified-parts compile. Label search
  avoids work only when it cannot affect the chosen placements or diagnostics.
  Camera scoring prepares invariant constraints once and formats a diagnostic
  only when that constraint becomes the worst score. Single-label dimension
  feasibility uses the same constraints without selecting a final placement.

### Completed blind replay

| Set | Rows | Main: empty / right / partial / wrong | Flag on |
| --- | ---: | --- | --- |
| baseline964 | 964 | 224 / 183 / 499 / 58 | 278 / 182 / 492 / 12 |
| other-strict | 780 | 257 / 102 / 358 / 63 | 317 / 101 / 353 / 9 |
| youtube | 42 | 18 / 4 / 19 / 1 | 18 / 10 / 14 / 0 |
| production | 3 | 3 / 0 / 0 / 0 | 3 / 0 / 0 / 0 |
| Total | 1,789 | 502 / 289 / 876 / 122 | 616 / 293 / 859 / 21 |

All rows are graded. Wrong does not rise in any set, but **21 wrong figures remain**.
This comparison uses the fresh main replay and current paired judgments; its
122 main wrongs supersede neither the historical 99-row ledger nor that older
baseline. Empties rise by 114, so the yield objective is not achieved. The two
lab sets each lose one right figure net. Across individual pairs, 25 formerly
right rows become partial (13) or empty (12), despite the aggregate right count
rising by four through gains elsewhere.

Four pairs move from partial to wrong: a velocity graph, a toroid hole label,
a bar-magnet field sketch and a glass-slab depth mark. Keep these grades; do not
claim no newly wrong figures. The graph's criticized ink is unchanged except
for an omitted label, and the magnet's field strokes are unchanged. The slab
retains the same world geometry but is enlarged by layout recovery. These three
pairs show judgment variation or newly apparent existing errors. The toroid
actually selects a different candidate with a misplaced `hole` label. That
selection regression remains unresolved and blocks enabling the flag.

Of main's 122 wrong rows, 60 become empty, 35 partial and 10 right; 17 stay wrong,
joined by the four partial-to-wrong pairs. Remaining errors include label
ownership, clipped or misleading text, graph/field geometry, circuit topology
and energy spacing. The generic checks reduce these failures but do not prove
all requested relationships. The original zero-wrong and no-right-loss launch
bars are not met.

The review contributes 599 unique fresh blind cards, including three separate
launch-label candidates. Unchanged figures reuse only matching question/render
fingerprints with recorded provenance. Per-row grades, all 21 wrongs, all 25
right losses and the four changed-grade pairs are retained in private evidence.

### Validation and timing

Engine yield and 14 launch gates, camera and quantity-symbol gates, tutor yield
and answer-reveal gates, and all 13 repair-pipeline scenarios pass. Drawing,
engine and core builds and tutor typecheck pass. The follow-up records 38 actual
implementation mutation kills, separately from the historical launch mutations.
No broad full-suite pass is claimed: known chemistry-routing and board-restoration
failures remain disclosed.

Performance preserves exact output and search budgets. The ink gate checks 191
scenes, 328,808 measured boxes and 3,993 frozen golden records. Whole-placement
and whole-compile comparisons cover synthetic and recorded cases, including
failures. The final 1,094-candidate timing clears the ink cache before each policy
arm and records one cold-ink and two warm calls; this is not a fresh process.
No competing agent replay/build ran during the sample. Timing was captured at
`25bdd43e`, before the final off-only diagnostic compatibility change.

| Policy | Cold p50 / p99 / max (ms) | Cold cases >50 ms | Warm maximum (ms) |
| --- | --- | ---: | ---: |
| off | 2.48 / 39.64 / 52.60 | 3 | 38.49 |
| verified_parts | 1.97 / 45.44 / 64.84 | 7 | 42.32 |

**The strict cold maximum below 50 ms is not achieved.** The comparable initial
flag-on sample had a 248.3 ms maximum and 152 cases over 50 ms. This is a large
reduction, not a passed requirement. A separate deliberately stalled search
fixture also remains over 50 ms. Further obstacle-hoisting and route-selection
prototypes gave neutral or mixed benefits and are not shipped. Keep the flag off
pending remaining truth and latency work.

### Recording providers and replay method

All baseline lab (964) and strict lab (780) records identify Azure deployment
`st-gpt-6-sol-h4`. YouTube client records say `server`; their run notes identify
Azure `st-gpt-6-sol`. Production scene observations identify Azure `gpt-6-sol`.
Production now uses Fireworks/Kimi K3. These deterministic engine replays of
historical Azure documents are valid engine comparisons, not Fireworks planner
measurements.

The denominator remains 1,789 headline rows: 1,744 lab, 42 YouTube tries and
three production traces. All 48 YouTube records and 108 candidates are replayed;
six records outside the counted turn set are audited separately. Changed pairs
use anonymous questions, rubrics and PNGs. Only one subagent views images at a
time; the parent never views them. Exact question/primitive fingerprints are
required to reuse an unchanged judgment across arms.

An initial 32-card batch in this follow-up was discarded in full after literal
label evidence was found to belong to other cards. Fresh judgments are written
before the next image opens and include literal observed labels and the PNG
SHA-256; hashes and label inventories are checked before aggregation. Discarded
judgments do not contribute to the table. One later literal-label mismatch was
freshly rechecked and remained partial; its original and corrected evidence are
retained. Equal geometry can receive different grades after a label or framing
change, so aggregate improvements do not establish causal correctness for every
row.

### Launch-label handoff

The three recorded candidates no longer fail construction because a plain
quantity symbol is rejected. The `v₀` candidate also passes full repair replay
and retains `v₀`. Both `u` candidates compile standalone, but attachment recovery
omits the requested lower-velocity label and the operator still displays its
`launch` role word. Both full repairs remain refused for losing required
geometry. Thus the parser fix is complete, while recovery of those two requested
`u` figures is not. These refused repairs are not counted as recovered figures
in the headline table. All three standalone candidates are independently
blind-graded partial, with no wrong figure among these three; this does not
override repair refusal.

### Original 99 cause accounting

The historical 99 wrong rows retain their original judgments and cause ledger:
wrong angle 15; optical path 14; medium side 11; panel transform 9; distractor
association 8; representation substitution 8; annotation semantics 6; curvature
binding 6; direction/sense 6; source geometry relation 5; energy spacing 4;
circuit topology 2; curve parameter 2; solid anchor 2; probability topology 1.
The earlier mapping assigned 65 new implementations, two upstream direction
corrections from #196, and 32 adjudication-only changes. Adjudication changes
are not code repairs. The old zero-wrong disposition is superseded by this
review; it must not be used for launch approval.

### Stock numbers and next coverage work

[PR #201](https://github.com/kaizen403/heytutor/pull/201) isolates the archetype
stock-number and photoelectric unit/source-binding fixes from this default-off
experiment. Its validation is reported on that PR; its changes are not included
in the 1,789-row yield replay.

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

Spend is **$0**. Only normal main-to-feature merges; no merge into main, production change or paid rerun. Live evaluation still
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
