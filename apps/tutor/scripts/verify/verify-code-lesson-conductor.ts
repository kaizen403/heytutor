/**
 * Conductor gate.
 *
 * Every failure the owner reported in the teaching stream was the model
 * deciding the lesson's shape: all the code arriving at once, blocks skipped
 * or repeated, and the figure frozen while the panel scrolled. The plan
 * already fixes the block order and the trace already fixes the figure order,
 * so the conductor enforces both and the model only narrates.
 *
 * These cases are the adversarial streams, not the happy path: the point is
 * that a badly-behaved model still produces a correct lesson.
 */
import { getSegmentCommands, type TutorSegment } from "@heytutor/drawing";
import type { CodeLessonPlan } from "@heytutor/tutor-core";
import {
  codeLessonResumeNote,
  createCodeLessonConductor,
  frameAdvanceRole,
  placeDsaFigureIntro,
  resolveCodeLessonSegments,
} from "../../features/tutor-session/lib/code-lesson/codeLessonSegments";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const PLAN: CodeLessonPlan = {
  schemaVersion: "code-lesson/v1",
  question: "reverse a linked list",
  title: "Reverse a linked list",
  language: "python",
  sections: [
    {
      id: "s1",
      title: "Reverse",
      explanation: "Walk the list once, flipping each next pointer.",
      blocks: [
        { id: "s1b1", code: "def reverse(head):" },
        { id: "s1b2", code: "    prev = None" },
        { id: "s1b3", code: "    curr = head" },
        { id: "s1b4", code: "    while curr:" },
      ],
      typeAlongRanges: [],
    },
    {
      id: "s2",
      title: "Flip",
      explanation: "Save next, point back, walk forward.",
      blocks: [
        { id: "s2b1", code: "        nxt = curr.next" },
        { id: "s2b2", code: "        curr.next = prev" },
      ],
      typeAlongRanges: [],
    },
  ],
  diagramHint: { structure: "linked_list", steps: [{ id: "a" }, { id: "b" }] },
};

const ORDER = PLAN.sections.flatMap((section) => section.blocks.map((block) => block.id));

function typeSegment(blockId: string, narration = "and then this happens next."): TutorSegment {
  return {
    narration,
    command: { type: "TYPE", params: [], text: blockId, charPosition: 0, narrationBefore: narration },
    commands: [{ type: "TYPE", params: [], text: blockId, charPosition: 0, narrationBefore: narration }],
  } as unknown as TutorSegment;
}

function focusSegment(id: string, narration = "look at the figure now."): TutorSegment {
  const command = {
    type: "FOCUS",
    params: [],
    text: `${id}|spotlight`,
    charPosition: 0,
    narrationBefore: narration,
  };
  return { narration, command, commands: [command] } as unknown as TutorSegment;
}

function focusTargets(segments: TutorSegment[]): string[] {
  return segments.flatMap((segment) =>
    ((segment as { commands?: Array<{ type: string; text?: string }> }).commands ?? [])
      .filter((command) => command.type === "FOCUS")
      .map((command) => command.text ?? ""),
  );
}

function revealedOrder(segments: TutorSegment[]): string[] {
  return segments.flatMap((segment) =>
    ((segment as { commands?: Array<{ type: string; semanticRef?: { entityId?: string } }> }).commands ?? [])
      .filter((command) => command.type === "TYPE")
      .map((command) => command.semanticRef?.entityId ?? ""),
  );
}

function frameCount(segments: TutorSegment[]): number {
  return segments.flatMap((segment) =>
    ((segment as { commands?: Array<{ type: string }> }).commands ?? []).filter((command) => command.type === "FRAME"),
  ).length;
}

// --- All blocks asked for at once, in the wrong order, still land in order. ---
{
  const scrambled = ["s2b2", "s1b3", "s1b1", "s2b1", "s1b4", "s1b2"].map((id) => typeSegment(id));
  const result = resolveCodeLessonSegments(scrambled, PLAN);
  assert(
    JSON.stringify(revealedOrder(result.segments)) === JSON.stringify(ORDER),
    `scrambled stream must reveal in plan order, got ${revealedOrder(result.segments).join(",")}`,
  );
  assert(result.missingBlockIds.length === 0, "every block should still be revealed");
}

// --- A repeated tag advances rather than re-typing the same block. ---
{
  const repeated = ["s1b1", "s1b1", "s1b2"].map((id) => typeSegment(id));
  const result = resolveCodeLessonSegments(repeated, PLAN);
  const order = revealedOrder(result.segments);
  assert(
    JSON.stringify(order) === JSON.stringify(["s1b1", "s1b2", "s1b3"]),
    `three tags must reveal three blocks in order, got ${order.join(",")}`,
  );
  assert(new Set(order).size === order.length, "no block may be typed twice");
  assert(result.duplicateBlockIds.includes("s1b1"), "the lagging tag should still be reported");
}

// --- An unknown block id is reported, never rendered. ---
{
  const result = resolveCodeLessonSegments([typeSegment("does_not_exist"), typeSegment("s1b1")], PLAN);
  assert(result.unknownBlockIds.includes("does_not_exist"), "an unknown block id must be reported");
  assert(revealedOrder(result.segments).length === 1, "only the real block may render");
}

// --- Skipping is impossible: fewer tags reveal fewer blocks, never the wrong ones. ---
{
  const result = resolveCodeLessonSegments([typeSegment("s2b2"), typeSegment("s2b2")], PLAN);
  const order = revealedOrder(result.segments);
  assert(order[0] === "s1b1", `the first reveal is always the first block, got ${order[0]}`);
  assert(
    JSON.stringify(result.missingBlockIds) === JSON.stringify(ORDER.slice(order.length)),
    "unrevealed blocks must be reported so the turn can flag an incomplete lesson",
  );
}

// --- Handwriting and marker ink never survive a DSA turn. ---
{
  const inky = [{
    narration: "let me draw this out",
    commands: [
      { type: "WRITE", params: [90, 200], text: "prev = None", charPosition: 0, narrationBefore: "" },
      { type: "UNDERLINE", params: [0, 0, 10, 10], charPosition: 0, narrationBefore: "" },
      { type: "DRAW_RECT", params: [0, 0, 10, 10], charPosition: 0, narrationBefore: "" },
      { type: "FOCUS", params: [], text: "cell0", charPosition: 0, narrationBefore: "" },
      { type: "PAUSE", params: [400], charPosition: 0, narrationBefore: "" },
    ],
  }] as unknown as TutorSegment[];
  const result = resolveCodeLessonSegments(inky, PLAN);
  const kinds = ((result.segments[0] as { commands?: Array<{ type: string }> }).commands ?? []).map((c) => c.type);
  assert(
    JSON.stringify(kinds) === JSON.stringify(["FOCUS", "PAUSE"]),
    `only FOCUS and PAUSE may survive, got ${kinds.join(",")}`,
  );
  assert(result.blockedCommandCount === 3, `three ink commands should be blocked, got ${result.blockedCommandCount}`);
}

// --- Frame advances are spread between blocks, not bunched. ---
{
  const stream = ORDER.map((id) => typeSegment(id));
  const result = resolveCodeLessonSegments(stream, PLAN, { frameCount: 4 });
  // Frame 1 is delayed intro, not a FRAME command, so three advances remain.
  assert(result.insertedFrameCount === 3, `expected 3 advances, got ${result.insertedFrameCount}`);
  assert(result.codeCatchUpFrameCount === 3, "all advances caused by skipped figure tags are true catch-up");
  assert(frameCount(result.segments) === 3, "advances must actually be emitted into the stream");

  // No two advances may sit against the same block, or the figure would jump
  // twice with nothing said in between.
  const positions: number[] = [];
  let blockIndex = 0;
  for (const segment of result.segments) {
    for (const command of (segment as { commands?: Array<{ type: string }> }).commands ?? []) {
      if (command.type === "FRAME") positions.push(blockIndex);
      if (command.type === "TYPE") blockIndex += 1;
    }
  }
  assert(new Set(positions).size === positions.length, `advances bunched at ${positions.join(",")}`);
}

// --- A turn with no worked example inserts nothing. ---
{
  const result = resolveCodeLessonSegments(ORDER.map((id) => typeSegment(id)), PLAN, { frameCount: 0 });
  assert(result.insertedFrameCount === 0, "no frames means no advances");
  assert(frameCount(result.segments) === 0, "no FRAME command may be emitted");
}

// --- Streaming: state carries across calls, exactly as in a live turn. ---
{
  const conductor = createCodeLessonConductor(PLAN, { frameCount: 3 });
  const seen: string[] = [];
  let frames = 0;
  // One segment at a time, the way the live mini-buffer flushes them.
  for (const id of ORDER) {
    const batch = conductor.resolve([typeSegment(id)]);
    seen.push(...revealedOrder(batch.segments));
    frames += frameCount(batch.segments);
  }
  assert(
    JSON.stringify(seen) === JSON.stringify(ORDER),
    `streamed reveals must match plan order, got ${seen.join(",")}`,
  );
  assert(new Set(seen).size === seen.length, "a streamed turn must not repeat a block");
  assert(frames === 2, `expected 2 advances across the stream, got ${frames}`);
}

// --- A figure beat walks the example forward, one frame per step. ---
{
  // Five frames, and the model narrates each in turn. The first FOCUS draws
  // frame 1 as delayed intro (no FRAME command), so only four advances follow.
  const focusIds = [["c0"], ["c1"], ["c2"], ["c3"], ["c4"]];
  const stream = focusIds.map((_, index) => focusSegment(`frame${index}`));
  const result = resolveCodeLessonSegments(stream, PLAN, {
    frameCount: 5,
    frameFocusIds: focusIds,
  });
  assert(
    frameCount(result.segments) === 4,
    `five figure beats must advance four times, got ${frameCount(result.segments)}`,
  );
  assert(result.unshownFrameCount === 0, "the whole walk-through must be shown");

  // Advance and spotlight arrive in the same step, and the spotlight names the
  // frame that is now on the board — never the id the model guessed.
  const targets = focusTargets(result.segments);
  assert(
    JSON.stringify(targets) === JSON.stringify(["c0|spotlight", "c1|spotlight", "c2|spotlight", "c3|spotlight", "c4|spotlight"]),
    `each beat must spotlight its own frame, got ${targets.join(" ")}`,
  );
  const firstStepCommands = ((result.segments[0] as { commands?: Array<{ type: string }> }).commands ?? [])
    .map((command) => command.type);
  assert(
    JSON.stringify(firstStepCommands) === JSON.stringify(["FOCUS"]),
    `the first beat draws frame 1 as intro, not as a FRAME command, got ${firstStepCommands.join(",")}`,
  );
}

// --- A frame advance says how it may spend its sentence. ---
{
  // Measured 10 Sep 2026: a figure beat drew its frame for 6 s of a 20 s
  // sentence and the pen parked for the rest, while the spotlight fired at
  // +15 s. The executor now walks the named cells after the redraw and halts
  // for the spotlight on its word, but only on a frame the step is about: a
  // frame inserted beside a code block hands the sentence straight back to
  // the TYPE. The conductor is the only place that knows which is which.
  const focusIds = [["c0"], ["c1", "c1b"], ["c2"]];
  const figure = resolveCodeLessonSegments(
    [focusSegment("frame0"), focusSegment("frame1")],
    PLAN,
    { frameCount: 3, frameFocusIds: focusIds },
  );
  const beat = (figure.segments[1] as { commands?: Array<{ type: string; semanticRef?: { entityId?: string; actionId?: string } }> }).commands ?? [];
  const frame = beat.find((command) => command.type === "FRAME");
  assert(frame, "the second figure beat must advance to frame 2");
  assert(
    frameAdvanceRole(frame as never) === "figure_beat",
    `a frame the step is about is a figure beat, got ${frame.semanticRef?.actionId ?? "no role"}`,
  );
  assert(
    frame.semanticRef?.entityId === "c1,c1b",
    `the figure beat must carry the spotlight's ids so the walk can halt on their word, got ${frame.semanticRef?.entityId ?? "nothing"}`,
  );
  assert(beat.findIndex((command) => command.type === "FRAME") < beat.findIndex((command) => command.type === "FOCUS"), "the advance still precedes the spotlight");

  // A skipped frame on the way is a catch-up; only the landing frame walks.
  const skipped = resolveCodeLessonSegments(
    [focusSegment("frame0"), focusSegment("frame2")],
    PLAN,
    { frameCount: 3, frameIds: ["frame0", "frame1", "frame2"], frameFocusIds: focusIds },
  );
  const jump = ((skipped.segments[1] as { commands?: Array<{ type: string; semanticRef?: { actionId?: string } }> }).commands ?? [])
    .filter((command) => command.type === "FRAME")
    .map((command) => frameAdvanceRole(command as never));
  assert(
    JSON.stringify(jump) === JSON.stringify(["catch_up", "figure_beat"]),
    `naming frame 3 from frame 1 passes frame 2 as a catch-up and lands as the figure beat, got ${jump.join(",")}`,
  );

  // A frame inserted beside code never claims the sentence.
  const code = resolveCodeLessonSegments(
    [typeSegment("s1b1"), typeSegment("s1b2"), typeSegment("s1b3"), typeSegment("s1b4")],
    PLAN,
    { frameCount: 3, frameFocusIds: focusIds },
  );
  const inserted = code.segments
    .flatMap((segment) => getSegmentCommands(segment))
    .filter((command) => command.type === "FRAME")
    .map((command) => frameAdvanceRole(command));
  assert(inserted.length > 0, "the code beats must have caught the figure up");
  assert(
    inserted.every((role) => role === "catch_up"),
    `a frame beside a code block is a catch-up, got ${inserted.join(",")}`,
  );

  // A bare FRAME from an older recording has no role and is left alone.
  assert(
    frameAdvanceRole({ type: "FRAME", params: [], charPosition: 0, narrationBefore: "" }) === null,
    "a FRAME without a role must not be mistaken for a figure beat",
  );
}

// --- More figure beats than frames: the walk stops, it never wraps. ---
{
  const focusIds = [["c0"], ["c1"]];
  const stream = [0, 1, 2, 3].map((index) => focusSegment(`frame${index}`));
  const result = resolveCodeLessonSegments(stream, PLAN, {
    frameCount: 2,
    frameFocusIds: focusIds,
  });
  assert(frameCount(result.segments) === 1, "two frames allow exactly one advance");
  const targets = focusTargets(result.segments);
  assert(
    targets.every((target) => target === "c0|spotlight" || target === "c1|spotlight"),
    `extra beats must hold the last frame, got ${targets.join(" ")}`,
  );
}

// --- Figure beats then code beats: nothing is left unshown or untyped. ---
{
  const focusIds = [["c0"], ["c1"], ["c2"]];
  const stream = [
    ...focusIds.map((_, index) => focusSegment(`frame${index}`)),
    ...ORDER.map((id) => typeSegment(id)),
  ];
  const result = resolveCodeLessonSegments(stream, PLAN, {
    frameCount: 3,
    frameFocusIds: focusIds,
  });
  assert(
    JSON.stringify(revealedOrder(result.segments)) === JSON.stringify(ORDER),
    "every block must still be revealed in plan order",
  );
  assert(result.unshownFrameCount === 0, "every frame must have been shown");
  assert(
    frameCount(result.segments) === 2,
    `the walk advances twice and the code beats add nothing, got ${frameCount(result.segments)}`,
  );
}

// --- A code beat never doubles as a figure beat. ---
{
  const focusIds = [["c0"], ["c1"], ["c2"]];
  const both = {
    narration: "and this line does the lookup.",
    commands: [
      { type: "TYPE", params: [], text: "s1b1", charPosition: 0, narrationBefore: "" },
      { type: "FOCUS", params: [], text: "frame2|spotlight", charPosition: 0, narrationBefore: "" },
    ],
  } as unknown as TutorSegment;
  const result = resolveCodeLessonSegments([both], PLAN, {
    frameCount: 3,
    frameFocusIds: focusIds,
  });
  const kinds = ((result.segments[0] as { commands?: Array<{ type: string }> }).commands ?? [])
    .map((command) => command.type);
  assert(
    JSON.stringify(kinds) === JSON.stringify(["TYPE"]),
    `a step that reveals code must not also move the figure, got ${kinds.join(",")}`,
  );
  assert(result.unshownFrameCount === 2, "the walk-through must not have advanced");
}

// --- A lesson that stops early knows exactly what it still owes. ---
{
  // The turn continues the stream while beats remain, so what "remains" has to
  // be exact: the model is told where to pick up, and a wrong answer here
  // either strands half a program in the panel or makes the tutor start over.
  const conductor = createCodeLessonConductor(PLAN, {
    frameCount: 4,
    frameFocusIds: [["c0"], ["c1"], ["c2"], ["c3"]],
  });
  conductor.resolve([focusSegment("frame0"), focusSegment("frame1"), typeSegment("s1b1")]);

  const progress = conductor.status();
  assert(
    JSON.stringify(progress.missingBlockIds) === JSON.stringify(ORDER.slice(1)),
    `five blocks should be outstanding, got ${progress.missingBlockIds.join(",")}`,
  );
  assert(
    progress.unshownFrameCount === 2,
    `two frames should be unshown, got ${progress.unshownFrameCount}`,
  );

  const note = codeLessonResumeNote(progress, PLAN);
  assert(note.includes("2 figure frame"), `the note must name the frames left: ${note}`);
  assert(note.includes("5 code block"), `the note must count the blocks left: ${note}`);
  assert(note.includes("s1b2"), `the note must name where to pick up: ${note}`);
  assert(
    /do not restate|do not summarise|do not start again/i.test(note),
    "a continuation must be told to continue, not to recap",
  );

  // Finishing the lesson leaves nothing owed, and nothing to continue for.
  for (const id of ORDER.slice(1)) conductor.resolve([typeSegment(id)]);
  conductor.resolve([focusSegment("frameN"), focusSegment("frameN")]);
  const done = conductor.status();
  assert(done.missingBlockIds.length === 0, "every block was revealed");
  assert(done.unshownFrameCount === 0, "every frame was shown");
  assert(
    codeLessonResumeNote(done, PLAN) === "",
    "a finished lesson must produce no resume note, or the turn would continue forever",
  );
}

// --- A resume after a doubt starts at the blocks and frames already shown. ---
{
  const conductor = createCodeLessonConductor(PLAN, {
    frameCount: 4,
    alreadyRevealedBlockIds: ["s1b1", "s1b2", "s1b3"],
    framesAlreadyShown: 2,
  });
  const progress = conductor.status();
  assert(
    JSON.stringify(progress.missingBlockIds) === JSON.stringify(ORDER.slice(3)),
    `a resume must skip already-typed blocks, got ${progress.missingBlockIds.join(",")}`,
  );
  assert(
    progress.unshownFrameCount === 2,
    `a resume must skip already-shown frames, got ${progress.unshownFrameCount}`,
  );
  const next = conductor.resolve([typeSegment("s1b4")]);
  assert(
    JSON.stringify(revealedOrder(next.segments)) === JSON.stringify(["s1b4"]),
    "the first TYPE after a resume is the next unrevealed block",
  );
}

// --- Two beats on one frame stay on that frame. ---
{
  // Measured on a live lesson: the model narrated a frame over two steps, and
  // because the conductor advanced on every FOCUS it counted, the board ran a
  // frame ahead of the words from the third step to the sixth. The frame the
  // tag names is what decides where the board goes.
  const frameIds = ["input", "store0", "hit1"];
  const focus = (id: string): TutorSegment => ({
    narration: `about ${id}`,
    command: {
      type: "FOCUS",
      params: [],
      text: `${id}|spotlight`,
      charPosition: 0,
      narrationBefore: "",
      semanticRef: { entityId: `${id}|spotlight` },
    },
  });
  const conductor = createCodeLessonConductor(PLAN, {
    frameCount: frameIds.length,
    frameIds,
    frameFocusIds: [["a"], ["b"], ["c"]],
  });
  const first = conductor.resolve([focus("input"), focus("input")]);
  assert(
    frameCount(first.segments) === 0,
    `naming frame 1 twice must leave the board on frame 1, got ${frameCount(first.segments)} advances`,
  );
  const second = conductor.resolve([focus("store0"), focus("store0"), focus("hit1")]);
  assert(
    frameCount(second.segments) === 2,
    `two more frames named means two advances, got ${frameCount(second.segments)}`,
  );
  assert(second.codeCatchUpFrameCount === 0,
    "advances attached to narrated figure beats are not code catch-up");
  assert(conductor.status().unshownFrameCount === 0, "the walk-through must be complete");

  // An id the walk-through does not have falls back to advancing in order,
  // because a model that invents a name must not strand the figure.
  const loose = createCodeLessonConductor(PLAN, {
    frameCount: 3,
    frameIds,
    frameFocusIds: [["a"], ["b"], ["c"]],
  });
  loose.resolve([focus("made_up"), focus("made_up_2")]);
  assert(loose.status().unshownFrameCount === 1, "unknown ids still walk the figure forward");
}

// --- A tag written before its words travels with them. ---
{
  // Measured in a live lesson: the model writes `[STEP]` then the tag on its
  // own line then the sentence, so the parser hands over a command with no
  // narration followed by narration with no command. The board swapped the
  // figure and spotlighted it a whole sentence before the tutor said why.
  const tagOnly: TutorSegment = {
    narration: "",
    command: {
      type: "TYPE",
      params: [],
      text: ORDER[0]!,
      charPosition: 0,
      narrationBefore: "",
      semanticRef: { entityId: ORDER[0]! },
    },
  };
  const wordsOnly: TutorSegment = { narration: "these lines set up the map", command: null };
  const conductor = createCodeLessonConductor(PLAN, { frameCount: 0 });
  const first = conductor.resolve([tagOnly]);
  assert(
    first.segments.length === 0,
    "a tag with no words waits for the words rather than firing on its own",
  );
  const second = conductor.resolve([wordsOnly]);
  assert(second.segments.length === 1, "the held tag joins the next narrated step");
  const commands = getSegmentCommands(second.segments[0]!);
  assert(
    commands.length === 1 && commands[0]!.type === "TYPE",
    `the words must carry the block reveal, got ${commands.map((command) => command.type).join(",")}`,
  );
  assert(second.segments[0]!.narration === wordsOnly.narration, "the words are unchanged");

  // A response that ends on a tag must still reveal it, or a block would be
  // counted as revealed and never typed.
  const trailing = createCodeLessonConductor(PLAN, { frameCount: 0 });
  trailing.resolve([tagOnly]);
  const finished = trailing.finish();
  assert(
    getSegmentCommands(finished.segments[0] ?? { narration: "", command: null }).length === 1,
    "a trailing tag is emitted when the turn ends",
  );
}

// --- A spoken step with no tag still moves the marker. ---
{
  // The lesson has steps that carry no tag by design: the opening, the
  // approach, the trace-through, the close. Those left the board with nothing
  // to do, so the pen stood still through a minute of speech and the lesson
  // read as stalled. Reported live on a bubble sort question.
  const spoken: TutorSegment = { narration: "the obvious way is to try every pair", command: null };
  const conductor = createCodeLessonConductor(PLAN, {
    frameCount: 3,
    frameIds: ["input", "store0", "hit1"],
    frameFocusIds: [["cell0"], ["cell1"], ["cell2"]],
    fallbackPointIds: ["w1", "w2"],
  });
  const resolved = conductor.resolve([spoken]);
  assert(resolved.segments.length === 1, "the spoken step still reaches the board");
  const commands = getSegmentCommands(resolved.segments[0]!);
  assert(
    commands.length === 1 && commands[0]!.type === "POINT",
    `a spoken step must carry a pointing move, got ${commands.map((command) => command.type).join(",") || "nothing"}`,
  );
  assert(
    commands[0]!.text === "w1",
    `before the figure is up the marker must point at the opening notes, got ${commands[0]!.text}`,
  );

  // After a figure beat the marker walks the frame, not the notes.
  conductor.resolve([focusSegment("input")]);
  const afterFigure = conductor.resolve([{
    narration: "now look at what that first move did",
    command: null,
  }]);
  const afterCommands = getSegmentCommands(afterFigure.segments[0]!);
  assert(
    afterCommands.length === 1 && afterCommands[0]!.type === "POINT",
    "a spoken step after the figure is up must still point",
  );
  assert(
    afterCommands[0]!.text === "cell0",
    `once the figure is up the marker walks the frame, got ${afterCommands[0]!.text}`,
  );

  // A step that already has work keeps it: pointing is a filler, never a
  // second tag competing with the one the lesson asked for.
  const typed = conductor.resolve([
    {
      narration: "these lines set up the map",
      command: {
        type: "TYPE",
        params: [],
        text: ORDER[0]!,
        charPosition: 0,
        narrationBefore: "",
        semanticRef: { entityId: ORDER[0]! },
      },
    },
  ]);
  const typedCommands = getSegmentCommands(typed.segments[0]!);
  assert(
    typedCommands.every((command) => command.type !== "POINT"),
    "a step that reveals code must not also carry a pointing move",
  );
}

// --- With no walk-through, the marker still has somewhere to stand. ---
//
// A pattern the catalog does not cover gets one static figure and no frames,
// so `framePointIds` is empty and a spoken step used to carry no board command
// at all. Measured on Distinct Subsequences: four of eight beats had nothing
// for the board to do, and the pen stood still through half the lesson. A
// static figure is still a figure, and its own anchors are what the marker
// walks.
{
  const spoken = (narration: string): TutorSegment =>
    ({ narration, commands: [] }) as unknown as TutorSegment;
  const stream = [spoken("first we look at what the table is counting."), typeSegment(ORDER[0]!)];

  const withFigure = resolveCodeLessonSegments(stream, PLAN, {
    frameCount: 0,
    fallbackPointIds: ["cell0_0", "cell1_1", "rowh0"],
  });
  const points = withFigure.segments.flatMap((segment) =>
    getSegmentCommands(segment).filter((command) => command.type === "POINT"),
  );
  assert(
    points.length > 0,
    "a spoken step with a static figure on the board must send the marker to it",
  );
  assert(
    (points[0]!.text ?? "").includes("cell0_0"),
    `the marker must walk the figure's own anchors, got ${JSON.stringify(points[0]!.text)}`,
  );

  // Nothing on the board is the one case where standing still is honest.
  const bare = resolveCodeLessonSegments(stream, PLAN, { frameCount: 0 });
  assert(
    bare.segments.flatMap((segment) => getSegmentCommands(segment)).every((command) => command.type !== "POINT"),
    "with no figure at all there is nothing to point at, and the marker must not invent a target",
  );

  // Before any FOCUS the opening notes are the only ink, so the fallback wins.
  const beforeFigure = resolveCodeLessonSegments(stream, PLAN, {
    frameCount: 2,
    frameIds: ["f1", "f2"],
    framePointIds: [["barA"], ["barB"]],
    fallbackPointIds: ["cell0_0"],
  });
  const beforePoints = beforeFigure.segments.flatMap((segment) =>
    getSegmentCommands(segment).filter((command) => command.type === "POINT"),
  );
  assert(
    beforePoints.some((command) => (command.text ?? "").includes("cell0_0")),
    "before the figure is up the marker walks the opening notes",
  );
}

// --- A concept question walks the figure and never opens the editor. ---
{
  const conductor = createCodeLessonConductor(PLAN, {
    includeCode: false,
    frameCount: 2,
    frameIds: ["input", "sorted"],
    framePointIds: [["cell0"], ["cell1"]],
  });
  const resolved = conductor.resolve([
    focusSegment("input", "we start with the input."),
    focusSegment("sorted", "the sorted result follows from the merge."),
    typeSegment(ORDER[0]!, "this code was not requested."),
  ]);
  assert(conductor.status().missingBlockIds.length === 0, "an explanation-only lesson owes no code blocks");
  assert(conductor.status().unshownFrameCount === 0, "the verified walk still reaches its last frame");
  assert(
    resolved.segments.flatMap(getSegmentCommands).every((command) => command.type !== "TYPE"),
    "even a stray TYPE tag cannot open the code editor in an explanation-only lesson",
  );
}

// --- Delayed intro sits after the opening and before the first figure beat. ---
{
  const given = [{ narration: "the question wants two indices.", command: { type: "WRITE", params: [90, 145], text: "Two Sum", charPosition: 0, narrationBefore: "" } }] as unknown as TutorSegment[];
  const intro = [{ narration: "here is the example.", command: { type: "DRAW_RECT", params: [0, 0, 10, 10], charPosition: 0, narrationBefore: "" }, verifiedDiagramIntro: true }] as unknown as TutorSegment[];
  const opening = { narration: "so we need a pair that adds to the target.", command: null };
  const focus = focusSegment("input");
  const placed = placeDsaFigureIntro(given, intro, [opening, focus]);
  assert(placed[0] === given[0], "opening notes stay first");
  assert(placed[1] === opening, "spoken opening stays before the figure");
  assert(placed[2] === intro[0], "frame 1 intro lands on the first FOCUS");
  assert(placed[3] === focus, "the FOCUS that asked for the figure follows it");
  const leftover = placeDsaFigureIntro(given, intro, [opening]);
  assert(
    leftover[leftover.length - 1] === intro[0],
    "if the stream never names a frame the intro still appends",
  );
}

console.log(
  `verify-code-lesson-conductor: ${ORDER.length} blocks — scrambled, repeated, unknown, ` +
    `skipped, inky, and streamed inputs all produce the planned lesson`,
);
