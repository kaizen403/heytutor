# Topic progress and agent completion logs

Tracking snapshot: **2026-10-02-topic-matrix-v1**. This ledger starts with **no newly accepted topic evidence**. Existing engine support is still unknown at topic level, not zero. Historical fractions such as Kinematics **6/14** remain a baseline inventory record; they are not automatically copied into accepted rows.

## Mandatory completion workflow

1. The coordinator reads the [matrix](index.md), freezes the source/exam/evaluation version and assigns exact topic IDs, dependencies and disjoint files. Register the owner and version on those rows in [topic-progress.csv](topic-progress.csv).
2. Each worker maintains a unique `work-logs/<packet>-<assignment-id>.md` using the [work-log template](work-logs/TEMPLATE.md). Record actual changed files, independent expectations, exact commands/results, artifacts and per-topic remaining variants. Write/update this log before reporting an assignment finished, including when blocked or only partially complete.
3. The worker proposes `integration_pending`, `verification_pending` or `blocked`; finishing code or one gate does not authorize acceptance. Keep shared ledger/root-counter edits with the integration owner to prevent concurrent writers from losing each other's updates.
4. The integration owner independently checks the full frozen topic contract and the root plan's shared/render/live/persistence/replay gates. Record the acceptance disposition in the worker log. Audit already-existing support the same way: new implementation is not required when existing code can supply all evidence.
5. After review, update the exact ledger rows and recompute the unique accepted-topic counts for each chapter. Update both the chapter table below and the root queue's **Accepted topics (new audit)** column. A count changes only when the topic states/evidence change, not when a worker finishes or a new operator is named.
6. Report the transition and remaining obligations, for example `6/14 -> 10/14`, or `14/14 accepted` after all fourteen full topic rows qualify. A compound topic with unverified required variants stays partial/pending. Apply the root >90% inventory threshold and lifecycle gates before declaring a chapter complete; accepted topic counts alone are not a release or merge authorization.

## Row contract

`topic-progress.csv` has exactly one record per matrix topic ID, including the separate Biology/Advanced editorial rows and supplemental macros. IDs, primary packets and catalogs must match the source matrices. There are 896 stored rows at different grains; they are not an additive official-topic denominator. The CSV is the authoritative mutable progress ledger; assignment CSVs and allocation percentages remain reference data.

| Field | Required meaning |
| --- | --- |
| `topic_id`, `packet`, `catalog` | Exact stable assignment identity; preserve it when recording work. |
| `state` | `planned`, `auditing`, `implementing`, `integration_pending`, `verification_pending`, `accepted` or `blocked`. Partial work stays in one of the non-accepted states. |
| `owner` | Actual assigned worker or coordinator; initially blank because no implementation assignment has started. |
| `scope_version` | Actual frozen evaluation/source profile with exam/year and declared variants; initially blank. Counts in one acceptance report use one compatible frozen profile, not a mix of incompatible exams/versions. |
| `evidence_ref` | Repository-relative work-log path containing real case, command and artifact evidence; required for accepted rows. |
| `accepted_by`, `accepted_at` | Actual integration reviewer and ISO-8601 acceptance timestamp, not a planned reviewer or date. Required only after acceptance. |
| `remaining_variants` | Outstanding required cases or blockers. An accepted row must say `none` after the full frozen contract passes; initially `topic audit pending`. |

Legitimate text-only decisions need their source/diagram-need evidence and remain separate from diagram-required success. Scope/source-quality exclusions stay visible and are not converted to accepted diagram results. For an exam-specific filtered report, state its approved denominator separately; the full-checklist counts here must not silently drop rows or label another exam's evidence as shared completion.

Supplemental Chemistry macros overlap the CA editorial children. Do not add macro and child accepted counts together. Macro acceptance requires the selected child evidence and explicit resolution of mixed/unlisted aliases. A blocked live/replay item keeps the topic out of `accepted`, even if its offline scene passes.

## Recompute before updating a chapter counter

Join the six assignment CSVs to the ledger by exact topic ID, reject duplicate/missing/unknown IDs or mismatched primary packets/catalogs, and count `state == accepted` only after checking the required evidence fields and the compatible frozen profile. Group by `catalog` and `unit_id`, not by drawing family or by total log entries. Report every non-accepted ID and its remaining obligations. Integer numerators below are unique accepted topic rows; denominators are the unchanged checklist totals. Preserve historical baseline numbers.

Update a ledger row instead of appending a duplicate topic record. Re-running a gate or writing a second log must not count the topic twice. If evidence is invalidated, move its state back to verification/blocked and decrease the live counter. Changed syllabus/taxonomy/profile requires explicit reconciliation, not overwriting old evidence with a new title.

## Core chapter counters

The accepted column starts at zero because no topic audit has been accepted into this new ledger. It does **not** claim the engine has zero capability. Existing supported topics can enter this count once audited. Keep the current unresolved topic list in the logs/ledger; the historical chapter order, priorities and baseline fractions stay fixed.

| Order | Chapter | Historical baseline | Accepted topics (new audit) | Remaining unaudited / unaccepted |
| --- | --- | --- | --- | --- |
| 1 | Kinematics | 6/14 | 0/14 — audit pending | 14 |
| 2 | Current Electricity | 0/17 | 0/17 — audit pending | 17 |
| 3 | Laws of Motion | 0/17 | 0/17 — audit pending | 17 |
| 4 | Work, Energy and Power | 0/16 | 0/16 — audit pending | 16 |
| 5 | Magnetic Effects of Current and Magnetism | 1/23 | 0/23 — audit pending | 23 |
| 6 | Coordinate Geometry | 15/29 | 0/29 — audit pending | 29 |
| 7 | Rotational Motion | 3/17 | 0/17 — audit pending | 17 |
| 8 | Electrostatics | 2/24 | 0/24 — audit pending | 24 |
| 9 | Electromagnetic Induction and Alternating Currents | 6/14 | 0/14 — audit pending | 14 |
| 10 | Optics | 2/27 | 0/27 — audit pending | 27 |
| 11 | Limit, Continuity and Differentiability | 6/18 | 0/18 — audit pending | 18 |
| 12 | Integral Calculus | 0/13 | 0/13 — audit pending | 13 |
| 13 | Differential Equations | 0/8 | 0/8 — audit pending | 8 |
| 14 | Matrices and Determinants | 0/14 | 0/14 — audit pending | 14 |
| 15 | Sequence and Series | 0/10 | 0/10 — audit pending | 10 |
| 16 | Binomial Theorem and its Simple Applications | 0/8 | 0/8 — audit pending | 8 |
| 17 | Permutations and Combinations | 2/9 | 0/9 — audit pending | 9 |
| 18 | Three-Dimensional Geometry | 6/14 | 0/14 — audit pending | 14 |
| 19 | Properties of Solids and Liquids | 5/27 | 0/27 — audit pending | 27 |
| 20 | Thermodynamics | 5/12 | 0/12 — audit pending | 12 |
| 21 | Kinetic Theory of Gases | 0/11 | 0/11 — audit pending | 11 |
| 22 | Dual Nature of Matter and Radiation | 0/8 | 0/8 — audit pending | 8 |
| 23 | Atoms and Nuclei | 0/12 | 0/12 — audit pending | 12 |
| 24 | Electronic Devices | 0/14 | 0/14 — audit pending | 14 |
| 25 | Experimental Skills | 0/33 | 0/33 — audit pending | 33 |
| 26 | Electromagnetic Waves | 0/8 | 0/8 — audit pending | 8 |
| 27 | Oscillations and Waves | 6/21 | 0/21 — audit pending | 21 |
| 28 | Gravitation | 2/14 | 0/14 — audit pending | 14 |
| 29 | Sets, Relations and Functions | 4/10 | 0/10 — audit pending | 10 |
| 30 | Complex Numbers and Quadratic Equations | 7/14 | 0/14 — audit pending | 14 |
| 31 | Vector Algebra | 3/10 | 0/10 — audit pending | 10 |
| 32 | Statistics and Probability | 2/12 | 0/12 — audit pending | 12 |
| 33 | Trigonometry | 1/10 | 0/10 — audit pending | 10 |
| 34 | Units and Measurements | 0/13 | 0/13 — audit pending | 13 |

## Separate additional catalog counters

Each catalog uses its own declared grain. These rows do not add chapters to the core queue or make Chemistry macro/child totals additive.

| Catalog | Chapter / group | Accepted topics (new audit) | Remaining unaudited / unaccepted |
| --- | --- | --- | --- |
| chemistry | Some Basic Concepts in Chemistry | 0/7 — audit pending | 7 |
| chemistry | Atomic Structure | 6/6 | 0 |
| chemistry | Chemical Bonding and Molecular Structure | 7/7 | 0 |
| chemistry | Chemical Thermodynamics | 0/6 — verification pending | 6 |
| chemistry | Solutions | 0/6 — verification pending | 6 |
| chemistry | Equilibrium | 0/8 — audit pending | 8 |
| chemistry | Redox Reactions and Electrochemistry | 0/8 — audit pending | 8 |
| chemistry | Chemical Kinetics | 0/6 — audit pending | 6 |
| chemistry | Classification of Elements and Periodicity in Properties | 0/6 — audit pending | 6 |
| chemistry | p-Block Elements | 0/7 — audit pending | 7 |
| chemistry | d- and f-Block Elements | 0/7 — audit pending | 7 |
| chemistry | Coordination Compounds | 0/6 — audit pending | 6 |
| chemistry | Purification and Characterisation of Organic Compounds | 0/5 — audit pending | 5 |
| chemistry | Some Basic Principles of Organic Chemistry | 0/8 — audit pending | 8 |
| chemistry | Hydrocarbons | 0/7 — audit pending | 7 |
| chemistry | Organic Compounds Containing Halogens | 0/5 — audit pending | 5 |
| chemistry | Organic Compounds Containing Oxygen | 0/8 — audit pending | 8 |
| chemistry | Organic Compounds Containing Nitrogen | 0/6 — audit pending | 6 |
| chemistry | Biomolecules | 0/7 — audit pending | 7 |
| chemistry | Principles Related to Practical Chemistry | 0/6 — audit pending | 6 |
| biology | Diversity in Living World | 0/9 — audit pending | 9 |
| biology | Structural Organisation in Animals and Plants | 0/29 — audit pending | 29 |
| biology | Cell Structure and Function | 0/20 — audit pending | 20 |
| biology | Plant Physiology | 0/19 — audit pending | 19 |
| biology | Human Physiology | 0/35 — audit pending | 35 |
| biology | Reproduction | 0/19 — audit pending | 19 |
| biology | Genetics and Evolution | 0/27 — audit pending | 27 |
| biology | Biology and Human Welfare | 0/10 — audit pending | 10 |
| biology | Biotechnology and Its Applications | 0/8 — audit pending | 8 |
| biology | Ecology and Environment | 0/13 — audit pending | 13 |
| advanced-extra | States Of Matter | 0/7 — audit pending | 7 |
| advanced-extra | Solid State | 0/5 — audit pending | 5 |
| advanced-extra | Surface Chemistry | 0/4 — audit pending | 4 |
| advanced-extra | Hydrogen S Block | 0/9 — audit pending | 9 |
| advanced-extra | Metallurgy | 0/5 — audit pending | 5 |
| advanced-extra | Environmental Chemistry | 0/3 — audit pending | 3 |
| advanced-extra | Polymers Everyday | 0/8 — audit pending | 8 |
| supplemental | Linear Programming | 0/1 — audit pending | 1 |
| supplemental | Mathematical Induction | 0/1 — audit pending | 1 |
| supplemental | Mathematical Reasoning | 0/1 — audit pending | 1 |
| supplemental | Communication Systems | 0/1 — audit pending | 1 |
| supplemental | States of Matter | 0/1 — audit pending | 1 |
| supplemental | Solid State | 0/1 — audit pending | 1 |
| supplemental | Surface Chemistry | 0/1 — audit pending | 1 |
| supplemental | Hydrogen | 0/1 — audit pending | 1 |
| supplemental | s-Block Elements | 0/1 — audit pending | 1 |
| supplemental | General Principles and Processes of Isolation of Metals | 0/1 — audit pending | 1 |
| supplemental | Environmental Chemistry | 0/1 — audit pending | 1 |
| supplemental | Polymers | 0/1 — audit pending | 1 |
| supplemental | Chemistry in Everyday Life | 0/1 — audit pending | 1 |

## Work-log index

Accepted counts below are unchanged. Allocation is not acceptance.

| Log | Owner | Scope version | Disposition | Accepted-count change |
| --- | --- | --- | --- | --- |
| [integrator-ch06-ch10-s0.md](work-logs/integrator-ch06-ch10-s0.md) | integration owner | 2026-10-02-topic-matrix-v1 | S0 frozen for chapters 6–10. CH-07b/07c, CH-09a/09b/09c and CH-10c blocked on named unaccepted prerequisites. CH-06a, CH-07a and CH-08a assigned and not yet accepted. | none; chapters 6–10 remain 0 accepted |
| [integrator-ch11-ch25-handoff.md](work-logs/integrator-ch11-ch25-handoff.md) | integration owner | 2026-10-02-topic-matrix-v1 | S0 profile extended to chapters 11–25. CH-14a is submitted and `verification_pending`. Slot 3 stays with CH-14a; the submission does not free it or authorize CH-15a. Slots 1 and 2 are free and unassigned. HEY-85 has no approved packet. CH-18 stays with HEY-84 and is blocked on S3. | none; chapters 11–25 remain 0 accepted |
| [CH-08a-2026-10-03.md](work-logs/CH-08a-2026-10-03.md) | integration owner | 2026-10-02-topic-matrix-v1 | Seven dipole operators compile and the 983-check gate passed. Rows are `verification_pending`. Live reveal, saved-turn persistence, and saved-turn replay were not run. | none; Electrostatics remains 0/24 |
| [CH-06a-2026-10-03.md](work-logs/CH-06a-2026-10-03.md) | integration owner | 2026-10-02-topic-matrix-v1 | Nine line operators compile and the 553-check gate passed. Rows are `verification_pending`. Live reveal, saved-turn persistence, and saved-turn replay were not run. | none; Coordinate Geometry remains 0/29 |
| [CH-07a-2026-10-03.md](work-logs/CH-07a-2026-10-03.md) | integration owner | 2026-10-02-topic-matrix-v1 | Five rigid-mass operators compile and the 186-check gate passed. Rows are `verification_pending`. Live reveal, saved-turn persistence, and saved-turn replay were not run. | none; Rotational Motion remains 0/17 |
| [CH-14a-HEY-84.md](work-logs/CH-14a-HEY-84.md) | integration owner | 2026-10-02-topic-matrix-v1 | Five matrix operators compile and the 9,218-check gate passed. Rows are `verification_pending`. Live reveal, saved-turn persistence, and saved-turn replay were not run. Slot 3 stays with CH-14a. CH-15a is not authorized. | none; Matrices and Determinants remains 0/14 |
| [C-05-solutions-20261006.md](work-logs/C-05-solutions-20261006.md) | chemistry lane | 2026-10-02-topic-matrix-v1 | Six solution rows compile and have saved reopened replays. Rows are `verification_pending`. Lecture audio was not tested. Henry's law is counted only on chemistry\|5. | none; Solutions remains 0/6 |

Packet logs are added here only after the worker writes them. The template is not evidence.
