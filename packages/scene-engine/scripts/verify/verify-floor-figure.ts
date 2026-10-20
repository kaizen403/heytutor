/**
 * Floor figure (DIAGRAM_FLOOR_FIGURE): every kind draws only the stated setup,
 * declines what it cannot draw honestly, and the floor audit refuses a figure
 * that writes an unstated number, a solved value, analysis ink, or an entity
 * with no stated source. Synthetic questions only; no recorded student text.
 */
import assert from "node:assert/strict";
import {
  auditFloorFigure,
  buildFloorFigure,
  compileSceneDocument,
  readFloorFacts,
  type FloorFigureInput,
  type RenderScene,
  type SceneDocument,
} from "../../src/index";

let checks = 0;
const check = (condition: unknown, message: string) => { assert.ok(condition, message); checks += 1; };

function quote(question: string, text: string, id: string, kind: "given" | "requested" = "given") {
  const start = question.indexOf(text);
  assert.ok(start >= 0, `fixture quote missing: ${text}`);
  return { id, kind, statement: text, evidence: { source: "question" as const, start, end: start + text.length, quote: text } };
}

function plan(question: string, givens: Array<[string, number, string | undefined, string]>, unknowns: Array<[string, string?]> = [], visualRequirement = "required") {
  return {
    schemaVersion: "turn-plan/v3", question,
    givens: givens.map(([symbol, value, unit, sourceText], index) => ({
      id: `g${index + 1}`, symbol, value, ...(unit ? { unit } : {}), sourceText, provenance: "given",
    })),
    unknowns: unknowns.map(([symbol, unit], index) => ({ id: `u${index + 1}`, symbol, ...(unit ? { unit } : {}) })),
    derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement,
  };
}

function texts(render: RenderScene): string[] {
  return render.primitives.flatMap((primitive) =>
    (primitive.kind === "label" || primitive.kind === "dimension") && primitive.text ? [primitive.text] : []);
}

function drawn(input: FloorFigureInput, kind: string) {
  const result = buildFloorFigure(input);
  check(result.figure?.kind === kind, `${kind} floor draws: ${JSON.stringify(result.attempts)}`);
  return result.figure!;
}

// 1. Circuit from a ProblemIR: series loop, values as written, the asked junction marked "?".
{
  const question = "A 12 V battery and two 3.3 kΩ resistors in series. Find the voltage at the junction.";
  const facts = [quote(question, "12 V battery", "f1"), quote(question, "two 3.3 kΩ resistors in series", "f2"),
    quote(question, "Find the voltage at the junction", "f3", "requested")];
  const problemIR = {
    schemaVersion: "problem-ir/v1", id: "divider", question, facts,
    entities: [
      { id: "battery", kind: "component", label: "12 V battery", evidenceFactIds: ["f1"] },
      { id: "r1", kind: "component", label: "3.3 kΩ resistor", evidenceFactIds: ["f2"] },
      { id: "r2", kind: "component", label: "3.3 kΩ resistor", evidenceFactIds: ["f2"] },
      { id: "junction", kind: "point", label: "junction", evidenceFactIds: ["f3"] },
    ],
    expressions: [], constraints: [], representationIntents: [{ id: "i1", kind: "network", entityIds: ["battery", "r1", "r2", "junction"], evidenceFactIds: ["f2"] }],
    solveRequests: [],
  };
  const turnPlan = plan(question, [["V", 12, "V", "12 V battery"], ["R_1", 3.3, "kΩ", "two 3.3 kΩ resistors"], ["R_2", 3.3, "kΩ", "two 3.3 kΩ resistors"]], [["V_j", "V"]]);
  const figure = drawn({ question, turnPlan, problemIR }, "circuit");
  const shown = texts(figure.renderScene);
  check(shown.includes("V_j = ?"), "the asked junction voltage is a question mark");
  check(shown.filter((text) => text.includes("3.3 kΩ")).length === 2, "both stated resistances are written as stated");
  check(!shown.some((text) => /\b6(?:\.0)?\s*V\b/.test(text)), "the solved junction voltage is never written");
  check(figure.document.assertions.some((assertion) => assertion.predicate === "path" && assertion.severity === "fatal"), "the series path is proved");
  check(!figure.renderScene.primitives.some((primitive) => primitive.kind === "vector"), "no current arrows");

  // Audit mutations on this figure: each must be refused.
  const factsRead = readFloorFacts({ question, turnPlan, problemIR })!;
  const mutate = (change: (document: SceneDocument) => void) => {
    const document = structuredClone(figure.document);
    change(document);
    const compiled = compileSceneDocument(document);
    assert.ok(compiled.renderScene, `mutation still compiles: ${JSON.stringify(compiled.report.issues.filter((issue) => issue.severity === "fatal")).slice(0, 400)}`);
    return auditFloorFigure(document, compiled.renderScene!, factsRead, { names: [], directedInk: false });
  };
  check(auditFloorFigure(figure.document, figure.renderScene, factsRead, { names: ["junction"], directedInk: false }).length === 0, "the unmutated figure passes the audit");
  check(mutate((document) => { document.entities.find((entity) => entity.id === "r1")!.label = "R = 7 Ω"; })
    .some((issue) => issue.code === "floor_unstated_text"), "an invented value is refused");
  check(mutate((document) => { document.annotations.push({ id: "solved", kind: "label", targetIds: ["junction"], text: "V_j = 6 V", labelMode: "append" }); })
    .some((issue) => issue.code === "floor_unstated_text"), "a solved value is refused");
  check(mutate((document) => {
    document.entities.push({ id: "current", kind: "vector", role: "current", provenance: { floor: true } });
    document.constructions.push({ id: "draw_current", operator: "vector", inputs: { start: "n_bl", end: "n_tl" }, outputs: ["current"] });
    document.requiredEntityIds.push("current");
    document.revealGroups[0]!.entityIds.push("current");
  }).some((issue) => issue.code === "floor_analysis_ink"), "an analysis arrow is refused in a circuit");
  check(mutate((document) => { delete document.entities[0]!.provenance; })
    .some((issue) => issue.code === "floor_unsourced_entity"), "an entity with no stated source is refused");
  check(mutate((document) => { document.source = { ...document.source, question: "Another question." }; })
    .some((issue) => issue.code === "floor_question"), "a figure built for another question is refused");
}

// 2. Circuit without a ProblemIR: stated values become parts; a stated count must match.
{
  const question = "Three resistors of 2 Ω, 4 Ω and 6 Ω are connected in series across a 12 V battery. Find the current.";
  const turnPlan = plan(question, [["R_1", 2, "Ω", "2 Ω"], ["R_2", 4, "Ω", "4 Ω"], ["R_3", 6, "Ω", "6 Ω"], ["V", 12, "V", "12 V battery"]], [["I", "A"]]);
  const figure = drawn({ question, turnPlan }, "circuit");
  const shown = texts(figure.renderScene);
  for (const text of ["R_1 = 2 Ω", "R_2 = 4 Ω", "R_3 = 6 Ω", "V = 12 V"]) check(shown.includes(text), `stated value written: ${text}`);
  const short = plan(question, [["R_1", 2, "Ω", "2 Ω"], ["R_2", 4, "Ω", "4 Ω"], ["V", 12, "V", "12 V battery"]]);
  check(!buildFloorFigure({ question, turnPlan: short }).figure, "three stated resistors but two values declines");
}

// 2b. Two stated arrangements draw as two panels; a series part with a parallel pair draws as one ladder.
{
  const question = "A 3 Ω resistor and a 6 Ω resistor are connected first in series and then in parallel across a 9 V battery. Find the current each time.";
  const figure = drawn({ question, turnPlan: plan(question, [["R_1", 3, "Ω", "3 Ω"], ["R_2", 6, "Ω", "6 Ω"], ["V", 9, "V", "9 V battery"]], [["I", "A"]]) }, "circuit");
  check(figure.document.assertions.some((assertion) => assertion.predicate === "path") &&
    figure.document.assertions.some((assertion) => assertion.predicate === "sameTerminalPair"), "both stated arrangements are proved");
  check(texts(figure.renderScene).filter((text) => text === "R_1 = 3 Ω").length === 2, "each panel carries the stated values");
  const mixed = "A 2 Ω resistor is in series with a parallel pair of 4 Ω and 12 Ω across a 10 V battery. Find the current from the battery.";
  const ladder = drawn({ question: mixed, turnPlan: plan(mixed, [["R_1", 2, "Ω", "2 Ω"], ["R_2", 4, "Ω", "4 Ω"], ["R_3", 12, "Ω", "12 Ω"], ["V", 10, "V", "10 V battery"]], [["I", "A"]]) }, "circuit");
  const pair = ladder.document.assertions.find((assertion) => assertion.predicate === "sameTerminalPair")!;
  check(pair.entities.length === 2 && pair.entities.includes("load_2") && pair.entities.includes("load_3"), "only the stated pair shares a terminal pair");
}

// 3. Concept circuit: the stated arrangement only, no values.
{
  const question = "Explain how a parallel circuit works.";
  const figure = drawn({ question, turnPlan: plan(question, []) }, "circuit");
  check(texts(figure.renderScene).every((text) => !/[0-9]/.test(text)), "a concept circuit writes no number");
  check(figure.document.assertions.some((assertion) => assertion.predicate === "sameTerminalPair"), "parallel parts share one terminal pair");
  check(!buildFloorFigure({ question: "Explain how a switch controls a circuit.", turnPlan: plan("Explain how a switch controls a circuit.", []) }).figure,
    "a part the floor cannot place declines");
}

// 4. Body on an incline at its stated angle, never a force.
{
  const question = "A 5 kg block rests on a rough incline at 30°. Find the friction force.";
  const facts = [quote(question, "5 kg block", "f1"), quote(question, "rough incline at 30°", "f2")];
  const problemIR = {
    schemaVersion: "problem-ir/v1", id: "incline", question, facts,
    entities: [
      { id: "block", kind: "body", label: "block", evidenceFactIds: ["f1"] },
      { id: "incline", kind: "region", label: "rough incline", evidenceFactIds: ["f2"] },
    ],
    expressions: [], constraints: [], representationIntents: [{ id: "i1", kind: "free_body", entityIds: ["block", "incline"], evidenceFactIds: ["f1", "f2"] }],
    solveRequests: [],
  };
  const turnPlan = plan(question, [["m", 5, "kg", "5 kg block"], ["θ", 30, "°", "incline at 30°"]], [["f", "N"]]);
  const figure = drawn({ question, turnPlan, problemIR }, "body");
  check(texts(figure.renderScene).includes("θ = 30°"), "the stated angle is written as stated");
  check(figure.document.assertions.some((assertion) => assertion.predicate === "angle_between" &&
    JSON.stringify(assertion.expected) === JSON.stringify({ value: 30, unit: "degree" })), "the incline is proved at its stated angle");
  check(!figure.renderScene.primitives.some((primitive) => primitive.kind === "vector"), "no force arrows");
}

// 5. Projectile on level ground: setup at the stated angle, range asked.
{
  const question = "A ball is projected from level ground at 40° with a speed of 20 m/s. Find its range.";
  const turnPlan = plan(question, [["u", 20, "m/s", "speed of 20 m/s"], ["θ", 40, "°", "at 40°"]], [["R", "m"]]);
  const figure = drawn({ question, turnPlan }, "motion");
  const shown = texts(figure.renderScene);
  for (const text of ["u = 20 m/s", "θ = 40°", "R = ?"]) check(shown.includes(text), `projectile label: ${text}`);
  check(figure.document.assertions.some((assertion) => assertion.predicate === "angle_between" &&
    JSON.stringify(assertion.expected) === JSON.stringify({ value: 40, unit: "degree" })), "launch velocity at the stated angle");
  const cliff = "A ball is projected at 30° with a speed of 20 m/s from the top of a cliff and lands on level ground below. Find its range.";
  check(buildFloorFigure({ question: cliff, turnPlan: plan(cliff, [["u", 20, "m/s", "speed of 20 m/s"], ["θ", 30, "°", "at 30°"]], [["R", "m"]]) }).figure?.kind !== "motion",
    "a launch from a height is not a level launch");
}

// 5b. Horizontal throw from a stated height; circular setup in the stated sense.
{
  const question = "A stone is thrown horizontally at 15 m/s from the top of a tower 45 m high. How far from the foot of the tower does it land?";
  const figure = drawn({ question, turnPlan: plan(question, [["u", 15, "m/s", "15 m/s"], ["h", 45, "m", "tower 45 m high"]], [["x", "m"]]) }, "motion");
  const shown = texts(figure.renderScene);
  for (const text of ["u = 15 m/s", "h = 45 m", "x = ?"]) check(shown.includes(text), `horizontal throw label: ${text}`);
  check(figure.document.assertions.some((assertion) => assertion.predicate === "parallel" && assertion.entities.includes("launch_velocity")),
    "the throw is proved horizontal");
  const angled = "A stone is thrown at 30° above the horizontal at 15 m/s from the top of a tower 45 m high. Find its range.";
  check(buildFloorFigure({ question: angled, turnPlan: plan(angled, [["u", 15, "m/s", "15 m/s"], ["h", 45, "m", "tower 45 m high"]]) }).figure?.kind !== "motion",
    "an angled launch from a height declines");
  const circle = "A particle moves anticlockwise on a circle of radius 2 m with a speed of 4 m/s that is increasing at 3 m/s^2. Find its acceleration.";
  const turning = drawn({ question: circle, turnPlan: plan(circle, [["r", 2, "m", "radius 2 m"], ["v", 4, "m/s", "speed of 4 m/s"], ["a_t", 3, "m/s^2", "increasing at 3 m/s^2"]], [["a", "m/s^2"]]) }, "circular");
  check(turning.document.assertions.some((assertion) => assertion.predicate === "perpendicular" && assertion.entities.includes("velocity")),
    "the velocity is proved tangent");
  check(!turning.document.entities.some((entity) => /accel/.test(entity.id)), "no acceleration arrow");
}

// 5c. Two stated sources at their stated separation; no field lines.
{
  const question = "Two point charges of +3 μC and -2 μC are 0.20 m apart. Find the force between them.";
  const figure = drawn({ question, turnPlan: plan(question, [["q_1", 3, "μC", "+3 μC"], ["q_2", -2, "μC", "-2 μC"], ["d", 0.2, "m", "0.20 m apart"]], [["F", "N"]]) }, "fields");
  check(!figure.renderScene.primitives.some((primitive) => primitive.kind === "vector"), "no field or force arrows between charges");
  const wires = "Two long parallel wires 0.10 m apart carry 4 A and 6 A in opposite directions. Find the force per metre.";
  const pair = drawn({ question: wires, turnPlan: plan(wires, [["I_1", 4, "A", "4 A"], ["I_2", 6, "A", "6 A"], ["d", 0.1, "m", "0.10 m apart"]]) }, "fields");
  check(pair.document.assertions.some((assertion) => assertion.predicate === "opposite_direction"), "stated opposite currents are proved opposite");
  const three = "Three point charges of 1 μC each sit at the corners of a triangle of side 0.1 m. Find the force on one.";
  check(buildFloorFigure({ question: three, turnPlan: plan(three, [["q", 1, "μC", "1 μC"], ["a", 0.1, "m", "side 0.1 m"]]) }).figure?.kind !== "fields",
    "more than two sources decline");
}

// 6. Optics: element, foci, object to scale; no rays.
{
  const question = "An object is 30 cm in front of a concave mirror of focal length 20 cm. Find the image distance.";
  const turnPlan = plan(question, [["u", 30, "cm", "30 cm in front of"], ["f", 20, "cm", "focal length 20 cm"]], [["v", "cm"]]);
  const figure = drawn({ question, turnPlan }, "optics");
  const shown = texts(figure.renderScene);
  check(shown.includes("u = 30 cm") && shown.includes("f = 20 cm"), "stated lengths written as stated");
  check(figure.document.assertions.some((assertion) => assertion.predicate === "distance_ratio" && assertion.expected === 20 / 30),
    "object placed to scale against the focal length");
  check(!figure.document.entities.some((entity) => /ray|image/.test(entity.id)), "no rays and no image");
  const convex = "An object is 15 cm in front of a convex mirror of focal length 10 cm. Find the image position.";
  const mirror = drawn({ question: convex, turnPlan: plan(convex, [["u", 15, "cm", "15 cm in front of"], ["f", 10, "cm", "focal length 10 cm"]]) }, "optics");
  const at = (id: string, kind = "point") => mirror.renderScene.primitives.find((primitive) => primitive.entityId === id && primitive.kind === kind)!.points[0]!;
  const name = mirror.renderScene.primitives.find((primitive) => primitive.kind === "label" && primitive.text === "convex mirror")!.points[0]!;
  check(Math.abs(name.x - at("P").x) < Math.abs(name.x - at("object_foot").x), "the mirror's name is written by the mirror, never on the object");
  const pair = "A converging lens and a plane mirror are 30 cm apart. Find the final image.";
  check(!buildFloorFigure({ question: pair, turnPlan: plan(pair, [["d", 30, "cm", "30 cm apart"]]) }).figure, "two elements decline");
}

// 7. Graph: stated equations plotted, computed points never labelled; no equation, no graph.
{
  const question = "Find the area of the region bounded by y = x and y = x^2.";
  const figure = drawn({ question, turnPlan: plan(question, [], [["A"]]), families: ["bounded_region"] }, "graph");
  const shown = texts(figure.renderScene);
  check(shown.some((text) => /x\^2|x²/.test(text)), "the stated curve is named");
  check(!shown.some((text) => /\(\s*1\s*,\s*1\s*\)|1\/6/.test(text)), "computed intersections and the area are never written");
  // Each equation is written from an anchor on its own curve, where the curves are farthest apart.
  const curveIds = new Set(figure.document.constructions.filter((construction) => construction.operator === "function_curve").map((construction) => construction.outputs[0]));
  check(figure.document.constructions.filter((construction) => construction.operator === "label" &&
    curveIds.has(String(construction.inputs.target).replace(/_tag$/, ""))).length === 2, "both stated equations are written from anchors");
  check(shown.includes("x") && shown.includes("y"), "the axes carry their plain names");
  for (const curve of figure.document.constructions.filter((construction) => construction.operator === "function_curve")) {
    const id = curve.outputs[0]!;
    const anchor = figure.document.constructions.find((construction) => construction.outputs[0] === `${id}_tag`);
    const writer = figure.document.constructions.find((construction) => construction.operator === "label" && construction.inputs.target === `${id}_tag`);
    if (!writer) continue;
    const x = Number(anchor!.inputs.x), y = Number(anchor!.inputs.y);
    const expected = String(curve.inputs.expression) === "x" ? x : x * x;
    check(Math.abs(expected - y) < 1e-9, `${writer.inputs.text} is anchored on its own curve`);
    check(!figure.renderScene.primitives.some((primitive) => primitive.kind === "point" && primitive.entityId === `${id}_tag`), "the anchor draws no dot");
  }
  const planes = "Explain the angle between two planes.";
  check(buildFloorFigure({ question: planes, turnPlan: plan(planes, []), families: ["coordinate_figure"] }).figure === null,
    "a stem with no stated equation gets no reused graph");
}

// 8. Facts: a plan value the question never states is not a fact.
{
  const question = "A resistor is connected across a 6 V battery.";
  const facts = readFloorFacts({ question, turnPlan: plan(question, [["V", 6, "V", "6 V battery"], ["R", 3, "Ω", "a resistor of 3 Ω"]]) })!;
  check(facts.values.some((value) => value.symbol === "V") && !facts.values.some((value) => value.symbol === "R"), "an invented plan value is dropped");
}

console.log(`verify-floor-figure: ${checks} checks passed`);
