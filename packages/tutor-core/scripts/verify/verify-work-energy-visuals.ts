/**
 * Unit 4 (work and energy) word problems must be classified as diagram-worthy
 * and compile a verified family scene. Text-only is reserved for definitions
 * and matching lists with no spatial setup.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { synthesizeFamilyScene } from "../../../scene-engine/src/synthesize/familyScene.ts";
import { inferSceneCapabilities } from "../../src/planners/sceneCapabilities";
import { questionRequiresVisual } from "../../src/planners/turnPlannerV3";

const probesPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../data/syllabus-probes/physics-unit-4.json",
);

const probes = JSON.parse(readFileSync(probesPath, "utf8")) as {
  questions: Array<{ id: string; question: string }>;
};

const TEXT_ONLY_IDS = new Set([
  "physics|4|power|easy",
  "physics|4|conservative-and-non-conservative-forces|easy",
  "physics|4|conservative-and-non-conservative-forces|hard",
]);

if (probes.questions.length === 0) {
  throw new Error("verify-work-energy-visuals: no probe questions loaded; the gate would pass vacuously");
}

const failures: string[] = [];

for (const item of probes.questions) {
  const requires = questionRequiresVisual(item.question);
  const capabilities = inferSceneCapabilities(item.question);
  const synthesized = synthesizeFamilyScene({
    question: item.question,
    families: capabilities.families,
  });
  const primitives = synthesized?.renderScene.primitives.length ?? 0;
  const mode = synthesized?.document.visualDecision.mode ?? "none";
  const expectScene = !TEXT_ONLY_IDS.has(item.id);

  if (expectScene) {
    if (!requires) {
      failures.push(`${item.id}: questionRequiresVisual=false families=${JSON.stringify(capabilities.families)}`);
    }
    if (!capabilities.visualRequired || capabilities.families.length === 0) {
      failures.push(`${item.id}: no visual family inferred (${JSON.stringify(capabilities.families)})`);
    }
    if (!synthesized || mode !== "scene" || primitives === 0) {
      failures.push(
        `${item.id}: family scene missing (mode=${mode} primitives=${primitives} family=${synthesized?.family ?? "null"})`,
      );
    }
  } else if (requires) {
    failures.push(`${item.id}: definition/matching stem was force-marked as requiring a visual`);
  }
}

if (failures.length > 0) {
  throw new Error(
    `work-energy visuals failed (${failures.length}/${probes.questions.length}):\n${failures.join("\n")}`,
  );
}

console.log(`verify-work-energy-visuals: ok  questions=${probes.questions.length}`);
