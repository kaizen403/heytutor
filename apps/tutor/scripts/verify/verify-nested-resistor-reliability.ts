/** Authored circuits only: live quantity authority -> selection -> canonical save. */
import assert from "node:assert/strict";
import { applySourceQuantityAuthority, compileSceneDocument, solveStatedResistorCircuit, validateTurnPlanV3, type SceneDocument } from "@heytutor/scene-engine";
import { readResistorTree, formatResistorTree } from "../../../../packages/scene-engine/src/archetypes/resistorTree";
import { selectProductionScene } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";

/** Independent floating-point nodal solve of emitted symbols/wires, not parsed tree. */
function solveFigure(document: SceneDocument, voltage: number) {
  const parent = new Map<string, string>();
  const root = (id: string): string => {
    const next = parent.get(id);
    if (!next) { parent.set(id, id); return id; }
    if (next === id) return id;
    const result = root(next); parent.set(id, result); return result;
  };
  for (const c of document.constructions.filter((c) => c.operator === "connect")) parent.set(root(String(c.inputs.start)), root(String(c.inputs.end)));
  const symbols = document.constructions.filter((c) => c.operator === "symbol");
  const source = symbols.find((c) => c.inputs.symbol === "battery");
  assert(source, "source is actually drawn");
  assert.equal(document.entities.find((e) => e.id === source.outputs[0])?.label, `${voltage} V`, "drawn source label matches the oracle voltage");
  const positive = root(String(source.inputs.start));
  const negative = root(String(source.inputs.end));
  assert.notEqual(positive, negative, "battery is not shorted");
  const resistors = symbols.filter((c) => c.inputs.symbol === "resistor").map((c) => {
    const entity = document.entities.find((e) => e.id === c.outputs[0]);
    const value = Number(/=([\d.]+)Ω/.exec(entity?.label ?? "")?.[1]);
    assert(value > 0, "resistance comes from the displayed label");
    return { id: c.outputs[0]!, from: root(String(c.inputs.start)), to: root(String(c.inputs.end)), value };
  });
  const free = [...new Set(resistors.flatMap((r) => [r.from, r.to]))].filter((n) => n !== positive && n !== negative);
  const rows = free.map(() => Array<number>(free.length + 1).fill(0));
  for (const r of resistors) {
    assert.notEqual(r.from, r.to, `${r.id} is not shorted`);
    for (const [a, b] of [[r.from, r.to], [r.to, r.from]]) {
      const row = free.indexOf(a!); if (row < 0) continue;
      rows[row]![row]! += 1 / r.value;
      const column = free.indexOf(b!);
      if (column >= 0) rows[row]![column]! -= 1 / r.value;
      else if (b === positive) rows[row]![free.length]! += voltage / r.value;
    }
  }
  for (let i = 0; i < free.length; i++) {
    const pivot = rows.findIndex((row, j) => j >= i && Math.abs(row[i]!) > 1e-12);
    assert(pivot >= 0, "every drawn branch has a determined voltage");
    [rows[i], rows[pivot]] = [rows[pivot]!, rows[i]!];
    const scale = rows[i]![i]!; rows[i] = rows[i]!.map((v) => v / scale);
    for (let j = 0; j < free.length; j++) if (j !== i) {
      const factor = rows[j]![i]!; rows[j] = rows[j]!.map((v, k) => v - factor * rows[i]![k]!);
    }
  }
  const potentials = new Map([[positive, voltage], [negative, 0], ...free.map((id, i): [string, number] => [id, rows[i]![free.length]!])]);
  const currents = resistors.map((r) => ({ id: r.id, value: (potentials.get(r.from)! - potentials.get(r.to)!) / r.value }));
  const total = resistors.reduce((sum, r, i) => sum + (r.from === positive ? currents[i]!.value : r.to === positive ? -currents[i]!.value : 0), 0);
  return { equivalent: voltage / total, total, currents };
}
const near = (actual: number, expected: number, label: string) => assert(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);
const policy = { preferPlanner: true, allowVerifiedSourceRecovery: true, allowedFigureSources: ["planner", "verified_recovery", "text_only"] as const };
async function main() {
  for (const [series, first, second, other, voltage, reverse] of [[2, 6, 3, 18, 18, false], [4, 5, 7, 6, 24, false], [3, 8, 4, 6, 14, true]] as const) {
    const branch = first + second;
    const parallel = branch * other / (branch + other);
    const equivalent = series + parallel;
    const total = voltage / equivalent;
    const branchVoltage = total * parallel;
    const question = reverse
      ? `A ${series} ohm resistor is in series with a parallel combination of a ${other} ohm resistor and a series combination of ${first} ohm and ${second} ohm resistors across a ${voltage} V battery. Find equivalent resistance, total current and each branch current.`
      : `A ${series} ohm resistor is in series with a parallel combination of a series combination of ${first} ohm and ${second} ohm resistors and a ${other} ohm resistor across a ${voltage} V battery. Find equivalent resistance, total current and each branch current.`;
    const values = reverse ? [series, other, first, second] : [series, first, second, other];
    const expectedCurrents = reverse ? [total, branchVoltage / other, branchVoltage / branch, branchVoltage / branch] : [total, branchVoltage / branch, branchVoltage / branch, branchVoltage / other];
    const checked = validateTurnPlanV3({ schemaVersion: "turn-plan/v3", question,
      givens: [...values.map((value, i) => ({ id: `R${i + 1}`, symbol: `R${i + 1}`, value, unit: "Ω", provenance: "given" })), { id: "V", symbol: "V", value: voltage, unit: "V", provenance: "given" }],
      derived: [{ id: "Req", symbol: "R_eq", value: equivalent, unit: "Ω", provenance: "derived" },
        { id: "Itotal", symbol: "I_total", value: total, unit: "A", provenance: "derived" },
        ...expectedCurrents.map((value, i) => ({ id: `I${i + 1}`, symbol: `I${i + 1}`, value, unit: "A", provenance: "derived" }))],
      unknowns: [], qualitativeClaims: [], lawIds: ["ohms-law"], assumptions: [], visualRequirement: "required" }, question);
    assert(checked.valid && checked.plan, JSON.stringify(checked.issues));
    const authoritative = applySourceQuantityAuthority(checked.plan, null, question);
    assert.equal(authoritative.outcomes.length, 1, "actual source authority recognizes the nested network");
    assert.equal(authoritative.outcomes[0]!.corrections.length, 0, "independent authored quantities already agree");
    const selected = selectProductionScene({ question, turnPlan: authoritative.plan, problemIR: null, policy });
    assert.equal(selected.visualStatus, "validated", selected.reason);
    assert(selected.representation);
    const { sceneDocument, renderScene, tier, nonMetric } = selected.representation;
    assert(compileSceneDocument(sceneDocument).ok);
    assert.equal(formatResistorTree(readResistorTree(question)!), reverse ? "S(0,P(1,S(2,3)))" : "S(0,P(S(1,2),3))");
    const figure = solveFigure(sceneDocument, voltage);
    near(figure.equivalent, equivalent, "drawn equivalent resistance"); near(figure.total, total, "drawn total current");
    figure.currents.forEach((r, i) => near(r.value, expectedCurrents[i]!, `drawn ${r.id} current`));
    assert.equal(figure.currents.length, 4, "every stated resistor is present exactly once");
    for (const primitive of renderScene.primitives) for (const p of primitive.points) assert(p.x >= 400 && p.x <= 1160 && p.y >= 0 && p.y <= 700, "inside diagram zone");
    const saved = await canonicalizeTurnSceneMetadata({ question, sceneDocument, visualStatus: "validated", sceneArtifacts: {
      schemaVersion: "scene-artifacts/v3", turnPlan: authoritative.plan, representationTier: tier, nonMetric, diagramResultStatus: "ready" }, segments: [] });
    assert(saved.ok, saved.ok ? "saved" : saved.error);
  }
  for (const question of [
    "A parallel combination of a series combination of 2 ohm and 3 ohm and 6 ohm and 9 ohm resistors across 12 V.",
    "A 2 ohm resistor in series with a 3 ohm resistor in parallel with a 6 ohm resistor across 12 V.",
    "A 2 ohm resistor in parallel with 3 ohm and 6 ohm in series across 12 V.",
    "A parallel combination of a series combination of 2 ohm and 3 ohm resistors in parallel and 6 ohm across 12 V.",
    `A ${"series combination of a ".repeat(500)}2 ohm and 3 ohm and 6 ohm and 9 ohm resistors across 12 V.`,
    "A parallel combination of a series combination of 1 ohm and 2 ohm and 3 ohm and 4 ohm and 5 ohm resistors across 12 V.",
  ]) {
    assert.equal(readResistorTree(question), null, "ambiguous, contradictory, excessive depth or size cannot produce a guessed tree");
    assert.equal(solveStatedResistorCircuit(question), null, "declined grouping cannot gain figure-backed numeric authority");
  }
  console.log("nested resistor reliability: 3 source-authority/production-selection/save cases, independent drawn-netlist oracle, 6 safety negatives PASS");
}
void main();
