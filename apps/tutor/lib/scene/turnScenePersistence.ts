import {
  LocalDeterministicSolverProvider,
  SCENE_ARTIFACTS_V3_VERSION,
  SCENE_ENGINE_VERSION,
  compileSceneDocument,
  validateProblemIR,
  validateSceneDocument,
  validateSceneQuantityAgreement,
  validateSolverResult,
  validateTurnPlanSceneProofs,
  validateTurnPlanV3,
  archetypeProvenance,
  verifyTurnPlanAgainstSolver,
  type SceneArtifactsV3,
  type SceneDocument,
  type TurnPlanV3,
  type ValidationReport,
} from "@heytutor/scene-engine";
import {
  getSegmentCommands,
  isBlockedVerifiedDiagramCommand,
  isStoredCommandTrustedGeometry,
  fitWorkTextCommand,
  parseStoredSegmentCommands,
  serializeSegmentCommands,
  type DrawCommand,
  type TutorSegment,
} from "@heytutor/drawing";
import { buildVerifiedDiagramPresentation } from "@/features/tutor-session/lib/verifiedScenePresentation";

export interface SubmittedTurnSegment {
  orderIndex: number;
  narration: string;
  spokenText: string;
  command: unknown;
  durationMs?: number;
  timings?: unknown;
}

export interface SubmittedTurnSceneMetadata {
  question: string;
  sceneDocument?: unknown;
  sceneEngineVersion?: string | null;
  validationReport?: unknown;
  visualStatus?: "validated" | "text_only" | "legacy" | "retry_required" | null;
  sceneArtifacts?: unknown;
  segments: SubmittedTurnSegment[];
}

export interface CanonicalTurnSceneMetadata {
  sceneDocument: SceneDocument | null;
  sceneEngineVersion: string | null;
  validationReport: ValidationReport | null;
  visualStatus: "validated" | "text_only" | "retry_required";
  sceneArtifacts: SceneArtifactsV3 | null;
  segments: SubmittedTurnSegment[];
}

export type TurnScenePersistenceResult =
  | { ok: true; value: CanonicalTurnSceneMetadata }
  | { ok: false; error: string };

/**
 * Re-establish every diagram trust claim at the server boundary. A browser may
 * submit a scene for persistence, but it cannot decide that geometry is safe
 * to replay with the uncompiled-diagram guards disabled.
 */
export async function canonicalizeTurnSceneMetadata(
  metadata: SubmittedTurnSceneMetadata,
): Promise<TurnScenePersistenceResult> {
  const question = metadata.question?.trim();
  if (!question) return failure("question is required for scene validation");
  if (!Array.isArray(metadata.segments)) return failure("segments must be an array");
  if (!validSegmentOrder(metadata.segments)) {
    return failure("segment orderIndex values must be unique non-negative integers");
  }

  if (metadata.visualStatus !== "validated") {
    if (metadata.segments.some((segment) => isStoredCommandTrustedGeometry(segment.command))) {
      return failure("trusted diagram commands require a server-validated scene");
    }
    const teachingCommands = canonicalizeTeachingCommands(metadata.segments, null);
    if (!teachingCommands.ok) return teachingCommands;
    const retryRequired = metadata.visualStatus === "retry_required";
    const plan = validatedOptionalTurnPlan(metadata.sceneArtifacts, question);
    const degradation = validatedDegradation(metadata.sceneArtifacts);
    return {
      ok: true,
      value: {
        sceneDocument: null,
        sceneEngineVersion: null,
        validationReport: null,
        visualStatus: retryRequired ? "retry_required" : "text_only",
        sceneArtifacts: retryRequired || degradation
          ? minimalFailureArtifacts(
              plan,
              retryRequired ? "retry_required" : "text_only",
              degradation,
            )
          : null,
        segments: teachingCommands.segments,
      },
    };
  }

  if (!isRecord(metadata.sceneArtifacts)) {
    return failure("validated scenes require scene-artifacts/v3");
  }
  if (metadata.sceneArtifacts.schemaVersion !== SCENE_ARTIFACTS_V3_VERSION) {
    return failure(`validated scenes require ${SCENE_ARTIFACTS_V3_VERSION}`);
  }
  if (metadata.sceneArtifacts.diagramResultStatus !== "ready") {
    return failure("validated scenes require diagramResultStatus ready");
  }
  const tier = metadata.sceneArtifacts.representationTier;
  if (!isRepresentationTier(tier)) return failure("validated scene has an invalid representation tier");
  const nonMetric = tier !== "exact_verified";
  if (metadata.sceneArtifacts.nonMetric !== nonMetric) {
    return failure("representation tier and nonMetric flag disagree");
  }

  const planResult = validateTurnPlanV3(metadata.sceneArtifacts.turnPlan, question);
  const turnPlan = planResult.plan;
  if (tier === "exact_verified" && !turnPlan) {
    // A plan is one source of exact numbers, not the only one. When every
    // metric slot was read from the question itself — "Sketch y = x^2", a
    // circle given by its own equation — the stem IS the source of truth, and
    // demanding a plan would mean re-deriving what the question already states.
    // Anything less than fully stem-grounded ("mixed", a display default, or a
    // document with no archetype provenance at all) still needs the plan.
    const submitted = validateSceneDocument(metadata.sceneDocument);
    if (!submitted.document) {
      // A document that does not even parse is structurally invalid; saying it
      // has a bad plan would hide the real reason from the caller.
      return failure(`exact scene is structurally invalid: ${formatIssues(submitted.report.issues)}`);
    }
    if (archetypeProvenance(submitted.document).exactGrounding !== "stem") {
      return failure(`exact scene has an invalid TurnPlanV3: ${formatIssues(planResult.issues)}`);
    }
  }

  let document: SceneDocument;
  let report: ValidationReport;
  let renderScene: NonNullable<ReturnType<typeof compileSceneDocument>["renderScene"]>;
  if (nonMetric) {
    // Recompile the accepted document that was actually taught. Re-running
    // selectVerifiedRepresentation here would re-infer families from the
    // question without the live-only context (inferred families, ProblemIR),
    // so the rebuilt document could differ from the one the student saw:
    // replay would diverge and teaching FOCUS on the taught ids would 400 the
    // save. Trust is re-established by validating and compiling the submitted
    // document; intro ink below is regenerated from this server compile,
    // never from the browser's trusted-geometry payload.
    const structural = validateSceneDocument(metadata.sceneDocument);
    if (!structural.document) {
      return failure(`accepted representation is structurally invalid: ${formatIssues(structural.report.issues)}`);
    }
    document = structural.document;
    if (document.visualDecision.mode !== "scene") {
      return failure("accepted representation persisted as text-only");
    }
    if (!sourceQuestionMatches(document, question)) {
      return failure("scene source question does not match the submitted question");
    }
    const declaredTier = document.source.representationTier;
    if (declaredTier !== undefined && declaredTier !== tier) {
      return failure("submitted fallback tier does not match the accepted document");
    }
    if (document.source.nonMetric === false) {
      return failure("accepted document declares metric geometry outside the exact path");
    }
    const compiled = compileSceneDocument(document);
    if (!compiled.ok || !compiled.renderScene) {
      return failure(`accepted representation does not compile: ${formatIssues(compiled.report.issues)}`);
    }
    report = compiled.report;
    renderScene = compiled.renderScene;
  } else {
    const structural = validateSceneDocument(metadata.sceneDocument);
    if (!structural.document) {
      return failure(`exact scene is structurally invalid: ${formatIssues(structural.report.issues)}`);
    }
    document = structural.document;
    if (!sourceQuestionMatches(document, question)) {
      return failure("scene source question does not match the submitted question");
    }
    // Both checks below reconcile the scene against the plan. A stem-grounded
    // exact scene has no plan to reconcile with — it was computed from the
    // question's own equation — so they are skipped rather than faked. Trust
    // is not weakened: the document is still structurally validated, its source
    // question still has to match, and compileSceneDocument below still fails
    // the save on any fatal assertion, which is where the metric proof lives.
    if (turnPlan) {
      const agreementIssues = validateSceneQuantityAgreement(
        document.quantities,
        turnPlan,
        displayedSceneText(document),
      );
      if (agreementIssues.length > 0) {
        return failure(`scene quantities disagree with TurnPlanV3: ${formatIssues(agreementIssues)}`);
      }
      const proofIssues = validateTurnPlanSceneProofs(document, turnPlan);
      if (proofIssues.some((issue) => issue.severity === "fatal")) {
        return failure(`scene proof obligations failed: ${formatIssues(proofIssues)}`);
      }
    }
    const compiled = compileSceneDocument(document);
    if (!compiled.ok || !compiled.renderScene) {
      return failure(`exact scene does not compile: ${formatIssues(compiled.report.issues)}`);
    }
    report = compiled.report;
    renderScene = compiled.renderScene;
  }

  if (!report.valid || report.issues.some((issue) => issue.severity === "fatal")) {
    return failure("current scene engine did not produce a valid report");
  }
  const expectedPresentation = buildVerifiedDiagramPresentation(document, renderScene);
  // Scene-engine owns diagram ink at persist time. Client intro may be missing
  // or diverge under concurrent lecture-lab compiles; replay uses the server
  // reconstruction, never the browser's trusted-geometry payload.
  const persistSegments = mergeServerDiagramIntro(
    metadata.segments,
    expectedPresentation.introSegments,
  );
  const teachingCommands = canonicalizeTeachingCommands(
    persistSegments,
    expectedPresentation.diagram,
  );
  if (!teachingCommands.ok) return teachingCommands;

  const solver = await canonicalSolverArtifacts(metadata.sceneArtifacts, turnPlan, question);
  if (!solver.ok) return solver;
  const candidateId = "server-revalidated-scene";
  const canonicalArtifacts: SceneArtifactsV3 = {
    schemaVersion: SCENE_ARTIFACTS_V3_VERSION,
    turnPlan: turnPlan ?? null,
    problemIR: solver.problemIR,
    solverResult: solver.solverResult,
    solverAuthority: solver.solverAuthority,
    representationTier: tier,
    nonMetric,
    candidates: [{
      candidateId,
      strategy: "server_revalidation",
      phase: "plan",
      accepted: true,
      sceneDocument: document,
      validationReport: report,
      score: 0,
      rejectionCodes: [],
    }],
    selectedCandidateId: candidateId,
    selectionReason: "revalidated against the current server engine before persistence",
    degradation: validatedDegradation(metadata.sceneArtifacts),
    proofObligations: document.assertions.map((assertion) => ({
      id: assertion.id,
      predicate: assertion.predicate,
      inputs: assertion.entities,
      expected: assertion.expected,
      severity: assertion.severity,
      reason: assertion.reason,
    })),
    visualReview: null,
    diagramResultStatus: "ready",
  };

  return {
    ok: true,
    value: {
      sceneDocument: document,
      sceneEngineVersion: SCENE_ENGINE_VERSION,
      validationReport: report,
      visualStatus: "validated",
      sceneArtifacts: canonicalArtifacts,
      segments: teachingCommands.segments,
    },
  };
}

async function canonicalSolverArtifacts(
  artifacts: Record<string, unknown>,
  turnPlan: TurnPlanV3 | null,
  question: string,
): Promise<
  | { ok: true; problemIR: SceneArtifactsV3["problemIR"]; solverResult: SceneArtifactsV3["solverResult"]; solverAuthority: SceneArtifactsV3["solverAuthority"] }
  | { ok: false; error: string }
> {
  const hasProblem = artifacts.problemIR != null;
  const hasResult = artifacts.solverResult != null;
  if (!hasProblem && !hasResult) {
    return { ok: true, problemIR: null, solverResult: null, solverAuthority: null };
  }
  if (!hasProblem || !hasResult || !turnPlan) {
    return failure("solver authority requires ProblemIR, SolverResult, and a valid TurnPlanV3");
  }
  const problemValidation = validateProblemIR(artifacts.problemIR, question);
  if (!problemValidation.problem) {
    return failure(`persisted ProblemIR is invalid: ${formatIssues(problemValidation.issues)}`);
  }
  const submittedResult = validateSolverResult(artifacts.solverResult, problemValidation.problem);
  if (!submittedResult.result || submittedResult.result.status !== "solved") {
    return failure(`persisted SolverResult is invalid: ${formatIssues(submittedResult.issues)}`);
  }
  const controller = new AbortController();
  const recomputed = await new LocalDeterministicSolverProvider().solve(problemValidation.problem, {
    signal: controller.signal,
    deadlineMs: Date.now() + 5_000,
  });
  const recomputedValidation = validateSolverResult(recomputed, problemValidation.problem);
  if (!recomputedValidation.result || recomputedValidation.result.status !== "solved") {
    return failure("the current deterministic solver could not reproduce the submitted result");
  }
  if (!sameSolverValues(submittedResult.result.values, recomputedValidation.result.values)) {
    return failure("submitted solver values differ from server recomputation");
  }
  const audit = verifyTurnPlanAgainstSolver(
    problemValidation.problem,
    recomputedValidation.result,
    turnPlan,
    question,
  );
  if (audit.status === "contradiction") {
    return failure(`solver authority contradicts TurnPlanV3: ${formatIssues(audit.issues)}`);
  }
  return {
    ok: true,
    problemIR: problemValidation.problem,
    solverResult: recomputedValidation.result,
    solverAuthority: audit,
  };
}

function isEpochClearSegment(segment: SubmittedTurnSegment): boolean {
  const commands = parseStoredSegmentCommands(segment.command);
  return (
    commands.length === 1 &&
    commands[0]?.type === "CLEAR" &&
    segment.narration.trim() === "" &&
    segment.spokenText.trim() === ""
  );
}

/** Keep teaching WRITE/FOCUS and the runtime CLEAR; replace client diagram ink. */
function mergeServerDiagramIntro(
  submitted: SubmittedTurnSegment[],
  introSegments: TutorSegment[],
): SubmittedTurnSegment[] {
  const teaching = submitted.filter((segment) => !isStoredCommandTrustedGeometry(segment.command));
  const leadingClears: SubmittedTurnSegment[] = [];
  const rest: SubmittedTurnSegment[] = [];
  let seenInk = false;
  for (const segment of teaching) {
    if (!seenInk && isEpochClearSegment(segment)) {
      leadingClears.push(segment);
      continue;
    }
    seenInk = true;
    rest.push(segment);
  }
  const intro: SubmittedTurnSegment[] = introSegments.map((segment) => ({
    orderIndex: 0,
    narration: segment.narration,
    spokenText: segment.narration,
    command: serializeSegmentCommands(getSegmentCommands(segment), {
      trustedDiagramGeometry: true,
    }),
  }));
  return [...leadingClears, ...intro, ...rest].map((segment, orderIndex) => ({
    ...segment,
    orderIndex,
  }));
}

function minimalFailureArtifacts(
  turnPlan: TurnPlanV3 | null,
  status: "retry_required" | "text_only",
  degradation?: SceneArtifactsV3["degradation"],
): SceneArtifactsV3 {
  return {
    schemaVersion: SCENE_ARTIFACTS_V3_VERSION,
    turnPlan,
    problemIR: null,
    solverResult: null,
    solverAuthority: null,
    candidates: [],
    selectedCandidateId: null,
    selectionReason: "partial and unverified scene data was removed before persistence",
    degradation,
    proofObligations: [],
    visualReview: null,
    diagramResultStatus: status,
  };
}

function validatedDegradation(artifacts: unknown): SceneArtifactsV3["degradation"] | undefined {
  if (!isRecord(artifacts) || !isRecord(artifacts.degradation)) return undefined;
  const value = artifacts.degradation;
  const reasons = new Set([
    "planner_unavailable",
    "candidate_invalid",
    "missing_capability",
    "solver_contradiction",
    "required_visual_unavailable",
  ]);
  if (
    value.attemptedTier !== "exact_verified" ||
    typeof value.reason !== "string" ||
    !reasons.has(value.reason) ||
    !Number.isInteger(value.candidateCount) ||
    (value.candidateCount as number) < 0 ||
    (value.candidateCount as number) > 16 ||
    !Array.isArray(value.issueCodes)
  ) return undefined;
  const issueCodes = Array.from(new Set(value.issueCodes.filter((code): code is string =>
    typeof code === "string" && /^[a-z0-9_-]{1,64}$/i.test(code),
  ))).slice(0, 32);
  return {
    attemptedTier: "exact_verified",
    reason: value.reason as NonNullable<SceneArtifactsV3["degradation"]>["reason"],
    issueCodes,
    candidateCount: value.candidateCount as number,
  };
}

function validatedOptionalTurnPlan(artifacts: unknown, question: string): TurnPlanV3 | null {
  if (!isRecord(artifacts)) return null;
  return validateTurnPlanV3(artifacts.turnPlan, question).plan;
}

function canonicalizeTeachingCommands(
  segments: SubmittedTurnSegment[],
  diagram: Parameters<typeof isBlockedVerifiedDiagramCommand>[1],
): { ok: true; segments: SubmittedTurnSegment[] } | { ok: false; error: string } {
  const canonical: SubmittedTurnSegment[] = [];

  for (const [segmentIndex, segment] of segments.entries()) {
    if (segment.command == null || isStoredCommandTrustedGeometry(segment.command)) {
      canonical.push({ ...segment });
      continue;
    }

    const commands = parseStoredSegmentCommands(segment.command);
    if (commands.length === 0 || commands.length > 16) {
      return failure(`segment ${segment.orderIndex} has an invalid teaching command envelope`);
    }

    const normalized: DrawCommand[] = [];
    for (const command of commands) {
      const runtimeClear =
        command?.type === "CLEAR" &&
        commands.length === 1 &&
        segmentIndex === 0 &&
        segment.orderIndex === 0 &&
        segment.narration.trim() === "" &&
        segment.spokenText.trim() === "" &&
        Array.isArray(command.params) &&
        command.params.length === 0;
      if (runtimeClear) {
        normalized.push({
          type: "CLEAR",
          params: [],
          charPosition: 0,
          narrationBefore: "",
        });
        continue;
      }

      const checked = canonicalTeachingCommand(command);
      const safeCommands = checked?.type === "WRITE" ? fitWorkTextCommand(checked) : checked ? [checked] : [];
      // A FOCUS that names an id absent from the committed diagram is a
      // teaching mismatch, not untrusted ink: filter the gesture and keep the
      // rest of the segment, mirroring the live prepareVerifiedLessonSegments
      // filter, so one stale id cannot drop the whole recording. Genuine
      // diagram ink (DRAW_*, LABEL, ERASE, …) and unknown ANNOTATE targets
      // still hard-fail below.
      const allowed = safeCommands.filter((candidate) =>
        candidate.type !== "FOCUS" || !isBlockedVerifiedDiagramCommand(candidate, diagram));
      if (
        safeCommands.length === 0 ||
        normalized.length + allowed.length > 16 ||
        allowed.some((candidate) => isBlockedVerifiedDiagramCommand(candidate, diagram))
      ) {
        const type = isRecord(command) && typeof command.type === "string"
          ? command.type
          : "unknown";
        return failure(`teaching command ${type} is not allowed for persistence`);
      }
      normalized.push(...allowed);
    }

    canonical.push({
      ...segment,
      command: serializeSegmentCommands(normalized),
    });
  }

  return { ok: true, segments: canonical };
}

function canonicalTeachingCommand(command: unknown): DrawCommand | null {
  if (!isRecord(command) || !Array.isArray(command.params)) return null;
  if (!command.params.every((value) => typeof value === "number" && Number.isFinite(value))) {
    return null;
  }
  const charPosition = command.charPosition;
  const narrationBefore = command.narrationBefore;
  if (
    !Number.isInteger(charPosition) ||
    (charPosition as number) < 0 ||
    (charPosition as number) > 10_000_000 ||
    typeof narrationBefore !== "string" ||
    narrationBefore.length > 8_000
  ) return null;

  if (
    command.type === "WRITE" &&
    command.params.length >= 2 &&
    command.params.length <= 3 &&
    typeof command.text === "string" &&
    command.text.length > 0 &&
    command.text.length <= 2_000
  ) {
    return {
      type: "WRITE",
      params: [...command.params] as number[],
      text: command.text,
      charPosition: charPosition as number,
      narrationBefore,
    };
  }

  if (
    command.type === "PAUSE" &&
    command.params.length === 1 &&
    command.params[0]! >= 0 &&
    command.params[0]! <= 60_000
  ) {
    return {
      type: "PAUSE",
      params: [...command.params] as number[],
      charPosition: charPosition as number,
      narrationBefore,
    };
  }

  if (
    command.type === "FOCUS" &&
    command.params.length === 0 &&
    typeof command.text === "string" &&
    command.text.trim().length > 0 &&
    command.text.length <= 160
  ) {
    return {
      type: "FOCUS",
      params: [],
      text: command.text.trim(),
      charPosition: charPosition as number,
      narrationBefore,
    };
  }

  if (
    (command.type === "EMPHASIZE" || command.type === "ANNOTATE") &&
    command.params.length === 0 &&
    typeof command.text === "string" &&
    command.text.trim().length > 0 &&
    command.text.length <= 128
  ) {
    return {
      type: command.type,
      params: [],
      text: command.text.trim(),
      charPosition: charPosition as number,
      narrationBefore,
    };
  }

  return null;
}

function sourceQuestionMatches(document: SceneDocument, question: string): boolean {
  return typeof document.source.question === "string" &&
    normalizeQuestion(document.source.question) === normalizeQuestion(question);
}

function displayedSceneText(document: SceneDocument): string[] {
  return [
    ...document.entities.map((entity) => entity.label),
    ...document.annotations.map((annotation) => annotation.text),
  ].filter((value): value is string => typeof value === "string");
}

function validSegmentOrder(segments: SubmittedTurnSegment[]): boolean {
  const seen = new Set<number>();
  return segments.every((segment) => {
    if (!Number.isInteger(segment.orderIndex) || segment.orderIndex < 0 || seen.has(segment.orderIndex)) {
      return false;
    }
    seen.add(segment.orderIndex);
    return true;
  });
}

function sameSolverValues(
  submitted: Array<{ requestId: string; exact?: unknown; approximate: number | number[]; errorBound: number }>,
  recomputed: Array<{ requestId: string; exact?: unknown; approximate: number | number[]; errorBound: number }>,
): boolean {
  const expected = new Map(recomputed.map((value) => [value.requestId, value]));
  return submitted.length === recomputed.length && submitted.every((value) => {
    const actual = expected.get(value.requestId);
    return Boolean(actual) && deepEqual(value.exact, actual!.exact) &&
      numericValueEqual(value.approximate, actual!.approximate, Math.max(value.errorBound, actual!.errorBound));
  });
}

function numericValueEqual(first: number | number[], second: number | number[], tolerance: number): boolean {
  if (typeof first === "number" && typeof second === "number") {
    return Math.abs(first - second) <= Math.max(1e-10, tolerance);
  }
  if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length) return false;
  return first.every((value, index) => Math.abs(value - second[index]!) <= Math.max(1e-10, tolerance));
}

function isRepresentationTier(value: unknown): value is NonNullable<SceneArtifactsV3["representationTier"]> {
  return value === "exact_verified" || value === "qualitative_verified" || value === "question_representation";
}

function normalizeQuestion(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function deepEqual(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) return true;
  if (Array.isArray(first) || Array.isArray(second)) {
    return Array.isArray(first) && Array.isArray(second) && first.length === second.length &&
      first.every((value, index) => deepEqual(value, second[index]));
  }
  if (!isRecord(first) || !isRecord(second)) return false;
  const firstKeys = Object.keys(first).filter((key) => first[key] !== undefined).sort();
  const secondKeys = Object.keys(second).filter((key) => second[key] !== undefined).sort();
  return firstKeys.length === secondKeys.length && firstKeys.every((key, index) =>
    key === secondKeys[index] && deepEqual(first[key], second[key]),
  );
}

function formatIssues(issues: Array<{ code?: string; path?: string; message: string }>): string {
  return issues.slice(0, 4).map((issue) =>
    `${issue.code ?? issue.path ?? "invalid"}: ${issue.message}`,
  ).join("; ");
}

function failure(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
