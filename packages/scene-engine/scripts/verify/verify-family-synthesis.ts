import {
  synthesizeFamilyScene,
  synthesizeLastResortScene,
  type TurnPlanV3,
} from "../../src";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function plan(question: string, givens: TurnPlanV3["givens"], extras: Partial<TurnPlanV3> = {}): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3",
    question,
    givens,
    unknowns: extras.unknowns ?? [],
    derived: extras.derived ?? [],
    qualitativeClaims: extras.qualitativeClaims ?? [],
    lawIds: extras.lawIds ?? [],
    assumptions: extras.assumptions ?? [],
    visualRequirement: extras.visualRequirement ?? "required",
  };
}

const refractionQuestion = "Light enters glass at 45 degrees with n = 1.5. Find the angle of refraction and draw both rays.";
const refraction = synthesizeFamilyScene({
  question: refractionQuestion,
  families: ["interface", "ray_path"],
  turnPlan: plan(refractionQuestion, [
    { id: "theta_i", symbol: "theta_i", value: 45, unit: "degree", provenance: "given" },
    { id: "n_2", symbol: "n_2", value: 1.5, unit: "1", provenance: "given" },
  ], { lawIds: ["snell_law"], unknowns: [{ id: "theta_r", symbol: "theta_r", unit: "degree" }] }),
});
assert(refraction, "refraction family must compile from the plan");
assert(refraction.tier === "exact_verified", "refraction must be an exact operator program");
assert(
  refraction.document.constructions.some((construction) => construction.operator === "refract_at"),
  "refraction must use refract_at rather than guessed ray endpoints",
);
assert(refraction.renderScene.primitives.length >= 4, "refraction scene is missing visible rays");

const microscopeQuestion =
  "A compound microscope has an objective of focal length 4 mm and an eyepiece of focal length 2.5 cm. " +
  "An object is placed 4.5 mm from the objective. The final image is formed at the near point, 25 cm from the eyepiece. " +
  "Draw the ray diagram.";
const microscope = synthesizeFamilyScene({
  question: microscopeQuestion,
  families: ["instrument_chain", "axis_view"],
  turnPlan: plan(microscopeQuestion, [
    { id: "f_o", symbol: "f_o", value: 4, unit: "mm", provenance: "given" },
    { id: "f_e", symbol: "f_e", value: 2.5, unit: "cm", provenance: "given" },
    { id: "u_o", symbol: "u_o", value: 4.5, unit: "mm", provenance: "given" },
    { id: "D", symbol: "D", value: 25, unit: "cm", provenance: "given" },
  ], { lawIds: ["compound_microscope"] }),
});
assert(microscope, "microscope family must compile from the plan");
assert(
  microscope.document.constructions.some((construction) => construction.operator === "optical_train"),
  "microscope must compile through optical_train",
);

const circuitQuestion = "Three resistors R1 = 12 ohm, R2 = 12 ohm, and R3 = 12 ohm are connected in parallel.";
const circuit = synthesizeFamilyScene({
  question: circuitQuestion,
  families: ["circuit_network"],
  turnPlan: plan(circuitQuestion, ["R1", "R2", "R3"].map((symbol, index) => ({
    id: `resistance_${index + 1}`,
    symbol,
    value: 12,
    unit: "ohm",
    sourceText: `${symbol} = 12 ohm`,
    provenance: "given" as const,
  }))),
});
assert(circuit, "parallel circuit family must compile from the question wording");
assert(
  circuit.document.constructions.filter((construction) => construction.operator === "symbol").length === 3,
  "parallel circuit must construct one symbol per named resistor",
);
assert(
  circuit.document.constructions.every((construction) =>
    construction.operator !== "point" || /^n\d+$/.test(String(construction.outputs[0] ?? ""))),
  "a parallel-only question must keep a single shared terminal pair",
);

const seriesAndParallelQuestion =
  "Three 12 ohm resistors in series and in parallel. Find both equivalent resistances and draw each circuit.";
const seriesAndParallel = synthesizeFamilyScene({
  question: seriesAndParallelQuestion,
  families: ["circuit_network"],
  turnPlan: plan(seriesAndParallelQuestion, [
    { id: "R", symbol: "R", value: 12, unit: "ohm", provenance: "given" },
    { id: "Req_series", symbol: "R_eq_series", value: 36, unit: "ohm", provenance: "derived" },
    { id: "Req_parallel", symbol: "R_eq_parallel", value: 4, unit: "ohm", provenance: "derived" },
  ]),
});
assert(seriesAndParallel, "series-and-parallel wording must compile both operator programs");
assert(
  seriesAndParallel.document.constructions.filter((construction) => construction.operator === "symbol").length === 6,
  "each topology must construct three resistor symbols",
);
assert(
  seriesAndParallel.document.revealGroups.some((group) => group.id === "series_group") &&
    seriesAndParallel.document.revealGroups.some((group) => group.id === "parallel_group"),
  "series and parallel must be separate reveal groups",
);
const circuitPointKeys = seriesAndParallel.document.constructions.flatMap((construction) => {
  if (construction.operator !== "point") return [];
  return [`${construction.inputs.x}:${construction.inputs.y}`];
});
assert(new Set(circuitPointKeys).size === circuitPointKeys.length, "the two circuit views must not share coordinates");
const seriesYs = seriesAndParallel.renderScene.primitives
  .filter((primitive) => String(primitive.entityId ?? "").startsWith("series_"))
  .flatMap((primitive) => primitive.points.map((point) => point.y));
const parallelYs = seriesAndParallel.renderScene.primitives
  .filter((primitive) => String(primitive.entityId ?? "").startsWith("parallel_"))
  .flatMap((primitive) => primitive.points.map((point) => point.y));
assert(seriesYs.length > 0 && parallelYs.length > 0, "both circuit views must render");
assert(
  Math.min(...seriesYs) > Math.max(...parallelYs) || Math.min(...parallelYs) > Math.max(...seriesYs),
  "series and parallel ink must occupy disjoint vertical bands",
);

const inclineQuestion = "A block rests on a 30 degree incline. Draw the free-body diagram.";
const incline = synthesizeFamilyScene({
  question: inclineQuestion,
  families: ["contact_body"],
  turnPlan: plan(inclineQuestion, [
    { id: "theta", symbol: "theta", value: 30, unit: "degree", provenance: "given" },
  ]),
});
assert(incline, "incline family must compile from the plan angle");
assert(
  incline.document.constructions.some((construction) => construction.operator === "normal_at"),
  "incline normal must be derived from the surface",
);
assert(
  !incline.document.constructions.some((construction) => construction.operator === "circle"),
  "a resting block must not invent a rolling disk",
);

const rollingQuestion =
  "A solid cylinder of mass 2 kg and radius 10 cm rolls without slipping down an incline of height 1.5 m, starting from rest.";
const rolling = synthesizeFamilyScene({
  question: rollingQuestion,
  families: ["contact_body", "solid_figure"],
  turnPlan: plan(rollingQuestion, [
    { id: "m", symbol: "m", value: 2, unit: "kg", provenance: "given" },
    { id: "R", symbol: "R", value: 0.1, unit: "m", provenance: "given" },
    { id: "h", symbol: "h", value: 1.5, unit: "m", provenance: "given" },
  ], { lawIds: ["moment_of_inertia", "rolling_without_slipping"] }),
});
assert(rolling, "rolling incline family must compile");
assert(rolling.family === "contact_body", "rolling cylinder on an incline is a contact body, not a mensuration solid");
assert(
  rolling.document.constructions.some((construction) => construction.operator === "circle"),
  "rolling body must be a circular section on the incline",
);
assert(
  !rolling.document.constructions.some((construction) => construction.operator === "solid_projection"),
  "rolling problems must not use a 3D mensuration solid",
);
assert(
  rolling.document.assertions.some((assertion) =>
    assertion.id === "contact_on_incline" && assertion.severity === "fatal"),
  "contact on the incline must stay a fatal proof",
);

const pulleyQuestion = "Two masses are connected by a string over a pulley. Draw the diagram.";
const pulley = synthesizeFamilyScene({
  question: pulleyQuestion,
  families: ["contact_body"],
  turnPlan: plan(pulleyQuestion, []),
});
assert(pulley, "pulley family must compile without guessed planner pixels");

const hingedQuestion = "A uniform rod is hinged at one end and makes 40 degrees with the horizontal. Find the hinge reaction.";
const hinged = synthesizeFamilyScene({
  question: hingedQuestion,
  families: ["contact_body"],
  turnPlan: plan(hingedQuestion, [
    { id: "theta", symbol: "theta", value: 40, unit: "degree", provenance: "given" },
  ]),
});
assert(hinged, "hinged rod family must compile from rotate");
assert(
  hinged.document.constructions.some((construction) => construction.operator === "rotate"),
  "hinged rod pose must be derived with rotate",
);

const curveQuestion = "Sketch the curve y=x^2.";
const curve = synthesizeFamilyScene({
  question: curveQuestion,
  families: ["analytic_curve"],
  turnPlan: plan(curveQuestion, []),
});
assert(curve, "explicit function graphs must compile");
assert(
  curve.document.constructions.some((construction) => construction.operator === "function_curve"),
  "analytic curve must use function_curve",
);

const prismQuestion = "A prism of angle 60 degrees and refractive index 1.5 is used. Find the minimum deviation.";
const prism = synthesizeFamilyScene({
  question: prismQuestion,
  families: ["interface", "ray_path"],
  turnPlan: plan(prismQuestion, [
    { id: "A", symbol: "A", value: 60, unit: "degree", provenance: "given" },
    { id: "n", symbol: "n", value: 1.5, unit: "1", provenance: "given" },
  ], { lawIds: ["prism_minimum_deviation"] }),
});
assert(prism, "prism family must compile a triangular section");
assert(
  prism.document.constructions.some((construction) => construction.operator === "polygon"),
  "prism must not be flattened into a single interface",
);
assert(
  !prism.document.constructions.some((construction) => construction.operator === "refract_at"),
  "prism apex must not be treated as a planar incidence angle",
);

const sphericalQuestion =
  "A point object is 30 cm from a spherical air-glass interface of radius 10 cm, glass index 1.5. Locate the paraxial image and show the surface-normal construction.";
const spherical = synthesizeFamilyScene({
  question: sphericalQuestion,
  families: ["axis_view", "interface", "ray_path"],
  turnPlan: plan(sphericalQuestion, [
    { id: "u", symbol: "u", value: 30, unit: "cm", provenance: "given" },
    { id: "R", symbol: "R", value: 10, unit: "cm", provenance: "given" },
    { id: "n_2", symbol: "n_2", value: 1.5, unit: "1", provenance: "given" },
  ], { lawIds: ["spherical_refraction"] }),
});
assert(spherical, "spherical interface must compile from the plan");
const sphericalLabels = new Map(
  spherical.document.entities
    .filter((entity) => entity.kind === "point" && entity.label)
    .map((entity) => [entity.label, entity.id]),
);
assert(sphericalLabels.has("O"), "object point O must be marked");
assert(sphericalLabels.has("C"), "center of curvature C must be marked");
assert(sphericalLabels.has("I"), "image point I must be marked");
assert(sphericalLabels.has("V"), "surface vertex V must be marked");
assert(
  spherical.document.assertions.some((assertion) =>
    assertion.predicate === "label_attached" && assertion.entities.includes("O")),
  "object label must be part of the proof contract",
);
assert(
  spherical.renderScene.primitives.some((primitive) => primitive.kind === "point"),
  "named points must render as visible marks",
);
assert(
  spherical.renderScene.primitives.some((primitive) => primitive.kind === "label" && /O/.test(primitive.text ?? "")),
  "object label must appear in the render scene",
);

const parametricQuestion =
  "Sketch the curve given by x = t^2 - 1, y = t^3 - t near t = 2, mark the point at that parameter, and draw the tangent there.";
const parametric = synthesizeFamilyScene({
  question: parametricQuestion,
  families: ["analytic_curve"],
  turnPlan: plan(parametricQuestion, []),
});
assert(parametric, "parametric curve must compile");
assert(
  parametric.document.entities.some((entity) => entity.id === "P" && entity.label === "P"),
  "parameter point must be marked P",
);
assert(
  parametric.document.constructions.some((construction) => construction.operator === "tangent_line"),
  "asked tangent must be derived from the curve",
);

const mirrorQuestion =
  "Concave mirror, f = 15 cm, object at 20 cm. Locate the image and draw the ray diagram.";
const mirror = synthesizeFamilyScene({
  question: mirrorQuestion,
  families: ["axis_view", "ray_path"],
  turnPlan: plan(mirrorQuestion, [
    { id: "f", symbol: "f", value: 15, unit: "cm", provenance: "given" },
    { id: "u", symbol: "u", value: 20, unit: "cm", provenance: "given" },
  ], {
    derived: [
      { id: "v", symbol: "v", value: 60, unit: "cm", provenance: "derived" },
      { id: "m", symbol: "m", value: -3, unit: "1", provenance: "derived" },
    ],
    lawIds: ["mirror_formula"],
  }),
});
assert(mirror, "concave mirror family must compile from the plan");
assert(
  mirror.document.entities.some((entity) => entity.kind === "arc" && /\bmirror\b/i.test(`${entity.id} ${entity.role}`)),
  "a spherical mirror must be an arc, not a straight line",
);
assert(
  !mirror.document.constructions.some((construction) =>
    construction.operator === "perpendicular_through" && construction.outputs.includes("lens")),
  "a spherical mirror must not be compiled as a thin-lens line",
);
assert(
  mirror.renderScene.primitives.some((primitive) => primitive.kind === "arc"),
  "compiled mirror ink must be an arc",
);
const mirrorLabels = new Map(
  mirror.document.entities
    .filter((entity) => entity.kind === "point" && entity.label)
    .map((entity) => [entity.label, entity.id]),
);
assert(mirrorLabels.has("O"), "object point O must be marked");
assert(mirrorLabels.has("I"), "image point I must be marked");
assert(mirrorLabels.has("F"), "focus F must be marked");
assert(mirrorLabels.has("C"), "center of curvature C must be marked");
const poleId = mirrorLabels.get("P") ?? mirrorLabels.get("V");
assert(poleId, "mirror pole must be marked P or V");
const pointX = (id: string): number => {
  const construction = mirror.document.constructions.find((item) =>
    item.operator === "point" && item.outputs.includes(id));
  const x = construction && typeof construction.inputs.x === "number" ? construction.inputs.x : null;
  assert(x !== null, `missing world x for ${id}`);
  return x;
};
const poleX = pointX(poleId);
const objectX = pointX(mirrorLabels.get("O")!);
const imageX = pointX(mirrorLabels.get("I")!);
const focusX = pointX(mirrorLabels.get("F")!);
assert((objectX - poleX) * (imageX - poleX) > 0, "real concave image must lie on the object side of the pole");
assert(Math.abs(imageX - poleX) > Math.abs(objectX - poleX), "real concave image must be farther than the object");
assert((focusX - poleX) * (objectX - poleX) > 0, "concave focus must lie in front of the mirror");
assert(
  mirror.document.teachingTimeline.some((action) =>
    action.action === "focus" && /this is o, the object/i.test(action.narrationIntent)),
  "intro must name and mark the object O",
);
assert(
  mirror.document.teachingTimeline.some((action) =>
    action.action === "focus" && /this is i, the image/i.test(action.narrationIntent)),
  "intro must name and mark the image I",
);

const convexQuestion =
  "A convex mirror has focal length 15 cm. An object is placed 20 cm from the mirror. Locate the image.";
const convex = synthesizeFamilyScene({
  question: convexQuestion,
  families: ["axis_view", "ray_path"],
  turnPlan: plan(convexQuestion, [
    { id: "f", symbol: "f", value: 15, unit: "cm", provenance: "given" },
    { id: "u", symbol: "u", value: 20, unit: "cm", provenance: "given" },
  ], { lawIds: ["mirror_formula"] }),
});
assert(convex, "convex mirror family must compile from the plan");
assert(
  convex.document.entities.some((entity) => entity.kind === "arc" && /\bmirror\b/i.test(`${entity.id} ${entity.role}`)),
  "a convex mirror must still be an arc",
);
const convexLabels = new Map(
  convex.document.entities
    .filter((entity) => entity.kind === "point" && entity.label)
    .map((entity) => [entity.label, entity.id]),
);
const convexPole = convexLabels.get("P") ?? convexLabels.get("V");
assert(convexLabels.has("O") && convexLabels.has("I") && convexPole, "convex mirror must mark O, I, and the pole");
const convexPoleConstruction = convex.document.constructions.find((item) =>
  item.operator === "point" && item.outputs.includes(convexPole!));
const convexObject = convex.document.constructions.find((item) =>
  item.operator === "point" && item.outputs.includes(convexLabels.get("O")!));
const convexImage = convex.document.constructions.find((item) =>
  item.operator === "point" && item.outputs.includes(convexLabels.get("I")!));
const convexPoleX = typeof convexPoleConstruction?.inputs.x === "number" ? convexPoleConstruction.inputs.x : 0;
const convexObjectX = typeof convexObject?.inputs.x === "number" ? convexObject.inputs.x : 0;
const convexImageX = typeof convexImage?.inputs.x === "number" ? convexImage.inputs.x : 0;
assert(
  (convexObjectX - convexPoleX) * (convexImageX - convexPoleX) < 0,
  "virtual convex image must lie behind the mirror",
);

const lastResort = synthesizeLastResortScene({
  question: "Explain the photoelectric effect and the stopping potential.",
  families: ["energy_level"],
  turnPlan: plan("Explain the photoelectric effect and the stopping potential.", []),
});
assert(lastResort, "last-resort energy-level schematic must still reach the board");
assert(lastResort.tier === "question_representation", "last-resort must stay a non-authoritative schematic");
assert(lastResort.renderScene.primitives.length > 0, "last-resort schematic produced no ink");

const missing = synthesizeFamilyScene({
  question: "What is the capital of France?",
  families: [],
  turnPlan: plan("What is the capital of France?", []),
});
assert(missing === null, "unsupported questions must not invent a diagram");

console.log("family synthesis verification passed");
