# Notepad

## Priority Context

- Monorepo: pnpm + turbo. App: `apps/tutor` (Next 15.3.6, custom `server.ts` with TTS WS relay). Packages: `packages/drawing`, `packages/tutor-core`, `packages/whiteboard`.
- Dev: `pnpm dev:tutor` → http://localhost:3000 (Postgres in Docker on :5433, `pnpm db:up`).
- Do NOT commit unless user asks. Do NOT re-adopt Hey Clicky (farzaa/clicky) architecture.

## Working Memory

### 2026-07-03 — Session state (pre-compaction snapshot)

**Context:** User reported regressions after a Hey Clicky-inspired refactor (commits `c702200`–`f97981a`: diagram templates, runtime planner, STEP streaming, JEE prompt injection). Full restore to pre-Clicky lesson flow from baseline `f3f89ec` was performed, keeping the Vercel/Azure deploy split (`publicOrigins.ts`, `middleware.ts` BACKEND_ORIGIN proxy, `vercel.json`).

**All changes are UNCOMMITTED on `main` (pushed head: `cd7007c`).** Modified: `page.tsx`, `systemPrompt.ts`, `elevenLabsWebSocketClient.ts`, `audioSync.ts`, `lessonPlanner.ts`, `alignmentCheck.ts`, drawing/tutor-core `index.ts`, `Whiteboard.tsx`, `.gitignore`.

**Post-restore fixes applied in `page.tsx` / tutor-core / whiteboard:**
1. Stall fix: `ensureTTSClient()` before each segment; `waitForAudioStart()` with 8s timeout; `markSpeechComplete` via `onEnd`/`onError`; TTS segment timeout 45–180s; WS job queue rejects jobs when socket not open (falls back to HTTP).
2. Speed fix: `tts.setPlaybackRate()` wired on settings change + `handleReplaySpeedChange` + `ensureTTSClient`; `speechDurationMs / speedRef.current` in `speechSplit`; wall clock scaled by speed; `speechComplete` short-circuits `liveAudioPositionMs` to segment end (unblocks writing after narration ends); all 3 `createBufferSource` sites set `playbackRate`; whiteboard per-char wait capped at `min(targetMs+2000, 8000)`.

**Verified:** tutor-core/whiteboard/drawing build, tutor typecheck, verify-fbd-mock, verify-diagram-templates all pass.

**Dev server:** running in background (`pnpm dev:tutor`), port 3000. If EADDRINUSE: `fuser -k 3000/tcp`.

**Langfuse creds in `apps/tutor/.env.local`** (LANGFUSE_HOST cloud.langfuse.com). Recent traces of stalls: `d70515c4` (no TTS after LLM), `2182f1cb` (7 tts-segments, ~4040 char output, stopped midway).

**Dead code left (not runtime-wired, deletable later):** `packages/drawing/src/templates/`, `commandPlacement.ts`, `boardZones.ts`, `topicPlanner.ts`, `jee/` data.

**Next step:** user is live-testing at 2x speed with a new physics problem (suggested Atwood machine / incline FBD / projectile). Awaiting feedback on whether speed + stall fixes hold.

## MANUAL
