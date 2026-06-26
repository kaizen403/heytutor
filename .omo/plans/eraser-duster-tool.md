# Eraser/Duster Tool for Whiteboard

## TL;DR

> **Quick Summary**: Add an AI-controlled eraser/duster tool that can erase specific regions of the whiteboard (new `ERASE` command) and upgrade the existing `CLEAR` command with a duster wipe animation. The cursor morphs into a duster shape during erasing. The AI is taught via system prompt to erase before drawing in occupied space instead of overwriting.
>
> **Deliverables**:
> - New `ERASE:x,y,width,height` drawing command recognized by the parser
> - Duster cursor visual (rounded rectangle) that replaces the marker during erasing
> - `eraseRegion()` method on WhiteboardHandle with sweep animation
> - Upgraded `clearBoard()` with optional duster wipe animation
> - Updated system prompt teaching the AI when and how to erase
> - Updated mock responses demonstrating the eraser
> - All wiring in page.tsx to execute ERASE commands
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 → Task 3 → Task 5 → F1-F4

---

## Context

### Original Request
User wants an eraser/duster tool for the AI whiteboard tutor. The AI should intelligently decide when to erase content, using a duster cursor visual (like a real whiteboard duster). The eraser should work like the drawing tools — AI embeds erase commands in its response, the cursor flies to the location, morphs into a duster, and wipes the area. No overwriting should occur — the AI should erase before drawing in occupied space.

### Interview Summary
**Key Discussions**:
- Erase scope: BOTH — new `ERASE:x,y,width,height` for region erasing + upgrade `CLEAR` with duster animation
- No-overwrite enforcement: PROMPT ONLY — teach AI via system prompt, no code-level collision detection

**Research Findings**:
- Whiteboard has 3 Konva layers (draw/anim/cursor) with `completedNodesRef` tracking finished nodes
- Cursor is a blue triangle (`Line` component) rendered inline on the cursor layer
- `CursorState` = "idle" | "thinking" | "speaking" | "drawing" — needs "erasing" added
- Drawing commands use `[COMMAND:params]` format, parsed by `IncrementalTagParser`
- `executeCommand()` in page.tsx handles each command type via switch statement
- `audioSync.ts` has duration calculations per command type
- No test framework exists — CI runs only `lint typecheck build`

---

## Work Objectives

### Core Objective
Add an AI-controlled eraser tool that wipes specific whiteboard regions with a duster cursor visual, and teach the AI to erase before drawing in occupied space instead of overwriting.

### Concrete Deliverables
- `ERASE` command type in drawing protocol + parser recognition
- `eraseRegion()` method on `WhiteboardHandle` with sweep animation + node destruction
- Duster cursor visual (rounded rectangle, warm beige color) on cursor layer
- Upgraded `clearBoard()` with optional animated duster wipe
- Updated system prompt with eraser instructions and no-overwrite rule
- Updated mock responses demonstrating the eraser
- `ERASE` case in `executeCommand()` switch in page.tsx
- `ERASE` duration calculations in audioSync.ts

### Definition of Done
- [ ] `pnpm typecheck` passes with zero errors
- [ ] `pnpm lint` passes with zero errors
- [ ] `pnpm build` succeeds for all packages and apps
- [ ] ERASE command parses correctly from LLM stream (IncrementalTagParser)
- [ ] Duster visual appears when cursor is in "erasing" state
- [ ] Erase animation sweeps left-to-right across specified region
- [ ] Konva nodes within the erase region are destroyed after sweep
- [ ] CLEAR command uses duster animation when duration is provided
- [ ] System prompt teaches AI about ERASE command and no-overwrite rule
- [ ] Mock responses include ERASE command demonstrations

### Must Have
- New `ERASE` command with `x,y,width,height` params
- Duster cursor visual distinct from the marker triangle
- Erase animation that visually sweeps the duster across the region
- Node destruction via bounding-box intersection (`getClientRect()`)
- `eraseRegion()` on `WhiteboardHandle` interface
- `clearBoard()` upgraded to support animated duster wipe
- System prompt updated with eraser command syntax + no-overwrite rule
- `IncrementalTagParser` recognizes `ERASE` tag in streaming LLM output
- `audioSync.ts` duration calculations for ERASE
- `page.tsx` `executeCommand()` handles ERASE case

### Must NOT Have (Guardrails)
- No user-controlled manual erasing — this is AI-controlled only
- No code-level collision/overlap detection — no-overwrite is prompt-enforced only
- No new API endpoints — erasing is entirely client-side
- No database/persistence changes — board state remains ephemeral
- No changes to the WebSocket TTS relay or LLM proxy routes
- No new npm dependencies — use existing Konva primitives
- No changes to the landing app (`apps/landing`)
- No removal of existing drawing commands or cursor states
- No changes to `VirtualCursor.tsx` — the duster is rendered inline in `Whiteboard.tsx` (same pattern as the existing marker triangle)

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: NO
- **Automated tests**: NO (no test framework in project)
- **Framework**: none
- **Agent-Executed QA**: ALWAYS (mandatory for all tasks)

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.omo/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Use Playwright (playwright skill) - Navigate, interact, assert DOM, screenshot
- **Library/Module**: Use Bash (bun/node REPL) - Import, call functions, compare output
- **Build**: Use Bash - Run pnpm typecheck/lint/build, assert exit code 0

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — foundation, no deps):
├── Task 1: Drawing protocol — add ERASE command type + parser [quick]
└── Task 2: System prompt + mock responses update [quick]

Wave 2 (After Wave 1 — core implementation, depends on Task 1):
├── Task 3: Whiteboard eraseRegion() + duster cursor + animations [deep]
└── Task 4: Audio sync durations for ERASE [quick]

Wave 3 (After Wave 2 — integration, depends on all):
└── Task 5: Wire ERASE into page.tsx executeCommand() [unspecified-high]

Wave FINAL (After ALL tasks — 4 parallel reviews):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Task 1 → Task 3 → Task 5 → F1-F4
Parallel Speedup: ~40% faster than sequential
Max Concurrent: 2 (Waves 1 & 2)
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| 1 | None | 3, 4, 5 |
| 2 | None | 5 |
| 3 | 1 | 5 |
| 4 | 1 | 5 |
| 5 | 1, 2, 3, 4 | F1-F4 |
| F1-F4 | 5 | None |

### Agent Dispatch Summary

- **Wave 1**: 2 tasks — T1 → `quick`, T2 → `quick`
- **Wave 2**: 2 tasks — T3 → `deep`, T4 → `quick`
- **Wave 3**: 1 task — T5 → `unspecified-high`
- **FINAL**: 4 tasks — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. Add ERASE command type to drawing protocol + parser

  **What to do**:
  - In `packages/drawing/src/drawingProtocol.ts`:
    - Add `'ERASE'` to the `DrawCommandType` union type (after `'CLEAR'`)
    - Add `ERASE` to the `DRAWING_TAG_PATTERN` regex — append `|ERASE` to the alternation group: `/\[(DRAW_CUBOID|DRAW_CUBE|DRAW_RECT|DRAW_CIRCLE|DRAW_LINE|WRITE|LABEL|PAUSE|CLEAR|ERASE)(?::([^\]]*))?\]/g`
  - In `packages/drawing/src/incrementalParser.ts`:
    - Add `'ERASE'` to the `TAG_NAMES` array (after `'CLEAR'`)
    - Add `ERASE` to the `COMPLETE_TAG_PATTERN` regex: `/^\[(DRAW_CUBOID|DRAW_CUBE|DRAW_RECT|DRAW_CIRCLE|DRAW_LINE|WRITE|LABEL|PAUSE|CLEAR|ERASE)(?::([^\]]*))?\]$/`
  - ERASE uses numeric params (x, y, width, height) — the existing `parseNumericParams` function in `drawingProtocol.ts` already handles this (same as DRAW_CUBOID etc.), so no new param parser needed
  - No changes needed to `parsedResponseToSegments` or `TutorSegment` — ERASE flows through the same segment pipeline as other commands

  **Must NOT do**:
  - Do not change existing command parsing behavior
  - Do not add new exported functions — ERASE reuses existing `parseDrawCommandFromTag` with `parseNumericParams`
  - Do not modify `shapePaths.ts` — ERASE has no SVG path generation

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Two files, small regex + type union additions, mechanical change
  - **Skills**: []
    - No skills needed — pure TypeScript type + regex edit

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Tasks 3, 4, 5
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References** (existing code to follow):
  - `packages/drawing/src/drawingProtocol.ts:1-10` — `DrawCommandType` union type (add ERASE here)
  - `packages/drawing/src/drawingProtocol.ts:26-27` — `DRAWING_TAG_PATTERN` regex (add ERASE to alternation)
  - `packages/drawing/src/drawingProtocol.ts:29-38` — `parseNumericParams()` function (ERASE reuses this — no changes needed)
  - `packages/drawing/src/drawingProtocol.ts:62-80` — `parseDrawCommandFromTag()` function (handles non-WRITE/LABEL types via parseNumericParams — ERASE flows through automatically)
  - `packages/drawing/src/incrementalParser.ts:7-17` — `TAG_NAMES` array (add ERASE here)
  - `packages/drawing/src/incrementalParser.ts:19-20` — `COMPLETE_TAG_PATTERN` regex (add ERASE here)

  **WHY Each Reference Matters**:
  - The `DrawCommandType` union is the type system entry point — ERASE must be here for TypeScript to accept it
  - The `DRAWING_TAG_PATTERN` regex drives `parseDrawingCommands()` which parses complete response text — without ERASE here, tags like `[ERASE:100,100,300,200]` would be treated as narration text
  - The `TAG_NAMES` array drives `couldBeTagPrefix()` in the incremental parser — without ERASE here, the streaming parser would flush `[ERASE:...` as narration instead of buffering it as a tag
  - The `COMPLETE_TAG_PATTERN` regex validates buffered tags — without ERASE here, complete `[ERASE:...]` tags would be treated as narration

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: ERASE tag parses correctly in full response text
    Tool: Bash (node -e)
    Preconditions: packages/drawing has been built (pnpm build --filter @heytutor/drawing) or use tsx
    Steps:
      1. Run: npx tsx -e "import { parseDrawingCommands } from './packages/drawing/src/index'; const r = parseDrawingCommands('erase this area [ERASE:100,100,300,200] then draw'); console.log(JSON.stringify({ cmdCount: r.commands.length, type: r.commands[0]?.type, params: r.commands[0]?.params, narration: r.narration }))"
      2. Assert output contains: cmdCount=1, type="ERASE", params=[100,100,300,200]
      3. Assert narration contains "erase this area" and "then draw" (text before and after tag)
    Expected Result: `{"cmdCount":1,"type":"ERASE","params":[100,100,300,200],"narration":"erase this area\nthen draw"}`
    Failure Indicators: cmdCount=0 (tag not recognized), type undefined, params empty
    Evidence: .omo/evidence/task-1-erase-parse-full.txt

  Scenario: ERASE tag parses incrementally via IncrementalTagParser
    Tool: Bash (node -e with tsx)
    Preconditions: packages/drawing source accessible
    Steps:
      1. Run: npx tsx -e "import { IncrementalTagParser } from './packages/drawing/src/index'; const segments: any[] = []; const p = new IncrementalTagParser({ onSegmentReady: (s) => segments.push(s) }); p.push('erase now [ERASE:50,50,200,100] done'); p.flush(); console.log(JSON.stringify(segments.map(s => ({ narration: s.narration, cmdType: s.command?.type, cmdParams: s.command?.params }))))"
      2. Assert 2 segments: first with narration "erase now" and command type ERASE params [50,50,200,100], second with narration "done" and no command
    Expected Result: `[{"narration":"erase now","cmdType":"ERASE","cmdParams":[50,50,200,100]},{"narration":"done","cmdType":undefined,"cmdParams":undefined}]`
    Failure Indicators: ERASE tag appears as narration text instead of parsed command
    Evidence: .omo/evidence/task-1-erase-parse-incremental.txt

  Scenario: Existing commands still parse after ERASE addition
    Tool: Bash (node -e with tsx)
    Preconditions: packages/drawing source accessible
    Steps:
      1. Run: npx tsx -e "import { parseDrawingCommands } from './packages/drawing/src/index'; const r = parseDrawingCommands('draw [DRAW_RECT:10,20,100,50] then [WRITE:hello,200,200] then [CLEAR]'); console.log(JSON.stringify({ count: r.commands.length, types: r.commands.map(c => c.type) }))"
      2. Assert count=3, types=["DRAW_RECT","WRITE","CLEAR"]
    Expected Result: `{"count":3,"types":["DRAW_RECT","WRITE","CLEAR"]}`
    Failure Indicators: Any existing command type missing or count != 3
    Evidence: .omo/evidence/task-1-existing-commands-still-parse.txt
  ```

  **Commit**: YES (groups with Task 2)
  - Message: `feat(drawing): add ERASE command type to drawing protocol`
  - Files: `packages/drawing/src/drawingProtocol.ts`, `packages/drawing/src/incrementalParser.ts`
  - Pre-commit: `pnpm typecheck --filter @heytutor/drawing`

- [x] 2. Update system prompt with eraser instructions + mock responses

  **What to do**:
  - In `packages/tutor-core/src/systemPrompt.ts`:
    - Add `[ERASE:x,y,width,height]` to the "available commands" list (after CLEAR)
    - Add a description: "erase removes everything inside the rectangular region. use it before drawing in an area that already has content — never draw on top of existing shapes or text."
    - Add a no-overwrite rule to the rules section: "never overwrite existing drawings or text. if you need to use an area that already has content, erase it first with an ERASE command, then draw there. the board is big — prefer finding empty space over erasing, but erase when you need to reuse an area."
    - Add sync pacing note: "treat ERASE like any other drawing command — say what you're about to erase, then place the ERASE command."
  - In `packages/tutor-core/src/mockResponses.ts`:
    - Add ERASE commands to the existing cuboid mock response to demonstrate erasing. Update the response to erase the formula before writing the cube volume:
      ```
      so let's draw a cuboid with length ten, width eight, and height six. [DRAW_CUBOID:200,150,300,200,80]
      the volume of a cuboid is length times width times height. [WRITE:V = l x w x h,200,420]
      now let me erase the formula to make room for the cube. [ERASE:180,400,300,60]
      now let's draw a cube inside the cuboid. [DRAW_CUBE:350,180,140]
      the volume of a cube is side cubed. so if the side is five, that's five cubed, which is one hundred twenty-five. [WRITE:V = s^3 = 125,350,420]
      the difference is the cuboid volume minus the cube volume. [WRITE:difference = V1 - V2,200,480]
      ```
    - Optionally add a new mock response with keywords `['erase', 'clear', 'reuse', 'new problem', 'wipe']` that demonstrates a full erase-and-redraw cycle

  **Must NOT do**:
  - Do not change the AI persona rules (lowercase, casual, no "simply"/"just", etc.)
  - Do not remove or alter existing command descriptions
  - Do not change the sync pacing rules — only add ERASE to them
  - Do not make mock responses too long — keep them concise

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Text-only edits to a prompt string and mock data array, no complex logic
  - **Skills**: []
    - No skills needed — text editing

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: Task 5
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References** (existing code to follow):
  - `packages/tutor-core/src/systemPrompt.ts:1-37` — Full system prompt. The "available commands" section (lines 18-27) lists all commands — add ERASE here. The "rules" section (lines 3-11) has behavioral rules — add no-overwrite rule here. The "sync pacing" section (lines 33-36) has pacing rules — add ERASE note here.
  - `packages/tutor-core/src/mockResponses.ts:1-41` — Mock responses array. The cuboid response (lines 3-8) is the best candidate to add an ERASE demonstration. Follow the same format: narration text with embedded `[COMMAND:params]` tags.

  **WHY Each Reference Matters**:
  - The system prompt is the AI's instruction set — without ERASE listed, the AI will never use it. The no-overwrite rule is the enforcement mechanism the user chose (prompt-only, no code-level detection).
  - Mock responses provide the demo-mode experience when no API keys are configured. Without ERASE in mocks, the eraser can't be tested without a real LLM response.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: System prompt contains ERASE command and no-overwrite rule
    Tool: Bash (grep)
    Preconditions: File exists at packages/tutor-core/src/systemPrompt.ts
    Steps:
      1. Run: grep -c "ERASE" packages/tutor-core/src/systemPrompt.ts
      2. Assert count >= 2 (command listing + at least one rule mention)
      3. Run: grep -c "overwrite" packages/tutor-core/src/systemPrompt.ts
      4. Assert count >= 1 (no-overwrite rule present)
    Expected Result: ERASE count >= 2, overwrite count >= 1
    Failure Indicators: ERASE not found, or "overwrite" rule missing
    Evidence: .omo/evidence/task-2-prompt-has-erase.txt

  Scenario: Mock response contains ERASE command
    Tool: Bash (grep)
    Preconditions: File exists at packages/tutor-core/src/mockResponses.ts
    Steps:
      1. Run: grep -c "ERASE" packages/tutor-core/src/mockResponses.ts
      2. Assert count >= 1 (at least one mock response uses ERASE)
    Expected Result: count >= 1
    Failure Indicators: No ERASE in any mock response
    Evidence: .omo/evidence/task-2-mock-has-erase.txt

  Scenario: Mock response with ERASE parses correctly
    Tool: Bash (node -e with tsx)
    Preconditions: packages/drawing Task 1 is complete
    Steps:
      1. Run: npx tsx -e "import { parseDrawingCommands } from './packages/drawing/src/index'; import { MOCK_RESPONSES } from './packages/tutor-core/src/index'; const r = parseDrawingCommands(MOCK_RESPONSES[0].response); const hasErase = r.commands.some(c => c.type === 'ERASE'); console.log(JSON.stringify({ totalCommands: r.commands.length, hasErase, types: r.commands.map(c => c.type) }))"
      2. Assert hasErase === true
      3. Assert totalCommands >= 4 (original commands + ERASE)
    Expected Result: `{"totalCommands":N,"hasErase":true,"types":["DRAW_CUBOID","WRITE","ERASE","DRAW_CUBE","WRITE","WRITE"]}`
    Failure Indicators: hasErase=false, or parsing fails
    Evidence: .omo/evidence/task-2-mock-erase-parses.txt
  ```

  **Commit**: YES (groups with Task 1)
  - Message: `feat(tutor-core): update system prompt with eraser + no-overwrite rule`
  - Files: `packages/tutor-core/src/systemPrompt.ts`, `packages/tutor-core/src/mockResponses.ts`
  - Pre-commit: `pnpm typecheck --filter @heytutor/tutor-core`

- [x] 5. Wire ERASE command into page.tsx executeCommand()

  **What to do**:
  - In `apps/tutor/app/page.tsx`:
    - **Add ERASE case to executeCommand() switch statement** (after the CLEAR case, ~line 161):
      ```typescript
      case "ERASE": {
        const [x, y, w, h] = command.params;
        if ([x, y, w, h].every(Number.isFinite)) {
          await wb.flyCursorTo(x, y, scaledDuration(getFlightDuration(command)));
          if (cancelRef.current) return;
          await wb.eraseRegion(
            x,
            y,
            w,
            h,
            scaledDuration(getDrawingDuration(command)),
          );
        }
        break;
      }
      ```
      This follows the exact same pattern as DRAW_RECT, DRAW_CIRCLE, etc. — fly to the region, then execute the erase.
    - **Update CLEAR case to use animated clearBoard()**:
      Change from:
      ```typescript
      case "CLEAR": {
        wb.clearBoard();
        break;
      }
      ```
      To:
      ```typescript
      case "CLEAR": {
        await wb.clearBoard(scaledDuration(getDrawingDuration(command)));
        break;
      }
      ```
      This makes CLEAR use the duster wipe animation. The `await` is safe because `executeCommand` is already async.
    - **No changes needed to cursorState mapping**: The `cursorState` variable on line 64-69 maps `TutorPhase` to `CursorState`. During ERASE execution, the Whiteboard component internally manages its cursor state via `eraseRegion()` (it calls `setActiveCursorState("erasing")` internally and reverts after). The page-level `cursorState` prop still passes "drawing" (since phase is "speaking" or "drawing" during execution), but the Whiteboard's internal state overrides the visual during the erase sweep. This is the same pattern as `drawShape()` which also manages cursor position internally.
    - **No changes needed to TutorPhase**: The phase stays "speaking" or "drawing" during ERASE — the user sees "teaching..." in the status, which is correct. The duster visual on the cursor is the feedback that erasing is happening.
    - **No changes needed to imports**: `getDrawingDuration` and `getFlightDuration` are already imported from `@heytutor/tutor-core` on line 27-28. `DrawCommand` type is already imported from `@heytutor/drawing` on line 14.

  **Must NOT do**:
  - Do not add "erasing" to `TutorPhase` — the Whiteboard handles cursor morphing internally
  - Do not add new imports — everything needed is already imported
  - Do not change the `cursorState` mapping or `statusConfig` — "teaching..." is the correct status during erasing
  - Do not modify `handleQuestion()`, `runSegment()`, `enqueueSegment()`, or `processResponseText()` — the ERASE command flows through the same segment pipeline as all other commands
  - Do not add error handling specific to ERASE — the existing `cancelRef.current` check and `Number.isFinite` validation (same as all draw commands) is sufficient

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Integration task that touches the main orchestration file. While the changes are small (2 switch cases), this file is 627 lines and the executor needs to understand the command flow to avoid breaking it.
  - **Skills**: []
    - No skills needed — mechanical code integration

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (sequential — depends on all prior tasks)
  - **Blocks**: F1-F4 (Final Verification Wave)
  - **Blocked By**: Tasks 1, 2, 3, 4 (needs ERASE type, eraseRegion method, duration calculations, all in place)

  **References**:

  **Pattern References** (existing code to follow):
  - `apps/tutor/app/page.tsx:71-168` — `executeCommand()` function with switch statement. The ERASE case goes after CLEAR (line 161-164). Follow the exact same pattern as DRAW_RECT (lines 104-115): destructure params, check `Number.isFinite`, call `flyCursorTo` then the action method.
  - `apps/tutor/app/page.tsx:161-164` — Current CLEAR case (`wb.clearBoard()`) — update to `await wb.clearBoard(scaledDuration(...))`
  - `apps/tutor/app/page.tsx:76-77` — `scaledDuration()` helper function — already handles speed multiplier division
  - `apps/tutor/app/page.tsx:27-33` — Import block — `getDrawingDuration` and `getFlightDuration` already imported from `@heytutor/tutor-core`

  **API/Type References**:
  - `WhiteboardHandle.eraseRegion(x, y, width, height, duration)` — new method from Task 3
  - `WhiteboardHandle.clearBoard(duration?)` — upgraded method from Task 3
  - `getDrawingDuration(command: DrawCommand): number` — returns area-scaled duration for ERASE (from Task 4)
  - `getFlightDuration(command: DrawCommand): number` — returns 500ms for ERASE (existing default)

  **WHY Each Reference Matters**:
  - `executeCommand()` is the single dispatch point for all drawing commands — ERASE must be wired here to be executed during a tutoring session
  - The `scaledDuration()` helper divides by `speedRef.current` — using it for ERASE ensures the erase animation respects the playback speed setting (1x, 1.5x, 2x, etc.)
  - The CLEAR case upgrade is needed because `clearBoard()` is now async (returns Promise) — without `await`, the next segment would start before the clear animation finishes

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: ERASE case exists in executeCommand switch
    Tool: Bash (grep)
    Preconditions: File modified at apps/tutor/app/page.tsx
    Steps:
      1. Run: grep -n "case \"ERASE\"" apps/tutor/app/page.tsx
      2. Assert match found with line number
      3. Run: grep -n "eraseRegion" apps/tutor/app/page.tsx
      4. Assert match found (the call to wb.eraseRegion)
      5. Run: grep -n "clearBoard" apps/tutor/app/page.tsx
      6. Assert the CLEAR case uses "await wb.clearBoard" (not just "wb.clearBoard()")
    Expected Result: ERASE case found, eraseRegion called, clearBoard awaited
    Failure Indicators: ERASE case missing, or clearBoard not awaited
    Evidence: .omo/evidence/task-5-grep-erase-case.txt

  Scenario: Full typecheck passes
    Tool: Bash
    Preconditions: All prior tasks complete
    Steps:
      1. Run: pnpm typecheck
      2. Assert exit code 0 (all packages + apps)
    Expected Result: Exit code 0, zero TypeScript errors across entire monorepo
    Failure Indicators: Type errors in page.tsx (eraseRegion not on WhiteboardHandle, etc.)
    Evidence: .omo/evidence/task-5-typecheck.txt

  Scenario: Full build passes
    Tool: Bash
    Preconditions: All prior tasks complete
    Steps:
      1. Run: pnpm build
      2. Assert exit code 0
    Expected Result: All packages and apps build successfully
    Failure Indicators: Build fails for tutor app or any package
    Evidence: .omo/evidence/task-5-build.txt

  Scenario: Full lint passes
    Tool: Bash
    Preconditions: All prior tasks complete
    Steps:
      1. Run: pnpm lint
      2. Assert exit code 0
    Expected Result: Zero lint errors
    Failure Indicators: ESLint errors in modified files
    Evidence: .omo/evidence/task-5-lint.txt

  Scenario: End-to-end erase works in browser (mock mode)
    Tool: Playwright (playwright skill)
    Preconditions: pnpm dev:tutor running on http://localhost:3000, no API keys needed (mock mode)
    Steps:
      1. Navigate to http://localhost:3000
      2. Wait for page load (header "heytutor" visible, whiteboard visible)
      3. Type "cuboid cube volume difference" in the input bar (triggers cuboid mock response which now has ERASE)
      4. Click the "ask" button
      5. Wait for status to change from "thinking..." to "teaching..."
      6. Watch the whiteboard: cuboid is drawn, formula is written, then ERASE executes
      7. Take a screenshot when the duster cursor appears (cursor is a rounded rectangle, not a triangle)
      8. Assert: the duster cursor is visually distinct from the marker (wider, beige color, not blue triangle)
      9. Wait for the erase sweep to complete — assert the formula text is gone from the whiteboard
      10. Wait for the cube to be drawn — assert it appears on the now-clean area
      11. Wait for status to return to "ready"
    Expected Result: Duster appears during ERASE, formula erased, cube drawn on clean area, no overwriting
    Failure Indicators: Cursor doesn't morph to duster, formula remains during cube drawing, type errors crash the page
    Evidence: .omo/evidence/task-5-e2e-erase.png

  Scenario: CLEAR command uses duster animation in browser
    Tool: Playwright (playwright skill)
    Preconditions: pnpm dev:tutor running
    Steps:
      1. Navigate to http://localhost:3000
      2. Type "rectangle area" in the input bar, click ask
      3. Wait for drawing to complete (status returns to "ready")
      4. Type "clear the board" (or any text that triggers a mock with CLEAR), click ask
      5. If no mock triggers CLEAR, type "circle radius" (circle mock doesn't have CLEAR — instead verify via a second question that the board was cleared between sessions)
      6. Alternative: Verify CLEAR animation by checking that after any mock response with CLEAR, the board is empty
      7. Take screenshot during CLEAR if duster animation is visible
    Expected Result: CLEAR uses duster sweep, board empties
    Failure Indicators: Board clears instantly without animation, or doesn't clear at all
    Evidence: .omo/evidence/task-5-clear-animation-e2e.png
  ```

  **Commit**: YES
  - Message: `feat(tutor): wire ERASE command into page executor`
  - Files: `apps/tutor/app/page.tsx`
  - Pre-commit: `pnpm typecheck && pnpm lint`


## Final Verification Wave (MANDATORY — after ALL implementation tasks)

<!-- TASKS_3_4_INSERT -->- [x] 3. Add eraseRegion() + duster cursor visual + animated clearBoard() to Whiteboard

  **What to do**:
  - In `packages/whiteboard/src/Whiteboard.tsx`:
    - **Add "erasing" to CursorState type**: Change `export type CursorState = "idle" | "thinking" | "speaking" | "drawing";` to include `"erasing"`
    - **Add duster constants** (near the existing cursor constants ~line 50):
      ```typescript
      const DUSTER_WIDTH = 28;
      const DUSTER_HEIGHT = 14;
      const DUSTER_COLOR = "#D4CDBE";
      const DUSTER_STROKE = "#B8B0A0";
      const DUSTER_CORNER_RADIUS = 3;
      ```
    - **Update cursorOpacity()**: Add `if (state === "erasing") return 0.95;` before the final `return 1;`
    - **Add activeCursorStateRef**: Add `const activeCursorStateRef = useRef<CursorState>(cursorState);` and a `useEffect` to sync it: `useEffect(() => { activeCursorStateRef.current = activeCursorState; }, [activeCursorState]);`
    - **Add eraseRegion to WhiteboardHandle interface**:
      ```typescript
      eraseRegion: (x: number, y: number, width: number, height: number, duration: number) => Promise<void>;
      ```
    - **Change clearBoard signature in WhiteboardHandle**: From `clearBoard: () => void;` to `clearBoard: (duration?: number) => Promise<void>;`
    - **Implement eraseRegion()** as a `useCallback`:
      1. Save current cursor state via `activeCursorStateRef.current` into a local variable `prevState`
      2. Call `setActiveCursorState("erasing")` — this morphs the cursor to duster visual
      3. Fly cursor to the left edge of the erase region, vertically centered: `await flyCursorTo(x, y + height / 2, 300)`
      4. Check `mountedRef.current` — return early if unmounted
      5. Sweep animation using `animateOver(duration, ...)`:
         - At each frame, compute `currentX = x + width * progress`
         - Set cursor position: `setCursorViewSafely(currentX, y + height / 2, 0, 1)`
         - Iterate `completedNodesRef.current` and destroy nodes whose `getClientRect()` intersects with the erased-so-far area (from `x` to `currentX` horizontally, `y` to `y+height` vertically):
           ```typescript
           completedNodesRef.current.forEach((node) => {
             const rect = node.getClientRect();
             if (rect.x < currentX && rect.x + rect.width > x &&
                 rect.y < y + height && rect.y + rect.height > y) {
               node.destroy();
               completedNodesRef.current.delete(node);
             }
           });
           ```
         - Also iterate `animNodesRef.current` with the same intersection check (in case drawing is in progress)
         - Call `drawLayerRef.current?.batchDraw()` and `animLayerRef.current?.batchDraw()` to reflect destroyed nodes
         - Call `cursorLayerRef.current?.batchDraw()` to update cursor position
      6. After sweep, restore cursor state: `setActiveCursorState(prevState)`
    - **Upgrade clearBoard()** to support animated duster wipe:
      - Change signature to `async (duration?: number): Promise<void>`
      - If `duration && duration > 0`: Save cursor state, set to "erasing", fly to `(50, height / 2)`, sweep across full board width using `animateOver(duration, ...)`, at each frame destroy completed and anim nodes whose `getClientRect().x < currentX`, then restore cursor state
      - If no duration (or 0): Keep the existing instant clear behavior (`clearTrackedNodes` for both anim and completed sets, then batchDraw all layers)
    - **Add duster visual to cursor layer rendering**: In the JSX for the cursor Layer, conditionally render based on `activeCursorState`:
      - If `activeCursorState === "erasing"`: Render a `Konva.Rect` (import `Rect` from `react-konva`) with:
        - `x={cursorView.x - DUSTER_WIDTH / 2}`
        - `y={cursorView.y - DUSTER_HEIGHT / 2}`
        - `width={DUSTER_WIDTH}`, `height={DUSTER_HEIGHT}`, `cornerRadius={DUSTER_CORNER_RADIUS}`
        - `fill={DUSTER_COLOR}`, `stroke={DUSTER_STROKE}`, `strokeWidth={1}`
        - `opacity={cursorOpacity(activeCursorState)}`
        - `rotation={cursorView.rotation}`, `scaleX={cursorView.scale}`, `scaleY={cursorView.scale}`
        - `shadowColor="#999999"`, `shadowBlur={10}`, `shadowOpacity={0.4}`
        - `listening={false}`
      - Else (existing behavior): Render the existing `Line` triangle with blue cursor styling
      - Use a ternary expression or if/else inside the cursor Layer JSX to switch between duster `Rect` and marker `Line`
    - **Update useImperativeHandle**: Add `eraseRegion` to the returned object, and update `clearBoard` reference. Update the dependency array to include `eraseRegion`
    - **Import Rect**: Add `Rect` to the `react-konva` import: `import { Layer, Line, Path as KonvaPath, Rect, Stage } from "react-konva";`

  **Must NOT do**:
  - Do not modify `VirtualCursor.tsx` — the duster is rendered inline in Whiteboard.tsx (same pattern as the existing marker triangle)
  - Do not add code-level overlap detection for the no-overwrite rule — that's prompt-enforced only
  - Do not change the existing marker triangle rendering for non-erasing states
  - Do not remove the instant-clear fallback (when duration is 0/undefined)
  - Do not erase nodes outside the specified erase region
  - Do not add new npm dependencies

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex implementation — new async method with animation, conditional rendering, bounding box intersection logic, state management with refs. Single file but high complexity.
  - **Skills**: []
    - No skills needed — this is Konva/React logic, not a styled UI task

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 4)
  - **Blocks**: Task 5
  - **Blocked By**: Task 1 (needs ERASE in DrawCommandType)

  **References**:

  **Pattern References** (existing code to follow):
  - `packages/whiteboard/src/Whiteboard.tsx:15` — `CursorState` type definition (add "erasing" here)
  - `packages/whiteboard/src/Whiteboard.tsx:23-33` — `WhiteboardHandle` interface (add `eraseRegion`, update `clearBoard`)
  - `packages/whiteboard/src/Whiteboard.tsx:47-62` — Cursor constants (add duster constants nearby)
  - `packages/whiteboard/src/Whiteboard.tsx:111-121` — `cursorOpacity()` function (add "erasing" case)
  - `packages/whiteboard/src/Whiteboard.tsx:123-137` — Component state setup (add `activeCursorStateRef` here)
  - `packages/whiteboard/src/Whiteboard.tsx:167-209` — `animateOver()` function (reuse for erase sweep animation)
  - `packages/whiteboard/src/Whiteboard.tsx:218-264` — `drawShape()` implementation (follow same pattern: create node on anim layer, animate, then move/cleanup)
  - `packages/whiteboard/src/Whiteboard.tsx:266-294` — `flyCursorTo()` implementation (call before sweeping)
  - `packages/whiteboard/src/Whiteboard.tsx:443-449` — `clearBoard()` current implementation (upgrade to async with optional animation)
  - `packages/whiteboard/src/Whiteboard.tsx:467-481` — `useImperativeHandle` setup (add `eraseRegion`, update `clearBoard`)
  - `packages/whiteboard/src/Whiteboard.tsx:483-513` — Cursor Layer JSX rendering (add conditional duster/marker rendering here)

  **API/Type References**:
  - Konva `Node.getClientRect()` — returns `{ x, y, width, height, visible }` relative to the stage. Used for bounding-box intersection detection during erase.
  - Konva `Rect` — `react-konva` Rect component for the duster shape. Docs: https://konvajs.org/api/Konva.Rect.html

  **WHY Each Reference Matters**:
  - `animateOver()` is the existing animation utility that drives all stroke animations — reusing it ensures the erase sweep has the same frame-rate management, cleanup, and cancellation behavior as drawing
  - `flyCursorTo()` must be called before erasing so the cursor visually travels to the erase region (same pattern as all draw commands)
  - `completedNodesRef` is the Set of finished Konva nodes — these are what get destroyed during erasing
  - `getClientRect()` is the Konva API for bounding-box intersection — it's the standard way to check if a node is within a rectangular region
  - The cursor Layer JSX is where the visual morph happens — conditional rendering based on `activeCursorState` switches between marker and duster

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Whiteboard exports eraseRegion and updated clearBoard in handle
    Tool: Bash (grep)
    Preconditions: File modified at packages/whiteboard/src/Whiteboard.tsx
    Steps:
      1. Run: grep "eraseRegion" packages/whiteboard/src/Whiteboard.tsx
      2. Assert at least 3 matches: interface declaration, implementation, useImperativeHandle
      3. Run: grep "erasing" packages/whiteboard/src/Whiteboard.tsx
      4. Assert at least 2 matches: CursorState type, cursorOpacity or rendering condition
    Expected Result: eraseRegion found in 3+ places, "erasing" found in 2+ places
    Failure Indicators: eraseRegion missing from interface or handle
    Evidence: .omo/evidence/task-3-grep-erase-region.txt

  Scenario: Typecheck passes for whiteboard package
    Tool: Bash
    Preconditions: Task 1 complete (ERASE in DrawCommandType)
    Steps:
      1. Run: pnpm typecheck --filter @heytutor/whiteboard
      2. Assert exit code 0
    Expected Result: Exit code 0, no type errors
    Failure Indicators: Type errors about missing Rect import, CursorState mismatch, eraseRegion signature
    Evidence: .omo/evidence/task-3-typecheck.txt

  Scenario: Build passes for whiteboard package
    Tool: Bash
    Preconditions: Task 1 complete
    Steps:
      1. Run: pnpm build --filter @heytutor/whiteboard
      2. Assert exit code 0, dist/index.js exists
    Expected Result: Build succeeds, dist/index.js and dist/index.d.ts generated
    Failure Indicators: tsup build fails, type errors
    Evidence: .omo/evidence/task-3-build.txt

  Scenario: Duster visual renders during erasing (browser QA)
    Tool: Playwright (playwright skill)
    Preconditions: Tutor app running (pnpm dev:tutor), API keys not required for mock mode
    Steps:
      1. Navigate to http://localhost:3000
      2. Type "draw a rectangle then erase it" in the input bar
      3. Click the "ask" button
      4. Wait for the AI to start teaching (status changes from "thinking" to "teaching")
      5. Wait for the ERASE command to execute (watch for cursor morphing from triangle to rectangle)
      6. Take a screenshot when the duster cursor is visible
      7. Assert: the cursor on the whiteboard is a rounded rectangle (duster), not a triangle (marker)
      8. Assert: after the erase sweep, the rectangle drawing is gone from the whiteboard
    Expected Result: Duster rectangle visible during erasing, rectangle shape disappears after sweep
    Failure Indicators: Cursor remains triangle during ERASE, or shapes not erased after sweep
    Evidence: .omo/evidence/task-3-duster-visual.png

  Scenario: CLEAR command uses duster animation
    Tool: Playwright (playwright skill)
    Preconditions: Tutor app running
    Steps:
      1. Navigate to http://localhost:3000
      2. Type "draw a cuboid" in the input bar, click ask
      3. Wait for drawing to complete (status returns to "ready")
      4. Type "clear the board" in the input bar, click ask
      5. Watch for CLEAR execution: cursor should fly to center, morph to duster, sweep across board
      6. Take screenshot during the sweep animation
      7. Assert: board is empty after CLEAR completes
    Expected Result: Duster sweeps across board, all content removed
    Failure Indicators: Board clears instantly without animation, or content remains
    Evidence: .omo/evidence/task-3-clear-animation.png
  ```

  **Commit**: YES
  - Message: `feat(whiteboard): add eraseRegion + duster cursor visual + animated clear`
  - Files: `packages/whiteboard/src/Whiteboard.tsx`
  - Pre-commit: `pnpm typecheck --filter @heytutor/whiteboard && pnpm build --filter @heytutor/whiteboard`

- [x] 4. Add ERASE duration calculations to audio sync

  **What to do**:
  - In `packages/tutor-core/src/audioSync.ts`:
    - **Add ERASE to DrawingDurations interface**: Add `ERASE: number;` to the interface (after `PAUSE: number;`)
    - **Add ERASE to DEFAULT_DRAWING_DURATIONS**: Add `ERASE: 1500,` to the constant (after `PAUSE: 500,`)
    - **Add ERASE case to getDrawingDuration()**: In the switch statement, add a case that scales duration with the erase area:
      ```typescript
      case "ERASE": {
        const [w, h] = command.params;
        const area = Math.abs((w ?? 0) * (h ?? 0));
        return Math.max(Math.min(Math.round(area / 50), 3000), 800);
      }
      ```
      This gives: 300x200 region → 1200ms, 600x400 region → 3000ms (capped), small 100x50 → 800ms (min)
    - **getFlightDuration()**: No change needed — the existing `return 500;` default already covers ERASE (it's not CLEAR or PAUSE)
    - **getCommandDrawDurationMs()**: No change needed — the existing logic already handles any command type via `getFlightDuration() + getDrawingDuration()`

  **Must NOT do**:
  - Do not change the CHARS_PER_SECOND or MS_PER_CHAR constants
  - Do not modify buildSyncPlan or buildSyncPlanFromTimings — they already use getDrawingDuration/getCommandDrawDurationMs generically
  - Do not change duration calculations for existing command types

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small mechanical addition — one interface field, one constant, one switch case. ~10 lines of code.
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 3)
  - **Blocks**: Task 5
  - **Blocked By**: Task 1 (needs ERASE in DrawCommandType for the switch case to be type-safe)

  **References**:

  **Pattern References**:
  - `packages/tutor-core/src/audioSync.ts:110-132` — `DrawingDurations` interface + `DEFAULT_DRAWING_DURATIONS` constant (add ERASE to both)
  - `packages/tutor-core/src/audioSync.ts:134-144` — `getDrawingDuration()` switch statement (add ERASE case)
  - `packages/tutor-core/src/audioSync.ts:146-150` — `getFlightDuration()` (no change — ERASE gets default 500ms)
  - `packages/tutor-core/src/audioSync.ts:152-166` — `getCommandDrawDurationMs()` (no change — handles ERASE generically)

  **WHY Each Reference Matters**:
  - `DrawingDurations` must include ERASE for TypeScript to accept `DEFAULT_DRAWING_DURATIONS[command.type]` as a valid lookup
  - `getDrawingDuration()` is called by `page.tsx` to compute the scaled duration for each command — without an ERASE case, it would fall to the `default` branch returning 1500ms (which is acceptable but not area-scaled)
  - `getFlightDuration()` already returns 500 for non-CLEAR/PAUSE commands, so ERASE automatically gets a 500ms flight time

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: ERASE duration scales with area
    Tool: Bash (node -e with tsx)
    Preconditions: Task 1 complete (ERASE in DrawCommandType)
    Steps:
      1. Run: npx tsx -e "import { getDrawingDuration, getFlightDuration, getCommandDrawDurationMs } from './packages/tutor-core/src/index'; const small = { type: 'ERASE' as const, params: [0,0,100,50], charPosition: 0, narrationBefore: '' }; const large = { type: 'ERASE' as const, params: [0,0,600,400], charPosition: 0, narrationBefore: '' }; console.log(JSON.stringify({ small: getDrawingDuration(small), large: getDrawingDuration(large), smallFlight: getFlightDuration(small), smallTotal: getCommandDrawDurationMs(small) }))"
      2. Assert small duration = 800 (min cap, 100x50=5000/50=100 → clamped to 800)
      3. Assert large duration = 3000 (max cap, 600x400=240000/50=4800 → clamped to 3000)
      4. Assert smallFlight = 500
      5. Assert smallTotal = 500 + 800 = 1300
    Expected Result: `{"small":800,"large":3000,"smallFlight":500,"smallTotal":1300}`
    Failure Indicators: Duration is 0, or doesn't scale with area, or TypeScript error on ERASE type
    Evidence: .omo/evidence/task-4-erase-duration.txt

  Scenario: Typecheck passes for tutor-core package
    Tool: Bash
    Preconditions: Task 1 complete
    Steps:
      1. Run: pnpm typecheck --filter @heytutor/tutor-core
      2. Assert exit code 0
    Expected Result: Exit code 0
    Failure Indicators: DrawingDurations interface missing ERASE, or switch case error
    Evidence: .omo/evidence/task-4-typecheck.txt
  ```

  **Commit**: YES
  - Message: `feat(tutor-core): add ERASE duration calculations to audio sync`
  - Files: `packages/tutor-core/src/audioSync.ts`
  - Pre-commit: `pnpm typecheck --filter @heytutor/tutor-core`



> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .omo/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `pnpm typecheck` + `pnpm lint` + `pnpm build`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check that ERASE command doesn't break existing DRAW_CUBOID/CUBE/RECT/CIRCLE/LINE/WRITE/LABEL/PAUSE/CLEAR parsing.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N/A] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  ~Skipped per user request — browser QA not performed. Build, typecheck, and parse tests all pass as automated verification.~
  Start tutor app with `pnpm dev:tutor`. Use Playwright to navigate to http://localhost:3000. Type a question that triggers erasing (e.g., "draw a rectangle then erase it and draw a circle"). Verify: duster cursor appears during erasing, nodes disappear as duster sweeps, no overwriting occurs. Test CLEAR command animation. Save screenshots to `.omo/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built, nothing beyond spec was built. Check "Must NOT do" compliance. Verify no changes to landing app, no new dependencies, no new API routes, no user-controlled erasing.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `feat(drawing): add ERASE command type to drawing protocol` — packages/drawing/src/drawingProtocol.ts, packages/drawing/src/incrementalParser.ts
- **Wave 1**: `feat(tutor-core): update system prompt with eraser + no-overwrite rule` — packages/tutor-core/src/systemPrompt.ts, packages/tutor-core/src/mockResponses.ts
- **Wave 2**: `feat(whiteboard): add eraseRegion + duster cursor visual + animated clear` — packages/whiteboard/src/Whiteboard.tsx
- **Wave 2**: `feat(tutor-core): add ERASE duration calculations to audio sync` — packages/tutor-core/src/audioSync.ts
- **Wave 3**: `feat(tutor): wire ERASE command into page executor` — apps/tutor/app/page.tsx
- Pre-commit: `pnpm typecheck && pnpm lint`

---

## Success Criteria

### Verification Commands
```bash
pnpm typecheck   # Expected: exit 0, zero errors
pnpm lint        # Expected: exit 0, zero errors
pnpm build       # Expected: exit 0, all packages built
```

### Final Checklist
- [x] All "Must Have" present
- [x] All "Must NOT Have" absent
- [x] `pnpm typecheck && pnpm build` all pass (lint pre-existing env issue)
- [x] ERASE command parses from LLM stream
- [ ] Duster visual renders during erasing (not browser-tested — skipped per user)
- [x] Nodes in erase region are destroyed (verified via code review)
- [x] CLEAR uses duster animation (verified via code review)
- [x] System prompt teaches no-overwrite rule
- [x] Mock responses demonstrate erasing
