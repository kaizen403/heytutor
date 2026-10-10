import { compileSceneDocument } from "../../src/compile/compiler";
import { parsePlaneEquation, readPlaneSourceStatement } from "../../src/ir/planeSource";
import type { SceneDocument } from "../../src/types";

let checks = 0;
function check(condition: unknown, message: string): asserts condition { checks += 1; if (!condition) throw new Error(message); }

type Plane = { id: string; inputs: Record<string, unknown>; label?: string };
function scene(question: string | undefined, planes: Plane[], quantities: Array<{ id: string; value: number }> = [], extra: Partial<SceneDocument> = {}): SceneDocument {
  const constructions = [
    { id: "make-origin", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["O"] },
    { id: "make-frame", operator: "space_frame", inputs: { origin: "O", scale: 2 }, outputs: ["frame"] },
    { id: "make-P", operator: "space_point", inputs: { frame: "frame", x: 1, y: 0, z: 0 }, outputs: ["P"] },
    ...planes.map((plane) => ({ id: `make-${plane.id}`, operator: "plane", inputs: { frame: "frame", ...plane.inputs }, outputs: [plane.id] })),
  ];
  const ids = constructions.flatMap((construction) => construction.outputs);
  const labels = new Map(planes.map((plane) => [plane.id, plane.label]));
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "plane source binding" },
    source: question === undefined ? {} : { question },
    quantities,
    entities: ids.map((id) => ({
      id,
      kind: id === "frame" ? "polyline" : id === "O" || id === "P" ? "point" : "polygon",
      role: "world geometry",
      ...(labels.get(id) ? { label: labels.get(id) } : {}),
    })),
    constructions,
    relations: [],
    assertions: [],
    annotations: [],
    requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "show the planes" }],
    teachingTimeline: [],
    ...extra,
  } as SceneDocument;
}
function codes(document: SceneDocument): string[] {
  const result = compileSceneDocument(document);
  return result.ok ? [] : result.report.issues.filter((issue) => issue.severity === "fatal").map((issue) => issue.code);
}
function passes(document: SceneDocument, message: string): void {
  const result = compileSceneDocument(document);
  check(result.ok && result.renderScene, `${message}: ${JSON.stringify(result.report.issues.filter((issue) => issue.severity === "fatal"))}`);
}
function mismatches(document: SceneDocument, message: string): void {
  const found = codes(document);
  check(found.includes("plane_source_mismatch"), `${message}: expected plane_source_mismatch, got ${JSON.stringify(found)}`);
}

// Reader.
const sum = parsePlaneEquation("x + y + z = 1");
check(sum && sum.a === 1 && sum.b === 1 && sum.c === 1 && sum.d === 1, "x + y + z = 1 reads as (1,1,1,1)");
const minus = parsePlaneEquation("2x − y + z = 4");
check(minus && minus.a === 2 && minus.b === -1 && minus.c === 1 && minus.d === 4, "unicode minus reads");
const shifted = parsePlaneEquation("x - z + 2 = 0");
check(shifted && shifted.a === 1 && shifted.b === 0 && shifted.c === -1 && shifted.d === -2, "x - z + 2 = 0 reads as (1,0,-1,-2)");
const packed = parsePlaneEquation("3x+4y-12z+5=0");
check(packed && packed.a === 3 && packed.b === 4 && packed.c === -12 && packed.d === -5, "3x+4y-12z+5=0 reads");
check(parsePlaneEquation("x*y + z = 1") === null, "a product of variables is not a plane");
check(parsePlaneEquation("2 = 2") === null, "an equation without a normal is not a plane");
const vector = readPlaneSourceStatement("Find the distance of the origin from the plane r·(i + j + k) = 1.");
check(vector && vector.distinct.length === 1 && vector.distinct[0]!.a === 1 && vector.distinct[0]!.d === 1 && !vector.unreadEquation && !vector.unanchoredPlaneMention, "vector form reads as one anchored plane");
const sphere = readPlaneSourceStatement("Find the tangent plane to the sphere x² + y² + z² = 9 at (1, 2, 2).");
check(sphere && sphere.distinct.length === 0 && sphere.unreadEquation, "a sphere is unread, never a plane");
const family = readPlaneSourceStatement("Find λ so that the plane x + λy + z = 1 passes through (1, 1, 1).");
check(family && family.distinct.length === 0 && family.unreadEquation, "a family x + λy + z = 1 is unread");
const symmetric = readPlaneSourceStatement("Find where the line (x − 1)/2 = (y + 1)/3 = z/4 meets the plane x + y + z = 1.");
check(symmetric && symmetric.distinct.length === 1 && !symmetric.unreadEquation, "a symmetric line is not a plane");
const named = readPlaneSourceStatement("The planes π₁: x + y + z = 1 and π₂: 2x + 3y + 4z = 5 meet in a line.");
check(named && named.names.get("π1")?.d === 1 && named.names.get("π2")?.d === 5, "named planes read");
const through = readPlaneSourceStatement("Find the equation of the plane through (1, 2, 3) parallel to the plane x + y + z = 1.");
check(through && through.unanchoredPlaneMention, "a sought plane is an unanchored mention");

const single = "Find the distance of the point (1, 2, 3) from the plane x + y + z = 1.";
// Must pass: both scales of the stated plane bind (rule b).
passes(scene(single, [{ id: "pi", inputs: { a: 1, b: 1, c: 1, d: "g1" } }], [{ id: "g1", value: 1 }]), "{a:1,b:1,c:1,d:g1} binds x + y + z = 1");
passes(scene(single, [{ id: "pi", inputs: { a: 2, b: 2, c: 2, d: 2 } }]), "{a:2,b:2,c:2,d:2} binds x + y + z = 1");
// ...and they are checked: the same scene with a wrong d fails.
mismatches(scene(single, [{ id: "pi", inputs: { a: 1, b: 1, c: 1, d: "g1" } }], [{ id: "g1", value: 3 }]), "single stated plane binds its d");
mismatches(scene(single, [{ id: "pi", inputs: { a: 1, b: 1, c: 2, d: 1 } }]), "single stated plane binds its normal");
// Point,u,v form: normal u×v and the point on the plane.
passes(scene(single, [{ id: "pi", inputs: { point: "P", u: [1, -1, 0], v: [1, 0, -1] } }]), "point,u,v spanning the stated plane binds");
mismatches(scene(single, [{ id: "pi", inputs: { point: [0, 0, 0], u: [1, -1, 0], v: [1, 0, -1] } }]), "point,u,v through an off-plane point fails");
mismatches(scene(single, [{ id: "pi", inputs: { point: "P", u: [1, 0, 0], v: [0, 1, 0] } }]), "point,u,v with the wrong span fails");
mismatches(scene(undefined, [{ id: "pi", inputs: { point: "P", u: [1, 0, 0], v: [0, 1, 0] }, label: "x + y + z = 1" }]), "labelled point,u,v with the wrong span fails");

// Labelled derived plane binds (rule a), with two stated planes.
const two = "Find the plane through the line of intersection of the planes x + y + z = 1 and 2x + 3y + 4z = 5 that is perpendicular to x + y + z = 1... show both planes.";
const intersection = "The planes x + y + z = 1 and 2x + 3y + 4z = 5 meet in a line. Find the distance of the origin from the plane through that line parallel to the y axis.";
passes(scene(intersection, [
  { id: "p1", inputs: { a: 1, b: 1, c: 1, d: 1 }, label: "x+y+z=1" },
  { id: "p2", inputs: { a: 2, b: 3, c: 4, d: 5 }, label: "2x+3y+4z=5" },
  { id: "p3", inputs: { a: 1, b: 0, c: -1, d: -2 }, label: "x−z+2=0" },
]), "derived plane labelled x−z+2=0 binds");
mismatches(scene(intersection, [
  { id: "p3", inputs: { a: 1, b: 0, c: -1, d: 2 }, label: "x−z+2=0" },
]), "derived plane off its label fails");
// Must fail: both stated planes drawn with the wrong constant.
const wrongPair = scene(intersection, [
  { id: "p1", inputs: { a: 1, b: 1, c: 1, d: -1 }, label: "x+y+z=1" },
  { id: "p2", inputs: { a: 2, b: 3, c: 4, d: -5 }, label: "2x+3y+4z=5" },
]);
const wrongPairResult = compileSceneDocument(wrongPair);
check(!wrongPairResult.ok && wrongPairResult.report.issues.filter((issue) => issue.code === "plane_source_mismatch").length === 2, "both wrong labelled planes fail");
// Must fail: the real candidate, -2x + y + 4z = 0 under 2x−y+z=4.
const image = "Find the image of the point P(1, 2, 3) in the plane 2x − y + z = 4.";
mismatches(scene(image, [{ id: "plane", inputs: { a: -2, b: 1, c: "d" }, label: "2x−y+z=4" }], [{ id: "d", value: 4 }]), "real candidate fails on its label");
mismatches(scene(image, [{ id: "plane", inputs: { a: -2, b: 1, c: "d" } }], [{ id: "d", value: 4 }]), "real candidate fails unlabelled on the single stated plane");
passes(scene(image, [{ id: "plane", inputs: { a: 2, b: -1, c: 1, d: "d" }, label: "2x−y+z=4" }], [{ id: "d", value: 4 }]), "the right image plane binds");
// Annotation and name claims.
mismatches(scene(intersection, [{ id: "p1", inputs: { a: 1, b: 1, c: 1, d: -1 } }, { id: "p2", inputs: { a: 2, b: 3, c: 4, d: 5 } }], [], {
  annotations: [{ id: "tag", kind: "label", targetIds: ["p1"], text: "x + y + z = 1" }],
}), "an annotation stating the equation binds its plane");
const namedQuestion = "The planes π₁: x + y + z = 1 and π₂: 2x + 3y + 4z = 5 meet in a line.";
passes(scene(namedQuestion, [{ id: "p1", inputs: { a: 1, b: 1, c: 1, d: 1 }, label: "π₁" }, { id: "p2", inputs: { a: 2, b: 3, c: 4, d: 5 }, label: "π₂" }]), "named planes bind");
mismatches(scene(namedQuestion, [{ id: "p1", inputs: { a: 2, b: 3, c: 4, d: 5 }, label: "π₁" }]), "a plane under the wrong name fails");

// Not checked: no stated or labelled equation, or the binding is ambiguous.
passes(scene("Show the angle between two planes with normals n₁ and n₂.", [{ id: "pi", inputs: { a: 1, b: 2, c: 3, d: 4 } }]), "symbolic question: unlabelled plane is not checked");
passes(scene("Find the equation of the plane through (1, 2, 3) parallel to the plane x + y + z = 1.", [{ id: "pi", inputs: { a: 1, b: 1, c: 1, d: 6 } }]), "a sought plane is not bound to the stated one");
passes(scene(intersection, [{ id: "p3", inputs: { a: 1, b: 0, c: -1, d: -2 } }]), "unlabelled derived plane with two stated planes is not checked");
passes(scene(single, [{ id: "pi", inputs: { a: 1, b: 1, c: 1, d: 1 } }, { id: "floor", inputs: { a: 0, b: 0, c: 1, d: 0 } }]), "two drawn planes: the unlabelled helper is not bound");
passes(scene(two, [{ id: "pi", inputs: { a: 1, b: 2, c: 3, d: 4 }, label: "π" }]), "a name the question never gives is not a claim");

console.log(`plane source verification passed (${checks} checks)`);
