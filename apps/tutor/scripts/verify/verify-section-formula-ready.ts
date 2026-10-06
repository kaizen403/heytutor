/**
 * Section formula through the live selection path.
 *
 * Families from inferSceneCapabilities, the figure from
 * selectVerifiedRepresentation, ink from buildVerifiedDiagramPresentation, as
 * useQuestionHandler does. Every section point, ratio and mode below was worked
 * by hand from the stem (P = (nA + mB)/(m + n) internally, (mB - nA)/(m - n)
 * externally); none is read back from the engine. Pixel positions are checked
 * against the drawn axes, and the caller admission must refuse a planner scene
 * whose endpoints, ratio or mode differ from the question even when its section
 * point is valid.
 */
import assert from "node:assert/strict";
import { validateTurnPlanSceneProofs, type SceneDocument } from "@heytutor/scene-engine";
import { inferSceneCapabilities, questionRequiresVisual } from "@heytutor/tutor-core";
import { verifiedDiagramHasDrawableInk } from "@heytutor/drawing";
import { selectVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { insideBoard, worldToPixel } from "./verify-circle-standard-ready";

interface SectionCase {
  id: string;
  question: string;
  a: [number, number];
  b: [number, number];
  aLabel: string;
  bLabel: string;
  mode: "internal" | "external" | "midpoint";
  /** Expected m:n in lowest terms (midpoint omits them). */
  ratio?: [number, number];
  point: [number, number];
  /** Directed parameter t with P = A + t(B - A). */
  t: number;
}

interface DeclineCase {
  id: string;
  question: string;
  why: string;
}

const PIXEL_TOLERANCE = 0.05;

function select(question: string) {
  const capabilities = inferSceneCapabilities(question, { lawIds: [], problemIR: null, turnPlan: null });
  return selectVerifiedRepresentation({ question, families: capabilities.families, problemIR: null, turnPlan: null });
}

function close(actual: number, expected: number, message: string): void {
  assert(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), `${message}: ${actual} != ${expected}`);
}

function checkSection(c: SectionCase): number {
  let checks = 0;
  assert(questionRequiresVisual(c.question), `${c.id}: a section question asks for a figure`);
  const selected = select(c.question);
  assert.equal(selected.sceneDocument.visualDecision.mode, "scene", `${c.id}: ${selected.reason}`);
  assert.equal(selected.family, "coordinate_figure", `${c.id}: family`);
  // The figure carries a fatal AP:PB distance_ratio proof in world units.
  assert.equal(selected.tier, "exact_verified", `${c.id}: tier ${selected.tier}`);
  assert(selected.sceneDocument.assertions.some((assertion) => assertion.predicate === "distance_ratio" && assertion.severity === "fatal"), `${c.id}: metric ratio proof`);
  const document = selected.sceneDocument;
  const byOutput = new Map(document.constructions.flatMap((construction) => construction.outputs.map((id) => [id, construction] as const)));
  const sections = document.constructions.filter((construction) => construction.operator === "section_point");
  assert.equal(sections.length, 1, `${c.id}: one section point`);
  const section = sections[0]!;
  assert.equal(section.inputs.mode, c.mode, `${c.id}: mode`);
  if (c.ratio) {
    const m = Number(section.inputs.m); const n = Number(section.inputs.n);
    close(m * c.ratio[1], n * c.ratio[0], `${c.id}: ratio m:n`);
    assert(m > 0 && n > 0, `${c.id}: positive weights`);
    checks += 2;
  }
  const endpoint = (id: unknown) => {
    const producer = byOutput.get(String(id));
    assert(producer?.operator === "point" && producer.inputs.coordinateSpace === "world", `${c.id}: endpoint ${String(id)} is a world point`);
    return [Number(producer.inputs.x), Number(producer.inputs.y)] as const;
  };
  assert.deepEqual(endpoint(section.inputs.a), c.a, `${c.id}: endpoint A`);
  assert.deepEqual(endpoint(section.inputs.b), c.b, `${c.id}: endpoint B`);
  const labels = new Map(document.entities.map((entity) => [entity.id, entity.label]));
  assert.equal(labels.get(String(section.inputs.a)), c.aLabel, `${c.id}: A label`);
  assert.equal(labels.get(String(section.inputs.b)), c.bLabel, `${c.id}: B label`);
  checks += 5;

  const scene = selected.renderScene;
  const toPixel = worldToPixel(scene, document);
  const pixelOf = (id: string) => {
    const primitive = scene.primitives.find((candidate) => candidate.kind === "point" && candidate.entityId === id);
    assert(primitive, `${c.id}: ${id} is drawn`);
    return primitive.points[0]!;
  };
  for (const [id, world] of [[String(section.inputs.a), c.a], [String(section.inputs.b), c.b], [section.outputs[0]!, c.point]] as const) {
    const expected = toPixel(world[0], world[1]);
    const actual = pixelOf(id);
    assert(Math.abs(actual.x - expected.x) <= PIXEL_TOLERANCE && Math.abs(actual.y - expected.y) <= PIXEL_TOLERANCE, `${c.id}: ${id} drawn at (${actual.x},${actual.y}), expected (${expected.x},${expected.y})`);
    checks += 1;
  }
  // Independent directed-ratio check on the drawn ink: P = A + t(B - A).
  const [pa, pb, pp] = [pixelOf(String(section.inputs.a)), pixelOf(String(section.inputs.b)), pixelOf(section.outputs[0]!)];
  assert(Math.abs(pp.x - (pa.x + c.t * (pb.x - pa.x))) <= 3 * PIXEL_TOLERANCE * (1 + Math.abs(c.t)), `${c.id}: drawn P is not at t=${c.t} (x)`);
  assert(Math.abs(pp.y - (pa.y + c.t * (pb.y - pa.y))) <= 3 * PIXEL_TOLERANCE * (1 + Math.abs(c.t)), `${c.id}: drawn P is not at t=${c.t} (y)`);
  checks += 2;
  const outside = c.t < 0 || c.t > 1;
  const extension = document.constructions.find((construction) => construction.operator === "segment" && construction.inputs.end === section.outputs[0]);
  if (outside) {
    assert(extension, `${c.id}: a point outside the segment is connected to it`);
    assert.equal(extension.inputs.start, c.t < 0 ? section.inputs.a : section.inputs.b, `${c.id}: extension runs from the nearer endpoint`);
    assert.equal(extension.inputs.end, section.outputs[0], `${c.id}: extension ends at P`);
  } else {
    assert(!extension, `${c.id}: no extension for a point on the segment`);
  }
  checks += 1;
  insideBoard(scene, c.id);
  const presentation = buildVerifiedDiagramPresentation(document, scene, { figureFamily: selected.family });
  assert(presentation && verifiedDiagramHasDrawableInk(presentation.diagram), `${c.id}: board ink`);
  assert(presentation.diagram.commands.some((command) => command.type === "LABEL" && command.text === c.aLabel), `${c.id}: board writes A`);
  checks += 2;

  // Caller admission: the question's own endpoints, ratio and mode, or nothing.
  assert(!validateTurnPlanSceneProofs(document, null).some((issue) => issue.severity === "fatal"), `${c.id}: the selected figure passes caller admission`);
  const forged = (mutate: (doc: SceneDocument) => void): boolean => {
    const copy = structuredClone(document);
    mutate(copy);
    return validateTurnPlanSceneProofs(copy, null).some((issue) => issue.severity === "fatal" && issue.code === "section_source_mismatch");
  };
  assert(forged((doc) => { const a = doc.constructions.find((construction) => construction.outputs.includes(String(section.inputs.a)))!; a.inputs = { ...a.inputs, x: Number(a.inputs.x) + 1 }; }), `${c.id}: a moved endpoint is refused`);
  if (c.mode !== "midpoint") {
    assert(forged((doc) => { const s = doc.constructions.find((construction) => construction.operator === "section_point")!; s.inputs = { ...s.inputs, m: s.inputs.n, n: s.inputs.m }; }) || c.ratio![0] === c.ratio![1], `${c.id}: a swapped ratio is refused`);
    assert(forged((doc) => { const s = doc.constructions.find((construction) => construction.operator === "section_point")!; s.inputs = { ...s.inputs, mode: c.mode === "internal" ? "external" : "internal" }; }), `${c.id}: a changed mode is refused`);
    checks += 2;
  }
  return checks + 1;
}

function checkDecline(c: DeclineCase): number {
  const selected = select(c.question);
  const sections = selected.sceneDocument.constructions.filter((construction) => construction.operator === "section_point");
  const points = selected.renderScene.primitives.filter((primitive) => primitive.kind === "point");
  assert.equal(sections.length, 0, `${c.id}: ${c.why}; got ${selected.reason}`);
  assert.equal(points.length, 0, `${c.id}: no point ink for ${c.why}; got ${selected.reason}`);
  return 2;
}

const CASES: SectionCase[] = [
  // ((2*2 + 1*8)/3, (2*3 + 1*9)/3) = (4, 5)
  { id: "SF1-internal", question: "Find the coordinates of the point which divides the line segment joining A(2,3) and B(8,9) internally in the ratio 1:2.", a: [2, 3], b: [8, 9], aLabel: "A(2,3)", bLabel: "B(8,9)", mode: "internal", ratio: [1, 2], point: [4, 5], t: 1 / 3 },
  // no mode word means internal; ((3*-1 + 2*4)/5, (3*7 + 2*-3)/5) = (1, 3)
  { id: "SF2-unnamed-default-internal", question: "Find the coordinates of the point which divides the join of (-1,7) and (4,-3) in the ratio 2:3.", a: [-1, 7], b: [4, -3], aLabel: "(-1,7)", bLabel: "(4,-3)", mode: "internal", ratio: [2, 3], point: [1, 3], t: 2 / 5 },
  // ((2*4 - 1*1)/1, (2*5 - 1*2)/1) = (7, 8), beyond B
  { id: "SF3-external", question: "Find the coordinates of the point which divides the join of A(1,2) and B(4,5) externally in the ratio 2:1.", a: [1, 2], b: [4, 5], aLabel: "A(1,2)", bLabel: "B(4,5)", mode: "external", ratio: [2, 1], point: [7, 8], t: 2 },
  // ((-2 + 6)/2, (4 - 8)/2) = (2, -2)
  { id: "SF4-midpoint", question: "Find the midpoint of the line segment joining A(-2,4) and B(6,-8).", a: [-2, 4], b: [6, -8], aLabel: "A(-2,4)", bLabel: "B(6,-8)", mode: "midpoint", point: [2, -2], t: 1 / 2 },
  // AP:PB = (4-2):(8-4) = 2:4 = 1:2, between A and B
  { id: "SF5-find-ratio", question: "In what ratio does the point P(4,5) divide the line segment joining A(2,3) and B(8,9)?", a: [2, 3], b: [8, 9], aLabel: "A(2,3)", bLabel: "B(8,9)", mode: "internal", ratio: [1, 2], point: [4, 5], t: 1 / 3 },
  // t = (1-2)/(5-2) = -1/3: AP:PB = 1:4 externally, beyond A
  { id: "SF6-find-ratio-external", question: "In what ratio does P(1,1) divide the segment from A(2,3) to B(5,9)?", a: [2, 3], b: [5, 9], aLabel: "A(2,3)", bLabel: "B(5,9)", mode: "external", ratio: [1, 4], point: [1, 1], t: -1 / 3 },
  // "ratio 1/2" is 1:2, never 2: ((2*0 + 1*6)/3, (2*0 + 1*3)/3) = (2, 1)
  { id: "SF7-fraction-ratio", question: "Find the point dividing the segment joining A(0,0) and B(6,3) in the ratio 1/2.", a: [0, 0], b: [6, 3], aLabel: "A(0,0)", bLabel: "B(6,3)", mode: "internal", ratio: [1, 2], point: [2, 1], t: 1 / 3 },
];

const DECLINES: DeclineCase[] = [
  { id: "N1-external-equal", question: "Find the point dividing A(1,2) and B(4,5) externally in the ratio 2:2.", why: "external m = n has no finite point" },
  // (2*2 + 1*8)/3 = 4, not 5
  { id: "N2-inconsistent-point", question: "The point P(5,5) divides the join of A(2,3) and B(8,9) in the ratio 1:2. Check this.", why: "the stated point disagrees with the ratio" },
  { id: "N3-zero-part", question: "Find the point which divides the join of A(1,1) and B(4,5) in the ratio 0:3.", why: "a zero part is not a proper ratio" },
  { id: "N4-negative-part", question: "Find the point which divides the join of A(1,1) and B(4,5) in the ratio -1:2.", why: "a negative part is outside the supported scope" },
  // (5-2)*(9-3) - (4-3)*(8-2) = 18 - 6 = 12, not collinear
  { id: "N5-not-collinear", question: "In what ratio does the point P(5,4) divide the line segment joining A(2,3) and B(8,9)?", why: "P is not on line AB" },
  { id: "N6-symbolic", question: "Find k if P(k,3) divides the join of A(1,2) and B(4,5) in the ratio 1:2.", why: "symbolic coordinates" },
  { id: "N7-axis-divides", question: "Find the ratio in which the y-axis divides the segment joining (5,-6) and (-1,-4).", why: "a line doing the dividing is not a two-point source" },
  { id: "N8-endpoint-from-midpoint", question: "If M(2,3) is the midpoint of AB and A is (1,1), find B.", why: "finding an endpoint from a midpoint is not supported" },
];

let checks = 0;
for (const c of CASES) checks += checkSection(c);
for (const c of DECLINES) checks += checkDecline(c);
console.log(`section formula ready: ${CASES.length} cases, ${DECLINES.length} declines, ${checks} checks`);
