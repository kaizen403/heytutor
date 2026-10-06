# Numeric text-only persistence / w3-numeric-text-persistence-20261006

Implemented a bounded numeric-only save/read repair. The complete captured signed count31 IR and Plan now survive normal text-only canonicalization, JSON storage serialization and stored-turn normalization with independently recomputed solver authority. Declined inputs save the teaching lesson without carrying authoritative IR, Solver, audit or a reduced Plan.

## Assignment and pins

- Worker: this numeric-persistence session; integration owner: the parent live-authority session. Proposed disposition: **integration_pending**; independent integration acceptance remains with the owner.
- Worktree: `/Users/kaizen/heytutor-cov-wt/w3-numeric-text-persistence-20261006`.
- Branch: `cov/w3-numeric-text-persistence-20261006`.
- Fixed parent: `/Users/kaizen/heytutor-cov-wt/w3-live-authority-20261006`, commit `cb6669044c50d9f59b69b6df316dafea86fa6d1c`. No later parent arithmetic or reviewer changes were incorporated.
- Read AGENTS, coverage plan, matrix index/progress/readiness and session ownership. Applied git workflow, test-driven development, incremental implementation and code review/quality skills.
- Scope: `apps/tutor/lib/scene/{turnScenePersistence,storedSceneSource,numericOnlyAuthority}.ts`, new dedicated app gate/runner/typecheck configuration and fixtures, this committed worklog. Generated reports/logs are outside the worktree in coordination storage.
- Engine, tutor-core, teaching arithmetic, live caller, source-refusal reviewer logic, replay hooks, existing gates/fixtures, ledger, READY files, remotes and protected worktrees are unchanged.

## Reproduction and capture provenance

User-supplied actual evidence: `runtime/run2026-10-06T1143-w2-5e191cee` timed out at wall `120022` ms without READY/lifecycle qualification; read-only own-PG forensics found HTTP200, a text-only row, and `scene_artifacts NULL` despite the authoritative count31 Plan. This session did not rerun or claim that DB lifecycle.

The new gate first failed on the fixed parent with `complete actual count31 numeric IR must survive text-only save`. The text-only branch only retained failure/code/continuation diagnostics and dropped the valid numeric triple. The scene-less read branch returned unvalidated numeric artifacts unchanged.

New `apps/tutor/scripts/verify/fixtures/w3-numeric-text-persistence-20261006/new255signed-count31.json` copies the **primary** complete original Plan and typed IR/Solver/audit from the corrected new-actual diagnostic `/Users/kaizen/heytutor-claude-coord/reviews/w3-unit-arithmetic-parent/captured-api-corrected.json`. `parseTurnPlanV3Content` returns the Plan directly. The gate independently calls the normal API authority path with the captured raw IR content, proves audit verified, and asserts complete JSON equality of the original IR and Plan through persistence (including actual IDs `problem`, `fCircular`, `eCircular`, `sCircular`, entities, source text, signed zero error, dependencies and bindings).

The alternate capture is a separate full original refusal fixture: independent API admission returns `source_declined` / `plan_binding_incomplete`. Both the full captured refusal and the alternate original Plan paired with primary IR/Solver without a rejection marker remain strict negatives. Full opaque refusal diagnostics survive. The earlier `captured-api.json` is a mistaken bootstrap and **excluded from product evidence**. `captured-signed-source31.json` preserves the earlier typed fixture as a separate regression control, without new-actual credit. Compact raw IR remains a separate refusal negative; persistence never reconstructs it.

- Corrected new-actual diagnostic SHA256: `8281de34a3c6ca63e72dcfcda3fed03c8a775591b1cf89fbd5a1cf311f41097b`.
- New full actual primary fixture SHA256: `7ccdda1932477ed8745f3b9bc75f3bb5ac8915cd2497dbd0976c8f2144af7877`.
- Earlier typed control source: `packages/scene-engine/scripts/verify/fixtures/w3-signed-measurement-source-actual/captured-input.json`, SHA256 `fc82bc9c22360fd5baf1ca22ffed6d42b3a1f0bd3ef4c6fa3f4d4550c3f3aaab`.
- Parent arithmetic commit `26c5b15` handles the false teaching check separately and is not incorporated into this fixed-parent persistence patch.

## Implementation and bounds

The new helper snapshots bounded own data and closes the original Plan before generic validation can project away unknown fields. Positive admission requires an existing whole-source proof for micrometer counting, finite binomial coefficients, finite progressions or bounded UCM, then every evaluate request's complete solver result and a fresh verified solver/Plan audit. It declines unsupported profiles by default.

Server saves reuse the existing `canonicalSolverArtifacts` on the immutable admitted snapshot, including exact deterministic recomputation. Read normalization independently evaluates the source-proved ASTs, recomputes rational exact values with the existing finite-polynomial kernel, rebuilds proofs/audits and removes cached visual claims. Source/solver values agree within 32 machine epsilons relative to the expected nonzero scalar; zero and sign are not collapsed by an absolute tolerance. Solver errorBound must be zero in this bounded evaluate lane. Count source corrections are refused rather than reconciled. A forged cached audit contributes no authority.

No absent IR is reconstructed. No graph, output, unknown or original claim is pruned to obtain a positive. The full original IR/Plan is retained on success; all four authority fields are null on numeric decline. Opaque refusal/evidence/page metadata stays separate. An invalid numeric graph cannot erase a valid continuation marker or bounded source evidence. Existing code lesson behavior remains covered by its unchanged gate.

Reused bounds: own-data depth64 /16384 nodes /65536 keys /1048576 aggregate key/string characters, finite own arrays no accessors/cycles/custom prototypes; ProblemIR arrays max256 items and AST128 nodes/depth24; rational kernel degree128/power64/128 nodes/depth24/1024 bits/300000 operations. Original server solver deadline remains5000ms. `sourcePlanEvidence` stays bounded at200000 characters; refusal diagnostics retain the existing server bounds. No cap, validator threshold or ownership guard was waived.

Text-only/retry-required status stays truthful. No scene, scene-engine version, validation report, representation tier, nonMetric flag, accepted candidate or diagram ink is manufactured for numeric success. A scene-less stored row falsely declaring validated becomes retry_required. Whole-scene admission remains the existing independent path owned by the reviewer.

## Verification

Node `v24.21.0`, pnpm `10.32.0`; requested PATH prefix `/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin`. Own frozen offline dependencies; no env copy. Heavy builds started at11:53UTC, after the parent's reserved interval. Fresh forced dependency builds:5/5 passed,0 cache hits. No Next production build or services were run.

From the worktree root:

```sh
pnpm install --frozen-lockfile --offline
pnpm exec turbo run build --filter=@heytutor/tutor^... --force
```

From `apps/tutor`:

```sh
node scripts/verify/run-w3-numeric-text-persistence.mjs source
node scripts/verify/run-w3-numeric-text-persistence.mjs esm
pnpm exec tsc --noEmit --incremental false --project scripts/verify/w3-numeric-persistence.tsconfig.json
pnpm exec eslint lib/scene/numericOnlyAuthority.ts lib/scene/turnScenePersistence.ts lib/scene/storedSceneSource.ts scripts/verify/verify-w3-numeric-text-persistence.mts scripts/verify/run-w3-numeric-text-persistence.mjs
pnpm exec tsx scripts/verify/verify-turn-scene-persistence.ts
pnpm exec tsx scripts/verify/verify-board-continuation.ts
pnpm exec tsx scripts/verify/verify-code-lesson-persistence.ts
```

- Source gate: **609 checks PASS**.
- Fresh public ESM gate: **609 checks PASS**, using the own built package import exports through the dedicated ESM runner.
- Entire app TypeScript graph plus the new `.mts` gate: PASS, incremental caching disabled.
- Scoped lint: PASS,0 output.
- Existing turn scene persistence, board continuation and code lesson persistence gates: PASS unchanged.
- `git diff --check`: PASS.

Independent positive oracles: signed count `(2.675-0.02-2.5)/0.005=31`; count39 from2.695, error0, sleeve2.5; count0 from3, error0, sleeve3; count99 from2.99, error+0.005, sleeve2.5. The original true count claim remains intact. Binomial controls independently give216 for x² in(2-3x)^4 and0 for x⁵ in(1+x)^2. AP/GP controls cover negative terms, negative ratio, ratio1 and empty sum. A complete authored UCM graph gives angular speed3rad/s and acceleration0.27m/s² from9cm/s and3cm. The broader fallback UCM graph is an honest negative because its whole source obligations fail; it is never reduced into a positive fixture.

Negatives cover every original IR/Plan hidden-field location, malformed known fields, false extra outputs/unknowns/claims, stale Plan/Solver, forged symbolic exact values and audits, wide solver bounds, partial/extra solver values, missing IR/Plan/Solver, Plan-only/audit-only payloads, an unconsumed same-value AST, refused compact raw payload, apparatus requests, source accessors/inherited obligations/nonfinite data and false scene-less visual flags. Every admitted case exercises canonical save →JSON→stored normalization→replay authority projection and writing timeline, idempotent normalization and a resave; no figure is restored. These are **offline boundary tests**, not an actual database, browser, authenticated save/reopen, voice or whole student replay receipt.

Fresh public artifact SHA256:

- scene-engine dist/index.js: `c8cfcfec8e99883f1fdc634a1348f14abcf5d5cd1d3ebd4f40ba011c34ab2d40`.
- tutor-core dist/index.js: `5569ceaad627a2320b6e0649145eec5f696e8c9ba00c56a6eeb65678fa60b830`.
- drawing dist/index.js: `b618fffc9a864840da737ce1c10a239e69d36ac13fc1f6e9a4278bb5212c887d`.

## Review, per-topic outcome and handoff

Self-review checked correctness, source admission before normalization, immutable solver input, source/default/refusal negatives, dependency direction, bounded synchronous work, metadata preservation and public ESM execution. No independent reviewer acceptance is claimed.

| Exact topic IDs touched by regression evidence | Outcome | Proposed state | Remaining obligations |
| --- | --- | --- | --- |
| `physics\|20\|screw-gauge`, `physics\|20\|screw-gauge-zero-error` | Bounded count-only persistence repaired; apparatus remains refused | integration_pending for infrastructure only | Parent integrate, fresh actual numeric turn/save/own-PG restart/read/whole replay; instrument diagrams/native breadth not qualified |
| `maths\|5\|binomial-theorem`, `maths\|6\|arithmetic-and-geometric-progressions`, `physics\|2\|uniform-circular-motion` | Existing complete source authority can persist without a scene; malformed originals decline | integration_pending for infrastructure only | Parent affected actual lifecycle/shared acceptance; broader UCM fallback retained as an exclusion |

Do not reconstruct the old NULL artifacts row: it has no original IR authority. Integration must rerun a fresh actual turn after applying this commit alongside the parent's arithmetic commit `26c5b15`. Unsupported source families, roots/integrals/networks/set results, nonzero error-bound solvers and unbound/no-IR turns remain excluded from numeric-only retention. No new topic READY, FULLY-CERTIFIED, accepted-ledger or chapter count was recorded.

Commit publication is expressly authorized by the user; author Rishi Vhavle `<rishivhavle21@gmail.com>`, hooksPath `/dev/null`, no coauthor and no remote publication. Full report and command logs: `/Users/kaizen/heytutor-claude-coord/reviews/w3-numeric-text-persistence-20261006/`. Generated `output/` is not committed and has been removed from the worktree. Fresh Sol review is a parent handoff obligation; this session did not spawn an agent or claim that review.
