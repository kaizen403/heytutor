/**
 * Physics unit probes (volume-certified units) must compile a family scene
 * unless the stem is an honest text-only definition / non-spatial MCQ.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../../scene-engine/src/synthesize/familyScene.ts";
import {
  inferSceneCapabilities,
  isQualitativeConceptQuestion,
  qualitativeQuestionAllowsScene,
} from "../../src/planners/sceneCapabilities";

const probesDir = join(dirname(fileURLToPath(import.meta.url)), "../../../../data/syllabus-probes");

/** Units 1–4 keep dedicated text-only / mechanics / work-energy gates. */
const SKIP_UNITS = new Set([1, 2, 3, 4]);

function honestTextOnly(text: string): boolean {
  const explicitVisual = /\b(?:draw|diagram|illustrat(?:e|ion)|sketch|construct|plot|graph|locate|mark|show)\b/i.test(text);
  if (explicitVisual) return false;
  return isQualitativeConceptQuestion(text) && !qualitativeQuestionAllowsScene(text);
}

const failures: string[] = [];
const probeFiles = readdirSync(probesDir)
  .filter((name) => /^physics-unit-\d+\.json$/.test(name))
  .sort();

for (const file of probeFiles) {
  const unitNumber = Number(/^physics-unit-(\d+)\.json$/.exec(file)?.[1]);
  if (SKIP_UNITS.has(unitNumber)) continue;
  const probes = JSON.parse(readFileSync(join(probesDir, file), "utf8")) as {
    questions: Array<{ id: string; question: string }>;
  };
  for (const item of probes.questions) {
    if (honestTextOnly(item.question)) continue;
    const capabilities = inferSceneCapabilities(item.question);
    const synthesized = synthesizeFamilyScene({
      question: item.question,
      families: capabilities.families,
    }) ?? synthesizeLastResortScene({
      question: item.question,
      families: capabilities.families,
    });
    const primitives = synthesized?.renderScene.primitives.length ?? 0;
    const mode = synthesized?.document.visualDecision.mode ?? "none";
    if (!synthesized || mode !== "scene" || primitives === 0) {
      failures.push(
        `${item.id}: family scene missing (mode=${mode} primitives=${primitives} family=${synthesized?.family ?? "null"} families=${JSON.stringify(capabilities.families)})`,
      );
    }
  }
}

if (failures.length > 0) {
  const shown = failures.slice(0, 40);
  throw new Error(
    `physics unit probe visuals failed (${failures.length}):\n${shown.join("\n")}${failures.length > 40 ? `\n… ${failures.length - 40} more` : ""}`,
  );
}

console.log(`verify-physics-unit-probe-visuals: ok  files=${probeFiles.length}`);
