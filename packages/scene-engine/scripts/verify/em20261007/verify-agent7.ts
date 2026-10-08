import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileSceneDocument } from "../../../src/compile/compiler";
import { validateSceneDocument } from "../../../src/document/validation";
import { consumePhysicalModel, standardCases, topicDispositions } from "../../../src/physics/em20261007/consume";
import type { RenderScene, SceneDocument } from "../../../src/types";
import { inductionAcAdmissions, inductionAcOutputUnits } from "../../../src/physics/em20261007/agent7-induction-ac";
import { registerModelAdmission, type ModelAdmission } from "../../../src/physics/em20261007/admission";
import { validateProblemIR } from "../../../src/ir/problemIR";
import { synthesizeFamilyScene } from "../../../src/synthesize/familyScene";
import { LocalDeterministicSolverProvider } from "../../../src/ir/solver";
import { renderSceneSvg } from "../../lib/renderSceneSvg";

/**
 * Frozen 14-row EMI/AC packet gate, 2026-10-09.
 * Independent scalar, conservation, source-binding, solver and full-frame
 * checks cover the original 14 models and 13 reusable dynamic extensions.
 * This gate does not mutate or prescribe the shared acceptance ledger.
 * Production acceptance belongs to the integration owner after dependency,
 * planner, runtime, persistence and independent review gates have passed.
 */

const failures: string[] = [];
const frames: Array<{ name: string; scene: RenderScene }> = [];
let checks = 0;
// Full frozen obligations: these are independent hand values, not model reads.
const dynamicCases: Array<[string, Record<string, number>, Record<string, number>]> = [
  ["ind.flux_loop", { B0: 2, dB: 3, ddB: 0, A0: 4, dA: 1, theta0: 0, omega: 0, N: 2, winding: 1, time: 1, closed: 1, R: 10 }, { phi: 50, emf: -40, I: -4, P: 160 }],
  ["ind.flux_loop", { B0: 2, dB: 0, ddB: 0, A0: 3, dA: 0, theta0: 0, omega: 2, N: 2, winding: -1, time: Math.PI / 4, closed: 0 }, { phi: 0, emf: -24 }],
  ["ind.self_state", { L0: 2, dL: 3, I0: 4, dI: -1, time: 1 }, { L: 5, I: 3, linkage: 15, emf: -4, U: 22.5 }],
  ["ind.mutual_state", { L1: 4, L2: 9, k: 0.5, dot1: 1, dot2: -1, I10: 2, dI1: 4, I20: 1, dI2: -1, time: 0 }, { M: -3, emf1: -3, emf2: 12, U: 6.5 }],
  ["ind.lc_state", { L: 4, C: 0.25, Q0: 2, I0: 0, time: Math.PI / 2 }, { omega: 1, Q: 0, I: -2, V: 0, UL: 8, UC: 0, U: 8 }],
];
for (const [name, inputs, oracle] of dynamicCases) {
  const result = consumePhysicalModel(name, inputs);
  if (result.status !== "scene") failures.push(`${name}: missing frozen dynamic variant`);
  else { matches(certifiedOf(result.document), oracle, name); compile(result.document, name); }
}
const apparatusCases: Array<[string, Record<string, number>, Record<string, number>]> = [
  ["ind.motional_circuit", { B: -2, l: 3, vx: 4, rodAngle: Math.PI / 2, closed: 1, R: 6 }, { emf: 24, I: 4, Fx: -24, P: 96 }],
  ["ind.sinusoid", { Vpeak: 10, Ipeak: 4, omega: 3, voltagePhase: 0.4, currentPhase: -0.6, time: 0 }, { Vrms: 10 / Math.sqrt(2), Irms: 4 / Math.sqrt(2), phase: 1, P: 20 * Math.cos(1), v: 10 * Math.sin(0.4), i: 4 * Math.sin(-0.6) }],
  ["ind.eddy_motion", { fieldSign: 1, velocitySign: 1, boundary: -1 }, {}],
  ["ind.rc_transient", { R: 2, C: 0.5, V: 10, initialV: 2, time: 1 }, { tau: 1, state: 10 - 8 / Math.E, current: 4 / Math.E, stored: 0.25 * (10 - 8 / Math.E) ** 2 }],
];
for (const [name, inputs, oracle] of apparatusCases) {
  const result = consumePhysicalModel(name, inputs);
  if (result.status !== "scene") failures.push(`${name}: missing frozen apparatus variant`);
  else { matches(certifiedOf(result.document), oracle, name); compile(result.document, name); }
}
for (const [name, inputs, oracle] of [
  ["ind.generator_state", { N: 2, B: 3, A: 4, omega: 5, theta0: 0, time: Math.PI / 10, winding: -1, closed: 1, R: 12 }, { phi: 0, emf: -120, peakEmf: 120, I: -10, P: 1200 }],
  ["ind.transformer_load", { Np: 10, Ns: 2, Vp: 100, frequency: 50, dotP: 1, dotS: -1, load: 4, coreLoss: 5, copperLoss: 5 }, { Vs: -20, Is: 5, Pout: 100, Pin: 110, Ip: 1.1, efficiency: 10 / 11 }],
  ["ind.dc_limits", { kind: 1, steady: 1 }, {}],
] as Array<[string, Record<string, number>, Record<string, number>]>) {
  const result = consumePhysicalModel(name, inputs);
  if (result.status !== "scene") failures.push(`${name}: missing required source apparatus`);
  else { matches(certifiedOf(result.document), oracle, name); compile(result.document, name); }
}
const seriesFixture = { V: 10, R: 3, L: 2, C: 0.0625, omega: 4, phase: 0, series: 1, scanMin: 1, scanMax: 8, scanCount: 29 };
const seriesResponse = consumePhysicalModel("ind.series_response", seriesFixture);
if (seriesResponse.status !== "scene") failures.push("series response needs component voltages and a frequency scan");
else { matches(certifiedOf(seriesResponse.document), { XL: 8, XC: 4, Zreal: 3, Zimag: 4, Z: 5, Ireal: 1.2, Iimag: -1.6, I: 2, lag: Math.atan2(4, 3), P: 12, Q: 16, VR: 6, VL: 16, VC: 8 }, "series response"); compile(seriesResponse.document, "series response"); }
function check(condition: unknown, message: string): void {
  checks++;
  if (!condition) failures.push(message);
}
function close(actual: number, expected: number, message: string): void {
  checks++;
  if (!(Math.abs(actual - expected) <= 1e-8 * Math.max(1, Math.abs(expected)))) {
    failures.push(`${message}: ${actual} != ${expected}`);
  }
}

const expected: Record<string, { ordinary: Record<string, number>; altered: Record<string, number> }> = {
  "ind.faraday": { ordinary: { phi: 20, emf: -12 }, altered: { phi: 12, emf: -8 } },
  "ind.motional": { ordinary: { emf: 24 }, altered: { emf: 30 } },
  "ind.eddy": { ordinary: {}, altered: {} },
  "ind.self": { ordinary: { L: 360 }, altered: { L: 144 } },
  "ind.mutual": { ordinary: { M: 3 }, altered: { M: 6 } },
  "ind.lc": { ordinary: { omega: 1, U: 8 }, altered: { omega: 1, U: 32 } },
  "ind.resistor": { ordinary: { Z: 5 }, altered: { Z: 7 } },
  "ind.reactance": { ordinary: { XL: 8, XC: 1 }, altered: { XL: 4, XC: 2 } },
  "ind.lcr": { ordinary: { X: 4, Z: 5 }, altered: { X: 4, Z: Math.hypot(8, 4) } },
  "ind.phasor": { ordinary: { Ireal: 1.2, Iimag: -1.6, I: 2, P: 12, powerFactor: 0.6 }, altered: { Ireal: 0.6, Iimag: -0.8, I: 1, P: 3, powerFactor: 0.6 } },
  "ind.resonance": { ordinary: { omega: 1, Z: 5 }, altered: { omega: 1, Z: 8 } },
  "ind.wattless": { ordinary: { XL: 8, I: 1.25, P: 0 }, altered: { XL: 16, I: 0.625, P: 0 } },
  "ind.generator": { ordinary: { peakEmf: 120 }, altered: { peakEmf: 48 } },
  "ind.transformer": { ordinary: { Vs: 20, Is: 5 }, altered: { Vs: 50, Is: 2 } },
  "ind.flux_loop": { ordinary: { phi: 50, emf: -40, I: -4, P: 160 }, altered: { phi: 0, emf: -24 } },
  "ind.self_state": { ordinary: { L: 5, I: 3, linkage: 15, emf: -4, U: 22.5 }, altered: { L: 5, I: 2, linkage: 10, emf: -15, U: 10 } },
  "ind.mutual_state": { ordinary: { M: -3, emf1: -3, emf2: 12, U: 6.5 }, altered: { M: 0, emf1: 0, emf2: 0, U: 12.5 } },
  "ind.lc_state": { ordinary: { omega: 1, Q: 0, I: -2, V: 0, UL: 8, UC: 0, U: 8 }, altered: { omega: 1, Q: 4, I: 0, V: 16, UL: 0, UC: 32, U: 32 } },
  "ind.motional_circuit": { ordinary: { emf: 24, I: 4, Fx: -24, P: 96 }, altered: { emf: 12 * Math.SQRT2 } },
  "ind.sinusoid": { ordinary: { Vrms: 10 / Math.SQRT2, Irms: 4 / Math.SQRT2, phase: 1, P: 20 * Math.cos(1), v: 10 * Math.sin(0.4), i: 4 * Math.sin(-0.6) }, altered: { Vrms: 8 / Math.SQRT2, Irms: Math.SQRT2, phase: -Math.PI / 2, P: 0, v: 0, i: 2 } },
  "ind.eddy_motion": { ordinary: {}, altered: {} },
  "ind.rc_transient": { ordinary: { tau: 1, state: 10 - 8 / Math.E, current: 4 / Math.E, stored: (10 - 8 / Math.E) ** 2 / 4 }, altered: { tau: 1, state: 8 / Math.E, current: -4 / Math.E, stored: 16 / Math.E ** 2 } },
  "ind.lr_transient": { ordinary: { tau: 2, state: 5 - 4 / Math.E, current: 5 - 4 / Math.E, stored: 2 * (5 - 4 / Math.E) ** 2 }, altered: { tau: 2, state: 4 / Math.E, current: 4 / Math.E, stored: 32 / Math.E ** 2 } },
  "ind.generator_state": { ordinary: { phi: 0, emf: -120, peakEmf: 120, I: -10, P: 1200 }, altered: { phi: 0, emf: -48, peakEmf: 48 } },
  "ind.transformer_load": { ordinary: { Vs: -20, Is: 5, Pout: 100, Pin: 110, Ip: 1.1, efficiency: 10 / 11 }, altered: { Vs: 100, Is: 5, Pout: 500, Pin: 500, Ip: 25, efficiency: 1 } },
  "ind.dc_limits": { ordinary: {}, altered: {} },
  "ind.series_response": { ordinary: { XL: 8, XC: 4, Zreal: 3, Zimag: 4, Z: 5, Ireal: 1.2, Iimag: -1.6, I: 2, lag: Math.atan2(4, 3), P: 12, Q: 16, VR: 6, VL: 16, VC: 8 }, altered: { XL: 4, XC: 8, Zreal: 3, Zimag: -4, Z: 5, Ireal: -1.6, Iimag: 1.2, I: 2, lag: Math.atan2(-4, 3), P: 12, Q: -16, VR: 6, VL: 8, VC: 16 } },
};

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

function compile(document: SceneDocument, label: string): RenderScene | null {
  const validated = validateSceneDocument(document);
  if (!validated.document) {
    failures.push(`${label} validation: ${validated.report.issues.filter((issue) => issue.severity === "fatal").map((issue) => `${issue.code}: ${issue.message}`).join("; ")}`);
    return null;
  }
  const compiled = compileSceneDocument(validated.document);
  if (!compiled.ok || !compiled.renderScene || compiled.report.issues.some((issue) => issue.severity === "fatal")) {
    failures.push(`${label} compile: ${compiled.report.issues.map((issue) => issue.message).join("; ")}`);
    return null;
  }
  check(compiled.renderScene.primitives.length > 0, `${label} scene render is empty`);
  frames.push({ name: label, scene: compiled.renderScene });
  return compiled.renderScene;
}

function matches(actual: Record<string, number>, wanted: Record<string, number>, label: string): void {
  const keys = [...new Set([...Object.keys(actual), ...Object.keys(wanted)])].sort();
  for (const key of keys) {
    if (!(key in actual) || !(key in wanted)) failures.push(`${label} certified keys ${JSON.stringify(actual)} != ${JSON.stringify(wanted)}`);
    else close(actual[key]!, wanted[key]!, `${label} ${key}`);
  }
}

function labelTexts(scene: RenderScene): string[] {
  return scene.primitives.filter((primitive) => primitive.kind === "label").map((primitive) => primitive.text ?? "");
}

const cases = standardCases().filter((item) => item.modelName.startsWith("ind."));
check(cases.length === Object.keys(expected).length, `induction case count ${cases.length} differs from independent oracle count`);
for (const item of cases) {
  const oracle = expected[item.modelName];
  if (!oracle) {
    failures.push(`missing oracle ${item.modelName}`);
    continue;
  }
  for (const sample of ["ordinary", "altered"] as const) {
    const consumed = consumePhysicalModel(item.modelName, sample === "ordinary" ? item.ordinary : item.altered);
    if (consumed.status !== "scene") {
      failures.push(`${item.modelName} ${sample} ${consumed.status === "rejected" ? consumed.reason : consumed.status}`);
      continue;
    }
    try {
      matches(certifiedOf(consumed.document), oracle[sample], `${item.modelName} ${sample}`);
    } catch (error) {
      failures.push(`${item.modelName} ${sample} ${error instanceof Error ? error.message : String(error)}`);
    }
    compile(consumed.document, `${item.modelName} ${sample}`);
  }
  check(item.rejections.length > 0, `${item.modelName} has no rejection`);
  for (const rejection of item.rejections) {
    const consumed = consumePhysicalModel(item.modelName, rejection);
    check(consumed.status === "rejected", `${item.modelName} accepted ${JSON.stringify(rejection)}`);
  }
}

const inductionTopics = topicDispositions().filter((topic) => topic.chapter === "Electromagnetic Induction and Alternating Currents");
check(inductionTopics.length === 14, `induction disposition count ${inductionTopics.length} != 14`);
for (const [topic, model] of [
  ["induced-emf-current-and-lenz-law", "ind.flux_loop"],
  ["power-in-ac-circuits-and-wattless-current", "ind.sinusoid"],
  ["ac-generator-and-transformer", "ind.transformer_load"],
  ["inductive-and-capacitive-reactance", "ind.series_response"],
  ["resonance-power-and-wattless-current", "ind.series_response"],
  ["power-in-ac-circuits-and-wattless-current", "ind.series_response"],
]) check(inductionTopics.find((item) => item.topicId === `physics|14|${topic}`)?.models.includes(model!), `${topic} audit omits its reusable ${model} closure`);

// Test-only registration exercises the exact handoff contracts without writing
// the coordinator's shared registration file.
for (const admission of inductionAcAdmissions) registerModelAdmission(admission);
function sourceFixture(admission: ModelAdmission, inputs: Record<string, number>, oracle: Record<string, number>, quoteOverrides: Record<string, string> = {}) {
  const quotes = Object.entries(inputs).map(([key, value]) => {
    const role = admission.roles[key] ?? admission.optionalRoles?.[key];
    if (!role) throw new Error(`${admission.name} missing source role ${key}`);
    return { key, value, role, quote: quoteOverrides[key] ?? role.sourcePhrases?.[String(value)]?.[0] ?? `${role.role} ${value} ${role.unit}` };
  });
  const assumptions = [...new Set([...admission.assumptions, ...(admission.conditionalRules ?? []).filter((rule) =>
    (!rule.when.presentAny || rule.when.presentAny.some((key) => key in inputs)) &&
    (!rule.when.absentAll || rule.when.absentAll.every((key) => !(key in inputs))) &&
    (!rule.when.equals || Object.entries(rule.when.equals).every(([key, value]) => inputs[key] === value)),
  ).flatMap((rule) => rule.assumptions ?? [])])];
  const asked = "Show the declared apparatus and calculate its requested result.";
  const question = `${assumptions.join("; ")}; ${quotes.map((item) => item.quote).join("; ")}; ${asked}`;
  const evidence = (quote: string) => ({ source: "question", start: question.indexOf(quote), end: question.indexOf(quote) + quote.length, quote });
  const symbol = Object.keys(oracle)[0];
  const raw = { schemaVersion: "problem-ir/v1", id: "emiSource", question,
    facts: [...quotes.map(({ key, role, quote }) => ({ id: key, kind: "given", statement: role.role, evidence: evidence(quote) })), ...assumptions.map((phrase, i) => ({ id: `assumption${i}`, kind: "assumption", statement: phrase, evidence: evidence(phrase) })), { id: "asked", kind: "requested", statement: asked, evidence: evidence(asked) }],
    entities: [], expressions: quotes.map(({ key, value }) => ({ id: key, valueType: "scalar", root: { kind: "number", value }, evidenceFactIds: [key] })), constraints: [], representationIntents: [],
    solveRequests: [{ id: "explicit", kind: "explicit_physical_model", model: admission.name, bindings: quotes.map(({ key, role }) => ({ key, role: role.role, unit: role.unit, expressionId: key, evidenceFactId: key })), evidenceFactIds: ["asked"], ...(symbol ? { resultBinding: { turnPlanQuantityId: "result", symbol, unit: inductionAcOutputUnits[admission.name]![symbol]!, evidenceFactIds: ["asked"] } } : {}) }],
  };
  return { question, raw, symbol };
}
const solver = new LocalDeterministicSolverProvider();
for (const item of cases) {
  const admission = inductionAcAdmissions.find((entry) => entry.name === item.modelName)!;
  check(Boolean(admission), `${item.modelName} exact admission missing`);
  for (const sample of ["ordinary", "altered"] as const) {
    const inputs = sample === "ordinary" ? item.ordinary : item.altered, oracle = expected[item.modelName]![sample];
    matches({ ...admission.scalar(inputs) }, oracle, `${item.modelName} ${sample} independent scalar`);
    const { raw, question, symbol } = sourceFixture(admission, inputs, oracle), validated = validateProblemIR(raw, question);
    check(validated.valid && Boolean(validated.problem), `${item.modelName} ${sample} source invalid: ${JSON.stringify(validated.issues)}`);
    if (!validated.problem) continue;
    const scene = synthesizeFamilyScene({ question, problemIR: validated.problem });
    check(scene?.document.source.explicitPhysicalModel === item.modelName, `${item.modelName} ${sample} admitted family missing`);
    if (scene) compile(scene.document, `${item.modelName} ${sample} admitted`);
    const solved = await solver.solve(validated.problem);
    check(solved.status === "solved", `${item.modelName} ${sample} source solver failed`);
    if (symbol) close(solved.values[0]?.approximate ?? NaN, oracle[symbol]!, `${item.modelName} ${sample} source solver`);
    else check(solved.values.length === 0 && scene && Object.keys(certifiedOf(scene.document)).length === 0, `${item.modelName} representation fabricated a scalar`);
    for (const mutation of ["wrong-role", "wrong-unit", "wrong-sign", "omitted-binding", "wrong-family", "missing-assumption", "forged-quote", "stale-value"]) {
      const bad = structuredClone(raw);
      if (mutation === "wrong-role") bad.solveRequests[0]!.bindings[0]!.role = "mass";
      if (mutation === "wrong-unit") bad.solveRequests[0]!.bindings[0]!.unit = "kg";
      if (mutation === "wrong-sign") bad.expressions[0]!.root.value = -bad.expressions[0]!.root.value - 0.123;
      if (mutation === "omitted-binding") bad.solveRequests[0]!.bindings.pop();
      if (mutation === "wrong-family") bad.solveRequests[0]!.model = "ce.drift";
      if (mutation === "missing-assumption") bad.facts = bad.facts.filter((fact) => fact.kind !== "assumption");
      if (mutation === "forged-quote") bad.facts[0]!.evidence.quote = "generated fact is not source";
      if (mutation === "stale-value") bad.expressions[0]!.root.value += 19;
      const rejected = validateProblemIR(bad, question);
      check(!rejected.valid && !synthesizeFamilyScene({ question, problemIR: bad }), `${item.modelName} ${sample} accepted ${mutation}`);
    }
    for (const [key, value] of Object.entries(inputs)) {
      const role = admission.roles[key] ?? admission.optionalRoles?.[key], phrase = role?.sourcePhrases?.[String(value)]?.[0];
      if (!phrase) continue;
      const negated = sourceFixture(admission, inputs, oracle, { [key]: `not ${phrase}` });
      check(!validateProblemIR(negated.raw, negated.question).valid, `${item.modelName} ${sample} accepted negated selector ${key}`);
      const other = Object.entries(role.sourcePhrases!).find(([otherValue]) => Number(otherValue) !== value)?.[1]?.[0];
      if (other) { const conflicting = sourceFixture(admission, inputs, oracle, { [key]: `${phrase} and ${other}` }); check(!validateProblemIR(conflicting.raw, conflicting.question).valid, `${item.modelName} ${sample} accepted conflicting selector ${key}`); }
    }
  }
}

// ind.faraday figure: a field-direction label and an emf label must survive compilation.
const faradayFigures: Array<[string, Record<string, number>, string]> = [
  ["ordinary", { Bz0: 2, dBz: 3, area: 4, turns: 1, time: 1 }, "⊙"],
  ["altered", { Bz0: 1, dBz: 2, area: 4, turns: 1, time: 1 }, "⊙"],
];
for (const [name, inputs, marker] of faradayFigures) {
  const consumed = consumePhysicalModel("ind.faraday", inputs);
  if (consumed.status !== "scene") {
    failures.push(`ind.faraday ${name} figure ${consumed.status === "rejected" ? consumed.reason : consumed.status}`);
    continue;
  }
  const rendered = compile(consumed.document, `ind.faraday ${name} figure`);
  if (!rendered) continue;
  const labels = labelTexts(rendered);
  check(labels.includes("B"), `ind.faraday ${name} field-direction label B missing: ${labels.join(",")}`);
  check(labels.includes(marker), `ind.faraday ${name} page-normal marker ${marker} missing: ${labels.join(",")}`);
  check(labels.some((text) => text.includes("emf")), `ind.faraday ${name} emf label missing: ${labels.join(",")}`);
  check(rendered.primitives.some((primitive) => primitive.kind === "polyline"), `ind.faraday ${name} flux curve missing`);
  check(rendered.primitives.some((primitive) => primitive.kind === "point"), `ind.faraday ${name} flux state point missing`);
}

// The page-normal marker follows the sign of the sampled field.
const intoPage = consumePhysicalModel("ind.faraday", { Bz0: -2, dBz: -3, area: 4, turns: 1, time: 1 });
check(intoPage.status === "scene", `a negative sampled field must stay a valid into-the-page figure, got ${intoPage.status === "rejected" ? intoPage.reason : intoPage.status}`);
if (intoPage.status === "scene") {
  const certified = certifiedOf(intoPage.document);
  close(certified.phi ?? NaN, -20, "into-page phi");
  close(certified.emf ?? NaN, 12, "into-page emf");
  const rendered = compile(intoPage.document, "ind.faraday into-page figure");
  if (rendered) {
    const labels = labelTexts(rendered);
    check(labels.includes("B"), `into-page field-direction label B missing: ${labels.join(",")}`);
    check(labels.includes("⊗"), `into-page marker ⊗ missing: ${labels.join(",")}`);
    check(!labels.includes("⊙"), "into-page figure must not keep the out-of-page marker");
    check(labels.some((text) => text.includes("emf")), `into-page emf label missing: ${labels.join(",")}`);
  }
}
const zeroField = consumePhysicalModel("ind.faraday", { Bz0: 1, dBz: -1, area: 4, turns: 1, time: 1 });
check(zeroField.status === "rejected" && zeroField.reason.includes("field-direction"), `a zero sampled field has no field-direction label and must be rejected, got ${zeroField.status === "rejected" ? zeroField.reason : zeroField.status}`);

function holdout(name: string, input: Record<string, number>, label: string): SceneDocument | null {
  const result = consumePhysicalModel(name, input);
  check(result.status === "scene", `${label} holdout rejected: ${result.status === "rejected" ? result.reason : result.status}`);
  if (result.status !== "scene") return null;
  compile(result.document, label);
  return result.document;
}
function integral(f: (x: number) => number, a: number, b: number, n = 4096): number {
  // Composite Simpson, independent of production state/phasor formulas.
  const h = (b - a) / n; let sum = f(a) + f(b);
  for (let i = 1; i < n; i++) sum += (i % 2 ? 4 : 2) * f(a + i * h);
  return sum * h / 3;
}
for (const winding of [-1, 1]) for (const dB of [-2, 0, 2]) for (const closed of [0, 1]) {
  const input = { B0: -3, dB, ddB: 2, A0: 2, dA: 0.5, theta0: 0.3, omega: -0.4, N: 3, winding, time: 0.7, closed, ...(closed ? { R: 5 } : {}) }, doc = holdout("ind.flux_loop", input, `flux-hard-${winding}-${dB}-${closed}`);
  if (!doc) continue;
  const r = certifiedOf(doc), linkage = (t: number) => 3 * winding * (-3 + dB * t + t * t) * (2 + t / 2) * Math.cos(0.3 - 0.4 * t), h = 1e-5;
  close(r.emf!, -(linkage(0.7 + h) - linkage(0.7 - h)) / (2 * h), "independent flux derivative");
  const normal = doc.source.positiveAreaNormalWorld as number[], field = doc.source.fieldWorld as number[];
  close(normal.reduce((sum, value, i) => sum + value * field[i]!, 0) * 3 * 2.35, r.phi!, "oriented area/B world dot product");
  const terminals = doc.source.terminalTopology as { emfReference: { positive: string; negative: string } };
  check(terminals.emfReference.positive === (winding > 0 ? "A" : "B") && terminals.emfReference.negative === (winding > 0 ? "B" : "A"), "source winding lost terminal emf reference");
  if (closed) { close(r.I! * 5, r.emf!, "closed-loop KVL"); close(r.P!, r.emf! * r.I!, "induced electrical power"); }
  else check(!("I" in r), "open-loop emf fabricated a current");
}
for (const B of [-2, 2]) for (const vx of [-4, 4]) for (const angle of [Math.PI / 6, Math.PI / 2, -Math.PI / 3]) {
  const doc = holdout("ind.motional_circuit", { B, l: 3, vx, rodAngle: angle, closed: 1, R: 7 }, `rod-hard-${B}-${vx}-${angle}`); if (!doc) continue;
  const r = certifiedOf(doc), integralEmf = integral(() => -vx * B * Math.sin(angle), 0, 3);
  close(r.emf!, integralEmf, "independent v-cross-B line integral"); close(-r.Fx! * vx, r.P!, "mechanical/electrical power balance"); check(r.Fx! * vx <= 0, "passive magnetic force assists rod motion");
}
for (const fieldSign of [-1, 1]) for (const velocitySign of [-1, 1]) for (const boundary of [-1, 0, 1]) {
  const doc = holdout("ind.eddy_motion", { fieldSign, velocitySign, boundary }, `eddy-${fieldSign}-${velocitySign}-${boundary}`); if (!doc) continue;
  const relations = doc.source.qualitativeRelations as { circulation: number; dragDirection: number };
  const change = boundary === 0 ? 0 : -boundary * velocitySign * fieldSign;
  check(relations.circulation === -change, "eddy circulation fails Lenz opposition"); check(relations.dragDirection === (boundary === 0 ? 0 : -velocitySign), "eddy drag/no-change relation wrong");
}
for (const Q0 of [-3, 0, 2]) for (const I0 of [-2, 1]) for (const time of [0, 0.9, Math.PI / 2, Math.PI]) {
  const L = 2, C = 0.5, doc = holdout("ind.lc_state", { L, C, Q0, I0, time }, `lc-hard-${Q0}-${I0}-${time}`); if (!doc) continue;
  const r = certifiedOf(doc); close(r.U!, Q0 ** 2 + I0 ** 2, "LC energy invariant"); close(r.V! + L * (-r.Q! / (L * C)), 0, "LC KVL");
}
for (const phase of [-1.2, 0, 0.8, Math.PI / 2]) {
  const doc = holdout("ind.sinusoid", { Vpeak: 7, Ipeak: 3, omega: 5, voltagePhase: 0.3, currentPhase: 0.3 - phase, time: 0.2 }, `sinusoid-${phase}`); if (!doc) continue;
  const r = certifiedOf(doc), period = 2 * Math.PI / 5, v = (t: number) => 7 * Math.sin(5 * t + 0.3), i = (t: number) => 3 * Math.sin(5 * t + 0.3 - phase);
  close(r.Vrms! ** 2, integral((t) => v(t) ** 2, 0, period) / period, "independent voltage RMS cycle integral"); close(r.Irms! ** 2, integral((t) => i(t) ** 2, 0, period) / period, "independent current RMS cycle integral"); close(r.P!, integral((t) => v(t) * i(t), 0, period) / period, "independent instantaneous power cycle average");
}
for (const omega of [0.5, 1, 2, 4, 7]) {
  const doc = holdout("ind.series_response", { V: 12, R: 4, L: 1, C: 1, omega, phase: 0, series: 1 }, `series-scan-${omega}`); if (!doc) continue;
  const r = certifiedOf(doc); close(r.Zreal! * r.Ireal! - r.Zimag! * r.Iimag!, 12, "complex KVL real"); close(r.Zimag! * r.Ireal! + r.Zreal! * r.Iimag!, 0, "complex KVL imaginary"); close(r.VR! ** 2 + (r.VL! - r.VC!) ** 2, 144, "component voltage triangle"); close(r.P!, 12 * r.I! * Math.cos(r.lag!), "average power with lead/lag");
  if (omega === 1) { close(r.I!, 3, "resonance maximum current"); close(r.VL!, r.VC!, "resonance component voltages cancel"); }
}
for (const pair of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
  const doc = holdout("ind.mutual_state", { L1: 2, L2: 8, k: 1, dot1: pair[0], dot2: pair[1], I10: 2, dI1: -3, I20: -1, dI2: 4, time: 0 }, `mutual-dot-${pair}`); if (!doc) continue;
  const r = certifiedOf(doc); close(r.M! ** 2, 16, "mutual passivity bound"); check(r.U! >= -1e-9, "coupled magnetic energy negative"); close(r.emf2!, pair[0] * pair[1] * 12, "mutual winding emf direction");
}
for (const dL of [-0.5, 0, 0.5]) for (const dI of [-2, 2]) {
  const doc = holdout("ind.self_state", { L0: 3, dL, I0: -1, dI, time: 0.6 }, `self-total-derivative-${dL}-${dI}`); if (!doc) continue;
  const r = certifiedOf(doc), linkage = (t: number) => (3 + dL * t) * (-1 + dI * t), h = 1e-5;
  close(r.emf!, -(linkage(0.6 + h) - linkage(0.6 - h)) / (2 * h), "independent total linkage derivative");
  close(r.U!, (3 + dL * 0.6) * (-1 + dI * 0.6) ** 2 / 2, "self stored magnetic energy");
}
for (const kind of ["rc", "lr"] as const) for (const initial of [-3, 0, 8]) {
  const time = 0.7, R = 2, storage = 0.5, V = 4;
  const inputs = kind === "rc" ? { R, C: storage, V, initialV: initial, time } : { R, L: storage, V, initialI: initial, time };
  const doc = holdout(`ind.${kind}_transient`, inputs, `${kind}-initial-${initial}`); if (!doc) continue;
  const r = certifiedOf(doc), tau = kind === "rc" ? 1 : 0.25, final = kind === "rc" ? 4 : 2;
  const state = (t: number) => final + (initial - final) * Math.exp(-t / tau), h = 1e-5, rate = (state(time + h) - state(time - h)) / (2 * h);
  close(r.state!, state(time), "independent switched initial-state solution");
  close(kind === "rc" ? R * r.current! + r.state! : R * r.current! + storage * rate, V, "transient KVL");
  if (kind === "rc") close(storage * rate, r.current!, "capacitor charge conservation");
}
for (const B of [-3, 3]) for (const omega of [-2, 2]) for (const winding of [-1, 1]) {
  const time = 0.4, theta0 = 0.3, doc = holdout("ind.generator_state", { N: 2, B, A: 4, omega, theta0, time, winding, closed: 1, R: 5 }, `generator-reversal-${B}-${omega}-${winding}`); if (!doc) continue;
  const r = certifiedOf(doc), linkage = (t: number) => 8 * winding * B * Math.cos(theta0 + omega * t), h = 1e-5;
  close(r.emf!, -(linkage(time + h) - linkage(time - h)) / (2 * h), "generator independent flux derivative");
  close(r.P!, r.emf! * r.I!, "generator electrical load power");
  const geometry = doc.source.generator as { axisWorld: number[]; areaNormalWorld: number[]; fieldWorld: number[] };
  close(geometry.axisWorld[0]!, 1, "generator shaft world axis");
  close(geometry.areaNormalWorld.reduce((sum, value, i) => sum + value * geometry.fieldWorld[i]!, 0) * 8 * winding, r.phi!, "generator projected coil linkage");
  const terminals = doc.source.terminalTopology as { emfReference: { positive: string; negative: string } };
  check(terminals.emfReference.positive === (winding > 0 ? "A" : "B") && terminals.emfReference.negative === (winding > 0 ? "B" : "A"), "generator terminal identity lost winding convention");
}
for (const pair of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) for (const losses of [false, true]) {
  const doc = holdout("ind.transformer_load", { Np: 4, Ns: 2, Vp: 20, frequency: 50, dotP: pair[0], dotS: pair[1], load: 5, ...(losses ? { coreLoss: 2, copperLoss: 3 } : {}) }, `transformer-polarity-${pair}-${losses}`); if (!doc) continue;
  const r = certifiedOf(doc); close(r.Vs!, pair[0] * pair[1] * 10, "transformer signed turns ratio"); close(r.Pout!, 20, "transformer load power"); close(r.Pin! - r.Pout!, losses ? 5 : 0, "transformer independent source loss budget"); close(20 * r.Ip!, r.Pin!, "transformer input active power");
  if (!losses) close(r.Ip! / r.Is!, 0.5, "transformer ideal current turns ratio");
}
const capacitor = holdout("ind.series_response", { V: 12, R: 0, L: 0, C: 0.5, omega: 2, phase: 0, series: 1 }, "pure-capacitor-leading-wattless");
if (capacitor) matches(certifiedOf(capacitor), { XL: 0, XC: 1, Zreal: 0, Zimag: -1, Z: 1, Ireal: 0, Iimag: 12, I: 12, lag: -Math.PI / 2, P: 0, Q: -144, VR: 0, VL: 0, VC: 12 }, "pure C lead and complex power");
const zeroAmplitude = holdout("ind.sinusoid", { Vpeak: 0, Ipeak: 0, omega: 2, voltagePhase: 0.3, currentPhase: -0.4, time: 1 }, "zero-amplitude-sinusoids");
if (zeroAmplitude) {
  const r = certifiedOf(zeroAmplitude); close(r.P!, 0, "zero-amplitude cycle power"); close(r.v!, 0, "zero voltage"); close(r.i!, 0, "zero current");
  for (const name of ["v(t)", "i(t)"]) {
    const points = zeroAmplitude.constructions.find((item) => item.outputs.includes(name))!.inputs.points as number[][];
    check(points.every((point) => point[1] === points[0]![1]), `${name} fabricated a nonzero waveform for zero amplitude`);
  }
}
const shortCoilInputs = { mu0: 2, n: 3, A: 4, length: 5, geometryFactor: 0.7, muR: 3 };
const shortCoil = holdout("ind.self", shortCoilInputs, "short-coil-supplied-factor");
if (shortCoil) close(certifiedOf(shortCoil).L!, 756, "source supplied short-coil factor");
const selfAdmission = inductionAcAdmissions.find((item) => item.name === "ind.self")!;
const shortSource = sourceFixture(selfAdmission, shortCoilInputs, { L: 756 }), shortIR = validateProblemIR(shortSource.raw, shortSource.question);
check(shortIR.valid && Boolean(synthesizeFamilyScene({ question: shortSource.question, problemIR: shortIR.problem })), "source supplied geometry factor and linear core must admit");
const missingFactorPremise = structuredClone(shortSource.raw); missingFactorPremise.facts = missingFactorPremise.facts.filter((fact) => fact.statement !== "source supplied geometry factor");
check(!validateProblemIR(missingFactorPremise, shortSource.question).valid, "missing short-coil factor premise admitted");
const transformerAdmission = inductionAcAdmissions.find((item) => item.name === "ind.transformer_load")!;
for (const losses of [false, true]) {
  const inputs = { Np: 4, Ns: 2, Vp: 20, frequency: 50, dotP: 1, dotS: 1, load: 5, ...(losses ? { coreLoss: 2, copperLoss: 3 } : {}) };
  const source = sourceFixture(transformerAdmission, inputs, { Vs: 10 }), omitted = structuredClone(source.raw);
  omitted.facts = omitted.facts.filter((fact) => fact.statement !== (losses ? "source stated loss budget" : "lossless transformer"));
  check(!validateProblemIR(omitted, source.question).valid, `transformer admitted without ${losses ? "source loss budget" : "lossless"} premise`);
}
for (const [name, inputs] of [
  ["ind.series_response", { V: 10, R: 0, L: 1, C: 1, omega: 1, phase: 0, series: 1 }],
  ["ind.series_response", { V: 10, R: 0, L: 1, C: 1, omega: 2, phase: 0, series: 1, scanMin: 0.7, scanMax: 1.4, scanCount: 17 }],
  ["ind.flux_loop", { B0: 1, dB: 0, ddB: 0, A0: 2, dA: 0, theta0: 0, omega: 0, N: 1, winding: 1, time: 0, closed: 0, R: 1 }],
  ["ind.generator_state", { N: 2, B: 3, A: 4, omega: 1, theta0: 0, time: 0, winding: 1, closed: 1 }],
  ["ind.transformer_load", { Np: 10, Ns: 2, Vp: 100, frequency: 50, dotP: 1, dotS: 1, load: 4, coreLoss: 5 }],
  ["ind.motional_circuit", { B: 2, l: 3, vx: 4, rodAngle: 0, closed: 0 }],
] as Array<[string, Record<string, number>]>) check(consumePhysicalModel(name, inputs).status === "rejected", `${name} accepted invalid optional/source group`);
for (const item of cases) {
  check(consumePhysicalModel(item.modelName, { ...item.ordinary, unrelatedInput: 1 }).status === "rejected", `${item.modelName} admitted unknown key`);
  const omitted = { ...item.ordinary }; delete omitted[Object.keys(inductionAcAdmissions.find((a) => a.name === item.modelName)!.roles)[0]!];
  check(consumePhysicalModel(item.modelName, omitted).status === "rejected", `${item.modelName} omitted required source input accepted`);
  const result = consumePhysicalModel(item.modelName, item.ordinary); if (result.status !== "scene") continue;
  const missing = structuredClone(result.document), required = missing.requiredEntityIds.find((id) => !id.endsWith("_anchor"))!;
  // Constructors may legitimately restore a redundant entity declaration;
  // remove its geometric producer to test an actually missing required mark.
  missing.constructions = missing.constructions.filter((construction) => !construction.outputs.includes(required));
  const validated = validateSceneDocument(missing), compiled = validated.document ? compileSceneDocument(validated.document) : null;
  check(!compiled?.renderScene, `${item.modelName} omitted required entity rendered partial ink`);
}

if (failures.length > 0) {
  throw new Error(`agent7 induction verification failed\n${failures.slice(0, 30).join("\n")}`);
}
const renderDir = process.env.EM_INDUCTION_RENDER_DIR;
if (renderDir) {
  mkdirSync(renderDir, { recursive: true });
  for (const [i, frame] of frames.entries()) writeFileSync(resolve(renderDir, `${String(i).padStart(3, "0")}-${frame.name.replace(/[^a-zA-Z0-9._-]/g, "-")}.svg`), renderSceneSvg(frame.scene, { title: frame.name, subtitle: "EMI/AC | offline compiled source frame | 1200x700", guides: true }));
  writeFileSync(resolve(renderDir, "manifest.json"), JSON.stringify({ board: [1200, 700], checks, modelCount: cases.length, topicCount: inductionTopics.length, frames: frames.map((frame, i) => ({ index: i, name: frame.name })) }, null, 2));
}
console.log(`agent7 induction verification passed (${cases.length} models, 14 frozen topics; ${checks} assertions; ${frames.length} full frames; source/solver/mutation gate included; acceptance pending)`);
