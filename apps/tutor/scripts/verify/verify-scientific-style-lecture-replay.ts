import assert from "node:assert/strict";
import { createFallbackTurnPlanV3 } from "@heytutor/tutor-core";
import { admitStoredScene } from "../../lib/scene/sceneAdmission";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { withScientificStyleNativeRepresentation } from "../../lib/scene/scientificStyleLecture";
import { parseScientificStyleLecture } from "../../lib/scene/scientificStyleLecture";
import { selectProductionFastRepresentation } from "../../features/tutor-session/lib/scene/productionSceneSelection";

const question = "Solve x + y = 5 and x - y = 1. Plot both lines and label their intersection.";
const turnPlan = createFallbackTurnPlanV3(question);
turnPlan.visualRequirement = "required";
const native = selectProductionFastRepresentation({ question, turnPlan, families: [], problemIR: null, nativeSourceFallback: true });
assert(native?.figureSource === "native_source", "the fully proved source must skip independent model scene requests");
const original = structuredClone(native.sceneDocument);
const style = { schema: "scientific-style-lecture/v1", paletteId: "teal", sampleHash: "a".repeat(64) };
const trusted = parseScientificStyleLecture(style)!;
const styled = withScientificStyleNativeRepresentation({ figureSource: "native_source", sceneDocument: original }, style)!;
assert.notEqual(styled.sceneDocument, original);
assert.equal(original.source.scientificStyle, undefined, "styling does not mutate a shared source document");
assert.deepEqual(withScientificStyleNativeRepresentation({ figureSource: "fast_family", sceneDocument: original }, style),
  { figureSource: "fast_family", sceneDocument: original }, "existing verified family has priority over native styling");
const admit = (sceneDocument: unknown) => admitStoredScene({ sceneDocument, sceneQuestion: question, turnPlan,
  submittedTier: native.tier, scientificStyle: trusted });
const before = admit(original), after = admit(styled.sceneDocument);
assert(before.ok && after.ok, !after.ok ? after.message : !before.ok ? before.message : "");
assert.equal(after.presentation.diagram.id, "verified_scene", "styling keeps verified geometry authority");
assert.equal(after.presentation.diagram.promptAddon, before.presentation.diagram.promptAddon);
const stripPalette = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, item: unknown) => {
  if (key === "scientificPalette") return undefined;
  if (key === "visualStyle" && item && typeof item === "object" && Object.entries(item).every(([field, value]) => field === "scientificPalette" || value === undefined)) return undefined;
  return item;
}));
assert.deepEqual(stripPalette(after.presentation), stripPalette(before.presentation), "only fixed paint differs after server admission");
assert(after.presentation.diagram.commands.some(command => command.visualStyle?.scientificPalette === "teal"));
assert.deepEqual(stripPalette(after.presentation.diagram.deferredAnnotations), stripPalette(before.presentation.diagram.deferredAnnotations),
  "the same computed intersection labels wait until teaching finishes");
assert(after.presentation.diagram.deferredAnnotations?.some(entry => entry.revealAfter === "teaching_complete" &&
  entry.commands.some(command => command.text === "(3, 2)")), "the computed intersection must stay hidden during setup");
const untrusted = admitStoredScene({ sceneDocument: styled.sceneDocument, sceneQuestion: question, turnPlan, submittedTier: native.tier });
assert(untrusted.ok && untrusted.document.source.scientificStyle === undefined, "default public admission strips unbound sample claims");
const missingTiming = structuredClone(styled.sceneDocument);
delete missingTiming.source.answerLabelPrimitiveIds;
const timingRebuilt = admit(missingTiming);
assert(timingRebuilt.ok && timingRebuilt.presentation.diagram.deferredAnnotations?.some(entry => entry.revealAfter === "teaching_complete" &&
  entry.commands.some(command => command.text === "(3, 2)")), "omitting submitted staging cannot advance a source-derived answer");
const forgedTiming = structuredClone(styled.sceneDocument);
forgedTiming.source.answerLabelPrimitiveIds = ["made_up_answer"];
const forgedTimingRebuilt = admit(forgedTiming);
assert(forgedTimingRebuilt.ok && forgedTimingRebuilt.presentation.diagram.deferredAnnotations?.some(entry => entry.commands.some(command => command.text === "(3, 2)")),
  "forged staging cannot replace independently rebuilt answer timing");
const reopened = restoreVerifiedPresentationFromTurn({ question, sceneDocument: after.document,
  sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan, representationTier: after.tier, nonMetric: after.tier !== "exact_verified" } });
assert(reopened, "stored verified source can be reopened");
assert.deepEqual(reopened.diagram.commands, after.presentation.diagram.commands, "reopen retains the drawn native palette and geometry");
assert.deepEqual(reopened.diagram.deferredAnnotations, after.presentation.diagram.deferredAnnotations);
const tampered = structuredClone(styled.sceneDocument);
tampered.constructions[0]!.inputs.equations = ["x+y=999", "x-y=1"];
assert.equal(admit(tampered).ok, false, "a style receipt never authorizes changed scientific geometry");
console.log("scientific style replay: real source compile, existing-first, save/reopen, answer staging and tamper refusal pass");
