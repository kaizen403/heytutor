/**
 * Scene IR — semantic diagram description filled by the autoformalizer LLM.
 * The Geometry Compiler owns all pixel coordinates; the LLM must not invent them.
 */

export const SCENE_KINDS = [
  "optics",
  "circuit",
  "projectile",
  "axes_plot",
  "euclidean",
  "incline",
  "fbd",
  "generic",
] as const;

export type SceneKind = (typeof SCENE_KINDS)[number];

export const ENTITY_TYPES = [
  "point",
  "segment",
  "ray",
  "line",
  "circle",
  "arc",
  "rect",
  "polygon",
  "curve",
  "arrow",
  "label",
  "dimension",
  "group",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export const CONSTRAINT_TYPES = [
  "on",
  "midpoint",
  "parallel",
  "perpendicular",
  "distance",
  "angle",
  "intersect",
  "reflect",
  "along_axis",
  "left_of",
  "right_of",
  "above",
  "below",
  "equal_length",
] as const;

export type ConstraintType = (typeof CONSTRAINT_TYPES)[number];

export type EntityRole =
  | "object"
  | "focus"
  | "optic"
  | "axis"
  | "image"
  | "center"
  | "pole"
  | "normal"
  | "force"
  | "ground"
  | "node"
  | "component"
  | string;

export interface SceneEntity {
  id: string;
  type: EntityType;
  /** Semantic role for plugins and prompt addons. */
  role?: EntityRole;
  /** Physical / layout attrs (u_cm, f_cm, angle_deg, width, …) — never raw teaching pixels. */
  attrs?: Record<string, number | string | boolean | null>;
  text?: string;
  /** Endpoint / membership refs by entity id. */
  from?: string;
  to?: string;
  center?: string;
  through?: string[];
  points?: string[];
}

export interface SceneConstraint {
  type: ConstraintType;
  /** Entity ids involved (order matters for directed constraints). */
  entities: string[];
  value?: number;
  unit?: string;
}

export interface SceneIntroPhase {
  narration: string;
  entityIds: string[];
}

export interface SceneSpec {
  kind: SceneKind;
  diagramType: string;
  entities: SceneEntity[];
  constraints: SceneConstraint[];
  /** Known measured quantities (u_cm, f_cm, angle_deg, …). */
  quantities?: Record<string, number>;
  givens: string[];
  asks: string[];
  introNarration: string;
  promptAddon: string;
  introPhases?: SceneIntroPhase[];
  /** Entity ids the teaching LLM may still draw (e.g. extra rays). */
  allowAdditions?: string[];
}

const ENTITY_TYPE_SET = new Set<string>(ENTITY_TYPES);
const CONSTRAINT_TYPE_SET = new Set<string>(CONSTRAINT_TYPES);
const SCENE_KIND_SET = new Set<string>(SCENE_KINDS);

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function sanitizeAttrs(
  attrs: unknown,
): Record<string, number | string | boolean | null> | undefined {
  if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) return undefined;
  const out: Record<string, number | string | boolean | null> = {};
  for (const [key, value] of Object.entries(attrs as Record<string, unknown>)) {
    if (
      typeof value === "number" ||
      typeof value === "string" ||
      typeof value === "boolean" ||
      value === null
    ) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeQuantities(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
      out[key] = raw;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Validate and sanitize a raw SceneSpec from the planner LLM.
 * Returns null when the scene is unusable (no entities / bad shape).
 */
export function validateSceneSpec(raw: unknown): SceneSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const plan = raw as Record<string, unknown>;

  const kindRaw = typeof plan.kind === "string" ? plan.kind : typeof plan.diagramType === "string" ? plan.diagramType : "generic";
  const kind: SceneKind = SCENE_KIND_SET.has(kindRaw)
    ? (kindRaw as SceneKind)
    : inferKindFromDiagramType(typeof plan.diagramType === "string" ? plan.diagramType : kindRaw);

  const diagramType =
    typeof plan.diagramType === "string" && plan.diagramType.trim().length > 0
      ? plan.diagramType.trim()
      : kind;

  const entitiesRaw = Array.isArray(plan.entities) ? plan.entities : [];
  const entities: SceneEntity[] = [];
  const seenIds = new Set<string>();

  for (const item of entitiesRaw) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    if (typeof e.id !== "string" || e.id.trim().length === 0) continue;
    if (typeof e.type !== "string" || !ENTITY_TYPE_SET.has(e.type)) continue;
    const id = e.id.trim();
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    entities.push({
      id,
      type: e.type as EntityType,
      role: typeof e.role === "string" ? e.role : undefined,
      attrs: sanitizeAttrs(e.attrs),
      text: typeof e.text === "string" ? e.text : undefined,
      from: typeof e.from === "string" ? e.from : undefined,
      to: typeof e.to === "string" ? e.to : undefined,
      center: typeof e.center === "string" ? e.center : undefined,
      through: asStringArray(e.through),
      points: asStringArray(e.points),
    });
  }

  if (entities.length < 1) return null;

  const constraintsRaw = Array.isArray(plan.constraints) ? plan.constraints : [];
  const constraints: SceneConstraint[] = [];
  for (const item of constraintsRaw) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    if (typeof c.type !== "string" || !CONSTRAINT_TYPE_SET.has(c.type)) continue;
    const entityIds = asStringArray(c.entities);
    if (entityIds.length < 1) continue;
    constraints.push({
      type: c.type as ConstraintType,
      entities: entityIds,
      value: typeof c.value === "number" && Number.isFinite(c.value) ? c.value : undefined,
      unit: typeof c.unit === "string" ? c.unit : undefined,
    });
  }

  const promptAddon = typeof plan.promptAddon === "string" ? plan.promptAddon.trim() : "";
  if (promptAddon.length === 0) return null;

  const introPhasesRaw = Array.isArray(plan.introPhases) ? plan.introPhases : [];
  const introPhases: SceneIntroPhase[] = [];
  for (const item of introPhasesRaw) {
    if (!item || typeof item !== "object") continue;
    const phase = item as Record<string, unknown>;
    if (typeof phase.narration !== "string") continue;
    const entityIds = asStringArray(phase.entityIds);
    if (entityIds.length === 0) continue;
    introPhases.push({ narration: phase.narration.trim(), entityIds });
  }

  return {
    kind,
    diagramType,
    entities,
    constraints,
    quantities: sanitizeQuantities(plan.quantities),
    givens: asStringArray(plan.givens),
    asks: asStringArray(plan.asks),
    introNarration: typeof plan.introNarration === "string" ? plan.introNarration.trim() : "",
    promptAddon,
    introPhases: introPhases.length > 0 ? introPhases : undefined,
    allowAdditions: asStringArray(plan.allowAdditions),
  };
}

function inferKindFromDiagramType(diagramType: string): SceneKind {
  const id = diagramType.toLowerCase();
  if (/optics|lens|mirror|prism|tir|refraction/.test(id)) return "optics";
  if (/circuit|resistor|wheatstone|rc_/.test(id)) return "circuit";
  if (/projectile|parabola_motion/.test(id)) return "projectile";
  if (/axes|plot|graph|calculus|function/.test(id)) return "axes_plot";
  if (/triangle|circle|euclidean|geometry|intersect/.test(id)) return "euclidean";
  if (/incline|ramp|slope/.test(id)) return "incline";
  if (/fbd|free.?body|force/.test(id)) return "fbd";
  return "generic";
}

/** Parse JSON text (fences / trailing commas) into a validated SceneSpec. */
export function parseSceneSpecJson(content: string): SceneSpec | null {
  let text = content.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    text = fenceMatch[1]!.trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  const jsonText = text.slice(firstBrace, lastBrace + 1);
  try {
    return validateSceneSpec(JSON.parse(jsonText));
  } catch {
    try {
      const fixed = jsonText.replace(/,\s*([}\]])/g, "$1");
      return validateSceneSpec(JSON.parse(fixed));
    } catch {
      return null;
    }
  }
}
