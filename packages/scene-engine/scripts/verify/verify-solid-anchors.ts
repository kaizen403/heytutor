import { compileSceneDocument, synthesizeFamilyScene, validateSceneDocument, type SceneDocument, type TurnPlanV3 } from "../../src/index";
import { buildSolidFigure } from "../../src/synthesize/solidFigure";

export function solidAnchorScene(axis: "vertical" | "horizontal" = "vertical"): SceneDocument {
  const anchor = (id: string, solid: string, at: number, radialFraction: number, angleDeg = 0) => ({
    id: `make_${id}`, operator: "solid_anchor", inputs: { solid, at, radialFraction, angleDeg }, outputs: [id],
  });
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "derived radius and height endpoints" },
    source: { question: "A hollow cylinder has outer radius R = 5 cm, inner radius r = 3 cm and length L = 8 cm." },
    quantities: [],
    entities: [
      { id: "origin", kind: "point", role: "construction helper" },
      { id: "outer", kind: "polyline", role: "outer cylinder" },
      { id: "inner", kind: "polyline", role: "inner cylinder" },
      ...["top_center", "outer_rim", "inner_center", "inner_rim", "base_rim"].map((id) => ({ id, kind: "point", role: "measurement endpoint" })),
      { id: "outer_radius", kind: "dimension", role: "outer radius", label: "R = 5 cm" },
      { id: "inner_radius", kind: "dimension", role: "inner radius", label: "r = 3 cm" },
      { id: "height", kind: "dimension", role: "length", label: "L = 8 cm" },
    ],
    constructions: [
      { id: "make_origin", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["origin"] },
      ...["outer", "inner"].map((id) => ({ id: `make_${id}`, operator: "solid_projection", inputs: { kind: "cylinder", center: "origin", radius: id === "outer" ? 5 : 3, height: 8, axis }, outputs: [id] })),
      anchor("top_center", "outer", 1, 0),
      anchor("outer_rim", "outer", 1, 1),
      anchor("inner_center", "inner", 1, 0),
      anchor("inner_rim", "inner", 1, 1, 180),
      anchor("base_rim", "outer", 0, 1),
      ...[["outer_radius", "top_center", "outer_rim", "radius", "outer"], ["inner_radius", "inner_center", "inner_rim", "radius", "inner"], ["height", "base_rim", "outer_rim", "height", "outer"]].map(([id, start, end, measurementKind, solid]) => ({ id: `make_${id}`, operator: "dimension", inputs: { start, end, measurementKind, solid }, outputs: [id!] })),
    ],
    relations: [], assertions: [], annotations: [],
    requiredEntityIds: ["outer", "inner", "top_center", "outer_rim", "inner_center", "inner_rim", "base_rim", "outer_radius", "inner_radius", "height"],
    revealGroups: [{ id: "setup", entityIds: ["outer", "inner", "top_center", "outer_rim", "inner_center", "inner_rim", "base_rim", "outer_radius", "inner_radius", "height"], dependsOn: [], narrationCue: "mark radii and length" }],
    teachingTimeline: [],
  };
}

for (const axis of ["vertical", "horizontal"] as const) {
  const validated = validateSceneDocument(solidAnchorScene(axis));
  if (!validated.document) throw new Error(`solid anchors schema: ${JSON.stringify(validated.report.issues)}`);
  const compiled = compileSceneDocument(validated.document);
  if (!compiled.ok || !compiled.renderScene) throw new Error(`solid anchors compile: ${JSON.stringify(compiled.report.issues)}`);
  const point = (id: string) => {
    const measurement = validated.document!.constructions.find((construction) => construction.operator === "dimension" && [construction.inputs.start, construction.inputs.end].includes(id))!;
    const bar = compiled.renderScene!.primitives.find((primitive) => primitive.entityId === measurement.outputs[0] && primitive.provenance?.measurementRole === "bar")!;
    const endpoint = measurement.inputs.start === id ? bar.provenance?.measuredStart : bar.provenance?.measuredEnd;
    if (typeof endpoint !== "object" || endpoint === null || !("x" in endpoint) || !("y" in endpoint) || typeof endpoint.x !== "number" || typeof endpoint.y !== "number") throw new Error("A measurement must preserve its exact endpoint provenance");
    return { x: endpoint.x, y: endpoint.y };
  };
  const center = point("top_center");
  const outer = point("outer_rim");
  const inner = point("inner_rim");
  const base = point("base_rim");
  const axial = axis === "vertical" ? "y" : "x";
  const radial = axis === "vertical" ? "x" : "y";
  if (Math.abs(center[axial] - outer[axial]) > 0.01 || Math.abs(center[axial] - inner[axial]) > 0.01) throw new Error("a radius must stay on the same circular face");
  if (Math.abs(base[radial] - outer[radial]) > 0.01) throw new Error("height must join matching rim points");
  const ratio = Math.abs(inner[radial] - center[radial]) / Math.abs(outer[radial] - center[radial]);
  if (Math.abs(ratio - 3 / 5) > 0.0001) throw new Error("inner/outer radius ratio must come from the drawn solids");
  if (JSON.stringify(compileSceneDocument(validated.document).renderScene) !== JSON.stringify(compiled.renderScene)) throw new Error("solid anchors must compile deterministically");
}

for (const inputs of [{ at: -0.1 }, { at: 1.1 }, { at: Infinity }, { radialFraction: -1 }, { radialFraction: 1.1 }, { angleDeg: Infinity }, { solid: "origin" }]) {
  const candidate = solidAnchorScene();
  Object.assign(candidate.constructions.find((c) => c.operator === "solid_anchor")!.inputs, inputs);
  const result = validateSceneDocument(candidate);
  if (result.document) throw new Error(`invalid solid anchor accepted: ${JSON.stringify(inputs)}`);
}
for (const kind of ["cylinder", "cone", "frustum", "sphere", "hemisphere"] as const) {
  for (const axis of ["vertical", "horizontal"] as const) {
    const fixture = solidAnchorScene(axis);
    const specimen: SceneDocument = { ...fixture, source: {}, quantities: [{ id: "section_at", value: 0.5 }],
      entities: [{ id: "origin", kind: "point", role: "construction helper point" }, { id: "solid", kind: "polyline", role: "solid" }, { id: "section", kind: "polyline", role: "cross section" }, { id: "rim", kind: "point", role: "vertex", label: "P" }],
      constructions: [
        { id: "make_origin", operator: "point", inputs: { x: 2, y: 3 }, outputs: ["origin"] },
        { id: "make_solid", operator: "solid_projection", inputs: { kind, center: "origin", radius: 5, axis, ...(["cylinder", "cone", "frustum"].includes(kind) ? { height: 8 } : {}), ...(kind === "frustum" ? { topRadius: 3 } : {}) }, outputs: ["solid"] },
        { id: "make_section", operator: "solid_cross_section", inputs: { solid: "solid", at: "section_at" }, outputs: ["section"] },
        { id: "make_rim", operator: "solid_anchor", inputs: { solid: "solid", at: "section_at", radialFraction: 1, angleDeg: 90 }, outputs: ["rim"] },
      ], requiredEntityIds: ["solid", "section", "rim"], revealGroups: [{ id: "setup", entityIds: ["solid", "section", "rim"], dependsOn: [], narrationCue: "derive P on the section" }],
    };
    const result = compileSceneDocument(specimen);
    if (!result.ok || !result.renderScene) throw new Error(`${kind} ${axis} anchor: ${JSON.stringify(result.report.issues)}`);
    const rim = result.renderScene.primitives.find((p) => p.entityId === "rim" && p.kind === "point")!.points[0]!;
    const section = result.renderScene.primitives.find((p) => p.entityId === "section" && p.kind === "polyline")!;
    if (!section.points.some((p) => Math.hypot(p.x - rim.x, p.y - rim.y) < 0.02)) throw new Error(`${kind} anchor must meet the engine-computed section exactly`);
  }
}
const question = solidAnchorScene().source.question as string;
const turnPlan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question,
  givens: [["outer_radius", "R", 5], ["inner_radius", "r", 3], ["length", "L", 8]].map(([id, symbol, value]) => ({ id: String(id), symbol: String(symbol), value: Number(value), unit: "cm", provenance: "given" })),
  unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" };
const family = synthesizeFamilyScene({ question, families: ["solid_figure"], turnPlan });
if (!family || family.document.constructions.filter((c) => c.operator === "solid_projection").length !== 2) throw new Error("solid family must preserve separate R and r cylinder radii");
for (const text of ["R = 5 cm", "r = 3 cm", "L = 8 cm"]) {
  if (!family.renderScene.primitives.some((p) => p.kind === "label" && p.text === text)) throw new Error(`solid family lost measurement ${text}`);
}
const shorthand = synthesizeFamilyScene({ question, families: ["solid_figure"], turnPlan: { ...turnPlan,
  givens: turnPlan.givens.map((q) => ({ ...q, id: q.symbol })),
} });
if (!shorthand || shorthand.document.constructions.filter((c) => c.operator === "solid_projection").length !== 2 || !shorthand.renderScene.primitives.some((p) => p.kind === "label" && p.text === "r = 3 cm")) throw new Error("Conventional R/r/L bindings must retain the inner radius");
const unrelatedRadius = synthesizeFamilyScene({ question: "A cylinder has outer radius R = 5 cm and length L = 8 cm. A particle follows an orbit of radius r = 3 cm.", families: ["solid_figure"], turnPlan: { ...turnPlan,
  givens: turnPlan.givens.map((q) => q.symbol === "r" ? { ...q, id: "orbit_radius" } : q),
} });
if (!unrelatedRadius || unrelatedRadius.document.constructions.some((c) => c.outputs.includes("inner_solid"))) throw new Error("An unrelated orbit radius must not become a cylinder bore");
const frustumQuestion = "A frustum of a cone has base radius R = 5 cm, top radius r = 3 cm and height h = 8 cm.";
const frustum = synthesizeFamilyScene({ question: frustumQuestion, families: ["solid_figure"], turnPlan: { ...turnPlan, question: frustumQuestion, givens: [
  { id: "base_radius", symbol: "R", value: 5, unit: "cm", provenance: "given" },
  { id: "top_radius", symbol: "r", value: 3, unit: "cm", provenance: "given" },
  { id: "height", symbol: "h", value: 8, unit: "cm", provenance: "given" },
] } });
const projected = frustum?.document.constructions.find((c) => c.operator === "solid_projection");
if (projected?.inputs.kind !== "frustum" || projected.inputs.topRadius !== 3) throw new Error("frustum must preserve its given top radius and type");
const invertedFrustumQuestion = "An inverted frustum has base radius r = 3 cm, top radius R = 5 cm and height h = 8 cm.";
const invertedFrustum = synthesizeFamilyScene({ question: invertedFrustumQuestion, families: ["solid_figure"], turnPlan: { ...turnPlan, question: invertedFrustumQuestion, givens: [
  { id: "base_radius", symbol: "r", value: 3, unit: "cm", provenance: "given" },
  { id: "top_radius", symbol: "R", value: 5, unit: "cm", provenance: "given" },
  { id: "height", symbol: "h", value: 8, unit: "cm", provenance: "given" },
] } });
const invertedProjection = invertedFrustum?.document.constructions.find((c) => c.operator === "solid_projection");
if (invertedProjection?.inputs.radius !== 3 || invertedProjection.inputs.topRadius !== 5) throw new Error("Explicit frustum base/top bindings must take precedence over letter case");
const coneQuestion = "A cone has radius r = 3 cm and slant length l = 5 cm.";
const cone = synthesizeFamilyScene({ question: coneQuestion, families: ["solid_figure"], turnPlan: { ...turnPlan, question: coneQuestion, givens: [
  { id: "radius", symbol: "r", value: 3, unit: "cm", provenance: "given" },
  { id: "slant_length", symbol: "l", value: 5, unit: "cm", provenance: "given" },
] } });
if (!cone || cone.document.entities.some((e) => e.id === "height_measure")) throw new Error("slant length must never be marked as axial height");

const sourceDiameter = buildSolidFigure("A cylinder has diameter 6 cm and height 8 cm.");
if (!sourceDiameter) throw new Error("The source mensuration builder must preserve a complete diameter/height figure");
const sourceCompiled = compileSceneDocument(sourceDiameter);
if (!sourceCompiled.ok || !sourceCompiled.renderScene) throw new Error(`Source anchors must compile: ${JSON.stringify(sourceCompiled.report.issues)}`);
const sourceAnchorIds = sourceDiameter.constructions.filter((construction) => construction.operator === "solid_anchor").flatMap((construction) => construction.outputs);
if (sourceAnchorIds.length < 4 || sourceCompiled.renderScene.primitives.some((primitive) => sourceAnchorIds.includes(primitive.entityId))) throw new Error("Consumed unlabeled source anchors must stay hidden construction helpers");
if (!sourceCompiled.renderScene.primitives.some((primitive) => primitive.kind === "label" && primitive.text === "D = 6 cm") || sourceCompiled.renderScene.primitives.some((primitive) => primitive.kind === "label" && primitive.text === "r = 3 cm")) throw new Error("A source diameter must retain its full-span label, never acquire a derived radius label");
const sourceBar = sourceCompiled.renderScene.primitives.find((primitive) => primitive.entityId === "cylinder_diameter" && primitive.provenance?.measurementRole === "bar")!;
const sourceContour = sourceCompiled.renderScene.primitives.filter((primitive) => primitive.entityId === "cylinder" && primitive.kind === "polyline").flatMap((primitive) => primitive.points);
for (const endpoint of [sourceBar.provenance?.measuredStart, sourceBar.provenance?.measuredEnd]) {
  if (typeof endpoint !== "object" || endpoint === null || !("x" in endpoint) || !("y" in endpoint) || typeof endpoint.x !== "number" || typeof endpoint.y !== "number") throw new Error("The source diameter must retain exact endpoint provenance");
  const { x, y } = endpoint;
  if (!sourceContour.some((point) => Math.hypot(point.x - x, point.y - y) < 0.02)) throw new Error("Both source diameter endpoints must meet the actual cylinder rim");
}
const visibleAnchor = sourceDiameter.entities.find((entity) => entity.id === "cylinder_diameter_end")!;
visibleAnchor.role = "vertex";
visibleAnchor.label = "P";
sourceDiameter.requiredEntityIds.push(visibleAnchor.id);
sourceDiameter.revealGroups[0]!.entityIds.push(visibleAnchor.id);
const visibleCompiled = compileSceneDocument(sourceDiameter);
if (!visibleCompiled.ok || !visibleCompiled.renderScene) throw new Error(`A displayed consumed anchor must compile: ${JSON.stringify(visibleCompiled.report.issues)}`);
if (!visibleCompiled.renderScene.primitives.some((primitive) => primitive.entityId === visibleAnchor.id && primitive.kind === "point") || !visibleCompiled.renderScene.primitives.some((primitive) => primitive.entityId === visibleAnchor.id && primitive.kind === "label" && primitive.text === "P")) throw new Error("An explicitly displayed labeled anchor P must retain its point and label");
console.log("verify-solid-anchors: derived solid measurements, source diameter, hidden helpers and visible anchors passed");
