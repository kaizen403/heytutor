/**
 * The refraction contract tells the planner how to name a medium's side.
 *
 * Round 7 planners wrote "incident side", "air side" and "gem side" on medium
 * labels; none of those is a placement the engine knew, so "air" fell to a
 * default slot on the gem side of a gem-air face. The engine now resolves
 * `incident_side` and `transmitted_side` from the refraction's own two paths
 * and drops an unbound medium label on the interface that names no side.
 * The refract_at contract must say so, in the full line a scoped optics
 * request sends, and every side value it names must be one the engine reads.
 *
 *   pnpm --filter @heytutor/tutor-core exec tsx scripts/verify/verify-optics-label-side-prompt.ts
 */
import { SCENE_SIDE_PLACEMENT_INTENTS } from "@heytutor/scene-engine";
import {
  SCENE_CONSTRUCTION_INPUT_CONTRACTS,
  buildSceneDocumentPlannerPrompt,
} from "../../src/planners/scenePlannerV2Prompt";

const failures: string[] = [];

const contract = SCENE_CONSTRUCTION_INPUT_CONTRACTS.split("\n").find((line) => line.startsWith("- refract_at:"));
if (!contract) {
  failures.push("the refract_at contract line is missing");
} else {
  for (const intent of ["incident_side", "transmitted_side"]) {
    if (!contract.includes(`"${intent}"`)) failures.push(`the refract_at contract does not name placementIntent "${intent}"`);
  }
  if (!contract.includes("placementIntent")) failures.push("the refract_at contract does not say the side goes in placementIntent");
  const named = [...contract.matchAll(/"([a-z]+_side)"/g)].map((match) => match[1]!);
  for (const intent of named) {
    if (!(SCENE_SIDE_PLACEMENT_INTENTS as readonly string[]).includes(intent)) {
      failures.push(`the refract_at contract names "${intent}", which the engine does not resolve`);
    }
  }
}

// A scoped optics request sends the full refract_at line, sentence and all.
const prompt = buildSceneDocumentPlannerPrompt(
  "A ray in glass of index 1.52 meets water of index 1.33 at 37 degrees to the normal.",
  { constructionOperators: ["point", "line", "refract_at", "angle_mark"] },
);
if (!prompt.includes("transmitted_side")) failures.push("a scoped refract_at request does not carry the side sentence");

if (failures.length > 0) {
  console.error(`verify-optics-label-side-prompt: ${failures.length} failure(s)`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("verify-optics-label-side-prompt: ok (refract_at names incident_side and transmitted_side; the engine resolves both)");
