import {
  matchDiagramTemplate,
  DIAGRAM_TEMPLATES,
  repairDiagramCommand,
  templateToDrawCommand,
  resolveAnnotationWithAnchors,
  isDuplicateTemplateDraw,
} from "@heytutor/drawing";
import { TUTOR_BASE_PROMPT, buildTurnSystemPrompt, buildContinuationPrompt } from "../src/systemPrompt";
import { planLesson } from "../src/topicPlanner";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

assert(DIAGRAM_TEMPLATES.length >= 5, "expected at least 5 diagram templates");

const fbd = matchDiagramTemplate("draw free body diagram for 5kg box with friction mu=0.3");
assert(fbd?.id === "fbd", "FBD template should match");

const bead = matchDiagramTemplate("bead on rotating hoop find equilibrium angle theta");
assert(bead?.id === "circular_motion", "circular motion template should match");

const parabola = matchDiagramTemplate("find vertex of parabola y^2 = 4ax");
assert(parabola?.id === "coordinate_axes", "coordinate axes template should match parabola");

const fbdPlan = planLesson("free body diagram 5kg friction", fbd);
assert(fbdPlan.promptAddon.includes("ALREADY on the board"), "FBD plan should mention skeleton");
assert(fbdPlan.promptAddon.length < 4000, "per-turn addon should stay compact");
assert(!fbdPlan.promptAddon.includes("MATHEMATICS:"), "should not dump full syllabus");

const turnPrompt = buildTurnSystemPrompt(fbdPlan.promptAddon);
assert(turnPrompt.includes("--- current lesson (runtime) ---"), "turn prompt should have runtime section");
assert(turnPrompt.length < 25000, "turn prompt should stay compact vs old monolith (~35k with full JEE dump)");
assert(fbdPlan.promptAddon.length < 3000, "per-turn addon should stay small");

assert(buildTurnSystemPrompt("") === TUTOR_BASE_PROMPT, "empty addon should return base prompt only");

const repaired = repairDiagramCommand(
  templateToDrawCommand({ type: "LABEL", params: [50, 50], text: "θ", anchorId: "theta" }),
);
assert(repaired.params[0] >= 400, "diagram label outside zone should be repaired");

const snap = resolveAnnotationWithAnchors(
  "CIRCLE_AROUND",
  [0, 0, 10, 10],
  bead!.anchors,
  [],
  "this is the angle theta from vertical",
);
assert(snap.snapped, "annotation should snap to template theta anchor");

const noLabelSnap = resolveAnnotationWithAnchors(
  "CIRCLE_AROUND",
  [0, 0, 10, 10],
  bead!.anchors,
  [],
  "the bead moves along the hoop",
);
assert(!noLabelSnap.snapped, "CIRCLE_AROUND should not snap without label match");

const fbdPlanAddon = fbdPlan.promptAddon;
const continuation = buildContinuationPrompt(fbdPlanAddon);
assert(continuation.includes("diagram reminder"), "continuation should include template reminder");
assert(continuation.includes("ALREADY on the board"), "continuation should repeat skeleton hint");

const duplicateDraw = isDuplicateTemplateDraw(
  { type: "DRAW_RECT", params: [540, 360, 240, 30], charPosition: 0, narrationBefore: "", syncable: false },
  fbd!,
);
assert(duplicateDraw, "template duplicate DRAW_RECT should be detected");

console.log("verify-diagram-templates: all checks passed");
