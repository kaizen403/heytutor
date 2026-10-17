import { strict as assert } from "node:assert";
import { compileSceneDocument as compileWithPolicy } from "../../src/compile/compiler";
const compileSceneDocument: typeof compileWithPolicy = (document, options) => compileWithPolicy(document, { ...options, yieldPolicy: "verified_parts" });
import type { SceneDocument } from "../../src/types";
const base: SceneDocument = { schemaVersion: "scene-document/v2", source: { question: "Show the declared geometry." }, visualDecision: { mode: "scene", reason: "Geometry." }, quantities: [], entities: [], constructions: [], relations: [], assertions: [], annotations: [], requiredEntityIds: [], revealGroups: [], teachingTimeline: [] };
function finish(d: SceneDocument) { d.constructions.forEach(c => c.id = "make_" + c.id); d.requiredEntityIds = d.entities.map(e => e.id); d.revealGroups = [{ id: "setup", entityIds: d.requiredEntityIds, dependsOn: [], narrationCue: "Geometry." }]; return compileSceneDocument(d); }
for (const [label, x, y, good] of [["i", 1, 0, true], ["i", 1, 2, false], ["2i-j", 2, -1, true], ["-3i+2j", -3, 2, true], ["-j", 0, 1, false]] as const) {
    const d = structuredClone(base);
    d.entities = [{ id: "o", kind: "point", role: "origin" }, { id: "v", kind: "vector", role: "vector", label }];
    d.constructions = [{ id: "o", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["o"] }, { id: "v", operator: "vector", inputs: { start: "o", direction: [x, y], length: Math.hypot(x, y) }, outputs: ["v"] }];
    const r = finish(d);
    assert.equal(r.ok, good, "Cartesian basis label must match vector geometry " + JSON.stringify(r.report.issues));
}
for (const count of [5, 33]) {
    const d = structuredClone(base);
    for (let i = 0; i < count; i++) {
        const angle = i / (count - 1) * Math.PI;
        d.entities.push({ id: `p${i}`, kind: "point", role: "sample" });
        d.constructions.push({ id: `p${i}`, operator: "point", inputs: { x: Math.cos(angle), y: Math.sin(angle), coordinateSpace: "world" }, outputs: [`p${i}`] });
    }
    d.entities.push({ id: "curve", kind: "polyline", role: "semicircular path" });
    d.constructions.push({ id: "curve", operator: "polyline", inputs: { points: d.entities.slice(0, -1).map(e => e.id) }, outputs: ["curve"] });
    const r = finish(d);
    assert.equal(r.report.issues.some(i => i.code === "declared_geometry_contradiction"), count === 5, "semicircular curve must not be a coarse polygon");
}
// Dense cocircular samples can still retrace or wind past one half-turn.
for (const [name, angles, good] of [
    ["counterclockwise half-turn", Array.from({ length: 33 }, (_, i) => i / 32 * Math.PI), true],
    ["clockwise half-turn", Array.from({ length: 33 }, (_, i) => -i / 32 * Math.PI), true],
    ["three-half-turn winding", Array.from({ length: 97 }, (_, i) => i / 32 * Math.PI), false],
    ["backtracking within one half-plane", [
        ...Array.from({ length: 25 }, (_, i) => i / 32 * Math.PI),
        ...Array.from({ length: 8 }, (_, i) => (23 - i) / 32 * Math.PI),
        ...Array.from({ length: 16 }, (_, i) => (17 + i) / 32 * Math.PI),
    ], false],
] as const) {
    const d = structuredClone(base);
    angles.forEach((angle, i) => {
        d.entities.push({ id: `p${i}`, kind: "point", role: "sample" });
        d.constructions.push({ id: `p${i}`, operator: "point", inputs: { x: 3 + 2 * Math.cos(angle + 0.7), y: -4 + 2 * Math.sin(angle + 0.7), coordinateSpace: "world" }, outputs: [`p${i}`] });
    });
    d.entities.push({ id: "curve", kind: "polyline", role: "semicircular path" });
    d.constructions.push({ id: "curve", operator: "polyline", inputs: { points: d.entities.slice(0, -1).map(e => e.id) }, outputs: ["curve"] });
    const r = finish(d);
    assert.equal(r.report.issues.some(i => i.code === "declared_geometry_contradiction"), !good, name);
    if (good) assert(r.ok, JSON.stringify(r.report.issues));
}
// Uniform x sampling is sparse in angle near a circle's vertical endpoints.
// Analytic sampling must meet the same geometric bound without rejecting the circle.
for (const [expression, xMin, xMax, good] of [
    ["sqrt(1-x^2)", -1, 1, true],
    ["2+sqrt(9-(x-4)^2)", 1, 7, true],
    ["-2-sqrt(4-(x+3)^2)", -5, -1, true],
    ["1-x^2", -1, 1, false],
    ["2*sqrt(1-x^2)", -1, 1, false],
] as const) {
    const d = structuredClone(base);
    d.entities = [{ id: "curve", kind: "polyline", role: "semicircular path" }];
    d.constructions = [{ id: "curve", operator: "function_curve", inputs: { expression, xMin, xMax }, outputs: ["curve"] }];
    const originalConstructions = structuredClone(d.constructions);
    // finish supplies required/reveal data but must not rewrite the expression.
    const r = finish(d);
    assert.equal(d.constructions[0]!.inputs.expression, originalConstructions[0]!.inputs.expression);
    if (good) {
        const legacyDocument = structuredClone(d);
        const legacy = compileWithPolicy(legacyDocument, { yieldPolicy: "off" });
        assert(legacy.ok && legacy.renderScene);
        assert.equal(legacy.renderScene.primitives.find(p => p.entityId === "curve" && p.kind !== "label")!.points.length, 65,
            "flag off preserves the original uniform-x samples");
        assert.deepEqual(legacyDocument, d, "analytic refinement never changes the source document");
    }
    assert.equal(r.ok, good, `analytic semicircle truth: ${expression}: ${JSON.stringify(r.report.issues)}`);
    if (good && r.renderScene) {
        const points = r.renderScene.primitives.find(p => p.entityId === "curve" && p.kind !== "label")!.points;
        const radius = Math.hypot(points[0]!.x - points.at(-1)!.x, points[0]!.y - points.at(-1)!.y) / 2;
        assert(points.slice(1).every((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y) <= radius * 0.19975 + 0.02),
            "analytic semicircle rendering retains the 0.5% sagitta quality bound");
    }
}
{
    const d = structuredClone(base);
    d.entities = [{ id: "curve", kind: "polyline", role: "semicircular path" }];
    d.constructions = [{ id: "curve", operator: "parametric_curve", inputs: { xExpression: "cos(t)", yExpression: "sin(t)", tMin: 0, tMax: 3 * Math.PI }, outputs: ["curve"] }];
    const r = finish(d);
    assert(!r.ok && r.report.issues.some(i => i.code === "declared_geometry_contradiction"), "analytic metadata cannot waive the three-half-turn blocker");
}
for (const failedForce of ["none", "normal", "friction"]) {
    const good = failedForce === "none";
    const d = structuredClone(base);
    d.entities = [{ id: "o", kind: "point", role: "origin" }, { id: "s", kind: "segment", role: "inclined plane" }, { id: "n", kind: "vector", role: "normal force" }, { id: "f", kind: "vector", role: "static friction" }];
    d.constructions = [{ id: "o", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["o"] }, { id: "s", operator: "line", inputs: { start: "o", direction: [1, 1] }, outputs: ["s"] }, { id: "n", operator: "vector", inputs: { start: "o", direction: failedForce !== "normal" ? [-1, 1] : [0, 1], length: 1 }, outputs: ["n"] }, { id: "f", operator: "vector", inputs: { start: "o", direction: failedForce !== "friction" ? [1, 1] : [1, 0], length: 1 }, outputs: ["f"] }];
    const r = finish(d);
    assert.equal(r.ok, good, JSON.stringify(r.report.issues));
}
console.log("launch: vector labels, circular paths and contact force geometry retain declared truth");
for (const coordinateSpace of ["world", "layout"]) {
    const d = structuredClone(base);
    d.entities = [{ id: "axes", kind: "axes", role: "axes" }, { id: "a", kind: "point", role: "item", label: "A" }];
    d.constructions = [{ id: "axes", operator: "axes", inputs: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 }, outputs: ["axes"] }, { id: "a", operator: "point", inputs: { x: 1, y: 1, coordinateSpace }, outputs: ["a"] }];
    assert.equal(finish(d).ok, coordinateSpace === "world", "layout points cannot inherit numeric axis meaning");
}
for (const count of [4, 64]) {
    const d = structuredClone(base);
    for (let i = 0; i < count; i++) {
        const angle = i / count * 2 * Math.PI;
        d.entities.push({ id: `p${i}`, kind: "point", role: "sample" });
        d.constructions.push({ id: `p${i}`, operator: "point", inputs: { x: 2 * Math.cos(angle), y: Math.sin(angle), coordinateSpace: "world" }, outputs: [`p${i}`] });
    }
    d.entities[0]!.role = "orbital focus";
    const points = d.entities.map(e => e.id);
    d.entities.push({ id: "curve", kind: "polyline", role: "closed orbit" });
    d.constructions.push({ id: "curve", operator: "polyline", inputs: { points: [...points, points[0]] }, outputs: ["curve"] });
    const r = finish(d);
    assert.equal(r.report.issues.some(i => i.code === "declared_geometry_contradiction"), count === 4, "a smooth orbit cannot contain polygon corners");
}
for (const end of [2, 2.01, 4]) {
    const d = structuredClone(base);
    d.entities = [{ id: "path", kind: "polyline", role: "projectile path" }, { id: "a", kind: "point", role: "endpoint" }, { id: "b", kind: "point", role: "endpoint" }, { id: "ground", kind: "segment", role: "ground" }];
    d.constructions = [{ id: "path", operator: "function_curve", inputs: { expression: "2*x-x^2", xMin: 0, xMax: end }, outputs: ["path"] }, { id: "a", operator: "point", inputs: { x: 1, y: 0, coordinateSpace: "world" }, outputs: ["a"] }, { id: "b", operator: "point", inputs: { x: 5, y: 0, coordinateSpace: "world" }, outputs: ["b"] }, { id: "ground", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["ground"] }];
    const r = finish(d);
    assert.equal(r.report.issues.some(i => i.code === "declared_geometry_contradiction"), end > 2, "physical path cannot continue beyond impact");
}
