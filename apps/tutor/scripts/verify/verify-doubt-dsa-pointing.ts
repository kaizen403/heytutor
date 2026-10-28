/**
 * A doubt on a code lesson board (DIAGRAM_DOUBT_POINTING).
 *
 * Live, a code board doubt used to point at nothing: its `activeDiagram` was
 * nulled, while replay kept the frame. With the flag on, the doubt points at
 * the cells of the frame on the board, and only there:
 *   - the frame is the doubt's figure only with the flag on and a frame
 *     visibly drawn; off, the doubt points at nothing, as before;
 *   - its FOCUS is cut to the frame's cells, forced to a spotlight, never
 *     kept, and ANNOTATE is dropped;
 *   - a frame id is never a target, so a doubt never steps the walk: frame
 *     advances are a conductor rewrite a doubt does not run, FRAME and POINT
 *     are dropped, and the executor's FOCUS never advances a frame;
 *   - the prompt lists cells by id and label, never a frame id.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DrawCommand, TutorSegment, VerifiedDiagram } from "@heytutor/drawing";
import {
  buildDoubtPointingPolicy,
  doubtActiveFigure,
  doubtCodeFrameCells,
} from "../../features/tutor-session/lib/turn/doubtPointing";
import { doubtSegment } from "../../features/tutor-session/lib/turn/doubtTurn";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = resolve(import.meta.dirname, "../..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");
/** Both anchors are checked: a missing end anchor would silently slice to the file's end. */
function between(source: string, file: string, start: string, end: string): string {
  const from = source.indexOf(start);
  assert(from >= 0, `${file}: start anchor "${start}" is gone. Repoint this gate; do not relax it.`);
  const to = source.indexOf(end, from + start.length);
  assert(to > from, `${file}: end anchor "${end}" is gone after "${start}". Repoint this gate; do not relax it.`);
  return source.slice(from, to);
}

const FRAME_IDS = ["frame_1", "frame_2", "frame_3"];
const frame = {
  id: "dsa_frame_2", layout: "code_lesson", name: "two sum, frame 2", promptAddon: "", reveals: [], deferredAnnotations: [],
  anchors: [
    { id: "cell_0", labels: ["2"], x: 480, y: 300, width: 48, height: 48 },
    { id: "cell_1", labels: ["7"], x: 528, y: 300, width: 48, height: 48 },
    { id: "ptr_i", labels: ["i"], x: 528, y: 360, width: 20, height: 20 },
    // A frame-sized anchor carrying a frame id must still never be pointable.
    { id: "frame_2", labels: [], x: 400, y: 140, width: 760, height: 500 },
  ],
  groups: [{ id: "window", entityIds: ["cell_0", "cell_1"] }],
  commands: [],
} as unknown as VerifiedDiagram;
const lessonFigure = { ...frame, id: "verified_scene", layout: "standard", name: "mirror" } as VerifiedDiagram;

// 1. Which figure a doubt hands the executor.
assert(doubtActiveFigure({ granted: true, codeBoard: true, codeFigureVisible: true, zoneFigure: frame }) === frame,
  "flag on: a code board doubt points at the frame on the board");
assert(doubtActiveFigure({ granted: false, codeBoard: true, codeFigureVisible: true, zoneFigure: frame }) === null,
  "flag off: a code board doubt points at nothing, as before");
assert(doubtActiveFigure({ granted: true, codeBoard: true, codeFigureVisible: false, zoneFigure: frame }) === null,
  "no frame drawn: nothing to point at");
for (const granted of [true, false]) {
  assert(doubtActiveFigure({ granted, codeBoard: false, codeFigureVisible: false, zoneFigure: lessonFigure }) === lessonFigure,
    `figure board (flag ${granted}): the doubt keeps the lesson's figure, as before`);
}

// 2. The policy on a code board: cells only, no frame ids.
const policy = buildDoubtPointingPolicy({ granted: true, figure: frame, codeBoard: true, frameIds: FRAME_IDS });
assert(policy.enabled && policy.codeBoard, "a code board policy says it is a code board");
assert(["cell_0", "cell_1", "ptr_i", "2", "7", "i", "window"].every((id) => policy.figureIds.has(id)), "the frame's cells, labels and groups are pointable");
assert(FRAME_IDS.every((id) => !policy.figureIds.has(id)), "no frame id is ever a doubt target");

// 3. The live filter: spotlight only, no keep, no ANNOTATE, no frame ids, no frame steps.
const at = (type: DrawCommand["type"], text?: string): DrawCommand => ({
  type, params: [], ...(text ? { text, semanticRef: { entityId: text } } : {}), charPosition: 0, narrationBefore: "",
});
const segment: TutorSegment = {
  narration: "the pointer i sits on seven, and two plus seven is the target",
  command: at("FOCUS", "ptr_i,cell_1|pulse|keep"),
  commands: [
    at("FOCUS", "ptr_i,cell_1|pulse|keep"),
    at("FOCUS", "frame_3|spotlight"),
    at("FOCUS", "frame_2"),
    at("ANNOTATE", "cell_1"),
    at("FRAME"),
    at("POINT", "cell_0"),
    at("TYPE"),
  ],
};
for (const codePanelShowing of [true, false]) {
  const kept = doubtSegment(segment, { codePanelShowing, pointing: policy });
  const commands = kept ? (kept.commands ?? [kept.command]).filter(Boolean) as DrawCommand[] : [];
  assert(commands.length === 1 && commands[0]!.type === "FOCUS", `panel ${codePanelShowing}: only the cell FOCUS survives (${commands.map((c) => `${c.type}:${c.text}`).join(" ")})`);
  assert(commands[0]!.text === "ptr_i,cell_1|spotlight" && commands[0]!.semanticRef?.entityId === "ptr_i,cell_1|spotlight",
    `panel ${codePanelShowing}: a code board FOCUS is a spotlight and never keeps a ring`);
  assert(kept!.narration === segment.narration, "the words always survive");
}

// 4. The prompt's cell list.
const cells = doubtCodeFrameCells(frame, FRAME_IDS);
assert(cells.map((cell) => cell.id).join(",") === "cell_0,cell_1,ptr_i", "the prompt lists the frame's cells, never a frame id");
assert(cells[0]!.labels.join() === "2", "a cell is listed with its labels");
assert(doubtCodeFrameCells(null, FRAME_IDS).length === 0, "no frame, no cells");

// 5. The live wiring.
{
  const file = "features/tutor-session/hooks/turn/useQuestionHandler.ts";
  const handler = between(read(file), file, "const teachQuestion = useCallback(", "return { handleQuestion };");
  const doubtBranch = between(handler, file, "if (doubt) {\n        // The doubt answers on the figure already drawn on this page.", "} else if (resume) {");
  assert(/activeDiagram = doubtActiveFigure\(\{\s*granted: doubtPointingGranted,\s*codeBoard: codeLessonBoard,\s*codeFigureVisible,\s*zoneFigure: activeVerifiedDiagramRef\.current,\s*\}\);/.test(doubtBranch),
    "a code board doubt hands the executor the frame only through the flag");
  assert(/const codeFrameIds = codeLessonBoard\s*\? \(codeLessonControllerRef\?\.current\?\.frames\.getSet\(\)\?\.frames\.map\(\(frame\) => frame\.id\) \?\? \[\]\)\s*: \[\];/.test(handler),
    "the frame ids come from the controller's walk-through");
  assert(handler.includes("codeFrameCells: codeLessonBoard ? doubtCodeFrameCells(activeDiagram, codeFrameIds) : [],"),
    "the prompt's cells come from the doubt's own figure, minus the frame ids");
  const queue = between(handler, file, "const queuePreparedSegments = (", "const hasTeachingContent =");
  assert(/const filtered = doubt\s*\? preparedSegments\.flatMap/.test(queue) && queue.includes(": (resolved?.segments ?? preparedSegments);"),
    "a doubt's segments never pass through the code lesson conductor, which rewrites FOCUS into frame steps");
  assert(handler.includes("codeLessonFrameIndex: doubtFrames?.getSet() ? doubtFrames.currentIndex() : null,"),
    "the saved reference names the frame on the board, read, never advanced");
}
{
  const file = "features/tutor-session/hooks/useCommandExecution.ts";
  const focus = between(read(file), file, 'case "FOCUS": {', 'case "EMPHASIZE": {');
  assert(!/frames\.advance\(|\.advance\(\)/.test(focus), "the executor's FOCUS never steps a frame");
}

console.log("verify-doubt-dsa-pointing: a code board doubt points at the frame's cells only with the flag, as spotlights, and never steps a frame");
