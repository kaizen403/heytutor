import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getSegmentCommands } from "@heytutor/drawing";
import { buildSourceGroundedRepresentation } from "../../features/tutor-session/lib/representationFallbackV4";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/verifiedScenePresentation";

interface CorpusQuestion {
  id: string;
  question: string;
}

const repoRoot = resolve(process.cwd(), "../..");
const fixturePaths = [
  "packages/scene-engine/fixtures/evaluation/jee-physics-core-v1.json",
  "packages/scene-engine/fixtures/evaluation/math-visual-core-v1.json",
];
const questions = fixturePaths.flatMap((relativePath) => {
  const raw = JSON.parse(readFileSync(resolve(repoRoot, relativePath), "utf8")) as {
    questions?: CorpusQuestion[];
  };
  if (!Array.isArray(raw.questions)) throw new Error(`${relativePath} has no questions`);
  return raw.questions;
});

const ids = new Set<string>();
let visibleRepresentations = 0;
let honestTextOnlyResults = 0;
for (const item of questions) {
  if (ids.has(item.id)) throw new Error(`duplicate cross-corpus id ${item.id}`);
  ids.add(item.id);
  const selected = buildSourceGroundedRepresentation(item.question);
  if (!selected.nonMetric) throw new Error(`${item.id}: fallback was incorrectly promoted to metric`);
  if (!selected.validationReport.valid || selected.validationReport.issues.some((issue) => issue.severity === "fatal")) {
    throw new Error(`${item.id}: fallback failed validation: ${JSON.stringify(selected.validationReport.issues)}`);
  }
  if (selected.sceneDocument.source.question !== item.question) {
    throw new Error(`${item.id}: fallback lost exact question provenance`);
  }
  if (selected.sceneDocument.source.nonMetric !== true) {
    throw new Error(`${item.id}: source document omitted non-metric disclosure`);
  }
  if (selected.sceneDocument.constructions.some((construction) => construction.operator === "rectangle")) {
    throw new Error(`${item.id}: fallback converted question tokens into unrelated boxes`);
  }

  if (selected.sceneDocument.visualDecision.mode === "scene") {
    visibleRepresentations += 1;
    if (selected.renderScene.primitives.length === 0) {
      throw new Error(`${item.id}: scene representation produced no visible geometry`);
    }
    const presentation = buildVerifiedDiagramPresentation(
      selected.sceneDocument,
      selected.renderScene,
    );
    if (presentation.introSegments.length === 0) {
      throw new Error(`${item.id}: scene representation has no narrated reveal`);
    }
    for (const [index, segment] of presentation.introSegments.entries()) {
      if (!segment.narration.trim()) throw new Error(`${item.id}: reveal ${index} has no narration`);
      const commands = getSegmentCommands(segment);
      if (commands.length === 0 || commands.length > 7) {
        throw new Error(`${item.id}: reveal ${index} has an invalid command batch`);
      }
      if (!segment.verifiedDiagramIntro) {
        throw new Error(`${item.id}: reveal ${index} is not marked as verified geometry`);
      }
    }
    if (!presentation.diagram.promptAddon.includes("intentionally non-metric")) {
      throw new Error(`${item.id}: teaching prompt could infer scale from fallback geometry`);
    }
    if (!presentation.diagram.promptAddon.includes("Do not emit DRAW_*")) {
      throw new Error(`${item.id}: teaching model drawing ownership is open`);
    }
  } else {
    honestTextOnlyResults += 1;
    if (selected.renderScene.primitives.length !== 0) {
      throw new Error(`${item.id}: text-only fallback leaked diagram ink`);
    }
  }
}

if (questions.length < 30) throw new Error("combined universal representation corpus is too small");
if (visibleRepresentations === 0 || honestTextOnlyResults === 0) {
  throw new Error("corpus must exercise both meaningful source visuals and honest text-only degradation");
}
console.log(
  `representation corpus v4 verification passed (${questions.length} questions; ${visibleRepresentations} meaningful visuals; ${honestTextOnlyResults} text-only)`,
);
