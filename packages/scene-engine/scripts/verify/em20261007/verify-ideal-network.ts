import { strict as assert } from "node:assert";
import { evaluateNetworkConstruction, type NetworkGeometry } from "../../../src/compile/networkGeometry";
import type { SourceContext } from "../../../src/compile/sourceScalars";

const context: SourceContext = {
  number(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("finite number required");
    return value;
  },
  point() { throw new Error("network points are inline"); },
  geometry() { return undefined; },
};

type Branch = {
  id: string;
  from: string;
  to: string;
  kind: "resistor" | "source" | "wire" | "open";
  resistance?: number;
  emf?: number;
};

function solve(branches: Branch[]): NetworkGeometry[] {
  return evaluateNetworkConstruction("kirchhoff_network", {
    nodes: [{ id: "A", at: [0, 0] }, { id: "B", at: [4, 0] }],
    branches,
    ground: "A",
    units: { resistance: "ohm", emf: "V" },
    currentScale: 0.2,
  }, context);
}

function current(outputs: NetworkGeometry[], id: string): number {
  const output = outputs.find((item) => "networkBranch" in item && item.networkBranch?.id === id);
  assert(output && "networkBranch" in output && output.networkBranch, `missing ${id}`);
  return output.networkBranch.current;
}

const idealSource = solve([
  { id: "S", from: "A", to: "B", kind: "source", resistance: 0, emf: 12 },
  { id: "R", from: "B", to: "A", kind: "resistor", resistance: 6 },
]);
assert.equal(current(idealSource, "S"), 2, "ideal source current must be MNA-certified");
assert.equal(current(idealSource, "R"), 2, "6 ohm load on 12 V ideal source must draw 2 A");

const short = solve([
  { id: "S", from: "A", to: "B", kind: "source", resistance: 2, emf: 12 },
  { id: "short", from: "B", to: "A", kind: "wire" },
]);
assert.equal(current(short, "S"), 6, "explicit short current must be limited by source resistance");
assert.equal(current(short, "short"), 6, "short branch must carry the same loop current");

const open = solve([
  { id: "S", from: "A", to: "B", kind: "source", resistance: 2, emf: 12 },
  { id: "open", from: "B", to: "A", kind: "open" },
]);
assert.equal(current(open, "S"), 0, "open circuit source current must be zero");
assert.equal(current(open, "open"), 0, "open branch current must be zero");

const rejects = (branches: Branch[]): boolean => {
  try { solve(branches); return false; } catch { return true; }
};
assert.equal(rejects([
  { id: "S1", from: "A", to: "B", kind: "source", resistance: 0, emf: 10 },
  { id: "S2", from: "A", to: "B", kind: "source", resistance: 0, emf: 4 },
  { id: "R", from: "B", to: "A", kind: "resistor", resistance: 2 },
]), true, "incompatible parallel ideal sources must reject");
assert.equal(rejects([
  { id: "S1", from: "A", to: "B", kind: "source", resistance: 0, emf: 10 },
  { id: "S2", from: "A", to: "B", kind: "source", resistance: 0, emf: 10 },
  { id: "R", from: "B", to: "A", kind: "resistor", resistance: 2 },
]), true, "parallel ideal-source current split is indeterminate and must reject");

console.log("ideal network checks passed");
