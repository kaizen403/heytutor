import assert from "node:assert/strict";
import { compileSceneDocument, pruneDeadSceneEntities, validateSceneDocument, validateTurnPlanSceneProofs } from "../../src/index";
import { buildTopologyGraph } from "../../src/topology/topology";
import { capacitorCircuit, capacitorDrawnTwice, capacitorPlan, freeCapacitorPlates } from "./fixtures/capacitor-circuit";

let checks = 0;
let fixedProfile: number[] | undefined;
for (const degrees of [0, 30, 45, 90, 135, 180, 225, 270, 315]) for (const reversed of [false, true]) {
  const document = capacitorCircuit();
  const angle = degrees * Math.PI / 180;
  for (const construction of document.constructions) if (construction.operator === "point") {
    const x = Number(construction.inputs.x), y = Number(construction.inputs.y);
    construction.inputs.x = 7 + x * Math.cos(angle) - y * Math.sin(angle);
    construction.inputs.y = -3 + x * Math.sin(angle) + y * Math.cos(angle);
  }
  const capacitor = document.constructions.find(({ id }) => id === "make_capacitor")!;
  if (reversed) [capacitor.inputs.start, capacitor.inputs.end] = [capacitor.inputs.end, capacitor.inputs.start];
  const validated = validateSceneDocument(pruneDeadSceneEntities({ ...document }));
  assert.ok(validated.document);
  assert.deepEqual(validateTurnPlanSceneProofs(validated.document, capacitorPlan), [], "a canonical component closes the battery loop");
  const edge = buildTopologyGraph(validated.document).edgeById.get("capacitor");
  assert.deepEqual([edge?.a, edge?.b], [capacitor.inputs.start, capacitor.inputs.end], "electrical ports come only from the declared terminal IDs");
  const compiled = compileSceneDocument(validated.document);
  assert.ok(compiled.ok && compiled.renderScene);
  const paths = compiled.renderScene.primitives.filter((primitive) => primitive.entityId === "capacitor" && primitive.kind === "polyline").map(({ points }) => points);
  assert.equal(paths.length, 4, "two leads and two fixed plates; no stroke bridges the gap");
  assert.ok(paths.every((path) => path.length === 2));
  const [lead1, plate1, plate2, lead2] = paths;
  const start = lead1![0]!, end = lead2![1]!;
  const dx = end.x - start.x, dy = end.y - start.y, span = Math.hypot(dx, dy);
  const midpoint = (path: typeof start[]) => ({ x: (path[0]!.x + path[1]!.x) / 2, y: (path[0]!.y + path[1]!.y) / 2 });
  const progress = (point: typeof start) => ((point.x - start.x) * dx + (point.y - start.y) * dy) / span ** 2;
  const centers = [midpoint(plate1!), midpoint(plate2!)];
  const plateLengths = [plate1!, plate2!].map((plate) => Math.hypot(plate[1]!.x - plate[0]!.x, plate[1]!.y - plate[0]!.y));
  for (const plate of [plate1!, plate2!]) {
    const center = midpoint(plate);
    assert.ok(Math.abs((center.x - start.x) * dy - (center.y - start.y) * dx) / span < 0.03, "each plate is centered on the terminal axis");
    assert.ok(Math.abs((plate[1]!.x - plate[0]!.x) * dx + (plate[1]!.y - plate[0]!.y) * dy) / span < 0.03, "plates stay perpendicular to the terminal axis");
  }
  assert.ok(plateLengths[0]! > 0 && Math.abs(plateLengths[0]! - plateLengths[1]!) < 0.03, "plates have equal positive length");
  assert.ok(progress(centers[0]!) > 0 && progress(centers[0]!) < progress(centers[1]!) && progress(centers[1]!) < 1, "a positive plate gap lies inside the two outer terminals");
  assert.ok(Math.hypot(lead1![1]!.x - centers[0]!.x, lead1![1]!.y - centers[0]!.y) < 0.03);
  assert.ok(Math.hypot(lead2![0]!.x - centers[1]!.x, lead2![0]!.y - centers[1]!.y) < 0.03, "each lead ends at its own plate, not across the gap");
  const profile = [progress(centers[0]!), progress(centers[1]!), plateLengths[0]! / span];
  fixedProfile ??= profile;
  assert.ok(profile.every((value, index) => Math.abs(value - fixedProfile![index]!) < 0.001), "the engine owns one fixed glyph profile under rotation and terminal reversal");
  checks += 15;
}

for (const variant of ["parallel", "touching", "perpendicular", "collinear"] as const) {
  const document = freeCapacitorPlates();
  const plate = document.constructions.find(({ id }) => id === "make_plate2")!;
  if (variant === "touching") plate.inputs = { start: [3, 1.2], end: [5, 1.2] };
  if (variant === "perpendicular") plate.inputs = { start: [4, 0.5], end: [4, 1.5] };
  if (variant === "collinear") plate.inputs = { start: [5, 1.2], end: [7, 1.2] };
  const issues = validateTurnPlanSceneProofs(document, capacitorPlan);
  const issue = issues.find(({ code }) => code === "source_loop_not_closed");
  assert.ok(issue, "free plate strokes never establish an electrical component edge");
  assert.match(issue.message, /symbol.*capacitor/);
  assert.match(issue.message, /start.*end/);
  assert.match(issue.message, /point IDs/);
  checks += 4;
}
const unnamedPlates = freeCapacitorPlates();
for (const entity of unnamedPlates.entities) if (entity.id.startsWith("plate")) entity.role = "plate";
assert.match(validateTurnPlanSceneProofs(unnamedPlates, capacitorPlan).find(({ code }) => code === "source_loop_not_closed")!.message, /symbol.*capacitor/, "the source request can identify the repair even when plate roles omit capacitor");
checks++;
const resistorOnlyPlan = { ...capacitorPlan, question: "Sketch the stated battery and resistor circuit; do not add a capacitor." };
const noCapacitorInstruction = validateTurnPlanSceneProofs(unnamedPlates, resistorOnlyPlan).find(({ code }) => code === "source_loop_not_closed")!.message;
assert.match(noCapacitorInstruction, /If the required component is a capacitor/, "a negative source mention must not turn repair advice into a directive to add a capacitor");
assert.match(noCapacitorInstruction, /never bypass a component/);
checks += 2;
// A capacitor symbol already draws both plates. Free segments wired to its
// terminals draw the capacitor a second time, and open switch wording does not
// waive that.
for (const kind of ["K", "N", "recorded"] as const) {
  for (const plan of [capacitorPlan, { ...capacitorPlan, assumptions: ["The switch is open."] }]) {
    const document = capacitorDrawnTwice(kind);
    assert.ok(validateSceneDocument(pruneDeadSceneEntities({ ...structuredClone(document) })).document, `${kind}: the double draw is otherwise a well formed document`);
    const issue = validateTurnPlanSceneProofs(document, plan).find(({ code }) => code === "capacitor_depicted_twice");
    assert.ok(issue, `${kind}: a capacitor drawn as a symbol and as free plates is refused`);
    assert.equal(issue.severity, "fatal");
    assert.equal(issue.failureKind, "truth", "a double drawn capacitor is a false figure, not a missing proof");
    assert.match(issue.message, /delete the free plate segments/);
    checks += 5;
  }
}
assert.equal(validateTurnPlanSceneProofs(capacitorCircuit(), capacitorPlan).some(({ code }) => code === "capacitor_depicted_twice"), false, "the native symbol alone is one capacitor");
assert.match(validateTurnPlanSceneProofs(freeCapacitorPlates(), capacitorPlan).find(({ code }) => code === "source_loop_not_closed")!.message, /delete the free plate segments/, "the closure repair tells the planner to delete free plates");
checks += 2;
console.log(`Capacitor terminals: ${checks} checks passed`);
