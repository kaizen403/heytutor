import { compileSceneDocument, pruneDeadSceneEntities, validateSceneDocument, type SceneDocument } from "../../src";

const operatorCases: Array<{
  operator: string;
  inputs: Record<string, unknown>;
  points: Array<{ id: string; x: number; y: number }>;
}> = [
  {
    operator: "wavefront_family",
    inputs: { origin: "p0", direction: [1, 0], shape: "plane", count: 4, spacing: 1, span: 5 },
    points: [{ id: "p0", x: 0, y: 0 }],
  },
  {
    operator: "aperture",
    inputs: { center: "p0", orientation: "vertical", length: 6, slitCount: 2, slitWidth: 0.25, slitSeparation: 1.2 },
    points: [{ id: "p0", x: 0, y: 0 }],
  },
  {
    operator: "screen_pattern",
    inputs: { start: "p0", end: "p1", pattern: "interference", count: 7, spacing: 0.55, centralWidth: 0.8 },
    points: [{ id: "p0", x: 0, y: -4 }, { id: "p1", x: 0, y: 4 }],
  },
  {
    operator: "transverse_field",
    inputs: { start: "p0", end: "p1", amplitude: 0.6, cycles: 3, orientationDeg: 90 },
    points: [{ id: "p0", x: -3, y: 0 }, { id: "p1", x: 3, y: 0 }],
  },
  {
    operator: "polarizer",
    inputs: { center: "p0", radius: 2, axisAngleDeg: 35 },
    points: [{ id: "p0", x: 0, y: 0 }],
  },
];

for (const testCase of operatorCases) {
  const document = operatorDocument(testCase.operator, testCase.inputs, testCase.points);
  const result = compileSceneDocument(document);
  if (!result.ok || !result.renderScene || result.renderScene.primitives.length < 2) {
    throw new Error(`${testCase.operator} failed: ${JSON.stringify(result.report.issues)}`);
  }
}

for (const mode of ["reflect_at", "refract_at"] as const) {
  const result = compileSceneDocument(surfaceRayDocument(mode));
  if (!result.ok || !result.renderScene || result.renderScene.primitives.length < 6) {
    throw new Error(`${mode} failed: ${JSON.stringify(result.report.issues)}`);
  }
}

const wavefrontRefractionResult = compileSceneDocument(wavefrontRefractionDocument());
if (!wavefrontRefractionResult.ok || !wavefrontRefractionResult.renderScene) {
  throw new Error(`ray-derived wavefront families failed: ${JSON.stringify(wavefrontRefractionResult.report.issues)}`);
}

const plannerDrift = surfaceRayDocument("refract_at");
const interfaceConstruction = plannerDrift.constructions.find((item) => item.id === "make_interface")!;
interfaceConstruction.operator = "line";
interfaceConstruction.inputs = { start: "contact", end: "missing_interface_end" };
const bundleConstruction = plannerDrift.constructions.find((item) => item.id === "make_bundle")!;
bundleConstruction.outputs = ["incident", "normal_helper", "refracted"];
plannerDrift.constructions.push({
  id: "make_visible_normal",
  operator: "perpendicular_through",
  inputs: { through: "contact", line: "interface" },
  outputs: ["normal"],
});
const snellAssertion = plannerDrift.assertions.find((item) => item.id === "snell")!;
snellAssertion.entities = ["incident", "refracted", "normal", "n1", "n2"];
snellAssertion.expected = true;
const plannerDriftValidated = validateSceneDocument(pruneDeadSceneEntities(
  plannerDrift as unknown as Record<string, unknown>,
));
const plannerDriftCompiled = plannerDriftValidated.document
  ? compileSceneDocument(plannerDriftValidated.document)
  : null;
if (!plannerDriftCompiled?.ok) {
  throw new Error(`atomic refraction planner drift was not normalized: ${JSON.stringify({ validation: plannerDriftValidated.report.issues, compilation: plannerDriftCompiled?.report.issues })}`);
}

const proofDerivedOptics = pruneDeadSceneEntities(
  proofDerivedWavefrontDocument() as unknown as Record<string, unknown>,
);
const proofDerivedConstructions = proofDerivedOptics.constructions as Array<{ operator?: string }>;
if (proofDerivedConstructions.filter((item) => item.operator === "refract_at").length !== 1 ||
    proofDerivedConstructions.filter((item) => item.operator === "wavefront_family").length !== 2) {
  throw new Error(`proof-derived optics did not select atomic operators: ${JSON.stringify(proofDerivedConstructions)}`);
}
const proofDerivedValidated = validateSceneDocument(proofDerivedOptics);
const proofDerivedCompiled = proofDerivedValidated.document
  ? compileSceneDocument(proofDerivedValidated.document)
  : null;
if (!proofDerivedCompiled?.ok) {
  throw new Error(`proof-derived optics failed: ${JSON.stringify({ validation: proofDerivedValidated.report.issues, compilation: proofDerivedCompiled?.report.issues })}`);
}

const instrumentDocument = opticalInstrumentDocument();
const normalizedInstrument = pruneDeadSceneEntities(
  instrumentDocument as unknown as Record<string, unknown>,
);
if (!(normalizedInstrument.constructions as Array<{ operator?: string }>).some((construction) =>
  construction.operator === "optical_train")) {
  throw new Error(`normal-adjustment ray proofs were not compiled into optical_train: ${JSON.stringify({
    entities: normalizedInstrument.entities,
    constructions: normalizedInstrument.constructions,
    assertions: normalizedInstrument.assertions,
  })}`);
}

for (const guessed of [guessedNearPointMicroscopeDocument(), guessedNearPointMicroscopeDocument({
  question: "A compound microscope has objective 1.2 cm and eyepiece 5 cm. An object is 1.5 cm from the objective. The final image is at the near point 25 cm from the eyepiece. Draw the ray diagram and find the tube length.",
  quantities: [
    { id: "f_o", value: 1.2, unit: "cm" },
    { id: "f_e", value: 5, unit: "cm" },
    { id: "u_o", value: 1.5, unit: "cm" },
    { id: "D", value: 25, unit: "cm" },
  ],
  objectiveX: 1.5,
  coincidentImageX: 80,
})]) {
  const normalizedGuessed = pruneDeadSceneEntities(guessed);
  if (!(normalizedGuessed.constructions as Array<{ operator?: string }>).some((construction) =>
    construction.operator === "optical_train")) {
    throw new Error(`near-point microscope rays were not compiled into optical_train: ${JSON.stringify({
      entities: normalizedGuessed.entities,
      constructions: normalizedGuessed.constructions,
    })}`);
  }
  const guessedValidated = validateSceneDocument(normalizedGuessed);
  const guessedCompiled = guessedValidated.document
    ? compileSceneDocument(guessedValidated.document)
    : null;
  if (!guessedCompiled?.ok) {
    throw new Error(`near-point microscope chain failed: ${JSON.stringify({
      validation: guessedValidated.report.issues,
      compilation: guessedCompiled?.report.issues,
    })}`);
  }
  const pointX = (id: string): number => {
    const construction = (guessedValidated.document?.constructions ?? []).find((item) =>
      item.operator === "point" && item.outputs.includes(id));
    const value = construction && typeof construction.inputs.x === "number" ? construction.inputs.x : NaN;
    if (!Number.isFinite(value)) throw new Error(`missing laid-out instrument point ${id}`);
    return value;
  };
  const objectX = pointX("O");
  const objectiveX = pointX("L_o");
  const imageX = pointX("I");
  const eyepieceX = pointX("L_e");
  const finalX = pointX("I_prime");
  if (!(objectX < objectiveX && objectiveX < imageX && imageX < eyepieceX)) {
    throw new Error(`microscope image plane was not between the lenses: ${JSON.stringify({ objectX, objectiveX, imageX, eyepieceX })}`);
  }
  if (!(finalX < eyepieceX - 1e-6)) {
    throw new Error(`virtual final image was not on the object side of the eyepiece: ${JSON.stringify({ finalX, eyepieceX })}`);
  }
}
const instrumentValidated = validateSceneDocument(normalizedInstrument);
const instrumentCompiled = instrumentValidated.document
  ? compileSceneDocument(instrumentValidated.document)
  : null;
if (!instrumentCompiled?.ok) {
  throw new Error(`verified optical instrument chain failed: ${JSON.stringify({ validation: instrumentValidated.report.issues, compilation: instrumentCompiled?.report.issues })}`);
}
const unprovedInstrument = structuredClone(instrumentDocument);
unprovedInstrument.assertions = unprovedInstrument.assertions.filter((assertion) =>
  assertion.id !== "objective_transverse");
const unprovedInstrumentValidation = validateSceneDocument(unprovedInstrument);
if (
  unprovedInstrumentValidation.document ||
  !unprovedInstrumentValidation.report.issues.some((issue) =>
    issue.code === "instrument_element_orientation_not_proven" && issue.entityIds?.includes("objective"))
) {
  throw new Error("optical instrument chain without an objective orientation proof was accepted");
}

const proofDocument = geometryProofDocument();
const proofResult = compileSceneDocument(proofDocument);
if (!proofResult.ok || !proofResult.renderScene) {
  throw new Error(`optics proof predicates failed: ${JSON.stringify(proofResult.report.issues)}`);
}

const numericAngleDocument = numericAngleAndLabelDocument();
const numericAngleResult = compileSceneDocument(numericAngleDocument);
if (!numericAngleResult.ok || !numericAngleResult.renderScene) {
  throw new Error(`numeric angle and label proofs failed: ${JSON.stringify(numericAngleResult.report.issues)}`);
}
const wrongNumericAngleDocument = structuredClone(numericAngleDocument);
const analyzerPoint = wrongNumericAngleDocument.constructions.find((item) => item.id === "make_analyzer_end")!;
analyzerPoint.inputs = { x: 1, y: 1, coordinateSpace: "world" };
const wrongNumericAngleResult = compileSceneDocument(wrongNumericAngleDocument);
if (wrongNumericAngleResult.ok || !wrongNumericAngleResult.report.issues.some((issue) => issue.code === "assertion_failed")) {
  throw new Error("numeric angle mutation was not rejected");
}
const falseInequalityDocument = structuredClone(numericAngleDocument);
const comparisonPoint = falseInequalityDocument.constructions.find((item) => item.id === "make_comparison_end")!;
comparisonPoint.inputs = { x: 2 * Math.sin(Math.PI / 3), y: 2 * Math.cos(Math.PI / 3), coordinateSpace: "world" };
const falseInequalityResult = compileSceneDocument(falseInequalityDocument);
if (falseInequalityResult.ok || !falseInequalityResult.report.issues.some((issue) => issue.code === "assertion_failed")) {
  throw new Error("equal angle marks incorrectly satisfied an explicit inequality assertion");
}

const ownershipDocument = structuredClone(proofDocument);
ownershipDocument.requiredEntityIds = ownershipDocument.requiredEntityIds.filter((id) => id !== "order_b");
ownershipDocument.revealGroups[0]!.entityIds = ownershipDocument.revealGroups[0]!.entityIds.filter((id) => id !== "order_b");
const ownershipValidated = validateSceneDocument(pruneDeadSceneEntities(
  ownershipDocument as unknown as Record<string, unknown>,
));
const ownershipResult = ownershipValidated.document
  ? compileSceneDocument(ownershipValidated.document)
  : { ok: false, report: ownershipValidated.report };
if (!ownershipResult.ok) {
  throw new Error(`asserted entity ownership was not normalized: ${JSON.stringify(ownershipResult.report.issues)}`);
}

const helperDocument = structuredClone(proofDocument);
helperDocument.requiredEntityIds = helperDocument.requiredEntityIds.filter((id) => id !== "poly_a");
helperDocument.revealGroups[0]!.entityIds = helperDocument.revealGroups[0]!.entityIds.filter((id) => id !== "poly_a");
const helperPruned = pruneDeadSceneEntities(helperDocument as unknown as Record<string, unknown>);
const helperValidated = validateSceneDocument(helperPruned);
const helperCompiled = helperValidated.document ? compileSceneDocument(helperValidated.document) : null;
if (!helperValidated.document || !helperCompiled?.ok) {
  throw new Error(`construction-only helper was not hidden safely: ${JSON.stringify({ entities: (helperPruned.entities as Array<{ id?: string }>).map((entity) => entity.id), validation: helperValidated.report.issues, compilation: helperCompiled?.report.issues })}`);
}

const brokenSnell = structuredClone(proofDocument);
brokenSnell.assertions = brokenSnell.assertions.filter((assertion) => assertion.predicate !== "snells_law");
brokenSnell.assertions.push({
  id: "bad_snell",
  predicate: "snells_law",
  entities: ["incident", "normal", "wrong_refracted"],
  expected: { n1: 1, n2: 1.5 },
  tolerance: 0.000001,
  severity: "fatal",
});
const brokenResult = compileSceneDocument(brokenSnell);
if (brokenResult.ok || !brokenResult.report.issues.some((issue) => issue.code === "assertion_failed")) {
  throw new Error("snells_law mutation was not rejected");
}

console.log("verify-optics-operators: ok");
console.log(`  operators=${operatorCases.length + 2} proof_predicates=${proofDocument.assertions.length}`);

function surfaceRayDocument(operator: "reflect_at" | "refract_at"): SceneDocument {
  const outgoingId = operator === "reflect_at" ? "reflected" : "refracted";
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: `verify atomic ${operator}` },
    source: { question: `Show a 30 degree ${operator === "reflect_at" ? "reflection" : "refraction"}.` },
    quantities: [
      { id: "theta", symbol: "theta", value: 30, unit: "degree" },
      { id: "n1", symbol: "n1", value: 1, unit: "1" },
      { id: "n2", symbol: "n2", value: 1.5, unit: "1" },
    ],
    entities: [
      { id: "left", kind: "point", role: "interface endpoint" },
      { id: "right", kind: "point", role: "interface endpoint" },
      { id: "contact", kind: "point", role: "point of incidence" },
      { id: "interface", kind: "segment", role: "optical interface" },
      { id: "incident", kind: "ray", role: "incident ray" },
      { id: "normal", kind: "segment", role: "surface normal" },
      { id: outgoingId, kind: "ray", role: `${outgoingId} ray` },
      { id: "angle_in", kind: "angle_mark", role: "incidence angle" },
      { id: "angle_out", kind: "angle_mark", role: "outgoing angle" },
    ],
    constructions: [
      { id: "make_left", operator: "point", inputs: { x: -3, y: 0, coordinateSpace: "world" }, outputs: ["left"] },
      { id: "make_right", operator: "point", inputs: { x: 3, y: 0, coordinateSpace: "world" }, outputs: ["right"] },
      { id: "make_contact", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["contact"] },
      { id: "make_interface", operator: "segment", inputs: { start: "left", end: "right" }, outputs: ["interface"] },
      {
        id: "make_bundle",
        operator,
        inputs: operator === "refract_at"
          ? { point: "contact", surface: "interface", incidentAngleDeg: "theta", n1: "n1", n2: "n2", span: 2 }
          : { point: "contact", surface: "interface", incidentAngleDeg: "theta", span: 2 },
        outputs: ["incident", "normal", outgoingId],
      },
      { id: "make_angle_in", operator: "angle_mark", inputs: { vertex: "contact", a: "incident", b: "normal", radius: 0.4 }, outputs: ["angle_in"] },
      { id: "make_angle_out", operator: "angle_mark", inputs: { vertex: "contact", a: "normal", b: outgoingId, radius: 0.4 }, outputs: ["angle_out"] },
    ],
    relations: [],
    assertions: [
      { id: "contact_on_surface", predicate: "on", entities: ["contact", "interface"], expected: true, severity: "fatal" },
      { id: "normal_perpendicular", predicate: "perpendicular", entities: ["normal", "interface"], expected: true, severity: "fatal" },
      ...(operator === "refract_at"
        ? [{ id: "snell", predicate: "snells_law", entities: ["incident", "normal", outgoingId], expected: { n1: 1, n2: 1.5 }, tolerance: 0.000001, severity: "fatal" as const }]
        : [{ id: "reflection_angles", predicate: "equal_angle", entities: ["incident", "normal", outgoingId, "normal"], expected: true, tolerance: 0.000001, severity: "fatal" as const }]),
    ],
    annotations: [],
    requiredEntityIds: ["left", "right", "contact", "interface", "incident", "normal", outgoingId, "angle_in", "angle_out"],
    revealGroups: [{ id: "setup", entityIds: ["left", "right", "contact", "interface", "incident", "normal", outgoingId, "angle_in", "angle_out"], dependsOn: [], narrationCue: "Explain the verified surface ray construction." }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Draw the interface and rays while explaining the law." }],
  };
}

function wavefrontRefractionDocument(): SceneDocument {
  const document = surfaceRayDocument("refract_at");
  document.entities.push(
    { id: "incident_fronts", kind: "wavefront_family", role: "incident wavefront family" },
    { id: "refracted_fronts", kind: "wavefront_family", role: "refracted wavefront family" },
  );
  document.constructions.push(
    {
      id: "make_incident_fronts",
      operator: "wavefront_family",
      inputs: { origin: "contact", direction: "incident", shape: "plane", count: 3, spacing: 0.35, span: 2.5 },
      outputs: ["incident_fronts"],
    },
    {
      id: "make_refracted_fronts",
      operator: "wavefront_family",
      inputs: { origin: "contact", direction: "refracted", shape: "plane", count: 3, spacing: 0.25, span: 2.5 },
      outputs: ["refracted_fronts"],
    },
  );
  document.requiredEntityIds.push("incident_fronts", "refracted_fronts");
  document.revealGroups[0]!.entityIds.push("incident_fronts", "refracted_fronts");
  return document;
}

function proofDerivedWavefrontDocument(): SceneDocument {
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "verify proof-driven optics normalization" },
    source: { question: "Show refraction and perpendicular incident and refracted wavefronts." },
    quantities: [
      { id: "theta1", symbol: "theta_1", value: 30, unit: "degree" },
      { id: "n1", symbol: "n_1", value: 1, unit: "1" },
      { id: "n2", symbol: "n_2", value: 1.5, unit: "1" },
    ],
    entities: [
      { id: "left", kind: "point", role: "interface endpoint" },
      { id: "right", kind: "point", role: "interface endpoint" },
      { id: "contact", kind: "point", role: "point of incidence" },
      { id: "source", kind: "point", role: "incident ray start" },
      { id: "wrong_out", kind: "point", role: "guessed refracted endpoint" },
      { id: "normal_end", kind: "point", role: "normal endpoint" },
      { id: "front_a", kind: "point", role: "wavefront endpoint" },
      { id: "front_b", kind: "point", role: "wavefront endpoint" },
      { id: "interface", kind: "segment", role: "optical interface" },
      { id: "incident", kind: "ray", role: "incident ray" },
      { id: "normal", kind: "segment", role: "surface normal" },
      { id: "refracted", kind: "ray", role: "refracted ray" },
      { id: "incident_front", kind: "segment", role: "incident wavefront" },
      { id: "refracted_front", kind: "segment", role: "refracted wavefront" },
    ],
    constructions: [
      { id: "make_left", operator: "point", inputs: { x: -4, y: 0, coordinateSpace: "world" }, outputs: ["left"] },
      { id: "make_right", operator: "point", inputs: { x: 4, y: 0, coordinateSpace: "world" }, outputs: ["right"] },
      { id: "make_contact", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["contact"] },
      { id: "make_source", operator: "point", inputs: { x: -1, y: 1.7320508075688772, coordinateSpace: "world" }, outputs: ["source"] },
      { id: "make_wrong_out", operator: "point", inputs: { x: 2, y: -2, coordinateSpace: "world" }, outputs: ["wrong_out"] },
      { id: "make_normal_end", operator: "point", inputs: { x: 0, y: 2, coordinateSpace: "world" }, outputs: ["normal_end"] },
      { id: "make_front_a", operator: "point", inputs: { x: -2, y: 1, coordinateSpace: "world" }, outputs: ["front_a"] },
      { id: "make_front_b", operator: "point", inputs: { x: 2, y: 1, coordinateSpace: "world" }, outputs: ["front_b"] },
      { id: "make_interface", operator: "segment", inputs: { start: "left", end: "right" }, outputs: ["interface"] },
      { id: "guess_incident", operator: "ray", inputs: { start: "source", end: "contact" }, outputs: ["incident"] },
      { id: "guess_normal", operator: "segment", inputs: { start: "contact", end: "normal_end" }, outputs: ["normal"] },
      { id: "guess_refracted", operator: "ray", inputs: { start: "contact", end: "wrong_out" }, outputs: ["refracted"] },
      { id: "guess_incident_front", operator: "segment", inputs: { start: "front_a", end: "front_b" }, outputs: ["incident_front"] },
      { id: "guess_refracted_front", operator: "segment", inputs: { start: "front_a", end: "wrong_out" }, outputs: ["refracted_front"] },
    ],
    relations: [],
    assertions: [
      { id: "contact_on_interface", predicate: "on", entities: ["contact", "interface"], expected: true, severity: "fatal" },
      { id: "normal_to_interface", predicate: "perpendicular", entities: ["normal", "interface"], expected: true, severity: "fatal" },
      { id: "incident_angle", predicate: "angle_between", entities: ["incident", "normal"], expected: { value: 30, unit: "degree" }, severity: "fatal" },
      { id: "snell", predicate: "snells_law", entities: ["incident", "normal", "refracted"], expected: { n1: 1, n2: 1.5 }, severity: "fatal" },
      { id: "incident_front_normal", predicate: "perpendicular", entities: ["incident", "incident_front"], expected: true, severity: "fatal" },
      { id: "refracted_front_normal", predicate: "perpendicular", entities: ["refracted", "refracted_front"], expected: true, severity: "fatal" },
    ],
    annotations: [],
    requiredEntityIds: ["interface", "incident", "normal", "refracted", "incident_front", "refracted_front"],
    revealGroups: [{ id: "setup", entityIds: ["interface", "incident", "normal", "refracted", "incident_front", "refracted_front"], dependsOn: [], narrationCue: "Reveal the verified ray and wavefront construction." }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Explain each ray and perpendicular wavefront while drawing it." }],
  };
}

function guessedNearPointMicroscopeDocument(options: {
  question?: string;
  quantities?: Array<{ id: string; value: number; unit: string }>;
  objectiveX?: number;
  coincidentImageX?: number;
} = {}): Record<string, unknown> {
  const question = options.question ?? (
    "A compound microscope has an objective of focal length 4 mm and an eyepiece of focal length 2.5 cm. " +
    "An object is placed 4.5 mm from the objective. The final image is formed at the near point, 25 cm from the eyepiece. " +
    "Draw the ray diagram showing the objective, the eyepiece, the intermediate real image, and the final virtual image."
  );
  const quantities = options.quantities ?? [
    { id: "f_o", value: 4, unit: "mm" },
    { id: "f_e", value: 2.5, unit: "cm" },
    { id: "u_o", value: 4.5, unit: "mm" },
    { id: "D", value: 25, unit: "cm" },
    { id: "v_o_cm", value: 36, unit: "cm" },
  ];
  const objectiveX = options.objectiveX ?? 4.5;
  const imageX = options.coincidentImageX ?? 40.5;
  const visible = ["O", "L_o", "I", "L_e", "I_prime", "axis", "obj_lens", "eye_lens", "ray1_obj", "ray1_int"];
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: "scene",
    source: { question },
    quantities,
    entities: [
      { id: "O", kind: "point", role: "object_position" },
      { id: "L_o", kind: "point", role: "objective_lens_center" },
      { id: "I", kind: "point", role: "intermediate_image" },
      { id: "L_e", kind: "point", role: "eyepiece_lens_center" },
      { id: "I_prime", kind: "point", role: "final_virtual_image" },
      { id: "axis", kind: "line", role: "optical_axis" },
      { id: "obj_lens", kind: "segment", role: "objective_lens" },
      { id: "eye_lens", kind: "segment", role: "eyepiece_lens" },
      { id: "ray1_obj", kind: "ray", role: "objective_ray_parallel" },
      { id: "ray1_int", kind: "ray", role: "objective_ray_refracted" },
    ],
    constructions: [
      { id: "c_O", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["O"] },
      { id: "c_L_o", operator: "point", inputs: { x: objectiveX, y: 0, coordinateSpace: "world" }, outputs: ["L_o"] },
      { id: "c_I", operator: "point", inputs: { x: imageX, y: 0, coordinateSpace: "world" }, outputs: ["I"] },
      { id: "c_L_e", operator: "point", inputs: { x: imageX, y: 0, coordinateSpace: "world" }, outputs: ["L_e"] },
      { id: "c_I_prime", operator: "point", inputs: { x: imageX + 25, y: 0, coordinateSpace: "world" }, outputs: ["I_prime"] },
      { id: "c_axis", operator: "line", inputs: { start: "O", end: "I_prime" }, outputs: ["axis"] },
      { id: "c_obj_lens", operator: "segment", inputs: { start: "L_o", end: "L_o" }, outputs: ["obj_lens"] },
      { id: "c_eye_lens", operator: "segment", inputs: { start: "L_e", end: "L_e" }, outputs: ["eye_lens"] },
      { id: "c_ray1_obj", operator: "ray", inputs: { start: "O", end: "I" }, outputs: ["ray1_obj"] },
      { id: "c_ray1_int", operator: "ray", inputs: { start: "L_o", end: "I" }, outputs: ["ray1_int"] },
    ],
    relations: [],
    assertions: [
      { id: "a_obj_on_axis", predicate: "on", entities: ["O", "axis"], expected: true, severity: "error" },
      { id: "a_intermediate_real", predicate: "between", entities: ["L_o", "I", "L_e"], expected: true, severity: "error" },
      { id: "a_final_between_object_and_objective", predicate: "between", entities: ["I_prime", "O", "L_o"], expected: true, severity: "error" },
    ],
    annotations: [],
    requiredEntityIds: visible,
    revealGroups: [{ id: "setup", entityIds: visible, dependsOn: [], narrationCue: "Draw the microscope chain." }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Show the verified instrument chain." }],
  };
}

function opticalInstrumentDocument(): SceneDocument {
  const points = [
    ["axis_left", -5, 0, "axis endpoint"],
    ["axis_right", 5, 0, "axis endpoint"],
    ["objective_center", -2, 0, "objective center"],
    ["eyepiece_center", 2, 0, "eyepiece center"],
    ["shared_focus", 0, 0, "common objective and eyepiece focal point"],
    ["incoming_top_start", -5, 1, "incoming ray endpoint"],
    ["incoming_top_hit", -2, 1, "incoming ray endpoint"],
    ["incoming_bottom_start", -5, -1, "incoming ray endpoint"],
    ["incoming_bottom_hit", -2, -1, "incoming ray endpoint"],
    ["emergent_top_start", 2, 0.7, "emergent ray endpoint"],
    ["emergent_top_end", 5, 0.7, "emergent ray endpoint"],
    ["emergent_bottom_start", 2, -0.7, "emergent ray endpoint"],
    ["emergent_bottom_end", 5, -0.7, "emergent ray endpoint"],
  ] as const;
  const pointEntities = points.map(([id, , , role]) => ({ id, kind: "point", role }));
  const pointConstructions = points.map(([id, x, y]) => ({
    id: `make_${id}`,
    operator: "point",
    inputs: { x, y, coordinateSpace: "world" },
    outputs: [id],
  }));
  const visibleIds = [
    ...points.map(([id]) => id),
    "axis", "objective", "eyepiece", "incoming_top", "incoming_bottom",
    "objective_ray_top", "objective_ray_bottom", "emergent_top", "emergent_bottom",
  ];
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "verify a proof-driven optical instrument chain" },
    source: { question: "Show an astronomical telescope in normal adjustment with parallel emergent rays." },
    quantities: [],
    entities: [
      ...pointEntities,
      { id: "axis", kind: "line", role: "optical axis", label: "axis" },
      { id: "objective", kind: "line", role: "objective lens", label: "objective" },
      { id: "eyepiece", kind: "line", role: "eyepiece lens", label: "eyepiece" },
      { id: "incoming_top", kind: "ray", role: "incoming ray" },
      { id: "incoming_bottom", kind: "ray", role: "incoming ray" },
      { id: "objective_ray_top", kind: "ray", role: "objective converging ray" },
      { id: "objective_ray_bottom", kind: "ray", role: "objective converging ray" },
      { id: "emergent_top", kind: "ray", role: "emergent ray" },
      { id: "emergent_bottom", kind: "ray", role: "emergent ray" },
    ],
    constructions: [
      ...pointConstructions,
      { id: "make_axis", operator: "line", inputs: { start: "axis_left", end: "axis_right" }, outputs: ["axis"] },
      { id: "make_objective", operator: "perpendicular_through", inputs: { through: "objective_center", line: "axis" }, outputs: ["objective"] },
      { id: "make_eyepiece", operator: "perpendicular_through", inputs: { through: "eyepiece_center", line: "axis" }, outputs: ["eyepiece"] },
      { id: "make_incoming_top", operator: "ray", inputs: { start: "incoming_top_start", end: "incoming_top_hit" }, outputs: ["incoming_top"] },
      { id: "make_incoming_bottom", operator: "ray", inputs: { start: "incoming_bottom_start", end: "incoming_bottom_hit" }, outputs: ["incoming_bottom"] },
      { id: "make_objective_ray_top", operator: "ray", inputs: { start: "incoming_top_hit", end: "shared_focus" }, outputs: ["objective_ray_top"] },
      { id: "make_objective_ray_bottom", operator: "ray", inputs: { start: "incoming_bottom_hit", end: "shared_focus" }, outputs: ["objective_ray_bottom"] },
      { id: "make_emergent_top", operator: "ray", inputs: { start: "emergent_top_start", end: "emergent_top_end" }, outputs: ["emergent_top"] },
      { id: "make_emergent_bottom", operator: "ray", inputs: { start: "emergent_bottom_start", end: "emergent_bottom_end" }, outputs: ["emergent_bottom"] },
    ],
    relations: [],
    assertions: [
      { id: "objective_transverse", predicate: "perpendicular", entities: ["objective", "axis"], expected: true, severity: "fatal" },
      { id: "eyepiece_transverse", predicate: "perpendicular", entities: ["eyepiece", "axis"], expected: true, severity: "fatal" },
      { id: "incoming_parallel", predicate: "parallel", entities: ["incoming_top", "incoming_bottom"], expected: true, severity: "fatal" },
      { id: "objective_focus", predicate: "converges", entities: ["objective_ray_top", "objective_ray_bottom", "shared_focus"], expected: true, severity: "fatal" },
      { id: "emergent_parallel", predicate: "parallel", entities: ["emergent_top", "emergent_bottom"], expected: true, severity: "fatal" },
      { id: "focus_between_elements", predicate: "between", entities: ["shared_focus", "objective_center", "eyepiece_center"], expected: true, severity: "fatal" },
    ],
    annotations: [],
    requiredEntityIds: visibleIds,
    revealGroups: [{ id: "setup", entityIds: visibleIds, dependsOn: [], narrationCue: "Draw the telescope ray chain from left to right." }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Explain the objective focus and parallel emergent rays while drawing them." }],
  };
}

function operatorDocument(
  operator: string,
  inputs: Record<string, unknown>,
  points: Array<{ id: string; x: number; y: number }>,
): SceneDocument {
  const output = `${operator}_output`;
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "offline reusable optics operator verification" },
    source: { question: `Verify ${operator}` },
    quantities: [],
    entities: [
      ...points.map((point) => ({ id: point.id, kind: "point", role: "construction point" })),
      { id: output, kind: "polyline", role: operator.replaceAll("_", " "), label: operator.slice(0, 12) },
    ],
    constructions: [
      ...points.map((point) => ({
        id: `make_${point.id}`,
        operator: "point",
        inputs: { x: point.x, y: point.y, coordinateSpace: "world" },
        outputs: [point.id],
      })),
      { id: `make_${output}`, operator, inputs, outputs: [output] },
    ],
    relations: [],
    assertions: [
      { id: `assert_${output}`, predicate: "exists", entities: [output], expected: true, severity: "fatal" },
      ...(operator === "screen_pattern" || operator === "wavefront_family"
        ? [{ id: `spacing_${output}`, predicate: "equal_spacing", entities: [output], expected: true, tolerance: 0.000001, severity: "fatal" as const }]
        : []),
    ],
    annotations: [],
    requiredEntityIds: [output],
    revealGroups: [{ id: "setup", entityIds: [output], dependsOn: [], narrationCue: `Explain the ${operator.replaceAll("_", " ")}.` }],
    teachingTimeline: [{ id: "reveal_setup", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: `Reveal the ${operator.replaceAll("_", " ")} before using it.` }],
  };
}

function geometryProofDocument(): SceneDocument {
  const refractedAngle = Math.asin(Math.sin(Math.PI / 6) / 1.5);
  const points = [
    ["origin", 0, 0], ["normal_end", 0, -4], ["incident_start", -2, -2 * Math.sqrt(3)],
    ["reflected_end", 2, -2 * Math.sqrt(3)], ["refracted_end", 4 * Math.sin(refractedAngle), 4 * Math.cos(refractedAngle)],
    ["wrong_end", 4, 0], ["inside_point", 1, 1], ["poly_a", -2, -2], ["poly_b", 2, -2],
    ["poly_c", 2, 2], ["poly_d", -2, 2], ["order_a", -3, 3], ["order_b", 0, 3], ["order_c", 3, 3],
  ] as const;
  const pointEntities = points.map(([id]) => ({ id, kind: "point", role: "proof point" }));
  const pointConstructions = points.map(([id, x, y]) => ({
    id: `make_${id}`,
    operator: "point",
    inputs: { x, y, coordinateSpace: "world" },
    outputs: [id],
  }));
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "verify reusable optics geometry proofs" },
    source: { question: "Verify reflection, refraction, containment, and ordering geometry." },
    quantities: [],
    entities: [
      ...pointEntities,
      { id: "normal", kind: "vector", role: "surface normal" },
      { id: "incident", kind: "vector", role: "incident ray" },
      { id: "reflected", kind: "vector", role: "first comparison path" },
      { id: "refracted", kind: "vector", role: "second comparison path" },
      { id: "wrong_refracted", kind: "vector", role: "comparison ray" },
      { id: "medium", kind: "polygon", role: "medium boundary" },
    ],
    constructions: [
      ...pointConstructions,
      { id: "make_normal", operator: "vector", inputs: { start: "origin", end: "normal_end" }, outputs: ["normal"] },
      { id: "make_incident", operator: "vector", inputs: { start: "incident_start", end: "origin" }, outputs: ["incident"] },
      { id: "make_reflected", operator: "vector", inputs: { start: "origin", end: "reflected_end" }, outputs: ["reflected"] },
      { id: "make_refracted", operator: "vector", inputs: { start: "origin", end: "refracted_end" }, outputs: ["refracted"] },
      { id: "make_wrong", operator: "vector", inputs: { start: "origin", end: "wrong_end" }, outputs: ["wrong_refracted"] },
      { id: "make_medium", operator: "polygon", inputs: { points: ["poly_a", "poly_b", "poly_c", "poly_d"] }, outputs: ["medium"] },
    ],
    relations: [],
    assertions: [
      { id: "equal_reflection_angles", predicate: "equal_angle", entities: ["incident", "normal", "reflected", "normal"], expected: true, tolerance: 0.000001, severity: "fatal" },
      { id: "snell_consistency", predicate: "snells_law", entities: ["incident", "normal", "refracted"], expected: { n1: 1, n2: 1.5 }, tolerance: 0.000001, severity: "fatal" },
      { id: "point_in_medium", predicate: "inside", entities: ["inside_point", "medium"], expected: true, severity: "fatal" },
      { id: "axis_order", predicate: "ordered_along", entities: ["order_a", "order_b", "order_c"], expected: { axis: "x", direction: "increasing" }, severity: "fatal" },
      { id: "equal_axis_spacing", predicate: "equal_spacing", entities: ["order_a", "order_b", "order_c"], expected: true, tolerance: 0.000001, severity: "fatal" },
    ],
    annotations: [],
    requiredEntityIds: [...points.map(([id]) => id), "normal", "incident", "reflected", "refracted", "wrong_refracted", "medium"],
    revealGroups: [{ id: "proof", entityIds: [...points.map(([id]) => id), "normal", "incident", "reflected", "refracted", "wrong_refracted", "medium"], dependsOn: [], narrationCue: "Reveal the verified ray relationships." }],
    teachingTimeline: [{ id: "reveal_proof", action: "reveal", targetId: "proof", dependsOn: [], narrationIntent: "Explain the normal, ray angles, and medium boundary as they appear." }],
  };
}

function numericAngleAndLabelDocument(): SceneDocument {
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "verify numeric angles and label ownership" },
    source: { question: "Show a polarization direction and analyzer axis separated by 60 degrees." },
    quantities: [{ id: "theta", symbol: "theta", value: 60, unit: "degree" }],
    entities: [
      { id: "origin", kind: "point", role: "common origin" },
      { id: "field_end", kind: "point", role: "field endpoint" },
      { id: "analyzer_end", kind: "point", role: "analyzer endpoint" },
      { id: "comparison_end", kind: "point", role: "comparison endpoint" },
      { id: "field", kind: "vector", role: "polarization direction", label: "E" },
      { id: "analyzer", kind: "vector", role: "analyzer axis" },
      { id: "comparison", kind: "vector", role: "comparison direction" },
      { id: "field_analyzer_angle", kind: "angle_mark", role: "field analyzer angle" },
      { id: "field_comparison_angle", kind: "angle_mark", role: "field comparison angle" },
      { id: "analyzer_label", kind: "label", role: "diagram label", label: "A" },
    ],
    constructions: [
      { id: "make_origin", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["origin"] },
      { id: "make_field_end", operator: "point", inputs: { x: 0, y: 4, coordinateSpace: "world" }, outputs: ["field_end"] },
      { id: "make_analyzer_end", operator: "point", inputs: { x: 2 * Math.sin(Math.PI / 3), y: 2 * Math.cos(Math.PI / 3), coordinateSpace: "world" }, outputs: ["analyzer_end"] },
      { id: "make_comparison_end", operator: "point", inputs: { x: Math.SQRT2, y: Math.SQRT2, coordinateSpace: "world" }, outputs: ["comparison_end"] },
      { id: "make_field", operator: "vector", inputs: { start: "origin", end: "field_end" }, outputs: ["field"] },
      { id: "make_analyzer", operator: "vector", inputs: { start: "origin", end: "analyzer_end" }, outputs: ["analyzer"] },
      { id: "make_comparison", operator: "vector", inputs: { start: "origin", end: "comparison_end" }, outputs: ["comparison"] },
      { id: "make_field_analyzer_angle", operator: "angle_mark", inputs: { vertex: "origin", a: "field", b: "analyzer", radius: 0.5 }, outputs: ["field_analyzer_angle"] },
      { id: "make_field_comparison_angle", operator: "angle_mark", inputs: { vertex: "origin", a: "field", b: "comparison", radius: 0.7 }, outputs: ["field_comparison_angle"] },
      { id: "make_analyzer_label", operator: "label", inputs: { target: "analyzer", text: "A" }, outputs: ["analyzer_label"] },
    ],
    relations: [],
    assertions: [
      { id: "field_label_attached", predicate: "label_attached", entities: ["field"], expected: true, severity: "fatal" },
      { id: "analyzer_label_attached", predicate: "label_attached", entities: ["analyzer_label", "analyzer"], expected: true, severity: "fatal" },
      { id: "analyzer_angle", predicate: "angle_between", entities: ["field", "analyzer"], expected: { value: 60, unit: "degree" }, tolerance: 0.000001, severity: "fatal" },
      { id: "angles_differ", predicate: "equal_angle", entities: ["field_analyzer_angle", "field_comparison_angle"], expected: false, tolerance: 0.000001, severity: "fatal" },
    ],
    annotations: [],
    requiredEntityIds: ["field", "analyzer", "comparison", "field_analyzer_angle", "field_comparison_angle", "analyzer_label"],
    revealGroups: [{ id: "setup", entityIds: ["field", "analyzer", "comparison", "field_analyzer_angle", "field_comparison_angle", "analyzer_label"], dependsOn: [], narrationCue: "Compare the field and analyzer directions." }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Draw and identify the two directions." }],
  };
}
