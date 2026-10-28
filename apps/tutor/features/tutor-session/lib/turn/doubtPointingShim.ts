/**
 * REMOVE AT INTEGRATION (lane B shim for lane A's doubtTurn.ts).
 *
 * Lane A owns `doubtTurn.ts` and adds, per the figures-any-time brief:
 *   - `doubtFigureRefFor(input)`, the figure a saved doubt names;
 *   - `doubtSegment(segment, { codePanelShowing, boardRows, pointing? })`,
 *     which applies a `DoubtPointingPolicy`.
 * Until that lands, this file gives lane B's call sites the exact signatures:
 * `doubtFigureRefFor` is a stub that names no figure (today's save), and
 * `doubtSegment` applies the policy on top of today's filter, as the contract
 * describes. At integration, replace the body of this file with
 *   export { doubtFigureRefFor, doubtSegment } from "./doubtTurn";
 * or point the imports at doubtTurn.ts and delete the file. The gates that
 * import from here (verify-doubt-same-board, verify-doubt-dsa-pointing) then
 * check lane A's implementation against the same contract.
 */
import {
  getSegmentCommands,
  parseFocusSpec,
  type DrawCommand,
  type TutorSegment,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import type { StoredTurn } from "@/lib/boards/boardsClient";
import type { DoubtFigureRef, DoubtPointingPolicy } from "@/lib/boards/doubtFigureRef";
import { doubtSegment as baseDoubtSegment, type BoardPageRecord } from "./doubtTurn";

/** Stub with lane A's signature: names no figure, so the save is today's. */
export function doubtFigureRefFor(input: {
  record: BoardPageRecord | null; boardId: string; afterReplay: boolean; figureOnPage: boolean;
  storedTurns: readonly StoredTurn[]; activeDiagram: VerifiedDiagram | null;
  codeLessonFrameIndex: number | null;
}): DoubtFigureRef | null {
  void input;
  return null;
}

function specText(command: DrawCommand): string {
  return command.semanticRef?.entityId ?? command.text ?? "";
}

function withSpec(command: DrawCommand, spec: string): DrawCommand {
  const next: DrawCommand = { ...command, text: spec };
  if (command.semanticRef) next.semanticRef = { ...command.semanticRef, entityId: spec };
  return next;
}

/** A FOCUS cut to the ids of the figure in the zone; on a code board, a spotlight without keep. */
function pointedFocus(command: DrawCommand, policy: DoubtPointingPolicy): DrawCommand | null {
  const raw = specText(command);
  const [, ...modifiers] = raw.split("|");
  const ids = parseFocusSpec(raw).targetIds.filter((id) => policy.figureIds.has(id.toLowerCase()));
  if (ids.length === 0) return null;
  if (policy.codeBoard) return withSpec(command, `${ids.join(",")}|spotlight`);
  return withSpec(command, [ids.join(","), ...modifiers].join("|"));
}

function pointedAnnotate(command: DrawCommand, policy: DoubtPointingPolicy): boolean {
  if (policy.codeBoard) return false;
  const ids = parseFocusSpec(specText(command)).targetIds;
  return ids.length > 0 && ids.every((id) => policy.figureIds.has(id.toLowerCase()));
}

/** Today's filter for one command: does the base doubt filter keep it? */
function keptByBase(
  segment: TutorSegment,
  command: DrawCommand,
  options: { codePanelShowing: boolean; boardRows?: readonly { workId?: string; text: string }[] },
): boolean {
  const probe: TutorSegment = { ...segment, narration: "", command };
  delete probe.commands;
  return baseDoubtSegment(probe, options) !== null;
}

/** Lane A's `doubtSegment` with the optional `pointing` policy (contract in the brief). */
export function doubtSegment(
  segment: TutorSegment,
  options: {
    codePanelShowing: boolean;
    boardRows?: readonly { workId?: string; text: string }[];
    pointing?: DoubtPointingPolicy;
  },
): TutorSegment | null {
  const policy = options.pointing;
  if (!policy?.enabled) {
    return baseDoubtSegment(segment, { codePanelShowing: options.codePanelShowing, boardRows: options.boardRows });
  }
  const commands = getSegmentCommands(segment);
  const kept: DrawCommand[] = [];
  for (const command of commands) {
    if (command.type === "ANNOTATE") {
      if (pointedAnnotate(command, policy)) kept.push(command);
      continue;
    }
    if (!keptByBase(segment, command, options)) continue;
    if (command.type === "FOCUS") {
      const pointed = pointedFocus(command, policy);
      if (pointed) kept.push(pointed);
      continue;
    }
    kept.push(command);
  }
  if (kept.length === commands.length && kept.every((command, index) => command === commands[index])) return segment;
  if (kept.length === 0 && !segment.narration.trim()) return null;
  const next: TutorSegment = { ...segment, command: kept[0] ?? null };
  if (kept.length > 1) next.commands = kept;
  else delete next.commands;
  return next;
}
