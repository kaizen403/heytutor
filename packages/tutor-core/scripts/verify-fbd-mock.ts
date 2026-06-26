import { buildLessonSegments, getSegmentCommands, type DrawCommand } from "@heytutor/drawing";
import { getMockResponse } from "../src/mockResponses";

const DIAGRAM_ZONE = { x: 400, y: 140, width: 500, height: 380 };
const LEFT_WORK_X = 400;

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function isInDiagramZone(x: number, y: number): boolean {
  return (
    x >= DIAGRAM_ZONE.x &&
    x <= DIAGRAM_ZONE.x + DIAGRAM_ZONE.width &&
    y >= DIAGRAM_ZONE.y &&
    y <= DIAGRAM_ZONE.y + DIAGRAM_ZONE.height
  );
}

function commandAnchor(command: DrawCommand): { x: number; y: number } | null {
  if (command.params.length < 2) {
    return null;
  }
  const [x, y] = command.params;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y };
}

const question =
  "Solve: a 5 kg box is pushed with 20 N on a surface with μ = 0.3. Find acceleration and draw the free-body diagram.";
const response = getMockResponse(question);

assert(
  response.includes("[DRAW_RECT:540,360"),
  "mock: expected diagram surface DRAW_RECT in diagram zone",
);
assert(response.includes("[LABEL:5 kg"), "mock: expected mass label on diagram");
assert(response.includes("[CIRCLE_AROUND:"), "mock: expected review-mode CIRCLE_AROUND annotations");

const segments = buildLessonSegments(response);
const commands = segments.flatMap((segment) => getSegmentCommands(segment));

const diagramSetup = commands.filter((cmd) => {
  const anchor = commandAnchor(cmd);
  if (!anchor) {
    return false;
  }
  return isInDiagramZone(anchor.x, anchor.y) && ["DRAW_RECT", "DRAW_LINE", "ARROW", "LABEL"].includes(cmd.type);
});

assert(diagramSetup.length >= 6, "mock: expected multiple diagram-zone setup commands");

const forceLabels = new Set(
  commands
    .filter((cmd) => cmd.type === "LABEL" && cmd.text)
    .map((cmd) => cmd.text!.trim()),
);
for (const label of ["F", "f", "N", "mg"]) {
  assert(forceLabels.has(label), `mock: missing force label ${label}`);
}

const annotations = commands.filter((cmd) =>
  ["CIRCLE_AROUND", "ARROW", "UNDERLINE"].includes(cmd.type),
);
assert(annotations.length >= 5, "mock: expected explain + solve phase annotations");

const leftAlgebra = commands.filter((cmd) => {
  if (cmd.type !== "WRITE" || !cmd.text) {
    return false;
  }
  const anchor = commandAnchor(cmd);
  return anchor !== null && anchor.x < LEFT_WORK_X && cmd.text.includes("=");
});

assert(leftAlgebra.length >= 4, "mock: expected multiple left-side algebra WRITE commands");

const firstDiagramIdx = commands.findIndex((cmd) => {
  const anchor = commandAnchor(cmd);
  return anchor !== null && isInDiagramZone(anchor.x, anchor.y) && cmd.type === "DRAW_RECT";
});
const firstAlgebraIdx = commands.findIndex((cmd) => {
  const anchor = commandAnchor(cmd);
  return (
    anchor !== null &&
    anchor.x < LEFT_WORK_X &&
    cmd.type === "WRITE" &&
    cmd.text?.includes("μ")
  );
});

assert(firstDiagramIdx >= 0, "mock: diagram DRAW_RECT not found");
assert(firstAlgebraIdx >= 0, "mock: left-side f = μN equation not found");
assert(
  firstAlgebraIdx > firstDiagramIdx,
  "mock: algebra must appear after diagram setup (diagram-first pacing)",
);

const solveAnnotations = commands.filter((cmd, index) => {
  if (index <= firstAlgebraIdx) {
    return false;
  }
  return ["CIRCLE_AROUND", "ARROW"].includes(cmd.type);
});
assert(
  solveAnnotations.length >= 1,
  "mock: expected at least one annotation during solve phase (e.g. net force ARROW)",
);

console.log("verify-fbd-mock: all checks passed");
