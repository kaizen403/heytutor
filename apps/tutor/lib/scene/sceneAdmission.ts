/**
 * Admit one stored scene at the server boundary: structure, source question,
 * tier, proofs, compile, save admission and the intro presentation rebuilt
 * from the server's own compile.
 *
 * This is the validated branch of canonicalizeTurnSceneMetadata, moved here
 * unchanged so every figure a lesson saves (the turn's own and each lesson
 * figure, DIAGRAM_LESSON_FIGURES) is admitted by the same code. The caller
 * owns everything about the turn: its artifacts envelope, the doubt and
 * lesson figure questions, rows and solver artifacts.
 *
 * A lesson saves many checkpoints with the same scenes, so results are
 * memoized by every input (a small LRU); a hit hands back a copy.
 */
import { createHash } from "node:crypto";
import {
  archetypeProvenance,
  certifyVseprSourceDocument,
  chemistryTeachingFamilyId,
  compileSceneDocument,
  validateSceneDocument,
  validateTurnPlanSceneProofs,
  type SceneDocument,
  type TurnPlanV3,
  type ValidationReport,
} from "@heytutor/scene-engine";
import type { VerifiedDiagram, VerifiedDiagramPresentation } from "@heytutor/drawing";
import type { NarrationLanguage } from "@heytutor/tutor-core";
import { buildVerifiedDiagramPresentation } from "@/features/tutor-session/lib/scene/verifiedScenePresentation";
import { sceneSaveAdmissionFailure } from "@/lib/scene/sceneSaveAdmission";
import { DSA_DIAGRAM_ZONE } from "@/features/tutor-session/constants";
import {
  LESSON_FIGURES_VERSION,
  figureCollidesWithAdvanceIds,
  lessonFigureSceneInput,
  type LessonFigureId,
  type LessonFiguresArtifact,
  type StoredLessonFigure,
} from "@/lib/boards/lessonFigures";

export type AdmittedRepresentationTier = "exact_verified" | "qualitative_verified" | "question_representation";

type RenderScene = NonNullable<ReturnType<typeof compileSceneDocument>["renderScene"]>;

export interface AdmittedCompiledScene {
  report: ValidationReport;
  renderScene: RenderScene;
}

export type StoredSceneAdmissionCode =
  | "scene_representation_tier_invalid" | "scene_document_invalid" | "scene_turn_plan_invalid"
  | "scene_representation_not_scene" | "scene_source_question_mismatch" | "scene_document_tier_mismatch"
  | "scene_metric_geometry_outside_exact" | "scene_compile_failed" | "scene_proof_failed"
  | "scene_admission_failed" | "scene_validation_report_invalid";

export type StoredSceneAdmission =
  | {
      ok: true;
      document: SceneDocument;
      compiled: AdmittedCompiledScene;
      presentation: VerifiedDiagramPresentation;
      tier: AdmittedRepresentationTier;
    }
  | { ok: false; code: StoredSceneAdmissionCode; message: string };

export interface StoredSceneAdmissionInput {
  sceneDocument: unknown;
  /** The question the scene was planned and verified on (composed for doubt and lesson figures). */
  sceneQuestion: string;
  /** The plan validated against `sceneQuestion`, or null. */
  turnPlan: TurnPlanV3 | null;
  submittedTier: unknown;
  narrationLanguage?: NarrationLanguage;
  /**
   * Was a plan submitted at all (absent: `turnPlan !== null`). A submitted
   * plan that failed validation must not gain the no-plan allowances.
   */
  planSubmitted?: boolean;
  /** Why the submitted plan failed validation, for the refusal message. */
  planIssues?: ReadonlyArray<{ code?: string; path?: string; message: string }>;
}

const MEMO_LIMIT = 64;
const memo = new Map<string, StoredSceneAdmission>();

export function admitStoredScene(input: StoredSceneAdmissionInput): StoredSceneAdmission {
  const key = createHash("sha256").update(JSON.stringify([
    input.sceneDocument ?? null,
    input.sceneQuestion,
    input.turnPlan,
    input.submittedTier ?? null,
    input.narrationLanguage ?? null,
    input.planSubmitted ?? null,
    input.planIssues ?? null,
  ])).digest("hex");
  const hit = memo.get(key);
  if (hit) {
    memo.delete(key);
    memo.set(key, hit);
    return structuredClone(hit);
  }
  const result = admitUncached(input);
  memo.set(key, structuredClone(result));
  while (memo.size > MEMO_LIMIT) memo.delete(memo.keys().next().value as string);
  return result;
}

function admitUncached(input: StoredSceneAdmissionInput): StoredSceneAdmission {
  const { sceneQuestion, turnPlan } = input;
  const tier = input.submittedTier;
  if (!isRepresentationTier(tier)) return refuse("scene_representation_tier_invalid", "validated scene has an invalid representation tier");
  const sceneDocument = withoutLegacyTeachingNotes(input.sceneDocument);
  const planIssues = input.planIssues ?? [];
  const planSubmitted = input.planSubmitted ?? turnPlan !== null;
  const nonMetric = tier !== "exact_verified";

  if (tier === "exact_verified" && !turnPlan) {
    // A plan is one source of exact numbers, not the only one. When every
    // metric slot was read from the question itself — "Sketch y = x^2", a
    // circle given by its own equation — the stem IS the source of truth, and
    // demanding a plan would mean re-deriving what the question already states.
    // Anything less than fully stem-grounded ("mixed", a display default, or a
    // document with no archetype provenance at all) still needs the plan.
    const submitted = validateSceneDocument(sceneDocument);
    if (!submitted.document) {
      // A document that does not even parse is structurally invalid; saying it
      // has a bad plan would hide the real reason from the caller.
      return refuse("scene_document_invalid", `exact scene is structurally invalid: ${formatIssues(submitted.report.issues)}`);
    }
    if (archetypeProvenance(submitted.document).exactGrounding !== "stem") {
      return refuse("scene_turn_plan_invalid", `exact scene has an invalid TurnPlanV3: ${formatIssues(planIssues)}`);
    }
  }

  let document: SceneDocument;
  let report: ValidationReport;
  let renderScene: RenderScene;
  if (nonMetric) {
    // Recompile the accepted document that was actually taught. Re-running
    // selectVerifiedRepresentation here would re-infer families from the
    // question without the live-only context (inferred families, ProblemIR),
    // so the rebuilt document could differ from the one the student saw:
    // replay would diverge and teaching FOCUS on the taught ids would 400 the
    // save. Trust is re-established by validating and compiling the submitted
    // document; intro ink below is regenerated from this server compile,
    // never from the browser's trusted-geometry payload.
    const structural = validateSceneDocument(sceneDocument);
    if (!structural.document) {
      return refuse("scene_document_invalid", `accepted representation is structurally invalid: ${formatIssues(structural.report.issues)}`);
    }
    document = canonicalTeachingFamily(structural.document);
    if (document.visualDecision.mode !== "scene") {
      return refuse("scene_representation_not_scene", "accepted representation persisted as text-only");
    }
    if (!sourceQuestionMatches(document, sceneQuestion)) {
      return refuse("scene_source_question_mismatch", "scene source question does not match the submitted question");
    }
    const declaredTier = document.source.representationTier;
    if (declaredTier !== undefined && declaredTier !== tier) {
      return refuse("scene_document_tier_mismatch", "submitted fallback tier does not match the accepted document");
    }
    if (document.source.nonMetric === false) {
      return refuse("scene_metric_geometry_outside_exact", "accepted document declares metric geometry outside the exact path");
    }
    // DSA structure diagrams were compiled into the code-lesson split live;
    // recompiling into the default viewport would move every primitive under
    // the code panel and diverge replay from the taught scene.
    const compiled = compileSceneDocument(
      document,
      isDsaSceneDocument(document) ? { viewport: DSA_DIAGRAM_ZONE } : {},
    );
    if (!compiled.ok || !compiled.renderScene) {
      return refuse("scene_compile_failed", `accepted representation does not compile: ${formatIssues(compiled.report.issues)}`);
    }
    report = compiled.report;
    renderScene = compiled.renderScene;
  } else {
    const structural = validateSceneDocument(sceneDocument);
    if (!structural.document) {
      return refuse("scene_document_invalid", `exact scene is structurally invalid: ${formatIssues(structural.report.issues)}`);
    }
    document = canonicalTeachingFamily(structural.document);
    if (!sourceQuestionMatches(document, sceneQuestion)) {
      return refuse("scene_source_question_mismatch", "scene source question does not match the submitted question");
    }
    // Both checks below reconcile the scene against the plan. A stem-grounded
    // exact scene has no plan to reconcile with — it was computed from the
    // question's own equation — so they are skipped rather than faked. Trust
    // is not weakened: the document is still structurally validated, its source
    // question still has to match, and compileSceneDocument below still fails
    // the save on any fatal assertion, which is where the metric proof lives.
    if (turnPlan) {
      const proofIssues = validateTurnPlanSceneProofs(document, turnPlan);
      if (proofIssues.some((issue) => issue.severity === "fatal")) {
        return refuse("scene_proof_failed", `scene proof obligations failed: ${formatIssues(proofIssues)}`);
      }
    }
    const compiled = compileSceneDocument(document);
    if (!compiled.ok || !compiled.renderScene) {
      return refuse("scene_compile_failed", `exact scene does not compile: ${formatIssues(compiled.report.issues)}`);
    }
    report = compiled.report;
    renderScene = compiled.renderScene;
  }

  // The same function runs live before a figure is drawn (useQuestionHandler),
  // so a scene this would refuse is never shown and then lost.
  // A missing optional plan is safe for an exact native source graph; an
  // explicitly invalid plan must not silently gain that legacy allowance.
  if (!turnPlan && planSubmitted
    && certifyVseprSourceDocument(document, sceneQuestion, null).status !== "not_applicable") {
    return refuse("scene_turn_plan_invalid", `native VSEPR scene has an invalid TurnPlanV3: ${formatIssues(planIssues)}`);
  }
  const admissionFailure = sceneSaveAdmissionFailure({ document, question: sceneQuestion, turnPlan, tier });
  if (admissionFailure) return refuse("scene_admission_failed", admissionFailure);

  if (!report.valid || report.issues.some((issue) => issue.severity === "fatal")) {
    return refuse("scene_validation_report_invalid", "current scene engine did not produce a valid report");
  }
  const presentation = buildVerifiedDiagramPresentation(
    document,
    renderScene,
    {
      originalQuestion: sceneQuestion,
      ...(turnPlan ? { turnPlan } : {}),
      ...(isDsaSceneDocument(document) ? { layout: "code_lesson" as const } : {}),
      ...(input.narrationLanguage ? { narrationLanguage: input.narrationLanguage } : {}),
      // The live intro letters a source given ("x = -2") with the plan, and
      // restore reads the same saved plan, so without it the saved intro
      // dropped that label and replay never drew it. Only a plan validated
      // against this question is passed; no plan keeps every value deferred.
      ...(turnPlan ? { turnPlan } : {}),
    },
  );
  return { ok: true, document, compiled: { report, renderScene }, presentation, tier };
}

/** A lesson turn's later figures, each admitted on its own composed question. */
export interface AdmittedLessonFigures {
  /** The canonical artifact to persist: admitted figures only, server documents. */
  artifact: LessonFiguresArtifact & { droppedFigureIds?: LessonFigureId[] };
  /** Each admitted figure's diagram, for the teaching cursor. */
  diagrams: ReadonlyMap<LessonFigureId, VerifiedDiagram>;
  droppedFigureIds: LessonFigureId[];
}

/**
 * Admit each later figure as the turn's own figure is admitted: on the lesson
 * question composed with its view, with the lesson's plan restamped to that
 * question and validated on it (`lessonFigureSceneInput`, shared with the live
 * plan and every restore). A figure that fails is dropped (fail soft, as
 * a stale FOCUS is); the rest of the save is unchanged. A figure with a part
 * named like an advance cue (`figure_1` to `figure_3`) is dropped too, and
 * every figure when the turn's own figure `first` has one (`id_collision`, as
 * `planLessonFigures` refuses it): `[FOCUS:figure_2]` would name both.
 */
export function admitLessonFigures(
  stored: LessonFiguresArtifact,
  input: {
    lessonQuestion: string;
    /** The lesson's plan as stored (`sceneArtifacts.turnPlan`), unvalidated: `lessonFigureSceneInput` restamps it. */
    lessonPlan: unknown;
    narrationLanguage?: NarrationLanguage;
    first?: VerifiedDiagram;
  },
): AdmittedLessonFigures {
  const admitted: StoredLessonFigure[] = [];
  const diagrams = new Map<LessonFigureId, VerifiedDiagram>();
  const droppedFigureIds: LessonFigureId[] = [];
  const firstCollides = input.first !== undefined && figureCollidesWithAdvanceIds(input.first);
  for (const figure of stored.figures) {
    if (firstCollides) {
      droppedFigureIds.push(figure.id);
      continue;
    }
    const scene = lessonFigureSceneInput(input.lessonQuestion, input.lessonPlan, figure.view);
    const result = admitStoredScene({
      sceneDocument: figure.sceneDocument,
      sceneQuestion: scene.question,
      turnPlan: scene.turnPlan,
      submittedTier: figure.tier,
      ...(input.narrationLanguage ? { narrationLanguage: input.narrationLanguage } : {}),
      planSubmitted: scene.planSubmitted,
      planIssues: scene.planIssues,
    });
    if (!result.ok || figureCollidesWithAdvanceIds(result.presentation.diagram)) {
      droppedFigureIds.push(figure.id);
      continue;
    }
    admitted.push({ ...figure, sceneDocument: result.document, tier: result.tier });
    diagrams.set(figure.id, result.presentation.diagram);
  }
  return {
    artifact: {
      schemaVersion: LESSON_FIGURES_VERSION,
      figures: admitted,
      ...(droppedFigureIds.length > 0 ? { droppedFigureIds } : {}),
    },
    diagrams,
    droppedFigureIds,
  };
}

export function isDsaSceneDocument(document: SceneDocument): boolean {
  return (document.source as Record<string, unknown>).synthesizedDsa === true;
}

export function isRepresentationTier(value: unknown): value is AdmittedRepresentationTier {
  return value === "exact_verified" || value === "qualitative_verified" || value === "question_representation";
}

/** Historical documents may carry planner-written prose; it is never authority. */
export function withoutLegacyTeachingNotes(input: unknown): unknown {
  if (!isRecord(input) || !isRecord(input.source) || !Object.hasOwn(input.source, "teachingNotes")) return input;
  const source = { ...input.source };
  delete source.teachingNotes;
  return { ...input, source };
}

function canonicalTeachingFamily(document: SceneDocument): SceneDocument {
  const familyId = chemistryTeachingFamilyId(document);
  const source = { ...document.source };
  delete source.chemistryTeachingFamilyId;
  if (familyId) source.chemistryTeachingFamilyId = familyId;
  return { ...document, source };
}

function sourceQuestionMatches(document: SceneDocument, question: string): boolean {
  return typeof document.source.question === "string" &&
    normalizeQuestion(document.source.question) === normalizeQuestion(question);
}

function normalizeQuestion(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function formatIssues(issues: ReadonlyArray<{ code?: string; path?: string; message: string }>): string {
  return issues.slice(0, 4).map((issue) =>
    `${issue.code ?? issue.path ?? "invalid"}: ${issue.message}`,
  ).join("; ");
}

function refuse(code: StoredSceneAdmissionCode, message: string): { ok: false; code: StoredSceneAdmissionCode; message: string } {
  return { ok: false, code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
