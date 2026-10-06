# W2 bounded source representation selection / 2026-10-06

## Assignment and source contract

- Worker: Luna. Integration owner: repository owner.
- Worktree: `/Users/kaizen/heytutor-cov-wt/w2-source-selection-fix-20261006`.
- Branch: `cov/w2-source-selection-fix-20261006`, based on `c9b48d2d932703b8b60b62b303c21dd1722ee1ad` from the W2 integration line.
- Scope: repair caller-context validation and representation selection for a complete, source-verified section figure. No topic IDs or topic counter changes are claimed.
- Owned paths: `apps/tutor/features/tutor-session/lib/scene/representationFallback.ts`, `apps/tutor/scripts/verify/verify-source-selection-context.ts`, and this log.
- Reproduction evidence: `/Users/kaizen/heytutor-claude-coord/integration/w2-section-run8-internal.json` contains the actual complete question, raw/normalized plan, ProblemIR, source candidate and exact proof. `/Users/kaizen/heytutor-claude-coord/runtime/runs/2026-10-06T0622-w2-c3f97bd9/evidence/w2-sf-internal-live.json` records the live qualitative-planner selection and declined save. The source candidate has no `source.archetype` marker.

## Changes and checks

- Selection now lets a source-generated `exact_verified` scene outrank a planner scene that only earned `qualitative_verified` based on the compiled proof result, without requiring an archetype metadata string.
- Exact and synthesized documents pass structural validation before compile. The selection boundary also validates the actual caller TurnPlan and full ProblemIR obligations; section documents receive the caller's question, source program, plan values and units in their source checks. The raw plan remains unmodified. The base `validateSceneDocument` API accepts only the document, so these caller-context checks run in the wrapper immediately after its structural pass.
- Added a verifier using the captured run8 fixture. It covers the complete source candidate, an invalid planner caption paired with the correct source, stale plan value, wrong coordinate unit, extra ProblemIR visual obligation, and the no-IR source path.
- Package install: `PATH=/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin:$PATH pnpm install --frozen-lockfile` — passed.
- Builds: `@heytutor/drawing`, `@heytutor/scene-engine`, `@heytutor/whiteboard`, and `@heytutor/tutor-core` — passed. The first tutor-core build overlapped scene-engine declaration generation and failed to resolve its types; the sequential retry passed.
- Tutor typecheck — passed after package builds. ESLint on both owned TypeScript files — passed.
- Passed gates after the structural-boundary update: `verify-source-selection-context.ts`; `verify-w1-section-fullir.ts`; `verify-representation-fallback.ts`; `verify-w2-section-live-seams.ts` (168 checks); `verify-matrix-source-types-hey88.ts` (1,676 controls); `verify-ucm-selection.ts` (33 checks); `verify-mensuration-fallback.ts`; `verify-suvat-ready.ts` (2,206 checks). Tutor typecheck and ESLint on both owned TypeScript files pass.
- Existing gate gaps: `verify-section-formula-ready.ts` stops before selection because its unchanged SF6 wording is declined by `readSectionFormulaSource` / `questionRequiresVisual`; `verify-live-save-parity.ts` cannot synthesize its ladder fixture because that question receives no family operator; `verify-render-scene-attestation.ts` fails its independent entities fixture's compile assertion. These outcomes are retained, not waived. The first is a parser/input gate and the latter two are outside this assignment's source-selection path.
- Live turn/save/replay was not rerun. The cited runtime evidence is the prior reproduction, not post-fix lifecycle evidence.

## Handoff

- Proposed state: `verification_pending` for this bounded code fix; no syllabus topic acceptance is proposed.
- Integration review should inspect the three owned paths and decide whether to rerun a student turn/save with the existing run8 request. No other session-owned source, compiler, persistence, ledger, count, DB, provider, browser, or deployment path was changed.
- Commit is authored as Rishi Vhavle (`rishivhavle21@gmail.com`) with hooks disabled; no co-author.

## Integration-owner disposition

- Pending independent review; topic ledger and accepted counters unchanged.
