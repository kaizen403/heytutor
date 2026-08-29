import type { DrawCommand } from "@heytutor/drawing";
import { parseDrawingCommands } from "@heytutor/drawing";
import {
  capSceneBatchDurations,
  clampAdaptiveInkFactor,
  effectiveWhiteboardInkSpeed,
  inkPaceContextForSegment,
  MAX_SCENE_BATCH_MS,
  selectInkPace,
} from "../../src/sync/inkPace";
import { getCommandDrawDurationMs, getDrawingDuration } from "../../src/sync/audioSync";

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
assert(
  trainTotal <= MAX_SCENE_BATCH_MS,
  `compound scene ink must cap at ${MAX_SCENE_BATCH_MS}ms, got ${trainTotal}`,
);
assert(
  trainNatural.reduce((sum, ms) => sum + ms, 0) > trainTotal,
  "busy figures must be time-capped so the lecture does not stall on decoration",
);

assert(clampAdaptiveInkFactor(2, "follow") === 1.2, "follow catch-up must not sprint past 1.2×");
assert(clampAdaptiveInkFactor(0.4, "follow") === 0.85, "follow catch-up must not crawl formulas");
assert(clampAdaptiveInkFactor(2, "scene") === 2, "scene catch-up may run faster than follow");
assert(
  effectiveWhiteboardInkSpeed(1, 2, "follow") <= 1.2,
  "whiteboard follow speed must stay with live voice",
);
assert(
  effectiveWhiteboardInkSpeed(1, 2, "scene") > effectiveWhiteboardInkSpeed(1, 2, "follow"),
  "scene animation speed may exceed follow catch-up",
);

const parsed = parseDrawingCommands("Write the relation. [WRITE:F = ma,80,200]");
assert(parsed.commands[0], "parser must emit the WRITE");
assert(!("pace" in parsed.commands[0]!), "teaching stream must not carry a pace field");
assert(!("speed" in parsed.commands[0]!), "teaching stream must not pick drawing speed");

console.log("verify-ink-pace: follow formulas stay slower than scene geometry; compound figures cap");
