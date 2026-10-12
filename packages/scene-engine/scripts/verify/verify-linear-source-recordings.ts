import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { compileSceneDocument, type SceneDocument } from "../../src/index";
import { buildLinearSourceDocument } from "../../src/compile/linearRegionSource";
import { readLinearSourceIntersectionNames } from "../../src/compile/linearSourcePoints";
import { evaluateLinearRegionConstruction, linearRegionPrimitives, type LinearRegionGeometry } from "../../src/compile/linearRegionGeometry";
import { parseLinearConstraint } from "../../src/math/linearRegion";
import { exactRationalText, deserializeRational, multiplyRational, addRational, compareRational, type ExactRational } from "../../src/math/exactRational";

interface SourceFixture {
  question: string;
  points: Array<{ label: string; x: string; y: string; included: boolean }>;
  corners?: [string, string][];
  cornerValues?: string[];
}
const fixtures: SourceFixture[] = JSON.parse(readFileSync(new URL("./fixtures/linear-source-admission.json", import.meta.url), "utf8"));
assert.equal(fixtures.length, 28);
let checks = 0;
const pointKey = (p: { x: ExactRational; y: ExactRational }): string => `${exactRationalText(p.x)},${exactRationalText(p.y)}`;
function sourceDocument(question: string): SceneDocument {
  const document = buildLinearSourceDocument(question);
  assert(document, `Complete supported original source refused: ${question}`); checks++;
  assert.equal(document.source.question, question); checks++;
  assert.equal(document.constructions.length, 1); checks++;
  assert.equal(document.annotations.length, 0); checks++;
  return document;
}
function assertCompiled(document: SceneDocument): ReturnType<typeof compileSceneDocument> & { renderScene: NonNullable<ReturnType<typeof compileSceneDocument>["renderScene"]> } {
  const compiled = compileSceneDocument(document);
  assert(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues)); checks++;
  assert(compiled.renderScene.primitives.some(p => p.kind === "label" && p.text?.trim())); checks++;
  return compiled as typeof compiled & { renderScene: NonNullable<typeof compiled.renderScene> };
}
for (const fixture of fixtures) {
  const document = sourceDocument(fixture.question), compiled = assertCompiled(document);
  const call = document.constructions[0]!;
  const geometry = evaluateLinearRegionConstruction(call.operator, call.inputs, fixture.question)[0]!;
  const raw = linearRegionPrimitives(geometry, call.outputs[0]!, "source_linear_setup");
  const marks = compiled.renderScene.primitives.filter(p => p.provenance?.linearRole === "source_reference_point");
  assert.equal(marks.length, fixture.points.length); checks++;
  for (const expected of fixture.points) {
    const mark = marks.find(p => (p.provenance?.linearSourcePoint as { label: string }).label === expected.label)!;
    assert(mark, `Missing original ${expected.label}`); checks++;
    assert.equal(pointKey((mark.provenance!.worldPoints as Array<{ x: ExactRational; y: ExactRational }>)[0]!), `${expected.x},${expected.y}`); checks++;
    assert.equal(mark.provenance!.linearMembership, expected.included); checks++;
    assert.equal(mark.provenance!.pointStyle, expected.included ? "filled" : "open"); checks++;
    const expectedText = geometry.solution.kind === "number_line_set" ? `${expected.label}=${expected.x}` : `${expected.label}=(${expected.x}, ${expected.y})`;
    assert(compiled.renderScene.primitives.some(p => p.kind === "label" && p.text?.includes(expectedText) && p.text.includes(expected.included ? "included" : "excluded"))); checks++;
  }
  // Every native equation label starts at an exact point on its own boundary.
  for (const label of raw.filter(p => p.provenance?.linearRole === "boundary_label")) {
    const anchor = (label.provenance!.worldPoints as Array<{ x: ExactRational; y: ExactRational }>)[0]!;
    for (const equation of label.text!.split("; ")) for (const row of parseLinearConstraint(equation, ["x", "y"], true)) {
      const lhs = addRational(multiplyRational(deserializeRational(row.a), deserializeRational(anchor.x)), multiplyRational(deserializeRational(row.b), deserializeRational(anchor.y)));
      assert.equal(compareRational(lhs, deserializeRational(row.rhs)), 0); checks++;
    }
  }
  if (fixture.corners) {
    assert.equal(geometry.solution.kind, "linear_feasible_region"); checks++;
    if (geometry.solution.kind !== "linear_feasible_region") throw new Error("Expected feasible region");
    assert.deepEqual(geometry.solution.closureVertices.map(corner => pointKey(corner.point)).sort(), fixture.corners.map(corner => corner.join(",")).sort()); checks++;
    assert.deepEqual(raw.filter(p => p.provenance?.linearRole === "closure_corner").map(p => pointKey((p.provenance!.worldPoints as Array<{ x: ExactRational; y: ExactRational }>)[0]!)).sort(), fixture.corners.map(corner => corner.join(",")).sort()); checks++;
    fixture.corners.forEach(([x, y], index) => {
      const tuple = `(${x}, ${y})`;
      assert(compiled.renderScene.primitives.some(p => p.kind === "label" && p.text?.includes(tuple)), `Corner tuple ${tuple} must remain visible when named`); checks++;
      assert(compiled.renderScene.primitives.some(p => p.kind === "label" && p.text?.includes(`${tuple}: ${fixture.cornerValues![index]}`)), `Exact objective value for ${tuple} must remain visible`); checks++;
    });
  }
  // Missing, moved or renamed original points cannot be hidden by short
  // plot names, captions, or named-corner duplicate substitution.
  if (fixture.points.length) for (const mutate of [
    (copy: LinearRegionGeometry) => { copy.referencePoints = []; },
    (copy: LinearRegionGeometry) => { copy.referencePoints![0]!.x = { numerator: "999", denominator: "1" }; },
    (copy: LinearRegionGeometry) => { copy.referencePoints![0]!.label = "invented"; },
  ]) {
    const copy = structuredClone(geometry); mutate(copy);
    assert.throws(() => linearRegionPrimitives(copy, call.outputs[0]!, "source_linear_setup"), /preserve every original/); checks++;
  }
  const changed = structuredClone(document), inputs = changed.constructions[0]!.inputs;
  if (call.operator === "number_line_set") inputs.expression = { inequality: "x>=999" };
  else if (call.operator === "linear_half_plane") inputs.inequality = "x>=999";
  else if (call.operator === "linear_system") inputs.equations = ["x=999", "y=999"];
  else inputs.constraints = ["x>=999", "y>=999"];
  const refused = compileSceneDocument(changed);
  assert(!refused.ok && refused.renderScene === null, "A readable label never permits different source geometry"); checks++;
}

// Independent near neighbors check that notation/prose recognition never
// masks mathematical conditions, coordinate order or actual domain limits.
for (const question of [
  "Graph x>=0 on a number line. The real x is not integer-valued.",
  "Graph x>=0 on a number line for integer x.",
  "Graph x>=0 on a number line for natural numbers x.",
  "In R^2, graph S={(y,x):2x-3y<6}.",
  "In R^2, graph S={(x,y):2x-3y<6}. Also x>=1.",
  "In R^2, graph S={(x,y):2x-3y<6+x*y}.",
  "In R^2, graph y<1. There is no constraint on x. Also x>=2.",
  "In R^2, graph x>=3. There is no constraint on y. Also y<2.",
  "Graph x+2y<=6 with strict boundary exclusion.",
  "For real x, let I={x:x>=1} and J={x:x<4}. Draw K=I intersect Unknown on a number line.",
  "For real x, let I={y:y>=1} and J={x:x<4}. Draw K=I intersect J on a number line.",
  "For real x, let I={x:x>=1} and J={x:x<4}. Draw K=I minus J on a number line. Here I minus J means x is in I AND x is in J.",
  "For real x, let I={x:x>=1} and J={x:x<4}. Draw K=I intersect J on a number line. Also x<=2.",
  "Minimize C=6x+4y subject to x>=0,y>=0,x+y<=5, and C+1 at every corner.",
  "Graph x<=2 on a number line. Mark P=1+x.",
  "Graph x<=2 on a number line. Mark P=sin(1).",
]) {
  assert.equal(buildLinearSourceDocument(question), null, `Unsafe source normalization: ${question}`); checks++;
}
for (const question of [
  "In R^2, graph S={(x,y):2x-3y<6} and x>=1.",
  "Minimize C=6x+4y subject to real x,y>=0, x+y<=5, and C at every corner. The domain is continuous, not integer-valued.",
  "Graph 2x-3y<6. Label the equivalent integer-coefficient boundary equation.",
]) assertCompiled(sourceDocument(question));
const complete = sourceDocument("In R^2, graph S={(x,y):2x-3y<6} and x>=1.");
const dropped = structuredClone(complete); dropped.constructions[0]!.inputs.constraints = ["2x-3y<6"];
assert.equal(compileSceneDocument(dropped).ok, false); checks++;
const strict = sourceDocument("Graph 2x-3y<6.");
strict.constructions[0]!.inputs.inequality = "2x-3y<=6";
assert.equal(compileSceneDocument(strict).ok, false); checks++;
assert(readLinearSourceIntersectionNames("Label the exact intersection P.").has("P")); checks++;
for (const text of ["Label the exact intersection coordinates.", "Label the exact intersection P+1.", "Label the exact intersection P squared."] ) {
  assert.equal(readLinearSourceIntersectionNames(text).size, 0); checks++;
}

// Optional nonpaid audit of immutable full stems. The committed gate above
// needs no private packet, planner response, network access or generated image.
const diagnosticPath = process.argv.find(arg => arg.startsWith("--diagnostics="))?.slice("--diagnostics=".length);
let recorded = 0;
if (diagnosticPath) {
  const rows = readFileSync(diagnosticPath, "utf8").trim().split("\n").map(line => JSON.parse(line))
    .filter(row => row.arm === "candidate" && row.diagram.reason === "representation carries no readable label");
  assert.equal(rows.length, 40);
  for (const row of rows) {
    const text = readFileSync(row.runPath, "utf8");
    assert.equal(createHash("sha256").update(text).digest("hex"), row.runSha256); checks++;
    assertCompiled(sourceDocument(JSON.parse(text).question)); recorded++;
  }
}
console.log(`linear complete-source admission: ${checks} checks, ${fixtures.length} portable original stems, ${recorded} hash-verified recorded stems`);
