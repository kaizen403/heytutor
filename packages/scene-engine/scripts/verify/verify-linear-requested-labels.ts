import assert from "node:assert/strict";
import { buildLinearSourceDocument, compileSceneDocument } from "../../src/index";
import { parseLinearConstraint, linearConstraintSignature, type ExactPoint } from "../../src/math/linearRegion";
import { addRational, multiplyRational, compareRational, deserializeRational, exactRationalText } from "../../src/math/exactRational";

let checks = 0;
const compiled = (question: string) => {
  const document = buildLinearSourceDocument(question);
  assert.ok(document, `Complete original named system should be admitted: ${question}`);
  const result = compileSceneDocument(document);
  assert.ok(result.ok && result.renderScene, JSON.stringify(result.report.issues));
  checks += 2;
  return { document, scene: result.renderScene };
};
type Scene = ReturnType<typeof compiled>["scene"];
const exactPoints = (primitive: Scene["primitives"][number]): ExactPoint[] => primitive.provenance!.worldPoints as ExactPoint[];
const key = (point: ExactPoint): string => `(${exactRationalText(point.x)}, ${exactRationalText(point.y)})`;
const signature = (equation: string): string => JSON.stringify(parseLinearConstraint(equation, ["x", "y"], true).map(linearConstraintSignature).sort());
const line = (scene: Scene, name: string, equation: string) => {
  const mark = scene.primitives.find(primitive => primitive.kind === "label" && primitive.provenance?.linearRole === "boundary_name"
    && Array.isArray(primitive.provenance.linearSourceNames) && primitive.provenance.linearSourceNames.includes(name));
  assert.ok(mark, `Requested source line ${name} must survive beside its verified boundary`);
  const row = parseLinearConstraint(equation, ["x", "y"], true)[0]!;
  for (const point of exactPoints(mark)) assert.equal(compareRational(addRational(multiplyRational(deserializeRational(row.a), deserializeRational(point.x)), multiplyRational(deserializeRational(row.b), deserializeRational(point.y))), deserializeRational(row.rhs)), 0,
    `${name} must remain attached to its own complete source equation`);
  const fact = scene.primitives.find(primitive => primitive.kind === "label" && primitive.text?.startsWith(`${name}: `));
  assert.ok(fact, `Source line ${name} retains its simplified equation`);
  assert.equal(signature(fact.text!.slice(name.length + 2)), signature(equation));
  assert.equal(mark.provenance?.fontPx, 19, "Requested names are checked at the live lettering floor");
  checks += 5;
};
const intercept = (scene: Scene, owner: string, axis: "x" | "y", tuple: string) => {
  const fact = scene.primitives.find(primitive => primitive.kind === "label" && primitive.text === `${owner} ${axis}-intercept=${tuple}`);
  assert.ok(fact, `Requested source intercept ${owner} ${axis} ${tuple} must survive in the live labels`);
  assert.equal(key(exactPoints(fact)[0]!), tuple, "The whole tuple stays bound to its actual exact intercept");
  assert.equal(fact.provenance?.linearInterceptAxis, axis);
  assert.ok(scene.primitives.some(primitive => primitive.kind === "point" && primitive.provenance?.linearRole === "source_intercept" && key(exactPoints(primitive)[0]!) === tuple), "The requested exact intercept has a verified mark");
  assert.equal(fact.provenance?.fontPx, 19);
  checks += 5;
};

const question = "In R^2, graph the simultaneous system L1: -2(2x - y) = -6 and L2: 6x - 3y = 12. Label both lines with their names and simplified equations, and label their intercepts. Use the graph to classify the system and state its full solution set.";
const { document, scene } = compiled(question);
line(scene, "L1", "-2(2x-y)=-6"); line(scene, "L2", "6x-3y=12");
intercept(scene, "L1", "x", "(3/2, 0)"); intercept(scene, "L1", "y", "(0, -3)");
intercept(scene, "L2", "x", "(2, 0)"); intercept(scene, "L2", "y", "(0, -4)");

const crossingQuestion = "In R^2, graph L1: x + y = 6 and L2: x - y = 2. The lines meet at P. Label both lines, P and their intercepts.";
const crossing = compiled(crossingQuestion);
line(crossing.scene, "L1", "x+y=6"); line(crossing.scene, "L2", "x-y=2");
intercept(crossing.scene, "L1", "x", "(6, 0)"); intercept(crossing.scene, "L1", "y", "(0, 6)");
intercept(crossing.scene, "L2", "x", "(2, 0)"); intercept(crossing.scene, "L2", "y", "(0, -2)");
const namedIntersection = crossing.scene.primitives.find(primitive => primitive.kind === "label" && primitive.text === "P");
assert.ok(namedIntersection, "The original intersection name must survive beside its exact mark");
assert.equal(key(exactPoints(namedIntersection)[0]!), "(4, 2)");
const intersectionFact = crossing.scene.primitives.find(primitive => primitive.text === "One solution: P=(4, 2)");
assert.ok(intersectionFact); assert.equal(key(exactPoints(intersectionFact)[0]!), "(4, 2)"); checks += 4;

const reordered = structuredClone(crossing.document);
reordered.constructions[0]!.inputs.equations = ["-3x+3y=-6", "2x+2y=12"];
const reorderedResult = compileSceneDocument(reordered);
assert.ok(reorderedResult.ok && reorderedResult.renderScene, JSON.stringify(reorderedResult.report.issues)); checks++;
line(reorderedResult.renderScene, "L1", "x+y=6"); line(reorderedResult.renderScene, "L2", "x-y=2");
intercept(reorderedResult.renderScene, "L1", "x", "(6, 0)"); intercept(reorderedResult.renderScene, "L2", "y", "(0, -2)");

const coincident = compiled("Graph L1: x+y=6 and L2: 2x+2y=12. Label both lines and their intercepts.");
assert.equal(coincident.scene.primitives.filter(primitive => primitive.provenance?.linearRole === "source_boundary").length, 1);
line(coincident.scene, "L1", "x+y=6"); line(coincident.scene, "L2", "2x+2y=12");
intercept(coincident.scene, "L1, L2", "x", "(6, 0)"); intercept(coincident.scene, "L1, L2", "y", "(0, 6)"); checks++;

const axes = compiled("Graph L1: x=2 and L2: y=3. Label both lines and their intercepts.");
intercept(axes.scene, "L1", "x", "(2, 0)"); intercept(axes.scene, "L2", "y", "(0, 3)");
assert.ok(axes.scene.primitives.some(primitive => primitive.text === "L1 y-intercept: none"));
assert.ok(axes.scene.primitives.some(primitive => primitive.text === "L2 x-intercept: none")); checks += 2;

const scoped = compiled("Graph L1: x+y=6 and L2: x-y=2. Label L1 intercepts.");
intercept(scoped.scene, "L1", "x", "(6, 0)"); intercept(scoped.scene, "L1", "y", "(0, 6)");
assert.ok(!scoped.scene.primitives.some(primitive => primitive.provenance?.linearInterceptAxis && Array.isArray(primitive.provenance.linearSourceNames) && primitive.provenance.linearSourceNames.includes("L2")), "A scoped request cannot borrow an unrelated line's intercepts"); checks++;
const suffixScoped = compiled("Graph L1: x+y=6 and L2: x-y=2. Label the intercepts of L1.");
intercept(suffixScoped.scene, "L1", "x", "(6, 0)"); intercept(suffixScoped.scene, "L1", "y", "(0, 6)");
assert.ok(!suffixScoped.scene.primitives.some(primitive => primitive.provenance?.linearInterceptAxis && Array.isArray(primitive.provenance.linearSourceNames) && primitive.provenance.linearSourceNames.includes("L2"))); checks++;
const bothScoped = compiled("Graph L1: x+y=6 and L2: x-y=2. Label both intercepts of L1.");
intercept(bothScoped.scene, "L1", "x", "(6, 0)"); intercept(bothScoped.scene, "L1", "y", "(0, 6)");
assert.ok(!bothScoped.scene.primitives.some(primitive => primitive.provenance?.linearInterceptAxis && Array.isArray(primitive.provenance.linearSourceNames) && primitive.provenance.linearSourceNames.includes("L2")), "Both axes of one named line do not request an unrelated line"); checks++;

const retainedCrossing = compiled("The lines 2x-y=5 and -3x+2y=-4 meet at P. Graph both lines, label P, and find its x-coordinate.");
assert.ok(retainedCrossing.scene.primitives.some(primitive => primitive.text === "P"));
assert.ok(retainedCrossing.scene.primitives.some(primitive => primitive.text === "One solution: P=(6, 7)")); checks += 2;
for (const question of [
  "Graph L1: x+y=6 and L1: x-y=2. Label both lines.",
  "Graph L1: x+y=6 and L2: x+y=2. The lines meet at P. Label P.",
]) {
  const document = buildLinearSourceDocument(question);
  assert.ok(document, "This control reaches the existing source-admission seam");
  const result = compileSceneDocument(document);
  assert.ok(!result.ok && result.renderScene === null, "Conflicting source name owners and nonexistent named intersections must be atomically refused"); checks += 2;
}

const clipped = structuredClone(crossing.document);
clipped.constructions[0]!.inputs.view = { xMin: -1, xMax: 5, yMin: -1, yMax: 5 };
const clippedResult = compileSceneDocument(clipped);
assert.ok(!clippedResult.ok && clippedResult.renderScene === null, "A view cannot silently drop requested exact intercepts"); checks++;
for (const [field, value] of [["names", ["Other", "P"]], ["intercepts", [[0, 99]]]] as const) {
  const forged = structuredClone(document);
  forged.constructions[0]!.inputs[field] = value;
  const refusal = compileSceneDocument(forged);
  assert.ok(!refusal.ok && refusal.renderScene === null, "Planner names and coordinates never supply source label authority"); checks++;
}
console.log(`verify-linear-requested-labels: ${checks} source names, exact anchors, requested intercepts and refusal checks passed`);
