/**
 * Topic neutral invariants for seven engine geometry corrections salvaged from
 * #96 and #97 plus one torque fix. Every section imports on its own, so a
 * missing export fails that section only. Each section holds at least one
 * check that main fails and guard checks that must hold on main and here.
 */
import assert from "node:assert/strict";

type Point = { x: number; y: number };
const failures: string[] = [];
let checks = 0;

function check(condition: unknown, message: string): asserts condition {
  checks += 1;
  assert.ok(condition, message);
}
function close(actual: number, expected: number, message: string, tolerance = 1e-12): void {
  checks += 1;
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${message}: ${actual} != ${expected}`);
}
function rejects(run: () => unknown, message: string): void {
  checks += 1;
  assert.throws(run, undefined, message);
}
async function section(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
}

const sourceContext = {
  number: (value: unknown): number => {
    const result = Number(value);
    if (!Number.isFinite(result)) throw new Error("not finite");
    return result;
  },
  point: (value: unknown): Point => {
    if (Array.isArray(value) && value.length === 2) return { x: Number(value[0]), y: Number(value[1]) };
    if (typeof value === "object" && value !== null && "x" in value && "y" in value) return { x: Number(value.x), y: Number(value.y) };
    throw new Error("not a point");
  },
  geometry: (): undefined => undefined,
};

function scene(operator: string, inputs: Record<string, unknown>, entities: Array<[string, string]>): Record<string, unknown> {
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: operator },
    source: {},
    quantities: [],
    entities: entities.map(([id, kind]) => ({ id, kind, role: kind })),
    constructions: [{ id: "make", operator, inputs, outputs: entities.map(([id]) => id) }],
    relations: [],
    assertions: [],
    annotations: [],
    requiredEntityIds: entities.map(([id]) => id),
    revealGroups: [{ id: "g", entityIds: entities.map(([id]) => id), dependsOn: [], narrationCue: operator }],
    teachingTimeline: [],
  };
}

type Primitive = { entityId: string; kind: string; points: Point[]; text?: string };
async function compiledPrimitives(document: Record<string, unknown>): Promise<Primitive[]> {
  const { compileSceneDocument, validateSceneDocument } = await import("../../src/index");
  const validated = validateSceneDocument(document as never);
  const compiled = compileSceneDocument((validated.document ?? document) as never);
  if (!compiled.ok || !compiled.renderScene) {
    throw new Error(`scene did not compile: ${compiled.report.issues.map((issue: { code: string }) => issue.code).join(", ")}`);
  }
  return compiled.renderScene.primitives as unknown as Primitive[];
}

// 1. Parallel wires: the force direction follows attraction or repulsion once,
// and a wire is apparatus, never a field mark labelled B.
await section("1 parallel wire force direction and wire identity", async () => {
  const { evaluateCurrentFieldConstruction, currentFieldOutputLabels } = await import("../../src/compile/currentFieldGeometry");
  const mu0 = 4 * Math.PI * 1e-7;
  const wires = (currents: [number, number]) => evaluateCurrentFieldConstruction("parallel_wire_force", {
    currents, separation: 0.1, mu0, length: 1, units: { current: "A", length: "m", mu0: "N/A^2" }, displayScale: 8, forceScale: 1,
  }, sourceContext);
  const expected = mu0 * 9 / (2 * Math.PI * 0.1);
  // Guard: same direction currents attract (main already right).
  const same = wires([3, 3]);
  check(same[2]!.currentField.components.x > 0 && same[3]!.currentField.components.x < 0, "same direction currents pull the wires together");
  close(same[2]!.currentField.components.x, expected, "attractive force per length is mu0 I1 I2 / (2 pi d)");
  // Opposite currents repel: the left wire is pushed left, the right wire right.
  for (const currents of [[3, -3], [-3, 3]] as Array<[number, number]>) {
    const opposite = wires(currents);
    check(opposite[2]!.currentField.components.x < 0, `opposite currents ${currents} push the left wire away from the right wire`);
    check(opposite[3]!.currentField.components.x > 0, `opposite currents ${currents} push the right wire away from the left wire`);
    close(Math.abs(opposite[2]!.currentField.components.x), expected, "repulsive force per length keeps its magnitude");
    close(opposite[2]!.currentField.components.x, -opposite[3]!.currentField.components.x, "the pair of forces is equal and opposite");
  }
  const labels = currentFieldOutputLabels("parallel_wire_force", same);
  check(labels.length === 4, "parallel wires label all four outputs");
  check(!labels[0]!.startsWith("B") && !labels[1]!.startsWith("B"), `a wire is never labelled as a field B: ${labels.slice(0, 2).join(", ")}`);
  check(labels[2]!.startsWith("F") && labels[3]!.startsWith("F"), "the force marks stay labelled F");
  rejects(() => currentFieldOutputLabels("parallel_wire_force", same, ["B", undefined, undefined, undefined]), "a requested B label on a wire is refused");
  const signed = wires([3, -2]);
  check(signed[1]!.currentField.components.y === -2, "the second wire keeps its signed current as metadata");
});

// 2. Cyclotron snapshot: at the +x point of the orbit q (v x B) points to the centre.
await section("2 cyclotron velocity sense gives an inward magnetic force", async () => {
  const { evaluateChapterInstrumentConstruction } = await import("../../src/compile/chapterInstrumentGeometry");
  for (const [charge, field] of [[1.6e-19, 0.5], [1.6e-19, -0.5], [-1.6e-19, 0.5], [-1.6e-19, -0.5]] as Array<[number, number]>) {
    const orbit = evaluateChapterInstrumentConstruction("cyclotron", {
      charge, mass: 1.67e-27, field, speed: 1e6, displayScale: 1e5,
      units: { charge: "C", mass: "kg", field: "T", speed: "m/s" },
    }, sourceContext);
    const circle = orbit[0]!;
    const arrow = orbit[3]!;
    check(circle.kind === "circle" && arrow.kind === "path", "the snapshot draws the orbit and a velocity arrow");
    const centre = circle.center;
    const particle = arrow.points[0]!;
    check(particle.x > centre.x && particle.y === centre.y, "the particle sits at the +x point of its orbit");
    const v = arrow.instrument.components;
    // F = q v x B with B = (0, 0, Bz) and v = (vx, vy, 0): F = q (vy Bz, -vx Bz, 0).
    const force = { x: charge * v.y * field, y: -charge * v.x * field };
    const toCentre = { x: centre.x - particle.x, y: centre.y - particle.y };
    check(force.x * toCentre.x + force.y * toCentre.y > 0, `q=${charge} B=${field}: the magnetic force points to the orbit centre`);
    const drawn = { x: arrow.points[1]!.x - particle.x, y: arrow.points[1]!.y - particle.y };
    check(drawn.x * v.x + drawn.y * v.y > 0, `q=${charge} B=${field}: the drawn arrow follows the velocity`);
  }
});

// 3. Kirchhoff network: an ideal source (zero internal resistance) is solved, not refused.
await section("3 kirchhoff network solves ideal sources", async () => {
  const { evaluateNetworkConstruction } = await import("../../src/compile/networkGeometry");
  type Branch = { id: string; from: string; to: string; current: number };
  const solve = (nodes: Array<{ id: string; at: [number, number] }>, branches: Array<Record<string, unknown>>, ground: string): Branch[] => {
    const output = evaluateNetworkConstruction("kirchhoff_network", { nodes, branches, ground, units: { resistance: "ohm", emf: "V" }, currentScale: 0.4 }, sourceContext);
    return output.filter((item) => item.kind === "compound").map((item) => item.networkBranch!);
  };
  const kcl = (nodes: Array<{ id: string }>, branches: Branch[]): number => Math.max(...nodes.map((node) =>
    Math.abs(branches.reduce((sum, branch) => sum + (branch.from === node.id ? branch.current : 0) - (branch.to === node.id ? branch.current : 0), 0))));
  const current = (branches: Branch[], id: string): number => branches.find((branch) => branch.id === id)!.current;
  const twoLoopNodes: Array<{ id: string; at: [number, number] }> = [
    { id: "bl", at: [0, 0] }, { id: "bc", at: [3, 0] }, { id: "br", at: [6, 0] },
    { id: "tl", at: [0, 2] }, { id: "tc", at: [3, 2] }, { id: "tr", at: [6, 2] },
  ];
  const twoLoop = (leftResistance: number): Array<Record<string, unknown>> => [
    { id: "V1", from: "bl", to: "tl", kind: "source", resistance: leftResistance, emf: 10 },
    { id: "R1", from: "tl", to: "tc", kind: "resistor", resistance: 2 },
    { id: "R3", from: "tc", to: "bc", kind: "resistor", resistance: 4 },
    { id: "R2", from: "tc", to: "tr", kind: "resistor", resistance: 2 },
    { id: "V2", from: "br", to: "tr", kind: "source", resistance: 1, emf: 5 },
    { id: "wbl", from: "bl", to: "bc", kind: "wire" },
    { id: "wbr", from: "bc", to: "br", kind: "wire" },
  ];
  // Guard: finite internal resistance keeps main's solution exactly.
  const finite = solve(twoLoopNodes, twoLoop(1), "bc");
  close(current(finite, "V1"), 1.5151515151515156, "finite left source current is unchanged", 1e-12);
  close(current(finite, "R3"), 1.3636363636363638, "finite shared branch current is unchanged", 1e-12);
  close(current(finite, "V2"), -0.15151515151515138, "finite right source current is unchanged", 1e-12);
  // Guard: a passive branch still needs positive resistance, a source still refuses negative resistance.
  const loopNodes: Array<{ id: string; at: [number, number] }> = [{ id: "a", at: [0, 0] }, { id: "b", at: [2, 0] }];
  rejects(() => solve(loopNodes, [
    { id: "E", from: "a", to: "b", kind: "source", resistance: 1, emf: 6 },
    { id: "R", from: "b", to: "a", kind: "resistor", resistance: 0 },
  ], "a"), "a zero resistance resistor is refused");
  rejects(() => solve(loopNodes, [
    { id: "E", from: "a", to: "b", kind: "source", resistance: -1, emf: 6 },
    { id: "R", from: "b", to: "a", kind: "resistor", resistance: 2 },
  ], "a"), "a negative source resistance is refused");
  rejects(() => solve(loopNodes, [
    { id: "E1", from: "a", to: "b", kind: "source", resistance: 0, emf: 6 },
    { id: "E2", from: "a", to: "b", kind: "source", resistance: 0, emf: 4 },
  ], "a"), "two ideal sources with different emf in parallel have no solution");
  // An ideal source across one resistor drives I = emf / R.
  const ideal = solve(loopNodes, [
    { id: "E", from: "a", to: "b", kind: "source", resistance: 0, emf: 6 },
    { id: "R", from: "b", to: "a", kind: "resistor", resistance: 2 },
  ], "a");
  close(current(ideal, "E"), 3, "an ideal 6 V source across 2 ohm drives 3 A");
  close(current(ideal, "R"), 3, "the resistor carries the same loop current");
  check(kcl(loopNodes, ideal) <= 1e-12, "KCL holds at every node of the ideal loop");
  // Two loops with an ideal left source: nodal oracle V_tr = 70/13, V_tc = 80/13, V_tl = 10.
  const mixed = solve(twoLoopNodes, twoLoop(0), "bc");
  close(current(mixed, "V1"), 25 / 13, "the ideal source current matches the nodal oracle");
  close(current(mixed, "R1"), 25 / 13, "the series resistor carries the ideal source current");
  close(current(mixed, "R3"), 20 / 13, "the shared branch current matches the nodal oracle");
  close(current(mixed, "R2"), 5 / 13, "the right resistor current matches the nodal oracle");
  close(current(mixed, "V2"), -5 / 13, "the real right source current matches the nodal oracle");
  check(kcl(twoLoopNodes, mixed) <= 1e-12, "KCL holds at every node of the mixed network");
  // A node id that looks like an internal key must not collide with a branch current.
  const oddNodes: Array<{ id: string; at: [number, number] }> = [{ id: "ideal:E", at: [0, 0] }, { id: "b", at: [2, 0] }];
  const odd = solve(oddNodes, [
    { id: "E", from: "ideal:E", to: "b", kind: "source", resistance: 0, emf: 6 },
    { id: "R", from: "b", to: "ideal:E", kind: "resistor", resistance: 2 },
  ], "ideal:E");
  close(current(odd, "E"), 3, "a node named ideal:E keeps the ideal source current at 3 A");
  close(current(odd, "R"), 3, "and the return resistor carries the same 3 A");
});

// 4. Directed multi paths: curved field lines keep their sense, and the shared ink
// helper keeps a straight two point vector identical to a plain arrow.
await section("4 directed multi path keeps arrow semantics", async () => {
  const engine = await import("../../src/index");
  const directedCurveInk = (engine as unknown as { directedCurveInk?: (points: readonly Point[]) => { stroke: readonly Point[]; arrow: readonly [Point, Point] | null } }).directedCurveInk;
  check(typeof directedCurveInk === "function", "the engine exports directedCurveInk for the presentation");
  const straight = directedCurveInk!([{ x: 0, y: 0 }, { x: 3, y: 4 }]);
  check(straight.stroke.length === 2 && straight.arrow?.[0].x === 0 && straight.arrow[1].x === 3 && straight.arrow[1].y === 4, "a two point vector is one arrow from start to end");
  const curve = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 15 }, { x: 30, y: 16 }];
  const curved = directedCurveInk!(curve);
  check(curved.stroke.length === 4 && curved.stroke[0] === curve[0] && curved.stroke[3] === curve[3], "a curve keeps every vertex in its stroke, first to last");
  check(curved.arrow?.[0] === curve[2] && curved.arrow[1] === curve[3], "the head sits on the last segment of the curve");
  // A densely sampled curve ends in sub-pixel steps; the board drops a head
  // whose shaft is under 2 px, so the head walks back to a drawable shaft.
  const dense = Array.from({ length: 40 }, (_, step) => ({ x: step * 0.5, y: Math.sqrt(step) }));
  const denseInk = directedCurveInk!(dense);
  const [tail, tip] = denseInk.arrow!;
  check(tip === dense[dense.length - 1], "a dense curve's head still ends at its last vertex");
  check(Math.hypot(tip.x - tail.x, tip.y - tail.y) >= 4, `a dense curve's head shaft is long enough to draw (${Math.hypot(tip.x - tail.x, tip.y - tail.y).toFixed(2)} px)`);
  check(tail === dense[dense.indexOf(tail)] && dense.indexOf(tail) >= dense.length - 10, "the head starts at the nearest vertex far enough back, not at the start");

  const charges = [{ id: "plus", position: { x: -1, y: 0 }, charge: 1 }, { id: "minus", position: { x: 1, y: 0 }, charge: -1 }];
  const lines = await compiledPrimitives(scene("field_lines", {
    charges, starts: [{ x: -0.925, y: 0.13 }], stepLength: 0.1, stepCount: 12, exclusionRadius: 0.1, k: 1,
  }, [["lines", "polyline"]]));
  const strokes = lines.filter((primitive) => primitive.entityId === "lines" && primitive.kind !== "label");
  check(strokes.length === 1, `one traced field line compiles to one stroke (${strokes.length})`);
  check(strokes[0]!.kind === "vector", `a field line keeps its direction as a vector primitive (${strokes[0]!.kind})`);
  check(strokes[0]!.points.length > 2, "the field line keeps its curved samples");
  // Guard: an undirected curve from the same family stays plain ink.
  const level = await compiledPrimitives(scene("equipotential", {
    source: "dipole", charges: [{ position: { x: 1, y: 0 }, charge: 1 }, { position: { x: -1, y: 0 }, charge: -1 }],
    V: 8, k: 1, samples: 96, sampleDomain: { min: { x: -3, y: -3 }, max: { x: 3, y: 3 } },
  }, [["level", "polyline"]]));
  const levelStrokes = level.filter((primitive) => primitive.entityId === "level" && primitive.kind !== "label");
  check(levelStrokes.length >= 1 && levelStrokes.every((primitive) => primitive.kind === "polyline"), `an equipotential stays undirected polyline ink (${levelStrokes.map((primitive) => primitive.kind).join(",")})`);
});

// 5. Point to line incidence: a point exactly on the line measures zero, and a
// section point at a true zero is zero.
await section("5 exact point line residual and section weights", async () => {
  const { evaluateAnalyticLineConstruction } = await import("../../src/compile/analyticLineGeometry");
  const distance = (point: [number, number], a: number, b: number, c: number) =>
    evaluateAnalyticLineConstruction("point_line_distance", { point: { x: point[0], y: point[1] }, a, b, c }, sourceContext);
  // Guards: decimal stems that main already draws on the line must stay on the line.
  for (const [point, a, b, c] of [[[0.1, 0.2], 2, 4, -1], [[1, 2], 0.1, 0.2, -0.5]] as Array<[[number, number], number, number, number]>) {
    const output = distance(point, a, b, c);
    check(output.length === 1 && output[0]!.kind === "point", `(${point}) on ${a}x + ${b}y + ${c} = 0 is drawn on the line`);
    check(output[0]!.analyticLine.distance === 0, `(${point}) on ${a}x + ${b}y + ${c} = 0 measures zero`);
  }
  // Guard: an ordinary off line point keeps its distance and foot.
  const off = distance([3, 4], 1, 1, 0);
  check(off[0]!.kind === "path", "an off line point draws its foot segment");
  close(off[0]!.analyticLine.distance ?? NaN, 7 / Math.SQRT2, "off line distance is |ax + by + c| / sqrt(a^2 + b^2)", 1e-12);
  // a x + b y + c is exactly zero in binary64 inputs, but the rounded float sum is -2^-104.
  const a = 1 + 2 ** -52;
  const onLine = distance([1 + 2 ** -52, 1 + 2 ** -51], a, -1, -(2 ** -104));
  check(onLine.length === 1 && onLine[0]!.kind === "point" && onLine[0]!.analyticLine.distance === 0, "a point exactly on the line is on the line, not a refused sub resolution distance");

  const section = (a: [number, number], b: [number, number], m: number, n: number, mode = "internal") => {
    const output = evaluateAnalyticLineConstruction("section_point", { a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, mode, m, n }, sourceContext);
    check(output.length === 1 && output[0]!.kind === "point", "a section point is a point");
    return (output[0] as { point: Point }).point;
  };
  // (n a + m b) / (m + n) is exactly zero for these integers.
  for (const [left, right, m, n] of [[[2, 5], [-3, 7], 2, 3], [[-1, 1], [5, 1], 1, 5], [[-6, 0], [9, 0], 2, 3]] as Array<[[number, number], [number, number], number, number]>) {
    const point = section(left, right, m, n);
    check(point.x === 0, `the ${m}:${n} section of x=${left[0]} and x=${right[0]} is exactly 0, got ${point.x}`);
  }
  // A valid ratio written with tiny weights must not underflow its numerator.
  const tiny = section([0, 0], [0.25, 1], Number.MIN_VALUE, Number.MIN_VALUE);
  check(tiny.x === 0.125 && tiny.y === 0.5, `a 1:1 ratio written as MIN_VALUE:MIN_VALUE is the midpoint, got (${tiny.x}, ${tiny.y})`);
  // Guard: an ordinary internal section is unchanged.
  const plain = section([1, 2], [4, 8], 1, 2);
  close(plain.x, 2, "1:2 section x"); close(plain.y, 4, "1:2 section y");
});

// 6. Dipole torque: tau = p x E is normal to the page, so the board draws a
// page normal glyph and never an arrow along p.
await section("6 dipole torque draws a page normal glyph", async () => {
  const { evaluateDipoleFieldConstruction } = await import("../../src/compile/dipoleFieldGeometry");
  const torque = (p: Point, E: Point, displayLength = 9) =>
    evaluateDipoleFieldConstruction("dipole_torque", { p, E, at: { x: 0, y: 0 }, displayLength }, sourceContext)[0]!;
  const ringRadius = (path: readonly Point[]): number => Math.max(...path.map((point) => Math.hypot(point.x, point.y)));
  const out = torque({ x: 1, y: 0 }, { x: 0, y: 2 });
  check(out.dipoleField.tau === 2 && out.dipoleField.tauSense === "out-of-page", "positive tau is out of the page");
  check(out.kind === "multi_path", `nonzero torque is a glyph, not an arrow (${out.kind})`);
  if (out.kind !== "multi_path") return;
  check(out.paths.every((path) => !path.directed), "the glyph has no directed stroke");
  close(ringRadius(out.paths[0]!.points), 4.5, "the outer ring radius is half the display length", 1e-9);
  check(out.paths.length === 2 && ringRadius(out.paths[1]!.points) < 0.5, "out of page adds a centre dot");
  check((out.dipoleField as { pageNormal?: unknown }).pageNormal === "out", "the glyph declares its page normal sense");
  check(out.dipoleField.components === undefined, "the torque mark does not reuse p as its components");
  close(out.dipoleField.magnitude ?? NaN, 2, "the magnitude is |tau|");
  const into = torque({ x: 1, y: 0 }, { x: 0, y: -2 });
  check(into.kind === "multi_path" && into.paths.length === 3 && into.paths.slice(1).every((path) => path.points.length === 2), "into the page draws a cross");
  check((into.dipoleField as { pageNormal?: unknown }).pageNormal === "in" && into.dipoleField.tau === -2, "negative tau is into the page");
  const zero = torque({ x: 2, y: 0 }, { x: 4, y: 0 });
  check(zero.kind === "point" && zero.dipoleField.tau === 0, "zero torque draws no direction");

  const compiled = await compiledPrimitives(scene("dipole_torque", { p: { x: 2, y: 0 }, E: { x: 0, y: 3 }, at: { x: 0, y: 0 }, displayLength: 1 }, [["tau", "vector"]]));
  const strokes = compiled.filter((primitive) => primitive.entityId === "tau" && primitive.kind !== "label");
  check(strokes.length >= 2 && strokes.every((primitive) => primitive.kind === "polyline"), `the compiled torque is undirected glyph ink (${strokes.map((primitive) => primitive.kind).join(",")})`);
});

// 7. Orbital box cue: the Pauli principle is a cue, the chemist Pauling is not.
await section("7 orbital box Pauli cue is a whole word", async () => {
  const { isOrbitalStem } = await import("../../src/chemistry/orbitalBox");
  check(!isOrbitalStem("Arrange F, Cl, Br and I in increasing order of Pauling electronegativity."), "Pauling electronegativity is not an orbital box stem");
  check(!isOrbitalStem("Who was Linus Pauling and what did he contribute to chemistry?"), "Linus Pauling is not an orbital box stem");
  check(isOrbitalStem("State the Pauli exclusion principle."), "the Pauli exclusion principle still routes");
  check(isOrbitalStem("Explain Pauli's principle for two electrons in one orbital."), "Pauli's principle still routes");
});

console.log(`verify-engine-geometry-corrections: ${checks} checks, ${failures.length} failed section(s)`);
if (failures.length) {
  console.log(`failed: ${failures.join("; ")}`);
  process.exit(1);
}
