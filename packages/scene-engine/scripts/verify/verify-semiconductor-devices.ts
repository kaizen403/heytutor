import assert from "node:assert/strict";
import { DEVICE_SPECS, assertDevice, bjtGlyph, opampGlyph, twoTerminalGlyph, type DeviceInstance } from "../../src/devices/devices";

let checks = 0;
const ok = (cond: unknown, msg: string) => { checks += 1; assert.ok(cond, msg); };

for (const spec of Object.values(DEVICE_SPECS)) {
  ok(spec.terminals.length >= 2, `${spec.kind} names its terminals`);
  ok(new Set(spec.terminals.map((t) => t.name)).size === spec.terminals.length, `${spec.kind} terminal names are unique`);
}
const wired = (nodes: Record<string, string>): DeviceInstance["wiredNodes"] => new Set(Object.values(nodes));
const bjtNodes = { base: "nb", collector: "nc", emitter: "ne" };
ok(assertDevice({ kind: "bjt_npn", terminalNodes: bjtNodes, wiredNodes: wired(bjtNodes), emitterArrow: "out" }).length === 0, "a wired NPN with the arrow out passes");
ok(assertDevice({ kind: "bjt_pnp", terminalNodes: bjtNodes, wiredNodes: wired(bjtNodes), emitterArrow: "in" }).length === 0, "a wired PNP with the arrow in passes");
ok(assertDevice({ kind: "bjt_npn", terminalNodes: bjtNodes, wiredNodes: wired(bjtNodes), emitterArrow: "in" }).some((i) => i.code === "polarity_reversed"), "an NPN with the arrow in is refused");
ok(assertDevice({ kind: "bjt_npn", terminalNodes: { ...bjtNodes, emitter: null }, wiredNodes: wired(bjtNodes), emitterArrow: "out" }).some((i) => i.code === "terminal_unwired"), "an unwired emitter is refused");
ok(assertDevice({ kind: "bjt_npn", terminalNodes: { base: "nb", collector: "nc", emitter: "nc" }, wiredNodes: new Set(["nb", "nc"]), emitterArrow: "out" }).some((i) => i.code === "terminals_shorted"), "collector tied to emitter is refused");
ok(assertDevice({ kind: "bjt_npn", terminalNodes: bjtNodes, wiredNodes: new Set(["nb", "nc"]), emitterArrow: "out" }).some((i) => i.code === "terminal_unwired"), "a terminal on an unwired node is refused");
const diodeNodes = { anode: "na", cathode: "nk" };
ok(assertDevice({ kind: "diode", terminalNodes: diodeNodes, wiredNodes: wired(diodeNodes), forwardFrom: "anode" }).length === 0, "a wired diode passes");
ok(assertDevice({ kind: "diode", terminalNodes: diodeNodes, wiredNodes: wired(diodeNodes), forwardFrom: "cathode" }).some((i) => i.code === "polarity_reversed"), "a reversed diode is refused");
ok(assertDevice({ kind: "zener", terminalNodes: diodeNodes, wiredNodes: wired(diodeNodes), forwardFrom: "anode" }).length === 0, "a wired zener passes");
const opNodes = { inverting: "ni", noninverting: "nn", output: "no", supply_positive: "nvp", supply_negative: "nvn" };
ok(assertDevice({ kind: "opamp", terminalNodes: opNodes, wiredNodes: wired(opNodes) }).length === 0, "a wired op amp passes");
ok(assertDevice({ kind: "opamp", terminalNodes: { ...opNodes, output: "ni" }, wiredNodes: wired(opNodes) }).some((i) => i.code === "terminals_shorted"), "an op amp output tied to its input is refused");
const capNodes = { positive: "np", negative: "nn2" };
ok(assertDevice({ kind: "capacitor_polarised", terminalNodes: capNodes, wiredNodes: wired(capNodes) }).length === 0, "a wired polarised capacitor passes");
ok(assertDevice({ kind: "capacitor", terminalNodes: { plate_a: "n1", plate_b: "n1" }, wiredNodes: new Set(["n1"]) }).some((i) => i.code === "terminals_shorted"), "shorted capacitor plates are refused");

const finite = (paths: { x: number; y: number }[][]) => paths.length > 0 && paths.every((p) => p.length >= 2 && p.every((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y)));
ok(finite(twoTerminalGlyph("diode", { x: 0, y: 0 }, { x: 4, y: 0 })), "diode glyph is finite ink");
ok(finite(twoTerminalGlyph("zener", { x: 0, y: 0 }, { x: 0, y: 4 })), "zener glyph is finite ink when vertical");
ok(finite(twoTerminalGlyph("capacitor_polarised", { x: 1, y: 1 }, { x: 5, y: 3 })), "capacitor glyph is finite ink when diagonal");
ok(finite(bjtGlyph("bjt_npn", { x: 0, y: 2 }, { x: 4, y: 4 }, { x: 4, y: 0 })), "BJT glyph is finite ink");
ok(finite(opampGlyph({ x: 0, y: 3 }, { x: 0, y: 1 }, { x: 5, y: 2 })), "op amp glyph is finite ink");
const diodePaths = twoTerminalGlyph("diode", { x: 0, y: 0 }, { x: 4, y: 0 });
ok(diodePaths[0]![0]!.x === 0 && diodePaths.at(-1)!.at(-1)!.x === 4, "diode leads reach both terminals, nothing bridges past them");

console.log(`semiconductor devices verification passed (${checks} checks)`);
