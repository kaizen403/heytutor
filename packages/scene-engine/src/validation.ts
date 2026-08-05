import {
  SCENE_DOCUMENT_VERSION,
  SCENE_ENGINE_VERSION,
  type SceneDocument,
  type SceneIssue,
  type ValidationReport,
  type ValidationResult,
} from "./types";
import { parseMathExpression, parseMathExpression2D } from "./expression";

const ARRAY_FIELDS = [
  "quantities", "entities", "constructions", "relations", "assertions",
  "annotations", "requiredEntityIds", "revealGroups", "teachingTimeline",
] as const;

const SUPPORTED_OPERATORS = new Set([
  "point", "segment", "ray", "line", "circle", "arc", "rectangle", "polygon",
  "polyline", "vector", "axes", "function_curve", "function_region", "parametric_curve",
  "polar_curve", "implicit_curve", "tangent_line", "normal_line", "representative_slice", "solid_of_revolution",
  "solid_projection", "solid_cross_section",
  "wavefront_family", "aperture", "screen_pattern", "transverse_field", "polarizer",
  "optical_train",
  "intersection", "midpoint",
  "surface_intersection", "surface_contact", "normal_at",
  "project", "translate", "rotate", "reflect_point", "reflect_direction",
  "refract_direction", "reflect_at", "refract_at", "parallel_through", "perpendicular_through", "angle_bisector",
  "angle_mark", "right_angle_mark", "tick_mark",
  "vector_components", "dimension", "connect", "symbol",
  "label",
]);

const VISIBLE_ENTITY_KIND_BY_OPERATOR: Readonly<Record<string, string>> = {
  segment: "segment", ray: "ray", line: "line", circle: "circle", arc: "arc",
  rectangle: "polygon", polygon: "polygon", polyline: "polyline", vector: "vector",
  axes: "axes", function_curve: "curve", function_region: "region",
  parametric_curve: "curve", polar_curve: "curve", implicit_curve: "curve",
  tangent_line: "line", normal_line: "line", representative_slice: "region",
  solid_of_revolution: "solid", solid_projection: "solid", solid_cross_section: "region",
  wavefront_family: "polyline", aperture: "polyline", screen_pattern: "polyline",
  transverse_field: "polyline", polarizer: "polyline",
  optical_train: "ray",
  angle_mark: "angle_mark", right_angle_mark: "right_angle_mark", tick_mark: "tick_mark",
  dimension: "dimension", connect: "connector", symbol: "component", label: "label",
};

const INFERRED_CONSTRUCTION_ENTITY = "__inferredConstructionEntity";
const CONSTRUCTION_ENTITY_REFERENCE_KEYS = new Set([
  "start", "end", "from", "to", "a", "b", "center", "origin", "surface",
  "through", "parallelTo", "first", "second", "point", "line", "incoming",
  "normal", "vertex", "curve", "upper", "lower", "profile", "solid", "basis",
  "vector", "target", "points", "direction", "axis", "objective", "eyepiece", "focus",
]);

/** Capability-corpus gate: fixtures may only name executable scene operators. */
export function isSupportedSceneOperator(operator: string): boolean {
  return SUPPORTED_OPERATORS.has(operator);
}

const SAMPLED_CURVE_OPERATORS = new Set(["function_curve", "parametric_curve", "polar_curve"]);
const CALCULUS_OPERATORS = new Set([
  "parametric_curve", "polar_curve", "implicit_curve", "tangent_line", "normal_line",
  "representative_slice", "solid_of_revolution",
]);
const MENSURATION_OPERATORS = new Set(["solid_projection", "solid_cross_section"]);
const WAVE_VISUAL_OPERATORS = new Set([
  "wavefront_family", "aperture", "screen_pattern", "transverse_field", "polarizer",
]);
const SURFACE_RAY_OPERATORS = new Set(["reflect_at", "refract_at"]);
const SOLID_PROJECTION_KINDS = new Set(["cylinder", "cone", "frustum", "sphere", "hemisphere"]);
const SUPPORTED_COMPONENT_SYMBOLS = [
  "galvanometer", "voltmeter", "ammeter", "capacitor", "inductor", "resistor",
  "ac_source", "battery", "zener", "diode", "switch", "lamp", "cell",
] as const;

/**
 * Remove entities that are provably planner artifacts before strict validation.
 * This is deliberately narrower than schema repair: ordinary dead entities are
 * removed only when omitted from ownership and references. A connector directly
 * duplicating a component terminal pair is also removed when nothing claims it
 * as an intentional short/bypass and no semantic reference consumes it.
 */
export function pruneDeadSceneEntities(raw: Record<string, unknown>): Record<string, unknown> {
  raw = normalizeConstructedLabels(raw);
  raw = pruneSelfReferentialConstructedLabels(raw);
  raw = promoteAssertedEntityOwnership(raw);
  raw = pruneUnconstructedWarningAssertions(raw);
  raw = pruneQuantityNarrationAnnotations(raw);
  raw = normalizeCoincidentUnownedPointAliases(raw);
  raw = normalizeAssertedDimensionBindings(raw);
  raw = normalizeRecognizedComponentOperators(raw);
  raw = repairAssertedSeriesTerminalIncidence(raw);
  raw = repairUniquelyAssertedPoweredLoop(raw);
  raw = normalizeMechanicalPlannerArtifacts(raw);
  raw = normalizeProofDerivedOpticsGeometry(raw);
  raw = normalizeProofDerivedOpticalTrain(raw);
  raw = normalizeMissingReferenceLineEndpoints(raw);
  raw = pruneRedundantIncidentPathDeclarations(raw);
  raw = promoteVisibleIncidentPaths(raw);
  raw = promoteTransformIncidentPaths(raw);
  raw = pruneUnsolvedRayPairs(raw);
  if (
    !Array.isArray(raw.entities) ||
    !Array.isArray(raw.constructions) ||
    !Array.isArray(raw.requiredEntityIds) ||
    !Array.isArray(raw.revealGroups)
  ) {
    return raw;
  }

  const entityIds = new Set(raw.entities.flatMap((entity) =>
    isRecord(entity) && typeof entity.id === "string" ? [entity.id] : [],
  ));
  const producerByOutput = new Map<string, Record<string, unknown>>();
  for (const construction of raw.constructions) {
    if (!isRecord(construction) || !Array.isArray(construction.outputs)) continue;
    for (const output of construction.outputs) {
      if (typeof output === "string") producerByOutput.set(output, construction);
    }
  }
  const annotationTexts = new Set(
    (Array.isArray(raw.annotations) ? raw.annotations : []).flatMap((annotation) =>
      isRecord(annotation) && typeof annotation.text === "string"
        ? [normalizeLabelText(annotation.text)]
        : [],
    ),
  );
  const redundantLabelIds = new Set(raw.entities.flatMap((entity) =>
    isRecord(entity) &&
    typeof entity.id === "string" &&
    entity.kind === "label" &&
    typeof entity.label === "string" &&
    !producerByOutput.has(entity.id) &&
    annotationTexts.has(normalizeLabelText(entity.label))
      ? [entity.id]
      : [],
  ));

  const owned = new Set(raw.requiredEntityIds.filter((id): id is string =>
    typeof id === "string" && !redundantLabelIds.has(id),
  ));
  for (const group of raw.revealGroups) {
    if (!isRecord(group) || !Array.isArray(group.entityIds)) continue;
    for (const id of group.entityIds) {
      if (typeof id === "string" && !redundantLabelIds.has(id)) owned.add(id);
    }
  }

  const referenced = new Set<string>();
  const nonAssertionReferenced = new Set<string>();
  const contractReferenced = new Set<string>();
  const collectEntityReferences = (value: unknown): void => {
    if (typeof value === "string") {
      if (entityIds.has(value)) referenced.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collectEntityReferences(item);
      return;
    }
    if (isRecord(value)) {
      for (const item of Object.values(value)) collectEntityReferences(item);
    }
  };
  for (const construction of raw.constructions) {
    if (isRecord(construction)) {
      collectConstructionEntityReferences(construction.inputs, entityIds, referenced);
      collectConstructionEntityReferences(
        construction.inputs,
        entityIds,
        nonAssertionReferenced,
      );
    }
  }
  for (const field of ["relations", "annotations", "teachingTimeline"] as const) {
    if (Array.isArray(raw[field])) collectEntityReferences(raw[field]);
    if (Array.isArray(raw[field])) {
      collectEntityReferencesInto(raw[field], entityIds, nonAssertionReferenced);
      collectEntityReferencesInto(raw[field], entityIds, contractReferenced);
    }
  }
  if (Array.isArray(raw.assertions)) {
    for (const assertion of raw.assertions) {
      const isRedundantLabelAssertion = isRecord(assertion) &&
        assertion.predicate === "label_attached" &&
        Array.isArray(assertion.entities) &&
        assertion.entities.length > 0 &&
        assertion.entities.every((id) => typeof id === "string" && redundantLabelIds.has(id));
      if (!isRedundantLabelAssertion) {
        collectEntityReferences(assertion);
        collectEntityReferencesInto(assertion, entityIds, contractReferenced);
      }
    }
  }

  const originalEntities = raw.entities;
  const entitiesById = new Map(originalEntities.flatMap((entity) =>
    isRecord(entity) && typeof entity.id === "string" ? [[entity.id, entity] as const] : [],
  ));
  const labelNormalizedEntities = originalEntities.map((entity) =>
    isRecord(entity) && shouldStripHelperPointLabel(entity, raw)
      ? omitLabel(entity)
      : entity,
  );
  const componentPairs = new Set<string>();
  const componentTerminals = new Map<string, readonly [string, string]>();
  for (const construction of raw.constructions) {
    if (!isRecord(construction) || construction.operator !== "symbol" || !isRecord(construction.inputs)) continue;
    const start = constructionEndpoint(construction.inputs, ["start", "from", "a"]);
    const end = constructionEndpoint(construction.inputs, ["end", "to", "b"]);
    const output = Array.isArray(construction.outputs) ? construction.outputs[0] : undefined;
    if (start && end && start !== end) {
      componentPairs.add(canonicalTerminalPair(start, end));
      if (typeof output === "string") componentTerminals.set(output, [start, end]);
    }
  }
  const assertedChainTerminalPairs = assertedComponentChainTerminalPairs(raw.assertions, componentTerminals);
  const groupByEntity = new Map<string, string>();
  for (const group of raw.revealGroups) {
    if (!isRecord(group) || typeof group.id !== "string" || !Array.isArray(group.entityIds)) continue;
    for (const id of group.entityIds) {
      if (typeof id === "string") groupByEntity.set(id, group.id);
    }
  }
  const crossViewConnectors = new Set<string>();
  for (const construction of raw.constructions) {
    if (
      !isRecord(construction) ||
      construction.operator !== "connect" ||
      !isRecord(construction.inputs) ||
      !Array.isArray(construction.outputs) ||
      construction.outputs.length !== 1 ||
      typeof construction.outputs[0] !== "string"
    ) continue;
    const output = construction.outputs[0];
    const start = constructionEndpoint(construction.inputs, ["start", "from", "a"]);
    const end = constructionEndpoint(construction.inputs, ["end", "to", "b"]);
    const startGroup = start ? groupByEntity.get(start) : undefined;
    const endGroup = end ? groupByEntity.get(end) : undefined;
    const entity = entitiesById.get(output);
    const semanticRole = `${String(entity?.role ?? "")} ${String(entity?.label ?? "")}`.toLowerCase();
    if (
      startGroup &&
      endGroup &&
      startGroup !== endGroup &&
      !/\b(bridge|cross[- ]?view|coupling|link)\b/.test(semanticRole) &&
      !referenced.has(output)
    ) {
      crossViewConnectors.add(output);
    }
  }
  const redundantDirectBypasses = new Set<string>();
  const degenerateConnectors = new Set<string>();
  const redundantClosingConnectors = new Set<string>();
  const connectorsByPair = new Map<string, string[]>();
  for (const construction of raw.constructions) {
    if (
      !isRecord(construction) ||
      construction.operator !== "connect" ||
      !isRecord(construction.inputs) ||
      !Array.isArray(construction.outputs) ||
      construction.outputs.length !== 1 ||
      typeof construction.outputs[0] !== "string"
    ) continue;
    const output = construction.outputs[0];
    const start = constructionEndpoint(construction.inputs, ["start", "from", "a"]);
    const end = constructionEndpoint(construction.inputs, ["end", "to", "b"]);
    const entity = entitiesById.get(output);
    const semanticRole = entity
      ? `${String(entity.role ?? "")} ${String(entity.label ?? "")}`.toLowerCase()
      : "";
    const explicitlySemantic = isExplicitConnectorSemantic(semanticRole);
    if (start && end) {
      if (start === end && !explicitlySemantic && !referenced.has(output)) {
        degenerateConnectors.add(output);
      } else if (start !== end) {
        const pair = canonicalTerminalPair(start, end);
        const siblings = connectorsByPair.get(pair) ?? [];
        siblings.push(output);
        connectorsByPair.set(pair, siblings);
        if (
          assertedChainTerminalPairs.has(pair) &&
          !explicitlySemantic &&
          !referenced.has(output)
        ) {
          redundantClosingConnectors.add(output);
        }
      }
    }
    if (
      start &&
      end &&
      componentPairs.has(canonicalTerminalPair(start, end)) &&
      !explicitlySemantic &&
      !nonAssertionReferenced.has(output)
    ) {
      redundantDirectBypasses.add(output);
    }
  }
  const duplicateConnectors = new Set<string>();
  for (const siblings of connectorsByPair.values()) {
    if (siblings.length < 2) continue;
    for (const output of siblings.slice(1)) {
      const entity = entitiesById.get(output);
      const semanticRole = entity
        ? `${String(entity.role ?? "")} ${String(entity.label ?? "")}`.toLowerCase()
        : "";
      if (!isExplicitConnectorSemantic(semanticRole) && !referenced.has(output)) {
        duplicateConnectors.add(output);
      }
    }
  }

  const prunable = new Set<string>();
  const solverOnlyPointDeclarations = new Set<string>();
  for (const [entityIndex, entity] of raw.entities.entries()) {
    if (!isRecord(entity) || typeof entity.id !== "string") continue;
    const output = entity.id;
    const producer = producerByOutput.get(output);
    const normalizedEntity = labelNormalizedEntities[entityIndex];
    const normalizedRole = normalizeLabelText(
      isRecord(normalizedEntity) && typeof normalizedEntity.role === "string"
        ? normalizedEntity.role
        : String(entity.kind ?? ""),
    );
    const isolatedHelperPoint =
      entity.kind === "point" &&
      producer?.operator === "point" &&
      !referenced.has(output) &&
      isRecord(normalizedEntity) &&
      typeof normalizedEntity.label !== "string" &&
      /^(?:point|node|terminal|junction|endpoint|connection|branch|helper|layout|wire)$/.test(normalizedRole);
    const constructionOnlyHelperPoint =
      entity.kind === "point" &&
      producer?.operator === "point" &&
      !owned.has(output) &&
      !contractReferenced.has(output) &&
      isRecord(normalizedEntity) &&
      typeof normalizedEntity.label !== "string";
    if (constructionOnlyHelperPoint) solverOnlyPointDeclarations.add(output);
    const orphanLabelDeclaration =
      entity.kind === "label" &&
      !producer &&
      !referenced.has(output) &&
      isRecord(normalizedEntity) &&
      typeof normalizedEntity.label !== "string";
    if (
      redundantDirectBypasses.has(output) ||
      redundantClosingConnectors.has(output) ||
      duplicateConnectors.has(output) ||
      degenerateConnectors.has(output) ||
      crossViewConnectors.has(output) ||
      isolatedHelperPoint ||
      orphanLabelDeclaration ||
      (
        !owned.has(output) &&
        !referenced.has(output) &&
        (!producer || (Array.isArray(producer.outputs) && producer.outputs.length === 1))
      )
    ) {
      prunable.add(output);
    }
  }
  const retainedConstructions = raw.constructions.filter((construction) =>
    !isRecord(construction) ||
    !Array.isArray(construction.outputs) ||
    construction.outputs.length !== 1 ||
    typeof construction.outputs[0] !== "string" ||
    !prunable.has(construction.outputs[0]),
  );
  const declaredRetainedIds = new Set(labelNormalizedEntities.flatMap((entity) =>
    isRecord(entity) &&
    typeof entity.id === "string" &&
    !prunable.has(entity.id)
      ? [entity.id]
      : [],
  ));
  const externallyOwned = new Set<string>([
    ...raw.requiredEntityIds.filter((id): id is string =>
      typeof id === "string" && !prunable.has(id)),
    ...raw.revealGroups.flatMap((group) =>
      isRecord(group) && Array.isArray(group.entityIds)
        ? group.entityIds.filter((id): id is string =>
            typeof id === "string" && !prunable.has(id))
        : [],
    ),
  ]);
  const nonConstructionReferences = new Set<string>();
  for (const field of ["assertions", "relations", "annotations", "teachingTimeline"] as const) {
    collectStrings(raw[field], (value) => nonConstructionReferences.add(value));
  }
  let constructions = retainedConstructions;
  while (true) {
    const retainedInputReferences = new Set(nonConstructionReferences);
    for (const construction of constructions) {
      if (!isRecord(construction)) continue;
      collectStrings(construction.inputs, (value) => retainedInputReferences.add(value));
    }
    const next = constructions.filter((construction) => {
      if (!isRecord(construction) || !Array.isArray(construction.outputs)) return true;
      const outputs = construction.outputs.filter((output): output is string => typeof output === "string");
      if (outputs.length === 0) return false;
      if (
        typeof construction.operator === "string" &&
        VISIBLE_ENTITY_KIND_BY_OPERATOR[construction.operator]
      ) return true;
      return outputs.some((output) =>
        declaredRetainedIds.has(output) ||
        externallyOwned.has(output) ||
        retainedInputReferences.has(output));
    });
    if (next.length === constructions.length) break;
    constructions = next;
  }
  const executableEntityIds = new Set(declaredRetainedIds);
  for (const construction of constructions) {
    if (!isRecord(construction) || !Array.isArray(construction.outputs)) continue;
    for (const output of construction.outputs) {
      if (typeof output === "string") executableEntityIds.add(output);
    }
  }
  const assertions = Array.isArray(raw.assertions)
    ? normalizeAssertionsAfterPruning(raw.assertions, prunable, constructions)
      .filter((assertion) =>
        !isRecord(assertion) ||
        !Array.isArray(assertion.entities) ||
        assertion.entities.every((id) =>
          typeof id === "string" && executableEntityIds.has(id)))
    : raw.assertions;

  return {
    ...raw,
    requiredEntityIds: raw.requiredEntityIds.filter((id) =>
      typeof id !== "string" || !prunable.has(id),
    ),
    revealGroups: raw.revealGroups.map((group) =>
      isRecord(group) && Array.isArray(group.entityIds)
        ? { ...group, entityIds: group.entityIds.filter((id) => typeof id !== "string" || !prunable.has(id)) }
        : group,
    ),
    assertions,
    entities: labelNormalizedEntities.filter((entity) =>
      !isRecord(entity) ||
      typeof entity.id !== "string" ||
      (!prunable.has(entity.id) && !solverOnlyPointDeclarations.has(entity.id)),
    ),
    constructions,
  };
}

function normalizeMissingReferenceLineEndpoints(raw: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(raw.entities) || !Array.isArray(raw.constructions)) return raw;
  const produced = new Set(raw.constructions.flatMap((construction) =>
    isRecord(construction) && Array.isArray(construction.outputs)
      ? construction.outputs.filter((id): id is string => typeof id === "string")
      : []));
  const entityById = new Map(raw.entities.flatMap((entity) =>
    isRecord(entity) && typeof entity.id === "string" ? [[entity.id, entity] as const] : []));
  let changed = false;
  const constructions = raw.constructions.map((construction) => {
    if (
      !isRecord(construction) ||
      construction.operator !== "line" ||
      !isRecord(construction.inputs) ||
      construction.inputs.direction !== undefined ||
      typeof construction.inputs.start !== "string" ||
      !produced.has(construction.inputs.start) ||
      typeof construction.inputs.end !== "string" ||
      produced.has(construction.inputs.end) ||
      !Array.isArray(construction.outputs) ||
      typeof construction.outputs[0] !== "string"
    ) return construction;
    const entity = entityById.get(construction.outputs[0]);
    const semantic = `${construction.outputs[0]} ${String(entity?.role ?? "")} ${String(entity?.label ?? "")}`
      .toLowerCase().replace(/[_-]+/g, " ");
    if (!/\b(?:interface|boundary|reference axis|principal axis|optical axis)\b/.test(semantic)) return construction;
    changed = true;
    const inputs = { ...construction.inputs };
    delete inputs.end;
    return { ...construction, inputs: { ...inputs, direction: [1, 0] } };
  });
  return changed ? { ...raw, constructions } : raw;
}

/**
 * Assertions make an entity part of the visible semantic contract. Planner
 * responses sometimes omit that entity from ownership metadata even though a
 * sibling assertion entity already identifies the intended reveal group.
 */
function promoteAssertedEntityOwnership(raw: Record<string, unknown>): Record<string, unknown> {
  if (
    !Array.isArray(raw.entities) ||
    !Array.isArray(raw.assertions) ||
    !Array.isArray(raw.requiredEntityIds) ||
    !Array.isArray(raw.revealGroups)
  ) return raw;

  const declared = new Set(raw.entities.flatMap((entity) =>
    isRecord(entity) && typeof entity.id === "string" ? [entity.id] : []));
  const required = raw.requiredEntityIds.filter((id): id is string => typeof id === "string");
  const requiredSet = new Set(required);
  const groups = raw.revealGroups.map((group) =>
    isRecord(group) && Array.isArray(group.entityIds)
      ? { ...group, entityIds: group.entityIds.filter((id): id is string => typeof id === "string") }
      : group);
  const groupIndexByEntity = new Map<string, number>();
  groups.forEach((group, index) => {
    if (!isRecord(group) || !Array.isArray(group.entityIds)) return;
    for (const id of group.entityIds) if (typeof id === "string") groupIndexByEntity.set(id, index);
  });

  let changed = false;
  for (const assertion of raw.assertions) {
    if (!isRecord(assertion) || !Array.isArray(assertion.entities)) continue;
    const entityIds = assertion.entities.filter((id): id is string => typeof id === "string" && declared.has(id));
    const ownerIndex = entityIds.map((id) => groupIndexByEntity.get(id)).find((index) => index !== undefined)
      ?? (groups.length === 1 ? 0 : undefined);
    if (ownerIndex === undefined) continue;
    const owner = groups[ownerIndex];
    if (!isRecord(owner) || !Array.isArray(owner.entityIds)) continue;
    for (const id of entityIds) {
      if (!requiredSet.has(id)) {
        required.push(id);
        requiredSet.add(id);
        changed = true;
      }
      if (!groupIndexByEntity.has(id)) {
        owner.entityIds.push(id);
        groupIndexByEntity.set(id, ownerIndex);
        changed = true;
      }
    }
  }
  return changed ? { ...raw, requiredEntityIds: required, revealGroups: groups } : raw;
}

function normalizeConstructedLabels(raw: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(raw.entities) || !Array.isArray(raw.constructions)) return raw;
  const labels = new Map<string, string>();
  for (const construction of raw.constructions) {
    if (
      !isRecord(construction) ||
      construction.operator !== "label" ||
      !isRecord(construction.inputs) ||
      typeof construction.inputs.text !== "string" ||
      !Array.isArray(construction.outputs) ||
      typeof construction.outputs[0] !== "string"
    ) continue;
    labels.set(construction.outputs[0], construction.inputs.text);
  }
  if (labels.size === 0) return raw;
  return {
    ...raw,
    entities: raw.entities.map((entity) => {
      if (!isRecord(entity) || typeof entity.id !== "string") return entity;
      const text = labels.get(entity.id);
      return text === undefined ? entity : { ...entity, kind: "label", role: "diagram label", label: text };
    }),
  };
}

function pruneSelfReferentialConstructedLabels(raw: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(raw.entities) || !Array.isArray(raw.constructions)) return raw;
  const removedIds = new Set(raw.constructions.flatMap((construction) =>
    isRecord(construction) &&
    construction.operator === "label" &&
    isRecord(construction.inputs) &&
    Array.isArray(construction.outputs) &&
    typeof construction.outputs[0] === "string" &&
    construction.inputs.target === construction.outputs[0]
      ? [construction.outputs[0]]
      : []));
  if (removedIds.size === 0) return raw;
  const withoutIds = (value: unknown): unknown => Array.isArray(value)
    ? value.filter((item) => typeof item !== "string" || !removedIds.has(item))
    : value;
  const annotations = Array.isArray(raw.annotations)
    ? raw.annotations.flatMap((annotation) => {
        if (!isRecord(annotation) || !Array.isArray(annotation.targetIds)) return [annotation];
        const targetIds = withoutIds(annotation.targetIds);
        return Array.isArray(targetIds) && targetIds.length > 0 ? [{ ...annotation, targetIds }] : [];
      })
    : raw.annotations;
  const retainedAnnotationIds = new Set(Array.isArray(annotations) ? annotations.flatMap((annotation) =>
    isRecord(annotation) && typeof annotation.id === "string" ? [annotation.id] : []) : []);
  const removedAnnotationIds = new Set(Array.isArray(raw.annotations) ? raw.annotations.flatMap((annotation) =>
    isRecord(annotation) && typeof annotation.id === "string" && !retainedAnnotationIds.has(annotation.id)
      ? [annotation.id]
      : []) : []);
  const removedTimelineTargets = new Set([...removedIds, ...removedAnnotationIds]);
  return {
    ...raw,
    entities: raw.entities.filter((entity) =>
      !isRecord(entity) || typeof entity.id !== "string" || !removedIds.has(entity.id)),
    constructions: raw.constructions.filter((construction) =>
      !isRecord(construction) ||
      !Array.isArray(construction.outputs) ||
      !construction.outputs.some((output) => typeof output === "string" && removedIds.has(output))),
    requiredEntityIds: withoutIds(raw.requiredEntityIds),
    revealGroups: Array.isArray(raw.revealGroups)
      ? raw.revealGroups.map((group) => isRecord(group)
        ? { ...group, entityIds: withoutIds(group.entityIds) }
        : group)
      : raw.revealGroups,
    assertions: Array.isArray(raw.assertions)
      ? raw.assertions.filter((assertion) =>
        !isRecord(assertion) ||
        !Array.isArray(assertion.entities) ||
        !assertion.entities.some((id) => typeof id === "string" && removedIds.has(id)))
      : raw.assertions,
    annotations,
    teachingTimeline: Array.isArray(raw.teachingTimeline)
      ? raw.teachingTimeline.flatMap((action) => {
          if (!isRecord(action)) return [action];
          if (typeof action.targetId === "string" && removedTimelineTargets.has(action.targetId)) return [];
          if (!Array.isArray(action.targetIds)) return [action];
          const targetIds = action.targetIds.filter((id) =>
            typeof id !== "string" || !removedTimelineTargets.has(id));
          return targetIds.length > 0 ? [{ ...action, targetIds }] : [];
        })
      : raw.teachingTimeline,
  };
}

function pruneUnconstructedWarningAssertions(raw: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(raw.assertions) || !Array.isArray(raw.constructions)) return raw;
  const produced = new Set(raw.constructions.flatMap((construction) =>
    isRecord(construction) && Array.isArray(construction.outputs)
      ? construction.outputs.filter((id): id is string => typeof id === "string")
      : [],
  ));
  return {
    ...raw,
    assertions: raw.assertions.filter((assertion) => {
      if (!isRecord(assertion) || assertion.severity !== "warning" || !Array.isArray(assertion.entities)) return true;
      return assertion.entities.every((id) => typeof id !== "string" || produced.has(id));
    }),
  };
}

function pruneUnsolvedRayPairs(raw: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(raw.entities) || !Array.isArray(raw.constructions)) return raw;
  const constructions = raw.constructions.filter(isRecord);
  const transforms = constructions.filter((construction) =>
    construction.operator === "reflect_direction" || construction.operator === "refract_direction");
  if (transforms.length === 0) return raw;
  const usedIncoming = new Set(transforms.flatMap((construction) =>
    isRecord(construction.inputs) && typeof construction.inputs.incoming === "string"
      ? [construction.inputs.incoming]
      : []));
  const outputProducer = new Map<string, Record<string, unknown>>();
  for (const construction of constructions) {
    if (!Array.isArray(construction.outputs)) continue;
    for (const output of construction.outputs) if (typeof output === "string") outputProducer.set(output, construction);
  }
  const removedIds = new Set<string>();
  for (const entity of raw.entities) {
    if (
      !isRecord(entity) || typeof entity.id !== "string" ||
      (entity.kind !== "ray" && entity.kind !== "vector") ||
      typeof entity.role !== "string" || !/\bincident(?:[ _-]?ray)?\b/i.test(entity.role) ||
      usedIncoming.has(entity.id)
    ) continue;
    const suffixes = semanticNumericSuffixes(entity.id, String(outputProducer.get(entity.id)?.id ?? ""));
    if (suffixes.size === 0) continue;
    const outgoing = raw.entities.find((candidate) => {
      if (
        !isRecord(candidate) || typeof candidate.id !== "string" || candidate.id === entity.id ||
        (candidate.kind !== "ray" && candidate.kind !== "vector")
      ) return false;
      const producer = outputProducer.get(candidate.id);
      if (producer?.operator === "reflect_direction" || producer?.operator === "refract_direction") return false;
      const words = `${candidate.id} ${String(candidate.role ?? "")}`.replace(/[_-]+/g, " ");
      if (!/\b(?:out|reflected|refracted|reflection|refraction|ref)\b/i.test(words)) return false;
      const candidateSuffixes = semanticNumericSuffixes(candidate.id, String(producer?.id ?? ""));
      return [...suffixes].some((suffix) => candidateSuffixes.has(suffix));
    });
    if (isRecord(outgoing) && typeof outgoing.id === "string") {
      removedIds.add(entity.id);
      removedIds.add(outgoing.id);
    }
  }
  if (removedIds.size === 0) return raw;

  let remainingConstructions = raw.constructions.filter((construction) =>
    !isRecord(construction) || !Array.isArray(construction.outputs) ||
    !construction.outputs.some((output) => typeof output === "string" && removedIds.has(output)));
  const declaredIds = new Set(raw.entities.flatMap((entity) =>
    isRecord(entity) && typeof entity.id === "string" && !removedIds.has(entity.id) ? [entity.id] : [],
  ));
  let changed = true;
  while (changed) {
    changed = false;
    const referenced = new Set<string>();
    for (const construction of remainingConstructions) {
      if (isRecord(construction)) collectStrings(construction.inputs, (id) => referenced.add(id));
    }
    const next = remainingConstructions.filter((construction) => {
      if (!isRecord(construction) || !Array.isArray(construction.outputs)) return true;
      const outputs = construction.outputs.filter((output): output is string => typeof output === "string");
      const orphan = outputs.length > 0 && outputs.every((output) =>
        !declaredIds.has(output) && !referenced.has(output));
      if (orphan) outputs.forEach((output) => removedIds.add(output));
      return !orphan;
    });
    changed = next.length !== remainingConstructions.length;
    remainingConstructions = next;
  }
  const stripIds = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.filter((item) =>
      typeof item !== "string" || !removedIds.has(item)).map(stripIds);
    if (!isRecord(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stripIds(item)]));
  };
  return {
    ...raw,
    entities: raw.entities.filter((entity) =>
      !isRecord(entity) || typeof entity.id !== "string" || !removedIds.has(entity.id)),
    constructions: remainingConstructions,
    requiredEntityIds: stripIds(raw.requiredEntityIds),
    revealGroups: stripIds(raw.revealGroups),
    annotations: Array.isArray(raw.annotations)
      ? raw.annotations.flatMap((annotation) => {
          if (!isRecord(annotation)) return [annotation];
          const targetIds = Array.isArray(annotation.targetIds)
            ? annotation.targetIds.filter((id) => typeof id !== "string" || !removedIds.has(id))
            : [];
          return targetIds.length > 0 ? [{ ...annotation, targetIds }] : [];
        })
      : raw.annotations,
    assertions: Array.isArray(raw.assertions)
      ? raw.assertions.filter((assertion) =>
          !isRecord(assertion) || !Array.isArray(assertion.entities) ||
          !assertion.entities.some((id) => typeof id === "string" && removedIds.has(id)))
      : raw.assertions,
    relations: Array.isArray(raw.relations)
      ? raw.relations.filter((relation) =>
          !isRecord(relation) || !Array.isArray(relation.entities) ||
          !relation.entities.some((id) => typeof id === "string" && removedIds.has(id)))
      : raw.relations,
    teachingTimeline: Array.isArray(raw.teachingTimeline)
      ? raw.teachingTimeline.flatMap((action) => {
          if (!isRecord(action) || (typeof action.targetId === "string" && removedIds.has(action.targetId))) {
            return isRecord(action) ? [] : [action];
          }
          if (!Array.isArray(action.targetIds)) return [action];
          const targetIds = action.targetIds.filter((id) =>
            typeof id !== "string" || !removedIds.has(id));
          return targetIds.length > 0 ? [{ ...action, targetIds }] : [];
        })
      : raw.teachingTimeline,
  };
}

function pruneQuantityNarrationAnnotations(raw: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(raw.annotations) || !Array.isArray(raw.quantities)) return raw;
  const quantityIds = new Set(raw.quantities.flatMap((quantity) =>
    isRecord(quantity) && typeof quantity.id === "string" ? [quantity.id] : [],
  ));
  const annotations = raw.annotations.filter((annotation) =>
    !(
      isRecord(annotation) &&
      annotation.kind === "narration" &&
      Array.isArray(annotation.targetIds) &&
      annotation.targetIds.length > 0 &&
      annotation.targetIds.every((id) => typeof id === "string" && quantityIds.has(id))
    ));
  return annotations.length === raw.annotations.length ? raw : { ...raw, annotations };
}

/** Collapse an exact duplicate point when only one alias participates in the scene contract. */
function normalizeCoincidentUnownedPointAliases(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  if (
    !Array.isArray(raw.entities) ||
    !Array.isArray(raw.constructions) ||
    !Array.isArray(raw.requiredEntityIds) ||
    !Array.isArray(raw.revealGroups)
  ) return raw;
  const owned = new Set<string>(raw.requiredEntityIds.filter((id): id is string => typeof id === "string"));
  for (const group of raw.revealGroups) {
    if (!isRecord(group) || !Array.isArray(group.entityIds)) continue;
    for (const id of group.entityIds) if (typeof id === "string") owned.add(id);
  }
  const pointConstructions = raw.constructions.filter((construction) =>
    isRecord(construction) && construction.operator === "point" &&
    isRecord(construction.inputs) && Array.isArray(construction.outputs) &&
    typeof construction.outputs[0] === "string" &&
    typeof construction.inputs.x === "number" && typeof construction.inputs.y === "number",
  ) as Array<Record<string, unknown>>;
  const aliases = new Map<string, string>();
  for (const candidate of pointConstructions) {
    const candidateId = (candidate.outputs as string[])[0]!;
    if (owned.has(candidateId)) continue;
    const candidateInputs = candidate.inputs as Record<string, unknown>;
    const keeper = pointConstructions.find((other) => {
      const otherId = (other.outputs as string[])[0]!;
      if (!owned.has(otherId) || otherId === candidateId) return false;
      const otherInputs = other.inputs as Record<string, unknown>;
      return otherInputs.x === candidateInputs.x && otherInputs.y === candidateInputs.y &&
        (otherInputs.coordinateSpace ?? "world") === (candidateInputs.coordinateSpace ?? "world");
    });
    if (keeper) aliases.set(candidateId, (keeper.outputs as string[])[0]!);
  }
  return aliases.size > 0 ? replaceAndRemoveEntityAliases(raw, aliases) : raw;
}

/**
 * A visible incident path and a surface-contact solver output must be the same
 * geometry. When the planner emitted both, make the solver produce the visible
 * semantic ID and use that path to determine the contact point.
 */
function promoteVisibleIncidentPaths(raw: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(raw.entities) || !Array.isArray(raw.constructions)) return raw;
  const constructions = raw.constructions.filter(isRecord);
  const declaredIds = new Set(raw.entities.flatMap((entity) =>
    isRecord(entity) && typeof entity.id === "string" ? [entity.id] : [],
  ));
  const ownedIds = new Set([
    ...(Array.isArray(raw.requiredEntityIds)
      ? raw.requiredEntityIds.filter((id): id is string => typeof id === "string")
      : []),
    ...(Array.isArray(raw.revealGroups)
      ? raw.revealGroups.flatMap((group) =>
          isRecord(group) && Array.isArray(group.entityIds)
            ? group.entityIds.filter((id): id is string => typeof id === "string")
            : [])
      : []),
  ]);
  const contacts = constructions.filter((construction) =>
    construction.operator === "surface_contact" && isRecord(construction.inputs) &&
    Array.isArray(construction.outputs) && typeof construction.outputs[1] === "string" &&
    !ownedIds.has(construction.outputs[1] as string),
  );
  if (contacts.length === 0) return raw;

  const promotions = new Map<string, {
    visibleId: string;
    producerId: string;
    through: unknown;
  }>();
  const unmatchedVisible = raw.entities.filter((entity) =>
    isRecord(entity) && typeof entity.id === "string" &&
    (entity.kind === "ray" || entity.kind === "vector") &&
    typeof entity.role === "string" && /\bincident(?:[ _-]?ray)?\b/i.test(entity.role),
  ) as Array<Record<string, unknown>>;
  for (const contact of contacts) {
    const helperId = (contact.outputs as string[])[1]!;
    if (declaredIds.has(helperId)) continue;
    const contactInputs = contact.inputs as Record<string, unknown>;
    const origin = contactInputs.origin;
    const suffixes = semanticNumericSuffixes(String(contact.id ?? ""), String((contact.outputs as string[])[0] ?? ""), helperId);
    const candidates = unmatchedVisible.flatMap((entity) => {
      const visibleId = entity.id as string;
      const producer = constructions.find((construction) =>
        (construction.operator === "ray" || construction.operator === "vector") &&
        Array.isArray(construction.outputs) && construction.outputs.includes(visibleId) &&
        isRecord(construction.inputs) && construction.inputs.start === origin,
      );
      if (!producer || !isRecord(producer.inputs) || typeof producer.id !== "string") return [];
      const visibleSuffixes = semanticNumericSuffixes(visibleId, producer.id);
      const suffixMatch = suffixes.size > 0 && [...suffixes].some((suffix) => visibleSuffixes.has(suffix));
      return [{ entity, producer, suffixMatch }];
    });
    const matched = candidates.filter((candidate) => candidate.suffixMatch);
    const choice = matched.length === 1 ? matched[0] : candidates.length === 1 ? candidates[0] : undefined;
    if (!choice || !isRecord(choice.producer.inputs)) continue;
    const end = constructionEndpoint(choice.producer.inputs, ["end", "to", "b"]);
    const direction = choice.producer.inputs.direction;
    const through = end ?? pointAlongDirection(origin, direction, constructions) ?? contactInputs.through;
    promotions.set(helperId, {
      visibleId: choice.entity.id as string,
      producerId: choice.producer.id as string,
      through,
    });
  }
  if (promotions.size === 0) return raw;

  const replaceId = (value: unknown): unknown => {
    if (typeof value === "string") return promotions.get(value)?.visibleId ?? value;
    if (Array.isArray(value)) return value.map(replaceId);
    if (!isRecord(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceId(item)]));
  };
  const removedProducerIds = new Set([...promotions.values()].map((promotion) => promotion.producerId));
  return {
    ...raw,
    constructions: raw.constructions.flatMap((construction) => {
      if (!isRecord(construction) || typeof construction.id !== "string") return [construction];
      if (removedProducerIds.has(construction.id)) return [];
      if (
        construction.operator === "surface_contact" &&
        Array.isArray(construction.outputs) &&
        typeof construction.outputs[1] === "string" &&
        promotions.has(construction.outputs[1])
      ) {
        const promotion = promotions.get(construction.outputs[1])!;
        return [{
          ...construction,
          inputs: { ...(isRecord(construction.inputs) ? construction.inputs : {}), through: promotion.through },
          outputs: [construction.outputs[0], promotion.visibleId],
        }];
      }
      return [{ ...construction, inputs: replaceId(construction.inputs) }];
    }),
    assertions: Array.isArray(raw.assertions) ? raw.assertions.map(replaceId) : raw.assertions,
    relations: Array.isArray(raw.relations) ? raw.relations.map(replaceId) : raw.relations,
    annotations: Array.isArray(raw.annotations) ? raw.annotations.map(replaceId) : raw.annotations,
    teachingTimeline: Array.isArray(raw.teachingTimeline)
      ? raw.teachingTimeline.map(replaceId)
      : raw.teachingTimeline,
  };
}

/** Make a visible incident ray the authoritative input to its matching transform. */
function promoteTransformIncidentPaths(raw: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(raw.entities) || !Array.isArray(raw.constructions)) return raw;
  const constructions = raw.constructions.filter(isRecord);
  const declaredIds = new Set(raw.entities.flatMap((entity) =>
    isRecord(entity) && typeof entity.id === "string" ? [entity.id] : [],
  ));
  const replacements = new Map<string, { visibleId: string; producerId: string }>();
  for (const transform of constructions) {
    if (
      (transform.operator !== "reflect_direction" && transform.operator !== "refract_direction") ||
      !isRecord(transform.inputs) || typeof transform.inputs.incoming !== "string" ||
      typeof transform.inputs.origin !== "string"
    ) continue;
    const helperId = transform.inputs.incoming;
    const transformOrigin = transform.inputs.origin;
    if (declaredIds.has(helperId)) continue;
    const helperProducer = constructions.find((construction) =>
      Array.isArray(construction.outputs) && construction.outputs.includes(helperId));
    if (
      !helperProducer ||
      !isRecord(helperProducer.inputs) ||
      typeof helperProducer.id !== "string" ||
      !Array.isArray(helperProducer.outputs) ||
      helperProducer.outputs.length !== 1
    ) continue;
    const suffixes = semanticNumericSuffixes(
      String(transform.id ?? ""),
      ...((Array.isArray(transform.outputs) ? transform.outputs : []).filter((id): id is string => typeof id === "string")),
      helperId,
    );
    const candidates = raw.entities.flatMap((entity) => {
      if (
        !isRecord(entity) || typeof entity.id !== "string" ||
        (entity.kind !== "ray" && entity.kind !== "vector") ||
        typeof entity.role !== "string" || !/\bincident(?:[ _-]?ray)?\b/i.test(entity.role)
      ) return [];
      const producer = constructions.find((construction) =>
        (construction.operator === "ray" || construction.operator === "vector") &&
        Array.isArray(construction.outputs) && construction.outputs.includes(entity.id) &&
        isRecord(construction.inputs));
      if (!producer || !isRecord(producer.inputs)) return [];
      const start = constructionEndpoint(producer.inputs, ["start", "from", "a", "origin"]);
      const end = constructionEndpoint(producer.inputs, ["end", "to", "b", "through"]);
      if (start !== transformOrigin && end !== transformOrigin) return [];
      const candidateSuffixes = semanticNumericSuffixes(entity.id, String(producer.id ?? ""));
      const suffixMatch = suffixes.size > 0 && [...suffixes].some((suffix) => candidateSuffixes.has(suffix));
      return [{ entityId: entity.id, suffixMatch }];
    });
    const matched = candidates.filter((candidate) => candidate.suffixMatch);
    const selected = matched.length === 1 ? matched[0] : candidates.length === 1 ? candidates[0] : undefined;
    if (selected) replacements.set(helperId, {
      visibleId: selected.entityId,
      producerId: helperProducer.id,
    });
  }
  if (replacements.size === 0) return raw;
  const replace = (value: unknown): unknown => {
    if (typeof value === "string") return replacements.get(value)?.visibleId ?? value;
    if (Array.isArray(value)) return value.map(replace);
    if (!isRecord(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
  };
  const removedProducerIds = new Set([...replacements.values()].map((value) => value.producerId));
  return {
    ...raw,
    constructions: raw.constructions.flatMap((construction) =>
      isRecord(construction) && typeof construction.id === "string" && removedProducerIds.has(construction.id)
        ? []
        : [isRecord(construction) ? { ...construction, inputs: replace(construction.inputs) } : construction]),
    entities: raw.entities.filter((entity) =>
      !isRecord(entity) || typeof entity.id !== "string" || !replacements.has(entity.id)),
    requiredEntityIds: replace(raw.requiredEntityIds),
    revealGroups: replace(raw.revealGroups),
    assertions: replace(raw.assertions),
    relations: replace(raw.relations),
    annotations: replace(raw.annotations),
    teachingTimeline: replace(raw.teachingTimeline),
  };
}

function semanticNumericSuffixes(...values: string[]): Set<string> {
  return new Set(values.flatMap((value) => value.match(/\d+/g) ?? []));
}

function pointAlongDirection(
  origin: unknown,
  direction: unknown,
  constructions: Record<string, unknown>[],
): Record<string, unknown> | null {
  const originPoint = literalPointFor(origin, constructions);
  const vector = Array.isArray(direction) && direction.length === 2 &&
    direction.every((value) => typeof value === "number" && Number.isFinite(value))
    ? { x: direction[0] as number, y: direction[1] as number }
    : isRecord(direction) && typeof direction.x === "number" && typeof direction.y === "number"
      ? { x: direction.x, y: direction.y }
      : null;
  if (!originPoint || !vector || Math.hypot(vector.x, vector.y) <= 1e-9) return null;
  return {
    x: originPoint.x + vector.x,
    y: originPoint.y + vector.y,
    coordinateSpace: originPoint.coordinateSpace,
  };
}

function literalPointFor(
  value: unknown,
  constructions: Record<string, unknown>[],
): { x: number; y: number; coordinateSpace: unknown } | null {
  if (isRecord(value) && typeof value.x === "number" && typeof value.y === "number") {
    return { x: value.x, y: value.y, coordinateSpace: value.coordinateSpace ?? "world" };
  }
  if (typeof value !== "string") return null;
  const producer = constructions.find((construction) =>
    construction.operator === "point" && Array.isArray(construction.outputs) &&
    construction.outputs.includes(value) && isRecord(construction.inputs),
  );
  if (!producer || !isRecord(producer.inputs) ||
      typeof producer.inputs.x !== "number" || typeof producer.inputs.y !== "number") return null;
  return {
    x: producer.inputs.x,
    y: producer.inputs.y,
    coordinateSpace: producer.inputs.coordinateSpace ?? "world",
  };
}

function replaceAndRemoveEntityAliases(
  raw: Record<string, unknown>,
  aliases: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const replace = (value: unknown): unknown => {
    if (typeof value === "string") return aliases.get(value) ?? value;
    if (Array.isArray(value)) return [...new Set(value.map(replace))];
    if (!isRecord(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
  };
  return {
    ...raw,
    entities: Array.isArray(raw.entities)
      ? raw.entities.filter((entity) =>
          !isRecord(entity) || typeof entity.id !== "string" || !aliases.has(entity.id))
      : raw.entities,
    constructions: Array.isArray(raw.constructions)
      ? raw.constructions.flatMap((construction) =>
          isRecord(construction) && Array.isArray(construction.outputs) &&
          construction.outputs.some((output) => typeof output === "string" && aliases.has(output))
            ? []
            : [isRecord(construction) ? { ...construction, inputs: replace(construction.inputs) } : construction])
      : raw.constructions,
    requiredEntityIds: replace(raw.requiredEntityIds),
    revealGroups: replace(raw.revealGroups),
    relations: replace(raw.relations),
    assertions: replace(raw.assertions),
    annotations: replace(raw.annotations),
    teachingTimeline: replace(raw.teachingTimeline),
  };
}

const DIMENSION_OWNER_OPERATORS = new Set([
  "segment", "connect", "symbol", "ray", "line", "vector",
]);

/**
 * A length assertion is also an annotation-ownership contract. Keeping the
 * dimension attached to unrelated points can satisfy the numeric assertion
 * while producing a visually false explanation, so bind it to the asserted
 * path before validation and layout.
 */
function normalizeAssertedDimensionBindings(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(raw.constructions) || !Array.isArray(raw.assertions)) return raw;

  const producerByOutput = new Map<string, Record<string, unknown>>();
  for (const construction of raw.constructions) {
    if (!isRecord(construction) || !Array.isArray(construction.outputs)) continue;
    for (const output of construction.outputs) {
      if (typeof output === "string") producerByOutput.set(output, construction);
    }
  }

  const bindings = new Map<string, { start: string; end: string }>();
  for (const assertion of raw.assertions) {
    if (
      !isRecord(assertion) ||
      assertion.predicate !== "equal_length" ||
      assertion.expected === false ||
      !Array.isArray(assertion.entities) ||
      assertion.entities.length !== 2 ||
      !assertion.entities.every((id) => typeof id === "string")
    ) continue;
    const [firstId, secondId] = assertion.entities as [string, string];
    const first = producerByOutput.get(firstId);
    const second = producerByOutput.get(secondId);
    const dimensionId = first?.operator === "dimension"
      ? firstId
      : second?.operator === "dimension" ? secondId : null;
    const owner = dimensionId === firstId ? second : dimensionId === secondId ? first : null;
    if (
      !dimensionId ||
      !owner ||
      typeof owner.operator !== "string" ||
      !DIMENSION_OWNER_OPERATORS.has(owner.operator) ||
      !isRecord(owner.inputs)
    ) continue;
    const start = constructionEndpoint(owner.inputs, ["start", "from", "a"]);
    const end = constructionEndpoint(owner.inputs, ["end", "to", "b"]);
    if (start && end && start !== end) bindings.set(dimensionId, { start, end });
  }
  if (bindings.size === 0) return raw;

  return {
    ...raw,
    constructions: raw.constructions.map((construction) => {
      if (!isRecord(construction) || !Array.isArray(construction.outputs)) return construction;
      const binding = construction.outputs.flatMap((output) =>
        typeof output === "string" && bindings.has(output) ? [bindings.get(output)!] : [],
      )[0];
      if (!binding || construction.operator !== "dimension") return construction;
      return {
        ...construction,
        inputs: {
          ...(isRecord(construction.inputs) ? construction.inputs : {}),
          ...binding,
        },
      };
    }),
  };
}

function normalizeRecognizedComponentOperators(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(raw.entities) || !Array.isArray(raw.constructions)) return raw;
  const entities = new Map(raw.entities.flatMap((entity) =>
    isRecord(entity) && typeof entity.id === "string"
      ? [[entity.id, entity] as const]
      : [],
  ));
  let changed = false;
  const constructions = raw.constructions.map((construction) => {
    if (
      !isRecord(construction) ||
      (construction.operator !== "connect" && construction.operator !== "segment") ||
      !isRecord(construction.inputs) ||
      !Array.isArray(construction.outputs) ||
      construction.outputs.length !== 1 ||
      typeof construction.outputs[0] !== "string"
    ) return construction;
    const entity = entities.get(construction.outputs[0]);
    if (!entity || (entity.kind !== "component" && entity.kind !== "symbol")) return construction;
    const semantic = `${construction.outputs[0]} ${String(entity.role ?? "")} ${String(entity.label ?? "")}`
      .toLowerCase()
      .replace(/[_-]+/g, " ");
    const symbol = recognizedComponentSymbol(semantic);
    const start = constructionEndpoint(construction.inputs, ["start", "from", "a"]);
    const end = constructionEndpoint(construction.inputs, ["end", "to", "b"]);
    if (!symbol || !start || !end || start === end) return construction;
    changed = true;
    return {
      ...construction,
      operator: "symbol",
      inputs: { symbol, start, end },
    };
  });
  return changed ? { ...raw, constructions } : raw;
}

function recognizedComponentSymbol(semantic: string): typeof SUPPORTED_COMPONENT_SYMBOLS[number] | undefined {
  return SUPPORTED_COMPONENT_SYMBOLS.find((candidate) => {
    const phrase = candidate.replace(/_/g, " ");
    return new RegExp(`(?:^|[^a-z])${phrase}(?:[^a-z]|$)`, "i").test(semantic);
  });
}

/**
 * Repair a port assignment, not a missing topology. A model sometimes places
 * both adjacent series connectors on one terminal of a two-terminal symbol.
 * When the ordered path identifies one unique connector toward the next
 * component, move only that local endpoint to the symbol's unused terminal.
 */
function repairAssertedSeriesTerminalIncidence(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(raw.constructions) || !Array.isArray(raw.assertions)) return raw;
  const constructions = raw.constructions.map((construction) =>
    isRecord(construction) && isRecord(construction.inputs)
      ? { ...construction, inputs: { ...construction.inputs } }
      : construction,
  );
  const symbols = new Map<string, { start: string; end: string }>();
  for (const construction of constructions) {
    if (
      !isRecord(construction) ||
      construction.operator !== "symbol" ||
      !isRecord(construction.inputs) ||
      !Array.isArray(construction.outputs) ||
      typeof construction.outputs[0] !== "string"
    ) continue;
    const start = constructionEndpoint(construction.inputs, ["start", "from", "a"]);
    const end = constructionEndpoint(construction.inputs, ["end", "to", "b"]);
    if (start && end && start !== end) symbols.set(construction.outputs[0], { start, end });
  }
  let changed = false;
  for (const assertion of raw.assertions) {
    if (
      !isRecord(assertion) ||
      assertion.predicate !== "path" ||
      assertion.expected === false ||
      !Array.isArray(assertion.entities)
    ) continue;
    const ordered = assertion.entities.filter(
      (id): id is string => typeof id === "string" && symbols.has(id),
    );
    if (ordered.length < 2) continue;
    for (let index = 0; index < ordered.length; index += 1) {
      const componentId = ordered[index]!;
      const terminals = symbols.get(componentId)!;
      const connectors = constructions.flatMap((construction, constructionIndex) => {
        if (
          !isRecord(construction) ||
          construction.operator !== "connect" ||
          !isRecord(construction.inputs)
        ) return [];
        const start = constructionEndpoint(construction.inputs, ["start", "from", "a"]);
        const end = constructionEndpoint(construction.inputs, ["end", "to", "b"]);
        if (!start || !end) return [];
        if (start === terminals.start || end === terminals.start) {
          return [{ constructionIndex, local: terminals.start, other: start === terminals.start ? end : start }];
        }
        if (start === terminals.end || end === terminals.end) {
          return [{ constructionIndex, local: terminals.end, other: start === terminals.end ? end : start }];
        }
        return [];
      });
      const startConnectors = connectors.filter((connector) => connector.local === terminals.start);
      const endConnectors = connectors.filter((connector) => connector.local === terminals.end);
      const overloaded = startConnectors.length > 1 && endConnectors.length === 0
        ? { connectors: startConnectors, from: terminals.start, to: terminals.end }
        : endConnectors.length > 1 && startConnectors.length === 0
          ? { connectors: endConnectors, from: terminals.end, to: terminals.start }
          : null;
      if (!overloaded) continue;
      const nextId = ordered[index + 1];
      const nextTerminals = nextId ? symbols.get(nextId) : undefined;
      const towardNext = nextTerminals
        ? overloaded.connectors.filter((connector) =>
            connector.other === nextTerminals.start || connector.other === nextTerminals.end)
        : [];
      if (towardNext.length !== 1) continue;
      const selected = constructions[towardNext[0]!.constructionIndex];
      if (!isRecord(selected) || !isRecord(selected.inputs)) continue;
      for (const key of ["start", "from", "a", "end", "to", "b"]) {
        if (selected.inputs[key] === overloaded.from) {
          selected.inputs[key] = overloaded.to;
          changed = true;
          break;
        }
      }
    }
  }
  return changed ? { ...raw, constructions } : raw;
}

/**
 * Close one missing return wire only when the document itself proves the
 * intent: a complete/series powered circuit, a connected component assertion,
 * and one unique nearest pair of dangling terminals. Ambiguous and explicitly
 * open circuits remain untouched and fail the normal topology proof.
 */
function repairUniquelyAssertedPoweredLoop(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  if (
    !Array.isArray(raw.entities) ||
    !Array.isArray(raw.constructions) ||
    !Array.isArray(raw.assertions) ||
    !Array.isArray(raw.requiredEntityIds) ||
    !Array.isArray(raw.revealGroups)
  ) return raw;
  const question = isRecord(raw.source) && typeof raw.source.question === "string"
    ? raw.source.question.toLowerCase()
    : "";
  if (
    /\b(?:open circuit|open switch|switch is open|disconnected circuit)\b/.test(question) ||
    !(/\b(?:series|complete|closed)\b.*\b(?:circuit|loop)\b/.test(question) ||
      /\b(?:circuit|loop)\b.*\b(?:series|complete|closed)\b/.test(question))
  ) return raw;

  const constructions = raw.constructions.filter(isRecord);
  const symbolEdges = constructions.flatMap((construction) => {
    if (
      construction.operator !== "symbol" ||
      !isRecord(construction.inputs) ||
      !Array.isArray(construction.outputs) ||
      typeof construction.outputs[0] !== "string"
    ) return [];
    const start = constructionEndpoint(construction.inputs, ["start", "from", "a"]);
    const end = constructionEndpoint(construction.inputs, ["end", "to", "b"]);
    if (!start || !end || start === end) return [];
    return [{
      id: construction.outputs[0],
      start,
      end,
      semantic: String(construction.inputs.symbol ?? ""),
    }];
  });
  const source = symbolEdges.find((edge) =>
    /\b(?:(?:ac|dc|voltage|current|power)[_ -]?source|battery|cell|supply|generator)\b/i
      .test(edge.semantic));
  if (!source) return raw;
  const assertedIds = raw.assertions.flatMap((assertion) =>
    isRecord(assertion) &&
    assertion.predicate === "connected" &&
    assertion.expected !== false &&
    Array.isArray(assertion.entities) &&
    assertion.entities.includes(source.id) &&
    assertion.entities.filter((id) =>
      typeof id === "string" && symbolEdges.some((edge) => edge.id === id)).length >= 3
      ? assertion.entities.filter((id): id is string => typeof id === "string")
      : [],
  );
  if (assertedIds.length === 0) return raw;
  const asserted = new Set(assertedIds);
  const relevantSymbols = symbolEdges.filter((edge) => asserted.has(edge.id));
  const connectorEdges = constructions.flatMap((construction) => {
    if (
      construction.operator !== "connect" ||
      !isRecord(construction.inputs)
    ) return [];
    const start = constructionEndpoint(construction.inputs, ["start", "from", "a"]);
    const end = constructionEndpoint(construction.inputs, ["end", "to", "b"]);
    return start && end && start !== end ? [{ start, end }] : [];
  });
  const terminals = new Set([
    ...relevantSymbols.flatMap((edge) => [edge.start, edge.end]),
    ...connectorEdges.flatMap((edge) => [edge.start, edge.end]),
  ]);
  const parent = new Map([...terminals].map((id) => [id, id]));
  const find = (id: string): string => {
    const owner = parent.get(id);
    if (!owner || owner === id) return id;
    const root = find(owner);
    parent.set(id, root);
    return root;
  };
  const join = (first: string, second: string): void => {
    const firstRoot = find(first);
    const secondRoot = find(second);
    if (firstRoot !== secondRoot) parent.set(secondRoot, firstRoot);
  };
  const nonSourceEdges = [
    ...relevantSymbols.filter((edge) => edge.id !== source.id),
    ...connectorEdges,
  ];
  const degree = new Map<string, number>();
  for (const edge of nonSourceEdges) {
    join(edge.start, edge.end);
    degree.set(edge.start, (degree.get(edge.start) ?? 0) + 1);
    degree.set(edge.end, (degree.get(edge.end) ?? 0) + 1);
  }
  const firstRoot = find(source.start);
  const secondRoot = find(source.end);
  if (firstRoot === secondRoot) return raw;
  const relevantRoots = new Set(relevantSymbols.flatMap((edge) =>
    edge.id === source.id ? [] : [find(edge.start), find(edge.end)]));
  if ([...relevantRoots].some((root) => root !== firstRoot && root !== secondRoot)) return raw;

  const points = new Map(constructions.flatMap((construction) =>
    construction.operator === "point" &&
    isRecord(construction.inputs) &&
    Array.isArray(construction.outputs) &&
    typeof construction.outputs[0] === "string" &&
    typeof construction.inputs.x === "number" &&
    Number.isFinite(construction.inputs.x) &&
    typeof construction.inputs.y === "number" &&
    Number.isFinite(construction.inputs.y) &&
    (construction.inputs.coordinateSpace === "layout" || construction.inputs.coordinateSpace === "world")
      ? [[construction.outputs[0], {
          x: construction.inputs.x,
          y: construction.inputs.y,
          space: construction.inputs.coordinateSpace,
        }] as const]
      : [],
  ));
  const dangling = [...terminals].filter((id) => (degree.get(id) ?? 0) <= 1 && points.has(id));
  const sourcePair = canonicalTerminalPair(source.start, source.end);
  const candidates = dangling.flatMap((first) => dangling.flatMap((second) => {
    if (
      first >= second ||
      find(first) === find(second) ||
      canonicalTerminalPair(first, second) === sourcePair
    ) return [];
    const firstPoint = points.get(first)!;
    const secondPoint = points.get(second)!;
    if (firstPoint.space !== secondPoint.space) return [];
    return [{
      first,
      second,
      distance: Math.hypot(firstPoint.x - secondPoint.x, firstPoint.y - secondPoint.y),
    }];
  })).filter((candidate) => candidate.distance > 1e-9)
    .sort((first, second) => first.distance - second.distance);
  if (
    candidates.length === 0 ||
    (candidates[1] && Math.abs(candidates[1].distance - candidates[0]!.distance) <= 1e-9)
  ) return raw;

  const ownerGroup = raw.revealGroups.find((group) => {
    if (!isRecord(group) || !Array.isArray(group.entityIds)) return false;
    const entityIds = group.entityIds;
    return relevantSymbols.every((edge) => entityIds.includes(edge.id));
  });
  if (!isRecord(ownerGroup) || !Array.isArray(ownerGroup.entityIds)) return raw;
  const occupied = new Set([
    ...raw.entities.flatMap((entity) =>
      isRecord(entity) && typeof entity.id === "string" ? [entity.id] : []),
    ...constructions.flatMap((construction) =>
      typeof construction.id === "string" ? [construction.id] : []),
  ]);
  let entityId = "asserted_loop_closure";
  let suffix = 2;
  while (occupied.has(entityId)) entityId = `asserted_loop_closure_${suffix++}`;
  const constructionId = `construct_${entityId}`;
  const winner = candidates[0]!;
  return {
    ...raw,
    entities: [
      ...raw.entities,
      { id: entityId, kind: "connector", role: "inferred return wire" },
    ],
    constructions: [
      ...raw.constructions,
      {
        id: constructionId,
        operator: "connect",
        inputs: { start: winner.first, end: winner.second },
        outputs: [entityId],
        reason: "unique asserted powered-loop closure",
      },
    ],
    requiredEntityIds: [...new Set([...raw.requiredEntityIds, entityId])],
    revealGroups: raw.revealGroups.map((group) =>
      group === ownerGroup
        ? {
            ...group,
            entityIds: [
              ...new Set([
                ...(Array.isArray(group.entityIds) ? group.entityIds : []),
                entityId,
              ]),
            ],
          }
        : group),
  };
}

/**
 * A surface_contact construction owns the finite incoming path used by a
 * reflection/refraction transform. Remove a second visible vector only when it
 * describes that exact origin/through path and has no semantic consumers.
 */
function pruneRedundantIncidentPathDeclarations(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(raw.entities) || !Array.isArray(raw.constructions)) return raw;
  const constructions = raw.constructions.filter(isRecord);
  const usedIncomingIds = new Set(constructions.flatMap((construction) =>
    (construction.operator === "reflect_direction" || construction.operator === "refract_direction") &&
    isRecord(construction.inputs) &&
    typeof construction.inputs.incoming === "string"
      ? [construction.inputs.incoming]
      : [],
  ));
  const contacts = constructions.filter((construction) =>
    construction.operator === "surface_contact" && isRecord(construction.inputs),
  );
  if (contacts.length === 0 || usedIncomingIds.size === 0) return raw;

  const replacements = new Map<string, string>();
  for (const entity of raw.entities) {
    if (
      !isRecord(entity) ||
      typeof entity.id !== "string" ||
      (entity.kind !== "vector" && entity.kind !== "ray") ||
      typeof entity.role !== "string" ||
      !/\bincident(?:[ _-]?ray)?\b/i.test(entity.role) ||
      usedIncomingIds.has(entity.id)
    ) continue;
    const producer = constructions.find((construction) =>
      (construction.operator === "vector" || construction.operator === "ray") &&
      Array.isArray(construction.outputs) &&
      construction.outputs.includes(entity.id) &&
      isRecord(construction.inputs),
    );
    if (!producer || !isRecord(producer.inputs)) continue;
    const start = producer.inputs.start;
    const end = producer.inputs.end;
    const equivalentContact = contacts.find((contact) =>
      isRecord(contact.inputs) &&
      contact.inputs.origin === start &&
      contact.inputs.through === end &&
      Array.isArray(contact.outputs) &&
      typeof contact.outputs[1] === "string" &&
      usedIncomingIds.has(contact.outputs[1]),
    );
    const replacement = equivalentContact && Array.isArray(equivalentContact.outputs)
      ? equivalentContact.outputs[1]
      : undefined;
    if (typeof replacement === "string") replacements.set(entity.id, replacement);
  }
  if (replacements.size === 0) return raw;

  const replaceId = (value: unknown): unknown => {
    if (typeof value === "string") return replacements.get(value) ?? value;
    if (Array.isArray(value)) return [...new Set(value.map(replaceId))];
    if (!isRecord(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceId(item)]));
  };

  return {
    ...raw,
    entities: raw.entities.filter((entity) =>
      !isRecord(entity) || typeof entity.id !== "string" || !replacements.has(entity.id)),
    constructions: raw.constructions.flatMap((construction) => {
      if (
        isRecord(construction) &&
        Array.isArray(construction.outputs) &&
        construction.outputs.some((output) => typeof output === "string" && replacements.has(output))
      ) return [];
      return isRecord(construction)
        ? [{ ...construction, inputs: replaceId(construction.inputs) }]
        : [construction];
    }),
    requiredEntityIds: Array.isArray(raw.requiredEntityIds)
      ? [...new Set(raw.requiredEntityIds.map(replaceId))]
      : raw.requiredEntityIds,
    revealGroups: Array.isArray(raw.revealGroups)
      ? raw.revealGroups.map((group) => isRecord(group) && Array.isArray(group.entityIds)
        ? { ...group, entityIds: [...new Set(group.entityIds.map(replaceId))] }
        : group)
      : raw.revealGroups,
    annotations: Array.isArray(raw.annotations)
      ? raw.annotations.map(replaceId)
      : raw.annotations,
    assertions: Array.isArray(raw.assertions)
      ? raw.assertions.map(replaceId)
      : raw.assertions,
    relations: Array.isArray(raw.relations)
      ? raw.relations.map(replaceId)
      : raw.relations,
    teachingTimeline: Array.isArray(raw.teachingTimeline)
      ? raw.teachingTimeline.map(replaceId)
      : raw.teachingTimeline,
  };
}

function collectEntityReferencesInto(
  value: unknown,
  entityIds: ReadonlySet<string>,
  target: Set<string>,
): void {
  if (typeof value === "string") {
    if (entityIds.has(value)) target.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectEntityReferencesInto(item, entityIds, target));
    return;
  }
  if (isRecord(value)) {
    Object.values(value).forEach((item) =>
      collectEntityReferencesInto(item, entityIds, target));
  }
}

function collectConstructionEntityReferences(
  inputs: unknown,
  entityIds: ReadonlySet<string>,
  target: Set<string>,
): void {
  if (!isRecord(inputs)) return;
  for (const [key, value] of Object.entries(inputs)) {
    if (!CONSTRUCTION_ENTITY_REFERENCE_KEYS.has(key)) continue;
    collectEntityReferencesInto(value, entityIds, target);
  }
}

function normalizeAssertionsAfterPruning(
  assertions: unknown[],
  prunable: ReadonlySet<string>,
  constructions: unknown[],
): unknown[] {
  const topologyEdgeIds = new Set(constructions.flatMap((construction) =>
    isRecord(construction) &&
    (construction.operator === "symbol" || construction.operator === "connect") &&
    Array.isArray(construction.outputs)
      ? construction.outputs.filter((output): output is string => typeof output === "string")
      : [],
  ));
  return assertions.flatMap((assertion) => {
    if (!isRecord(assertion) || !Array.isArray(assertion.entities)) return [assertion];
    let entities = assertion.entities.filter(
      (id) => typeof id !== "string" || !prunable.has(id),
    );
    if (assertion.predicate === "path") {
      entities = entities.filter((id) => typeof id !== "string" || topologyEdgeIds.has(id));
    }
    if (entities.length === assertion.entities.length) return [assertion];
    const minimum = assertion.predicate === "path" || assertion.predicate === "label_attached"
      ? 1
      : assertion.predicate === "converges"
        ? 3
        : 2;
    return entities.length >= minimum ? [{ ...assertion, entities }] : [];
  });
}

/**
 * Normalize only planner artifacts whose intended representation is
 * unambiguous. Physics, topology, and assertion failures remain untouched.
 */
function normalizeMechanicalPlannerArtifacts(raw: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(raw.constructions)) return raw;

  const declaredCoordinateSpaces = raw.constructions.flatMap((construction) => {
    if (
      !isRecord(construction) ||
      construction.operator !== "point" ||
      !isRecord(construction.inputs) ||
      (construction.inputs.coordinateSpace !== "layout" && construction.inputs.coordinateSpace !== "world")
    ) return [];
    return [construction.inputs.coordinateSpace];
  });
  const worldSpaceCount = declaredCoordinateSpaces.filter((space) => space === "world").length;
  const defaultCoordinateSpace: "layout" | "world" =
    worldSpaceCount >= declaredCoordinateSpaces.length - worldSpaceCount ? "world" : "layout";
  const inlinePointInputKeys = new Set([
    "start", "end", "from", "to", "a", "b", "origin", "target", "at",
    "point", "through", "center", "vertex",
  ]);

  const declaredEntityIds = new Set(
    (Array.isArray(raw.entities) ? raw.entities : []).flatMap((entity) =>
      isRecord(entity) && typeof entity.id === "string" ? [entity.id] : [],
    ),
  );
  const declaredEntities = new Map(
    (Array.isArray(raw.entities) ? raw.entities : []).flatMap((entity) =>
      isRecord(entity) && typeof entity.id === "string"
        ? [[entity.id, entity] as const]
        : [],
    ),
  );
  const interfaceCandidates = [...declaredEntities].flatMap(([id, entity]) => {
    const semantic = `${id} ${String(entity.role ?? "")} ${String(entity.label ?? "")}`
      .toLowerCase()
      .replace(/[_-]+/g, " ");
    return (entity.kind === "line" || entity.kind === "segment") &&
      /\b(?:boundary|interface|surface)\b/.test(semantic)
      ? [id]
      : [];
  });
  const occupiedIds = new Set<string>([
    ...declaredEntityIds,
    ...raw.constructions.flatMap((construction) =>
      isRecord(construction) && typeof construction.id === "string"
        ? [construction.id]
        : [],
    ),
  ]);
  const retainedConstructionIds = new Set<string>();
  const allocateId = (base: string): string => {
    let candidate = base;
    let suffix = 2;
    while (occupiedIds.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    occupiedIds.add(candidate);
    return candidate;
  };
  const constructions: unknown[] = [];
  for (const rawConstruction of raw.constructions) {
    if (!isRecord(rawConstruction)) {
      constructions.push(rawConstruction);
      continue;
    }

    const originalId = typeof rawConstruction.id === "string"
      ? rawConstruction.id
      : undefined;
    const outputs = typeof rawConstruction.outputs === "string"
      ? [rawConstruction.outputs]
      : Array.isArray(rawConstruction.outputs) && rawConstruction.outputs.length > 0
        ? rawConstruction.outputs
        : originalId && (
            declaredEntityIds.has(originalId) ||
            rawConstruction.operator === "normal_at"
          )
          ? [originalId]
          : [];
    // An outputless construction whose ID does not name a declared entity
    // cannot contribute deterministic geometry.
    if (outputs.length === 0) continue;

    let constructionId = originalId;
    if (
      constructionId &&
      (
        declaredEntityIds.has(constructionId) ||
        retainedConstructionIds.has(constructionId) ||
        outputs.includes(constructionId)
      )
    ) {
      constructionId = allocateId(`construct_${constructionId}`);
    }
    if (constructionId) retainedConstructionIds.add(constructionId);

    let operator = rawConstruction.operator;
    let inputs = isRecord(rawConstruction.inputs)
      ? { ...rawConstruction.inputs }
      : rawConstruction.inputs;
    if (
      operator === "label" &&
      isRecord(inputs) &&
      typeof inputs.target === "string" &&
      declaredEntities.get(inputs.target)?.kind === "group" &&
      interfaceCandidates.length === 1
    ) {
      inputs = { ...inputs, target: interfaceCandidates[0] };
    }
    if (isRecord(inputs)) {
      for (const [key, value] of Object.entries(inputs)) {
        const inlinePoint = isInlineCoordinatePoint(value)
          ? value
          : inlinePointInputKeys.has(key) &&
              Array.isArray(value) &&
              value.length >= 2 &&
              typeof value[0] === "number" &&
              Number.isFinite(value[0]) &&
              typeof value[1] === "number" &&
              Number.isFinite(value[1])
            ? {
                x: value[0],
                y: value[1],
                coordinateSpace: inputs.coordinateSpace === "layout" || inputs.coordinateSpace === "world"
                  ? inputs.coordinateSpace
                  : defaultCoordinateSpace,
              }
          : inlinePointInputKeys.has(key) &&
              isRecord(value) &&
              typeof value.x === "number" &&
              Number.isFinite(value.x) &&
              typeof value.y === "number" &&
              Number.isFinite(value.y)
            ? {
                ...value,
                coordinateSpace: inputs.coordinateSpace === "layout" || inputs.coordinateSpace === "world"
                  ? inputs.coordinateSpace
                  : defaultCoordinateSpace,
              }
            : null;
        if (!inlinePoint) continue;
        const outputStem = typeof outputs[0] === "string"
          ? outputs[0]
          : constructionId ?? "geometry";
        const anchorId = allocateId(`${outputStem}_${key}_anchor`);
        const anchorConstructionId = allocateId(`construct_${anchorId}`);
        retainedConstructionIds.add(anchorConstructionId);
        constructions.push({
          id: anchorConstructionId,
          operator: "point",
          inputs: inlinePoint,
          outputs: [anchorId],
        });
        inputs[key] = anchorId;
      }
    }
    if (
      operator === "vector" &&
      isRecord(inputs) &&
      Array.isArray(inputs.direction) &&
      inputs.direction.length >= 3 &&
      inputs.direction.slice(0, 3).every((value) =>
        typeof value === "number" && Number.isFinite(value))
    ) {
      const [x, y, z] = inputs.direction as number[];
      if (Math.hypot(x!, y!) > 1e-9) {
        inputs = { ...inputs, direction: [x, y] };
      } else if (Math.abs(z!) > 1e-9 && typeof inputs.start === "string") {
        operator = "label";
        inputs = { target: inputs.start, text: z! < 0 ? "×" : "•" };
      }
    }

    constructions.push({
      ...rawConstruction,
      ...(constructionId ? { id: constructionId } : {}),
      operator,
      inputs,
      outputs,
    });
  }

  const labelTextByOutput = new Map<string, string>();
  for (const construction of constructions) {
    if (
      !isRecord(construction) ||
      construction.operator !== "label" ||
      !isRecord(construction.inputs) ||
      typeof construction.inputs.text !== "string" ||
      !isCompactDiagramLabel(construction.inputs.text) ||
      !Array.isArray(construction.outputs) ||
      construction.outputs.length !== 1 ||
      typeof construction.outputs[0] !== "string"
    ) continue;
    labelTextByOutput.set(construction.outputs[0], construction.inputs.text);
  }
  const entities: unknown[] = Array.isArray(raw.entities)
    ? raw.entities.map((entity) => {
        if (!isRecord(entity)) return entity;
        const normalizedEntity = { ...entity };
        if (
          typeof normalizedEntity.kind === "string" &&
          (typeof normalizedEntity.role !== "string" || normalizedEntity.role.trim() === "")
        ) {
          normalizedEntity.role = normalizedEntity.kind === "point"
            ? "helper point"
            : normalizedEntity.kind.replace(/_/g, " ");
        }
        if (typeof normalizedEntity.label === "string" && normalizedEntity.label.trim() === "") {
          delete normalizedEntity.label;
        }
        if (
          normalizedEntity.kind !== "label" &&
          typeof normalizedEntity.label === "string" &&
          !isCompactDiagramLabel(normalizedEntity.label)
        ) {
          delete normalizedEntity.label;
        }
        if (
          normalizedEntity.kind === "label" &&
          typeof normalizedEntity.id === "string"
        ) {
          const label = labelTextByOutput.get(normalizedEntity.id);
          if (label) normalizedEntity.label = label;
        }
        if (
          typeof normalizedEntity.id === "string" &&
          labelTextByOutput.has(normalizedEntity.id)
        ) {
          normalizedEntity.kind = "label";
          normalizedEntity.role = "direction marker";
          normalizedEntity.label = labelTextByOutput.get(normalizedEntity.id);
        }
        return normalizedEntity;
      })
    : [];
  const annotations = Array.isArray(raw.annotations)
    ? raw.annotations.map((annotation) => {
        if (
          !isRecord(annotation) ||
          annotation.kind !== "label" ||
          typeof annotation.text !== "string" ||
          isCompactDiagramLabel(annotation.text)
        ) return annotation;
        return { ...annotation, kind: "callout" };
      })
    : raw.annotations;
  const derivedPathNormalized = normalizeDerivedPathWrappers({
    ...raw,
    entities,
    constructions,
    annotations,
  });
  const componentNormalizedConstructions = normalizeVectorComponentBases(
    derivedPathNormalized.constructions as unknown[],
    derivedPathNormalized.entities as unknown[],
  );
  const coordinateNormalizedConstructions = normalizeVectorCoordinateSpaces(
    componentNormalizedConstructions,
  );
  const normalizedAssertions = normalizeIncidentAssertionOrder(
    coordinateNormalizedConstructions,
    derivedPathNormalized.assertions,
  );
  const normalizedOpticsAssertions = normalizeSnellAssertionShape(
    coordinateNormalizedConstructions,
    normalizedAssertions,
    derivedPathNormalized.quantities,
    derivedPathNormalized.entities,
  );
  const normalizedAngleAssertions = normalizeNumericAngleAssertions(
    coordinateNormalizedConstructions,
    normalizedOpticsAssertions,
    derivedPathNormalized.quantities,
    derivedPathNormalized.entities,
  );
  const normalizedConstructions = normalizeAssertedVectorDirections(
    coordinateNormalizedConstructions,
    normalizedAngleAssertions,
  );
  const normalized = {
    ...derivedPathNormalized,
    constructions: normalizedConstructions,
    assertions: normalizedAngleAssertions,
  };
  return constrainParaxialIllustrationHeight(normalized);
}

/**
 * Replace guessed refraction geometry only when the document already contains
 * a complete, unambiguous proof contract. This is driven by predicates and
 * quantities rather than topic names, so the same repair applies to plane,
 * curved, prism, and wavefront scenes.
 */
function normalizeProofDerivedOpticsGeometry(raw: Record<string, unknown>): Record<string, unknown> {
  if (
    !Array.isArray(raw.entities) ||
    !Array.isArray(raw.constructions) ||
    !Array.isArray(raw.assertions) ||
    !Array.isArray(raw.quantities)
  ) return raw;

  const entities = raw.entities.map((entity) => isRecord(entity) ? { ...entity } : entity);
  const entityById = new Map(entities.flatMap((entity) =>
    isRecord(entity) && typeof entity.id === "string" ? [[entity.id, entity] as const] : []));
  const semantic = (id: string): string => {
    const entity = entityById.get(id);
    return `${id} ${String(entity?.role ?? "")} ${String(entity?.label ?? "")}`
      .toLowerCase()
      .replace(/[_{}-]+/g, " ")
      .replace(/\s+/g, " ");
  };
  const originalConstructions = raw.constructions.map((construction) =>
    isRecord(construction) ? { ...construction, inputs: isRecord(construction.inputs) ? { ...construction.inputs } : construction.inputs } : construction);
  let constructions = originalConstructions;
  const assertions = raw.assertions.map((assertion) => isRecord(assertion) ? { ...assertion } : assertion);
  const occupiedConstructionIds = new Set(constructions.flatMap((construction) =>
    isRecord(construction) && typeof construction.id === "string" ? [construction.id] : []));
  const allocateConstructionId = (base: string): string => {
    let id = base;
    let suffix = 2;
    while (occupiedConstructionIds.has(id)) id = `${base}_${suffix++}`;
    occupiedConstructionIds.add(id);
    return id;
  };
  let changed = false;

  for (let assertionIndex = 0; assertionIndex < assertions.length; assertionIndex += 1) {
    const assertion = assertions[assertionIndex];
    if (
      !isRecord(assertion) ||
      assertion.predicate !== "snells_law" ||
      assertion.expected === false ||
      !Array.isArray(assertion.entities)
    ) continue;

    const producers = constructionProducers(constructions);
    const assertedIds = assertion.entities.filter((id): id is string => typeof id === "string");
    const incidentId = assertedIds.find((id) =>
      /\bincident\b/.test(semantic(id)) && !/\bwavefront\b/.test(semantic(id)));
    const refractedId = assertedIds.find((id) =>
      /\brefract(?:ed|ion)?\b/.test(semantic(id)) && !/\bwavefront\b/.test(semantic(id)));
    const normalId = assertedIds.find((id) =>
      /\bnormal\b/.test(semantic(id)) && !/\bwavefront\b/.test(semantic(id)));
    if (!incidentId || !refractedId || !normalId) continue;

    const existingBundle = [incidentId, normalId, refractedId]
      .map((id) => producers.get(id))
      .find((producer) => producer?.operator === "refract_at");
    const contactSurface = proofDerivedContactAndSurface(raw, constructions, entityById);
    const indices = proofDerivedRefractiveIndices(assertion.expected, raw.quantities);
    const incidentAngleDeg = proofDerivedIncidentAngleDeg(
      assertions,
      raw.quantities,
      incidentId,
      normalId,
    );
    if (!contactSurface || !indices || incidentAngleDeg === null) continue;

    if (!existingBundle) {
      const replacedProducers = new Set(
        [incidentId, normalId, refractedId]
          .map((id) => producers.get(id))
          .filter((producer): producer is Record<string, unknown> => Boolean(producer)),
      );
      if (replacedProducers.size !== 3) continue;
      const span = proofDerivedRaySpan(
        incidentId,
        refractedId,
        contactSurface.contact,
        producers,
      );
      const tangentSign = proofDerivedTangentSign(
        incidentId,
        contactSurface.contact,
        contactSurface.surface,
        producers,
      );
      const dependencyIndexes = [contactSurface.contact, contactSurface.surface]
        .map((id) => producers.get(id))
        .map((producer) => constructions.indexOf(producer))
        .filter((index) => index >= 0);
      if (dependencyIndexes.length !== 2) continue;
      const insertionIndex = Math.max(...dependencyIndexes) + 1;
      const bundle = {
        id: allocateConstructionId(`derive_${String(assertion.id ?? "snell")}_rays`),
        operator: "refract_at",
        inputs: {
          point: contactSurface.contact,
          surface: contactSurface.surface,
          incidentAngleDeg,
          n1: indices.n1,
          n2: indices.n2,
          tangentSign,
          span,
        },
        outputs: [incidentId, normalId, refractedId],
      };
      constructions = [
        ...constructions.slice(0, insertionIndex).filter((item) => !replacedProducers.has(item as Record<string, unknown>)),
        bundle,
        ...constructions.slice(insertionIndex).filter((item) => !replacedProducers.has(item as Record<string, unknown>)),
      ];
      changed = true;
    }

    assertions[assertionIndex] = {
      ...assertion,
      entities: [incidentId, normalId, refractedId],
      expected: indices,
    };

    const wavefrontIds = new Map<string, string>();
    for (const candidate of assertions) {
      if (
        !isRecord(candidate) ||
        candidate.predicate !== "perpendicular" ||
        candidate.expected === false ||
        !Array.isArray(candidate.entities)
      ) continue;
      const ids = candidate.entities.filter((id): id is string => typeof id === "string");
      if (ids.length !== 2) continue;
      const wavefrontId = ids.find((id) => /\bwavefront\b/.test(semantic(id)));
      const rayId = ids.find((id) => id === incidentId || id === refractedId);
      if (wavefrontId && rayId) wavefrontIds.set(wavefrontId, rayId);
    }
    if (wavefrontIds.size > 0) {
      const updatedProducers = constructionProducers(constructions);
      const replacedWavefrontProducers = new Set<Record<string, unknown>>();
      const wavefrontConstructions: Record<string, unknown>[] = [];
      const raySpan = proofDerivedRaySpan(
        incidentId,
        refractedId,
        contactSurface.contact,
        updatedProducers,
      );
      for (const [wavefrontId, rayId] of wavefrontIds) {
        const producer = updatedProducers.get(wavefrontId);
        if (producer?.operator === "wavefront_family") continue;
        if (producer) replacedWavefrontProducers.add(producer);
        const entity = entityById.get(wavefrontId);
        if (entity) entity.kind = "polyline";
        wavefrontConstructions.push({
          id: allocateConstructionId(`derive_${wavefrontId}`),
          operator: "wavefront_family",
          inputs: {
            origin: contactSurface.contact,
            direction: rayId,
            shape: "plane",
            count: 1,
            spacing: 1,
            span: Math.max(1.5, raySpan * 0.8),
          },
          outputs: [wavefrontId],
        });
      }
      if (wavefrontConstructions.length > 0) {
        const bundleIndex = constructions.findIndex((construction) =>
          isRecord(construction) &&
          construction.operator === "refract_at" &&
          Array.isArray(construction.outputs) &&
          construction.outputs.includes(incidentId));
        const withoutOldWavefronts = constructions.filter((construction) =>
          !replacedWavefrontProducers.has(construction as Record<string, unknown>));
        const adjustedBundleIndex = withoutOldWavefronts.findIndex((construction) =>
          isRecord(construction) &&
          construction.operator === "refract_at" &&
          Array.isArray(construction.outputs) &&
          construction.outputs.includes(incidentId));
        const insertAfter = adjustedBundleIndex >= 0 ? adjustedBundleIndex + 1 : Math.max(0, bundleIndex + 1);
        constructions = [
          ...withoutOldWavefronts.slice(0, insertAfter),
          ...wavefrontConstructions,
          ...withoutOldWavefronts.slice(insertAfter),
        ];
        changed = true;
      }
    }

    constructions = constructions.map((construction) => {
      if (
        !isRecord(construction) ||
        construction.operator !== "angle_mark" ||
        !Array.isArray(construction.outputs) ||
        typeof construction.outputs[0] !== "string" ||
        !isRecord(construction.inputs)
      ) return construction;
      const markSemantic = semantic(construction.outputs[0]);
      const rayId = /\bincident\b/.test(markSemantic)
        ? incidentId
        : /\brefract(?:ed|ion)?\b/.test(markSemantic)
          ? refractedId
          : null;
      return rayId
        ? {
            ...construction,
            inputs: {
              ...construction.inputs,
              vertex: contactSurface.contact,
              a: normalId,
              b: rayId,
            },
          }
        : construction;
    });
  }

  return changed ? { ...raw, entities, constructions, assertions } : raw;
}

function normalizeProofDerivedOpticalTrain(raw: Record<string, unknown>): Record<string, unknown> {
  if (
    !Array.isArray(raw.entities) ||
    !Array.isArray(raw.constructions) ||
    !Array.isArray(raw.assertions) ||
    !Array.isArray(raw.quantities) ||
    !isRecord(raw.source) ||
    typeof raw.source.question !== "string" ||
    !/\bnormal adjustment\b/i.test(raw.source.question)
  ) return raw;

  const sourceConstructions = raw.constructions;
  const sourceAssertions = raw.assertions;
  const entityById = new Map(raw.entities.flatMap((entity) =>
    isRecord(entity) && typeof entity.id === "string" ? [[entity.id, entity] as const] : []));
  const semantic = (id: string): string => {
    const entity = entityById.get(id);
    return `${id} ${String(entity?.role ?? "")} ${String(entity?.label ?? "")}`
      .toLowerCase().replace(/[_-]+/g, " ").replace(/([a-z])(\d)/g, "$1 $2").replace(/\s+/g, " ");
  };
  const namedElementIds = (name: "objective" | "eyepiece"): string[] =>
    [...entityById].flatMap(([id, entity]) => {
      const label = String(entity.label ?? "").trim().toLowerCase();
      const role = String(entity.role ?? "").toLowerCase().replace(/[_-]+/g, " ");
      return label === name || new RegExp(`\\b${name} (?:lens|element)\\b`).test(role) ? [id] : [];
    });
  const objectiveIds = namedElementIds("objective");
  const eyepieceIds = namedElementIds("eyepiece");
  const axisIds = [...entityById].flatMap(([id, entity]) =>
    (entity.kind === "line" || entity.kind === "segment") &&
    /\b(?:optical |principal )?axis\b/.test(semantic(id))
      ? [id]
      : []);
  const focusIds = [...entityById].flatMap(([id, entity]) =>
    entity.kind === "point" && /\b(?:shared focus|intermediate focus|common .*foc|intermediate image)\b/.test(semantic(id))
      ? [id]
      : []);
  if (objectiveIds.length !== 1 || eyepieceIds.length !== 1 || axisIds.length !== 1 || focusIds.length !== 1) {
    return raw;
  }
  const objectiveId = objectiveIds[0]!;
  const eyepieceId = eyepieceIds[0]!;
  const axisId = axisIds[0]!;
  const focusId = focusIds[0]!;
  const rayIds = [...entityById].flatMap(([id, entity]) => entity.kind === "ray" ? [id] : []);
  const incomingIds = rayIds.filter((id) => /\b(?:incoming|incident|in ray)\b/.test(semantic(id)));
  const internalIds = rayIds.filter((id) =>
    /\b(?:mid ray|internal ray|intermediate ray|objective (?:converging )?ray|converging ray)\b/.test(semantic(id)));
  const outgoingIds = rayIds.filter((id) => /\b(?:out ray|outgoing|emergent)\b/.test(semantic(id)));
  if (incomingIds.length !== 2 || internalIds.length !== 2 || outgoingIds.length !== 2) return raw;

  const proves = (predicate: string, ids: readonly string[]): boolean =>
    sourceAssertions.some((assertion) => {
      if (
        !isRecord(assertion) ||
        assertion.predicate !== predicate ||
        assertion.expected === false ||
        !Array.isArray(assertion.entities)
      ) return false;
      const assertionEntities = assertion.entities;
      return ids.every((id) => assertionEntities.includes(id));
    });
  if (
    !proves("perpendicular", [objectiveId, axisId]) ||
    !proves("perpendicular", [eyepieceId, axisId]) ||
    !proves("parallel", incomingIds) ||
    !proves("parallel", outgoingIds) ||
    !sourceAssertions.some((assertion) =>
      isRecord(assertion) && assertion.predicate === "converges" && assertion.expected !== false)
  ) return raw;

  const producers = constructionProducers(sourceConstructions);
  if ([...incomingIds, ...internalIds, ...outgoingIds].some((id) =>
    producers.get(id)?.operator === "optical_train")) return raw;
  const rayProducers = new Set([...incomingIds, ...internalIds, ...outgoingIds]
    .map((id) => producers.get(id))
    .filter((producer): producer is Record<string, unknown> => Boolean(producer)));
  if (rayProducers.size !== 6) return raw;
  const dependencies = [objectiveId, eyepieceId, axisId, focusId]
    .map((id) => producers.get(id));
  if (dependencies.some((producer) => !producer)) return raw;
  const dependencyIndexes = dependencies.map((producer) => sourceConstructions.indexOf(producer));
  if (dependencyIndexes.some((index) => index < 0)) return raw;

  const occupiedIds = new Set(sourceConstructions.flatMap((construction) =>
    isRecord(construction) && typeof construction.id === "string" ? [construction.id] : []));
  let constructionId = "derive_optical_train";
  let suffix = 2;
  while (occupiedIds.has(constructionId)) constructionId = `derive_optical_train_${suffix++}`;
  const insertionIndex = Math.max(...dependencyIndexes) + 1;
  const trainConstruction = {
    id: constructionId,
    operator: "optical_train",
    inputs: {
      axis: axisId,
      objective: objectiveId,
      eyepiece: eyepieceId,
      focus: focusId,
    },
    outputs: [...incomingIds, ...internalIds, ...outgoingIds],
  };
  let constructions: unknown[] = [
    ...sourceConstructions.slice(0, insertionIndex).filter((item) => !rayProducers.has(item as Record<string, unknown>)),
    trainConstruction,
    ...sourceConstructions.slice(insertionIndex).filter((item) => !rayProducers.has(item as Record<string, unknown>)),
  ];

  const objectiveCenter = proofDerivedElementCenter(objectiveId, producers);
  const eyepieceCenter = proofDerivedElementCenter(eyepieceId, producers);
  const objectiveFocalLength = proofDerivedLengthInMeters(raw.quantities, /\bf\s*o\b|objective focal/i);
  const eyepieceFocalLength = proofDerivedLengthInMeters(raw.quantities, /\bf\s*e\b|eyepiece focal/i);
  if (
    objectiveCenter &&
    eyepieceCenter &&
    objectiveFocalLength !== null &&
    eyepieceFocalLength !== null &&
    objectiveFocalLength > 0 &&
    eyepieceFocalLength > 0
  ) {
    const fraction = objectiveFocalLength / (objectiveFocalLength + eyepieceFocalLength);
    constructions = constructions.map((construction) =>
      isRecord(construction) &&
      construction.operator === "point" &&
      Array.isArray(construction.outputs) &&
      construction.outputs.includes(focusId) &&
      isRecord(construction.inputs)
        ? {
            ...construction,
            inputs: {
              ...construction.inputs,
              x: objectiveCenter.x + (eyepieceCenter.x - objectiveCenter.x) * fraction,
              y: objectiveCenter.y + (eyepieceCenter.y - objectiveCenter.y) * fraction,
            },
          }
        : construction);
  }

  const assertions = sourceAssertions.map((assertion) =>
    isRecord(assertion) && assertion.predicate === "converges" && assertion.expected !== false
      ? { ...assertion, entities: [...internalIds, focusId] }
      : assertion);
  return { ...raw, constructions, assertions };
}

function proofDerivedElementCenter(
  id: string,
  producers: ReadonlyMap<string, Record<string, unknown>>,
): { x: number; y: number } | null {
  const producer = producers.get(id);
  if (!producer || !isRecord(producer.inputs)) return null;
  const throughId = constructionEndpoint(producer.inputs, ["through"]);
  if (throughId) return proofDerivedPoint(throughId, producers);
  const startId = constructionEndpoint(producer.inputs, ["start", "from", "a"]);
  const endId = constructionEndpoint(producer.inputs, ["end", "to", "b"]);
  const start = startId ? proofDerivedPoint(startId, producers) : null;
  const end = endId ? proofDerivedPoint(endId, producers) : null;
  return start && end
    ? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
    : null;
}

function proofDerivedLengthInMeters(quantities: unknown[], pattern: RegExp): number | null {
  const matches = quantities.flatMap((quantity) => {
    if (!isRecord(quantity) || typeof quantity.value !== "number" || !Number.isFinite(quantity.value)) return [];
    const semantic = `${String(quantity.id ?? "")} ${String(quantity.symbol ?? "")} ${String(quantity.label ?? "")}`
      .replace(/[_{}-]+/g, " ");
    if (!pattern.test(semantic)) return [];
    const unit = String(quantity.unit ?? "").trim().toLowerCase();
    const factor = unit === "m" || unit === "metre" || unit === "meter"
      ? 1
      : unit === "cm" ? 0.01
        : unit === "mm" ? 0.001
          : null;
    return factor === null ? [] : [quantity.value * factor];
  });
  return matches.length === 1 ? matches[0]! : null;
}

function proofDerivedContactAndSurface(
  raw: Record<string, unknown>,
  constructions: unknown[],
  entityById: ReadonlyMap<string, Record<string, unknown>>,
): { contact: string; surface: string } | null {
  if (!Array.isArray(raw.assertions)) return null;
  const producers = constructionProducers(constructions);
  const candidates = raw.assertions.flatMap((assertion) => {
    if (
      !isRecord(assertion) ||
      assertion.predicate !== "on" ||
      assertion.expected === false ||
      !Array.isArray(assertion.entities)
    ) return [];
    const ids = assertion.entities.filter((id): id is string => typeof id === "string");
    if (ids.length !== 2) return [];
    const contact = ids.find((id) => producers.get(id)?.operator === "point" || producers.get(id)?.operator === "surface_intersection");
    const surface = ids.find((id) => ["line", "segment", "circle", "arc"].includes(String(producers.get(id)?.operator ?? "")));
    if (!contact || !surface) return [];
    const contactEntity = entityById.get(contact);
    const surfaceEntity = entityById.get(surface);
    const semantic = `${contact} ${String(contactEntity?.role ?? "")} ${surface} ${String(surfaceEntity?.role ?? "")} ${String(surfaceEntity?.label ?? "")}`
      .toLowerCase().replace(/[_-]+/g, " ");
    const score = (/\b(?:incidence|contact|hit)\b/.test(semantic) ? 2 : 0) +
      (/\b(?:interface|surface|boundary)\b/.test(semantic) ? 1 : 0);
    return [{ contact, surface, score }];
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length > 1 && candidates[0]!.score === candidates[1]!.score) return null;
  return { contact: candidates[0]!.contact, surface: candidates[0]!.surface };
}

function proofDerivedRefractiveIndices(
  expected: unknown,
  quantities: unknown[],
): { n1: number; n2: number } | null {
  if (isRecord(expected) && positiveFinite(expected.n1) && positiveFinite(expected.n2)) {
    return { n1: expected.n1, n2: expected.n2 };
  }
  const n1 = proofDerivedQuantityValue(quantities, /\bn\s*1\b|refractive index.*(?:1|first)|index.*medium\s*1/i);
  const n2 = proofDerivedQuantityValue(quantities, /\bn\s*2\b|refractive index.*(?:2|second)|index.*medium\s*2/i);
  if (n1 !== null && n2 !== null && n1 > 0 && n2 > 0) return { n1, n2 };
  const v1 = proofDerivedQuantityValue(quantities, /\bv\s*1\b|speed.*(?:1|first)|velocity.*medium\s*1/i);
  const v2 = proofDerivedQuantityValue(quantities, /\bv\s*2\b|speed.*(?:2|second)|velocity.*medium\s*2/i);
  return v1 !== null && v2 !== null && v1 > 0 && v2 > 0
    ? { n1: 1, n2: v1 / v2 }
    : null;
}

function proofDerivedIncidentAngleDeg(
  assertions: unknown[],
  quantities: unknown[],
  incidentId: string,
  normalId: string,
): number | null {
  const angleAssertion = assertions.find((assertion) =>
    isRecord(assertion) &&
    assertion.predicate === "angle_between" &&
    assertion.expected !== false &&
    Array.isArray(assertion.entities) &&
    assertion.entities.includes(incidentId) &&
    assertion.entities.includes(normalId));
  const fromAssertion = isRecord(angleAssertion)
    ? proofDerivedAngleToDegrees(angleAssertion.expected)
    : null;
  const angle = fromAssertion ?? proofDerivedQuantityAngle(
    quantities,
    /\btheta\s*1\b|\bθ\s*1\b|incident(?:ce)? angle|angle of incidence/i,
  );
  return angle !== null && angle > 0 && angle < 90 ? angle : null;
}

function proofDerivedQuantityValue(quantities: unknown[], pattern: RegExp): number | null {
  const matches = quantities.flatMap((quantity) => {
    if (!isRecord(quantity) || typeof quantity.value !== "number" || !Number.isFinite(quantity.value)) return [];
    const semantic = `${String(quantity.id ?? "")} ${String(quantity.symbol ?? "")} ${String(quantity.label ?? "")}`
      .replace(/[_{}-]+/g, " ");
    return pattern.test(semantic) ? [quantity.value] : [];
  });
  return matches.length === 1 ? matches[0]! : null;
}

function proofDerivedQuantityAngle(quantities: unknown[], pattern: RegExp): number | null {
  const matches = quantities.flatMap((quantity) => {
    if (!isRecord(quantity) || typeof quantity.value !== "number" || !Number.isFinite(quantity.value)) return [];
    const semantic = `${String(quantity.id ?? "")} ${String(quantity.symbol ?? "")} ${String(quantity.label ?? "")}`
      .replace(/[_{}-]+/g, " ");
    if (!pattern.test(semantic)) return [];
    return [proofDerivedAngleToDegrees({ value: quantity.value, unit: quantity.unit })];
  }).filter((value): value is number => value !== null);
  return matches.length === 1 ? matches[0]! : null;
}

function proofDerivedAngleToDegrees(value: unknown): number | null {
  const numeric = typeof value === "number"
    ? value
    : isRecord(value) && typeof value.value === "number" ? value.value : null;
  if (numeric === null || !Number.isFinite(numeric)) return null;
  const unit = isRecord(value) ? String(value.unit ?? "").trim().toLowerCase() : "";
  return /^(?:rad|radian|radians)$/.test(unit)
    ? numeric * 180 / Math.PI
    : numeric;
}

function proofDerivedRaySpan(
  incidentId: string,
  refractedId: string,
  contactId: string,
  producers: ReadonlyMap<string, Record<string, unknown>>,
): number {
  const contact = proofDerivedPoint(contactId, producers);
  const lengths = [incidentId, refractedId].flatMap((id) => {
    const producer = producers.get(id);
    if (!producer || !isRecord(producer.inputs) || !contact) return [];
    const endpointIds = [
      constructionEndpoint(producer.inputs, ["start", "from", "a", "origin"]),
      constructionEndpoint(producer.inputs, ["end", "to", "b"]),
    ].filter((candidate): candidate is string => Boolean(candidate));
    return endpointIds.flatMap((endpointId) => {
      const endpoint = proofDerivedPoint(endpointId, producers);
      return endpoint ? [Math.hypot(endpoint.x - contact.x, endpoint.y - contact.y)] : [];
    });
  }).filter((length) => length > 1e-6 && Number.isFinite(length));
  return lengths.length > 0 ? Math.max(1, ...lengths) : 3;
}

function proofDerivedTangentSign(
  incidentId: string,
  contactId: string,
  surfaceId: string,
  producers: ReadonlyMap<string, Record<string, unknown>>,
): -1 | 1 {
  const contact = proofDerivedPoint(contactId, producers);
  const incident = producers.get(incidentId);
  const surface = producers.get(surfaceId);
  if (!contact || !incident || !surface || !isRecord(incident.inputs) || !isRecord(surface.inputs)) return 1;
  const incidentEndpointIds = [
    constructionEndpoint(incident.inputs, ["start", "from", "a", "origin"]),
    constructionEndpoint(incident.inputs, ["end", "to", "b"]),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const source = incidentEndpointIds
    .map((id) => proofDerivedPoint(id, producers))
    .find((point) => point && Math.hypot(point.x - contact.x, point.y - contact.y) > 1e-6);
  if (!source) return 1;

  let normal: { x: number; y: number } | null = null;
  if (surface.operator === "line" || surface.operator === "segment") {
    const aId = constructionEndpoint(surface.inputs, ["start", "from", "a"]);
    const bId = constructionEndpoint(surface.inputs, ["end", "to", "b"]);
    const a = aId ? proofDerivedPoint(aId, producers) : null;
    const b = bId ? proofDerivedPoint(bId, producers) : null;
    if (a && b) normal = { x: -(b.y - a.y), y: b.x - a.x };
  } else if (surface.operator === "circle" || surface.operator === "arc") {
    const centerId = constructionEndpoint(surface.inputs, ["center"]);
    const center = centerId ? proofDerivedPoint(centerId, producers) : null;
    if (center) normal = { x: center.x - contact.x, y: center.y - contact.y };
  }
  if (!normal || Math.hypot(normal.x, normal.y) < 1e-9) return 1;
  const magnitude = Math.hypot(normal.x, normal.y);
  normal = { x: normal.x / magnitude, y: normal.y / magnitude };
  const tangent = { x: -normal.y, y: normal.x };
  const sourceDirection = { x: source.x - contact.x, y: source.y - contact.y };
  return sourceDirection.x * tangent.x + sourceDirection.y * tangent.y >= 0 ? 1 : -1;
}

function proofDerivedPoint(
  id: string,
  producers: ReadonlyMap<string, Record<string, unknown>>,
): { x: number; y: number } | null {
  const producer = producers.get(id);
  if (
    producer?.operator !== "point" ||
    !isRecord(producer.inputs) ||
    typeof producer.inputs.x !== "number" ||
    !Number.isFinite(producer.inputs.x) ||
    typeof producer.inputs.y !== "number" ||
    !Number.isFinite(producer.inputs.y)
  ) return null;
  return { x: producer.inputs.x, y: producer.inputs.y };
}

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizeNumericAngleAssertions(
  constructions: unknown[],
  assertions: unknown,
  quantities: unknown,
  entities: unknown,
): unknown {
  if (!Array.isArray(assertions) || !Array.isArray(quantities) || !Array.isArray(entities)) return assertions;
  const producers = constructionProducers(constructions);
  const entityById = new Map(entities.flatMap((entity) =>
    isRecord(entity) && typeof entity.id === "string" ? [[entity.id, entity] as const] : []));
  const angleQuantities = quantities.flatMap((quantity) => {
    if (!isRecord(quantity) || typeof quantity.value !== "number" || !Number.isFinite(quantity.value)) return [];
    const unit = String(quantity.unit ?? "").trim().toLowerCase();
    const semantic = `${String(quantity.id ?? "")} ${String(quantity.symbol ?? "")} ${String(quantity.label ?? "")}`;
    return unit === "°" || /^(?:deg|degree|degrees|rad|radian|radians)$/.test(unit) || /(?:theta|angle|θ)/i.test(semantic)
      ? [{ value: quantity.value, unit: unit || "degree" }]
      : [];
  });
  const fallbackAngle = angleQuantities.length === 1 ? angleQuantities[0] : null;
  const labelAngle = (id: string): { value: number; unit: string } | null => {
    const label = String(entityById.get(id)?.label ?? "");
    const match = label.match(/(-?\d+(?:\.\d+)?)\s*(?:°|deg(?:ree)?s?)/i);
    return match ? { value: Number(match[1]), unit: "degree" } : null;
  };
  return assertions.map((assertion) => {
    if (!isRecord(assertion) || assertion.predicate !== "equal_angle" || !Array.isArray(assertion.entities)) return assertion;
    if (assertion.expected === false) return assertion;
    const ids = assertion.entities.filter((id): id is string => typeof id === "string");
    if (ids.length === 4) return assertion;
    const explicitExpected = typeof assertion.expected === "number" ||
      (isRecord(assertion.expected) && typeof assertion.expected.value === "number")
      ? assertion.expected
      : null;
    if (ids.length === 2 && explicitExpected !== null) {
      return { ...assertion, predicate: "angle_between", entities: ids, expected: explicitExpected };
    }
    const angleMarkId = ids.find((id) => producers.get(id)?.operator === "angle_mark");
    const angleMark = angleMarkId ? producers.get(angleMarkId) : undefined;
    const angleInputs = angleMark && isRecord(angleMark.inputs)
      ? [angleInputsId(angleMark.inputs.a), angleInputsId(angleMark.inputs.b)].filter((id): id is string => Boolean(id))
      : [];
    const pathIds = ids.filter((id) => producers.get(id)?.operator !== "angle_mark");
    const arms = pathIds.length === 2 ? pathIds : angleInputs.length === 2 ? angleInputs : [];
    const expected = explicitExpected ?? (angleMarkId ? labelAngle(angleMarkId) : null) ?? fallbackAngle;
    return arms.length === 2 && expected
      ? { ...assertion, predicate: "angle_between", entities: arms, expected }
      : assertion;
  });
}

function angleInputsId(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeIncidentAssertionOrder(
  constructions: unknown[],
  assertions: unknown,
): unknown {
  if (!Array.isArray(assertions)) return assertions;
  const producers = constructionProducers(constructions);
  return assertions.map((assertion) => {
    if (
      !isRecord(assertion) ||
      assertion.predicate !== "incident" ||
      !Array.isArray(assertion.entities) ||
      assertion.entities.length !== 2 ||
      typeof assertion.entities[0] !== "string" ||
      typeof assertion.entities[1] !== "string"
    ) return assertion;
    const first = producers.get(assertion.entities[0]);
    const second = producers.get(assertion.entities[1]);
    return isPathConstruction(first) && second?.operator === "point"
      ? { ...assertion, entities: [assertion.entities[1], assertion.entities[0]] }
      : assertion;
  });
}

function normalizeSnellAssertionShape(
  constructions: unknown[],
  assertions: unknown,
  quantities: unknown,
  entities: unknown,
): unknown {
  if (!Array.isArray(assertions) || !Array.isArray(quantities) || !Array.isArray(entities)) return assertions;
  const producers = constructionProducers(constructions);
  const entityById = new Map(entities.flatMap((entity) =>
    isRecord(entity) && typeof entity.id === "string" ? [[entity.id, entity] as const] : []));
  const quantityById = new Map(quantities.flatMap((quantity) =>
    isRecord(quantity) && typeof quantity.id === "string" ? [[quantity.id, quantity] as const] : []));
  const semantic = (id: string): string => {
    const entity = entityById.get(id);
    return `${id} ${String(entity?.role ?? "")} ${String(entity?.label ?? "")}`
      .toLowerCase().replace(/[_-]+/g, " ");
  };
  const quantityValue = (pattern: RegExp): number | null => {
    const match = [...quantityById].find(([id, quantity]) =>
      pattern.test(`${id} ${String(quantity.symbol ?? "")} ${String(quantity.label ?? "")}`));
    return match && typeof match[1].value === "number" && Number.isFinite(match[1].value)
      ? match[1].value
      : null;
  };

  return assertions.map((assertion) => {
    if (!isRecord(assertion) || assertion.predicate !== "snells_law" || !Array.isArray(assertion.entities)) {
      return assertion;
    }
    const ids = assertion.entities.filter((id): id is string => typeof id === "string");
    const pathIds = ids.filter((id) => isPathConstruction(producers.get(id)));
    const incident = pathIds.find((id) => /\bincident\b/.test(semantic(id)));
    const normal = pathIds.find((id) => /\bnormal\b/.test(semantic(id)));
    const refracted = pathIds.find((id) => /\brefract/.test(semantic(id)));
    const expected = isRecord(assertion.expected) ? assertion.expected : {};
    const n1 = typeof expected.n1 === "number" ? expected.n1 : quantityValue(/\bn\s*1\b|\bn1\b/i);
    const n2 = typeof expected.n2 === "number" ? expected.n2 : quantityValue(/\bn\s*2\b|\bn2\b/i);
    if (!incident || !normal || !refracted || !(n1 !== null && n1 > 0) || !(n2 !== null && n2 > 0)) {
      return assertion;
    }
    return { ...assertion, entities: [incident, normal, refracted], expected: { n1, n2 } };
  });
}

/**
 * Models sometimes treat a derived path as a direction and wrap it in another
 * ray/vector. The wrapper is provably redundant when it shares the transform
 * origin and its only direction is the transform output. Preserve the visible
 * semantic ID by assigning it directly to the deterministic transform.
 */
function normalizeDerivedPathWrappers(raw: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(raw.entities) || !Array.isArray(raw.constructions)) return raw;
  const entities = raw.entities.filter(isRecord);
  const entityById = new Map(entities.flatMap((entity) =>
    typeof entity.id === "string" ? [[entity.id, entity] as const] : [],
  ));
  const constructions = raw.constructions.map((construction) =>
    isRecord(construction) ? { ...construction } : construction,
  );
  const removedConstructionIds = new Set<string>();
  const replacements = new Map<string, string>();

  for (const transform of constructions) {
    if (
      !isRecord(transform) ||
      (transform.operator !== "reflect_direction" && transform.operator !== "refract_direction") ||
      !isRecord(transform.inputs) ||
      !Array.isArray(transform.outputs) ||
      transform.outputs.length !== 1 ||
      typeof transform.outputs[0] !== "string" ||
      typeof transform.inputs.origin !== "string"
    ) continue;
    const helperId = transform.outputs[0];
    const originId = transform.inputs.origin;
    const rolePattern = transform.operator === "reflect_direction" ? /\breflected\b/i : /\brefracted\b/i;
    const wrappers = constructions.filter((candidate) => {
      if (
        !isRecord(candidate) ||
        (candidate.operator !== "ray" && candidate.operator !== "vector") ||
        !isRecord(candidate.inputs) ||
        candidate.inputs.start !== originId ||
        candidate.inputs.direction !== helperId ||
        !Array.isArray(candidate.outputs) ||
        candidate.outputs.length !== 1 ||
        typeof candidate.outputs[0] !== "string"
      ) return false;
      const entity = entityById.get(candidate.outputs[0]);
      return Boolean(entity && typeof entity.role === "string" && rolePattern.test(entity.role));
    });
    const visibleWrapper = wrappers.find((candidate) =>
      isRecord(candidate) && candidate.operator === "ray" &&
      Array.isArray(candidate.outputs) &&
      typeof candidate.outputs[0] === "string" &&
      entityById.get(candidate.outputs[0])?.kind === "ray",
    );
    if (!isRecord(visibleWrapper) || !Array.isArray(visibleWrapper.outputs)) continue;
    const visibleId = visibleWrapper.outputs[0];
    if (typeof visibleId !== "string") continue;

    transform.outputs = [visibleId];
    replacements.set(helperId, visibleId);
    for (const wrapper of wrappers) {
      if (!isRecord(wrapper) || typeof wrapper.id !== "string" || !Array.isArray(wrapper.outputs)) continue;
      removedConstructionIds.add(wrapper.id);
      const output = wrapper.outputs[0];
      if (typeof output === "string" && output !== visibleId) replacements.set(output, visibleId);
    }
  }
  if (replacements.size === 0) return raw;

  const replaceId = (value: unknown): unknown =>
    typeof value === "string" ? replacements.get(value) ?? value : value;
  const replaceIds = (value: unknown): unknown =>
    Array.isArray(value) ? [...new Set(value.map(replaceId))] : value;
  const removedEntityIds = new Set(replacements.keys());
  for (const value of replacements.values()) removedEntityIds.delete(value);

  return {
    ...raw,
    entities: raw.entities.filter((entity) =>
      !isRecord(entity) || typeof entity.id !== "string" || !removedEntityIds.has(entity.id),
    ),
    constructions: constructions.flatMap((construction) => {
      if (!isRecord(construction) || (typeof construction.id === "string" && removedConstructionIds.has(construction.id))) {
        return [];
      }
      return [{
        ...construction,
        inputs: isRecord(construction.inputs)
          ? Object.fromEntries(Object.entries(construction.inputs).map(([key, value]) => [key, replaceId(value)]))
          : construction.inputs,
      }];
    }),
    requiredEntityIds: replaceIds(raw.requiredEntityIds),
    revealGroups: Array.isArray(raw.revealGroups)
      ? raw.revealGroups.map((group) => isRecord(group)
        ? { ...group, entityIds: replaceIds(group.entityIds) }
        : group)
      : raw.revealGroups,
    relations: Array.isArray(raw.relations)
      ? raw.relations.map((relation) => isRecord(relation)
        ? { ...relation, entities: replaceIds(relation.entities) }
        : relation)
      : raw.relations,
    assertions: Array.isArray(raw.assertions)
      ? raw.assertions.map((assertion) => isRecord(assertion)
        ? { ...assertion, entities: replaceIds(assertion.entities) }
        : assertion)
      : raw.assertions,
    annotations: Array.isArray(raw.annotations)
      ? raw.annotations.map((annotation) => isRecord(annotation)
        ? { ...annotation, targetIds: replaceIds(annotation.targetIds) }
        : annotation)
      : raw.annotations,
    teachingTimeline: Array.isArray(raw.teachingTimeline)
      ? raw.teachingTimeline.map((action) => isRecord(action)
        ? { ...action, targetId: replaceId(action.targetId) }
        : action)
      : raw.teachingTimeline,
  };
}

function normalizeVectorSumConvergenceAssertions(
  constructions: unknown[],
  assertions: unknown,
): unknown {
  if (!Array.isArray(assertions)) return assertions;
  const vectorsByOutput = new Map<string, { start: string; end: string }>();
  for (const construction of constructions) {
    if (
      !isRecord(construction) ||
      construction.operator !== "vector" ||
      !isRecord(construction.inputs) ||
      !Array.isArray(construction.outputs) ||
      typeof construction.outputs[0] !== "string"
    ) continue;
    const start = constructionEndpoint(construction.inputs, ["start", "from", "a", "origin"]);
    const end = constructionEndpoint(construction.inputs, ["end", "to", "b"]);
    if (start && end) vectorsByOutput.set(construction.outputs[0], { start, end });
  }

  return assertions.map((assertion) => {
    if (
      !isRecord(assertion) ||
      assertion.predicate !== "converges" ||
      assertion.expected === false ||
      !Array.isArray(assertion.entities) ||
      assertion.entities.length < 3 ||
      assertion.entities.some((id) => typeof id !== "string")
    ) return assertion;

    const entityIds = assertion.entities as string[];
    const commonOriginVectors = entityIds.map((id) => vectorsByOutput.get(id));
    const commonResultant = commonOriginVectors.at(-1);
    if (
      commonResultant &&
      commonOriginVectors.every((vector) => vector) &&
      commonOriginVectors.slice(0, -1).every(
        (vector) => vector!.start === commonResultant.start,
      )
    ) {
      return { ...assertion, predicate: "vector_sum" };
    }

    const target = entityIds.at(-1)!;
    const chainIds = entityIds.slice(0, -1);
    const chain = chainIds.map((id) => vectorsByOutput.get(id));
    if (
      chain.some((vector) => !vector) ||
      chain.slice(1).some((vector, index) => vector!.start !== chain[index]!.end)
    ) return assertion;

    const chainStart = chain[0]!.start;
    const resultant = [...vectorsByOutput].find(([id, vector]) =>
      !chainIds.includes(id) &&
      vector.start === chainStart &&
      vector.end === target,
    );
    if (!resultant) return assertion;
    return {
      ...assertion,
      entities: [chainIds.at(-1)!, resultant[0], target],
    };
  });
}

function materializeConnectedPointChains(raw: Record<string, unknown>): Record<string, unknown> {
  if (
    !Array.isArray(raw.entities) ||
    !Array.isArray(raw.constructions) ||
    !Array.isArray(raw.assertions) ||
    !Array.isArray(raw.requiredEntityIds) ||
    !Array.isArray(raw.revealGroups)
  ) return raw;
  const pointIds = new Set(raw.entities.flatMap((entity) =>
    isRecord(entity) && entity.kind === "point" && typeof entity.id === "string"
      ? [entity.id]
      : [],
  ));
  const occupiedIds = new Set<string>([
    ...raw.entities.flatMap((entity) =>
      isRecord(entity) && typeof entity.id === "string" ? [entity.id] : [],
    ),
    ...raw.constructions.flatMap((construction) =>
      isRecord(construction) && typeof construction.id === "string" ? [construction.id] : [],
    ),
  ]);
  const allocate = (base: string): string => {
    let id = base;
    let suffix = 2;
    while (occupiedIds.has(id)) id = `${base}_${suffix++}`;
    occupiedIds.add(id);
    return id;
  };
  const entities = [...raw.entities];
  const constructions = [...raw.constructions];
  const required = new Set(raw.requiredEntityIds.filter((id): id is string => typeof id === "string"));
  const revealGroups = raw.revealGroups.map((group) =>
    isRecord(group) && Array.isArray(group.entityIds)
      ? { ...group, entityIds: [...group.entityIds] }
      : group,
  );

  const edgeRecords = (): Array<{ id: string; start: string; end: string }> =>
    constructions.flatMap((construction) => {
      if (
        !isRecord(construction) ||
        !["segment", "connect"].includes(String(construction.operator)) ||
        !isRecord(construction.inputs) ||
        !Array.isArray(construction.outputs) ||
        typeof construction.outputs[0] !== "string" ||
        typeof construction.inputs.start !== "string" ||
        typeof construction.inputs.end !== "string"
      ) return [];
      return [{
        id: construction.outputs[0],
        start: construction.inputs.start,
        end: construction.inputs.end,
      }];
    });

  const assertions = raw.assertions.map((assertion) => {
    if (
      !isRecord(assertion) ||
      assertion.predicate !== "connected" ||
      assertion.expected === false ||
      !Array.isArray(assertion.entities) ||
      assertion.entities.length < 2 ||
      assertion.entities.length > 8 ||
      !assertion.entities.every((id) => typeof id === "string" && pointIds.has(id))
    ) return assertion;
    const chain = assertion.entities as string[];
    const parent = new Map(chain.map((id) => [id, id]));
    const find = (id: string): string => {
      const owner = parent.get(id) ?? id;
      if (owner === id) return id;
      const root = find(owner);
      parent.set(id, root);
      return root;
    };
    const join = (first: string, second: string): void => {
      const firstRoot = find(first);
      const secondRoot = find(second);
      if (firstRoot !== secondRoot) parent.set(secondRoot, firstRoot);
    };
    const chainSet = new Set(chain);
    edgeRecords().forEach((edge) => {
      if (chainSet.has(edge.start) && chainSet.has(edge.end)) join(edge.start, edge.end);
    });

    for (let index = 1; index < chain.length; index += 1) {
      const start = chain[index - 1]!;
      const end = chain[index]!;
      if (find(start) === find(end)) continue;
      const entityId = allocate(`assert_${String(assertion.id ?? "connected")}_link_${index}`);
      const constructionId = allocate(`construct_${entityId}`);
      entities.push({ id: entityId, kind: "connector", role: "asserted connection" });
      constructions.push({
        id: constructionId,
        operator: "connect",
        inputs: { start, end },
        outputs: [entityId],
      });
      required.add(entityId);
      const ownerGroup = revealGroups.find((group) =>
        isRecord(group) &&
        Array.isArray(group.entityIds) &&
        (group.entityIds.includes(start) || group.entityIds.includes(end)),
      );
      if (isRecord(ownerGroup) && Array.isArray(ownerGroup.entityIds)) {
        ownerGroup.entityIds.push(entityId);
      }
      join(start, end);
    }

    return assertion;
  });

  return {
    ...raw,
    entities,
    constructions,
    assertions,
    requiredEntityIds: [...required],
    revealGroups,
  };
}

function normalizePathOnAssertions(
  constructions: unknown[],
  assertions: unknown,
): unknown {
  if (!Array.isArray(assertions)) return assertions;
  const producers = constructionProducers(constructions);
  return assertions.map((assertion) => {
    if (
      !isRecord(assertion) ||
      assertion.predicate !== "on" ||
      assertion.expected === false ||
      !Array.isArray(assertion.entities) ||
      assertion.entities.length !== 2 ||
      typeof assertion.entities[0] !== "string" ||
      typeof assertion.entities[1] !== "string"
    ) return assertion;
    const first = producers.get(assertion.entities[0]);
    const second = producers.get(assertion.entities[1]);
    const firstOrigin = constructionOrigin(first);
    const secondOrigin = constructionOrigin(second);
    if (
      !firstOrigin ||
      firstOrigin !== secondOrigin ||
      !isPathConstruction(first) ||
      !isPathConstruction(second)
    ) return assertion;
    return { ...assertion, predicate: "parallel" };
  });
}

function normalizeAssertedVectorDirections(
  constructions: unknown[],
  assertions: unknown,
): unknown[] {
  if (!Array.isArray(assertions)) return constructions;
  const producers = constructionProducers(constructions);
  const points = new Map<string, { x: number; y: number }>();
  for (const construction of constructions) {
    if (
      !isRecord(construction) ||
      construction.operator !== "point" ||
      !isRecord(construction.inputs) ||
      !Array.isArray(construction.outputs) ||
      typeof construction.outputs[0] !== "string" ||
      typeof construction.inputs.x !== "number" ||
      !Number.isFinite(construction.inputs.x) ||
      typeof construction.inputs.y !== "number" ||
      !Number.isFinite(construction.inputs.y)
    ) continue;
    points.set(construction.outputs[0], {
      x: construction.inputs.x,
      y: construction.inputs.y,
    });
  }

  const constraints = new Map<string, { predicate: "parallel" | "perpendicular"; referenceId: string }>();
  const assertedIncidentEndpoints = new Set<string>();
  for (const assertion of assertions) {
    if (
      isRecord(assertion) &&
      assertion.predicate === "incident" &&
      assertion.expected !== false &&
      Array.isArray(assertion.entities) &&
      assertion.entities.length === 2
    ) {
      const [firstId, secondId] = assertion.entities;
      if (typeof firstId === "string" && typeof secondId === "string") {
        const first = producers.get(firstId);
        const second = producers.get(secondId);
        const vectorId = first?.operator === "vector" ? firstId
          : second?.operator === "vector" ? secondId : null;
        const pointId = points.has(firstId) ? firstId : points.has(secondId) ? secondId : null;
        const vector = vectorId ? producers.get(vectorId) : undefined;
        if (
          vectorId &&
          pointId &&
          isRecord(vector?.inputs) &&
          (vector.inputs.start === pointId || vector.inputs.end === pointId)
        ) assertedIncidentEndpoints.add(vectorId);
      }
    }
    if (
      !isRecord(assertion) ||
      (assertion.predicate !== "parallel" && assertion.predicate !== "perpendicular") ||
      assertion.expected === false ||
      !Array.isArray(assertion.entities) ||
      assertion.entities.length !== 2
    ) continue;
    const [firstId, secondId] = assertion.entities;
    if (typeof firstId !== "string" || typeof secondId !== "string") continue;
    const first = producers.get(firstId);
    const second = producers.get(secondId);
    if (first?.operator === "vector" && second?.operator === "vector") {
      constraints.set(secondId, { predicate: assertion.predicate, referenceId: firstId });
    } else if (first?.operator === "vector" && isPathConstruction(second)) {
      constraints.set(firstId, { predicate: assertion.predicate, referenceId: secondId });
    } else if (second?.operator === "vector" && isPathConstruction(first)) {
      constraints.set(secondId, { predicate: assertion.predicate, referenceId: firstId });
    }
  }
  if (constraints.size === 0 && assertedIncidentEndpoints.size === 0) return constructions;

  const directionFor = (
    entityId: string,
    visiting = new Set<string>(),
  ): { x: number; y: number } | null => {
    if (visiting.has(entityId)) return null;
    visiting.add(entityId);
    const construction = producers.get(entityId);
    if (!construction || !isRecord(construction.inputs)) return null;
    if (
      (construction.operator === "parallel_through" || construction.operator === "perpendicular_through") &&
      typeof construction.inputs.line === "string"
    ) {
      const reference = directionFor(construction.inputs.line, visiting);
      if (!reference) return null;
      return construction.operator === "perpendicular_through"
        ? { x: -reference.y, y: reference.x }
        : reference;
    }
    const explicit = construction.inputs.direction;
    if (
      Array.isArray(explicit) &&
      explicit.length >= 2 &&
      typeof explicit[0] === "number" &&
      Number.isFinite(explicit[0]) &&
      typeof explicit[1] === "number" &&
      Number.isFinite(explicit[1])
    ) return { x: explicit[0], y: explicit[1] };
    const start = typeof construction.inputs.start === "string"
      ? points.get(construction.inputs.start)
      : undefined;
    const end = typeof construction.inputs.end === "string"
      ? points.get(construction.inputs.end)
      : undefined;
    return start && end ? { x: end.x - start.x, y: end.y - start.y } : null;
  };

  return constructions.map((construction) => {
    if (
      !isRecord(construction) ||
      construction.operator !== "vector" ||
      !isRecord(construction.inputs) ||
      !Array.isArray(construction.outputs) ||
      typeof construction.outputs[0] !== "string"
    ) return construction;
    const outputId = construction.outputs[0];
    const endpointNormalized = assertedIncidentEndpoints.has(outputId) &&
      Object.prototype.hasOwnProperty.call(construction.inputs, "direction")
      ? (() => {
          const inputs = { ...construction.inputs };
          delete inputs.direction;
          return { ...construction, inputs };
        })()
      : construction;
    const constraint = constraints.get(outputId);
    if (!constraint) return endpointNormalized;
    const current = directionFor(construction.outputs[0]);
    const reference = directionFor(constraint.referenceId);
    if (!current || !reference) return endpointNormalized;
    const currentLength = Math.hypot(current.x, current.y);
    const referenceLength = Math.hypot(reference.x, reference.y);
    if (currentLength <= 1e-9 || referenceLength <= 1e-9) return endpointNormalized;
    const parallel = { x: reference.x / referenceLength, y: reference.y / referenceLength };
    const basis = constraint.predicate === "perpendicular"
      ? { x: -parallel.y, y: parallel.x }
      : parallel;
    const dot = current.x * basis.x + current.y * basis.y;
    if (Math.abs(dot) <= 1e-9) return endpointNormalized;
    const sign = dot < 0 ? -1 : 1;
    const normalizedInputs = isRecord(endpointNormalized.inputs)
      ? endpointNormalized.inputs
      : construction.inputs;
    return {
      ...endpointNormalized,
      inputs: {
        ...normalizedInputs,
        direction: [
          basis.x * currentLength * sign,
          basis.y * currentLength * sign,
        ],
      },
    };
  });
}

/**
 * Coordinate-space tags affect physical proof orientation, not the raw point
 * coordinates. Within one connected vector construction, mixed tags are a
 * planner metadata contradiction, so normalize the component to its majority
 * space (world wins ties) before evaluating vector constraints.
 */
function normalizeVectorCoordinateSpaces(constructions: unknown[]): unknown[] {
  const pointProducer = new Map<string, { index: number; construction: Record<string, unknown> }>();
  const vectorEdges: Array<readonly [string, string]> = [];
  constructions.forEach((construction, index) => {
    if (!isRecord(construction) || !isRecord(construction.inputs)) return;
    if (
      construction.operator === "point" &&
      Array.isArray(construction.outputs) &&
      typeof construction.outputs[0] === "string"
    ) {
      pointProducer.set(construction.outputs[0], { index, construction });
      return;
    }
    if (construction.operator !== "vector") return;
    const start = constructionEndpoint(construction.inputs, ["start", "from", "a", "origin"]);
    const end = constructionEndpoint(construction.inputs, ["end", "to", "b"]);
    if (start && end && start !== end) vectorEdges.push([start, end]);
  });
  if (vectorEdges.length === 0) return constructions;

  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const owner = parent.get(id) ?? id;
    if (owner === id) {
      parent.set(id, id);
      return id;
    }
    const root = find(owner);
    parent.set(id, root);
    return root;
  };
  const join = (first: string, second: string): void => {
    const firstRoot = find(first);
    const secondRoot = find(second);
    if (firstRoot !== secondRoot) parent.set(secondRoot, firstRoot);
  };
  vectorEdges.forEach(([start, end]) => join(start, end));

  const pointsByComponent = new Map<string, string[]>();
  for (const id of new Set(vectorEdges.flat())) {
    const root = find(id);
    pointsByComponent.set(root, [...(pointsByComponent.get(root) ?? []), id]);
  }
  const normalizedSpaceByPoint = new Map<string, "layout" | "world">();
  for (const pointIds of pointsByComponent.values()) {
    const spaces = pointIds.flatMap((id) => {
      const inputs = pointProducer.get(id)?.construction.inputs;
      return isRecord(inputs) && (inputs.coordinateSpace === "layout" || inputs.coordinateSpace === "world")
        ? [inputs.coordinateSpace]
        : [];
    });
    if (!spaces.includes("layout") || !spaces.includes("world")) continue;
    const worldCount = spaces.filter((space) => space === "world").length;
    const layoutCount = spaces.length - worldCount;
    const selected = worldCount >= layoutCount ? "world" : "layout";
    pointIds.forEach((id) => normalizedSpaceByPoint.set(id, selected));
  }
  if (normalizedSpaceByPoint.size === 0) return constructions;
  return constructions.map((construction) => {
    if (
      !isRecord(construction) ||
      construction.operator !== "point" ||
      !isRecord(construction.inputs) ||
      !Array.isArray(construction.outputs) ||
      typeof construction.outputs[0] !== "string"
    ) return construction;
    const coordinateSpace = normalizedSpaceByPoint.get(construction.outputs[0]);
    return coordinateSpace
      ? { ...construction, inputs: { ...construction.inputs, coordinateSpace } }
      : construction;
  });
}

function constructionProducers(constructions: unknown[]): Map<string, Record<string, unknown>> {
  const producers = new Map<string, Record<string, unknown>>();
  for (const construction of constructions) {
    if (!isRecord(construction) || !Array.isArray(construction.outputs)) continue;
    for (const output of construction.outputs) {
      if (typeof output === "string") producers.set(output, construction);
    }
  }
  return producers;
}

function constructionOrigin(construction: Record<string, unknown> | undefined): string | null {
  if (!construction || !isRecord(construction.inputs)) return null;
  for (const key of ["origin", "start", "through", "point"]) {
    const value = construction.inputs[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function isPathConstruction(
  construction: Record<string, unknown> | undefined,
): construction is Record<string, unknown> {
  return Boolean(
    construction &&
    typeof construction.operator === "string" &&
    [
      "segment", "connect", "line", "ray", "vector", "vector_components",
      "parallel_through", "perpendicular_through", "normal_at",
      "reflect_at", "refract_at",
    ].includes(construction.operator),
  );
}

function normalizeVectorComponentBases(
  constructions: unknown[],
  entities: unknown,
): unknown[] {
  if (!Array.isArray(entities)) return constructions;
  const entitiesById = new Map(entities.flatMap((entity) =>
    isRecord(entity) && typeof entity.id === "string"
      ? [[entity.id, entity] as const]
      : [],
  ));
  const surfaceCandidates = entities.flatMap((entity) => {
    if (
      !isRecord(entity) ||
      typeof entity.id !== "string" ||
      !["line", "segment", "vector"].includes(String(entity.kind))
    ) return [];
    const semantic = `${String(entity.role ?? "")} ${String(entity.label ?? "")}`
      .toLowerCase()
      .replace(/[_-]+/g, " ");
    return /\b(?:surface|plane|ramp|slope)\b/.test(semantic) &&
      !/\b(?:normal|perpendicular)\b/.test(semantic)
      ? [entity.id]
      : [];
  });
  if (surfaceCandidates.length !== 1) return constructions;
  const basis = surfaceCandidates[0]!;

  return constructions.map((construction) => {
    if (
      !isRecord(construction) ||
      construction.operator !== "vector_components" ||
      !isRecord(construction.inputs) ||
      construction.inputs.basis !== undefined ||
      construction.inputs.parallelTo !== undefined ||
      construction.inputs.reference !== undefined ||
      !Array.isArray(construction.outputs) ||
      construction.outputs.length !== 2
    ) return construction;

    const semantic = (output: unknown): string => {
      if (typeof output !== "string") return "";
      const entity = entitiesById.get(output);
      return `${output} ${String(entity?.role ?? "")} ${String(entity?.label ?? "")}`
        .toLowerCase()
        .replace(/[_-]+/g, " ");
    };
    const parallelId = construction.outputs.find((output) => /\bparallel\b/.test(semantic(output)));
    const perpendicularId = construction.outputs.find((output) => /\b(?:perp|perpendicular|normal)\b/.test(semantic(output)));
    if (
      typeof parallelId !== "string" ||
      typeof perpendicularId !== "string" ||
      parallelId === perpendicularId
    ) return construction;

    return {
      ...construction,
      inputs: { ...construction.inputs, basis },
      outputs: [parallelId, perpendicularId],
    };
  });
}

function normalizeSameSidePointSubjects(raw: Record<string, unknown>): Record<string, unknown> {
  if (
    !Array.isArray(raw.assertions) ||
    !Array.isArray(raw.entities) ||
    !Array.isArray(raw.constructions)
  ) return raw;

  const pointIds = new Set(raw.entities.flatMap((entity) =>
    isRecord(entity) && entity.kind === "point" && typeof entity.id === "string"
      ? [entity.id]
      : [],
  ));
  const constructionByOutput = new Map<string, Record<string, unknown>>();
  for (const construction of raw.constructions) {
    if (!isRecord(construction) || !Array.isArray(construction.outputs)) continue;
    for (const output of construction.outputs) {
      if (typeof output === "string") constructionByOutput.set(output, construction);
    }
    if (
      construction.operator === "point" &&
      typeof construction.outputs[0] === "string"
    ) {
      pointIds.add(construction.outputs[0]);
    }
  }

  let changed = false;
  const directionalPoint = (id: string, origin: string): string | undefined => {
    if (pointIds.has(id)) return id;
    const producer = constructionByOutput.get(id);
    if (!producer || !isRecord(producer.inputs)) return undefined;
    const start = typeof producer.inputs.start === "string" ? producer.inputs.start : undefined;
    const end = typeof producer.inputs.end === "string" ? producer.inputs.end : undefined;
    if (end && end !== origin && pointIds.has(end)) return end;
    if (start && start !== origin && pointIds.has(start)) return start;
    if (end && pointIds.has(end)) return end;
    if (start && pointIds.has(start)) return start;
    return undefined;
  };

  const assertions = raw.assertions.map((assertion) => {
    if (
      !isRecord(assertion) ||
      assertion.predicate !== "same_side" ||
      !Array.isArray(assertion.entities) ||
      assertion.entities.length !== 3 ||
      !assertion.entities.every((id) => typeof id === "string")
    ) return assertion;

    const [subject, comparison, origin] = assertion.entities as string[];
    if (!origin || !pointIds.has(origin)) return assertion;
    const normalizedSubject = directionalPoint(subject!, origin);
    const normalizedComparison = directionalPoint(comparison!, origin);
    if (!normalizedSubject || !normalizedComparison) return assertion;
    if (normalizedSubject === subject && normalizedComparison === comparison) return assertion;
    changed = true;
    return {
      ...assertion,
      entities: [normalizedSubject, normalizedComparison, origin],
    };
  });
  return changed ? { ...raw, assertions } : raw;
}

function normalizeTopologyAssertionSubjects(raw: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(raw.assertions) || !Array.isArray(raw.constructions)) return raw;
  const symbolIds = new Set<string>();
  const connectorIds = new Set<string>();
  for (const construction of raw.constructions) {
    if (
      !isRecord(construction) ||
      (construction.operator !== "symbol" && construction.operator !== "connect") ||
      !Array.isArray(construction.outputs) ||
      typeof construction.outputs[0] !== "string"
    ) continue;
    if (construction.operator === "symbol") symbolIds.add(construction.outputs[0]);
    else connectorIds.add(construction.outputs[0]);
  }
  let changed = false;
  const assertions = raw.assertions.map((assertion) => {
    if (
      !isRecord(assertion) ||
      (assertion.predicate !== "path" && assertion.predicate !== "sameTerminalPair") ||
      !Array.isArray(assertion.entities)
    ) return assertion;
    const eligibleIds = assertion.predicate === "path"
      ? new Set([...symbolIds, ...connectorIds])
      : symbolIds;
    const topologyEdges = assertion.entities.filter((id): id is string =>
      typeof id === "string" && eligibleIds.has(id),
    );
    const minimumEdges = assertion.predicate === "path" ? 1 : 2;
    if (
      topologyEdges.length < minimumEdges ||
      topologyEdges.length === assertion.entities.length
    ) return assertion;
    changed = true;
    return { ...assertion, entities: topologyEdges };
  });
  return changed ? { ...raw, assertions } : raw;
}

function normalizeNamedBetweenAssertions(raw: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(raw.assertions) || !Array.isArray(raw.entities)) return raw;
  const entities = new Map(raw.entities.flatMap((entity) =>
    isRecord(entity) && typeof entity.id === "string" ? [[entity.id, entity] as const] : [],
  ));
  let changed = false;
  const assertions = raw.assertions.map((assertion) => {
    if (
      !isRecord(assertion) ||
      assertion.predicate !== "between" ||
      typeof assertion.id !== "string" ||
      !Array.isArray(assertion.entities) ||
      assertion.entities.length !== 3 ||
      !assertion.entities.every((id) => typeof id === "string")
    ) return assertion;

    const betweenIndex = normalizeSemanticWords(assertion.id).indexOf(" between ");
    if (betweenIndex <= 0) return assertion;
    const namedSubject = normalizeSemanticWords(assertion.id).slice(0, betweenIndex).trim();
    const matches = (assertion.entities as string[]).filter((id) => {
      const entity = entities.get(id);
      const semanticWords = normalizeSemanticWords(`${id} ${String(entity?.role ?? "")}`);
      return subjectAliases(namedSubject).some((alias) => semanticWords.split(" ").includes(alias));
    });
    if (matches.length !== 1 || matches[0] === assertion.entities[0]) return assertion;
    changed = true;
    const subject = matches[0]!;
    return {
      ...assertion,
      entities: [subject, ...(assertion.entities as string[]).filter((id) => id !== subject)],
    };
  });
  return changed ? { ...raw, assertions } : raw;
}

function normalizeSemanticWords(value: string): string {
  return ` ${value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

function subjectAliases(value: string): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return [...new Set(words.flatMap((word) => {
    if (word === "obj") return ["obj", "object"];
    if (word === "img") return ["img", "image"];
    if (word === "ctr") return ["ctr", "center", "centre"];
    return [word];
  }))];
}

function constrainParaxialIllustrationHeight(raw: Record<string, unknown>): Record<string, unknown> {
  if (
    !Array.isArray(raw.entities) ||
    !Array.isArray(raw.constructions) ||
    !raw.constructions.some((construction) =>
      isRecord(construction) &&
      (construction.operator === "reflect_direction" || construction.operator === "refract_direction"),
    )
  ) {
    return raw;
  }

  const sourceQuestion = isRecord(raw.source) && typeof raw.source.question === "string"
    ? raw.source.question
    : "";
  const hasSpecifiedHeight = /\b(?:object|image)\s+height\b/i.test(sourceQuestion) ||
    (Array.isArray(raw.quantities) && raw.quantities.some((quantity) =>
      isRecord(quantity) &&
      /(?:^|_)(?:object_?height|image_?height|h_o|h_i)(?:$|_)/i.test(
        `${String(quantity.id ?? "")} ${String(quantity.symbol ?? "")}`,
      ),
    ));
  if (hasSpecifiedHeight) return raw;

  const entities = new Map(raw.entities.flatMap((entity) =>
    isRecord(entity) && typeof entity.id === "string" ? [[entity.id, entity] as const] : [],
  ));
  const pointConstructionByOutput = new Map<string, Record<string, unknown>>();
  for (const construction of raw.constructions) {
    if (
      !isRecord(construction) ||
      construction.operator !== "point" ||
      !isRecord(construction.inputs) ||
      construction.inputs.coordinateSpace !== "world" ||
      !Array.isArray(construction.outputs)
    ) continue;
    const output = construction.outputs[0];
    if (typeof output === "string") pointConstructionByOutput.set(output, construction);
  }

  const findEntityId = (pattern: RegExp): string | null => {
    for (const [id, entity] of entities) {
      const semanticName = `${id} ${String(entity.role ?? "")}`.replace(/[_-]+/g, " ");
      if (pattern.test(semanticName)) return id;
    }
    return null;
  };
  const objectBaseId = findEntityId(/\bobject (?:base|position)\b/i);
  const objectTipId = findEntityId(/\bobject tip\b/i);
  const imageBaseId = findEntityId(/\bimage (?:base|position)\b/i);
  const imageTipId = findEntityId(/\bimage tip\b/i);
  const referenceId = findEntityId(/\b(?:pole|optical center|vertex)\b/i);
  if (!objectBaseId || !objectTipId || !referenceId) return raw;

  const pointFor = (id: string | null): PointValue | null => {
    if (!id) return null;
    const construction = pointConstructionByOutput.get(id);
    if (!construction || !isRecord(construction.inputs)) return null;
    const { x, y } = construction.inputs;
    return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)
      ? { x, y }
      : null;
  };
  const objectBase = pointFor(objectBaseId);
  const objectTip = pointFor(objectTipId);
  const reference = pointFor(referenceId);
  if (!objectBase || !objectTip || !reference) return raw;

  const opticalPointIds = [
    objectBaseId,
    imageBaseId,
    ...[...entities].flatMap(([id, entity]) =>
      /\b(?:focus|focal|center of curvature|centre of curvature)\b/i.test(
        `${id} ${String(entity.role ?? "")}`.replace(/[_-]+/g, " "),
      ) ? [id] : [],
    ),
  ].filter((id): id is string => Boolean(id));
  const referenceDistances = opticalPointIds.flatMap((id) => {
    const point = pointFor(id);
    if (!point) return [];
    const distance = Math.hypot(point.x - reference.x, point.y - reference.y);
    return distance > 1e-9 ? [distance] : [];
  });
  const scaleDistance = Math.min(...referenceDistances);
  const objectHeight = Math.hypot(objectTip.x - objectBase.x, objectTip.y - objectBase.y);
  const maxHeight = scaleDistance * 0.08;
  if (!Number.isFinite(maxHeight) || maxHeight <= 0 || objectHeight <= 0) return raw;

  // Keep an unspecified construction arrow legible without letting it become
  // large enough to invalidate the paraxial illustration. Smaller planner
  // heights are preserved; oversized ones are reduced deterministically.
  const factor = objectHeight > maxHeight ? maxHeight / objectHeight : 1;
  const scalableTipIds = [objectTipId, imageTipId].filter((id): id is string => Boolean(id));
  const baseByTip = new Map<string, PointValue>([[objectTipId, objectBase]]);
  const imageBase = pointFor(imageBaseId);
  if (imageTipId && imageBase) baseByTip.set(imageTipId, imageBase);
  const magnification = Array.isArray(raw.quantities)
    ? raw.quantities.find((quantity) =>
        isRecord(quantity) &&
        typeof quantity.value === "number" &&
        Number.isFinite(quantity.value) &&
        /^(?:m|magnification|m_val)$/i.test(String(quantity.id ?? quantity.symbol ?? "")),
      )
    : undefined;
  const magnificationValue = isRecord(magnification) && typeof magnification.value === "number"
    ? magnification.value
    : null;

  if (factor === 1 && (!imageTipId || !imageBase || magnificationValue === null)) return raw;

  return {
    ...raw,
    constructions: raw.constructions.map((construction) => {
      if (!isRecord(construction) || !Array.isArray(construction.outputs)) return construction;
      const output = construction.outputs[0];
      if (typeof output !== "string" || !scalableTipIds.includes(output) || !isRecord(construction.inputs)) {
        return construction;
      }
      const base = baseByTip.get(output);
      const point = pointFor(output);
      if (output === imageTipId && imageBase && magnificationValue !== null) {
        return {
          ...construction,
          operator: "point",
          inputs: {
            x: imageBase.x + (objectTip.x - objectBase.x) * factor * magnificationValue,
            y: imageBase.y + (objectTip.y - objectBase.y) * factor * magnificationValue,
            coordinateSpace: "world",
          },
        };
      }
      if (!base || !point) return construction;
      return {
        ...construction,
        inputs: {
          ...construction.inputs,
          x: base.x + (point.x - base.x) * factor,
          y: base.y + (point.y - base.y) * factor,
        },
      };
    }),
  };
}

interface PointValue { x: number; y: number }

function constructionEndpoint(
  inputs: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = inputs[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function canonicalTerminalPair(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function assertedComponentChainTerminalPairs(
  assertions: unknown,
  componentTerminals: ReadonlyMap<string, readonly [string, string]>,
): Set<string> {
  const pairs = new Set<string>();
  if (!Array.isArray(assertions)) return pairs;
  for (const assertion of assertions) {
    if (
      !isRecord(assertion) ||
      assertion.predicate !== "path" ||
      assertion.expected !== true ||
      !Array.isArray(assertion.entities)
    ) continue;
    const edges = assertion.entities.flatMap((id) =>
      typeof id === "string" && componentTerminals.has(id)
        ? [componentTerminals.get(id)!]
        : [],
    );
    if (edges.length < 2 || edges.length !== assertion.entities.length) continue;
    const degree = new Map<string, number>();
    for (const [a, b] of edges) {
      degree.set(a, (degree.get(a) ?? 0) + 1);
      degree.set(b, (degree.get(b) ?? 0) + 1);
    }
    const endpoints = [...degree].filter(([, value]) => value === 1).map(([id]) => id);
    if (endpoints.length === 2 && [...degree.values()].every((value) => value <= 2)) {
      pairs.add(canonicalTerminalPair(endpoints[0]!, endpoints[1]!));
    }
  }
  return pairs;
}

function isExplicitConnectorSemantic(value: string): boolean {
  return /\b(short|bypass|jumper|loop|return|source|battery|supply|bridge|cross[- ]?view|coupling|link)\b/.test(value);
}

function normalizeLabelText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function collectStrings(value: unknown, visit: (value: string) => void): void {
  if (typeof value === "string") {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, visit));
    return;
  }
  if (isRecord(value)) {
    Object.values(value).forEach((item) => collectStrings(item, visit));
  }
}

function omitLabel(entity: Record<string, unknown>): Record<string, unknown> {
  const withoutLabel = { ...entity };
  delete withoutLabel.label;
  return withoutLabel;
}

function shouldStripHelperPointLabel(
  entity: Record<string, unknown>,
  document: Record<string, unknown>,
): boolean {
  if (
    entity.kind !== "point" ||
    typeof entity.id !== "string" ||
    typeof entity.label !== "string"
  ) {
    return false;
  }

  const semantic = isRecord(entity.semantic) ? entity.semantic : {};
  if (semantic.keepLabel === true || semantic.labelRequired === true) return false;

  const role = normalizeLabelText(typeof entity.role === "string" ? entity.role : "point");
  if (/\b(vertex|midpoint|focus|focal|centre|center|pole|origin|object|image|intersection|angle|incidence|normal)\b/.test(role)) {
    return false;
  }

  const question = isRecord(document.source) && typeof document.source.question === "string"
    ? document.source.question
    : "";
  const namedInQuestion = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(entity.label.trim())}([^A-Za-z0-9_]|$)`, "i")
    .test(question);
  if (namedInQuestion) return false;

  const looksGenerated = normalizeLabelText(entity.id) === normalizeLabelText(entity.label) ||
    /^[A-Z](?:\d{0,3})?$/.test(entity.label.trim());
  return looksGenerated && (
    role === "point" ||
    /\b(node|terminal|junction|endpoint|connection|branch|helper|layout|wire)\b/.test(role)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function validateSceneDocument(raw: unknown): ValidationResult {
  const issues: SceneIssue[] = [];
  if (!isRecord(raw)) {
    return result(null, [{ code: "invalid_document", message: "SceneDocument must be an object", severity: "fatal", path: "$" }]);
  }
  const normalizedRaw: Record<string, unknown> = normalizeGenericPlannerSchema({
    ...raw,
    quantities: raw.quantities ?? [],
    relations: raw.relations ?? [],
    annotations: raw.annotations ?? [],
  });
  if (normalizedRaw.visualDecision === "scene" || normalizedRaw.visualDecision === "text_only") {
    normalizedRaw.visualDecision = {
      mode: normalizedRaw.visualDecision,
      reason: "planner visual decision",
    };
  }
  if (Array.isArray(normalizedRaw.entities)) {
    normalizedRaw.entities = normalizedRaw.entities.map((entity) =>
      isRecord(entity) && typeof entity.kind === "string" && typeof entity.role !== "string"
        ? { ...entity, role: entity.kind }
        : entity,
    );
  }
  if (Array.isArray(normalizedRaw.assertions)) {
    normalizedRaw.assertions = normalizedRaw.assertions.map((assertion) => {
      if (!isRecord(assertion)) return assertion;
      const severity = assertion.severity === "info" || assertion.severity === "warning"
        ? "warning"
        : "fatal";
      return { ...assertion, severity };
    });
  }
  if (Array.isArray(normalizedRaw.annotations)) {
    normalizedRaw.annotations = normalizedRaw.annotations.map((annotation) =>
      isRecord(annotation)
        ? {
            ...annotation,
            targetIds: Array.isArray(annotation.targetIds)
              ? annotation.targetIds
              : typeof annotation.targetId === "string" ? [annotation.targetId] : [],
          }
        : annotation,
    );
  }
  const annotationTargets = new Map<string, string[]>();
  if (Array.isArray(normalizedRaw.annotations)) {
    for (const annotation of normalizedRaw.annotations) {
      if (
        isRecord(annotation) &&
        typeof annotation.id === "string" &&
        Array.isArray(annotation.targetIds)
      ) {
        annotationTargets.set(
          annotation.id,
          annotation.targetIds.filter((target): target is string => typeof target === "string"),
        );
      }
    }
  }
  if (Array.isArray(normalizedRaw.revealGroups)) {
    normalizedRaw.revealGroups = normalizedRaw.revealGroups.map((group, index) =>
      isRecord(group)
        ? {
            ...group,
            id: typeof group.id === "string"
              ? group.id
              : typeof group.label === "string" ? group.label : `group_${index + 1}`,
            entityIds: Array.isArray(group.entityIds) || Array.isArray(group.entities)
              ? [...new Set((Array.isArray(group.entityIds) ? group.entityIds : group.entities as unknown[]).flatMap((id) =>
                  typeof id === "string" && annotationTargets.has(id)
                    ? annotationTargets.get(id)!
                    : [id],
                ))]
              : [],
            dependsOn: Array.isArray(group.dependsOn) ? group.dependsOn : [],
            narrationCue: typeof group.narrationCue === "string"
              ? group.narrationCue
              : typeof group.label === "string" ? group.label : "reveal scene",
          }
        : group,
    );
  }
  if (Array.isArray(normalizedRaw.teachingTimeline)) {
    normalizedRaw.teachingTimeline = normalizedRaw.teachingTimeline.map((timelineAction, index) => {
      if (!isRecord(timelineAction)) return timelineAction;
      const action = typeof timelineAction.action === "string"
        ? timelineAction.action
        : typeof timelineAction.type === "string" ? timelineAction.type : "reveal";
      const targetId = typeof timelineAction.targetId === "string"
        ? timelineAction.targetId
        : typeof timelineAction.target === "string"
          ? timelineAction.target
          : typeof timelineAction.groupId === "string"
            ? timelineAction.groupId
            : Array.isArray(timelineAction.targetIds) && typeof timelineAction.targetIds[0] === "string"
              ? timelineAction.targetIds[0]
              : undefined;
      const narrationIntent = typeof timelineAction.narrationIntent === "string"
        ? timelineAction.narrationIntent
        // Planner models often emit `narration` instead of `narrationIntent`.
        : typeof timelineAction.narration === "string"
          ? timelineAction.narration
          : `${action} ${targetId ?? "scene"}`;
      return {
            ...timelineAction,
            action,
            targetId,
            id: typeof timelineAction.id === "string" ? timelineAction.id : `timeline_${index + 1}`,
            dependsOn: Array.isArray(timelineAction.dependsOn) ? timelineAction.dependsOn : [],
            narrationIntent,
          };
    });
  }
  if (Array.isArray(normalizedRaw.requiredEntityIds)) {
    normalizedRaw.requiredEntityIds = [...new Set(normalizedRaw.requiredEntityIds.flatMap((id) =>
      typeof id === "string" && annotationTargets.has(id)
        ? annotationTargets.get(id)!
        : [id],
    ))];
  }
  reconcileConstructionOwnership(normalizedRaw);
  if (normalizedRaw.schemaVersion !== SCENE_DOCUMENT_VERSION) {
    issues.push({ code: "schema_version", message: `Expected ${SCENE_DOCUMENT_VERSION}`, severity: "fatal", path: "schemaVersion", expected: SCENE_DOCUMENT_VERSION, actual: normalizedRaw.schemaVersion });
  }
  for (const field of ARRAY_FIELDS) {
    if (!Array.isArray(normalizedRaw[field])) issues.push({ code: "missing_array", message: `${field} must be an array`, severity: "fatal", path: field });
  }
  if (!isRecord(normalizedRaw.visualDecision) || (normalizedRaw.visualDecision.mode !== "scene" && normalizedRaw.visualDecision.mode !== "text_only")) {
    issues.push({ code: "visual_decision", message: "visualDecision.mode must be scene or text_only", severity: "fatal", path: "visualDecision.mode" });
  }
  if (issues.some((issue) => issue.severity === "fatal")) return result(null, issues);

  const document = normalizedRaw as unknown as SceneDocument;
  const idOwners = new Map<string, string>();
  const addIds = (values: unknown[], path: string) => values.forEach((value, index) => {
    if (!isRecord(value) || typeof value.id !== "string" || value.id.trim() === "") {
      issues.push({ code: "invalid_id", message: `${path}[${index}] needs a non-empty id`, severity: "fatal", path: `${path}[${index}].id` });
      return;
    }
    const owner = idOwners.get(value.id);
    if (owner) issues.push({ code: "duplicate_id", message: `Duplicate id ${value.id}`, severity: "fatal", path: `${path}[${index}].id`, actual: owner });
    else idOwners.set(value.id, path);
  });
  addIds(document.quantities, "quantities");
  addIds(document.entities, "entities");
  addIds(document.constructions, "constructions");
  addIds(document.relations, "relations");
  addIds(document.assertions, "assertions");
  addIds(document.annotations, "annotations");
  addIds(document.revealGroups, "revealGroups");
  addIds(document.teachingTimeline, "teachingTimeline");

  const entityIds = new Set(document.entities.map((entity) => entity.id));
  const constructionByOutput = new Map<string, SceneDocument["constructions"][number]>();
  for (const construction of document.constructions) {
    for (const output of construction.outputs ?? []) {
      if (typeof output === "string") constructionByOutput.set(output, construction);
    }
  }
  const solverOnlyIds = implicitSolverEntityIds(document);
  const groupIds = new Set(document.revealGroups.map((group) => group.id));
  const actionIds = new Set(document.teachingTimeline.map((action) => action.id));
  const requireEntity = (id: unknown, path: string) => {
    if (typeof id !== "string" || (!entityIds.has(id) && !solverOnlyIds.has(id))) {
      issues.push({ code: "dangling_entity", message: `Unknown entity ${String(id)}`, severity: "fatal", path, entityIds: typeof id === "string" ? [id] : undefined });
    }
  };

  document.entities.forEach((entity, index) => {
    if (!entity.kind || !entity.role) issues.push({ code: "incomplete_entity", message: "Entity requires kind and role", severity: "fatal", path: `entities[${index}]`, entityIds: [entity.id] });
    if (entity.label && !isCompactDiagramLabel(entity.label)) {
      issues.push({
        code: "verbose_diagram_label",
        message: "Diagram labels must be compact identifiers or values; put descriptive properties in narration",
        severity: "warning",
        path: `entities[${index}].label`,
        entityIds: [entity.id],
        actual: entity.label,
      });
    }
    const requiredOperator = requiredOperatorForDerivedRole(entity);
    const actualOperator = constructionByOutput.get(entity.id)?.operator;
    const expectedComponentSymbol = recognizedComponentSymbol(
      `${entity.id} ${entity.role} ${entity.label ?? ""}`.toLowerCase().replace(/[_-]+/g, " "),
    );
    const declaredAsComponent = entity.kind === "component" || entity.kind === "symbol";
    if (declaredAsComponent && expectedComponentSymbol && actualOperator && actualOperator !== "symbol") {
      issues.push({
        code: "component_requires_symbol_operator",
        message: `${entity.id} is a circuit component and must use the deterministic symbol operator`,
        severity: "fatal",
        path: `entities[${index}].kind`,
        entityIds: [entity.id],
        expected: "symbol",
        actual: actualOperator,
      });
    }
    const actualComponentSymbol = constructionByOutput.get(entity.id)?.inputs.symbol;
    if (
      declaredAsComponent &&
      expectedComponentSymbol &&
      actualOperator === "symbol" &&
      actualComponentSymbol !== expectedComponentSymbol
    ) {
      issues.push({
        code: "component_symbol_semantic_mismatch",
        message: `${entity.id} must use the ${expectedComponentSymbol} symbol`,
        severity: "fatal",
        path: `entities[${index}].role`,
        entityIds: [entity.id],
        expected: expectedComponentSymbol,
        actual: actualComponentSymbol,
      });
    }
    const derivedOperatorAccepted = requiredOperator === "reflect_direction"
      ? actualOperator === "reflect_direction" || actualOperator === "reflect_at"
      : requiredOperator === "refract_direction"
        ? actualOperator === "refract_direction" || actualOperator === "refract_at"
        : actualOperator === requiredOperator;
    if (requiredOperator && actualOperator && !derivedOperatorAccepted) {
      issues.push({
        code: "derived_role_operator_mismatch",
        message: `${entity.role} must be derived with ${requiredOperator}, not guessed with ${actualOperator}`,
        severity: "fatal",
        path: `entities[${index}].role`,
        entityIds: [entity.id],
        expected: requiredOperator,
        actual: actualOperator,
      });
    }
  });
  document.constructions.forEach((construction, index) => {
    if (!SUPPORTED_OPERATORS.has(construction.operator)) issues.push({ code: "unsupported_operator", message: `Unsupported operator ${construction.operator}`, severity: "fatal", path: `constructions[${index}].operator` });
    if (!isRecord(construction.inputs)) issues.push({ code: "invalid_inputs", message: "Construction inputs must be an object", severity: "fatal", path: `constructions[${index}].inputs` });
    if (!Array.isArray(construction.outputs) || construction.outputs.length === 0) issues.push({ code: "missing_outputs", message: "Construction must declare outputs", severity: "fatal", path: `constructions[${index}].outputs` });
    else construction.outputs.forEach((id, outputIndex) => requireEntity(id, `constructions[${index}].outputs[${outputIndex}]`));
    if (construction.operator === "label") {
      const target = construction.inputs.target ?? construction.inputs.at ?? construction.inputs.point;
      requireEntity(target, `constructions[${index}].inputs.target`);
      const text = construction.inputs.text;
      const output = construction.outputs[0];
      const entity = document.entities.find((candidate) => candidate.id === output);
      if (
        construction.outputs.length !== 1 ||
        entity?.kind !== "label" ||
        typeof text !== "string" ||
        !isCompactDiagramLabel(text) ||
        entity.label !== text
      ) {
        issues.push({
          code: "invalid_label_construction",
          message: "label requires one label output whose compact entity label matches inputs.text",
          severity: "fatal",
          path: `constructions[${index}]`,
          entityIds: typeof output === "string" ? [output] : undefined,
        });
      }
    }
    if (construction.operator === "function_curve" && isRecord(construction.inputs)) {
      validateFunctionCurveInputs(construction.inputs, index, document, issues);
      if (!Array.isArray(construction.outputs) || construction.outputs.length !== 1) {
        issues.push({
          code: "invalid_function_curve_outputs",
          message: "function_curve must produce exactly one curve entity",
          severity: "fatal",
          path: `constructions[${index}].outputs`,
          actual: Array.isArray(construction.outputs) ? construction.outputs.length : construction.outputs,
        });
      }
    }
    if (construction.operator === "function_region" && isRecord(construction.inputs)) {
      validateFunctionRegionConstruction(
        construction,
        index,
        document,
        constructionByOutput,
        issues,
      );
    }
    if (CALCULUS_OPERATORS.has(construction.operator) && isRecord(construction.inputs)) {
      validateCalculusConstruction(
        construction,
        index,
        document,
        constructionByOutput,
        issues,
      );
    }
    if (MENSURATION_OPERATORS.has(construction.operator) && isRecord(construction.inputs)) {
      validateMensurationConstruction(
        construction,
        index,
        document,
        constructionByOutput,
        issues,
      );
    }
    if (WAVE_VISUAL_OPERATORS.has(construction.operator) && isRecord(construction.inputs)) {
      validateWaveVisualConstruction(construction, index, document, constructionByOutput, issues);
    }
    if (SURFACE_RAY_OPERATORS.has(construction.operator) && isRecord(construction.inputs)) {
      validateSurfaceRayConstruction(construction, index, document, constructionByOutput, issues);
    }
    if (construction.operator === "optical_train" && isRecord(construction.inputs)) {
      validateOpticalTrainConstruction(construction, index, constructionByOutput, issues);
    }
    if (construction.operator === "polygon" && Array.isArray(construction.outputs)) {
      const output = construction.outputs[0];
      const entity = document.entities.find((candidate) => candidate.id === output);
      const role = `${String(entity?.role ?? "")} ${String(entity?.label ?? "")}`.toLowerCase();
      if (/\b(?:region|area|enclosed)\b/.test(role) && document.constructions.some((candidate) => candidate.operator === "function_curve")) {
        issues.push({
          code: "function_region_requires_deterministic_operator",
          message: "A region bounded by function curves must use function_region; a guessed polygon is not accepted",
          severity: "fatal",
          path: `constructions[${index}].operator`,
          entityIds: typeof output === "string" ? [output] : undefined,
        });
      }
    }
  });
  const directionTransforms = document.constructions.filter((construction) =>
    construction.operator === "reflect_direction" || construction.operator === "refract_direction",
  );
  if (directionTransforms.length > 0) {
    directionTransforms.forEach((construction) => {
      if (typeof construction.inputs.normal !== "string") {
        issues.push({
          code: "normal_must_be_constructed",
          message: `${construction.id} must reference constructed normal geometry instead of a guessed vector`,
          severity: "fatal",
          path: `constructions.${construction.id}.inputs.normal`,
          actual: construction.inputs.normal,
        });
      }
    });
    const usedIncomingIds = new Set(
      directionTransforms
        .map((construction) => construction.inputs.incoming)
        .filter((value): value is string => typeof value === "string"),
    );
    document.entities.forEach((entity, index) => {
      const pathLike = ["ray", "vector", "line", "segment", "polyline"].includes(entity.kind);
      if (pathLike && /\bincident[ _-]?ray\b/i.test(entity.role) && !usedIncomingIds.has(entity.id)) {
        issues.push({
          code: "incident_ray_not_used",
          message: `${entity.id} is drawn as an incident ray but is not the incoming geometry of any reflection or refraction`,
          severity: "fatal",
          path: `entities[${index}].role`,
          entityIds: [entity.id],
        });
      }
    });
  }
  document.relations.forEach((relation, index) => relation.entities.forEach((id, ref) => requireEntity(id, `relations[${index}].entities[${ref}]`)));
  document.assertions.forEach((assertion, index) => {
    assertion.entities.forEach((id, ref) => requireEntity(id, `assertions[${index}].entities[${ref}]`));
    if (assertion.predicate === "function_value") {
      if (
        assertion.entities.length !== 1 ||
        constructionByOutput.get(assertion.entities[0] ?? "")?.operator !== "function_curve" ||
        !isRecord(assertion.expected) ||
        typeof assertion.expected.x !== "number" ||
        !Number.isFinite(assertion.expected.x) ||
        typeof assertion.expected.y !== "number" ||
        !Number.isFinite(assertion.expected.y)
      ) {
        issues.push({
          code: "invalid_function_assertion",
          message: "function_value requires one curve entity and finite expected {x, y}",
          severity: "fatal",
          path: `assertions[${index}]`,
        });
      }
    }
    if (assertion.predicate === "root") {
      const expectedX = typeof assertion.expected === "number"
        ? assertion.expected
        : isRecord(assertion.expected) ? assertion.expected.x : undefined;
      if (
        assertion.entities.length !== 1 ||
        constructionByOutput.get(assertion.entities[0] ?? "")?.operator !== "function_curve" ||
        typeof expectedX !== "number" ||
        !Number.isFinite(expectedX)
      ) {
        issues.push({
          code: "invalid_function_assertion",
          message: "root requires one curve entity and a finite expected x or {x}",
          severity: "fatal",
          path: `assertions[${index}]`,
        });
      }
    }
  });
  validateOpticalInstrumentProofContract(document, issues);
  document.annotations.forEach((annotation, index) => {
    annotation.targetIds.forEach((id, ref) => requireEntity(id, `annotations[${index}].targetIds[${ref}]`));
    if (annotation.kind === "label" && annotation.text && !isCompactDiagramLabel(annotation.text)) {
      issues.push({
        code: "verbose_diagram_label",
        message: "Diagram labels must be compact identifiers or values; use a callout or narration for prose",
        severity: "warning",
        path: `annotations[${index}].text`,
        entityIds: annotation.targetIds,
        actual: annotation.text,
      });
    }
  });
  document.requiredEntityIds.forEach((id, index) => requireEntity(id, `requiredEntityIds[${index}]`));

  const grouped = new Set<string>();
  document.revealGroups.forEach((group, index) => {
    group.entityIds.forEach((id, ref) => { requireEntity(id, `revealGroups[${index}].entityIds[${ref}]`); grouped.add(id); });
    group.dependsOn.forEach((id, ref) => {
      if (!groupIds.has(id)) issues.push({ code: "dangling_group_dependency", message: `Unknown reveal group ${id}`, severity: "fatal", path: `revealGroups[${index}].dependsOn[${ref}]` });
    });
  });
  document.requiredEntityIds.forEach((id) => {
    if (!grouped.has(id)) issues.push({ code: "unrevealed_required_entity", message: `Required entity ${id} is not in a reveal group`, severity: "fatal", entityIds: [id] });
  });
  const required = new Set(document.requiredEntityIds);
  document.entities.forEach((entity, index) => {
    if (solverOnlyIds.has(entity.id) || entity.kind === "group") return;
    if (!required.has(entity.id)) {
      issues.push({
        code: "unrequired_entity",
        message: `Entity ${entity.id} is not declared in requiredEntityIds`,
        severity: "fatal",
        path: `entities[${index}]`,
        entityIds: [entity.id],
      });
    }
    if (!grouped.has(entity.id)) {
      issues.push({
        code: "ungrouped_entity",
        message: `Entity ${entity.id} is not assigned to a reveal group`,
        severity: "fatal",
        path: `entities[${index}]`,
        entityIds: [entity.id],
      });
    }
  });
  document.teachingTimeline.forEach((action, index) => {
    const validTarget = groupIds.has(action.targetId) || entityIds.has(action.targetId) || document.annotations.some((annotation) => annotation.id === action.targetId);
    if (!validTarget) issues.push({ code: "dangling_timeline_target", message: `Unknown timeline target ${action.targetId}`, severity: "fatal", path: `teachingTimeline[${index}].targetId` });
    action.dependsOn.forEach((id, ref) => {
      if (!actionIds.has(id)) issues.push({ code: "dangling_action_dependency", message: `Unknown teaching action ${id}`, severity: "fatal", path: `teachingTimeline[${index}].dependsOn[${ref}]` });
    });
  });
  checkAcyclic(document.revealGroups.map((item) => ({ id: item.id, deps: item.dependsOn })), "revealGroups", issues);
  checkAcyclic(document.teachingTimeline.map((item) => ({ id: item.id, deps: item.dependsOn })), "teachingTimeline", issues);

  if (document.visualDecision.mode === "text_only") {
    const structuralCount = document.entities.length + document.constructions.length + document.revealGroups.length;
    if (structuralCount !== 0) issues.push({ code: "text_only_has_scene", message: "text_only documents must not contain scene geometry", severity: "fatal", actual: structuralCount });
  } else if (document.requiredEntityIds.length === 0) {
    issues.push({ code: "empty_required_scene", message: "A scene must declare requiredEntityIds", severity: "fatal", path: "requiredEntityIds" });
  }

  return result(issues.some((issue) => issue.severity === "fatal") ? null : document, issues, document);
}

/**
 * Normalize unambiguous JSON-shape drift at the model boundary. This keeps the
 * scene contract semantic: aliases are repaired, while geometry and proofs
 * remain subject to the normal deterministic validator/compiler.
 */
function normalizeGenericPlannerSchema(raw: Record<string, unknown>): Record<string, unknown> {
  const entities: unknown[] = Array.isArray(raw.entities)
    ? raw.entities.map((entity) => {
        if (!isRecord(entity)) return entity;
        const kind = entity.kind === "curve" || entity.kind === "graph"
          ? "polyline"
          : entity.kind === "symbol" ? "component"
          : entity.kind;
        const role = typeof entity.role === "string" && entity.role.trim()
          ? entity.role
          : kind === "polyline" && (entity.kind === "curve" || entity.kind === "graph")
            ? "function graph"
            : typeof kind === "string" ? kind.replace(/_/g, " ") : "helper";
        return { ...entity, kind, role };
      })
    : [];
  const entityIds = new Set(entities.flatMap((entity) =>
    isRecord(entity) && typeof entity.id === "string" ? [entity.id] : [],
  ));
  const constructions: unknown[] = Array.isArray(raw.constructions)
    ? raw.constructions.map((construction) => {
        if (!isRecord(construction)) return construction;
        const outputs = typeof construction.outputs === "string"
          ? [construction.outputs]
          : Array.isArray(construction.outputs) ? construction.outputs : [];
        return {
          ...construction,
          outputs,
          id: typeof construction.id === "string"
            ? construction.id
            : typeof outputs[0] === "string" ? `construct_${outputs[0]}` : construction.id,
        };
      })
    : [];
  if (Array.isArray(entities) && Array.isArray(constructions)) {
    for (const construction of constructions) {
      if (!isRecord(construction) || !Array.isArray(construction.outputs)) continue;
      for (const output of construction.outputs) {
        if (typeof output !== "string" || entityIds.has(output)) continue;
        const operator = String(construction.operator ?? "");
        const kind = operator === "function_curve" || operator === "parametric_curve" || operator === "polar_curve" || operator === "implicit_curve" ? "polyline"
          : operator === "axes" ? "axes"
            : operator === "label" ? "label"
              : operator === "polygon" ? "polygon"
                : operator === "polyline" ? "polyline"
                  : operator === "circle" ? "circle"
                    : operator === "arc" ? "arc"
                      : operator === "point" ? "point"
                            : operator === "vector" ? "vector"
                            : operator === "dimension" ? "dimension"
                              : operator === "function_region" || operator === "solid_of_revolution" ? "polygon"
                                : operator === "solid_projection" || operator === "solid_cross_section" ? "polyline"
                                  : operator === "tangent_line" || operator === "normal_line" || operator === "representative_slice" ? "segment"
                            : "segment";
        entities.push({
          id: output,
          kind,
          role: operator === "point" ? "construction helper" : `${operator.replace(/_/g, " ")} geometry`,
          [INFERRED_CONSTRUCTION_ENTITY]: true,
        });
        entityIds.add(output);
      }
    }
  }
  return {
    ...raw,
    entities,
    constructions,
  };
}

export function implicitSolverEntityIds(document: SceneDocument): Set<string> {
  const required = new Set(document.requiredEntityIds);
  const grouped = new Set(document.revealGroups.flatMap((group) => group.entityIds));
  const referenced = new Set<string>();
  for (const construction of document.constructions) {
    collectStrings(construction.inputs, (value) => referenced.add(value));
  }
  for (const assertion of document.assertions) {
    assertion.entities.forEach((id) => referenced.add(id));
  }
  for (const relation of document.relations) {
    relation.entities.forEach((id) => referenced.add(id));
  }

  return new Set(document.constructions.flatMap((construction) => {
    if (construction.operator === "normal_at") return construction.outputs;
    if (construction.operator === "reflect_at" || construction.operator === "refract_at") {
      const normalId = construction.outputs[1];
      return normalId && !required.has(normalId) ? [normalId] : [];
    }
    if (construction.operator === "surface_contact") {
      const hitPointId = construction.outputs[0];
      return hitPointId && !required.has(hitPointId) ? [hitPointId] : [];
    }
    if (construction.operator === "point") {
      const output = construction.outputs[0];
      return output && isImplicitConstructionPoint(output, document) ? [output] : [];
    }
    if (
      !["line", "parallel_through", "perpendicular_through"].includes(construction.operator)
    ) return [];
    return construction.outputs.filter((output) => {
      if (required.has(output) || grouped.has(output) || !referenced.has(output)) return false;
      const entity = document.entities.find((candidate) => candidate.id === output);
      if (entity?.label) return false;
      if (document.annotations.some((annotation) => annotation.targetIds.includes(output))) return false;
      return true;
    });
  }));
}

/**
 * Construction outputs are semantic declarations. Recover visible incident
 * paths and reconcile explicit reveal ownership before strict validation, so
 * planner bookkeeping omissions do not hide otherwise verifiable geometry.
 */
function reconcileConstructionOwnership(raw: Record<string, unknown>): void {
  if (
    !Array.isArray(raw.entities) ||
    !Array.isArray(raw.constructions) ||
    !Array.isArray(raw.requiredEntityIds) ||
    !Array.isArray(raw.revealGroups)
  ) return;

  const entities = raw.entities;
  const entityIds = new Set(entities.flatMap((entity) =>
    isRecord(entity) && typeof entity.id === "string" ? [entity.id] : [],
  ));
  const entityById = new Map(entities.flatMap((entity) =>
    isRecord(entity) && typeof entity.id === "string"
      ? [[entity.id, entity] as const]
      : [],
  ));
  const required = new Set(raw.requiredEntityIds.filter((id): id is string => typeof id === "string"));
  for (const id of required) {
    if (entityById.get(id)?.kind === "group") required.delete(id);
  }
  const groups = raw.revealGroups.filter(isRecord);

  const assignOwnerGroup = (entityId: string, construction?: Record<string, unknown>): void => {
    if (groups.some((group) => Array.isArray(group.entityIds) && group.entityIds.includes(entityId))) return;
    const referencedInputs = new Set<string>();
    if (construction && isRecord(construction.inputs)) {
      collectStrings(construction.inputs, (value) => referencedInputs.add(value));
    }
    const candidates = groups.filter((group) =>
      Array.isArray(group.entityIds) && group.entityIds.some((id) =>
        typeof id === "string" && referencedInputs.has(id)),
    );
    const owner = candidates.length === 1
      ? candidates[0]
      : groups.length === 1 ? groups[0] : undefined;
    if (owner && Array.isArray(owner.entityIds)) owner.entityIds.push(entityId);
  };

  for (const group of groups) {
    if (!Array.isArray(group.entityIds)) continue;
    for (const id of group.entityIds) {
      if (
        typeof id === "string" &&
        entityIds.has(id) &&
        entityById.get(id)?.kind !== "group"
      ) required.add(id);
    }
  }


  const producerByOutput = new Map<string, Record<string, unknown>>();
  for (const construction of raw.constructions) {
    if (!isRecord(construction) || !Array.isArray(construction.outputs)) continue;
    for (const output of construction.outputs) {
      if (typeof output === "string") producerByOutput.set(output, construction);
    }
    const kind = typeof construction.operator === "string"
      ? VISIBLE_ENTITY_KIND_BY_OPERATOR[construction.operator]
      : undefined;
    if (!kind) continue;
    for (const output of construction.outputs) {
      if (typeof output !== "string") continue;
      const declared = entityIds.has(output);
      if (!declared) {
        entities.push({ id: output, kind, role: kind === "connector" ? "connection" : kind });
        entityIds.add(output);
        entityById.set(output, entities.at(-1) as Record<string, unknown>);
      }
      const entity = entityById.get(output);
      if (entity?.[INFERRED_CONSTRUCTION_ENTITY] === true || !declared) {
        required.add(output);
        assignOwnerGroup(output, construction);
      }
    }
  }
  for (const id of required) assignOwnerGroup(id, producerByOutput.get(id));

  for (const construction of raw.constructions) {
    if (
      !isRecord(construction) ||
      construction.operator !== "surface_contact" ||
      !Array.isArray(construction.outputs)
    ) continue;
    const incidentId = construction.outputs[1];
    if (typeof incidentId !== "string") continue;
    if (!entityIds.has(incidentId)) {
      entities.push({ id: incidentId, kind: "vector", role: "incident ray" });
      entityIds.add(incidentId);
    }
    required.add(incidentId);

    const consumer = raw.constructions.find((candidate) =>
      isRecord(candidate) &&
      (candidate.operator === "reflect_direction" || candidate.operator === "refract_direction") &&
      isRecord(candidate.inputs) &&
      candidate.inputs.incoming === incidentId,
    );
    const resultId = isRecord(consumer) && Array.isArray(consumer.outputs) && typeof consumer.outputs[0] === "string"
      ? consumer.outputs[0]
      : undefined;
    const ownerGroup = groups.find((group) =>
      Array.isArray(group.entityIds) && resultId && group.entityIds.includes(resultId),
    ) ?? groups.find((group) => {
      if (!Array.isArray(group.entityIds) || !isRecord(construction.inputs)) return false;
      const groupEntityIds = group.entityIds;
      return [construction.inputs.origin, construction.inputs.surface]
        .some((id) => typeof id === "string" && groupEntityIds.includes(id));
    });
    if (ownerGroup && Array.isArray(ownerGroup.entityIds) && !ownerGroup.entityIds.includes(incidentId)) {
      ownerGroup.entityIds.push(incidentId);
    }
  }

  for (const annotation of Array.isArray(raw.annotations) ? raw.annotations : []) {
    if (!isRecord(annotation) || !Array.isArray(annotation.targetIds)) continue;
    for (const targetId of annotation.targetIds) {
      if (typeof targetId !== "string") continue;
      const target = entities.find((entity) =>
        isRecord(entity) && entity.id === targetId,
      );
      if (
        !isRecord(target) ||
        target.kind !== "point" ||
        typeof target.role !== "string" ||
        typeof target.label === "string"
      ) continue;
      const consumerOutputs = raw.constructions.flatMap((construction) =>
        isRecord(construction) &&
        isRecord(construction.inputs) &&
        referencesEntityId(construction.inputs, targetId) &&
        Array.isArray(construction.outputs)
          ? construction.outputs.filter((id): id is string => typeof id === "string")
          : [],
      );
      const ownerGroup = groups.find((group) => {
        const entityIds = group.entityIds;
        return Array.isArray(entityIds) &&
          consumerOutputs.some((output) => entityIds.includes(output));
      }) ?? (groups.length === 1 ? groups[0] : undefined);
      if (!ownerGroup || !Array.isArray(ownerGroup.entityIds)) continue;
      required.add(targetId);
      if (!ownerGroup.entityIds.includes(targetId)) ownerGroup.entityIds.push(targetId);
    }
  }
  for (const entity of entities) {
    if (isRecord(entity)) delete entity[INFERRED_CONSTRUCTION_ENTITY];
    if (
      !isRecord(entity) ||
      entity.kind !== "group" ||
      typeof entity.id !== "string"
    ) continue;
    const entityKeys = [entity.id, entity.role]
      .filter((value): value is string => typeof value === "string")
      .map(normalizeSemanticGroupKey)
      .filter(Boolean);
    const ownerGroup = groups.find((group) =>
      typeof group.id === "string" &&
      entityKeys.includes(normalizeSemanticGroupKey(group.id)),
    );
    if (
      ownerGroup &&
      Array.isArray(ownerGroup.entityIds) &&
      !ownerGroup.entityIds.includes(entity.id)
    ) {
      ownerGroup.entityIds.push(entity.id);
    }
  }
  raw.requiredEntityIds = [...required];
}

function normalizeSemanticGroupKey(value: string): string {
  return value.toLowerCase()
    .replace(/(?:group|frame|view|diagram)/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function referencesEntityId(value: unknown, entityId: string): boolean {
  if (value === entityId) return true;
  if (Array.isArray(value)) return value.some((item) => referencesEntityId(item, entityId));
  if (isRecord(value)) return Object.values(value).some((item) => referencesEntityId(item, entityId));
  return false;
}

function checkAcyclic(nodes: Array<{ id: string; deps: string[] }>, path: string, issues: SceneIssue[]): void {
  const state = new Map<string, number>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return false;
    if (state.get(id) === 2) return true;
    state.set(id, 1);
    const node = nodes.find((candidate) => candidate.id === id);
    for (const dep of node?.deps ?? []) if (!visit(dep)) return false;
    state.set(id, 2);
    return true;
  };
  for (const node of nodes) if (!visit(node.id)) { issues.push({ code: "dependency_cycle", message: `${path} contains a dependency cycle`, severity: "fatal", path }); break; }
}

function result(document: SceneDocument | null, issues: SceneIssue[], statsDocument?: SceneDocument): ValidationResult {
  const source = statsDocument ?? document;
  const report: ValidationReport = {
    engineVersion: SCENE_ENGINE_VERSION,
    valid: !issues.some((issue) => issue.severity === "fatal"),
    issues,
    stats: { entityCount: source?.entities.length ?? 0, constructionCount: source?.constructions.length ?? 0, primitiveCount: 0, assertionCount: source?.assertions.length ?? 0 },
  };
  return { document, report };
}

function validateCalculusConstruction(
  construction: SceneDocument["constructions"][number],
  index: number,
  document: SceneDocument,
  constructionByOutput: Map<string, SceneDocument["constructions"][number]>,
  issues: SceneIssue[],
): void {
  const operator = construction.operator;
  const inputs = construction.inputs;
  if (construction.outputs.length !== 1) {
    issues.push({
      code: `invalid_${operator}_outputs`,
      message: `${operator} must produce exactly one visible entity`,
      severity: "fatal",
      path: `constructions[${index}].outputs`,
      actual: construction.outputs.length,
    });
  }

  const output = construction.outputs[0];
  const outputKind = document.entities.find((entity) => entity.id === output)?.kind;
  const allowedOutputKinds = operator === "solid_of_revolution"
    ? ["polygon"]
    : operator === "parametric_curve" || operator === "polar_curve" || operator === "implicit_curve"
      ? ["polyline"]
      : operator === "representative_slice"
        ? ["segment", "line", "polyline"]
        : ["line", "segment", "polyline"];
  if (output && outputKind && !allowedOutputKinds.includes(outputKind)) {
    issues.push({
      code: `invalid_${operator}_output_kind`,
      message: `${operator} output must use entity kind ${allowedOutputKinds.join(" or ")}`,
      severity: "fatal",
      path: `constructions[${index}].outputs[0]`,
      entityIds: [output],
      expected: allowedOutputKinds,
      actual: outputKind,
    });
  }

  if (operator === "parametric_curve") {
    validateParameterizedCurveInputs(inputs, index, document, issues, {
      operator,
      parameter: "t",
      minKey: "tMin",
      maxKey: "tMax",
      expressions: ["xExpression", "yExpression"],
    });
    return;
  }
  if (operator === "polar_curve") {
    validateParameterizedCurveInputs(inputs, index, document, issues, {
      operator,
      parameter: "theta",
      minKey: "thetaMin",
      maxKey: "thetaMax",
      expressions: ["radiusExpression"],
    });
    return;
  }
  if (operator === "implicit_curve") {
    validateImplicitCurveInputs(inputs, index, document, issues);
    return;
  }

  const producerFor = (value: unknown) => typeof value === "string" ? constructionByOutput.get(value) : undefined;
  const addBadReference = (key: string, expected: string, value: unknown) => issues.push({
    code: `invalid_${operator}_curve_reference`,
    message: `${operator} ${key} must reference ${expected}`,
    severity: "fatal" as const,
    path: `constructions[${index}].inputs.${key}`,
    entityIds: typeof value === "string" ? [value] : undefined,
    actual: value,
  });

  if (operator === "tangent_line" || operator === "normal_line") {
    const curveId = inputs.curve ?? inputs.target;
    const producer = producerFor(curveId);
    if (!producer || !SAMPLED_CURVE_OPERATORS.has(producer.operator)) {
      addBadReference("curve", "a function_curve, parametric_curve, or polar_curve", curveId);
      return;
    }
    const domain = sampledCurveDomain(producer, document);
    const at = validationNumber(inputs.at ?? inputs.parameter ?? inputs.atX, document);
    if (!domain || at === null || !(at > domain.min && at < domain.max)) {
      issues.push({
        code: `invalid_${operator}_parameter`,
        message: `${operator} requires a finite parameter strictly inside the curve domain`,
        severity: "fatal",
        path: `constructions[${index}].inputs.at`,
        expected: domain,
        actual: inputs.at ?? inputs.parameter ?? inputs.atX,
      });
    }
    const span = inputs.span === undefined ? 1 : validationNumber(inputs.span, document);
    if (span === null || !(span > 0)) {
      issues.push({
        code: `invalid_${operator}_span`,
        message: `${operator} span must be a positive finite number`,
        severity: "fatal",
        path: `constructions[${index}].inputs.span`,
        actual: inputs.span,
      });
    }
    return;
  }

  if (operator === "representative_slice") {
    const upperId = inputs.upper ?? inputs.top;
    const lowerId = inputs.lower ?? inputs.bottom;
    const upper = producerFor(upperId);
    const lower = producerFor(lowerId);
    if (upper?.operator !== "function_curve") addBadReference("upper", "a function_curve", upperId);
    if (lower?.operator !== "function_curve") addBadReference("lower", "a function_curve", lowerId);
    const atX = validationNumber(inputs.atX ?? inputs.x ?? inputs.at, document);
    const upperDomain = upper ? sampledCurveDomain(upper, document) : null;
    const lowerDomain = lower ? sampledCurveDomain(lower, document) : null;
    if (
      atX === null ||
      !upperDomain || !lowerDomain ||
      atX < upperDomain.min || atX > upperDomain.max ||
      atX < lowerDomain.min || atX > lowerDomain.max
    ) {
      issues.push({
        code: "invalid_representative_slice_domain",
        message: "representative_slice atX must lie in both function domains",
        severity: "fatal",
        path: `constructions[${index}].inputs.atX`,
        actual: inputs.atX ?? inputs.x ?? inputs.at,
      });
    } else if (upper && lower) {
      try {
        const upperY = parseMathExpression(String(upper.inputs.expression)).evaluate(atX);
        const lowerY = parseMathExpression(String(lower.inputs.expression)).evaluate(atX);
        if (!(upperY > lowerY + 1e-6)) {
          issues.push({
            code: "invalid_representative_slice_order",
            message: "representative_slice upper curve must be strictly above lower curve at atX",
            severity: "fatal",
            path: `constructions[${index}].inputs`,
            expected: "upper(atX) > lower(atX)",
            actual: { upperY, lowerY },
          });
        }
      } catch {
        // The referenced function_curve validator reports malformed expressions.
      }
    }
    return;
  }

  if (operator === "solid_of_revolution") {
    const profileId = inputs.profile ?? inputs.curve;
    const profile = producerFor(profileId);
    if (profile?.operator !== "function_curve") {
      addBadReference("profile", "a function_curve", profileId);
      return;
    }
    const domain = sampledCurveDomain(profile, document);
    const xMin = inputs.xMin === undefined ? domain?.min ?? null : validationNumber(inputs.xMin, document);
    const xMax = inputs.xMax === undefined ? domain?.max ?? null : validationNumber(inputs.xMax, document);
    const axisY = inputs.axisY === undefined ? 0 : validationNumber(inputs.axisY, document);
    if (
      !domain || xMin === null || xMax === null || !(xMin < xMax) ||
      xMin < domain.min || xMax > domain.max
    ) {
      issues.push({
        code: "invalid_solid_of_revolution_domain",
        message: "solid_of_revolution requires xMin < xMax within the function profile domain",
        severity: "fatal",
        path: `constructions[${index}].inputs`,
        expected: domain,
        actual: { xMin: inputs.xMin, xMax: inputs.xMax },
      });
    }
    if (axisY === null) {
      issues.push({
        code: "invalid_solid_of_revolution_axis",
        message: "solid_of_revolution axisY must be a finite number",
        severity: "fatal",
        path: `constructions[${index}].inputs.axisY`,
        actual: inputs.axisY,
      });
    }
    validateCurveSamples(inputs.samples, index, document, issues, operator);
    if (domain && xMin !== null && xMax !== null && xMin < xMax && axisY !== null) {
      try {
        const expression = parseMathExpression(String(profile.inputs.expression));
        const signedRadii = Array.from({ length: 65 }, (_, sampleIndex) =>
          expression.evaluate(xMin + (xMax - xMin) * sampleIndex / 64) - axisY,
        );
        const nonzero = signedRadii.filter((radius) => Math.abs(radius) > 1e-6);
        const side = nonzero.length > 0 ? Math.sign(nonzero[0]!) : 0;
        const interiorAxisContact = signedRadii.some((radius, sampleIndex) =>
          Math.abs(radius) <= 1e-6 && sampleIndex > 0 && sampleIndex < signedRadii.length - 1,
        );
        if (
          side === 0 ||
          interiorAxisContact ||
          nonzero.some((radius) => Math.sign(radius) !== side)
        ) {
          issues.push({
            code: "invalid_solid_of_revolution_profile",
            message: "solid_of_revolution profile must remain on one side of axisY and may meet it only at endpoints",
            severity: "fatal",
            path: `constructions[${index}].inputs`,
          });
        }
      } catch {
        // The referenced function_curve validator reports malformed expressions.
      }
    }
  }
}

function validateFunctionRegionConstruction(
  construction: SceneDocument["constructions"][number],
  index: number,
  document: SceneDocument,
  constructionByOutput: Map<string, SceneDocument["constructions"][number]>,
  issues: SceneIssue[],
): void {
  const inputs = construction.inputs;
  const upperId = inputs.upper ?? inputs.top ?? inputs.above;
  const lowerId = inputs.lower ?? inputs.bottom ?? inputs.below;
  const upper = typeof upperId === "string" ? constructionByOutput.get(upperId) : undefined;
  const lower = typeof lowerId === "string" ? constructionByOutput.get(lowerId) : undefined;
  const output = construction.outputs[0];
  const outputKind = document.entities.find((entity) => entity.id === output)?.kind;
  if (
    construction.outputs.length !== 1 ||
    (outputKind !== "polygon" && outputKind !== "function_region")
  ) {
    issues.push({
      code: "invalid_function_region_output",
      message: "function_region must produce exactly one polygon or semantic function_region entity",
      severity: "fatal",
      path: `constructions[${index}].outputs`,
      entityIds: output ? [output] : undefined,
    });
  }
  if (upper?.operator !== "function_curve" || lower?.operator !== "function_curve") {
    issues.push({
      code: "invalid_function_region_reference",
      message: "function_region upper and lower must reference constructed function curves",
      severity: "fatal",
      path: `constructions[${index}].inputs`,
      entityIds: [upperId, lowerId].filter((id): id is string => typeof id === "string"),
    });
    return;
  }
  const upperDomain = sampledCurveDomain(upper, document);
  const lowerDomain = sampledCurveDomain(lower, document);
  const xMin = inputs.xMin === undefined
    ? upperDomain && lowerDomain ? Math.max(upperDomain.min, lowerDomain.min) : null
    : validationNumber(inputs.xMin, document);
  const xMax = inputs.xMax === undefined
    ? upperDomain && lowerDomain ? Math.min(upperDomain.max, lowerDomain.max) : null
    : validationNumber(inputs.xMax, document);
  if (
    !upperDomain || !lowerDomain || xMin === null || xMax === null || !(xMin < xMax) ||
    xMin < upperDomain.min || xMax > upperDomain.max ||
    xMin < lowerDomain.min || xMax > lowerDomain.max
  ) {
    issues.push({
      code: "invalid_function_region_domain",
      message: "function_region requires a non-empty interval inside both function domains",
      severity: "fatal",
      path: `constructions[${index}].inputs`,
      actual: { xMin: inputs.xMin, xMax: inputs.xMax },
    });
    return;
  }
  validateCurveSamples(inputs.samples, index, document, issues, "function_region");
  try {
    const upperExpression = parseMathExpression(String(upper.inputs.expression));
    const lowerExpression = parseMathExpression(String(lower.inputs.expression));
    const reversedAt = Array.from({ length: 65 }, (_, sampleIndex) =>
      xMin + (xMax - xMin) * sampleIndex / 64
    ).find((x) => upperExpression.evaluate(x) + 1e-6 < lowerExpression.evaluate(x));
    if (reversedAt !== undefined) {
      issues.push({
        code: "invalid_function_region_order",
        message: "function_region upper curve must not fall below its lower curve in the requested interval",
        severity: "fatal",
        path: `constructions[${index}].inputs`,
        expected: "upper(x) >= lower(x)",
        actual: { x: reversedAt },
      });
    }
  } catch {
    // Referenced function_curve validation owns expression diagnostics.
  }
}

function validateMensurationConstruction(
  construction: SceneDocument["constructions"][number],
  index: number,
  document: SceneDocument,
  constructionByOutput: Map<string, SceneDocument["constructions"][number]>,
  issues: SceneIssue[],
): void {
  const { operator, inputs } = construction;
  if (construction.outputs.length !== 1) {
    issues.push({
      code: `invalid_${operator}_outputs`,
      message: `${operator} must produce exactly one visible entity`,
      severity: "fatal",
      path: `constructions[${index}].outputs`,
      actual: construction.outputs.length,
    });
  }
  const output = construction.outputs[0];
  const outputKind = document.entities.find((entity) => entity.id === output)?.kind;
  if (output && outputKind && outputKind !== "polyline") {
    issues.push({
      code: `invalid_${operator}_output_kind`,
      message: `${operator} output must use entity kind polyline`,
      severity: "fatal",
      path: `constructions[${index}].outputs[0]`,
      entityIds: [output],
      expected: "polyline",
      actual: outputKind,
    });
  }

  if (operator === "solid_projection") {
    const centerId = inputs.center;
    const centerProducer = typeof centerId === "string" ? constructionByOutput.get(centerId) : undefined;
    if (centerProducer?.operator !== "point") {
      issues.push({
        code: "invalid_solid_projection_center",
        message: "solid_projection center must reference a constructed point",
        severity: "fatal",
        path: `constructions[${index}].inputs.center`,
        entityIds: typeof centerId === "string" ? [centerId] : undefined,
        actual: centerId,
      });
    }
    if (!SOLID_PROJECTION_KINDS.has(String(inputs.kind))) {
      issues.push({
        code: "invalid_solid_projection_kind",
        message: "solid_projection kind must be cylinder, cone, frustum, sphere, or hemisphere",
        severity: "fatal",
        path: `constructions[${index}].inputs.kind`,
        actual: inputs.kind,
      });
    }
    if (inputs.axis !== undefined && inputs.axis !== "vertical" && inputs.axis !== "horizontal") {
      issues.push({
        code: "invalid_solid_projection_axis",
        message: "solid_projection axis must be vertical or horizontal",
        severity: "fatal",
        path: `constructions[${index}].inputs.axis`,
        actual: inputs.axis,
      });
    }
    const radius = validationNumber(inputs.radius, document);
    if (radius === null || !(radius > 0)) {
      issues.push({
        code: "invalid_solid_projection_radius",
        message: "solid_projection radius must be a positive finite number",
        severity: "fatal",
        path: `constructions[${index}].inputs.radius`,
        actual: inputs.radius,
      });
    }
    const needsHeight = inputs.kind === "cylinder" || inputs.kind === "cone" || inputs.kind === "frustum";
    const height = inputs.height === undefined ? null : validationNumber(inputs.height, document);
    if (needsHeight && (height === null || !(height > 0))) {
      issues.push({
        code: "invalid_solid_projection_height",
        message: `${String(inputs.kind)} solid_projection requires a positive finite height`,
        severity: "fatal",
        path: `constructions[${index}].inputs.height`,
        actual: inputs.height,
      });
    } else if (!needsHeight && inputs.height !== undefined) {
      issues.push({
        code: "invalid_solid_projection_height",
        message: `${String(inputs.kind)} derives its height from radius and must not declare height`,
        severity: "fatal",
        path: `constructions[${index}].inputs.height`,
        actual: inputs.height,
      });
    }
    const topRadius = inputs.topRadius === undefined ? null : validationNumber(inputs.topRadius, document);
    if (
      inputs.kind === "frustum" &&
      (topRadius === null || !(topRadius > 0) || (radius !== null && Math.abs(topRadius - radius) <= 1e-6))
    ) {
      issues.push({
        code: "invalid_solid_projection_top_radius",
        message: "frustum solid_projection requires a positive topRadius different from radius",
        severity: "fatal",
        path: `constructions[${index}].inputs.topRadius`,
        actual: inputs.topRadius,
      });
    } else if (inputs.kind !== "frustum" && inputs.topRadius !== undefined) {
      issues.push({
        code: "invalid_solid_projection_top_radius",
        message: "topRadius is valid only for a frustum solid_projection",
        severity: "fatal",
        path: `constructions[${index}].inputs.topRadius`,
        actual: inputs.topRadius,
      });
    }
    return;
  }

  const solidId = inputs.solid;
  const solidProducer = typeof solidId === "string" ? constructionByOutput.get(solidId) : undefined;
  if (solidProducer?.operator !== "solid_projection") {
    issues.push({
      code: "invalid_solid_cross_section_reference",
      message: "solid_cross_section solid must reference a solid_projection output",
      severity: "fatal",
      path: `constructions[${index}].inputs.solid`,
      entityIds: typeof solidId === "string" ? [solidId] : undefined,
      actual: solidId,
    });
  }
  const at = validationNumber(inputs.at, document);
  if (at === null || !(at > 0 && at < 1)) {
    issues.push({
      code: "invalid_solid_cross_section_position",
      message: "solid_cross_section at must be a finite number strictly between 0 and 1",
      severity: "fatal",
      path: `constructions[${index}].inputs.at`,
      actual: inputs.at,
    });
  }
  if (inputs.plane !== undefined && inputs.plane !== "transverse") {
    issues.push({
      code: "invalid_solid_cross_section_plane",
      message: "solid_cross_section currently supports plane transverse only",
      severity: "fatal",
      path: `constructions[${index}].inputs.plane`,
      actual: inputs.plane,
    });
  }
}

function validateWaveVisualConstruction(
  construction: SceneDocument["constructions"][number],
  index: number,
  document: SceneDocument,
  constructionByOutput: Map<string, SceneDocument["constructions"][number]>,
  issues: SceneIssue[],
): void {
  const { operator, inputs } = construction;
  const output = construction.outputs[0];
  const outputKind = document.entities.find((entity) => entity.id === output)?.kind;
  if (construction.outputs.length !== 1 || (outputKind !== "polyline" && outputKind !== operator)) {
    issues.push({
      code: `invalid_${operator}_output`,
      message: `${operator} must produce exactly one ${operator} or polyline entity`,
      severity: "fatal",
      path: `constructions[${index}].outputs`,
      entityIds: output ? [output] : undefined,
      actual: { count: construction.outputs.length, kind: outputKind },
    });
  }
  const pointReference = (key: string): boolean => {
    const value = inputs[key];
    return typeof value === "string" && constructionByOutput.get(value)?.operator === "point";
  };
  const positiveInput = (key: string): number | null => {
    const value = validationNumber(inputs[key], document);
    return value !== null && value > 0 ? value : null;
  };
  const finiteArray2 = (value: unknown): boolean => Array.isArray(value) && value.length >= 2 &&
    value.slice(0, 2).every((entry) => typeof entry === "number" && Number.isFinite(entry));
  const invalid = (key: string, message: string, actual = inputs[key]) => issues.push({
    code: `invalid_${operator}_${key}`,
    message,
    severity: "fatal" as const,
    path: `constructions[${index}].inputs.${key}`,
    actual,
  });

  if (operator === "wavefront_family") {
    if (!pointReference("origin")) invalid("origin", "wavefront_family origin must reference a constructed point");
    const directionEntity = typeof inputs.direction === "string"
      ? document.entities.find((entity) => entity.id === inputs.direction)
      : undefined;
    const pathDirection = Boolean(
      directionEntity &&
      ["ray", "vector", "line", "segment", "polyline"].includes(directionEntity.kind) &&
      constructionByOutput.has(directionEntity.id),
    );
    if (!finiteArray2(inputs.direction) && !pathDirection) {
      invalid("direction", "wavefront_family direction must be a finite two-component vector or a constructed path");
    }
    if (inputs.shape !== "plane" && inputs.shape !== "circular") invalid("shape", "wavefront_family shape must be plane or circular");
    const count = validationNumber(inputs.count, document);
    if (count === null || !Number.isInteger(count) || count < 1 || count > 12) invalid("count", "wavefront_family count must be an integer from 1 to 12");
    if (positiveInput("spacing") === null) invalid("spacing", "wavefront_family spacing must be positive");
    if (positiveInput("span") === null) invalid("span", "wavefront_family span must be positive");
    return;
  }
  if (operator === "aperture") {
    if (!pointReference("center")) invalid("center", "aperture center must reference a constructed point");
    if (inputs.orientation !== "vertical" && inputs.orientation !== "horizontal") invalid("orientation", "aperture orientation must be vertical or horizontal");
    const count = validationNumber(inputs.slitCount, document);
    if (count === null || !Number.isInteger(count) || count < 1 || count > 4) invalid("slitCount", "aperture slitCount must be an integer from 1 to 4");
    const length = positiveInput("length");
    const width = positiveInput("slitWidth");
    const separation = positiveInput("slitSeparation");
    if (length === null) invalid("length", "aperture length must be positive");
    if (width === null) invalid("slitWidth", "aperture slitWidth must be positive");
    if (separation === null) invalid("slitSeparation", "aperture slitSeparation must be positive");
    if (length !== null && width !== null && separation !== null && count !== null &&
      width + Math.max(0, count - 1) * separation >= length) {
      invalid("length", "aperture slits must fit strictly inside its finite length", { length, width, separation, count });
    }
    return;
  }
  if (operator === "screen_pattern") {
    if (!pointReference("start") || !pointReference("end") || inputs.start === inputs.end) {
      invalid("start", "screen_pattern requires distinct constructed start and end points", { start: inputs.start, end: inputs.end });
    }
    if (!["interference", "diffraction", "resolution"].includes(String(inputs.pattern))) invalid("pattern", "screen_pattern pattern must be interference, diffraction, or resolution");
    const count = validationNumber(inputs.count, document);
    if (count === null || !Number.isInteger(count) || count < 3 || count > 21 || count % 2 === 0) invalid("count", "screen_pattern count must be an odd integer from 3 to 21");
    if (positiveInput("spacing") === null) invalid("spacing", "screen_pattern spacing must be positive");
    if (positiveInput("centralWidth") === null) invalid("centralWidth", "screen_pattern centralWidth must be positive");
    return;
  }
  if (operator === "transverse_field") {
    if (!pointReference("start") || !pointReference("end") || inputs.start === inputs.end) {
      invalid("start", "transverse_field requires distinct constructed start and end points", { start: inputs.start, end: inputs.end });
    }
    if (positiveInput("amplitude") === null) invalid("amplitude", "transverse_field amplitude must be positive");
    const cycles = validationNumber(inputs.cycles, document);
    if (cycles === null || !Number.isInteger(cycles) || cycles < 1 || cycles > 12) invalid("cycles", "transverse_field cycles must be an integer from 1 to 12");
    if (validationNumber(inputs.orientationDeg, document) === null) invalid("orientationDeg", "transverse_field orientationDeg must be finite");
    return;
  }
  if (!pointReference("center")) invalid("center", "polarizer center must reference a constructed point");
  if (positiveInput("radius") === null) invalid("radius", "polarizer radius must be positive");
  if (validationNumber(inputs.axisAngleDeg, document) === null) invalid("axisAngleDeg", "polarizer axisAngleDeg must be finite");
}

function validateSurfaceRayConstruction(
  construction: SceneDocument["constructions"][number],
  index: number,
  document: SceneDocument,
  constructionByOutput: Map<string, SceneDocument["constructions"][number]>,
  issues: SceneIssue[],
): void {
  const { operator, inputs } = construction;
  if (construction.outputs.length !== 3) {
    issues.push({
      code: `invalid_${operator}_outputs`,
      message: `${operator} must produce [incident_ray, normal, outgoing_ray]`,
      severity: "fatal",
      path: `constructions[${index}].outputs`,
      actual: construction.outputs,
    });
  }
  const pointProducer = typeof inputs.point === "string" ? constructionByOutput.get(inputs.point) : undefined;
  if (pointProducer?.operator !== "point" && pointProducer?.operator !== "surface_intersection") {
    issues.push({
      code: `invalid_${operator}_point`,
      message: `${operator} point must reference a constructed contact point`,
      severity: "fatal",
      path: `constructions[${index}].inputs.point`,
      actual: inputs.point,
    });
  }
  const surfaceProducer = typeof inputs.surface === "string" ? constructionByOutput.get(inputs.surface) : undefined;
  if (!surfaceProducer || !["line", "segment", "circle", "arc"].includes(surfaceProducer.operator)) {
    issues.push({
      code: `invalid_${operator}_surface`,
      message: `${operator} surface must reference a constructed line, segment, circle, or arc`,
      severity: "fatal",
      path: `constructions[${index}].inputs.surface`,
      actual: inputs.surface,
    });
  }
  const incidentAngleDeg = validationNumber(inputs.incidentAngleDeg, document);
  if (incidentAngleDeg === null || !(incidentAngleDeg > 0 && incidentAngleDeg < 90)) {
    issues.push({
      code: `invalid_${operator}_angle`,
      message: `${operator} incidentAngleDeg must be strictly between 0 and 90`,
      severity: "fatal",
      path: `constructions[${index}].inputs.incidentAngleDeg`,
      actual: inputs.incidentAngleDeg,
    });
  }
  if (inputs.tangentSign !== undefined && inputs.tangentSign !== -1 && inputs.tangentSign !== 1) {
    issues.push({
      code: `invalid_${operator}_tangent_sign`,
      message: `${operator} tangentSign must be -1 or 1`,
      severity: "fatal",
      path: `constructions[${index}].inputs.tangentSign`,
      actual: inputs.tangentSign,
    });
  }
  const span = inputs.span === undefined ? 2 : validationNumber(inputs.span, document);
  if (span === null || !(span > 0)) {
    issues.push({
      code: `invalid_${operator}_span`,
      message: `${operator} span must be positive`,
      severity: "fatal",
      path: `constructions[${index}].inputs.span`,
      actual: inputs.span,
    });
  }
  if (operator === "refract_at") {
    const n1 = validationNumber(inputs.n1, document);
    const n2 = validationNumber(inputs.n2, document);
    if (n1 === null || n2 === null || !(n1 > 0) || !(n2 > 0)) {
      issues.push({
        code: "invalid_refract_at_indices",
        message: "refract_at requires positive n1 and n2",
        severity: "fatal",
        path: `constructions[${index}].inputs`,
        actual: { n1: inputs.n1, n2: inputs.n2 },
      });
    }
  }
}

function validateOpticalTrainConstruction(
  construction: SceneDocument["constructions"][number],
  index: number,
  constructionByOutput: ReadonlyMap<string, SceneDocument["constructions"][number]>,
  issues: SceneIssue[],
): void {
  if (construction.outputs.length !== 6) {
    issues.push({
      code: "invalid_optical_train_outputs",
      message: "optical_train must produce [incoming_upper, incoming_lower, internal_upper, internal_lower, outgoing_upper, outgoing_lower]",
      severity: "fatal",
      path: `constructions[${index}].outputs`,
      actual: construction.outputs,
    });
  }
  const allowedPathOperators = new Set(["line", "segment", "parallel_through", "perpendicular_through"]);
  for (const key of ["axis", "objective", "eyepiece"] as const) {
    const value = construction.inputs[key];
    const producer = typeof value === "string" ? constructionByOutput.get(value) : undefined;
    if (!producer || !allowedPathOperators.has(producer.operator)) {
      issues.push({
        code: "invalid_optical_train_path",
        message: `optical_train ${key} must reference constructed line geometry`,
        severity: "fatal",
        path: `constructions[${index}].inputs.${key}`,
        entityIds: typeof value === "string" ? [value] : undefined,
      });
    }
  }
  const focus = construction.inputs.focus;
  const focusProducer = typeof focus === "string" ? constructionByOutput.get(focus) : undefined;
  if (focusProducer?.operator !== "point" && focusProducer?.operator !== "intersection") {
    issues.push({
      code: "invalid_optical_train_focus",
      message: "optical_train focus must reference one constructed point",
      severity: "fatal",
      path: `constructions[${index}].inputs.focus`,
      entityIds: typeof focus === "string" ? [focus] : undefined,
    });
  }
  for (const key of ["raySpan", "beamHalfHeight"] as const) {
    const value = construction.inputs[key];
    if (value !== undefined && !(typeof value === "number" && Number.isFinite(value) && value > 0)) {
      issues.push({
        code: "invalid_optical_train_scale",
        message: `optical_train ${key} must be a positive dimensionless display length`,
        severity: "fatal",
        path: `constructions[${index}].inputs.${key}`,
        actual: value,
      });
    }
  }
}

function validateImplicitCurveInputs(
  inputs: Record<string, unknown>,
  index: number,
  document: SceneDocument,
  issues: SceneIssue[],
): void {
  const xMin = validationNumber(inputs.xMin, document);
  const xMax = validationNumber(inputs.xMax, document);
  const yMin = validationNumber(inputs.yMin, document);
  const yMax = validationNumber(inputs.yMax, document);
  if (
    xMin === null || xMax === null || !(xMin < xMax) ||
    yMin === null || yMax === null || !(yMin < yMax)
  ) {
    issues.push({
      code: "invalid_implicit_curve_domain",
      message: "implicit_curve requires finite xMin < xMax and yMin < yMax",
      severity: "fatal",
      path: `constructions[${index}].inputs`,
      expected: { xMin: "finite", xMax: "> xMin", yMin: "finite", yMax: "> yMin" },
      actual: { xMin: inputs.xMin, xMax: inputs.xMax, yMin: inputs.yMin, yMax: inputs.yMax },
    });
  }

  const expression = inputs.expression;
  if (typeof expression !== "string") {
    issues.push({
      code: "invalid_implicit_curve_expression",
      message: "implicit_curve expression must be a string representing F(x, y)",
      severity: "fatal",
      path: `constructions[${index}].inputs.expression`,
    });
  } else {
    try {
      const parsed = parseMathExpression2D(expression);
      if (xMin !== null && xMax !== null && xMin < xMax && yMin !== null && yMax !== null && yMin < yMax) {
        parsed.assertContinuousOn(xMin, xMax, yMin, yMax);
      }
    } catch (error) {
      issues.push({
        code: "invalid_implicit_curve_expression",
        message: `implicit_curve expression is invalid or discontinuous: ${error instanceof Error ? error.message : String(error)}`,
        severity: "fatal",
        path: `constructions[${index}].inputs.expression`,
      });
    }
  }

  if (inputs.variable !== undefined || inputs.variables !== undefined) {
    issues.push({
      code: "invalid_implicit_curve_variables",
      message: "implicit_curve variables are fixed as x and y and must not be overridden",
      severity: "fatal",
      path: `constructions[${index}].inputs`,
      actual: inputs.variable ?? inputs.variables,
    });
  }
  validateImplicitGridCount(inputs.xSamples, "xSamples", index, document, issues);
  validateImplicitGridCount(inputs.ySamples, "ySamples", index, document, issues);

  const xSamples = inputs.xSamples === undefined ? 65 : validationNumber(inputs.xSamples, document);
  const ySamples = inputs.ySamples === undefined ? 65 : validationNumber(inputs.ySamples, document);
  if (
    xMin !== null && xMax !== null && xSamples !== null && xSamples >= 2 &&
    yMin !== null && yMax !== null && ySamples !== null && ySamples >= 2 &&
    (xMin + (xMax - xMin) / (xSamples - 1) === xMin ||
      yMin + (yMax - yMin) / (ySamples - 1) === yMin)
  ) {
    issues.push({
      code: "invalid_implicit_curve_grid_precision",
      message: "implicit_curve domain is too narrow for distinct floating-point grid coordinates",
      severity: "fatal",
      path: `constructions[${index}].inputs`,
    });
  }
}

function validateImplicitGridCount(
  value: unknown,
  name: "xSamples" | "ySamples",
  index: number,
  document: SceneDocument,
  issues: SceneIssue[],
): void {
  const samples = value === undefined ? 65 : validationNumber(value, document);
  if (samples === null || !Number.isInteger(samples) || samples < 17 || samples > 161) {
    issues.push({
      code: "invalid_implicit_curve_grid",
      message: `implicit_curve ${name} must be an integer from 17 to 161`,
      severity: "fatal",
      path: `constructions[${index}].inputs.${name}`,
      actual: samples,
    });
  }
}

function validateParameterizedCurveInputs(
  inputs: Record<string, unknown>,
  index: number,
  document: SceneDocument,
  issues: SceneIssue[],
  contract: {
    operator: "parametric_curve" | "polar_curve";
    parameter: "t" | "theta";
    minKey: "tMin" | "thetaMin";
    maxKey: "tMax" | "thetaMax";
    expressions: string[];
  },
): void {
  if (inputs.parameter !== undefined && inputs.parameter !== contract.parameter) {
    issues.push({
      code: `invalid_${contract.operator}_parameter`,
      message: `${contract.operator} only supports parameter ${contract.parameter}`,
      severity: "fatal",
      path: `constructions[${index}].inputs.parameter`,
      actual: inputs.parameter,
    });
  }
  const min = validationNumber(inputs[contract.minKey] ?? inputs.parameterMin, document);
  const max = validationNumber(inputs[contract.maxKey] ?? inputs.parameterMax, document);
  if (min === null || max === null || !(min < max)) {
    issues.push({
      code: `invalid_${contract.operator}_domain`,
      message: `${contract.operator} requires finite ${contract.minKey} < ${contract.maxKey}`,
      severity: "fatal",
      path: `constructions[${index}].inputs`,
      actual: { min: inputs[contract.minKey], max: inputs[contract.maxKey] },
    });
  }
  for (const expressionKey of contract.expressions) {
    const source = inputs[expressionKey];
    if (typeof source !== "string") {
      issues.push({
        code: `invalid_${contract.operator}_expression`,
        message: `${contract.operator} ${expressionKey} must be a string`,
        severity: "fatal",
        path: `constructions[${index}].inputs.${expressionKey}`,
      });
      continue;
    }
    try {
      const parsed = parseParameterizedExpression(source, contract.parameter);
      if (min !== null && max !== null && min < max) parsed.assertContinuousOn(min, max);
    } catch (error) {
      issues.push({
        code: `invalid_${contract.operator}_expression`,
        message: `${contract.operator} ${expressionKey} is invalid or discontinuous: ${error instanceof Error ? error.message : String(error)}`,
        severity: "fatal",
        path: `constructions[${index}].inputs.${expressionKey}`,
      });
    }
  }
  validateCurveSamples(inputs.samples, index, document, issues, contract.operator);
}

function sampledCurveDomain(
  construction: SceneDocument["constructions"][number],
  document: SceneDocument,
): { min: number; max: number } | null {
  const keys = construction.operator === "function_curve"
    ? ["xMin", "xMax", "x_min", "x_max"]
    : construction.operator === "parametric_curve"
      ? ["tMin", "tMax", "parameterMin", "parameterMax"]
      : construction.operator === "polar_curve"
        ? ["thetaMin", "thetaMax", "parameterMin", "parameterMax"]
        : [];
  if (keys.length === 0) return null;
  const min = validationNumber(construction.inputs[keys[0]!] ?? construction.inputs[keys[2]!], document);
  const max = validationNumber(construction.inputs[keys[1]!] ?? construction.inputs[keys[3]!], document);
  return min !== null && max !== null && min < max ? { min, max } : null;
}

function validateCurveSamples(
  value: unknown,
  index: number,
  document: SceneDocument,
  issues: SceneIssue[],
  operator: string,
): void {
  const samples = value === undefined ? 65 : validationNumber(value, document);
  if (samples === null || !Number.isInteger(samples) || samples < 17 || samples > 161 || samples % 2 === 0) {
    issues.push({
      code: `invalid_${operator}_samples`,
      message: `${operator} samples must be an odd integer from 17 to 161`,
      severity: "fatal",
      path: `constructions[${index}].inputs.samples`,
      actual: samples,
    });
  }
}

function parseParameterizedExpression(source: string, parameter: "t" | "theta") {
  if (/\bx\b/.test(source)) throw new Error(`${parameter} expression cannot also reference x`);
  return parseMathExpression(source.replace(new RegExp(`\\b${parameter}\\b`, "g"), "x"));
}

function validateFunctionCurveInputs(
  inputs: Record<string, unknown>,
  index: number,
  document: SceneDocument,
  issues: SceneIssue[],
): void {
  if (typeof inputs.expression !== "string") {
    issues.push({
      code: "invalid_function_expression",
      message: "function_curve expression must be a string",
      severity: "fatal",
      path: `constructions[${index}].inputs.expression`,
    });
  } else {
    try {
      parseMathExpression(inputs.expression);
    } catch (error) {
      issues.push({
        code: "invalid_function_expression",
        message: `Invalid function_curve expression: ${error instanceof Error ? error.message : String(error)}`,
        severity: "fatal",
        path: `constructions[${index}].inputs.expression`,
      });
    }
  }
  if (inputs.variable !== undefined && inputs.variable !== "x") {
    issues.push({
      code: "invalid_function_variable",
      message: "function_curve only supports variable x",
      severity: "fatal",
      path: `constructions[${index}].inputs.variable`,
      actual: inputs.variable,
    });
  }
  const xMin = validationNumber(inputs.xMin ?? inputs.x_min, document);
  const xMax = validationNumber(inputs.xMax ?? inputs.x_max, document);
  if (xMin === null || xMax === null || !(xMin < xMax)) {
    issues.push({
      code: "invalid_function_domain",
      message: "function_curve requires finite numeric xMin < xMax",
      severity: "fatal",
      path: `constructions[${index}].inputs`,
      expected: { xMin: "finite number", xMax: "greater finite number" },
      actual: { xMin: inputs.xMin ?? inputs.x_min, xMax: inputs.xMax ?? inputs.x_max },
    });
  } else if (typeof inputs.expression === "string") {
    try {
      parseMathExpression(inputs.expression).assertContinuousOn(xMin, xMax);
    } catch (error) {
      issues.push({
        code: "invalid_function_domain",
        message: `function_curve is not provably finite and continuous on its domain: ${error instanceof Error ? error.message : String(error)}`,
        severity: "fatal",
        path: `constructions[${index}].inputs`,
      });
    }
  }
  const samples = inputs.samples === undefined ? 65 : validationNumber(inputs.samples, document);
  if (samples === null || !Number.isInteger(samples) || samples < 17 || samples > 161 || samples % 2 === 0) {
    issues.push({
      code: "invalid_function_samples",
      message: "function_curve samples must be an odd integer from 17 to 161",
      severity: "fatal",
      path: `constructions[${index}].inputs.samples`,
      actual: samples,
    });
  }
}

function validationNumber(value: unknown, document: SceneDocument, seen = new Set<string>()): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || seen.has(value)) return null;
  const quantity = document.quantities.find((candidate) => candidate.id === value);
  if (!quantity) return null;
  seen.add(value);
  return validationNumber(quantity.value, document, seen);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInlineCoordinatePoint(value: unknown): value is Record<string, unknown> {
  return isRecord(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y) &&
    (value.coordinateSpace === "layout" || value.coordinateSpace === "world");
}

function isImplicitConstructionPoint(entityId: string, document: SceneDocument): boolean {
  const entity = document.entities.find((candidate) => candidate.id === entityId);
  const annotationAnchor = Boolean(
    entity &&
    !entity.label &&
    isGenericHelperPointRole(entity.role) &&
    document.annotations.some((annotation) => annotation.targetIds.includes(entityId)),
  );
  if (document.requiredEntityIds.includes(entityId) && !annotationAnchor) return false;
  if (document.annotations.some((annotation) => annotation.targetIds.includes(entityId)) && !annotationAnchor) return false;
  if (document.relations.some((relation) => relation.entities.includes(entityId))) return false;
  if (entity?.label) return false;
  if (entity && !isGenericHelperPointRole(entity.role)) {
    return false;
  }
  if (annotationAnchor) return true;
  const consumers = document.constructions.flatMap((construction) =>
    referencesEntityId(construction.inputs, entityId) ? [construction.operator] : [],
  );
  return consumers.length > 0;
}

function isGenericHelperPointRole(role: string): boolean {
  const normalized = role.replace(/[_-]+/g, " ");
  if (/\b(?:observation|target|charge|object|image|focus|focal|pole|vertex|midpoint|intersection|incidence|source)\b/i.test(normalized)) {
    return false;
  }
  return /\b(?:point|node|terminal|junction|endpoint|end|hit|contact|origin|reference|helper|layout|wire|anchor|marker|mark|base|tip|tail|head|position|pos)\b|\bfield symbol\b/i.test(normalized);
}

function isCompactDiagramLabel(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, " ");
  return normalized.length > 0 && normalized.length <= 16;
}

function requiredOperatorForDerivedRole(entity: SceneDocument["entities"][number]): string | null {
  const normalized = entity.role.trim().toLowerCase();
  const pathLike = ["ray", "vector", "line", "segment", "polyline"].includes(entity.kind);
  if (/\bwavefront(?:s| family)?\b/.test(normalized)) return "wavefront_family";
  if (pathLike && /\breflected\b/.test(normalized)) {
    return "reflect_direction";
  }
  if (pathLike && /\brefracted\b/.test(normalized)) {
    return "refract_direction";
  }
  if (/\bangle bisector\b/.test(normalized)) return "angle_bisector";
  if (/\bprojection foot\b|\bfoot of (?:the )?perpendicular\b/.test(normalized)) return "project";
  if (/\btangent line\b/.test(normalized)) return "tangent_line";
  if (/\b(?:curve|function|graph) normal line\b|\bnormal line (?:to|of) (?:the )?(?:curve|function|graph)\b/.test(normalized)) {
    return "normal_line";
  }
  if (/\brepresentative slice\b/.test(normalized)) return "representative_slice";
  if (/\bsolid of revolution\b/.test(normalized)) return "solid_of_revolution";
  if (/\bsolid cross section\b/.test(normalized)) return "solid_cross_section";
  if (/\bsolid projection\b/.test(normalized)) return "solid_projection";
  if (/\bparametric curve\b/.test(normalized)) return "parametric_curve";
  if (/\bpolar curve\b/.test(normalized)) return "polar_curve";
  return null;
}

/**
 * Optical instruments are accepted from their semantic proof graph, never a
 * fixed drawing. The checks below state the invariant shared by refracting
 * instrument chains: elements are transverse to one axis, ray bundles prove
 * their direction, and normal adjustment has one shared focal plane.
 */
function validateOpticalInstrumentProofContract(
  document: SceneDocument,
  issues: SceneIssue[],
): void {
  const semantic = (id: string): string => {
    const entity = document.entities.find((candidate) => candidate.id === id);
    return `${id} ${entity?.role ?? ""} ${entity?.label ?? ""}`
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/([a-z])(\d)/g, "$1 $2")
      .replace(/\s+/g, " ");
  };
  const pathLike = (id: string): boolean => {
    const kind = document.entities.find((entity) => entity.id === id)?.kind;
    return typeof kind === "string" && ["line", "segment", "ray", "vector", "polyline"].includes(kind);
  };
  const isNamedElement = (
    entity: SceneDocument["entities"][number],
    name: "objective" | "eyepiece",
  ): boolean => {
    const normalizedLabel = entity.label?.trim().toLowerCase();
    const normalizedRole = entity.role.toLowerCase().replace(/[_-]+/g, " ");
    return normalizedLabel === name ||
      new RegExp(`\\b${name} (?:lens|element)\\b`).test(normalizedRole);
  };
  const objectiveIds = document.entities.flatMap((entity) =>
    pathLike(entity.id) && isNamedElement(entity, "objective") ? [entity.id] : []);
  const eyepieceIds = document.entities.flatMap((entity) =>
    pathLike(entity.id) && isNamedElement(entity, "eyepiece") ? [entity.id] : []);
  if (objectiveIds.length === 0 || eyepieceIds.length === 0) return;

  const axisIds = document.entities.flatMap((entity) =>
    (entity.kind === "line" || entity.kind === "segment") &&
    /\b(?:optical |principal )?axis\b/.test(semantic(entity.id))
      ? [entity.id]
      : []);
  if (axisIds.length !== 1) {
    issues.push({
      code: "instrument_axis_not_unique",
      message: "An optical instrument chain requires exactly one shared optical axis",
      severity: "fatal",
      entityIds: [...objectiveIds, ...eyepieceIds, ...axisIds],
      expected: 1,
      actual: axisIds.length,
    });
    return;
  }
  const axisId = axisIds[0]!;
  const proves = (predicate: string, ids: readonly string[]): boolean =>
    document.assertions.some((assertion) =>
      assertion.predicate === predicate &&
      assertion.expected !== false &&
      ids.every((id) => assertion.entities.includes(id)));

  for (const elementId of [...objectiveIds, ...eyepieceIds]) {
    if (proves("perpendicular", [elementId, axisId])) continue;
    issues.push({
      code: "instrument_element_orientation_not_proven",
      message: `${elementId} must be proved perpendicular to the shared optical axis`,
      severity: "fatal",
      entityIds: [elementId, axisId],
      expected: true,
    });
  }

  const incomingRayIds = document.entities.flatMap((entity) =>
    entity.kind === "ray" && /\b(?:incident|incoming|ray in)\b/.test(semantic(entity.id)) ? [entity.id] : []);
  const outgoingRayIds = document.entities.flatMap((entity) =>
    entity.kind === "ray" && /\b(?:emergent|outgoing|ray out)\b/.test(semantic(entity.id)) ? [entity.id] : []);
  for (const [name, rayIds] of [["incoming", incomingRayIds], ["emergent", outgoingRayIds]] as const) {
    if (rayIds.length < 2 || proves("parallel", rayIds.slice(0, 2))) continue;
    issues.push({
      code: "instrument_ray_bundle_not_proven",
      message: `The ${name} ray bundle must include a parallel proof`,
      severity: "fatal",
      entityIds: rayIds,
      expected: true,
    });
  }

  const question = typeof document.source.question === "string" ? document.source.question : "";
  if (!/\bnormal adjustment\b/i.test(question)) return;
  const objectiveFocalIds = document.entities.flatMap((entity) => {
    const name = semantic(entity.id);
    return entity.kind === "point" && /\bobjective\b/.test(name) && /\bfoc(?:al|us)\b/.test(name)
      ? [entity.id]
      : [];
  });
  const eyepieceFocalIds = document.entities.flatMap((entity) => {
    const name = semantic(entity.id);
    return entity.kind === "point" && /\beyepiece\b/.test(name) && /\bfoc(?:al|us)\b/.test(name)
      ? [entity.id]
      : [];
  });
  if (
    objectiveFocalIds.length > 0 &&
    eyepieceFocalIds.length > 0 &&
    !objectiveFocalIds.some((id) => eyepieceFocalIds.includes(id))
  ) {
    issues.push({
      code: "normal_adjustment_focal_plane_split",
      message: "Normal adjustment requires one shared objective-image and eyepiece-focal point, not two independent focal points",
      severity: "fatal",
      entityIds: [...objectiveFocalIds, ...eyepieceFocalIds],
      expected: "one shared point ID",
    });
  }
  const focalIds = document.entities.flatMap((entity) =>
    entity.kind === "point" && /\b(?:foc(?:al|us)|intermediate image)\b/.test(semantic(entity.id))
      ? [entity.id]
      : []);
  const hasFocusProof = document.assertions.some((assertion) =>
    assertion.predicate === "converges" &&
    assertion.expected !== false &&
    assertion.entities.length >= 3 &&
    assertion.entities.some((id) => focalIds.includes(id)));
  if (!hasFocusProof) {
    issues.push({
      code: "instrument_intermediate_focus_not_proven",
      message: "A normal-adjustment instrument must prove that at least two objective rays converge at the shared intermediate focal point",
      severity: "fatal",
      entityIds: [...objectiveIds, ...eyepieceIds, ...focalIds],
      expected: "converges [ray, ray, shared_focus]",
    });
  }
}
