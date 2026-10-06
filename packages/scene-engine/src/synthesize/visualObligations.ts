import { finiteProgressionDocumentIssues, isSourceBoundFiniteProgressionDocument } from "../contracts/finiteProgressionContract";
import { finiteBinomialDocumentIssues } from "../contracts/finiteBinomialContract";
import { admitFiniteBinomialProblem, validateFiniteBinomialSourceDocument } from "../ir/finiteBinomialProgram";
/**
 * Required visual obligations (DCP-02) — the "is this figure complete?" seam.
 *
 * Compiling proves a scene's geometry is valid; `sceneDemand` proves it is not
 * a contradicted family. Neither proves the picture actually shows what the
 * source requires: a circuit missing one named resistor still compiles, and a
 * stale scalar can still pair with correct geometry. These obligations close
 * that gap from source evidence and structural ProblemIR alone:
 *
 * - named bodies: every entity a representation intent draws must appear,
 * - connections: every `connected` constraint must hold in the scene topology,
 * - given dimensions: every constant given-grounded expression value must be
 *   carried by the scene (stale planner scalars reject),
 * - spatial relations: every structural constraint with an executable proof
 *   predicate must carry a fatal assertion over the mapped entities.
 *
 * Derivation reads only ProblemIR structure (entity ids/labels, constraint
 * kinds, intent membership, expression trees, fact kinds). There is no chapter
 * registry, no question template, no question-ID routing, and no English
 * stem classifier here: a source-named body must appear under its source
 * name (exact label equality; the id is only a search hint), an unnamed
 * body matches by stable id, and dimensions are stated literal values.
 * Relations with no
 * executable predicate (tangent, symmetric) are reported as unsupported, never
 * silently dropped and never a rejection — an honest representation preserves
 * all *supported* source requirements and declares the rest as limits.
 *
 * A missed supported obligation is fatal: the candidate is rejected and the
 * caller moves to the next family or teaches text-only. Partial scenes never
 * render.
 */

import {
  isExecutableSceneProofPredicate,
  isPlannerVisibleSceneProofPredicate,
} from "../capability/capabilityManifest";
import type { ExpressionNodeIR, ProblemIR } from "../ir/problemIR";
import { sectionFormulaDimensionIsCarried, sectionFormulaRequestedDimensionIsCarried } from "../ir/sectionFormulaSource";
import { matrixLiteralSourceEntityIsCarried, matrixLiteralSourceDimensionIsCarried } from "../ir/matrixLiteralSource";
import {pointLineRequestedDimensionIsCarried} from "../ir/pointLineProgram";
import {circleSourceProblemEntitySceneId,circleSourceDimensionIsCarried} from "../ir/circleSourceProgram";
import { bindStatedCircuitProblem, checkStatedCircuitProblemBinding } from "../ir/statedCircuitProblemBinding";
import { relativeMotionSource, relativeMotionSourceEntityBindings } from "../physics/relativeMotionSource";
import { validateRelativeMotionSourceInputs } from "./relativeMotionScene";
import { uniformCircularProblemEntitySceneId, uniformCircularSourceDimensionIsCarried } from "../physics/uniformCircularIdentity";
import type { SceneDocument, SceneIssue } from "../types";

export const VISUAL_OBLIGATIONS_VERSION = "visual-obligations/v1" as const;

export type VisualObligationKind =
  | "named_body"
  | "connection"
  | "given_dimension"
  | "spatial_relation";

interface VisualObligationBase {
  id: string;
  kind: VisualObligationKind;
  /** ProblemIR entity ids this obligation is about (empty for pure dimensions). */
  problemEntityIds: readonly string[];
  /** Source facts grounding this obligation. */
  factIds: readonly string[];
  /** Stable human-readable summary; never matched against, only reported. */
  label: string;
  /** False only when no executable capability can express the requirement. */
  supported: boolean;
  supportReason?: string;
}

export interface NamedBodyObligation extends VisualObligationBase {
  kind: "named_body";
  problemEntityId: string;
  problemKind: string;
  problemLabel: string | null;
}

export interface ConnectionObligation extends VisualObligationBase {
  kind: "connection";
  problemConstraintId: string;
}

export interface GivenDimensionObligation extends VisualObligationBase {
  kind: "given_dimension";
  problemExpressionId: string;
  value: number;
}

export interface SpatialRelationObligation extends VisualObligationBase {
  kind: "spatial_relation";
  problemConstraintId: string;
  relation: string;
  /** Compatible executable proof predicates (empty when unsupported). */
  predicates: readonly string[];
}

export type VisualObligation =
  | NamedBodyObligation
  | ConnectionObligation
  | GivenDimensionObligation
  | SpatialRelationObligation;

export interface VisualObligationSet {
  version: typeof VISUAL_OBLIGATIONS_VERSION;
  problemId: string;
  obligations: readonly VisualObligation[];
}

export interface VisualObligationMiss {
  obligationId: string;
  kind: VisualObligationKind;
  code: string;
  message: string;
  problemEntityIds: readonly string[];
}

export interface VisualObligationCheckResult {
  satisfied: boolean;
  satisfiedIds: readonly string[];
  missing: readonly VisualObligationMiss[];
  /** Supported obligations cannot be confused with declared limits. */
  unsupportedIds: readonly string[];
}

/**
 * Structural constraint kinds that demand a visible proof, and the executable
 * predicates that can carry each one. `tangent` and `symmetric` have no
 * executable predicate in the capability manifest, so they are reported as
 * unsupported rather than rejected: the picture cannot prove them, and the
 * turn must declare that limit instead of faking it.
 */
const SPATIAL_PREDICATES: Readonly<Record<string, readonly string[]>> = {
  incident: ["incident", "on"],
  parallel: ["parallel"],
  perpendicular: ["perpendicular"],
  inside: ["inside"],
  tangent: [],
  symmetric: [],
};

/** Narrow a loose structural view to a full ProblemIR before deriving. */
export function isFullProblemIRStructure(value: unknown): value is ProblemIR {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  for (const field of ["facts", "entities", "expressions", "constraints", "representationIntents"]) {
    if (!Array.isArray(record[field])) return false;
  }
  const entities = record.entities as unknown[];
  if (entities.length > 0) {
    const shaped = entities.every(
      (entity) =>
        typeof entity === "object" &&
        entity !== null &&
        typeof (entity as Record<string, unknown>).id === "string",
    );
    if (!shaped) return false;
  }
  return true;
}

export function deriveVisualObligations(problem: ProblemIR): VisualObligationSet {
  const obligations: VisualObligation[] = [];
  const entities = new Map((problem.entities ?? []).map((entity) => [entity.id, entity]));
  const facts = new Map((problem.facts ?? []).map((fact) => [fact.id, fact]));

  const obligatedEntities = new Set<string>();
  for (const intent of problem.representationIntents ?? []) {
    for (const entityId of intent.entityIds ?? []) {
      if (obligatedEntities.has(entityId)) continue;
      const entity = entities.get(entityId);
      if (!entity) continue;
      obligatedEntities.add(entityId);
      obligations.push({
        id: `body:${entityId}`,
        kind: "named_body",
        problemEntityIds: [entityId],
        factIds: [...entity.evidenceFactIds],
        label: entity.label ?? entityId,
        supported: true,
        problemEntityId: entityId,
        problemKind: entity.kind,
        problemLabel: entity.label ?? null,
      });
    }
  }

  for (const constraint of problem.constraints ?? []) {
    if (constraint.kind === "equation" || constraint.kind === "inequality") continue;
    const entityIds = [...(constraint.entityIds ?? [])];
    if (entityIds.length < 2 || entityIds.some((id) => !entities.has(id))) continue;
    if (constraint.kind === "connected") {
      obligations.push({
        id: `connection:${constraint.id}`,
        kind: "connection",
        problemEntityIds: entityIds,
        factIds: [...constraint.evidenceFactIds],
        label: entityIds.join(" + "),
        supported: true,
        problemConstraintId: constraint.id,
      });
      continue;
    }
    const predicates = (SPATIAL_PREDICATES[constraint.kind] ?? []).filter((predicate) =>
      isExecutableSceneProofPredicate(predicate),
    );
    const supported = predicates.length > 0;
    obligations.push({
      id: `relation:${constraint.id}`,
      kind: "spatial_relation",
      problemEntityIds: entityIds,
      factIds: [...constraint.evidenceFactIds],
      label: `${constraint.kind} ${entityIds.join(" ")}`,
      supported,
      supportReason: supported
        ? undefined
        : `no executable proof predicate for ${constraint.kind}`,
      problemConstraintId: constraint.id,
      relation: constraint.kind,
      predicates,
    });
  }

  for (const expression of problem.expressions ?? []) {
    if (expression.valueType !== "scalar") continue;
    // A given dimension is a stated literal, not a computation: compound trees
    // are solver business, and obligating them would force scenes to carry
    // incidental arithmetic. Bare literals grounded in given facts are the
    // source's own numbers, so the figure must carry them.
    if (expression.root.kind !== "number" && expression.root.kind !== "constant") continue;
    const groundedInGiven = (expression.evidenceFactIds ?? []).some(
      (factId) => facts.get(factId)?.kind === "given",
    );
    if (!groundedInGiven) continue;
    const value = evaluateConstantExpression(expression.root);
    if (value === null) continue;
    obligations.push({
      id: `dimension:${expression.id}`,
      kind: "given_dimension",
      problemEntityIds: [],
      factIds: [...expression.evidenceFactIds],
      label: String(value),
      supported: true,
      problemExpressionId: expression.id,
      value,
    });
  }

  return { version: VISUAL_OBLIGATIONS_VERSION, problemId: problem.id, obligations };
}

export function checkVisualObligations(
  set: VisualObligationSet,
  document: SceneDocument,
  problem?: ProblemIR,
  turnPlan?: unknown,
): VisualObligationCheckResult {
  const authority = problem ? {question: problem.question, problemIR: problem, turnPlan} : undefined;
  const progressionIssues = finiteProgressionDocumentIssues(document, authority);
  const sourceIssues = progressionIssues.length ? progressionIssues : finiteBinomialDocumentIssues(document, authority);
  if (sourceIssues.length) return {satisfied: false, satisfiedIds: [],
    missing: sourceIssues.map(issue => ({obligationId: progressionIssues.length ? "finite_progression_source" : "finite_polynomial_source", kind: "named_body", code: issue.code,
      message: issue.message, problemEntityIds: problem?.entities.map(entity => entity.id) ?? []})),
    unsupportedIds: set.obligations.filter(obligation => !obligation.supported).map(obligation => obligation.id)};
  const satisfiedIds: string[] = [];
  const missing: VisualObligationMiss[] = [];
  const unsupportedIds: string[] = [];
  const mapping = mapProblemEntities(set, document, problem);
  const circuit = problem ? bindStatedCircuitProblem(problem.question, problem) : null;
  const sourceGroups = circuit && !checkStatedCircuitProblemBinding(problem!.question, problem, document).some(issue => issue.severity === "fatal")
    ? new Map(circuit.entityBindings.filter(row => document.entities.find(entity => entity.id === row.sceneEntityId)?.kind === "group")
      .map(row => [row.problemEntityId, row.memberIds])) : null;

  for (const obligation of set.obligations) {
    if (!obligation.supported) {
      unsupportedIds.push(obligation.id);
      continue;
    }
    const miss = checkObligation(obligation, document, mapping, problem);
    if (miss) missing.push(miss);
    else satisfiedIds.push(obligation.id);
  }
  // Persistence is part of completeness: an obligated body that the turn does
  // not require and does not reveal is lost on save and on replay.
  for (const obligation of set.obligations) {
    if (obligation.kind !== "named_body" || !obligation.supported) continue;
    const sceneId = mapping.get(obligation.problemEntityId);
    if (!sceneId) continue;
    const members = sourceGroups?.get(obligation.problemEntityId);
    const requiredIds = members ?? [sceneId];
    if (!requiredIds.every(id => document.requiredEntityIds.includes(id))) {
      missing.push({
        obligationId: obligation.id,
        kind: obligation.kind,
        code: "uncovered_required_entity",
        message: `obligated body ${describeBody(obligation)} is missing from requiredEntityIds`,
        problemEntityIds: [obligation.problemEntityId],
      });
    }
    const revealed = [sceneId, ...(members ?? [])].every(id => document.revealGroups.some((group) => group.entityIds.includes(id)));
    if (!revealed) {
      missing.push({
        obligationId: obligation.id,
        kind: obligation.kind,
        code: "uncovered_reveal_entity",
        message: `obligated body ${describeBody(obligation)} is in no reveal group`,
        problemEntityIds: [obligation.problemEntityId],
      });
    }
  }

  return { satisfied: missing.length === 0, satisfiedIds, missing, unsupportedIds };
}

/** Fatal scene issues for every missed supported obligation. */
export function visualObligationIssues(
  problem: ProblemIR,
  document: SceneDocument,
  turnPlan?: unknown,
): SceneIssue[] {
  const set = deriveVisualObligations(problem);
  const result = checkVisualObligations(set, document, problem, turnPlan);
  return result.missing.map((miss) => ({
    code: miss.code,
    message: miss.message,
    severity: "fatal" as const,
    path: `visualObligations/${miss.obligationId}`,
    entityIds: [],
  }));
}

/** First-miss summary for the family loop; null when the candidate is whole. */
export function visualObligationRejection(
  set: VisualObligationSet,
  document: SceneDocument,
  problem?: ProblemIR,
  turnPlan?: unknown,
): string | null {
  const result = checkVisualObligations(set, document, problem, turnPlan);
  return result.missing.length > 0 ? result.missing[0]!.message : null;
}

/**
 * Planner-availability half of the slice: every supported obligation must be
 * expressible with planner-visible capabilities, so the planner can actually
 * be asked for what the obligations demand.
 */
export function visualObligationsPlannerCoverage(set: VisualObligationSet): {
  covered: boolean;
  uncoveredIds: readonly string[];
} {
  const uncoveredIds: string[] = [];
  for (const obligation of set.obligations) {
    if (!obligation.supported) continue;
    if (obligation.kind !== "spatial_relation") continue;
    const visible = obligation.predicates.some((predicate) =>
      isPlannerVisibleSceneProofPredicate(predicate),
    );
    if (!visible) uncoveredIds.push(obligation.id);
  }
  return { covered: uncoveredIds.length === 0, uncoveredIds };
}

function checkObligation(
  obligation: VisualObligation,
  document: SceneDocument,
  mapping: ReadonlyMap<string, string>,
  problem?: ProblemIR,
): VisualObligationMiss | null {
  switch (obligation.kind) {
    case "named_body": {
      const indexedSource = problem ? matrixLiteralSourceEntityIsCarried(document, problem, obligation.problemEntityId) : null;
      if (indexedSource !== null) return indexedSource ? null : {
        obligationId: obligation.id, kind: obligation.kind, code: "missing_named_body",
        message: `source-indexed body ${describeBody(obligation)} is not carried by the complete verified table`, problemEntityIds: [obligation.problemEntityId],
      };
      const sceneId = mapping.get(obligation.problemEntityId);
      return sceneId
        ? null
        : {
            obligationId: obligation.id,
            kind: obligation.kind,
            code: "missing_named_body",
            message: `obligated body ${describeBody(obligation)} has no scene entity`,
            problemEntityIds: [obligation.problemEntityId],
          };
    }
    case "connection": {
      const sceneIds = lookupSceneIds(obligation.problemEntityIds, document, mapping);
      if (!sceneIds) {
        return {
          obligationId: obligation.id,
          kind: obligation.kind,
          code: "missing_connection",
          message: `connection ${obligation.label} names a body with no scene entity`,
          problemEntityIds: [...obligation.problemEntityIds],
        };
      }
      return sceneIdsConnected(document, sceneIds)
        ? null
        : {
            obligationId: obligation.id,
            kind: obligation.kind,
            code: "missing_connection",
            message: `connection ${obligation.label} is not joined in the scene topology`,
            problemEntityIds: [...obligation.problemEntityIds],
          };
    }
    case "given_dimension": {
      return ((isSourceBoundFiniteProgressionDocument(document) ? document.entities.some(entity => entity.kind === "label"
        && Array.isArray(entity.provenance?.expressionIds) && entity.provenance.expressionIds.includes(obligation.problemExpressionId)
        && entity.provenance.value === obligation.value && document.requiredEntityIds.includes(entity.id)
        && document.revealGroups.some(group => group.entityIds.includes(entity.id))) : null)
        ?? (problem ? matrixLiteralSourceDimensionIsCarried(document, problem, obligation.problemExpressionId, obligation.value, obligation.factIds) : null)
        ?? (problem ? uniformCircularSourceDimensionIsCarried(document, problem, obligation.problemExpressionId, obligation.value, obligation.factIds) : null)
        ?? (problem ? pointLineRequestedDimensionIsCarried(document, problem, obligation.problemExpressionId, obligation.value) : null)
        ?? (problem ? sectionFormulaRequestedDimensionIsCarried(document, problem, obligation.problemExpressionId, obligation.value) : null)
        ?? (problem ? circleSourceDimensionIsCarried(document,problem,obligation.problemExpressionId,obligation.value,obligation.factIds) : null)
        ?? sectionFormulaDimensionIsCarried(document, obligation.problemExpressionId, obligation.value, obligation.factIds)
        ?? sceneCarriesValue(document, obligation.value))
        ? null
        : {
            obligationId: obligation.id,
            kind: obligation.kind,
            code: "missing_given_dimension",
            message: `given dimension ${obligation.label} is not carried by the scene`,
            problemEntityIds: [],
          };
    }
    case "spatial_relation": {
      const sceneIds = lookupSceneIds(obligation.problemEntityIds, document, mapping);
      if (!sceneIds) {
        return {
          obligationId: obligation.id,
          kind: obligation.kind,
          code: "missing_spatial_relation",
          message: `${obligation.label} names a body with no scene entity`,
          problemEntityIds: [...obligation.problemEntityIds],
        };
      }
      const proved = document.assertions.some(
        (assertion) =>
          assertion.severity === "fatal" &&
          obligation.predicates.includes(assertion.predicate) &&
          sceneIds.every((id) => assertion.entities.includes(id)),
      );
      return proved
        ? null
        : {
            obligationId: obligation.id,
            kind: obligation.kind,
            code: "missing_spatial_relation",
            message: `${obligation.label} has no fatal ${obligation.predicates.join("/")} proof`,
            problemEntityIds: [...obligation.problemEntityIds],
          };
    }
  }
}

function describeBody(obligation: NamedBodyObligation): string {
  return obligation.problemLabel ?? obligation.problemEntityId;
}

/**
 * Greedy one-to-one map from obligated ProblemIR entities to scene entities.
 * A source-named body must appear under its source name: the id is only a
 * search hint, and an id hit with a missing or conflicting label does not
 * match — a renamed body is a different body. An unnamed body matches by
 * stable id. Each scene entity is consumed once, so two obligations sharing
 * one label still report the second as missing.
 */
function mapProblemEntities(
  set: VisualObligationSet,
  document: SceneDocument,
  problem?: ProblemIR,
): Map<string, string> {
  const mapping = new Map<string, string>();
  const consumed = new Set<string>();
  const byId = new Map(document.entities.map((entity) => [entity.id, entity]));
  const motion = problem ? relativeMotionSource(problem.question) : null;
  const motionBindings = problem && motion?.status === "admitted" && !validateRelativeMotionSourceInputs(document, problem.question).some(issue => issue.severity === "fatal")
    ? relativeMotionSourceEntityBindings(problem.question, problem) : null;
  // Compact badges may name source-proved combinations. Establish the whole
  // circuit correspondence afresh; a badge, role or membership marker alone
  // cannot authorize an identity join.
  const polynomial = problem ? admitFiniteBinomialProblem(problem.question, problem) : null;
  const polynomialId = problem && polynomial?.status === "ok"
    && validateFiniteBinomialSourceDocument(document, problem.question, problem).length === 0 ? polynomial.polynomialEntityId : null;
  const circuit = problem ? bindStatedCircuitProblem(problem.question, problem) : null;
  const circuitBindings = circuit && !checkStatedCircuitProblemBinding(problem!.question, problem, document).some(issue => issue.severity === "fatal")
    ? new Map(circuit.entityBindings.map(row => [row.problemEntityId, row.sceneEntityId])) : null;
  const labelHolds = (entity: SceneDocument["entities"][number], problemLabel: string | null): boolean =>
    problemLabel === null ||
    (typeof entity.label === "string" &&
      sameObligationLabel(entity.label, problemLabel));
  // Text is not a physical body. Structural kinds constrain identity even
  // when the label is exact: a trajectory's name on a point cannot name a curve.
  const kindHolds = (entity: SceneDocument["entities"][number], obligation: NamedBodyObligation): boolean => {
    switch (obligation.problemKind) {
      case "point": return entity.kind === "point";
      // Analytic straight lines may be rendered as sampled function curves.
      case "line": return ["line", "segment", "ray", "polyline"].includes(entity.kind);
      case "curve": return ["polyline", "circle", "arc", "line", "segment", "ray"].includes(entity.kind);
      case "body":
      case "solid":
      case "component":
      case "region":
      case "field": return !["label", "group", "dimension", "angle_mark", "right_angle_mark", "axes"].includes(entity.kind);
      default: return true;
    }
  };
  for (const obligation of set.obligations) {
    if (obligation.kind !== "named_body") continue;
    if (polynomialId === obligation.problemEntityId && byId.has(polynomialId) && !consumed.has(polynomialId)) {
      mapping.set(obligation.problemEntityId, polynomialId); consumed.add(polynomialId); continue;
    }
    const circuitId = circuitBindings?.get(obligation.problemEntityId);
    const circuitEntity = circuitId ? byId.get(circuitId) : null;
    if (circuitEntity && kindHolds(circuitEntity, obligation) && !consumed.has(circuitEntity.id)) {
      mapping.set(obligation.problemEntityId, circuitEntity.id); consumed.add(circuitEntity.id); continue;
    }
    const circularId = problem ? uniformCircularProblemEntitySceneId(document, problem, obligation.problemEntityId) : null;
    const sourceCircleId=problem?circleSourceProblemEntitySceneId(document,problem,obligation.problemEntityId):null;
    const sourceCircleEntity=sourceCircleId?byId.get(sourceCircleId):undefined;
    if (sourceCircleEntity && !consumed.has(sourceCircleEntity.id)) {
      mapping.set(obligation.problemEntityId,sourceCircleEntity.id);consumed.add(sourceCircleEntity.id);continue;
    }
    const circularEntity = circularId ? byId.get(circularId) : null;
    if (circularEntity && kindHolds(circularEntity, obligation) && !consumed.has(circularEntity.id)) {
      mapping.set(obligation.problemEntityId, circularEntity.id); consumed.add(circularEntity.id); continue;
    }
    const actor = motionBindings?.get(obligation.problemEntityId);
    if (actor && motion?.status === "admitted") {
      const key = actor === motion.source.subject.name ? "a" : actor === motion.source.reference.name ? "b" : "o";
      const marker = byId.get(`${key}_start`);
      if (marker && marker.label === actor && kindHolds(marker, obligation) && !consumed.has(marker.id)) {
        mapping.set(obligation.problemEntityId, marker.id); consumed.add(marker.id); continue;
      }
    }
    const direct = byId.get(obligation.problemEntityId);
    if (direct && !consumed.has(direct.id) && kindHolds(direct, obligation) && labelHolds(direct, obligation.problemLabel)) {
      mapping.set(obligation.problemEntityId, direct.id);
      consumed.add(direct.id);
      continue;
    }
    if (obligation.problemLabel === null) continue;
    const wanted = obligation.problemLabel;
    const labelled = document.entities.find(
      (entity) =>
        !consumed.has(entity.id) &&
        kindHolds(entity, obligation) &&
        typeof entity.label === "string" &&
        sameObligationLabel(entity.label, wanted),
    );
    if (labelled) {
      mapping.set(obligation.problemEntityId, labelled.id);
      consumed.add(labelled.id);
    }
  }
  return mapping;
}

/** Resolve constraint endpoints through the body map, then by direct lookup. */
function lookupSceneIds(
  problemIds: readonly string[],
  document: SceneDocument,
  mapping: ReadonlyMap<string, string>,
): string[] | null {
  const sceneIds: string[] = [];
  for (const problemId of problemIds) {
    const mapped = mapping.get(problemId);
    if (mapped) {
      sceneIds.push(mapped);
      continue;
    }
    const direct = document.entities.some((entity) => entity.id === problemId);
    if (direct) {
      sceneIds.push(problemId);
      continue;
    }
    return null;
  }
  return sceneIds;
}

/**
 * Undirected construction-graph connectivity over entity ids: every string in
 * a construction's inputs that names an entity is joined to every output.
 * Assertions deliberately contribute no edges — a claimed path is a proof
 * about the graph, not the graph itself, so a lying assertion can never
 * satisfy a connection on an uncompiled document. Transitive connectivity
 * counts: a series path through other components still joins its ends.
 */
function sceneIdsConnected(document: SceneDocument, sceneIds: readonly string[]): boolean {
  if (sceneIds.length < 2) return true;
  const known = new Set(document.entities.map((entity) => entity.id));
  const adjacency = new Map<string, Set<string>>();
  const link = (first: string, second: string): void => {
    if (first === second || !known.has(first) || !known.has(second)) return;
    const siblings = adjacency.get(first) ?? new Set<string>();
    siblings.add(second);
    adjacency.set(first, siblings);
    const reverse = adjacency.get(second) ?? new Set<string>();
    reverse.add(first);
    adjacency.set(second, reverse);
  };
  const clique = (ids: readonly string[]): void => {
    for (let index = 0; index < ids.length; index += 1) {
      for (let other = index + 1; other < ids.length; other += 1) {
        link(ids[index]!, ids[other]!);
      }
    }
  };
  for (const construction of document.constructions) {
    const touched = [
      ...collectEntityReferences(construction.inputs, known),
      ...construction.outputs.filter((output) => known.has(output)),
    ];
    clique(touched);
  }
  const [start, ...rest] = sceneIds;
  const reached = new Set<string>([start!]);
  const queue = [start!];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const next of adjacency.get(current) ?? []) {
      if (reached.has(next)) continue;
      reached.add(next);
      queue.push(next);
    }
  }
  return rest.every((id) => reached.has(id));
}

function collectEntityReferences(inputs: Record<string, unknown>, known: ReadonlySet<string>): string[] {
  const found: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      if (known.has(value)) found.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
    }
  };
  for (const value of Object.values(inputs)) visit(value);
  return found;
}

function sceneCarriesValue(document: SceneDocument, value: number): boolean {
  return document.quantities.some(
    (quantity) => typeof quantity.value === "number" && valuesMatch(quantity.value, value),
  );
}

function valuesMatch(first: number, second: number): boolean {
  if (!Number.isFinite(first) || !Number.isFinite(second)) return false;
  if (first === second) return true;
  return Math.abs(first - second) <= 1e-9 * Math.max(1, Math.abs(first), Math.abs(second));
}

function normalizeObligationLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * A board formula writes subscripts as `_4` and charges as `^(2-)`. That is
 * the same species as the source spelling `SF4` or `SO4^2-`, not a renamed body.
 * Anything that is not a chemical formula keeps the exact trimmed comparison.
 */
function sameObligationLabel(sceneLabel: string, problemLabel: string): boolean {
  if (normalizeObligationLabel(sceneLabel) === normalizeObligationLabel(problemLabel)) return true;
  const sceneKey = formulaIdentity(sceneLabel);
  const problemKey = formulaIdentity(problemLabel);
  return sceneKey !== null && sceneKey === problemKey;
}

function formulaIdentity(value: string): string | null {
  const key = value
    .trim()
    .replace(/\s+/g, "")
    .replace(/_(\d+)/g, "$1")
    .replace(/\^\(([^)]*)\)/g, "$1")
    .replace(/[\^()[\]]/g, "");
  if (!/^[A-Z][A-Za-z0-9+-]*$/.test(key)) return null;
  return key;
}

/**
 * Closed-form constant evaluation over the ProblemIR expression tree. Any free
 * variable — or anything outside the finite range — is not a given dimension,
 * so it yields no obligation rather than a guessed one. Function semantics
 * match the audited expression language (`log` is the natural logarithm).
 */
export function evaluateConstantExpression(root: ExpressionNodeIR): number | null {
  switch (root.kind) {
    case "number":
      return Number.isFinite(root.value) && Math.abs(root.value) <= 1e12 ? root.value : null;
    case "constant":
      return root.name === "pi" ? Math.PI : Math.E;
    case "variable":
      return null;
    case "unary": {
      const operand = evaluateConstantExpression(root.operand);
      if (operand === null) return null;
      const value = root.operator === "+" ? operand : -operand;
      return Number.isFinite(value) ? value : null;
    }
    case "binary": {
      const left = evaluateConstantExpression(root.left);
      const right = evaluateConstantExpression(root.right);
      if (left === null || right === null) return null;
      let value: number;
      switch (root.operator) {
        case "+": value = left + right; break;
        case "-": value = left - right; break;
        case "*": value = left * right; break;
        case "/":
          if (right === 0) return null;
          value = left / right;
          break;
        case "^":
          value = Math.pow(left, right);
          break;
      }
      return Number.isFinite(value) && Math.abs(value) <= 1e12 ? value : null;
    }
    case "call": {
      const argument = evaluateConstantExpression(root.argument);
      if (argument === null) return null;
      let value: number;
      switch (root.function) {
        case "sin": value = Math.sin(argument); break;
        case "cos": value = Math.cos(argument); break;
        case "tan": value = Math.tan(argument); break;
        case "asin":
          if (Math.abs(argument) > 1) return null;
          value = Math.asin(argument);
          break;
        case "acos":
          if (Math.abs(argument) > 1) return null;
          value = Math.acos(argument);
          break;
        case "atan": value = Math.atan(argument); break;
        case "sqrt":
          if (argument < 0) return null;
          value = Math.sqrt(argument);
          break;
        case "abs": value = Math.abs(argument); break;
        case "exp": value = Math.exp(argument); break;
        case "log":
        case "ln":
          if (argument <= 0) return null;
          value = Math.log(argument);
          break;
      }
      return Number.isFinite(value) && Math.abs(value) <= 1e12 ? value : null;
    }
  }
}
