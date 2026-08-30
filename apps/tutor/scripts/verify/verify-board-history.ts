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
const deleteButton = boardHistory.slice(
  boardHistory.indexOf("data-delete-btn"),
  boardHistory.indexOf("data-delete-btn") + 420,
);
assert(deleteButton.includes("disabled={disabled}"), "delete must respect the lesson lock");
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
