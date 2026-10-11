import assert from "node:assert/strict";
import type { SceneDocument, TurnPlanV3 } from "../../src/index";
import { validateProductionSceneCandidate, selectProductionScene } from "../../../../apps/tutor/features/tutor-session/lib/scene/productionSceneSelection";
import { sceneSaveAdmissionFailure } from "../../../../apps/tutor/lib/scene/sceneSaveAdmission";

const engine = process.argv.includes("--compiled-boundary") ? await import("../../dist/index.js") : await import("../../src/index");
const { compileSceneDocument, parseComplexDistanceExpression, validateComplexDistanceSourceInputs, validateSceneQuantityAgreement, validateTurnPlanV3 } = engine;

let checks = 0;
function check(actual: unknown, expected: unknown, reason: string): void { checks++; assert.deepEqual(actual, expected, reason); }
function fixture(expression = "z + (4 - 3i)", components: [unknown, unknown] = ["literalReal", "literalImaginary"], role = "distance reference point", literal: [number, number] = [4, -3]) {
  const question = `If |z| = 2, find the greatest and least values of |${expression}|. Show the distance reference on an Argand diagram.`;
  const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [
    { id: "radius", symbol: "|z|", value: 2, unit: "1", provenance: "given", sourceText: "|z| = 2" },
    { id: "literalReal", symbol: `Re(${literal[0]}${literal[1] < 0 ? "" : "+"}${literal[1]}i)`, value: literal[0], unit: "1", provenance: "given", sourceText: `Re(${literal[0]}${literal[1] < 0 ? "" : "+"}${literal[1]}i) = ${literal[0]}` },
    { id: "literalImaginary", symbol: `Im(${literal[0]}${literal[1] < 0 ? "" : "+"}${literal[1]}i)`, value: literal[1], unit: "1", provenance: "given", sourceText: `Im(${literal[0]}${literal[1] < 0 ? "" : "+"}${literal[1]}i) = ${literal[1]}` },
  ], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [] };
  const document: SceneDocument = { schemaVersion: "scene-document/v2", source: { question }, visualDecision: { mode: "scene", reason: "source numeric reference oracle" },
    quantities: plan.givens.map(({ id, symbol, value, unit }) => ({ id, symbol, value, unit })),
    entities: [ { id: "origin", kind: "point", role: "complex origin", label: "O" }, { id: "locus", kind: "circle", role: "locus", label: "locus" }, { id: "reference", kind: "point", role, label: "W", semantic: { complexDistanceExpression: `|${expression}|` } } ],
    constructions: [
      { id: "makeOrigin", operator: "complex_point", inputs: { real: 0, imaginary: 0, origin: [0, 0], displayScale: 1 }, outputs: ["origin"] },
      { id: "makeLocus", operator: "circle", inputs: { center: "origin", radius: "radius" }, outputs: ["locus"] },
      { id: "makeReference", operator: "complex_point", inputs: { real: components[0], imaginary: components[1], origin: [0, 0], displayScale: 1 }, outputs: ["reference"] },
    ], relations: [], assertions: [], annotations: [], requiredEntityIds: ["origin", "locus", "reference"], revealGroups: [{ id: "setup", entityIds: ["origin", "locus", "reference"], dependsOn: [], narrationCue: "Compare the locus and reference." }], teachingTimeline: [] };
  return { question, plan, document };
}
function candidate(row: ReturnType<typeof fixture>) {
  return validateProductionSceneCandidate({ candidate: row.document as unknown as Record<string, unknown>, question: row.question, turnPlan: row.plan });
}
const wrong = fixture();
check(validateTurnPlanV3(wrong.plan, wrong.question).valid, true, "literal Re(w)/Im(w) givens remain correct");
check(validateSceneQuantityAgreement(wrong.document.quantities, wrong.plan), [], "the scalar audit alone cannot prove the reference role");
check(compileSceneDocument(wrong.document).ok, true, "the wrong reference is still a valid computed literal complex point");
check(candidate(fixture("z - (4 - 3i)")).valid, true, "subtraction uses the unnegated point");
check(candidate(fixture("z + (4 - 3i)", [-4, 3])).valid, true, "addition uses the negated point");
check(candidate(fixture("z + (4 - 3i)", ["literalReal", "literalImaginary"], "literal complex constant w")).valid, true, "a correctly labelled literal w is not a false given");
check(candidate(wrong).valid, false, "RED: +w cannot be admitted as the distance reference for |z+w|");
check(sceneSaveAdmissionFailure({ document: wrong.document, question: wrong.question, turnPlan: wrong.plan, tier: "question_representation" }) !== null, true, "shared save admission rejects the wrong reference");
check(Boolean(selectProductionScene({ question: wrong.question, turnPlan: wrong.plan, problemIR: null, candidate: wrong.document as unknown as Record<string, unknown>, requiredRetryEnabled: false, policy: { preferPlanner: true, allowedFigureSources: ["planner"] } }).representation), false, "the wrong reference never reaches the canvas");
const beforeAudit = JSON.stringify(wrong.document);
validateComplexDistanceSourceInputs(wrong.document, wrong.question);
check(JSON.stringify(wrong.document), beforeAudit, "source authority declines but never repairs or invents geometry");

function sourceAccepted(row: ReturnType<typeof fixture>, reason: string): void {
  check(validateComplexDistanceSourceInputs(row.document, row.question), [], reason);
}
function sourceRejected(row: ReturnType<typeof fixture>, reason: string, code?: string): void {
  const issues = validateComplexDistanceSourceInputs(row.document, row.question);
  check(issues.some((issue) => issue.severity === "fatal" && (!code || issue.code === code)), true, reason);
}
for (const [expression, real, imaginary] of [
  ["|z+(4-3i)|", -4, 3], ["|z-(4-3i)|", 4, -3], ["|z+6−8i|", -6, 8],
  ["|z-3-4i|", 3, 4], ["|z+7i|", 0, -7], ["|z-i|", 0, 1], ["|z+4|", -4, 0],
  ["|z+1/2-3i/4|", -0.5, 0.75], ["|z-(1.5+3/4i)|", 1.5, 0.75],
  ["|q+(.25-i/2)|", -0.25, 0.5], ["\\left|z + (2.5 - 1.25i)\\right|", -2.5, 1.25],
  ["|z|", 0, 0], ["|z+1e-12i|", 0, -1e-12],
] as const) {
  check(parseComplexDistanceExpression(expression)?.reference, { real, imaginary }, `complete affine modulus ${expression}`);
}
for (const expression of [
  "|2z+4-3i|", "|z*(4-3i)|", "|z+4-3i+w|", "|z+4-3ijunk|", "|z+sqrt(4)-3i|",
  "|z^2+4-3i|", "|z+(4-3i)|junk", "prefix|z+4-3i|", "|z+4-3i", "||z+4||",
  "|z+4-3i cm|", "|z+4/0|", "|z+NaN|", "|z+Infinity|", "|z+1e-999i|", "|z+1e-13i|",
  "|z+1e13|", "|z+1000000000000.000001|", "|z+0.00000000000099999999999999999|", "|z+z-z|", `|z+${"(".repeat(20)}4${")".repeat(20)}|`, "|z+4-3i;5|", "|z+(4-3i)x|",
]) check(parseComplexDistanceExpression(expression), null, "unsupported syntax is never partially parsed");
const precisionExpressions: Array<[string, number | null]> = [
  ["|z+(100000000000+0.000000000001)-100000000000|", -1e-12],
  ["|z+(0.000000000001+100000000000)-100000000000|", -1e-12],
  ["|z+(100000000000-0.000000000001)-100000000000|", 1e-12],
  ["|z+100000000000-(100000000000-0.000000000001)|", -1e-12],
  ["|z+100000000000+0.000000000001-100000000000|", -1e-12],
  ["|z+(0.1+0.2)|", -0.3],
  ["|z+999999999999.000001-999999999999|", -1e-6],
  ["|z+1/3-0.3333333333333333|", null],
];
const precisionRows = precisionExpressions.map(([expression, expected]) => {
  const row = fixture(expression.slice(1, -1), [0, 0]);
  row.plan.givens = row.plan.givens.filter((quantity) => quantity.id === "radius");
  row.document.quantities = row.document.quantities.filter((quantity) => quantity.id === "radius");
  return { expression, expected, row, compiled: compileSceneDocument(row.document), validation: candidate(row), save: sceneSaveAdmissionFailure({ document: row.document, question: row.question, turnPlan: row.plan, tier: "question_representation" }) };
});
if (process.argv.includes("--observe-vector-boundary")) console.log(JSON.stringify({ precisionBoundary: precisionRows.map(({ expression, row, compiled, validation, save }, index) => ({ alias: `precision-${index + 1}`, parsedReference: parseComplexDistanceExpression(expression)?.reference ?? null, compileOk: compiled.ok, candidateValid: validation.valid, sharedSaveAccepted: save === null, sourceCodes: validateComplexDistanceSourceInputs(row.document, row.question).map((issue) => issue.code) })) }));
for (const { expression, expected, row, compiled, validation, save } of precisionRows) {
  check(compiled.ok, true, "a zero complex reference fully compiles; source refusal must not depend on a separate render gate");
  check(parseComplexDistanceExpression(expression)?.reference ?? null, expected === null ? null : { real: expected, imaginary: 0 }, "RED: exact decimal/fraction arithmetic must preserve the source offset or decline below-bound remainders, never round it to zero");
  sourceRejected(row, "a zero reference cannot satisfy a nonzero or unsupported exact source offset");
  check(validation.valid, false, "precision-losing zero-reference figure is refused by actual candidate validation");
  check(save !== null, true, "precision-losing zero-reference figure is refused by shared save admission");
}
for (const expression of ["|z+(100000000000-100000000000)+0.000000000001|", "|z+0.000000000001+(100000000000-100000000000)|", "|z+(0.000000000001-0.000000000001)|"]) {
  const expected = expression.endsWith("001)|") ? 0 : -1e-12;
  check(parseComplexDistanceExpression(expression)?.reference, { real: expected, imaginary: 0 }, "honest exact cancellation and direct tiny offsets remain supported");
}

// Owner-permitted Request44 oracle; true literal w and O→w remain valid.
const original = fixture("z + 6 - 8i", ["literalReal", "literalImaginary"], "distance reference point", [6, -8]);
original.question = "If |z| = 2, find the greatest and least values of |z + 6 − 8i| and the values of z at which they occur.";
original.plan.question = original.question;
original.document.source.question = original.question;
sourceRejected(original, "original numeric sign inversion is rejected only in an explicit reference role", "complex_distance_reference_mismatch");
check([-6, 8], parseComplexDistanceExpression("|z+6-8i|") && Object.values(parseComplexDistanceExpression("|z+6-8i|")!.reference), "independent Request44 reference oracle");
for (const [point, expected] of [[[6 / 5, -8 / 5], 12], [[-6 / 5, 8 / 5], 8]] as const) {
  check(Math.hypot(point[0], point[1]), 2, "independent literal extrema stay on the given modulus-2 locus");
  check(Math.hypot(point[0] + 6, point[1] - 8), expected, "independent literal requested-modulus extrema oracle, not a new solver claim");
}
const originalLiteral = structuredClone(original);
originalLiteral.document.entities[2]!.role = "given complex number";
originalLiteral.document.entities[2]!.label = "6−8i";
originalLiteral.document.entities.push({ id: "Ow", kind: "vector", role: "direction of 6−8i" });
originalLiteral.document.constructions.push({ id: "makeOw", operator: "vector", inputs: { start: "origin", end: "reference" }, outputs: ["Ow"] });
originalLiteral.document.requiredEntityIds.push("Ow");
originalLiteral.document.revealGroups[0]!.entityIds.push("Ow");
sourceAccepted(originalLiteral, "original-shaped literal-only +w/O→w scene is not a numerical contradiction");
check(candidate(originalLiteral).valid, true, "true original literal quantities and geometry stay admitted; relevance is not this guard");

const both = fixture("z + (4 - 3i)", [-4, 3]);
both.document.entities.push({ id: "literal", kind: "point", role: "literal complex constant w", label: "w" });
both.document.constructions.push({ id: "makeLiteral", operator: "complex_point", inputs: { real: "literalReal", imaginary: "literalImaginary", displayScale: 1 }, outputs: ["literal"] });
both.document.requiredEntityIds.push("literal");
both.document.revealGroups[0]!.entityIds.push("literal");
sourceAccepted(both, "literal w and a separate correct −w reference may coexist");
check(candidate(both).valid, true, "both correct roles survive actual candidate admission");

const transform = structuredClone(both);
transform.document.constructions[2] = { id: "makeReference", operator: "complex_transform", inputs: { source: "literal", multiplier: { real: -1, imaginary: 0 }, addend: { real: 0, imaginary: 0 }, origin: [19, -31], displayScale: 7 }, outputs: ["reference"] };
sourceAccepted(transform, "computed transform components, not translated/scaled screen coordinates, are checked");
transform.document.constructions[2]!.inputs.multiplier = { real: 1, imaginary: 0 };
sourceRejected(transform, "a transform producing +w still cannot supply −w", "complex_distance_reference_mismatch");

const world = fixture("z + (4 - 3i)", [-4, 3]);
world.document.constructions[2] = { id: "makeReference", operator: "point", inputs: { x: -4, y: 3, coordinateSpace: "world" }, outputs: ["reference"] };
sourceAccepted(world, "explicit world-coordinate reference is supported");
world.document.constructions[2]!.inputs.coordinateSpace = "canvas";
sourceRejected(world, "raw canvas pixels never become complex mathematical components", "complex_distance_input_unsupported");

function distanceFixture(valid: boolean, worldEndpoints = false) {
  const row = fixture("z + (4 - 3i)", valid ? [-4, 3] : [4, -3], "literal complex constant w");
  row.document.entities.push({ id: "variable", kind: "point", role: "complex variable z", label: "z" }, { id: "distance", kind: "segment", role: "source modulus distance", label: "|z+(4-3i)|" });
  row.document.constructions.push({ id: "makeVariable", operator: "complex_point", inputs: { real: 2, imaginary: 0, displayScale: 1 }, outputs: ["variable"] }, { id: "makeDistance", operator: "segment", inputs: { start: "variable", end: "reference" }, outputs: ["distance"] });
  row.document.requiredEntityIds.push("variable", "distance");
  row.document.revealGroups[0]!.entityIds.push("variable", "distance");
  if (worldEndpoints) {
    row.document.constructions[2] = { id: "makeReference", operator: "point", inputs: { x: valid ? -4 : 4, y: valid ? 3 : -3, coordinateSpace: "world" }, outputs: ["reference"] };
    row.document.constructions[3] = { id: "makeVariable", operator: "point", inputs: { x: 2, y: 0, coordinateSpace: "world" }, outputs: ["variable"] };
  }
  return row;
}
sourceAccepted(distanceFixture(true), "a complete source-labelled distance with a named z endpoint binds −w");
sourceRejected(distanceFixture(false), "a wrong +w endpoint contradicts the explicitly labelled source distance", "complex_distance_reference_mismatch");
check(candidate(distanceFixture(false)).valid, false, "explicitly wrong source-distance endpoints are rejected by production");
function zeroDistanceFixture(operator = "segment", variableFrame = { origin: [0, 0], displayScale: 1 }, referenceFrame = variableFrame) {
  const row = distanceFixture(true);
  row.question = "For |z| = 2, show the distance |z| on an Argand diagram.";
  row.plan.question = row.question;
  row.document.source.question = row.question;
  row.plan.givens = row.plan.givens.filter((quantity) => quantity.id === "radius");
  row.document.quantities = row.document.quantities.filter((quantity) => quantity.id === "radius");
  row.document.entities.at(-1)!.kind = operator;
  row.document.entities.at(-1)!.label = "|z|";
  row.document.constructions.at(-1)!.operator = operator;
  row.document.constructions[2]!.inputs = { real: 0, imaginary: 0, ...referenceFrame };
  row.document.constructions[3]!.inputs = { real: 2, imaginary: 0, ...variableFrame };
  return row;
}
const frameBoundaryRows = [
  { variableFrame: { origin: [0, 0], displayScale: 1 }, referenceFrame: { origin: [10, 0], displayScale: 1 } },
  { variableFrame: { origin: [0, 0], displayScale: 1 }, referenceFrame: { origin: [0, 0], displayScale: 3 } },
  { variableFrame: { origin: [1e11, 0], displayScale: 1 }, referenceFrame: { origin: [1e11 + 0.001, 0], displayScale: 1 } },
].flatMap(({ variableFrame, referenceFrame }) => ["segment", "vector", "dimension"].map((operator) => {
  const row = zeroDistanceFixture(operator, variableFrame, referenceFrame);
  const compiled = compileSceneDocument(row.document);
  const validation = candidate(row);
  const save = sceneSaveAdmissionFailure({ document: row.document, question: row.question, turnPlan: row.plan, tier: "question_representation" });
  return { row, compiled, validation, save };
}));
if (process.argv.includes("--observe-vector-boundary")) console.log(JSON.stringify({ mixedFrameBoundary: frameBoundaryRows.map(({ row, compiled, validation, save }) => ({ operator: row.document.constructions.at(-1)!.operator, compileOk: compiled.ok, compileCodes: compiled.report.issues.map((issue) => issue.code), candidateValid: validation.valid, sharedSaveAccepted: save === null, sourceCodes: validateComplexDistanceSourceInputs(row.document, row.question).map((issue) => issue.code) })) }));
for (const { row, compiled, validation, save } of frameBoundaryRows) {
  check(compiled.ok, row.document.constructions.at(-1)!.operator !== "dimension", "segment/vector |z| witnesses actually compile; dimensions already have an independent scaled-source measurement ban");
  sourceRejected(row, "RED: source-distance endpoints must share a computed display frame", "complex_distance_input_unsupported");
  check(validation.valid, false, "mixed-frame distance is refused by actual production validation");
  check(save !== null, true, "mixed-frame distance is refused by shared save admission");
}
for (const operator of ["segment", "vector", "dimension"]) for (const frame of [{ origin: [0, 0], displayScale: 1 }, { origin: [10, -7], displayScale: 3 }, { origin: [1e11, 0], displayScale: 1 }]) {
  const row = zeroDistanceFixture(operator, frame);
  check(compileSceneDocument(row.document).ok, operator !== "dimension", "aligned segment/vector distance compiles; dimensions retain their independent complex-source measurement ban");
  sourceAccepted(row, "aligned source-distance endpoints remain valid after frame safety check");
  check(candidate(row).valid, operator !== "dimension", "aligned endpoint-only segment/vector stays production-admissible without weakening dimension validation");
  check(sceneSaveAdmissionFailure({ document: row.document, question: row.question, turnPlan: row.plan, tier: "question_representation" }), null, "aligned endpoint-only frame passes shared source admission without claiming compilation for dimensions");
}
for (const operator of ["segment", "vector", "dimension"]) {
  const row = distanceFixture(false);
  row.document.constructions.at(-1)!.operator = operator;
  sourceRejected(row, "all supported explicit endpoint producers enforce the same reference");
}
const vectorOverrideRows = [{ direction: [1, 0] }, { direction: [-6, 3], length: 1 }, { length: 1 }].map((override) => {
  const row = distanceFixture(true, true);
  row.document.entities.at(-1)!.kind = "vector";
  row.document.constructions.at(-1)!.operator = "vector";
  Object.assign(row.document.constructions.at(-1)!.inputs, override);
  const overriddenCompile = compileSceneDocument(row.document);
  const validation = candidate(row);
  const save = sceneSaveAdmissionFailure({ document: row.document, question: row.question, turnPlan: row.plan, tier: "question_representation" });
  return { row, overriddenCompile, validation, save };
});
const zeroOverride = zeroDistanceFixture("vector");
Object.assign(zeroOverride.document.constructions.at(-1)!.inputs, { direction: [1, 0], length: 1 });
vectorOverrideRows.push({ row: zeroOverride, overriddenCompile: compileSceneDocument(zeroOverride.document), validation: candidate(zeroOverride), save: sceneSaveAdmissionFailure({ document: zeroOverride.document, question: zeroOverride.question, turnPlan: zeroOverride.plan, tier: "question_representation" }) });
if (process.argv.includes("--observe-vector-boundary")) console.log(JSON.stringify({ vectorBoundary: vectorOverrideRows.map(({ row, overriddenCompile, validation, save }) => ({ inputs: Object.keys(row.document.constructions.at(-1)!.inputs), compileOk: overriddenCompile.ok, compileCodes: overriddenCompile.report.issues.map((issue) => issue.code), candidateValid: validation.valid, candidateCodes: validation.errors.map((issue) => issue.code), sharedSaveAccepted: save === null, sourceCodes: validateComplexDistanceSourceInputs(row.document, row.question).map((issue) => issue.code) })) }));
for (const { row, validation, save } of vectorOverrideRows) {
  sourceRejected(row, "source-labelled vectors have an endpoint-only contract", "complex_distance_input_unsupported");
  check(validation.valid, false, "overridden source-distance vector is refused by production candidate validation");
  check(save !== null, true, "overridden source-distance vector is refused by shared save admission");
}
for (const operator of ["segment", "vector", "dimension"]) {
  const row = distanceFixture(true, true);
  row.document.entities.at(-1)!.kind = operator;
  row.document.constructions.at(-1)!.operator = operator;
  sourceAccepted(row, "ordinary endpoint-only distances remain supported for every owned operator");
  check(candidate(row).valid, true, "endpoint-only distance survives actual candidate validation");
  check(sceneSaveAdmissionFailure({ document: row.document, question: row.question, turnPlan: row.plan, tier: "question_representation" }), null, "endpoint-only distance survives shared save admission");
}
const unnamed = distanceFixture(true);
unnamed.document.entities.find((entity) => entity.id === "variable")!.label = "P";
unnamed.document.entities.find((entity) => entity.id === "variable")!.role = "point";
sourceRejected(unnamed, "unidentified variable endpoints are never guessed", "complex_distance_input_unsupported");

const ambiguous = fixture("z+(4-3i)", [-4, 3]);
delete ambiguous.document.entities[2]!.semantic;
ambiguous.question += " Also compare |z-(4-3i)|.";
sourceRejected(ambiguous, "an unbound reference cannot choose among distinct distances", "complex_distance_source_ambiguous");
ambiguous.document.entities[2]!.semantic = { complexDistanceExpression: "|z+(4-3i)|" };
sourceAccepted(ambiguous, "explicit source expression resolves a multiple-distance source");
ambiguous.document.entities[2]!.role = "distance reference for |z-(4-3i)|";
sourceRejected(ambiguous, "conflicting semantic and role bindings never override one another", "complex_distance_source_binding_unsupported");
ambiguous.document.entities[2]!.semantic = { complexDistanceExpression: "|z-(4-3i)|" };
sourceRejected(ambiguous, "minus signs inside role expressions are preserved", "complex_distance_reference_mismatch");
const forgedBinding = fixture("z+1e11", [-1e11, 0]);
forgedBinding.document.entities[2]!.semantic = { complexDistanceExpression: "|z+100000000000.001|" };
sourceRejected(forgedBinding, "RED: numerical comparison tolerance cannot authorize a different explicit source expression", "complex_distance_source_binding_unsupported");
const distinctSources = fixture("z+1e11", [-1e11, 0]);
delete distinctSources.document.entities[2]!.semantic;
distinctSources.question = "Compare |z+1e11| and |z+100000000000.001|.";
sourceRejected(distinctSources, "RED: distinct source references cannot collapse under a relative-tolerance join", "complex_distance_source_ambiguous");
const equivalentSource = fixture("z+0.5", [-0.5, 0]);
equivalentSource.document.entities[2]!.semantic = { complexDistanceExpression: "|z+1/2|" };
sourceAccepted(equivalentSource, "equivalent decimal/fraction forms with identical retained source values remain bound");
for (const suffix of [" Also compare |z+w|.", " Also compare |z+4-3ijunk|.", " Also compare |z+4-3i."]) {
  const row = fixture("z+(4-3i)", [-4, 3]); delete row.document.entities[2]!.semantic; row.question += suffix;
  sourceRejected(row, "unsupported or unterminated source math cannot be silently discarded");
}
const spoof = structuredClone(wrong);
spoof.document.source.question = spoof.question.replace("z +", "z -");
check(candidate(spoof).valid, false, "candidate uses real question rather than a sign-spoofed scene.source");
check(sceneSaveAdmissionFailure({ document: spoof.document, question: spoof.question, turnPlan: spoof.plan, tier: "question_representation" }) !== null, true, "save admission uses the trusted question even with spoofed source");
const compiledSpoof = compileSceneDocument(spoof.document);
check(compiledSpoof.ok, true, "the final-admission mutation is not masked by numeric compilation");
const prevalidated = selectProductionScene({ question: wrong.question, turnPlan: wrong.plan, problemIR: null, candidateValidation: { valid: true, errors: [], value: { document: wrong.document, renderScene: compiledSpoof.renderScene!, report: compiledSpoof.report } }, requiredRetryEnabled: false, policy: { preferPlanner: true, allowedFigureSources: ["planner"] } });
check(Boolean(prevalidated.representation), false, "cached/prevalidated candidates cannot bypass final save admission");
check(prevalidated.saveFailure?.includes("complex_distance_reference_mismatch"), true, "final selection records the source-reference rejection");
const fastSpoof = selectProductionScene({ question: spoof.question, turnPlan: spoof.plan, problemIR: null, fastRepresentation: { sceneDocument: spoof.document, renderScene: compiledSpoof.renderScene!, validationReport: compiledSpoof.report, tier: "question_representation", nonMetric: true, figureSource: "planner", reason: "frozen precompiled source-admission mutation" }, requiredRetryEnabled: false });
check(Boolean(fastSpoof.representation), false, "fast/fallback admission cannot trust spoofed source question metadata");
check(fastSpoof.saveFailure?.includes("complex_distance_reference_mismatch"), true, "trusted final-admission rejection is exercised on the fast representation path");
check(sceneSaveAdmissionFailure({ document: wrong.document, question: wrong.question, turnPlan: null, tier: "question_representation" }) !== null, true, "source authority does not depend on planner claims being present");

for (const mutate of [
  (row: ReturnType<typeof fixture>) => { row.document.constructions[2]!.inputs.real = "1e-999"; },
  (row: ReturnType<typeof fixture>) => { row.document.constructions[2]!.inputs.real = Infinity; },
  (row: ReturnType<typeof fixture>) => { row.document.quantities[1]!.unit = "cm"; row.document.constructions[2]!.inputs.real = "literalReal"; },
  (row: ReturnType<typeof fixture>) => { row.document.quantities.push({ id: "literalReal", value: -4, unit: "1" }); },
  (row: ReturnType<typeof fixture>) => { row.document.constructions[2] = { id: "cyclic", operator: "complex_transform", inputs: { source: "reference", multiplier: { real: -1, imaginary: 0 }, addend: { real: 0, imaginary: 0 }, displayScale: 1 }, outputs: ["reference"] }; },
  (row: ReturnType<typeof fixture>) => { row.document.constructions[2]!.inputs.real = { value: -4, unit: "m" }; },
]) { const row = fixture("z+(4-3i)", [-4, 3]); mutate(row); sourceRejected(row, "nonfinite/underflow/unit/cyclic/ambiguous component authority is unproved", "complex_distance_input_unsupported"); }
let getterReads = 0;
const accessor = fixture("z+(4-3i)", [-4, 3]);
accessor.document.constructions[2]!.inputs.real = Object.defineProperty({}, "value", { enumerable: true, get() { getterReads++; return -4; } });
sourceRejected(accessor, "getter-based component wrappers are rejected without executing them", "complex_distance_input_unsupported");
check(getterReads, 0, "the source guard does not evaluate getters");
const tiny = fixture("z+1e-12i", [0, 0]);
sourceRejected(tiny, "no absolute tolerance floor can turn a tiny signed reference into zero", "complex_distance_reference_mismatch");
const zero = fixture("z+(4-3i)", [0, 0]);
zero.document.entities[2]!.semantic = { complexDistanceExpression: "|z|" };
sourceAccepted(zero, "explicit zero-reference |z| binding is valid alongside a displaced modulus");
delete zero.document.entities[2]!.semantic;
sourceRejected(zero, "unbound zero-versus-displaced reference is ambiguous, not a guessed contradiction", "complex_distance_source_ambiguous");
const translatedLocus = fixture("z-3-4i", [3, 4]);
translatedLocus.question = "For |z-3-4i|=2, find the least and greatest values of |z|.";
sourceAccepted(translatedLocus, "the source-subtraction reference of a displaced locus remains +3+4i");
const mixedLocus = fixture("z+4", [-4, 0]);
mixedLocus.question = "For |z-3i|≤2, find the greatest and least values of |z+4|.";
sourceAccepted(mixedLocus, "a positive real literal in the objective still has the explicit negative-real distance reference");
const unrelated = fixture("z+(4-3i)", [4, -3], "reference point");
unrelated.question = "Show a world-coordinate reference point for a circuit.";
sourceAccepted(unrelated, "an unrelated generic reference role is not a complex-distance assertion or topic route");
const textOnly = structuredClone(wrong); textOnly.document.visualDecision.mode = "text_only";
sourceAccepted(textOnly, "no numeric geometry is asserted in text-only mode");

// Held-out synthetic constants are oracles, not accepted topic counts.
for (let index = 1; index <= 96; index++) {
  const real = index % 17 - 8;
  const imaginary = index % 13 - 6;
  const offset = `${real}${imaginary < 0 ? "" : "+"}${imaginary}i`;
  for (const sign of ["+", "-"]) {
    const factor = sign === "+" ? -1 : 1;
    const row = fixture(`z${sign}(${offset})`, [factor * real, factor * imaginary]);
    sourceAccepted(row, "held-out addition/subtraction reference agrees by mathematical role");
    row.document.constructions[2]!.inputs.real = factor * real + 0.25;
    sourceRejected(row, "held-out wrong reference is rejected independently of scalar values", "complex_distance_reference_mismatch");
  }
}
console.log(JSON.stringify({ gate: "complex-distance-source", checks, compiledBoundary: process.argv.includes("--compiled-boundary"), spendUsd: 0, coverageClaim: false }));
