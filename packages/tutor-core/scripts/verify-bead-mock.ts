import {
  buildLessonSegments,
  getSegmentCommands,
  normalizeBoardText,
  type DrawCommand,
} from "@heytutor/drawing";
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

assert(normalizeBoardText("theta") === "θ", "normalizeBoardText: theta -> θ");
assert(normalizeBoardText("sin theta = y/x") === "sin θ = y/x", "normalizeBoardText: sin theta");
assert(normalizeBoardText("f = mu N") === "f = μ N", "normalizeBoardText: mu");
assert(normalizeBoardText("omega^2") === "ω^2", "normalizeBoardText: omega");
assert(normalizeBoardText("phi") === "φ", "normalizeBoardText: phi");

const question =
  "A bead of mass m slides on a frictionless circular hoop of radius R that rotates with angular velocity omega. Find the equilibrium angle theta.";
const response = getMockResponse(question);

assert(response.includes("[DRAW_CIRCLE:650,300"), "mock: expected hoop DRAW_CIRCLE in diagram zone");
assert(response.includes("[LABEL:θ"), "mock: expected θ label on diagram");
assert(response.includes("[LABEL:ω"), "mock: expected ω label on diagram");
assert(!/\[LABEL:theta/i.test(response), "mock: board labels must not spell theta");
assert(response.includes("[CIRCLE_AROUND:"), "mock: expected angle annotation");

const segments = buildLessonSegments(response);
const commands = segments.flatMap((segment) => getSegmentCommands(segment));

const boardTexts = commands
  .filter((cmd) => (cmd.type === "WRITE" || cmd.type === "LABEL") && cmd.text)
  .map((cmd) => cmd.text!.trim());

for (const text of boardTexts) {
  assert(!/\btheta\b/i.test(text), `normalized board text must not contain 'theta': ${text}`);
  assert(!/\bomega\b/i.test(text), `normalized board text must not contain 'omega': ${text}`);
}

const diagramSetup = commands.filter((cmd) => {
  const anchor = commandAnchor(cmd);
  if (!anchor) {
    return false;
  }
  return isInDiagramZone(anchor.x, anchor.y) && ["DRAW_CIRCLE", "DRAW_LINE", "LABEL", "CIRCLE_AROUND"].includes(cmd.type);
});

assert(diagramSetup.length >= 5, "mock: expected multiple diagram-zone setup commands");

const diagramLabels = new Set(
  commands
    .filter((cmd) => cmd.type === "LABEL" && cmd.text)
    .map((cmd) => cmd.text!.trim()),
);
for (const label of ["O", "θ", "ω", "m"]) {
  assert(diagramLabels.has(label), `mock: missing diagram label ${label}`);
}

const firstDiagramIdx = commands.findIndex((cmd) => {
  const anchor = commandAnchor(cmd);
  return anchor !== null && isInDiagramZone(anchor.x, anchor.y) && cmd.type === "DRAW_CIRCLE";
});
const firstAlgebraIdx = commands.findIndex((cmd) => {
  const anchor = commandAnchor(cmd);
  return anchor !== null && anchor.x < LEFT_WORK_X && cmd.type === "WRITE" && cmd.text?.includes("θ");
});

assert(firstDiagramIdx >= 0, "mock: diagram DRAW_CIRCLE not found");
assert(firstAlgebraIdx >= 0, "mock: left-side θ equation not found");
assert(
  firstAlgebraIdx > firstDiagramIdx,
  "mock: algebra must appear after diagram setup (diagram-first pacing)",
);

console.log("verify-bead-mock: all checks passed");
