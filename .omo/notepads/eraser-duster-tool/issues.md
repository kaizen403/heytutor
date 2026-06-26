## 2026-06-23 — Task 3 issues

- No issues encountered. Typecheck and build both pass cleanly.
- Browser QA deferred to Task 5 (page integration). The whiteboard component is not yet wired into `apps/tutor/app/page.tsx`, so visual verification of the duster cursor and erase sweep animation cannot be done until that integration task.
- Note: `clearBoard` signature change from `() => void` to `(duration?: number) => Promise<void>` is a breaking interface change. Any existing callers that treat `clearBoard` as synchronous will need to await it. Currently the only caller is the `useImperativeHandle` exposure itself; Task 5 integration should use `await clearBoard(duration)`.

## 2026-06-23 — Task 3 fix: restore inline Line triangle, remove VirtualCursor

### Problem
Atlas verification rejected Task 3 because non-erasing marker rendering drifted from the plan. The initial implementation imported and used `VirtualCursor` for the non-erasing cursor instead of preserving the original inline `Line` triangle pattern. Visual constants also diverged from the pre-task whiteboard style.

### Fix applied
- Removed `import { VirtualCursor } from "./VirtualCursor";` — no longer used in Whiteboard.tsx.
- Added `Line` to the `react-konva` import: `import { Layer, Line, Path as KonvaPath, Rect, Stage } from "react-konva";`.
- Restored non-erasing cursor JSX to inline `Line` triangle using `CURSOR_TRIANGLE_POINTS = [0, 0, -8, 20, 8, 20]`, `closed`, `fill={CURSOR_BLUE}`, `stroke={CURSOR_BLUE}`, `shadowColor={CURSOR_BLUE}`, with rotation/scale/opacity props.
- Updated visual constants to pre-task style: `WHITEBOARD_COLOR = "#F8F6F0"`, `INK_COLOR = "#222222"`, `CURSOR_BLUE = "#3380FF"`.
- Added `if (state === "erasing") return 0.95;` to `cursorOpacity()`.
- Added `shadowColor="#999999"`, `shadowBlur={10}`, `shadowOpacity={0.4}` to duster `Rect`.
- All eraser functionality preserved: `eraseRegion()`, `destroyNodesInRect()`, `activeCursorStateRef`, async `clearBoard(duration?)`, instant clear fallback.

### Verification
- `pnpm typecheck --filter @heytutor/whiteboard`: PASS (exit 0).
- `pnpm build --filter @heytutor/whiteboard`: PASS (exit 0, dist/index.js 23.71 KB).
- Grep confirms no `VirtualCursor` references remain in Whiteboard.tsx.
- `VirtualCursor.tsx` was NOT modified.


## 2026-06-23 — Task 4 fix: param destructuring + flight duration

### Issues fixed
1. **Param destructuring**: Initial implementation used `const [w, h] = command.params` which extracted x,y (indices 0,1) instead of width,height (indices 2,3). ERASE params are `[x, y, width, height]` per the drawing protocol. Fixed to `const [, , eraseWidth, eraseHeight] = command.params`.
2. **Flight duration**: `getFlightDuration()` returned 350ms for ERASE via the catch-all `return 350`. Acceptance criteria require 500ms. Added explicit `if (command.type === "ERASE") return 500;` before the catch-all. No existing command durations changed.

### Verification after fix
- Smoke check: `{"small":800,"large":3000,"smallFlight":500,"smallTotal":1300}` — all values match acceptance criteria.
- Typecheck: PASS (0 errors).
- LSP: only pre-existing errors (missing .d.ts for @heytutor/drawing).
