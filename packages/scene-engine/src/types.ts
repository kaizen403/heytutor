export const SCENE_DOCUMENT_VERSION = "scene-document/v2" as const;
export const SCENE_ENGINE_VERSION = "scene-engine/2.0.0" as const;

export type VisualMode = "scene" | "text_only";
export type Severity = "fatal" | "warning";

export interface SceneIssue {
  code: string;
  message: string;
  severity: Severity;
  path?: string;
  entityIds?: string[];
  expected?: unknown;
  actual?: unknown;
  residual?: number;
}

export interface ValidationReport {
  engineVersion: string;
  valid: boolean;
  issues: SceneIssue[];
  stats: {
    entityCount: number;
    constructionCount: number;
    primitiveCount: number;
    assertionCount: number;
  };
}

export interface SceneEntity {
  id: string;
  kind: string;
  role: string;
  label?: string;
  semantic?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
}

export interface SceneConstruction {
  id: string;
  operator: string;
  inputs: Record<string, unknown>;
  outputs: string[];
  reason?: string;
}

export interface SceneRelation {
  id: string;
  predicate: string;
  entities: string[];
  value?: unknown;
}

export interface SceneAssertion {
  id: string;
  predicate: string;
  entities: string[];
  expected?: unknown;
  tolerance?: unknown;
  severity: Severity;
  reason?: string;
}

export const SCENE_ANNOTATION_KINDS = [
  "label",
  "callout",
  "narration",
  "enclose",
  "highlight",
  "trace",
  "badge",
  "spin",
  "equal_tick",
  "equal_arc",
  "parallel_mark",
  "hatch",
  "brace",
  "endpoint",
  "loop",
  "sense",
  "drop",
  "ghost",
  "extend",
  "frame",
  "polarity",
  "slope_triangle",
] as const;

export type SceneAnnotationKind = (typeof SCENE_ANNOTATION_KINDS)[number];

export type SceneAnnotationPointStyle = "filled" | "open" | "cross" | "square";

export interface SceneAnnotationStyle {
  count?: 1 | 2 | 3;
  pointStyle?: SceneAnnotationPointStyle;
  transient?: boolean;
}

export interface SceneAnnotation {
  id: string;
  kind: string;
  targetIds: string[];
  text?: string;
  quantityId?: string;
  placementIntent?: string;
  style?: SceneAnnotationStyle;
}

export interface SceneRevealGroup {
  id: string;
  entityIds: string[];
  dependsOn: string[];
  narrationCue: string;
}

export interface SceneTeachingAction {
  id: string;
  action: "reveal" | "focus" | "annotate";
  targetId: string;
  dependsOn: string[];
  narrationIntent: string;
}

export interface SceneDocument {
  schemaVersion: typeof SCENE_DOCUMENT_VERSION;
  visualDecision: { mode: VisualMode; reason: string };
  source: Record<string, unknown>;
  quantities: Array<Record<string, unknown> & { id: string }>;
  entities: SceneEntity[];
  constructions: SceneConstruction[];
  relations: SceneRelation[];
  assertions: SceneAssertion[];
  annotations: SceneAnnotation[];
  requiredEntityIds: string[];
  revealGroups: SceneRevealGroup[];
  teachingTimeline: SceneTeachingAction[];
}

export interface RenderPoint { x: number; y: number }

export type RenderPrimitiveKind =
  | "point"
  | "line"
  | "ray"
  | "circle"
  | "arc"
  | "rectangle"
  | "polygon"
  | "polyline"
  | "vector"
  | "axes"
  | "label"
  | "dimension";

export interface RenderPrimitive {
  id: string;
  entityId: string;
  groupId: string;
  kind: RenderPrimitiveKind;
  points: RenderPoint[];
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  text?: string;
  labelPlacement?: string;
  provenance?: Record<string, unknown>;
}

export interface RenderScene {
  engineVersion: string;
  primitives: RenderPrimitive[];
  revealGroups: SceneRevealGroup[];
  timeline: SceneTeachingAction[];
  entityBounds: Record<string, { x: number; y: number; width: number; height: number }>;
  caption?: string;
}

export interface CompileResult {
  ok: boolean;
  renderScene: RenderScene | null;
  report: ValidationReport;
}

export interface ValidationResult {
  document: SceneDocument | null;
  report: ValidationReport;
}

export interface CompileOptions {
  viewport?: { x: number; y: number; width: number; height: number; padding?: number };
}
