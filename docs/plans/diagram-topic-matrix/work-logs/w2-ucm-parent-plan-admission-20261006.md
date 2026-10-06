# W2 actual circular plan read admission — 6 October 2026

Integration owner: parent. Integration pending independent review and fresh runtime. READY and accepted counts unchanged.

Integrated the fresh incidence compatibility fixes (823717f6,1251faa1) and actual UCM source joins (d5b0e106 from worker380ac1c4). The worker left a demonstrated plan-only force obligation admitted by raw stored read and restore. This parent patch exports the bounded runtime contract and enforces complete valid actual Plan, source roles/unknown requests and fresh numeric values in the shared sourceBoundPlanIssues helper. Missing plans and unsupported complete sources decline atomically. No smaller IR is substituted.

New gate apps/tutor/scripts/verify/verify-w2-ucm-plan-read.ts checks all three unchanged actual captured IR/Plan controls and extra-force, stale-scalar and missing-plan negatives across live/save/read/restore: 48 checks pass. Worker gate: 246 groups, zero failures; its original printed parent-seam now rejects stored read/restore. Integrated incidence lifecycle gate: 31 pass. Engine/core normal builds, tutor typecheck and scoped ESLint pass. Initial own gate lacked explicit fixture-derived admission/stored types; the two TS7022 failures were fixed with actual imported parameter types and rerun. Original failure log was retained in the session tools; final type log is green.

Commands: node packages/scene-engine/scripts/verify/run-w2-ucm-live.mjs (worker gate); same runner with file URL to each new app gate; pnpm --filter @heytutor/scene-engine build; pnpm --filter @heytutor/tutor-core build; pnpm --filter @heytutor/tutor typecheck; pnpm --filter @heytutor/tutor exec eslint lib/scene/sourcePlanAdmission.ts scripts/verify/verify-w2-ucm-plan-read.ts. Logs: coordinator integration/w2-ucm-parent-*.log, w2-ucm-integrated-gate.log and w2-incidence-integrated-gate.log.

Fresh student, narration/WRITE/reveal, authenticated save and restarted reopened replay remain unrun on this patch. The previous UCM run declined all three figures and remains failed. Independent source review is running. No remote push/main edit or Chemistry edits.
