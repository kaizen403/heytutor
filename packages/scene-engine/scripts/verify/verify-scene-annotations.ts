import {
  compileSceneDocument,
  validateSceneDocument,
  type SceneDocument,
} from "../../src/index";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function baseScene(overrides: Partial<SceneDocument>): SceneDocument {
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "annotation verify" },
    source: { question: "Mark points A and B on segment AB." },
    quantities: [],
    entities: [
      { id: "a", kind: "point", role: "vertex", label: "A" },
      { id: "b", kind: "point", role: "vertex", label: "B" },
      { id: "ab", kind: "segment", role: "edge" },
    ],
    constructions: [
      { id: "make_a", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] },
      { id: "make_b", operator: "point", inputs: { x: 4, y: 0 }, outputs: ["b"] },
      { id: "make_ab", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["ab"] },
    ],
    relations: [],
    assertions: [],
    annotations: [],
    requiredEntityIds: ["a", "b", "ab"],
    revealGroups: [
      { id: "setup", entityIds: ["a", "b", "ab"], dependsOn: [], narrationCue: "draw AB" },
    ],
    teachingTimeline: [
      { id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "draw AB" },
    ],
    ...overrides,
  };
}

function compile(document: SceneDocument) {
  const validated = validateSceneDocument(document);
  assert(validated.document !== null, `schema: ${JSON.stringify(validated.report.issues)}`);
  const compiled = compileSceneDocument(validated.document!);
  assert(compiled.ok && compiled.renderScene !== null, `compile: ${JSON.stringify(compiled.report.issues)}`);
  return compiled.renderScene!;
}

const unknown = validateSceneDocument(baseScene({
  annotations: [{ id: "bad", kind: "spotlight", targetIds: ["a"] }],
}));
assert(
  unknown.document === null && unknown.report.issues.some((issue) => issue.code === "unknown_annotation_kind"),
  "unknown annotation kinds must fail closed",
);

const enclosed = compile(baseScene({
  annotations: [{ id: "ring_a", kind: "enclose", targetIds: ["a"] }],
}));
assert(
  enclosed.primitives.some((primitive) => primitive.provenance?.annotation === "enclose"),
  "enclose must compile a ring around the target",
);

const highlighted = compile(baseScene({
  entities: [
    { id: "a", kind: "point", role: "corner" },
    { id: "b", kind: "point", role: "corner" },
    { id: "c", kind: "point", role: "corner" },
    { id: "d", kind: "point", role: "corner" },
    { id: "region", kind: "polygon", role: "area" },
  ],
  constructions: [
    { id: "make_a", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] },
    { id: "make_b", operator: "point", inputs: { x: 3, y: 0 }, outputs: ["b"] },
    { id: "make_c", operator: "point", inputs: { x: 3, y: 2 }, outputs: ["c"] },
    { id: "make_d", operator: "point", inputs: { x: 0, y: 2 }, outputs: ["d"] },
    { id: "make_region", operator: "polygon", inputs: { points: ["a", "b", "c", "d"] }, outputs: ["region"] },
  ],
  annotations: [{ id: "shade", kind: "highlight", targetIds: ["region"], style: { transient: false } }],
  requiredEntityIds: ["a", "b", "c", "d", "region"],
  revealGroups: [
    { id: "setup", entityIds: ["a", "b", "c", "d", "region"], dependsOn: [], narrationCue: "region" },
  ],
}));
assert(
  highlighted.primitives.some((primitive) => primitive.provenance?.annotation === "highlight"),
  "highlight must compile a filled region",
);

const ticks = compile(baseScene({
  annotations: [{ id: "eq", kind: "equal_tick", targetIds: ["ab"], style: { count: 2 } }],
}));
assert(
  ticks.primitives.filter((primitive) => primitive.provenance?.annotation === "equal_tick").length === 2,
  "equal_tick count 2 must emit two tick strokes",
);

const hatched = compile(baseScene({
  annotations: [{ id: "rough", kind: "hatch", targetIds: ["ab"] }],
}));
assert(
  hatched.primitives.some((primitive) => primitive.provenance?.annotation === "hatch"),
  "hatch must mark a segment",
);

const braced = compile(baseScene({
  annotations: [{ id: "span", kind: "brace", targetIds: ["ab"], text: "d" }],
}));
assert(
  braced.primitives.some((primitive) => primitive.provenance?.annotation === "brace" && primitive.kind === "polyline"),
  "brace must follow the span",
);

const parallel = compile(baseScene({
  annotations: [{ id: "par", kind: "parallel_mark", targetIds: ["ab"], style: { count: 1 } }],
}));
assert(
  parallel.primitives.some((primitive) => primitive.provenance?.annotation === "parallel_mark"),
  "parallel_mark must emit chevrons",
);

const openEnd = compile(baseScene({
  annotations: [{ id: "open_a", kind: "endpoint", targetIds: ["a"], style: { pointStyle: "open" } }],
}));
assert(
  openEnd.primitives.some((primitive) => primitive.provenance?.pointStyle === "open"),
  "endpoint open must restyle the point",
);

const badged = compile(baseScene({
  annotations: [{ id: "step1", kind: "badge", targetIds: ["a"], text: "1" }],
}));
assert(
  badged.primitives.some((primitive) => primitive.provenance?.annotation === "badge"),
  "badge must mark a sequence point",
);

const spun = compile(baseScene({
  annotations: [{ id: "torque", kind: "spin", targetIds: ["ab"], text: "clockwise" }],
}));
assert(
  spun.primitives.some((primitive) => primitive.provenance?.annotation === "spin"),
  "spin must compile a rotation mark",
);

const looped = compile(baseScene({
  entities: [
    { id: "a", kind: "point", role: "vertex", label: "A" },
    { id: "b", kind: "point", role: "vertex", label: "B" },
    { id: "c", kind: "point", role: "vertex", label: "C" },
    { id: "ab", kind: "segment", role: "side" },
    { id: "bc", kind: "segment", role: "side" },
    { id: "ca", kind: "segment", role: "side" },
    { id: "tri", kind: "polygon", role: "face" },
  ],
  constructions: [
    { id: "make_a", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] },
    { id: "make_b", operator: "point", inputs: { x: 3, y: 0 }, outputs: ["b"] },
    { id: "make_c", operator: "point", inputs: { x: 1.5, y: 2 }, outputs: ["c"] },
    { id: "make_ab", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["ab"] },
    { id: "make_bc", operator: "segment", inputs: { start: "b", end: "c" }, outputs: ["bc"] },
    { id: "make_ca", operator: "segment", inputs: { start: "c", end: "a" }, outputs: ["ca"] },
    { id: "make_tri", operator: "polygon", inputs: { points: ["a", "b", "c"] }, outputs: ["tri"] },
  ],
  annotations: [{ id: "mesh", kind: "loop", targetIds: ["tri"] }],
  requiredEntityIds: ["a", "b", "c", "ab", "bc", "ca", "tri"],
  revealGroups: [
    { id: "setup", entityIds: ["a", "b", "c", "ab", "bc", "ca", "tri"], dependsOn: [], narrationCue: "triangle" },
  ],
}));
assert(
  looped.primitives.some((primitive) => primitive.provenance?.annotation === "loop"),
  "loop must follow the closed route",
);

const axis = compile(baseScene({
  entities: [
    { id: "left", kind: "point", role: "axis end" },
    { id: "right", kind: "point", role: "axis end" },
    { id: "F", kind: "point", role: "focal point", label: "F" },
    { id: "axis", kind: "segment", role: "principal axis" },
  ],
  constructions: [
    { id: "make_left", operator: "point", inputs: { x: -4, y: 0 }, outputs: ["left"] },
    { id: "make_right", operator: "point", inputs: { x: 4, y: 0 }, outputs: ["right"] },
    { id: "make_f", operator: "point", inputs: { x: 1, y: 0 }, outputs: ["F"] },
    { id: "make_axis", operator: "segment", inputs: { start: "left", end: "right" }, outputs: ["axis"] },
  ],
  assertions: [
    { id: "label_F", predicate: "label_attached", entities: ["F"], expected: true, severity: "fatal" },
  ],
  requiredEntityIds: ["left", "right", "F", "axis"],
  revealGroups: [
    { id: "setup", entityIds: ["left", "right", "F", "axis"], dependsOn: [], narrationCue: "axis" },
  ],
}));
const focus = axis.primitives.find((primitive) => primitive.kind === "point" && primitive.entityId === "F")?.points[0];
const focusLabel = axis.primitives.find((primitive) => primitive.kind === "label" && primitive.entityId === "F")?.points[0];
assert(Boolean(focus && focusLabel), "focus must stay labeled");
assert(
  Math.abs((focusLabel?.y ?? 0) - (focus?.y ?? 0)) > 8,
  "F must sit off the principal axis, not on it",
);

const angled = compile(baseScene({
  entities: [
    { id: "a", kind: "point", role: "vertex" },
    { id: "b", kind: "point", role: "vertex", label: "B" },
    { id: "c", kind: "point", role: "vertex", label: "C" },
    { id: "ab", kind: "segment", role: "arm" },
    { id: "ac", kind: "segment", role: "arm" },
    { id: "ang", kind: "angle_mark", role: "angle at A" },
  ],
  constructions: [
    { id: "make_a", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] },
    { id: "make_b", operator: "point", inputs: { x: 3, y: 0 }, outputs: ["b"] },
    { id: "make_c", operator: "point", inputs: { x: 1, y: 2 }, outputs: ["c"] },
    { id: "make_ab", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["ab"] },
    { id: "make_ac", operator: "segment", inputs: { start: "a", end: "c" }, outputs: ["ac"] },
    { id: "make_ang", operator: "angle_mark", inputs: { vertex: "a", a: "b", b: "c" }, outputs: ["ang"] },
  ],
  requiredEntityIds: ["b", "c", "ab", "ac", "ang"],
  revealGroups: [
    { id: "setup", entityIds: ["b", "c", "ab", "ac", "ang"], dependsOn: [], narrationCue: "angle" },
  ],
}));
assert(
  angled.primitives.some((primitive) => primitive.kind === "point" && primitive.entityId === "a"),
  "angle vertices must receive a visible point mark",
);

const equalArc = compile(baseScene({
  entities: [
    { id: "a", kind: "point", role: "vertex", label: "A" },
    { id: "b", kind: "point", role: "vertex", label: "B" },
    { id: "c", kind: "point", role: "vertex", label: "C" },
    { id: "ab", kind: "segment", role: "arm" },
    { id: "ac", kind: "segment", role: "arm" },
    { id: "ang", kind: "angle_mark", role: "angle at A" },
  ],
  constructions: [
    { id: "make_a", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] },
    { id: "make_b", operator: "point", inputs: { x: 3, y: 0 }, outputs: ["b"] },
    { id: "make_c", operator: "point", inputs: { x: 0, y: 3 }, outputs: ["c"] },
    { id: "make_ab", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["ab"] },
    { id: "make_ac", operator: "segment", inputs: { start: "a", end: "c" }, outputs: ["ac"] },
    { id: "make_ang", operator: "angle_mark", inputs: { vertex: "a", a: "b", b: "c", radius: 0.6 }, outputs: ["ang"] },
  ],
  annotations: [{ id: "arcs", kind: "equal_arc", targetIds: ["ang"], style: { count: 2 } }],
  requiredEntityIds: ["a", "b", "c", "ab", "ac", "ang"],
  revealGroups: [
    { id: "setup", entityIds: ["a", "b", "c", "ab", "ac", "ang"], dependsOn: [], narrationCue: "angle" },
  ],
}));
assert(
  equalArc.primitives.filter((primitive) => primitive.kind === "arc").length >= 2,
  "equal_arc count 2 must add a nested arc",
);

const sensed = compile(baseScene({
  annotations: [{ id: "flow", kind: "sense", targetIds: ["ab"] }],
}));
assert(
  sensed.primitives.some((primitive) => primitive.provenance?.annotation === "sense"),
  "sense must mark direction along a path",
);

const dropped = compile(baseScene({
  entities: [
    { id: "origin", kind: "point", role: "origin", label: "O" },
    { id: "sample", kind: "point", role: "sample", label: "P" },
    { id: "axes", kind: "axes", role: "plot axes" },
  ],
  constructions: [
    { id: "make_origin", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["origin"] },
    { id: "make_sample", operator: "point", inputs: { x: 2, y: 1.5 }, outputs: ["sample"] },
    { id: "make_axes", operator: "axes", inputs: { xMin: -1, xMax: 3, yMin: -1, yMax: 2 }, outputs: ["axes"] },
  ],
  annotations: [{ id: "ord", kind: "drop", targetIds: ["sample", "axes"] }],
  requiredEntityIds: ["origin", "sample", "axes"],
  revealGroups: [
    { id: "setup", entityIds: ["origin", "sample", "axes"], dependsOn: [], narrationCue: "plot" },
  ],
}));
assert(
  dropped.primitives.some((primitive) => primitive.provenance?.annotation === "drop"),
  "drop must drop an ordinate to the axes",
);

const ghosted = compile(baseScene({
  annotations: [{ id: "echo", kind: "ghost", targetIds: ["ab"] }],
}));
assert(
  ghosted.primitives.some((primitive) => primitive.provenance?.annotation === "ghost"),
  "ghost must clone the target as dashed ink",
);

const extended = compile(baseScene({
  annotations: [{ id: "continue", kind: "extend", targetIds: ["ab"] }],
}));
assert(
  extended.primitives.some((primitive) => primitive.provenance?.annotation === "extend"),
  "extend must continue the path",
);

const framed = compile(baseScene({
  annotations: [{ id: "nt", kind: "frame", targetIds: ["a", "ab"] }],
}));
assert(
  framed.primitives.filter((primitive) => primitive.provenance?.annotation === "frame").length >= 2,
  "frame must emit two local axes",
);

const poles = compile(baseScene({
  annotations: [{ id: "pm", kind: "polarity", targetIds: ["ab"], text: "-+" }],
}));
assert(
  poles.primitives.filter((primitive) => primitive.provenance?.annotation === "polarity" && primitive.kind === "label").length === 2,
  "polarity must mark both terminals",
);

const slope = compile(baseScene({
  entities: [
    { id: "p0", kind: "point", role: "start" },
    { id: "p1", kind: "point", role: "rise" },
    { id: "p2", kind: "point", role: "end" },
    { id: "graph", kind: "polyline", role: "v(t)" },
  ],
  constructions: [
    { id: "make_p0", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["p0"] },
    { id: "make_p1", operator: "point", inputs: { x: 2, y: 2 }, outputs: ["p1"] },
    { id: "make_p2", operator: "point", inputs: { x: 4, y: 2 }, outputs: ["p2"] },
    { id: "make_graph", operator: "polyline", inputs: { points: ["p0", "p1", "p2"] }, outputs: ["graph"] },
  ],
  annotations: [{ id: "rise", kind: "slope_triangle", targetIds: ["graph"] }],
  requiredEntityIds: ["p0", "p1", "p2", "graph"],
  revealGroups: [
    { id: "setup", entityIds: ["p0", "p1", "p2", "graph"], dependsOn: [], narrationCue: "graph" },
  ],
}));
assert(
  slope.primitives.some((primitive) => primitive.provenance?.annotation === "slope_triangle"),
  "slope_triangle must sit on the rising chord",
);

console.log("verify-scene-annotations: enclose/highlight/ticks/hatch/brace/parallel/endpoint/badge/spin/loop/sense/drop/ghost/extend/frame/polarity/slope passed");
