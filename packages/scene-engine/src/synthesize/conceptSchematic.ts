/**
 * Qualitative teaching schematic from a turn plan's named systems and flows.
 *
 * An "explain the laws" question names no apparatus in the stem, so the exact
 * planner correctly refuses to invent geometry and the family builders have
 * nothing to dimension. The plan still lists the objects the explanation is
 * about (systems in contact, heat and work, two reservoirs). This compiles
 * those objects as layout-coordinate boxes and arrows, staged in reveal
 * groups, never as a metric P–V cycle or other canned apparatus.
 *
 * Grounded in the plan, not a topic template: no plan objects → no scene.
 */
import { SCENE_DOCUMENT_VERSION } from "../types";
import type {
  SceneAnnotation,
  SceneAssertion,
  SceneConstruction,
  SceneDocument,
  SceneEntity,
  SceneRevealGroup,
  SceneTeachingAction,
} from "../types";

export const CONCEPT_SCHEMATIC_FAMILY = "concept_schematic";

interface SpatialHint {
  kind: "system" | "reservoir" | "engine" | "flow" | "instrument";
  id: string;
  label: string;
  role: string;
}

interface BoxSpec {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  role: string;
  groupId: string;
}

interface ArrowSpec {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  label: string;
  role: string;
  groupId: string;
}

interface SegmentSpec {
  id: string;
  startId: string;
  endId: string;
  role: string;
  groupId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clipLabel(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.slice(0, 16);
}

function planLooksNumeric(turnPlan: unknown): boolean {
  if (!isRecord(turnPlan)) return false;
  const givens = Array.isArray(turnPlan.givens) ? turnPlan.givens : [];
  let count = 0;
  for (const row of givens) {
    if (isRecord(row) && typeof row.value === "number" && Number.isFinite(row.value)) {
      count += 1;
    }
  }
  return count >= 2;
}

function visualNone(turnPlan: unknown): boolean {
  return isRecord(turnPlan) && turnPlan.visualRequirement === "none";
}

function classifyHint(raw: string): SpatialHint | SpatialHint[] | null {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const lower = text.toLowerCase();

  if (
    /sign convention|absolute zero|perfect crystal/.test(lower)
    && !/system|reservoir|engine|thermometer/.test(lower)
  ) {
    return null;
  }
  if (/^entropy\b|^temperature\b/.test(lower) && !/system|reservoir/.test(lower)) {
    return null;
  }

  if (/thermometer/.test(lower) || /system\s+[a-z]\s*\(.*therm/.test(lower)) {
    const letter = text.match(/\bsystem\s+([A-Za-z])/i)?.[1];
    return {
      kind: "instrument",
      id: "thermometer",
      label: clipLabel((letter ?? "C").toUpperCase()),
      role: "thermometer",
    };
  }
  if (/hot\s+reservoir/.test(lower)) {
    return { kind: "reservoir", id: "hot_res", label: "hot", role: "hot reservoir" };
  }
  if (/cold\s+reservoir/.test(lower)) {
    return { kind: "reservoir", id: "cold_res", label: "cold", role: "cold reservoir" };
  }
  if (/from hot to cold|hot to cold/.test(lower)) {
    return [
      { kind: "reservoir", id: "hot_res", label: "hot", role: "hot reservoir" },
      { kind: "reservoir", id: "cold_res", label: "cold", role: "cold reservoir" },
    ];
  }
  if (/\bheat\s+engine\b|\bengine\b/.test(lower) && !/\bheat\s*q\b/.test(lower)) {
    return { kind: "engine", id: "engine", label: "engine", role: "heat engine" };
  }
  if (/\binternal energy\b|\bdelta\s*u\b|Δu/.test(lower) && !/\bsystem\b/.test(lower)) {
    return { kind: "flow", id: "energy_u", label: "U", role: "internal energy" };
  }
  if (/\bwork\b/.test(lower) && !/\bsystem\b/.test(lower) && !/\bheat\s+engine\b/.test(lower)) {
    return { kind: "flow", id: "work_w", label: "W", role: "work" };
  }
  if (/\bheat\b/.test(lower) && !/\bengine\b/.test(lower) && !/\breservoir\b/.test(lower)) {
    return { kind: "flow", id: "heat_q", label: "Q", role: "heat" };
  }
  if (/\bQ\b/.test(text) && /\bW\b/.test(text)) {
    return [
      { kind: "flow", id: "heat_q", label: "Q", role: "heat" },
      { kind: "flow", id: "work_w", label: "W", role: "work" },
    ];
  }
  const namedSystem = text.match(/\bsystems?\s+([A-Za-z])\b/i);
  if (namedSystem?.[1]) {
    const letter = namedSystem[1].toLowerCase();
    return {
      kind: "system",
      id: `sys_${letter}`,
      label: letter.toUpperCase(),
      role: "system",
    };
  }
  if (/\bsystems?\b/.test(lower) || /\bthird system\b/.test(lower)) {
    return { kind: "system", id: "system", label: "sys", role: "system" };
  }
  return null;
}

function pushHint(into: SpatialHint[], value: SpatialHint | SpatialHint[] | null): void {
  if (!value) return;
  const items = Array.isArray(value) ? value : [value];
  for (const item of items) into.push(item);
}

function collectHints(turnPlan: unknown): SpatialHint[] {
  if (!isRecord(turnPlan)) return [];
  const found: SpatialHint[] = [];
  const claims = Array.isArray(turnPlan.qualitativeClaims) ? turnPlan.qualitativeClaims : [];
  const hintStrings: string[] = [];
  const prose: string[] = [];
  for (const claim of claims) {
    if (!isRecord(claim)) continue;
    if (Array.isArray(claim.relatedEntityHints)) {
      for (const hint of claim.relatedEntityHints) {
        if (typeof hint === "string") hintStrings.push(hint);
      }
    }
    if (typeof claim.claim === "string") prose.push(claim.claim);
    if (typeof claim.expected === "string") prose.push(claim.expected);
  }
  for (const hint of hintStrings) pushHint(found, classifyHint(hint));
  if (found.length < 2) {
    for (const text of prose) pushHint(found, classifyHint(text));
  }
  return uniquify(found);
}

function uniquify(hints: SpatialHint[]): SpatialHint[] {
  const byId = new Map<string, SpatialHint>();
  const used = new Set<string>();
  const nextSystemId = (): { id: string; label: string } => {
    for (const letter of ["a", "b", "c", "d"]) {
      const id = `sys_${letter}`;
      if (!used.has(id)) return { id, label: letter.toUpperCase() };
    }
    const id = `sys_${used.size + 1}`;
    return { id, label: `S${used.size}` };
  };
  for (const hint of hints) {
    let next = hint;
    if (hint.id === "system") {
      const assigned = nextSystemId();
      next = { ...hint, id: assigned.id, label: hint.label === "sys" ? assigned.label : hint.label };
    }
    if (used.has(next.id)) continue;
    used.add(next.id);
    byId.set(next.id, next);
  }
  return [...byId.values()];
}

function layoutPoint(id: string, x: number, y: number): SceneConstruction {
  return {
    id: `make_${id}`,
    operator: "point",
    inputs: { x, y, coordinateSpace: "layout" },
    outputs: [id],
  };
}

function exists(id: string): SceneAssertion {
  return {
    id: `${id}_exists`,
    predicate: "exists",
    entities: [id],
    expected: true,
    severity: "fatal",
  };
}

function labeled(id: string): SceneAssertion {
  return {
    id: `label_${id}`,
    predicate: "label_attached",
    entities: [id],
    expected: true,
    severity: "fatal",
  };
}

/**
 * Compile a teaching schematic from the turn plan, or null when the plan
 * names nothing spatial to draw.
 */
export function buildConceptSchematic(
  question: string,
  turnPlan: unknown,
): SceneDocument | null {
  if (!question.trim() || visualNone(turnPlan) || planLooksNumeric(turnPlan)) return null;
  const hints = collectHints(turnPlan);
  if (hints.length < 2) return null;

  const systems = hints.filter((hint) => hint.kind === "system");
  const reservoirs = hints.filter((hint) => hint.kind === "reservoir");
  const engines = hints.filter((hint) => hint.kind === "engine");
  const instruments = hints.filter((hint) => hint.kind === "instrument");
  const flows = hints.filter((hint) => hint.kind === "flow" && hint.id !== "energy_u");
  const energy = hints.find((hint) => hint.id === "energy_u");

  const boxes: BoxSpec[] = [];
  const arrows: ArrowSpec[] = [];
  const segments: SegmentSpec[] = [];
  const groupOrder: Array<{ id: string; cue: string; entityIds: string[] }> = [];

  const contactBodies = [
    ...systems,
    ...instruments,
  ];
  if (contactBodies.length >= 2) {
    const groupId = "zeroth_law";
    const entityIds: string[] = [];
    const placed = contactBodies.slice(0, 3);
    const xs = placed.length === 2 ? [-1.6, 1.6] : [-2.2, 0, 2.2];
    const y = reservoirs.length + engines.length + flows.length > 0 ? 1.8 : 0;
    placed.forEach((body, index) => {
      boxes.push({
        id: body.id,
        x: xs[index]!,
        y,
        width: 1.5,
        height: 0.95,
        label: body.label,
        role: body.role,
        groupId,
      });
      entityIds.push(body.id);
    });
    for (let index = 0; index < placed.length - 1; index += 1) {
      const id = `contact_${index + 1}`;
      segments.push({
        id,
        startId: placed[index]!.id,
        endId: placed[index + 1]!.id,
        role: "thermal contact",
        groupId,
      });
      entityIds.push(id);
    }
    groupOrder.push({
      id: groupId,
      cue: instruments.length > 0
        ? "systems in thermal contact with a thermometer"
        : "systems in thermal contact",
      entityIds,
    });
  }

  const firstLawBody = systems[0] ?? (
    flows.length > 0
      ? { id: "system", label: "sys", role: "system", kind: "system" as const }
      : null
  );
  if (firstLawBody && flows.length > 0) {
    const groupId = "first_law";
    const entityIds: string[] = [];
    const y = contactBodies.length >= 2 ? 0 : reservoirs.length > 0 ? 1.2 : 0;
    const bodyId = firstLawBody.id === systems[0]?.id && contactBodies.length >= 2
      ? "system"
      : firstLawBody.id;
    const alreadyDrawn = boxes.some((box) => box.id === bodyId);
    if (!alreadyDrawn) {
      boxes.push({
        id: bodyId,
        x: 0,
        y,
        width: 2.1,
        height: 1.2,
        label: energy ? "U" : firstLawBody.label,
        role: firstLawBody.role,
        groupId,
      });
    }
    entityIds.push(bodyId);
    const heat = flows.find((flow) => flow.id === "heat_q") ?? flows[0]!;
    arrows.push({
      id: heat.id,
      x0: -2.7,
      y0: y,
      x1: -1.15,
      y1: y,
      label: heat.label,
      role: heat.role,
      groupId,
    });
    entityIds.push(heat.id);
    const work = flows.find((flow) => flow.id === "work_w");
    if (work) {
      arrows.push({
        id: work.id,
        x0: 0,
        y0: y + 0.7,
        x1: 0,
        y1: y + 1.7,
        label: work.label,
        role: work.role,
        groupId,
      });
      entityIds.push(work.id);
    }
    groupOrder.push({
      id: groupId,
      cue: "heat Q into the system and work W leaving it",
      entityIds,
    });
  }

  if (reservoirs.length >= 2 || (reservoirs.length >= 1 && engines.length > 0)) {
    const groupId = "second_law";
    const entityIds: string[] = [];
    const yHot = contactBodies.length >= 2 || flows.length > 0 ? -1.5 : 1.1;
    const hot = reservoirs.find((item) => item.id === "hot_res") ?? reservoirs[0]!;
    const cold = reservoirs.find((item) => item.id === "cold_res")
      ?? reservoirs[1]
      ?? { id: "cold_res", label: "cold", role: "cold reservoir", kind: "reservoir" as const };
    const engine = engines[0] ?? {
      id: "engine",
      label: "engine",
      role: "heat engine",
      kind: "engine" as const,
    };
    boxes.push({
      id: hot.id,
      x: 0,
      y: yHot,
      width: 2.3,
      height: 0.7,
      label: hot.label,
      role: hot.role,
      groupId,
    });
    boxes.push({
      id: engine.id,
      x: 0,
      y: yHot - 0.95,
      width: 1.5,
      height: 0.65,
      label: engine.label,
      role: engine.role,
      groupId,
    });
    boxes.push({
      id: cold.id,
      x: 0,
      y: yHot - 1.9,
      width: 2.3,
      height: 0.7,
      label: cold.label,
      role: cold.role,
      groupId,
    });
    entityIds.push(hot.id, engine.id, cold.id);
    arrows.push({
      id: "qh",
      x0: 0,
      y0: yHot - 0.35,
      x1: 0,
      y1: yHot - 0.62,
      label: "Qh",
      role: "heat from hot reservoir",
      groupId,
    });
    entityIds.push("qh");
    arrows.push({
      id: "qc",
      x0: 0,
      y0: yHot - 1.28,
      x1: 0,
      y1: yHot - 1.55,
      label: "Qc",
      role: "heat to cold reservoir",
      groupId,
    });
    entityIds.push("qc");
    groupOrder.push({
      id: groupId,
      cue: "a heat engine between a hot reservoir and a cold reservoir",
      entityIds,
    });
  }

  if (boxes.length < 2 && arrows.length === 0) return null;

  const entities: SceneEntity[] = [];
  const constructions: SceneConstruction[] = [];
  const assertions: SceneAssertion[] = [];
  const annotations: SceneAnnotation[] = [];
  const usedIds = new Set<string>();
  const centerByBox = new Map<string, string>();

  const takeId = (id: string, fallback: string): string => {
    if (!usedIds.has(id)) {
      usedIds.add(id);
      return id;
    }
    let n = 2;
    while (usedIds.has(`${fallback}_${n}`)) n += 1;
    const next = `${fallback}_${n}`;
    usedIds.add(next);
    return next;
  };

  for (const box of boxes) {
    if (usedIds.has(box.id) && entities.some((entity) => entity.id === box.id)) {
      continue;
    }
    const centerId = takeId(`${box.id}_c`, `${box.id}_c`);
    usedIds.add(box.id);
    centerByBox.set(box.id, centerId);
    entities.push({ id: centerId, kind: "point", role: `${box.role} center` });
    entities.push({ id: box.id, kind: "rectangle", role: box.role, label: box.label });
    constructions.push(layoutPoint(centerId, box.x, box.y));
    constructions.push({
      id: `make_${box.id}`,
      operator: "rectangle",
      inputs: { center: centerId, width: box.width, height: box.height },
      outputs: [box.id],
    });
    assertions.push(exists(box.id), labeled(box.id));
  }

  for (const arrow of arrows) {
    const startId = takeId(`${arrow.id}_s`, `${arrow.id}_s`);
    const endId = takeId(`${arrow.id}_e`, `${arrow.id}_e`);
    usedIds.add(arrow.id);
    entities.push({ id: startId, kind: "point", role: `${arrow.role} start` });
    entities.push({ id: endId, kind: "point", role: `${arrow.role} end` });
    entities.push({ id: arrow.id, kind: "vector", role: arrow.role, label: arrow.label });
    constructions.push(layoutPoint(startId, arrow.x0, arrow.y0));
    constructions.push(layoutPoint(endId, arrow.x1, arrow.y1));
    constructions.push({
      id: `make_${arrow.id}`,
      operator: "vector",
      inputs: { start: startId, end: endId },
      outputs: [arrow.id],
    });
    assertions.push(exists(arrow.id), labeled(arrow.id));
  }

  for (const segment of segments) {
    const start = centerByBox.get(segment.startId);
    const end = centerByBox.get(segment.endId);
    if (!start || !end) continue;
    usedIds.add(segment.id);
    entities.push({ id: segment.id, kind: "segment", role: segment.role });
    constructions.push({
      id: `make_${segment.id}`,
      operator: "segment",
      inputs: { start, end },
      outputs: [segment.id],
    });
    assertions.push(exists(segment.id));
  }

  const revealGroups: SceneRevealGroup[] = groupOrder.map((group, index) => ({
    id: group.id,
    entityIds: [...new Set(group.entityIds.filter((id) => usedIds.has(id)))],
    dependsOn: index === 0 ? [] : [groupOrder[index - 1]!.id],
    narrationCue: group.cue,
  })).filter((group) => group.entityIds.length > 0);

  if (revealGroups.length === 0) {
    revealGroups.push({
      id: "setup",
      entityIds: entities.filter((entity) => entity.label).map((entity) => entity.id),
      dependsOn: [],
      narrationCue: "the named systems and flows from the explanation",
    });
  }

  const teachingTimeline: SceneTeachingAction[] = revealGroups.map((group, index) => ({
    id: `reveal_${group.id}`,
    action: "reveal",
    targetId: group.id,
    dependsOn: index === 0 ? [] : [`reveal_${revealGroups[index - 1]!.id}`],
    narrationIntent: group.narrationCue,
  }));

  const labeledCount = entities.filter((entity) => entity.label).length;
  if (labeledCount < 2) return null;

  return {
    schemaVersion: SCENE_DOCUMENT_VERSION,
    visualDecision: {
      mode: "scene",
      reason: "qualitative teaching schematic from the turn plan's named systems and flows",
    },
    source: {
      question,
      synthesizedFamily: true,
      conceptSchematic: true,
      representationTier: "qualitative_verified",
      nonMetric: true,
    },
    quantities: [],
    entities,
    constructions,
    relations: [],
    assertions,
    annotations,
    requiredEntityIds: entities.filter((entity) => entity.label).map((entity) => entity.id),
    revealGroups,
    teachingTimeline,
  };
}
