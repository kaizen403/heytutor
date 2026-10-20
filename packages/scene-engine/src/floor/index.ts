/**
 * Floor figure: the last honest picture for a lesson that needs one.
 *
 * It runs only after every planner candidate and every computed figure
 * failed, behind DIAGRAM_FLOOR_FIGURE=on. Each figure kind draws the stated
 * setup from {@link readFloorFacts} with existing operators, then faces the
 * same engine compile, picture demand and visual obligations as every other
 * figure, and the floor's own audit. A kind that cannot draw honestly returns
 * null and the next kind is tried; when none can, the lesson is taught as
 * today, with no figure.
 */
import { compileSceneDocument } from "../compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../document/validation";
import { demandRejection, sceneDemand } from "../synthesize/sceneDemand";
import { deriveVisualObligations, isFullProblemIRStructure, visualObligationRejection, type VisualObligationSet } from "../synthesize/visualObligations";
import type { RenderScene, SceneDocument, ValidationReport } from "../types";
import { auditFloorFigure } from "./audit";
import { readFloorFacts, type FloorFacts } from "./facts";
import { FLOOR_KIND_BUILDERS, floorKindOrder, type FloorKind } from "./kinds";

export { readFloorFacts, FLOOR_FIGURE_VERSION, type FloorFacts, type FloorStatedValue, type FloorUnknown, type FloorObject } from "./facts";
export { auditFloorFigure, floorAllowedTexts, type FloorAuditIssue } from "./audit";
export type { FloorKind } from "./kinds";

/** DIAGRAM_FLOOR_FIGURE: only the exact value "on" enables the floor tier; anything else is off. */
export function parseDiagramFloorFigure(raw: unknown): boolean {
  return raw === true || (typeof raw === "string" && raw.trim().toLowerCase() === "on");
}

export interface FloorFigureInput {
  question: string;
  turnPlan: unknown;
  problemIR?: unknown;
  /** Scene families the live gate already inferred; ordering hints only. */
  families?: readonly string[];
}

export interface FloorFigureAttempt {
  kind: FloorKind;
  outcome: "drawn" | "declined" | "invalid";
  reason: string;
}

export interface FloorFigure {
  document: SceneDocument;
  renderScene: RenderScene;
  validationReport: ValidationReport;
  kind: FloorKind;
  reason: string;
}

export interface FloorFigureResult {
  figure: FloorFigure | null;
  attempts: FloorFigureAttempt[];
}

function compileFloor(document: SceneDocument): { document: SceneDocument; renderScene: RenderScene; report: ValidationReport } | string {
  const validated = validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string, unknown>));
  if (!validated.document) return `document invalid: ${validated.report.issues.map((issue) => issue.code).join(", ")}`;
  const compiled = compileSceneDocument(validated.document);
  if (!compiled.ok || !compiled.renderScene || !compiled.report.valid ||
      compiled.report.issues.some((issue) => issue.severity === "fatal" || issue.code === "assertion_failed")) {
    return `compile failed: ${compiled.report.issues.map((issue) => issue.code).join(", ")}`;
  }
  return { document: validated.document, renderScene: compiled.renderScene, report: compiled.report };
}

/**
 * Every named body, connection and spatial relation obligation applies to the
 * floor unchanged. A "given dimension" whose number the question never writes
 * is a solved result the ProblemIR grounded in given facts (a final velocity of
 * 0); the floor never shows solved values, so that one obligation is dropped.
 */
function floorObligations(set: VisualObligationSet, question: string, problem: FloorFacts["problem"]): VisualObligationSet {
  // Incidence is proved through a point; between a curve and a line (no point)
  // no executable predicate can carry it, so like tangency it is a declared
  // limit, not a requirement. The floor kind proves the meeting point instead.
  const kinds = new Map((problem?.entities ?? []).map((entity) => [entity.id, entity.kind]));
  const pointless = (ids: readonly string[]) => ids.every((id) => kinds.get(id) !== "point");
  const written = (question.replace(/[−–]/g, "-").match(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []).map(Number);
  const stated = (value: number) => written.some((number) => Math.abs(number - value) <= 1e-9 * Math.max(1, Math.abs(value)));
  return { ...set, obligations: set.obligations.filter((obligation) =>
    (obligation.kind !== "given_dimension" || stated(obligation.value)) &&
    !(obligation.kind === "spatial_relation" && obligation.relation === "incident" && pointless(obligation.problemEntityIds))) };
}

export function buildFloorFigure(input: FloorFigureInput): FloorFigureResult {
  const attempts: FloorFigureAttempt[] = [];
  const facts: FloorFacts | null = readFloorFacts(input);
  if (!facts) return { figure: null, attempts };
  const demand = sceneDemand(facts.question, facts.problem);
  const obligations = isFullProblemIRStructure(facts.problem) ? floorObligations(deriveVisualObligations(facts.problem), facts.question, facts.problem) : null;
  for (const kind of floorKindOrder(facts, input.families ?? [])) {
    let built: ReturnType<(typeof FLOOR_KIND_BUILDERS)[FloorKind]>;
    try {
      built = FLOOR_KIND_BUILDERS[kind](facts);
    } catch (error) {
      attempts.push({ kind, outcome: "invalid", reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (!built) {
      attempts.push({ kind, outcome: "declined", reason: "no stated setup for this kind" });
      continue;
    }
    if ("declined" in built) {
      attempts.push({ kind, outcome: "declined", reason: built.declined });
      continue;
    }
    const compiled = compileFloor(built.document);
    if (typeof compiled === "string") {
      attempts.push({ kind, outcome: "invalid", reason: compiled });
      continue;
    }
    const demanded = demandRejection(compiled.document, demand);
    if (demanded) {
      attempts.push({ kind, outcome: "invalid", reason: `picture demand: ${demanded}` });
      continue;
    }
    if (obligations && visualObligationRejection(obligations, compiled.document)) {
      attempts.push({ kind, outcome: "invalid", reason: "visual obligations unmet" });
      continue;
    }
    const audit = auditFloorFigure(compiled.document, compiled.renderScene, facts, built);
    if (audit.length > 0) {
      attempts.push({ kind, outcome: "invalid", reason: audit.map((issue) => `${issue.code}: ${issue.message}`).join("; ") });
      continue;
    }
    attempts.push({ kind, outcome: "drawn", reason: built.reason });
    return {
      figure: {
        document: compiled.document,
        renderScene: compiled.renderScene,
        validationReport: compiled.report,
        kind,
        reason: built.reason,
      },
      attempts,
    };
  }
  return { figure: null, attempts };
}
