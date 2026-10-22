/** Completion outcomes are historical diagnostics, preserved through live/lab capture and save/reopen. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compileSceneDocument, type SceneCompletionDiagnosticsV3, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { selectProductionScene, validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";

const question = "Show the labelled points A and B.";
const turnPlan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3", question, visualRequirement: "required",
  givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [],
};
const document: SceneDocument = {
  schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "labelled points" },
  source: { question, nonMetric: true, representationTier: "qualitative_verified" }, quantities: [],
  entities: [{ id: "A", kind: "point", role: "given point", label: "A" }, { id: "B", kind: "point", role: "given point", label: "B" }],
  constructions: [
    { id: "makeA", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["A"] },
    { id: "makeB", operator: "point", inputs: { x: 4, y: 3, coordinateSpace: "world" }, outputs: ["B"] },
  ],
  relations: [], assertions: [], annotations: [], requiredEntityIds: ["A", "B"],
  revealGroups: [{ id: "setup", entityIds: ["A", "B"], dependsOn: [], narrationCue: "Show the given points." }], teachingTimeline: [],
};
const rejected: SceneCompletionDiagnosticsV3 = {
  adopted: false,
  additions: [{ id: "proposed_mass", kind: "given_label", quantityIds: ["mass"], targetIds: ["A"], text: "m = 7.5 kg" }],
  skipped: [{ code: "quantity_owner_conflict", quantityId: "charge", entityIds: ["A", "B"] }],
  rejection: "completion admission changed existing geometry or label information: preserve the complete reason",
};
const skipped: SceneCompletionDiagnosticsV3 = { adopted: false, additions: [], skipped: [{ code: "annotation_scalar_carrier_has_no_region_owner", quantityId: "index", entityIds: ["interface"] }] };
const unchanged: SceneCompletionDiagnosticsV3 = { adopted: false, additions: [], skipped: [] };

async function main(): Promise<void> {
  const compiled = compileSceneDocument(document);
  assert.ok(compiled.ok && compiled.renderScene, "diagnostic fixture must compile natively");
  const failures: string[] = [];
  let checks = 0;
  for (const [name, completion] of [["rejected proposal", rejected], ["skipped proposal", skipped], ["unchanged proposal", unchanged], ["completion not attempted", undefined]] as const) {
    try {
      const submitted = {
        question, sceneDocument: document, visualStatus: "validated", segments: [],
        sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan, representationTier: "qualitative_verified", nonMetric: true,
          figureSource: "planner", candidates: [], diagramResultStatus: "ready", completion },
      };
      const saved = await canonicalizeTurnSceneMetadata(JSON.parse(JSON.stringify(submitted)));
      assert.ok(saved.ok, `${name}: native canonical save must accept the valid original figure`);
      assert.deepEqual(saved.value.sceneArtifacts?.completion, completion,
        `${name}: complete outcome, additions, skipped details and rejection survive canonical save`);
      const reopened = await canonicalizeTurnSceneMetadata(JSON.parse(JSON.stringify({ ...saved.value, question })));
      assert.ok(reopened.ok, `${name}: native canonical reopen must accept`);
      assert.deepEqual(reopened.value.sceneArtifacts?.completion, completion,
        `${name}: complete diagnostics survive reopen`);
      assert.deepEqual(reopened.value.sceneDocument, saved.value.sceneDocument, `${name}: diagnostics cannot change accepted geometry`);
      checks++;
    } catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
  }

  for (const [name, visualStatus, completion, expected] of [
    ["text-only diagnostics", "text_only", rejected, rejected],
    ["malformed diagnostics are not trusted", "validated", { ...rejected, adopted: "yes" }, undefined],
  ] as const) {
    try {
      const saved = await canonicalizeTurnSceneMetadata({ question, sceneDocument: document, visualStatus, segments: [],
        sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan, representationTier: "qualitative_verified", nonMetric: true,
          figureSource: "planner", candidates: [], diagramResultStatus: "ready", completion } });
      assert.ok(saved.ok, `${name}: diagnostics do not invalidate a valid save`);
      assert.deepEqual(saved.value.sceneArtifacts?.completion, expected, `${name}: canonical diagnostics match their valid shape`);
      const reopened = await canonicalizeTurnSceneMetadata(JSON.parse(JSON.stringify({ ...saved.value, question })));
      assert.ok(reopened.ok, `${name}: canonical reopen succeeds`);
      assert.deepEqual(reopened.value.sceneArtifacts?.completion, expected, `${name}: the canonical outcome survives reopen`);
      checks++;
    } catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
  }

  try {
    // The native gate exposes fixture JSON without executing its assertions.
    const fixtures = JSON.parse(execFileSync(process.execPath, ["--import", "tsx",
      join(__dirname, "../../../../packages/scene-engine/scripts/verify/verify-completion-right-angles.ts"), "--print-fixtures"],
    { cwd: join(__dirname, "../.."), encoding: "utf8", env: { ...process.env, TSX_TSCONFIG_PATH: join(__dirname, "../../tsconfig.json") } })) as Array<{ kind: string; document: SceneDocument; turnPlan: TurnPlanV3 }>;
    for (const kind of ["valid", "fit-shift"]) {
      const fixture = fixtures.find(candidate => candidate.kind === kind);
      assert.ok(fixture, "native right-angle fixture is available");
      // Live admission requires readable ink; name the existing reference line.
      fixture.document.entities.find(entity => entity.id === "base")!.label = "l";
      const validation = validateProductionSceneCandidate({ candidate: fixture.document as unknown as Record<string, unknown>,
        question: fixture.turnPlan.question, turnPlan: fixture.turnPlan });
      assert.ok(validation.valid && validation.value, `right-angle baseline passes production: ${JSON.stringify(validation.errors)}`);
      const selection = selectProductionScene({ question: fixture.turnPlan.question, turnPlan: fixture.turnPlan, problemIR: null,
        fastRepresentation: { tier: "qualitative_verified", nonMetric: true, figureSource: "planner", reason: "native perpendicular setup",
          sceneDocument: validation.value.document, renderScene: validation.value.renderScene, validationReport: validation.value.report }, completionEnabled: true });
      assert.ok(selection.representation && selection.completion,
        `right-angle result crosses native production selection: ${JSON.stringify(selection.completion)}; ${selection.reason}`);
      assert.equal(selection.completion.adopted, kind === "valid", `${kind}: only the unchanged-fit right angle is adopted`);
      const addition = selection.completion.additions.find(candidate => candidate.kind === "right_angle");
      if (kind === "valid") assert.ok(addition, "adopted diagnostics retain the actual right-angle addition");
      else {
        assert.deepEqual(selection.representation.sceneDocument, validation.value.document, "fit-shift refusal retains the original figure");
        assert.ok(selection.completion.skipped.some(skip => skip.code === "right_angle_changes_existing_geometry"), "fit-shift refusal retains its native reason");
      }
      const saved = await canonicalizeTurnSceneMetadata({ question: fixture.turnPlan.question, sceneDocument: selection.representation.sceneDocument,
        visualStatus: "validated", segments: [], sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: fixture.turnPlan,
          representationTier: selection.representation.tier, nonMetric: selection.representation.nonMetric, figureSource: "planner", candidates: [],
          diagramResultStatus: "ready", completion: selection.completion } });
      assert.ok(saved.ok, "adopted right-angle scene saves through the native canonicalizer");
      const reopened = await canonicalizeTurnSceneMetadata(JSON.parse(JSON.stringify({ ...saved.value, question: fixture.turnPlan.question })));
      assert.ok(reopened.ok && reopened.value.sceneDocument, "adopted right-angle scene reopens");
      assert.deepEqual(reopened.value.sceneArtifacts?.completion, selection.completion,
        "actual adopted outcome, additions and skipped records survive reopen");
      const rendered = compileSceneDocument(reopened.value.sceneDocument);
      assert.ok(rendered.ok && rendered.renderScene, "right-angle result reopens as native geometry");
      if (addition) assert.ok(rendered.renderScene.primitives.some(primitive => primitive.entityId === addition.id && primitive.kind !== "label"),
        "the reported adopted right angle survives reopen as native geometry");
      checks++;
    }
  } catch (error) { failures.push("native right-angle adoption round trip"); console.error(`FAIL native right-angle adoption round trip: ${error instanceof Error ? error.message : String(error)}`); }

  // Execute the actual caller capture statements, as the existing selection-parity
  // gate does, without mounting React or running the provider-backed lesson loop.
  for (const [name, relative, live] of [
    ["live artifact capture", "../../features/tutor-session/hooks/turn/useQuestionHandler.ts", true],
    ["lab run capture", "../lecture-lab/lecturePipeline.ts", false],
  ] as const) {
    try {
      const source = readFileSync(join(__dirname, relative), "utf8");
      const capture = source.split("completion-diagnostics:begin")[1]?.split("completion-diagnostics:end")[0];
      assert.ok(capture, `${name}: actual caller capture is present`);
      const body = capture.replace(/\/\/[^\n]*/g, "");
      for (const completion of [rejected, skipped, unchanged, undefined]) {
        const run = { diagram: {} as { completion?: unknown } };
        const captured = live
          ? new Function("sceneSelection", `return ({ ${body} });`)({ completion }).completion
          : (new Function("sceneSelection", "run", body)({ completion }, run), run.diagram.completion);
        assert.deepEqual(captured, completion, `${name}: caller retains full diagnostics`);
      }
      checks++;
    } catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  console.log(`structured-completion diagnostics: ${checks}/10 checks passed`);
  assert.deepEqual(failures, [], "completion diagnostic outcomes must remain available after capture and reopen");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
