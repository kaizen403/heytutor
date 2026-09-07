/**
 * Physics unit probes (volume-certified units) must compile a family scene
 * unless the stem is an honest text-only definition / non-spatial MCQ, or the
 * scene engine has declared that this subject must not get the picture the
 * available family would draw.
 *
 * The second reason is new. Before it, this gate was satisfied by the wrong
 * picture: a 342-probe sweep found the two-point-charge figure committed for the
 * cyclotron, a helical path, Earth's magnetic elements and the variation of g
 * with depth, and the Bohr two-level figure committed for fission, fusion, Q
 * value and Rutherford scattering. `sceneDemand` now vetoes those, and a veto
 * leaves the turn teaching text-only, which `sceneDemand` itself documents as
 * the honest outcome. Counting that as a coverage failure would mean the gate
 * was pushing the engine to keep drawing the wrong thing.
 *
 * There is a third case, and it is the honest one to be uncomfortable about: a
 * subject for which the engine has no builder at all. An AC generator, a
 * reactance phasor, a transistor as a switch, a metre scale on a pivot, a
 * meniscus and a drop all fall here. They used to satisfy this gate by drawing
 * something else, because the probe generator appended an apparatus cue that
 * pointed at whatever builder did exist: a metre scale asked for "circuit
 * symbols and labelled terminals" and shipped a resistor network. With the cue
 * corrected, those subjects draw nothing, which is honest and is a real loss of
 * coverage. `docs/plans/figure-relevance-fixes.md` lists the builders that
 * would give them a correct figure.
 *
 * It is still a gate. Both counts are capped, so a probe that starts drawing
 * nothing has to come here and say why, and anything that fails for neither
 * reason fails outright.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../../scene-engine/src/synthesize/familyScene.ts";
import { sceneDemand } from "../../../scene-engine/src/synthesize/sceneDemand.ts";
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

/**
 * Probes whose subject the engine refuses to draw with the family it has.
 * Raise this only with the reason, and only alongside the veto that caused it.
 */
const MAX_DECLARED_DECLINES = 48;

/**
 * Probes whose subject has no builder. Lowering this is the point; raising it
 * means a subject that used to have a figure has lost one, and needs a reason.
 */
const MAX_MISSING_BUILDERS = 54;

const failures: string[] = [];
const declined: string[] = [];
const missingBuilder: string[] = [];
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
      const forbids = sceneDemand(item.question).forbids;
      if (forbids.length > 0) {
        declined.push(`${item.id}: ${forbids.join(", ")}`);
        continue;
      }
      // Nothing was even proposed, or the one family proposed could not serve
      // this subject. Either way there is no builder for it today.
      if (capabilities.families.length === 0 || !synthesized) {
        missingBuilder.push(`${item.id}: families=${JSON.stringify(capabilities.families)}`);
        continue;
      }
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

if (missingBuilder.length > MAX_MISSING_BUILDERS) {
  const subjects = [...new Set(missingBuilder.map((entry) => entry.split("|").slice(0, 3).join("|")))];
  throw new Error(
    `${missingBuilder.length} probes have no builder for their subject, up from ${MAX_MISSING_BUILDERS}. ` +
      "A subject that used to draw and now does not needs a reason here:\n" +
      subjects.slice(0, 20).join("\n"),
  );
}

if (declined.length > MAX_DECLARED_DECLINES) {
  throw new Error(
    `the engine now refuses ${declined.length} probe subjects, up from ${MAX_DECLARED_DECLINES}. ` +
      "That may be right, but it is a coverage change and belongs in this file with its reason:\n" +
      declined.slice(0, 20).join("\n"),
  );
}

console.log(
  `verify-physics-unit-probe-visuals: ok  files=${probeFiles.length}` +
    `  declared declines=${declined.length}/${MAX_DECLARED_DECLINES}` +
    `  no builder=${missingBuilder.length}/${MAX_MISSING_BUILDERS}`,
);
