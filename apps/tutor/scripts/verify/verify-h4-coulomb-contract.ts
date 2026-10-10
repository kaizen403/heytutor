import assert from "node:assert/strict";
import { type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { normalizeSceneDocumentModelOutput, planSceneDocument, repairSceneDocument, selectConstructionInputContracts } from "@heytutor/tutor-core";
import { validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";

async function main(): Promise<void> {
  let checks = 0;
  const failures: string[] = [];
  const check = (value: unknown, message: string) => { checks++; if (!value) failures.push(message); };
  const question = "Two charges +2 uC and -1 uC are 3 cm apart. Show their Coulomb forces with k=9e9 N*m^2/C^2.";
  const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [] };
  const scene: SceneDocument = {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "verified source units" }, source: { question }, quantities: [],
    entities: [{ id: "F1", kind: "vector", role: "force on first charge" }, { id: "F2", kind: "vector", role: "force on second charge" }],
    constructions: [{ id: "forces", operator: "coulomb_pair", inputs: {
      charges: [{ position: [0, 0], charge: { value: 2, unit: "uC" } }, { position: [3, 0], charge: { value: -1, unit: "uC" } }],
      k: 9e9, displayLength: 1, units: { charge: "uC", length: "cm" },
    }, outputs: ["F1", "F2"] }], relations: [], assertions: [], annotations: [], requiredEntityIds: ["F1", "F2"],
    revealGroups: [{ id: "g", entityIds: ["F1", "F2"], dependsOn: [], narrationCue: "equal opposite forces" }], teachingTimeline: [],
  };
  const production = (document: SceneDocument) => validateProductionSceneCandidate({ candidate: normalizeSceneDocumentModelOutput(document as unknown as Record<string, unknown>, question), question, turnPlan: plan });
  const positive = production(scene);
  check(positive.valid, `declared source units survive production: ${JSON.stringify(positive.errors)}`);
  check(positive.value?.renderScene.primitives.some((mark) => mark.kind === "label" && mark.text?.includes(" N")), "derived force labels carry newtons");
  const mismatch = structuredClone(scene);
  (mismatch.constructions[0]!.inputs.charges as Array<{ charge: { unit: string } }>)[0]!.charge.unit = "C";
  check(!production(mismatch).valid, "declared charge-prefix mismatch rejects");
  const wrappedK = structuredClone(scene); wrappedK.constructions[0]!.inputs.k = { value: 9e9, unit: "N*m^2/C^2" };
  check(!production(wrappedK).valid, "unsupported unit-bearing inline k wrapper rejects");
  const legacy = structuredClone(scene);
  delete legacy.constructions[0]!.inputs.units;
  legacy.constructions[0]!.inputs.charges = [{ position: [0, 0], charge: 2e-6 }, { position: [0.03, 0], charge: -1e-6 }];
  check(production(legacy).valid, "omitted unit packet preserves bare-SI compatibility");
  for (const detailed of [undefined, []] as const) {
    const contract = selectConstructionInputContracts(["coulomb_pair"], detailed);
    check(contract.includes('units?:{charge:"C"|"mC"|"uC"|"nC",length:"m"|"cm"|"mm"}') && contract.includes("SI"), "full/compact contracts expose only verified Coulomb unit opt-in");
  }
  const requests: Array<{ messages: Array<{ content: string }> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(scene) } }] }), { status: 200 });
  };
  try {
    await planSceneDocument(question, { proxyUrl: "http://planner.test", timeoutMs: 2000 });
    await repairSceneDocument(question, scene as unknown as Record<string, unknown>, [{ code: "invalid_coulomb_units", message: "Respect declared source units.", severity: "fatal" }], { proxyUrl: "http://planner.test", timeoutMs: 2000 });
  } finally { globalThis.fetch = originalFetch; }
  check(requests.length === 2, "both real transports exercised with only paid fetch mocked");
  requests.forEach((request, index) => {
    const prompt = request.messages.map((message) => message.content).join("\n");
    check(prompt.length <= (index === 0 ? 24_500 : 27_000), "unchanged initial/repair budget");
    check(prompt.includes('units?:{charge:"C"|"mC"|"uC"|"nC",length:"m"|"cm"|"mm"}'), "declared Coulomb units survive actual transport");
  });
  assert.equal(failures.length, 0, failures.join("\n"));
  console.log(`H4 Coulomb contract: ${checks} production/transport checks passed`);
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
