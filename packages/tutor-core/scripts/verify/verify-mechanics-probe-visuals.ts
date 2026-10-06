/**
 * Physics Units 2–3 lecture probes must compile a verified family scene.
 * Text-only is reserved for definition stems with no spatial setup.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { synthesizeFamilyScene } from "../../../scene-engine/src/synthesize/familyScene.ts";
import { readUniformCircularSource } from "../../../scene-engine/src/physics/uniformCircularSource.ts";
import { inferSceneCapabilities } from "../../src/planners/sceneCapabilities";
import { questionRequiresVisual } from "../../src/planners/turnPlannerV3";

const probesDir = join(dirname(fileURLToPath(import.meta.url)), "../../../../data/syllabus-probes");

const TEXT_ONLY_IDS = new Set([
  "physics|2|frame-of-reference|easy",
]);

const failures: string[] = [];

// Uniform circular motion is admitted by the turn plan, not by wording
// (coordinator decision, 4 Oct 2026). Its probes run with a plan that names
// circular motion; without one the engine's UCM figure must never be drawn,
// and a numeric stem's legacy static circle declines.
const UCM_PROBE = "physics|2|uniform-circular-motion|";
const circularPlan = { lawIds: ["uniform circular motion: a_c = v^2/r"], givens: [], derived: [], unknowns: [] };

for (const unit of [2, 3] as const) {
  const probes = JSON.parse(readFileSync(join(probesDir, `physics-unit-${unit}.json`), "utf8")) as {
    questions: Array<{ id: string; question: string }>;
  };
  if (probes.questions.length === 0) {
    throw new Error(`verify-mechanics-probe-visuals: physics-unit-${unit} has no probes; the gate would pass vacuously`);
  }
  for (const item of probes.questions) {
    const requires = questionRequiresVisual(item.question);
    const capabilities = inferSceneCapabilities(item.question);
    const ucm = item.id.startsWith(UCM_PROBE);
    const synthesized = synthesizeFamilyScene({
      question: item.question,
      families: capabilities.families,
      ...(ucm ? { turnPlan: circularPlan } : {}),
    });
    if (ucm) {
      const unplanned = synthesizeFamilyScene({ question: item.question, families: capabilities.families });
      if (unplanned?.document.source.archetype === "uniform_circular_motion_source") {
        failures.push(`${item.id}: the UCM figure was drawn without a plan naming circular motion`);
      }
      if (readUniformCircularSource(item.question)?.status === "numeric" && unplanned !== null) {
        failures.push(`${item.id}: without a circular plan the legacy figure must decline (got ${unplanned.family})`);
      }
    }
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
      failures.push(`${item.id}: definition stem was force-marked as requiring a visual`);
    }
  }
}

if (failures.length > 0) {
  throw new Error(`mechanics probe visuals failed (${failures.length}):\n${failures.join("\n")}`);
}

console.log("verify-mechanics-probe-visuals: ok");
