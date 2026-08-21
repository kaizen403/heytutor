/**
 * Compile oracles for every pinned math/physics eval question.
 * These are never selected at runtime. They certify that the demanded operators
 * compose and compile, so coverage cannot be claimed from operator names alone.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Entity = { id: string; kind: string; role: string; label?: string };
export type Construction = { id: string; operator: string; inputs: Record<string, unknown>; outputs: string[] };
export type Assertion = {
  id: string;
  predicate: string;
  entities: string[];
  expected: unknown;
  severity: "fatal";
  tolerance?: number;
};

export function scene(
  question: string,
  entities: Entity[],
  constructions: Construction[],
  assertions: Assertion[] = [],
): Record<string, unknown> {
  const entityIds = entities.map((entity) => entity.id);
  for (const construction of constructions) {
    if (construction.operator !== "label") continue;
    const text = construction.inputs.text;
    const output = construction.outputs[0];
    const entity = entities.find((candidate) => candidate.id === output);
    if (entity && typeof text === "string") entity.label = text;
  }
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "evaluation compile oracle" },
    source: { question },
    quantities: [],
    entities,
    constructions,
    relations: [],
    assertions,
    annotations: [],
    requiredEntityIds: entityIds,
    revealGroups: [{ id: "setup", entityIds, dependsOn: [], narrationCue: "setup" }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "setup" }],
  };
}

export function pt(id: string, x: number, y: number, role = "point", label?: string): { entity: Entity; construction: Construction } {
  return {
    entity: { id, kind: "point", role, ...(label ? { label } : {}) },
    construction: { id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: [id] },
  };
}

function gather(parts: Array<{ entity: Entity; construction: Construction }>): { entities: Entity[]; constructions: Construction[] } {
  return {
    entities: parts.map((part) => part.entity),
    constructions: parts.map((part) => part.construction),
  };
}

function loadJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), relativePath), "utf8")) as Record<string, unknown>;
}

export function circuit(
  question: string,
  nodes: Array<{ id: string; x: number; y: number }>,
  symbols: Array<{ id: string; symbol: string; start: string; end: string; role: string }>,
  extra: {
    connectors?: Array<{ id: string; start: string; end: string }>;
    extraEntities?: Entity[];
    extraConstructions?: Construction[];
    assertions?: Assertion[];
  } = {},
): Record<string, unknown> {
  const nodeParts = nodes.map((node) => pt(node.id, node.x, node.y, "node"));
  const symbolEntities: Entity[] = symbols.map((item) => ({ id: item.id, kind: "component", role: item.role }));
  const symbolConstructions: Construction[] = symbols.map((item) => ({
    id: `make_${item.id}`,
    operator: "symbol",
    inputs: { symbol: item.symbol, start: item.start, end: item.end },
    outputs: [item.id],
  }));
  const connectorEntities: Entity[] = (extra.connectors ?? []).map((item) => ({ id: item.id, kind: "connector", role: "wire" }));
  const connectorConstructions: Construction[] = (extra.connectors ?? []).map((item) => ({
    id: `make_${item.id}`,
    operator: "connect",
    inputs: { start: item.start, end: item.end },
    outputs: [item.id],
  }));
  const packed = gather(nodeParts);
  return scene(
    question,
    [...packed.entities, ...symbolEntities, ...connectorEntities, ...(extra.extraEntities ?? [])],
    [...packed.constructions, ...symbolConstructions, ...connectorConstructions, ...(extra.extraConstructions ?? [])],
    extra.assertions ?? [],
  );
}

export function energyDiagram(
  question: string,
  levels: Array<{ id: string; y: number; label: string }>,
  transition: { from: string; to: string },
): Record<string, unknown> {
  const axes: Entity = { id: "axes", kind: "axes", role: "energy axis" };
  const levelEntities: Entity[] = levels.map((level) => ({ id: level.id, kind: "segment", role: "energy level", label: level.label }));
  const from = levels.find((level) => level.id === transition.from)!;
  const to = levels.find((level) => level.id === transition.to)!;
  return scene(question, [
    axes,
    ...levelEntities,
    { id: "photon", kind: "vector", role: "transition" },
    { id: "gap", kind: "dimension", role: "energy difference" },
    { id: "photon_label", kind: "label", role: "transition label" },
    { id: "from_pt", kind: "point", role: "upper level sample" },
    { id: "to_pt", kind: "point", role: "lower level sample" },
    { id: "mid_pt", kind: "point", role: "between levels" },
    { id: "unit_top", kind: "point", role: "unit reference top" },
    { id: "unit_bot", kind: "point", role: "unit reference bottom" },
  ], [
    { id: "make_axes", operator: "axes", inputs: { xMin: -1, xMax: 4, yMin: -1, yMax: 5 }, outputs: ["axes"] },
    ...levels.map((level) => ({
      id: `make_${level.id}`,
      operator: "segment" as const,
      inputs: { start: { x: 0, y: level.y, coordinateSpace: "world" }, end: { x: 3, y: level.y, coordinateSpace: "world" } },
      outputs: [level.id],
    })),
    {
      id: "make_photon",
      operator: "vector",
      inputs: { start: { x: 1.5, y: from.y, coordinateSpace: "world" }, end: { x: 1.5, y: to.y, coordinateSpace: "world" } },
      outputs: ["photon"],
    },
    {
      id: "make_gap",
      operator: "dimension",
      inputs: { start: { x: 3.2, y: from.y, coordinateSpace: "world" }, end: { x: 3.2, y: to.y, coordinateSpace: "world" } },
      outputs: ["gap"],
    },
    { id: "make_label", operator: "label", inputs: { target: "photon", text: "hν" }, outputs: ["photon_label"] },
    { id: "make_from_pt", operator: "point", inputs: { x: 0, y: from.y, coordinateSpace: "world" }, outputs: ["from_pt"] },
    { id: "make_to_pt", operator: "point", inputs: { x: 0, y: to.y, coordinateSpace: "world" }, outputs: ["to_pt"] },
    { id: "make_mid_pt", operator: "point", inputs: { x: 0, y: (from.y + to.y) / 2, coordinateSpace: "world" }, outputs: ["mid_pt"] },
    { id: "make_unit_top", operator: "point", inputs: { x: 3.5, y: 1, coordinateSpace: "world" }, outputs: ["unit_top"] },
    { id: "make_unit_bot", operator: "point", inputs: { x: 3.5, y: 0, coordinateSpace: "world" }, outputs: ["unit_bot"] },
  ], [
    { id: "levels_parallel", predicate: "parallel", entities: [from.id, to.id], expected: true, severity: "fatal" },
    { id: "transition_connected", predicate: "connected", entities: ["photon", from.id], expected: true, severity: "fatal" },
    { id: "mid_between", predicate: "between", entities: ["mid_pt", "from_pt", "to_pt"], expected: true, severity: "fatal" },
    { id: "gap_ratio", predicate: "distance_ratio", entities: ["from_pt", "to_pt", "unit_top", "unit_bot"], expected: Math.abs(from.y - to.y), severity: "fatal" },
  ]);
}

export function concaveMirrorOracle(): Record<string, unknown> {
  const golden = loadJson("../../fixtures/golden/optics-concave-mirror-u20-f15.json");
  const document = golden.sceneDocument as Record<string, unknown>;
  const entities = [...(document.entities as Entity[])];
  const constructions = [...(document.constructions as Construction[])];
  entities.push(
    { id: "axis_line", kind: "line", role: "principal axis line" },
    { id: "u_dim", kind: "dimension", role: "object distance" },
    { id: "F_label", kind: "label", role: "focus label", label: "F" },
  );
  constructions.push(
    { id: "make_axis_line", operator: "line", inputs: { start: "left_axis", end: "right_axis" }, outputs: ["axis_line"] },
    { id: "make_u_dim", operator: "dimension", inputs: { start: "object_base", end: "P" }, outputs: ["u_dim"] },
    { id: "make_F_label", operator: "label", inputs: { target: "F", text: "F" }, outputs: ["F_label"] },
  );
  return {
    ...document,
    entities,
    constructions,
    requiredEntityIds: [...(document.requiredEntityIds as string[]), "axis_line", "u_dim", "F_label"],
    assertions: [
      ...(document.assertions as Assertion[]),
      { id: "object_on_axis", predicate: "on", entities: ["object_base", "axis"], expected: true, severity: "fatal" },
      { id: "incident_on_axis", predicate: "incident", entities: ["object_base", "axis"], expected: true, severity: "fatal" },
    ],
  };
}

export const EVALUATION_COMPILE_PROBES: Record<string, Record<string, unknown>> = {
  "function-roots-parabola": scene(
    "Sketch y = x^2 - 4, mark every x-intercept and the vertex.",
    [
      { id: "axes", kind: "axes", role: "axes" },
      { id: "curve", kind: "polyline", role: "function graph" },
      { id: "vertex", kind: "point", role: "vertex", label: "V" },
      { id: "vertex_label", kind: "label", role: "vertex label" },
    ],
    [
      { id: "make_axes", operator: "axes", inputs: { xMin: -4, xMax: 4, yMin: -5, yMax: 5 }, outputs: ["axes"] },
      { id: "make_curve", operator: "function_curve", inputs: { expression: "x^2 - 4", xMin: -4, xMax: 4, samples: 65 }, outputs: ["curve"] },
      { id: "make_vertex", operator: "point", inputs: { x: 0, y: -4, coordinateSpace: "world" }, outputs: ["vertex"] },
      { id: "make_vertex_label", operator: "label", inputs: { target: "vertex", text: "V" }, outputs: ["vertex_label"] },
    ],
    [
      { id: "left_root", predicate: "root", entities: ["curve"], expected: -2, severity: "fatal" },
      { id: "right_root", predicate: "root", entities: ["curve"], expected: 2, severity: "fatal" },
      { id: "vertex_value", predicate: "function_value", entities: ["curve"], expected: { x: 0, y: -4 }, severity: "fatal" },
    ],
  ),

  "function-area-parabola-line": scene(
    "The curve y = x^2 and the line y = 4 enclose a region. Sketch it.",
    [
      { id: "axes", kind: "axes", role: "axes" },
      { id: "lower", kind: "polyline", role: "parabola" },
      { id: "upper", kind: "polyline", role: "line y=4" },
      { id: "region", kind: "polygon", role: "enclosed region" },
      { id: "slice", kind: "segment", role: "representative slice" },
      { id: "low", kind: "point", role: "lower sample" },
      { id: "mid", kind: "point", role: "interior sample" },
      { id: "high", kind: "point", role: "upper sample" },
    ],
    [
      { id: "make_axes", operator: "axes", inputs: { xMin: -3, xMax: 3, yMin: -1, yMax: 5 }, outputs: ["axes"] },
      { id: "make_lower", operator: "function_curve", inputs: { expression: "x^2", xMin: -2.5, xMax: 2.5, samples: 65 }, outputs: ["lower"] },
      { id: "make_upper", operator: "function_curve", inputs: { expression: "4", xMin: -2.5, xMax: 2.5, samples: 65 }, outputs: ["upper"] },
      { id: "make_region", operator: "function_region", inputs: { upper: "upper", lower: "lower", xMin: -2, xMax: 2, samples: 65 }, outputs: ["region"] },
      { id: "make_slice", operator: "representative_slice", inputs: { upper: "upper", lower: "lower", atX: 0 }, outputs: ["slice"] },
      { id: "make_low", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["low"] },
      { id: "make_mid", operator: "point", inputs: { x: 0, y: 2, coordinateSpace: "world" }, outputs: ["mid"] },
      { id: "make_high", operator: "point", inputs: { x: 0, y: 4, coordinateSpace: "world" }, outputs: ["high"] },
    ],
    [
      { id: "parabola_root", predicate: "root", entities: ["lower"], expected: 0, severity: "fatal" },
      { id: "meet_left", predicate: "function_value", entities: ["lower"], expected: { x: -2, y: 4 }, severity: "fatal" },
      { id: "interior", predicate: "between", entities: ["mid", "low", "high"], expected: true, severity: "fatal" },
    ],
  ),

  "function-parametric-tangent": scene(
    "For x = t^2 - 1 and y = t^3 - t, sketch the curve near t = 2 and draw the tangent.",
    [
      { id: "axes", kind: "axes", role: "axes" },
      { id: "curve", kind: "polyline", role: "parametric curve" },
      { id: "contact", kind: "point", role: "point at t=2" },
      { id: "tangent", kind: "line", role: "tangent" },
    ],
    [
      { id: "make_axes", operator: "axes", inputs: { xMin: -2, xMax: 6, yMin: -2, yMax: 8 }, outputs: ["axes"] },
      {
        id: "make_curve",
        operator: "parametric_curve",
        inputs: { xExpression: "t^2 - 1", yExpression: "t^3 - t", tMin: 0.5, tMax: 2.5, samples: 65 },
        outputs: ["curve"],
      },
      { id: "make_contact", operator: "point", inputs: { x: 3, y: 6, coordinateSpace: "world" }, outputs: ["contact"] },
      { id: "make_tangent", operator: "tangent_line", inputs: { curve: "curve", at: 2, span: 2 }, outputs: ["tangent"] },
    ],
    [
      { id: "on_curve", predicate: "function_value", entities: ["curve"], expected: { x: 3, y: 6, t: 2 }, severity: "fatal" },
      { id: "contact_on", predicate: "on", entities: ["contact", "curve"], expected: true, severity: "fatal" },
      { id: "contact_incident", predicate: "incident", entities: ["contact", "curve"], expected: true, severity: "fatal" },
    ],
  ),

  "differential-tangent-normal": scene(
    "Draw y = x^2 with its tangent and normal at x = 2.",
    [
      { id: "curve", kind: "polyline", role: "function graph" },
      { id: "tangent", kind: "line", role: "tangent" },
      { id: "normal", kind: "line", role: "normal" },
      { id: "contact", kind: "point", role: "contact" },
    ],
    [
      { id: "make_curve", operator: "function_curve", inputs: { expression: "x^2", xMin: 0, xMax: 4, samples: 65 }, outputs: ["curve"] },
      { id: "make_tangent", operator: "tangent_line", inputs: { curve: "curve", at: 2, span: 2 }, outputs: ["tangent"] },
      { id: "make_normal", operator: "normal_line", inputs: { curve: "curve", at: 2, span: 2 }, outputs: ["normal"] },
      { id: "make_contact", operator: "point", inputs: { x: 2, y: 4, coordinateSpace: "world" }, outputs: ["contact"] },
    ],
    [
      { id: "at_two", predicate: "function_value", entities: ["curve"], expected: { x: 2, y: 4 }, severity: "fatal" },
      { id: "contact_on_curve", predicate: "on", entities: ["contact", "curve"], expected: true, severity: "fatal" },
      { id: "perp", predicate: "perpendicular", entities: ["tangent", "normal"], expected: true, severity: "fatal" },
    ],
  ),

  "differential-polar-tangent": scene(
    "Sketch r = 2 cos(theta) and mark the tangent at theta = pi/3.",
    [
      { id: "axes", kind: "axes", role: "axes" },
      { id: "curve", kind: "polyline", role: "polar curve" },
      { id: "tangent", kind: "line", role: "tangent" },
      { id: "contact", kind: "point", role: "point at pi/3" },
    ],
    [
      { id: "make_axes", operator: "axes", inputs: { xMin: -0.5, xMax: 2.5, yMin: -1.5, yMax: 1.5 }, outputs: ["axes"] },
      {
        id: "make_curve",
        operator: "polar_curve",
        inputs: { radiusExpression: "2*cos(theta)", thetaMin: 0, thetaMax: 3.141592653589793, samples: 65 },
        outputs: ["curve"],
      },
      { id: "make_tangent", operator: "tangent_line", inputs: { curve: "curve", at: 1.0471975511965976, span: 1 }, outputs: ["tangent"] },
      { id: "make_contact", operator: "point", inputs: { x: 0.5, y: 0.86602540378, coordinateSpace: "world" }, outputs: ["contact"] },
    ],
    [
      { id: "contact_on", predicate: "on", entities: ["contact", "curve"], expected: true, tolerance: 0.01, severity: "fatal" },
      { id: "contact_incident", predicate: "incident", entities: ["contact", "curve"], expected: true, tolerance: 0.01, severity: "fatal" },
    ],
  ),

  "solid-disk-sqrt": scene(
    "The region under y = sqrt(x) from x = 0 to x = 4 is revolved about the x-axis.",
    [
      { id: "curve", kind: "polyline", role: "y=sqrt(x)" },
      { id: "axis", kind: "polyline", role: "y=0" },
      { id: "region", kind: "polygon", role: "region under the curve" },
      { id: "disk", kind: "polyline", role: "representative disk" },
      { id: "solid", kind: "polygon", role: "solid of revolution" },
      { id: "low", kind: "point", role: "axis sample" },
      { id: "mid", kind: "point", role: "disk interior" },
      { id: "high", kind: "point", role: "curve sample" },
    ],
    [
      { id: "make_curve", operator: "function_curve", inputs: { expression: "sqrt(x)", xMin: 0, xMax: 4, samples: 65 }, outputs: ["curve"] },
      { id: "make_axis", operator: "function_curve", inputs: { expression: "0", xMin: 0, xMax: 4, samples: 65 }, outputs: ["axis"] },
      { id: "make_region", operator: "function_region", inputs: { upper: "curve", lower: "axis", xMin: 0, xMax: 4, samples: 65 }, outputs: ["region"] },
      { id: "make_disk", operator: "representative_slice", inputs: { upper: "curve", lower: "axis", atX: 1, method: "disk", axisY: 0 }, outputs: ["disk"] },
      { id: "make_solid", operator: "solid_of_revolution", inputs: { profile: "curve", axisY: 0, xMin: 0, xMax: 4, samples: 65 }, outputs: ["solid"] },
      { id: "make_low", operator: "point", inputs: { x: 1, y: 0, coordinateSpace: "world" }, outputs: ["low"] },
      { id: "make_mid", operator: "point", inputs: { x: 1, y: 0.5, coordinateSpace: "world" }, outputs: ["mid"] },
      { id: "make_high", operator: "point", inputs: { x: 1, y: 1, coordinateSpace: "world" }, outputs: ["high"] },
    ],
    [
      { id: "at_four", predicate: "function_value", entities: ["curve"], expected: { x: 4, y: 2 }, severity: "fatal" },
      { id: "radius_between", predicate: "between", entities: ["mid", "low", "high"], expected: true, severity: "fatal" },
    ],
  ),

  "solid-washer-parabola-line": scene(
    "Revolve the region between y = 4 and y = x^2 about the x-axis.",
    [
      { id: "upper", kind: "polyline", role: "y=4" },
      { id: "lower", kind: "polyline", role: "y=x^2" },
      { id: "region", kind: "polygon", role: "region" },
      { id: "washer", kind: "polyline", role: "representative washer" },
      { id: "solid", kind: "polygon", role: "solid of revolution" },
      { id: "low", kind: "point", role: "inner radius" },
      { id: "mid", kind: "point", role: "washer interior" },
      { id: "high", kind: "point", role: "outer radius" },
    ],
    [
      { id: "make_upper", operator: "function_curve", inputs: { expression: "4", xMin: -2, xMax: 2, samples: 65 }, outputs: ["upper"] },
      { id: "make_lower", operator: "function_curve", inputs: { expression: "x^2", xMin: -2, xMax: 2, samples: 65 }, outputs: ["lower"] },
      { id: "make_region", operator: "function_region", inputs: { upper: "upper", lower: "lower", xMin: -2, xMax: 2, samples: 65 }, outputs: ["region"] },
      { id: "make_washer", operator: "representative_slice", inputs: { upper: "upper", lower: "lower", atX: 1, method: "washer", axisY: 0 }, outputs: ["washer"] },
      { id: "make_solid", operator: "solid_of_revolution", inputs: { profile: "upper", axisY: 0, xMin: -2, xMax: 2, samples: 65 }, outputs: ["solid"] },
      { id: "make_low", operator: "point", inputs: { x: 1, y: 1, coordinateSpace: "world" }, outputs: ["low"] },
      { id: "make_mid", operator: "point", inputs: { x: 1, y: 2.5, coordinateSpace: "world" }, outputs: ["mid"] },
      { id: "make_high", operator: "point", inputs: { x: 1, y: 4, coordinateSpace: "world" }, outputs: ["high"] },
    ],
    [
      { id: "meet", predicate: "root", entities: ["lower"], expected: 0, severity: "fatal" },
      { id: "washer_between", predicate: "between", entities: ["mid", "low", "high"], expected: true, severity: "fatal" },
    ],
  ),

  "mensuration-cylinder": (() => {
    const center = pt("center", 0, 0, "base center");
    return scene(
      "Draw a right circular cylinder of radius 3 cm and height 5 cm.",
      [
        center.entity,
        { id: "solid", kind: "polyline", role: "cylinder" },
        { id: "height_dim", kind: "dimension", role: "height" },
        { id: "radius_dim", kind: "dimension", role: "radius" },
        { id: "radius_label", kind: "label", role: "radius" },
        { id: "rim", kind: "point", role: "rim" },
        { id: "top", kind: "point", role: "top" },
      ],
      [
        center.construction,
        { id: "make_rim", operator: "point", inputs: { x: 3, y: 0, coordinateSpace: "world" }, outputs: ["rim"] },
        { id: "make_top", operator: "point", inputs: { x: 0, y: 5, coordinateSpace: "world" }, outputs: ["top"] },
        { id: "make_solid", operator: "solid_projection", inputs: { kind: "cylinder", center: "center", radius: 3, height: 5, axis: "vertical" }, outputs: ["solid"] },
        { id: "make_height_dim", operator: "dimension", inputs: { start: "center", end: "top" }, outputs: ["height_dim"] },
        { id: "make_radius_dim", operator: "dimension", inputs: { start: "center", end: "rim" }, outputs: ["radius_dim"] },
        { id: "make_radius_label", operator: "label", inputs: { target: "solid", text: "r=3" }, outputs: ["radius_label"] },
      ],
      [
        { id: "axis_perp_radius", predicate: "perpendicular", entities: ["height_dim", "radius_dim"], expected: true, severity: "fatal" },
        { id: "radii_equal", predicate: "equal_length", entities: ["center", "rim", "center", "rim"], expected: true, severity: "fatal" },
      ],
    );
  })(),

  "mensuration-frustum": (() => {
    const center = pt("center", 0, 0, "base center");
    return scene(
      "A right circular conical frustum has radii 5 cm and 2 cm and height 4 cm.",
      [
        center.entity,
        { id: "solid", kind: "polyline", role: "frustum" },
        { id: "section", kind: "polyline", role: "cross section" },
        { id: "height_dim", kind: "dimension", role: "height" },
        { id: "base_r", kind: "dimension", role: "base radius" },
        { id: "top_r", kind: "dimension", role: "top radius" },
      ],
      [
        center.construction,
        { id: "make_solid", operator: "solid_projection", inputs: { kind: "frustum", center: "center", radius: 5, topRadius: 2, height: 4, axis: "vertical" }, outputs: ["solid"] },
        { id: "make_section", operator: "solid_cross_section", inputs: { solid: "solid", at: 0.5, plane: "transverse" }, outputs: ["section"] },
        { id: "make_height_dim", operator: "dimension", inputs: { start: { x: 0, y: 0, coordinateSpace: "world" }, end: { x: 0, y: 4, coordinateSpace: "world" } }, outputs: ["height_dim"] },
        { id: "make_base_r", operator: "dimension", inputs: { start: { x: 0, y: 0, coordinateSpace: "world" }, end: { x: 5, y: 0, coordinateSpace: "world" } }, outputs: ["base_r"] },
        { id: "make_top_r", operator: "dimension", inputs: { start: { x: 0, y: 4, coordinateSpace: "world" }, end: { x: 2, y: 4, coordinateSpace: "world" } }, outputs: ["top_r"] },
      ],
      [
        { id: "axis_perp", predicate: "perpendicular", entities: ["height_dim", "base_r"], expected: true, severity: "fatal" },
        { id: "radii_parallel", predicate: "parallel", entities: ["base_r", "top_r"], expected: true, severity: "fatal" },
      ],
    );
  })(),

  "mensuration-composite-cap": (() => {
    const base = pt("base", 0, 0, "cylinder base");
    const join = pt("join", 0, 8, "join circle");
    const mid = pt("mid", 0, 4, "interior axis point");
    return scene(
      "A cylinder topped by a hemisphere of the same radius.",
      [
        base.entity,
        join.entity,
        mid.entity,
        { id: "cylinder", kind: "polyline", role: "cylinder" },
        { id: "cap", kind: "polyline", role: "hemisphere" },
        { id: "section", kind: "polyline", role: "cross section" },
        { id: "height_dim", kind: "dimension", role: "cylinder height" },
      ],
      [
        base.construction,
        join.construction,
        mid.construction,
        { id: "make_cylinder", operator: "solid_projection", inputs: { kind: "cylinder", center: "base", radius: 3, height: 8, axis: "vertical" }, outputs: ["cylinder"] },
        { id: "make_cap", operator: "solid_projection", inputs: { kind: "hemisphere", center: "join", radius: 3, axis: "vertical" }, outputs: ["cap"] },
        { id: "make_section", operator: "solid_cross_section", inputs: { solid: "cylinder", at: 0.5, plane: "transverse" }, outputs: ["section"] },
        { id: "make_height_dim", operator: "dimension", inputs: { start: "base", end: "join" }, outputs: ["height_dim"] },
      ],
      [
        { id: "join_connected", predicate: "connected", entities: ["join", "height_dim"], expected: true, severity: "fatal" },
        { id: "interior_same_side", predicate: "same_side", entities: ["base", "mid", "join"], expected: true, severity: "fatal" },
      ],
    );
  })(),

  "coordinate-right-triangle": (() => {
    const a = pt("a", 0, 0, "vertex", "A");
    const b = pt("b", 4, 0, "vertex", "B");
    const c = pt("c", 0, 3, "vertex", "C");
    return scene(
      "Plot A(0,0), B(4,0), and C(0,3), mark the right angle.",
      [
        { id: "axes", kind: "axes", role: "axes" },
        a.entity, b.entity, c.entity,
        { id: "triangle", kind: "polygon", role: "triangle ABC" },
        { id: "ab", kind: "segment", role: "AB" },
        { id: "ac", kind: "segment", role: "AC" },
        { id: "right", kind: "right_angle_mark", role: "right angle at A" },
      ],
      [
        { id: "make_axes", operator: "axes", inputs: { xMin: -1, xMax: 5, yMin: -1, yMax: 4 }, outputs: ["axes"] },
        a.construction, b.construction, c.construction,
        { id: "make_triangle", operator: "polygon", inputs: { points: ["a", "b", "c"] }, outputs: ["triangle"] },
        { id: "make_ab", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["ab"] },
        { id: "make_ac", operator: "segment", inputs: { start: "a", end: "c" }, outputs: ["ac"] },
        { id: "make_right", operator: "right_angle_mark", inputs: { vertex: "a", a: "b", b: "c" }, outputs: ["right"] },
      ],
      [
        { id: "right_angle", predicate: "perpendicular", entities: ["ab", "ac"], expected: true, severity: "fatal" },
        { id: "a_on_ab", predicate: "on", entities: ["a", "ab"], expected: true, severity: "fatal" },
      ],
    );
  })(),

  "coordinate-parabola-circle": scene(
    "Sketch y = x^2 and x^2 + (y - 3)^2 = 9 and mark every real intersection.",
    [
      { id: "axes", kind: "axes", role: "axes" },
      { id: "parabola", kind: "polyline", role: "y=x^2" },
      { id: "circle", kind: "polyline", role: "circle" },
      { id: "origin_hit", kind: "point", role: "intersection at origin" },
    ],
    [
      { id: "make_axes", operator: "axes", inputs: { xMin: -4, xMax: 4, yMin: -1, yMax: 7 }, outputs: ["axes"] },
      { id: "make_parabola", operator: "function_curve", inputs: { expression: "x^2", xMin: -3, xMax: 3, samples: 65 }, outputs: ["parabola"] },
      {
        id: "make_circle",
        operator: "implicit_curve",
        inputs: { expression: "x^2 + (y-3)^2 - 9", xMin: -4, xMax: 4, yMin: -1, yMax: 7, xSamples: 65, ySamples: 65 },
        outputs: ["circle"],
      },
      { id: "make_origin_hit", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["origin_hit"] },
    ],
    [
      { id: "parabola_origin", predicate: "function_value", entities: ["parabola"], expected: { x: 0, y: 0 }, severity: "fatal" },
      { id: "origin_on_circle", predicate: "on", entities: ["origin_hit", "circle"], expected: true, severity: "fatal" },
    ],
  ),
};
