import { strict as assert } from "node:assert";
import { compileSceneDocument as compileWithPolicy } from "../../src/compile/compiler";
const compileSceneDocument: typeof compileWithPolicy = (document, options) => compileWithPolicy(document, { ...options, yieldPolicy: "verified_parts" });
import type { SceneDocument } from "../../src/types";
function surfaceDocument(): SceneDocument {
    return {
        schemaVersion: "scene-document/v2", source: { question: "Show two spherical faces and their centres of curvature.", nonMetric: true, representationTier: "qualitative_verified" },
        visualDecision: { mode: "scene", reason: "Signed surface geometry." }, quantities: [],
        entities: [
            { id: "origin", kind: "point", role: "axis origin" }, { id: "axis", kind: "line", role: "optical axis" },
            { id: "v1", kind: "point", role: "first face vertex" }, { id: "v2", kind: "point", role: "second face vertex" },
            { id: "c1", kind: "point", role: "first centre of curvature", label: "C1" }, { id: "c2", kind: "point", role: "second face centre of curvature", label: "C2" },
            { id: "s1", kind: "arc", role: "first spherical surface" }, { id: "s2", kind: "arc", role: "second spherical surface" },
        ],
        constructions: [
            { id: "o", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["origin"] },
            { id: "a", operator: "line", inputs: { start: "origin", direction: [1, 0] }, outputs: ["axis"] },
            ...[["v1", -0.3], ["v2", 0.3], ["c1", 2], ["c2", -2]].map(([id, x]) => ({ id: `point_${id}`, operator: "point", inputs: { x, y: 0, coordinateSpace: "world" }, outputs: [String(id)] })),
            { id: "face1", operator: "spherical_surface", inputs: { vertex: "v1", axis: "axis", halfHeight: 0.5 }, outputs: ["s1"] },
            { id: "face2", operator: "spherical_surface", inputs: { vertex: "v2", axis: "axis", halfHeight: 0.5 }, outputs: ["s2"] },
        ], relations: [], assertions: [], annotations: [], requiredEntityIds: ["axis", "v1", "v2", "c1", "c2", "s1", "s2"],
        revealGroups: [{ id: "setup", entityIds: ["axis", "v1", "v2", "c1", "c2", "s1", "s2"], dependsOn: [], narrationCue: "Surfaces." }], teachingTimeline: [],
    };
}
const rejected = (doc: SceneDocument, message: string) => {
    const result = compileSceneDocument(doc);
    assert(!result.ok && result.report.issues.some(issue => issue.code === "invalid_spherical_curvature" && issue.failureKind === "truth"), `${message}: ${JSON.stringify(result.report.issues)}`);
};
const admitted = (doc: SceneDocument, message: string) => {
    const result = compileSceneDocument(doc);
    assert(result.ok, `${message}: ${JSON.stringify(result.report.issues)}`);
};
rejected(surfaceDocument(), "Unbound curvature centres cannot certify default surfaces");
for (const shift of [-7, 0, 9]) {
    const correct = surfaceDocument();
    for (const c of correct.constructions) {
        if (c.operator === "point" && typeof c.inputs.x === "number")
            c.inputs.x += shift;
        if (c.id === "face1")
            c.inputs.center = "c1";
        if (c.id === "face2")
            c.inputs.center = "c2";
    }
    admitted(correct, `Explicit opposite centres remain valid at translation ${shift}`);
    const mismatch = structuredClone(correct);
    mismatch.constructions.find(c => c.id === "face2")!.inputs.center = "c1";
    rejected(mismatch, "A declared second centre cannot be silently replaced by first centre");
}
const mirror = surfaceDocument();
mirror.entities = mirror.entities.filter(e => !["s1", "c1", "c2"].includes(e.id));
mirror.constructions = mirror.constructions.filter(c => !["face1", "point_c1", "point_c2"].includes(c.id));
mirror.entities.find(e => e.id === "s2")!.role = "concave mirror";
mirror.requiredEntityIds = mirror.requiredEntityIds.filter(id => !["s1", "c1", "c2"].includes(id));
mirror.revealGroups[0]!.entityIds = [...mirror.requiredEntityIds];
rejected(mirror, "Declared concave mirror cannot use unspecified convex default");
const declared = structuredClone(mirror);
declared.constructions.find(c => c.id === "face2")!.inputs.kind = "concave";
admitted(declared, "Explicit concave schematic is valid");
const contradictory = structuredClone(declared);
contradictory.constructions.find(c => c.id === "face2")!.inputs.signedRadius = 3;
rejected(contradictory, "Signed radius contradicting explicit concavity must fail");
const wrongKind = structuredClone(declared);
wrongKind.constructions.find(c => c.id === "face2")!.inputs.kind = "convex";
rejected(wrongKind, "Explicit kind cannot contradict the declared mirror role");
const generic = structuredClone(mirror);
generic.entities.find(e => e.id === "s2")!.role = "spherical interface";
admitted(generic, "Unclaimed schematic curvature remains allowed");
console.log("launch curvature truth: centre binding, concavity, translations, and honest defaults passed");

const correctDefault = structuredClone(mirror);
correctDefault.entities.find(e => e.id === "s2")!.role = "convex mirror";
admitted(correctDefault, "Actual convex default matches the declared convex mirror without added proof");
const faced = structuredClone(declared);
faced.entities.find(e => e.id === "s2")!.semantic = { facing: "right" };
faced.constructions.find(c => c.id === "face2")!.inputs.signedRadius = 3;
admitted(faced, "Explicit opposite facing reverses concavity convention");
faced.constructions.find(c => c.id === "face2")!.inputs.signedRadius = -3;
rejected(faced, "Explicit opposite facing still refuses contradictory curvature");
function pairedFaces(kind: "concave" | "convex", body = true, coincident = false): SceneDocument {
    const doc = surfaceDocument();
    doc.entities = doc.entities.filter(e => !["c1", "c2"].includes(e.id));
    doc.constructions = doc.constructions.filter(c => !["point_c1", "point_c2"].includes(c.id));
    doc.requiredEntityIds = doc.requiredEntityIds.filter(id => !["c1", "c2"].includes(id));
    doc.revealGroups[0]!.entityIds = [...doc.requiredEntityIds];
    const r = kind === "convex" ? 3 : -3;
    for (const [id, radius] of [["face1", r], ["face2", -r]] as const) {
        const c = doc.constructions.find(c => c.id === id)!;
        c.inputs.kind = kind;
        c.inputs.signedRadius = radius;
        if (coincident) c.inputs.vertex = "origin";
    }
    if (body) {
        doc.entities.push({ id: "body", kind: "polygon", role: "refracting body" });
        doc.constructions.push({ id: "make_body", operator: "lens_section", inputs: { center: "origin", axis: "axis", radius1: r, radius2: -r, halfHeight: 0.5, thickness: 0.6 }, outputs: ["body"] });
        doc.requiredEntityIds.push("body");
        doc.revealGroups[0]!.entityIds.push("body");
    }
    return doc;
}
for (const kind of ["concave", "convex"] as const) {
    for (const coincident of [false, true]) {
        const pair = pairedFaces(kind, true, coincident);
        admitted(pair, `Both ${kind} faces are judged relative to their body (coincident=${coincident})`);
        const wrongFace = structuredClone(pair);
        const second = wrongFace.constructions.find(c => c.id === "face2")!;
        second.inputs.signedRadius = -Number(second.inputs.signedRadius);
        rejected(wrongFace, "A reversed second face remains a real body-relative contradiction");
    }
    admitted(pairedFaces(kind, false), "Unbound paired faces do not imply an incident-facing convention");
}
const explicitlyFacedPair = pairedFaces("concave", false);
explicitlyFacedPair.entities.find(e => e.id === "s1")!.semantic = { facing: "left" };
explicitlyFacedPair.entities.find(e => e.id === "s2")!.semantic = { facing: "right" };
admitted(explicitlyFacedPair, "Explicit facing binds free surfaces without inventing a body");
explicitlyFacedPair.constructions.find(c => c.id === "face2")!.inputs.signedRadius = -3;
rejected(explicitlyFacedPair, "A free surface contradicting its explicit facing remains blocked");
