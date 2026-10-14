/**
 * G4a: the full optics contract lines teach magnitude inputs (form, objectSide,
 * plan ids), the focus names the engine accepts, and where numbers and prose go.
 * They sit on the full contract lines only, so the universal prompt's compact
 * table does not grow and the existing budgets (24,500 initial, 27,000 repair)
 * still hold.
 *
 * G4c: rays come from the engine. The principal_rays line, full and compact,
 * leads with its whole shape (image:imageTip_id and the three ray names); the
 * gaussian_image line sends every ray to principal_rays and no longer asks for
 * hand rays with converges; lens and mirror stems carry the full line.
 */
import assert from "node:assert/strict";
import { SUPPORTED_SCENE_CONSTRUCTION_OPERATORS } from "@heytutor/scene-engine";
import { inferSceneCapabilities } from "../../src/planners/sceneCapabilities";
import { buildSceneDocumentPlannerPrompt, selectConstructionInputContracts } from "../../src/planners/scenePlannerV2Prompt";
import { repairSceneDocument } from "../../src/planners/scenePlannerV2";

const RAYS_SHAPE = '- principal_rays: {image:imageTip_id,rays?:["parallel","focal","central"]}.';
const REQUIRED = ['form:"converging"', 'objectSide:"real"|"virtual"', "F′", "F₁", "never on a focus", "every ray with principal_rays", RAYS_SHAPE, "never as free segments; no converges is needed"];

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
const full = selectConstructionInputContracts(["gaussian_image", "optical_focus", "principal_rays"]);
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

// G4d: the sentence asking for one form on both operators lives on the full gaussian_image line, which
// compaction drops. A formless optical_focus on a concave mirror resolves f > 0 against its form
// gaussian_image (the round 8 two-mirror figures), so the compact optical_focus shape must offer form.
const compactFocus = (contracts: string): string | undefined => contracts.split("\n").find((line) => line.startsWith("- optical_focus:"));
for (const [where, contracts] of [
  ["the compact catalog (selectConstructionInputContracts with nothing detailed)", compact],
  ["the universal initial prompt", universal],
  ["the compact catalog of every operator", selectConstructionInputContracts(SUPPORTED_SCENE_CONSTRUCTION_OPERATORS, [])],
  ["the full contracts", full],
] as const) {
  const line = compactFocus(contracts);
  assert(line, `${where} must carry an optical_focus line`);
  assert(shapeKeys(line).has("form") && /form\??:"converging"\|"diverging"/.test(line), `the optical_focus line in ${where} must offer form:"converging"|"diverging" in its shape: ${line}`);
}
console.log(`G4d: pass (compact optical_focus line: ${compactFocus(compact)})`);

// G4c: the principal_rays line leads with its whole shape wherever it appears, and the
// gaussian_image line no longer asks for hand rays ending on imageTip with converges.
const linesOf = (contracts: string, operator: string) => contracts.split("\n").filter((line) => line.startsWith(`- ${operator}:`));
for (const [where, contracts] of [
  ["the full contracts", selectConstructionInputContracts(["gaussian_image", "optical_focus", "principal_rays"])],
  ["the compact catalog", selectConstructionInputContracts(["gaussian_image", "optical_focus", "principal_rays"], [])],
  ["the universal initial prompt", universal],
  ["the compact catalog of every operator", selectConstructionInputContracts(SUPPORTED_SCENE_CONSTRUCTION_OPERATORS, [])],
] as const) {
  const [line] = linesOf(contracts, "principal_rays");
  assert(line?.startsWith(RAYS_SHAPE), `${where} must lead the principal_rays line with ${RAYS_SHAPE}; got ${line}`);
  const [gaussian] = linesOf(contracts, "gaussian_image");
  assert(gaussian && !/assert converges|End two rays/.test(gaussian), `${where} must not ask for hand rays with converges: ${gaussian}`);
}
const [compactRays] = linesOf(selectConstructionInputContracts(["principal_rays"], []), "principal_rays");
assert(compactRays?.includes("Outputs one polyline ray per rays name, default [parallel,central]."), `the compact principal_rays line must state its outputs: ${compactRays}`);
for (const question of [
  "Concave mirror, f = 15 cm, object at 20 cm. Locate the image and draw the ray diagram.",
  "A 5 cm tall candle is placed 27 cm from a concave lens of focal length 18 cm. Draw the ray diagram and find the position, size and nature of the image.",
]) {
  const capabilities = inferSceneCapabilities(question);
  assert(capabilities.constructionOperators?.includes("principal_rays"), `the scoped catalog for "${question}" must offer principal_rays`);
  const prompt = buildSceneDocumentPlannerPrompt(question, capabilities);
  const [line] = linesOf(prompt, "principal_rays");
  assert(line?.startsWith(RAYS_SHAPE) && line.includes("never as free segments"), `the scoped prompt for "${question}" must carry the full principal_rays line`);
}
console.log(`G4c: pass (compact principal_rays line: ${compactRays})`);

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
      { id: "rays", operator: "principal_rays", inputs: { image: "it" }, outputs: ["r1", "r2"] },
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
