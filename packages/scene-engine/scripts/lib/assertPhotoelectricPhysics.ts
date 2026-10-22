import assert from "node:assert/strict";
import type { SceneDocument } from "../../src/types";

/** Check the physics producer against independent energy golds. Rounded
 * label-only golds retain their original 0.005 eV interval; exact golds retain
 * persisted six-decimal equality. Geometry must always match actual values. */
export function assertPhysicsEnergy(document: SceneDocument, labels: readonly string[], phi: number, energy: number, kinetic: number | null = energy - phi, roundedGold = false): void {
  assert.equal(document.source.archetype, "photoelectric", "actual physics producer");
  assert.equal(document.source.chemistryFamily, undefined, "physics does not re-enter chemistry");
  const actual = new Map<string, number>();
  for (const [symbol, value, level, printedSymbol] of [["phi", phi, "make_phi_top", "φ"], ["E", energy, "make_E_top", "hν"]] as const) {
    const quantity = document.quantities.find(item => item.symbol === symbol && item.unit === "eV");
    assert.ok(quantity && typeof quantity.value === "number" && Number.isFinite(quantity.value), `${symbol}: numeric source quantity`);
    if (roundedGold) assert.ok(Math.abs(quantity.value - value) <= 0.005, `${symbol}: original label precision`);
    else assert.equal(quantity.value, Number(value.toFixed(6)), `${symbol}: original scientific quantity at persisted precision`);
    actual.set(symbol, quantity.value);
    assert.equal(document.constructions.find(construction => construction.id === level)?.inputs.y,
      Number(quantity.value.toFixed(4)), `${symbol}: actual drawn level`);
    const printed = labels.map(label => new RegExp(`^${printedSymbol}=([+\\-]?[0-9]+(?:\\.[0-9]+)?) eV$`).exec(label)).find(Boolean);
    assert.ok(printed && Math.abs(Number(printed[1]) - value) <= 0.005, `${symbol}: original physical value stays visible`);
  }
  if (kinetic === null) {
    assert.ok(labels.includes("no emission"));
    assert.ok(!document.entities.some(entity => entity.id === "kinetic"));
    return;
  }
  const printedK = labels.map(label => /^K=([+-]?[0-9]+(?:\.[0-9]+)?) eV$/.exec(label)).find(Boolean);
  assert.ok(printedK && Math.abs(Number(printedK[1]) - kinetic) <= 0.005, "K: original physical result stays visible");
  if (kinetic > 0) {
    assert.equal(document.constructions.find(construction => construction.id === "make_k_base")?.inputs.y, Number(actual.get("phi")!.toFixed(4)));
    assert.equal(document.constructions.find(construction => construction.id === "make_k_tip")?.inputs.y, Number(actual.get("E")!.toFixed(4)));
  }
}
