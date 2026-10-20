/**
 * Fields floor: the two sources the question states (two point charges, or two
 * long parallel wires) at their stated separation, each labelled with its
 * stated charge or current as written. It never draws a field line, a force or
 * a resultant: those are analysis. Wire currents carry arrows only when the
 * question states their directions ("in the same direction", "in opposite
 * directions"); otherwise only their values are written.
 */
import type { FloorFacts, FloorStatedValue } from "../facts";
import type { FloorKindBuild } from "./index";
import { emptyParts, floorDocument, floorEntity, point, unitDimension, valueLabel } from "./shared";

const SEPARATION = /\b(?:apart|separated|separation|distance|between them|from each other)\b/i;
const CHARGES = /\bpoint charges?\b|\btwo charges\b|\bcharges? of\b|\bcharges?\s+[+\-−]?\d/i;
const WIRES = /\b(?:parallel|long|straight)\s+(?:wires|conductors)\b/i;
const DECLINE = /\b(?:three|four|square|triangle|corner|vertex|vertices|ring|loop|sphere|shell|plate|dipole|cylinder|rod|solenoid|toroid|semicircle|arc|grid|lattice)\b/i;

export function fieldsSignals(facts: FloorFacts): boolean {
  return (CHARGES.test(facts.question) || WIRES.test(facts.question)) && SEPARATION.test(facts.question);
}

function separationOf(facts: FloorFacts): FloorStatedValue | null | "ambiguous" {
  const lengths = facts.values.filter((value) => unitDimension(value.unit) === "length" && SEPARATION.test(value.context));
  return lengths.length === 1 ? lengths[0]! : lengths.length === 0 ? null : "ambiguous";
}

export function buildFieldsFloor(facts: FloorFacts): FloorKindBuild | { declined: string } | null {
  if (!fieldsSignals(facts)) return null;
  if (DECLINE.test(facts.question)) return { declined: "the arrangement is more than two stated sources" };
  if (facts.problem && facts.intents.some((intent) => intent.kind !== "field" && intent.kind !== "conceptual")) {
    return { declined: "the ProblemIR asks for a picture the fields floor does not draw" };
  }
  const wires = WIRES.test(facts.question);
  const sources = facts.values.filter((value) => unitDimension(value.unit) === (wires ? "current" : "charge"));
  if (sources.length !== 2) return { declined: `two stated ${wires ? "currents" : "charges"} are needed` };
  const separation = separationOf(facts);
  if (separation === "ambiguous") return { declined: "more than one stated separation" };
  const built = emptyParts();
  const names: string[] = [];
  const width = 5;
  if (wires) {
    const same = /\bsame direction\b/i.test(facts.question);
    const opposite = /\bopposite directions?\b/i.test(facts.question);
    if (same && opposite) return { declined: "both directions stated" };
    sources.forEach((value, index) => {
      const x = index * width, id = `wire_${index + 1}`;
      built.entities.push(
        floorEntity(`${id}_bottom`, "point", "wire end", null, { stated: "long straight wire" }),
        floorEntity(`${id}_top`, "point", "wire end", null, { stated: "long straight wire" }),
        floorEntity(id, same || opposite ? "vector" : "segment", "stated long straight wire", valueLabel(value), { quantityIds: [value.quantityId] }),
      );
      const upward = index === 0 || same;
      built.constructions.push(point(`${id}_bottom`, x, 0), point(`${id}_top`, x, 4),
        { id: `draw_${id}`, operator: same || opposite ? "vector" : "segment",
          inputs: upward ? { start: `${id}_bottom`, end: `${id}_top` } : { start: `${id}_top`, end: `${id}_bottom` }, outputs: [id] });
    });
    built.assertions.push({ id: "floor_wires_parallel", predicate: "parallel", entities: ["wire_1", "wire_2"], expected: true, severity: "fatal",
      reason: "the stated wires are parallel" });
    if (same || opposite) {
      built.assertions.push({ id: "floor_current_sense", predicate: same ? "same_direction" : "opposite_direction", entities: ["wire_1", "wire_2"],
        expected: true, severity: "fatal", reason: "the stated current directions" });
    }
  } else {
    sources.forEach((value, index) => {
      const id = `charge_${index + 1}`;
      built.entities.push(floorEntity(id, "point", "stated point charge", valueLabel(value), { quantityIds: [value.quantityId] }));
      built.constructions.push(point(id, index * width, 0));
    });
  }
  const [first, second] = wires ? ["wire_1_bottom", "wire_2_bottom"] : ["charge_1", "charge_2"];
  if (separation) {
    built.entities.push(
      floorEntity("sep_a", "point", "dimension end", null, { stated: "separation" }),
      floorEntity("sep_b", "point", "dimension end", null, { stated: "separation" }),
      floorEntity("separation", "dimension", "stated separation", valueLabel(separation), { quantityIds: [separation.quantityId] }),
    );
    built.constructions.push(point("sep_a", 0, -0.9), point("sep_b", width, -0.9),
      { id: "draw_separation", operator: "dimension", inputs: { start: "sep_a", end: "sep_b" }, outputs: ["separation"] });
  }
  built.assertions.push({ id: "floor_sources_exist", predicate: "exists", entities: [first, second], expected: true, severity: "fatal",
    reason: "both stated sources are drawn" });
  built.groups.push({ id: "floor_sources", entityIds: built.entities.map((entity) => entity.id),
    cue: wires ? "The two stated wires and their currents." : "The two stated charges and their separation." });
  return {
    document: floorDocument(facts, "fields", built, wires ? "the stated parallel wires" : "the stated point charges"),
    names,
    directedInk: wires,
    reason: wires ? "two stated wires at their stated separation" : "two stated charges at their stated separation",
  };
}
