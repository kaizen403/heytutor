# Coordination request to Cursor b10f1489 / HEY-83, HEY-84, HEY-85

Prepared 2026-10-02 by HEY-83. This is a handoff request, not an accepted contract or authorization for another writer. No shared runtime, central ledger, counters or Drive files were edited by this handoff.

## Identified coordinator

Kaizen identified Cursor session `b10f1489-5216-4a2d-9b0a-9b2ca6f2de33` as the chapters 6–10 owner. Read-only inspection of its local transcript confirms the original 111-topic assignment, its S0 log, the shared-integration reservation and three child assignments. The original prompt says integration owner **for this batch** and excludes expansion into other chapters; it does not itself approve extending the source/seam contract to chapters 11–25.

Transcript: `~/.cursor/projects/Users-kaizen-heytutor/agent-transcripts/b10f1489-5216-4a2d-9b0a-9b2ca6f2de33/b10f1489-5216-4a2d-9b0a-9b2ca6f2de33.jsonl`.

| Packet | Cursor child | Allowed source / gate / log |
| --- | --- | --- |
| CH-06a | c08504b2-02e6-450c-bb76-7635de839479 | `compile/analyticLineGeometry.ts`; `verify/verify-ch06a-line-operators.ts`; `work-logs/CH-06a-2026-10-03.md` |
| CH-07a | 16e49e27-3102-4bbf-b2a3-7662512d6054 | `compile/rigidMassGeometry.ts`; `verify/verify-ch07a-mass-operators.ts`; `work-logs/CH-07a-2026-10-03.md` |
| CH-08a | d4c99678-23fc-4616-9b43-50eeb04641a7 | `compile/dipoleFieldGeometry.ts`; `verify/verify-ch08a-dipole-operators.ts`; `work-logs/CH-08a-2026-10-03.md` |

Source/gate paths are under `packages/scene-engine/src/` and `packages/scene-engine/scripts/`; logs are under `docs/plans/diagram-topic-matrix/`. Each child prompt names `/Users/kaizen/heytutor` with disjoint writes. Current running state, freed slots and completed delivery are not established by a recorded assignment.

At 19:42 UTC, analytic-line source and dipole source/gate existed; the rigid-mass source, CH-06a/CH-07a gates and all three worker logs were absent. At 19:43 UTC HEY-83 independently reran `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-ch08a-dipole-operators.ts`: **983 checks passed**, with the module/gate SHA-256 values unchanged during the run. This is positive offline packet evidence, not full topic acceptance. The central ledger still has zero accepted rows.

## Subordinate handoffs awaiting your agreement

- **HEY-84, chapters 11–18:** proposed CH-14a, the three exact IDs `maths|3|matrices-and-types`, `maths|3|matrix-algebra`, `maths|3|transpose-symmetric-and-skew-symmetric`. Proposed new paths: `packages/scene-engine/src/compile/matrixArrayGeometry.ts`, `packages/scene-engine/scripts/verify/verify-matrix-array-operators.ts`, and its own packet log. No shared registration or additional writing agent is approved. Read its log at `/Users/kaizen/.capy/worktrees/jam_01M3Z0VA51QDZZD3E341V3VP3Q/heytutor/docs/plans/diagram-topic-matrix/work-logs/CH-14a-HEY-84.md`.
- **HEY-85, chapters 18–25:** proposed bounded CH-23a hydrogen-level/transition audit, with only its own logs and a proposed dedicated `scripts/verify/verify-ch23a-hey85.ts` gate until a source/path contract is approved. Its 117 Physics rows, 22-packet dependency graph and 14 reserved CH-18 Maths IDs are recorded in `/Users/kaizen/.capy/worktrees/jam_01M3Z10WD1WZKTPRNE3PN2KEFK/heytutor/docs/plans/diagram-topic-matrix/work-logs/CH-18-25-handoff-HEY-85.md`. The dedicated diagnosis/proposal is `CH-23a-HEY-85.md` beside it.
- HEY-84 and HEY-85 have coordinated their CH-18 boundary. Neither reports starting implementation workers or editing shared runtime/central files. Their baseline checks are not topic acceptance.

## Confirmed blockers for integration review

HEY-83's independent 111-topic audit is `audit-CH06-CH10-HEY83-20261002.md` beside this request. Its frozen row totals are 21 implementing, 39 blocked, 51 planned, zero accepted. Twelve existing-operator baseline gates passed. The unfinished distributed-fields gate fails at its near-axis wire fixture; provenance of unrelated concurrent main changes must not be attributed to these three workers without evidence.

HEY-85 and HEY-83 independently reproduced the CH-23a problem: Balmer, hydrogen emission 3→2 and absorption 2→3 all return a fixed 2→1 figure tagged `qualitative_verified`; the representation fallback repeats it. `buildEnergyLevel` calls fixed `bohrLevelDocument`, and `detectArchetype` uses max/min levels, losing absorption direction. Rutherford apparatus declines both family and fallback. No shared fix was attempted. HEY-83's current-main reproduction is `~/.capy/work/diagram-topic-matrix/audits/ch23a-independent-reproduction.json`.

## Response needed from the coordinator

1. Confirm whether you accept the global integration role outside the original 6–10 batch. If not, name the owner who may approve the extension.
2. Record the approved source/exam/evaluation version and concrete S0/S2/S3/S5 contracts for each selected subordinate slice. An existing module or a version label alone is not an accepted contract.
3. State the current total writer budget and actual worker state. Do not admit an additional writer merely because another session has reached its final message; queued/live children must be accounted for.
4. Approve exact packet IDs, disjoint allowed files and worktrees, or name the blocker. Keep shared compiler/document/capability/planner integration, source-attestation/render/live/replay acceptance, central counters and Drive synchronization with one owner.
5. Resolve any chapter-6 ownership ambiguity before another batch writes it. This HEY-83 thread has produced planning documents and read-only audits, not a CH-06 implementation; the separate `heytutor#83` PR from HEY-80 concerns chapters 1–5. A bare “83 / 0–6” reference must not create duplicate CH-06 ownership.

Write your response to a uniquely owned log in main and tell Kaizen which file to relay to HEY-83, HEY-84 and HEY-85. Until then, the subordinate proposals remain blocked. No commit, push, PR, merge or acceptance is requested by this handoff.
