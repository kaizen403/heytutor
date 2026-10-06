# W2 arithmetic seam — review R1/R2 — 6 October 2026

Disposition: **integration_pending; READY 0; accepted-count change 0; FULLY-CERTIFIED 0**.

Worker: Codex in `/Users/kaizen/heytutor-cov-wt/w2-arithmetic-seam-20261006`.
Integration owner: parent coverage coordinator. Base: `5223e6361721f96a41f929d2485d6f3d94f746a0`.
This assignment fixes shared teaching admission seams, assigns no topic IDs and
changes no exam denominator, ledger, readiness table or chapter count.

Read AGENTS.md, coverage plan, topic index/progress, session ownership and the
catalogued code-review skill. The supplied independent report is the spec:
`/Users/kaizen/heytutor-claude-coord/reviews/w2-shared-authority-review-20261006.md`,
R1/R2 only. No agents were launched; the final diff was reviewed directly for
the report's requirements and AGENTS authority/atomic-admission rules.

## Owned changes

- `packages/drawing/src/protocol/drawingProtocol.ts`: announced bounded parser/type
  change before editing. Parser WRITE commands retain `sourceText` before math
  rewriting and board normalization. Coordinate/font suffixes are removed from
  that source text. Rendering still uses normalized `text`.
- `apps/tutor/features/tutor-session/lib/turn/teachingArithmeticAdmission.ts`:
  check parser source notation when available, retaining spelling/typography
  normalization while avoiding fractional rewriting. Deferred admission separates
  checking from committing released row history/narration. Immediate callers
  retain the existing `offer()` behavior.
- `apps/tutor/features/tutor-session/hooks/turn/useQuestionHandler.ts`: the live
  buffer defers its commit until downstream scene/conductor/doubt/alignment/resume
  admission releases the segment to the queue. Discarded no-ink/startup beats do
  not enter arithmetic history; previously released beats survive a repair.
- `apps/tutor/scripts/verify/verify-w2-arithmetic-parser.ts`: own parser/admission
  gate, source and built ESM, incremental and batch paths.
- `apps/tutor/scripts/verify/verify-w2-arithmetic-seam.ts`: own gate adapted from
  the explicitly authorized external `reviews/w2-shared-review/hook-harness.ts`.
  All imports resolve this worktree; no absolute pin or external execution.
- This evidence log.

Core arithmetic logic did not need changing. Parent source/compiler/capability,
ledger and runtime files remain untouched. No other worktree, main, remotes,
stash, forks, agents, Astral, environment/key files, browser, ports, provider
calls or DB operations were used. Local Prisma client generation creates types
only. Dependencies/build output and receipts are ignored or external.

## Independent expectations and outcomes

The adapted desired-contract gate was run before implementation. It failed
streaming/batch positive and negative mixed-number cases, plus no-ink resume
retry history. Baseline receipt: external `baseline-hook.jsonl`.

Final parser gate: **120 combinations pass**, plus six spelling controls and
deferred-commit controls. Existing `plus`/`squared` false-row checks still reject.
The exact raw `2 \frac{1}{2}=2.5` survives the actual parser while board text
remains `2 (1/2)=2.5`. Raw positive/negative mixed numbers, dfrac/tfrac,
delimiters and even an erroneous mixed RHS abstain; none obtains a false proof
or correctness certificate. Explicit addition/multiplication and fraction
products remain supported. `2(3+4)=14` is correct and `=13` is false, with
independent expected product 14. Tests use one-character stream splits and
coordinate/font suffixes through source and built ESM parsers.

Final actual-hook gate: **24 scenarios pass**. It runs this checkout's actual
handler, turn control and segment runner with virtual time and React/I/O mocks.

- Valid mixed-number and negative mixed-number responses, streaming and batch:
  one teaching request each; no arithmetic repair.
- Explicit fraction operations, streaming and batch: one request each.
- Ordinary false parenthesis multiplication: correct proof and one repair.
- False complete STEP, multi-WRITE atomicity, attempt tail, split close tag,
  continuation, two repairs, shared budget, cancellation before/during repair,
  final-open drain and batch rejection retain the original safe behavior.
  Exhaustion is three requests and an error; final-open failure and batch
  negative fail safely. No false beat/tail reaches queues, playback, recorded
  segments, assistant history or either captured save payload.
- No-ink resume followed by arithmetic repair: three requests; final response,
  retry/final assistant history, queued/spoken/recorded segments and local/board
  save payloads exclude `DISCARDED`; retain `ADMITTED sum five` and the repaired
  square. Both persistence mocks are exercised. Positive no-ink control takes
  two requests. A withheld no-ink lead-in within the same request also stays
  excluded after an arithmetic repair, in two requests.

## Reproduction and receipts

All commands ran in the assigned worktree with Node **v24.21.0**, pnpm
**10.32.0**, and this PATH prefix:

```text
/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin
```

External owned receipts:
`/Users/kaizen/heytutor-claude-coord/reviews/w2-arithmetic-seam/`.

| Exact command | Final result / receipt |
| --- | --- |
| `pnpm install --offline --frozen-lockfile --ignore-scripts` | pass; own dependencies; `install.log` |
| `pnpm --filter @heytutor/drawing build` | ESM/declarations pass; `build-drawing.log` |
| `pnpm --filter @heytutor/scene-engine build` | ESM/declarations pass, unchanged source; `build-engine.log` |
| `pnpm --filter @heytutor/tutor-core build` | ESM/declarations pass; `build-core.log` |
| `pnpm --filter @heytutor/whiteboard build` | ESM/declarations pass; `build-whiteboard.log` |
| `pnpm --filter @heytutor/tutor exec prisma generate --schema prisma/schema.prisma` | local generation pass; `prisma-generate.log` |
| `pnpm --filter @heytutor/drawing typecheck` | pass; `drawing-type.log` |
| `pnpm --filter @heytutor/tutor-core typecheck` | pass; `core-type.log` |
| `pnpm --filter @heytutor/tutor typecheck` | pass; `tutor-type.log` |
| `pnpm --filter @heytutor/drawing lint` | pass, no warnings; `drawing-lint.log` |
| `pnpm --filter @heytutor/tutor exec eslint features/tutor-session/lib/turn/teachingArithmeticAdmission.ts features/tutor-session/hooks/turn/useQuestionHandler.ts scripts/verify/verify-w2-arithmetic-seam.ts scripts/verify/verify-w2-arithmetic-parser.ts` | pass, no warnings; `app-lint.log` |
| `pnpm --filter @heytutor/tutor exec tsx --tsconfig tsconfig.json scripts/verify/verify-w2-arithmetic-parser.ts` | 120 parser controls and deferred commit pass; `parser.log` |
| `pnpm --filter @heytutor/tutor exec tsx --tsconfig tsconfig.json scripts/verify/verify-w2-arithmetic-seam.ts` | 24 scenarios pass; `hook.log`, `hook.jsonl`, `hook-summary.json` |
| `pnpm --filter @heytutor/drawing verify` | all eight drawing gates pass; `drawing-verify.log` |
| `pnpm --filter @heytutor/tutor exec tsx --tsconfig tsconfig.json scripts/verify/verify-startup-turn.ts` | actual-handler startup regressions pass; `startup-regression.log` |
| `git diff --check` | pass |

## Limits and parent handoff

Unsupported arithmetic is an abstention. This does not verify mixed-number
values, units, arbitrary speech, symbolic/source truth or source-bound diagrams.
Hook tests transpile actual TS with stubbed React primitives; they are not a
mounted React application. Save arguments are captured evidence, not a real
authenticated save, DB restart/reopen or saved student replay. No actual
student render, provider playback, full root build/check, full scene/core/tutor
suite, corpus or holdout was run. R3/R4 and all topic/source/runtime integration
remain parent-owned. Parent should independently integrate/recheck these seams
and provide required student lifecycle evidence. No READY/acceptance increment
is proposed.

The user authorized a commit of clean owned paths as Rishi Vhavle
`rishivhavle21@gmail.com`, without coauthors or publication. Final commit/status
and artifact hashes are recorded in the external report and manifest. The
integration-owner disposition remains pending.
