import assert from "node:assert/strict";
import { compileSceneDocument, completeSceneDocument, validateSceneDocument, validateTurnPlanV3, type SceneDocument, type TurnPlanV3 } from "../../src/index";

function fixture(kind: "valid" | "nonincident" | "existing" | "split" | "fit-shift") {
  const question = "Draw a line and its perpendicular through their common point O.";
  const turnPlan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [], unknowns: [], derived: [], lawIds: [], assumptions: [],
    qualitativeClaims: [{ id: "orthogonal", claim: "The two lines are perpendicular", expected: "perpendicular", relatedQuantityIds: [] }] };
  const document: SceneDocument = {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "perpendicular incidence" }, source: { question, nonMetric: true }, quantities: [],
    entities: ["L", "R", "O"].map(id => ({ id, kind: "point", role: "construction helper" })).concat([
      { id: "base", kind: kind === "fit-shift" ? "line" : "segment", role: "reference line" }, { id: "perp", kind: "line", role: "perpendicular line" },
    ]),
    constructions: [
      { id: "make_L", operator: "point", inputs: { x: -2, y: 0, coordinateSpace: "world" }, outputs: ["L"] },
      { id: "make_R", operator: "point", inputs: { x: 3, y: 0, coordinateSpace: "world" }, outputs: ["R"] },
      { id: "make_O", operator: "point", inputs: { x: 0, y: kind === "nonincident" ? 1 : 0, coordinateSpace: "world" }, outputs: ["O"] },
      { id: "make_base", operator: kind === "fit-shift" ? "line" : "segment", inputs: { start: "L", end: "R" }, outputs: ["base"] },
      { id: "make_perp", operator: "perpendicular_through", inputs: { through: "O", line: "base" }, outputs: ["perp"] },
    ], annotations: [], relations: [], assertions: [], requiredEntityIds: ["base", "perp"],
    revealGroups: [{ id: "setup", entityIds: ["L", "R", "O", "base", ...(kind === "split" ? [] : ["perp"])], dependsOn: [], narrationCue: "Show the lines." }], teachingTimeline: [],
  };
  if (kind === "split") document.revealGroups.push({ id: "second", entityIds: ["perp"], dependsOn: ["setup"], narrationCue: "Show the perpendicular." });
  if (kind === "existing") {
    document.entities.push({ id: "old_mark", kind: "right_angle_mark", role: "existing incidence mark" });
    document.constructions.push({ id: "make_old_mark", operator: "right_angle_mark", inputs: { vertex: "O", a: "L", b: "perp" }, outputs: ["old_mark"] });
    document.requiredEntityIds.push("old_mark"); document.revealGroups[0]!.entityIds.push("old_mark");
  }
  return { kind, document, turnPlan };
}

const fixtures = (["valid", "nonincident", "existing", "split", "fit-shift"] as const).map(fixture);
if (process.argv.includes("--print-fixtures")) {
  console.log(JSON.stringify(fixtures));
} else {
  for (const { kind, document, turnPlan } of fixtures) {
    assert.ok(validateTurnPlanV3(turnPlan, turnPlan.question).valid, `${kind}: supported qualitative plan`);
    const validated = validateSceneDocument(document); assert.ok(validated.document, JSON.stringify(validated.report.issues));
    const baseline = compileSceneDocument(validated.document);
    assert.ok(baseline.ok && baseline.renderScene, `${kind}: baseline must draw: ${JSON.stringify(baseline.report.issues)}`);
    const result = completeSceneDocument(validated.document, { enabled: true, turnPlan, baseRenderScene: baseline.renderScene });
    if (kind !== "valid") {
      assert.deepEqual(result.additions, [], `${kind}: unsafe, duplicate or separately revealed right angle must not be added`);
      assert.equal(result.document, validated.document);
      assert.ok(result.skipped.some(s => s.code === ({ nonincident: "right_angle_native_proof_failed", existing: "right_angle_already_present", split: "ambiguous_right_angle_scope", "fit-shift": "right_angle_changes_existing_geometry" }[kind])));
      continue;
    }
    assert.equal(result.additions.length, 1, "proved perpendicular incidence must produce one right-angle mark");
    const addition = result.additions[0]!; assert.equal(addition.kind, "right_angle");
    assert.deepEqual(addition.targetIds, ["base", "perp"]);
    assert.deepEqual(result.document.entities.slice(0, document.entities.length), document.entities);
    assert.deepEqual(result.document.constructions.slice(0, document.constructions.length), document.constructions);
    assert.equal(result.document.constructions.at(-1)!.operator, "right_angle_mark");
    assert.equal(result.document.assertions.filter(a => a.severity === "fatal" && a.predicate === "perpendicular").length, 1);
    assert.equal(result.document.assertions.filter(a => a.severity === "fatal" && a.predicate === "on").length, 2);
    const compiled = compileSceneDocument(result.document); assert.ok(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
    assert.ok(compiled.renderScene.primitives.some(p => p.entityId === addition.id && p.kind !== "label"), "right angle survives as native geometry");
    for (const prior of baseline.renderScene.primitives.filter(p => p.kind !== "label" && !p.provenance?.labelLeader))
      assert.deepEqual(compiled.renderScene.primitives.find(p => p.id === prior.id), prior, "right angle preserves old geometry");
    const second = completeSceneDocument(result.document, { enabled: true, turnPlan, baseRenderScene: compiled.renderScene });
    assert.deepEqual(second.additions, [], "native right-angle completion is idempotent");
    assert.deepEqual(second.document, result.document);
  }
  console.log("completion-right-angles: 5/5 passed");
}
