import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { compileSceneDocument } from "../../src/compile/compiler";
import { validateSceneDocument } from "../../src/document/validation";
import { canPlaceSingleLabel, obstaclesFromPrimitives, placeLabels } from "../../src/labels/labelEngine";
import { namedGaps, ownerNamedGaps } from "../../src/labels/levelGap";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import type { RenderPoint, RenderPrimitive, SceneDocument } from "../../src/types";

// An arrow drawn from one level to a parallel level names the gap between
// them. A recorded photoelectric lesson wrote the work function "φ" above its
// own line, inside the gap the K arrow names, so the board said K = φ. A
// level's label (the line's own, or the label of a point on it) must not sit
// inside a gap an arrow names. The arrows' labels may. Measured on the
// compiled scene, not through the engine.

type Box = { x: number; y: number; width: number; height: number };
let checks = 0;

function compile(document: SceneDocument) {
  const validated = validateSceneDocument(structuredClone(document));
  assert.ok(validated.document, `document validates: ${validated.report.issues.map((issue) => `${issue.code} ${issue.message}`).join(", ")}`);
  return compileSceneDocument(validated.document);
}

const point = (id: string, x: number, y: number) => ({ id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: [id] });
const segment = (id: string, start: string, end: string) => ({ id: `make_${id}`, operator: "segment", inputs: { start, end }, outputs: [id] });
const vector = (id: string, start: string, end: string) => ({ id: `make_${id}`, operator: "vector", inputs: { start, end }, outputs: [id] });

function levelsDocument(withGapArrow: boolean): SceneDocument {
  const entities = [
    { id: "axes", kind: "axes", role: "energy axis" },
    { id: "zero", kind: "point", role: "zero of energy", label: "0" },
    { id: "low_start", kind: "point", role: "lower level start" },
    { id: "low_end", kind: "point", role: "lower level end" },
    { id: "low_level", kind: "segment", role: "lower level", label: "W" },
    { id: "high_start", kind: "point", role: "upper level start" },
    { id: "high_end", kind: "point", role: "upper level end" },
    { id: "high_level", kind: "segment", role: "upper level", label: "E" },
    { id: "rise_base", kind: "point", role: "total arrow base" },
    { id: "rise_tip", kind: "point", role: "total arrow tip" },
    { id: "rise", kind: "vector", role: "total energy", label: "E" },
    ...(withGapArrow ? [
      { id: "gap_base", kind: "point", role: "gap arrow base" },
      { id: "gap_tip", kind: "point", role: "gap arrow tip" },
      { id: "gap", kind: "vector", role: "energy gap", label: "K" },
    ] : []),
  ];
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "two energy levels on one energy axis" },
    source: { question: "Two energy levels and the gap between them." },
    quantities: [],
    entities,
    constructions: [
      { id: "make_axes", operator: "axes", inputs: { xMin: -0.5, xMax: 4, yMin: -0.6, yMax: 3.75 }, outputs: ["axes"] },
      point("zero", 0, 0),
      point("low_start", 0, 2), point("low_end", 1.4, 2), segment("low_level", "low_start", "low_end"),
      point("high_start", 0, 3), point("high_end", 1.4, 3), segment("high_level", "high_start", "high_end"),
      point("rise_base", 2.2, 0), point("rise_tip", 2.2, 3), vector("rise", "rise_base", "rise_tip"),
      ...(withGapArrow ? [point("gap_base", 3, 2), point("gap_tip", 3, 3), vector("gap", "gap_base", "gap_tip")] : []),
    ],
    relations: [],
    assertions: [],
    annotations: [],
    requiredEntityIds: [],
    teachingTimeline: [],
    revealGroups: [{ id: "setup", dependsOn: [], entityIds: entities.map((entity) => entity.id) }],
  } as unknown as SceneDocument;
}

function labelBox(primitive: RenderPrimitive): Box | null {
  const bounds = primitive.provenance?.labelBounds as Box | undefined;
  return bounds && Number.isFinite(bounds.x) ? bounds : null;
}

function strokeOf(primitives: RenderPrimitive[], entityId: string): [RenderPoint, RenderPoint] | null {
  const primitive = primitives.find((candidate) => candidate.entityId === entityId && candidate.kind !== "label" && candidate.points.length >= 2);
  return primitive ? [primitive.points[0]!, primitive.points.at(-1)!] : null;
}

/** Horizontal gaps: an arrow whose ends lie on two horizontal levels. */
function horizontalGaps(primitives: RenderPrimitive[]) {
  const levels = primitives
    .filter((primitive) => primitive.kind !== "label" && primitive.kind !== "vector" && primitive.kind !== "axes" && primitive.points.length >= 2)
    .map((primitive) => [primitive.points[0]!, primitive.points.at(-1)!] as const)
    .filter(([a, b]) => Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) >= 40);
  const arrows = primitives.filter((primitive) => primitive.kind === "vector" && primitive.points.length >= 2);
  const gaps: Array<{ arrow: string; low: number; high: number; from: number; to: number }> = [];
  for (const arrow of arrows) {
    const [tail, head] = [arrow.points[0]!, arrow.points.at(-1)!];
    for (const first of levels) for (const second of levels) {
      if (first === second || Math.abs(first[0].y - tail.y) > 4 || Math.abs(second[0].y - head.y) > 4) continue;
      gaps.push({
        arrow: arrow.entityId,
        low: Math.min(first[0].y, second[0].y), high: Math.max(first[0].y, second[0].y),
        from: Math.max(Math.min(first[0].x, first[1].x), Math.min(second[0].x, second[1].x)),
        to: Math.min(Math.max(first[0].x, first[1].x), Math.max(second[0].x, second[1].x)),
      });
    }
  }
  return gaps;
}

function assertLevelLabelsClear(primitives: RenderPrimitive[], levelOwners: string[], name: string): void {
  const gaps = horizontalGaps(primitives);
  for (const label of primitives.filter((primitive) => primitive.kind === "label" && levelOwners.includes(primitive.entityId))) {
    const box = labelBox(label);
    assert.ok(box, `${name}: ${label.entityId} label has a box`);
    const centreY = box.y + box.height / 2;
    for (const gap of gaps) {
      const inside = centreY > gap.low && centreY < gap.high && box.x < gap.to && box.x + box.width > gap.from;
      assert.ok(!inside, `${name}: level label "${label.text}" of ${label.entityId} sits in the gap the ${gap.arrow} arrow names`);
    }
    checks += 1;
  }
}

{
  const result = compile(levelsDocument(true));
  assert.equal(result.ok, true, `levels with a gap arrow compile: ${result.report.issues.map((issue) => `${issue.code} ${issue.message}`).join(", ")}`);
  const primitives = result.renderScene!.primitives;
  assert.ok(horizontalGaps(primitives).some((gap) => gap.arrow === "gap"), "the K arrow joins the two levels");
  assertLevelLabelsClear(primitives, ["low_level", "high_level", "zero"], "levels with a gap arrow");
  const gapLabel = primitives.find((primitive) => primitive.kind === "label" && primitive.entityId === "gap");
  assert.ok(gapLabel, "the gap arrow keeps its own label");
  checks += 1;
}

{
  // Without an arrow across it the band names nothing; every level keeps its label.
  const result = compile(levelsDocument(false));
  assert.equal(result.ok, true, "levels without a gap arrow compile");
  const primitives = result.renderScene!.primitives;
  assert.equal(horizontalGaps(primitives).some((gap) => gap.arrow === "gap"), false, "no arrow joins the two levels");
  for (const entityId of ["low_level", "high_level", "zero"]) {
    assert.ok(primitives.some((primitive) => primitive.kind === "label" && primitive.entityId === entityId), `${entityId} keeps its label`);
    assert.ok(strokeOf(primitives, entityId) || entityId === "zero", `${entityId} is drawn`);
  }
  checks += 1;
}

{
  const scene = synthesizeFamilyScene({ question: "The work function of a metal is 2.0 eV and light of photon energy 3.0 eV falls on it. Draw the energy level diagram of photoemission." });
  assert.ok(scene?.renderScene, "the photoemission stem still draws an energy level figure");
  const primitives = scene.renderScene.primitives;
  assert.ok(primitives.some((primitive) => primitive.kind === "vector"), "the photoemission figure draws the K arrow");
  const levelOwners = primitives
    .filter((primitive) => primitive.kind === "label")
    .map((primitive) => primitive.entityId)
    .filter((entityId) => !primitives.some((primitive) => primitive.entityId === entityId && primitive.kind === "vector"));
  assert.ok(levelOwners.length > 0, "the photoemission figure has level labels");
  assertLevelLabelsClear(primitives, levelOwners, `family ${scene.family}`);
}

// The rule reads only levels joined square by an arrow. Edges of a body, a
// frame or a dimension, and an arrow across parallel lines at a slant, name
// no gap: a ray in a fibre, a vector across a parallelepiped face.
const stroke = (id: string, kind: RenderPrimitive["kind"], points: RenderPoint[]) =>
  ({ id, entityId: id, kind, points }) as unknown as RenderPrimitive;
const levels = (kind: RenderPrimitive["kind"], arrow: RenderPoint[], right = 620) => [
  stroke("upper", kind, [{ x: 20, y: 100 }, { x: right, y: 100 }]),
  stroke("lower", kind, [{ x: 20, y: 200 }, { x: right, y: 200 }]),
  stroke("arrow", "vector", arrow),
];
const square = [{ x: 300, y: 200 }, { x: 300, y: 100 }];
const slant = [{ x: 100, y: 200 }, { x: 400, y: 100 }];
{
  assert.equal(namedGaps(obstaclesFromPrimitives(levels("line", square))).length, 1, "an arrow square to two lines names their gap");
  assert.equal(namedGaps(obstaclesFromPrimitives(levels("line", slant))).length, 0, "a slanted arrow between parallel lines names no gap");
  assert.equal(namedGaps(obstaclesFromPrimitives(levels("dimension", square))).length, 0, "dimension strokes are not levels");
  assert.equal(namedGaps(obstaclesFromPrimitives(levels("polyline", square))).length, 0, "frame strokes are not levels");
  assert.equal(namedGaps(obstaclesFromPrimitives([
    stroke("box", "rectangle", [{ x: 20, y: 100 }, { x: 620, y: 100 }, { x: 620, y: 200 }, { x: 20, y: 200 }]),
    stroke("arrow", "vector", square),
  ])).length, 0, "the edges of a box are not levels");
  checks += 1;
}

// A middle level between two named gaps, its line spanning the view so no
// slot clears both gaps, keeps the placement it has without the rule rather
// than being pushed onto a long leader. Given room past its line's end, it
// moves there.
{
  const stack = (arrowKind: RenderPrimitive["kind"], right: number) => [
    stroke("top", "line", [{ x: 20, y: 100 }, { x: right, y: 100 }]),
    stroke("middle", "line", [{ x: 20, y: 200 }, { x: right, y: 200 }]),
    stroke("bottom", "line", [{ x: 20, y: 300 }, { x: right, y: 300 }]),
    stroke("fall_top", arrowKind, [{ x: 160, y: 100 }, { x: 160, y: 200 }]),
    stroke("fall_middle", arrowKind, [{ x: 480, y: 200 }, { x: 480, y: 300 }]),
  ];
  const place = (arrowKind: RenderPrimitive["kind"], viewWidth: number, right: number) => {
    const result = placeLabels(
      [{ entityId: "middle", anchor: { x: (20 + right) / 2, y: 200 }, text: "n = 3", viewBounds: { x: 0, y: 0, width: viewWidth, height: 400 } }],
      obstaclesFromPrimitives(stack(arrowKind, right)),
    );
    const placement = result.placements.find((entry) => entry.entityId === "middle");
    assert.ok(result.ok && placement, `the middle level is labelled (view ${viewWidth})`);
    return placement!;
  };
  const tight = place("vector", 640, 620), unruled = place("line", 640, 620);
  assert.deepEqual(
    { bounds: tight.bounds, slot: tight.slot, usesLeader: tight.usesLeader },
    { bounds: unruled.bounds, slot: unruled.slot, usesLeader: unruled.usesLeader },
    "with no slot clear of the gaps the label is placed as without the rule",
  );
  // The gap ruled solve costs nothing where no gap is named: lines in place
  // of arrows name none, so the figure solves once. The single label check
  // asks the layout without the rule and agrees with placeLabels either way.
  const owner = { entityId: "middle", anchor: { x: 320, y: 200 }, text: "n = 3", viewBounds: { x: 0, y: 0, width: 640, height: 400 } };
  for (const [arrowKind, expected] of [["line", 0], ["vector", 1]] as const) {
    let solves = 0;
    const obstacles = obstaclesFromPrimitives(stack(arrowKind, 620));
    const placed = placeLabels([owner], obstacles, { onNamedGapSolve: () => { solves += 1; } });
    assert.equal(solves, expected, `${arrowKind} strokes run ${expected} gap ruled solve`);
    assert.equal(canPlaceSingleLabel(owner, obstacles), placed.ok, `${arrowKind}: the single label check agrees with placeLabels`);
  }
  const roomy = place("vector", 760, 620);
  const centreY = roomy.bounds.y + roomy.bounds.height / 2;
  const inBand = centreY > 100 && centreY < 300 && roomy.bounds.x < 620 && roomy.bounds.x + roomy.bounds.width > 20;
  assert.ok(!inBand && !roomy.usesLeader, "with room past the line end the label leaves the named gaps");
  checks += 1;
}

// A labelled point on the tail of an arrow that names a stack of levels
// would, without the figure guard, take the line's west slot and push that
// line's label onto a leader. The guard keeps the layout without the rule.
{
  const prims = [
    stroke("v0", "line", [{ x: 80, y: 80 }, { x: 520, y: 80 }]),
    stroke("v54", "line", [{ x: 80, y: 200 }, { x: 520, y: 200 }]),
    stroke("v270", "line", [{ x: 80, y: 360 }, { x: 520, y: 360 }]),
    stroke("shift", "vector", [{ x: 200, y: 200 }, { x: 200, y: 80 }]),
    stroke("drop", "vector", [{ x: 360, y: 200 }, { x: 360, y: 360 }]),
    stroke("q", "point", [{ x: 80, y: 200 }]),
    stroke("wall", "line", [{ x: 530, y: 40 }, { x: 530, y: 420 }]),
  ];
  const view = { x: 0, y: 0, width: 640, height: 440 };
  const owners = [
    { entityId: "v0", anchor: { x: 300, y: 80 }, text: "0 V", preferredSlot: "west" as const, viewBounds: view },
    { entityId: "v54", anchor: { x: 300, y: 200 }, text: "54 V", preferredSlot: "west" as const, viewBounds: view },
    { entityId: "v270", anchor: { x: 300, y: 360 }, text: "270 V", preferredSlot: "west" as const, viewBounds: view },
    { entityId: "q", anchor: { x: 80, y: 200 }, text: "q", tetherPx: 40, allowLeader: false, viewBounds: view },
    { entityId: "shift", anchor: { x: 200, y: 140 }, text: "s", viewBounds: view },
  ];
  const obstacles = obstaclesFromPrimitives(prims);
  const unruled = placeLabels(owners, obstacles, { namedGaps: false });
  const guarded = placeLabels(owners, obstacles);
  assert.ok(unruled.ok && guarded.ok, "the stacked levels still label");
  const same = (a: (typeof guarded.placements)[number], b: (typeof unruled.placements)[number]) =>
    Math.abs(a.bounds.x - b.bounds.x) < 0.01 && Math.abs(a.bounds.y - b.bounds.y) < 0.01 && a.usesLeader === b.usesLeader;
  assert.ok(
    guarded.placements.length === unruled.placements.length
    && guarded.placements.every((placement, index) => same(placement, unruled.placements[index]!)),
    "a point whose move would push 54 V onto a leader keeps the layout without the rule",
  );
  checks += 1;
}

// A band that strictly contains a middle level does not constrain that
// level's label. Taken from the merge review's fuzz-case-234: "K" has a
// clear west slot at its own line and must keep it.
{
  const prims = [
    stroke("L0", "line", [{ x: 429, y: 132 }, { x: 830, y: 132 }]),
    stroke("L1", "line", [{ x: 484, y: 236 }, { x: 774, y: 236 }]),
    stroke("L2", "line", [{ x: 459, y: 292 }, { x: 771, y: 292 }]),
    stroke("L3", "line", [{ x: 429, y: 401 }, { x: 733, y: 401 }]),
    stroke("A0", "vector", [{ x: 651, y: 132 }, { x: 651, y: 236 }]),
    stroke("A1", "vector", [{ x: 526, y: 292 }, { x: 526, y: 236 }]),
    stroke("A2", "vector", [{ x: 567, y: 401 }, { x: 567, y: 132 }]),
    stroke("P1", "point", [{ x: 774, y: 236 }]),
  ];
  const view = { x: 400, y: 40, width: 760, height: 500 };
  const result = placeLabels(
    [
      { entityId: "L0", anchor: { x: 630, y: 132 }, text: "φ", preferredSlot: "west", viewBounds: view },
      { entityId: "L1", anchor: { x: 629, y: 236 }, text: "K", preferredSlot: "west", viewBounds: view },
      { entityId: "A2", anchor: { x: 567, y: 266 }, text: "Lyman α", viewBounds: view },
      { entityId: "P1", anchor: { x: 774, y: 236 }, text: "B1", tetherPx: 40, allowLeader: false, viewBounds: view },
    ],
    obstaclesFromPrimitives(prims),
  );
  const k = result.placements.find((entry) => entry.text === "K");
  assert.ok(result.ok && k, "K is labelled");
  const centreY = k!.bounds.y + k!.bounds.height / 2;
  assert.ok(!k!.usesLeader && Math.abs(centreY - 236) < 8, "K keeps its west slot on its own line, not a leader across the top");
  const kGaps = ownerNamedGaps(
    { entityId: "L1", anchor: { x: 629, y: 236 }, text: "K" },
    obstaclesFromPrimitives(prims),
    namedGaps(obstaclesFromPrimitives(prims)),
  );
  assert.ok(!kGaps.some((gap) => gap.arrowEntityId === "A2"), "the outer A2 band does not constrain K");
  checks += 1;
}

// Two constructed stacks from the delta review's fuzz (geometry only).
// case-154: the gap rule must be judged against main's final layout, after
// #308's point rival step. Judged against the layout before that step, the
// gap layout was kept and #308's repair of B0 was then refused, so B0 read
// as P1's letter. case-156: the label that leaves its gap keeps a margin
// floor, so "n = 1" may not end as near the next level as its own.
{
  type Fixture = { prims: RenderPrimitive[]; owners: Parameters<typeof placeLabels>[0] };
  const fixture = (name: string): Fixture => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
  const toPoint = (box: Box, p: RenderPoint) => Math.hypot(Math.max(box.x - p.x, 0, p.x - (box.x + box.width)), Math.max(box.y - p.y, 0, p.y - (box.y + box.height)));
  const toLevel = (box: Box, [a, b]: RenderPoint[]) => {
    const dx = Math.max(Math.min(a!.x, b!.x) - (box.x + box.width), box.x - Math.max(a!.x, b!.x), 0);
    const dy = Math.max(a!.y - (box.y + box.height), box.y - a!.y, 0);
    return Math.hypot(dx, dy);
  };
  const place = (case_: Fixture, text: string) => {
    const result = placeLabels(case_.owners, obstaclesFromPrimitives(case_.prims));
    const placement = result.placements.find((entry) => entry.text === text);
    assert.ok(result.ok && placement, `${text} is labelled`);
    return placement!.bounds;
  };

  const c154 = fixture("level-label-gap-case-154.json");
  const b0 = place(c154, "B0");
  const dots = c154.prims.filter((prim) => prim.kind === "point");
  const ownDot = toPoint(b0, dots.find((prim) => prim.entityId === "P0")!.points[0]!);
  const foreignDot = Math.min(...dots.filter((prim) => prim.entityId !== "P0").map((prim) => toPoint(b0, prim.points[0]!)));
  assert.ok(ownDot < foreignDot, `B0 reads as its own point, as on main (own ${ownDot.toFixed(1)} px, nearest other dot ${foreignDot.toFixed(1)} px)`);
  checks += 1;

  const c156 = fixture("level-label-gap-case-156.json");
  const n1 = place(c156, "n = 1");
  const levels = c156.prims.filter((prim) => prim.kind === "line");
  const ownLevel = toLevel(n1, levels.find((prim) => prim.entityId === "L2")!.points);
  const otherLevel = Math.min(...levels.filter((prim) => prim.entityId !== "L2").map((prim) => toLevel(n1, prim.points)));
  assert.ok(otherLevel - ownLevel >= 8, `"n = 1" stays at least 8 px nearer its own level than any other (own ${ownLevel.toFixed(1)} px, other ${otherLevel.toFixed(1)} px)`);
  checks += 1;
}

console.log(`verify-level-label-gaps: ${checks} checks passed`);
