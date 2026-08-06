import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSceneDocumentPlannerPrompt,
  DEFAULT_SCENE_CONSTRUCTION_OPERATORS,
} from "../src/scenePlannerV2Prompt";
import { inferSceneCapabilities } from "../src/sceneCapabilities";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../scene-engine/fixtures/evaluation/optics-syllabus-v1.json",
);
const corpus = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  cases: Array<{
    id: string;
    question: string;
    visualFamilies: string[];
    law?: { id?: string };
  }>;
};

const operatorByFamily: Record<string, string[]> = {
  ray_path: ["ray", "surface_contact", "normal_at", "reflect_at", "refract_at"],
  axis_view: ["line", "dimension"],
  interface: ["line", "surface_intersection"],
  instrument_chain: ["line", "ray", "optical_train"],
  wavefront: ["wavefront_family"],
  aperture: ["aperture"],
  screen_pattern: ["screen_pattern"],
  transverse_field: ["transverse_field"],
  polarizer: ["polarizer"],
};

for (const testCase of corpus.cases) {
  const capabilities = inferSceneCapabilities(
    testCase.question,
    testCase.law?.id ? [testCase.law.id] : [],
  );
  if (!capabilities.visualRequired) throw new Error(`${testCase.id}: optics visual was not required`);
  if (capabilities.planningGuidance.length === 0) throw new Error(`${testCase.id}: visual invariants were omitted`);
  for (const family of testCase.visualFamilies) {
    for (const operator of operatorByFamily[family] ?? []) {
      if (!capabilities.constructionOperators.includes(operator)) {
        throw new Error(`${testCase.id}: ${family} did not select ${operator}`);
      }
    }
  }
}

const ydse = corpus.cases.find((item) => item.id === "ydse-advanced");
if (!ydse) throw new Error("missing YDSE test case");
const ydseCapabilities = inferSceneCapabilities(ydse.question, [ydse.law?.id ?? ""]);
const compactPrompt = buildSceneDocumentPlannerPrompt(ydse.question, {
  constructionOperators: ydseCapabilities.constructionOperators,
  proofPredicates: ydseCapabilities.proofPredicates,
  planningGuidance: ydseCapabilities.planningGuidance,
});
const fullPrompt = buildSceneDocumentPlannerPrompt(ydse.question, {
  constructionOperators: DEFAULT_SCENE_CONSTRUCTION_OPERATORS,
});
if (!compactPrompt.includes("- aperture:") || !compactPrompt.includes("- screen_pattern:")) {
  throw new Error("compact YDSE prompt omitted required operator contracts");
}
if (compactPrompt.includes("- solid_projection:") || compactPrompt.includes("- implicit_curve:")) {
  throw new Error("compact YDSE prompt retained unrelated capability contracts");
}
if (!(compactPrompt.length < fullPrompt.length * 0.72)) {
  throw new Error(`compact prompt did not materially reduce context: ${compactPrompt.length}/${fullPrompt.length}`);
}

const instrument = corpus.cases.find((item) => item.id === "instruments-advanced");
if (!instrument) throw new Error("missing advanced optical-instrument case");
const instrumentCapabilities = inferSceneCapabilities(instrument.question, [instrument.law?.id ?? ""]);
const instrumentPrompt = buildSceneDocumentPlannerPrompt(instrument.question, {
  constructionOperators: instrumentCapabilities.constructionOperators,
  proofPredicates: instrumentCapabilities.proofPredicates,
  planningGuidance: instrumentCapabilities.planningGuidance,
});
if (
  !instrumentPrompt.includes("SELECTED VISUAL INVARIANTS") ||
  !instrumentPrompt.includes("use optical_train for the six rays") ||
  instrumentPrompt.includes("Use aperture for the physical opening")
) {
  throw new Error("instrument prompt did not receive only its selected compact invariants");
}

console.log("verify-scene-capabilities: ok");
console.log(`  cases=${corpus.cases.length} compact_chars=${compactPrompt.length} full_chars=${fullPrompt.length}`);
