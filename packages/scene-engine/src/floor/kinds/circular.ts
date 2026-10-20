/**
 * Circular motion floor: one particle on a circle of stated radius, its
 * velocity along the tangent in the stated sense (clockwise or anticlockwise),
 * and its stated speed and rate of change as written. No acceleration arrow,
 * no average-velocity chord, no position after a time: those are what the
 * question asks. A string, a vertical circle, a road or a second body declines.
 * When the engine's own circular source declines a stem, the selector's veto
 * keeps the floor off the board too.
 */
import type { FloorFacts } from "../facts";
import type { FloorKindBuild } from "./index";
import { appendLabel, emptyParts, floorDocument, floorEntity, point, unitDimension, valueLabel } from "./shared";

const CIRCLE = /\b(?:moves?|moving|travels?|goes|revolves?)\b[^.]*\b(?:circle|circular path|circular track)\b[^.]*\bradius\b|\bcircle of radius\b[^.]*\b(?:moves?|speed)\b/i;
const DECLINE = /\b(?:vertical circle|string|rope|thread|banked|conical|road|car|cyclist|pendulum|loop|disc|wheel|ring|two particles|second particle|another particle|stone|satellite|orbit|planet|electron|charge|magnetic)\b/i;

export function circularSignals(facts: FloorFacts): boolean {
  return CIRCLE.test(facts.question);
}

export function buildCircularFloor(facts: FloorFacts): FloorKindBuild | { declined: string } | null {
  if (!circularSignals(facts)) return null;
  if (DECLINE.test(facts.question)) return { declined: "the circular setup has a part the floor does not draw" };
  if (facts.objects.length > 0) return { declined: "a ProblemIR body has no place in the circular floor" };
  const radii = facts.values.filter((value) => unitDimension(value.unit) === "length" && /\bradius\b/i.test(value.context));
  const speeds = facts.values.filter((value) => /^(?:m\/s|cm\/s|km\/h)$/.test((value.unit ?? "").trim()));
  const rates = facts.values.filter((value) => /^(?:m\/s\^?2|m\/s²|cm\/s\^?2)$/.test((value.unit ?? "").trim()));
  if (radii.length !== 1 || speeds.length > 1 || rates.length > 1) return { declined: "one stated radius and at most one speed and one rate" };
  const anticlockwise = /\b(?:anti-?clockwise|counter-?clockwise)\b/i.test(facts.question);
  const clockwise = !anticlockwise && /\bclockwise\b/i.test(facts.question);
  const radius = radii[0]!, speed = speeds[0] ?? null, rate = rates[0] ?? null;
  const r = 3;
  const built = emptyParts();
  const names = ["O", "P"];
  built.entities.push(
    floorEntity("O", "point", "centre of the circle", "O", { stated: "circle" }),
    floorEntity("P", "point", "the particle on the circle", "P", { stated: "particle" }),
    floorEntity("circle", "circle", "stated circle", null, { stated: "circle" }),
    floorEntity("radius", "segment", "stated radius", valueLabel(radius), { quantityIds: [radius.quantityId] }),
  );
  built.constructions.push(point("O", 0, 0), point("P", r, 0),
    { id: "draw_circle", operator: "circle", inputs: { center: "O", radius: r }, outputs: ["circle"] },
    { id: "draw_radius", operator: "segment", inputs: { start: "O", end: "P" }, outputs: ["radius"] });
  built.assertions.push({ id: "floor_particle_on_circle", predicate: "on", entities: ["P", "circle"], expected: true, severity: "fatal",
    reason: "the particle is on the circle" });
  if (anticlockwise || clockwise) {
    built.entities.push(floorEntity("velocity", "vector", "velocity along the tangent in the stated sense", speed ? valueLabel(speed) : "v",
      { stated: anticlockwise ? "anticlockwise" : "clockwise", ...(speed ? { quantityIds: [speed.quantityId] } : {}) }));
    built.constructions.push({ id: "draw_velocity", operator: "vector", inputs: { start: "P", direction: [0, anticlockwise ? 1 : -1], length: 1.8 }, outputs: ["velocity"] });
    built.assertions.push({ id: "floor_velocity_tangent", predicate: "perpendicular", entities: ["velocity", "radius"], expected: true, severity: "fatal",
      reason: "the velocity is along the tangent" });
    if (!speed) names.push("v");
  } else if (speed) {
    built.annotations.push(appendLabel("speed_value", "P", valueLabel(speed)));
  }
  if (rate) built.annotations.push(appendLabel("rate_value", "P", valueLabel(rate)));
  built.groups.push({ id: "floor_circle", entityIds: built.entities.map((entity) => entity.id),
    cue: "The particle on the circle of stated radius, moving in the stated sense." });
  return {
    document: floorDocument(facts, "circular", built, "a particle on the stated circle"),
    names,
    directedInk: anticlockwise || clockwise,
    reason: `a particle on a circle of stated radius${anticlockwise || clockwise ? ", moving in the stated sense" : ""}`,
  };
}
