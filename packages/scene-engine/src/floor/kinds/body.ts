/**
 * Body floor, from ProblemIR structure only: one body resting on one surface,
 * both named by a free-body intent and joined by a stated incidence. The
 * surface is an incline only when a degree value is bound to it through a
 * shared evidence fact; it is drawn at that angle from the horizontal, so a
 * quote that measures the angle from anything else ("with the vertical", "to
 * the normal") declines. Bound values sit beside their own part. No force is
 * ever drawn, and strings, pulleys, springs or a second body decline.
 */
import type { FloorFacts } from "../facts";
import { readFloorBindings, type FloorBinding } from "../bindings";
import type { FloorKindBuild } from "./index";
import { emptyParts, floorDocument, floorEntity, obligatedObjects, point, problemLabel } from "./shared";

const CONNECTORS = /\b(?:strings?|ropes?|cords?|threads?|pulleys?|springs?|rods?|chains?|cables?|hinges?|wedges?|on top of|stacked|attached|tied|hanging|suspended)\b/i;
const NOT_HORIZONTAL = /\b(?:vertical|normal|perpendicular|with the wall|from the top)\b/i;

export function buildBodyFloor(facts: FloorFacts): FloorKindBuild | { declined: string } | null {
  const problem = facts.problem;
  if (!problem) return null;
  const intents = problem.representationIntents.filter((intent) => intent.kind === "free_body");
  if (intents.length === 0) return null;
  if (intents.length > 1) return { declined: "more than one free body scene" };
  const members = problem.entities.filter((entity) => intents[0]!.entityIds.includes(entity.id));
  const bodies = members.filter((entity) => entity.kind === "body");
  const surfaces = members.filter((entity) => entity.kind === "region" || entity.kind === "line");
  if (bodies.length !== 1 || surfaces.length !== 1 || members.length !== 2) return { declined: "the free body scene is not one body on one surface" };
  if (problem.entities.filter((entity) => entity.kind === "body").length !== 1) return { declined: "the question has more than one body" };
  const body = bodies[0]!, surface = surfaces[0]!;
  const resting = problem.constraints.some((constraint) => constraint.kind === "incident" &&
    constraint.entityIds.length === 2 && constraint.entityIds.includes(body.id) && constraint.entityIds.includes(surface.id));
  if (!resting) return { declined: "the structure does not state that the body is on the surface" };
  if (CONNECTORS.test(facts.question)) return { declined: "a connector or a second support is not drawn by the floor" };
  if (/\b(?:projected|projectile|thrown|launched|fired|kicked|dropped|falls?|falling|in flight|in the air)\b/i.test(facts.question)) {
    return { declined: "a body in flight is not resting on a surface" };
  }
  const bodyName = facts.objects.find((object) => object.id === body.id)?.name ?? null;
  const surfaceName = facts.objects.find((object) => object.id === surface.id)?.name ?? null;
  if (!bodyName || !surfaceName) return { declined: "the body or the surface has no name the question uses" };
  const unplaced = obligatedObjects(facts).filter((object) => object.id !== body.id && object.id !== surface.id);
  if (unplaced.length > 0) return { declined: `obligated ${unplaced.map((object) => object.id).join(", ")} has no place` };

  const bindings = readFloorBindings(facts);
  const own = (id: string) => bindings.filter((binding) => binding.entityIds.length === 1 && binding.entityIds[0] === id);
  const isAngle = (binding: FloorBinding) => /^(?:°|deg|degrees?)$/i.test(binding.unitText.trim());
  const angles = own(surface.id).filter(isAngle);
  if (angles.length > 1 || own(body.id).some(isAngle)) return { declined: "an angle the floor cannot place" };
  const angle = angles[0] ?? null;
  if (angle) {
    const quote = problem.facts.find((fact) => fact.id === angle.factId)?.evidence.quote ?? "";
    if (NOT_HORIZONTAL.test(quote)) return { declined: "the angle is not measured from the horizontal" };
    if (!(angle.value > 3 && angle.value < 80)) return { declined: "the incline angle is outside a drawable range" };
  }
  if (!angle && /\b(?:incline[ds]?|slope[ds]?|ramps?|planks?|banked|tilted|wedges?)\b/i.test(facts.question)) {
    return { declined: "the question names an incline but no angle is bound to the surface" };
  }
  const theta = angle ? (angle.value * Math.PI) / 180 : 0;

  const built = emptyParts();
  const length = 6;
  built.entities.push(
    floorEntity("surface_left", "point", "surface end", null, { stated: "surface" }),
    floorEntity("surface_right", "point", "surface end", null, { stated: "surface" }),
    floorEntity(surface.id, "segment", angle ? "stated incline" : "stated surface", problemLabel(facts, surface.id) ? surfaceName : null, { objectId: surface.id }),
  );
  built.constructions.push(point("surface_left", 0, 0), point("surface_right", length * Math.cos(theta), length * Math.sin(theta)),
    { id: `draw_${surface.id}`, operator: "segment", inputs: { start: "surface_left", end: "surface_right" }, outputs: [surface.id] });
  if (angle) {
    built.entities.push(
      floorEntity("surface_foot", "point", "base corner", null, { stated: "horizontal base" }),
      floorEntity("surface_base", "segment", "horizontal base", null, { stated: "horizontal base" }),
      floorEntity("surface_angle", "angle_mark", "stated incline angle", angle.quantity ? `${angle.quantity.symbol} = ${angle.valueText}` : angle.valueText,
        { objectId: surface.id, ...(angle.quantity ? { quantityIds: [angle.quantity.quantityId] } : {}) }),
    );
    built.constructions.push(point("surface_foot", length * Math.cos(theta), 0),
      { id: "draw_surface_base", operator: "segment", inputs: { start: "surface_left", end: "surface_foot" }, outputs: ["surface_base"] },
      { id: "draw_surface_angle", operator: "angle_mark", inputs: { vertex: "surface_left", a: surface.id, b: "surface_base", radius: 1.4 }, outputs: ["surface_angle"] });
    built.assertions.push({ id: "floor_incline_angle", predicate: "angle_between", entities: [surface.id, "surface_base"],
      expected: { value: angle.value, unit: "degree" }, severity: "fatal", reason: "the incline is drawn at its stated angle" });
  }
  const u = { x: Math.cos(theta), y: Math.sin(theta) }, n = { x: -Math.sin(theta), y: Math.cos(theta) };
  const at = (s: number, h: number) => ({ x: u.x * s + n.x * h, y: u.y * s + n.y * h });
  const corners = [at(2.4, 0), at(3.6, 0), at(3.6, 0.9), at(2.4, 0.9)];
  corners.forEach((corner, index) => {
    built.entities.push(floorEntity(`body_c${index}`, "point", "body corner", null, { stated: "body" }));
    built.constructions.push(point(`body_c${index}`, corner.x, corner.y));
  });
  built.entities.push(floorEntity(body.id, "polygon", "stated body", problemLabel(facts, body.id) ? bodyName : null, { objectId: body.id }));
  built.constructions.push({ id: `draw_${body.id}`, operator: "polygon", inputs: { points: ["body_c0", "body_c1", "body_c2", "body_c3"] }, outputs: [body.id] });
  built.assertions.push({ id: "floor_body_on_surface", predicate: "on", entities: ["body_c0", surface.id], expected: true, severity: "fatal",
    reason: "the body rests on its stated surface" });
  // Each bound value is written from a hidden anchor on its own part: above the
  // body's top edge, or below the surface's middle, so it can only read as that part's.
  const anchors: Array<[string, { x: number; y: number }, FloorBinding[]]> = [
    [body.id, at(3, 1.35), own(body.id)],
    [surface.id, at(1.2, -0.55), own(surface.id).filter((binding) => !isAngle(binding))],
  ];
  for (const [id, where, values] of anchors) {
    values.forEach((binding, index) => {
      const tag = `${id}_value${index}_tag`, label = `${id}_value${index}`;
      const text = binding.quantity ? `${binding.quantity.symbol} = ${binding.valueText}` : binding.valueText;
      built.entities.push(floorEntity(tag, "point", "label anchor point", null, { objectId: id }),
        floorEntity(label, "label", "stated value", text, { objectId: id }));
      built.constructions.push(point(tag, where.x, where.y + index * (id === body.id ? 0.55 : -0.55)),
        { id: `write_${label}`, operator: "label", inputs: { target: tag, text }, outputs: [label] });
    });
  }
  built.groups.push({ id: "floor_body", entityIds: built.entities.map((entity) => entity.id),
    cue: angle ? "The stated body on the incline at its stated angle." : "The stated body on the stated surface." });
  return {
    document: floorDocument(facts, "body", built, "the stated body on its stated surface"),
    names: [bodyName, surfaceName],
    directedInk: false,
    reason: angle ? "a stated body on an incline at its stated angle" : "a stated body on a stated surface",
  };
}
