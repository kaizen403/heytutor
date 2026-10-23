/** Whole-policy retry uses native validation; failed partial ink never renders. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileSceneDocument, getLabelTransactionDiagnostics } from "../../src/compile/compiler";
import type { SceneDocument } from "../../src/types";
const fixture = JSON.parse(readFileSync(new URL("./fixtures/label-placement-coverage-transactions.json", import.meta.url), "utf8")) as {
  records: Array<{ id: string; document: SceneDocument }>;
};
const documentFor = (id: string): SceneDocument => structuredClone(fixture.records.find(item => item.id === id)!.document);
const failures: string[] = [];
let passed = 0;
function check(name: string, body: () => void): void {
  try { body(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
for (const id of ["crowded-dimension-callout", "crowded-native-path-names"]) check(`complete native transaction ${id}`, () => {
  const document = documentFor(id);
  const before = JSON.stringify(document);
  const result = compileSceneDocument(document);
  assert.ok(result.ok && result.renderScene && result.report.valid, JSON.stringify(result.report.issues));
  assert.equal(JSON.stringify(document), before);
  const diagnostics = getLabelTransactionDiagnostics(result)!;
  assert.equal(diagnostics.selectedPolicy, "native");
  assert.equal(diagnostics.attempts.length, 2, "one additional complete attempt only");
  const [attached, native] = diagnostics.attempts;
  assert.equal(attached!.result.renderScene, null, "failed enhanced placements never render");
  assert.equal(attached!.retryable, true);
  assert.equal(native!.result, result, "the entire valid native attempt is returned");
  assert.deepEqual(native!.physicalInk, attached!.physicalInk);
  assert.equal(diagnostics.physicalInkMatches, true);
  assert.equal(diagnostics.searchWork, diagnostics.attempts.reduce((sum, attempt) => sum + attempt.searchWork, 0));
  assert.equal(diagnostics.solverCalls, diagnostics.attempts.reduce((sum, attempt) => sum + attempt.solverCalls, 0));
  assert.ok(diagnostics.elapsedMs >= diagnostics.attempts.reduce((sum, attempt) => sum + attempt.elapsedMs, 0));
  console.log(`MEASURE ${id} ${JSON.stringify({ elapsedMs: diagnostics.elapsedMs, searchWork: diagnostics.searchWork, solverCalls: diagnostics.solverCalls, attempts: diagnostics.attempts.map(attempt => ({ policy: attempt.policy, elapsedMs: attempt.elapsedMs, searchWork: attempt.searchWork, solverCalls: attempt.solverCalls })) })}`);
});
// Angle wedge relocation and value callouts on strokes were cut from this
// port. A relocating attempt is selected only when its ownership comparison
// with MAIN's complete placement is clean; otherwise MAIN's placement stands.
for (const id of ["crowded-path-callouts", "fixed-font-narrow-wedge"]) check(`attached placement needs a clean MAIN comparison ${id}`, () => {
  const result = compileSceneDocument(documentFor(id));
  assert.ok(result.ok && result.renderScene && result.report.valid, JSON.stringify(result.report.issues));
  const diagnostics = getLabelTransactionDiagnostics(result)!;
  const [attached, native] = diagnostics.attempts;
  assert.equal(attached!.policy, "attached");
  if (!attached!.modified) { assert.equal(diagnostics.attempts.length, 1); return; }
  assert.equal(native!.policy, "native", "a relocating attempt is compared with MAIN's complete placement");
  assert.ok(diagnostics.ownershipDelta, "the comparison is recorded");
  assert.equal(diagnostics.selectedPolicy, diagnostics.ownershipDelta.ok && diagnostics.physicalInkMatches ? "attached" : "native");
  assert.equal(result, diagnostics.selectedPolicy === "attached" ? attached!.result : native!.result);
  console.log(`MEASURE ${id} ${JSON.stringify(diagnostics.ownershipDelta)}`);
});
check("native invalid companion stays atomic after enhanced label failure", () => {
  const document = documentFor("fixed-font-narrow-wedge");
  document.annotations.push({ id: "missing_axis_text", kind: "label", targetIds: ["axis"] });
  document.assertions.push({ id: "required_native_axis_label", predicate: "label_attached", entities: ["axis"], expected: true, severity: "fatal" });
  const result = compileSceneDocument(document);
  const diagnostics = getLabelTransactionDiagnostics(result)!;
  assert.equal(result.ok, false);
  assert.equal(result.renderScene, null);
  assert.equal(diagnostics.selectedPolicy, null);
  assert.equal(diagnostics.attempts.length, 2, "enhanced failure reaches independently invalid native attempt");
  const native = diagnostics.attempts[1]!;
  assert.equal(native.policy, "native");
  assert.equal(native.result.ok, false);
  assert.equal(native.result.renderScene, null);
  assert.ok(native.result.report.issues.some(issue => issue.code === "label_unattached" && issue.entityIds?.includes("axis")));
});
check("authority rejection receives no label-policy retry", () => {
  const document = documentFor("fixed-font-narrow-wedge");
  document.assertions[0]!.entities = ["axis", "upper"]; // Parallel source lines cannot certify perpendicularity.
  const result = compileSceneDocument(document);
  assert.equal(result.ok, false);
  assert.equal(result.renderScene, null);
  assert.equal(getLabelTransactionDiagnostics(result)!.attempts.length, 1);
});
check("append proposal uses its base document's label policy", () => {
  for (const id of ["fixed-font-narrow-wedge", "crowded-dimension-callout"]) {
    const base = documentFor(id);
    const basePolicy = getLabelTransactionDiagnostics(compileSceneDocument(structuredClone(base)))!.selectedPolicy;
    assert.ok(basePolicy, `${id} base document draws`);
    const document = structuredClone(base);
    const target = document.entities.find(entity => entity.kind === "segment" || entity.kind === "line" || entity.kind === "vector")!;
    document.annotations.push({ id: "appended_note", kind: "label", targetIds: [target.id], text: "note", labelMode: "append" });
    const attempts = getLabelTransactionDiagnostics(compileSceneDocument(document))!.attempts;
    assert.equal(attempts[0]!.policy, basePolicy, `${id}: existing placements keep the policy that drew them`);
    if (!attempts[0]!.result.ok) assert.equal(attempts.length, 1, `${id}: a failed append proposal is never retried`);
  }
});
check("structurally invalid append proposal cannot invoke outer retry", () => {
  const document = documentFor("crowded-path-callouts");
  Object.assign(document.annotations[0]!, { labelMode: "append" });
  const result = compileSceneDocument(document);
  assert.equal(result.ok, false);
  assert.equal(result.renderScene, null);
  assert.equal(getLabelTransactionDiagnostics(result)!.attempts.length, 1);
});
check("malformed documents preserve structural rejection without throwing", () => {
  for (const raw of [null, undefined,
    Object.assign(documentFor("fixed-font-narrow-wedge"), { annotations: {} }),
    Object.assign(documentFor("fixed-font-narrow-wedge"), { annotations: [null] }),
  ]) {
    const result = Reflect.apply(compileSceneDocument, undefined, [raw]);
    assert.equal(result.ok, false);
    assert.equal(result.renderScene, null);
    assert.equal(getLabelTransactionDiagnostics(result)!.attempts.length, 1);
  }
});
check("enclosed native-name leader cannot claim enhanced policy", () => {
  const oracle = JSON.parse(readFileSync(new URL("./fixtures/label-placement-native-leader-fallback.json", import.meta.url), "utf8")) as {
    document: SceneDocument; nativeRenderScene: unknown;
  };
  const result = compileSceneDocument(structuredClone(oracle.document));
  assert.ok(result.ok && result.renderScene && result.report.valid);
  assert.equal(JSON.stringify(result.renderScene), JSON.stringify(oracle.nativeRenderScene), "the entire independently compiled MAIN render is retained");
  const diagnostics = getLabelTransactionDiagnostics(result)!;
  assert.equal(diagnostics.selectedPolicy, "native", "a physical contour crossing cannot be called an enhanced attached leader");
  assert.equal(diagnostics.attempts.length, 2);
  assert.equal(diagnostics.attempts[0]!.result.renderScene, null);
  assert.deepEqual(diagnostics.attempts[0]!.physicalInk, diagnostics.attempts[1]!.physicalInk);
  const contour = result.renderScene.primitives.find(primitive => primitive.entityId === "frame")!;
  const leader = result.renderScene.primitives.find(primitive => primitive.provenance?.labelLeader === true)!;
  assert.ok(contour && leader && leader.points.length === 2);
  const top = Math.min(...contour.points.map(point => point.y));
  const bottom = Math.max(...contour.points.map(point => point.y));
  assert.ok(leader.points[0]!.y > top && leader.points[0]!.y < bottom && leader.points[1]!.y < top,
    "the exact legacy leader crosses the supplied enclosing contour, so its native-only policy matters");
});
console.log(`label placement transactions: ${passed}/${passed + failures.length} passed`);
if (failures.length) process.exitCode = 1;
