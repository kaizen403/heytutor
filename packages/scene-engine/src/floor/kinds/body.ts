/**
 * Body floor: the bodies the question names, resting on the surfaces it names
 * (a level surface, or an incline at its stated angle), with stated values
 * beside the part they belong to. It never draws a force: a force set is
 * analysis, and a fallback that drew an incomplete one taught the excluded
 * case (the frictionless banked curve). Strings, pulleys, springs, or more
 * than one body per surface decline.
 */
import type { FloorFacts, FloorObject, FloorStatedValue } from "../facts";
import type { FloorKindBuild } from "./index";
import { appendLabel, emptyParts, floorDocument, floorEntity, obligatedObjects, point, unitDimension, valueLabel } from "./shared";

const SURFACE = /\b(?:floor|ground|ice|table|surface|plane|incline|slope|ramp|road|track|plank|bank(?:ed)?|ice)\b/i;
const INCLINED = /\b(?:incline[ds]?|slope|ramp|plank|tilted|bank(?:ed)?|wedge)\b/i;
const CONNECTOR = /\b(?:string|rope|cord|thread|pulley|spring|rod|chain|cable|hinge)\b/i;

interface Panel {
  surface: FloorObject;
  body: FloorObject;
  inclined: boolean;
}

/** A value belongs to the object whose own evidence quotes it, else the single object of its natural kind. */
function owner(value: FloorStatedValue, panels: Panel[]): { object: FloorObject; role: "body" | "surface" | "angle" } | null {
  for (const panel of panels) {
    if (panel.body.quotes.some((quote) => quote.includes(value.valueText))) return { object: panel.body, role: "body" };
    if (panel.surface.quotes.some((quote) => quote.includes(value.valueText))) {
      return { object: panel.surface, role: unitDimension(value.unit) === "angle" ? "angle" : "surface" };
    }
  }
  const dimension = unitDimension(value.unit);
  const bodies = [...new Set(panels.map((panel) => panel.body.id))];
  if (dimension === "mass" && bodies.length === 1) return { object: panels[0]!.body, role: "body" };
  const inclined = panels.filter((panel) => panel.inclined);
  if (dimension === "angle" && inclined.length === 1) return { object: inclined[0]!.surface, role: "angle" };
  return null;
}

export function buildBodyFloor(facts: FloorFacts): FloorKindBuild | { declined: string } | null {
  const bodies = facts.objects.filter((object) => object.kind === "body");
  if (bodies.length === 0) return null;
  if (facts.objects.some((object) => CONNECTOR.test(`${object.name ?? ""} ${object.id}`))) {
    return { declined: "strings, pulleys and springs are not drawn by the body floor" };
  }
  if (facts.constraints.some((constraint) => constraint.kind !== "equation" && constraint.kind !== "inequality" && constraint.kind !== "incident")) {
    return { declined: "the bodies carry a relation the body floor does not draw" };
  }
  const panels: Panel[] = [];
  const intents = facts.intents.filter((intent) => intent.kind === "free_body");
  const groups = intents.length > 0 ? intents.map((intent) => intent.entityIds) : [facts.objects.map((object) => object.id)];
  for (const ids of groups) {
    const members = facts.objects.filter((object) => ids.includes(object.id));
    const panelBodies = members.filter((object) => object.kind === "body");
    const surfaces = members.filter((object) => object.kind !== "body" && SURFACE.test(`${object.name ?? ""} ${object.id}`));
    if (panelBodies.length !== 1 || surfaces.length !== 1) return { declined: "each panel needs exactly one stated body on one stated surface" };
    const others = members.filter((object) => !panelBodies.includes(object) && !surfaces.includes(object));
    if (others.length > 0) return { declined: `stated ${others.map((object) => object.id).join(", ")} has no place on the body floor` };
    if (!panelBodies[0]!.name || !surfaces[0]!.name) return { declined: "a body or surface has no name the question uses" };
    panels.push({ body: panelBodies[0]!, surface: surfaces[0]!, inclined: INCLINED.test(`${surfaces[0]!.name} ${surfaces[0]!.id}`) });
  }
  if (panels.length === 0 || panels.length > 2) return { declined: "one or two panels only" };
  const unplaced = obligatedObjects(facts).filter((object) => !panels.some((panel) => panel.body.id === object.id || panel.surface.id === object.id));
  if (unplaced.length > 0) return { declined: `obligated ${unplaced.map((object) => object.id).join(", ")} has no place` };

  const owned = new Map<string, FloorStatedValue[]>();
  const angles = new Map<string, FloorStatedValue>();
  for (const value of facts.values) {
    const found = owner(value, panels);
    if (!found) continue;
    if (found.role === "angle") {
      if (angles.has(found.object.id)) return { declined: "two stated angles for one incline" };
      angles.set(found.object.id, value);
    } else owned.set(found.object.id, [...(owned.get(found.object.id) ?? []), value]);
  }
  if (panels.some((panel) => panel.inclined && !angles.has(panel.surface.id))) {
    return { declined: "an incline needs its stated angle" };
  }

  const built = emptyParts();
  const names: string[] = [];
  const seen = new Set<string>();
  panels.forEach((panel, index) => {
    const dx = index * 8;
    const suffix = panels.length > 1 ? `_${index + 1}` : "";
    const groupIds: string[] = [];
    const add = (entity: ReturnType<typeof floorEntity>) => { built.entities.push(entity); groupIds.push(entity.id); };
    const surfaceId = seen.has(panel.surface.id) ? `${panel.surface.id}${suffix}` : panel.surface.id;
    const bodyId = seen.has(panel.body.id) ? `${panel.body.id}${suffix}` : panel.body.id;
    seen.add(panel.surface.id); seen.add(panel.body.id);
    const left = `${surfaceId}_left`, right = `${surfaceId}_right`;
    const angle = angles.get(panel.surface.id);
    const theta = angle ? (angle.value * Math.PI) / 180 : 0;
    if (panel.inclined && !(theta > 0.05 && theta < 1.4)) throw new Error("incline angle outside the drawable range");
    const length = 6;
    add(floorEntity(left, "point", "surface end", null, { objectId: panel.surface.id }));
    add(floorEntity(right, "point", "surface end", null, { objectId: panel.surface.id }));
    built.constructions.push(point(left, dx, 0), point(right, dx + length * Math.cos(theta), length * Math.sin(theta)));
    add(floorEntity(surfaceId, "segment", panel.inclined ? "stated incline" : "stated surface", panel.surface.name, { objectId: panel.surface.id }));
    built.constructions.push({ id: `draw_${surfaceId}`, operator: "segment", inputs: { start: left, end: right }, outputs: [surfaceId] });
    names.push(panel.surface.name!);
    if (panel.inclined && angle) {
      const base = `${surfaceId}_base`, foot = `${surfaceId}_foot`, mark = `${surfaceId}_angle`;
      add(floorEntity(foot, "point", "base corner", null, { objectId: panel.surface.id }));
      built.constructions.push(point(foot, dx + length * Math.cos(theta), 0));
      add(floorEntity(base, "segment", "horizontal base", null, { objectId: panel.surface.id }));
      built.constructions.push({ id: `draw_${base}`, operator: "segment", inputs: { start: left, end: foot }, outputs: [base] });
      add(floorEntity(mark, "angle_mark", "stated incline angle", valueLabel(angle), { objectId: panel.surface.id, quantityIds: [angle.quantityId] }));
      built.constructions.push({ id: `draw_${mark}`, operator: "angle_mark", inputs: { vertex: left, a: surfaceId, b: base }, outputs: [mark] });
      built.assertions.push({ id: `floor_angle_${surfaceId}`, predicate: "angle_between", entities: [surfaceId, base],
        expected: { value: angle.value, unit: "degree" }, severity: "fatal", reason: "the incline is drawn at its stated angle" });
    }
    // The body sits on the surface, mid-way along it.
    const u = { x: Math.cos(theta), y: Math.sin(theta) }, n = { x: -Math.sin(theta), y: Math.cos(theta) };
    const at = (s: number, h: number) => ({ x: dx + u.x * s + n.x * h, y: u.y * s + n.y * h });
    const corners = [at(2.4, 0), at(3.6, 0), at(3.6, 0.9), at(2.4, 0.9)];
    const cornerIds = corners.map((_, corner) => `${bodyId}_c${corner}`);
    corners.forEach((corner, corner_i) => {
      add(floorEntity(cornerIds[corner_i]!, "point", "body corner", null, { objectId: panel.body.id }));
      built.constructions.push(point(cornerIds[corner_i]!, corner.x, corner.y));
    });
    add(floorEntity(bodyId, "polygon", "stated body", panel.body.name, { objectId: panel.body.id }));
    built.constructions.push({ id: `draw_${bodyId}`, operator: "polygon", inputs: { points: cornerIds }, outputs: [bodyId] });
    names.push(panel.body.name!);
    built.assertions.push({ id: `floor_on_${bodyId}`, predicate: "on", entities: [cornerIds[0]!, surfaceId], expected: true, severity: "fatal",
      reason: "the body rests on its stated surface" });
    for (const [objectId, target] of [[panel.body.id, bodyId], [panel.surface.id, surfaceId]] as const) {
      for (const value of owned.get(objectId) ?? []) {
        const id = `value_${target}_${value.quantityId}`;
        if (built.annotations.some((annotation) => annotation.id === id)) continue;
        built.annotations.push(appendLabel(id, target, valueLabel(value)));
      }
    }
    built.groups.push({ id: `floor_panel${suffix || "_1"}`, entityIds: groupIds,
      cue: panel.inclined ? "The stated body on the incline at its stated angle." : "The stated body on the stated surface." });
  });
  return {
    document: floorDocument(facts, "body", built, "stated bodies on stated surfaces"),
    names,
    directedInk: false,
    reason: `the stated ${panels.map((panel) => panel.inclined ? "incline" : "surface").join(" and ")} with ${panels.map((panel) => panel.body.name).join(", ")}`,
  };
}
