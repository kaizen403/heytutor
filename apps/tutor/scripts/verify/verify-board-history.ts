import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EMPTY_AI_RESPONSE_MESSAGE,
  emptyAiResponseError,
  isEmptyTutorResponse,
} from "../../features/tutor-session/hooks/turn/useTurnControl";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = resolve(import.meta.dirname, "../..");
const boardHistory = readFileSync(
  resolve(root, "features/tutor-session/components/BoardHistory.tsx"),
  "utf8",
);
// Anchor first. This block used to slice from the old trash button's marker,
// and when that control was replaced by the hover cluster `indexOf` returned
// -1, the slice went garbage, and the gate failed pointing at a lock that was
// working fine. A missing anchor must say so, not masquerade as a broken
// invariant.
const actionsStart = boardHistory.indexOf("data-row-actions");
assert(
  actionsStart > 0,
  "row-action anchor is gone; repoint this gate at the control that replaced it",
);
// Both ends, not just the start. An unguarded END anchor is the worse of the
// two: `indexOf(needle, -1)` does not throw, it searches from 0, so a renamed
// end marker silently yields a slice that starts before `actionsStart` or runs
// most of the file. The first fails with a lie; the second can fail OPEN, by
// matching the thing being asserted somewhere else entirely.
const menuAt = boardHistory.indexOf("bh__menu");
assert(
  menuAt > actionsStart,
  "row menu anchor is gone; repoint this gate at the markup that replaced it",
);
const actionsEnd = boardHistory.indexOf("</div>", menuAt);
assert(
  actionsEnd > actionsStart,
  "row-action block has no closing tag after the menu; repoint this gate",
);
const rowActions = boardHistory.slice(actionsStart, actionsEnd);

// Reaching Delete during a lesson takes two hops, so gate both. Every control
// outside the menu refuses while locked (there is one, the three dots, since
// the pin moved inside)...
const outside = (rowActions.match(/disabled=\{disabled\}/g) ?? []).length;
assert(
  outside >= 1,
  "every row action must respect the lesson lock",
);
assert(
  outside === (rowActions.match(/className="bh__row-btn"/g) ?? []).length,
  "a row action was added without the lesson lock",
);
// ...and a menu already open when the lesson starts is force-closed, so a
// student cannot reach Delete through a popover that outlived the lock.
assert(
  boardHistory.includes("if (disabled && menuBoardId)"),
  "a running lesson must close an open row menu",
);
assert(boardHistory.includes("Delete this board?"), "deleting a board must ask first");
assert(
  boardHistory.includes("if (disabled && confirmDeleteId)"),
  "a running lesson must disarm an armed delete",
);

const turnControl = readFileSync(
  resolve(root, "features/tutor-session/hooks/turn/useTurnControl.ts"),
  "utf8",
);
assert(!/no response from ai/.test(turnControl), "the silent subtitle-only error string is gone");
assert(
  isEmptyTutorResponse("", { commands: [], narration: "" }),
  "an empty lesson must be treated as no answer",
);
assert(
  !isEmptyTutorResponse("[STEP]hello[/STEP]", { commands: [], narration: "" }),
  "a STEP lesson is not empty",
);
const error = emptyAiResponseError("find v");
assert(error.message === EMPTY_AI_RESPONSE_MESSAGE, "the empty-answer copy is the banner copy");
assert(error.question === "find v", "retry must get the question that failed");
assert(
  /setLastError\(error\)/.test(turnControl) && /onError\?\.\(error\)/.test(turnControl),
  "an empty AI answer must go through the board error banner",
);
assert(
  !/isEmptyTutorResponse[\s\S]{0,220}setNarrationText/.test(turnControl),
  "an empty AI answer must not hide in narrationText",
);

console.log("board history and empty-ai-response verification passed");
