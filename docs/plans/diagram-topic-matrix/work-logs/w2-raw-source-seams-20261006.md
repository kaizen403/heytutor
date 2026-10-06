# W2 R4 raw source structural trust seams — 6 October 2026

Disposition: **integration_pending**. New READY **0**, accepted-count change **0**, new FULLY-CERTIFIED **0**. This closes the bounded offline R4 repro, not a topic or student lifecycle certification. No topic IDs or denominator rows were assigned or changed.

## Assignment and source contract

- Worker: Codex in `/Users/kaizen/heytutor-cov-wt/w2-raw-source-seams-20261006`; integration owner: parent W2 coordinator.
- Starting revision: `5223e6361721f96a41f929d2485d6f3d94f746a0` (`fix: bind Ohm unknown units to derived owners`), clean tracked tree.
- Read this checkout's AGENTS, coverage plan, topic matrix index, progress contract, session ownership and work-log template; read external review `/Users/kaizen/heytutor-claude-coord/reviews/w2-shared-authority-review-20261006.md` R4 and original `findings.mts` / `source-repros.mts` under `reviews/w2-shared-review`.
- Owned paths: `apps/tutor/lib/scene/{turnScenePersistence,storedSceneSource}.ts`, `apps/tutor/features/tutor-session/lib/scene/restoreVerifiedDiagram.ts`, new `apps/tutor/scripts/verify/verify-w2-raw-source-seams.ts`, and this log. No central engine source guard/compiler/capability, static ladder, other workers' gates, ledgers or counters were edited.
- Frozen source: existing `packages/scene-engine/scripts/verify/fixtures/w2-motion/w1-ucm-stone.json`. Selection and persistence use the actual `actualPlan` and complete `savedIR` (facts, entities, expressions, constraints, solve requests and intents); the local deterministic solver recomputes that IR. No simpler IR, obligation exemption, model-derived authority or source substitution was used.

## Reproduction and change

The exact raw mutations separately pop `source_name_O_0` from `revealGroups[0].entityIds` and `requiredEntityIds`. The unchanged engine guard and raw compiler reject each; the unchanged permissive normalizer restores each. Previously save/read/restore checked only the normalized document and accepted both omissions.

The initial owned gate ran on the starting implementation: **103 grouped checks, 24 failed**. Every failure was one of the two omissions at save/read/restore, in both exact and representation paths, with source markers retained or removed. Correct source, one-ULP derived scalar, JSONB key order and timeline/radius/unit/beyond-bound negatives passed. Receipt: `baseline.jsonl`. The final gate adds combined omission/one-ULP and malformed-shape checks: **137/137 pass**; receipt: `raw-seams-final.log`. These are grouped checks, not counts of topics or student turns.

`rawStoredTurnSourceIssues` runs the existing engine source/caller guards directly on the submitted payload before `validateSceneDocument`. Malformed raw shapes that typed guards cannot inspect fail closed. Persistence performs the check before either normalization path (including the planless exact path); stored read quarantines rejected payloads and strips trusted diagram commands; restore declines before constructing a presentation. Existing normalized validation, compilation, source binding and solver checks still run afterward. The engine alone retains gamma(8) derived-scalar tolerance and object-key-order equality. There is no required/reveal repair allowance.

## Bounded controls

- Correct raw stone and JSONB-reordered objects pass both `exact_verified` and `question_representation` branches.
- A true next-binary64-value mutation of derived `a_c` passes and canonicalizes at save/read/restore. Canonical quantities and restored diagram equal the exact control; caller document and full captured IR remain unchanged.
- Required/reveal omissions reject at raw compiler/live admission/save/read/restore, with markers retained and removed. The gate explicitly demonstrates that normalization would otherwise repair the omission.
- Combining either omission with legitimate derived one-ULP drift still rejects. Source-radius one-ULP drift, timeline forgery, wrong derived unit and derived drift beyond gamma(8) reject; source literals and structure do not borrow scalar tolerance.
- Malformed raw entity/construction arrays reject safely at all three changed seams.
- Stored-read negatives retain the rejected raw document for diagnosis with `retry_required`, clear trusted intro ink and do not mutate the submitted turn.

An R4-only adaptation of the external original `findings.mts` was saved to the worker's own artifact directory as `r4-original-repro.mts`. It imports this checkout, retains the actual captured full IR and changes the assertions to require rejection. Its five rows pass: correct source accepts, both exact omissions/timeline/radius reject at all seams. No pinned review code was executed as fix proof. The committed gate adapts the raw controls from both external repros and imports locally.

## Commands and evidence

All commands ran in the assigned worktree with Node **v24.21.0**, pnpm **10.32.0** and PATH prefix:

```text
/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin
```

Artifact directory: `/Users/kaizen/heytutor-claude-coord/reviews/w2-raw-source-seams/`. Logs are external evidence, not repository inputs; `manifest.json` records their hashes.

| Command | Result / receipt |
| --- | --- |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | Own dependencies; pass, `install.log` |
| `pnpm --filter @heytutor/drawing build` | Pass, `build-drawing.log` |
| `pnpm --filter @heytutor/scene-engine build` | Pass, `build-engine.log` |
| `pnpm --filter @heytutor/tutor-core build` | Pass, `build-core.log` |
| `pnpm --filter @heytutor/whiteboard build` | Pass, `build-whiteboard.log` |
| `pnpm --filter @heytutor/tutor exec prisma generate --schema prisma/schema.prisma` | Pass, `prisma-generate.log`; local generation without DB/env files |
| `pnpm --filter @heytutor/tutor exec tsx --tsconfig tsconfig.json scripts/verify/verify-w2-raw-source-seams.ts` | 137/137 pass, `raw-seams-final.log` |
| `pnpm --filter @heytutor/tutor exec tsx --tsconfig tsconfig.json /Users/kaizen/heytutor-claude-coord/reviews/w2-raw-source-seams/r4-original-repro.mts` | Five desired-contract rows pass, `r4-original-repro.jsonl` |
| `pnpm --filter @heytutor/tutor exec tsx --tsconfig tsconfig.json scripts/verify/verify-turn-scene-persistence.ts` | Pass, `verify-persistence.log` |
| `pnpm --filter @heytutor/tutor exec tsx --tsconfig tsconfig.json scripts/verify/verify-w2-source-lifecycle.ts` | Five UCM controls pass, `verify-source-lifecycle.log` |
| `pnpm --filter @heytutor/tutor exec tsx --tsconfig tsconfig.json scripts/verify/verify-publication-authority-and-restore.ts` | 659 checks pass, `verify-restore.log` |
| `pnpm --filter @heytutor/tutor exec tsx --tsconfig tsconfig.json scripts/verify/verify-verified-scene-recovery.ts` | Pass, `verify-recovery.log` |
| `pnpm --filter @heytutor/{scene-engine,tutor-core,tutor} typecheck` (three separate commands) | All pass; `type-engine.log`, `type-core.log`, `type-tutor-final.log` |
| `pnpm --filter @heytutor/tutor exec eslint lib/scene/turnScenePersistence.ts lib/scene/storedSceneSource.ts features/tutor-session/lib/scene/restoreVerifiedDiagram.ts scripts/verify/verify-w2-raw-source-seams.ts` | Pass, zero output; `lint-changed-final.log` |
| `git diff --check` / staged path review | Pass; only the five owned paths committed |

## Limits and handoff

Offline actual functions only: no authenticated DB save/restart, fresh-login reopen, mounted student render, browser, runtime/server, provider, audio or earliest whole lecture replay was run. Full root production build, full engine/core/tutor suites and frozen corpus/holdout are unrun. Existing affected checks above passed; no shared failure was waived or gate threshold changed. The 137 checks establish only this supported raw structural seam contract, not all-topic source completeness.

Parent retains R1/R2/R3, central guard/compiler/capability/static ladder and broad relative full-IR questions. Integrate this commit and repeat the affected checks and student lifecycle before any broader authority/readiness claim. R4 does not approve the other review findings. No main/other worktrees, keys/env reads, DB, browser, remotes, stash, forks, subagents, Astral, pushes or publication were used. Commit authorship is RishiVhavle `<rishivhavle21@gmail.com>` with per-command `core.hooksPath=/dev/null` as authorized.

Integration-owner disposition: pending independent review. READY **0**; accepted-count change **0**; FULLY-CERTIFIED **0**.
