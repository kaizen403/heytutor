# SHADED REGIONS — measured operator result

11 October 2026. Harness 3. **Both repeats pass the requested gate: right rises and wrong does not, separately under A, B and consensus. Required visual coverage regresses substantially.** The single PR is a draft for coordinator review of that tradeoff; no merge or production change occurred. No accepted syllabus-topic counts change.

## Result and coverage cost

All 40 original rows are required maths visuals. All 160 outcomes remain in the denominator, including required empties. Every outcome was classified maths and ran strict; there were zero run errors. “Right” means the complete figure rubric, including required ink and labels, rather than mathematical admission alone.

| Repeat | Build | Required rows | Drawn | Right | Partial | Wrong | Required empty |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | Main | 40 | 39 | 1 | 22 | 16 | 1 |
| 1 | Candidate | 40 | 13 | 4 | 9 | 0 | 27 |
| 2 | Main | 40 | 39 | 0 | 23 | 16 | 1 |
| 2 | Candidate | 40 | 15 | 5 | 10 | 0 | 25 |

This is a small gain in complete figures with a large decline in coverage: candidate correct-required rates are 4/40 and 5/40, and empty rates are 27/40 and 25/40. Of main's 16 wrong figures, 14 become empty in repeat 1 and 12 become empty in repeat 2. Main's sole right figure in repeat 1 also becomes empty. A lower wrong count must not be described as universal coverage or proof that every refusal was necessary.

Both independent first judges pass each repeat without pooling:

| Judge | Repeat | Right main→candidate | Wrong main→candidate | Gate |
| --- | ---: | --- | --- | --- |
| A | 1 | 1→4 | 16→0 | Pass |
| B | 1 | 1→4 | 16→0 | Pass |
| A | 2 | 0→5 | 15→0 | Pass |
| B | 2 | 0→5 | 15→1 | Pass |
| Consensus | 1 | 1→4 | 16→0 | Pass |
| Consensus | 2 | 0→5 | 16→0 | Pass |

B's repeat-2 newly wrong row is `sys08-distinct-vertical`: the judge identifies an unexplained dashed diagonal mark beside otherwise correct vertical lines and missing axis labels. A and C grade that same card partial, so consensus is partial. The recorded selected document uses existing axes/point/line constructions, has `family:null`, and is `qualitative_verified`; it uses none of the new operators. This minority wrong verdict remains in the evidence and B's gate. Root did not inspect the image or override the verdict.

## Family breakdown and operator use

Each family has 10 required rows. Cells are right / partial / wrong / required empty, using frozen consensus grades.

| Family | Repeat 1 main | Repeat 1 candidate | Repeat 2 main | Repeat 2 candidate |
| --- | --- | --- | --- | --- |
| Number lines | 1 / 4 / 5 / 0 | 3 / 1 / 0 / 6 | 0 / 4 / 6 / 0 | 3 / 1 / 0 / 6 |
| Half-planes | 0 / 5 / 5 / 0 | 1 / 0 / 0 / 9 | 0 / 5 / 5 / 0 | 0 / 0 / 0 / 10 |
| Feasible regions/objectives | 0 / 4 / 6 / 0 | 0 / 0 / 0 / 10 | 0 / 5 / 5 / 0 | 2 / 1 / 0 / 7 |
| Two-line systems | 0 / 9 / 0 / 1 | 0 / 8 / 0 / 2 | 0 / 9 / 0 / 1 | 0 / 8 / 0 / 2 |

Selected candidate documents use `number_line_set` four times in each repeat, `linear_half_plane` once then zero times, and `linear_feasible_region` zero then three times. No selected paid document uses `linear_system`; eight committed documents in each repeat use existing generic constructions. Main uses none of the new operators. Deterministic development evidence supports all four operators, but these paid outcomes establish limited planner adoption, especially for systems and half-planes. Feasible-region results swing from all 10 empty to three drawn across repeats, making sampling variation visible.

Topic asks (20 per arm) have right 1→1 and 0→1, wrong 8→0 in both repeats, and required empty 0→15 then 0→13. Exam stems (20 per arm) have right 0→3 and 0→4, wrong 8→0 in both repeats, and required empty 1→12 in both. The aggregate right gain does not repeat within every question style or family.

Candidate empties comprise 26 `candidates_invalid` plus one `fallback_suppressed` in repeat 1, and 23 plus two in repeat 2. Every invalid candidate row records `invalid_linear_region`; `linear_source_mismatch` co-occurs on 25/26 and 22/23 rows. Suppression records `solver_contradiction`. No empty row records explicit `plannerDeclined` or `declinedUnreadable`. These are recorded admission diagnostics, not independent judgments that all rejected plans were mathematically wrong. Detailed issue messages were not retained in these run records, so an exact source-mismatch cause histogram is unavailable. The stored terminal “representation carries no readable label” text is a fallback diagnostic, not sufficient root-cause evidence. The operator source gate and planner's source/program representation remain an important integration limitation. There was no held-out repair or retry.

## What is implemented and proved

Four shared operators produce one engine-owned `linear_region` composite from original affine expressions:

- `number_line_set`: exact real-set union, intersection and complement; open/closed endpoints, rays, singleton, empty and all-real sets.
- `linear_half_plane`: the source inequality determines shaded side and weak solid/strict dashed boundaries.
- `linear_feasible_region`: exact feasibility, all closure corners with inclusion, each corner's objective value, recession behavior, attained optimum versus unattained finite limit or unbounded objective. Artificial viewport corners are never mathematical vertices.
- `linear_system`: exact unique intersection, distinct parallel lines or coincident equations, preserving both source labels.

Reduced BigInt rationals, affine parsing, Fourier–Motzkin/Farkas certificates, intersection proofs and objective/recession witnesses supply mathematical authority. The compiler binds the full Boolean source program, constraints, explicit domain and objective/direction. Forged proof/results, wrong shading/corners, omitted givens and model-authored marks or annotations fail atomically. Unsupported nonlinear/integer/conditional or unbound prose scope declines. Source recognition is a bounded grammar independent of topics or questions.

Engine geometry owns clipped fill, strict boundaries, corners, exact labels, objective values and reveal order. Open endpoints mask the underlying line in live Konva; artificial clipping edges have no stroke. Measured label boxes, clearance and separation gates reject unreadable scenes. Distant vertical boundaries can make the automatic view too narrow for attached captions; this known conservative layout refusal was found in calibration development and preserved without held-out tuning.

## Frozen experiment and judging

The independent eval was authored and frozen **before implementation**, at `2026-10-11T00:47:53Z`: 40 unique rows, 10 per family, 20 topic asks and 20 exam stems, with `must_show`, `must_label`, `must_not_show` and subject-derived answers. It covers CBSE inequalities/LPP and SAT-style inequalities/systems. Current CBSE Class 11 two-variable inequality scope is formative assessment; the author log records that distinction. The tracked [eval JSONL](../../../../data/diagram-eval/v1/linear-regions-heldout-20261011.jsonl) is byte-identical to the original freeze; development gates use independent numbers.

Pinned main `216450fcf7e5a88d41341a9e79871e1b9d198c72` was compared with candidate `4ea55cc136aa6449b31f2e93760c2946850f2d0c`. Source, builds, environment hashes, example library, rubric and helpers froze before the first call. Fixed order: main r1 → candidate r1 → candidate r2 → main r2. Both private builds used actual production maths strict, the existing subject/strategy decisions, 4000 ms live example picker, unchanged 60000 ms scene limit and identical 212 allowed existing examples. Jev replay was parked. No runtime or example change followed a held-out call.

Native Chrome captured the complete diagram zone. Exact full rubric plus exact PNG bytes gave 98 unique cards, while all 160 original outcomes remained. Fresh source-naive A/B/C each graded all 98 cards, one image followed immediately by one appended first grade. Calibration scores and arm identities stayed hidden until all three first streams and consensus froze. A/B agreed on 95 cards; C resolved three conflicts; there were no three-way verdict conflicts and zero grade recoveries. Consensus omissions use the selected winning first grade, rather than a union of annotations. Root image views: **zero**.

Each judge was 24/24 consistent with the frozen synthetic calibration references (eight right, eight partial, eight wrong; six per family). This measures synthetic reference consistency, **not human accuracy**. Failed v1–v3 calibration compilation attempts remain ungraded and archived; the original 24 mathematical contracts/gold were unchanged. Complete v4 used equivalent affine notation and one common explicit planar window, was normally compiled and independently rationally checked before images, and froze before judging. Partial references remove annotations after normal admission; wrong references compile alternate legitimate source mathematics against the original rubric. These synthetic variants are not admitted product candidates. One unbounded-objective exhibit combines two normally compiled panels. No score selected/replaced a judge or changed a grade.

Main advanced during measurement to `d9ff5b4a` through another owner's chemistry PR #136. The measured pair remains unchanged. A read-only merge-tree check against that main is conflict-free; this is not a rerun against the new chemistry build. The report commit changes evidence/docs only.

## Validation and practical limits

Passed: 361 exact-kernel checks, 4,015 public compiler checks, 143 independent Python Fraction comparisons, eight sub-agent-only native Chrome development figure inspections, full drawing/whiteboard verify suites and the new live presentation gate. Public negative tests change shade side, corner identity/completeness, objectives, source Boolean meaning and semantic group annotations. Final private candidate passed five dependency builds and 13 nonpaid controls; main passed its five builds and eight controls. Root typecheck and lint each passed 12/12 tasks; sequential full build passed 7/7.

Four broader script failures reproduce on the measured main: `verify-archetype-pictures` has three physics/chemistry subject mismatches; `verify-geometric-optics-operators` rejects lens anchors with `invalid_display_metric_assertion`; tutor-core `verify-scene-capabilities` expects `energy_level` rather than `chem_orbital` for a photoelectric probe; tutor `verify-draft-board-url` fails the unsaved-home-board API assertion. Therefore the full verification chains are not claimed green. No unrelated repair was folded in. Evidence is figure-only model judging; this does not establish full-lecture quality, persistence/replay behavior, human accuracy or accepted syllabus coverage.

The final report audit reran exactly those four failed scripts on clean pinned main `216450fc`, reproduced all four, and saved `nonpaid/final-baseline-*.log` plus `FINAL-BASELINE-FAILURE-RECEIPT.json`. These nonpaid checks neither reran held-out rows nor changed runtime or images.

## Spend, cleanup and handoff

The user explicitly removed the brief's $30 cap. Fresh, exclusively attributable Azure deltas are 4,225,995 prompt and 850,848 generated tokens. At frozen $2/M input and $10/M output, pricing cached input as uncached, the conservative token estimate is **$16.96047**. Known response usage is **$14.512332**, incomplete across **89 accounting entries spanning 77 unique trace IDs**. The **$21.364592** unresolved allowance is exposure, not a measured charge. Response usage and deployment estimates describe the same calls and are not added. This is not an invoice; native agent/CLI billing is unexposed and unmeasured. Prior physics spend is excluded.

Eight stable fresh baseline observations and eight stable settlement observations, followed by two agreeing observations, underpin attribution. There are zero in-flight/reserved calls or missing checkpoints. The root-owned controller, private servers on 3530/3533 and metrics watcher ended. Cleanup signalled no other owner's processes and left H4's port 3600/deployment untouched. A separate read-only worker rechecked 243 assets, 25 helpers, private build locks, all four 40-row ledgers and spend arithmetic.

After unblinding, that worker independently reconstructed all frozen aggregate fields, paired transitions, omissions, newly-wrong occurrences and six gate cells; joined all 160 run records; and verified all 98 grade-card identities. It rechecked 1,618 main and 1,625 candidate locked files plus tracked-clean private heads. The audit used metadata only, without images, revalidation, model calls or grade/source changes.

[Harness 4's generic example list](H3R6-linear-region-examples-for-H4-20261011.md) was handed over without eval numbers: Boolean number-line sets, strict/weak signed half-planes, rational LPP corners/costs, multiple optima, finite/unbounded/unattained/infeasible cases, and unique/parallel/coincident systems. H4 owns library edits; none enter this experiment. Requests were checked through #42; prior 3D/Argand diagnoses remain parked with the physics work.

#125 and #124 are closed with report comments. Physics lessons: narrowing prompt instructions sometimes reduced geometry omissions while exposing direction, topology, polarity or dimension errors; narration-only facts did not supply missing ink. Fresh drawn counts changed 35→31 in one repeat and 33→40 in the next, exceeding apparent prompt effects. Frozen all-row blind judgments showed no unit passing the complete gate, so that work remains parked. See [the negative consolidation report](HARNESS-3-PHYSICS-CONSOLIDATION-20261011.md).

## Evidence identities

[Portable results, all-row outcomes and original first/consensus grades](../../../../data/diagram-eval/v1/reports/linear-regions-20261011/provenance.json) retain original digests and document path-only transformations. Raw calls, image bytes, receipts and private build artifacts remain in `.context/h3r6/shaded-regions/`.

| Artifact | SHA256 |
| --- | --- |
| Eval40 | `7dd247caaa637b076fe32998b831b759d28d15315932843f35a9b92a3f6ebe4f` |
| Preregistration | `c790e856596409f3ebc56b51281cea18f95203bd80f159f605ff32f59ce3916f` |
| Original aggregate results | `0f7eeb21260139c853c4acdd99b601cd90345bd8c48a54bb2a47be26b494ce24` |
| Final first A | `56eb169238c0e51d67b0794c290030f35f6edd342ce4e4cda55a529ae830937f` |
| Final first B | `cf47776cb8f4e560155bc45a0e94f5c54cc9c600ba51eb7799841eebcf038ade` |
| Final first C | `42dd15c0d5f4f7ccd880277c892c7c96af0ce85c99446551dbdee9324ecf015d` |
| Consensus grades | `c171e3b7eded278115de0c713f3eacd680fa99be0ac6b31258d8f83f3ad36081` |
| Financial/control audit | `188054c9982a401cc17cd926d4eadd2e2cc93d5cb6525b88f074b939da028b2c` |
| Independent post-unblind results audit | `ce90f276f131cba181345e3f896597031c6d4a8ce95789c316e3888f723eb467` |

Implementation details and worker-owned evidence: [integration](H3R6-linear-region-integration-20261011.md), [exact maths](H3R6-linear-region-math-20261011.md), [public/visual gates](H3R6-linear-region-public-gates-20261011.md), [independent eval authorship](H3R6-shaded-eval40-independent-20261011.md).
