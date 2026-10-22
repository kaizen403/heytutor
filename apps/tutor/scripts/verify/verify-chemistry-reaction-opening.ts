/** Actual source-computed molecules must reveal atom identity with their bond skeleton. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type * as E from "@heytutor/scene-engine";
import { getSegmentCommands, type VerifiedDiagramCommand, type VerifiedDiagramReveal } from "@heytutor/drawing";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";

async function main(): Promise<void> {
const sourceMode = process.argv.includes("--source-producer");
const engine: typeof E = await import(new URL(sourceMode ? "../../../../packages/scene-engine/src/index.ts" : "../../../../packages/scene-engine/dist/index.js", import.meta.url).href);
interface Row { id: string; question: string; draw: boolean }
const rows = JSON.parse(fs.readFileSync(new URL("../../../../packages/scene-engine/scripts/verify/fixtures/chemistry-source-reaction-products.json", import.meta.url), "utf8")) as Row[];
const baselineAt = process.argv.indexOf("--baseline");
interface PaintBaseline { id: string; route: string; language: string; primitives: unknown; quantities: unknown }
const baseline = baselineAt < 0 ? [] : (JSON.parse(fs.readFileSync(path.resolve(process.argv[baselineAt + 1]!), "utf8")) as { results: PaintBaseline[] }).results;
const results: unknown[] = [];
let failed = 0;
for (const row of rows.filter(row => row.draw)) for (const [route, produce] of [["ordinary", engine.synthesizeFamilyScene], ["last", engine.synthesizeLastResortScene]] as const) for (const language of ["english", "hinglish"] as const) {
  const actual = produce({ question: row.question, families: ["chem_organic"] });
  let error: string | null = null;
  let presentation: ReturnType<typeof buildVerifiedDiagramPresentation> | null = null;
  try {
    assert.ok(actual, "actual public producer must compile");
    const plan: E.TurnPlanV3 = { schemaVersion: "turn-plan/v3", question: row.question, givens: [], unknowns: [{ id: "requested_count", symbol: "N" }], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" };
    const document = engine.deferVerifiedAnswerLabels(actual.document, plan, actual.renderScene);
    presentation = buildVerifiedDiagramPresentation(document, actual.renderScene, { figureFamily: actual.family, narrationLanguage: language });
    const atomLabels = document.entities.filter(entity => entity.kind === "label" && /^(?:reactant|product)_(?:a|h)\d+$/.test(entity.id));
    assert.ok(atomLabels.length, "connected molecular figure has explicit atom identity");
    for (const entity of atomLabels) {
      const marks: E.RenderPrimitive[] = actual.renderScene.primitives.filter(mark => mark.entityId === entity.id && mark.kind === "label");
      assert.ok(marks.length, `normal compiled atom ${entity.id}`);
      const groupId = marks[0]!.groupId;
      const reveal: VerifiedDiagramReveal | undefined = presentation.diagram.reveals.find(beat => beat.targetId === groupId);
      assert.ok(reveal, `molecule skeleton group ${groupId} is revealed`);
      const commands: VerifiedDiagramCommand[] = reveal.commandIndices.map(index => presentation!.diagram.commands[index]!);
      assert.ok(commands.some(command => command.type === "DRAW_LINE"), "same beat contains actual molecular bonds");
      for (const mark of marks) assert.equal(commands.filter(command => command.type === "LABEL" && command.semanticRef?.entityId === entity.id && command.semanticRef?.primitiveId === mark.id && command.text === mark.text).length, 1, `atom identity ${entity.id}/${mark.text} must co-reveal exactly once with bonds`);
      assert.equal(entity.semantic?.labelRequired, true, `atom identity ${entity.id} is mandatory structural ink`);
    }
    const opening = presentation.introSegments.flatMap(getSegmentCommands);
    const answerIds = new Set(document.revealGroups.find(group => group.id === "reaction_answer")?.entityIds ?? []);
    assert.ok(!opening.some(command => command.type === "LABEL" && answerIds.has(command.semanticRef?.entityId ?? "")), "computed count/carbon answers remain deferred");
    const old = baseline.find(item => item.id === row.id && item.route === route && item.language === language);
    if (baselineAt >= 0) {
      assert.ok(old, "original before payload is present");
      assert.deepEqual(JSON.parse(JSON.stringify(actual.renderScene.primitives)), old.primitives, "all full compiled geometry/labels/paint remain exact");
      assert.deepEqual(JSON.parse(JSON.stringify(actual.document.quantities)), old.quantities, "all declared source/count quantities remain exact");
    }
  } catch (caught) { failed++; error = String(caught); }
  results.push({ id: row.id, route, language, question: row.question, error, primitives: actual?.renderScene.primitives, quantities: actual?.document.quantities, document: actual?.document, presentation });
}
const outAt = process.argv.indexOf("--out");
if (outAt >= 0) fs.writeFileSync(path.resolve(process.argv[outAt + 1]!), JSON.stringify({ mode: sourceMode ? "source-producer" : "built-producer", checks: results.length, failed, results }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ mode: sourceMode ? "source-producer" : "built-producer", checks: results.length, passed: results.length - failed, failed }));
if (failed) process.exitCode = 1;
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
