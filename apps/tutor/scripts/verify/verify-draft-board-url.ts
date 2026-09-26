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
  boardTitleNamesLesson,
  createDraftBoardId,
  draftBoardPath,
  isUntouchedHomeBoard,
  resolveSessionBoard,
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

const home = resolveSessionBoard({
  routeBoardId: null,
  draftBoardId: "draft",
  abandonedRouteId: null,
  chosenBoardId: null,
});
assert(home.sessionId === "draft" && home.isDraft, "the home board is the unclaimed draft");

const held = resolveSessionBoard({
  routeBoardId: "lesson",
  draftBoardId: "fresh",
  abandonedRouteId: "lesson",
  chosenBoardId: null,
});
assert(
  held.sessionId === "fresh" && held.isDraft,
  "New board stays up while the router still names the lecture it left",
);

const picked = resolveSessionBoard({
  routeBoardId: "lesson",
  draftBoardId: "fresh",
  abandonedRouteId: null,
  chosenBoardId: "lesson",
});
assert(
  picked.sessionId === "lesson" && !picked.isDraft,
  "opening the lecture from the list shows it again",
);

const other = resolveSessionBoard({
  routeBoardId: "other",
  draftBoardId: "fresh",
  abandonedRouteId: "lesson",
  chosenBoardId: null,
});
assert(
  other.sessionId === "other" && !other.isDraft,
  "a different board the router reached is the one on screen",
);

const claimed = resolveSessionBoard({
  routeBoardId: "fresh",
  draftBoardId: "fresh",
  abandonedRouteId: "lesson",
  chosenBoardId: null,
});
assert(
  claimed.sessionId === "fresh" && !claimed.isDraft,
  "once Next names the new draft, it is no longer an unsaved home board",
);

assert(
  isUntouchedHomeBoard({
    isDraft: true,
    storedTurnsCount: 0,
    inputInteracted: false,
    phaseIsIdle: true,
    boardTitle: "New board",
  }),
  "a blank home board must not mint another blank board",
);
assert(
  !isUntouchedHomeBoard({
    isDraft: true,
    storedTurnsCount: 0,
    inputInteracted: true,
    phaseIsIdle: true,
    boardTitle: "New board",
  }),
  "asking on the home board means New board has to leave it",
);
assert(
  !isUntouchedHomeBoard({
    isDraft: true,
    storedTurnsCount: 0,
    inputInteracted: false,
    phaseIsIdle: true,
    boardTitle: "Centripetal force of circular motion",
  }),
  "a lesson stopped before its turn was saved still counts as used",
);
assert(
  !isUntouchedHomeBoard({
    isDraft: false,
    storedTurnsCount: 0,
    inputInteracted: false,
    phaseIsIdle: true,
  }),
  "a saved board is never the untouched home board",
);
assert(boardTitleNamesLesson("Centripetal force of circular motion"), "a lesson title names a lesson");
assert(!boardTitleNamesLesson("new board"), "the placeholder title does not name a lesson");

const page = read("features/tutor-session/TutorSessionPage.tsx");
assert(
  /resolveSessionBoard\(/.test(page),
  "which board is on screen must go through resolveSessionBoard",
);
assert(
  /boardIdFromPathname\(window\.location\.pathname\)/.test(page),
  "New board must remember the lecture in the address bar, not only the route Next reports",
);
assert(
  /window\.location\.pathname\.startsWith\("\/c\/"\)/.test(page),
  "New Board must put the address bar back on the home board when the lesson claimed /c/{id} without a navigation",
);
assert(
  /onChooseBoard=\{chooseBoard\}/.test(page),
  "opening a saved board must release the New board hold",
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
  /if \(activeSessionIdRef\.current !== sessionId\) return true/.test(boardSession),
  "a lesson that New board already left must not claim the URL out from under the fresh board",
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

const notesChat = read("app/api/boards/[boardId]/notes-chat/route.ts");
const notesChatGet = notesChat.slice(
  notesChat.indexOf("export async function GET"),
  notesChat.indexOf("export async function POST"),
);
assert(
  /return NextResponse\.json\(\{\s*messages: \[\]\s*\}\)/.test(notesChatGet),
  "GET notes-chat must return an empty thread when the board row is not persisted yet",
);
assert(
  /const foreign = await prisma\.board\.findFirst/.test(notesChatGet),
  "GET notes-chat must distinguish a missing draft from a board owned by someone else",
);
assert(
  notesChatGet.includes('return NextResponse.json({ error: "not found" }, { status: 404 })'),
  "GET notes-chat must still 404 for another user's board",
);
const notesChatPost = notesChat.slice(notesChat.indexOf("export async function POST"));
assert(
  /const board = await getOwnedBoard\(boardId, userId\);\s*if \(!board\) \{\s*return NextResponse\.json\(\{ error: "not found" \}, \{ status: 404 \}\);/.test(
    notesChatPost,
  ),
  "POST notes-chat must still require an owned board row before writing chat",
);

const notesClient = read("lib/boards/notesChatClient.ts");
assert(
  /fetch\(resolveApiUrl\(`\/api\/boards\/\$\{boardId\}\/notes-chat`\)\)/.test(notesClient),
  "the notes sidebar loads history from GET notes-chat",
);
const notesHook = read("features/tutor-session/hooks/useNotesChat.ts");
assert(
  /fetchNotesChatMessages\(boardId\)/.test(notesHook),
  "opening a board must fetch notes-chat for that session id, including drafts",
);

console.log("draft board url verification passed");
