import {
  SCENE_ENGINE_VERSION,
  type CompileOptions,
  type CompileResult,
  type RenderPoint,
  type RenderPrimitive,
  type SceneAssertion,
  type SceneDocument,
  type SceneIssue,
  type ValidationReport,
} from "../types";
import { obstaclesFromPrimitives, placeLabels, type LabelOwner } from "../labels/labelEngine";
import { evaluateTopologyAssertion, validateTopologyInvariants } from "../topology/topology";
import { implicitSolverEntityIds, validateSceneDocument } from "../document/validation";
import { parseMathExpression, parseMathExpression2D } from "../math/expression";
import {
  isExecutableSceneConstructionOperator,
  isExecutableSceneProofPredicate,
  isTopologySceneProofPredicate,
  type SupportedSceneConstructionOperator,
} from "../capability/capabilityManifest";

type Point = { x: number; y: number };
type Viewport = { x: number; y: number; width: number; height: number; padding?: number };
type SampledCurve = {
  curveKind: "function" | "parametric" | "polar";
  parameterMin: number;
  parameterMax: number;
  evaluate: (parameter: number) => Point;
};
type SolidProjectionKind = "cylinder" | "cone" | "frustum" | "sphere" | "hemisphere";
type SolidProjection = {
  kind: SolidProjectionKind;
  center: Point;
  radius: number;
  height: number;
  topRadius: number;
  axis: "vertical" | "horizontal";
};
type Geometry =
  | { kind: "point"; point: Point }
  | { kind: "path"; points: Point[]; closed?: boolean; directed?: boolean; infinite?: boolean; sampledCurve?: SampledCurve }
  | { kind: "multi_path"; paths: Point[][] }
  | { kind: "circle"; center: Point; radius: number }
  | { kind: "arc"; center: Point; radius: number; startAngle: number; endAngle: number }
  | { kind: "axes"; xMin: number; xMax: number; yMin: number; yMax: number }
  | { kind: "dimension"; a: Point; b: Point }
  | { kind: "compound"; paths: Point[][]; terminals: [Point, Point]; solidProjection?: SolidProjection };

const EPSILON = 1e-6;

export function compileSceneDocument(document: SceneDocument, options: CompileOptions = {}): CompileResult {
  const structural = validateSceneDocument(document);
  if (!structural.document) return { ok: false, renderScene: null, report: structural.report };
  if (document.visualDecision.mode === "text_only") return { ok: true, renderScene: emptyRenderScene(document), report: structural.report };

  const issues = [...structural.report.issues];
  const geometry = new Map<string, Geometry>();
  const quantities = new Map(document.quantities.map((quantity) => [quantity.id, quantity]));
  const layoutOverrides = computeLogicalLayout(document);
  const parallelLaneOffsets = computeParallelLaneOffsets(document);

  validateTopologyInvariants(document, issues);
  if (issues.some((issue) => issue.severity === "fatal")) {
    return { ok: false, renderScene: null, report: report(document, issues, 0) };
  }

  for (const { construction, originalIndex } of orderConstructionsByDependency(document)) {
    try {
      const laneOffset = construction.outputs[0]
        ? parallelLaneOffsets.get(construction.outputs[0])
        : undefined;
      const inputs = laneOffset === undefined
        ? construction.inputs
        : { ...construction.inputs, __parallelLane: laneOffset };
      const operator = construction.operator;
      if (!isExecutableSceneConstructionOperator(operator)) {
        throw new Error(`unsupported operator ${operator}`);
      }
      const outputs = evaluateConstruction(operator, inputs, geometry, quantities);
      if (construction.operator === "point" && construction.outputs[0]) {
        const override = layoutOverrides.get(construction.outputs[0]);
        if (override) outputs[0] = { kind: "point", point: override };
      }
      if (outputs.length !== construction.outputs.length) {
        throw new Error(`operator produced ${outputs.length} outputs, expected ${construction.outputs.length}`);
      }
      construction.outputs.forEach((id, outputIndex) => {
        const next = outputs[outputIndex]!;
        if (assignChainedRefractInternalPath(id, outputIndex, construction, document, geometry)) return;
        geometry.set(id, next);
      });
    } catch (error) {
      issues.push({ code: "construction_failed", message: `${construction.id}: ${errorMessage(error)}`, severity: "fatal", path: `constructions[${originalIndex}]`, entityIds: construction.outputs });
    }
  }
  for (const construction of document.constructions) {
    if (construction.operator !== "connect" || !construction.outputs[0]) continue;
    try {
      const start = resolvePoint(first(construction.inputs, ["start", "from", "a"]), geometry);
      const end = resolvePoint(first(construction.inputs, ["end", "to", "b"]), geometry);
      geometry.set(construction.outputs[0], {
        kind: "path",
        points: routedConnectorPoints(start, end, geometry, construction.outputs[0]),
      });
    } catch (error) {
      issues.push({
        code: "construction_failed",
        message: `${construction.id}: ${errorMessage(error)}`,
        severity: "fatal",
        entityIds: construction.outputs,
      });
    }
  }

  for (const entityId of document.requiredEntityIds) {
    const entity = document.entities.find((candidate) => candidate.id === entityId);
    const hasAnnotation = document.annotations.some((annotation) => annotation.targetIds.includes(entityId));
    const annotationPositionedLabel = entity?.kind === "label" && hasAnnotation;
    if (!geometry.has(entityId) && entity?.kind !== "group" && !annotationPositionedLabel) {
      issues.push({ code: "unconstructed_required_entity", message: `Required entity ${entityId} has no deterministic construction`, severity: "fatal", entityIds: [entityId] });
    }
  }

  const constructionOnlyIds = implicitSolverEntityIds(document);
  const entityToGroup = new Map<string, string>();
  document.revealGroups.forEach((group) => group.entityIds.forEach((id) => entityToGroup.set(id, group.id)));
  const geometrySignatures = new Map<string, string[]>();
  const directionOverlayIds = new Set<string>();
  const coincidentPointAliases = new Map<string, string>();
  const coincidentPathAliases = new Map<string, string>();
  for (const [entityId, value] of geometry) {
    if (constructionOnlyIds.has(entityId)) continue;
    if (document.entities.find((entity) => entity.id === entityId)?.kind === "label") continue;
    const signature = geometrySignature(value);
    const groupId = entityToGroup.get(entityId);
    const existingIds = geometrySignatures.get(signature) ?? [];
    const existing = existingIds.find((candidateId) => {
      const candidateGroupId = entityToGroup.get(candidateId);
      return candidateGroupId === groupId || !candidateGroupId || !groupId;
    });
    if (existing) {
      const existingValue = geometry.get(existing);
      const sameRevealGroup = entityToGroup.get(existing) === groupId;
      const coincidentPoint = sameRevealGroup && existingValue?.kind === "point" && value.kind === "point";
      const overlayId = sameRevealGroup
        ? directionOverlayEntity(existing, existingValue, entityId, value)
        : null;
      if (coincidentPoint) {
        const existingLabel = document.entities.find((entity) => entity.id === existing)?.label?.trim();
        const currentLabel = document.entities.find((entity) => entity.id === entityId)?.label?.trim();
        if (currentLabel && !existingLabel) {
          coincidentPointAliases.set(existing, entityId);
          geometrySignatures.set(signature, existingIds.map((id) => id === existing ? entityId : id));
        } else {
          coincidentPointAliases.set(entityId, existing);
        }
      }
      else if (
        sameRevealGroup &&
        (explicitlyParallelPathAliases(document, existing, existingValue, entityId, value) ||
          coincidentPhasorAliases(document, existing, existingValue, entityId, value) ||
          coincidentAxisRayAliases(document, existing, existingValue, entityId, value) ||
          coincidentIncidentReflectionAliases(document, existing, existingValue, entityId, value) ||
          coincidentSupportingLineAliases(existingValue, value))
      ) {
        coincidentPathAliases.set(entityId, existing);
      }
      else if (overlayId) directionOverlayIds.add(overlayId);
      else issues.push({ code: "duplicate_geometry", message: `${entityId} duplicates ${existing}`, severity: "fatal", entityIds: [existing, entityId] });
    } else {
      geometrySignatures.set(signature, [...existingIds, entityId]);
    }
  }

  for (const assertion of document.assertions) validateAssertion(assertion, geometry, document, issues);
  if (issues.some((issue) => issue.severity === "fatal")) return { ok: false, renderScene: null, report: report(document, issues, 0) };

  const viewport: Viewport = options.viewport ?? { x: 410, y: 55, width: 740, height: 555, padding: 24 };
  const hasLabels = document.entities.some((entity) => Boolean(entity.label)) ||
    document.annotations.some((annotation) =>
      (annotation.kind === "label" || annotation.kind === "callout") &&
      Boolean(annotation.kind === "callout"
        ? compactCalloutLabel(annotation.text)
        : annotation.text),
    );
  const transformPlan = createEntityTransformPlan(
    document,
    geometry,
    constructionOnlyIds,
    entityToGroup,
    viewport,
    hasLabels,
  );
  if (!transformPlan) {
    issues.push({ code: "empty_geometry", message: "Scene has no finite geometry to render", severity: "fatal" });
    return { ok: false, renderScene: null, report: report(document, issues, 0) };
  }

  const finiteIncomingIds = new Set(
    document.constructions
      .filter((construction) => construction.operator === "reflect_direction" || construction.operator === "refract_direction")
      .map((construction) => construction.inputs.incoming)
      .filter((value): value is string => typeof value === "string"),
  );
  const dimensionLanes = computeDimensionLaneOffsets(document, geometry, entityToGroup);
  const primitives: RenderPrimitive[] = [];
  const renderableIds = new Set(document.requiredEntityIds);
  for (const entity of document.entities) {
    if (!renderableIds.has(entity.id)) continue;
    if (coincidentPointAliases.has(entity.id)) continue;
    if (coincidentPathAliases.has(entity.id)) continue;
    const value = geometry.get(entity.id);
    const groupId = entityToGroup.get(entity.id);
    if (value && groupId && !constructionOnlyIds.has(entity.id) && entity.kind !== "label") {
      primitives.push(...toPrimitives(
        entity.id,
        entity.kind,
        value,
        groupId,
        transformPlan.transformFor(entity.id),
        transformPlan.viewportFor(entity.id),
        finiteIncomingIds.has(entity.id),
        dimensionLanes.get(entity.id) ?? 0,
        undefined,
        entity.provenance,
        directionOverlayIds.has(entity.id),
      ));
    }
  }

  const labelOwners: LabelOwner[] = [];
  const consumedAnnotationIds = new Set<string>();
  const summaryLabelIds = new Set<string>();
  for (const entity of document.entities) {
    if (!entity.label || !renderableIds.has(entity.id) || constructionOnlyIds.has(entity.id)) continue;
    const semanticDirectionMarker = entity.kind === "label" && isPageNormalMarker(entity.label);
    if (entity.kind === "label" && !semanticDirectionMarker && document.annotations.some((annotation) =>
      (annotation.kind === "label" || annotation.kind === "callout") &&
      annotation.targetIds.includes(entity.id) &&
      Boolean(annotation.kind === "callout"
        ? compactCalloutLabel(annotation.text)
        : annotation.text),
    )) continue;
    const target = geometry.get(entity.id);
    if (!target) continue;
    const valueAnnotation = entity.kind === "component" && isComponentDesignator(entity.label)
      ? document.annotations.find((annotation) =>
          annotation.kind === "label" &&
          annotation.targetIds.includes(entity.id) &&
          Boolean(annotation.text) &&
          annotation.text !== entity.label,
        )
      : undefined;
    const explicitAnnotation = document.annotations.find((annotation) =>
      (annotation.kind === "label" || annotation.kind === "callout") &&
      !annotation.quantityId &&
      !(annotation.kind === "callout" && isViewSummaryText(annotation.text)) &&
      annotation.targetIds.includes(entity.id) &&
      Boolean(annotation.kind === "callout"
        ? compactCalloutLabel(annotation.text)
        : annotation.text),
    );
    const quantityText = entity.kind === "component" && isComponentDesignator(entity.label)
      ? matchingQuantityText(entity.label, document.quantities)
      : undefined;
    const supplementalText = valueAnnotation?.text ?? quantityText;
    const combinedText = supplementalText
      ? `${entity.label} ${supplementalText}`
      : entity.label;
    const useCombinedText = Boolean(supplementalText) && combinedText.length <= 16;
    if (valueAnnotation && useCombinedText) consumedAnnotationIds.add(valueAnnotation.id);
    if (explicitAnnotation && !useCombinedText && !semanticDirectionMarker) continue;
    labelOwners.push({
      labelId: `primitive_${entity.id}_label`,
      entityId: entity.id,
      anchor: transformPlan.transformFor(entity.id)(centerOf(target)),
      text: useCombinedText ? combinedText : entity.label,
      viewBounds: transformPlan.viewportFor(entity.id),
    });
  }
  for (const annotation of document.annotations) {
    if (consumedAnnotationIds.has(annotation.id)) continue;
    // Narration and timeline metadata are not drawable ink. They may target a
    // semantic group that intentionally has no geometry of its own.
    if (annotation.kind !== "label" && annotation.kind !== "callout") continue;
    const targetId = annotation.targetIds[0];
    if (!targetId) continue;
    const target = geometry.get(targetId);
    const targetEntity = document.entities.find((entity) => entity.id === targetId);
    const groupId = entityToGroup.get(targetId);
    const summaryText = (
      (annotation.kind === "callout" && isViewSummaryText(annotation.text)) ||
      (Boolean(annotation.quantityId) && Boolean(targetEntity?.label))
    )
      ? compactCalloutLabel(annotation.text)
      : undefined;
    if (groupId && summaryText) {
      summaryLabelIds.add(annotation.id);
      const groupPrimitives = primitives.filter((primitive) => primitive.groupId === groupId);
      const groupBounds = boundsForPrimitives(groupPrimitives);
      const memberId = document.revealGroups
        .find((group) => group.id === groupId)
        ?.entityIds.find((id) => geometry.has(id));
      const groupViewport = memberId ? transformPlan.viewportFor(memberId) : viewport;
      const estimatedWidth = summaryText.length * 13 + 8;
      const anchorX = groupBounds
        ? Math.min(
            groupViewport.x + groupViewport.width - estimatedWidth / 2 - 8,
            Math.max(groupViewport.x + estimatedWidth / 2 + 8, groupBounds.x + estimatedWidth / 2),
          )
        : groupViewport.x + estimatedWidth / 2 + 8;
      labelOwners.unshift({
        labelId: annotation.id,
        entityId: targetId,
        anchor: {
          x: anchorX,
          y: groupViewport.y + 46,
        },
        text: summaryText,
        preferredSlot: "north",
        viewBounds: groupViewport,
        useOwnerBounds: false,
      });
      continue;
    }
    if (targetEntity?.kind === "label" && annotation.text) {
      const groupPrimitives = groupId
        ? primitives.filter((primitive) => primitive.groupId === groupId)
        : [];
      const groupBounds = boundsForPrimitives(groupPrimitives);
      const memberId = document.revealGroups
        .find((group) => group.id === groupId)
        ?.entityIds.find((id) => geometry.has(id) && id !== targetId);
      const groupViewport = memberId ? transformPlan.viewportFor(memberId) : viewport;
      const preferredSlot = placementSlot(annotation.placementIntent) ?? "north";
      const useBottom = preferredSlot === "south" || preferredSlot === "southeast" || preferredSlot === "southwest";
      const anchor = groupBounds
        ? {
            x: groupBounds.x + groupBounds.width / 2,
            y: useBottom ? groupBounds.y + groupBounds.height : groupBounds.y,
          }
        : { x: groupViewport.x + groupViewport.width / 2, y: groupViewport.y + 10 };
      const text = annotation.kind === "callout"
        ? compactCalloutLabel(annotation.text)
        : annotation.text;
      if (text) labelOwners.push({
        labelId: annotation.id,
        entityId: targetId,
        anchor,
        text,
        preferredSlot,
        viewBounds: groupViewport,
      });
      continue;
    }
    if (!target) {
      if (targetEntity?.kind === "group" && annotation.kind === "label" && annotation.text) {
        const groupId = entityToGroup.get(targetId);
        const groupPrimitives = groupId
          ? primitives.filter((primitive) => primitive.groupId === groupId)
          : [];
        const groupBounds = boundsForPrimitives(groupPrimitives);
        const memberId = document.revealGroups
          .find((group) => group.id === groupId)
          ?.entityIds.find((id) => geometry.has(id));
        const groupViewport = memberId ? transformPlan.viewportFor(memberId) : viewport;
        labelOwners.push({
          labelId: annotation.id,
          entityId: targetId,
          anchor: groupBounds
            ? { x: groupBounds.x + groupBounds.width / 2, y: groupBounds.y }
            : { x: groupViewport.x + groupViewport.width / 2, y: groupViewport.y + 10 },
          text: annotation.text,
          preferredSlot: placementSlot(annotation.placementIntent) ?? "north",
          viewBounds: groupViewport,
        });
        continue;
      }
      issues.push({ code: "annotation_target_unrendered", message: `Annotation ${annotation.id} target is not rendered`, severity: annotation.kind === "callout" ? "warning" : "fatal", entityIds: [targetId] });
      continue;
    }
    const center = transformPlan.transformFor(targetId)(centerOf(target));
    if (annotation.kind === "label" || annotation.kind === "callout") {
      const rawText = annotation.text ?? document.entities.find((entity) => entity.id === targetId)?.label;
      const text = annotation.kind === "callout" ? compactCalloutLabel(rawText) : rawText;
      if (text) labelOwners.push({
        labelId: annotation.id,
        entityId: targetId,
        anchor: center,
        text,
        preferredSlot: placementSlot(annotation.placementIntent),
        viewBounds: transformPlan.viewportFor(targetId),
      });
    }
  }

  const uniqueLabelOwners = labelOwners.filter((owner, index, all) => {
    if (owner.labelId && summaryLabelIds.has(owner.labelId)) {
      return all.findIndex((candidate) => candidate.labelId === owner.labelId) === index;
    }
    return all.findIndex((candidate) =>
      candidate.entityId === owner.entityId &&
      (!candidate.labelId || !summaryLabelIds.has(candidate.labelId))
    ) === index;
  });
  const labels = placeLabels(uniqueLabelOwners, obstaclesFromPrimitives(primitives));
  for (const issue of labels.issues) {
    issues.push({
      code: issue.code,
      message: issue.message,
      severity: "fatal",
      entityIds: [issue.entityId, ...(issue.overlappingIds ?? [])],
    });
  }
  for (const placement of labels.placements) {
    const groupId = entityToGroup.get(placement.entityId);
    if (!groupId) continue;
    // A leader rendered with the same stroke as scene geometry is easily
    // mistaken for a ray or wire. Labels may use a distant collision-free slot,
    // but remain text-only until a distinct callout stroke style is available.
    primitives.push({
      id: placement.labelId,
      entityId: placement.entityId,
      groupId,
      kind: "label",
      points: [{
        x: round(placement.bounds.x + placement.bounds.width / 2),
        y: round(placement.bounds.y + placement.bounds.height / 2),
      }],
      text: placement.text,
      labelPlacement: "absolute",
    });
  }

  const renderedIds = new Set([
    ...primitives.map((primitive) => primitive.entityId),
    ...coincidentPointAliases.keys(),
    ...coincidentPathAliases.keys(),
  ]);
  for (const id of document.requiredEntityIds) {
    if (!renderedIds.has(id) && !constructionOnlyIds.has(id)) issues.push({ code: "required_entity_not_rendered", message: `Required entity ${id} produced no render primitive`, severity: "fatal", entityIds: [id] });
  }
  if (issues.some((issue) => issue.severity === "fatal")) return { ok: false, renderScene: null, report: report(document, issues, primitives.length) };
  pushDegenerateProjectedGeometryIssues(geometry, primitives, constructionOnlyIds, issues);
  if (issues.some((issue) => issue.severity === "fatal")) return { ok: false, renderScene: null, report: report(document, issues, primitives.length) };

  const entityBounds: Record<string, { x: number; y: number; width: number; height: number }> = {};
  for (const primitive of primitives) {
    const points = primitive.kind === "circle" || primitive.kind === "arc"
      ? circleBounds(primitive.points[0]!, primitive.radius ?? 0)
      : primitive.points;
    const bounds = boundsOf(points);
    const current = entityBounds[primitive.entityId];
    entityBounds[primitive.entityId] = current ? unionBounds(current, bounds) : bounds;
  }
  for (const [aliasId, renderedId] of coincidentPointAliases) {
    const bounds = entityBounds[renderedId];
    if (bounds) entityBounds[aliasId] = bounds;
  }

  return {
    ok: true,
    renderScene: { engineVersion: SCENE_ENGINE_VERSION, primitives, revealGroups: document.revealGroups, timeline: document.teachingTimeline, entityBounds },
    report: report(document, issues, primitives.length),
  };
}

function isPageNormalMarker(value: string): boolean {
  return ["×", "⊗", "•", "⊙"].includes(value.trim());
}

function compactCalloutLabel(text: string | undefined): string | undefined {
  const normalized = text?.trim();
  if (!normalized) return undefined;
  if (normalized.length <= 16) return normalized;
  const compactResult = normalized
    .replace(/R_?eq\s*,\s*(?:series|parallel)\s*=/i, "R_eq =")
    .replace(/\s+/g, " ");
  if (compactResult.length <= 16) return compactResult;
  const directionalPrefix = compactResult.match(
    /^(.{1,16}?)(?:\s+(?:toward|towards|to the|into|out of|leftward|rightward|upward|downward|clockwise|counterclockwise)\b)/i,
  )?.[1]?.trim();
  if (directionalPrefix) return directionalPrefix;
  const head = normalized.split(/[(:,;]/, 1)[0]?.trim();
  if (head && head.length <= 16) return head;
  return undefined;
}

function isComponentDesignator(text: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_₀-₉]{0,7}$/.test(text.trim());
}

function matchingQuantityText(
  designator: string,
  quantities: SceneDocument["quantities"],
): string | undefined {
  const key = normalizeIdentifier(designator);
  const quantity = quantities.find((candidate) =>
    normalizeIdentifier(candidate.id) === key ||
    (typeof candidate.symbol === "string" && normalizeIdentifier(candidate.symbol) === key),
  );
  if (!quantity) return undefined;
  if (typeof quantity.label === "string" && quantity.label.trim()) return quantity.label.trim();
  const value = quantity.value;
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const unit = typeof quantity.unit === "string" && !/^(?:1|dimensionless)$/i.test(quantity.unit.trim())
    ? ` ${quantity.unit.trim()}`
    : "";
  return `${value}${unit}`;
}

function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase().replace(/[₀-₉]/g, (digit) =>
    String("₀₁₂₃₄₅₆₇₈₉".indexOf(digit)),
  );
}

function isViewSummaryText(text: string | undefined): boolean {
  const normalized = text?.trim() ?? "";
  return /^(?:series|parallel|result|equivalent|total|answer|fbd|free[- ]body)\b/i.test(normalized) ||
    /^[A-Za-z][A-Za-z0-9_₀-₉,]*\s*=/.test(normalized);
}

function boundsForPrimitives(
  primitives: RenderPrimitive[],
): { x: number; y: number; width: number; height: number } | null {
  let combined: { x: number; y: number; width: number; height: number } | null = null;
  for (const primitive of primitives) {
    if (primitive.points.length === 0) continue;
    const points = primitive.kind === "circle" || primitive.kind === "arc"
      ? circleBounds(primitive.points[0]!, primitive.radius ?? 0)
      : primitive.points;
    const next = boundsOf(points);
    combined = combined ? unionBounds(combined, next) : next;
  }
  return combined;
}

function placementSlot(intent: string | undefined): LabelOwner["preferredSlot"] {
  switch (intent?.toLowerCase()) {
    case "above": return "north";
    case "below": return "south";
    case "left": return "west";
    case "right": return "east";
    case "upper-left":
    case "above-left":
    case "above_left": return "northwest";
    case "upper-right":
    case "above-right":
    case "above_right": return "northeast";
    case "lower-left":
    case "below-left":
    case "below_left": return "southwest";
    case "lower-right":
    case "below-right":
    case "below_right": return "southeast";
    default: return undefined;
  }
}

interface EntityTransformPlan {
  transformFor: (entityId: string) => (point: Point) => RenderPoint;
  viewportFor: (entityId: string) => Viewport;
}

function createEntityTransformPlan(
  document: SceneDocument,
  geometry: Map<string, Geometry>,
  constructionOnlyIds: Set<string>,
  entityToGroup: Map<string, string>,
  viewport: Viewport,
  hasLabels: boolean,
): EntityTransformPlan | null {
  const renderGeometry = [...geometry.entries()].filter(([id]) => !constructionOnlyIds.has(id));
  const fallbackViewport = withLabelPadding(viewport, hasLabels);
  const fitEntries = renderGeometry.filter(([id]) =>
    document.entities.find((entity) => entity.id === id)?.kind !== "label",
  );
  const fallback = createTransform(
    (fitEntries.length > 0 ? fitEntries : renderGeometry).map(([, value]) => value),
    fallbackViewport,
  );
  if (!fallback) return null;

  const components = constructionComponents(document, geometry)
    .map((ids) => ({
      ids,
      renderIds: ids.filter((id) => geometry.has(id) && !constructionOnlyIds.has(id) && entityToGroup.has(id)),
    }))
    .filter((component) => component.renderIds.length > 0);
  const componentGroups = components.map((component) =>
    [...new Set(component.renderIds.map((id) => entityToGroup.get(id)!).filter(Boolean))],
  );
  const distinctGroups = new Set(componentGroups.flat());
  const canPack = components.length > 1 &&
    componentGroups.every((groups) => groups.length === 1) &&
    distinctGroups.size === components.length;
  if (!canPack) {
    return { transformFor: () => fallback, viewportFor: () => viewport };
  }

  const groupOrder = new Map(document.revealGroups.map((group, index) => [group.id, index]));
  const ordered = components
    .map((component, index) => ({ component, groupId: componentGroups[index]![0]! }))
    .sort((a, b) => (groupOrder.get(a.groupId) ?? 0) - (groupOrder.get(b.groupId) ?? 0));
  const slots = viewSlots(viewport, ordered.length);
  const transformByEntity = new Map<string, (point: Point) => RenderPoint>();
  const viewportByEntity = new Map<string, Viewport>();
  ordered.forEach(({ component }, index) => {
    const slot = slots[index]!;
    const values = component.ids.flatMap((id) => {
      const value = geometry.get(id);
      const kind = document.entities.find((entity) => entity.id === id)?.kind;
      return value && !constructionOnlyIds.has(id) && kind !== "label" ? [value] : [];
    });
    const componentTransform = createTransform(values, withLabelPadding(slot, hasLabels));
    if (!componentTransform) return;
    component.ids.forEach((id) => {
      transformByEntity.set(id, componentTransform);
      viewportByEntity.set(id, slot);
    });
  });
  return {
    transformFor: (entityId) => transformByEntity.get(entityId) ?? fallback,
    viewportFor: (entityId) => viewportByEntity.get(entityId) ?? viewport,
  };
}

function constructionComponents(document: SceneDocument, geometry: Map<string, Geometry>): string[][] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };
  geometry.forEach((_, id) => parent.set(id, id));
  for (const construction of document.constructions) {
    const ids = construction.outputs.filter((id) => geometry.has(id));
    collectStrings(construction.inputs, (id) => {
      if (geometry.has(id)) ids.push(id);
    });
    const firstId = ids[0];
    if (firstId) ids.slice(1).forEach((id) => union(firstId, id));
  }
  const byRoot = new Map<string, string[]>();
  geometry.forEach((_, id) => byRoot.set(find(id), [...(byRoot.get(find(id)) ?? []), id]));
  return [...byRoot.values()];
}

function viewSlots(viewport: Viewport, count: number): Viewport[] {
  const gap = 40;
  const columns = count <= 2 ? 1 : 2;
  const rows = Math.ceil(count / columns);
  const width = (viewport.width - gap * (columns - 1)) / columns;
  const height = (viewport.height - gap * (rows - 1)) / rows;
  return Array.from({ length: count }, (_, index) => ({
    x: viewport.x + (index % columns) * (width + gap),
    y: viewport.y + Math.floor(index / columns) * (height + gap),
    width,
    height,
    padding: viewport.padding,
  }));
}

function withLabelPadding(viewport: Viewport, hasLabels: boolean): Viewport {
  return hasLabels
    ? { ...viewport, padding: Math.min(64, Math.max(viewport.padding ?? 24, Math.min(viewport.width, viewport.height) * 0.18)) }
    : viewport;
}

function orderConstructionsByDependency(document: SceneDocument): Array<{
  construction: SceneDocument["constructions"][number];
  originalIndex: number;
}> {
  const outputOwner = new Map<string, number>();
  document.constructions.forEach((construction, index) => {
    for (const output of construction.outputs) outputOwner.set(output, index);
  });
  const dependencies = document.constructions.map((construction, index) => {
    const owners = new Set<number>();
    collectStrings(construction.inputs, (value) => {
      const owner = outputOwner.get(value);
      if (owner !== undefined && owner !== index) owners.add(owner);
    });
    return owners;
  });
  const emitted = new Set<number>();
  const ordered: Array<{ construction: SceneDocument["constructions"][number]; originalIndex: number }> = [];
  while (ordered.length < document.constructions.length) {
    let progressed = false;
    document.constructions.forEach((construction, index) => {
      if (emitted.has(index) || ![...dependencies[index]!].every((owner) => emitted.has(owner))) return;
      emitted.add(index);
      ordered.push({ construction, originalIndex: index });
      progressed = true;
    });
    if (progressed) continue;
    document.constructions.forEach((construction, index) => {
      if (!emitted.has(index)) ordered.push({ construction, originalIndex: index });
    });
    break;
  }
  return ordered;
}

function collectStrings(value: unknown, visit: (value: string) => void): void {
  if (typeof value === "string") visit(value);
  else if (Array.isArray(value)) for (const item of value) collectStrings(item, visit);
  else if (isRecord(value)) for (const item of Object.values(value)) collectStrings(item, visit);
}

function evaluateConstruction(
  operator: SupportedSceneConstructionOperator,
  inputs: Record<string, unknown>,
  geometry: Map<string, Geometry>,
  quantities: Map<string, Record<string, unknown>>,
): Geometry[] {
  const point = (names: string[]): Point => resolvePoint(first(inputs, names), geometry);
  const number = (names: string[]): number => resolveNumber(first(inputs, names), quantities);
  switch (operator) {
    case "point": return [{ kind: "point", point: { x: number(["x"]), y: number(["y"]) } }];
    case "label": return [{
      kind: "point",
      point: centerOf(resolveGeometry(first(inputs, ["target", "at", "point"]), geometry)),
    }];
    case "segment": return [{
      kind: "path",
      points: distinctPathPoints(point(["start", "from", "a"]), point(["end", "to", "b"]), operator),
    }];
    case "connect": return [{
      kind: "path",
      points: routedConnectorPoints(
        point(["start", "from", "a"]),
        point(["end", "to", "b"]),
        geometry,
      ),
    }];
    case "line": return [{ kind: "path", points: linePoints(inputs, geometry), infinite: true }];
    case "ray": return [{ kind: "path", points: linePoints(inputs, geometry), directed: true, infinite: true }];
    case "vector": {
      const start = point(["start", "from", "a", "origin"]);
      const explicitDirection = inputs.direction === undefined
        ? null
        : resolveVector(inputs.direction, geometry);
      const hasEndpoint = ["end", "to", "b"].some((name) => inputs[name] !== undefined);
      const endpoint = hasEndpoint
        ? point(["end", "to", "b"])
        : explicitDirection
          ? { x: start.x + explicitDirection.x, y: start.y + explicitDirection.y }
          : linePoints(inputs, geometry)[1];
      const end = explicitDirection
        ? (() => {
            const unit = normalize(explicitDirection);
            const referenceSpan = distance(start, endpoint);
            const span = inputs.length === undefined
              ? (referenceSpan < EPSILON ? 1 : referenceSpan)
              : positive(resolveNumber(inputs.length, quantities), "vector length");
            return { x: start.x + unit.x * span, y: start.y + unit.y * span };
          })()
        : endpoint;
      return [{ kind: "path", points: distinctPathPoints(start, end, "vector"), directed: true }];
    }
    case "circle": return [{ kind: "circle", center: point(["center"]), radius: positive(number(["radius", "r"]), "radius") }];
    case "arc": return [{ kind: "arc", center: point(["center"]), radius: positive(number(["radius", "r"]), "radius"), startAngle: angle(number(["startAngle", "start_angle"]), inputs), endAngle: angle(number(["endAngle", "end_angle"]), inputs) }];
    case "rectangle": {
      const center = point(["center"]); const width = positive(number(["width"]), "width"); const height = positive(number(["height"]), "height");
      return [{ kind: "path", closed: true, points: [{ x: center.x - width / 2, y: center.y - height / 2 }, { x: center.x + width / 2, y: center.y - height / 2 }, { x: center.x + width / 2, y: center.y + height / 2 }, { x: center.x - width / 2, y: center.y + height / 2 }] }];
    }
    case "polygon":
    case "polyline": return [{ kind: "path", closed: operator === "polygon", points: resolvePointArray(first(inputs, ["points", "vertices"]), geometry) }];
    case "axes": return [{ kind: "axes", xMin: number(["xMin", "x_min"]), xMax: number(["xMax", "x_max"]), yMin: number(["yMin", "y_min"]), yMax: number(["yMax", "y_max"]) }];
    case "function_region": return [{ kind: "path", closed: true, points: functionRegionPoints(inputs, geometry, quantities) }];
    case "implicit_curve": return [implicitCurveGeometry(inputs, quantities)];
    case "parametric_curve": return [parametricCurveGeometry(inputs, quantities)];
    case "polar_curve": return [polarCurveGeometry(inputs, quantities)];
    case "tangent_line": return [derivedCurveLine(inputs, geometry, quantities, false)];
    case "normal_line": return [derivedCurveLine(inputs, geometry, quantities, true)];
    case "representative_slice": return [representativeSliceGeometry(inputs, geometry, quantities)];
    case "solid_of_revolution": return [solidOfRevolutionGeometry(inputs, geometry, quantities)];
    case "solid_projection": return [solidProjectionGeometry(inputs, geometry, quantities)];
    case "solid_cross_section": return [solidCrossSectionGeometry(inputs, geometry, quantities)];
    case "wavefront_family": return [wavefrontFamilyGeometry(inputs, geometry, quantities)];
    case "aperture": return [apertureGeometry(inputs, geometry, quantities)];
    case "screen_pattern": return [screenPatternGeometry(inputs, geometry, quantities)];
    case "transverse_field": return [transverseFieldGeometry(inputs, geometry, quantities)];
    case "polarizer": return [polarizerGeometry(inputs, geometry, quantities)];
    case "optical_train": return opticalTrainGeometry(inputs, geometry, quantities);
    case "reflect_at": return surfaceRayBundleGeometry(inputs, geometry, quantities, "reflect");
    case "refract_at": return surfaceRayBundleGeometry(inputs, geometry, quantities, "refract");
    case "midpoint": {
      const a = point(["a", "start"]); const b = point(["b", "end"]); return [{ kind: "point", point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }];
    }
    case "intersection": return [{ kind: "point", point: intersect(resolveLine(first(inputs, ["first", "a", "line1"]), geometry), resolveLine(first(inputs, ["second", "b", "line2"]), geometry)) }];
    case "surface_intersection": {
      const origin = point(["origin", "start"]);
      const direction = resolveContactDirection(origin, inputs, geometry);
      const surface = resolveGeometry(first(inputs, ["surface", "target"]), geometry);
      return [{ kind: "point", point: intersectSurface(origin, direction, surface, inputs.which) }];
    }
    case "surface_contact": {
      const origin = point(["origin", "start"]);
      const direction = resolveContactDirection(origin, inputs, geometry);
      const surface = resolveGeometry(first(inputs, ["surface", "target"]), geometry);
      const hit = intersectSurfaceEitherDirection(origin, direction, surface, inputs.which);
      return [
        { kind: "point", point: hit },
        { kind: "path", directed: true, points: distinctPathPoints(origin, hit, "surface_contact") },
      ];
    }
    case "normal_at": {
      const at = point(["point", "at", "origin"]);
      const surface = resolveGeometry(first(inputs, ["surface", "target"]), geometry);
      const normal = surfaceNormal(at, surface);
      return [{ kind: "path", directed: true, points: [at, { x: at.x + normal.x, y: at.y + normal.y }] }];
    }
    case "translate": {
      const source = point(["point", "source"]); const delta = resolveVector(first(inputs, ["vector", "delta"]), geometry); return [{ kind: "point", point: { x: source.x + delta.x, y: source.y + delta.y } }];
    }
    case "rotate": {
      const source = point(["point", "source"]); const center = point(["center"]); const theta = angle(number(["angle"]), inputs); const dx = source.x - center.x; const dy = source.y - center.y;
      return [{ kind: "point", point: { x: center.x + dx * Math.cos(theta) - dy * Math.sin(theta), y: center.y + dx * Math.sin(theta) + dy * Math.cos(theta) } }];
    }
    case "reflect_point": {
      const source = point(["point", "source"]); const [a, b] = resolveLine(first(inputs, ["line", "axis"]), geometry); return [{ kind: "point", point: reflectPoint(source, a, b) }];
    }
    case "parallel_through":
    case "perpendicular_through": {
      const through = point(["through", "point"]); const [a, b] = resolveLine(first(inputs, ["line", "reference"]), geometry); let direction = { x: b.x - a.x, y: b.y - a.y };
      if (operator === "perpendicular_through") direction = { x: -direction.y, y: direction.x };
      return [{ kind: "path", infinite: true, points: [through, { x: through.x + direction.x, y: through.y + direction.y }] }];
    }
    case "dimension": {
      const [a, b] = distinctPathPoints(point(["start", "from", "a"]), point(["end", "to", "b"]), operator);
      return [{ kind: "dimension", a, b }];
    }
    case "symbol": {
      const start = point(["start", "from", "a"]);
      const end = point(["end", "to", "b"]);
      const symbol = first(inputs, ["symbol"]);
      if (typeof symbol !== "string") throw new Error("symbol must be a string");
      const lane = typeof inputs.__parallelLane === "number" ? inputs.__parallelLane : 0;
      return [{ kind: "compound", paths: routedSymbolPaths(symbol, start, end, lane), terminals: [start, end] }];
    }
    case "vector_components": {
      const origin = point(["origin", "start"]); const vector = resolveVector(first(inputs, ["vector"]), geometry);
      const basisReference = first(inputs, ["basis", "parallelTo", "reference"]);
      if (basisReference !== undefined) {
        const [basisStart, basisEnd] = resolveLine(basisReference, geometry);
        const basis = normalize({ x: basisEnd.x - basisStart.x, y: basisEnd.y - basisStart.y });
        const projection = vector.x * basis.x + vector.y * basis.y;
        const parallel = { x: basis.x * projection, y: basis.y * projection };
        const perpendicular = { x: vector.x - parallel.x, y: vector.y - parallel.y };
        return [
          { kind: "path", directed: true, points: distinctPathPoints(origin, { x: origin.x + parallel.x, y: origin.y + parallel.y }, "parallel component") },
          { kind: "path", directed: true, points: distinctPathPoints(origin, { x: origin.x + perpendicular.x, y: origin.y + perpendicular.y }, "perpendicular component") },
        ];
      }
      return [{ kind: "path", directed: true, points: [origin, { x: origin.x + vector.x, y: origin.y }] }, { kind: "path", directed: true, points: [{ x: origin.x + vector.x, y: origin.y }, { x: origin.x + vector.x, y: origin.y + vector.y }] }];
    }
    case "project": {
      const source = point(["point", "source"]); const [a, b] = resolveLine(first(inputs, ["line", "onto"]), geometry); return [{ kind: "point", point: projectPoint(source, a, b) }];
    }
    case "angle_bisector": {
      const vertex = point(["vertex"]); const a = point(["a", "first"]); const b = point(["b", "second"]); const u = normalize({ x: a.x - vertex.x, y: a.y - vertex.y }); const v = normalize({ x: b.x - vertex.x, y: b.y - vertex.y });
      return [{ kind: "path", infinite: true, points: [vertex, { x: vertex.x + u.x + v.x, y: vertex.y + u.y + v.y }] }];
    }
    case "angle_mark": {
      const vertex = point(["vertex"]);
      const a = resolveAngleArmPoint(first(inputs, ["a", "first"]), vertex, geometry);
      const b = resolveAngleArmPoint(first(inputs, ["b", "second"]), vertex, geometry);
      const radius = inputs.radius === undefined
        ? Math.min(distance(vertex, a), distance(vertex, b)) * 0.2
        : positive(resolveNumber(inputs.radius, quantities), "radius");
      const startAngle = Math.atan2(a.y - vertex.y, a.x - vertex.x);
      let endAngle = Math.atan2(b.y - vertex.y, b.x - vertex.x);
      while (endAngle - startAngle > Math.PI) endAngle -= Math.PI * 2;
      while (endAngle - startAngle < -Math.PI) endAngle += Math.PI * 2;
      return [{ kind: "arc", center: vertex, radius, startAngle, endAngle }];
    }
    case "right_angle_mark": {
      const vertex = point(["vertex"]);
      const a = resolveAngleArmPoint(first(inputs, ["a", "first"]), vertex, geometry);
      const b = resolveAngleArmPoint(first(inputs, ["b", "second"]), vertex, geometry);
      const u = normalize({ x: a.x - vertex.x, y: a.y - vertex.y });
      const v = normalize({ x: b.x - vertex.x, y: b.y - vertex.y });
      const size = inputs.size === undefined
        ? Math.min(distance(vertex, a), distance(vertex, b)) * 0.16
        : positive(resolveNumber(inputs.size, quantities), "size");
      return [{
        kind: "path",
        points: [
          { x: vertex.x + u.x * size, y: vertex.y + u.y * size },
          { x: vertex.x + (u.x + v.x) * size, y: vertex.y + (u.y + v.y) * size },
          { x: vertex.x + v.x * size, y: vertex.y + v.y * size },
        ],
      }];
    }
    case "tick_mark": {
      const [a, b] = resolveLine(first(inputs, ["target", "line", "segment"]), geometry);
      const at = inputs.at === undefined ? 0.5 : resolveNumber(inputs.at, quantities);
      if (at < 0 || at > 1) throw new Error("tick_mark at must be between 0 and 1");
      const span = distance(a, b);
      const size = inputs.size === undefined
        ? span * 0.08
        : positive(resolveNumber(inputs.size, quantities), "size");
      const center = { x: a.x + (b.x - a.x) * at, y: a.y + (b.y - a.y) * at };
      const normal = normalize({ x: -(b.y - a.y), y: b.x - a.x });
      return [{
        kind: "path",
        points: [
          { x: center.x - normal.x * size / 2, y: center.y - normal.y * size / 2 },
          { x: center.x + normal.x * size / 2, y: center.y + normal.y * size / 2 },
        ],
      }];
    }
    case "reflect_direction": {
      const origin = point(["origin", "point"]); const incomingInput = first(inputs, ["incoming", "direction"]); assertPathMeetsOrigin(incomingInput, origin, geometry, "incoming"); const normalInput = first(inputs, ["normal"]); assertPathMeetsOrigin(normalInput, origin, geometry, "normal"); const incoming = resolveVector(incomingInput, geometry); const normal = normalize(resolveVector(normalInput, geometry)); const dot = incoming.x * normal.x + incoming.y * normal.y; const reflected = { x: incoming.x - 2 * dot * normal.x, y: incoming.y - 2 * dot * normal.y };
      return [{ kind: "path", directed: true, infinite: true, points: [origin, { x: origin.x + reflected.x, y: origin.y + reflected.y }] }];
    }
    case "refract_direction": {
      const origin = point(["origin", "point"]); const incomingInput = first(inputs, ["incoming", "direction"]); assertPathMeetsOrigin(incomingInput, origin, geometry, "incoming"); const normalInput = first(inputs, ["normal"]); assertPathMeetsOrigin(normalInput, origin, geometry, "normal"); const incoming = normalize(resolveVector(incomingInput, geometry)); const normal = normalize(resolveVector(normalInput, geometry)); const n1 = positive(number(["n1"]), "n1"); const n2 = positive(number(["n2"]), "n2");
      const refracted = refract(incoming, normal, n1 / n2); return [{ kind: "path", directed: true, infinite: true, points: [origin, { x: origin.x + refracted.x, y: origin.y + refracted.y }] }];
    }
    case "function_curve": return [functionCurveGeometry(inputs, quantities)];
    default: return assertNeverSceneCapability(operator);
  }
}

function validateAssertion(assertion: SceneAssertion, geometry: Map<string, Geometry>, document: SceneDocument, issues: SceneIssue[]): void {
  const severity = assertion.severity;
  const predicate = assertion.predicate;
  const values = assertion.entities.map((id) => geometry.get(id));
  const hasUnconstructedGeometry =
    predicate !== "exists" &&
    predicate !== "label_attached" &&
    values.some((value) => value === undefined);
  if (!isExecutableSceneProofPredicate(predicate)) {
    issues.push(hasUnconstructedGeometry
      ? { code: "assertion_entity_unconstructed", message: `Assertion ${assertion.id} references unconstructed geometry`, severity, entityIds: assertion.entities }
      : { code: "unsupported_assertion", message: `Assertion predicate ${predicate} is not deterministically implemented`, severity: "fatal", entityIds: assertion.entities });
    return;
  }
  if (isTopologySceneProofPredicate(predicate)) {
    evaluateTopologyAssertion(assertion, document, issues);
    return;
  }
  if (hasUnconstructedGeometry) {
    issues.push({ code: "assertion_entity_unconstructed", message: `Assertion ${assertion.id} references unconstructed geometry`, severity, entityIds: assertion.entities });
    return;
  }
  let passed = false;
  let residual: number | undefined;
  try {
    switch (predicate) {
      case "exists": passed = assertion.entities.every((id) => geometry.has(id) || document.entities.some((entity) => entity.id === id)); break;
      case "entity_count": passed = assertion.entities.length === Number(assertion.expected); break;
      case "connected": passed = values.length >= 2 && values.slice(1).every((value) => areConnected(values[0], value, geometry)); break;
      case "incident":
      case "on": {
        const pointGeometry = values[0]?.kind === "point" ? values[0]
          : values[1]?.kind === "point" ? values[1]
            : undefined;
        const support = pointGeometry === values[0] ? values[1] : values[0];
        if (!pointGeometry || !support) break;
        residual = pointGeometryResidual(pointGeometry, support);
        const sampledCurve = support.kind === "path" ? support.sampledCurve : undefined;
        if (sampledCurve) {
          residual = sampledCurveCartesianResidual(sampledCurve, pointGeometry.point, {});
        }
        const exactTolerance = tolerance(assertion);
        const relationTolerance = typeof assertion.tolerance === "number" || !isDerivedDirection(assertion.entities[1], document)
          ? exactTolerance
          : Math.max(exactTolerance, geometryScale(geometry) * 0.005);
        passed = residual < relationTolerance;
        if (!passed) {
          const bodyResidual = rigidBodyContactResidual(values[0], values[1], geometry);
          if (bodyResidual !== null) {
            residual = bodyResidual;
            passed = residual < relationTolerance;
          }
        }
        if (passed && assertion.expected !== false && residual >= exactTolerance) {
          issues.push(approximateRelationIssue(assertion, residual, relationTolerance));
        }
        break;
      }
      case "between": passed = isBetween(asPoint(values[0]), asPoint(values[1]), asPoint(values[2])); break;
      case "parallel": {
        residual = parallelResidual(asLine(values[0]), asLine(values[1]));
        const exactTolerance = tolerance(assertion);
        const relationTolerance = typeof assertion.tolerance === "number" || !assertion.entities.some((id) => isDerivedDirection(id, document))
          ? exactTolerance
          : Math.max(exactTolerance, 0.005);
        passed = residual < relationTolerance;
        if (passed && assertion.expected !== false && residual >= exactTolerance) {
          issues.push(approximateRelationIssue(assertion, residual, relationTolerance));
        }
        break;
      }
      case "perpendicular": residual = perpendicularResidual(asLine(values[0]), asLine(values[1])); passed = residual < tolerance(assertion); break;
      case "collinear": residual = collinearResidual(assertion.entities.map((id) => asPoint(geometry.get(id)))); passed = residual < tolerance(assertion); break;
      case "equal_length": {
        const measured = values.length >= 4 &&
          values.length % 2 === 0 &&
          values.every((value) => value?.kind === "point")
          ? Array.from({ length: values.length / 2 }, (_, index) =>
              distance(asPoint(values[index * 2]), asPoint(values[index * 2 + 1])),
            )
          : values.map((value) => length(asLine(value)));
        if (measured.length < 2) break;
        residual = Math.max(...measured.slice(1).map((value) => Math.abs(value - measured[0]!)));
        passed = residual < tolerance(assertion);
        break;
      }
      case "equal_angle": {
        const markedAngles = values.length === 2 && values.every((value) => value?.kind === "arc")
          ? values as Array<Extract<Geometry, { kind: "arc" }>>
          : null;
        const firstAngle = markedAngles
          ? Math.abs(markedAngles[0]!.endAngle - markedAngles[0]!.startAngle)
          : values.length === 4 ? acuteAngleBetween(asLine(values[0]), asLine(values[1])) : NaN;
        const secondAngle = markedAngles
          ? Math.abs(markedAngles[1]!.endAngle - markedAngles[1]!.startAngle)
          : values.length === 4 ? acuteAngleBetween(asLine(values[2]), asLine(values[3])) : NaN;
        if (!Number.isFinite(firstAngle) || !Number.isFinite(secondAngle)) break;
        residual = Math.abs(firstAngle - secondAngle);
        passed = residual < tolerance(assertion);
        break;
      }
      case "angle_between": {
        if (values.length !== 2) break;
        const expectedAngle = expectedAngleRadians(assertion.expected);
        residual = Math.abs(acuteAngleBetween(asLine(values[0]), asLine(values[1])) - expectedAngle);
        passed = residual < angularTolerance(assertion);
        break;
      }
      case "snells_law": {
        if (values.length !== 3 || !isRecord(assertion.expected)) break;
        const n1 = Number(assertion.expected.n1);
        const n2 = Number(assertion.expected.n2);
        if (!(n1 > 0) || !(n2 > 0)) break;
        const incidentAngle = acuteAngleBetween(asLine(values[0]), asLine(values[1]));
        const refractedAngle = acuteAngleBetween(asLine(values[2]), asLine(values[1]));
        residual = Math.abs(n1 * Math.sin(incidentAngle) - n2 * Math.sin(refractedAngle));
        passed = residual < tolerance(assertion);
        break;
      }
      case "inside": {
        const subject = asPoint(values[0]);
        const boundary = values[1];
        passed = boundary?.kind === "circle"
          ? distance(subject, boundary.center) < boundary.radius - EPSILON
          : boundary?.kind === "path" && boundary.closed === true
            ? pointInsidePolygon(subject, boundary.points)
            : false;
        break;
      }
      case "ordered_along": {
        if (!isRecord(assertion.expected) || values.length < 2) break;
        const axis = assertion.expected.axis;
        const direction = assertion.expected.direction;
        if ((axis !== "x" && axis !== "y") || (direction !== "increasing" && direction !== "decreasing")) break;
        const coordinates = values.map((value) => asPoint(value)[axis]);
        passed = coordinates.slice(1).every((value, index) => direction === "increasing"
          ? value > coordinates[index]! + EPSILON
          : value < coordinates[index]! - EPSILON);
        break;
      }
      case "equal_spacing": {
        const points = values.length === 1 && values[0]?.kind === "multi_path"
          ? values[0].paths.map((path) => path[0]).filter((point): point is Point => point !== undefined)
          : values.map(asPoint);
        if (points.length < 3) break;
        const gaps = points.slice(1).map((point, index) => distance(points[index]!, point));
        residual = Math.max(...gaps.slice(1).map((gap) => Math.abs(gap - gaps[0]!)));
        passed = residual < tolerance(assertion);
        break;
      }
      case "distance_ratio": {
        const ratio = distance(asPoint(values[0]), asPoint(values[1])) /
          distance(asPoint(values[2]), asPoint(values[3]));
        residual = Math.abs(ratio - Number(assertion.expected));
        passed = residual < tolerance(assertion);
        break;
      }
      case "same_side": {
        const firstPoint = asPoint(values[0]);
        const secondPoint = asPoint(values[1]);
        const origin = asPoint(values[2]);
        const dot = (firstPoint.x - origin.x) * (secondPoint.x - origin.x) +
          (firstPoint.y - origin.y) * (secondPoint.y - origin.y);
        passed = dot > EPSILON;
        break;
      }
      case "opposite_direction": {
        const firstLine = asLine(values[0]);
        const secondLine = asLine(values[1]);
        const firstDirection = normalize({ x: firstLine[1].x - firstLine[0].x, y: firstLine[1].y - firstLine[0].y });
        const secondDirection = normalize({ x: secondLine[1].x - secondLine[0].x, y: secondLine[1].y - secondLine[0].y });
        residual = Math.abs(firstDirection.x * secondDirection.y - firstDirection.y * secondDirection.x);
        passed = residual < tolerance(assertion) &&
          firstDirection.x * secondDirection.x + firstDirection.y * secondDirection.y < 0;
        break;
      }
      case "vector_sum": {
        if (values.length < 3) break;
        const lines = values.map((value) => asLine(value));
        const components = lines.slice(0, -1);
        const resultant = lines.at(-1)!;
        const sum = components.reduce(
          (total, line) => ({
            x: total.x + line[1].x - line[0].x,
            y: total.y + line[1].y - line[0].y,
          }),
          { x: 0, y: 0 },
        );
        const actual = {
          x: resultant[1].x - resultant[0].x,
          y: resultant[1].y - resultant[0].y,
        };
        residual = Math.hypot(sum.x - actual.x, sum.y - actual.y);
        const exactTolerance = tolerance(assertion);
        const relationTolerance = typeof assertion.tolerance === "number"
          ? exactTolerance
          : Math.max(exactTolerance, Math.hypot(actual.x, actual.y) * 0.005);
        passed = residual < relationTolerance;
        if (passed && residual >= exactTolerance) {
          issues.push({
            code: "approximate_vector_sum",
            message: `Assertion ${assertion.id} closes within the scale-aware vector tolerance`,
            severity: "warning",
            entityIds: assertion.entities,
            residual,
            expected: { maxResidual: relationTolerance },
          });
        }
        break;
      }
      case "converges": {
        const targetValue = values.at(-1);
        if (values.length >= 3 && targetValue?.kind === "point") {
          const target = asPoint(targetValue);
          const targetLines = values.slice(0, -1);
          const lines = targetLines.map((value) => asLine(value));
          residual = Math.max(...lines.map((line) => pointLineResidual(target, line)));
          const exactTolerance = tolerance(assertion);
          const convergenceTolerance = typeof assertion.tolerance === "number"
            ? exactTolerance
            : Math.max(exactTolerance, geometryScale(geometry) * 0.005);
          passed = lines.length >= 2 &&
            residual < convergenceTolerance &&
            targetLines.every((value) => geometryCanReachTarget(value, target, convergenceTolerance));
          if (passed && residual >= exactTolerance) {
            issues.push({
              code: "approximate_convergence",
              message: `Assertion ${assertion.id} converges within the scale-aware illustration tolerance`,
              severity: "warning",
              entityIds: assertion.entities,
              residual,
              expected: { maxResidual: convergenceTolerance },
            });
          }
        } else {
          const lines = assertion.entities.map((id) => asLine(geometry.get(id)));
          passed = lines.length >= 2 && lines.every((line, index) => index === 0 || distance(intersect(lines[0]!, line), intersect(lines[0]!, lines[1]!)) < tolerance(assertion));
        }
        break;
      }
      case "label_attached": passed = hasAttachedLabel(assertion, document); break;
      case "function_value": {
        const expected = assertion.expected;
        if (!isRecord(expected) || typeof expected.x !== "number" || typeof expected.y !== "number") {
          throw new Error("function_value expected must be {x, y}");
        }
        const sampled = values[0]?.kind === "path" ? values[0].sampledCurve : undefined;
        if (sampled) {
          residual = sampledCurveCartesianResidual(sampled, { x: expected.x, y: expected.y }, expected);
        } else {
          const expression = curveExpression(assertion.entities[0], document);
          residual = Math.abs(expression.evaluate(expected.x) - expected.y);
        }
        passed = residual < tolerance(assertion);
        break;
      }
      case "root": {
        const expected = assertion.expected;
        const x = typeof expected === "number"
          ? expected
          : isRecord(expected) && typeof expected.x === "number" ? expected.x : null;
        if (x === null) throw new Error("root expected must be x or {x}");
        const expression = curveExpression(assertion.entities[0], document);
        residual = Math.abs(expression.evaluate(x));
        passed = residual < tolerance(assertion);
        break;
      }
      case "wave_cycles": {
        const expected = assertion.expected;
        const claimedCycles = typeof expected === "number"
          ? expected
          : isRecord(expected) && typeof expected.cycles === "number" ? expected.cycles : null;
        if (claimedCycles === null || !(claimedCycles > 0)) throw new Error("wave_cycles expected must be cycles or {cycles}");
        const cycleResidual = waveCycleResidual(values[0], claimedCycles);
        if (cycleResidual === null) {
          passed = false;
          break;
        }
        residual = cycleResidual;
        passed = residual < tolerance(assertion);
        break;
      }
      default: return assertNeverSceneCapability(predicate);
    }
  } catch { passed = false; }
  if (assertion.expected === false) passed = !passed;
  if (!passed) issues.push({ code: "assertion_failed", message: assertion.reason ?? `Assertion ${assertion.id} failed`, severity, entityIds: assertion.entities, expected: assertion.expected, residual });
}

function isDerivedDirection(entityId: string | undefined, document: SceneDocument): boolean {
  if (!entityId) return false;
  return document.constructions.some((construction) =>
    (construction.operator === "reflect_direction" || construction.operator === "refract_direction") &&
    construction.outputs.includes(entityId),
  );
}

function approximateRelationIssue(assertion: SceneAssertion, residual: number, maxResidual: number): SceneIssue {
  return {
    code: "approximate_relation",
    message: `Assertion ${assertion.id} holds within the scale-aware physical tolerance`,
    severity: "warning",
    entityIds: assertion.entities,
    residual,
    expected: { maxResidual },
  };
}

const MIN_PLANAR_SCREEN_PX = 12;

function createTransform(values: Geometry[], viewport: { x: number; y: number; width: number; height: number; padding?: number }): ((point: Point) => RenderPoint) | null {
  const points = fitGeometryPoints(values);
  if (points.length === 0) return null;
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const padding = viewport.padding ?? 24;
  const spanX = Math.max(maxX - minX, 0);
  const spanY = Math.max(maxY - minY, 0);
  const innerWidth = viewport.width - 2 * padding;
  const innerHeight = viewport.height - 2 * padding;
  const width = Math.max(spanX, 1);
  const height = Math.max(spanY, 1);
  const uniformScale = Math.min(innerWidth / width, innerHeight / height);
  if (shouldSplitPlotAxes(values, spanX, spanY, uniformScale)) {
    const scaleX = innerWidth / Math.max(spanX, EPSILON);
    const scaleY = innerHeight / Math.max(spanY, EPSILON);
    const offsetX = viewport.x + padding;
    const offsetY = viewport.y + padding;
    return (point) => ({
      x: round(offsetX + (point.x - minX) * scaleX),
      y: round(offsetY + innerHeight - (point.y - minY) * scaleY),
    });
  }
  const usedWidth = width * uniformScale;
  const usedHeight = height * uniformScale;
  const offsetX = viewport.x + (viewport.width - usedWidth) / 2;
  const offsetY = viewport.y + (viewport.height - usedHeight) / 2;
  return (point) => ({
    x: round(offsetX + (point.x - minX) * uniformScale),
    y: round(offsetY + usedHeight - (point.y - minY) * uniformScale),
  });
}

function fitGeometryPoints(values: Geometry[]): Point[] {
  const finite = values.flatMap((value) => {
    if (value.kind === "path" && value.infinite) return [];
    return pointsOf(value);
  }).filter(finitePoint);
  return finite.length > 0 ? finite : values.flatMap(pointsOf).filter(finitePoint);
}

function shouldSplitPlotAxes(
  values: Geometry[],
  spanX: number,
  spanY: number,
  uniformScale: number,
): boolean {
  if (spanX < EPSILON || spanY < EPSILON) return false;
  if (values.some((value) =>
    value.kind === "circle" ||
    value.kind === "arc" ||
    (value.kind === "path" && value.sampledCurve))) {
    return false;
  }
  const rings = planarRings(values);
  if (rings.length === 0 || rings.some((ring) => !ringAxisAligned(ring))) return false;
  return Math.min(spanX, spanY) * uniformScale < MIN_PLANAR_SCREEN_PX;
}

function planarRings(values: Geometry[]): Point[][] {
  return values.flatMap((value) => {
    if (value.kind !== "path" || value.points.length < 3) return [];
    const first = value.points[0]!;
    const last = value.points.at(-1)!;
    const closed = value.closed === true || distance(first, last) < EPSILON;
    const ring = closed && distance(first, last) < EPSILON && value.points.length >= 4
      ? value.points.slice(0, -1)
      : value.points;
    if (ring.length < 3 || Math.abs(polygonArea(ring)) <= EPSILON) return [];
    return [ring];
  });
}

function ringAxisAligned(ring: Point[]): boolean {
  return ring.every((point, index) => {
    const next = ring[(index + 1) % ring.length]!;
    return Math.abs(point.x - next.x) < EPSILON || Math.abs(point.y - next.y) < EPSILON;
  });
}

function polygonArea(polygon: Point[]): number {
  return polygon.reduce((area, point, index) => {
    const next = polygon[(index + 1) % polygon.length]!;
    return area + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function infinitePathFarPoint(start: Point, next: Point): Point {
  return {
    x: start.x + (next.x - start.x) * 1e6,
    y: start.y + (next.y - start.y) * 1e6,
  };
}

function pushDegenerateProjectedGeometryIssues(
  geometry: Map<string, Geometry>,
  primitives: RenderPrimitive[],
  constructionOnlyIds: Set<string>,
  issues: SceneIssue[],
): void {
  const byEntity = new Map<string, RenderPrimitive[]>();
  for (const primitive of primitives) {
    if (primitive.kind === "label") continue;
    byEntity.set(primitive.entityId, [...(byEntity.get(primitive.entityId) ?? []), primitive]);
  }
  geometry.forEach((value, id) => {
    if (constructionOnlyIds.has(id) || planarRings([value]).length === 0) return;
    const rendered = byEntity.get(id) ?? [];
    const points = rendered.flatMap((primitive) => primitive.points);
    if (points.length < 3) return;
    const width = Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x));
    const height = Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y));
    if (Math.min(width, height) >= MIN_PLANAR_SCREEN_PX) return;
    issues.push({
      code: "degenerate_projected_geometry",
      message: `${id} is a 2D region that collapsed to a line on the canvas`,
      severity: "fatal",
      entityIds: [id],
    });
  });
}

function toPrimitives(entityId: string, entityKind: string, value: Geometry, groupId: string, transform: (point: Point) => RenderPoint, viewport: { x: number; y: number; width: number; height: number; padding?: number }, forceFinite: boolean, dimensionOffsetPx = 0, label?: string, provenance?: Record<string, unknown>, directionOverlay = false): RenderPrimitive[] {
  if (value.kind === "point") return [{ id: `primitive_${entityId}`, entityId, groupId, kind: "point", points: [transform(value.point)], text: label, provenance }];
  if (value.kind === "circle") return [{ id: `primitive_${entityId}`, entityId, groupId, kind: "circle", points: [transform(value.center)], radius: distance(transform(value.center), transform({ x: value.center.x + value.radius, y: value.center.y })), text: label, provenance }];
  if (value.kind === "arc") return [{ id: `primitive_${entityId}`, entityId, groupId, kind: "arc", points: [transform(value.center)], radius: distance(transform(value.center), transform({ x: value.center.x + value.radius, y: value.center.y })), startAngle: -value.endAngle, endAngle: -value.startAngle, text: label, provenance }];
  if (value.kind === "axes") return [{ id: `primitive_${entityId}`, entityId, groupId, kind: "axes", points: [transform({ x: value.xMin, y: 0 }), transform({ x: value.xMax, y: 0 }), transform({ x: 0, y: value.yMin }), transform({ x: 0, y: value.yMax })], text: label, provenance }];
  if (value.kind === "dimension") {
    const [start, end] = offsetDimension(transform(value.a), transform(value.b), dimensionOffsetPx);
    return [{ id: `primitive_${entityId}`, entityId, groupId, kind: "dimension", points: [start, end], text: label, provenance }];
  }
  if (value.kind === "multi_path") {
    const primitives: RenderPrimitive[] = value.paths.map((path, index) => ({
      id: `primitive_${entityId}_${index}`,
      entityId,
      groupId,
      kind: "polyline",
      points: path.map(transform),
      provenance,
    }));
    if (label) {
      primitives.push({
        id: `primitive_${entityId}_label`,
        entityId,
        groupId,
        kind: "label",
        points: [transform(centerOf(value))],
        text: label,
        labelPlacement: "automatic",
        provenance,
      });
    }
    return primitives;
  }
  if (value.kind === "compound") {
    const primitives: RenderPrimitive[] = value.paths.map((path, index) => ({
      id: `primitive_${entityId}_${index}`,
      entityId,
      groupId,
      kind: "polyline",
      points: path.map(transform),
      provenance,
    }));
    if (label) {
      primitives.push({
        id: `primitive_${entityId}_label`,
        entityId,
        groupId,
        kind: "label",
        points: [transform(centerOf(value))],
        text: label,
        labelPlacement: "automatic",
        provenance,
      });
    }
    return primitives;
  }
  const kind = entityKind === "ray"
    ? "ray"
    : entityKind === "vector" || value.directed
      ? "vector"
      : value.closed
        ? (value.points.length === 4 ? "rectangle" : "polygon")
        : value.points.length > 2
          ? "polyline"
          : "line";
  const transformedPoints = value.points.map(transform);
  let renderPoints = value.infinite && !forceFinite && value.points.length >= 2
    ? clipInfinitePath(
        transform(value.points[0]!),
        transform(infinitePathFarPoint(value.points[0]!, value.points[1]!)),
        value.directed === true,
        viewport,
      )
    : transformedPoints;
  if (directionOverlay && renderPoints.length >= 2) {
    renderPoints = offsetDirectionMarker(renderPoints[0]!, renderPoints.at(-1)!);
  }
  return [{ id: `primitive_${entityId}`, entityId, groupId, kind, points: renderPoints, text: label, provenance }];
}

function offsetDirectionMarker(start: RenderPoint, end: RenderPoint): RenderPoint[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < EPSILON) return [start, end];
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  const markerLength = Math.min(88, Math.max(30, length * 0.34));
  const offset = 10;
  const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  return [
    { x: round(center.x - ux * markerLength / 2 + nx * offset), y: round(center.y - uy * markerLength / 2 + ny * offset) },
    { x: round(center.x + ux * markerLength / 2 + nx * offset), y: round(center.y + uy * markerLength / 2 + ny * offset) },
  ];
}

function computeDimensionLaneOffsets(
  document: SceneDocument,
  geometry: Map<string, Geometry>,
  entityToGroup: Map<string, string>,
): Map<string, number> {
  const buckets = new Map<string, string[]>();
  for (const construction of document.constructions) {
    if (construction.operator !== "dimension") continue;
    const entityId = construction.outputs[0];
    const value = entityId ? geometry.get(entityId) : undefined;
    if (!entityId || value?.kind !== "dimension") continue;
    const angle = Math.atan2(value.b.y - value.a.y, value.b.x - value.a.x);
    const undirected = ((angle % Math.PI) + Math.PI) % Math.PI;
    const orientationBucket = Math.round(undirected / (Math.PI / 12)) % 12;
    const key = `${entityToGroup.get(entityId) ?? "scene"}:${orientationBucket}`;
    buckets.set(key, [...(buckets.get(key) ?? []), entityId]);
  }
  const offsets = new Map<string, number>();
  for (const ids of buckets.values()) {
    ids.forEach((id, index) => offsets.set(id, (index + 1) * 28));
  }
  return offsets;
}

function offsetDimension(start: RenderPoint, end: RenderPoint, amount: number): [RenderPoint, RenderPoint] {
  if (amount <= 0) return [start, end];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const magnitude = Math.hypot(dx, dy);
  if (magnitude < EPSILON) return [start, end];
  let nx = -dy / magnitude;
  let ny = dx / magnitude;
  if (Math.abs(ny) >= Math.abs(nx)) {
    if (ny < 0) { nx *= -1; ny *= -1; }
  } else if (nx < 0) {
    nx *= -1;
    ny *= -1;
  }
  return [
    { x: round(start.x + nx * amount), y: round(start.y + ny * amount) },
    { x: round(end.x + nx * amount), y: round(end.y + ny * amount) },
  ];
}

function clipInfinitePath(start:RenderPoint,next:RenderPoint,directed:boolean,viewport:{x:number;y:number;width:number;height:number;padding?:number}):RenderPoint[]{
  const padding=viewport.padding??0;const left=viewport.x+padding;const right=viewport.x+viewport.width-padding;const top=viewport.y+padding;const bottom=viewport.y+viewport.height-padding;const dx=next.x-start.x;const dy=next.y-start.y;const hits:Array<{t:number;point:RenderPoint}>=[];
  const add=(t:number,x:number,y:number)=>{if(Number.isFinite(t)&&x>=left-EPSILON&&x<=right+EPSILON&&y>=top-EPSILON&&y<=bottom+EPSILON)hits.push({t,point:{x:round(x),y:round(y)}});};
  if(Math.abs(dx)>EPSILON){let t=(left-start.x)/dx;add(t,left,start.y+t*dy);t=(right-start.x)/dx;add(t,right,start.y+t*dy);}
  if(Math.abs(dy)>EPSILON){let t=(top-start.y)/dy;add(t,start.x+t*dx,top);t=(bottom-start.y)/dy;add(t,start.x+t*dx,bottom);}
  const unique=[...new Map(hits.map((hit)=>[`${hit.point.x}:${hit.point.y}`,hit])).values()].sort((a,b)=>a.t-b.t);
  if(directed){const forward=unique.filter((hit)=>hit.t>EPSILON);return forward.length>0?[start,forward.at(-1)!.point]:[start,next];}
  return unique.length>=2?[unique[0]!.point,unique.at(-1)!.point]:[start,next];
}

function emptyRenderScene(document: SceneDocument) { return { engineVersion: SCENE_ENGINE_VERSION, primitives: [], revealGroups: document.revealGroups, timeline: document.teachingTimeline, entityBounds: {} }; }
function report(document: SceneDocument, issues: SceneIssue[], primitiveCount: number): ValidationReport { return { engineVersion: SCENE_ENGINE_VERSION, valid: !issues.some((issue) => issue.severity === "fatal"), issues, stats: { entityCount: document.entities.length, constructionCount: document.constructions.length, primitiveCount, assertionCount: document.assertions.length } }; }
function first(inputs: Record<string, unknown>, names: string[]): unknown { for (const name of names) if (inputs[name] !== undefined) return inputs[name]; throw new Error(`missing input ${names.join("|")}`); }
function resolveNumber(value: unknown, quantities: Map<string, Record<string, unknown>>): number { if (typeof value === "number" && Number.isFinite(value)) return value; if (typeof value === "string") { const quantity = quantities.get(value); if (quantity) return resolveNumber(quantity.value, quantities); const parsed = Number(value); if (Number.isFinite(parsed)) return parsed; } if (typeof value === "object" && value && "value" in value) return resolveNumber((value as { value: unknown }).value, quantities); throw new Error(`non-numeric value ${String(value)}`); }
function functionCurveGeometry(
  inputs: Record<string, unknown>,
  quantities: Map<string, Record<string, unknown>>,
): Extract<Geometry, { kind: "path" }> {
  if (typeof inputs.expression !== "string") throw new Error("function_curve expression must be a string");
  if (inputs.variable !== undefined && inputs.variable !== "x") throw new Error("function_curve only supports variable x");
  const xMin = resolveNumber(first(inputs, ["xMin", "x_min"]), quantities);
  const xMax = resolveNumber(first(inputs, ["xMax", "x_max"]), quantities);
  if (!(xMin < xMax)) throw new Error("function_curve requires xMin < xMax");
  const samples = curveSampleCount(inputs.samples, quantities, "function_curve");
  const expression = parseMathExpression(inputs.expression);
  expression.assertContinuousOn(xMin, xMax);
  const evaluate = (x: number): Point => ({ x, y: expression.evaluate(x) });
  const points = sampleCurve(evaluate, xMin, xMax, samples);
  // Probe between rendered samples as well, so a domain failure cannot hide
  // between two otherwise finite endpoints.
  for (let index = 1; index < points.length; index += 1) {
    expression.evaluate((points[index - 1]!.x + points[index]!.x) / 2);
  }
  return {
    kind: "path",
    points,
    sampledCurve: { curveKind: "function", parameterMin: xMin, parameterMax: xMax, evaluate },
  };
}

function parametricCurveGeometry(
  inputs: Record<string, unknown>,
  quantities: Map<string, Record<string, unknown>>,
): Extract<Geometry, { kind: "path" }> {
  const parameter = inputs.parameter === undefined ? "t" : inputs.parameter;
  if (parameter !== "t") throw new Error("parametric_curve only supports parameter t");
  if (typeof inputs.xExpression !== "string" || typeof inputs.yExpression !== "string") {
    throw new Error("parametric_curve requires xExpression and yExpression strings");
  }
  const tMin = resolveNumber(first(inputs, ["tMin", "parameterMin"]), quantities);
  const tMax = resolveNumber(first(inputs, ["tMax", "parameterMax"]), quantities);
  if (!(tMin < tMax)) throw new Error("parametric_curve requires tMin < tMax");
  const samples = curveSampleCount(inputs.samples, quantities, "parametric_curve");
  const xExpression = parseParameterizedExpression(inputs.xExpression, "t");
  const yExpression = parseParameterizedExpression(inputs.yExpression, "t");
  xExpression.assertContinuousOn(tMin, tMax);
  yExpression.assertContinuousOn(tMin, tMax);
  const evaluate = (t: number): Point => ({ x: xExpression.evaluate(t), y: yExpression.evaluate(t) });
  return {
    kind: "path",
    points: sampleCurve(evaluate, tMin, tMax, samples),
    sampledCurve: { curveKind: "parametric", parameterMin: tMin, parameterMax: tMax, evaluate },
  };
}

function polarCurveGeometry(
  inputs: Record<string, unknown>,
  quantities: Map<string, Record<string, unknown>>,
): Extract<Geometry, { kind: "path" }> {
  const parameter = inputs.parameter === undefined ? "theta" : inputs.parameter;
  if (parameter !== "theta") throw new Error("polar_curve only supports parameter theta");
  if (typeof inputs.radiusExpression !== "string") throw new Error("polar_curve requires radiusExpression");
  const thetaMin = resolveNumber(first(inputs, ["thetaMin", "parameterMin"]), quantities);
  const thetaMax = resolveNumber(first(inputs, ["thetaMax", "parameterMax"]), quantities);
  if (!(thetaMin < thetaMax)) throw new Error("polar_curve requires thetaMin < thetaMax");
  const samples = curveSampleCount(inputs.samples, quantities, "polar_curve");
  const radiusExpression = parseParameterizedExpression(inputs.radiusExpression, "theta");
  radiusExpression.assertContinuousOn(thetaMin, thetaMax);
  const evaluate = (theta: number): Point => {
    const radius = radiusExpression.evaluate(theta);
    return { x: radius * Math.cos(theta), y: radius * Math.sin(theta) };
  };
  return {
    kind: "path",
    points: sampleCurve(evaluate, thetaMin, thetaMax, samples),
    sampledCurve: { curveKind: "polar", parameterMin: thetaMin, parameterMax: thetaMax, evaluate },
  };
}

const MAX_IMPLICIT_SEGMENTS = 8192;

function implicitCurveGeometry(
  inputs: Record<string, unknown>,
  quantities: Map<string, Record<string, unknown>>,
): Extract<Geometry, { kind: "multi_path" }> {
  if (typeof inputs.expression !== "string") {
    throw new Error("implicit_curve expression must be a string");
  }
  const xMin = resolveNumber(first(inputs, ["xMin"]), quantities);
  const xMax = resolveNumber(first(inputs, ["xMax"]), quantities);
  const yMin = resolveNumber(first(inputs, ["yMin"]), quantities);
  const yMax = resolveNumber(first(inputs, ["yMax"]), quantities);
  if (!(xMin < xMax) || !(yMin < yMax)) {
    throw new Error("implicit_curve requires xMin < xMax and yMin < yMax");
  }
  const xSamples = implicitGridSampleCount(inputs.xSamples, quantities, "xSamples");
  const ySamples = implicitGridSampleCount(inputs.ySamples, quantities, "ySamples");
  const xStep = (xMax - xMin) / (xSamples - 1);
  const yStep = (yMax - yMin) / (ySamples - 1);
  if (xMin + xStep === xMin || yMin + yStep === yMin) {
    throw new Error("implicit_curve domain is too narrow for the requested grid");
  }

  const expression = parseMathExpression2D(inputs.expression);
  expression.assertContinuousOn(xMin, xMax, yMin, yMax);
  const evaluate = (x: number, y: number): number => expression.evaluate(x, y);
  const xs = Array.from({ length: xSamples }, (_, index) => xMin + xStep * index);
  const ys = Array.from({ length: ySamples }, (_, index) => yMin + yStep * index);
  const values = ys.map((y) => xs.map((x) => evaluate(x, y)));

  // Marching squares assumes at most one zero crossing per cell edge. Probe
  // between grid nodes and fail closed instead of aliasing a high-frequency or
  // under-resolved relation into a plausible but false contour.
  for (let yIndex = 0; yIndex < ySamples; yIndex += 1) {
    for (let xIndex = 0; xIndex < xSamples - 1; xIndex += 1) {
      assertSingleImplicitEdgeCrossing(
        evaluate,
        { x: xs[xIndex]!, y: ys[yIndex]! },
        { x: xs[xIndex + 1]!, y: ys[yIndex]! },
      );
    }
  }
  for (let xIndex = 0; xIndex < xSamples; xIndex += 1) {
    for (let yIndex = 0; yIndex < ySamples - 1; yIndex += 1) {
      assertSingleImplicitEdgeCrossing(
        evaluate,
        { x: xs[xIndex]!, y: ys[yIndex]! },
        { x: xs[xIndex]!, y: ys[yIndex + 1]! },
      );
    }
  }

  const segments: Array<[Point, Point]> = [];
  for (let yIndex = 0; yIndex < ySamples - 1; yIndex += 1) {
    for (let xIndex = 0; xIndex < xSamples - 1; xIndex += 1) {
      const corners: [Point, Point, Point, Point] = [
        { x: xs[xIndex]!, y: ys[yIndex]! },
        { x: xs[xIndex + 1]!, y: ys[yIndex]! },
        { x: xs[xIndex + 1]!, y: ys[yIndex + 1]! },
        { x: xs[xIndex]!, y: ys[yIndex + 1]! },
      ];
      const cornerValues: [number, number, number, number] = [
        values[yIndex]![xIndex]!,
        values[yIndex]![xIndex + 1]!,
        values[yIndex + 1]![xIndex + 1]!,
        values[yIndex + 1]![xIndex]!,
      ];
      if (cornerValues.every((value) => value === 0)) {
        throw new Error("implicit_curve is zero throughout a grid cell and has no one-dimensional contour there");
      }
      const mask = cornerValues.reduce(
        (value, cornerValue, cornerIndex) => value | (cornerValue >= 0 ? 1 << cornerIndex : 0),
        0,
      );
      const center = {
        x: (corners[0].x + corners[2].x) / 2,
        y: (corners[0].y + corners[2].y) / 2,
      };
      const centerValue = evaluate(center.x, center.y);
      if ((mask === 0 || mask === 15) && hiddenImplicitContour(cornerValues, centerValue)) {
        throw new Error("implicit_curve grid misses a contour inside a cell; increase xSamples and ySamples");
      }
      const edges = marchingSquareEdges(mask, centerValue, cornerValues);
      const edgePoints = (edge: number): Point => {
        const [startIndex, endIndex] = ([
          [0, 1], [1, 2], [2, 3], [3, 0],
        ] as const)[edge]!;
        return interpolateImplicitZero(
          corners[startIndex],
          corners[endIndex],
          cornerValues[startIndex],
          cornerValues[endIndex],
        );
      };
      for (const [firstEdge, secondEdge] of edges) {
        const start = edgePoints(firstEdge);
        const end = edgePoints(secondEdge);
        if (distance(start, end) <= Math.min(xStep, yStep) * 1e-10) continue;
        segments.push([start, end]);
        if (segments.length > MAX_IMPLICIT_SEGMENTS) {
          throw new Error(`implicit_curve exceeds the ${MAX_IMPLICIT_SEGMENTS}-segment complexity limit`);
        }
      }
    }
  }
  if (segments.length === 0) {
    throw new Error("implicit_curve has no verified zero contour in the requested domain");
  }
  const tolerance = Math.max(
    Math.max(xStep, yStep) * 1e-8,
    Number.EPSILON * Math.max(1, Math.abs(xMin), Math.abs(xMax), Math.abs(yMin), Math.abs(yMax)) * 64,
  );
  const paths = stitchImplicitSegments(segments, tolerance);
  if (paths.length === 0) throw new Error("implicit_curve did not produce a renderable contour");
  return { kind: "multi_path", paths };
}

function implicitGridSampleCount(
  value: unknown,
  quantities: Map<string, Record<string, unknown>>,
  name: string,
): number {
  const samples = value === undefined ? 65 : resolveNumber(value, quantities);
  if (!Number.isInteger(samples) || samples < 17 || samples > 161) {
    throw new Error(`implicit_curve ${name} must be an integer from 17 to 161`);
  }
  return samples;
}

function assertSingleImplicitEdgeCrossing(
  evaluate: (x: number, y: number) => number,
  start: Point,
  end: Point,
): void {
  const signs = [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.sign(evaluate(
    start.x + (end.x - start.x) * ratio,
    start.y + (end.y - start.y) * ratio,
  ))).filter((sign) => sign !== 0);
  let transitions = 0;
  for (let index = 1; index < signs.length; index += 1) {
    if (signs[index] !== signs[index - 1]) transitions += 1;
  }
  if (transitions > 1) {
    throw new Error("implicit_curve grid edge contains multiple zero crossings; increase grid resolution or narrow the domain");
  }
}

function hiddenImplicitContour(
  corners: readonly number[],
  center: number,
): boolean {
  const nonzeroCornerSigns = corners.map(Math.sign).filter((sign) => sign !== 0);
  if (nonzeroCornerSigns.length === 0) return true;
  const cornerSign = nonzeroCornerSigns[0]!;
  return center === 0 || Math.sign(center) !== cornerSign;
}

function marchingSquareEdges(
  mask: number,
  centerValue: number,
  values: readonly [number, number, number, number],
): Array<readonly [number, number]> {
  switch (mask) {
    case 0:
    case 15: return [];
    case 1: return [[3, 0]];
    case 2: return [[0, 1]];
    case 3: return [[3, 1]];
    case 4: return [[1, 2]];
    case 5: {
      const positiveCenter = centerValue > 0 || (
        centerValue === 0 && values[0] * values[2] >= values[1] * values[3]
      );
      return positiveCenter ? [[0, 1], [2, 3]] : [[3, 0], [1, 2]];
    }
    case 6: return [[0, 2]];
    case 7: return [[3, 2]];
    case 8: return [[2, 3]];
    case 9: return [[0, 2]];
    case 10: {
      const positiveCenter = centerValue > 0 || (
        centerValue === 0 && values[1] * values[3] >= values[0] * values[2]
      );
      return positiveCenter ? [[3, 0], [1, 2]] : [[0, 1], [2, 3]];
    }
    case 11: return [[1, 2]];
    case 12: return [[1, 3]];
    case 13: return [[0, 1]];
    case 14: return [[3, 0]];
    default: throw new Error(`invalid marching-square mask ${mask}`);
  }
}

function interpolateImplicitZero(start: Point, end: Point, startValue: number, endValue: number): Point {
  if (startValue === 0) return start;
  if (endValue === 0) return end;
  const denominator = startValue - endValue;
  const ratio = denominator === 0 ? 0.5 : Math.max(0, Math.min(1, startValue / denominator));
  return {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
  };
}

function stitchImplicitSegments(segments: Array<[Point, Point]>, tolerance: number): Point[][] {
  const key = (point: Point) => `${Math.round(point.x / tolerance)}:${Math.round(point.y / tolerance)}`;
  const unique = new Map<string, [Point, Point]>();
  for (const segment of segments) {
    const firstKey = key(segment[0]);
    const secondKey = key(segment[1]);
    if (firstKey === secondKey) continue;
    const signature = firstKey < secondKey
      ? `${firstKey}|${secondKey}`
      : `${secondKey}|${firstKey}`;
    if (!unique.has(signature)) unique.set(signature, segment);
  }
  const values = [...unique.values()];
  const adjacency = new Map<string, number[]>();
  values.forEach((segment, index) => {
    for (const point of segment) adjacency.set(key(point), [...(adjacency.get(key(point)) ?? []), index]);
  });
  const unused = new Set(values.map((_, index) => index));
  const paths: Point[][] = [];
  while (unused.size > 0) {
    const activeDegree = (point: Point) => (adjacency.get(key(point)) ?? [])
      .filter((index) => unused.has(index)).length;
    const seedIndex = [...unused].find((index) => {
      const segment = values[index]!;
      return activeDegree(segment[0]) !== 2 || activeDegree(segment[1]) !== 2;
    }) ?? unused.values().next().value as number;
    const seed = values[seedIndex]!;
    const firstDegree = activeDegree(seed[0]);
    const secondDegree = activeDegree(seed[1]);
    const startSide = firstDegree !== 2 ? 0 : secondDegree !== 2 ? 1 : 0;
    const path = startSide === 0 ? [seed[0], seed[1]] : [seed[1], seed[0]];
    unused.delete(seedIndex);
    const startKey = key(path[0]!);
    while (true) {
      const current = path.at(-1)!;
      const currentKey = key(current);
      if (path.length > 2 && currentKey === startKey) break;
      const candidates = (adjacency.get(currentKey) ?? []).filter((index) => unused.has(index));
      if (candidates.length === 0) break;
      const previous = path[path.length - 2]!;
      const incoming = normalize({ x: current.x - previous.x, y: current.y - previous.y });
      const nextIndex = candidates.sort((leftIndex, rightIndex) => {
        const continuationScore = (index: number): number => {
          const segment = values[index]!;
          const other = key(segment[0]) === currentKey ? segment[1] : segment[0];
          const direction = normalize({ x: other.x - current.x, y: other.y - current.y });
          return incoming.x * direction.x + incoming.y * direction.y;
        };
        return continuationScore(rightIndex) - continuationScore(leftIndex) || leftIndex - rightIndex;
      })[0]!;
      const next = values[nextIndex]!;
      const other = key(next[0]) === currentKey ? next[1] : next[0];
      path.push(other);
      unused.delete(nextIndex);
    }
    if (path.length >= 2) paths.push(path);
  }
  return paths;
}

function derivedCurveLine(
  inputs: Record<string, unknown>,
  geometry: Map<string, Geometry>,
  quantities: Map<string, Record<string, unknown>>,
  normal: boolean,
): Extract<Geometry, { kind: "path" }> {
  const curve = sampledCurveReference(first(inputs, ["curve", "target"]), geometry);
  const at = resolveNumber(first(inputs, ["at", "parameter", "atX"]), quantities);
  const point = curve.evaluate(at);
  const derivative = sampledCurveDerivative(curve, at);
  const direction = normalize(normal ? { x: -derivative.y, y: derivative.x } : derivative);
  const defaultSpan = Math.max(curve.parameterMax - curve.parameterMin, 1) * 0.5;
  const span = inputs.span === undefined ? defaultSpan : positive(resolveNumber(inputs.span, quantities), "span");
  return {
    kind: "path",
    infinite: true,
    points: distinctPathPoints(
      { x: point.x - direction.x * span / 2, y: point.y - direction.y * span / 2 },
      { x: point.x + direction.x * span / 2, y: point.y + direction.y * span / 2 },
      normal ? "normal_line" : "tangent_line",
    ),
  };
}

function representativeSliceMethod(value: unknown): "strip" | "disk" | "washer" {
  if (value === undefined || value === "strip") return "strip";
  if (value === "disk" || value === "washer") return value;
  throw new Error("representative_slice method must be strip, disk, or washer");
}

const REVOLUTION_FORESHORTEN = 0.24;

function revolutionEllipse(atX: number, axisY: number, radius: number): Point[] {
  if (!(radius > EPSILON)) throw new Error("revolution ellipse radius must be positive");
  const rx = radius * REVOLUTION_FORESHORTEN;
  return Array.from({ length: 33 }, (_, index) => ({
    x: atX + rx * Math.sin((Math.PI * 2 * index) / 32),
    y: axisY + radius * Math.cos((Math.PI * 2 * index) / 32),
  }));
}

function representativeSliceGeometry(
  inputs: Record<string, unknown>,
  geometry: Map<string, Geometry>,
  quantities: Map<string, Record<string, unknown>>,
): Geometry {
  const upper = functionCurveReference(first(inputs, ["upper", "top"]), geometry, "representative_slice upper");
  const lower = functionCurveReference(first(inputs, ["lower", "bottom"]), geometry, "representative_slice lower");
  const atX = resolveNumber(first(inputs, ["atX", "x", "at"]), quantities);
  assertParameterInDomain(upper, atX, "representative_slice");
  assertParameterInDomain(lower, atX, "representative_slice");
  const upperPoint = upper.evaluate(atX);
  const lowerPoint = lower.evaluate(atX);
  if (!(upperPoint.y > lowerPoint.y + EPSILON)) {
    throw new Error("representative_slice requires upper curve to be strictly above lower curve at atX");
  }
  const method = representativeSliceMethod(inputs.method);
  if (method === "strip") {
    return { kind: "path", points: [lowerPoint, upperPoint] };
  }
  const axisY = inputs.axisY === undefined ? 0 : resolveNumber(inputs.axisY, quantities);
  const upperRadius = Math.abs(upperPoint.y - axisY);
  const lowerRadius = Math.abs(lowerPoint.y - axisY);
  const outer = Math.max(upperRadius, lowerRadius);
  const inner = Math.min(upperRadius, lowerRadius);
  if (!(outer > EPSILON)) {
    throw new Error("representative_slice disk/washer radius must be positive");
  }
  if (method === "disk" && inner > EPSILON) {
    throw new Error("representative_slice method disk requires the inner curve to meet the axis");
  }
  if (method === "washer" && (!(inner > EPSILON) || !(outer - inner > EPSILON))) {
    throw new Error("representative_slice method washer requires distinct positive inner and outer radii");
  }
  const paths = [revolutionEllipse(atX, axisY, outer)];
  if (method === "washer") paths.push(revolutionEllipse(atX, axisY, inner));
  paths.push([
    { x: atX, y: axisY - outer },
    { x: atX, y: axisY + outer },
  ]);
  return { kind: "multi_path", paths };
}

function solidOfRevolutionGeometry(
  inputs: Record<string, unknown>,
  geometry: Map<string, Geometry>,
  quantities: Map<string, Record<string, unknown>>,
): Extract<Geometry, { kind: "compound" }> {
  const curve = functionCurveReference(first(inputs, ["profile", "curve"]), geometry, "solid_of_revolution profile");
  const xMin = inputs.xMin === undefined ? curve.parameterMin : resolveNumber(inputs.xMin, quantities);
  const xMax = inputs.xMax === undefined ? curve.parameterMax : resolveNumber(inputs.xMax, quantities);
  if (!(xMin < xMax) || xMin < curve.parameterMin - EPSILON || xMax > curve.parameterMax + EPSILON) {
    throw new Error("solid_of_revolution requires xMin < xMax within the profile domain");
  }
  const axisY = inputs.axisY === undefined ? 0 : resolveNumber(inputs.axisY, quantities);
  const samples = curveSampleCount(inputs.samples, quantities, "solid_of_revolution");
  const profile = sampleCurve(curve.evaluate, xMin, xMax, samples);
  const signedRadii = profile.map((point) => point.y - axisY);
  const nonzero = signedRadii.filter((radius) => Math.abs(radius) > EPSILON);
  if (nonzero.length === 0) throw new Error("solid_of_revolution profile cannot lie entirely on its axis");
  const side = Math.sign(nonzero[0]!);
  if (signedRadii.some((radius, index) => Math.abs(radius) <= EPSILON && index > 0 && index < signedRadii.length - 1)) {
    throw new Error("solid_of_revolution profile may meet its axis only at domain endpoints");
  }
  if (nonzero.some((radius) => Math.sign(radius) !== side)) {
    throw new Error("solid_of_revolution profile must remain on one side of its axis");
  }
  const mirrored = profile.map((point) => ({ x: point.x, y: 2 * axisY - point.y })).reverse();
  const start = profile[0]!;
  const end = profile.at(-1)!;
  const paths = [profile, mirrored];
  const startRadius = Math.abs(start.y - axisY);
  const endRadius = Math.abs(end.y - axisY);
  if (startRadius > EPSILON) paths.push(revolutionEllipse(start.x, axisY, startRadius));
  if (endRadius > EPSILON) paths.push(revolutionEllipse(end.x, axisY, endRadius));
  return { kind: "compound", paths, terminals: [start, end] };
}

function solidProjectionGeometry(
  inputs: Record<string, unknown>,
  geometry: Map<string, Geometry>,
  quantities: Map<string, Record<string, unknown>>,
): Extract<Geometry, { kind: "compound" }> {
  const kind = inputs.kind;
  if (!isSolidProjectionKind(kind)) throw new Error(`unsupported solid_projection kind ${String(kind)}`);
  const center = resolvePoint(first(inputs, ["center"]), geometry);
  const radius = positive(resolveNumber(first(inputs, ["radius"]), quantities), "radius");
  const axis = inputs.axis === undefined ? "vertical" : inputs.axis;
  if (axis !== "vertical" && axis !== "horizontal") {
    throw new Error("solid_projection axis must be vertical or horizontal");
  }
  const needsHeight = kind === "cylinder" || kind === "cone" || kind === "frustum";
  const height = needsHeight
    ? positive(resolveNumber(first(inputs, ["height"]), quantities), "height")
    : radius * (kind === "sphere" ? 2 : 1);
  const topRadius = kind === "frustum"
    ? positive(resolveNumber(first(inputs, ["topRadius"]), quantities), "topRadius")
    : kind === "cylinder" ? radius : 0;
  if (kind === "frustum" && Math.abs(topRadius - radius) <= EPSILON) {
    throw new Error("frustum topRadius must differ from radius; use cylinder for equal radii");
  }

  const solid: SolidProjection = { kind, center, radius, height, topRadius, axis };
  const paths = solidProjectionPaths(solid);
  assertConnectedProjectionTopology(kind, paths);
  const extents = solidProjectionExtents(solid);
  return { kind: "compound", paths, terminals: extents, solidProjection: solid };
}

function solidCrossSectionGeometry(
  inputs: Record<string, unknown>,
  geometry: Map<string, Geometry>,
  quantities: Map<string, Record<string, unknown>>,
): Extract<Geometry, { kind: "path" }> {
  const solidId = first(inputs, ["solid"]);
  if (typeof solidId !== "string") throw new Error("solid_cross_section solid must reference a solid_projection");
  const solidGeometry = geometry.get(solidId);
  const solid = solidGeometry?.kind === "compound" ? solidGeometry.solidProjection : undefined;
  if (!solid) throw new Error(`${solidId} is not a solid_projection`);
  const at = resolveNumber(first(inputs, ["at"]), quantities);
  if (!(at > 0 && at < 1)) throw new Error("solid_cross_section at must be strictly between 0 and 1");
  const plane = inputs.plane === undefined ? "transverse" : inputs.plane;
  if (plane !== "transverse") throw new Error("solid_cross_section currently supports plane transverse only");

  const { axial, radius } = solidCrossSectionDimensions(solid, at);
  if (!(radius > EPSILON) || !Number.isFinite(axial) || !Number.isFinite(radius)) {
    throw new Error("solid_cross_section produced a degenerate section");
  }
  const points = projectionEllipse(solid, axial, radius);
  if (points.length < 4 || distance(points[0]!, points.at(-1)!) > EPSILON) {
    throw new Error("solid_cross_section must produce a closed finite contour");
  }
  return { kind: "path", points };
}

function wavefrontFamilyGeometry(
  inputs: Record<string, unknown>,
  geometry: Map<string, Geometry>,
  quantities: Map<string, Record<string, unknown>>,
): Extract<Geometry, { kind: "multi_path" }> {
  const origin = resolvePoint(first(inputs, ["origin", "center"]), geometry);
  const direction = normalize(resolveVector(first(inputs, ["direction"]), geometry));
  const shape = inputs.shape;
  if (shape !== "plane" && shape !== "circular") throw new Error("wavefront_family shape must be plane or circular");
  const count = boundedInteger(resolveNumber(first(inputs, ["count"]), quantities), 1, 12, "wavefront count");
  const spacing = positive(resolveNumber(first(inputs, ["spacing"]), quantities), "wavefront spacing");
  const span = positive(resolveNumber(first(inputs, ["span"]), quantities), "wavefront span");
  const normal = { x: -direction.y, y: direction.x };
  const paths = Array.from({ length: count }, (_, index) => {
    if (shape === "circular") {
      const radius = spacing * (index + 1);
      return Array.from({ length: 49 }, (__, sample) => {
        const theta = 2 * Math.PI * sample / 48;
        return { x: origin.x + radius * Math.cos(theta), y: origin.y + radius * Math.sin(theta) };
      });
    }
    const center = {
      x: origin.x + direction.x * spacing * index,
      y: origin.y + direction.y * spacing * index,
    };
    return [
      { x: center.x - normal.x * span / 2, y: center.y - normal.y * span / 2 },
      { x: center.x + normal.x * span / 2, y: center.y + normal.y * span / 2 },
    ];
  });
  return { kind: "multi_path", paths };
}

function apertureGeometry(
  inputs: Record<string, unknown>,
  geometry: Map<string, Geometry>,
  quantities: Map<string, Record<string, unknown>>,
): Extract<Geometry, { kind: "multi_path" }> {
  const center = resolvePoint(first(inputs, ["center"]), geometry);
  const orientation = inputs.orientation;
  if (orientation !== "vertical" && orientation !== "horizontal") throw new Error("aperture orientation must be vertical or horizontal");
  const length = positive(resolveNumber(first(inputs, ["length"]), quantities), "aperture length");
  const slitCount = boundedInteger(resolveNumber(first(inputs, ["slitCount"]), quantities), 1, 4, "slitCount");
  const slitWidth = positive(resolveNumber(first(inputs, ["slitWidth"]), quantities), "slitWidth");
  const separation = positive(resolveNumber(first(inputs, ["slitSeparation"]), quantities), "slitSeparation");
  const slitCenters = Array.from({ length: slitCount }, (_, index) =>
    (index - (slitCount - 1) / 2) * separation);
  const gaps = slitCenters.map((offset) => [offset - slitWidth / 2, offset + slitWidth / 2] as const);
  if (gaps[0]![0] <= -length / 2 || gaps.at(-1)![1] >= length / 2) throw new Error("aperture slits must fit inside its finite length");
  const boundaries = [-length / 2, ...gaps.flat(), length / 2];
  const paths: Point[][] = [];
  for (let index = 0; index < boundaries.length - 1; index += 2) {
    const from = boundaries[index]!;
    const to = boundaries[index + 1]!;
    paths.push(orientation === "vertical"
      ? [{ x: center.x, y: center.y + from }, { x: center.x, y: center.y + to }]
      : [{ x: center.x + from, y: center.y }, { x: center.x + to, y: center.y }]);
  }
  return { kind: "multi_path", paths };
}

function screenPatternGeometry(
  inputs: Record<string, unknown>,
  geometry: Map<string, Geometry>,
  quantities: Map<string, Record<string, unknown>>,
): Extract<Geometry, { kind: "multi_path" }> {
  const start = resolvePoint(first(inputs, ["start"]), geometry);
  const end = resolvePoint(first(inputs, ["end"]), geometry);
  const tangent = normalize({ x: end.x - start.x, y: end.y - start.y });
  const normal = { x: -tangent.y, y: tangent.x };
  const pattern = inputs.pattern;
  if (pattern !== "interference" && pattern !== "diffraction" && pattern !== "resolution") throw new Error("screen_pattern pattern must be interference, diffraction, or resolution");
  const count = boundedInteger(resolveNumber(first(inputs, ["count"]), quantities), 3, 21, "screen pattern count");
  if (count % 2 === 0) throw new Error("screen pattern count must be odd");
  const spacing = positive(resolveNumber(first(inputs, ["spacing"]), quantities), "screen pattern spacing");
  const centralWidth = positive(resolveNumber(first(inputs, ["centralWidth"]), quantities), "central width");
  const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const half = (count - 1) / 2;
  const screenLength = distance(start, end);
  const displaySpacing = Math.min(spacing, screenLength / (count + 1));
  const marks = Array.from({ length: count }, (_, index) => {
    const order = index - half;
    const offset = order * displaySpacing;
    const markCenter = { x: center.x + tangent.x * offset, y: center.y + tangent.y * offset };
    const strength = pattern === "interference"
      ? 0.55 + 0.45 * Math.cos(order * Math.PI / 2) ** 2
      : pattern === "diffraction" ? 1 / (1 + Math.abs(order)) : order === 0 ? 1 : 0.62;
    const markLength = centralWidth * (0.35 + strength * 0.65);
    return [markCenter, { x: markCenter.x + normal.x * markLength, y: markCenter.y + normal.y * markLength }];
  });
  return { kind: "multi_path", paths: marks };
}

/**
 * Two `refract_at` bundles that share the internal path id (first bundle's
 * refracted output, second bundle's incident output) would otherwise overwrite
 * that path. Replace it with the chord between the two contact points so angle
 * marks at both faces meet an endpoint.
 */
function assignChainedRefractInternalPath(
  id: string,
  outputIndex: number,
  construction: SceneDocument["constructions"][number],
  document: SceneDocument,
  geometry: Map<string, Geometry>,
): boolean {
  if (construction.operator !== "refract_at" || (outputIndex !== 0 && outputIndex !== 2)) return false;
  const bundles = document.constructions.filter((candidate) =>
    candidate.operator === "refract_at" && Array.isArray(candidate.outputs),
  );
  const upstream = bundles.find((candidate) => candidate.outputs[2] === id);
  const downstream = bundles.find((candidate) =>
    candidate.id !== upstream?.id && candidate.outputs[0] === id,
  );
  if (!upstream || !downstream || !isRecord(upstream.inputs) || !isRecord(downstream.inputs)) return false;
  try {
    const previousContact = resolvePoint(first(upstream.inputs, ["point", "contact"]), geometry);
    const thisContact = resolvePoint(first(downstream.inputs, ["point", "contact"]), geometry);
    if (distance(previousContact, thisContact) < EPSILON) return false;
    geometry.set(id, {
      kind: "path",
      directed: true,
      points: [previousContact, thisContact],
    });
    return true;
  } catch {
    return false;
  }
}

function surfaceRayBundleGeometry(
  inputs: Record<string, unknown>,
  geometry: Map<string, Geometry>,
  quantities: Map<string, Record<string, unknown>>,
  mode: "reflect" | "refract",
): Geometry[] {
  const contact = resolvePoint(first(inputs, ["point", "contact"]), geometry);
  const surface = resolveGeometry(first(inputs, ["surface"]), geometry);
  let normal = surfaceNormal(contact, surface);
  const incidentAngle = resolveNumber(first(inputs, ["incidentAngleDeg"]), quantities) * Math.PI / 180;
  if (!(incidentAngle > 0 && incidentAngle < Math.PI / 2)) throw new Error(`${mode}_at incidence angle must be between 0 and 90 degrees`);
  const tangentSign = inputs.tangentSign === undefined ? 1 : resolveNumber(inputs.tangentSign, quantities);
  if (tangentSign !== -1 && tangentSign !== 1) throw new Error(`${mode}_at tangentSign must be -1 or 1`);
  const span = inputs.span === undefined ? 2 : positive(resolveNumber(inputs.span, quantities), `${mode}_at span`);
  const tangent = { x: -normal.y * tangentSign, y: normal.x * tangentSign };
  const sourceDirection = normalize({
    x: normal.x * Math.cos(incidentAngle) + tangent.x * Math.sin(incidentAngle),
    y: normal.y * Math.cos(incidentAngle) + tangent.y * Math.sin(incidentAngle),
  });
  const source = {
    x: contact.x + sourceDirection.x * span,
    y: contact.y + sourceDirection.y * span,
  };
  const incoming = normalize({ x: contact.x - source.x, y: contact.y - source.y });
  if (incoming.x * normal.x + incoming.y * normal.y > 0) normal = { x: -normal.x, y: -normal.y };
  const outgoing = mode === "reflect"
    ? normalize({
        x: incoming.x - 2 * (incoming.x * normal.x + incoming.y * normal.y) * normal.x,
        y: incoming.y - 2 * (incoming.x * normal.x + incoming.y * normal.y) * normal.y,
      })
    : refract(
        incoming,
        normal,
        positive(resolveNumber(first(inputs, ["n1"]), quantities), "n1") /
          positive(resolveNumber(first(inputs, ["n2"]), quantities), "n2"),
      );
  return [
    { kind: "path", directed: true, points: [source, contact] },
    { kind: "path", points: [contact, { x: contact.x + normal.x * span * 0.8, y: contact.y + normal.y * span * 0.8 }] },
    { kind: "path", directed: true, points: [contact, { x: contact.x + outgoing.x * span, y: contact.y + outgoing.y * span }] },
  ];
}

function opticalTrainGeometry(
  inputs: Record<string, unknown>,
  geometry: Map<string, Geometry>,
  quantities: Map<string, Record<string, unknown>>,
): Geometry[] {
  const axis = resolveLine(first(inputs, ["axis"]), geometry);
  const objective = resolveLine(first(inputs, ["objective"]), geometry);
  const eyepiece = resolveLine(first(inputs, ["eyepiece"]), geometry);
  const focus = resolvePoint(first(inputs, ["focus"]), geometry);
  const objectiveCenter = intersect(axis, objective);
  const eyepieceCenter = intersect(axis, eyepiece);
  let axisDirection = normalize({
    x: axis[1].x - axis[0].x,
    y: axis[1].y - axis[0].y,
  });
  const elementDelta = {
    x: eyepieceCenter.x - objectiveCenter.x,
    y: eyepieceCenter.y - objectiveCenter.y,
  };
  if (elementDelta.x * axisDirection.x + elementDelta.y * axisDirection.y < 0) {
    axisDirection = { x: -axisDirection.x, y: -axisDirection.y };
  }
  const elementSeparation = Math.hypot(elementDelta.x, elementDelta.y);
  if (elementSeparation < EPSILON) throw new Error("optical_train elements must have distinct centers");
  const transverse = { x: -axisDirection.y, y: axisDirection.x };
  const projectedHalfExtent = (line: [Point, Point], center: Point): number =>
    Math.max(...line.map((point) => Math.abs(
      (point.x - center.x) * transverse.x + (point.y - center.y) * transverse.y,
    )));
  const defaultHalfHeight = Math.min(
    projectedHalfExtent(objective, objectiveCenter),
    projectedHalfExtent(eyepiece, eyepieceCenter),
  );
  const beamHalfHeight = inputs.beamHalfHeight === undefined
    ? (defaultHalfHeight > EPSILON ? defaultHalfHeight * 0.78 : elementSeparation * 0.12)
    : positive(resolveNumber(inputs.beamHalfHeight, quantities), "optical_train beamHalfHeight");
  const raySpan = inputs.raySpan === undefined
    ? elementSeparation * 0.42
    : positive(resolveNumber(inputs.raySpan, quantities), "optical_train raySpan");
  const offset = (center: Point, amount: number): Point => ({
    x: center.x + transverse.x * amount,
    y: center.y + transverse.y * amount,
  });
  const advance = (point: Point, amount: number): Point => ({
    x: point.x + axisDirection.x * amount,
    y: point.y + axisDirection.y * amount,
  });
  const objectiveUpper = offset(objectiveCenter, beamHalfHeight);
  const objectiveLower = offset(objectiveCenter, -beamHalfHeight);
  const eyepieceUpper = offset(eyepieceCenter, beamHalfHeight);
  const eyepieceLower = offset(eyepieceCenter, -beamHalfHeight);
  const objectRef = inputs.object;
  const finalRef = inputs.finalImage !== undefined ? inputs.finalImage : inputs.virtualImage;
  const object = objectRef === undefined ? null : resolvePoint(objectRef, geometry);
  const finalImage = finalRef === undefined ? null : resolvePoint(finalRef, geometry);
  const incomingUpperStart = object ? offset(object, beamHalfHeight) : advance(objectiveUpper, -raySpan);
  const incomingLowerStart = object ? offset(object, -beamHalfHeight) : advance(objectiveLower, -raySpan);
  const outgoingDirection = (hit: Point): Point => {
    if (!finalImage) return axisDirection;
    const delta = { x: hit.x - finalImage.x, y: hit.y - finalImage.y };
    return Math.hypot(delta.x, delta.y) < EPSILON ? axisDirection : normalize(delta);
  };
  const outgoingUpperEnd = {
    x: eyepieceUpper.x + outgoingDirection(eyepieceUpper).x * raySpan,
    y: eyepieceUpper.y + outgoingDirection(eyepieceUpper).y * raySpan,
  };
  const outgoingLowerEnd = {
    x: eyepieceLower.x + outgoingDirection(eyepieceLower).x * raySpan,
    y: eyepieceLower.y + outgoingDirection(eyepieceLower).y * raySpan,
  };
  return [
    { kind: "path", directed: true, points: [incomingUpperStart, objectiveUpper] },
    { kind: "path", directed: true, points: [incomingLowerStart, objectiveLower] },
    { kind: "path", directed: true, points: [objectiveUpper, focus, eyepieceUpper] },
    { kind: "path", directed: true, points: [objectiveLower, focus, eyepieceLower] },
    { kind: "path", directed: true, points: [eyepieceUpper, outgoingUpperEnd] },
    { kind: "path", directed: true, points: [eyepieceLower, outgoingLowerEnd] },
  ];
}

function transverseFieldGeometry(
  inputs: Record<string, unknown>,
  geometry: Map<string, Geometry>,
  quantities: Map<string, Record<string, unknown>>,
): Extract<Geometry, { kind: "multi_path" }> {
  const start = resolvePoint(first(inputs, ["start"]), geometry);
  const end = resolvePoint(first(inputs, ["end"]), geometry);
  const direction = normalize({ x: end.x - start.x, y: end.y - start.y });
  const baseNormal = { x: -direction.y, y: direction.x };
  const orientation = resolveNumber(first(inputs, ["orientationDeg"]), quantities) * Math.PI / 180;
  const orientationScale = Math.cos(orientation - Math.PI / 2);
  const normal = { x: baseNormal.x * orientationScale, y: baseNormal.y * orientationScale };
  const amplitude = positive(resolveNumber(first(inputs, ["amplitude"]), quantities), "field amplitude");
  const cycles = boundedInteger(resolveNumber(first(inputs, ["cycles"]), quantities), 1, 12, "field cycles");
  const samples = cycles * 24 + 1;
  const wave = Array.from({ length: samples }, (_, index) => {
    const t = index / (samples - 1);
    const displacement = amplitude * Math.sin(2 * Math.PI * cycles * t);
    return {
      x: start.x + (end.x - start.x) * t + normal.x * displacement,
      y: start.y + (end.y - start.y) * t + normal.y * displacement,
    };
  });
  const axisHalf = Math.min(amplitude * 1.25, distance(start, end) * 0.18);
  const axisCenter = { x: start.x + (end.x - start.x) * 0.12, y: start.y + (end.y - start.y) * 0.12 };
  return { kind: "multi_path", paths: [
    [start, end],
    wave,
    [
      { x: axisCenter.x - baseNormal.x * axisHalf, y: axisCenter.y - baseNormal.y * axisHalf },
      { x: axisCenter.x + baseNormal.x * axisHalf, y: axisCenter.y + baseNormal.y * axisHalf },
    ],
  ] };
}

function polarizerGeometry(
  inputs: Record<string, unknown>,
  geometry: Map<string, Geometry>,
  quantities: Map<string, Record<string, unknown>>,
): Extract<Geometry, { kind: "multi_path" }> {
  const center = resolvePoint(first(inputs, ["center"]), geometry);
  const radius = positive(resolveNumber(first(inputs, ["radius"]), quantities), "polarizer radius");
  const angle = resolveNumber(first(inputs, ["axisAngleDeg"]), quantities) * Math.PI / 180;
  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const circle = Array.from({ length: 49 }, (_, index) => {
    const theta = 2 * Math.PI * index / 48;
    return { x: center.x + radius * Math.cos(theta), y: center.y + radius * Math.sin(theta) };
  });
  return { kind: "multi_path", paths: [
    circle,
    [
      { x: center.x - direction.x * radius * 0.82, y: center.y - direction.y * radius * 0.82 },
      { x: center.x + direction.x * radius * 0.82, y: center.y + direction.y * radius * 0.82 },
    ],
  ] };
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  return value;
}

function solidProjectionPaths(solid: SolidProjection): Point[][] {
  const { kind, radius, height, topRadius } = solid;
  if (kind === "cylinder") {
    const base = projectionEllipse(solid, 0, radius);
    const top = projectionEllipse(solid, height, radius);
    return [
      base,
      top,
      [projectionPoint(solid, 0, -radius), projectionPoint(solid, height, -radius)],
      [projectionPoint(solid, 0, radius), projectionPoint(solid, height, radius)],
    ];
  }
  if (kind === "cone") {
    const apex = projectionPoint(solid, height, 0);
    return [
      projectionEllipse(solid, 0, radius),
      [projectionPoint(solid, 0, -radius), apex],
      [projectionPoint(solid, 0, radius), apex],
    ];
  }
  if (kind === "frustum") {
    const base = projectionEllipse(solid, 0, radius);
    const top = projectionEllipse(solid, height, topRadius);
    return [
      base,
      top,
      [projectionPoint(solid, 0, -radius), projectionPoint(solid, height, -topRadius)],
      [projectionPoint(solid, 0, radius), projectionPoint(solid, height, topRadius)],
    ];
  }
  if (kind === "sphere") {
    return [
      projectionCircle(solid, 0, radius),
      projectionMeridian(solid, 0, radius),
    ];
  }
  return [
    projectionDome(solid, radius),
    projectionEllipse(solid, 0, radius),
  ];
}

function solidProjectionExtents(solid: SolidProjection): [Point, Point] {
  if (solid.kind === "sphere") {
    return [projectionPoint(solid, -solid.radius, 0), projectionPoint(solid, solid.radius, 0)];
  }
  return [projectionPoint(solid, 0, 0), projectionPoint(solid, solid.height, 0)];
}

function solidCrossSectionDimensions(solid: SolidProjection, at: number): { axial: number; radius: number } {
  if (solid.kind === "cylinder") return { axial: solid.height * at, radius: solid.radius };
  if (solid.kind === "cone") return { axial: solid.height * at, radius: solid.radius * (1 - at) };
  if (solid.kind === "frustum") {
    return {
      axial: solid.height * at,
      radius: solid.radius + (solid.topRadius - solid.radius) * at,
    };
  }
  if (solid.kind === "sphere") {
    const axial = -solid.radius + 2 * solid.radius * at;
    return { axial, radius: Math.sqrt(Math.max(0, solid.radius ** 2 - axial ** 2)) };
  }
  const axial = solid.radius * at;
  return { axial, radius: Math.sqrt(Math.max(0, solid.radius ** 2 - axial ** 2)) };
}

function projectionEllipse(solid: SolidProjection, axial: number, radius: number): Point[] {
  return sampleProjectionPath(33, (angle) => projectionPoint(
    solid,
    axial + radius * 0.24 * Math.sin(angle),
    radius * Math.cos(angle),
  ));
}

function projectionCircle(solid: SolidProjection, axial: number, radius: number): Point[] {
  return sampleProjectionPath(65, (angle) => projectionPoint(
    solid,
    axial + radius * Math.sin(angle),
    radius * Math.cos(angle),
  ));
}

function projectionMeridian(solid: SolidProjection, axial: number, radius: number): Point[] {
  return sampleProjectionPath(65, (angle) => projectionPoint(
    solid,
    axial + radius * Math.sin(angle),
    radius * 0.24 * Math.cos(angle),
  ));
}

function projectionDome(solid: SolidProjection, radius: number): Point[] {
  return Array.from({ length: 33 }, (_, index) => {
    const angle = Math.PI * index / 32;
    return projectionPoint(solid, radius * Math.sin(angle), radius * Math.cos(angle));
  });
}

function sampleProjectionPath(samples: number, evaluate: (angle: number) => Point): Point[] {
  return Array.from({ length: samples }, (_, index) => {
    const point = evaluate(Math.PI * 2 * index / (samples - 1));
    if (!finitePoint(point)) throw new Error("solid projection produced a non-finite point");
    return point;
  });
}

function projectionPoint(solid: SolidProjection, axial: number, radial: number): Point {
  return solid.axis === "vertical"
    ? { x: solid.center.x + radial, y: solid.center.y + axial }
    : { x: solid.center.x + axial, y: solid.center.y + radial };
}

function assertConnectedProjectionTopology(kind: SolidProjectionKind, paths: Point[][]): void {
  const expectedPathCount: Record<SolidProjectionKind, number> = {
    cylinder: 4,
    cone: 3,
    frustum: 4,
    sphere: 2,
    hemisphere: 2,
  };
  if (paths.length !== expectedPathCount[kind] || paths.some((path) =>
    path.length < 2 || path.some((point) => !finitePoint(point)))) {
    throw new Error(`solid_projection ${kind} produced invalid contour topology`);
  }
  const visited = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    const current = queue.shift()!;
    paths.forEach((path, index) => {
      if (visited.has(index)) return;
      if (!geometriesTouch(
        { kind: "path", points: paths[current]! },
        { kind: "path", points: path },
      )) return;
      visited.add(index);
      queue.push(index);
    });
  }
  if (visited.size !== paths.length) throw new Error(`solid_projection ${kind} contours are disconnected`);
}

function isSolidProjectionKind(value: unknown): value is SolidProjectionKind {
  return value === "cylinder" || value === "cone" || value === "frustum" ||
    value === "sphere" || value === "hemisphere";
}

function sampledCurveReference(value: unknown, geometry: Map<string, Geometry>): SampledCurve {
  if (typeof value !== "string") throw new Error("curve must reference a constructed sampled curve");
  const curve = geometry.get(value);
  if (curve?.kind !== "path" || !curve.sampledCurve) throw new Error(`${value} is not a sampled curve`);
  return curve.sampledCurve;
}

function sampledCurveCartesianResidual(
  sampled: SampledCurve,
  target: Point,
  expected: Record<string, unknown>,
): number {
  if (sampled.curveKind === "function") {
    return distance(sampled.evaluate(target.x), target);
  }
  const pinned = [expected.t, expected.parameter, expected.theta]
    .find((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (pinned !== undefined) {
    return distance(sampled.evaluate(pinned), target);
  }
  const steps = 64;
  const span = sampled.parameterMax - sampled.parameterMin;
  let bestParameter = sampled.parameterMin;
  let best = Infinity;
  for (let index = 0; index <= steps; index += 1) {
    const parameter = sampled.parameterMin + span * index / steps;
    const residual = distance(sampled.evaluate(parameter), target);
    if (residual < best) {
      best = residual;
      bestParameter = parameter;
    }
  }
  let low = Math.max(sampled.parameterMin, bestParameter - span / steps);
  let high = Math.min(sampled.parameterMax, bestParameter + span / steps);
  for (let index = 0; index < 24; index += 1) {
    const left = low + (high - low) / 3;
    const right = high - (high - low) / 3;
    if (distance(sampled.evaluate(left), target) < distance(sampled.evaluate(right), target)) {
      high = right;
    } else {
      low = left;
    }
  }
  return distance(sampled.evaluate((low + high) / 2), target);
}

function functionCurveReference(value: unknown, geometry: Map<string, Geometry>, name: string): SampledCurve {
  const curve = sampledCurveReference(value, geometry);
  if (curve.curveKind !== "function") throw new Error(`${name} must reference a function_curve`);
  return curve;
}

function sampledCurveDerivative(curve: SampledCurve, at: number): Point {
  assertParameterInDomain(curve, at, "curve derivative", true);
  const range = curve.parameterMax - curve.parameterMin;
  const margin = Math.min(at - curve.parameterMin, curve.parameterMax - at);
  let h = Math.min(range * 1e-3, margin / 4);
  if (!(h > Math.max(range * 1e-10, Number.EPSILON * Math.max(1, Math.abs(at))))) {
    throw new Error("curve derivative point is too close to the domain boundary");
  }
  let previous: Point | null = null;
  let derivative: Point | null = null;
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const p0 = curve.evaluate(at);
    const left = curve.evaluate(at - h);
    const right = curve.evaluate(at + h);
    const farLeft = curve.evaluate(at - 2 * h);
    const farRight = curve.evaluate(at + 2 * h);
    const leftSlope = { x: (p0.x - left.x) / h, y: (p0.y - left.y) / h };
    const rightSlope = { x: (right.x - p0.x) / h, y: (right.y - p0.y) / h };
    const oneSidedGap = Math.hypot(leftSlope.x - rightSlope.x, leftSlope.y - rightSlope.y);
    const oneSidedScale = Math.max(1, Math.hypot(leftSlope.x, leftSlope.y), Math.hypot(rightSlope.x, rightSlope.y));
    const oneSidedAgreement = oneSidedGap <= oneSidedScale * 5e-4;
    if (iteration === 4 && !oneSidedAgreement) {
      throw new Error("curve is not differentiable at the requested parameter");
    }
    derivative = {
      x: (farLeft.x - 8 * left.x + 8 * right.x - farRight.x) / (12 * h),
      y: (farLeft.y - 8 * left.y + 8 * right.y - farRight.y) / (12 * h),
    };
    if (previous) {
      const delta = Math.hypot(derivative.x - previous.x, derivative.y - previous.y);
      const scale = Math.max(1, Math.hypot(derivative.x, derivative.y));
      if (iteration >= 2 && oneSidedAgreement && delta <= scale * 1e-7) break;
    }
    previous = derivative;
    h /= 2;
  }
  if (!derivative || !finitePoint(derivative) || Math.hypot(derivative.x, derivative.y) < EPSILON) {
    throw new Error("curve has no stable nonzero tangent direction at the requested parameter");
  }
  return derivative;
}

function assertParameterInDomain(curve: SampledCurve, parameter: number, operator: string, strict = false): void {
  const lowerOk = strict ? parameter > curve.parameterMin : parameter >= curve.parameterMin;
  const upperOk = strict ? parameter < curve.parameterMax : parameter <= curve.parameterMax;
  if (!Number.isFinite(parameter) || !lowerOk || !upperOk) {
    throw new Error(`${operator} parameter must be ${strict ? "strictly " : ""}within the curve domain`);
  }
}

function curveSampleCount(
  value: unknown,
  quantities: Map<string, Record<string, unknown>>,
  operator: string,
): number {
  const samples = value === undefined ? 65 : resolveNumber(value, quantities);
  if (!Number.isInteger(samples) || samples < 17 || samples > 161 || samples % 2 === 0) {
    throw new Error(`${operator} samples must be an odd integer from 17 to 161`);
  }
  return samples;
}

function sampleCurve(evaluate: (parameter: number) => Point, min: number, max: number, samples: number): Point[] {
  return Array.from({ length: samples }, (_, index) => {
    const point = evaluate(min + (max - min) * index / (samples - 1));
    if (!finitePoint(point)) throw new Error("curve evaluation produced a non-finite point");
    return point;
  });
}

function parseParameterizedExpression(source: string, parameter: "t" | "theta") {
  if (new RegExp(`\\bx\\b`).test(source)) {
    throw new Error(`${parameter} expression cannot also reference x`);
  }
  return parseMathExpression(source.replace(new RegExp(`\\b${parameter}\\b`, "g"), "x"));
}
function functionRegionPoints(
  inputs: Record<string, unknown>,
  geometry: Map<string, Geometry>,
  quantities: Map<string, Record<string, unknown>>,
): Point[] {
  const upperId = first(inputs, ["upper", "top", "above"]);
  const lowerId = first(inputs, ["lower", "bottom", "below"]);
  if (typeof upperId !== "string" || typeof lowerId !== "string") throw new Error("function_region requires upper and lower curve IDs");
  const upper = functionCurveReference(upperId, geometry, "function_region upper");
  const lower = functionCurveReference(lowerId, geometry, "function_region lower");
  const xMin = inputs.xMin === undefined
    ? Math.max(upper.parameterMin, lower.parameterMin)
    : resolveNumber(inputs.xMin, quantities);
  const xMax = inputs.xMax === undefined
    ? Math.min(upper.parameterMax, lower.parameterMax)
    : resolveNumber(inputs.xMax, quantities);
  if (!(xMin < xMax)) throw new Error("function_region requires a non-empty shared domain");
  assertParameterInDomain(upper, xMin, "function_region upper boundary");
  assertParameterInDomain(upper, xMax, "function_region upper boundary");
  assertParameterInDomain(lower, xMin, "function_region lower boundary");
  assertParameterInDomain(lower, xMax, "function_region lower boundary");
  const samples = inputs.samples === undefined ? 65 : resolveNumber(inputs.samples, quantities);
  if (!Number.isInteger(samples) || samples < 17 || samples > 161 || samples % 2 === 0) throw new Error("function_region samples must be an odd integer from 17 to 161");
  const lowerPoints = Array.from({ length: samples }, (_, index) =>
    lower.evaluate(xMin + (xMax - xMin) * index / (samples - 1)),
  );
  const upperPoints = Array.from({ length: samples }, (_, index) =>
    upper.evaluate(xMin + (xMax - xMin) * index / (samples - 1)),
  );
  if (upperPoints.some((point, index) => point.y + EPSILON < lowerPoints[index]!.y)) {
    throw new Error("function_region upper curve falls below its lower curve inside the requested domain");
  }
  return [...lowerPoints, ...upperPoints.reverse()];
}
function curveExpression(entityId: string | undefined, document: SceneDocument) {
  if (!entityId) throw new Error("function assertion requires a curve entity");
  const construction = document.constructions.find((candidate) =>
    candidate.operator === "function_curve" && candidate.outputs.includes(entityId),
  );
  if (!construction || typeof construction.inputs.expression !== "string") {
    throw new Error(`${entityId} is not a function_curve`);
  }
  return parseMathExpression(construction.inputs.expression);
}
function resolvePoint(value: unknown, geometry: Map<string, Geometry>): Point { if (typeof value === "string") return asPoint(geometry.get(value)); if (Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === "number" && Number.isFinite(item))) return { x: value[0] as number, y: value[1] as number }; if (isRecord(value) && typeof value.x === "number" && typeof value.y === "number") return { x: value.x, y: value.y }; throw new Error(`invalid point reference ${String(value)}`); }
function resolvePointArray(value: unknown, geometry: Map<string, Geometry>): Point[] { if (!Array.isArray(value) || value.length < 2) throw new Error("points must contain at least two points"); return value.map((item) => resolvePoint(item, geometry)); }
function resolveAngleArmPoint(value: unknown, vertex: Point, geometry: Map<string, Geometry>): Point {
  if (typeof value !== "string") return resolvePoint(value, geometry);
  const resolved = geometry.get(value);
  if (resolved?.kind === "point") return resolved.point;
  const points = resolved?.kind === "path"
    ? resolved.points
    : resolved?.kind === "compound"
      ? resolved.terminals
      : null;
  if (!points || points.length < 2) throw new Error("angle arm must reference point or path geometry");
  const firstPoint = points[0]!;
  const lastPoint = points.at(-1)!;
  if (distance(firstPoint, vertex) < EPSILON && distance(lastPoint, vertex) >= EPSILON) return lastPoint;
  if (distance(lastPoint, vertex) < EPSILON && distance(firstPoint, vertex) >= EPSILON) return firstPoint;
  throw new Error("angle arm path must meet the angle vertex at exactly one endpoint");
}
function resolveLine(value: unknown, geometry: Map<string, Geometry>): [Point, Point] { if (typeof value === "string") return asLine(geometry.get(value)); if (Array.isArray(value) && value.length === 2) return [resolvePoint(value[0], geometry), resolvePoint(value[1], geometry)]; throw new Error(`invalid line reference ${String(value)}`); }
function resolveVector(value: unknown, geometry: Map<string, Geometry>): Point {
  if (typeof value === "string") {
    const line = asLine(geometry.get(value));
    return { x: line[1].x - line[0].x, y: line[1].y - line[0].y };
  }
  if (Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === "number")) {
    return { x: value[0] as number, y: value[1] as number };
  }
  if (isRecord(value) && typeof value.x === "number" && typeof value.y === "number") {
    return { x: value.x, y: value.y };
  }
  throw new Error("invalid vector");
}
function resolveGeometry(value: unknown, geometry: Map<string, Geometry>): Geometry {
  if (typeof value !== "string") throw new Error("surface must reference constructed geometry");
  const resolved = geometry.get(value);
  if (!resolved) throw new Error(`missing surface geometry ${value}`);
  return resolved;
}
function resolveContactDirection(origin:Point,inputs:Record<string,unknown>,geometry:Map<string,Geometry>):Point{
  if(inputs.through!==undefined){const through=resolvePoint(inputs.through,geometry);return{x:through.x-origin.x,y:through.y-origin.y};}
  if(inputs.parallelTo!==undefined)return resolveVector(inputs.parallelTo,geometry);
  return resolveVector(first(inputs,["direction","incoming"]),geometry);
}
function linePoints(inputs: Record<string, unknown>, geometry: Map<string, Geometry>): [Point, Point] { const start = resolvePoint(first(inputs, ["start", "from", "a", "origin"]), geometry); if (["end", "to", "b"].some((name) => inputs[name] !== undefined)) return distinctPathPoints(start, resolvePoint(first(inputs, ["end", "to", "b"]), geometry), "line"); const direction = resolveVector(first(inputs, ["direction", "vector"]), geometry); return distinctPathPoints(start, { x: start.x + direction.x, y: start.y + direction.y }, "line"); }
function distinctPathPoints(a:Point,b:Point,operator:string):[Point,Point]{if(distance(a,b)<EPSILON)throw new Error(`${operator} endpoints must be distinct`);return[a,b];}
function assertPathMeetsOrigin(value:unknown,origin:Point,geometry:Map<string,Geometry>,name:string):void{if(typeof value!=="string")return;const resolved=geometry.get(value);if(resolved?.kind!=="path")throw new Error(`${name} must reference constructed path geometry`);const endpoints=[resolved.points[0],resolved.points.at(-1)].filter((point):point is Point=>Boolean(point));if(!endpoints.some((point)=>distance(point,origin)<EPSILON))throw new Error(`${name} geometry must meet the transform origin`);}
function asPoint(value: Geometry | undefined): Point { if (!value) throw new Error("missing geometry"); if (value.kind === "point") return value.point; throw new Error("expected point geometry"); }
function asLine(value: Geometry | undefined): [Point, Point] { if (value?.kind === "path" && value.points.length >= 2) return [value.points[0]!, value.points[1]!]; if (value?.kind === "multi_path" && value.paths[0]?.length >= 2) return [value.paths[0][0]!, value.paths[0][1]!]; if (value?.kind === "compound") return value.terminals; if (value?.kind === "dimension") return [value.a, value.b]; throw new Error("expected line geometry"); }
function acuteAngleBetween(firstLine: [Point, Point], secondLine: [Point, Point]): number {
  const firstDirection = normalize({ x: firstLine[1].x - firstLine[0].x, y: firstLine[1].y - firstLine[0].y });
  const secondDirection = normalize({ x: secondLine[1].x - secondLine[0].x, y: secondLine[1].y - secondLine[0].y });
  const dot = Math.abs(firstDirection.x * secondDirection.x + firstDirection.y * secondDirection.y);
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}
function expectedAngleRadians(expected: unknown): number {
  const value = typeof expected === "number"
    ? expected
    : isRecord(expected) && typeof expected.value === "number" ? expected.value : NaN;
  if (!Number.isFinite(value)) throw new Error("angle_between expected must be a finite angle");
  const unit = isRecord(expected) && typeof expected.unit === "string"
    ? expected.unit.trim().toLowerCase()
    : "";
  if (unit === "degree" || unit === "degrees" || unit === "deg" || unit === "°") return value * Math.PI / 180;
  if (unit === "radian" || unit === "radians" || unit === "rad") return value;
  return Math.abs(value) > Math.PI * 2 ? value * Math.PI / 180 : value;
}
function hasAttachedLabel(assertion: SceneAssertion, document: SceneDocument): boolean {
  const assertedIds = new Set(assertion.entities);
  if (document.annotations.some((annotation) =>
    annotation.kind === "label" && annotation.targetIds.some((id) => assertedIds.has(id)))) {
    return true;
  }
  if (document.entities.some((entity) =>
    assertedIds.has(entity.id) && entity.kind !== "label" && typeof entity.label === "string" && entity.label.trim().length > 0)) {
    return true;
  }
  return document.constructions.some((construction) => {
    if (construction.operator !== "label" || typeof construction.inputs.target !== "string") return false;
    const outputAsserted = construction.outputs.some((id) => assertedIds.has(id));
    return outputAsserted && (assertedIds.size === 1 || assertedIds.has(construction.inputs.target));
  });
}
function pointInsidePolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current]!;
    const b = polygon[previous]!;
    const crosses = (a.y > point.y) !== (b.y > point.y) &&
      point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}
function intersect(firstLine: [Point, Point], secondLine: [Point, Point]): Point { const [a,b]=firstLine; const [c,d]=secondLine; const denominator=(a.x-b.x)*(c.y-d.y)-(a.y-b.y)*(c.x-d.x); if(Math.abs(denominator)<EPSILON) throw new Error("parallel lines do not intersect"); return {x:((a.x*b.y-a.y*b.x)*(c.x-d.x)-(a.x-b.x)*(c.x*d.y-c.y*d.x))/denominator,y:((a.x*b.y-a.y*b.x)*(c.y-d.y)-(a.y-b.y)*(c.x*d.y-c.y*d.x))/denominator}; }
function intersectSurface(origin: Point, direction: Point, surface: Geometry, which: unknown): Point {
  const unit = normalize(direction);
  let hits: Array<{ t: number; point: Point }>;
  if (surface.kind === "circle" || surface.kind === "arc") {
    const ox = origin.x - surface.center.x;
    const oy = origin.y - surface.center.y;
    const projection = ox * unit.x + oy * unit.y;
    const discriminant = projection * projection - (ox * ox + oy * oy - surface.radius * surface.radius);
    if (discriminant < -EPSILON) throw new Error("ray does not intersect surface");
    const root = Math.sqrt(Math.max(0, discriminant));
    hits = [-projection - root, -projection + root]
      .filter((t) => t > EPSILON)
      .map((t) => ({ t, point: { x: origin.x + t * unit.x, y: origin.y + t * unit.y } }));
    if (surface.kind === "arc") hits = hits.filter(({ point }) => angleOnArc(Math.atan2(point.y - surface.center.y, point.x - surface.center.x), surface.startAngle, surface.endAngle));
  } else if (surface.kind === "path") {
    const rayLine: [Point, Point] = [origin, { x: origin.x + unit.x, y: origin.y + unit.y }];
    if (surface.infinite) {
      const point = intersect(rayLine, asLine(surface));
      const t = (point.x - origin.x) * unit.x + (point.y - origin.y) * unit.y;
      hits = t > EPSILON ? [{ t, point }] : [];
    } else {
      hits = surface.points.slice(1).flatMap((end, index) => {
        const segment: [Point, Point] = [surface.points[index]!, end];
        let point: Point;
        try {
          point = intersect(rayLine, segment);
        } catch {
          return [];
        }
        const t = (point.x - origin.x) * unit.x + (point.y - origin.y) * unit.y;
        return t > EPSILON && pointSegmentResidual(point, segment) <= 1e-4
          ? [{ t, point }]
          : [];
      });
    }
  } else {
    throw new Error("surface_intersection supports line, circle, or arc geometry");
  }
  if (hits.length === 0) throw new Error("no forward surface intersection");
  hits.sort((a, b) => a.t - b.t);
  return which === "farthest_forward" ? hits.at(-1)!.point : hits[0]!.point;
}
function intersectSurfaceEitherDirection(origin:Point,direction:Point,surface:Geometry,which:unknown):Point{try{return intersectSurface(origin,direction,surface,which);}catch(firstError){try{return intersectSurface(origin,{x:-direction.x,y:-direction.y},surface,which);}catch{throw firstError;}}}
function surfaceNormal(at: Point, surface: Geometry): Point {
  if (surface.kind === "circle" || surface.kind === "arc") return normalize({ x: surface.center.x - at.x, y: surface.center.y - at.y });
  if (surface.kind === "path") {
    const [a, b] = asLine(surface);
    const projection = projectPoint(at, a, b);
    if (distance(at, projection) > 1e-4) throw new Error("normal point is not on surface");
    return normalize({ x: -(b.y - a.y), y: b.x - a.x });
  }
  throw new Error("normal_at supports line, circle, or arc geometry");
}
function angleOnArc(value: number, start: number, end: number): boolean {
  const full = Math.PI * 2;
  const normalizeAngle = (angleValue: number) => ((angleValue % full) + full) % full;
  const angleValue = normalizeAngle(value);
  const startValue = normalizeAngle(start);
  const endValue = normalizeAngle(end);
  return startValue <= endValue
    ? angleValue >= startValue - EPSILON && angleValue <= endValue + EPSILON
    : angleValue >= startValue - EPSILON || angleValue <= endValue + EPSILON;
}
function projectPoint(p: Point, a: Point, b: Point): Point { const dx=b.x-a.x,dy=b.y-a.y; const denominator=dx*dx+dy*dy; if(denominator<EPSILON) throw new Error("degenerate line"); const t=((p.x-a.x)*dx+(p.y-a.y)*dy)/denominator; return {x:a.x+t*dx,y:a.y+t*dy}; }
function reflectPoint(p: Point,a:Point,b:Point):Point { const q=projectPoint(p,a,b); return{x:2*q.x-p.x,y:2*q.y-p.y}; }
function refract(i:Point,n:Point,eta:number):Point { let normal=n; let cosi=Math.max(-1,Math.min(1,i.x*n.x+i.y*n.y)); let ratio=eta; if(cosi>0){normal={x:-n.x,y:-n.y};ratio=1/eta;}else cosi=-cosi; const k=1-ratio*ratio*(1-cosi*cosi); if(k<0) throw new Error("total internal reflection"); return normalize({x:ratio*i.x+(ratio*cosi-Math.sqrt(k))*normal.x,y:ratio*i.y+(ratio*cosi-Math.sqrt(k))*normal.y}); }
function pointsOf(value:Geometry):Point[]{ if(value.kind==="point")return[value.point]; if(value.kind==="path")return value.points; if(value.kind==="multi_path")return value.paths.flat(); if(value.kind==="circle"||value.kind==="arc")return[{x:value.center.x-value.radius,y:value.center.y-value.radius},{x:value.center.x+value.radius,y:value.center.y+value.radius}]; if(value.kind==="axes")return[{x:value.xMin,y:value.yMin},{x:value.xMax,y:value.yMax}]; if(value.kind==="compound")return value.paths.flat(); return[value.a,value.b]; }
function routedConnectorPoints(
  start: Point,
  end: Point,
  geometry: Map<string, Geometry>,
  ignoredEntityId?: string,
): Point[] {
  const direct = distinctPathPoints(start, end, "connect");
  const span = distance(start, end);
  const direction = { x: (end.x - start.x) / span, y: (end.y - start.y) / span };
  const normal = { x: -direction.y, y: direction.x };
  const clearance = Math.max(0.05, span * 0.015);
  const blockers = [...geometry.entries()].flatMap(([entityId, value]) => {
    if (entityId === ignoredEntityId) return [];
    if (value.kind === "point") return [];
    return pointsOf(value).some((point) => {
      const along = (point.x - start.x) * direction.x + (point.y - start.y) * direction.y;
      const across = Math.abs((point.x - start.x) * normal.x + (point.y - start.y) * normal.y);
      return along > span * 0.04 && along < span * 0.96 && across <= clearance;
    }) ? [value] : [];
  });
  if (blockers.length === 0) return direct;

  const obstaclePoints = blockers.flatMap(pointsOf);
  const baseProjection = start.x * normal.x + start.y * normal.y;
  const projections = obstaclePoints.map((point) => point.x * normal.x + point.y * normal.y);
  const margin = Math.max(0.35, span * 0.08);
  const positiveOffset = Math.max(...projections) - baseProjection + margin;
  const negativeOffset = Math.min(...projections) - baseProjection - margin;
  const offset = Math.abs(positiveOffset) <= Math.abs(negativeOffset)
    ? positiveOffset
    : negativeOffset;
  const shift = { x: normal.x * offset, y: normal.y * offset };
  return [
    start,
    { x: start.x + shift.x, y: start.y + shift.y },
    { x: end.x + shift.x, y: end.y + shift.y },
    end,
  ];
}
function centerOf(value:Geometry):Point {
  if (value.kind === "path" && value.infinite === true && value.points[0]) return value.points[0];
  const points=pointsOf(value);
  return{x:points.reduce((sum,p)=>sum+p.x,0)/points.length,y:points.reduce((sum,p)=>sum+p.y,0)/points.length};
}
function normalize(p:Point):Point { const magnitude=Math.hypot(p.x,p.y); if(magnitude<EPSILON)throw new Error("zero vector"); return{x:p.x/magnitude,y:p.y/magnitude}; }
function positive(value:number,name:string):number{if(value<=0)throw new Error(`${name} must be positive`);return value;}
function angle(value:number,inputs:Record<string,unknown>):number{return inputs.angleUnit==="degrees"||Math.abs(value)>2*Math.PI?value*Math.PI/180:value;}
function tolerance(assertion:SceneAssertion):number{return typeof assertion.tolerance==="number"?assertion.tolerance:1e-4;}

/**
 * Residual between the claimed and measured number of oscillation cycles on a
 * transverse wave bundle. A transverse_field emits a multi_path of
 * [axis, oscillating wave, axis tick]; we isolate the wave as the path with the
 * largest total perpendicular deviation from the bundle's propagation axis, then
 * count zero-crossings of the perpendicular displacement. A sinusoid of N cycles
 * crosses the axis 2N times (endpoints excluded), so cycles ≈ crossings / 2.
 * Returns the absolute difference between measured and claimed cycles, or null
 * when the value carries no oscillating path.
 */
function waveCycleResidual(value: Geometry | undefined, claimedCycles: number): number | null {
  if (!value || value.kind !== "multi_path" || value.paths.length < 2) return null;
  // Propagation axis = the straight two-point path (the wave guide).
  const axisPath = value.paths.find((path) => path.length === 2);
  if (!axisPath) return null;
  const axisStart = axisPath[0]!;
  const axisEnd = axisPath[1]!;
  const axisLength = distance(axisStart, axisEnd);
  if (axisLength < EPSILON) return null;
  const direction = { x: (axisEnd.x - axisStart.x) / axisLength, y: (axisEnd.y - axisStart.y) / axisLength };
  const normal = { x: -direction.y, y: direction.x };
  // The wave is the densest path that is not the straight axis.
  const wave = value.paths
    .filter((path) => path.length > 2)
    .sort((a, b) => b.length - a.length)[0];
  if (!wave || wave.length < 9) return null;
  // Count sign changes of perpendicular displacement relative to the axis line.
  const displacements = wave.map((point) => {
    const rel = { x: point.x - axisStart.x, y: point.y - axisStart.y };
    const along = rel.x * direction.x + rel.y * direction.y;
    if (along < -EPSILON || along > axisLength + EPSILON) return null; // off-axis ticks
    return rel.x * normal.x + rel.y * normal.y;
  });
  const samples = displacements.filter((d): d is number => d !== null);
  if (samples.length < 9) return null;
  // A transverse wave of N cycles oscillates as sin(2πN·t) over t∈[0,1], whose
  // displacement touches/crosses the axis 2N+1 times including both endpoints.
  // Counting sign transitions between consecutive samples misses exact-zero
  // endpoints, so detect peaks between consecutive axis touchings instead: each
  // half-cycle contributes one extremum, and N cycles = (2N+1 touchings) − 1
  // intervals → extrema pairs. The robust proxy is: full cycles = number of
  // times the displacement returns to the same-signed extremum, i.e. count
  // positive peaks; a sinusoid has exactly one positive peak per cycle.
  let positivePeaks = 0;
  for (let index = 1; index < samples.length - 1; index++) {
    const previous = samples[index - 1]!;
    const current = samples[index]!;
    const next = samples[index + 1]!;
    if (current > 0 && current >= previous && current > next) positivePeaks++;
  }
  const measuredCycles = positivePeaks;
  return Math.abs(measuredCycles - claimedCycles);
}
function geometryScale(geometry:Map<string,Geometry>):number{const points=[...geometry.values()].flatMap(pointsOf);if(points.length===0)return 1;const xs=points.map((point)=>point.x);const ys=points.map((point)=>point.y);return Math.max(1,Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys));}
function length(line:[Point,Point]):number{return distance(line[0],line[1]);}
function distance(a:Point,b:Point):number{return Math.hypot(a.x-b.x,a.y-b.y);}
function parallelResidual(a:[Point,Point],b:[Point,Point]):number{const u=normalize({x:a[1].x-a[0].x,y:a[1].y-a[0].y});const v=normalize({x:b[1].x-b[0].x,y:b[1].y-b[0].y});return Math.abs(u.x*v.y-u.y*v.x);}
function perpendicularResidual(a:[Point,Point],b:[Point,Point]):number{const u=normalize({x:a[1].x-a[0].x,y:a[1].y-a[0].y});const v=normalize({x:b[1].x-b[0].x,y:b[1].y-b[0].y});return Math.abs(u.x*v.x+u.y*v.y);}
function collinearResidual(points:Point[]):number{if(points.length<3)return 0;const[a,b]=points;return Math.max(...points.slice(2).map((p)=>Math.abs((b!.x-a!.x)*(p.y-a!.y)-(b!.y-a!.y)*(p.x-a!.x))));}
function pointLineResidual(point:Point,line:[Point,Point]):number{const[a,b]=line;const lineLength=Math.hypot(b.x-a.x,b.y-a.y);if(lineLength<EPSILON)return Infinity;return Math.abs((b.x-a.x)*(a.y-point.y)-(a.x-point.x)*(b.y-a.y))/lineLength;}
function geometryCanReachTarget(value: Geometry | undefined, target: Point, tolerance: number): boolean {
  if (value?.kind !== "path" || value.directed !== true || value.points.length < 2) return true;
  const start = value.points[0]!;
  const end = value.points.at(-1)!;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const pathLength = Math.hypot(dx, dy);
  if (pathLength < EPSILON) return false;
  const projectedDistance = ((target.x - start.x) * dx + (target.y - start.y) * dy) / pathLength;
  if (projectedDistance < -tolerance) return false;
  if (value.infinite === true) return true;
  return projectedDistance <= pathLength + tolerance;
}
function isBetween(p:Point,a:Point,b:Point):boolean{return collinearResidual([a,p,b])<EPSILON&&p.x>=Math.min(a.x,b.x)-EPSILON&&p.x<=Math.max(a.x,b.x)+EPSILON&&p.y>=Math.min(a.y,b.y)-EPSILON&&p.y<=Math.max(a.y,b.y)+EPSILON;}
function pointGeometryResidual(pointGeometry:Geometry|undefined,target:Geometry|undefined):number{
  const point=asPoint(pointGeometry);
  if(target?.kind==="circle"||target?.kind==="arc")return Math.abs(distance(point,target.center)-target.radius);
  if(target?.kind==="path"){
    if(target.infinite)return pointLineResidual(point,[target.points[0]!,target.points.at(-1)!]);
    return Math.min(...target.points.slice(1).map((end,index)=>pointSegmentResidual(point,[target.points[index]!,end])));
  }
  if(target?.kind==="compound"||target?.kind==="multi_path")return Math.min(...target.paths.flatMap((path)=>path.slice(1).map((end,index)=>pointSegmentResidual(point,[path[index]!,end]))));
  const line=asLine(target);return pointLineResidual(point,line);
}
function pointSegmentResidual(point:Point,segment:[Point,Point]):number{
  const[a,b]=segment;const dx=b.x-a.x,dy=b.y-a.y;const denominator=dx*dx+dy*dy;
  if(denominator<EPSILON)return distance(point,a);
  const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/denominator));
  return distance(point,{x:a.x+t*dx,y:a.y+t*dy});
}
function areConnected(a: Geometry | undefined, b: Geometry | undefined, all: Map<string, Geometry>): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const values = [...all.values()];
  const queue = [a];
  const visited = new Set<Geometry>(queue);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of values) {
      if (visited.has(next) || !geometriesTouch(current, next)) continue;
      if (next === b) return true;
      visited.add(next);
      queue.push(next);
    }
  }
  return false;
}

function geometriesTouch(first: Geometry, second: Geometry): boolean {
  if (circleTouchesGeometry(first, second) || circleTouchesGeometry(second, first)) return true;
  if (closedPathContainsTerminal(first, second) || closedPathContainsTerminal(second, first)) return true;
  const firstPoints = geometryTerminals(first);
  const secondPoints = geometryTerminals(second);
  if (firstPoints.some((point) => secondPoints.some((candidate) => distance(point, candidate) < EPSILON))) return true;
  const firstSegments = geometrySegments(first);
  const secondSegments = geometrySegments(second);
  if (firstPoints.some((point) => secondSegments.some((segment) => pointSegmentResidual(point, segment) < EPSILON))) return true;
  if (secondPoints.some((point) => firstSegments.some((segment) => pointSegmentResidual(point, segment) < EPSILON))) return true;
  return firstSegments.some((firstSegment) =>
    secondSegments.some((secondSegment) => segmentsTouch(firstSegment, secondSegment)),
  );
}

function circleTouchesGeometry(circle: Geometry, other: Geometry): boolean {
  if (circle.kind !== "circle") return false;
  if (geometryTerminals(other).some((point) =>
    distance(point, circle.center) < EPSILON ||
    Math.abs(distance(point, circle.center) - circle.radius) < EPSILON)) {
    return true;
  }
  return geometrySegments(other).some((segment) =>
    pointSegmentResidual(circle.center, segment) <= circle.radius + EPSILON,
  );
}

function closedPathContainsTerminal(body: Geometry, other: Geometry): boolean {
  if (body.kind !== "path" || body.closed !== true || body.points.length < 3) return false;
  return geometryTerminals(other).some((point) => pointInsidePolygon(point, body.points));
}

function geometrySegments(value: Geometry): Array<[Point, Point]> {
  if (value.kind === "path") {
    const segments = value.points.slice(1).map((point, index) => [value.points[index]!, point] as [Point, Point]);
    if (value.closed && value.points.length > 2) segments.push([value.points.at(-1)!, value.points[0]!]);
    return segments;
  }
  if (value.kind === "compound" || value.kind === "multi_path") {
    return value.paths.flatMap((path) => path.slice(1).map((point, index) => [path[index]!, point] as [Point, Point]));
  }
  if (value.kind === "dimension") return [[value.a, value.b]];
  return [];
}

function segmentsTouch([a, b]: [Point, Point], [c, d]: [Point, Point]): boolean {
  const cross = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (Math.abs(abC) < EPSILON && pointSegmentResidual(c, [a, b]) < EPSILON) return true;
  if (Math.abs(abD) < EPSILON && pointSegmentResidual(d, [a, b]) < EPSILON) return true;
  if (Math.abs(cdA) < EPSILON && pointSegmentResidual(a, [c, d]) < EPSILON) return true;
  if (Math.abs(cdB) < EPSILON && pointSegmentResidual(b, [c, d]) < EPSILON) return true;
  return abC * abD < 0 && cdA * cdB < 0;
}

function geometryTerminals(value: Geometry): Point[] {
  if (value.kind === "point") return [value.point];
  if (value.kind === "path") return value.points.length >= 2 ? [value.points[0]!, value.points.at(-1)!] : [];
  if (value.kind === "compound") return value.terminals;
  if (value.kind === "multi_path") return value.paths.flatMap((path) =>
    path.length >= 2 ? [path[0]!, path.at(-1)!] : [],
  );
  if (value.kind === "dimension") return [value.a, value.b];
  return [];
}

function pointKey(point: Point): string {
  return `${signatureNumber(point.x)}:${signatureNumber(point.y)}`;
}

function signatureNumber(value: number): string {
  if (Math.abs(value) < 1e-12) return "0";
  return Number(value.toPrecision(12)).toString();
}

function geometrySignature(value: Geometry): string {
  if (value.kind === "point") return `point:${pointKey(value.point)}`;
  if (value.kind === "path") {
    const forward = value.points.map(pointKey).join("|");
    if (value.infinite) return `path:${forward}`;
    const reverse = [...value.points].reverse().map(pointKey).join("|");
    return `path:${forward < reverse ? forward : reverse}`;
  }
  if (value.kind === "compound") return `compound:${value.paths.map((path) => path.map(pointKey).join("|")).join(";")}`;
  if (value.kind === "multi_path") return `multi_path:${value.paths.map((path) => path.map(pointKey).join("|")).join(";")}`;
  if (value.kind === "circle") return `circle:${pointKey(value.center)}:${signatureNumber(value.radius)}`;
  if (value.kind === "arc") return `arc:${pointKey(value.center)}:${signatureNumber(value.radius)}:${signatureNumber(value.startAngle)}:${signatureNumber(value.endAngle)}`;
  if (value.kind === "axes") return `axes:${value.xMin}:${value.xMax}:${value.yMin}:${value.yMax}`;
  return `dimension:${pointKey(value.a)}:${pointKey(value.b)}`;
}

function directionOverlayEntity(
  existingId: string,
  existing: Geometry | undefined,
  candidateId: string,
  candidate: Geometry,
): string | null {
  if (
    existing?.kind !== "path" ||
    candidate.kind !== "path" ||
    existing.points.length !== 2 ||
    candidate.points.length !== 2 ||
    existing.directed === candidate.directed
  ) return null;
  const directedId = candidate.directed ? candidateId : existingId;
  const directedGeometry = candidate.directed ? candidate : existing;
  return directedGeometry.infinite ? null : directedId;
}

function coincidentSupportingLineAliases(
  existing: Geometry | undefined,
  candidate: Geometry,
): boolean {
  if (existing?.kind !== "path" || candidate.kind !== "path") return false;
  if (existing.infinite !== true && candidate.infinite !== true) return false;
  if (existing.points.length < 2 || candidate.points.length < 2) return false;
  const first: [Point, Point] = [existing.points[0]!, existing.points.at(-1)!];
  const second: [Point, Point] = [candidate.points[0]!, candidate.points.at(-1)!];
  return (
    (distance(first[0], second[0]) < EPSILON && distance(first[1], second[1]) < EPSILON) ||
    (distance(first[0], second[1]) < EPSILON && distance(first[1], second[0]) < EPSILON)
  );
}

function rigidBodyContactResidual(
  pointGeometry: Geometry | undefined,
  target: Geometry | undefined,
  all: Map<string, Geometry>,
): number | null {
  if (pointGeometry?.kind !== "point" || !target) return null;
  const line = target.kind === "path" && target.points.length >= 2
    ? [target.points[0]!, target.points.at(-1)!] as [Point, Point]
    : null;
  if (!line) return null;
  const point = pointGeometry.point;
  for (const value of all.values()) {
    if (value.kind === "circle" && distance(point, value.center) < EPSILON) {
      return Math.max(0, pointLineResidual(point, line) - value.radius);
    }
    if (
      value.kind === "path" &&
      value.closed === true &&
      value.points.length >= 3 &&
      pointInsidePolygon(point, value.points)
    ) {
      if (closedPathIntersectsLine(value, line)) return 0;
    }
  }
  return null;
}

function closedPathIntersectsLine(path: Extract<Geometry, { kind: "path" }>, line: [Point, Point]): boolean {
  const signed = (point: Point) =>
    (point.x - line[0].x) * (line[1].y - line[0].y) - (point.y - line[0].y) * (line[1].x - line[0].x);
  const signs = path.points.map(signed);
  if (signs.some((value) => Math.abs(value) < EPSILON)) return true;
  for (let index = 0; index < signs.length; index += 1) {
    const next = (index + 1) % signs.length;
    if (signs[index]! * signs[next]! < 0) return true;
  }
  return false;
}

function angularTolerance(assertion: SceneAssertion): number {
  if (typeof assertion.tolerance === "number") return assertion.tolerance;
  const expected = assertion.expected;
  const unit = isRecord(expected) && typeof expected.unit === "string"
    ? expected.unit.trim().toLowerCase()
    : "";
  const rawValue = typeof expected === "number"
    ? expected
    : isRecord(expected) && typeof expected.value === "number" ? expected.value : null;
  const isDegree = unit === "degree" || unit === "degrees" || unit === "deg" || unit === "°" ||
    (rawValue !== null && unit === "" && Math.abs(rawValue) > Math.PI * 2);
  return isDegree ? 0.5 * Math.PI / 180 : 1e-4;
}

function explicitlyParallelPathAliases(
  document: SceneDocument,
  existingId: string,
  existing: Geometry | undefined,
  candidateId: string,
  candidate: Geometry,
): boolean {
  if (
    existing?.kind !== "path" ||
    candidate.kind !== "path" ||
    existing.directed !== true ||
    candidate.directed !== true
  ) return false;
  return document.assertions.some((assertion) =>
    assertion.predicate === "parallel" &&
    assertion.expected !== false &&
    assertion.entities.includes(existingId) &&
    assertion.entities.includes(candidateId),
  );
}

function coincidentPhasorAliases(
  document: SceneDocument,
  existingId: string,
  existing: Geometry | undefined,
  candidateId: string,
  candidate: Geometry,
): boolean {
  if (
    existing?.kind !== "path" ||
    candidate.kind !== "path" ||
    existing.directed !== true ||
    candidate.directed !== true
  ) return false;
  return [existingId, candidateId].every((entityId) => {
    const entity = document.entities.find((candidateEntity) => candidateEntity.id === entityId);
    const semantics = [entity?.id, entity?.role, entity?.label]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .replace(/[_-]+/g, " ");
    return /\bphasors?\b/i.test(semantics);
  });
}

function coincidentIncidentReflectionAliases(
  document: SceneDocument,
  existingId: string,
  existing: Geometry | undefined,
  candidateId: string,
  candidate: Geometry,
): boolean {
  if (existing?.kind !== "path" || candidate.kind !== "path") return false;
  const semantics = (entityId: string): string => {
    const entity = document.entities.find((candidateEntity) => candidateEntity.id === entityId);
    return [entity?.id, entity?.role, entity?.label]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .replace(/[_-]+/g, " ")
      .toLowerCase();
  };
  const first = semantics(existingId);
  const second = semantics(candidateId);
  const rayNumber = (value: string): string | undefined =>
    value.match(/\bray\s*([0-9]+)\b/)?.[1] ??
    value.match(/\b(?:inc(?:ident)?|incoming|refl(?:ected|ection)?|refracted|refraction|out(?:going)?)\s*([0-9]+)\b/)?.[1];
  const firstNumber = rayNumber(first);
  const secondNumber = rayNumber(second);
  if (!firstNumber || firstNumber !== secondNumber) return false;
  const isIncident = (value: string): boolean =>
    /\b(?:inc(?:ident)?|incoming|in)(?:\s*[0-9]+)?\b/.test(value);
  const isReturned = (value: string): boolean =>
    /\b(?:refl(?:ected|ection)?|refracted|refraction|out(?:going)?)(?:\s*[0-9]+)?\b/.test(value);
  return (isIncident(first) && isReturned(second)) || (isReturned(first) && isIncident(second));
}

function coincidentAxisRayAliases(
  document: SceneDocument,
  existingId: string,
  existing: Geometry | undefined,
  candidateId: string,
  candidate: Geometry,
): boolean {
  if (existing?.kind !== "path" || candidate.kind !== "path") return false;
  const semantics = (entityId: string): string => {
    const entity = document.entities.find((candidateEntity) => candidateEntity.id === entityId);
    return [entity?.id, entity?.role, entity?.label]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .replace(/[_-]+/g, " ")
      .toLowerCase();
  };
  const first = semantics(existingId);
  const second = semantics(candidateId);
  return (first.includes("axis") && second.includes("ray")) ||
    (second.includes("axis") && first.includes("ray"));
}

function symbolPaths(symbol: string, start: Point, end: Point): Point[][] {
  const normalizedSymbol = symbol.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const direction = normalize({ x: end.x - start.x, y: end.y - start.y });
  const normal = { x: -direction.y, y: direction.x };
  const span = distance(start, end);
  if (span < EPSILON) throw new Error("symbol terminals must be distinct");
  const at = (along: number, across = 0): Point => ({
    x: start.x + direction.x * span * along + normal.x * span * across,
    y: start.y + direction.y * span * along + normal.y * span * across,
  });
  const circleAt = (along: number, radiusFraction = 0.2): Point[] => {
    const center = at(along);
    const radius = span * radiusFraction;
    return Array.from({ length: 25 }, (_, index) => {
      const theta = index / 24 * Math.PI * 2;
      return {
        x: center.x + radius * Math.cos(theta),
        y: center.y + radius * Math.sin(theta),
      };
    });
  };

  if (normalizedSymbol === "resistor") {
    return [[
      at(0), at(0.18), at(0.25, 0.1), at(0.35, -0.1), at(0.45, 0.1),
      at(0.55, -0.1), at(0.65, 0.1), at(0.75, -0.1), at(0.82), at(1),
    ]];
  }
  if (normalizedSymbol === "battery" || normalizedSymbol === "cell") {
    return [
      [at(0), at(0.43)],
      [at(0.43, -0.16), at(0.43, 0.16)],
      [at(0.57, -0.09), at(0.57, 0.09)],
      [at(0.57), at(1)],
    ];
  }
  if (normalizedSymbol === "capacitor") {
    return [
      [at(0), at(0.43)],
      [at(0.43, -0.17), at(0.43, 0.17)],
      [at(0.57, -0.17), at(0.57, 0.17)],
      [at(0.57), at(1)],
    ];
  }
  if (normalizedSymbol === "inductor" || normalizedSymbol === "coil") {
    const coil = Array.from({ length: 33 }, (_, index) => {
      const progress = index / 32;
      return at(0.2 + progress * 0.6, 0.1 * Math.sin(progress * Math.PI * 8));
    });
    return [[at(0), at(0.2)], coil, [at(0.8), at(1)]];
  }
  if (normalizedSymbol === "lamp") {
    const circle = circleAt(0.5, 0.22);
    return [[at(0), at(0.28)], circle, [at(0.34, -0.12), at(0.66, 0.12)], [at(0.34, 0.12), at(0.66, -0.12)], [at(0.72), at(1)]];
  }
  if (
    normalizedSymbol === "galvanometer" ||
    normalizedSymbol === "ammeter" ||
    normalizedSymbol === "voltmeter"
  ) {
    return [[at(0), at(0.28)], circleAt(0.5), [at(0.72), at(1)]];
  }
  if (normalizedSymbol === "ac_source" || normalizedSymbol === "alternating_source") {
    const wave = Array.from({ length: 17 }, (_, index) => {
      const progress = index / 16;
      return at(0.34 + progress * 0.32, 0.07 * Math.sin(progress * Math.PI * 2));
    });
    return [[at(0), at(0.28)], circleAt(0.5), wave, [at(0.72), at(1)]];
  }
  if (normalizedSymbol === "diode" || normalizedSymbol === "zener") {
    const cathode = normalizedSymbol === "zener"
      ? [at(0.64, -0.17), at(0.68, -0.11), at(0.68, 0.11), at(0.72, 0.17)]
      : [at(0.68, -0.17), at(0.68, 0.17)];
    return [
      [at(0), at(0.32)],
      [at(0.32, -0.16), at(0.32, 0.16), at(0.64), at(0.32, -0.16)],
      cathode,
      [at(0.68), at(1)],
    ];
  }
  if (normalizedSymbol === "switch") {
    return [
      [at(0), at(0.38)],
      [at(0.38), at(0.7, -0.14)],
      [at(0.7), at(1)],
    ];
  }
  throw new Error(`unsupported symbol ${normalizedSymbol}`);
}

function routedSymbolPaths(symbol: string, start: Point, end: Point, lane: number): Point[][] {
  if (Math.abs(lane) < EPSILON) return symbolPaths(symbol, start, end);
  const direction = normalize({ x: end.x - start.x, y: end.y - start.y });
  const normal = { x: -direction.y, y: direction.x };
  const offset = distance(start, end) * lane;
  const shiftedStart = { x: start.x + normal.x * offset, y: start.y + normal.y * offset };
  const shiftedEnd = { x: end.x + normal.x * offset, y: end.y + normal.y * offset };
  return [
    [start, shiftedStart],
    ...symbolPaths(symbol, shiftedStart, shiftedEnd),
    [shiftedEnd, end],
  ];
}

/** Assign stable, symmetric lanes to parallel symbols while topology keeps the
 * original shared terminal pair. Values are fractions of the terminal span. */
function computeParallelLaneOffsets(document: SceneDocument): Map<string, number> {
  const byPair = new Map<string, string[]>();
  for (const construction of document.constructions) {
    if (construction.operator !== "symbol" || !construction.outputs[0]) continue;
    const start = construction.inputs.start;
    const end = construction.inputs.end;
    if (typeof start !== "string" || typeof end !== "string" || start === end) continue;
    const pair = start < end ? `${start}|${end}` : `${end}|${start}`;
    byPair.set(pair, [...(byPair.get(pair) ?? []), construction.outputs[0]]);
  }
  const offsets = new Map<string, number>();
  for (const ids of byPair.values()) {
    if (ids.length < 2) continue;
    const middle = (ids.length - 1) / 2;
    ids.forEach((id, index) => offsets.set(id, (index - middle) * 0.42));
  }
  return offsets;
}

function computeLogicalLayout(document: SceneDocument): Map<string, Point> {
  const layoutPoints = new Map<string, Point>();
  for (const construction of document.constructions) {
    if (
      construction.operator === "point" &&
      construction.inputs.coordinateSpace === "layout" &&
      construction.outputs[0]
    ) {
      const x = construction.inputs.x;
      const y = construction.inputs.y;
      if (typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)) {
        layoutPoints.set(construction.outputs[0], { x, y });
      }
    }
  }

  const edges: Array<[string, string]> = [];
  for (const construction of document.constructions) {
    if (construction.operator !== "symbol" && construction.operator !== "connect") continue;
    const start = construction.inputs.start;
    const end = construction.inputs.end;
    if (typeof start !== "string" || typeof end !== "string") continue;
    if (!layoutPoints.has(start) || !layoutPoints.has(end)) continue;
    if (start === end) continue;
    edges.push([start, end]);
  }
  if (edges.length < 3) return new Map();

  const adjacency = new Map<string, string[]>();
  for (const [start, end] of edges) {
    adjacency.set(start, [...(adjacency.get(start) ?? []), end]);
    adjacency.set(end, [...(adjacency.get(end) ?? []), start]);
  }

  const result = new Map<string, Point>();
  const visited = new Set<string>();
  for (const root of adjacency.keys()) {
    if (visited.has(root)) continue;
    const component: string[] = [];
    const stack = [root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (visited.has(node)) continue;
      visited.add(node);
      component.push(node);
      for (const neighbor of adjacency.get(node) ?? []) {
        if (!visited.has(neighbor)) stack.push(neighbor);
      }
    }

    // Only canonicalize a simple closed loop. Branched and multi-view graphs
    // retain planner layout coordinates; flattening them onto one polygon is
    // what caused parallel branches and separate circuits to cross.
    if (component.length < 3 || component.some((id) => adjacency.get(id)?.length !== 2)) continue;
    const componentSet = new Set(component);
    const componentEdgeCount = edges.filter(([a, b]) => componentSet.has(a) && componentSet.has(b)).length;
    if (componentEdgeCount !== component.length) continue;

    const first = [...component].sort((a, b) => {
      const pa = layoutPoints.get(a)!;
      const pb = layoutPoints.get(b)!;
      return pa.x - pb.x || pa.y - pb.y || a.localeCompare(b);
    })[0]!;
    const order = [first];
    let previous: string | null = null;
    let current = first;
    while (order.length < component.length) {
      const next = (adjacency.get(current) ?? []).find((candidate) =>
        candidate !== previous && !order.includes(candidate));
      if (!next) break;
      order.push(next);
      previous = current;
      current = next;
    }
    if (order.length !== component.length) continue;

    const originals = component.map((id) => layoutPoints.get(id)!);
    const minX = Math.min(...originals.map((point) => point.x));
    const maxX = Math.max(...originals.map((point) => point.x));
    const minY = Math.min(...originals.map((point) => point.y));
    const maxY = Math.max(...originals.map((point) => point.y));
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    const radiusX = Math.max((maxX - minX) / 2, 3);
    const radiusY = Math.max((maxY - minY) / 2, 2);
    order.forEach((id, index) => {
      const angle = Math.PI - index / order.length * Math.PI * 2;
      result.set(id, {
        x: center.x + Math.cos(angle) * radiusX,
        y: center.y + Math.sin(angle) * radiusY,
      });
    });
  }
  return result;
}
function finitePoint(point:Point):boolean{return Number.isFinite(point.x)&&Number.isFinite(point.y);}
function round(value:number):number{return Math.round(value*100)/100;}
function circleBounds(center:Point,radius:number):Point[]{return[{x:center.x-radius,y:center.y-radius},{x:center.x+radius,y:center.y+radius}];}
function boundsOf(points:Point[]){const xs=points.map((p)=>p.x),ys=points.map((p)=>p.y);const x=Math.min(...xs),y=Math.min(...ys);return{x,y,width:Math.max(...xs)-x,height:Math.max(...ys)-y};}
function unionBounds(a:{x:number;y:number;width:number;height:number},b:{x:number;y:number;width:number;height:number}){const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),right=Math.max(a.x+a.width,b.x+b.width),bottom=Math.max(a.y+a.height,b.y+b.height);return{x,y,width:right-x,height:bottom-y};}
function assertNeverSceneCapability(capability: never): never {
  throw new Error(`unhandled scene capability ${String(capability)}`);
}
function errorMessage(error:unknown):string{return error instanceof Error?error.message:String(error);}
function isRecord(value:unknown):value is Record<string,unknown>{return typeof value==="object"&&value!==null&&!Array.isArray(value);}
