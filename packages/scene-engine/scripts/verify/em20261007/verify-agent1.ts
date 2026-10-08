/**
 * Agent 1 admission and figure verification. One ordinary textbook question
 * per admitted Current Electricity model: the grounded question must validate
 * and emit that model's scene with its certified result; a changed number
 * under the same quote, a wrong-role fact, and a missing assumption must each
 * be refused. The isolated builder's compiled figure must carry its required
 * labels, axes, terminals, polarity, and arrow directions.
 */
import { compileSceneDocument } from "../../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../../src/document/validation";
import { demandRejection, sceneDemand } from "../../../src/synthesize/sceneDemand";
import { deriveVisualObligations, visualObligationRejection } from "../../../src/synthesize/visualObligations";
import { validateProblemIR, type QuestionSourceEvidence } from "../../../src/ir/problemIR";
import { LocalDeterministicSolverProvider } from "../../../src/ir/solver";
import { consumePhysicalModel, explicitPhysicalModelScene, standardCases } from "../../../src/physics/em20261007/consume";
import { modelAdmission, modelAdmissionRole } from "../../../src/physics/em20261007/admission";
import { renderSceneSvg } from "../../lib/renderSceneSvg";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { synthesizeFamilyScene } from "../../../src/synthesize/familyScene";
import type { RenderPoint, RenderPrimitive, RenderPrimitiveKind, RenderScene, SceneDocument } from "../../../src/types";

const modelFailures = new Map<string, string[]>();
function fail(model: string, reason: string): void {
  const existing = modelFailures.get(model) ?? [];
  existing.push(reason);
  modelFailures.set(model, existing);
}

interface BindingFixture {
  readonly key: string;
  readonly role: string;
  readonly unit: string;
  readonly quote: string;
}

interface CaseFixture {
  readonly model: string;
  readonly question: string;
  readonly bindings: readonly BindingFixture[];
  readonly values: Readonly<Record<string, number>>;
  readonly assumptions: readonly { phrase: string; quote: string }[];
  readonly asked: { statement: string; quote: string };
  readonly result: { symbol: string; unit: string; expected: number };
  readonly changed: { key: string; value: number };
  readonly certified: Readonly<Record<string, number>>;
}

const fixtures: readonly CaseFixture[] = [
  {
    model: "ce.drift",
    question: "A uniform conductor has carrier number density 10 per m^3 and carrier charge 2 C. Its cross-section area is 3 m^2 and the electrons drift with drift velocity 4 m/s opposite to the conventional current. Find the current.",
    bindings: [
      { key: "n", role: "carrier number density", unit: "per m^3", quote: "carrier number density 10 per m^3" },
      { key: "e", role: "carrier charge", unit: "C", quote: "carrier charge 2 C" },
      { key: "A", role: "cross-section area", unit: "m^2", quote: "cross-section area is 3 m^2" },
      { key: "vd", role: "drift velocity", unit: "m/s", quote: "drift velocity 4 m/s" },
    ],
    values: { n: 10, e: 2, A: 3, vd: 4 },
    assumptions: [{ phrase: "uniform", quote: "A uniform conductor" }, { phrase: "conventional current", quote: "the conventional current" }],
    asked: { statement: "Find the current.", quote: "Find the current." },
    result: { symbol: "I", unit: "A", expected: 240 },
    changed: { key: "n", value: 13 },
    certified: { I: 240 },
  },
  {
    model: "ce.current_density",
    question: "A uniform conductor carries a current of 8 A through a cross-section area of 2 m^2. The applied electric field is 2 V/m and the drift velocity is 4 m/s along the field. Find the current density.",
    bindings: [
      { key: "I", role: "current", unit: "A", quote: "current of 8 A" },
      { key: "A", role: "cross-section area", unit: "m^2", quote: "cross-section area of 2 m^2" },
      { key: "vd", role: "drift velocity", unit: "m/s", quote: "drift velocity is 4 m/s" },
      { key: "E", role: "electric field", unit: "V/m", quote: "electric field is 2 V/m" },
    ],
    values: { I: 8, A: 2, vd: 4, E: 2 },
    assumptions: [{ phrase: "uniform", quote: "A uniform conductor" }],
    asked: { statement: "Find the current density.", quote: "Find the current density." },
    result: { symbol: "J", unit: "A/m^2", expected: 4 },
    changed: { key: "I", value: 9 },
    certified: { J: 4, mu: 2 },
  },
  {
    model: "ce.power",
    question: "A steady current of 2 A flows through a resistor of resistance 3 ohm and the voltage across it is 6 V. Find the power dissipated.",
    bindings: [
      { key: "I", role: "current", unit: "A", quote: "steady current of 2 A" },
      { key: "R", role: "resistance", unit: "ohm", quote: "resistance 3 ohm" },
      { key: "V", role: "voltage", unit: "V", quote: "voltage across it is 6 V" },
    ],
    values: { I: 2, R: 3, V: 6 },
    assumptions: [{ phrase: "steady", quote: "A steady current" }],
    asked: { statement: "Find the power dissipated.", quote: "Find the power dissipated." },
    result: { symbol: "P", unit: "W", expected: 12 },
    changed: { key: "I", value: 5 },
    certified: { P: 12 },
  },
  {
    model: "ce.joule",
    question: "A constant current of 2 A flows through a resistor of resistance 3 ohm for a time of 4 s. Find the heat produced.",
    bindings: [
      { key: "I", role: "current", unit: "A", quote: "constant current of 2 A" },
      { key: "R", role: "resistance", unit: "ohm", quote: "resistance 3 ohm" },
      { key: "t", role: "time", unit: "s", quote: "time of 4 s" },
    ],
    values: { I: 2, R: 3, t: 4 },
    assumptions: [{ phrase: "constant", quote: "A constant current" }],
    asked: { statement: "Find the heat produced.", quote: "Find the heat produced." },
    result: { symbol: "H", unit: "J", expected: 48 },
    changed: { key: "I", value: 5 },
    certified: { H: 48 },
  },
  {
    model: "ce.resistivity",
    question: "An isotropic material has resistivity 2 ohm m. Find its conductivity.",
    bindings: [
      { key: "rho", role: "resistivity", unit: "ohm m", quote: "resistivity 2 ohm m" },
    ],
    values: { rho: 2 },
    assumptions: [{ phrase: "isotropic", quote: "An isotropic material" }],
    asked: { statement: "Find its conductivity.", quote: "Find its conductivity." },
    result: { symbol: "sigma", unit: "S/m", expected: 0.5 },
    changed: { key: "rho", value: 5 },
    certified: { sigma: 0.5 },
  },
  {
    model: "ce.resistance",
    question: "A uniform wire of resistivity 2 ohm m, length 6 m, and cross-section area 3 m^2 is used in a circuit. Find its resistance.",
    bindings: [
      { key: "rho", role: "resistivity", unit: "ohm m", quote: "resistivity 2 ohm m" },
      { key: "L", role: "length", unit: "m", quote: "length 6 m" },
      { key: "A", role: "cross-section area", unit: "m^2", quote: "cross-section area 3 m^2" },
    ],
    values: { rho: 2, L: 6, A: 3 },
    assumptions: [{ phrase: "uniform", quote: "A uniform wire" }],
    asked: { statement: "Find its resistance.", quote: "Find its resistance." },
    result: { symbol: "R", unit: "ohm", expected: 4 },
    changed: { key: "rho", value: 5 },
    certified: { R: 4 },
  },
  {
    model: "ce.temperature",
    question: "A metal wire follows a linear law: its reference resistance is 10 ohm, its temperature coefficient is 0.5 per degree Celsius, and it is heated through a temperature rise of 2 degree Celsius. Find the new resistance.",
    bindings: [
      { key: "R0", role: "reference resistance", unit: "ohm", quote: "reference resistance is 10 ohm" },
      { key: "alpha", role: "temperature coefficient", unit: "per degree Celsius", quote: "temperature coefficient is 0.5 per degree Celsius" },
      { key: "dT", role: "temperature rise", unit: "degree Celsius", quote: "temperature rise of 2 degree Celsius" },
    ],
    values: { R0: 10, alpha: 0.5, dT: 2 },
    assumptions: [{ phrase: "linear", quote: "a linear law" }],
    asked: { statement: "Find the new resistance.", quote: "Find the new resistance." },
    result: { symbol: "R", unit: "ohm", expected: 20 },
    changed: { key: "R0", value: 16 },
    certified: { R: 20 },
  },
  {
    model: "ce.cell",
    question: "A discharging cell of emf 12 V and internal resistance 1 ohm supplies a current of 2 A. Find the terminal voltage.",
    bindings: [
      { key: "E", role: "emf", unit: "V", quote: "emf 12 V" },
      { key: "I", role: "current", unit: "A", quote: "current of 2 A" },
      { key: "r", role: "internal resistance", unit: "ohm", quote: "internal resistance 1 ohm" },
    ],
    values: { E: 12, I: 2, r: 1 },
    assumptions: [{ phrase: "discharging", quote: "A discharging cell" }],
    asked: { statement: "Find the terminal voltage.", quote: "Find the terminal voltage." },
    result: { symbol: "V", unit: "V", expected: 10 },
    changed: { key: "E", value: 15 },
    certified: { V: 10 },
  },
  {
    model: "ce.iv_ohmic",
    question: "An ohmic conductor has a voltage at one ampere of 2 V and a voltage at two amperes of 4 V. Find the slope of its V-I characteristic.",
    bindings: [
      { key: "v1", role: "voltage at one ampere", unit: "V", quote: "voltage at one ampere of 2 V" },
      { key: "v2", role: "voltage at two amperes", unit: "V", quote: "voltage at two amperes of 4 V" },
    ],
    values: { v1: 2, v2: 4 },
    assumptions: [{ phrase: "ohmic", quote: "An ohmic conductor" }],
    asked: { statement: "Find the slope of its V-I characteristic.", quote: "Find the slope of its V-I characteristic." },
    result: { symbol: "slope", unit: "V/A", expected: 2 },
    changed: { key: "v1", value: 5 },
    certified: { v1: 2, v2: 4, slope: 2 },
  },
];

function evidence(question: string, quote: string): QuestionSourceEvidence {
  const start = question.indexOf(quote);
  if (start < 0) throw new Error(`fixture quote is not in the question: ${quote}`);
  return { source: "question", start, end: start + quote.length, quote };
}

type Mutation = "changedValue" | "wrongRole" | "dropAssumptions";

function buildIr(fixture: CaseFixture, mutation?: Mutation): Record<string, unknown> {
  if (fixture.bindings.length === 0) throw new Error(`fixture ${fixture.model} needs at least one binding`);
  const facts: unknown[] = [];
  if (mutation !== "dropAssumptions") {
    for (const [index, assumption] of fixture.assumptions.entries()) {
      facts.push({
        id: `assume${index}`,
        kind: "assumption",
        statement: `The ${assumption.phrase} assumption is quoted.`,
        evidence: evidence(fixture.question, assumption.quote),
      });
    }
  }
  for (const binding of fixture.bindings) {
    facts.push({
      id: binding.key,
      kind: "given",
      statement: `The ${binding.role} is stated in ${binding.unit}.`,
      evidence: evidence(fixture.question, binding.quote),
    });
  }
  facts.push({ id: "asked", kind: "requested", statement: fixture.asked.statement, evidence: evidence(fixture.question, fixture.asked.quote) });
  const expressions = fixture.bindings.map((binding) => ({
    id: binding.key,
    valueType: "scalar",
    root: { kind: "number", value: mutation === "changedValue" && binding.key === fixture.changed.key ? fixture.changed.value : fixture.values[binding.key] },
    evidenceFactIds: [binding.key],
  }));
  const firstKey = fixture.bindings[0]?.key;
  const swapTarget = fixture.bindings[1]?.key ?? "asked";
  const bindings = fixture.bindings.map((binding) => ({
    key: binding.key,
    role: binding.role,
    unit: binding.unit,
    expressionId: binding.key,
    evidenceFactId: mutation === "wrongRole" && binding.key === firstKey ? swapTarget : binding.key,
  }));
  return {
    schemaVersion: "problem-ir/v1",
    id: `${fixture.model.replace(".", "_")}_question`,
    question: fixture.question,
    facts,
    entities: [],
    expressions,
    constraints: [],
    representationIntents: [],
    solveRequests: [{
      id: "explicitModel",
      kind: "explicit_physical_model",
      model: fixture.model,
      bindings,
      evidenceFactIds: ["asked"],
      resultBinding: { turnPlanQuantityId: "askedResult", symbol: fixture.result.symbol, unit: fixture.result.unit, evidenceFactIds: ["asked"] },
    }],
  };
}

function certifiedOf(document: SceneDocument): Record<string, number> {
  const certified = document.source.certified;
  if (typeof certified !== "object" || certified === null) throw new Error("missing certified record");
  const values: Record<string, number> = {};
  for (const [key, value] of Object.entries(certified)) {
    if (typeof value !== "number") throw new Error(`${key} is not a certified number`);
    values[key] = value;
  }
  return values;
}

function close(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 1e-8 * Math.max(1, Math.abs(expected));
}

function compiledOrdinary(model: string, inputs: Readonly<Record<string, number>>): RenderScene {
  const consumed = consumePhysicalModel(model, inputs);
  if (consumed.status !== "scene") {
    throw new Error(`${model} ordinary inputs were rejected: ${consumed.status === "rejected" ? consumed.reason : consumed.status}`);
  }
  const validated = validateSceneDocument(consumed.document);
  const compiled = compileSceneDocument(validated.document ?? consumed.document);
  if (!compiled.ok || !compiled.renderScene) {
    throw new Error(`${model} ordinary scene did not compile`);
  }
  return compiled.renderScene;
}

/** Per-model probe over one compiled ordinary scene: every method reports
 * failures under the model's name, so the report stays per-model. */
function probe(model: string, scene: RenderScene) {
  const labels = (): string[] =>
    scene.primitives.filter((primitive) => primitive.kind === "label").map((primitive) => primitive.text ?? "").filter((text) => text.length > 0);
  const find = (entityId: string, kind: RenderPrimitiveKind): RenderPrimitive | null => {
    const found = scene.primitives.find((primitive) => primitive.entityId === entityId && primitive.kind === kind);
    if (!found) fail(model, `compiled scene is missing the ${kind} primitive of entity ${entityId}`);
    return found ?? null;
  };
  const arrow = (entityId: string, points: (start: RenderPoint, end: RenderPoint) => boolean, wanted: string): void => {
    const primitive = find(entityId, "vector");
    const start = primitive?.points.at(0);
    const end = primitive?.points.at(-1);
    if (!start || !end || !points(start, end)) {
      fail(model, `${entityId} arrow must point ${wanted} (start ${JSON.stringify(start)} end ${JSON.stringify(end)})`);
    }
  };
  return {
    labels(wanted: readonly string[]): void {
      const present = labels();
      for (const text of wanted) {
        if (!present.includes(text)) fail(model, `compiled labels must include "${text}"; got [${present.join(", ")}]`);
      }
    },
    primitive(entityId: string, kind: RenderPrimitiveKind): RenderPrimitive | null {
      return find(entityId, kind);
    },
    right(entityId: string): void {
      arrow(entityId, (start, end) => end.x > start.x, "right");
    },
    left(entityId: string): void {
      arrow(entityId, (start, end) => end.x < start.x, "left");
    },
    up(entityId: string): void {
      arrow(entityId, (start, end) => end.y < start.y, "up");
    },
    polarity(): void {
      const present = labels();
      if (!present.includes("+")) fail(model, "compiled scene must carry the positive polarity mark +");
      if (!present.includes("-")) fail(model, "compiled scene must carry the negative polarity mark -");
    },
  };
}

const solver = new LocalDeterministicSolverProvider();

// Signed carrier model: electrons drift against E, conventional current
// follows E. The supplied charge is signed, not an electron magnitude.
const carrier = consumePhysicalModel("ce.carrier_density", { n: 5, q: -2, mu: 3, E: -4, A: 2 });
if (carrier.status !== "scene") throw new Error("signed source-declared carrier model must be supported");
const carrierValues = certifiedOf(carrier.document);
if (!close(carrierValues.vd, 12) || !close(carrierValues.J, -120) || !close(carrierValues.I, -240)) throw new Error("signed carrier reference convention is wrong");
const heat = consumePhysicalModel("ce.joule_piecewise", { R: 3, I1: 2, t1: 4, I2: -3, t2: 2, I3: 0, t3: 5 });
if (heat.status !== "scene" || !close(certifiedOf(heat.document).H, 102)) throw new Error("piecewise signed-current heating must integrate to 102 J");
const stretched = consumePhysicalModel("ce.stretched_wire", { rho: 2, L: 6, A: 3, factor: 2 });
if (stretched.status !== "scene" || !close(certifiedOf(stretched.document).R, 16) || !close(certifiedOf(stretched.document).A, 1.5)) throw new Error("conserved-volume stretch must quadruple resistance");
const charging = consumePhysicalModel("ce.cell_signed", { E: 12, I: -2, r: 1 });
if (charging.status !== "scene" || !close(certifiedOf(charging.document).V, 14) || !close(certifiedOf(charging.document).P_emf, -24) || !close(certifiedOf(charging.document).P_heat, 4)) throw new Error("charging cell must have signed source power and internal heating");
const boundedTemperature = consumePhysicalModel("ce.temperature_range", { R0: 10, alpha: -0.01, T0: 20, T: 40, Tmin: 0, Tmax: 50 });
if (boundedTemperature.status !== "scene" || !close(certifiedOf(boundedTemperature.document).R, 8)) throw new Error("linear temperature law needs a source reference and validity interval");
const supplied = consumePhysicalModel("ce.iv_samples", { i0: -2, v0: -3, i1: 0.5, v1: 1, i2: 3, v2: 9 });
if (supplied.status !== "scene" || Object.keys(certifiedOf(supplied.document)).length > 0 || !supplied.document.constructions.some((item) => item.operator === "point" && item.inputs.x === 3 && item.inputs.y === 9)) throw new Error("non-ohmic observations must use supplied current coordinates without derived certification");
const measuredTemperature = consumePhysicalModel("ce.temperature_samples", { T0: -10, R0: 8, T1: 20, R1: 10, T2: 50, R2: 17 });
if (measuredTemperature.status !== "scene" || Object.keys(certifiedOf(measuredTemperature.document)).length > 0 || !measuredTemperature.document.constructions.some((item) => item.operator === "point" && item.inputs.x === 50 && item.inputs.y === 17)) throw new Error("measured nonlinear resistance data must remain supplied observations");
const materials = consumePhysicalModel("ce.material_comparison", { rho1: 2, rho2: 5, L: 6, A: 3 });
if (materials.status !== "scene" || !close(certifiedOf(materials.document).R1, 4) || !close(certifiedOf(materials.document).R2, 10)) throw new Error("same-geometry material comparison must preserve geometry and reciprocal conductivities");

for (const fixture of fixtures) {
  const model = fixture.model;
  const groundedIr = buildIr(fixture);
  const validated = validateProblemIR(groundedIr, fixture.question);
  if (!validated.valid || !validated.problem) {
    fail(model, `grounded question must validate: ${validated.issues.map((issue) => issue.message).join("; ")}`);
  }
  const scene = validated.problem ? synthesizeFamilyScene({ question: fixture.question, problemIR: validated.problem }) : null;
  if (scene?.document.source.explicitPhysicalModel !== model) {
    fail(model, `grounded question must emit its own scene, got ${scene?.document.source.explicitPhysicalModel ?? "none"}`);
  }
  if (scene && scene.tier !== "question_representation") fail(model, `grounded scene tier must be question_representation, got ${scene.tier}`);
  const certified = scene ? certifiedOf(scene.document) : {};
  if (!close(certified[fixture.result.symbol], fixture.result.expected)) {
    fail(model, `emitted certified ${fixture.result.symbol} must be ${fixture.result.expected}, got ${String(certified[fixture.result.symbol])}`);
  }
  const solved = await solver.solve(groundedIr);
  const approximate = solved.values[0]?.approximate;
  if (solved.status !== "solved" || typeof approximate !== "number" || !close(approximate, fixture.result.expected)) {
    fail(model, `solver must recompute ${fixture.result.symbol} = ${fixture.result.expected}, got ${solved.status} ${solved.issues.map((issue) => issue.message).join("; ")}`);
  }
  for (const mutation of ["changedValue", "wrongRole", "dropAssumptions"] as const) {
    const mutated = buildIr(fixture, mutation);
    if (validateProblemIR(mutated, fixture.question).valid) fail(model, `${mutation} mutation must not validate`);
    if (synthesizeFamilyScene({ question: fixture.question, problemIR: mutated }) !== null) {
      fail(model, `${mutation} mutation must not emit a scene`);
    }
  }
  const genericQuote = "Use the explicit model for this source.";
  const genericIr = {
    schemaVersion: "problem-ir/v1",
    id: "genericQuote",
    question: genericQuote,
    facts: [{ id: "fact", kind: "given", statement: "The explicit model is the source.", evidence: { source: "question", start: 8, end: 23, quote: "explicit model" } }],
    entities: [],
    expressions: [],
    constraints: [],
    representationIntents: [],
    solveRequests: [{ id: "explicitModel", kind: "explicit_physical_model", model, inputs: fixture.values, evidenceFactIds: ["fact"] }],
  };
  if (validateProblemIR(genericIr, genericQuote).valid) fail(model, "a generic explicit-model quote must not validate");
  if (synthesizeFamilyScene({ question: genericQuote, problemIR: genericIr }) !== null) fail(model, "a generic explicit-model quote must not emit a scene");
}

// Isolated-builder figure checks: the compiled scene, not just the numbers.
{
  const drift = probe("ce.drift", compiledOrdinary("ce.drift", { n: 10, e: 2, A: 3, vd: 4 }));
  drift.labels(["conductor", "A", "I", "vd"]);
  drift.right("current");
  drift.left("drift");

  const density = probe("ce.current_density", compiledOrdinary("ce.current_density", { I: 8, A: 2, vd: 4, E: 2 }));
  density.labels(["conductor", "A", "I", "E", "vd"]);
  density.right("current");
  density.right("field");
  density.right("drift");

  const power = probe("ce.power", compiledOrdinary("ce.power", { I: 2, R: 3, V: 6 }));
  power.labels(["R", "I", "V"]);
  power.polarity();
  power.right("current");
  power.primitive("loadV", "dimension");

  const joule = probe("ce.joule", compiledOrdinary("ce.joule", { I: 2, R: 3, t: 4 }));
  joule.labels(["R", "I", "H"]);
  joule.right("current");
  joule.up("heat");

  const resistivity = probe("ce.resistivity", compiledOrdinary("ce.resistivity", { rho: 2 }));
  resistivity.labels(["ρ", "σ = 1/ρ"]);

  const resistance = probe("ce.resistance", compiledOrdinary("ce.resistance", { rho: 2, L: 6, A: 3 }));
  resistance.labels(["ρ", "L", "A"]);
  resistance.primitive("lengthMark", "dimension");

  const temperature = probe("ce.temperature", compiledOrdinary("ce.temperature", { R0: 10, alpha: 0.5, dT: 2 }));
  temperature.labels(["R₀", "ΔT", "α"]);
  temperature.up("rise");

  const cellScene = compiledOrdinary("ce.cell", { E: 12, I: 2, r: 1 });
  const cell = probe("ce.cell", cellScene);
  cell.labels(["E", "r", "A", "B", "I", "V"]);
  cell.polarity();
  const cellGlyphs = cellScene.primitives
    .filter((primitive) => primitive.entityId === "cell" && primitive.kind === "polyline");
  if (cellGlyphs.length < 4) fail("ce.cell", `the cell glyph needs its lead, long line, short line, and lead (>= 4 polylines), got ${cellGlyphs.length}`);
  cell.primitive("terminalA", "point");
  cell.primitive("terminalB", "point");
  cell.right("current");
  cell.primitive("terminalV", "dimension");

  const ohmic = probe("ce.iv_ohmic", compiledOrdinary("ce.iv_ohmic", { v1: 2, v2: 4 }));
  ohmic.labels(["I (A)", "V (V)"]);
  const ohmicAxes = ohmic.primitive("axes", "axes");
  const ohmicCurve = ohmic.primitive("curve", "polyline");
  const origin = ohmicAxes?.points.at(0);
  const curveStart = ohmicCurve?.points.at(0);
  if (!origin || !curveStart || Math.abs(origin.x - curveStart.x) > 1e-6 || Math.abs(origin.y - curveStart.y) > 1e-6) {
    fail("ce.iv_ohmic", "the ohmic characteristic must start at the axes origin");
  }
  const a = ohmicCurve?.points.at(0);
  const b = ohmicCurve?.points.at(1);
  const c = ohmicCurve?.points.at(2);
  if (!a || !b || !c) {
    fail("ce.iv_ohmic", "the ohmic characteristic needs at least three plotted points");
  } else {
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cross) > 1e-3) fail("ce.iv_ohmic", `the ohmic characteristic must be a straight line through the origin (cross product ${cross})`);
  }
  ohmic.primitive("observed1", "point");
  ohmic.primitive("observed2", "point");

  const declaredScene = compiledOrdinary("ce.iv_declared", { y1: 1, y2: 4 });
  const declared = probe("ce.iv_declared", declaredScene);
  declared.labels(["I (A)", "V (V)"]);
  declared.primitive("axes", "axes");
  declared.primitive("observed0", "point");
  declared.primitive("observed1", "point");
  declared.primitive("observed2", "point");
  if (declaredScene.primitives.some((primitive) => primitive.kind === "polyline")) {
    fail("ce.iv_declared", "the declared non-ohmic plot must not invent a joining curve between the supplied points");
  }
}

// Certified cross-check of every isolated builder against the frozen oracle numbers.
const oracle: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  "ce.drift": { I: 240 },
  "ce.current_density": { J: 4, mu: 2 },
  "ce.power": { P: 12 },
  "ce.joule": { H: 48 },
  "ce.resistivity": { sigma: 0.5 },
  "ce.resistance": { R: 4 },
  "ce.temperature": { R: 20 },
  "ce.cell": { V: 10 },
  "ce.iv_ohmic": { v1: 2, v2: 4, slope: 2 },
  "ce.iv_declared": {},
};
for (const fixture of fixtures) {
  const consumed = consumePhysicalModel(fixture.model, fixture.values);
  if (consumed.status !== "scene") {
    fail(fixture.model, `ordinary inputs were rejected: ${consumed.status === "rejected" ? consumed.reason : consumed.status}`);
    continue;
  }
  const certified = certifiedOf(consumed.document);
  const wanted = oracle[fixture.model];
  if (!wanted) {
    fail(fixture.model, "no oracle row");
    continue;
  }
  for (const key of [...new Set([...Object.keys(certified), ...Object.keys(wanted)])]) {
    if (!close(certified[key], wanted[key])) {
      fail(fixture.model, `certified ${key} must be ${String(wanted[key])}, got ${String(certified[key])}`);
    }
  }
}

const order = [...fixtures.map((fixture) => fixture.model), "ce.iv_declared"];
const report: string[] = [];
for (const model of order) {
  const reasons = modelFailures.get(model) ?? [];
  report.push(reasons.length === 0 ? `${model}: PASS` : `${model}: FAIL — ${reasons.join("; ")}`);
}
console.log(report.join("\n"));
if (modelFailures.size > 0) {
  throw new Error(`agent1 verification failed for ${modelFailures.size} model(s)`);
}
console.log("agent1 legacy verification passed (10 admitted models; declared observations carry no derived certification)");

const extensionOracles: Record<string, [Record<string, number>, Record<string, number>]> = {
  "ce.carrier_density": [{ vd: 12, J: -120, I: -240 }, { vd: 12, J: 120, I: 360 }],
  "ce.joule_piecewise": [{ H: 102, duration: 11 }, { H: 78, duration: 6 }],
  "ce.stretched_wire": [{ L: 12, A: 1.5, R: 16, R0: 4 }, { L: 2, A: 4, R: 1.5, R0: 6 }],
  "ce.cell_signed": [{ V: 14, P_emf: -24, P_heat: 4, P_terminal: -28 }, { V: 0, P_emf: 144, P_heat: 144, P_terminal: 0 }],
  "ce.temperature_range": [{ R: 8, Rmin: 12, Rmax: 7 }, { R: 16, Rmin: 14, Rmax: 24 }],
  "ce.iv_samples": [{}, {}], "ce.temperature_samples": [{}, {}],
  "ce.material_comparison": [{ sigma1: 0.5, sigma2: 0.2, R1: 4, R2: 10 }, { sigma1: 0.25, sigma2: 1, R1: 6, R2: 1.5 }],
};
const renderedFrames: Array<{ name: string; sample: number; scene: RenderScene }> = [];
for (const item of standardCases().filter((item) => item.modelName.startsWith("ce."))) {
  const admission = modelAdmission(item.modelName);
  if (!admission) throw new Error(`${item.modelName} lacks source admission`);
  for (const [index, values] of [item.ordinary, item.altered].entries()) {
    const result = consumePhysicalModel(item.modelName, values);
    if (result.status !== "scene") throw new Error(`${item.modelName} positive ${index} rejected`);
    const expected = extensionOracles[item.modelName]?.[index];
    const actual = certifiedOf(result.document);
    if (expected) for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) if (!close(actual[key], expected[key])) throw new Error(`${item.modelName} oracle ${key}: ${actual[key]} != ${expected[key]}`);
    const compiled = compiledOrdinary(item.modelName, values);
    renderedFrames.push({ name: item.modelName, sample: index, scene: compiled });
    if (item.declaredScope === "qualitative" && compiled.primitives.some((primitive) => primitive.kind === "polyline")) throw new Error(`${item.modelName} invents interpolation`);
  }
  for (const invalid of [...item.rejections, { ...item.ordinary, invented: 1 }]) if (consumePhysicalModel(item.modelName, invalid).status !== "rejected") throw new Error(`${item.modelName} invalid/unknown input accepted`);
  if (!extensionOracles[item.modelName] && item.modelName !== "ce.iv_declared") continue; // Legacy handwritten source fixtures above.
  const bindings = Object.keys(item.ordinary).map((key) => {
    const role = modelAdmissionRole(item.modelName, key);
    if (!role) throw new Error(`${item.modelName}.${key} lacks source admission`);
    return { key, ...role, quote: `${role.role} ${item.ordinary[key]} ${role.unit}` };
  });
  const assumptions = admission.assumptions.map((phrase) => ({ phrase, quote: phrase }));
  const asked = item.modelName.includes("iv_") ? "Draw the V-I characteristic from these supplied observations." : item.modelName.includes("temperature") ? "Draw the resistance versus temperature plot." : "Show the declared model.";
  const question = `${assumptions.map((entry) => entry.quote).join("; ")}. ${bindings.map((entry) => entry.quote).join("; ")}. ${asked}`;
  const expected = extensionOracles[item.modelName]?.[0] ?? {};
  const symbol = Object.keys(expected)[0] ?? "observations";
  const fixture: CaseFixture = { model: item.modelName, question, bindings, values: item.ordinary, assumptions, asked: { statement: asked, quote: asked }, result: { symbol, unit: symbol === "vd" ? "m/s" : symbol === "H" ? "J" : symbol === "V" ? "V" : symbol === "R" ? "ohm" : symbol === "sigma1" ? "S/m" : "1", expected: expected[symbol] ?? 0 }, changed: { key: bindings[0]!.key, value: item.ordinary[bindings[0]!.key]! + 17 }, certified: expected };
  const raw = buildIr(fixture);
  if (item.declaredScope === "qualitative") {
    const request = (raw.solveRequests as Array<Record<string, unknown>>)[0]!;
    delete request.resultBinding;
  }
  const validated = validateProblemIR(raw, question);
  if (!validated.problem) throw new Error(`${item.modelName} source fixture rejected: ${JSON.stringify(validated.issues)}`);
  const represented = synthesizeFamilyScene({ question, problemIR: validated.problem });
  if (represented?.document.source.explicitPhysicalModel !== item.modelName) {
    const explicit = explicitPhysicalModelScene(question, validated.problem);
    const v = explicit.document ? validateSceneDocument(pruneDeadSceneEntities(structuredClone(explicit.document) as unknown as Record<string, unknown>)) : null;
    const c = v?.document ? compileSceneDocument(v.document) : null;
    throw new Error(`${item.modelName} source fixture lost its family: ${explicit.reason}; validate=${JSON.stringify(v?.report.issues)} compile=${JSON.stringify(c?.report.issues)} demand=${explicit.document && demandRejection(explicit.document, sceneDemand(question, validated.problem))} obligations=${explicit.document && visualObligationRejection(deriveVisualObligations(validated.problem), explicit.document, validated.problem)}`);
  }
  if (item.declaredScope === "solved") {
    const solved = await solver.solve(validated.problem);
    if (solved.status !== "solved" || !close(solved.values[0]?.approximate ?? NaN, expected[symbol])) throw new Error(`${item.modelName} solver lost numeric authority`);
  }
  for (const mutation of ["changedValue", "wrongRole", "dropAssumptions"] as const) {
    const mutated = buildIr(fixture, mutation);
    if (validateProblemIR(mutated, question).valid || synthesizeFamilyScene({ question, problemIR: mutated })) throw new Error(`${item.modelName} accepted ${mutation}`);
  }
  const omitted = structuredClone(raw) as { solveRequests: Array<{ bindings: unknown[] }> };
  omitted.solveRequests[0]!.bindings.pop();
  if (validateProblemIR(omitted, question).valid || synthesizeFamilyScene({ question, problemIR: omitted })) throw new Error(`${item.modelName} accepted omitted required evidence`);
}

// Holdout: different density/area and carrier sign; no values from the named examples.
const holdoutCarrier = consumePhysicalModel("ce.carrier_density", { n: 7, q: -3, mu: 0.5, E: 8, A: 0.25 });
if (holdoutCarrier.status !== "scene" || !close(certifiedOf(holdoutCarrier.document).I, 21)) throw new Error("signed carrier holdout must give 21 A");
for (const state of [{ E: 9, I: 0, r: 2 }, { E: 9, I: 4.5, r: 2 }, { E: 9, I: -3, r: 2 }]) {
  const result = consumePhysicalModel("ce.cell_signed", state);
  if (result.status !== "scene") throw new Error("cell open/short/charging state unsupported");
  const c = certifiedOf(result.document);
  if (!close(c.P_emf - c.P_terminal - c.P_heat, 0)) throw new Error("cell power balance fails");
}
if (consumePhysicalModel("math.circle", { n: 1 }).status !== "unclaimed") throw new Error("wrong family claimed");
console.log("agent1 extension source, solver, numeric, invalid, omitted-evidence, observed-plot, and holdout gates passed");
const renderDir = process.env.EM_CURRENT_RENDER_DIR;
if (renderDir) { mkdirSync(renderDir, { recursive: true }); for (const item of renderedFrames) writeFileSync(resolve(renderDir, `${item.name}-${item.sample}.svg`), renderSceneSvg(item.scene, { title: `${item.name} ${item.sample}`, subtitle: "1200×700 offline compiled frame; observed points carry no derived certification" })); }
// The declared-scope gate above is not a whole-row completion receipt.
// Explicit full-obligation mode retains unsupported larger declared data in
// the gap denominator instead of silently narrowing the frozen source scope.
if (process.argv.includes("--full-obligations")) {
  const missing: string[] = [];
  if (consumePhysicalModel("ce.joule_piecewise", { R: 3, I1: 2, t1: 4, I2: -3, t2: 2, I3: 0, t3: 5, I4: 1, t4: 2 }).status !== "scene") missing.push("joules-law-of-heating: arbitrary declared interval cardinality beyond three");
  if (consumePhysicalModel("ce.iv_samples", { i0: -2, v0: -3, i1: 0.5, v1: 1, i2: 3, v2: 9, i3: 4, v3: 16 }).status !== "scene") missing.push("iv-characteristics: arbitrary supplied observation cardinality beyond three");
  if (consumePhysicalModel("ce.temperature_samples", { T0: -10, R0: 8, T1: 20, R1: 10, T2: 50, R2: 17, T3: 80, R3: 30 }).status !== "scene") missing.push("temperature-dependence-of-resistance: arbitrary nonlinear measured observation cardinality beyond three");
  if (missing.length) throw new Error(`Current full-row obligations remain open:\n${missing.join("\n")}`);
}
