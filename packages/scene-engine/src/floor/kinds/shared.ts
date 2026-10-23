import {
  SCENE_DOCUMENT_VERSION,
  type SceneAnnotation,
  type SceneAssertion,
  type SceneConstruction,
  type SceneDocument,
  type SceneEntity,
} from "../../types";
import { FLOOR_FIGURE_VERSION, type FloorFacts, type FloorObject } from "../facts";

export interface FloorGroup {
  id: string;
  entityIds: string[];
  cue: string;
}

export interface FloorParts {
  entities: SceneEntity[];
  constructions: SceneConstruction[];
  assertions: SceneAssertion[];
  annotations: SceneAnnotation[];
  groups: FloorGroup[];
}

export function emptyParts(): FloorParts {
  return { entities: [], constructions: [], assertions: [], annotations: [], groups: [] };
}

/** Every floor entity names the stated fact it draws. */
export function floorEntity(
  id: string,
  kind: string,
  role: string,
  label: string | null,
  source: { objectId?: string; quantityIds?: string[]; stated?: string },
): SceneEntity {
  return {
    id,
    kind,
    role,
    ...(label ? { label } : {}),
    provenance: { floor: true, ...source },
  };
}

export function point(id: string, x: number, y: number): SceneConstruction {
  return { id: `place_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: [id] };
}

/** A supplemental value label beside an entity whose own label is a source name. */
export function appendLabel(id: string, target: string, text: string): SceneAnnotation {
  return { id, kind: "label", targetIds: [target], text, labelMode: "append" };
}

/** The document envelope every floor kind shares: source, tier, stated quantities, staged reveal. */
export function floorDocument(facts: FloorFacts, kind: string, parts: FloorParts, reason: string): SceneDocument {
  const groups = parts.groups.filter((group) => group.entityIds.length > 0);
  return {
    schemaVersion: SCENE_DOCUMENT_VERSION,
    visualDecision: { mode: "scene", reason },
    source: {
      question: facts.question,
      floorFigure: FLOOR_FIGURE_VERSION,
      floorKind: kind,
      representationTier: "question_representation",
      nonMetric: true,
      omittedClaims: ["derived values", "forces and fields not stated", "rays", "metric scale"],
    },
    quantities: facts.values.map((value) => ({
      id: value.quantityId,
      symbol: value.symbol,
      value: value.value,
      ...(value.unit ? { unit: value.unit } : {}),
      sourceText: value.valueText,
    })),
    entities: parts.entities,
    constructions: parts.constructions,
    relations: [],
    assertions: parts.assertions,
    annotations: parts.annotations,
    requiredEntityIds: parts.entities.map((entity) => entity.id),
    revealGroups: groups.map((group, index) => ({
      id: group.id,
      entityIds: group.entityIds,
      dependsOn: index === 0 ? [] : [groups[index - 1]!.id],
      narrationCue: group.cue,
    })),
    teachingTimeline: groups.map((group, index) => ({
      id: `reveal_${group.id}`,
      action: "reveal" as const,
      targetId: group.id,
      dependsOn: index === 0 ? [] : [`reveal_${groups[index - 1]!.id}`],
      narrationIntent: group.cue,
    })),
  };
}

/** Objects a ProblemIR representation intent obligates the figure to show. */
export function obligatedObjects(facts: FloorFacts): FloorObject[] {
  const ids = new Set(facts.intents.flatMap((intent) => intent.entityIds));
  return facts.objects.filter((object) => ids.has(object.id));
}

/** The label an obligated object must carry: its ProblemIR label, unchanged. */
export function problemLabel(facts: FloorFacts, objectId: string): string | null {
  return facts.problem?.entities.find((entity) => entity.id === objectId)?.label ?? null;
}
