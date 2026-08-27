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

const boxForceQuestion = "A constant 10 N force pushes a box 4.0 m in the same direction as the force. Find the work done by the force.";
const boxForce = synthesizeFamilyScene({
  question: boxForceQuestion,
  families: ["contact_body"],
  turnPlan: plan(boxForceQuestion, [
    { id: "F", symbol: "F", value: 10, unit: "N", provenance: "given" },
    { id: "d", symbol: "d", value: 4, unit: "m", provenance: "given" },
  ]),
});
assert(boxForce, "constant-force box must compile a contact-body scene");
assert(
  boxForce.document.constructions.some((construction) => construction.outputs.includes("force")),
  "constant-force box must draw the applied force",
);

const raindropQuestion = "A raindrop of mass 1 g starts from rest at height 1 km and hits the ground at 5 m/s.";
const raindrop = synthesizeFamilyScene({
  question: raindropQuestion,
  families: ["contact_body"],
  turnPlan: plan(raindropQuestion, [
    { id: "m", symbol: "m", value: 0.001, unit: "kg", provenance: "given" },
    { id: "h", symbol: "h", value: 1000, unit: "m", provenance: "given" },
  ]),
});
assert(raindrop, "raindrop work problem must compile a falling-body scene");
assert(
  raindrop.document.entities.some((entity) => entity.id === "weight"),
  "falling-body scene must include weight",
);

const pendulumAngleQuestion = "A simple pendulum of length 2.0 m is released from rest at 60° to the vertical. Find the speed at the bottom.";
const pendulumAngle = synthesizeFamilyScene({
  question: pendulumAngleQuestion,
  families: ["contact_body"],
  turnPlan: plan(pendulumAngleQuestion, [
    { id: "L", symbol: "L", value: 2, unit: "m", provenance: "given" },
    { id: "theta", symbol: "theta", value: 60, unit: "degree", provenance: "given" },
  ]),
});
assert(pendulumAngle, "pendulum energy problem must compile");
assert(
  pendulumAngle.document.constructions.some((construction) => construction.operator === "rotate"),
  "a pendulum angle must be derived with rotate, not drawn as an incline",
);
assert(
  !pendulumAngle.document.entities.some((entity) => entity.id === "incline"),
  "a degree angle on a pendulum must not become an inclined plane",
);

const forceGraphQuestion = "A block of mass 10 kg moves along the x-axis under F = 5x N (x in metres). Find the work from x = 2 m to x = 4 m.";
const forceGraph = synthesizeFamilyScene({
  question: forceGraphQuestion,
  families: ["analytic_curve", "contact_body"],
  turnPlan: plan(forceGraphQuestion, [
    { id: "m", symbol: "m", value: 10, unit: "kg", provenance: "given" },
  ]),
});
assert(forceGraph, "variable-force F=5x must compile");
assert(forceGraph.family === "analytic_curve", "F(x) work should lead with the force-displacement graph");
assert(
  forceGraph.document.constructions.some((construction) => construction.operator === "function_curve"),
  "F=5x must be drawn as a function curve",
);

const xtQuestion = "Position along a line is x = t^3 metres with t in seconds. Find the instantaneous velocity at t = 2.0 s and the average velocity from t = 0 to t = 2.0 s.";
const xt = synthesizeFamilyScene({ question: xtQuestion });
assert(xt, "x=t^3 must compile a position-time graph");
assert(xt.family === "analytic_curve", "x(t) should lead with an analytic curve");
assert(
  xt.document.constructions.some((construction) => construction.operator === "function_curve"),
  "x=t^3 must be drawn as a function curve",
);

const trainQuestion = "A train starting from rest first accelerates uniformly up to 80 km/h in time t, then moves at that constant speed for time 3t. The average speed for the whole duration is (in km/h): (A) 70";
const train = synthesizeFamilyScene({ question: trainQuestion });
assert(train, "train average-speed stem must compile a diagram");
assert(
  train.renderScene.primitives.length > 0,
  "train average-speed stem produced no ink",
);

const roundTripQuestion = "Use the same 6 m/s / 9 m/s / 15 m/s straight-line trip as motion-in-a-straight-line medium, but now also find the average velocity if the particle returns to the start after the second half.";
const roundTrip = synthesizeFamilyScene({ question: roundTripQuestion });
assert(roundTrip, "round-trip average-velocity stem must compile a motion diagram");
assert(roundTrip.renderScene.primitives.length > 0, "round-trip stem produced no ink");

const unicodeXt = "Position along a line is x = t³ metres with t in seconds. Find the instantaneous velocity at t = 2.0 s and the average velocity from t = 0 to t = 2.0 s.";
const unicodeXtScene = synthesizeFamilyScene({ question: unicodeXt, families: [] });
assert(unicodeXtScene, "unicode x=t³ must still compile when the caller passes no families");
assert(
  unicodeXtScene.family === "analytic_curve",
  "unicode x=t³ must be an analytic curve, not a locked empty family list",
);

const relativeEasy = "Car A travels east at 20 m/s and car B travels east at 5.0 m/s on the same straight road. Find the velocity of A relative to B and of B relative to A.";
const relativeEasyScene = synthesizeFamilyScene({ question: relativeEasy, families: [] });
assert(relativeEasyScene, "1D relative-velocity cars must compile a diagram");
assert(
  relativeEasyScene.renderScene.primitives.length > 0,
  "relative-velocity cars produced no ink",
);
assert(
  relativeEasyScene.document.entities.some((entity) => entity.label === "A")
    && relativeEasyScene.document.entities.some((entity) => entity.label === "B"),
  "relative-velocity cars must be labelled A and B",
);

const relativeCatch = "Car A travels at a constant 15 m/s. Car B is 100 m ahead of A, travelling in the same direction at a constant 10 m/s. Find the time until A catches B. Then repeat if B instead starts from rest with acceleration 1.0 m/s² at the instant A is 100 m behind.";
const relativeCatchScene = synthesizeFamilyScene({ question: relativeCatch });
assert(relativeCatchScene, "catching-up cars must compile a diagram");
assert(
  relativeCatchScene.document.entities.filter((entity) => entity.role === "car").length === 2,
  "catching-up must draw two cars, not a single kinematics particle",
);

const projectileQuestion = "A ball is projected from the ground at 45° to the horizontal and reaches a maximum height of 120 m before returning to the same level.";
const projectileScene = synthesizeFamilyScene({ question: projectileQuestion, families: [] });
assert(projectileScene, "level-ground projectile must compile a diagram");
assert(projectileScene.renderScene.primitives.length > 0, "projectile produced no ink");
assert(
  projectileScene.document.entities.some((entity) => entity.id === "velocity"),
  "projectile must show the launch velocity",
);

const riverQuestion = "A boat’s speed in still water is 5.0 m/s and the current is 3.0 m/s along the river. Find the speed downstream and upstream.";
const riverScene = synthesizeFamilyScene({ question: riverQuestion, families: [] });
assert(riverScene, "river-boat stem must compile a velocity diagram");
assert(riverScene.family === "vector_diagram", "river-boat must use the vector family");

const rainQuestion = "Rain falls vertically at 10 m/s. A person walks east at 5.0 m/s. Find the magnitude of the rain’s velocity relative to the person.";
const rainScene = synthesizeFamilyScene({ question: rainQuestion });
assert(rainScene, "rain-man relative velocity must compile a diagram");
assert(rainScene.renderScene.primitives.length > 0, "rain-man produced no ink");

const motionGraphQuestion = "A velocity–time graph is a horizontal line at v = 10 m/s from t = 0 to t = 4.0 s. Sketch it, find the displacement from the area.";
const motionGraph = synthesizeFamilyScene({ question: motionGraphQuestion, families: [] });
assert(motionGraph, "en-dash velocity-time graph must compile");
assert(motionGraph.family === "state_plot", "motion graphs must be state plots, not empty axes");

const ucmQuestion = "A particle moves in a horizontal circle of radius 2.0 m with period 2.0 s. Find the speed and the centripetal acceleration.";
const ucm = synthesizeFamilyScene({ question: ucmQuestion });
assert(ucm, "uniform circular motion must compile a diagram");
assert(
  ucm.document.entities.some((entity) => entity.kind === "circle"),
  "UCM must draw the circular path",
);

const bankedQuestion = "A curve of radius 90 m is banked at 30° with no friction. Take g = 10 m/s². Find the design speed.";
const banked = synthesizeFamilyScene({ question: bankedQuestion });
assert(banked, "banked-road stem must compile");
assert(
  banked.document.entities.some((entity) => entity.id === "incline"),
  "a banked road must be an incline, not a horizontal block",
);

const conicalQuestion = "A conical pendulum has string length 2.0 m and makes 30° with the vertical. Draw T, mg, and the radius of the horizontal circle.";
const conical = synthesizeFamilyScene({ question: conicalQuestion });
assert(conical, "conical pendulum must compile");
assert(
  conical.document.entities.some((entity) => entity.id === "tension"),
  "conical pendulum must mark tension",
);

const notProjectile = "A particle’s velocity is (3.0 î + 4.0 ĵ) m/s. Find its speed. This is not a projectile: there is no gravity in the problem.";
const notProjectileScene = synthesizeFamilyScene({ question: notProjectile });
assert(notProjectileScene, "planar velocity components must still compile");
assert(
  !notProjectileScene.document.entities.some((entity) => entity.id === "tower"),
  "a stem that says it is not a projectile must not become a trajectory",
);

const missing = synthesizeFamilyScene({
  question: "What is the capital of France?",
  families: [],
  turnPlan: plan("What is the capital of France?", []),
});
assert(missing === null, "unsupported questions must not invent a diagram");

const gaussQuestion = "Apply Gauss's law to a uniformly charged thin spherical shell of radius 10 cm carrying 2 μC. Find the electric field outside.";
const gaussScene = synthesizeFamilyScene({ question: gaussQuestion, families: [] });
assert(gaussScene, "Gauss shell must compile a point-field diagram");
assert(gaussScene.family === "point_field", "Gauss shell must use point_field");

const wheatstoneQuestion = "In a Wheatstone bridge the four resistances are 10 ohm, 20 ohm, 30 ohm and 40 ohm. Find the galvanometer current.";
const wheatstoneScene = synthesizeFamilyScene({ question: wheatstoneQuestion, families: [] });
assert(wheatstoneScene, "Wheatstone bridge must compile a circuit");
assert(wheatstoneScene.family === "circuit_network", "Wheatstone must use circuit_network");

const depletionQuestion =
  "With the help of a suitable diagram, explain the formation of depletion-region in a p-n junction. How does its width change when the junction is forward biased and reverse biased?";
const depletion = synthesizeFamilyScene({ question: depletionQuestion, families: [] });
assert(depletion, "depletion-region stem must compile as one energy-level family");
assert(depletion.family === "energy_level", "depletion region must not fall through to a circuit");
assert(
  depletion.document.entities.some((entity) => entity.id === "depletion"),
  "depletion scene must mark the depletion region",
);

const bandQuestion = "Draw energy band diagrams of n-type and p-type semiconductors at temperature T > 0 K.";
const bands = synthesizeFamilyScene({ question: bandQuestion, families: [] });
assert(bands, "n-type and p-type energy bands must compile");
assert(bands.family === "energy_level", "semiconductor bands must use energy_level");
assert(
  bands.document.entities.some((entity) => entity.id === "n_imp")
    && bands.document.entities.some((entity) => entity.id === "p_imp"),
  "n-type and p-type columns must mark donor and acceptor levels",
);

const solarQuestion =
  "With the help of a simple diagram, explain the working of a silicon solar cell, giving all three basic processes involved.";
const solar = synthesizeFamilyScene({ question: solarQuestion, families: [] });
assert(solar, "solar cell must compile as a junction schematic");
assert(solar.family === "energy_level", "solar cell must not become a circuit");
assert(solar.document.entities.some((entity) => entity.id === "photon"), "solar cell must mark the incident photon");

const ledQuestion = "Explain, with the help of a schematic diagram, the principle and working of a Light Emitting Diode.";
const led = synthesizeFamilyScene({ question: ledQuestion, families: [] });
assert(led, "LED working diagram must compile as the energy-level family");
assert(led.family === "energy_level", "LED must not become a generic resistor circuit");
assert(led.document.entities.some((entity) => entity.id === "photon"), "LED must mark the emitted photon");

const diodeCircuitQuestion = "Draw a p-n junction diode in forward bias with the battery and the junction.";
const diodeCircuit = synthesizeFamilyScene({ question: diodeCircuitQuestion, families: [] });
assert(diodeCircuit, "forward-bias diode with battery must still compile a circuit");
assert(diodeCircuit.family === "circuit_network", "a biased diode with a battery remains circuit_network");

const transferQuestion =
  "Draw the transfer characteristic curve of a base biased transistor in CE configuration.";
const transfer = synthesizeFamilyScene({ question: transferQuestion, families: [] });
assert(transfer, "transistor transfer characteristic must compile");
assert(transfer.family === "state_plot", "a device characteristic curve is a state plot");

const meterBridgeQuestion = "State the principle of a meter bridge. A meter bridge balance point is found with resistances R and S.";
const meterBridge = synthesizeFamilyScene({ question: meterBridgeQuestion, families: [] })
  ?? synthesizeLastResortScene({ question: meterBridgeQuestion, families: [] });
assert(meterBridge, "meter-bridge spelling must compile as the same circuit family as metre-bridge");
assert(meterBridge.family === "circuit_network", "meter bridge must use circuit_network");

const magneticNewline = "A 1 cm straight segment of a conductor carrying 1 A lies at the origin. The magnetic\nfield due to this segment at (1 m, 1 m, 0) is.";
const magneticScene = synthesizeFamilyScene({ question: magneticNewline, families: [] })
  ?? synthesizeLastResortScene({ question: magneticNewline, families: [] });
assert(magneticScene, "newline-split magnetic field must still compile");
assert(magneticScene.family === "point_field", "a current element field is point_field");

const platesQuestion = "Four identical thin square metal sheets are kept parallel to each other with equal distance d between them. Find the capacitance between the outer sheets.";
const plates = synthesizeFamilyScene({ question: platesQuestion, families: [] })
  ?? synthesizeLastResortScene({ question: platesQuestion, families: [] });
assert(plates, "parallel metal sheets must compile as plates, not a resistor network");
assert(plates.family === "point_field", "parallel plates stay in point_field");
assert(plates.document.entities.some((entity) => entity.id === "plate1"), "parallel-plate scene must mark both plates");

const variationQuestion =
  "A conductor of uniform cross-sectional area is connected across a dc source. Draw a graph showing variation of drift velocity of electrons (vd) as a function of current density (J) in it.";
const variation = synthesizeFamilyScene({ question: variationQuestion, families: [] })
  ?? synthesizeLastResortScene({ question: variationQuestion, families: [] });
assert(variation, "named variation graph must compile");
assert(variation.family === "state_plot", "vd versus J is a state plot, not empty axes");

const normalAdjMicroscope =
  "A compound microscope consists of an objective and an eyepiece. The expression for me depends on whether the final image is formed at the near point or at infinity (normal adjustment). Draw the ray diagram.";
const microscopePaper = synthesizeFamilyScene({ question: normalAdjMicroscope, families: [] })
  ?? synthesizeLastResortScene({ question: normalAdjMicroscope, families: [] });
assert(microscopePaper, "a microscope stem that mentions normal adjustment must still compile through optical_train");
assert(
  microscopePaper.document.constructions.some((construction) => construction.operator === "optical_train"),
  "normal-adjustment wording must not veto an optical_train instrument",
);

const keplerQuestion = "A satellite orbits Earth in a circular orbit of radius 2R. Find the orbital velocity. Take g at the surface as 10 m/s².";
const keplerScene = synthesizeFamilyScene({ question: keplerQuestion, families: [] });
assert(keplerScene, "satellite orbit must compile a field/orbit diagram");

console.log("family synthesis verification passed");
