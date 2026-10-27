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
ok(assertDevice({ kind: "opamp", terminalNodes: { ...opNodes, output: "nn" }, wiredNodes: wired(opNodes) }).some((i) => i.code === "terminals_shorted"), "an op amp output tied to its noninverting input is refused");
const capNodes = { positive: "np", negative: "nn2" };
ok(assertDevice({ kind: "capacitor_polarised", terminalNodes: capNodes, wiredNodes: wired(capNodes) }).length === 0, "a wired polarised capacitor passes");
ok(assertDevice({ kind: "capacitor", terminalNodes: { plate_a: "n1", plate_b: "n1" }, wiredNodes: new Set(["n1"]) }).some((i) => i.code === "terminals_shorted"), "shorted capacitor plates are refused");

const finite = (paths: { x: number; y: number }[][]) => paths.length > 0 && paths.every((p) => p.length >= 2 && p.every((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y)));
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
ok(finite(twoTerminalGlyph("diode", { x: 0, y: 0 }, { x: 4, y: 0 })), "diode glyph is finite ink");
ok(finite(twoTerminalGlyph("zener", { x: 0, y: 0 }, { x: 0, y: 4 })), "zener glyph is finite ink when vertical");
ok(finite(twoTerminalGlyph("capacitor_polarised", { x: 1, y: 1 }, { x: 5, y: 3 })), "capacitor glyph is finite ink when diagonal");
ok(finite(bjtGlyph("bjt_npn", { x: 0, y: 2 }, { x: 4, y: 4 }, { x: 4, y: 0 })), "BJT glyph is finite ink");
ok(finite(opampGlyph({ x: 0, y: 3 }, { x: 0, y: 1 }, { x: 5, y: 2 })), "op amp glyph is finite ink");
const diodePaths = twoTerminalGlyph("diode", { x: 0, y: 0 }, { x: 4, y: 0 });
ok(diodePaths[0]![0]!.x === 0 && diodePaths.at(-1)!.at(-1)!.x === 4, "diode leads reach both terminals, nothing bridges past them");
const bjtBase = { x: 0, y: 2 }, bjtC = { x: 4, y: 4 }, bjtE = { x: 4, y: 0 };
for (const kind of ["bjt_npn", "bjt_pnp"] as const) {
  const glyph = bjtGlyph(kind, bjtBase, bjtC, bjtE);
  const bar = glyph[3]!;
  ok(dist(glyph[1]![1]!, bar[0]!) < 0.001 && dist(glyph[2]![1]!, bar[1]!) < 0.001, `${kind}: collector and emitter leads meet the base bar`);
  ok(dist(glyph[0]![1]!, { x: (bar[0]!.x + bar[1]!.x) / 2, y: (bar[0]!.y + bar[1]!.y) / 2 }) < 0.001, `${kind}: base lead joins the middle of the bar`);
}
ok(JSON.stringify(bjtGlyph("bjt_npn", bjtBase, bjtC, bjtE)) !== JSON.stringify(bjtGlyph("bjt_pnp", bjtBase, bjtC, bjtE)), "NPN and PNP ink differ in the emitter arrow");
ok(JSON.stringify(opampGlyph({ x: 0, y: 3 }, { x: 0, y: 1 }, { x: 5, y: 2 })) !== JSON.stringify(opampGlyph({ x: 0, y: 1 }, { x: 0, y: 3 }, { x: 5, y: 2 })), "swapping the op amp inputs changes the ink");
ok(JSON.stringify(twoTerminalGlyph("capacitor", { x: 0, y: 0 }, { x: 4, y: 0 })) !== JSON.stringify(twoTerminalGlyph("capacitor_polarised", { x: 0, y: 0 }, { x: 4, y: 0 })), "the polarised capacitor carries a mark the plain one lacks");
const follower = { kind: "opamp" as const, terminalNodes: { inverting: "no", noninverting: "ni", output: "no", supply_positive: "nvp", supply_negative: "nvn" }, wiredNodes: new Set(["no", "ni", "nvp", "nvn"]) };
ok(assertDevice(follower).length === 0, "a voltage follower with output tied to inverting passes");

console.log(`semiconductor devices verification passed (${checks} checks)`);
