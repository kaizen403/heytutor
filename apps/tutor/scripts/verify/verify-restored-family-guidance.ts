/**
 * Fresh and Continue use the real compiler, presentation and teaching helpers.
 * A reconstructed family may restore teaching context, never scene authority.
 * No fabricated family/IR metadata is allowed to supply that context.
 */
import assert from "node:assert/strict";
import {
  compileSceneDocument,
  synthesizeFamilyScene,
  validateSceneDocument,
  type SceneDocument,
} from "@heytutor/scene-engine";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import {
  buildResumeTeachingPrompt,
  buildTurnTeachingPrompt,
} from "../../features/tutor-session/lib/turn/turnTeachingPrompt";

const SOLID_GUIDANCE = "For mensuration, explain which part is the base";
const FAMILY_GUIDANCE = "The construction on the board is a ";
const compositeQuestion = "A solid consists of a cylinder of radius 3 cm and height 8 cm, topped by a cone of height 4 cm. Find its volume and total exposed surface area, including the bottom.";
const composite = synthesizeFamilyScene({ question: compositeQuestion });
assert(composite && composite.family === "solid_figure", "the engine must source-select the real composite fixture");
const sourceScene = composite.document;

let passed = 0;
const failures: string[] = [];
function check(name: string, body: () => void): void {
  try {
    body();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message.slice(0, 700) : String(error)}`);
  }
}

function presentation(document: SceneDocument, question: string, figureFamily?: string) {
  const structural = validateSceneDocument(document);
  assert(structural.document, "fixture must remain a structurally valid canonical document");
  const compiled = compileSceneDocument(structural.document);
  assert(compiled.ok && compiled.renderScene, "fixture must pass the actual ordinary compiler");
  return buildVerifiedDiagramPresentation(structural.document, compiled.renderScene, {
    originalQuestion: question,
    ...(figureFamily ? { figureFamily } : {}),
  });
}

check("real composite fresh and Continue prompts retain identical family guidance", () => {
  const fresh = presentation(sourceScene, compositeQuestion, composite.family);
  const restored = restoreVerifiedPresentationFromTurn({ question: compositeQuestion, sceneDocument: sourceScene });
  assert(restored);
  assert(fresh.diagram.promptAddon.includes(SOLID_GUIDANCE), "the actual fresh presentation must carry solid-specific guidance");
  const freshPrompt = buildTurnTeachingPrompt({
    question: compositeQuestion, diagramPromptAddon: fresh.diagram.promptAddon,
    turnPlan: null, solverProjection: null, codeLesson: null, isDsa: false,
    familiarity: "normal", fastMode: false,
  });
  const resumePrompt = buildResumeTeachingPrompt({
    lessonQuestion: compositeQuestion, reason: "stop", boardRows: [],
    rowsLeftOnPage: 8, nextRowY: 180, diagramPromptAddon: restored.diagram.promptAddon,
    codePanelShowing: false, turnPlan: null, solverProjection: null,
    familiarity: "normal", fastMode: false,
  });
  assert(freshPrompt.systemPrompt.includes(SOLID_GUIDANCE));
  assert(resumePrompt.systemPrompt.includes(SOLID_GUIDANCE), "the production Continue prompt must include the same solid teaching rule");
  assert.equal(restored.diagram.promptAddon, fresh.diagram.promptAddon, "Continue must retain the actual fresh figure context");
  assert.deepEqual(restored.diagram.commands, fresh.diagram.commands, "context restoration cannot change committed ink");
  assert.deepEqual(restored.diagram.anchors, fresh.diagram.anchors);
  assert.deepEqual(restored.introSegments, fresh.introSegments, "canonical suffix authority must remain unchanged");
});

for (const question of [
  "A cube has edge 5 cm. Find its volume and surface area.",
  "A cuboid has length 8 cm, width 5 cm and height 3 cm. Find its surface area.",
  "A square pyramid has base side 6 cm and height 4 cm. Find its volume.",
  "A regular hexagonal prism has base side 4 cm and height 10 cm. Find its volume.",
  "A hollow cylinder has outer radius 5 cm, inner radius 3 cm and height 8 cm. Find its volume.",
]) {
  check(`historical source-only restore: ${question}`, () => {
    const figure = synthesizeFamilyScene({ question });
    assert(figure && figure.family === "solid_figure");
    const fresh = presentation(figure.document, question, figure.family);
    const restored = restoreVerifiedPresentationFromTurn({ question, sceneDocument: figure.document });
    assert(restored, "historical exact canonical source figures need no saved family metadata");
    assert.deepEqual(restored, fresh);
  });
}

check("JSON object-key order does not withdraw authentic restored guidance", () => {
  const reversed = JSON.parse(JSON.stringify(sourceScene, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).reverse())
      : value));
  const restored = restoreVerifiedPresentationFromTurn({ question: compositeQuestion, sceneDocument: reversed });
  assert(restored);
  assert.equal(restored.diagram.promptAddon, presentation(sourceScene, compositeQuestion, composite.family).diagram.promptAddon);
});

check("fabricated family, valid-looking plan and ProblemIR cannot override engine context", () => {
  const restored = restoreVerifiedPresentationFromTurn({
    question: compositeQuestion, sceneDocument: sourceScene,
    sceneArtifacts: {
      figureFamily: "double_slit", family: "double_slit", promptAddon: "invented teaching authority",
      turnPlan: { schemaVersion: "turn-plan/v3", question: compositeQuestion, visualRequirement: "required",
        givens: [{ id: "fake", symbol: "d", value: 999, provenance: "given" }],
        unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [] },
      problemIR: { schemaVersion: "problem-ir/v1", entities: [{ id: "fake", kind: "aperture" }], figureFamily: "double_slit" },
    },
  });
  assert(restored);
  assert.equal(restored.diagram.promptAddon, presentation(sourceScene, compositeQuestion, composite.family).diagram.promptAddon);
  assert(!restored.diagram.promptAddon.includes("invented teaching authority"));
});

check("a different canonical reveal cannot borrow source-family guidance", () => {
  const altered: SceneDocument = {
    ...sourceScene,
    revealGroups: sourceScene.revealGroups.map((group, index) =>
      index === 0 ? { ...group, narrationCue: "Here is the saved solid." } : group),
  };
  const plain = presentation(altered, compositeQuestion);
  const restored = restoreVerifiedPresentationFromTurn({ question: compositeQuestion, sceneDocument: altered,
    sceneArtifacts: { family: "solid_figure", figureFamily: "solid_figure", problemIR: { entities: [{ kind: "solid" }] } } });
  assert(restored, "optional context mismatch must not weaken or replace ordinary compile authority");
  assert.deepEqual(restored, plain, "only exact canonical identity may recover family context");
  assert(!restored.diagram.promptAddon.includes(FAMILY_GUIDANCE));
});

check("a different external source cannot borrow the stored solid's guidance", () => {
  const question = "A cube has edge 5 cm. Find its volume and surface area.";
  const restored = restoreVerifiedPresentationFromTurn({ question, sceneDocument: sourceScene });
  assert(restored, "this gate does not expand ordinary canonical source/save acceptance");
  assert.deepEqual(restored, presentation(sourceScene, question));
  assert(!restored.diagram.promptAddon.includes(FAMILY_GUIDANCE));
});

check("missing external source never falls back to document source for family guidance", () => {
  const restored = restoreVerifiedPresentationFromTurn({ sceneDocument: sourceScene,
    sceneArtifacts: { family: "solid_figure", figureFamily: "solid_figure" } });
  assert(restored);
  assert(!restored.diagram.promptAddon.includes(FAMILY_GUIDANCE));
  assert(!restored.diagram.promptAddon.includes(SOLID_GUIDANCE));
});

check("fabricated saved context cannot grant guidance to an unrelated canonical scene", () => {
  const unrelatedQuestion = "A projectile is launched at 20 m/s at 30 degrees above horizontal. Show its trajectory.";
  const unrelated = synthesizeFamilyScene({ question: unrelatedQuestion });
  assert(unrelated && unrelated.family !== "solid_figure");
  const altered = { ...unrelated.document, source: { ...unrelated.document.source, question: compositeQuestion } };
  const restored = restoreVerifiedPresentationFromTurn({ question: compositeQuestion, sceneDocument: altered,
    sceneArtifacts: { family: "solid_figure", figureFamily: "solid_figure", problemIR: { entities: [{ kind: "solid" }] } } });
  assert(restored);
  assert(!restored.diagram.promptAddon.includes(FAMILY_GUIDANCE));
  assert(!restored.diagram.promptAddon.includes(SOLID_GUIDANCE));
});

check("text-only and invalid documents remain non-rendering regardless of family metadata", () => {
  const artifacts = { family: "solid_figure", figureFamily: "solid_figure" };
  assert.equal(restoreVerifiedPresentationFromTurn({ question: compositeQuestion,
    sceneDocument: { ...sourceScene, visualDecision: { mode: "text_only", reason: "declined" } }, sceneArtifacts: artifacts }), null);
  assert.equal(restoreVerifiedPresentationFromTurn({ question: compositeQuestion,
    sceneDocument: { ...sourceScene, schemaVersion: "invented" }, sceneArtifacts: artifacts }), null);
});

console.log(`restored family-guidance verification: ${passed}/${passed + failures.length} passed`);
if (failures.length) process.exitCode = 1;
