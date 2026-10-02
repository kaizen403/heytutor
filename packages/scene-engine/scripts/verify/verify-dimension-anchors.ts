import { compileSceneDocument, validateSceneDocument, type RenderPoint, type RenderScene, type SceneDocument } from "../../src/index";
import { chemistryFamilyBuilder } from "../../src/chemistry";
import { pruneDeadSceneEntities } from "../../src/document/validation";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type Span = [RenderPoint, RenderPoint];
const samePoint = (a: RenderPoint, b: RenderPoint) => Math.hypot(a.x - b.x, a.y - b.y) < 0.02;

function candidate(spans: Span[], label?: "entity" | "annotation"): SceneDocument {
  const ids = spans.flatMap((_, index) => [`a${index}`, `b${index}`, `edge${index}`, `dim${index}`]);
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "verify exact measurement anchors" },
    source: { question: "Mark the distances between the supplied endpoints." },
    quantities: [],
    entities: spans.flatMap((_, index) => [
      { id: `a${index}`, kind: "point", role: "span start" },
      { id: `b${index}`, kind: "point", role: "span end" },
      { id: `edge${index}`, kind: "segment", role: "measured edge" },
      { id: `dim${index}`, kind: "dimension", role: "distance", ...(label === "entity" ? { label: "d" } : {}) },
    ]),
    constructions: spans.flatMap(([a, b], index) => [
      { id: `make_a${index}`, operator: "point", inputs: a, outputs: [`a${index}`] },
      { id: `make_b${index}`, operator: "point", inputs: b, outputs: [`b${index}`] },
      { id: `make_edge${index}`, operator: "segment", inputs: { start: `a${index}`, end: `b${index}` }, outputs: [`edge${index}`] },
      { id: `make_dim${index}`, operator: "dimension", inputs: { start: `a${index}`, end: `b${index}` }, outputs: [`dim${index}`] },
    ]),
    relations: [],
    assertions: [],
    annotations: label === "annotation" ? [{ id: "distance_label", kind: "label", targetIds: ["dim0"], text: "d" }] : [],
    requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "Mark the distances." }],
    teachingTimeline: [{ id: "show", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Show the measurements." }],
  };
}

function compile(scene: SceneDocument): RenderScene {
  const validated = validateSceneDocument(scene);
  assert(validated.document, `validation: ${JSON.stringify(validated.report.issues)}`);
  const result = compileSceneDocument(validated.document);
  assert(result.ok && result.renderScene, `compile: ${JSON.stringify(result.report.issues)}`);
  return result.renderScene;
}

function measure(scene: RenderScene, index: number) {
  const bar = scene.primitives.find((primitive) => primitive.entityId === `dim${index}` && primitive.kind === "dimension");
  const edge = scene.primitives.find((primitive) => primitive.entityId === `edge${index}` && primitive.kind === "line");
  const witnesses = scene.primitives.filter((primitive) => primitive.entityId === `dim${index}` && primitive.provenance?.measurementRole === "witness");
  assert(bar && edge, "Every distance must have a bar and measured edge.");
  assert(witnesses.length === 2, "A displaced dimension must keep two exact endpoint witness lines.");
  assert(bar.provenance?.measurementRole === "bar", "The bar must identify its measurement role for coordinated reveal.");
  const measuredStart = bar.provenance?.measuredStart as RenderPoint;
  const measuredEnd = bar.provenance?.measuredEnd as RenderPoint;
  assert(measuredStart && measuredEnd && samePoint(measuredStart, edge.points[0]!) && samePoint(measuredEnd, edge.points[1]!), "Measured endpoints must stay attached to the verified edge.");
  const dx = edge.points[1]!.x - edge.points[0]!.x;
  const dy = edge.points[1]!.y - edge.points[0]!.y;
  const length = Math.hypot(dx, dy);
  witnesses.forEach((witness, endpoint) => {
    assert(samePoint(witness.points[0]!, edge.points[endpoint]!), "A witness must start exactly on its measured endpoint.");
    const wx = witness.points[1]!.x - witness.points[0]!.x;
    const wy = witness.points[1]!.y - witness.points[0]!.y;
    assert(Math.abs((wx * dx + wy * dy) / length) < 0.02, "Witness lines must be perpendicular to the measured span.");
    const bx = bar.points[endpoint]!.x - witness.points[0]!.x;
    const by = bar.points[endpoint]!.y - witness.points[0]!.y;
    assert(Math.abs(wx * by - wy * bx) < 0.5, "A bar cap must lie on its own endpoint witness.");
    assert(Math.hypot(wx, wy) > Math.hypot(bx, by), "Witnesses must extend slightly past the bar cap.");
  });
  assert(Math.abs(Math.hypot(bar.points[1]!.x - bar.points[0]!.x, bar.points[1]!.y - bar.points[0]!.y) - length) < 0.02, "Offsetting must preserve the measured span length.");
  for (const primitive of [bar, ...witnesses]) {
    assert(primitive.points.every((point) => point.x >= 410 && point.x <= 1150 && point.y >= 55 && point.y <= 610), "Measurement ink must stay inside its viewport.");
  }
  return { bar, edge, offset: Math.hypot(bar.points[0]!.x - edge.points[0]!.x, bar.points[0]!.y - edge.points[0]!.y) };
}

for (const [name, span] of Object.entries({
  horizontal: [{ x: 0, y: 0 }, { x: 4, y: 0 }],
  vertical: [{ x: 0, y: 0 }, { x: 0, y: 4 }],
  diagonal: [{ x: 0, y: 0 }, { x: 4, y: 3 }],
  reversed: [{ x: 4, y: 3 }, { x: 0, y: 0 }],
}) as Array<[string, Span]>) {
  const scene = compile(candidate([span]));
  measure(scene, 0);
  assert(JSON.stringify(scene) === JSON.stringify(compile(candidate([span]))), `${name} layout must be deterministic.`);
}

const nested = compile(candidate([
  [{ x: 0, y: 0 }, { x: 4, y: 0 }],
  [{ x: 1, y: 0 }, { x: 3, y: 0 }],
]));
assert(measure(nested, 0).offset > measure(nested, 1).offset + 20, "A longer overlapping span must use the outer lane.");
const unrelated = compile(candidate([
  [{ x: 0, y: 0 }, { x: 2, y: 0 }],
  [{ x: 3, y: 0 }, { x: 5, y: 0 }],
  [{ x: 0, y: 2 }, { x: 2, y: 2 }],
]));
assert([0, 1, 2].every((index) => Math.abs(measure(unrelated, index).offset - 28) < 0.02), "Unrelated spans must reuse the first lane instead of drifting farther away.");

const span: Span = [{ x: 0, y: 0 }, { x: 4, y: 0 }];
const entityLabeled = compile(candidate([span], "entity"));
const annotationLabeled = compile(candidate([span], "annotation"));
const entityLabel = entityLabeled.primitives.find((primitive) => primitive.kind === "label" && primitive.entityId === "dim0");
const annotationLabel = annotationLabeled.primitives.find((primitive) => primitive.kind === "label" && primitive.entityId === "dim0");
assert(entityLabel && annotationLabel && samePoint(entityLabel.points[0]!, annotationLabel.points[0]!), "Entity and annotation labels must anchor to the same displaced bar.");

const impossible = compileSceneDocument(candidate([span]), { viewport: { x: 410, y: 55, width: 20, height: 20, padding: 0 } });
assert(!impossible.ok && impossible.renderScene === null, "A viewport without room for a truthful dimension must fail closed.");
const coincidentCandidate = candidate([[{ x: 1, y: 1 }, { x: 1, y: 1 }]]);
coincidentCandidate.entities = coincidentCandidate.entities.filter((entity) => entity.id !== "edge0");
coincidentCandidate.constructions = coincidentCandidate.constructions.filter((construction) => !construction.outputs.includes("edge0"));
coincidentCandidate.requiredEntityIds = coincidentCandidate.requiredEntityIds.filter((id) => id !== "edge0");
coincidentCandidate.revealGroups[0]!.entityIds = [...coincidentCandidate.requiredEntityIds];
const coincident = compileSceneDocument(coincidentCandidate);
assert(!coincident.ok && coincident.renderScene === null && coincident.report.issues.some((issue) => issue.code === "construction_failed" && issue.entityIds?.includes("dim0")), "Coincident measurement endpoints must fail closed instead of producing meaningless caps.");

function withCarrier(at: number): SceneDocument {
  const specimen = candidate([[{ x: 0, y: 0 }, { x: 4, y: 0 }]], "entity");
  specimen.entities.push({ id: "carrier", kind: "line", role: "continuous measured surface" });
  specimen.constructions.push({ id: "make_carrier", operator: "line", inputs: {
    start: { x: at, y: -3 }, end: { x: at, y: 3 },
  }, outputs: ["carrier"] });
  specimen.requiredEntityIds.push("carrier");
  specimen.revealGroups[0]!.entityIds.push("carrier");
  return specimen;
}
for (const endpoint of [0, 4]) {
  const anchoredCarrier = compile(withCarrier(endpoint));
  measure(anchoredCarrier, 0);
}
const crossedCarrier = compileSceneDocument(withCarrier(2));
assert(!crossedCarrier.ok && crossedCarrier.renderScene === null && crossedCarrier.report.issues.some((issue) => issue.code === "dimension_overlap_unresolved"), "An unrelated continuous surface crossing the interior of a measurement must never receive the endpoint-contact exemption.");

const crowded = candidate([
  [{ x: 0, y: 0 }, { x: 5, y: 0 }],
  [{ x: 1, y: 0 }, { x: 3, y: 0 }],
  [{ x: 0, y: 2 }, { x: 4, y: 4 }],
  [{ x: 5, y: 1 }, { x: 5, y: 4 }],
], "entity");
crowded.entities.filter((entity) => entity.kind === "dimension").forEach((entity, index) => {
  entity.label = ["5 cm", "2 cm", "s", "h"][index];
});
const crowdedScene = compile(crowded);
for (const index of [0, 1]) {
  const { bar } = measure(crowdedScene, index);
  const label = crowdedScene.primitives.find((primitive) => primitive.kind === "label" && primitive.entityId === `dim${index}`);
  const bounds = label?.provenance?.labelBounds as { x: number; y: number; width: number; height: number } | undefined;
  assert(label && bounds && bounds.y > bar.points[0]!.y + 5, "Nested measurement labels must sit beyond their own bar, clear of the measured figure.");
  assert(label.provenance?.usesLeader === false, "Distance labels must not send leaders across other bars or measured spans.");
  assert(bounds.y + bounds.height <= 610, "The reserved dimension envelope must include the full label.");
}

const cft = chemistryFamilyBuilder("chem_cft")!(
  "Which of the following is diamagnetic: [Ni(CO)4], [NiCl4]2-, [Fe(CN)6]3-?", [], false,
);
assert(cft, "The source-grounded CFT comparison must produce its three complexes.");
const cftValidated = validateSceneDocument(pruneDeadSceneEntities(cft as unknown as Record<string, unknown>));
assert(cftValidated.document, `CFT schema: ${JSON.stringify(cftValidated.report.issues)}`);
const cftCompiled = compileSceneDocument(cftValidated.document);
assert(cftCompiled.ok && cftCompiled.renderScene, `Internal gap measurements must find precise nearby label space: ${JSON.stringify(cftCompiled.report.issues)}`);
for (const bar of cftCompiled.renderScene.primitives.filter((primitive) => primitive.kind === "dimension")) {
  const label = cftCompiled.renderScene.primitives.find((primitive) => primitive.kind === "label" && primitive.entityId === bar.entityId);
  assert(label, `CFT gap ${bar.entityId} must keep its label.`);
  const center = { x: (bar.points[0]!.x + bar.points[1]!.x) / 2, y: (bar.points[0]!.y + bar.points[1]!.y) / 2 };
  assert(Math.hypot(label.points[0]!.x - center.x, label.points[0]!.y - center.y) <= 120, "Internal measurement labels must remain tethered to their own gap.");
  assert(cftCompiled.renderScene.primitives.filter((primitive) => primitive.entityId === bar.entityId && primitive.provenance?.measurementRole === "witness").length === 2, "An internal gap must preserve both exact endpoint witnesses.");
}

const energy = chemistryFamilyBuilder("chem_thermo")!(
  "For an exothermic reaction the activation energy of the forward reaction is 60 kJ/mol and ΔH = −20 kJ/mol. Draw the energy profile diagram.", [], false,
);
assert(energy, "The source-grounded energy profile must produce a scene.");
const energyValidated = validateSceneDocument(pruneDeadSceneEntities(energy as unknown as Record<string, unknown>));
assert(energyValidated.document, `energy schema: ${JSON.stringify(energyValidated.report.issues)}`);
const energyCompiled = compileSceneDocument(energyValidated.document);
assert(energyCompiled.ok && energyCompiled.renderScene, `Exact activation energy must find a clear measurement lane: ${JSON.stringify(energyCompiled.report.issues)}`);
const activation = energyCompiled.renderScene.primitives.find((primitive) => primitive.kind === "dimension" && primitive.entityId === "ea_dim")!;
const peak = energyCompiled.renderScene.primitives.find((primitive) => primitive.kind === "point" && primitive.entityId === "ts_point_1")!.points[0]!;
assert(samePoint(activation.provenance?.measuredEnd as RenderPoint, peak), "Relocating a bar must preserve its exact transition-state endpoint.");
const profile = energyCompiled.renderScene.primitives.find((primitive) => primitive.entityId === "profile" && primitive.kind === "polyline")!;
assert(profile, "The energy profile must remain visible.");
const barX = activation.points[0]!.x;
const lowY = Math.min(...activation.points.map((point) => point.y));
const highY = Math.max(...activation.points.map((point) => point.y));
profile.points.slice(1).forEach((end, index) => {
  const start = profile.points[index]!;
  const dx = end.x - start.x;
  if (Math.abs(dx) < 0.00001) return;
  const t = (barX - start.x) / dx;
  if (t < 0 || t > 1) return;
  const y = start.y + (end.y - start.y) * t;
  assert(y < lowY - 4 || y > highY + 4, "The relocated activation-energy bar must clear the actual profile curve.");
});
console.log("exact dimension anchor verification passed");
