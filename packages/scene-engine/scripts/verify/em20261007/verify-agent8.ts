/**
 * Agent 8 public-seam verification: independent physical/scalar holdouts,
 * shared E/B phase and handedness, complete compiled marks/labels, source
 * admission metadata, incompatible-source rejection and atomic failure.
 * All captured scenes are complete 1200×700 offline frames, not live-board
 * screenshots or student-runtime acceptance evidence.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileSceneDocument } from "../../../src/compile/compiler";
import { validateSceneDocument } from "../../../src/document/validation";
import { validateProblemIR } from "../../../src/ir/problemIR";
import { consumePhysicalModel, standardCases } from "../../../src/physics/em20261007/consume";
import * as emWavePacket from "../../../src/physics/em20261007/agent8-em-waves";
import { synthesizeFamilyScene } from "../../../src/synthesize/familyScene";
import { renderSceneSvg } from "../../lib/renderSceneSvg";
import type { RenderScene, SceneDocument } from "../../../src/types";

const BANDS = ["radio", "microwave", "infrared", "visible", "ultraviolet", "xray", "gamma"] as const;
const PACKET_MODELS = [
  "emw.triad", "emw.amplitude", "emw.speed", "emw.energy",
  "emw.production", "emw.spectrum", "emw.applications", "emw.displacement",
] as const;
type PacketModel = (typeof PACKET_MODELS)[number];

const modelFailures = new Map<string, string[]>();
const renderedCases: Array<{ name: string; label: string; scene: RenderScene }> = [];
let checks = 0;
function fail(model: string, reason: string): void {
  const existing = modelFailures.get(model) ?? [];
  existing.push(reason);
  modelFailures.set(model, existing);
}

function compileModel(name: string, inputs: Record<string, number>, label: string): RenderScene | null {
  const consumed = consumePhysicalModel(name, inputs);
  if (consumed.status !== "scene") {
    fail(name, `${label}: ${consumed.status === "rejected" ? `rejected (${consumed.reason})` : "unclaimed"}`);
    return null;
  }
  const validated = validateSceneDocument(consumed.document);
  if (!validated.document) {
    fail(name, `${label}: validation ${validated.report.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`);
    return null;
  }
  const compiled = compileSceneDocument(validated.document);
  if (!compiled.ok || !compiled.renderScene || compiled.report.issues.some((issue) => issue.severity === "fatal")) {
    fail(name, `${label}: compile ${compiled.report.issues.map((issue) => issue.message).join("; ")}`);
    return null;
  }
  renderedCases.push({ name, label, scene: compiled.renderScene });
  return compiled.renderScene;
}

function labelTexts(scene: RenderScene): string[] {
  return scene.primitives.filter((primitive) => primitive.kind === "label").map((primitive) => primitive.text ?? "");
}

const cases = new Map(standardCases().map((item) => [item.modelName, item] as const));
function sampleOf(name: PacketModel, sample: "ordinary" | "altered"): Record<string, number> {
  const item = cases.get(name);
  if (!item) {
    fail(name, `${sample}: missing standard case`);
    return {};
  }
  return sample === "ordinary" ? item.ordinary : item.altered;
}

function expectRejected(name: string, inputs: Record<string, number>, label: string): void {
  checks += 1;
  const consumed = consumePhysicalModel(name, inputs);
  if (consumed.status !== "rejected") fail(name, `${label}: ${JSON.stringify(inputs)} was not rejected`);
}

function documentOf(name: string, inputs: Record<string, unknown>, label: string): SceneDocument | null {
  const consumed = consumePhysicalModel(name, inputs);
  if (consumed.status !== "scene") {
    fail(name, `${label}: ${consumed.status === "rejected" ? consumed.reason : consumed.status}`);
    return null;
  }
  return consumed.document;
}

function close(name: string, actual: unknown, expected: number, label: string): void {
  checks += 1;
  if (typeof actual !== "number" || !Number.isFinite(actual) || Math.abs(actual - expected) > (expected === 0 ? 1e-12 : 1e-10 * Math.max(Math.abs(expected), 1e-100))) {
    fail(name, `${label}: ${String(actual)} != independent expected ${expected}`);
  }
}

const exported = emWavePacket as unknown as {
  emWaveSourceAdmissions?: Array<{ name: string; resultKind: string; roles: Record<string, { role: string; unit: string }>; optionalRoles: Record<string, { role: string; unit: string; unitByInput?: { key: string; cases: Record<string, string> } }>; optionalGroups: string[][]; assumptions: string[]; conditionalRules: Array<{ when: { equals?: Record<string, number> }; assumptions?: string[] }> }>;
  emWaveScalar?: (name: string, inputs: Record<string, number>) => Record<string, number>;
};
checks += 1;
if (!exported.emWaveSourceAdmissions || !exported.emWaveScalar) fail("emw.triad", "machine-readable source contract and deterministic scalar evaluator must be exported");
else {
  const contracts = JSON.parse(JSON.stringify(exported.emWaveSourceAdmissions)) as NonNullable<typeof exported.emWaveSourceAdmissions>;
  for (const name of PACKET_MODELS) {
    const contract = contracts.find(entry => entry.name === name);
    checks += 1;
    if (!contract || !contract.assumptions.length || [...Object.values(contract.roles), ...Object.values(contract.optionalRoles)].some(role => !role.role || !role.unit) || contract.optionalGroups.some(group => group.some(key => !(key in contract.optionalRoles)))) fail(name, "source contract must cover exact roles, units, assumptions and optional groups");
  }
  const energy = contracts.find(entry => entry.name === "emw.energy");
  const spectrum = contracts.find(entry => entry.name === "emw.spectrum");
  const applications = contracts.find(entry => entry.name === "emw.applications");
  checks += 3;
  if (!energy?.conditionalRules.some(rule => rule.when.equals?.reflection === 1 && rule.assumptions?.includes("perfect reflector"))) fail("emw.energy", "reflector source condition missing from contract");
  if (spectrum?.optionalRoles.radioMin?.unitByInput?.cases["2"] !== "m") fail("emw.spectrum", "source-bound wavelength limit units must be machine-readable");
  if (applications?.resultKind !== "representation" || Object.keys(exported.emWaveScalar("emw.applications", { radio: 1, microwave: 0, infrared: 0, visible: 0, ultraviolet: 0, xray: 0, gamma: 0 })).length !== 0) fail("emw.applications", "applications must remain scalar-free at admission seam");
  close("emw.speed", exported.emWaveScalar("emw.speed", { mu0: 2, eps0: 0.5, medium: 0, f: 3 }).lambda, 1 / 3, "exported scalar evaluator uses declared propagation model");
}

/** Worked holdout: v=8, B0=0.5, λ=4. At t=1/16 s the origin
 * has phase -π/4; at s=λ/4 the phase is +π/4. These are physical
 * field samples, independent of the plotted (normalized) arrow lengths. */
const waveInputs = { c: 8, B: 0.5, crossed: 1, lambda: 4, phase: 0, time: 0.0625, kSign: 1, eSign: 1, theta: 0 };
const plane = documentOf("emw.amplitude", waveInputs, "hard shared-phase holdout");
if (plane) {
  const model = plane.source.planeWave as { samples: Array<{ s: number; E: number[]; B: number[] }>; frequency: number; electromagnetic: boolean } | undefined;
  if (!model?.electromagnetic) fail("emw.amplitude", "plane wave must establish electromagnetic semantics");
  close("emw.amplitude", model?.frequency, 2, "wave frequency");
  const origin = model?.samples.find(sample => sample.s === 0);
  const quarter = model?.samples.find(sample => sample.s === 1);
  close("emw.amplitude", origin?.E[1], -2.8284271247461903, "E at origin");
  close("emw.amplitude", origin?.B[2], -0.3535533905932738, "B shares E phase at origin");
  close("emw.amplitude", quarter?.E[1], 2.8284271247461903, "E at quarter wavelength");
  close("emw.amplitude", quarter?.B[2], 0.3535533905932738, "B shares E phase at quarter wavelength");
  const scene = compileModel("emw.amplitude", waveInputs, "plane-wave curves");
  for (const id of ["electric-wave", "magnetic-wave"]) {
    if (!scene?.primitives.some(p => p.entityId === id && p.kind === "polyline" && p.points.length >= 49)) fail("emw.amplitude", `${id} shared-phase trace missing`);
  }
}

const mediumSpeed = { mu0: 2, eps0: 0.5, medium: 1, isotropic: 1, lossless: 1, muR: 1, epsR: 4, f: 0.25, lambda: 2 };
const speedDocument = documentOf("emw.speed", mediumSpeed, "isotropic-medium worked example");
if (speedDocument) {
  const values = speedDocument.source.certified as Record<string, number>;
  for (const [key, value] of Object.entries({ c: 0.5, n: 2, f: 0.25, lambda: 2 })) close("emw.speed", values[key], value, key);
}
const speedFigure = compileModel("emw.speed", mediumSpeed, "visible frequency and wavelength");
if (speedFigure) {
  for (const [id, text] of [["speed-wave", "f=0.25 Hz"], ["wavelength-marker", "λ=2 m"]] as const) {
    checks += 1;
    if (!speedFigure.primitives.some(p => p.entityId === id && p.kind === "label" && p.text === text)) fail("emw.speed", `${id}: source frequency/wavelength must be student-visible`);
  }
  checks += 1;
  if (!speedFigure.primitives.some(p => p.entityId === "speed-wave" && p.kind === "polyline" && p.points.length >= 49)) fail("emw.speed", "frequency/wavelength figure needs a normalized wave trace");
}
const averagedEnergy = { eps0: 2, E: 3, c: 4, convention: 1, reflection: 1, kSign: -1, eSign: 1, theta: 0 };
const energyDocument = documentOf("emw.energy", averagedEnergy, "peak-amplitude average and reflecting surface");
if (energyDocument) {
  const values = energyDocument.source.certified as Record<string, number>;
  for (const [key, value] of Object.entries({ u: 9, momentum: 2.25, intensity: 36, uElectric: 4.5, uMagnetic: 4.5, B: 0.75, pressure: 18 })) close("emw.energy", values[key], value, key);
  const flux = energyDocument.source.energy as { poynting: number[] } | undefined;
  close("emw.energy", flux?.poynting[0], -36, "Poynting direction reverses with propagation");
}
for (const [label, input, surfaceLabel, direction] of [
  ["reflector with reversed S", averagedEnergy, "reflector", -1],
  ["absorber with forward S", { eps0: 2, E: 3, c: 4, convention: 0, reflection: 0 }, "absorber", 1],
] as const) {
  const scene = compileModel("emw.energy", input, label);
  if (!scene) continue;
  const flux = scene.primitives.find(p => p.entityId === "poynting" && p.kind === "vector");
  const surface = scene.primitives.find(p => p.entityId === "radiation-surface" && ["line", "polyline"].includes(p.kind));
  checks += 3;
  if (!flux || !(direction * (flux.points.at(-1)!.x - flux.points[0]!.x) > 0) || !labelTexts(scene).includes("S")) fail("emw.energy", `${label}: visible S must follow physical propagation`);
  if (!surface || !labelTexts(scene).includes(surfaceLabel)) fail("emw.energy", `${label}: declared surface missing`);
  if (flux && surface) {
    const [a, b] = [surface.points[0]!, surface.points.at(-1)!];
    if (Math.abs(a.x - b.x) > 1e-9 || Math.abs(a.y - b.y) < 1) fail("emw.energy", `${label}: surface must be normal to the incident flow`);
  }
}
const antennaInputs = { q: 1, a: 2, antenna: 1, farField: 1, dipole: 1, length: 0.2, frequency: 5, axisAngle: Math.PI / 2, outgoingAngle: 0 };
const production = documentOf("emw.production", antennaInputs, "oscillating antenna and transverse outgoing field");
if (production) {
  const source = production.source.radiation as { mechanism: string; propagation: number[]; electricDirection: number[]; magneticDirection: number[]; frequency: number } | undefined;
  if (source?.mechanism !== "oscillating electric dipole antenna") fail("emw.production", "antenna mechanism must be declared");
  close("emw.production", source?.frequency, 5, "antenna source frequency");
  close("emw.production", source?.propagation[0], 1, "outgoing direction");
  close("emw.production", source?.electricDirection[1], -1, "positive upward acceleration radiates downward E along +x");
  close("emw.production", source?.magneticDirection[2], -1, "outgoing B direction");
}
for (const [label, input, expectedSense] of [["antenna B into page", antennaInputs, -1], ["charge B out of page", { ...antennaInputs, q: -1 }, 1]] as const) {
  const scene = compileModel("emw.production", input, label);
  if (!scene) continue;
  const ring = scene.primitives.find(p => p.entityId === "radiation-magnetic" && p.kind === "circle");
  checks += 2;
  if (!ring || !labelTexts(scene).includes("B radiation")) fail("emw.production", `${label}: outgoing B direction must be marked`);
  if (expectedSense > 0) {
    const dot = scene.primitives.find(p => p.entityId === "radiation-magnetic-dot" && p.kind === "circle");
    if (!dot || dot.provenance?.inkRole !== "opaque_dot" || !ring || Math.hypot(dot.points[0]!.x - ring.points[0]!.x, dot.points[0]!.y - ring.points[0]!.y) > 1e-9) fail("emw.production", `${label}: positive B needs a concentric opaque dot`);
  } else if (!["radiation-magnetic-cross-a", "radiation-magnetic-cross-b"].every(id => scene.primitives.some(p => p.entityId === id && p.kind === "line"))) fail("emw.production", `${label}: negative B needs both cross strokes`);
}
const boundedSpectrum = { shown: 1, order: -1, boundUnit: 1, edge0: 1, edge1: 2, edge2: 4, edge3: 8, edge4: 16, edge5: 32, edge6: 64, edge7: 128 };
const spectrum = documentOf("emw.spectrum", boundedSpectrum, "source-defined frequency limits and inverse wavelength order");
if (spectrum) {
  const facts = spectrum.source.spectrum as { bands: Array<{ band: string; min: number; max: number }>; frequencyDirection: number; wavelengthDirection: number } | undefined;
  close("emw.spectrum", facts?.bands.find(b => b.band === "visible")?.min, 8, "source-defined visible frequency lower bound");
  close("emw.spectrum", facts?.bands.find(b => b.band === "visible")?.max, 16, "source-defined visible frequency upper bound");
  close("emw.spectrum", facts?.frequencyDirection, -1, "frequency axis direction");
  close("emw.spectrum", facts?.wavelengthDirection, 1, "inverse wavelength direction");
}
for (const [label, input] of [["ordinary inverse cue", { shown: 1 }], ["reversed inverse cue", { shown: 1, order: -1 }], ["bounded inverse cue", boundedSpectrum]] as const) {
  const scene = compileModel("emw.spectrum", input, label);
  if (!scene) continue;
  const f = scene.primitives.find(p => p.entityId === "frequency-order" && p.kind === "vector");
  const lambda = scene.primitives.find(p => p.entityId === "wavelength-order" && p.kind === "vector");
  const radio = scene.primitives.find(p => p.entityId === "radio" && p.kind === "point")?.points[0];
  const gamma = scene.primitives.find(p => p.entityId === "gamma" && p.kind === "point")?.points[0];
  checks += 2;
  if (!f || !lambda || !radio || !gamma || !labelTexts(scene).includes("f increases") || !labelTexts(scene).includes("λ increases")) { fail("emw.spectrum", `${label}: visible inverse-direction cues missing`); continue; }
  const delta = (p: typeof f) => ({ x: p.points.at(-1)!.x - p.points[0]!.x, y: p.points.at(-1)!.y - p.points[0]!.y });
  const df = delta(f), dl = delta(lambda);
  if (!(df.x * (gamma.x - radio.x) + df.y * (gamma.y - radio.y) > 0) || !(df.x * dl.x + df.y * dl.y < 0)) fail("emw.spectrum", `${label}: frequency must point radio→gamma while wavelength points oppositely`);
}
const imagingApplication = { radio: 0, microwave: 0, infrared: 0, visible: 0, ultraviolet: 0, xray: 1, gamma: 0, useCode: 3, sourceContext: 1 };
const application = documentOf("emw.applications", imagingApplication, "source-grounded X-ray imaging relationship");
if (application) {
  const context = application.source.applications as Array<{ band: string; use: string }> | undefined;
  if (!context?.some(item => item.band === "xray" && item.use === "medical imaging")) fail("emw.applications", "source imaging context missing");
  if (Object.keys(application.source.certified as object).length !== 0) fail("emw.applications", "qualitative uses cannot emit solved numeric labels");
}
const continuityInputs = { eps0: 2, dPhi: -3, conduction: -18, continuity: 1, dielectric: 1, epsR: 3, linear: 1, homogeneous: 1, area: 2, dE: -1.5, uniform: 1 };
const displacement = documentOf("emw.displacement", continuityInputs, "dielectric capacitor continuity and signed surfaces");
if (displacement) {
  const values = displacement.source.certified as Record<string, number>;
  close("emw.displacement", values.id, -18, "signed dielectric displacement current");
  close("emw.displacement", values.ic, -18, "source conduction current");
  const surfaces = displacement.source.surfaceCurrents as { wire: { conduction: number; displacement: number }; gap: { conduction: number; displacement: number } } | undefined;
  close("emw.displacement", surfaces?.wire.conduction, -18, "wire surface conduction");
  close("emw.displacement", surfaces?.gap.conduction, 0, "capacitor gap has no conduction current");
  close("emw.displacement", surfaces?.gap.displacement, -18, "gap surface displacement");
}

const orientations = [
  { input: { kSign: 1, eSign: 1, theta: 0 }, k: [1, 0, 0], E: [0, 1, 0], B: [0, 0, 1] },
  { input: { kSign: -1, eSign: 1, theta: 0 }, k: [-1, 0, 0], E: [0, 1, 0], B: [0, 0, -1] },
  { input: { kSign: 1, eSign: -1, theta: 0 }, k: [1, 0, 0], E: [0, -1, 0], B: [0, 0, -1] },
  { input: { kSign: -1, eSign: -1, theta: 0 }, k: [-1, 0, 0], E: [0, -1, 0], B: [0, 0, 1] },
  { input: { kSign: 1, eSign: 1, theta: Math.PI / 2 }, k: [0, 1, 0], E: [-1, 0, 0], B: [0, 0, 1] },
];
for (const [index, oracle] of orientations.entries()) {
  const input = { crossed: 1, ...oracle.input };
  const document = documentOf("emw.triad", input, `orientation-${index}`);
  const scene = compileModel("emw.triad", input, `orientation-${index}`);
  const frame = document?.source.physicalFrame as { k: number[]; E: number[]; B: number[] } | undefined;
  if (frame) {
    for (const field of ["k", "E", "B"] as const) for (let component = 0; component < 3; component += 1) close("emw.triad", frame[field][component], oracle[field][component]!, `orientation-${index} ${field}[${component}]`);
    for (const [a, b] of [["E", "k"], ["B", "k"], ["E", "B"]] as const) close("emw.triad", frame[a].reduce((sum, value, axis) => sum + value * frame[b][axis]!, 0), 0, `physical ${a}·${b}`);
    const cross = [frame.E[1]! * frame.B[2]! - frame.E[2]! * frame.B[1]!, frame.E[2]! * frame.B[0]! - frame.E[0]! * frame.B[2]!, frame.E[0]! * frame.B[1]! - frame.E[1]! * frame.B[0]!];
    for (let axis = 0; axis < 3; axis += 1) close("emw.triad", cross[axis], oracle.k[axis]!, `right-handed E×B component ${axis}`);
  }
  if (scene && oracle.B[2] === -1 && !["magnetic-cross-a", "magnetic-cross-b"].every(id => scene.primitives.some(p => p.entityId === id && ["line", "polyline"].includes(p.kind)))) fail("emw.triad", `orientation-${index}: into-page glyph missing`);
}

for (const [label, input, expected] of [
  ["easy crest", { ...waveInputs, phase: Math.PI / 2, time: 0 }, { E: 4, B: 0.5 }],
  ["medium time reversal", { ...waveInputs, time: -0.125 }, { E: 4, B: 0.5 }],
  ["reversed propagation", { ...waveInputs, time: 0, kSign: -1 }, { E: -4, B: 0.5 }],
  ["reversed polarization", { ...waveInputs, phase: Math.PI / 2, time: 0, eSign: -1 }, { E: -4, B: -0.5 }],
] as const) {
  const document = documentOf("emw.amplitude", input, label);
  compileModel("emw.amplitude", input, label);
  const data = document?.source.planeWave as { samples: Array<{ s: number; E: number[]; B: number[] }> } | undefined;
  const sample = data?.samples.find(p => p.s === (label === "reversed propagation" ? 1 : 0));
  close("emw.amplitude", sample?.E[1], expected.E, `${label} E`);
  close("emw.amplitude", sample?.B[2], expected.B, `${label} B`);
}
const fullPeriod = documentOf("emw.amplitude", { ...waveInputs, time: waveInputs.time + 0.5 }, "period holdout");
if (fullPeriod && plane) {
  const before = plane.source.planeWave as { samples: Array<{ E: number[]; B: number[] }> };
  const after = fullPeriod.source.planeWave as typeof before;
  for (const index of [0, 12, 24, 36, 48, 60, 72, 84, 96]) {
    close("emw.amplitude", after.samples[index]?.E[1], before.samples[index]!.E[1]!, `same phase after full period E[${index}]`);
    close("emw.amplitude", after.samples[index]?.B[2], before.samples[index]!.B[2]!, `same phase after full period B[${index}]`);
  }
}
for (const [label, input, expected] of [
  ["vacuum frequency", { mu0: 2, eps0: 0.5, medium: 0, f: 3 }, { c: 1, lambda: 1 / 3, f: 3, n: 1 }],
  ["independent medium holdout", { ...mediumSpeed, epsR: 2.25, f: 2, lambda: 1 / 3 }, { c: 2 / 3, lambda: 1 / 3, f: 2, n: 1.5 }],
  ["SI vacuum", { mu0: 1.25663706212e-6, eps0: 8.8541878128e-12, medium: 0, f: 1e8 }, { c: 299792458, lambda: 2.99792458, f: 1e8, n: 1 }],
] as const) {
  const document = documentOf("emw.speed", input, label);
  compileModel("emw.speed", input, label);
  const values = document?.source.certified as Record<string, number> | undefined;
  for (const [key, value] of Object.entries(expected)) close("emw.speed", values?.[key], value, `${label} ${key}`);
}
for (const [label, input, expected] of [
  ["instantaneous absorption", { eps0: 2, E: 3, c: 4, convention: 0, reflection: 0 }, { u: 18, intensity: 72, pressure: 18, momentum: 4.5 }],
  ["RMS absorption holdout", { eps0: 0.5, E: 4, c: 2, convention: 2, reflection: 0, mu0: 0.5 }, { u: 8, intensity: 16, pressure: 8, momentum: 4 }],
  ["wave to energy composite", { eps0: 0.5, E: 2.8284271247461903, c: 8, convention: 0, mu0: 0.03125 }, { u: 4, intensity: 32, momentum: 0.5 }],
  ["zero-field state", { eps0: 2, E: 0, c: 4, convention: 1 }, { u: 0, intensity: 0, momentum: 0 }],
] as const) {
  const document = documentOf("emw.energy", input, label);
  compileModel("emw.energy", input, label);
  const values = document?.source.certified as Record<string, number> | undefined;
  for (const [key, value] of Object.entries(expected)) close("emw.energy", values?.[key], value, `${label} ${key}`);
}
for (const [label, input] of [
  ["antenna", antennaInputs],
  ["accelerating charge", { q: -2, a: -3, farField: 1, dipole: 1, axisAngle: 0, outgoingAngle: Math.PI / 2 }],
  ["dipole-axis null holdout", { ...antennaInputs, outgoingAngle: Math.PI / 2 }],
] as const) {
  const document = documentOf("emw.production", input, label);
  const scene = compileModel("emw.production", input, label);
  if (label.includes("null") && (!(document?.source.radiation as { nullDirection?: boolean })?.nullDirection || scene?.primitives.some(p => p.entityId === "outgoing" && p.kind === "vector"))) fail("emw.production", "axis null cannot fabricate outgoing radiation");
}
compileModel("emw.spectrum", boundedSpectrum, "bounded-frequency reverse order");
compileModel("emw.spectrum", { shown: 1, order: -1 }, "inverse wavelength strip");
compileModel("emw.spectrum", { shown: 1, boundUnit: 2, edge0: 128, edge1: 64, edge2: 32, edge3: 16, edge4: 8, edge5: 4, edge6: 2, edge7: 1 }, "wavelength bounds holdout");
const overlappingBands = { shown: 1, boundUnit: 2, radioMin: 1, radioMax: 100, microwaveMin: 0.01, microwaveMax: 2, infraredMin: 0.001, infraredMax: 0.02, visibleMin: 0.0001, visibleMax: 0.002, ultravioletMin: 0.00001, ultravioletMax: 0.0002, xrayMin: 1e-7, xrayMax: 0.00002, gammaMin: 1e-9, gammaMax: 1e-6 };
const overlapping = documentOf("emw.spectrum", overlappingBands, "independent overlapping source band limits");
compileModel("emw.spectrum", overlappingBands, "overlapping source limits");
if (overlapping) {
  const bands = (overlapping.source.spectrum as { bands: Array<{ band: string; min: number; max: number }> }).bands;
  close("emw.spectrum", bands.find(b => b.band === "xray")?.min, 1e-7, "X-ray overlap lower limit");
  close("emw.spectrum", bands.find(b => b.band === "gamma")?.max, 1e-6, "gamma overlap upper limit");
}
for (const [code, band, use] of [[1, "radio", "broadcast communication"], [2, "microwave", "oven heating"], [3, "xray", "medical imaging"], [4, "infrared", "thermal imaging"], [5, "visible", "vision"], [6, "ultraviolet", "disinfection"], [7, "gamma", "radiotherapy"]] as const) {
  const input = { ...Object.fromEntries(BANDS.map(b => [b, b === band ? 1 : 0])), useCode: code, sourceContext: 1 };
  const scene = compileModel("emw.applications", input, `source use ${code}`);
  const displayUse = use === "broadcast communication" ? "broadcast" : use;
  if (scene && (!labelTexts(scene).includes(band) || !labelTexts(scene).includes(displayUse))) fail("emw.applications", `${band} → ${use} relationship missing`);
}
compileModel("emw.applications", { ...sampleOf("emw.applications", "ordinary"), useCode: 1, useCode2: 5, sourceContext: 1 }, "communication and vision composite");
for (const [label, input, id] of [
  ["signed dielectric continuity", continuityInputs, -18],
  ["vacuum continuity", { eps0: 2, dPhi: 5, conduction: 10, continuity: 1 }, 10],
  ["steady-state holdout", { eps0: 2, dPhi: 0, conduction: 0, continuity: 1 }, 0],
] as const) {
  const document = documentOf("emw.displacement", input, label);
  compileModel("emw.displacement", input, label);
  close("emw.displacement", (document?.source.certified as Record<string, number> | undefined)?.id, id, label);
}

const negativeCases: Array<[PacketModel, Record<string, number>, string]> = [
  ["emw.triad", {}, "omitted transverse declaration"], ["emw.triad", { crossed: 1, kSign: 1 }, "partial orientation"], ["emw.triad", { crossed: 1, kSign: 0, eSign: 1, theta: 0 }, "singular propagation"],
  ["emw.amplitude", { ...waveInputs, time: Number.NaN }, "invalid source time"], ["emw.amplitude", { ...waveInputs, lambda: 0 }, "singular wavelength"], ["emw.amplitude", { c: 8, B: 0.5, crossed: 1, lambda: 4 }, "omitted wave source"],
  ["emw.amplitude", { ...waveInputs, B: -1 }, "invalid amplitude"], ["emw.amplitude", { ...waveInputs, c: 1e308, B: 1e308 }, "overflow"], ["emw.amplitude", { c: 1e-300, B: 1e-300, crossed: 1 }, "nonzero underflow"],
  ["emw.amplitude", { ...waveInputs, displacement: 1 }, "mechanical-wave wrong family"], ["emw.speed", { ...mediumSpeed, isotropic: 0 }, "anisotropic medium"], ["emw.speed", { ...mediumSpeed, lossless: 0 }, "lossy medium"],
  ["emw.speed", { ...mediumSpeed, lambda: 3 }, "wrong wavelength"], ["emw.speed", { mu0: 2, eps0: 0.5, f: 3 }, "omitted medium declaration"], ["emw.speed", { mu0: 1e-300, eps0: 1e-300 }, "vacuum product underflow"],
  ["emw.energy", { ...averagedEnergy, convention: 3 }, "unsupported convention"], ["emw.energy", { ...averagedEnergy, reflection: 0.5 }, "omitted surface model"], ["emw.energy", { eps0: 2, E: 3, c: 4, reflection: 1 }, "omitted amplitude convention"], ["emw.energy", { eps0: 2, E: 3, c: 4, convention: 1, mu0: 1 }, "incompatible vacuum constants"],
  ["emw.production", { ...antennaInputs, farField: 0 }, "near-field wrong family"], ["emw.production", { ...antennaInputs, frequency: 0 }, "singular antenna frequency"], ["emw.production", { q: 0, a: 3 }, "zero source charge"], ["emw.production", { q: 1, a: 2, antenna: 1 }, "omitted antenna assumptions"],
  ["emw.spectrum", { ...boundedSpectrum, edge4: 7 }, "invalid band ordering"], ["emw.spectrum", { shown: 1, boundUnit: 1, edge0: 1 }, "omitted source bounds"], ["emw.spectrum", { shown: 1, decay: 1 }, "X-ray spectrum is not nuclear decay"],
  ["emw.applications", { ...imagingApplication, useCode: 2 }, "wrong use-to-band relationship"], ["emw.applications", { ...imagingApplication, sourceContext: 0 }, "omitted source context"], ["emw.applications", { ...imagingApplication, xray: 2 }, "invalid band flag"],
  ["emw.displacement", { ...continuityInputs, conduction: 18 }, "wrong continuity sign"], ["emw.displacement", { ...continuityInputs, linear: 0 }, "undeclared dielectric constitutive model"], ["emw.displacement", { ...continuityInputs, area: 3 }, "flux-rate mismatch"], ["emw.displacement", { eps0: 2, dPhi: 5, conduction: 10 }, "omitted continuity assumption"],
];
for (const [model, input, label] of negativeCases) expectRejected(model, input, label);
for (const model of PACKET_MODELS) {
  const question = "An electromagnetic question has no supplied physical model inputs.";
  const raw = { schemaVersion: "problem-ir/v1", id: "missingSource", question, facts: [], entities: [], expressions: [], constraints: [], representationIntents: [], solveRequests: [{ id: "model", kind: "explicit_physical_model", model, inputs: sampleOf(model, "ordinary"), evidenceFactIds: [] }] };
  checks += 1;
  if (validateProblemIR(raw, question).problem || synthesizeFamilyScene({ question, problemIR: raw }) !== null) fail(model, "omitted source evidence must not emit a family scene");
}
if (plane) {
  const incomplete = { ...plane, entities: plane.entities.filter(entity => entity.id !== "magnetic") };
  const compiled = compileSceneDocument(incomplete);
  checks += 1;
  if (compiled.ok || compiled.renderScene) fail("emw.amplitude", "omitted required magnetic field must fail atomically with no render scene");
}
for (const [model, document, ids] of [
  ["emw.speed", speedDocument, ["speed-wave", "wavelength-marker"]],
  ["emw.energy", energyDocument, ["poynting", "radiation-surface"]],
  ["emw.production", production, ["radiation-magnetic", "radiation-magnetic-cross-a"]],
  ["emw.spectrum", spectrum, ["frequency-order", "wavelength-order"]],
] as const) {
  if (!document) continue;
  for (const id of ids) {
    const incomplete = { ...document, entities: document.entities.filter(entity => entity.id !== id) };
    const compiled = compileSceneDocument(incomplete);
    checks += 1;
    if (!document.requiredEntityIds.includes(id) || compiled.ok || compiled.renderScene) fail(model, `omitted required ${id} must fail atomically with no render scene`);
  }
}

/** Triad figure lock: E, B, k labels, the out-of-page dot, a ring plus a
 * smaller concentric dot circle, k rightward, E upward. */
function lockTriadFigure(name: string, scene: RenderScene, label: string): void {
  const texts = labelTexts(scene);
  for (const text of ["E", "B", "k"]) {
    if (!texts.includes(text)) fail(name, `${label}: compiled labels must include "${text}"; got [${texts.join(", ")}]`);
  }
  const ring = scene.primitives.find((primitive) => primitive.entityId === "magnetic" && primitive.kind === "circle");
  const dot = scene.primitives.find((primitive) => primitive.entityId === "magnetic-dot" && primitive.kind === "circle");
  if (!ring || !dot) fail(name, `${label}: out-of-page B needs a ring and a filled centre circle`);
  if (dot && ring && !((dot.radius ?? 0) < (ring.radius ?? 0) && (dot.radius ?? 0) > (ring.radius ?? 0) * 0.15)) {
    fail(name, `${label}: the out-of-page dot must be a visible filled circle inside the ring`);
  }
  if (dot?.provenance?.inkRole !== "opaque_dot") fail(name, `${label}: the out-of-page dot must carry explicit opaque-dot ink semantics`);
  if (dot?.provenance?.fillRole === "region") fail(name, `${label}: an opaque field dot cannot use translucent region semantics`);
  const ringCenter = ring?.points[0];
  const dotCenter = dot?.points[0];
  if (ringCenter && dotCenter && Math.hypot(dotCenter.x - ringCenter.x, dotCenter.y - ringCenter.y) > 1e-6) {
    fail(name, `${label}: the out-of-page dot is not at the centre of the B ring`);
  }
  const propagation = scene.primitives.find((primitive) => primitive.entityId === "propagation" && primitive.kind === "vector");
  const kStart = propagation?.points.at(0);
  const kEnd = propagation?.points.at(-1);
  if (!kStart || !kEnd || !(kEnd.x > kStart.x)) fail(name, `${label}: the propagation vector k must point right`);
  const electric = scene.primitives.find((primitive) => primitive.entityId === "electric" && primitive.kind === "vector");
  const eStart = electric?.points.at(0);
  const eEnd = electric?.points.at(-1);
  if (!eStart || !eEnd || !(eEnd.y < eStart.y)) fail(name, `${label}: the electric field vector E must point up`);
}

const triadOrdinary = compileModel("emw.triad", sampleOf("emw.triad", "ordinary"), "ordinary");
if (triadOrdinary) lockTriadFigure("emw.triad", triadOrdinary, "ordinary");
const triadAltered = compileModel("emw.triad", sampleOf("emw.triad", "altered"), "altered");
if (triadAltered) lockTriadFigure("emw.triad", triadAltered, "altered");
expectRejected("emw.triad", { crossed: 0 }, "rejection");
expectRejected("emw.triad", { crossed: 1, extra: 1 }, "extra input");

for (const sample of ["ordinary", "altered"] as const) {
  const scene = compileModel("emw.amplitude", sampleOf("emw.amplitude", sample), sample);
  if (scene) lockTriadFigure("emw.amplitude", scene, sample);
}
expectRejected("emw.amplitude", { c: 3, B: 2, crossed: 0 }, "parallel rejection");
expectRejected("emw.amplitude", { c: 0, B: 2, crossed: 1 }, "zero c rejection");

/** Spectrum lock: each band's label carries its declared order and the
 * band points run left to right in that order. */
function lockSpectrumOrder(name: string, scene: RenderScene, label: string): void {
  const points = BANDS.map((band) => scene.primitives.find((primitive) => primitive.entityId === band && primitive.kind === "point"));
  for (const [index, band] of BANDS.entries()) {
    const wanted = `${index + 1}. ${band}`;
    const bandLabel = scene.primitives.find((primitive) => primitive.entityId === band && primitive.kind === "label");
    if (!bandLabel || bandLabel.text !== wanted) {
      fail(name, `${label}: the ${band} label must read "${wanted}", got ${bandLabel?.text ?? "no label"}`);
    }
    if (!points[index]) fail(name, `${label}: the ${band} band point is missing`);
  }
  const xs = points.map((point) => point?.points[0]?.x).filter((x): x is number => typeof x === "number");
  if (xs.length === BANDS.length) {
    for (let index = 1; index < xs.length; index += 1) {
      if (!(xs[index]! > xs[index - 1]!)) {
        fail(name, `${label}: the band points are not laid out left to right in the declared order`);
        break;
      }
    }
  }
}

for (const sample of ["ordinary", "altered"] as const) {
  const scene = compileModel("emw.spectrum", sampleOf("emw.spectrum", sample), sample);
  if (scene) lockSpectrumOrder("emw.spectrum", scene, sample);
}
expectRejected("emw.spectrum", { shown: 0 }, "rejection");

for (const sample of ["ordinary", "altered"] as const) {
  const scene = compileModel("emw.speed", sampleOf("emw.speed", sample), sample);
  if (scene) {
    if (!scene.primitives.some((primitive) => primitive.entityId === "ray" && primitive.kind === "vector")) {
      fail("emw.speed", `${sample}: the propagation ray vector is missing`);
    }
  }
}
expectRejected("emw.speed", { mu0: 0, eps0: 0.5 }, "zero mu0 rejection");
expectRejected("emw.speed", { mu0: 2, eps0: 0 }, "zero eps0 rejection");

for (const sample of ["ordinary", "altered"] as const) {
  const scene = compileModel("emw.energy", sampleOf("emw.energy", sample), sample);
  if (scene) {
    if (!scene.primitives.some((primitive) => primitive.entityId === "electric" && primitive.kind === "vector")) {
      fail("emw.energy", `${sample}: the electric amplitude vector is missing`);
    }
  }
}
expectRejected("emw.energy", { eps0: 2, E: 3, c: 0 }, "zero c rejection");
expectRejected("emw.energy", { eps0: 0, E: 3, c: 3 }, "zero eps0 rejection");

for (const sample of ["ordinary", "altered"] as const) {
  const scene = compileModel("emw.production", sampleOf("emw.production", sample), sample);
  if (scene) {
    if (!scene.primitives.some((primitive) => primitive.entityId === "charge" && primitive.kind === "point")) {
      fail("emw.production", `${sample}: the source charge point is missing`);
    }
    if (!scene.primitives.some((primitive) => primitive.entityId === "acceleration" && primitive.kind === "vector")) {
      fail("emw.production", `${sample}: the acceleration vector is missing`);
    }
  }
}
expectRejected("emw.production", { q: 1, a: 0 }, "zero acceleration rejection");

const applicationsLabels: Array<[Record<string, number>, string]> = [
  [sampleOf("emw.applications", "ordinary"), "radio"],
  [sampleOf("emw.applications", "ordinary"), "visible"],
  [sampleOf("emw.applications", "altered"), "microwave"],
];
for (const [inputs, band] of applicationsLabels) {
  const scene = compileModel("emw.applications", inputs, "selected bands");
  if (scene && !labelTexts(scene).includes(band)) {
    fail("emw.applications", `the selected band label "${band}" is missing`);
  }
}
expectRejected("emw.applications", { radio: 0, microwave: 0, infrared: 0, visible: 0, ultraviolet: 0, xray: 0, gamma: 0 }, "no band rejection");

for (const sample of ["ordinary", "altered"] as const) {
  const scene = compileModel("emw.displacement", sampleOf("emw.displacement", sample), sample);
  if (scene) {
    if (!scene.primitives.some((primitive) => primitive.entityId === "gap" && (primitive.kind === "rectangle" || primitive.kind === "polygon"))) {
      fail("emw.displacement", `${sample}: the capacitor gap is missing`);
    }
    if (!scene.primitives.some((primitive) => primitive.entityId === "current" && primitive.kind === "vector")) {
      fail("emw.displacement", `${sample}: the displacement current vector is missing`);
    }
  }
}
expectRejected("emw.displacement", { eps0: 2, dPhi: 0 }, "steady flux rejection");
expectRejected("emw.displacement", { eps0: 0, dPhi: 5 }, "zero eps0 rejection");

let failed = false;
for (const name of PACKET_MODELS) {
  const reasons = modelFailures.get(name) ?? [];
  if (reasons.length > 0) {
    failed = true;
    console.log(`FAIL ${name}`);
    for (const reason of reasons) console.log(`  - ${reason}`);
  } else {
    console.log(`pass ${name}`);
  }
}
const packetNames: readonly string[] = PACKET_MODELS;
const orphanModels = [...modelFailures.keys()].filter((name) => !packetNames.includes(name));
if (orphanModels.length > 0) {
  failed = true;
  for (const name of orphanModels) console.log(`FAIL ${name}: ${modelFailures.get(name)!.join("; ")}`);
}
if (failed) throw new Error("agent8 EM-wave verification failed");
const renderDir = process.env.EM_WAVES_RENDER_DIR;
if (renderDir) {
  mkdirSync(renderDir, { recursive: true });
  for (const [index, entry] of renderedCases.entries()) writeFileSync(resolve(renderDir, `${String(index).padStart(2, "0")}-${entry.name}-${entry.label.replace(/[^a-z0-9]+/gi, "-")}.svg`), renderSceneSvg(entry.scene, { title: `${entry.name}: ${entry.label}`, subtitle: "Offline compiled frame; physical values are separate from display scale" }));
  writeFileSync(resolve(renderDir, "manifest.json"), JSON.stringify(renderedCases.map(({ name, label, scene }) => ({ name, label, width: 1200, height: 700, primitives: scene.primitives.length })), null, 2));
}
console.log(`agent8 EM-wave verification passed (8 models; ${checks} numeric/negative/atomic checks; ${renderedCases.length} complete frames)`);
