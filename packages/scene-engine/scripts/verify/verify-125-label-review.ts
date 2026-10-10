import { compileSceneDocument } from "../../src/compile/compiler";
import type { SceneDocument } from "../../src/types";
let checks = 0;
const failures: string[] = [];
const check = (condition: unknown, message: string) => { checks++; if (!condition) failures.push(message); };
function scene(): SceneDocument {
  return { schemaVersion: "scene-document/v2", source: {}, visualDecision: { mode: "scene", reason: "source-created review witness" }, quantities: [], entities: [], constructions: [], relations: [], assertions: [], annotations: [], requiredEntityIds: [], revealGroups: [], teachingTimeline: [] };
}
function add(d: SceneDocument, id: string, kind: string, operator: string, inputs: Record<string, unknown>, label?: string): void {
  d.entities.push({ id, kind, role: kind, ...(label === undefined ? {} : { label }) });
  d.constructions.push({ id: `make_${id}`, operator, inputs, outputs: [id] });
  d.requiredEntityIds.push(id);
}
function compile(d: SceneDocument) {
  d.revealGroups = [{ id: "all", entityIds: d.requiredEntityIds, dependsOn: [], narrationCue: "reveal" }];
  return compileSceneDocument(d);
}
function helix(): SceneDocument {
  const d = scene();
  add(d, "O", "point", "point", { x: 0, y: 0 });
  add(d, "frame", "polyline", "space_frame", { origin: "O", scale: 1, axisLength: 1 });
  add(d, "start", "point", "space_point", { frame: "frame", x: 0, y: 0, z: 0 });
  add(d, "path", "polyline", "magnetic_helix", { frame: "frame", origin: "start", mass: 1e-26, charge: 1e-19, velocity: [3e5, 0, 4e5], magneticField: [0, 0, 0.5], turns: 2, displayScale: 1, units: { mass: "kg", charge: "C", velocity: "m/s", magneticField: "T" } }, "helix");
  return d;
}
for (const text of ["9 m", "9m", "radius 9 m", "r=0.06 m; 9 m", "pitch 9 mm", "0 m", "9"]) {
  for (const placement of ["entity", "callout", "label"] as const) {
    const d = helix();
    if (placement === "entity") d.entities.at(-1)!.label = text;
    else if (placement === "callout") d.annotations.push({ id: "claim", kind: "callout", targetIds: ["path"], text });
    else add(d, "claim", "label", "label", { target: "path", text }, text);
    const result = compile(d);
    check(!result.ok && result.report.issues.some(i => i.code === "invalid_magnetic_helix_label"), `${placement} refuses ambiguous measurement ${text}`);
  }
}
for (const text of ["helix", "3D helix", "r=0.06 m", "radius≈6 cm", "p≈0.5027 m", "r=60 mm; p≈502.7 mm"]) {
  const d = helix();
  d.annotations.push({ id: "verified", kind: "callout", targetIds: ["path"], text });
  check(compile(d).ok, `verified or symbolic helix label survives: ${text}`);
}
const wave = scene(); wave.source = { nonMetric: true, representationTier: "qualitative_verified" };
add(wave, "wave", "polyline", "harmonic_wave", { amplitude: 1, waveNumber: 1, angularFrequency: 0, phase: 0, phaseUnit: "rad", time: 0, xMin: 0, xMax: 2 * Math.PI });
add(wave, "sample", "point", "wave_sample", { wave: "wave", x: Math.PI / 2 });
const representative = compile(wave);
check(representative.ok, "symbolic wave and sample compile");
check(representative.renderScene?.primitives.some(p => p.entityId === "sample" && p.text === "y"), "representative sample displays a symbol rather than normalized height");
const physical = structuredClone(wave); physical.source = {}; physical.quantities = [{ id: "A", value: 1, unit: "m" }];
check(compile(physical).renderScene?.primitives.some(p => p.entityId === "sample" && p.text === "y=1"), "stated wave source retains checked numeric sample");
const explicit = structuredClone(wave); explicit.entities.at(-1)!.label = "y=1";
check(!compile(explicit).ok, "representative planner numeric sample claim refuses");
const force = scene(); force.source = { nonMetric: true };
add(force, "F", "vector", "magnetic_force", { charge: 2, velocity: [3, 0, 0], magneticField: [0, 0, 4], units: { charge: "C", velocity: "m/s", magneticField: "T" }, origin: [0, 0], displayLength: 2 }, "F");
force.annotations = [{ id: "rule", kind: "narration", targetIds: ["F"], text: "Force is largest at π/2" }];
check(compile(force).ok, "unrendered narration of an angle rule cannot cancel representative force ink");
const value = structuredClone(force); value.annotations = [{ id: "claim", kind: "callout", targetIds: ["F"], text: "F=24 N" }];
check(!compile(value).ok, "visible physical measurement still refuses");
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`125 label review: ${checks}/${checks} checks passed`);
