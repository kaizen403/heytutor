import { strict as assert } from "node:assert";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { isStoredCommandTrustedGeometry, parseStoredSegmentCommands, serializeSegmentCommands } from "@heytutor/drawing";
import { buildReplayTimeline } from "../../lib/replay/replayTimeline";
import { sourceCheckedStoredTurn } from "../../lib/scene/storedSceneSource";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import type { StoredTurn } from "../../lib/boards/boardsClient";

async function main(): Promise<void> {
  const question = "In Cartesian coordinates, A=(0,0), B=(3,4). Show the distance AB.";
  const plan = { schemaVersion: "turn-plan/v3", question, givens: [{ id: "ax", symbol: "ax", value: 0, provenance: "given", sourceText: "A=(0,0)" }, { id: "ay", symbol: "ay", value: 0, provenance: "given", sourceText: "A=(0,0)" }, { id: "bx", symbol: "bx", value: 3, provenance: "given", sourceText: "B=(3,4)" }, { id: "by", symbol: "by", value: 4, provenance: "given", sourceText: "B=(3,4)" }], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" };
  let checks = 0;
  for (const tier of ["exact_verified", "qualitative_verified", "question_representation"] as const) {
    for (const withPlan of tier === "exact_verified" ? [true] : [true, false]) {
      for (const sample of ["literal-correct", "ref-correct", "literal-mutant", "inline-with-correct-quantities", "ref-mutant", "same-distance-mutant", "false-context"] as const) {
        const q = sample === "false-context" ? `The statement "${question}" is false.` : question;
        const bound = sample === "ref-correct" || sample === "ref-mutant";
        const quantities = sample === "inline-with-correct-quantities" || bound ? plan.givens.map((g) => ({ id: g.id, value: sample === "ref-mutant" && g.id === "bx" ? 6 : g.value })) : [];
        const a = sample === "same-distance-mutant" ? { x: 3, y: 0 } : bound ? { x: "ax", y: "ay" } : { x: 0, y: 0 };
        const b = bound ? { x: "bx", y: "by" } : { x: sample.includes("mutant") || sample === "inline-with-correct-quantities" ? 6 : 3, y: 4 };
        const doc = { schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "bounded source control" }, source: { question: q, representationTier: tier, nonMetric: tier !== "exact_verified" }, quantities, entities: [{ id: "distance", kind: "segment", role: "distance AB" }], constructions: [{ id: "makeDistance", operator: "coordinate_distance", inputs: { a, b }, outputs: ["distance"] }], relations: [], assertions: [], annotations: [], requiredEntityIds: ["distance"], revealGroups: [{ id: "distanceGroup", entityIds: ["distance"], dependsOn: [], narrationCue: "distance AB" }], teachingTimeline: [] };
        const result = await canonicalizeTurnSceneMetadata({ question: q, sceneDocument: doc, visualStatus: "validated", sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: withPlan ? { ...plan, question: q } : null, representationTier: tier, nonMetric: tier !== "exact_verified", candidates: [], diagramResultStatus: "ready" }, segments: [] });
        const expected = sample === "literal-correct" || sample === "ref-correct";
        assert.equal(result.ok, expected, `${tier}/${withPlan}/${sample}: ${!result.ok ? result.error : "accepted"}`); checks++;
        if (!result.ok) continue;
        const value = result.value;
        const stored: StoredTurn = { id: "synthetic", orderIndex: 0, question: q, rawResponse: "", speedMultiplier: 1, traceId: null, ...value, segments: value.segments.map((segment) => ({ ...segment, command: serializeSegmentCommands(parseStoredSegmentCommands(segment.command), { trustedDiagramGeometry: isStoredCommandTrustedGeometry(segment.command) }), id: `s${segment.orderIndex}`, audioUrl: null, audioFormat: null, durationMs: segment.durationMs ?? null, timings: null })) };
        const timeline = buildReplayTimeline([stored]);
        assert.ok(timeline.cues.some((cue) => cue.trustedDiagramGeometry)); checks++;
        assert.ok(timeline.cues.flatMap((cue) => cue.commands).some((command) => command.type === "LABEL" && command.text === "d=5")); checks++;
        assert.ok(restoreVerifiedPresentationFromTurn(stored)); checks++;
        assert.equal(sourceCheckedStoredTurn(stored), stored); checks++;
        const legacyBad = { ...stored, sceneDocument: { ...doc, constructions: [{ ...doc.constructions[0]!, inputs: { a: { x: 0, y: 0 }, b: { x: 6, y: 4 } } }] } };
        assert.equal(buildReplayTimeline([legacyBad]).cues.flatMap((cue) => cue.commands).length, 0); checks++;
        assert.equal(restoreVerifiedPresentationFromTurn(legacyBad), null); checks++;
        const filtered = sourceCheckedStoredTurn(legacyBad);
        assert.equal(filtered.visualStatus, "retry_required"); checks++;
        assert.equal(filtered.segments.some((segment) => isStoredCommandTrustedGeometry(segment.command)), false); checks++;
        assert.equal(legacyBad.visualStatus, "validated"); checks++;
        const withWork: StoredTurn = { ...legacyBad, segments: [...legacyBad.segments, { id: "work", orderIndex: 99, narration: "work", spokenText: "work", command: serializeSegmentCommands([{ type: "CLEAR", params: [], charPosition: 0, narrationBefore: "" }, { type: "WRITE", params: [50, 100], text: "3^2+4^2=25", charPosition: 0, narrationBefore: "" }]), audioUrl: null, durationMs: 700, timings: null }] };
        const checkedWork = sourceCheckedStoredTurn(withWork);
        assert.deepEqual(checkedWork.segments.at(-1)!.command, withWork.segments.at(-1)!.command); checks++;
        assert.deepEqual(sourceCheckedStoredTurn(checkedWork), checkedWork); checks++;
        const falseSource = { ...stored, question: `The statement "${q}" is false.` };
        assert.equal(buildReplayTimeline([falseSource]).cues.flatMap((cue) => cue.commands).length, 0); checks++;
        assert.equal(restoreVerifiedPresentationFromTurn(falseSource), null); checks++;
        const malformed = { ...stored, sceneDocument: {} };
        assert.equal(buildReplayTimeline([malformed]).cues.flatMap((cue) => cue.commands).length, 0); checks++;
        assert.equal(restoreVerifiedPresentationFromTurn(malformed), null); checks++;
      }
    }
  }
  console.log(JSON.stringify({ gate: "HEY88-coordinate-persistence", checks, metadataRoundTripOnly: true, actualDBLiveSourceCohortAndTopicAcceptance: "not_claimed" }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
