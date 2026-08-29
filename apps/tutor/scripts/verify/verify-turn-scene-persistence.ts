import {
  LocalDeterministicSolverProvider,
  compileSceneDocument,
  type ProblemIR,
  type SceneArtifactsV3,
  type SceneDocument,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import {
  getSegmentCommands,
  parseStoredSegmentCommands,
  serializeSegmentCommands,
  type TutorSegment,
} from "@heytutor/drawing";
import { selectVerifiedRepresentation } from "../../features/tutor-session/lib/representationFallbackV4";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/verifiedScenePresentation";
import {
  canonicalizeTurnSceneMetadata,
  type SubmittedTurnSceneMetadata,
} from "../../lib/scene/turnScenePersistence";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
const arithmeticQuestion = "Use a number line to find 2+3.";
const arithmeticPlan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3",
  question: arithmeticQuestion,
  givens: [
    { id: "two", symbol: "a", value: 2, provenance: "given", sourceText: "2" },
    { id: "three", symbol: "b", value: 3, provenance: "given", sourceText: "3" },
  ],
  unknowns: [{ id: "answer", symbol: "A" }],
  derived: [{
    id: "answer",
    symbol: "A",
    value: 5,
    provenance: "derived",
    sourceText: "2+3",
    dependsOn: ["two", "three"],
  }],
  qualitativeClaims: [],
  lawIds: [],
  assumptions: [],
  visualRequirement: "required",
};
const problemIR: ProblemIR = {
  schemaVersion: "problem-ir/v1",
  id: "arithmeticProblem",
  question: arithmeticQuestion,
  facts: [{
    id: "requestedAnswer",
    kind: "requested",
    statement: "Find the value of 2+3",
    evidence: { source: "question", start: 0, end: arithmeticQuestion.length, quote: arithmeticQuestion },
  }],
  entities: [],
  expressions: [{
    id: "sumExpression",
    valueType: "scalar",
    root: {
      kind: "binary",
      operator: "+",
      left: { kind: "number", value: 2 },
      right: { kind: "number", value: 3 },
    },
    evidenceFactIds: ["requestedAnswer"],
  }],
  constraints: [],
  representationIntents: [],
  solveRequests: [{
    id: "evaluateSum",
    kind: "evaluate",
    expressionId: "sumExpression",
    resultBinding: {
      turnPlanQuantityId: "answer",
      symbol: "A",
      evidenceFactIds: ["requestedAnswer"],
    },
  }],
};
const solverResult = await new LocalDeterministicSolverProvider().solve(problemIR);

const exactDocument: SceneDocument = {
  schemaVersion: "scene-document/v2",
  visualDecision: { mode: "scene", reason: "verified number-line construction" },
  source: { question: arithmeticQuestion, representationTier: "exact_verified", nonMetric: false },
  quantities: [
    { id: "two", value: 2 },
    { id: "three", value: 3 },
    { id: "answer", value: 5 },
  ],
  entities: [
    { id: "line_start", kind: "point", role: "number-line start" },
    { id: "line_end", kind: "point", role: "number-line end" },
    { id: "number_line", kind: "segment", role: "number line" },
    { id: "start_value", kind: "point", role: "starting value", label: "2" },
    { id: "sum_value", kind: "point", role: "sum", label: "5" },
    { id: "add_three", kind: "vector", role: "add three" },
  ],
  constructions: [
    { id: "make_line_start", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["line_start"] },
    { id: "make_line_end", operator: "point", inputs: { x: 6, y: 0, coordinateSpace: "world" }, outputs: ["line_end"] },
    { id: "make_number_line", operator: "segment", inputs: { start: "line_start", end: "line_end" }, outputs: ["number_line"] },
    { id: "make_start_value", operator: "point", inputs: { x: "two", y: 0, coordinateSpace: "world" }, outputs: ["start_value"] },
    { id: "make_sum_value", operator: "point", inputs: { x: "answer", y: 0, coordinateSpace: "world" }, outputs: ["sum_value"] },
    { id: "make_add_three", operator: "vector", inputs: { start: "start_value", end: "sum_value" }, outputs: ["add_three"] },
  ],
  relations: [],
  assertions: [
    { id: "start_on_line", predicate: "on", entities: ["start_value", "number_line"], expected: true, severity: "fatal" },
    { id: "sum_on_line", predicate: "on", entities: ["sum_value", "number_line"], expected: true, severity: "fatal" },
  ],
  annotations: [],
  requiredEntityIds: ["line_start", "line_end", "number_line", "start_value", "sum_value", "add_three"],
  revealGroups: [{
    id: "number_line_setup",
    entityIds: ["line_start", "line_end", "number_line", "start_value", "sum_value", "add_three"],
    dependsOn: [],
    narrationCue: "show addition on the number line",
  }],
  teachingTimeline: [{
    id: "show_number_line",
    action: "reveal",
    targetId: "number_line_setup",
    dependsOn: [],
    narrationIntent: "move three units from two to five",
  }],
};
const exactCompiled = compileSceneDocument(exactDocument);
assert(exactCompiled.ok && exactCompiled.renderScene, "exact persistence fixture must compile");
const exactPresentation = buildVerifiedDiagramPresentation(exactDocument, exactCompiled.renderScene);
const exactArtifacts: SceneArtifactsV3 = {
  schemaVersion: "scene-artifacts/v3",
  turnPlan: arithmeticPlan,
  problemIR,
  solverResult,
  representationTier: "exact_verified",
  nonMetric: false,
  candidates: [],
  diagramResultStatus: "ready",
};
const exactMetadata = metadataFor(
  arithmeticQuestion,
  exactDocument,
  exactArtifacts,
  exactPresentation.introSegments,
);

const accepted = await canonicalizeTurnSceneMetadata(exactMetadata);
assert(accepted.ok, `current exact scene should persist: ${accepted.ok ? "" : accepted.error}`);
assert(accepted.value.sceneEngineVersion === "scene-engine/2.0.0", "engine version must be regenerated");
assert(accepted.value.validationReport?.valid === true, "validation report must be regenerated");
assert(accepted.value.sceneArtifacts?.candidates.length === 1, "client candidate telemetry must be replaced");
assert(accepted.value.sceneArtifacts?.solverAuthority?.status === "verified", "solver authority must be regenerated");

const mutatedCommands = clone(exactMetadata);
const firstTrusted = mutatedCommands.segments.find((segment) =>
  isRecord(segment.command) && segment.command.trustedDiagramGeometry === true
)!;
assert(isRecord(firstTrusted.command) && Array.isArray(firstTrusted.command.commands), "fixture needs trusted command envelope");
const firstCommand = firstTrusted.command.commands[0];
assert(isRecord(firstCommand) && Array.isArray(firstCommand.params), "fixture needs command params");
firstCommand.params[0] = Number(firstCommand.params[0]) + 1;
const mutatedParam = firstCommand.params[0];
const mutatedCommandResult = await canonicalizeTurnSceneMetadata(mutatedCommands);
assert(mutatedCommandResult.ok, `server intro must replace client trusted ink: ${mutatedCommandResult.ok ? "" : mutatedCommandResult.error}`);
assert(
  !mutatedCommandResult.value.segments.some((segment) => {
    if (!isRecord(segment.command) || !Array.isArray(segment.command.commands)) return false;
    const first = segment.command.commands[0];
    return isRecord(first) && Array.isArray(first.params) && first.params[0] === mutatedParam;
  }),
  "replay ink must come from the server compile, not the mutated client payload",
);

const missingTrusted = clone(exactMetadata);
missingTrusted.segments = [];
const missingTrustedResult = await canonicalizeTurnSceneMetadata(missingTrusted);
assert(missingTrustedResult.ok, `a validated scene with no client intro must still persist: ${missingTrustedResult.ok ? "" : missingTrustedResult.error}`);
assert(
  missingTrustedResult.value.segments.some((segment) => isRecord(segment.command) && segment.command.trustedDiagramGeometry === true),
  "the server must inject verified intro segments when the client omitted them",
);

const forgedSolver = clone(exactMetadata);
assert(isRecord(forgedSolver.sceneArtifacts) && isRecord(forgedSolver.sceneArtifacts.solverResult), "fixture needs solver result");
const forgedValues = forgedSolver.sceneArtifacts.solverResult.values;
assert(Array.isArray(forgedValues) && isRecord(forgedValues[0]), "fixture needs solver value");
forgedValues[0].approximate = 6;
forgedValues[0].exact = { kind: "integer", value: "6" };
const forgedSolverResult = await canonicalizeTurnSceneMetadata(forgedSolver);
assert(!forgedSolverResult.ok && /server recomputation/.test(forgedSolverResult.error), "forged solver values must be rejected");

const fallbackQuestion = "Sketch the curve y=x^2 and identify the curve.";
const fallback = selectVerifiedRepresentation({ question: fallbackQuestion });
const fallbackPresentation = buildVerifiedDiagramPresentation(fallback.sceneDocument, fallback.renderScene);
const fallbackArtifacts: SceneArtifactsV3 = {
  schemaVersion: "scene-artifacts/v3",
  turnPlan: null,
  representationTier: fallback.tier,
  // The tier is earned by the selector (a curve computed from the stated
  // equation with a function_value proof is exact); the flag must agree.
  nonMetric: fallback.nonMetric,
  candidates: [],
  diagramResultStatus: "ready",
};
const fallbackMetadata = metadataFor(
  fallbackQuestion,
  fallback.sceneDocument,
  fallbackArtifacts,
  fallbackPresentation.introSegments,
);
const acceptedFallback = await canonicalizeTurnSceneMetadata(fallbackMetadata);
assert(acceptedFallback.ok, `deterministic fallback should persist: ${acceptedFallback.ok ? "" : acceptedFallback.error}`);

const forgedFallback = clone(fallbackMetadata);
assert(isRecord(forgedFallback.sceneDocument) && Array.isArray(forgedFallback.sceneDocument.entities), "fixture needs fallback entities");
assert(isRecord(forgedFallback.sceneDocument.entities[0]), "fixture needs first fallback entity");
forgedFallback.sceneDocument.entities[0].label = "invented label";
const forgedFallbackResult = await canonicalizeTurnSceneMetadata(forgedFallback);
// P1: persist recompiles the accepted document that was taught instead of
// re-inferring a representation from the question (the live-only family and
// ProblemIR context is unavailable here, so re-inference could produce a
// different document than the one the student saw). The server still
// validates and compiles the submitted document — the persisted document and
// its regenerated intro ink come from that server compile of the accepted
// document, so replay matches what was taught.
assert(forgedFallbackResult.ok, "the accepted fallback document is recompiled at persist time, not re-inferred");
assert(
  forgedFallbackResult.value.sceneDocument?.entities[0]?.label === "invented label",
  "the persisted document must be the accepted taught document, not a question re-inference",
);

const invalidFallback = clone(fallbackMetadata);
assert(isRecord(invalidFallback.sceneDocument), "fixture needs a fallback document");
invalidFallback.sceneDocument.schemaVersion = "scene-document/v99";
const invalidFallbackResult = await canonicalizeTurnSceneMetadata(invalidFallback);
assert(
  !invalidFallbackResult.ok && /structurally invalid/.test(invalidFallbackResult.error),
  "a forged non-metric document that fails server validation must still be rejected",
);

const forgedFallbackInk = clone(fallbackMetadata);
const firstFallbackSegment = forgedFallbackInk.segments.find((segment) =>
  isRecord(segment.command) && segment.command.trustedDiagramGeometry === true
)!;
assert(isRecord(firstFallbackSegment.command) && Array.isArray(firstFallbackSegment.command.commands), "fixture needs trusted fallback commands");
const firstFallbackCommand = firstFallbackSegment.command.commands[0];
assert(isRecord(firstFallbackCommand) && Array.isArray(firstFallbackCommand.params), "fixture needs a mutable fallback command");
firstFallbackCommand.params[0] = Number(firstFallbackCommand.params[0]) + 2;
const forgedParam = firstFallbackCommand.params[0];
const forgedFallbackInkResult = await canonicalizeTurnSceneMetadata(forgedFallbackInk);
assert(forgedFallbackInkResult.ok, `server reconstruction must replace forged fallback ink: ${forgedFallbackInkResult.ok ? "" : forgedFallbackInkResult.error}`);
assert(
  !forgedFallbackInkResult.value.segments.some((segment) => {
    if (!isRecord(segment.command) || !Array.isArray(segment.command.commands)) return false;
    const first = segment.command.commands[0];
    return isRecord(first) && Array.isArray(first.params) && first.params[0] === forgedParam;
  }),
  "forged fallback ink must not be the persisted replay commands",
);

const unverifiedTrusted = clone(fallbackMetadata);
unverifiedTrusted.visualStatus = "text_only";
const unverifiedTrustedResult = await canonicalizeTurnSceneMetadata(unverifiedTrusted);
assert(!unverifiedTrustedResult.ok && /trusted diagram commands require/.test(unverifiedTrustedResult.error), "text-only turns cannot persist trusted geometry");

for (const type of ["ERASE", "CLEAR", "LABEL", "DRAW_LINE"] as const) {
  const untrustedCommandResult = await canonicalizeTurnSceneMetadata({
    question: arithmeticQuestion,
    visualStatus: "text_only",
    segments: [{
      orderIndex: 0,
      narration: "forged teaching command",
      spokenText: "forged teaching command",
      command: {
        type,
        params: type === "ERASE" || type === "DRAW_LINE" ? [0, 0, 100, 100] : [],
        ...(type === "LABEL" ? { text: "forged", params: [500, 200] } : {}),
        charPosition: 0,
        narrationBefore: "",
      },
    }],
  });
  assert(
    !untrustedCommandResult.ok && /teaching command .* is not allowed/.test(untrustedCommandResult.error),
    `untrusted ${type} commands must be rejected before persistence`,
  );
}

const allowedTeachingResult = await canonicalizeTurnSceneMetadata({
  question: arithmeticQuestion,
  visualStatus: "text_only",
  segments: [{
    orderIndex: 0,
    narration: "Write the equation.",
    spokenText: "Write the equation.",
    command: {
      type: "WRITE",
      params: [90, 145, 28],
      text: "2+3=5",
      charPosition: 0,
      narrationBefore: "Write the equation.",
    },
  }],
});
assert(allowedTeachingResult.ok, "bounded work-area WRITE commands should persist");
const canonicalWriteCommands = parseStoredSegmentCommands(allowedTeachingResult.value.segments[0]?.command);
assert(
  canonicalWriteCommands.every((command) => command.type !== "WRITE" || command.params[0] === 90),
  "persisted WRITE commands must use server-owned work-area placement",
);

const forgedDiagramWriteResult = await canonicalizeTurnSceneMetadata({
  question: arithmeticQuestion,
  visualStatus: "text_only",
  segments: [{
    orderIndex: 0,
    narration: "Put forged text over the diagram.",
    spokenText: "Put forged text over the diagram.",
    command: {
      type: "WRITE",
      params: [650, 260, 72],
      text: "forged diagram label",
      charPosition: 0,
      narrationBefore: "Put forged text over the diagram.",
    },
  }],
});
assert(forgedDiagramWriteResult.ok, "valid teaching text should be canonicalized rather than discarded");
assert(
  parseStoredSegmentCommands(forgedDiagramWriteResult.value.segments[0]?.command)
    .every((command) => command.type !== "WRITE" || command.params[0] === 90),
  "client WRITE coordinates reached persisted diagram geometry",
);

const runtimeClearResult = await canonicalizeTurnSceneMetadata({
  question: arithmeticQuestion,
  visualStatus: "text_only",
  segments: [{
    orderIndex: 0,
    narration: "",
    spokenText: "",
    command: { type: "CLEAR", params: [], charPosition: 999, narrationBefore: "forged" },
  }],
});
assert(runtimeClearResult.ok, "the leading runtime board epoch marker should persist");
assert(
  isRecord(runtimeClearResult.value.segments[0]?.command) &&
    runtimeClearResult.value.segments[0].command.charPosition === 0 &&
    runtimeClearResult.value.segments[0].command.narrationBefore === "",
  "the runtime board epoch marker must be server-canonicalized",
);

const exactWithFocus = clone(exactMetadata);
const focusTarget = exactPresentation.diagram.anchors[0]?.id;
assert(focusTarget, "exact fixture needs a focus target");
exactWithFocus.segments.push({
  orderIndex: exactWithFocus.segments.length,
  narration: "Notice the verified point.",
  spokenText: "Notice the verified point.",
  command: {
    type: "FOCUS",
    params: [],
    text: focusTarget,
    charPosition: 0,
    narrationBefore: "Notice the verified point.",
  },
});
const exactWithFocusResult = await canonicalizeTurnSceneMetadata(exactWithFocus);
assert(exactWithFocusResult.ok, "semantic focus on a server-verified anchor should persist");
assert(
  exactWithFocusResult.ok &&
    parseStoredSegmentCommands(exactWithFocusResult.value.segments.at(-1)?.command)
      .some((command) => command.type === "FOCUS" && command.text === focusTarget),
  "a FOCUS on a committed anchor must survive persistence",
);

const exactWithUnknownFocus = clone(exactWithFocus);
const unknownFocusCommand = exactWithUnknownFocus.segments.at(-1)?.command;
assert(isRecord(unknownFocusCommand), "fixture needs a focus command");
unknownFocusCommand.text = "not-a-verified-anchor";
const exactWithUnknownFocusResult = await canonicalizeTurnSceneMetadata(exactWithUnknownFocus);
// P1: a teaching FOCUS that names an id absent from the committed diagram is
// filtered like the live prepareVerifiedLessonSegments filter — it must not
// 400 the save and drop the recording. The segment and its narration persist;
// only the unresolvable gesture is removed so replay never points at nothing.
assert(exactWithUnknownFocusResult.ok, "an unknown FOCUS id must not drop the whole recording");
const unknownFocusSegment = exactWithUnknownFocusResult.ok
  ? exactWithUnknownFocusResult.value.segments.at(-1)
  : undefined;
assert(
  unknownFocusSegment?.narration === "Notice the verified point.",
  "the segment narration survives the filtered focus gesture",
);
assert(
  parseStoredSegmentCommands(unknownFocusSegment?.command).every((command) => command.type !== "FOCUS"),
  "the unresolved FOCUS gesture is filtered out of the persisted turn",
);

const exactWithEmphasize = clone(exactMetadata);
exactWithEmphasize.segments.push({
  orderIndex: exactWithEmphasize.segments.length,
  narration: "Keep this formula.",
  spokenText: "Keep this formula.",
  command: {
    type: "EMPHASIZE",
    params: [],
    text: "last",
    charPosition: 0,
    narrationBefore: "Keep this formula.",
  },
});
const exactWithEmphasizeResult = await canonicalizeTurnSceneMetadata(exactWithEmphasize);
assert(exactWithEmphasizeResult.ok, "semantic EMPHASIZE on a work-area row should persist");

const exactWithSpotlight = clone(exactMetadata);
exactWithSpotlight.segments.push({
  orderIndex: exactWithSpotlight.segments.length,
  narration: "Notice the verified point.",
  spokenText: "Notice the verified point.",
  command: {
    type: "FOCUS",
    params: [],
    text: `${focusTarget}|spotlight`,
    charPosition: 0,
    narrationBefore: "Notice the verified point.",
  },
});
const exactWithSpotlightResult = await canonicalizeTurnSceneMetadata(exactWithSpotlight);
assert(exactWithSpotlightResult.ok, "FOCUS spotlight variants must persist against a verified anchor");

const failedExactAttempt = await canonicalizeTurnSceneMetadata({
  question: arithmeticQuestion,
  visualStatus: "retry_required",
  sceneArtifacts: {
    schemaVersion: "scene-artifacts/v3",
    turnPlan: arithmeticPlan,
    candidates: [],
    diagramResultStatus: "retry_required",
    degradation: {
      attemptedTier: "exact_verified",
      reason: "candidate_invalid",
      issueCodes: ["assertion_failed", "assertion_failed", "invalid code is removed"],
      candidateCount: 2,
    },
  },
  segments: [],
});
assert(failedExactAttempt.ok, "failed exact attempt telemetry should persist without geometry");
assert(
  failedExactAttempt.value.sceneArtifacts?.degradation?.reason === "candidate_invalid" &&
    failedExactAttempt.value.sceneArtifacts.degradation.issueCodes.join(",") === "assertion_failed",
  "failed exact attempt telemetry was not bounded and canonicalized",
);

console.log("turn scene persistence verification passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function metadataFor(
  question: string,
  document: SceneDocument,
  artifacts: SceneArtifactsV3,
  segments: TutorSegment[],
): SubmittedTurnSceneMetadata {
  return {
    question,
    sceneDocument: document,
    sceneEngineVersion: "forged-client-version",
    validationReport: { valid: true, issues: [] },
    visualStatus: "validated",
    sceneArtifacts: artifacts,
    segments: segments.map((segment, index) => ({
      orderIndex: index,
      narration: segment.narration,
      spokenText: segment.narration,
      command: serializeSegmentCommands(getSegmentCommands(segment), {
        trustedDiagramGeometry: true,
      }),
    })),
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
