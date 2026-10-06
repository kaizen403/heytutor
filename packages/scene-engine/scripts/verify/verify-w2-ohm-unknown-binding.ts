import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";
import { applyStatedCircuitAuthority } from "../../src/ir/statedCircuitAuthority";

const plan = JSON.parse(readFileSync(new URL("./fixtures/w2-ohm/w1-ohm-tree-captured-planning-plan.json", import.meta.url), "utf8")) as TurnPlanV3;
let checks = 0;

function check(name: string, run: () => void): void {
  run();
  checks++;
  console.log(`ok ${name}`);
}

function strict(input: TurnPlanV3) {
  const snapshot = structuredClone(input);
  const result = applyStatedCircuitAuthority(input.question, input, { requireBoundClaims: true });
  assert.ok(result, "captured source circuit remains recognized");
  assert.deepEqual(input, snapshot, "authority leaves its input plan unchanged");
  return result.plan;
}

function rejectItot(name: string, edit: (input: TurnPlanV3) => void): void {
  check(name, () => {
    const input = structuredClone(plan);
    edit(input);
    const output = strict(input);
    assert.ok(!output.derived.some(row => row.id === "Itot"), "withdraw conflicting total-current row");
    assert.ok(!output.unknowns.some(row => row.id === "Itot"), "withdraw its incompatible unknown");
    assert.ok(!output.qualitativeClaims.some(claim => claim.relatedQuantityIds?.includes("Itot")), "withdraw linked claim c3");
    assert.equal(output.derived.find(row => row.id === "Req")?.value, 2, "preserve compatible equivalent resistance");
    assert.equal(output.derived.find(row => row.id === "Rs")?.value, 6, "preserve compatible intermediate resistance");
  });
}

rejectItot("declared voltage unknown cannot bind derived current", input => {
  input.unknowns.find(row => row.id === "Itot")!.unit = "V";
});
rejectItot("leaf resistance owner cannot bind derived source current", input => {
  Object.assign(input.unknowns.find(row => row.id === "Itot")!, { symbol: "R1", unit: "ohm" });
});
rejectItot("unsupported explicit unknown unit is removed during cleanup", input => {
  input.unknowns.find(row => row.id === "Itot")!.unit = "furlong";
});
rejectItot("known leaf-current symbol cannot own source current by same unit", input => {
  input.unknowns.find(row => row.id === "Itot")!.symbol = "I1";
});

for (const [name, edit] of [
  ["request identity binds compatible arbitrary alias", (input: TurnPlanV3) => {
    input.unknowns.find(row => row.id === "Itot")!.symbol = "ghost";
  }],
  ["absent unknown unit inherits its bound derived dimension", (input: TurnPlanV3) => {
    delete input.unknowns.find(row => row.id === "Itot")!.unit;
  }],
] as const) {
  check(name, () => {
    const input = structuredClone(plan);
    edit(input);
    const output = strict(input);
    assert.equal(output.derived.find(row => row.id === "Rs")?.value, 6);
    assert.equal(output.derived.find(row => row.id === "Req")?.value, 2);
    assert.equal(output.derived.find(row => row.id === "Itot")?.value, 3);
    assert.deepEqual(output.unknowns, input.unknowns, "retain the request-bound compatible unknown");
    assert.deepEqual(output.qualitativeClaims, input.qualitativeClaims, "retain all supported linked claims");
  });
}

console.log(`W2 Ohm unknown binding: ${checks} checks, 0 failures; strict policy only, READY 0 / accepted 0.`);
