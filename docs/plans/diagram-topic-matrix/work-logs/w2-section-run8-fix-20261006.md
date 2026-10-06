# W2 section actual-run8 and completeness fix — 6 October 2026

Sol worker; parent integration owner. Branch `cov/w2-section-run8-fix-20261006`, own tree `/Users/kaizen/heytutor-cov-wt/w2-section-run8-fix-20261006`, pinned base `c9b48d2d932703b8b60b62b303c21dd1722ee1ad`. Proposed disposition: `integration_pending`. READY increment 0; FULLY-CERTIFIED increment 0; accepted topic counts unchanged.

## Assignment and source contract

Bounded CH-06a repair for `maths|10|section-formula`, within the existing 2026 J/A coordinate-plane scope (N not applicable). This is evidence for captured and bounded variants, not acceptance of the entire topic. Read AGENTS, coverage plan, topic matrix index/progress, session ownership, source module, previous worker logs/gates, actual run8 diagnosis and final independent review before implementation. Ownership was announced in the session. No Astral, subagents, main/remote operations, provider/browser calls, DB access, environment copies, dependency copies, Physics edits, or shared counts. Own frozen install/build only; Prisma generation happened through the normal local install hook without a database connection.

Only four owned files:

- `packages/scene-engine/src/ir/sectionFormulaSource.ts`
- `packages/scene-engine/scripts/verify/fixtures/w2-section-run8-actual-fullir.json` (new)
- `apps/tutor/scripts/verify/verify-w2-section-run8-fix.ts` (new)
- this unique worklog

Original coordination/runtime/review outputs were read but never overwritten. Copies of diagnosis/review scripts retarget both imports and output destinations to `/Users/kaizen/heytutor-claude-coord/integration/w2-section-run8-fix-review` before execution. All scratch bundles/build/test logs stay there or in ignored own build directories.

## Diagnosis and change

Run `2026-10-06T0622-w2-c3f97bd9`: external was saved as `validated`; internal and midpoint were `retry_required` with null saved IR. Reconstruction uses the actual complete raw `problem-ir-v1` response, the existing normalizer/validator/Plan binder and the **unchanged actual saved canonicalPlan**. The new fixture retains rawIR, complete reconstructed runtimeIR, canonicalPlan, independent expected coordinates, original visual status, exact input paths and SHA-256 source-file hashes. Missing runtime save IR is explicitly labelled reconstructed, never replaced by a source-only surrogate. Positive verification regenerates that reconstruction and deep-compares every channel.

The supplied diagnosis and independently bundled c9 source agree: internal audit verified/doc true/scene true/issues empty; external likewise. No internal fact-grammar broadening was made for the runtime failure. Parent owns the runtime internal planner-selection fix separately.

Midpoint c9 rejects `x-coordinate of A is -4` and the corresponding other three axis statements. Its typed requested statement `midpoint P of segment AB` requires a full-question quote; its requested line lineage also requires that full quote. Actual evidence is the exact span `midpoint P of the line segment joining A(-4,6) and B(8,-2)` without Find or period. Baseline controls preserving the full actual IR show axis-only and request-quote-only changes still fail; both changes together pass. The fix binds the complete axis statement to the coordinate role/value and exact named-point evidence. Midpoint requested line evidence now accepts only a complete midpoint request clause with the joining relationship and both exact named endpoints, including the actual span. Endpoint tuples, joining-only suffixes, short request prefixes and wrong names cannot source that requested line. Existing given-endpoint line evidence remains supported.

The follow-up independent review supplied two P1 gaps and a P2 regression. Requested statements now consume the complete supported point/operation/mode/ratio statement and separately bind its source quote. Wrong P/Z, internal/external, ratio 9:1 and residual midpoint/coordinate asks reject. Whole-source parsing replaces vocabulary deletion with complete bounded request/join/ratio clauses. Unsupported composites made solely of formerly allowed words decline atomically, including submitted/restored section documents. The established `segment from A … to B …` spelling is explicitly consumed, restoring SF6. No source/IR obligations are dropped, no expression/validator tolerances changed, no model-authored ink or runtime fixture lookup added.

## Independent checks

New gate: three actual captures plus five independent complete-IR parameter holdouts, each also exercised source-only with its correct Plan. Independent oracles: internal zero x `(0,3)`, internal zero y `(3,0)`, external negative `(-12,27)`, external zero `(0,-3)`, decimal internal `(0,1.5)`. Coordinates come from independently supplied affine-combination expectations, not engine output. Whole caller inputs are immutable; actual Plans remain unchanged through synthesis and save canonicalization. Correct complete-IR scenes retain real AB line geometry, its incidence assertions and all derived visual obligations.

Controls preserve valid IR schemas: contradictory axis/value/name, wrong midpoint endpoint/result/mode, incomplete line quote, wrong requested fact role, hidden attached fact, unused fact, changed operation/name/mode/ratio, unsupported literal result formula, and complete-source composites with/without actual IR. Every negative rejects normal synthesis and compiler/live/save/read/restore. Source-only controls explicitly carry null IR; the actual fullIR controls never do.

The gate passes **156 cases / 780 boundary assertions** across source TS and public built ESM. An additional owned esbuild runner resolves every application `@heytutor/*` import to this tree's built public ESM, keeping public engine imports external. The same 780 assertions pass there. `import-resolution.json` retains all resolved imports. This is stronger than assuming tsconfig aliases use production packages.

Retargeted final-review `fresh-review.ts` results: each of the five reported contradictory requested statements and both midpoint suffixes rejects all five boundaries in TS/ESM; the full captured-IR extra-midpoint control also rejects. Retargeted `holdouts.ts`: all five positive captures pass every boundary, and unsupported-request/literal-formula controls reject. These diagnostic scripts also exercise unchanged circle channels; no circle implementation or acceptance claim belongs to this assignment.

## Commands and receipts

All commands use:

```sh
export PATH=/Users/kaizen/Library/Caches/pnpm/dlx/4113e0156f1bebff8f9956ac1db8efea/muvxu6x9-88l/node_modules/.bin:$PATH
```

Node 24.21.0 / global pnpm 10.32.0. Working directory is the own tree unless a package-filter command supplies the package directory.

| Command | Actual result / review-directory log |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS; `install.log` |
| `pnpm --filter @heytutor/drawing build` | PASS; `build-drawing.log` |
| `pnpm --filter @heytutor/scene-engine build` | PASS ESM/DTS; `build-scene-final2.log` |
| `pnpm --filter @heytutor/tutor-core build` | PASS ESM/DTS; `build-core.log` |
| `pnpm --filter @heytutor/whiteboard build` | PASS ESM/DTS; `build-whiteboard.log` |
| `pnpm --filter @heytutor/design-tokens build` | PASS; `build-tokens.log` |
| `pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-w2-section-run8-fix.ts` | PASS 156 cases / 780 seam assertions; `run8-final3.log` |
| `pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-w2-section-live-seams.ts` | PASS original six captures / 168 positive-negative controls; `seams-final3.log` |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w2-section-completeness.ts` | PASS original 42 controls; `completeness-final3.log` |
| `pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-section-formula-ready.ts` | PASS original 7 cases / 8 declines / 138 checks, including SF6 from/to; `ready-app-final3.log` |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w1-section-fullir.ts` | PASS; `w1-engine-final3.log` |
| `pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-w1-section-fullir.ts` | PASS; `w1-app-final3.log` |
| `pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-w2-section-matrix.ts` | PASS; `section-matrix-final.log` |
| `pnpm --filter @heytutor/scene-engine typecheck` | PASS; `typecheck-scene-final3.log` |
| `pnpm --filter @heytutor/tutor typecheck` | PASS; `typecheck-app-final3.log` |
| `pnpm --filter @heytutor/scene-engine lint` | PASS, four inherited unrelated warnings; `lint-scene-final3.log` |
| `pnpm --filter @heytutor/tutor exec eslint scripts/verify/verify-w2-section-run8-fix.ts` | PASS; `lint-gate-final3.log` |
| `node <review-dir>/bundle-gates.mjs` then `node <review-dir>/run8-built-consumers.mjs` | PASS 780 seam assertions with application consumers using own public ESM; `run8-built-consumers-final3.log` |
| `node <review-dir>/seams-built-consumers.mjs` from own `apps/tutor` | PASS original 168 controls through built consumers; `seams-built-consumers-final.log` |
| `pnpm --filter @heytutor/tutor exec tsx <review-dir>/fresh-review.ts` and `.../holdouts.ts` | Completed, 42/60 diagnostic rows; `fresh-review-results.json`, `holdouts-results.json` |
| `pnpm --filter @heytutor/scene-engine exec tsx <review-dir>/diagnosis.mts` | All three audit verified/doc true/scene true/issues empty; `diagnosis-fixed.log` |
| `git diff --check` | PASS |

`<review-dir>` means `/Users/kaizen/heytutor-claude-coord/integration/w2-section-run8-fix-review`.

Retained failures: the separate **engine** `verify-section-formula-ready.ts` fails its pre-existing indexed given `x_1` without sourceText expectation (expected retained `x1`, actual no givens). Independently bundled c9 source fails on the identical expectation/output; `ready-engine-initial.log` and `ready-engine-baseline.log`. The quoted-source requirement is retained, not weakened to make that stale expectation pass. This differs from the **app** gate, whose full 138 checks pass. Initial harness issues are also retained: root `pnpm exec tsx` lacked the package executable; new gate initially used a nominal entire-module API type across source/DTS and omitted required null problemIR; the built original seam runner first ran from the wrong cwd. Corrected invocations/narrow public API typing pass; `diagnosis-fixed.log`, `typecheck-app.log`, `seams-built-consumers-wrong-cwd.log` retain relevant attempts. The additional section/matrix gate exposed a newly excluded existing anonymous requested statement `Find the coordinates of the dividing point` with evidence exactly `Find`. Independent c9 bundling passes this capture. The bounded form was restored only for an anonymous single dividing-point coordinate ask, with the command quoted at source offset zero; added point names, modes, ratios or asks do not match. The new gate adds anonymous capture positives and contradictory statement negatives without altering the old fixture. `section-matrix.log` retains the intermediate failure; `section-matrix-baseline.log` and `section-matrix-final.log` retain the c9 and corrected passes. The initial added anonymous check supplied a raw uncompiled document to the regenerated compiled-shape source guard; it correctly failed. The check now uses the actual normal synthesized/compiled candidate, retaining the failure in `run8-built-consumers-final2.log` and `anonymous-full-compile.log`. No source check or test expectation was relaxed.

## Outcome and remaining gaps

| Topic | Checked scope | Tier / disposition | Remaining obligations |
| --- | --- | --- | --- |
| `maths\|10\|section-formula` | Actual run8 external/internal/midpoint complete IR + Plans; five independent affine holdouts source-only/fullIR; contradictory and composite controls; existing captured/fullIR/138-check regressions | `exact_verified` offline; `integration_pending` | Parent integrates this commit with its app selection fix, then fresh normal student renders, source review, HTTP persistence, owned restart/reopen and replay/audio/reveal checks |

No fresh browser render inspection, HTTP/DB persistence, restart, reopened board playback or audio/reveal synchronization was attempted. The helper names live/save/read/restore denote offline seams only. Parent retains Physics native runs. Whole repository verification/build and external checklist acceptance were not run. The review's inherited indexed quotation binary64 precision limitation remains outside this bounded repair; wrong endpoint quotes, actual source spans and metric conflicts remain guarded. No new percentage or acceptance is claimed. Parent alone updates shared topic counts after independent lifecycle review.

Publication is an explicitly authorized local commit by Rishi Vhavle, hooks disabled for that command, no coauthor; no push/PR/merge. Integration-owner disposition remains pending.
