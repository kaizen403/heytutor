/**
 * Deterministic repairs of planner shapes that carry no geometric claim of
 * their own. Each one either rewrites a document part into the exact form the
 * validator already proves, or drops a part nothing reads; neither can add a
 * mark, a value or a proof.
 */
import type { SceneIssue } from "../types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ID_FIELDS = [
  "quantities", "entities", "constructions", "relations", "assertions",
  "annotations", "revealGroups", "teachingTimeline",
] as const;

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * `relations` are never compiled, proven or rendered; their only effect is to
 * keep the entities they name from orphan pruning. Planners write them as
 * `{kind, entities}`, `{predicate, entities}` or `{on: [a, b]}`, mostly with
 * no id, and the id stage then refused the whole document before any real
 * error reached the repair prompt.
 *
 * Each entry is read as `{id, predicate, entities, value?}`:
 * - a missing or empty id gets `relation_<n>`, never an id the document
 *   already uses;
 * - the predicate comes from `predicate`, then `kind`, then `type`, or from
 *   the single array-valued key of a `{on: [a, b]}` entry;
 * - an entry that is not an object, has no predicate, no entity list, a
 *   non-string entity, or an entity the document never declares or constructs
 *   is dropped and recorded as a `relation_dropped` warning.
 *
 * An id written by the planner is kept as written, so an id that collides
 * with another part still fails the id stage as `duplicate_id`.
 */
export function normalizeSceneRelations(raw: Record<string, unknown>): { relations: unknown; issues: SceneIssue[] } {
  if (!Array.isArray(raw.relations)) return { relations: raw.relations, issues: [] };
  const known = new Set<string>();
  for (const entity of Array.isArray(raw.entities) ? raw.entities : []) {
    if (isRecord(entity) && nonEmptyString(entity.id)) known.add(entity.id);
  }
  for (const construction of Array.isArray(raw.constructions) ? raw.constructions : []) {
    if (!isRecord(construction) || !Array.isArray(construction.outputs)) continue;
    for (const output of construction.outputs) if (nonEmptyString(output)) known.add(output);
  }
  const usedIds = new Set<string>();
  for (const field of ID_FIELDS) {
    for (const item of Array.isArray(raw[field]) ? raw[field] as unknown[] : []) {
      if (isRecord(item) && nonEmptyString(item.id)) usedIds.add(item.id);
    }
  }
  let next = 1;
  const freshId = (): string => {
    while (usedIds.has(`relation_${next}`)) next += 1;
    const id = `relation_${next}`;
    usedIds.add(id);
    return id;
  };

  const issues: SceneIssue[] = [];
  const drop = (index: number, reason: string, entityIds?: string[]) => {
    issues.push({
      code: "relation_dropped",
      message: `relations[${index}] dropped: ${reason}. Relations are not drawn or proved; state a checked fact as an assertion.`,
      severity: "warning",
      path: `relations[${index}]`,
      ...(entityIds ? { entityIds } : {}),
    });
  };
  const relations: unknown[] = [];
  raw.relations.forEach((entry, index) => {
    if (!isRecord(entry)) return drop(index, "not an object");
    let predicate = [entry.predicate, entry.kind, entry.type].find(nonEmptyString);
    let entities: unknown = entry.entities;
    if (entities === undefined && predicate === undefined) {
      const arrayKeys = Object.keys(entry).filter((key) => Array.isArray(entry[key]));
      const otherKeys = Object.keys(entry).filter((key) => !arrayKeys.includes(key) && key !== "id" && key !== "value");
      if (arrayKeys.length === 1 && otherKeys.length === 0) {
        predicate = arrayKeys[0];
        entities = entry[arrayKeys[0]!];
      }
    }
    if (!nonEmptyString(predicate)) return drop(index, "no predicate");
    if (!Array.isArray(entities) || entities.length === 0 || !entities.every(nonEmptyString)) {
      return drop(index, "no list of entity ids");
    }
    const unknown = entities.filter((id) => !known.has(id));
    if (unknown.length > 0) return drop(index, `unknown entity ${unknown.join(", ")}`, unknown);
    const hasId = nonEmptyString(entry.id);
    if (hasId && entry.predicate === predicate && entry.entities === entities) {
      relations.push(entry);
      return;
    }
    relations.push({
      id: hasId ? entry.id : freshId(),
      predicate,
      entities,
      ...(entry.value !== undefined ? { value: entry.value } : {}),
    });
  });
  return { relations, issues };
}

/** Straight 2D carriers whose first two points span the projected line. */
const PLANAR_LINE_OPERATORS = new Set(["line", "segment", "ray"]);

/**
 * `space_project` onto a line is the foot of the perpendicular,
 * `l + d̂ (d̂ · (p - l))`. When its `frame` is a 2D `axes` output, its point a
 * planar point and its target a planar line, segment or ray, the 2D `project`
 * operator computes that same foot, `a + t (b - a)` with
 * `t = (p - a) · (b - a) / |b - a|²`, in the same world coordinates. Such a
 * construction is rewritten to `project`. Any other `space_project` is left
 * for the space validator; when its point and target are planar but its frame
 * is no frame at all, a warning names `project` so the repair prompt does.
 */
export function normalizePlanarSpaceProjections(raw: Record<string, unknown>): { constructions: unknown; issues: SceneIssue[] } {
  if (!Array.isArray(raw.constructions)) return { constructions: raw.constructions, issues: [] };
  const producer = new Map<string, string>();
  for (const construction of raw.constructions) {
    if (!isRecord(construction) || typeof construction.operator !== "string" || !Array.isArray(construction.outputs)) continue;
    for (const output of construction.outputs) if (nonEmptyString(output)) producer.set(output, construction.operator);
  }
  const planar = (operator: string | undefined) =>
    operator !== undefined && !operator.startsWith("space_") && operator !== "plane" && operator !== "solid_anchor";
  const issues: SceneIssue[] = [];
  let changed = false;
  const constructions = raw.constructions.map((construction, index) => {
    if (!isRecord(construction) || construction.operator !== "space_project" || !isRecord(construction.inputs)) return construction;
    const { frame, point, onto, ...rest } = construction.inputs;
    const planarInputs = nonEmptyString(point) && planar(producer.get(point)) &&
      nonEmptyString(onto) && planar(producer.get(onto));
    if (
      planarInputs && Object.keys(rest).length === 0 && nonEmptyString(frame) && producer.get(frame) === "axes" &&
      PLANAR_LINE_OPERATORS.has(producer.get(onto as string) ?? "")
    ) {
      changed = true;
      return { ...construction, operator: "project", inputs: { point, onto } };
    }
    if (planarInputs && !(nonEmptyString(frame) && producer.get(frame) === "space_frame")) {
      issues.push({
        code: "space_project_on_planar_inputs",
        message: `constructions[${index}] projects a 2D point onto 2D geometry without a space_frame. ` +
          `For the foot of a perpendicular in a 2D figure use {"operator":"project","inputs":{"point":${JSON.stringify(point)},"onto":${JSON.stringify(onto)}}}.`,
        severity: "warning",
        path: `constructions[${index}].operator`,
      });
    }
    return construction;
  });
  return { constructions: changed ? constructions : raw.constructions, issues };
}
