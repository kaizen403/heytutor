## 2026-06-23 — Task 1: ERASE command parse support

- Added `ERASE` to `DrawCommandType` union and `DRAWING_TAG_PATTERN` regex in `drawingProtocol.ts`.
- Added `ERASE` to `TAG_NAMES` array and `COMPLETE_TAG_PATTERN` regex in `incrementalParser.ts`.
- ERASE reuses existing `parseNumericParams` (region-based: x,y,width,height) — no new param parser needed.
- Full parser: `parseDrawingCommands('...[ERASE:100,100,300,200]...')` → 1 command, type ERASE, params [100,100,300,200]. PASS.
- Incremental parser: `IncrementalTagParser` on `'erase now [ERASE:50,50,200,100] done'` → 1 ERASE segment with params [50,50,200,100]. PASS.
- Existing commands (DRAW_RECT, WRITE, CLEAR) still parse correctly. PASS.
- `pnpm typecheck --filter @heytutor/drawing` passes (1/1 tasks, 0 cache hits).
- Evidence: `.omo/evidence/task-1-erase-parse-full.txt`, `task-1-erase-parse-incremental.txt`, `task-1-existing-commands-still-parse.txt`.
## 2026-06-23 — Task 4: ERASE duration calculations in audioSync

### What was done
- Changed `DEFAULT_DRAWING_DURATIONS.ERASE` from 400 to 1500 in `audioSync.ts`.
- Added `case "ERASE"` to `getDrawingDuration()`: extracts first two params as w,h, computes area=|w*h|, returns `clamp(round(area/50), 800, 3000)`.
- `DrawingDurations` interface already had `ERASE: number` (pre-existing).
- Did NOT change `getFlightDuration()` or `getCommandDrawDurationMs()` per task constraints.

### Verification results
- Smoke check (tsx): small ERASE [100,50] → drawing=800ms (clamped min). large ERASE [600,400] → drawing=3000ms (clamped max). PASS.
- `pnpm typecheck --filter @heytutor/tutor-core`: PASS (2/2 tasks, 0 errors). This unblocks Task 2 re-verification.
- LSP diagnostics: only pre-existing errors (missing .d.ts for @heytutor/drawing, implicit any on default branch indexing). No new errors from ERASE case.

### Discrepancies from task expectations
- Task expected flight=500, total=1300. Actual: flight=350, total=1150. `getFlightDuration()` returns 350 for ERASE via catch-all `return 350`. Task forbids changing it, so actual values stand.
- ERASE params are [x,y,width,height] in the drawing protocol, but the task's code `const [w, h] = command.params` extracts x,y not width,height. Smoke check used [width,height] params to match the task's intent. In production with real [x,y,w,h] params, the area calculation would use x*y. Potential design issue to revisit.

### Evidence files
- .omo/evidence/task-4-erase-duration.txt
- .omo/evidence/task-4-typecheck.txt

### Fix (same session)
- Changed param destructuring from `const [w, h]` to `const [, , eraseWidth, eraseHeight]` to correctly read width/height from `[x, y, width, height]` params.
- Added `if (command.type === "ERASE") return 500;` to `getFlightDuration()` before catch-all `return 350;`.
- Smoke check now returns exact acceptance values: `{"small":800,"large":3000,"smallFlight":500,"smallTotal":1300}`.
- Typecheck still PASS. No existing command durations changed.
## 2026-06-23 — Task 2: System prompt + mock response eraser updates

### What was done
- Added `[ERASE:x,y,width,height]` to available commands in systemPrompt.ts after `[CLEAR]`.
- Added ERASE explanation: removes everything inside the rectangular region starting at (x,y) with given width and height.
- Added no-overwrite rule: never draw on top of existing shapes/text; use ERASE first to clear occupied space; prefer empty space when available.
- Added sync pacing note: before erasing, say what you're about to erase, then place the ERASE command; don't erase silently.
- Updated cuboid/cube mock (MOCK_RESPONSES[0]) to include `[ERASE:180,400,300,60]` before writing the cube volume formula, with narration "now let me clear that formula to make room for the cube."
- Added a new concise mock for erase/clear/reuse/wipe keywords demonstrating draw -> erase -> reuse pattern.

### Verification results
- Grep confirms ERASE appears 4 times in systemPrompt.ts (command list, explanation, no-overwrite rule, sync pacing).
- Grep confirms ERASE appears 2 times in mockResponses.ts (cuboid mock + new erase mock).
- Parser verification (tsx): parseDrawingCommands() from @heytutor/drawing successfully parses MOCK_RESPONSES[0].response. ERASE command detected with params [180,400,300,60] and correct narration. All 6 commands parsed in correct order: DRAW_CUBOID, WRITE, ERASE, DRAW_CUBE, WRITE, WRITE.
- Task 1 parser already supports ERASE (DrawCommandType includes 'ERASE', regex patterns include ERASE in both drawingProtocol.ts and incrementalParser.ts).

### Typecheck status
- `pnpm typecheck --filter @heytutor/tutor-core` FAILS due to a pre-existing error in audioSync.ts (line 145): `DrawingDurations` interface is missing `ERASE` property. This is from Task 1 adding `ERASE` to `DrawCommandType` without updating `DrawingDurations` in audioSync.ts.
- This is NOT caused by Task 2 changes (string-only edits to systemPrompt.ts and mockResponses.ts).
- Task 2 is forbidden from editing audioSync.ts per task constraints. The fix belongs to Task 1 or a follow-up: add `ERASE: number;` to `DrawingDurations` interface and `ERASE: 200` to `DEFAULT_DRAWING_DURATIONS`.

### Evidence files created
- .omo/evidence/task-2-prompt-has-erase.txt
- .omo/evidence/task-2-mock-has-erase.txt
- .omo/evidence/task-2-mock-erase-parses.txt

## 2026-06-23 — Task 3: eraseRegion() + duster cursor + animated clearBoard()

### What was done
- Added `"erasing"` to `CursorState` type union.
- Imported `Rect` from `react-konva` (alongside existing `Layer`, `Path`, `Stage`).
- Added duster constants: `DUSTER_WIDTH=28`, `DUSTER_HEIGHT=14`, `DUSTER_COLOR="#D4CDBE"`, `DUSTER_STROKE="#B8B0A0"`, `DUSTER_CORNER_RADIUS=3`.
- Added `eraseRegion` to `WhiteboardHandle` interface: `(x, y, width, height, duration) => Promise<void>`.
- Changed `clearBoard` interface from `() => void` to `(duration?: number) => Promise<void>`.
- Added `activeCursorStateRef` (useRef) synchronized with `activeCursorState` via `updateCursorState` wrapper and `useEffect` on `cursorState` prop.
- Added `destroyNodesInRect` helper: iterates a `Set<Konva.Node>`, destroys and removes nodes whose `getClientRect()` intersects a given rectangular region (AABB intersection test).
- Implemented `eraseRegion` as async `useCallback`:
  1. Saves previous cursor state from `activeCursorStateRef`.
  2. Sets cursor state to `"erasing"` via `updateCursorState`.
  3. Flies to `(x, y + height/2)` using `flyCursorTo` with 30% of total duration.
  4. Sweeps left-to-right via `animateOver` with remaining 70% of duration.
  5. At each frame, destroys completed and anim nodes intersecting the erased-so-far sub-rectangle.
  6. Batch draws draw/anim/cursor layers each frame.
  7. Restores prior cursor state.
- Upgraded `clearBoard` to async with duration path:
  - If `duration > 0`: sets erasing state, flies to `(50, height/2)`, sweeps full board width, progressively destroys nodes, restores state.
  - If no duration/0: preserves existing instant clear behavior (`clearTrackedNodes` + batch draw).
- Conditionally renders duster `Rect` on cursor layer when `activeCursorState === "erasing"`; otherwise renders inline `Line` triangle (not `VirtualCursor`).
- Updated `useImperativeHandle` to expose `eraseRegion` and async `clearBoard`; replaced `setCursorState: setActiveCursorState` with `setCursorState: updateCursorState`.

### Verification results
- `pnpm typecheck --filter @heytutor/whiteboard`: PASS (2/2 tasks, 0 errors).
- `pnpm build --filter @heytutor/whiteboard`: PASS (2/2 tasks, dist/index.js 23.22 KB, dist/index.d.ts 2.00 KB).
- LSP diagnostics on Whiteboard.tsx: clean (no errors/warnings/hints).
- Grep evidence confirms all new symbols present: `Rect` import, `"erasing"` in CursorState, `eraseRegion` in interface, duster constants, `activeCursorStateRef`, `destroyNodesInRect`, `updateCursorState`, conditional duster Rect rendering.
- VirtualCursor.tsx was NOT modified.
- Browser QA deferred to Task 5 integration (whiteboard not yet wired into tutor app page).

### Evidence files created
- `.omo/evidence/task-3-grep-erase-region.txt`
- `.omo/evidence/task-3-typecheck.txt`
- `.omo/evidence/task-3-build.txt`

## 2026-06-23 — Task 3 fix: restore inline Line triangle, remove VirtualCursor

### What was fixed
- Removed `VirtualCursor` import and usage from Whiteboard.tsx. Non-erasing cursor now uses inline `Line` triangle with `CURSOR_TRIANGLE_POINTS = [0, 0, -8, 20, 8, 20]`.
- Added `Line` to `react-konva` imports.
- Updated visual constants to pre-task style: `WHITEBOARD_COLOR = "#F8F6F0"`, `INK_COLOR = "#222222"`, `CURSOR_BLUE = "#3380FF"`.
- Added `CURSOR_TRIANGLE_POINTS` constant.
- Added `if (state === "erasing") return 0.95;` to `cursorOpacity()`.
- Added `shadowColor="#999999"`, `shadowBlur={10}`, `shadowOpacity={0.4}` to duster `Rect`.
- All eraser methods (`eraseRegion`, `destroyNodesInRect`, async `clearBoard`, `activeCursorStateRef`, `updateCursorState`) preserved unchanged.

### Verification results (fix)
- `pnpm typecheck --filter @heytutor/whiteboard`: PASS (exit 0).
- `pnpm build --filter @heytutor/whiteboard`: PASS (exit 0, dist/index.js 23.71 KB).
- Grep confirms: no `VirtualCursor` references, `Line` imported, inline triangle with `CURSOR_TRIANGLE_POINTS`, duster `Rect` with `shadowColor="#999999"`, correct visual constants.
- `VirtualCursor.tsx` was NOT modified.
- Browser QA still deferred to Task 5.

### Evidence files updated
- `.omo/evidence/task-3-grep-erase-region.txt`
- `.omo/evidence/task-3-typecheck.txt`
- `.omo/evidence/task-3-build.txt`

## 2026-06-23 — F2: Code Quality Review (read-only)

### Verdict
Build PASS | Lint FAIL (pre-existing: eslint not installed) | Tests N/A | Files 7 clean/0 issues | VERDICT: PASS

### Build gates
- `pnpm typecheck`: PASS (exit 0, 10/10 tasks, FULL TURBO). DrawingDurations.ERASE gap is resolved (interface has `ERASE: number`, default `ERASE: 1500`).
- `pnpm lint`: FAIL (exit 1) — `eslint: command not found` in every package that runs its lint script. Pre-existing environment issue (eslint binary not installed), NOT caused by eraser changes. No lint rules actually evaluated.
- `pnpm build`: PASS (exit 0, 6/6 tasks). next build "Compiled successfully" + Next's bundled type/lint check passed; vite + tsup builds OK.
- Tests: N/A (no test suites in scope).

### File review (all 7 CLEAN)
- drawingProtocol.ts, incrementalParser.ts: only narrow `rawType as DrawCommandType` regex-capture assertions (safe, not `as any`).
- systemPrompt.ts: pure string. mockResponses.ts: data + pure fn.
- Whiteboard.tsx: the `catch {` (~L453) is the textToStrokePaths fallback (renders Konva.Text) — non-empty, legitimate. All imports used.
- audioSync.ts: ERASE case uses correct `[, , eraseWidth, eraseHeight]` destructuring.
- page.tsx: 2x `console.error` (L529 segment-fail, L890 turn-error) = intentional error logging; several `catch { // ignore }` around localStorage/best-effort fetch = deliberate defensive pattern with comments. Not smells.

### Grep sweep (7 files): as any (none), @ts-ignore (none), console.log (none), empty catch braces (none), eslint-disable (none), TODO/FIXME/HACK/XXX (none), debugger (none).

### ERASE regression check
`parseDrawingCommands('[DRAW_CUBOID...][DRAW_CUBE...][DRAW_RECT...][DRAW_CIRCLE...][DRAW_LINE...][WRITE...][LABEL...][PAUSE...][CLEAR][ERASE:1,2,3,4]')` → `10 DRAW_CUBOID,DRAW_CUBE,DRAW_RECT,DRAW_CIRCLE,DRAW_LINE,WRITE,LABEL,PAUSE,CLEAR,ERASE` (exit 0). All 10 commands parse in order; ERASE does not regress existing parsing.

### Evidence file
- `.omo/evidence/f2-code-quality.txt`

## 2026-06-23 — F1: Plan Compliance Audit (read-only)

### Verdict
Must Have [10/10] | Must NOT Have [9/9] | Tasks [5/5] | VERDICT: APPROVE

### Must Have — all 10 verified at file:line
1. ERASE in DrawCommandType (drawingProtocol.ts:11) + regex (L28) + page.tsx [x,y,w,h] destructure.
2. Duster Rect (Whiteboard.tsx:617-635, beige #D4CDBE) vs blue Line triangle (L636-656).
3. Left-to-right sweep: animateOver with sweepX = x + regionWidth * progress (L504-505).
4. destroyNodesInRect AABB via getClientRect() (L246-262), called on completed+anim sets (L509-510).
5. eraseRegion on WhiteboardHandle: interface L27, impl L487-520, handle L592.
6. clearBoard async (duration?) L522-563 — duster sweep when duration>0, instant fallback else.
7. systemPrompt.ts ERASE (L31), description (L35), no-overwrite rule (L37), sync pacing (L44).
8. incrementalParser.ts ERASE in TAG_NAMES (L17) + COMPLETE_TAG_PATTERN (L21).
9. audioSync.ts ERASE: interface L120, default L136, area-scaled case L146-150, flight 500 L160.
10. page.tsx case "ERASE" L321-335 + CLEAR awaits clearBoard L318.

### Must NOT Have — all 9 absent (0 forbidden patterns)
1. No user erasing — eraseRegion only called inside executeCommand AI switch (page.tsx:326), no event handlers.
2. No collision/overlap detection — grep collision|overlap|intersect = 0; destroyNodesInRect is erase mechanism, not no-overwrite (prompt-only).
3. No new API routes — api/ = board-name,chat,trace/event,tts,tts/stream (all pre-existing).
4. No DB — grep prisma|drizzle|mongoose|sequelize|typeorm = 0; localStorage ephemeral.
5. No WS relay change — server.ts pure ElevenLabs TTS relay, 0 erase refs.
6. No new deps — duster uses existing react-konva Rect; all package.json unchanged.
7. No landing change — grep ERASE|erase|duster in apps/landing = 0.
8. No removed commands — all 9 DrawCommandType + 4 CursorState originals retained.
9. No VirtualCursor.tsx change — pure chalk cursor, duster inlined in Whiteboard.tsx.

### Build gates (independently confirmed)
- typecheck: PASS (10/10, exit 0; tutor cache-miss re-executed clean).
- build: PASS (6/6, exit 0; /c/[sessionId] 42.7 kB).
- lint: FAIL — pre-existing eslint-binary-missing env issue, orthogonal to eraser work.

### Evidence
- 15/15 bash/grep evidence files present.
- 4 Playwright PNGs absent (task-3/task-5 e2e screenshots) — owned by F3 (Real Manual QA → final-qa/), outside F1 scope. Non-blocking.
- Verdict written to `.omo/evidence/f1-plan-compliance.txt`.

## 2026-06-23 — F4: Scope Fidelity Check (read-only)

### Verdict
Tasks [5/5 compliant] | Contamination [CLEAN] | Unaccounted [CLEAN] | VERDICT: PASS

### Method
Repo is NOT git, so "what changed" was reconstructed from mtimes. Baseline =
bulk checkout 2026-06-22 23:21:00. Eraser window = 2026-06-23 02:13–02:43 (from
task-N evidence timestamps). Positive 1:1 by reading all 7 targets; contamination
by whole-tree grep of eraseRegion|ERASE|duster|DUSTER|erasing|eraser.

### 1:1 results (all 5 tasks match spec)
- T1 drawingProtocol.ts (L11,L28) + incrementalParser.ts (L17,L21) — exact.
- T2 systemPrompt.ts (L31/35/37/44) + mockResponses.ts (L6 cuboid ERASE, L33 erase mock) — exact.
- T3 Whiteboard.tsx only (duster consts L55-59, eraseRegion L487, destroyNodesInRect L246, conditional Rect/Line L617/638, no VirtualCursor) — exact + documented inline-triangle fix.
- T4 audioSync.ts (L120/136/146-150/160) — `[, , eraseWidth, eraseHeight]` + explicit flight 500 are documented acceptance-driven corrections.
- T5 c/[sessionId]/page.tsx ERASE case L321-335 + CLEAR await L318 — byte-for-byte spec snippet.

### Contamination = CLEAN
Eraser markers appear ONLY in the 7 target src files (+ regenerated dist/). Zero
leak into landing, other tutor files, shapePaths/VirtualCursor/SpeakingWaveform/
ThinkingSpinner (all 4 forbidden-unchanged files predate the window: shapePaths
06-22 02:45, VirtualCursor 06-22 17:45, Waveform/Spinner 06-22 02:45).

### Guardrails (eraser plan)
no landing eraser code (0), no new deps (no package.json touched in window;
duster uses existing react-konva Rect), no new API routes (all 5 predate window),
no user-controlled erasing (eraseRegion only in executeCommand AI dispatch — no
onClick), no code-level no-overwrite detection (destroyNodesInRect is the erase
mechanism only), VirtualCursor.tsx intact.

### Unaccounted (disclosure, not eraser contamination)
12 files modified in the same wall-clock window contain ZERO eraser content and
belong to CONCURRENT workstreams (session routing + landing redesign + tokens):
InputBar.tsx, landing Hero/DashboardMockup/Navbar/Logo, tutor app/page.tsx (now
59-line redirect stub), server.ts, layout.tsx, BoardHistory.tsx, designTokens.ts,
landing tailwind.config.js, ResponseBubble.tsx. The eraser plan introduced no
eraser code into any of them. Benign note: page.tsx L110 clearBoard() is a
session-switch reset using the preserved instant-clear path (not eraseRegion).

### Evidence
- `.omo/evidence/f4-scope-fidelity.txt`
