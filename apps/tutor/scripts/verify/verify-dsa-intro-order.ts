import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { buildLessonSegments, getSegmentCommands, prepareVerifiedLessonSegments, type TutorSegment } from "@heytutor/drawing";
import type { CodeLessonPlan } from "@heytutor/tutor-core";
import type { SceneDocument, TurnPlanV3 } from "@heytutor/scene-engine";
import { placeDsaFigureIntro, resolveCodeLessonSegments } from "../../features/tutor-session/lib/code-lesson/codeLessonSegments";
import { resolveDsaFrames } from "../../features/tutor-session/lib/code-lesson/dsaFrames";
import { scenario } from "./verify-startup-turn";

const fixture: {
  question: string; rawResponse: string; turnPlan: TurnPlanV3; sceneDocument: SceneDocument;
  codeLesson: CodeLessonPlan; givenSegments: TutorSegment[]; introSegments: TutorSegment[];
  recordedTeaching: TutorSegment[]; expectedProducedIntro: TutorSegment[];
} = JSON.parse(readFileSync(resolve(process.cwd(), "scripts/verify/fixtures/launch-l20-late-intro.json"), "utf8"));
const failures: string[] = [];
let checks = 0;
function check(ok: unknown, message: string): void { checks++; if (!ok) failures.push(message); }
async function main() {
  const frames = resolveDsaFrames(fixture.question, fixture.codeLesson.diagramHint, fixture.codeLesson);
  assert(frames && frames.frames.length === 3, "captured example must resolve through the actual trace/compile producer");
  const intro = frames.frames[0]!.presentation.introSegments;
  const diagram = frames.frames[0]!.presentation.diagram;
  const ownedIds = new Set(diagram.anchors.map(anchor => anchor.id));
  function ownedPoint(segment: TutorSegment): boolean {
    return getSegmentCommands(segment).some(command => command.type === "POINT" && ownedIds.has(command.semanticRef?.entityId ?? command.text ?? ""));
  }
  function marks(segments: TutorSegment[]): string {
    return JSON.stringify(segments.flatMap(getSegmentCommands).map(({ type, params, text, semanticRef }) => ({ type, params, text, ...(semanticRef ? { semanticRef: { entityId: semanticRef.entityId, primitiveId: semanticRef.primitiveId, actionId: semanticRef.actionId } } : {}) })));
  }
  check(marks(intro) === marks(fixture.expectedProducedIntro), "real first-frame producer preserves every pre-fix compiled mark, label, and semantic owner");
  check(intro.flatMap(getSegmentCommands).every((command, i) => {
    const native = fixture.introSegments.flatMap(getSegmentCommands)[i];
    return native && command.type === native.type && command.text === native.text && isDeepStrictEqual(command.semanticRef, native.semanticRef) && (command.type === "LABEL" || isDeepStrictEqual(command.params, native.params));
  }), "native capture retains all 22 source marks/owners; LABEL font metrics are measured per environment");
  check(isDeepStrictEqual(frames.scenes.frames[0]!.document.entities, fixture.sceneDocument.entities), "captured whole scene, not an invented array fixture, is being reproduced");
  check(fixture.recordedTeaching.slice(0, 2).every(segment => getSegmentCommands(segment).every(command => command.text === "w1")), "recorded opening points only at the work area");
  check(fixture.recordedTeaching.slice(2).every(ownedPoint), "recorded failing first-frame clauses reference verified cells");

  const prepared = prepareVerifiedLessonSegments(buildLessonSegments(fixture.rawResponse), diagram);
  check(prepared.blockedCommandCount === 0, "real teaching preparation does not bypass any diagram filter");
  const conducted = resolveCodeLessonSegments(prepared.segments, fixture.codeLesson, {
    frameCount: frames.frames.length, frameIds: frames.frames.map(frame => frame.id),
    frameFocusIds: frames.frames.map(frame => frame.focusEntityIds),
    framePointIds: frames.frames.map(frame => frame.pointEntityIds), fallbackPointIds: ["w1", "w2", "w3"],
  });
  const batch = placeDsaFigureIntro(fixture.givenSegments, intro, conducted.segments);
  const firstIntro = batch.indexOf(intro[0]!);
  check(firstIntro > fixture.givenSegments.length, "batch keeps givens and ordinary opening before the delayed figure");
  check(batch.slice(0, fixture.givenSegments.length).every((segment, index) => segment === fixture.givenSegments[index]), "batch preserves all Given rows byte-whole and in order");
  check(batch.findIndex(ownedPoint) > firstIntro, "batch must enqueue verified intro before the first owned POINT narration");
  check(batch.findIndex(segment => segment.narration.includes("first search frame")) > firstIntro, "batch must show the array before narrating its first frame");
  check(marks(conducted.segments) === marks(batch.filter(segment => !intro.includes(segment) && !fixture.givenSegments.includes(segment))), "placement preserves every conducted command, including all code/frame advances");

  // The public live hook, actual planner validation, parser, conductor and queue.
  // Only external transports/clock/audio are the established offline startup fixture.
  const live = await scenario("ready", false, false, {
    plan: fixture.turnPlan, recordedCodeLesson: { plan: fixture.codeLesson, response: fixture.rawResponse },
  });
  assert("recordedCodeEvents" in live && live.recordedCodeEvents, "actual live consumer returned its queue receipts");
  const events = live.recordedCodeEvents;
  const introAt = events.findIndex(event => event.name === "enqueue-intro");
  check(introAt >= 0 && events.filter(event => event.name === "enqueue-intro").length === 1, "live enqueues the existing verified intro once");
  const queued = events.flatMap((event, index) => event.name === "enqueue" ? [{ index, segment: event.data as TutorSegment }] : []);
  const firstPoint = queued.find(entry => ownedPoint(entry.segment));
  check(firstPoint && firstPoint.index > introAt, "live must enqueue verified intro before first owned POINT narration");
  const firstFrameWords = queued.find(entry => entry.segment.narration.includes("first search frame"));
  check(firstFrameWords && firstFrameWords.index > introAt, "live must show the array before narrating its first frame");
  check(queued.filter(entry => getSegmentCommands(entry.segment).some(command => command.type === "POINT" && command.text === "w1")).some(entry => entry.index < introAt), "live work-area POINT remains before the figure");
  check(queued.filter(entry => getSegmentCommands(entry.segment).some(command => command.type === "WRITE")).length === fixture.givenSegments.length, "live keeps all original Given rows");
  const liveIntro = events[introAt]?.data as TutorSegment[] | undefined;
  check(liveIntro && marks(liveIntro) === marks(intro), "live uses the same whole verified intro with unchanged marks");
  const typed = queued.flatMap(entry => getSegmentCommands(entry.segment).filter(command => command.type === "TYPE").map(command => command.text));
  check(JSON.stringify(typed) === JSON.stringify(fixture.codeLesson.sections.flatMap(section => section.blocks.map(block => block.code))), "live preserves every exact code block in plan order");

  function commandSegment(type: "POINT" | "FOCUS" | "FRAME" | "TYPE", id: string): TutorSegment {
    return { narration: "A control teaching step.", command: { type, params: [], text: id, charPosition: 0, narrationBefore: "", semanticRef: { entityId: id } } };
  }
  for (const id of ["w1", "unrelated", ""]) {
    const before = commandSegment("POINT", id), owned = commandSegment("POINT", [...ownedIds][0]!);
    const placed = placeDsaFigureIntro(fixture.givenSegments, intro, [before, owned]);
    check(placed.indexOf(before) < placed.indexOf(intro[0]!), `unowned POINT ${JSON.stringify(id)} does not prematurely reveal the figure`);
    check(placed.indexOf(intro[0]!) < placed.indexOf(owned), `owned POINT still starts the figure after ${JSON.stringify(id)}`);
  }
  for (const type of ["FOCUS", "FRAME", "TYPE"] as const) {
    const beat = commandSegment(type, type === "FOCUS" ? [...ownedIds][0]! : "first");
    const placed = placeDsaFigureIntro([], intro, [beat, ...fixture.recordedTeaching]);
    check(placed[0] === intro[0], `${type}: an earlier existing valid intro position never moves later`);
  }
  const unrelated = commandSegment("POINT", "w1");
  check(placeDsaFigureIntro([], intro, [unrelated]).at(-1) === intro.at(-1), "no figure beat keeps the existing final-intro fallback");
  check(JSON.stringify(placeDsaFigureIntro(fixture.givenSegments, [], [unrelated])) === JSON.stringify([...fixture.givenSegments, unrelated]), "no accepted diagram adds no intro and changes no teaching");
  if (failures.length) throw new Error(`${failures.length}/${checks} DSA intro-order checks failed:\n${failures.join("\n")}`);
  console.log(`verify-dsa-intro-order: ${checks} checks passed; captured L20 through real live and batch consumers, owned POINT, opening/work-point and absent-diagram controls`);

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
