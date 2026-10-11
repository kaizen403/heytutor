import assert from "node:assert/strict";
import {
  buildSceneDocumentPlannerPrompt,
  selectConstructionInputContracts,
} from "../../src/planners/scenePlannerV2Prompt";
import { inferSceneCapabilities } from "../../src/planners/sceneCapabilities";
import { planSceneDocumentWithRepair } from "../../src/planners/scenePlannerV2";

const operators = ["number_line_set", "linear_half_plane", "linear_feasible_region", "linear_system"];
const capabilities = inferSceneCapabilities("Graph affine inequalities in two real variables.", {
  turnPlan: { visualRequirement: "required", givens: [] },
});
for (const operator of operators) assert.ok(capabilities.constructionOperators.includes(operator), `${operator} remains available`);
for (const detailed of [undefined, [], operators]) {
  const contracts = selectConstructionInputContracts(operators, detailed);
  assert.ok(contracts.includes("1 linear_region only,no extra ink/claims"));
  assert.ok(contracts.includes("Equivalents only"));
  for (const operator of operators) assert.ok(contracts.includes(`- ${operator}:`));
  const lines = contracts.split("\n");
  const numberLine = lines.find((line) => line.startsWith("- number_line_set:"))!;
  assert.ok(numberLine.includes("union") && numberLine.includes("intersection") && numberLine.includes("complement"));
  assert.match(numberLine, /Boolean grouping.*domains/);
  const feasible = lines.find((line) => line.startsWith("- linear_feasible_region:"))!;
  assert.match(feasible, /(?:all|All|every|Copy all).*constraints.*domains/i);
  assert.ok(feasible.includes("objective") && feasible.includes("sense"));
  for (const operator of operators.slice(1)) {
    const contract = lines.find((line) => line.startsWith(`- ${operator}:`))!;
    assert.ok(/(?:exactly two|Exactly 2)/.test(contract) || contracts.includes("2D:2 axes even single-axis"));
  }
  assert.match(lines.find((line) => line.startsWith("- linear_system:"))!, /both full original equations|both full source equations/i);
}
assert.ok(buildSceneDocumentPlannerPrompt("Graph an affine source program.").length + 800 <= 24_500, "universal compact contract remains under initial transport budget");

async function verifyTransport() {
  const originalFetch = globalThis.fetch;
  const sent: Array<Array<{ content?: string }>> = [];
  globalThis.fetch = async (_url, options) => {
    sent.push(JSON.parse(String(options?.body)).messages);
    return Response.json({ choices: [{ message: { content: JSON.stringify({
      schemaVersion: "scene-document/v2", repaired: sent.length > 2,
      constructions: [{ id: "region", operator: "linear_feasible_region", inputs: {
        variables: ["u", "v"], constraints: ["u >= 0", "v >= 0", "u + 2v <= 9"],
        objective: { expression: "2u + v", sense: "max" },
      }, outputs: ["region"] }],
    }) } }] });
  };
  try {
    const result = await planSceneDocumentWithRepair("Maximize 2u + v under u >= 0, v >= 0 and u + 2v <= 9.",
      (candidate) => candidate.repaired === true ? { valid: true, errors: [] } : {
        valid: false, errors: [{ code: "linear_source_mismatch", message: "Preserve the complete original source inequality.", severity: "fatal" }],
      }, { proxyUrl: "http://contracts.test", timeoutMs: 1000, constructionOperators: operators });
    assert.ok(result?.validation.valid);
    assert.equal(sent.length, 4, "two plans and first complete repair round");
    for (const messages of sent) {
      const prompt = messages.map((message) => message.content ?? "").join("\n");
      assert.ok(prompt.length <= 27_000, "repair remains under existing transport budget");
      assert.ok(prompt.includes("1 linear_region only,no extra ink/claims"));
      assert.ok(prompt.includes("all original constraints") || prompt.includes("all source constraints"));
      assert.ok(prompt.includes('sense:"max"|"min"'));
      assert.ok(prompt.includes("Equivalents only"));
    }
    console.log(`linear-region contracts: full/compact/repair preserve source semantics and one-output ownership; universal prompt ${buildSceneDocumentPlannerPrompt("Graph an affine source program.").length} chars; zero model calls`);
  } finally { globalThis.fetch = originalFetch; }
}
void verifyTransport().catch((error) => { console.error(error); process.exitCode = 1; });
