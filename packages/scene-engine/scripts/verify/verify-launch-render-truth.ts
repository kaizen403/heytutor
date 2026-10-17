import { strict as assert } from "node:assert";
import { compileSceneDocument as compileWithPolicy } from "../../src/compile/compiler";
const compileSceneDocument: typeof compileWithPolicy = (document, options) => compileWithPolicy(document, { ...options, yieldPolicy: "verified_parts" });
import type { SceneDocument } from "../../src/types";
// Reveal groups describe teaching order, not independent coordinate systems.
for (const [cx, cy, radius] of [[-1, 4, 3], [3, -2, 1], [-4, -3, 2]]) {
    const document: SceneDocument = {
        schemaVersion: "scene-document/v2",
        source: { question: "Show the stated circle in its coordinate plane." },
        visualDecision: { mode: "scene", reason: "Coordinate geometry." },
        quantities: [],
        entities: [
            { id: "axes", kind: "axes", role: "coordinate frame" },
            { id: "centre", kind: "point", role: "centre", label: "C" },
            { id: "circle", kind: "circle", role: "circle" },
        ],
        constructions: [
            { id: "axes_c", operator: "axes", inputs: { xMin: -8, xMax: 8, yMin: -8, yMax: 8 }, outputs: ["axes"] },
            { id: "centre_c", operator: "point", inputs: { x: cx, y: cy, coordinateSpace: "world" }, outputs: ["centre"] },
            { id: "circle_c", operator: "circle", inputs: { center: "centre", radius }, outputs: ["circle"] },
        ],
        relations: [], assertions: [], annotations: [], requiredEntityIds: ["axes", "centre", "circle"],
        revealGroups: [
            { id: "frame", entityIds: ["axes"], dependsOn: [], narrationCue: "Axes." },
            { id: "geometry", entityIds: ["centre", "circle"], dependsOn: ["frame"], narrationCue: "Circle." },
        ],
        teachingTimeline: [],
    };
    const compiled = compileSceneDocument(document);
    assert(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
    const axes = compiled.renderScene.primitives.find(p => p.entityId === "axes" && p.kind === "axes")!;
    const circle = compiled.renderScene.primitives.find(p => p.entityId === "circle" && p.kind === "circle")!;
    const origin = { x: axes.points[2]!.x, y: axes.points[0]!.y };
    const scale = (axes.points[1]!.x - axes.points[0]!.x) / 16;
    assert(Math.abs(circle.points[0]!.x - (origin.x + cx! * scale)) < 0.03, "circle and axes must share x coordinates");
    assert(Math.abs(circle.points[0]!.y - (origin.y - cy! * scale)) < 0.03, "circle and axes must share y coordinates");
    assert(Math.abs(circle.radius! - radius! * scale) < 0.03, "circle and axes must share scale");
}
console.log("launch render truth: shared coordinate frame passed");
// Both call sites have different handedness: construction geometry is world
// y-up; annotation geometry is already screen y-down.
for (const sense of ["clockwise", "counterclockwise"] as const) {
    const document: SceneDocument = {
        schemaVersion: "scene-document/v2", source: { question: "Show the specified sense." },
        visualDecision: { mode: "scene", reason: "Direction." }, quantities: [],
        entities: [
            { id: "a", kind: "point", role: "endpoint" }, { id: "b", kind: "point", role: "endpoint" },
            { id: "line", kind: "segment", role: "axis", label: "axis" }, { id: "badge", kind: "polyline", role: "sense" },
        ],
        constructions: [
            { id: "a_c", operator: "point", inputs: { x: -2, y: -1, coordinateSpace: "world" }, outputs: ["a"] },
            { id: "b_c", operator: "point", inputs: { x: 3, y: 2, coordinateSpace: "world" }, outputs: ["b"] },
            { id: "line_c", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["line"] },
            { id: "badge_c", operator: "sign_badge", inputs: { target: "line", sense }, outputs: ["badge"] },
        ], relations: [], assertions: [],
        annotations: [{ id: "spin", kind: "spin", targetIds: ["line"], text: sense }],
        requiredEntityIds: ["line", "badge"],
        revealGroups: [{ id: "setup", entityIds: ["line", "badge"], dependsOn: [], narrationCue: "Sense." }], teachingTimeline: [],
    };
    const compiled = compileSceneDocument(document);
    assert(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
    for (const owner of ["badge", "spin"]) {
        const arc = compiled.renderScene.primitives.find(p => (p.entityId === owner || p.id.startsWith(owner)) && p.points.length > 3);
        assert(arc, `missing ${owner} arc`);
        const [a, b, c] = arc.points;
        const winding = (b!.x - a!.x) * (c!.y - b!.y) - (b!.y - a!.y) * (c!.x - b!.x);
        assert(sense === "clockwise" ? winding > 0 : winding < 0, `${owner}: rendered ${sense} sense must agree`);
    }
}
console.log("launch render truth: badge and annotation winding passed");
// A proved incidence must remain true after groups are laid out.
const incidence: SceneDocument = {
    schemaVersion: "scene-document/v2", source: { question: "Show P on the circle." },
    visualDecision: { mode: "scene", reason: "Circle incidence." }, quantities: [],
    entities: [{ id: "O", kind: "point", role: "centre" }, { id: "P", kind: "point", role: "point", label: "P" }, { id: "circle", kind: "circle", role: "circle" }],
    constructions: [
        { id: "o", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["O"] },
        { id: "p", operator: "point", inputs: { x: 3, y: 4, coordinateSpace: "world" }, outputs: ["P"] },
        { id: "c", operator: "circle", inputs: { center: "O", radius: 5 }, outputs: ["circle"] },
    ], relations: [], annotations: [], requiredEntityIds: ["P", "circle"],
    assertions: [{ id: "incidence", predicate: "on", entities: ["P", "circle"], expected: true, severity: "fatal" }],
    revealGroups: [{ id: "circle_group", entityIds: ["circle"], dependsOn: [], narrationCue: "Circle." }, { id: "point_group", entityIds: ["P"], dependsOn: ["circle_group"], narrationCue: "P." }], teachingTimeline: [],
};
const result = compileSceneDocument(incidence);
assert(result.ok && result.renderScene, JSON.stringify(result.report.issues));
const p = result.renderScene.primitives.find(p => p.entityId === "P" && p.kind === "point")!.points[0]!;
const c = result.renderScene.primitives.find(p => p.kind === "circle")!;
assert(Math.abs(Math.hypot(p.x - c.points[0]!.x, p.y - c.points[0]!.y) - c.radius!) < 0.03, "layout cannot break proved incidence");
console.log("launch render truth: proved incidence survives layout");
