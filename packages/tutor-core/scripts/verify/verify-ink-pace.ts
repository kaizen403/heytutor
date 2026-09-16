import type { DrawCommand } from "@heytutor/drawing";
import { parseDrawingCommands } from "@heytutor/drawing";
import {
  capSceneBatchDurations,
  clampAdaptiveInkFactor,
  effectiveWhiteboardInkSpeed,
  inkPaceContextForSegment,
  isCuedSceneBatch,
  MAX_SCENE_BATCH_MS,
  selectInkPace,
} from "../../src/sync/inkPace";
import { getCommandDrawDurationMs, getDrawingDuration } from "../../src/sync/audioSync";
import {
  cuedInkBudgetMs,
  cuedInkCapMs,
  cuedInkFloorMs,
  cueWindowRemainingMs,
  cueWindowReserveMs,
  cueWindowSharers,
  getCueSpeechWindow,
  nextDistinctCueToken,
} from "../../src/sync/cueWindow";
import type { AudioTimings } from "../../src/tts/elevenLabsClient";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function command(
  type: DrawCommand["type"],
  params: number[],
  text?: string,
): DrawCommand {
  return {
    type,
    params,
    text,
    charPosition: 0,
    narrationBefore: "",
  };
}

const formula = command("WRITE", [80, 200], "F = ma");
const longFormula = command("WRITE", [80, 260], "r^2 = (x-h)^2 + (y-k)^2");
const sceneLine = command("DRAW_LINE", [450, 300, 850, 320]);
const sceneBody = command("DRAW_RECT", [420, 180, 280, 160]);
const focus = command("FOCUS", []);
const diagramLabel = command("LABEL", [620, 210], "A");

const workWritePace = selectInkPace(formula);
assert(workWritePace === "follow", "work-area WRITE must be follow pace");
assert(selectInkPace(longFormula) === "follow", "formula substitutions must stay followable");
assert(selectInkPace(focus) === "follow", "teaching FOCUS traces must be followable");
assert(selectInkPace(command("EMPHASIZE", [], "last")) === "follow", "EMPHASIZE must stay followable");
assert(selectInkPace(command("SUPERSEDE", [], "1")) === "follow", "SUPERSEDE must stay followable");

const introContext = inkPaceContextForSegment({
  verifiedDiagramIntro: true,
  commandCount: 16,
  hasNarration: true,
});
assert(introContext.explainedInSpeechWindow !== true, "a busy intro is not a single explained stroke");
assert(
  selectInkPace(sceneLine, introContext) === "scene",
  "verified diagram geometry in a compound intro is scene pace",
);
assert(
  selectInkPace(sceneBody, introContext) === "scene",
  "busy scene bodies (train / carriage / circuit) are scene pace",
);
assert(
  selectInkPace(diagramLabel, introContext) === "follow",
  "diagram labels must be read at handwriting pace, even inside a compound intro",
);
assert(
  selectInkPace(sceneLine, introContext) === "scene" &&
    selectInkPace(diagramLabel, introContext) === "follow",
  "structure and naming must be paced apart: fast geometry, readable labels",
);
assert(
  selectInkPace(focus, introContext) === "scene",
  "FOCUS traces inside a compound intro are setup, not lesson follow-along",
);

const explainedContext = inkPaceContextForSegment({
  verifiedDiagramIntro: true,
  commandCount: 1,
  hasNarration: true,
});
assert(explainedContext.explainedInSpeechWindow === true, "a one-mark narrated reveal is explained in-window");
assert(
  selectInkPace(sceneLine, explainedContext) === "follow",
  "a single construction being explained stays followable",
);

const formulaMs = getDrawingDuration(formula, "follow");
const longFormulaMs = getDrawingDuration(longFormula, "follow");
const sceneLineMs = getDrawingDuration(sceneLine, "scene");
assert(formulaMs >= 420, "formula WRITE must stay at handwriting pace");
{
  // Whiteboard dumps ink instantly at <= 18ms/char when there is no schedule.
  // Follow teaching text must stay above that so live pen motion actually runs.
  const instantDumpMs = "F = ma".replace(/\s+/g, "").length * 18;
  assert(
    formulaMs > instantDumpMs,
    `follow WRITE (${formulaMs}ms) must exceed the instant-label dump (${instantDumpMs}ms)`,
  );
}
assert(
  formulaMs > sceneLineMs,
  `formula WRITE (${formulaMs}ms) must be slower than an equivalent-length scene line (${sceneLineMs}ms)`,
);
assert(
  longFormulaMs > sceneLineMs,
  `substitution WRITE (${longFormulaMs}ms) must be slower than scene geometry (${sceneLineMs}ms)`,
);
assert(
  getDrawingDuration(sceneLine, "follow") > sceneLineMs,
  "scene pace must shorten geometry vs the follow metronome",
);
assert(
  getDrawingDuration(diagramLabel, "scene") < getDrawingDuration(diagramLabel, "follow"),
  "scene labels must appear faster than work-area handwriting",
);

const train = Array.from({ length: 18 }, (_, index) =>
  command("DRAW_LINE", [430 + index * 12, 240, 442 + index * 12, 310]),
);
const trainPaces = train.map((cmd) =>
  selectInkPace(cmd, inkPaceContextForSegment({
    verifiedDiagramIntro: true,
    commandCount: train.length,
    hasNarration: true,
  })),
);
assert(
  trainPaces.every((pace) => pace === "scene"),
  "a train / compound figure must draw at scene pace",
);
const trainNatural = train.map((cmd, index) => getCommandDrawDurationMs(cmd, trainPaces[index]));
const trainCapped = capSceneBatchDurations(trainNatural);
const trainTotal = trainCapped.reduce((sum, ms) => sum + ms, 0);
// An uncued batch (a DSA frame, a figure with no words to draw under) keeps
// the cap: it is watched as one thing and must not stall the lecture.
assert(
  trainTotal <= MAX_SCENE_BATCH_MS,
  `uncued compound scene ink must cap at ${MAX_SCENE_BATCH_MS}ms, got ${trainTotal}`,
);
assert(
  trainNatural.reduce((sum, ms) => sum + ms, 0) > trainTotal,
  "uncued busy figures must be time-capped so the lecture does not stall on decoration",
);
assert(!isCuedSceneBatch(train), "a batch with no spoken cues is not a cued batch");

// A cued intro is paced by the voice, one part per word. The cap is what
// squeezed a 10 s mirror intro into 1.3 s of ink and a 3.3 s parked pen
// (measured 10 Sep 2026), so it must not touch a cued batch.
{
  const cuedTrain = train.map((cmd, index) => ({
    ...cmd,
    spokenCue: { token: index < 9 ? "carriages" : "wheels", entityId: `car_${index}` },
  }));
  assert(isCuedSceneBatch(cuedTrain), "a batch whose every command names its word is a cued batch");
  assert(
    !isCuedSceneBatch([...cuedTrain, train[0]!]),
    "one command with no word makes the batch uncued; the cap then applies to all of it",
  );
  const cuedDurations = capSceneBatchDurations(trainNatural, MAX_SCENE_BATCH_MS, { cued: isCuedSceneBatch(cuedTrain) });
  assert(
    cuedDurations.reduce((sum, ms) => sum + ms, 0) === trainNatural.reduce((sum, ms) => sum + ms, 0),
    "the scene batch cap must not apply to a cued intro",
  );
}

// The cue window: where in the sentence's audio a part's word is spoken.
{
  const narration = "The mirror, its pole, focus and centre, and the object.";
  const msPerChar = 86;
  const estimated = getCueSpeechWindow(narration, { token: "pole", entityId: "P" }, null, msPerChar, 0, "focus");
  assert(estimated.matched, "a whole word in the sentence is matched");
  assert(
    estimated.startMs === narration.indexOf("pole") * msPerChar,
    `an estimated window starts where the word is spoken at ${msPerChar} ms per char, got ${estimated.startMs}`,
  );
  assert(
    estimated.endMs === narration.indexOf("focus") * msPerChar,
    `the window runs to the next part's word, got ${estimated.endMs}`,
  );
  assert(estimated.cursor === narration.indexOf("pole") + "pole".length, "the cursor moves past the matched word");
  // A second part under the same word finds that word again from the cursor;
  // a different word cannot land on the head of the phrase just matched.
  const shared = getCueSpeechWindow(narration, { token: "pole", entityId: "P_tick" }, null, msPerChar, estimated.cursor, "focus");
  assert(shared.matched && shared.startMs === estimated.startMs, "a part under the same word shares its window");
  const support = "then the pulley support, the pulley, then the string";
  const first = getCueSpeechWindow(support, { token: "pulley support", entityId: "s" }, null, msPerChar, 0, "pulley");
  const circle = getCueSpeechWindow(support, { token: "pulley", entityId: "p" }, null, msPerChar, first.cursor, "string");
  assert(
    circle.matched && circle.startMs === support.indexOf("the pulley,") * msPerChar + "the ".length * msPerChar,
    `the pulley is drawn under its own word, not the head of "pulley support", got ${circle.startMs}`,
  );

  // Timed: the same sentence at a measured alignment, twice as slow.
  const spokenChars = narration.length;
  const timings: AudioTimings = {
    charStartTimes: Array.from({ length: spokenChars }, (_, index) => index * 0.172),
    charDurations: Array.from({ length: spokenChars }, () => 0.172),
    totalDuration: spokenChars * 0.172,
  };
  const timed = getCueSpeechWindow(narration, { token: "pole", entityId: "P" }, timings, msPerChar, 0, "focus");
  assert(
    Math.abs(timed.startMs - narration.indexOf("pole") * 172) <= 1,
    `a timed window follows the alignment, not the estimate, got ${timed.startMs}`,
  );
  assert(timed.totalMs === Math.round(timings.totalDuration * 1000), "the window carries the sentence length");

  // Whole word, forward from the cursor, case-sensitive when short.
  const inside = getCueSpeechWindow("the concave mirror", { token: "v", entityId: "v" }, null, msPerChar);
  assert(!inside.matched, "\"v\" inside \"concave\" is not the word v");
  const afterCursor = getCueSpeechWindow(narration, { token: "the", entityId: "x" }, null, msPerChar, 30);
  assert(
    afterCursor.matched && afterCursor.cursor === narration.indexOf("the", 30) + "the".length,
    "matching walks forward from the cursor",
  );
  const sameWord = getCueSpeechWindow(narration, { token: "pole", entityId: "P" }, null, msPerChar, estimated.cursor);
  assert(sameWord.cursor === estimated.cursor, "a run of commands under one word lands on the same occurrence");
  const missing = getCueSpeechWindow(narration, { token: "lens", entityId: "L" }, null, msPerChar, 20);
  assert(!missing.matched && missing.endMs === missing.totalMs, "an absent word runs on from the cursor to the end");
  const caseSensitive = getCueSpeechWindow("the object O and o", { token: "O", entityId: "O" }, null, msPerChar);
  assert(caseSensitive.matched && caseSensitive.startMs === "the object O and o".indexOf("O") * msPerChar, "a short label matches its own case");
}

// The cued budget: floored at hand speed, capped at an unhurried pace, the
// slack of a shared window split by how far each part can be drawn out.
{
  const point = command("DRAW_POINT", [500, 300, 2]);
  const arc = command("DRAW_ARC", [600, 300, 150, 60, 120]);
  const label = command("LABEL", [520, 280, 24], "M");
  const pointFloor = cuedInkFloorMs(point);
  const arcFloor = cuedInkFloorMs(arc);
  assert(pointFloor >= 70 && pointFloor < arcFloor, `a dot's floor is the whiteboard minimum plus its flight, under an arc's (${pointFloor} vs ${arcFloor})`);
  assert(cuedInkFloorMs(label) === getCommandDrawDurationMs(label, "follow"), "a label's floor is its handwriting natural");
  assert(cuedInkCapMs(label) === cuedInkFloorMs(label), "a label is not drawn out over its word");
  assert(cuedInkCapMs(arc) > arcFloor && cuedInkCapMs(arc) <= arcFloor * 4, "a shape may be drawn out, but only a few times its hand-speed time");
  assert(cuedInkBudgetMs({ remainingMs: 50, floorMs: 136, capMs: 544 }) === 136, "a window shorter than the floor still gets the floor");
  assert(cuedInkBudgetMs({ remainingMs: 5000, floorMs: 136, capMs: 544 }) === 544, "a long window is capped");
  assert(cuedInkBudgetMs({ remainingMs: 300, floorMs: 136, capMs: 544 }) === 300, "inside the window the part fills what is left");
  const shared = cuedInkBudgetMs({
    remainingMs: 1000,
    floorMs: 136,
    capMs: 544,
    sharers: { floorMs: 470, capacityMs: 0 },
  });
  assert(shared === 530, `a label sharing the window keeps its floor and the shape takes the slack, got ${shared}`);
  const even = cuedInkBudgetMs({
    remainingMs: 1000,
    floorMs: 100,
    capMs: 500,
    sharers: { floorMs: 100, capacityMs: 400 },
  });
  assert(even === 500, `equal parts split a window evenly, got ${even}`);

  const beat = [
    { ...arc, spokenCue: { token: "mirror", entityId: "mirror" } },
    { ...label, spokenCue: { token: "mirror", entityId: "mirror" } },
    { ...point, spokenCue: { token: "pole", entityId: "P" } },
  ];
  const floors = beat.map((cmd) => cuedInkFloorMs(cmd));
  const caps = beat.map((cmd, index) => cuedInkCapMs(cmd, floors[index]));
  assert(nextDistinctCueToken(beat, 0) === "pole", "the next distinct word closes the window");
  assert(nextDistinctCueToken(beat, 2) === null, "the last word runs to the end of the sentence");
  const sharers = cueWindowSharers(beat, 0, floors, caps);
  assert(sharers.floorMs === floors[1] && sharers.capacityMs === 0, "the label under the same word is a sharer with no stretch");
  assert(cueWindowReserveMs(beat, 0, floors) === floors[2], "the parts under later words reserve their floors");
  assert(cueWindowRemainingMs({ endMs: 1376, totalMs: 4730 }, 412, 0) === 964, "what is left of the window after the wait");
  assert(cueWindowRemainingMs({ endMs: 4128, totalMs: 4730 }, 2752, 700) === 1278, "the reserve shortens a window that would leave too little sentence");
}

assert(clampAdaptiveInkFactor(2, "follow") === 1.2, "follow catch-up must not sprint past 1.2×");
assert(clampAdaptiveInkFactor(0.4, "follow") === 0.85, "follow catch-up must not crawl formulas");
assert(clampAdaptiveInkFactor(2, "scene") === 2, "scene catch-up may run faster than follow");
assert(
  effectiveWhiteboardInkSpeed(1, 2, "follow") <= 1.2,
  "whiteboard follow catch-up at 1× must stay with live voice",
);
assert(
  Math.abs(effectiveWhiteboardInkSpeed(2, 1, "follow") - 2) < 1e-9,
  "a user 2× setting must actually draw at 2×, not stay capped at 1.2×",
);
assert(
  Math.abs(effectiveWhiteboardInkSpeed(0.5, 1, "follow") - 0.5) < 1e-9,
  "a user 0.5× setting must slow the pen, not floor at 0.7×",
);
assert(
  effectiveWhiteboardInkSpeed(1, 2, "scene") > effectiveWhiteboardInkSpeed(1, 2, "follow"),
  "scene animation speed may exceed follow catch-up",
);

const typeBlock = command("TYPE", [], "def kruskal(edges):\n    return mst");
const typeMs = getDrawingDuration(typeBlock, "follow");
assert(typeMs >= 1_200, "TYPE duration must stay readable, not share handwriting's short cap");
assert(
  typeMs > getDrawingDuration(command("WRITE", [80, 200], typeBlock.text), "follow"),
  "code typing must be budgeted slower than an equivalent handwritten line",
);
const parsed = parseDrawingCommands("Write the relation. [WRITE:F = ma,80,200]");
assert(parsed.commands[0], "parser must emit the WRITE");
assert(!("pace" in parsed.commands[0]!), "teaching stream must not carry a pace field");
assert(!("speed" in parsed.commands[0]!), "teaching stream must not pick drawing speed");

// A frame swap is geometry being revealed, not handwriting being followed.
// Paced as handwriting it drew a third slower than the figure it replaces, so
// the redraw finished seconds after the sentence that introduced it and the
// next sentence waited on the ink.
{
  const frameSwap = command("FRAME", []);
  assert(
    selectInkPace(frameSwap) === "scene",
    `a frame swap must reveal at scene pace, got ${selectInkPace(frameSwap)}`,
  );
  assert(
    selectInkPace(frameSwap, { verifiedDiagramIntro: true, batchCommandCount: 1 }) === "scene",
    "a frame swap stays scene pace inside an intro batch too",
  );
}

// A DSA figure's labels are the figure: cell values and index headers, not
// prose being written out. Lettered at handwriting pace the opening figure
// took three times its own sentence to appear, and the voice waited on the ink
// before the lesson could go on.
{
  const introContext = { verifiedDiagramIntro: true, batchCommandCount: 8 };
  assert(
    selectInkPace(diagramLabel, introContext) === "follow",
    "an ordinary figure label is still read at handwriting pace",
  );
  assert(
    selectInkPace(diagramLabel, { ...introContext, sceneText: true }) === "scene",
    "a figure whose text is part of the sketch letters it at scene pace",
  );
  assert(
    selectInkPace(sceneBody, { ...introContext, sceneText: true }) === "scene",
    "geometry is unaffected by the text pace",
  );
  assert(
    selectInkPace(formula, { sceneText: true }) === "follow",
    "work-column prose is never scene text, whatever the figure says",
  );
}

console.log("verify-ink-pace: follow formulas stay slower than scene geometry; uncued compound figures cap; cued intros follow the voice");
