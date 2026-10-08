import {
  SCENE_DOCUMENT_VERSION,
  type SceneConstruction,
  type SceneDocument,
  type SceneEntity,
} from "../../types";

export type DeclaredScope = "solved" | "qualitative" | "setup_only" | "text_only";

export interface TopicBinding {
  topicId: string;
  packet: string;
  chapter: string;
  remaining: string;
}

export interface EmModel {
  name: string;
  family: string;
  scope: DeclaredScope;
  assumptions: string;
  topics: TopicBinding[];
  keys: readonly string[];
  ordinary: Record<string, number>;
  altered: Record<string, number>;
  rejections: Record<string, number>[];
  build(inputs: Record<string, unknown>): SceneDocument;
}

export function finiteInputs(inputs: Record<string, unknown>, keys: readonly string[]): Record<string, number> {
  const extra = Object.keys(inputs).filter((key) => !keys.includes(key));
  if (extra.length > 0) throw new Error(`unsupported inputs: ${extra.join(", ")}`);
  const values: Record<string, number> = {};
  for (const key of keys) {
    const value = inputs[key];
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} must be a finite number`);
    values[key] = value;
  }
  return values;
}

export function positive(value: number, key: string): number {
  if (!(value > 0)) throw new Error(`${key} must be positive`);
  return value;
}

export function agree(actual: number, expected: number, key: string): number {
  if (Math.abs(actual - expected) > 1e-8 * Math.max(1, Math.abs(expected))) {
    throw new Error(`${key} is ${actual}, expected ${expected}`);
  }
  return expected;
}

export const numberContext = {
  number(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    throw new Error("expected a finite number");
  },
  point(value: unknown): { x: number; y: number } {
    if (Array.isArray(value) && value.length === 2 && value.every((entry) => typeof entry === "number")) {
      return { x: value[0] as number, y: value[1] as number };
    }
    if (typeof value === "object" && value !== null && "x" in value && "y" in value) {
      const point = value as { x: unknown; y: unknown };
      if (typeof point.x === "number" && typeof point.y === "number") return { x: point.x, y: point.y };
    }
    throw new Error("expected an inline point");
  },
  geometry(): undefined {
    return undefined;
  },
};

export function sceneDocument(args: {
  model: string;
  family: string;
  scope: DeclaredScope;
  assumptions: string;
  certified: Record<string, number>;
  entities?: SceneEntity[];
  constructions?: SceneConstruction[];
}): SceneDocument {
  const entities = args.entities ?? [];
  const constructions = args.constructions ?? [];
  const textOnly = args.scope === "text_only";
  if (textOnly && (entities.length > 0 || constructions.length > 0)) {
    throw new Error("text_only models cannot carry diagram marks");
  }
  return {
    schemaVersion: SCENE_DOCUMENT_VERSION,
    visualDecision: {
      mode: textOnly ? "text_only" : "scene",
      reason: args.assumptions,
    },
    source: {
      explicitPhysicalModel: args.model,
      family: args.family,
      declaredScope: args.scope,
      assumptions: args.assumptions,
      certified: args.certified,
      displayScaleIsNotMeasurement: true,
    },
    quantities: Object.entries(args.certified).map(([id, value]) => ({ id: `certified_${id}`, value })),
    entities,
    constructions: constructions.map((item, index) => ({ ...item, id: `build_${index}_${item.id}` })),
    relations: [],
    assertions: [],
    annotations: [],
    requiredEntityIds: entities.map((entity) => entity.id),
    revealGroups: textOnly ? [] : [{
      id: "model",
      entityIds: entities.map((entity) => entity.id),
      dependsOn: [],
      narrationCue: "Reveal the source-declared diagram.",
    }],
    teachingTimeline: [],
  };
}

export function entity(id: string, kind: string, role: string): SceneEntity {
  return { id, kind, role };
}

export function construction(id: string, operator: string, inputs: Record<string, unknown>, outputs: string[]): SceneConstruction {
  return { id, operator, inputs, outputs };
}
