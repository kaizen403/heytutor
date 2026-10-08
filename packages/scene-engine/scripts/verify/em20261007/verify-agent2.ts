import { compileSceneDocument } from "../../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../../src/document/validation";
import { consumePhysicalModel, explicitPhysicalModelScene, standardCases } from "../../../src/physics/em20261007/consume";
import { demandRejection, sceneDemand } from "../../../src/synthesize/sceneDemand";
import { deriveVisualObligations, visualObligationRejection } from "../../../src/synthesize/visualObligations";
import { modelAdmission } from "../../../src/physics/em20261007/admission";
import { validateProblemIR } from "../../../src/ir/problemIR";
import { synthesizeFamilyScene } from "../../../src/synthesize/familyScene";
import { LocalDeterministicSolverProvider } from "../../../src/ir/solver";
import { renderSceneSvg } from "../../lib/renderSceneSvg";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RenderScene, SceneDocument } from "../../../src/types";

const consumed = consumePhysicalModel("dc.wheatstone", { emf: 12, r: 1, P: 2, Q: 4, Rg: 5 });
if (consumed.status !== "scene") throw new Error(`wheatstone ${consumed.status}`);
const branches = consumed.document.constructions.flatMap((construction) => {
  const value = construction.inputs.branches;
  return Array.isArray(value) ? value : [];
});
const detector = branches.find((branch) => branch && typeof branch === "object" && "id" in branch && branch.id === "G");
if (!detector || !("kind" in detector) || detector.kind !== "detector") {
  throw new Error("Wheatstone G branch must be a detector, not a wire");
}
const validated = validateSceneDocument(consumed.document);
const compiled = validated.document ? compileSceneDocument(validated.document) : null;
if (!compiled?.ok || !compiled.renderScene) throw new Error("wheatstone did not compile");
const ring = compiled.renderScene.primitives.some((primitive) => primitive.entityId === "G" && primitive.points.length >= 12);
if (!ring) throw new Error("Wheatstone detector ring is missing");
const plates = compiled.renderScene.primitives.filter((primitive) => primitive.entityId === "S" && primitive.kind === "polyline" && primitive.points.length === 2);
const vertical = plates.filter((primitive) => Math.abs(primitive.points[0]!.x - primitive.points[1]!.x) < 2);
const horizontal = plates.filter((primitive) => Math.abs(primitive.points[0]!.y - primitive.points[1]!.y) < 2);
const longPlate = vertical.reduce((best, plate) => {
  const span = Math.abs(plate.points[0]!.y - plate.points[1]!.y);
  return span > best.span ? { span, x: (plate.points[0]!.x + plate.points[1]!.x) / 2 } : best;
}, { span: 0, x: NaN });
const xs = horizontal.flatMap((lead) => lead.points.map((point) => point.x));
const mid = xs.length > 0 ? (Math.min(...xs) + Math.max(...xs)) / 2 : NaN;
if (!(longPlate.x > mid)) throw new Error(`long plate x=${longPlate.x} is not toward the higher-potential terminal mid=${mid}`);
const labels = compiled.renderScene.primitives.filter((primitive) => primitive.kind === "label").map((primitive) => primitive.text);
for (const text of ["P", "Q", "Rg", "12 V, r"]) {
  if (!labels.includes(text)) throw new Error(`wheatstone label ${text} is missing; got ${labels.join(", ")}`);
}
if (labels.some((text) => text === "WL" || text === "LT" || text === "S")) throw new Error("wheatstone still shows internal branch ids");
console.log("agent2 wheatstone detector, labels, and source polarity passed");

// Public consume/model seam: the four arms are independent source values.
// This hand-worked nodal example has VR=10, VT=5, VB=4 when E=11.8.
const unbalanced = consumePhysicalModel("dc.wheatstone_declared", { emf: 11.8, r: 1, P: 5, Q: 25 / 6, R: 5, S: 10, Rg: 5 });
if (unbalanced.status !== "scene") throw new Error("source-declared unbalanced Wheatstone must emit a scene");
const certified = unbalanced.document.source.certified as Record<string, number>;
if (Math.abs(certified.I_G - 0.2) > 1e-9) throw new Error(`unbalanced detector must carry 0.2 A, got ${certified.I_G}`);
const parallelCells = consumePhysicalModel("dc.cells_parallel", { e1: 10, r1: 2, e2: 4, r2: 1, R: 2 });
if (parallelCells.status !== "scene") throw new Error("unequal parallel cells must be supported");
const parallelValues = parallelCells.document.source.certified as Record<string, number>;
if (Math.abs(parallelValues.V - 4.5) > 1e-9 || Math.abs(parallelValues.I_S2 + 0.5) > 1e-9 || Math.abs(parallelValues.P_source2 + 2) > 1e-9) throw new Error("weak parallel cell must charge with -0.5 A and -2 W supplied power");
const correctedMetre = consumePhysicalModel("dc.metre_bridge_observed", { known: 2, balance: 25, wire: 100, cLeft: 5, cRight: 5, knownLeft: 1, area: 0.03, sampleLength: 5 });
if (correctedMetre.status !== "scene") throw new Error("source-declared metre bridge end corrections must be supported");
const metreValues = correctedMetre.document.source.certified as Record<string, number>;
if (Math.abs(metreValues.unknown - 16 / 3) > 1e-9 || Math.abs(metreValues.rho - 0.032) > 1e-9) throw new Error("corrected metre bridge resistance and resistivity are wrong");
const loadedPot = consumePhysicalModel("dc.potentiometer_loaded", { driver: 4, wire: 100, lOpen: 50, lLoaded: 40, load: 8 });
if (loadedPot.status !== "scene") throw new Error("loaded potentiometer internal resistance must be supported");
const potValues = loadedPot.document.source.certified as Record<string, number>;
if (Math.abs(potValues.r - 2) > 1e-9 || Math.abs(potValues.E - 2) > 1e-9 || Math.abs(potValues.V - 1.6) > 1e-9) throw new Error("loaded potentiometer r=2 ohm, E=2 V, V=1.6 V are required");
const comparisonPot = consumePhysicalModel("dc.potentiometer_comparison", { driver: 4, wire: 100, l1: 25, l2: 60 });
if (comparisonPot.status !== "scene" || Math.abs((comparisonPot.document.source.certified as Record<string, number>).ratio - 5 / 12) > 1e-9) throw new Error("same-gradient comparison must certify E1/E2=5/12");
const ideal = consumePhysicalModel("dc.ohm", { emf: 12, rInternal: 0, R: 6 });
const short = consumePhysicalModel("dc.ohm", { emf: 12, rInternal: 2, R: 0 });
const open = consumePhysicalModel("dc.ohm_open", { emf: 12, rInternal: 0 });
if (ideal.status !== "scene" || short.status !== "scene" || open.status !== "scene") throw new Error("required ideal/short/open resistor variants remain unsupported");
if ((ideal.document.source.certified as Record<string, number>).I_R !== 2 || (short.document.source.certified as Record<string, number>).I_R !== 6 || (open.document.source.certified as Record<string, number>).I_R !== 0) throw new Error("ideal/short/open circuit authority is wrong");
const twoLoops = consumePhysicalModel("dc.kirchhoff_declared", { e1: 12, e2: -6, r1: 2, r2: 3, Rm: 4, Ra: 6 });
if (twoLoops.status !== "scene") throw new Error("two declared loops with arbitrary positive resistances and reversed source polarity must be supported");

const rendered: Array<{ name: string; sample: number; scene: RenderScene }> = [];
const solver = new LocalDeterministicSolverProvider();
function checkNetworkEquations(document: SceneDocument): void {
  const construction = document.constructions.find((item) => item.operator === "kirchhoff_network");
  if (!construction) return;
  const nodes = construction.inputs.nodes as Array<{ id: string; at: [number, number] }>;
  const branches = construction.inputs.branches as Array<{ id: string; from: string; to: string; resistance?: number; emf?: number; kind: string }>;
  const currents = document.source.certified as Record<string, number>;
  const potentials = new Map<string, number>([[nodes[0]!.id, 0]]);
  for (const node of nodes) {
    const residual = branches.reduce((sum, branch) => sum + (branch.from === node.id ? currents[`I_${branch.id}`]! : 0) - (branch.to === node.id ? currents[`I_${branch.id}`]! : 0), 0);
    if (Math.abs(residual) > 1e-8) throw new Error(`independent KCL residual ${node.id}=${residual}`);
  }
  // Reconstruct node potentials along a spanning tree; every other branch
  // closes an independent cycle. Open branches impose no voltage constraint.
  for (let pass = 0; pass < nodes.length; pass += 1) for (const branch of branches) {
    if (branch.kind === "open") continue;
    const drop = currents[`I_${branch.id}`]! * (branch.resistance ?? 0) - (branch.emf ?? 0);
    if (potentials.has(branch.from) && !potentials.has(branch.to)) potentials.set(branch.to, potentials.get(branch.from)! - drop);
    else if (potentials.has(branch.to) && !potentials.has(branch.from)) potentials.set(branch.from, potentials.get(branch.to)! + drop);
    else if (potentials.has(branch.from) && potentials.has(branch.to) && Math.abs(potentials.get(branch.from)! - potentials.get(branch.to)! - drop) > 1e-8) throw new Error(`independent KVL residual on ${branch.id}`);
  }
}

for (const item of standardCases().filter((item) => item.modelName.startsWith("dc."))) {
  const admission = modelAdmission(item.modelName);
  if (!admission) throw new Error(`${item.modelName} lacks source admission`);
  for (const [sample, inputs] of [item.ordinary, item.altered].entries()) {
    const result = consumePhysicalModel(item.modelName, inputs);
    if (result.status !== "scene") throw new Error(`${item.modelName} declared inputs must emit: ${result.status === "rejected" ? result.reason : result.status}`);
    const validated = validateSceneDocument(result.document);
    const compiled = validated.document ? compileSceneDocument(validated.document) : null;
    if (!compiled?.ok || !compiled.renderScene) throw new Error(`${item.modelName} must compile atomically: ${JSON.stringify(validated.report.issues)} ${JSON.stringify(compiled?.report.issues)}`);
    checkNetworkEquations(result.document);
    rendered.push({ name: item.modelName, sample, scene: compiled.renderScene });
    const quantities = result.document.source.certified as Record<string, number>;
    if (item.modelName.startsWith("dc.cells_") && Math.abs(quantities.P_source1 + quantities.P_source2 - quantities.P_internal1 - quantities.P_internal2 - quantities.P_load) > 1e-8) throw new Error("signed source/dissipation total does not balance");
    const rotated = structuredClone(result.document);
    for (const construction of rotated.constructions) if (construction.operator === "kirchhoff_network") {
      const nodes = construction.inputs.nodes as Array<{ at: [number, number] }>;
      for (const node of nodes) node.at = [-node.at[1], node.at[0]];
    }
    const rotatedValidated = validateSceneDocument(rotated);
    const rotatedCompiled = rotatedValidated.document ? compileSceneDocument(rotatedValidated.document) : null;
    if (!rotatedCompiled?.ok) throw new Error(`${item.modelName} orientation changes the certified topology: ${JSON.stringify(rotatedValidated.report.issues)} ${JSON.stringify(rotatedCompiled?.report.issues)}`);
  }
  for (const invalid of [...item.rejections, { ...item.ordinary, undeclared: 1 }]) if (consumePhysicalModel(item.modelName, invalid).status !== "rejected") throw new Error(`${item.modelName} invalid input accepted`);
  const quotes = Object.entries(admission.roles).map(([key, role]) => ({ key, role, quote: `${role.role} ${item.ordinary[key]} ${role.unit}` }));
  const asked = "Show the declared circuit and find its stated result.";
  const question = `${admission.assumptions.join("; ")}. ${quotes.map((entry) => entry.quote).join("; ")}. ${asked}`;
  const evidence = (quote: string) => ({ source: "question", start: question.indexOf(quote), end: question.indexOf(quote) + quote.length, quote });
  const result = consumePhysicalModel(item.modelName, item.ordinary);
  if (result.status !== "scene") throw new Error("ordinary source vanished");
  const expected = result.document.source.certified as Record<string, number>;
  const symbol = Object.keys(expected)[0]!;
  const raw = { schemaVersion: "problem-ir/v1", id: "declaredCurrent", question,
    facts: [...quotes.map(({ key, role, quote }) => ({ id: key, kind: "given", statement: `The ${role.role} is stated in ${role.unit}.`, evidence: evidence(quote) })), ...admission.assumptions.map((phrase, index) => ({ id: `assume${index}`, kind: "assumption", statement: phrase, evidence: evidence(phrase) })), { id: "asked", kind: "requested", statement: asked, evidence: evidence(asked) }],
    entities: [], expressions: quotes.map(({ key }) => ({ id: key, valueType: "scalar", root: { kind: "number", value: item.ordinary[key] }, evidenceFactIds: [key] })), constraints: [], representationIntents: [],
    solveRequests: [{ id: "declared", kind: "explicit_physical_model", model: item.modelName, bindings: quotes.map(({ key, role }) => ({ key, ...role, expressionId: key, evidenceFactId: key })), evidenceFactIds: ["asked"], resultBinding: { turnPlanQuantityId: "result", symbol, unit: "1", evidenceFactIds: ["asked"] } }],
  };
  const admitted = validateProblemIR(raw, question);
  const scene = admitted.problem ? synthesizeFamilyScene({ question, problemIR: admitted.problem }) : null;
  if (!scene || scene.document.source.explicitPhysicalModel !== item.modelName) {
    const explicit = explicitPhysicalModelScene(question, admitted.problem);
    const v = explicit.document ? validateSceneDocument(pruneDeadSceneEntities(structuredClone(explicit.document) as unknown as Record<string, unknown>)) : null;
    const c = v?.document ? compileSceneDocument(v.document) : null;
    throw new Error(`${item.modelName} source declaration rejected: ${JSON.stringify(admitted.issues)} validation=${JSON.stringify(v?.report.issues)} compile=${JSON.stringify(c?.report.issues)} ok=${c?.ok} primitives=${c?.renderScene?.primitives.length} demand=${v?.document && demandRejection(v.document, sceneDemand(question, admitted.problem))} obligations=${v?.document && admitted.problem && visualObligationRejection(deriveVisualObligations(admitted.problem), v.document, admitted.problem)}`);
  }
  const solved = await solver.solve(admitted.problem!);
  if (solved.status !== "solved" || Math.abs((solved.values[0]?.approximate ?? NaN) - expected[symbol]!) > 1e-8) throw new Error(`${item.modelName} solver differs from the circuit equations`);
  for (const mutation of ["wrong-role", "missing-evidence", "wrong-family", "stale-value", "missing-assumption"]) {
    const changed = structuredClone(raw);
    if (mutation === "wrong-role") changed.solveRequests[0]!.bindings[0]!.role = "mass";
    if (mutation === "missing-evidence") changed.solveRequests[0]!.bindings.pop();
    if (mutation === "wrong-family") changed.solveRequests[0]!.model = "ce.drift";
    if (mutation === "stale-value") changed.expressions[0]!.root.value += 13;
    if (mutation === "missing-assumption") changed.facts = changed.facts.filter((fact) => fact.kind !== "assumption");
    if (validateProblemIR(changed, question).valid || synthesizeFamilyScene({ question, problemIR: changed })) throw new Error(`${item.modelName} accepted ${mutation}`);
  }
}

// Holdout changes arm ratios and reverses source; zero detector is permitted
// only at balance. KCL/KVL and source reversal give independent controls.
for (const arms of [{ P: 3, Q: 7, R: 6, S: 14 }, { P: 3, Q: 7, R: 6, S: 13 }]) {
  const a = consumePhysicalModel("dc.wheatstone_declared", { emf: 9, r: 2, ...arms, Rg: 4 });
  const b = consumePhysicalModel("dc.wheatstone_declared", { emf: -9, r: 2, ...arms, Rg: 4 });
  if (a.status !== "scene" || b.status !== "scene") throw new Error("bridge holdout unsupported");
  checkNetworkEquations(a.document); checkNetworkEquations(b.document);
  const ac = a.document.source.certified as Record<string, number>, bc = b.document.source.certified as Record<string, number>;
  if (Math.abs(ac.I_G + bc.I_G) > 1e-9 || (arms.S === 14 ? ac.I_G !== 0 : Math.abs(ac.I_G) < 1e-6)) throw new Error("bridge balance/source reversal control failed");
  const missing = structuredClone(a.document);
  (missing.constructions[0]!.inputs.branches as unknown[]).pop();
  const v = validateSceneDocument(missing), c = v.document ? compileSceneDocument(v.document) : null;
  if (c?.ok || c?.renderScene) throw new Error("omitted bridge branch rendered partial ink");
}
for (const emfs of [{ e1: 10, e2: 4 }, { e1: 10, e2: 10 }]) if (consumePhysicalModel("dc.cells_parallel", { ...emfs, r1: 0, r2: 0, R: 2 }).status !== "rejected") throw new Error("ideal parallel source inconsistency/ambiguity accepted");
const renderDir = process.env.EM_CURRENT_RENDER_DIR;
if (renderDir) { mkdirSync(renderDir, { recursive: true }); for (const item of rendered) writeFileSync(resolve(renderDir, `${item.name}-${item.sample}.svg`), renderSceneSvg(item.scene, { title: `${item.name} ${item.sample}`, subtitle: "1200×700 offline compiled frame; source values separate from display scale" })); }
console.log(`agent2 source, signed KCL/KVL, power, ideal/short/open, bridge controls, orientation, invalid/evidence, and holdout gates passed (${rendered.length} frames)`);
