/**
 * G4a: the full optics contract lines teach magnitude inputs (form, objectSide,
 * plan ids), the focus names the engine accepts, and where numbers and prose go.
 * They sit on the full contract lines only, so the universal prompt's compact
 * table does not grow and the existing budgets (24,500 initial, 27,000 repair)
 * still hold.
 */
import assert from "node:assert/strict";
import { SUPPORTED_SCENE_CONSTRUCTION_OPERATORS } from "@heytutor/scene-engine";
import { inferSceneCapabilities } from "../../src/planners/sceneCapabilities";
import { buildSceneDocumentPlannerPrompt, selectConstructionInputContracts } from "../../src/planners/scenePlannerV2Prompt";
import { repairSceneDocument } from "../../src/planners/scenePlannerV2";

const REQUIRED = ['form:"converging"', 'objectSide:"real"|"virtual"', "F′", "F₁", "never on a focus", "End two rays on imageTip and assert converges"];

// Lens and mirror stems get a scoped catalog, so their initial request carries the full lines.
let opticsPromptLength = 0;
for (const question of [
  "Concave mirror, f = 15 cm, object at 20 cm. Locate the image and draw the ray diagram.",
  "How does a convex lens form an image?",
  "A convex lens of focal length 15 cm has an object placed 10 cm from it. Draw the ray diagram and describe the image.",
]) {
  const prompt = buildSceneDocumentPlannerPrompt(question, inferSceneCapabilities(question));
  for (const text of REQUIRED) assert(prompt.includes(text), `the planner prompt for "${question}" must include ${text}`);
  assert(prompt.length + 800 <= 24_500, `the optics prompt must fit the initial transport budget: ${prompt.length}`);
  opticsPromptLength = Math.max(opticsPromptLength, prompt.length);
}
// The reusable-capability optics case reaches the whole catalog, which stays compact; it must still fit.
const opticsQuestion = "Draw the Cartesian image and foci of a converging lens with explicit object and focal distances.";
const opticsPrompt = buildSceneDocumentPlannerPrompt(opticsQuestion, inferSceneCapabilities(opticsQuestion));
assert(opticsPrompt.length + 800 <= 24_500, `the optics capability prompt must fit the initial transport budget: ${opticsPrompt.length}`);

// The compact catalog keeps only each line's first sentence: the explanatory sentences live on the full lines only.
const compact = selectConstructionInputContracts(["gaussian_image", "optical_focus"], []);
for (const text of ["F′", "never on a focus"]) assert(!compact.includes(text), `the compact optics contracts must not carry ${text}`);
const full = selectConstructionInputContracts(["gaussian_image", "optical_focus"]);
for (const text of REQUIRED) assert(full.includes(text), `the full optics contracts must include ${text}`);

const unknownQuestion = "Draw the supplied conditional outcomes and mark every joint leaf probability.";
const unknownCapabilities = inferSceneCapabilities(unknownQuestion);
const universal = buildSceneDocumentPlannerPrompt(unknownQuestion, { ...unknownCapabilities, constructionOperators: SUPPORTED_SCENE_CONSTRUCTION_OPERATORS });
assert(!universal.includes("never on a focus"), "the universal initial prompt keeps the compact optics lines");
assert(universal.length + 800 <= 24_500, `the universal initial prompt must keep its budget: ${universal.length}`);

// G4b: compaction keeps sentence 0, so the compact gaussian_image line must still carry the whole
// required shape. 18 of 21 recorded first-pass candidates copied a 4-key compact shape and then
// failed on the unit, displayScale, centre and axis it left out.
const GAUSSIAN_KEYS = ["kind", "center", "axis", "objectDistance", "focalLength", "objectHeight", "displayScale", "lengthUnit", "form", "objectSide"];
const shapeKeys = (line: string | undefined): Set<string> => {
  const shape = /\{([^}]*)\}/.exec(line ?? "")?.[1] ?? "";
  return new Set([...shape.matchAll(/(?:^|,)\s*([A-Za-z]+)\??\s*(?=[:,]|$)/g)].map((match) => match[1]!));
};
const compactGaussian = (contracts: string): string | undefined => contracts.split("\n").find((line) => line.startsWith("- gaussian_image:"));
for (const [where, contracts] of [
  ["the compact catalog (selectConstructionInputContracts with nothing detailed)", compact],
  ["the universal initial prompt", universal],
  ["the compact catalog of every operator", selectConstructionInputContracts(SUPPORTED_SCENE_CONSTRUCTION_OPERATORS, [])],
] as const) {
  const line = compactGaussian(contracts);
  assert(line, `${where} must carry a gaussian_image line`);
  const keys = shapeKeys(line);
  const missing = GAUSSIAN_KEYS.filter((key) => !keys.has(key));
  assert.deepEqual(missing, [], `the gaussian_image line in ${where} must carry ${GAUSSIAN_KEYS.join(", ")}; missing ${missing.join(", ")} in: ${line}`);
  assert(/form:"converging"\|"diverging"/.test(line) && /objectSide:"real"\|"virtual"/.test(line), `the gaussian_image line in ${where} must give the form and objectSide values: ${line}`);
}
console.log(`G4b: pass (compact gaussian_image line: ${compactGaussian(compact)})`);

// A universal repair of a candidate that used the optics operators carries their full lines within budget.
const originalFetch = globalThis.fetch;
const requests: Array<{ messages: Array<{ content: string }> }> = [];
globalThis.fetch = async (_input, init) => {
  requests.push(JSON.parse(String(init?.body)));
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ schemaVersion: "scene-document/v2", visualDecision: { mode: "text_only" } }) } }] }), { status: 200 });
};
try {
  await repairSceneDocument(unknownQuestion, {
    schemaVersion: "scene-document/v2",
    constructions: [
      { id: "image", operator: "gaussian_image", inputs: { kind: "lens" }, outputs: ["ob", "ot", "ib", "it"] },
      { id: "foci", operator: "optical_focus", inputs: { kind: "lens" }, outputs: ["F1", "F2"] },
    ],
  }, [{ code: "invalid_optical_focus_label", message: "optical numeric labels must name a supported physical scalar", severity: "fatal" }],
  { ...unknownCapabilities, proxyUrl: "http://planner.test", timeoutMs: 2000 });
  assert.equal(requests.length, 1);
  const repair = requests[0]!.messages.map((message) => message.content).join("\n");
  for (const text of REQUIRED) assert(repair.includes(text), `the optics repair request must include ${text}`);
  assert(repair.length <= 27_000, `the universal repair request with optics operators exceeds its budget: ${repair.length}`);
  console.log(`G4a: pass (optics stem prompt ${opticsPromptLength}, optics capability prompt ${opticsPrompt.length}, universal ${universal.length}, optics repair ${repair.length})`);
} finally { globalThis.fetch = originalFetch; }
console.log("verify-optics-prompt-lines: optics contract lines carry magnitude inputs, focus names and placement within budget");
