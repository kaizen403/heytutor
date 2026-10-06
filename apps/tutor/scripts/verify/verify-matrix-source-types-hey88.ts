import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseStoredSegmentCommands, serializeSegmentCommands, isStoredCommandTrustedGeometry } from "@heytutor/drawing";
import { inferSceneCapabilities } from "@heytutor/tutor-core";
import { shouldAttemptExactScene } from "../../features/tutor-session/lib/scene/diagramGeneration";
import { selectVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { compileSceneDocument, validateMatrixSourceBinding, pruneDeadSceneEntities, validateSceneDocument, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { sourceCheckedStoredTurn } from "../../lib/scene/storedSceneSource";
import { buildReplayTimeline } from "../../lib/replay/replayTimeline";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";

let checks = 0;
const check = (condition: unknown, message: string): void => { checks++; assert.ok(condition, message); };
function fixture(entries: number[][], claimedType?: string, question = `A=${JSON.stringify(entries)}. Show A.`) {
  const givens = entries.flatMap((row, i) => row.map((value, j) => ({ id: `a${i + 1}${j + 1}`, symbol: `a${i + 1}${j + 1}`, value, unit: "dimensionless", provenance: "given" as const, sourceText: question })));
  const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, givens, unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" };
  const document: SceneDocument = {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "source matrix" }, source: { question, representationTier: "exact_verified", nonMetric: false },
    quantities: givens.map(({ id, value, unit }) => ({ id, value, unit })), entities: [{ id: "A", kind: "matrix_array", label: "A", role: "source matrix" }],
    constructions: [{ id: "make_A", operator: "matrix_array", inputs: { entries, origin: [0, 0], displayScale: 1, ...(claimedType ? { claimedType } : {}) }, outputs: ["A"] }],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["A"], revealGroups: [{ id: "matrices", entityIds: ["A"], dependsOn: [], narrationCue: "Here is the given array." }], teachingTimeline: [],
  };
  return { document, plan, question };
}
function submitted(sample: ReturnType<typeof fixture>) {
  return { question: sample.question, sceneDocument: sample.document, visualStatus: "validated" as const, sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan: sample.plan, representationTier: "exact_verified", nonMetric: false, candidates: [], diagramResultStatus: "ready" }, segments: [
    { orderIndex: 0, narration: "Write the calculation.", spokenText: "Write the calculation.", command: { type: "WRITE", params: [90, 145, 28], text: "1+0=1", charPosition: 0, narrationBefore: "Write the calculation." } },
    { orderIndex: 1, narration: "Notice the verified matrix.", spokenText: "Notice the verified matrix.", command: { type: "FOCUS", params: [], text: "A", charPosition: 0, narrationBefore: "Notice the verified matrix." } },
  ] };
}
async function main(): Promise<void> {
  const cases = [
    ["square", [[1, 2], [3, 4]]], ["rectangular", [[1, 2, 3], [4, 5, 6]]],
    ["row", [[1, 2, 3]]], ["column", [[1], [2], [3]]],
    ["diagonal", [[2, 0, 0], [0, 3, 0], [0, 0, 4]]],
    ["identity", [[1, 0, 0], [0, 1, 0], [0, 0, 1]]], ["zero", [[0, 0, 0], [0, 0, 0]]],
  ] as const;
  for (const [type, entries] of cases) {
    for (const tier of ["exact_verified", "qualitative_verified", "question_representation"] as const) {
      const question = `The ${type} matrix A has ${entries.length} rows and ${entries[0].length} columns, with A=${JSON.stringify(entries)}. Show A and state its type.`;
      const sample = fixture(entries.map((row) => [...row]), type, question);
      sample.document.source.representationTier = tier;
      sample.document.source.nonMetric = tier !== "exact_verified";
      const capabilities = inferSceneCapabilities(question, { turnPlan: sample.plan });
      check(capabilities.hasSourceProgram === true && capabilities.constructionOperators.includes("matrix_array"), `${type}/${tier}: registered source program advertises engine operator`);
      check(shouldAttemptExactScene({ visualRequirement: "required", chemistryLane: false, familyCount: 0, hasArchetype: false, hasSourceProgram: capabilities.hasSourceProgram }), `${type}/${tier}: real live admission attempts source program`);
      const payload = submitted(sample);
      payload.sceneArtifacts.representationTier = tier;
      payload.sceneArtifacts.nonMetric = tier !== "exact_verified";
      const good = compileSceneDocument(sample.document);
      check(good.ok && good.renderScene, `${type}/${tier}: actual public source type positive`);
      const model = pruneDeadSceneEntities(structuredClone(sample.document) as unknown as Record<string, unknown>);
      const modelConstruction = (model.constructions as SceneDocument["constructions"]).find((construction) => construction.operator === "matrix_array");
      check(JSON.stringify(modelConstruction?.inputs.origin) === "[0,0]", `${type}/${tier}: actual model pruning preserves the matrix display tuple`);
      check((model.entities as SceneDocument["entities"]).every((entity) => !entity.id.endsWith("_origin_anchor")), `${type}/${tier}: matrix display placement does not manufacture a point entity`);
      const modelValidation = validateSceneDocument(model);
      check(modelValidation.report.valid && modelValidation.document !== null, `${type}/${tier}: actual model output validates structurally`);
      const modelCompile = compileSceneDocument(model as unknown as SceneDocument);
      check(modelCompile.ok && modelCompile.renderScene?.primitives.filter((primitive) => primitive.provenance?.matrixCell).length === entries.length * entries[0].length, `${type}/${tier}: normalized model compiles every source cell`);
      for (const origin of [[0], [0, 0, 0], "A_origin_anchor", { x: 0, y: 0 }]) {
        const invalidOrigin = structuredClone(sample.document);
        invalidOrigin.constructions[0]!.inputs.origin = origin;
        const rejectedOrigin = compileSceneDocument(pruneDeadSceneEntities(invalidOrigin as unknown as Record<string, unknown>) as unknown as SceneDocument);
        check(!rejectedOrigin.ok && rejectedOrigin.renderScene === null && rejectedOrigin.report.issues.some((issue) => issue.code === "invalid_matrix_array_origin"), `${type}/${tier}: evaluator still refuses invalid display origin`);
      }
      const canonical = await canonicalizeTurnSceneMetadata(payload);
      check(canonical.ok, `${type}/${tier}: correct type canonical positive`);
      if (!canonical.ok) throw new Error(canonical.error);
      const turn: StoredTurn = { ...canonical.value, id: `${type}/${tier}`, orderIndex: 0, question, rawResponse: "", speedMultiplier: 1, traceId: null,
        segments: canonical.value.segments.map((segment) => ({ id: `segment-${segment.orderIndex}`, orderIndex: segment.orderIndex, narration: segment.narration, spokenText: segment.spokenText, command: serializeSegmentCommands(parseStoredSegmentCommands(segment.command), { trustedDiagramGeometry: isStoredCommandTrustedGeometry(segment.command) }), audioUrl: null, durationMs: segment.durationMs ?? null, timings: null })),
      };
      const originalCandidate = JSON.stringify(sample.document);
      const selectedMatrix = selectVerifiedRepresentation({ question, turnPlan: sample.plan, exact: { sceneDocument: sample.document, renderScene: good.renderScene!, validationReport: good.report } });
      check(JSON.stringify(sample.document) === originalCandidate && (selectedMatrix.tier === sample.document.source.representationTier || selectedMatrix.sceneDocument !== sample.document), `${type}/${tier}: earned classification preserves the original candidate and clones conflicting declarations`);
      check(selectedMatrix.sceneDocument.source.representationTier === selectedMatrix.tier && selectedMatrix.sceneDocument.source.nonMetric === selectedMatrix.nonMetric, `${type}/${tier}: accepted document carries its earned classification`);
      check(JSON.stringify(selectedMatrix.sceneDocument.constructions) === JSON.stringify(sample.document.constructions) && selectedMatrix.sceneDocument.source.question === question, `${type}/${tier}: classification preserves all source operands and the question`);
      check(JSON.stringify(selectedMatrix.renderScene.primitives) === JSON.stringify(good.renderScene!.primitives), `${type}/${tier}: reclassified compile preserves every visible primitive`);
      const selectedPayload = structuredClone(payload);
      selectedPayload.sceneDocument = selectedMatrix.sceneDocument;
      selectedPayload.sceneArtifacts.representationTier = selectedMatrix.tier;
      selectedPayload.sceneArtifacts.nonMetric = selectedMatrix.nonMetric;
      const selectedCanonical = await canonicalizeTurnSceneMetadata(selectedPayload);
      check(selectedCanonical.ok, `${type}/${tier}: actual selector document/artifact pair crosses canonical save`);
      check(selectedMatrix.validationReport.valid, `${type}/${tier}: accepted tier is returned with a freshly compiled valid report`);
      const unknownPayload = structuredClone(payload);
      unknownPayload.sceneArtifacts.turnPlan.unknowns.push({ id: "matrixType", symbol: "type(A)" });
      check(validateMatrixSourceBinding(unknownPayload.sceneDocument, question, unknownPayload.sceneArtifacts.turnPlan).every((issue) => issue.severity !== "fatal"), `${type}/${tier}: requested unknown is not relabeled as an asserted GIVEN`);
      if (tier === "exact_verified") {
        const exactUnknown = await canonicalizeTurnSceneMetadata(unknownPayload);
        check(!exactUnknown.ok && exactUnknown.error.includes("unresolved_numeric_unknown"), `${type}/${tier}: unresolved requested unknown cannot be promoted to whole-question exact verification`);
      }
      unknownPayload.sceneDocument.source.representationTier = "question_representation";
      unknownPayload.sceneDocument.source.nonMetric = true;
      unknownPayload.sceneArtifacts.representationTier = "question_representation";
      unknownPayload.sceneArtifacts.nonMetric = true;
      const unknownCanonical = await canonicalizeTurnSceneMetadata(unknownPayload);
      check(unknownCanonical.ok, `${type}/${tier}: honest representation preserves the unresolved unknown role: ${unknownCanonical.ok ? "ok" : unknownCanonical.error}`);
      for (const value of [1, 9]) {
        const unbound = structuredClone(payload);
        unbound.sceneArtifacts.turnPlan.givens.push({ id: "z", symbol: "z", value, unit: "dimensionless", provenance: "given", sourceText: question });
        check(validateMatrixSourceBinding(unbound.sceneDocument, question, unbound.sceneArtifacts.turnPlan).some((issue) => issue.code === "matrix_source_quantity_mismatch"), `${type}/${tier}/${value}: unmatched GIVEN requires an actual source-role witness, not number membership`);
        check(!(await canonicalizeTurnSceneMetadata(unbound)).ok, `${type}/${tier}/${value}: canonical save refuses unbound whole-question GIVEN assertion`);
        const unboundTurn = structuredClone(turn);
        unboundTurn.sceneArtifacts = unbound.sceneArtifacts;
        check(sourceCheckedStoredTurn(unboundTurn).visualStatus === "retry_required", `${type}/${tier}/${value}: stored reader refuses unsourced GIVEN metadata`);
        check(restoreVerifiedPresentationFromTurn(unboundTurn) === null, `${type}/${tier}/${value}: restoration refuses unsourced GIVEN metadata`);
        check(buildReplayTimeline([unboundTurn]).cues.every((cue) => !cue.trustedDiagramGeometry), `${type}/${tier}/${value}: replay cannot trust unsourced GIVEN metadata`);
        const unboundDocument = structuredClone(sample.document);
        unboundDocument.quantities.push(Object.assign({ id: "z", value, unit: "dimensionless" }, { symbol: "z", provenance: "given", sourceText: question }));
        const publicRejection = compileSceneDocument(unboundDocument);
        check(!publicRejection.ok && publicRejection.renderScene === null && publicRejection.report.issues.some((issue) => issue.code === "matrix_source_quantity_mismatch"), `${type}/${tier}/${value}: public compiler refuses explicitly asserted unsourced GIVEN quantity`);
      }
      const mixed = structuredClone(payload);
      mixed.sceneDocument.entities.push({ id: "Z", kind: "vector", label: "Z", role: "unrelated candidate vector" });
      mixed.sceneDocument.constructions.push({ id: "make_Z", operator: "vector", inputs: { start: [0, 0], direction: [1, 0], length: 4, coordinateSpace: "world" }, outputs: ["Z"] });
      mixed.sceneDocument.requiredEntityIds.push("Z");
      mixed.sceneDocument.revealGroups[0]!.entityIds.push("Z");
      const mixedCompile = compileSceneDocument(mixed.sceneDocument);
      check(!mixedCompile.ok && mixedCompile.renderScene === null && mixedCompile.report.issues.some((issue) => issue.code === "matrix_source_extra_geometry"), `${type}/${tier}: whole candidate refuses unrelated vector beside a correct source matrix`);
      check(validateMatrixSourceBinding(mixed.sceneDocument, question, mixed.sceneArtifacts.turnPlan).some((issue) => issue.code === "matrix_source_extra_geometry"), `${type}/${tier}: live source guard covers every candidate construction, not just its declared table`);
      check(!(await canonicalizeTurnSceneMetadata(mixed)).ok, `${type}/${tier}: canonical save refuses whole-candidate source escape`);
      const mixedTurn = structuredClone(turn);
      mixedTurn.sceneDocument = mixed.sceneDocument;
      check(sourceCheckedStoredTurn(mixedTurn).visualStatus === "retry_required", `${type}/${tier}: source-read refuses unsourced extra candidate ink`);
      check(restoreVerifiedPresentationFromTurn(mixedTurn) === null, `${type}/${tier}: restore cannot display an unrelated source-unproved figure`);
      check(buildReplayTimeline([mixedTurn]).cues.every((cue) => !cue.trustedDiagramGeometry), `${type}/${tier}: replay cannot trust partially source-matched candidate`);
      const substituted = structuredClone(payload);
      substituted.sceneDocument.entities[0]!.kind = "vector";
      substituted.sceneDocument.constructions[0]!.operator = "vector";
      substituted.sceneDocument.constructions[0]!.inputs = { start: [0, 0], direction: [1, 0], length: 2, coordinateSpace: "world" };
      const replaced = compileSceneDocument(substituted.sceneDocument);
      check(!replaced.ok && replaced.renderScene === null && replaced.report.issues.some((issue) => issue.code === "matrix_source_missing_program"), `${type}/${tier}: generic vector substitution cannot omit source program`);
      check(validateMatrixSourceBinding(substituted.sceneDocument, question, sample.plan).some((issue) => issue.severity === "fatal"), `${type}/${tier}: live rejects source program removal`);
      check(!(await canonicalizeTurnSceneMetadata(substituted)).ok, `${type}/${tier}: save rejects generic substitution`);
      const substitutedTurn = structuredClone(turn);
      substitutedTurn.sceneDocument = substituted.sceneDocument;
      check(sourceCheckedStoredTurn(substitutedTurn).visualStatus === "retry_required" && restoreVerifiedPresentationFromTurn(substitutedTurn) === null, `${type}/${tier}: read/restore refuses generic matrix substitution`);
      check(buildReplayTimeline([substitutedTurn]).cues.every((cue) => !cue.trustedDiagramGeometry), `${type}/${tier}: saved replay cannot trust generic matrix substitution`);
      for (const corruptType of ["square", "rectangular", "row", "column", "zero", "identity", "diagonal"]) {
        if (corruptType === type) continue;
        const corrupt = structuredClone(sample);
        corrupt.document.constructions[0]!.inputs.claimedType = corruptType;
        const compiled = compileSceneDocument(corrupt.document);
        check(!compiled.ok && compiled.renderScene === null, `${type}/${tier}/${corruptType}: atomic public rejection`);
        check(validateMatrixSourceBinding(corrupt.document, question, sample.plan).some((issue) => issue.severity === "fatal"), `${type}/${tier}/${corruptType}: actual live admission rejects`);
        const rejectedPayload = structuredClone(payload);
        rejectedPayload.sceneDocument = corrupt.document;
        check(!(await canonicalizeTurnSceneMetadata(rejectedPayload)).ok, `${type}/${tier}/${corruptType}: canonical save rejects`);
        const corruptTurn = structuredClone(turn);
        corruptTurn.sceneDocument = corrupt.document;
        check(sourceCheckedStoredTurn(corruptTurn).visualStatus === "retry_required", `${type}/${tier}/${corruptType}: stored reader refuses`);
        check(restoreVerifiedPresentationFromTurn(corruptTurn) === null, `${type}/${tier}/${corruptType}: restore refuses`);
        check(buildReplayTimeline([corruptTurn]).cues.every((cue) => !cue.trustedDiagramGeometry), `${type}/${tier}/${corruptType}: replay cannot trust geometry`);
      }
    }
  }
  const operatorCases = [
    ["matrix_scale", "kA", { matrix: "A", scalar: "k" }],
    ["matrix_add", "A+B", { left: "A", right: "B" }],
    ["matrix_product", "AB", { left: "A", right: "B" }],
    ["matrix_transpose", "A^T", { matrix: "A" }],
  ] as const;
  for (const [operator, expression, inputs] of operatorCases) {
    const sample = fixture([[1, 2], [3, 4]], undefined, `A=[[1,2],[3,4]], B=[[2,0],[0,2]], k=2. C=${expression}. Show C.`);
    sample.document.entities.push({ id: "B", kind: "matrix_array", label: "B", role: "source matrix" }, { id: "C", kind: "matrix_array", label: "C", role: "requested result" });
    sample.document.constructions.push({ id: "make_B", operator: "matrix_array", inputs: { entries: [[2, 0], [0, 2]], origin: [0, 0], displayScale: 1 }, outputs: ["B"] }, { id: "make_C", operator, inputs: { ...inputs, origin: [0, 0], displayScale: 1 }, outputs: ["C"] });
    sample.document.requiredEntityIds.push("B", "C");
    sample.document.revealGroups[0]!.entityIds.push("B", "C");
    sample.document.quantities.push({ id: "k", value: 2, unit: "dimensionless" });
    const model = pruneDeadSceneEntities(sample.document as unknown as Record<string, unknown>);
    check((model.constructions as SceneDocument["constructions"]).filter((construction) => construction.operator.startsWith("matrix_")).every((construction) => JSON.stringify(construction.inputs.origin) === "[0,0]"), `${operator}: all source and result display origins retain tuples at the actual model boundary`);
    const compiled = compileSceneDocument(model as unknown as SceneDocument);
    check(compiled.ok && compiled.renderScene?.primitives.filter((primitive) => primitive.provenance?.matrixCell).length === 12, `${operator}: real normalized program compiles all source/result cells: ${JSON.stringify(compiled.report.issues)}; cells=${compiled.renderScene?.primitives.filter((primitive) => primitive.provenance?.matrixCell).length}`);
  }
  const generic = fixture([[1, 2]], undefined, "Show a vector of length 2.").document;
  generic.entities[0]!.kind = "vector";
  generic.constructions[0]!.operator = "vector";
  generic.constructions[0]!.inputs = { start: [0, 0], direction: [1, 0], length: 2, coordinateSpace: "world" };
  const normalizedVector = pruneDeadSceneEntities(generic as unknown as Record<string, unknown>);
  check(typeof (normalizedVector.constructions as SceneDocument["constructions"]).find((construction) => construction.operator === "vector")?.inputs.start === "string", "ordinary vector point promotion remains intact outside matrix display placement");
  check(compileSceneDocument(normalizedVector as unknown as SceneDocument).ok, "ordinary normalized vector still compiles");
  if (process.argv[2]) {
    const sources = JSON.parse(readFileSync(process.argv[2], "utf8")) as { results: { id: string; document: SceneDocument }[] };
    const native = sources.results.find((record) => record.id === "indexed-correct-grid-only");
    if (!native || typeof native.document.source.question !== "string") throw new Error("Missing immutable full native indexed source");
    const question = native.document.source.question;
    const sample = fixture([[1, 1, 1], [1, 0, 1], [0, 1, 0]], undefined, question);
    sample.document.source.representationTier = "question_representation";
    sample.document.source.nonMetric = true;
    sample.document.entities[0]!.id = "M";
    sample.document.entities[0]!.label = "M";
    sample.document.constructions[0]!.outputs = ["M"];
    sample.document.requiredEntityIds = ["M"];
    sample.document.revealGroups[0]!.entityIds = ["M"];
    const compiled = compileSceneDocument(sample.document);
    check(compiled.ok && compiled.renderScene && compiled.report.issues.some((issue) => issue.code === "matrix_source_component_only"), "full original native indexed source compiles with visible outside-component warning");
    if (!compiled.renderScene) throw new Error("Missing native source grid");
    const capabilities = inferSceneCapabilities(question, { turnPlan: sample.plan });
    check(capabilities.hasSourceProgram === true && capabilities.constructionOperators.includes("matrix_array"), "native source program reaches actual capability admission without topic router");
    const selected = selectVerifiedRepresentation({ question, turnPlan: sample.plan, exact: { sceneDocument: sample.document, renderScene: compiled.renderScene, validationReport: compiled.report } });
    check(selected.tier === "question_representation" && selected.nonMetric && selected.validationReport.issues.some((issue) => issue.code === "matrix_source_component_only"), "native component scope cannot be upgraded by live representation selection");
    check(selected.sceneDocument.source.question === question, "native selected source retains every original option byte");
    const payload = submitted(sample);
    payload.sceneArtifacts.representationTier = "question_representation";
    payload.sceneArtifacts.nonMetric = true;
    payload.segments[1]!.command.text = "M";
    const canonical = await canonicalizeTurnSceneMetadata(payload);
    check(canonical.ok, "native full source/actual plan canonical admission");
    if (!canonical.ok) throw new Error(canonical.error);
    const turn: StoredTurn = { ...canonical.value, id: "native-indexed", orderIndex: 0, question, rawResponse: "", speedMultiplier: 1, traceId: null,
      segments: canonical.value.segments.map((segment) => ({ id: `segment-${segment.orderIndex}`, orderIndex: segment.orderIndex, narration: segment.narration, spokenText: segment.spokenText, command: serializeSegmentCommands(parseStoredSegmentCommands(segment.command), { trustedDiagramGeometry: isStoredCommandTrustedGeometry(segment.command) }), audioUrl: null, durationMs: segment.durationMs ?? null, timings: null })),
    };
    check(sourceCheckedStoredTurn(turn) === turn && restoreVerifiedPresentationFromTurn(turn) !== null, "native scoped source/plan restored only after stored admission");
    check(buildReplayTimeline([turn]).cues.flatMap((cue) => cue.commands).filter((command) => command.type === "LABEL" && command.semanticRef?.primitiveId?.startsWith("M_")).length === 9, "native saved replay retains nine distinct grid cells");
    for (const suffix of [" Additionally, let N=[[2,3],[4,5]] be a supplied matrix.", " Additionally, let k=2 be a supplied scalar.", " N=[[2,3],[4,5]].", " k=2."]) {
      const changed = structuredClone(payload);
      changed.question += suffix;
      changed.sceneDocument.source.question = changed.question;
      changed.sceneArtifacts.turnPlan.question = changed.question;
      const rejected = compileSceneDocument(changed.sceneDocument);
      check(!rejected.ok && rejected.renderScene === null && rejected.report.issues.some((issue) => issue.code === "matrix_source_unsupported"), "additional source-given omission rejected causally before trusted native ink");
      check(validateMatrixSourceBinding(changed.sceneDocument, changed.question, changed.sceneArtifacts.turnPlan).some((issue) => issue.severity === "fatal"), "actual live source boundary refuses hidden additional premises with consistent self-questions");
      check(!(await canonicalizeTurnSceneMetadata(changed)).ok, "canonical cannot save M-only after an additional source given");
      const substituted = structuredClone(changed.sceneDocument);
      substituted.entities[0]!.kind = "vector";
      substituted.constructions[0]!.operator = "vector";
      substituted.constructions[0]!.inputs = { start: [0, 0], direction: [1, 0], length: 2, coordinateSpace: "world" };
      const missing = compileSceneDocument(substituted);
      check(!missing.ok && missing.renderScene === null && missing.report.issues.some((issue) => issue.code === "matrix_source_missing_program"), "unsupported extra-premise question cannot escape by removing every matrix operator");
      const changedTurn = structuredClone(turn);
      changedTurn.question = changed.question;
      changedTurn.sceneDocument = changed.sceneDocument;
      changedTurn.sceneArtifacts = changed.sceneArtifacts;
      check(sourceCheckedStoredTurn(changedTurn).visualStatus === "retry_required", "stored reader refuses hidden additional source givens");
      check(restoreVerifiedPresentationFromTurn(changedTurn) === null, "restoration cannot draw an incomplete source-given component");
      check(buildReplayTimeline([changedTurn]).cues.every((cue) => !cue.trustedDiagramGeometry), "saved replay cannot trust omitted additional source givens");
    }
    const wrong = structuredClone(payload);
    wrong.sceneArtifacts.representationTier = "exact_verified";
    check(!(await canonicalizeTurnSceneMetadata(wrong)).ok, "native component cannot save whole-question exact artifact");
    const corruptTurn = structuredClone(turn);
    (corruptTurn.sceneArtifacts as { representationTier: string }).representationTier = "exact_verified";
    check(sourceCheckedStoredTurn(corruptTurn).visualStatus === "retry_required" && restoreVerifiedPresentationFromTurn(corruptTurn) === null, "native exact artifact cannot bypass read/restore source scope");
  }
  console.log(`HEY88 source-type obligation gate passed (${checks} public/live/canonical/read/restore/replay controls); in-memory, not authenticated/native-row acceptance`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
