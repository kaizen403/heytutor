import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { compileSceneDocument, isSupportedSceneOperator, pruneUnverifiedSceneAnnotations, type SceneConstruction, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { normalizeSceneDocumentModelOutput } from "@heytutor/tutor-core";
import { validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";

const question = "Draw the supplied source model and leave the unknown field, force and image distance for the narrated solution.";
const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [] };
function scene(constructions: SceneConstruction[], kinds: string[]): SceneDocument {
  const ids = constructions.flatMap((construction) => construction.outputs);
  return { schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "source model" }, source: { question }, quantities: [],
    entities: ids.map((id, index) => ({ id, kind: kinds[index]!, role: "source geometry" })), constructions,
    relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "g", entityIds: ids, dependsOn: [], narrationCue: "source model" }], teachingTimeline: [] };
}
const fixtures = [
  { name: "ring", target: "E", symbol: "E", unit: "N/C", correct: "E≈0.32 N/C", wrongUnit: "E=0.32 N", document: scene([
    { id: "o", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["O"] },
    { id: "f", operator: "space_frame", inputs: { origin: "O", axisLength: 2 }, outputs: ["frame"] },
    { id: "c", operator: "space_point", inputs: { frame: "frame", x: 0, y: 0, z: 0 }, outputs: ["center"] },
    { id: "r", operator: "charged_ring_axial_field", inputs: { frame: "frame", center: "center", radius: 3, charge: 2, axialDistance: 4, k: 5, displayLength: 0.5, units: { charge: "C", length: "m" } }, outputs: ["ring", "at", "E"] },
  ], ["point", "polyline", "point", "polyline", "point", "vector"]) },
  { name: "Coulomb", target: "F1", symbol: "F", unit: "N", correct: "F≈1 N", wrongUnit: "F=1 C", document: scene([
    { id: "pair", operator: "coulomb_pair", inputs: { charges: [{ position: [0, 0], charge: 1 }, { position: [1, 0], charge: 1 }], k: 1, displayLength: 0.5 }, outputs: ["F1", "F2"] },
  ], ["vector", "vector"]) },
  { name: "point charge", target: "E", symbol: "E", unit: "", correct: "E≈1", document: scene([
    { id: "field", operator: "point_charge_field", inputs: { charge: { position: [0, 0], charge: 1 }, at: [1, 0], k: 1, displayLength: 0.5 }, outputs: ["E"] },
  ], ["vector"]) },
  { name: "finite dipole", target: "E", symbol: "E", unit: "", correct: "E≈0.89", document: scene([
    { id: "field", operator: "dipole_field", inputs: { charges: [{ position: [-1, 0], charge: -1 }, { position: [1, 0], charge: 1 }], at: [2, 0], mode: "finite", k: 1, displayLength: 0.5 }, outputs: ["E"] },
  ], ["vector"]) },
  { name: "Gaussian image", target: "ib", symbol: "v", unit: "m", correct: "v=1.5 m", wrongUnit: "v=1.5 s", document: scene([
    { id: "image", operator: "gaussian_image", inputs: { kind: "lens", center: [0, 0], axis: [1, 0], objectDistance: -3, focalLength: 1, objectHeight: 1, displayScale: 1, lengthUnit: "m" }, outputs: ["ob", "ot", "ib", "it"] },
  ], ["point", "point", "point", "point"]) },
  { name: "optical focus", target: "F2", symbol: "f", unit: "m", correct: "f=1 m", wrongUnit: "f=1 s", document: scene([
    { id: "focus", operator: "optical_focus", inputs: { kind: "lens", center: [0, 0], axis: [1, 0], focalLength: 1, displayScale: 1, lengthUnit: "m" }, outputs: ["F1", "F2"] },
  ], ["point", "point"]) },
];
let checks = 0;
const failures: string[] = [];
const check = (value: unknown, message: string) => { checks++; if (!value) failures.push(message); };
const production = (document: SceneDocument) => validateProductionSceneCandidate({ candidate: normalizeSceneDocumentModelOutput(document as unknown as Record<string, unknown>, question), question, turnPlan: plan });
// The shared policy also runs on the parent PR before the separately stacked
// ring model exists. The ring PR's gate makes its presence mandatory.
const supportedFixtures = isSupportedSceneOperator("charged_ring_axial_field") ? fixtures : fixtures.slice(1);
for (const fixture of supportedFixtures) {
  const labeled = (label: string) => { const document = structuredClone(fixture.document); document.entities.find((entity) => entity.id === fixture.target)!.label = label; return document; };
  const positive = labeled(fixture.correct);
  check(production(positive).valid, `${fixture.name}: valid rounded/exact original claim survives production`);
  const wrong = labeled(`${fixture.symbol}=999${fixture.unit ? ` ${fixture.unit}` : ""}`);
  check(!compileSceneDocument(wrong).ok, `${fixture.name}: direct compile rejects false original claim`);
  check(pruneUnverifiedSceneAnnotations(wrong, plan) === wrong, `${fixture.name}: original false claim cannot be erased`);
  check(!production(wrong).valid, `${fixture.name}: production rejects false original claim`);
  const callout = structuredClone(fixture.document); callout.annotations = [{ id: "claim", kind: "callout", targetIds: [fixture.target], text: `${fixture.symbol}=999${fixture.unit ? ` ${fixture.unit}` : ""}` }];
  check(!production(callout).valid, `${fixture.name}: owned false numeric callout rejects`);
  const quantity = structuredClone(callout); quantity.quantities = [{ id: "claim_value", symbol: fixture.symbol, value: 999, ...(fixture.unit ? { unit: fixture.unit } : {}) }]; quantity.annotations[0]!.quantityId = "claim_value";
  check(pruneUnverifiedSceneAnnotations(quantity, plan) === quantity && !production(quantity).valid, `${fixture.name}: false quantity-linked callout checked before text removal`);
  const symbolic = structuredClone(wrong); symbolic.source = { ...symbolic.source, nonMetric: true, qualitative: true }; symbolic.quantities = [];
  check(!production(symbolic).valid, `${fixture.name}: symbolic source qualifier cannot hide a false numeric claim`);
  if (fixture.wrongUnit) check(!production(labeled(fixture.wrongUnit)).valid, `${fixture.name}: incompatible original claim unit rejects`);
}
const normal = scene([
  { id: "origin", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["O"] },
  { id: "normal", operator: "vector", inputs: { start: "O", direction: [0, 0, -1] }, outputs: ["I"] },
], ["point", "vector"]);
normal.entities[1]!.label = "I=999 A";
check(!compileSceneDocument(normal).ok && pruneUnverifiedSceneAnnotations(normal, plan) === normal && !production(normal).valid, "typed page-normal original numeric claim cannot be erased");
const symbolicNormal = structuredClone(normal); symbolicNormal.entities[1]!.label = "I";
check(production(symbolicNormal).valid, "typed page-normal symbolic name remains valid");
const generic = scene([{ id: "p", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["P"] }], ["point"]);
generic.entities[0]!.label = "I=2 A";
check(pruneUnverifiedSceneAnnotations(generic, plan).entities[0]!.label !== "I=2 A", "optional generic measured ink still prunes");
check(production(generic).valid, "generic optional cleanup still admits valid geometry");
const clean = structuredClone(generic); delete clean.entities[0]!.label;
check(pruneUnverifiedSceneAnnotations(clean, plan) === clean, "unchanged text takes the original identity fast path");
const bench = (operation: () => unknown): number => { for (let i = 0; i < 5; i++) operation(); const start = performance.now(); for (let i = 0; i < 40; i++) operation(); return (performance.now() - start) / 40; };
const benchmarkFixture = supportedFixtures[0]!;
const timed = structuredClone(benchmarkFixture.document); timed.entities.find((entity) => entity.id === benchmarkFixture.target)!.label = benchmarkFixture.correct;
console.log(JSON.stringify({ timingMsPerCandidate: { unchangedPrune: bench(() => pruneUnverifiedSceneAnnotations(benchmarkFixture.document, plan)), checkedPrune: bench(() => pruneUnverifiedSceneAnnotations(timed, plan)), fullCompile: bench(() => compileSceneDocument(timed)) } }));
assert.equal(failures.length, 0, failures.join("\n"));
console.log(`Original source claims: ${checks} actual-production checks passed`);
