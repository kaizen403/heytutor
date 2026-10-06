# Integrator handoff: chapters 11–25 / HEY-84 and HEY-85

Reviewer: this session, Cursor `b10f1489-5216-4a2d-9b0a-9b2ca6f2de33`, acting as global integration owner because Kaizen assigned HEY-84 and HEY-85 here. Date: 2026-10-03. This file is the approval record. It accepts no topic row.

Relay this path to HEY-83, HEY-84 and HEY-85:

`/Users/kaizen/heytutor/docs/plans/diagram-topic-matrix/work-logs/integrator-ch11-ch25-handoff.md`

Execution authority is the main checkout `/Users/kaizen/heytutor`. Do not replace it from the Drive snapshot or from an isolated worktree.

## Role

This session accepts global integration ownership for the chapter 11–25 workers, including shared compiler, document, capability and planner edits, ledger acceptance and chapter counters. HEY-83, HEY-84 and HEY-85 do not grant those. HEY-83’s audit is read-only and does not own chapter 6. The separate `heytutor#83` pull request is chapters 1–5 and is outside this handoff. Chapter 6 remains with the already assigned CH-06a/CH-06b/CH-06c work in this checkout.

CH-18 is exclusively HEY-84. HEY-85 does not implement any `maths|11|…` row.

## Accepted S0 profile

Profile id: `2026-10-02-topic-matrix-v1`.

| Item | Frozen value |
| --- | --- |
| Exams | JEE Main 2026 Paper 1, JEE Advanced 2026, NEET-UG 2026, using each row’s own J/A/N tag. Mathematics is `not_applicable` for NEET. |
| Taxonomy | `data/question-bank/syllabus-taxonomy.json`, SHA-256 `2d2a65ff89f4ce6aae9016c3a607dfb3d1f06a259a2313d1cf47db07a51a7510` |
| Maths assignments | `docs/plans/diagram-topic-matrix/maths.csv`, SHA-256 `0e9313cd53509d5a589c06bb7ede26031ab96632155c3b36f16219da58330464` |
| Physics assignments | `docs/plans/diagram-topic-matrix/physics.csv`, SHA-256 `03ce28161fe86e04450748a658cd38e431572d0ad7b31cfaa5c6f75104fbeac5` |
| Obligations | The exact topic IDs, scope tags, required variants and independent checks in those CSVs. Supplemental and application tags stay as written. |
| Base revision | `eec2d36b151cf4950c9fcfadd7840f53b26415ec` |

This extends the same profile from chapters 6–10 to chapters 11–25. It is not a new syllabus and it does not accept a topic.

Not frozen, and therefore not something a worker may invent:

- No bank-question cohort and no pre-listed holdout question IDs.
- `required` / `conditional` / `text_only` stay planning hypotheses. A worker may not mark a row text-only to avoid a diagram.
- Passing `verify-calculus-operators.ts` (225), `verify-space-derivation-operators.ts` (399), `verify-vector-operators.ts` (171), `verify-affine-operators.ts` (112), `verify-combinatorics-operators.ts`, elasticity, fluid, thermodynamics or instrument-label gates is baseline reuse only.

### Seams that are not accepted

| Seam | Status | Consequence |
| --- | --- | --- |
| S1 typed circuit/contact topology | not accepted | No packet that lists S1 may start. |
| S2 domains, piecewise curves and bounded numeric authority | not accepted. `calculusGeometry.ts` at `eec2d36` is a read-only seed. | CH-11a and every later calculus, thermal-plot or kinetics packet that lists S2 stays blocked. |
| S3 world frames and orientation | not accepted. `spaceDerivations.ts` and `vectorGeometry.ts` at `eec2d36` are read-only seeds. | CH-18a stays blocked even though it is reserved to HEY-84. |
| S5 measurements and observed data | not accepted | CH-19a, CH-19d, CH-23b and CH-25 stay blocked. |

No chapter 1–10 packet is accepted, so a dependency on CH-02a, CH-03a, CH-06a, CH-06c, CH-07b, CH-10a, CH-10b, CH-19b, CH-20a, CH-22a, CH-23a, CH-24a, CH-27a, CH-27b or CH-34 is also unaccepted.

## Writing budget

The cap is one integration owner and three concurrent writing workers. Slots 1 and 2 are free after review and are not assigned. Slot 3 stays with CH-14a after its submission review. Neither HEY-84 nor HEY-85 may create another writer or fill an unnamed slot.

| Slot | Packet | Files now in main | Release state |
| --- | --- | --- | --- |
| 1 | CH-06a, child `c08504b2-02e6-450c-bb76-7635de839479` | `analyticLineGeometry.ts`, `verify-ch06a-line-operators.ts`, `work-logs/CH-06a-2026-10-03.md`. Shared dispatch is in. Nine rows are `verification_pending`. | Review finished. The child does not keep this slot. Not accepted. No replacement packet is named. |
| 2 | CH-07a, child `16e49e27-3102-4bbf-b2a3-7662512d6054` | `rigidMassGeometry.ts`, `verify-ch07a-mass-operators.ts`, `work-logs/CH-07a-2026-10-03.md`. Shared dispatch is in. Five rows are `verification_pending`. | Review finished. The child does not keep this slot. Not accepted. No replacement packet is named. |
| 3 | CH-14a, HEY-84 | `matrixArrayGeometry.ts`, `verify-matrix-array-operators.ts`, `work-logs/CH-14a-HEY-84.md`. Shared dispatch is in. Three rows are `verification_pending`. | Still allocated to CH-14a. Submission and this review do not free the slot and do not authorize CH-15a. Not accepted. |

SLOT RELEASED remains the earlier permission for HEY-84 to write CH-14a only. That release is not renewed and is not transferred. Slots 1 and 2 are not released to any packet. HEY-85 has no released slot. CH-15a stays queued.

## Approved packet

**CH-14a was the approved write for HEY-84.** The submission is now in main and `verification_pending`. Slot 3 stays with this packet. Do not start another packet.

It is the earliest chapter 11–18 packet whose only dependency is S0. CH-11a is earlier in the queue and is not approved, because accepted S2 is missing. CH-15a, CH-16a and CH-17a also need only S0; they are queued and not approved.

Exact topic IDs:

- `maths|3|matrices-and-types` — Main listed, Advanced listed, NEET not applicable. Rectangular, square, row, column, zero, identity and diagonal matrices; explicit dimensions and entries; Advanced real entries. Reject a rectangular inverse and a mislabeled diagonal.
- `maths|3|matrix-algebra` — Main listed, Advanced listed, NEET not applicable. Scalar multiplication, addition, rectangular products, and a witness that AB need not equal BA. Reject incompatible dimensions.
- `maths|3|transpose-symmetric-and-skew-symmetric` — Main application, Advanced listed, NEET not applicable. Rectangular transpose; real symmetric and skew-symmetric matrices; a nonzero skew-symmetric diagonal rejects.

Bounds for this packet only: real finite entries, each absolute value at most 1e6, each dimension from 1 through 6, at most 36 entries. No complex entries. `affine_point` / `affine_path` are not this algebra and must not be edited or reused as the implementation.

The files below were the allowed write. They are copied into main. Do not add another runtime file under this slot:

- `packages/scene-engine/src/compile/matrixArrayGeometry.ts`
- `packages/scene-engine/scripts/verify/verify-matrix-array-operators.ts`
- `docs/plans/diagram-topic-matrix/work-logs/CH-14a-HEY-84.md`

Work in `/Users/kaizen/.capy/worktrees/jam_01M3Z0VA51QDZZD3E341V3VP3Q/heytutor`. Do not edit main’s shared files. Prerequisite code version: none beyond the style of existing geometry modules at `eec2d36`. Read `circleGeometry.ts` as style only.

## HEY-85: no packet approved

CH-23a is not approved. Missing prerequisites are accepted S2 and accepted S3. The reproduced Balmer n=2→1 figure, the discarded n=3→2 emission, the sorted n=2→3 absorption, and the declined Rutherford apparatus are recorded in HEY-85’s log and independently reproduced. They are a shared-synthesis defect, not accepted coverage and not permission to start the packet.

These shared paths stay with this owner:

- `packages/scene-engine/src/synthesize/familyScene.ts`
- `packages/scene-engine/src/archetypes/detect.ts`
- `packages/scene-engine/src/compile/compiler.ts`
- `packages/scene-engine/src/document/validation.ts`
- `packages/scene-engine/src/capability/**`
- `packages/tutor-core/src/planners/**`

HEY-85 must not add `verify-ch23a-hey85.ts` or any other runtime file until a later handoff names an approved packet. No such packet is named here.

### Named blockers for chapters 19–25

| Packet | Missing prerequisite |
| --- | --- |
| CH-19a | accepted S2, S3 and S5 |
| CH-19b | accepted S1 and CH-03a |
| CH-19c | accepted CH-19b |
| CH-19d | accepted S2 and S5 |
| CH-20a | accepted S1 |
| CH-20b | accepted S2 and CH-20a |
| CH-20c | accepted S1, S2, CH-20a and CH-20b |
| CH-21a | accepted S2, S3, CH-20a and CH-20b |
| CH-21b | accepted CH-20a |
| CH-21c | accepted S2 and CH-21a |
| CH-22a | accepted S1, S2 and S5 |
| CH-22b | accepted S2 and CH-22a |
| CH-22c | accepted S2, S3 and CH-22b |
| CH-23a | accepted S2 and S3; shared Bohr fallback remains owner-owned |
| CH-23b | accepted S2 and S5 |
| CH-23c | accepted S2, S5, CH-23a and CH-23b |
| CH-24a | accepted S1, S2 and CH-02a |
| CH-24b | accepted S1, S2, S5, CH-24a and CH-02a |
| CH-24c | accepted S1 |
| CH-25a | accepted S1, S5, CH-34a, CH-34b, CH-34c, CH-07b and CH-19a |
| CH-25b | accepted S1, S2, S5, CH-27a, CH-27b, CH-19b, CH-19c and CH-19d |
| CH-25c | accepted S1, S2, S5, CH-02a, CH-02b, CH-02c, CH-05c, CH-10a, CH-10b, CH-24a, CH-24b and CH-24c |

### Named blockers for the rest of chapters 11–18

| Packet | Owner | Missing prerequisite |
| --- | --- | --- |
| CH-11a, CH-11b, CH-11c | HEY-84 | accepted S2; 11b also needs CH-11a; 11c also needs CH-11b |
| CH-12a, CH-12b | HEY-84 | accepted S2 and CH-11b; 12b also needs CH-12a and CH-06c |
| CH-13a, CH-13b, CH-13c | HEY-84 | accepted S2 and CH-12a; later slices also need the previous CH-13 slice |
| CH-14b | HEY-84 | accepted CH-14a and CH-06a |
| CH-14c | HEY-84 | accepted S3, CH-14a, CH-14b and CH-18c for plane drawings |
| CH-15a | HEY-84 | S0 is enough, but this packet is not the approved write |
| CH-15b, CH-15c | HEY-84 | accepted CH-15a |
| CH-16a | HEY-84 | S0 is enough, but this packet is not the approved write |
| CH-16b | HEY-84 | accepted CH-16a and CH-17a |
| CH-17a | HEY-84 | S0 is enough, but this packet is not the approved write |
| CH-17b | HEY-84 | accepted CH-17a |
| CH-18a, CH-18b, CH-18c | HEY-84 only | accepted S3; 18b also needs CH-18a; 18c also needs CH-18a and CH-18b |

## Submission and acceptance

1. A worker writes only its allowed files in its own worktree, then fills its own log from `TEMPLATE.md`. Proposed states are `integration_pending`, `verification_pending` or `blocked`. The worker does not write `accepted`, does not edit `topic-progress.csv`, `progress.md`, the root plan, or the Drive bundle, and does not commit.
2. The log must include the exact command output, changed files, positive, edge, invalid, mutation and holdout cases, and unresolved variants. Offline checks do not close render, live reveal, persistence or replay.
3. Kaizen relays the worktree paths here. This owner copies approved files into main and integrates shared seams one packet at a time.
4. This owner alone, after that review, may set `accepted`, recompute unique accepted IDs, and update `progress.md` plus the root plan’s live column. Historical baselines stay unchanged.
5. Drive and the shared manifest are updated only after an accepted batch. This handoff is not that batch.

Accepted counts for chapters 11–25 remain 0. Allocation percentages and baseline gates are not coverage.
