/**
 * Circle in standard form, through the live selection path.
 *
 * Mirrors useQuestionHandler: families come from inferSceneCapabilities, the
 * figure from selectVerifiedRepresentation, the board ink from
 * buildVerifiedDiagramPresentation. Every expected centre, radius, equation
 * label and membership verdict below was worked by hand from the stem; none
 * is read back from the engine. Pixel geometry is checked against the drawn
 * axes, so a correct document with a wrong render still fails.
 *
 * Shared by the general-form gate (verify-circle-general-ready.ts).
 */
import assert from "node:assert/strict";
import { compileSceneDocument, validateSceneDocument, type RenderScene, type SceneDocument } from "@heytutor/scene-engine";
import { inferSceneCapabilities, questionRequiresVisual } from "@heytutor/tutor-core";
import { verifiedDiagramHasDrawableInk } from "@heytutor/drawing";
import { selectVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";

export interface CircleCase {
  id: string;
  question: string;
  center: [number, number];
  radius: number;
  label: string;
  /** Set when the equation is too long for one label: the board says r² on the circle and marks C(h,k). */
  centreLabel?: string;
  member?: { at: [number, number]; verdict: "on" | "inside" | "outside" };
}

export interface PointCase {
  id: string;
  question: string;
  point: [number, number];
}

export interface DeclineCase {
  id: string;
  question: string;
  why: string;
}

const DIAGRAM_X: readonly [number, number] = [400, 1160];
const CANVAS_Y: readonly [number, number] = [0, 700];
const PIXEL_TOLERANCE = 0.05;

function select(question: string) {
  const capabilities = inferSceneCapabilities(question, { lawIds: [], problemIR: null, turnPlan: null });
  return selectVerifiedRepresentation({ question, families: capabilities.families, problemIR: null, turnPlan: null });
}

export function worldToPixel(scene: RenderScene, document: SceneDocument): (x: number, y: number) => { x: number; y: number } {
  const axes = scene.primitives.find((primitive) => primitive.kind === "axes");
  const range = document.constructions.find((construction) => construction.operator === "axes")?.inputs;
  assert(axes && range, "a coordinate figure draws its axes");
  const [xStart, xEnd, yBottom, yTop] = axes.points as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
  const { xMin, xMax, yMin, yMax } = range as { xMin: number; xMax: number; yMin: number; yMax: number };
  const sx = (xEnd.x - xStart.x) / (xMax - xMin);
  const sy = (yBottom.y - yTop.y) / (yMax - yMin);
  // Render coordinates are rounded to 0.01 px, so the two scales agree to that grain.
  assert(Math.abs(sx - sy) <= 0.02 / Math.min(xEnd.x - xStart.x, yBottom.y - yTop.y) * sx, `axes must share one scale (${sx} vs ${sy})`);
  return (x, y) => ({ x: xStart.x + (x - xMin) * sx, y: yBottom.y - (y - yMin) * sy });
}

export function insideBoard(scene: RenderScene, id: string): void {
  for (const primitive of scene.primitives) {
    const radius = primitive.kind === "circle" ? (primitive.radius ?? 0) : 0;
    for (const point of primitive.points) {
      assert(point.x - radius >= DIAGRAM_X[0] - 1e-6 && point.x + radius <= DIAGRAM_X[1] + 1e-6, `${id}: ${primitive.id} leaves the diagram zone`);
      assert(point.y - radius >= CANVAS_Y[0] - 1e-6 && point.y + radius <= CANVAS_Y[1] + 1e-6, `${id}: ${primitive.id} leaves the canvas`);
    }
  }
}

function boardInk(selected: ReturnType<typeof select>, id: string) {
  const presentation = buildVerifiedDiagramPresentation(selected.sceneDocument, selected.renderScene, { figureFamily: selected.family });
  assert(presentation && verifiedDiagramHasDrawableInk(presentation.diagram), `${id}: the figure must produce board ink`);
  return presentation.diagram.commands;
}

export function checkCircleCase(c: CircleCase): number {
  let checks = 0;
  assert(questionRequiresVisual(c.question), `${c.id}: a stated circle asks for a figure`);
  const selected = select(c.question);
  assert.equal(selected.sceneDocument.visualDecision.mode, "scene", `${c.id}: ${selected.reason}`);
  assert.equal(selected.family, "coordinate_figure", `${c.id}: family`);
  assert.notEqual(selected.tier, "exact_verified", `${c.id}: a display-scale figure is not metric`);
  const document = selected.sceneDocument;
  const circles = document.constructions.filter((construction) => construction.operator === "circle");
  assert.equal(circles.length, 1, `${c.id}: one circle`);
  const circle = circles[0]!;
  const centre = document.constructions.find((construction) => construction.outputs.includes(String(circle.inputs.center)));
  assert(centre && centre.operator === "point" && centre.inputs.coordinateSpace === "world", `${c.id}: centre is a world point`);
  // -d/2a yields -0 for a zero linear term; the centre is the same point.
  assert(Math.abs(Number(centre.inputs.x) - c.center[0]) <= 1e-12, `${c.id}: centre x ${centre.inputs.x}`);
  assert(Math.abs(Number(centre.inputs.y) - c.center[1]) <= 1e-12, `${c.id}: centre y ${centre.inputs.y}`);
  assert(Math.abs(Number(circle.inputs.radius) - c.radius) <= 1e-12, `${c.id}: radius ${circle.inputs.radius} != ${c.radius}`);
  checks += 4;
  const locus = document.entities.find((entity) => entity.id === circle.outputs[0]);
  assert.equal(locus?.label, c.label, `${c.id}: equation label`);
  assert.deepEqual(document.source.circleSourceBinding, { locusId: circle.outputs[0] }, `${c.id}: source binding`);
  checks += 2;

  const scene = selected.renderScene;
  const toPixel = worldToPixel(scene, document);
  const drawn = scene.primitives.filter((primitive) => primitive.kind === "circle");
  assert.equal(drawn.length, 1, `${c.id}: one drawn circle`);
  const expectedCentre = toPixel(c.center[0], c.center[1]);
  const edge = toPixel(c.center[0] + c.radius, c.center[1]);
  assert(Math.abs(drawn[0]!.points[0]!.x - expectedCentre.x) <= PIXEL_TOLERANCE && Math.abs(drawn[0]!.points[0]!.y - expectedCentre.y) <= PIXEL_TOLERANCE, `${c.id}: drawn centre`);
  assert(Math.abs((drawn[0]!.radius ?? 0) - (edge.x - expectedCentre.x)) <= PIXEL_TOLERANCE, `${c.id}: drawn radius`);
  checks += 2;

  const centres = document.entities.filter((entity) => entity.role === "circle centre");
  if (c.centreLabel) {
    assert.equal(centres.length, 1, `${c.id}: a long equation marks the centre`);
    assert.equal(centres[0]!.label, c.centreLabel, `${c.id}: centre label`);
    const centrePrimitive = scene.primitives.find((primitive) => primitive.kind === "point" && primitive.entityId === centres[0]!.id);
    assert(centrePrimitive && Math.abs(centrePrimitive.points[0]!.x - expectedCentre.x) <= PIXEL_TOLERANCE && Math.abs(centrePrimitive.points[0]!.y - expectedCentre.y) <= PIXEL_TOLERANCE, `${c.id}: centre pixel`);
    checks += 3;
  } else {
    assert.equal(centres.length, 0, `${c.id}: the equation label already names the centre`);
    checks += 1;
  }
  const members = document.entities.filter((entity) => entity.role === "named point");
  if (c.member) {
    const [mx, my] = c.member.at;
    assert.equal(members.length, 1, `${c.id}: the stem's point is drawn`);
    assert.equal(members[0]!.label, `P(${mx},${my})`, `${c.id}: member label`);
    const memberPrimitive = scene.primitives.find((primitive) => primitive.kind === "point" && primitive.entityId === members[0]!.id);
    const expected = toPixel(mx, my);
    assert(memberPrimitive && Math.abs(memberPrimitive.points[0]!.x - expected.x) <= PIXEL_TOLERANCE && Math.abs(memberPrimitive.points[0]!.y - expected.y) <= PIXEL_TOLERANCE, `${c.id}: member pixel`);
    const onAssertion = document.assertions.some((assertion) => assertion.predicate === "on" && assertion.entities.includes(members[0]!.id));
    assert.equal(onAssertion, c.member.verdict === "on", `${c.id}: an on-circle proof exists only when the point is on the circle`);
    // Independent pixel verdict: distance from the drawn centre against the drawn radius.
    const pixelDistance = Math.hypot(memberPrimitive.points[0]!.x - drawn[0]!.points[0]!.x, memberPrimitive.points[0]!.y - drawn[0]!.points[0]!.y);
    const verdict = Math.abs(pixelDistance - drawn[0]!.radius!) <= 0.1 ? "on" : pixelDistance < drawn[0]!.radius! ? "inside" : "outside";
    assert.equal(verdict, c.member.verdict, `${c.id}: the picture shows the point ${c.member.verdict}`);
    checks += 5;
  } else {
    assert.equal(members.length, 0, `${c.id}: no invented point`);
    checks += 1;
  }
  insideBoard(scene, c.id);
  const commands = boardInk(selected, c.id);
  assert(commands.some((command) => command.type === "DRAW_CIRCLE"), `${c.id}: board draws the circle`);
  assert(commands.some((command) => command.type === "LABEL" && command.text === c.label), `${c.id}: board writes the equation`);
  checks += 3;

  // A planner scene with the wrong radius cannot pair with this stem.
  const forged = structuredClone(document);
  const forgedCircle = forged.constructions.find((construction) => construction.operator === "circle")!;
  forgedCircle.inputs = { ...forgedCircle.inputs, radius: c.radius + 1 };
  const forgedCompile = compileSceneDocument(forged);
  assert(!forgedCompile.ok && forgedCompile.report.issues.some((issue) => issue.code === "circle_source_mismatch"), `${c.id}: a wrong-radius planner scene is rejected`);
  const forgedCentre = structuredClone(document);
  const anchor = forgedCentre.constructions.find((construction) => construction.outputs.includes(String(circle.inputs.center)))!;
  anchor.inputs = { ...anchor.inputs, x: c.center[0] + 1 };
  assert(!compileSceneDocument(forgedCentre).ok, `${c.id}: a wrong-centre planner scene is rejected`);
  checks += 2;

  // A planner scene tracing the circle with implicit_curve: the source circle
  // compiles, a different circle under the same equation label does not
  // (reviewer probe circle-implicit-forgery.mts).
  const [h, k] = c.center;
  const traced = (expression: string) => {
    const span = c.radius * 1.5 + 1;
    const doc = {
      schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "planner implicit circle" }, source: { question: c.question }, quantities: [],
      entities: [{ id: "curve", kind: "polyline", role: "implicit curve", label: c.label }],
      constructions: [{ id: "make_curve", operator: "implicit_curve", inputs: { expression, xMin: h - span, xMax: h + span, yMin: k - span, yMax: k + span, xSamples: 65, ySamples: 65 }, outputs: ["curve"] }],
      relations: [], assertions: [], annotations: [], requiredEntityIds: ["curve"],
      revealGroups: [{ id: "g", entityIds: ["curve"], dependsOn: [], narrationCue: "curve" }],
      teachingTimeline: [{ id: "t", action: "reveal", targetId: "g", dependsOn: [], narrationIntent: "reveal" }],
    } as unknown as SceneDocument;
    const validated = validateSceneDocument(doc);
    return validated.document ? compileSceneDocument(validated.document) : null;
  };
  const r2 = c.radius ** 2;
  const sourceTrace = traced(`(x-(${h}))^2+(y-(${k}))^2-(${r2})`);
  assert(sourceTrace?.ok, `${c.id}: an implicit trace of the source circle compiles: ${JSON.stringify(sourceTrace?.report.issues)}`);
  for (const forged of [`(x-(${h}))^2+(y-(${k}))^2-(${r2 + 2})`, `(x-(${h + 1}))^2+(y-(${k}))^2-(${r2})`, "x^2+y^2-4"]) {
    if (forged === "x^2+y^2-4" && h === 0 && k === 0 && r2 === 4) continue;
    const result = traced(forged);
    assert(result && !result.ok && result.report.issues.some((issue) => issue.code === "circle_source_mismatch"), `${c.id}: implicit trace ${forged} under the source label is rejected`);
    checks += 1;
  }
  // A non-circle under the equation label is a false label (reviewer residual on
  // 37606d3f): an ellipse, a line and a polyline must all be rejected.
  if (c.label.includes("x")) {
    // Ellipse, line, a quartic and a non-polynomial curve (reviewer block on 42290422).
    for (const nonCircle of [`(x-(${h}))^2+2*(y-(${k}))^2-(${r2})`, `x+y-(${h + k})`, `(x-(${h}))^4+(y-(${k}))^4-(${r2 ** 2})`, `y-(${k})-0.5*sin(x)`]) {
      const result = traced(nonCircle);
      assert(result && !result.ok && result.report.issues.some((issue) => issue.code === "circle_source_mismatch"), `${c.id}: ${nonCircle} under the circle's equation label is rejected`);
      checks += 1;
    }
    const polyline = {
      schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "planner polyline" }, source: { question: c.question }, quantities: [],
      entities: [{ id: "curve", kind: "polyline", role: "curve", label: c.label }],
      constructions: [{ id: "make_curve", operator: "polyline", inputs: { points: [[h - c.radius, k], [h, k + c.radius], [h + c.radius, k]] }, outputs: ["curve"] }],
      relations: [], assertions: [], annotations: [], requiredEntityIds: ["curve"],
      revealGroups: [{ id: "g", entityIds: ["curve"], dependsOn: [], narrationCue: "curve" }],
      teachingTimeline: [{ id: "t", action: "reveal", targetId: "g", dependsOn: [], narrationIntent: "reveal" }],
    } as unknown as SceneDocument;
    const validated = validateSceneDocument(polyline);
    const result = validated.document ? compileSceneDocument(validated.document) : null;
    assert(!result?.ok, `${c.id}: a polyline under the circle's equation label is rejected`);
    checks += 1;
  }
  checks += 1;
  return checks;
}

export function checkPointCase(c: PointCase): number {
  assert(questionRequiresVisual(c.question), `${c.id}: a stated locus asks for a figure`);
  const selected = select(c.question);
  assert.equal(selected.sceneDocument.visualDecision.mode, "scene", `${c.id}: ${selected.reason}`);
  assert.equal(selected.sceneDocument.constructions.filter((construction) => construction.operator === "circle").length, 0, `${c.id}: a zero-radius locus is not a circle`);
  assert.equal(selected.renderScene.primitives.filter((primitive) => primitive.kind === "circle").length, 0, `${c.id}: no drawn circle`);
  const points = selected.sceneDocument.constructions.filter((construction) => construction.operator === "point" && construction.inputs.coordinateSpace === "world");
  assert(points.some((point) => Math.abs(Number(point.inputs.x) - c.point[0]) <= 1e-12 && Math.abs(Number(point.inputs.y) - c.point[1]) <= 1e-12), `${c.id}: the singleton point`);
  insideBoard(selected.renderScene, c.id);
  boardInk(selected, c.id);
  return 5;
}

export function checkDeclineCase(c: DeclineCase): number {
  const selected = select(c.question);
  const circles = selected.sceneDocument.constructions.filter((construction) => construction.operator === "circle");
  const drawn = selected.renderScene.primitives.filter((primitive) => primitive.kind === "circle");
  assert.equal(circles.length + drawn.length, 0, `${c.id}: ${c.why}; got ${selected.reason}`);
  assert(!selected.renderScene.primitives.some((primitive) => primitive.text?.includes("²")), `${c.id}: no equation ink for an invalid source`);
  return 2;
}

const CASES: CircleCase[] = [
  { id: "S1-declared", question: "Find the equation of the circle with centre (2,-3) and radius 4.", center: [2, -3], radius: 4, label: "(x-2)²+(y+3)²=16" },
  { id: "S2-standard", question: "Find the centre and radius of the circle (x+1)^2+(y-4)^2=9.", center: [-1, 4], radius: 3, label: "(x+1)²+(y-4)²=9" },
  // (4-1)² + (2+2)² = 9 + 16 = 25 = r²
  { id: "S3-on", question: "Does the point (4,2) lie on, inside or outside the circle (x-1)^2+(y+2)^2=25?", center: [1, -2], radius: 5, label: "(x-1)²+(y+2)²=25", member: { at: [4, 2], verdict: "on" } },
  // 5² + 1² = 26 > 16
  { id: "S4-outside", question: "Is the point P(5,1) inside or outside the circle x^2+y^2=16?", center: [0, 0], radius: 4, label: "x²+y²=16", member: { at: [5, 1], verdict: "outside" } },
  // (1-2)² + (1-2)² = 2 < 9
  // (x-1/2)² + (y+3/2)² = 25/4: centre (0.5,-1.5), r = 2.5; the equation is too long for one label
  { id: "S6-fractional", question: "Find the centre and radius of the circle (x-1/2)^2+(y+3/2)^2=25/4.", center: [0.5, -1.5], radius: 2.5, label: "r²=6.25", centreLabel: "C(0.5,-1.5)" },
  // a far centre: the frame follows the circle, not the origin's neighbourhood
  { id: "S7-far-centre", question: "Find the centre and radius of the circle (x+100)^2+(y-100)^2=9.", center: [-100, 100], radius: 3, label: "r²=9", centreLabel: "C(-100,100)" },
  { id: "S5-inside", question: "Determine whether the point (1,1) lies inside the circle (x-2)^2+(y-2)^2=9.", center: [2, 2], radius: 3, label: "(x-2)²+(y-2)²=9", member: { at: [1, 1], verdict: "inside" } },
];

const DECLINES: DeclineCase[] = [
  { id: "N1-negative-r2", question: "Find the centre and radius of the circle (x-1)^2+(y+2)^2=-4.", why: "r² = -4 has no real circle" },
  { id: "N2-negative-radius", question: "A circle has centre (1,2) and radius -3. Find its equation.", why: "a radius cannot be negative" },
  { id: "N3-contradiction", question: "The circle (x-1)^2+(y-2)^2=9 has centre (1,2) and radius 4. Find its area.", why: "the stated radius contradicts r² = 9" },
  // Fitting (x+1000000)² loses the precision an exact centre needs: refuse, never a stock circle.
  { id: "N5-unreadable-far-centre", question: "Find the centre and radius of the circle (x+1000000)^2+(y-1000000)^2=9.", why: "the equation cannot be read exactly" },
  { id: "N4-undeclared-zero", question: "Find the equation of the circle with centre (0,0) and radius 0.", why: "a zero radius is not a circle unless the stem calls it a point" },
];

if (import.meta.url === `file://${process.argv[1]}`) {
  let checks = 0;
  for (const c of CASES) checks += checkCircleCase(c);
  for (const c of DECLINES) checks += checkDeclineCase(c);
  console.log(`circle standard form ready: ${CASES.length} cases, ${DECLINES.length} declines, ${checks} checks`);
}
