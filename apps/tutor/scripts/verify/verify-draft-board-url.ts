/**
 * The home board is unaddressed until it is asked something. `/` must stay `/`,
 * the first question must claim `/c/{id}` without a navigation, and nothing may
 * write a board row before that.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  boardIdFromPathname,
  boardPath,
  createDraftBoardId,
  draftBoardPath,
} from "../../features/tutor-session/lib/board/boardRoute";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = resolve(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");

assert(boardIdFromPathname("/") === null, "the home board must not read as a saved board");
assert(boardIdFromPathname("") === null, "an empty path must not read as a saved board");
assert(boardIdFromPathname(null) === null, "a missing path must not read as a saved board");
assert(boardIdFromPathname("/admin") === null, "only /c/ addresses a board");
assert(boardIdFromPathname("/c/board-1") === "board-1", "/c/{id} must resolve its board");
assert(
  boardIdFromPathname(boardPath("board 1")) === "board 1",
  "a board path must round-trip through the URL encoder",
);
assert(draftBoardPath() === "/", "a blank home board must live at /");
assert(draftBoardPath("   ") === "/", "whitespace is not a question");
assert(
  draftBoardPath("  find x  ") === `/?q=${encodeURIComponent("find x")}`,
  "a typed next question must ride to the home board in ?q=",
);
assert(
  createDraftBoardId() !== createDraftBoardId(),
  "every home board must get its own id",
);

const page = read("features/tutor-session/TutorSessionPage.tsx");
assert(
  /const isDraft = routeBoardId === null/.test(page),
  "draft state must be read off the URL, so claiming it flips the flag",
);
assert(
  /sessionId = routeBoardId \?\? draftBoardId/.test(page),
  "the claimed URL must resolve to the same id the draft was already using",
);

const boardSession = read("features/tutor-session/hooks/useBoardSession.ts");
assert(
  /window\.history\.replaceState\(window\.history\.state \?\? \{\}, "", boardPath\(board\.id\)\)/.test(
    boardSession,
  ),
  "claiming the URL must be a replaceState that keeps Next's history state — a route push or a null state remounts the lesson",
);
assert(
  /if \(!isDraft \|\| committedDraftRef\.current === sessionId\) return false/.test(boardSession),
  "a board may only be committed once, and only from a draft",
);
assert(
  /let detail = draft \? null : await fetchBoardDetail\(boardId\)/.test(boardSession),
  "restoring an unsaved home board must not hit the boards API",
);
const restoreEffect = boardSession.slice(boardSession.lastIndexOf("const generation = ++restoreGenerationRef.current"));
assert(
  /\}, \[sessionId, cancelRef, stopTurnRef, revokeReplayBlobUrls\]\)/.test(restoreEffect),
  "restore must key on the board alone — claiming the URL flips isDraft, and re-running would stop the live turn",
);
assert(
  /const draft = isDraftRef\.current/.test(restoreEffect),
  "the draft flag must reach restore through a ref, not a dependency",
);
assert(
  /if \(!detail && !draft\) \{\s*await createBoard\(boardId\)/.test(boardSession),
  "restore must never write a row for a board that has not been asked anything",
);

const questionHandler = read("features/tutor-session/hooks/turn/useQuestionHandler.ts");
// Ordering, not adjacency: a doubt saves the part of the turn it stopped and
// skips the epoch, and both of those sit between the commit and a lesson's
// epoch. Every one of them must still come after the row exists.
const HANDLER_ANCHOR = "const handleQuestion = useCallback(";
const handlerAt = questionHandler.indexOf(HANDLER_ANCHOR);
assert(
  handlerAt >= 0,
  `this gate reads useQuestionHandler.ts from "${HANDLER_ANCHOR}", which is gone. Repoint it; do not relax it.`,
);
const handlerBody = questionHandler.slice(handlerAt);
const committedAt = handlerBody.indexOf("await boardCommitted;");
const epochAt = handlerBody.indexOf("await beginBoardEpoch()");
const partialSaveAt = handlerBody.indexOf("saveTurnToBoard(partialTurnSave)");
assert(
  committedAt >= 0 &&
    epochAt > committedAt &&
    (partialSaveAt < 0 || partialSaveAt > committedAt),
  "the board row must exist before the turn starts saving to it",
);
assert(
  // A doubt names the board from the lesson it is about, so the title source
  // may be an expression; the commit must still be awaited beside it.
  /Promise\.all\(\[\s*requestBoardTitle\([^\n]*\),\s*boardCommitted,?\s*\]\)/.test(questionHandler),
  "naming must wait for the row it renames",
);
assert(
  /boardNeedsGeneratedTitle/.test(questionHandler),
  "an empty board that still carries an abandoned title must be renamed from the question that actually runs",
);

const layout = read("app/(session)/layout.tsx");
assert(
  /<TutorSessionPage \/>/.test(layout),
  "the session must live in the layout shared by / and /c/{id}",
);
assert(
  !/app\/page\.tsx/.test(layout),
  "the home route must not redirect into a board",
);

console.log("draft board url verification passed");
