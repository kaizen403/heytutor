import {
  REQUIRED_DIAGRAM_RETRY_ENABLED,
  PROBLEM_AUTHORITY_DEADLINE_MS,
  TURN_PLAN_ATTEMPT_DEADLINE_MS,
  TURN_PLAN_DEADLINE_MS,
  diagramFailureVisualStatus,
  resolvePlannedSceneVisualStatus,
  selectBestAvailableTurnPlan,
} from "../features/tutor-session/lib/diagramGenerationV3";
import { isTurnMetadataPersistable } from "../lib/turnPersistencePolicy";
import {
  prepareVerifiedLessonSegments,
  type DrawCommand,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import { cursorOpacity } from "@heytutor/whiteboard";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(REQUIRED_DIAGRAM_RETRY_ENABLED, "required diagrams must fail closed unless explicitly disabled");
assert(TURN_PLAN_DEADLINE_MS === 20_000, "turn-plan work must leave 40 seconds for scene synthesis and repair");
assert(
  TURN_PLAN_ATTEMPT_DEADLINE_MS >= 10_000 && TURN_PLAN_ATTEMPT_DEADLINE_MS < TURN_PLAN_DEADLINE_MS,
  "the initial turn plan must tolerate observed latency while reserving a bounded audit window",
);
assert(PROBLEM_AUTHORITY_DEADLINE_MS <= 18_000, "solver authority must preserve at least twenty-two seconds for scene synthesis");
const plannedTurn = { source: "planned" };
const auditedTurn = { source: "audited" };
const fallbackTurn = { source: "fallback" };
assert(
  selectBestAvailableTurnPlan(auditedTurn, plannedTurn, fallbackTurn) === auditedTurn,
  "an audited turn plan must take precedence",
);
assert(
  selectBestAvailableTurnPlan(null, plannedTurn, fallbackTurn) === plannedTurn,
  "an unavailable audit must not discard a validated primary turn plan",
);
assert(
  selectBestAvailableTurnPlan(null, null, fallbackTurn) === fallbackTurn,
  "the conservative fallback is only for total turn-planner failure",
);
const completePrimary = {
  unknowns: [{ id: "d_i", symbol: "d_i" }, { id: "a", symbol: "a" }],
  derived: [
    { id: "d_i_calc", symbol: "d_i", value: 60 },
    { id: "a_value", symbol: "a", value: 2 },
  ],
};
const incompleteAudit = {
  unknowns: [{ id: "d_i", symbol: "d_i" }, { id: "a", symbol: "a" }],
  derived: [{ id: "angular_speed", symbol: "alpha", value: 10 }],
};
assert(
  selectBestAvailableTurnPlan(incompleteAudit, completePrimary, completePrimary) === completePrimary,
  "an audit must not replace a primary plan while dropping a requested numerical result",
);
const disagreeingCompleteAudit = {
  unknowns: completePrimary.unknowns,
  derived: [
    { id: "d_i_calc", symbol: "d_i", value: 50 },
    { id: "a_value", symbol: "a", value: 4 },
  ],
};
const agreeingPeer = structuredClone(completePrimary);
assert(
  selectBestAvailableTurnPlan(
    disagreeingCompleteAudit,
    completePrimary,
    incompleteAudit,
    [agreeingPeer],
  ) === completePrimary,
  "two agreeing complete plans must outvote a disagreeing complete audit",
);

assert(
  resolvePlannedSceneVisualStatus({
    visualRequirement: "required",
    hasValidatedScene: false,
    requiredRetryEnabled: true,
  }) === "retry_required",
  "a valid text_only planner result must still block when TurnPlan requires a diagram",
);
assert(
  resolvePlannedSceneVisualStatus({
    visualRequirement: "optional",
    hasValidatedScene: false,
    requiredRetryEnabled: true,
  }) === "text_only",
  "optional diagrams may degrade to text-only",
);
assert(
  resolvePlannedSceneVisualStatus({
    visualRequirement: "none",
    hasValidatedScene: false,
    requiredRetryEnabled: true,
  }) === "text_only",
  "no-visual turns must continue teaching without a diagram",
);
assert(
  diagramFailureVisualStatus("required", true) === "retry_required",
  "required failure status must honor the retry gate",
);
assert(
  isTurnMetadataPersistable({
    question: "Draw the circuit",
    rawResponse: "",
    visualStatus: "retry_required",
    sceneArtifacts: { schemaVersion: "scene-artifacts/v3" },
  }),
  "required diagram failures with artifacts must persist without narration",
);
assert(
  !isTurnMetadataPersistable({
    question: "Draw the circuit",
    rawResponse: "",
    visualStatus: "text_only",
  }),
  "ordinary empty turns must remain invalid",
);

const compiledBottomBranch = {
  type: "DRAW_LINE",
  params: [570.77, 547.8, 729.23, 547.8],
  charPosition: 0,
  narrationBefore: "",
} satisfies DrawCommand;
const compiledSummary = {
  type: "LABEL",
  text: "Rs = 36Ω",
  params: [452.926, 55, 24],
  charPosition: 0,
  narrationBefore: "",
} satisfies DrawCommand;
assert(compiledSummary.params[1] === 55, "verified summary labels must retain the compiler's reserved title band");
assert(cursorOpacity("idle") === 0, "the marker cursor must be hidden after a turn completes");
assert(cursorOpacity("drawing") > 0, "the marker cursor must remain visible while drawing");

const verifiedDiagram: VerifiedDiagram = {
  id: "verified_scene",
  name: "test scene",
  commands: [],
  anchors: [],
  reveals: [],
  promptAddon: "",
};
const rejectedDraw = prepareVerifiedLessonSegments([
  {
    narration: "the reflected rays converge at the image point.",
    command: { ...compiledBottomBranch, params: [500, 200, 700, 300] },
  },
], verifiedDiagram);
assert(rejectedDraw.blockedCommandCount === 1, "teaching-model structural ink must be rejected");
assert(rejectedDraw.segments.length === 1, "rejecting marker ink must not discard useful narration");
assert(rejectedDraw.segments[0]?.command === null, "rejected marker ink must not reach execution");

const markerOnly = prepareVerifiedLessonSegments([
  {
    narration: "let me draw the ray.",
    command: { ...compiledBottomBranch, params: [500, 200, 700, 300] },
  },
], verifiedDiagram);
assert(markerOnly.droppedSegmentCount === 1, "empty marker-action segments should be removed");

const workWriting = prepareVerifiedLessonSegments([
  {
    narration: "the equivalent resistance is thirty six ohms.",
    command: {
      type: "WRITE",
      text: "R_eq = 36 Ω",
      params: [90, 145],
      charPosition: 0,
      narrationBefore: "",
    },
  },
], verifiedDiagram);
assert(workWriting.blockedCommandCount === 0, "verified scenes must allow work-area equations");

const misplacedWriting = prepareVerifiedLessonSegments([
  {
    narration: "this equation belongs in the work area.",
    command: {
      type: "WRITE",
      text: "x = 2",
      params: [1000, 600],
      charPosition: 0,
      narrationBefore: "",
    },
  },
], verifiedDiagram);
assert(misplacedWriting.blockedCommandCount === 0, "equations must be repaired into the work area");
assert(misplacedWriting.segments[0]?.narration.length, "repaired writing must retain narration");
assert(
  misplacedWriting.segments[0]?.command?.params[0] === 90,
  "model-provided equation coordinates must not control work-area placement",
);

console.log("diagram generation V3 verification passed");
