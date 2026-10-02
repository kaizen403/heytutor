import {
  compileSceneDocument,
  synthesizeFamilyScene,
  validateSceneDocument,
  type RenderPoint,
  type RenderScene,
  type SceneDocument,
  type TurnPlanV3,
} from "../../src/index";
import { solidFigureParts } from "../../src/synthesize/solidFigure";

type SolidKind = "cylinder" | "sphere";
interface Quantity { id: string; symbol: string; value: number; unit?: string }

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const samePoint = (a: RenderPoint, b: RenderPoint) => Math.hypot(a.x - b.x, a.y - b.y) < 0.02;
const sourceLabel = (quantity: Quantity) => `${quantity.symbol} = ${quantity.value}${quantity.unit ? ` ${quantity.unit}` : ""}`;

function makePlan(question: string, quantities: readonly Quantity[]): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3", question,
    givens: quantities.map((quantity) => ({ ...quantity, provenance: "given" })),
    unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
  };
}

function measuredPoint(value: unknown): RenderPoint {
  assert(typeof value === "object" && value !== null && "x" in value && "y" in value &&
    typeof value.x === "number" && typeof value.y === "number", "Measurements must retain finite exact endpoint provenance.");
  assert(Number.isFinite(value.x) && Number.isFinite(value.y), "Measurement endpoints must be finite.");
  return { x: value.x, y: value.y };
}

function verifyMeasurement(scene: RenderScene, kind: SolidKind, label: string, span: "radius" | "diameter") {
  const labelPrimitive = scene.primitives.find((primitive) => primitive.kind === "label" && primitive.text === label);
  assert(labelPrimitive, `The source measurement label ${label} must survive compilation.`);
  const bar = scene.primitives.find((primitive) => primitive.entityId === labelPrimitive.entityId && primitive.provenance?.measurementRole === "bar");
  assert(bar, `${label} must belong to a dimension with exact measured endpoints.`);
  const a = measuredPoint(bar.provenance?.measuredStart);
  const b = measuredPoint(bar.provenance?.measuredEnd);
  const outline = scene.primitives.filter((primitive) => primitive.entityId === "solid" && primitive.kind !== "label").flatMap((primitive) => primitive.points);
  assert(outline.length > 0, "The measurement must reference a rendered solid.");
  const minX = Math.min(...outline.map((point) => point.x));
  const maxX = Math.max(...outline.map((point) => point.x));
  const onRim = (point: RenderPoint) => outline.some((rim) => samePoint(point, rim));
  assert(Math.abs(a.y - b.y) < 0.02, `${label} must stay on one circular section.`);
  if (span === "diameter") {
    assert(onRim(a) && onRim(b), `${label} must join two actual rim points.`);
    assert(Math.abs(Math.min(a.x, b.x) - minX) < 0.02 && Math.abs(Math.max(a.x, b.x) - maxX) < 0.02,
      `${label} must span opposite rims, never centre to rim.`);
  } else {
    const centerX = (minX + maxX) / 2;
    assert(Math.abs(a.x - centerX) < 0.02 && onRim(b), `${label} must join the solid centre and rim.`);
    assert(Math.abs(Math.abs(b.x - a.x) - (maxX - minX) / 2) < 0.02, `${label} must measure exactly one radius.`);
  }
  if (kind === "sphere") {
    const centerY = (Math.min(...outline.map((point) => point.y)) + Math.max(...outline.map((point) => point.y))) / 2;
    assert(Math.abs(a.y - centerY) < 0.02, `${label} must use the sphere equator through its geometric centre.`);
  }
  const witnesses = scene.primitives.filter((primitive) => primitive.entityId === bar.entityId && primitive.provenance?.measurementRole === "witness");
  assert(witnesses.length === 2 && witnesses.some((primitive) => samePoint(primitive.points[0]!, a)) && witnesses.some((primitive) => samePoint(primitive.points[0]!, b)),
    `${label} must retain both exact physical endpoints when its bar moves.`);
}

function family(kind: SolidKind, quantities: readonly Quantity[]) {
  const question = `A ${kind} has ${quantities.map((quantity) => sourceLabel(quantity)).join(" and ")}.`;
  const result = synthesizeFamilyScene({ question, families: ["solid_figure"], turnPlan: makePlan(question, quantities) });
  assert(result, `A consistent ${kind} measurement must compile.`);
  return result;
}

function manualAnchorScene(kind: SolidKind, span: "radius" | "diameter"): SceneDocument {
  const at = kind === "sphere" ? 0.5 : 1;
  const label = span === "diameter" ? "D = 14 cm" : "r = 7 cm";
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "solid measurement capability" },
    source: { question: `A ${kind} has ${label}.` }, quantities: [],
    entities: [
      { id: "origin", kind: "point", role: "construction helper point" },
      { id: "solid", kind: "polyline", role: "solid projection" },
      { id: "measure_start", kind: "point", role: "measurement endpoint" },
      { id: "measure_end", kind: "point", role: "measurement endpoint" },
      { id: "measure", kind: "dimension", role: "solid measurement", label },
    ],
    constructions: [
      { id: "make_origin", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["origin"] },
      { id: "make_solid", operator: "solid_projection", inputs: { kind, center: "origin", radius: 7, axis: "vertical", ...(kind === "cylinder" ? { height: 8 } : {}) }, outputs: ["solid"] },
      { id: "make_start", operator: "solid_anchor", inputs: { solid: "solid", at, radialFraction: span === "radius" ? 0 : 1, angleDeg: span === "radius" ? 0 : 180 }, outputs: ["measure_start"] },
      { id: "make_end", operator: "solid_anchor", inputs: { solid: "solid", at, radialFraction: 1, angleDeg: 0 }, outputs: ["measure_end"] },
      { id: "make_measure", operator: "dimension", inputs: { start: "measure_start", end: "measure_end", measurementKind: span, solid: "solid" }, outputs: ["measure"] },
    ],
    relations: [], assertions: [], annotations: [],
    requiredEntityIds: ["solid", "measure_start", "measure_end", "measure"],
    revealGroups: [{ id: "setup", entityIds: ["solid", "measure_start", "measure_end", "measure"], dependsOn: [], narrationCue: "Mark the exact measurement" }],
    teachingTimeline: [],
  };
}

const failures: string[] = [];
let checks = 0;
function check(name: string, run: () => void) {
  checks += 1;
  try { run(); } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

for (const kind of ["cylinder", "sphere"] as const) {
  for (const span of ["radius", "diameter"] as const) {
    check(`${kind} primitive ${span}`, () => {
      const validated = validateSceneDocument(manualAnchorScene(kind, span));
      assert(validated.document, `The solid-anchor capability must validate: ${JSON.stringify(validated.report.issues)}`);
      const compiled = compileSceneDocument(validated.document);
      assert(compiled.ok && compiled.renderScene, `The solid-anchor capability must compile: ${JSON.stringify(compiled.report.issues)}`);
      verifyMeasurement(compiled.renderScene, kind, span === "diameter" ? "D = 14 cm" : "r = 7 cm", span);
    });
  }
  check(`${kind} diameter binding`, () => {
    const diameter = { id: "diameter", symbol: "D", value: 14, unit: "cm" };
    const result = family(kind, [diameter]);
    const projection = result.document.constructions.find((construction) => construction.operator === "solid_projection");
    assert(projection?.inputs.radius === 7, "A source diameter of 14 cm must produce a radius of 7 cm.");
    verifyMeasurement(result.renderScene, kind, sourceLabel(diameter), "diameter");
    assert(!result.renderScene.primitives.some((primitive) => primitive.kind === "label" && primitive.text?.startsWith("r =")), "Diameter-only givens must not acquire an invented radius label.");
  });
  check(`${kind} radius binding`, () => {
    const radius = { id: "radius", symbol: "r", value: 0.7, unit: "cm" };
    verifyMeasurement(family(kind, [radius]).renderScene, kind, sourceLabel(radius), "radius");
  });
  check(`${kind} mixed-unit consistent radius and diameter`, () => {
    const radius = { id: "radius", symbol: "r", value: 70, unit: "mm" };
    const diameter = { id: "diameter", symbol: "D", value: 14, unit: "cm" };
    const result = family(kind, [radius, diameter]);
    verifyMeasurement(result.renderScene, kind, sourceLabel(radius), "radius");
    verifyMeasurement(result.renderScene, kind, sourceLabel(diameter), "diameter");
    assert(result.document.quantities.some((quantity) => quantity.id === radius.id && quantity.value === 70 && quantity.unit === "mm") &&
      result.document.quantities.some((quantity) => quantity.id === diameter.id && quantity.value === 14 && quantity.unit === "cm"), "Original source values and units must survive normalization.");
  });
  check(`${kind} contradictory radius and diameter`, () => {
    const quantities = [{ id: "radius", symbol: "r", value: 70, unit: "mm" }, { id: "diameter", symbol: "D", value: 15, unit: "cm" }];
    assert(solidFigureParts(kind, quantities) === null, "Contradictory radius/diameter bindings must fail closed.");
    const question = `A ${kind} has radius r = 70 mm and diameter D = 15 cm.`;
    assert(synthesizeFamilyScene({ question, families: ["solid_figure"], turnPlan: makePlan(question, quantities) }) === null,
      "Single-solid synthesis must not fall back to a partial contradictory scene.");
  });
}

check("unrelated quantity ownership", () => {
  const parts = solidFigureParts("cylinder", [
    { id: "orbit_radius", symbol: "r", value: 3, unit: "cm" },
    { id: "displacement", symbol: "d", value: 13, unit: "cm" },
    { id: "radius", symbol: "r", value: 5, unit: "cm" },
    { id: "height", symbol: "h", value: 8, unit: "cm" },
  ]);
  assert(parts, "Unrelated scalar quantities must not prevent a supported solid binding.");
  assert(parts.constructions.find((construction) => construction.operator === "solid_projection")?.inputs.radius === 5,
    "An orbit radius must never override the actual solid radius.");
  assert(!parts.quantities.some((quantity) => ["orbit_radius", "displacement"].includes(quantity.id)), "Unrelated r/d symbols must not become solid measurements.");
});

check("foreign shorthand and external-radius ownership", () => {
  for (const id of ["sphere_r", "sphere_external_radius"]) {
    const quantities = [{ id: "cylinder_diameter", symbol: "D", value: 14, unit: "cm" }, { id, symbol: "r", value: 0.7, unit: "cm" }];
    const question = "Spheres have radius r = 0.7 cm and are submerged in a cylinder with diameter D = 14 cm.";
    assert(synthesizeFamilyScene({ question, families: ["solid_figure"], turnPlan: makePlan(question, quantities) }) === null,
      `Foreign measurement ${id} must not be omitted by a single-cylinder family.`);
  }
});

check("contradictory duplicate diameter aliases", () => {
  const quantities = [{ id: "diameter", symbol: "D", value: 14, unit: "cm" }, { id: "outer_diameter", symbol: "Dout", value: 15, unit: "cm" }];
  const question = "A cylinder has diameter D = 14 cm and outer diameter Dout = 15 cm.";
  assert(synthesizeFamilyScene({ question, families: ["solid_figure"], turnPlan: makePlan(question, quantities) }) === null,
    "Conflicting primary diameter aliases must fail closed, never select one value silently.");
});

check("hollow cylinder outer diameter and explicit inner radius", () => {
  const diameter = { id: "outer_diameter", symbol: "D", value: 14, unit: "cm" };
  const innerRadius = { id: "inner_radius", symbol: "r", value: 30, unit: "mm" };
  const height = { id: "height", symbol: "h", value: 8, unit: "cm" };
  const question = "A hollow cylinder has outer diameter D = 14 cm, inner radius r = 30 mm and height h = 8 cm.";
  const result = synthesizeFamilyScene({ question, families: ["solid_figure"], turnPlan: makePlan(question, [diameter, innerRadius, height]) });
  assert(result, "A hollow cylinder with outer diameter and explicit inner radius must compile every measurement.");
  verifyMeasurement(result.renderScene, "cylinder", sourceLabel(diameter), "diameter");
  const primitives = result.renderScene.primitives;
  assert(primitives.some((primitive) => primitive.kind === "label" && primitive.text === sourceLabel(height)), "The given cylinder height label must remain visible.");
  const innerLabel = primitives.find((primitive) => primitive.kind === "label" && primitive.text === sourceLabel(innerRadius));
  assert(innerLabel, "The inner radius must retain its original value and unit.");
  const innerBar = primitives.find((primitive) => primitive.entityId === innerLabel.entityId && primitive.provenance?.measurementRole === "bar");
  assert(innerBar, "The inner radius must own an exact dimension.");
  const center = measuredPoint(innerBar.provenance?.measuredStart);
  const rim = measuredPoint(innerBar.provenance?.measuredEnd);
  const innerContour = primitives.filter((primitive) => primitive.entityId === "inner_solid" && primitive.kind !== "label").flatMap((primitive) => primitive.points);
  assert(innerContour.length > 0 && innerContour.some((point) => samePoint(point, rim)), "The inner radius endpoint must lie exactly on the inner cylinder rim.");
  const innerMinX = Math.min(...innerContour.map((point) => point.x));
  const innerMaxX = Math.max(...innerContour.map((point) => point.x));
  assert(Math.abs(center.x - (innerMinX + innerMaxX) / 2) < 0.02 && Math.abs(center.y - rim.y) < 0.02,
    "The inner radius must start at the centre of its own circular face.");
  assert(Math.abs(Math.abs(rim.x - center.x) - (innerMaxX - innerMinX) / 2) < 0.02, "The inner radius must span exactly centre to inner rim.");
  const outerContour = primitives.filter((primitive) => primitive.entityId === "solid" && primitive.kind !== "label").flatMap((primitive) => primitive.points);
  const outerWidth = Math.max(...outerContour.map((point) => point.x)) - Math.min(...outerContour.map((point) => point.x));
  assert(Math.abs((innerMaxX - innerMinX) - outerWidth * 3 / 7) < 0.02, "Mixed-unit inner radius and outer diameter must preserve the physical 3:7 radius ratio within endpoint rounding.");
  const witnesses = primitives.filter((primitive) => primitive.entityId === innerBar.entityId && primitive.provenance?.measurementRole === "witness");
  assert(witnesses.length === 2 && witnesses.some((primitive) => samePoint(primitive.points[0]!, center)) && witnesses.some((primitive) => samePoint(primitive.points[0]!, rim)),
    "The inner radius must retain both exact endpoint witnesses.");
});

check("composite quantity ownership", () => {
  const quantities = [
    { id: "sphere_radius", symbol: "r", value: 0.7, unit: "cm" },
    { id: "cylinder_diameter", symbol: "D", value: 14, unit: "cm" },
    { id: "water_rise", symbol: "Δh", value: 3.5, unit: "cm" },
  ];
  const question = "Small spheres each of radius r = 0.7 cm are submerged in a cylindrical vessel of diameter D = 14 cm; water rises by 3.5 cm.";
  assert(synthesizeFamilyScene({ question, families: ["solid_figure"], turnPlan: makePlan(question, quantities) }) === null,
    "A single-solid family must reject composite bindings rather than mark sphere radius or water rise on the vessel.");
});

check("source frustum missing second radius", () => {
  const question = "A frustum has radius 5 cm and height 6 cm. Find its volume.";
  const quantities = [{ id: "radius", symbol: "r", value: 5, unit: "cm" }, { id: "height", symbol: "h", value: 6, unit: "cm" }];
  const result = synthesizeFamilyScene({ question, families: ["solid_figure"], turnPlan: makePlan(question, quantities) });
  assert(!result?.document.constructions.some((construction) => construction.operator === "solid_projection"), "A quantity fallback must not invent the frustum's unstated second radius.");
});

for (const [kind, question] of [
  ["cube", "A cube has edge 5 cm. Find its volume."],
  ["cuboid", "A cuboid has length 8 cm, width 5 cm and height 3 cm. Find its volume."],
  ["prism", "A regular hexagonal prism has base side 4 cm and height 10 cm. Find its volume."],
  ["pyramid", "A square pyramid has base side 6 cm and height 4 cm. Find its volume."],
] as const) {
  check(`${kind} actual height endpoints`, () => {
    const result = synthesizeFamilyScene({ question, families: ["solid_figure"] });
    assert(result, `${kind} must retain a readable source-grounded height.`);
    const projection = result.document.constructions.find((construction) => construction.operator === "solid_projection" && construction.inputs.kind === "polyhedron");
    assert(projection, "The height must belong to a source-defined polyhedron.");
    const contours = result.renderScene.primitives.filter((primitive) => primitive.entityId === projection.outputs[0] && primitive.kind === "polyline");
    const height = result.renderScene.primitives.find((primitive) => primitive.entityId === `${kind}_h` && primitive.provenance?.measurementRole === "bar");
    assert(height, "The source height must own an exact measurement.");
    const a = measuredPoint(height.provenance?.measuredStart);
    const b = measuredPoint(height.provenance?.measuredEnd);
    if (projection.inputs.topScale === 1) {
      const maxX = Math.max(...contours.flatMap((primitive) => primitive.points.map((point) => point.x)));
      assert(Math.abs(a.x - maxX) < 0.02 && Math.abs(b.x - maxX) < 0.02, "A prism height must follow its actual rightmost vertex, never an off-figure line.");
      assert(contours.some((primitive) => primitive.points.length === 2 &&
        ((samePoint(primitive.points[0]!, a) && samePoint(primitive.points[1]!, b)) || (samePoint(primitive.points[0]!, b) && samePoint(primitive.points[1]!, a)))),
      "A prism height must join matching base and top vertices of the rendered solid.");
    } else {
      const base = contours.find((primitive) => primitive.points.length > 2 && samePoint(primitive.points[0]!, primitive.points.at(-1)!));
      assert(base, "A pyramid must retain its actual base contour.");
      const vertices = base.points.slice(0, -1);
      const center = vertices.reduce((sum, point) => ({ x: sum.x + point.x / vertices.length, y: sum.y + point.y / vertices.length }), { x: 0, y: 0 });
      assert(samePoint(a, center) && Math.abs(a.x - b.x) < 0.02, "A pyramid height must start at its true base centre and stay on the axis.");
      assert(contours.some((primitive) => primitive.points.length === 2 && samePoint(primitive.points[1]!, b)), "A pyramid height must end at the actual apex, never on a slant edge.");
    }
    const witnesses = result.renderScene.primitives.filter((primitive) => primitive.entityId === height.entityId && primitive.provenance?.measurementRole === "witness");
    assert(witnesses.length === 2 && witnesses.some((primitive) => samePoint(primitive.points[0]!, a)) && witnesses.some((primitive) => samePoint(primitive.points[0]!, b)), "Polyhedral height witnesses must retain both true physical endpoints.");
  });
}

if (failures.length) throw new Error(`verify-solid-measurement-bindings: ${failures.length}/${checks} failed\n${failures.join("\n")}`);
console.log(`verify-solid-measurement-bindings: ${checks} exact radius/diameter and quantity ownership checks passed`);
