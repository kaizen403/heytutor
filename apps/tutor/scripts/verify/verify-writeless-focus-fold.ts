/**
 * Runs of write-less FOCUS steps are spoken as one segment.
 *
 * The prompt forbids two write-less steps in a row; the model still sends
 * them (v3 p3e2-t1 had three in a row, p2e1-t1 two), and the board stands
 * still while they are spoken. `prepareVerifiedLessonSegments` speaks each
 * run as one segment. This gate parses a lesson shaped like p3e2-t1 through
 * the real parser and preparation, then checks: at most one write-less FOCUS
 * segment in a row, every word and command kept in order, every WRITE
 * segment untouched, and on a timed clock every FOCUS of a merged segment
 * still lands on its own words. It also measures why the run is not folded
 * into the row after it. The streaming folder gives the same segments as the
 * batch form.
 *
 * The live turn prepares one streamed segment at a time. The streamed half
 * runs the lesson through the real incremental parser and the turn's fold
 * (`createStreamedFocusFold`) the way `useQuestionHandler` does, and checks
 * that it queues what the batch path does, never holds a writing segment,
 * never holds a lesson that opens by pointing, and that the hook really
 * takes every prepared segment through the fold and flushes it at the end.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { buildLessonSegments, getSegmentCommands, IncrementalTagParser, resolveVerifiedDiagramFocusTargets, type DrawCommand, type TutorSegment, type VerifiedDiagram } from "@heytutor/drawing";
import { getFocusTargetSchedule, getWriteCharScheduleMs, mathToSpeech, validateAudioTimingsForNarration } from "@heytutor/tutor-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const placementPath = process.env.FOCUS_FOLD_SOURCE ?? path.resolve(here, "../../../../packages/drawing/src/protocol/commandPlacement.ts");
type Placement = typeof import("../../../../packages/drawing/src/protocol/commandPlacement");
const streamedFoldPath = path.resolve(here, "../../features/tutor-session/lib/turn/streamedFocusFold.ts");
const handlerPath = path.resolve(here, "../../features/tutor-session/hooks/turn/useQuestionHandler.ts");
type StreamedFold = typeof import("../../features/tutor-session/lib/turn/streamedFocusFold");

const anchor = (id: string, labels: string[], x: number, y: number) => ({ id, labels, x, y, width: 40, height: 40 });
const diagram: VerifiedDiagram = {
  id: "verified_scene", name: "plane in wind", commands: [], reveals: [], promptAddon: "",
  anchors: [
    anchor("origin", ["plane"], 700, 400), anchor("north_ref", ["N"], 700, 200),
    anchor("v_air", ["v_air"], 650, 300), anchor("v_wind", ["v_wind"], 800, 400),
    anchor("v_ground", ["v_ground"], 700, 300), anchor("theta_mark", ["θ"], 690, 330),
  ],
};

// Shaped like v3 p3e2-t1: a row, then three write-less FOCUS steps, then rows.
const lesson = [
  "[STEP]\nHere v_air is the plane's speed through the air, v_wind is the wind, and we want the angle and the ground speed. [WRITE:θ = ?, v_ground = ?,90,211]\n[/STEP]",
  "[STEP]\nIn the figure the plane [FOCUS:origin] sits at the start, and N [FOCUS:north_ref] shows due north.\n[/STEP]",
  "[STEP]\nv_air [FOCUS:v_air] is the plane's velocity relative to the air, and v_wind [FOCUS:v_wind] blows to the east.\n[/STEP]",
  "[STEP]\nThe pilot wants due north, so v_ground [FOCUS:v_ground] points north, and θ [FOCUS:theta_mark] is the heading west of north.\n[/STEP]",
  "[STEP]\nGround velocity equals air velocity plus wind velocity. [WRITE:v_ground = v_air + v_wind,90,277]\n[/STEP]",
  "[STEP]\nThe east west parts cancel, so v_air sin θ equals v_wind. [WRITE:v_air sin θ = v_wind,90,343] [EMPHASIZE:last]\n[/STEP]",
  // p2e1-t1: two write-less steps in a row.
  "[STEP]\nLook at v_wind [FOCUS:v_wind] again.\n[/STEP]",
  "[STEP]\nAnd notice θ [FOCUS:theta_mark] once more.\n[/STEP]",
  "[STEP]\nSo sin θ equals one hundred twenty over two hundred. [WRITE:sin θ = 120/200 = 0.6,90,409]\n[/STEP]",
  // A run with no WRITE after it stays as it was.
  "[STEP]\nNotice v_air [FOCUS:v_air].\n[/STEP]",
  "[STEP]\nNotice v_ground [FOCUS:v_ground].\n[/STEP]",
].join("\n");

const isWritelessFocus = (segment: TutorSegment) => {
  const commands = getSegmentCommands(segment);
  return commands.some(command => command.type === "FOCUS") && !commands.some(command => command.type === "WRITE" || command.type === "TYPE");
};
const isNarrationOnly = (segment: TutorSegment) => getSegmentCommands(segment).length === 0;
const words = (segments: readonly TutorSegment[]) => segments.map(segment => segment.narration.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ");
const commandKey = (command: DrawCommand) => `${command.type}|${command.text ?? ""}|${command.charPosition}`;

/** Longest run of write-less FOCUS segments, spoken tails between them ignored. */
function longestWritelessRun(segments: readonly TutorSegment[], untilIndex = segments.length): number {
  let run = 0, longest = 0;
  for (const segment of segments.slice(0, untilIndex)) {
    if (isNarrationOnly(segment)) continue;
    run = isWritelessFocus(segment) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest;
}

/** Synthetic alignment, 70 ms per spoken character, for a timed schedule. */
function timingsFor(narration: string) {
  const spoken = mathToSpeech(narration.trim());
  const timings = {
    charStartTimes: [...spoken].map((_, index) => index * 0.07),
    charDurations: [...spoken].map(() => 0.07),
    totalDuration: spoken.length * 0.07,
  };
  assert(validateAudioTimingsForNarration(narration, timings).valid, "fixture alignment is accepted by the runtime");
  return timings;
}

async function main() {
  const placement = await import(pathToFileURL(placementPath).href) as Placement;
  const raw = buildLessonSegments(lesson);
  assert(longestWritelessRun(raw) >= 3, "the fixture reproduces three write-less FOCUS steps in a row");
  const prepared = placement.prepareVerifiedLessonSegments(raw, diagram);
  assert(longestWritelessRun(prepared.segments) <= 1, `preparation leaves at most one write-less FOCUS segment in a row (found ${longestWritelessRun(prepared.segments)})`);
  // The same preparation one segment at a time folds nothing; it is the
  // reference for what was said and drawn. Folding it with the streaming
  // folder keeps command identity, so every cue can be traced to its words.
  const unfolded = raw.flatMap(segment => placement.prepareVerifiedLessonSegments([segment], diagram).segments);
  assert(longestWritelessRun(unfolded) >= 3, "preparation alone leaves the run in place");
  const folder = placement.createWritelessFocusFolder(diagram);
  const segments = unfolded.flatMap(segment => folder.push(segment));
  segments.push(...folder.flush());
  assert.deepEqual(prepared.segments.map(segment => segment.narration), segments.map(segment => segment.narration),
    "batch preparation and the streaming folder give the same segments");
  assert.deepEqual(prepared.segments.map(segment => getSegmentCommands(segment).map(commandKey)), segments.map(segment => getSegmentCommands(segment).map(commandKey)));

  assert(longestWritelessRun(segments) <= 1, "at most one write-less FOCUS segment in a row");
  // Six FOCUS segments in the p3e2 run (two per step) become one; two in the
  // p2e1 run become one; the closing run of two becomes one.
  assert.equal(prepared.foldedFocusSegmentCount, 5 + 1 + 1, "every later FOCUS segment of a run is folded into its first");
  // Rows keep their own segment: a row's cue is matched from the start of its
  // segment's words, and the pointing steps name the very quantities it writes.
  const writeSegments = (list: readonly TutorSegment[]) => list.filter(segment => getSegmentCommands(segment).some(command => command.type === "WRITE"));
  assert.deepEqual(writeSegments(segments), writeSegments(unfolded), "every WRITE segment is spoken exactly as before");

  // Nothing said or drawn is lost, and the order is the order spoken.
  assert.equal(words(segments), words(unfolded), "every word is still spoken, in order");
  assert.deepEqual(segments.flatMap(getSegmentCommands), unfolded.flatMap(getSegmentCommands), "every command is kept, in order");

  // On a timed clock each folded cue still lands on its own words.
  const rawByCommand = new Map<DrawCommand, TutorSegment>();
  for (const segment of unfolded) for (const command of getSegmentCommands(segment)) rawByCommand.set(command, segment);
  let checkedFocus = 0;
  for (const segment of segments) {
    const commands = getSegmentCommands(segment);
    const sources = [...new Set(commands.map(command => rawByCommand.get(command)!))];
    if (sources.length < 2) continue;
    const timings = timingsFor(segment.narration);
    const spoken = mathToSpeech(segment.narration.trim());
    // Where each source segment's words sit in the merged spoken text.
    let cursor = 0;
    const ranges = new Map<TutorSegment, { start: number; end: number }>();
    const first = unfolded.indexOf(sources[0]!);
    let last = first, joined = unfolded[first]!.narration.trim();
    while (joined !== segment.narration && last + 1 < unfolded.length) joined = `${joined} ${unfolded[++last]!.narration.trim()}`;
    assert.equal(joined, segment.narration, "the merged words are exactly its parts, in order");
    for (const source of unfolded.slice(first, last + 1)) {
      const part = mathToSpeech(source.narration.trim());
      if (!part) continue;
      const at = spoken.indexOf(part, cursor);
      if (at < 0) continue;
      ranges.set(source, { start: at, end: at + part.length });
      cursor = at + part.length;
    }
    for (const command of commands) {
      const range = ranges.get(rawByCommand.get(command)!);
      assert(range, `${command.type} ${command.text}: its words are in the merged segment`);
      if (command.type === "FOCUS") {
        const targets = resolveVerifiedDiagramFocusTargets(command, diagram).map(target => ({ id: target.id, labels: [target.id, ...target.labels] }));
        const schedule = getFocusTargetSchedule({ narration: segment.narration, command, targets, timings });
        assert.equal(schedule.source, "tts");
        for (const window of schedule.targets) {
          const at = window.startMs / 70;
          assert(at >= range.start - 1 && at <= range.end + 1,
            `FOCUS ${command.text} lands on its own words (char ${at.toFixed(0)} in ${range.start}..${range.end})`);
        }
        checkedFocus++;
      }
    }
  }
  assert(checkedFocus >= 8, `merged cues were checked (${checkedFocus} FOCUS)`);

  // Why a run is not folded into the row after it: on the merged words the
  // row "v_ground = v_air + v_wind" would start on the pointing sentence.
  const p3e2Run = segments.find(segment => getSegmentCommands(segment).filter(command => command.type === "FOCUS").length >= 6)!;
  const nextRow = segments[segments.indexOf(p3e2Run) + 1]!;
  assert.equal(getSegmentCommands(nextRow)[0]?.text, "v_ground = v_air + v_wind");
  const intoRow = `${p3e2Run.narration} ${nextRow.narration}`;
  const early = getWriteCharScheduleMs(intoRow, getSegmentCommands(nextRow)[0]!, timingsFor(intoRow));
  assert(early && early.offsetsMs[0]! / 70 < mathToSpeech(p3e2Run.narration).length,
    "folding the run into its row would write the row on the pointing words");

  // A FOCUS repeated on one target inside a fold is traced once.
  const repeat = buildLessonSegments([
    "[STEP]\nNotice N [FOCUS:north_ref].\n[/STEP]",
    "[STEP]\nNotice the plane [FOCUS:origin].\n[/STEP]",
    "[STEP]\nAgain N [FOCUS:north_ref] points north.\n[/STEP]",
    "[STEP]\nSo we write the rule. [WRITE:v = u + at,90,211]\n[/STEP]",
  ].join("\n"));
  const repeated = placement.prepareVerifiedLessonSegments(repeat, diagram).segments;
  assert.equal(repeated.length, 2, "the pointing run is one segment before its row");
  assert.equal(getSegmentCommands(repeated[0]!).filter(command => command.type === "FOCUS" && command.text === "north_ref").length, 1,
    "one trace per target in a merged segment");

  // A code lesson never folds.
  const codeLesson = placement.foldWritelessFocusRuns(raw, { ...diagram, layout: "code_lesson" } as VerifiedDiagram);
  assert.equal(codeLesson.foldedFocusSegmentCount, 0, "a code lesson's FOCUS beats are never folded");

  // The streamed path, as useQuestionHandler runs it.
  const { createStreamedFocusFold } = await import(pathToFileURL(streamedFoldPath).href) as StreamedFold;
  const hasWrite = (segment: TutorSegment) => getSegmentCommands(segment).some(command => command.type === "WRITE");
  const streamLesson = (text: string, chunk: number) => {
    const fold = createStreamedFocusFold(diagram, { codeLesson: false });
    const raws: TutorSegment[] = [];
    const queued: TutorSegment[] = [];
    const heldWrites: string[] = [];
    let firstTake: TutorSegment[] | null = null;
    let buffered: TutorSegment | null = null;
    let started = false;
    const flush = () => {
      if (!buffered) return;
      raws.push(buffered);
      const ready = placement.prepareVerifiedLessonSegments([buffered], diagram).segments;
      const out = fold.take(ready, { lessonStarted: started });
      firstTake ??= out;
      for (const segment of ready) if (hasWrite(segment) && !out.includes(segment)) heldWrites.push(segment.narration);
      queued.push(...out);
      if (out.some(segment => /[\p{L}\p{N}]/u.test(segment.narration))) started = true;
      buffered = null;
    };
    const parser = new IncrementalTagParser({ preserveStepSpeech: true, onSegmentReady: segment => { flush(); buffered = segment; } });
    for (let at = 0; at < text.length; at += chunk) parser.push(text.slice(at, at + chunk));
    parser.flush();
    flush();
    queued.push(...fold.finish());
    return { raws, queued, heldWrites, firstTake: firstTake ?? [], folded: fold.foldedFocusSegmentCount() };
  };
  for (const chunk of [7, 23, 101]) {
    const streamed = streamLesson(lesson, chunk);
    const batch = placement.prepareVerifiedLessonSegments(streamed.raws, diagram);
    assert.deepEqual(streamed.queued.map(segment => segment.narration), batch.segments.map(segment => segment.narration),
      `streamed (${chunk} char chunks) queues the segments the batch path speaks`);
    assert.deepEqual(streamed.queued.map(segment => getSegmentCommands(segment).map(commandKey)), batch.segments.map(segment => getSegmentCommands(segment).map(commandKey)));
    assert(longestWritelessRun(streamed.queued) <= 1, `streamed: at most one write-less FOCUS segment in a row (found ${longestWritelessRun(streamed.queued)})`);
    assert.equal(streamed.folded, batch.foldedFocusSegmentCount, "streamed folds every run the batch path folds");
    assert(streamed.folded >= 4, `streamed folds the fixture runs (${streamed.folded})`);
    assert.deepEqual(streamed.heldWrites, [], "a writing segment is queued on the call that prepared it");
  }
  // A lesson that opens by pointing starts on its first step, not the next.
  const opensPointing = streamLesson([
    "[STEP]\nIn the figure v_air [FOCUS:v_air] is the plane through the air.\n[/STEP]",
    "[STEP]\nAnd v_wind [FOCUS:v_wind] blows east.\n[/STEP]",
    "[STEP]\nNotice θ [FOCUS:theta_mark].\n[/STEP]",
    "[STEP]\nSo we add them. [WRITE:v_ground = v_air + v_wind,90,211]\n[/STEP]",
  ].join("\n"), 13);
  assert.equal(opensPointing.firstTake.length, 1, "the opening pointing step is queued at once");
  assert(longestWritelessRun(opensPointing.queued) <= 2, "after the opening step the run still folds");
  assert.equal(opensPointing.folded, 1, "the two pointing steps after the opening one are spoken as one");
  // A code lesson's FOCUS beats pass through untouched.
  const codeFold = createStreamedFocusFold(diagram, { codeLesson: true });
  const codeOut = buildLessonSegments(lesson).flatMap(segment => codeFold.take([segment], { lessonStarted: true }));
  assert.equal(codeOut.length + codeFold.finish().length, buildLessonSegments(lesson).length, "a code lesson never folds");

  // The hook takes every prepared streamed segment through the fold and
  // flushes it once the response ends. Both ends of every slice are checked.
  const handler = readFileSync(handlerPath, "utf8");
  const slice = (start: string, end: string) => {
    const from = handler.indexOf(start);
    assert(from >= 0, `useQuestionHandler still has ${JSON.stringify(start)}`);
    const to = handler.indexOf(end, from + start.length);
    assert(to > from, `useQuestionHandler: ${JSON.stringify(end)} follows ${JSON.stringify(start)}`);
    return handler.slice(from, to);
  };
  const flushBody = slice("const flushBufferedSegment = () => {", "\n        };");
  assert(/const prepared = prepareVerifiedLessonSegments\(\[bufferedSegment\], activeDiagram\);/.test(flushBody), "the streamed segment is prepared on its own");
  assert(/focusFold\.take\(prepared\.segments,\s*\{\s*lessonStarted:\s*usableTeachingStepReceived\s*\}\)/.test(flushBody), "every prepared streamed segment goes through the fold");
  assert(!/queuePreparedSegments\(prepared\.segments/.test(flushBody), "no prepared segment skips the fold");
  const finishBody = slice("const flushFocusFold = () => {", "\n        };");
  assert(/focusFold\.finish\(\)/.test(finishBody) && /queuePreparedSegments\(held/.test(finishBody), "the held run is queued at the end");
  const tail = slice("// Flush the final segment through verified-scene ownership filtering.", "throwIfTurnCancelled();");
  assert(/flushBufferedSegment\(\);\s*flushFocusFold\(\);\s*$/.test(tail), "the fold is flushed right after the final segment");
  assert(/let focusFold = createStreamedFocusFold\(activeDiagram, \{ codeLesson: Boolean\(codeLesson\) \}\);/.test(handler), "one fold per turn, off for code lessons");

  console.log(`verify-writeless-focus-fold: ${prepared.foldedFocusSegmentCount} folded, ${checkedFocus} FOCUS cues on their words, rows untouched; streamed path folds the same and holds no row`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
