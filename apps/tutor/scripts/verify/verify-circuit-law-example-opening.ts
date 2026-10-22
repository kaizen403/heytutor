/** Actual public producer -> normal compiler -> unchanged app opening/completion.
 * --source-producer is explicitly a pre-build source check, never built proof. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import * as built from "../../../../packages/scene-engine/dist/index.js";
import { getSegmentCommands, type DrawCommand } from "../../../../packages/drawing/dist/index.js";
import type { SceneDocument } from "../../../../packages/scene-engine/src/types";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { completeStoredTurnDiagram } from "../../features/tutor-session/lib/replay/completeReplayDiagram";
import fixtures from "../../../../packages/scene-engine/scripts/verify/fixtures/chemistry-f4-circuit-law-example.json";

async function main(): Promise<void> {
  const sourceMode = process.argv.includes("--source-producer");
  const engine = sourceMode ? await import("../../../../packages/scene-engine/src/index") : built;
  type Produced = NonNullable<ReturnType<typeof built.synthesizeFamilyScene>>;
  type Presentation = ReturnType<typeof buildVerifiedDiagramPresentation>;
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

  function normalCompile(result: Produced) {
    const validated = engine.validateSceneDocument(engine.pruneDeadSceneEntities({ ...result.document }));
    assert.ok(validated.document, "ordinary structural validation");
    const compiled = engine.compileSceneDocument(validated.document);
    assert.ok(compiled.ok && compiled.renderScene, "ordinary complete compilation");
    return { document: validated.document, renderScene: compiled.renderScene };
  }

  function labelKey(entityId: string | undefined, primitiveId: string | undefined, text: string | undefined): string {
    return JSON.stringify({ entityId, primitiveId, text });
  }

  function commandLabels(commands: DrawCommand[]): string[] {
    return commands.filter(command => command.type === "LABEL")
      .map(command => labelKey(command.semanticRef?.entityId, command.semanticRef?.primitiveId, command.text)).sort();
  }

  function physicalCommands(commands: DrawCommand[]): string[] {
    return commands.map(command => JSON.stringify({ ...command,
      charPosition: 0, narrationBefore: "", spokenCue: undefined,
    })).sort();
  }

  function withoutCues(document: SceneDocument): SceneDocument {
    const value = clone(document);
    for (const group of value.revealGroups) group.narrationCue = "";
    for (const beat of value.teachingTimeline) beat.narrationIntent = "";
    return value;
  }

  async function complete(question: string, document: SceneDocument, presentation: Presentation) {
    const opening = presentation.introSegments.flatMap(getSegmentCommands);
    const full = [...opening];
    const turn: StoredTurn = {
      id: "law-opening-gate", orderIndex: 0, question, rawResponse: "", speedMultiplier: 1,
      traceId: null, sceneDocument: document, sceneEngineVersion: null, validationReport: null,
      visualStatus: "validated", status: "complete", kind: "lesson", segments: [], sceneArtifacts: null,
    };
    await completeStoredTurnDiagram({
      turn, diagram: presentation.diagram,
      executeCommand: async command => { full.push(command); }, shouldCancel: () => false,
    });
    return { opening, full };
  }

  const sourceResults: Array<{ passed: boolean; [key: string]: unknown }> = [];
  const openingResults: Array<{ passed: boolean; [key: string]: unknown }> = [];
  let failures = 0;
  for (const gold of fixtures) {
    const records: unknown[] = [];
    let ordinary: Produced | null = null;
    try {
      for (const route of ["ordinary", "lastResort"] as const) {
        const result = route === "ordinary" ? engine.synthesizeFamilyScene({ question: gold.question })
          : engine.synthesizeLastResortScene({ question: gold.question });
        records.push({ route, result });
        assert.equal(!!result, gold.draw, `${gold.id}/${route}: original whole source obligation`);
        if (result) {
          assert.equal(result.document.source.question, gold.question);
          normalCompile(result);
        }
        if (route === "ordinary") ordinary = result;
      }
      sourceResults.push({ id: gold.id, passed: true, records });
    } catch (error) {
      failures++;
      sourceResults.push({ id: gold.id, passed: false, error: String(error), records });
      continue;
    }
    if (gold.mode !== "example") continue;
    assert.ok(ordinary);
    const actual = normalCompile(ordinary);
    assert.deepEqual(actual.document.quantities, [], "symbolic example contains no numeric givens");
    const requiredLabels = actual.renderScene.primitives.filter(mark => mark.kind === "label")
      .map(mark => labelKey(mark.entityId, mark.id, mark.text)).sort();
    assert.ok(requiredLabels.length > 0, "non-vacuous actual compiled label inventory");
    const baseline = built.synthesizeFamilyScene({ question: gold.question });
    assert.ok(baseline);
    for (const language of ["english", "hinglish"] as const) {
      let details: unknown;
      try {
        const options = { originalQuestion: gold.question, figureFamily: ordinary.family,
          ...(language === "hinglish" ? { narrationLanguage: "hinglish" as const } : {}) };
        const presentation = buildVerifiedDiagramPresentation(actual.document, actual.renderScene, options);
        const commands = await complete(gold.question, actual.document, presentation);
        const wire = clone(actual);
        const reopened = buildVerifiedDiagramPresentation(wire.document, wire.renderScene, options);
        const reopenedCommands = await complete(gold.question, wire.document, reopened);
        const baselineCompile = built.compileSceneDocument(baseline.document);
        assert.ok(baselineCompile.ok && baselineCompile.renderScene);
        const original = buildVerifiedDiagramPresentation(baseline.document, baselineCompile.renderScene, options);
        const originalCommands = await complete(gold.question, baseline.document, original);
        const remaining = commandLabels(commands.opening);
        const missing: string[] = [];
        for (const key of requiredLabels) {
          const index = remaining.indexOf(key);
          if (index < 0) missing.push(key); else remaining.splice(index, 1);
        }
        details = { document: actual.document, renderScene: actual.renderScene, presentation, requiredLabels,
          missingLabels: missing.map(key => JSON.parse(key)), openingCommands: commands.opening,
          fullCommands: commands.full, jsonReopenedCommands: reopenedCommands.full };
        assert.deepEqual(commandLabels(commands.full), requiredLabels, "full completion preserves every actual label exactly once");
        assert.deepEqual(clone(presentation), clone(reopened), "JSON readaptation preserves entire presentation");
        assert.deepEqual(clone(commands), clone(reopenedCommands), "JSON readaptation preserves all actual commands");
        assert.deepEqual(withoutCues(actual.document), withoutCues(baseline.document), "cue does not change source graph or labels");
        assert.deepEqual(clone(actual.renderScene.primitives), clone(baselineCompile.renderScene.primitives), "all native paint unchanged");
        assert.deepEqual(clone(actual.renderScene.entityBounds), clone(baselineCompile.renderScene.entityBounds), "all native bounds unchanged");
        assert.deepEqual(physicalCommands(commands.full), physicalCommands(originalCommands.full), "full physical payload unchanged");
        assert.deepEqual(physicalCommands(reopenedCommands.full), physicalCommands(originalCommands.full), "reopened physical payload unchanged");
        assert.deepEqual(missing, [], `${gold.id}/${language}: every compiled entity/primitive/text label multiplicity must open`);
        openingResults.push({ id: gold.id, question: gold.question, language, passed: true, details });
      } catch (error) {
        failures++;
        openingResults.push({ id: gold.id, question: gold.question, language, passed: false, error: String(error), details });
      }
    }
  }
  assert.equal(fixtures.length, 20, "original source corpus remains complete");
  assert.equal(openingResults.length, 18, "nine actual example questions in both languages");
  const report = { mode: sourceMode ? "source-producer-pre-build" : "own-built-public-producer",
    sourceResults, openingResults, failures, scope: "Real producer/compiler/app opening/completion and JSON re-adaptation; no canonical persistence or native admission claim." };
  const out = process.argv.indexOf("--out");
  if (out >= 0) writeFileSync(process.argv[out + 1]!, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ mode: report.mode, sourcePassed: sourceResults.filter(row => row.passed).length,
    openingPassed: openingResults.filter(row => row.passed).length, openingCases: openingResults.length, failures }));
  process.exitCode = failures ? 1 : 0;
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
