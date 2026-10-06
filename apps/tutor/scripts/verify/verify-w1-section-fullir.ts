/** Normal full-IR selection and pure live/save admission, without a server or DB. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applySectionFormulaAuthority, compileSceneDocument, LocalDeterministicSolverProvider, validateTurnPlanSceneProofs, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { inferSceneCapabilities } from "@heytutor/tutor-core";
import { cases, namedProblemFor, problemFor, requestedNameCases, validated } from "../../../../packages/scene-engine/scripts/verify/verify-w1-section-fullir";
import { selectVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { liveSceneSaveFailure, sceneSaveAdmissionFailure } from "../../lib/scene/sceneSaveAdmission";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { insideBoard, worldToPixel } from "./verify-circle-standard-ready";

async function verifyRequestedNames(): Promise<void> {
  for (const c of [...requestedNameCases, cases[1]!]) {
    const name = requestedNameCases.includes(c) ? "Q" : "R";
    const problem = namedProblemFor(c, name);
    const rawPlan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question: c.question, visualRequirement: "required",
      givens: problem.expressions.map((expression) => ({ id: expression.id, symbol: expression.id, value: expression.root.kind === "number" ? expression.root.value : NaN, provenance: "given", sourceText: c.question })),
      derived: [], unknowns: [], qualitativeClaims: [], assumptions: [], lawIds: [] };
    const authority = applySectionFormulaAuthority(c.question, rawPlan);
    assert(authority?.reading.status === "ok");
    const plan = authority.plan;
    const selected = selectVerifiedRepresentation({ question: c.question, problemIR: problem, turnPlan: plan });
    assert.equal(selected.tier, "exact_verified", `${c.id}: matching ${name}`);
    const document = selected.sceneDocument;
    const result = document.constructions.find((construction) => construction.operator === "section_point")!.outputs[0]!;
    const presentation = buildVerifiedDiagramPresentation(document, selected.renderScene, { figureFamily: selected.family });
    assert(presentation?.diagram.commands.some((command) => command.type === "LABEL" && command.text === `${name}=(7,8)`));
    const point = selected.renderScene.primitives.find((primitive) => primitive.kind === "point" && primitive.entityId === result)?.points[0];
    const expected = worldToPixel(selected.renderScene, document)(7, 8); // Independent 2B-A oracle.
    assert(point && Math.hypot(point.x - expected.x, point.y - expected.y) < 0.05);
    assert.equal(liveSceneSaveFailure({ document, question: c.question, turnPlan: plan, tier: selected.tier }), null);
    const metadata = { question: c.question, sceneDocument: document, visualStatus: "validated" as const, segments: [],
      sceneArtifacts: { schemaVersion: "scene-artifacts/v3", representationTier: selected.tier, nonMetric: selected.nonMetric,
        diagramResultStatus: "ready", turnPlan: plan, problemIR: problem, solverResult: await new LocalDeterministicSolverProvider().solve(problem) } };
    const saved = await canonicalizeTurnSceneMetadata(metadata);
    assert(saved.ok, `${c.id}: ${saved.ok ? "saved" : saved.error}`);
    const restored = { question: c.question, ...JSON.parse(JSON.stringify(saved.value)) };
    assert((await canonicalizeTurnSceneMetadata(restored)).ok, "matching result survives JSON revalidation");
    if (name === "R") continue; // Anonymous source permits the IR's requested name.
    if (c === requestedNameCases[0]) {
      for (const target of ["target", "at", "point"]) {
        const labelled = structuredClone(document);
        labelled.entities.push({ id: "coordinate_caption", kind: "label", role: "coordinate caption", label: "R≈[7,8]" });
        labelled.constructions.push({ id: "coordinate_caption_op", operator: "label", inputs: { [target]: result, text: "R≈[7,8]" }, outputs: ["coordinate_caption"] });
        assert(liveSceneSaveFailure({ document: labelled, question: c.question, turnPlan: plan, tier: selected.tier }), `${target} construction cannot rename Q`);
        assert(!(await canonicalizeTurnSceneMetadata({ ...metadata, sceneDocument: labelled })).ok);
        assert(!(await canonicalizeTurnSceneMetadata({ ...metadata, sceneDocument: JSON.parse(JSON.stringify(labelled)) as SceneDocument })).ok);
      }
      for (const kind of ["label", "callout", "badge"] as const) {
        for (const [text, valid] of [["Q≈[7,8]", true], ["R≈[7,8]", false], ["Q≈[4,5]", false]] as const) {
          const square = structuredClone(document);
          const annotation = square.annotations.find((item) => item.targetIds.includes(result))!;
          annotation.kind = kind;
          annotation.text = text;
          assert.equal(liveSceneSaveFailure({ document: square, question: c.question, turnPlan: plan, tier: selected.tier }) === null, valid);
          assert.equal((await canonicalizeTurnSceneMetadata({ ...metadata, sceneDocument: square })).ok, valid);
          assert.equal((await canonicalizeTurnSceneMetadata({ ...metadata, sceneDocument: JSON.parse(JSON.stringify(square)) as SceneDocument })).ok, valid);
        }
      }
    }
    for (const kind of ["label", "callout", "badge"] as const) {
      for (const separator of ["=", "≈", ":"]) {
        for (const [text, valid] of [[`Q${separator}(7,8)`, true], [`R${separator}(7,8)`, false], [`Q${separator}(4,5)`, false]] as const) {
          const annotated = structuredClone(document);
          const annotation = annotated.annotations.find((item) => item.targetIds.includes(result))!;
          annotation.kind = kind;
          annotation.text = text;
          assert.equal(liveSceneSaveFailure({ document: annotated, question: c.question, turnPlan: plan, tier: selected.tier }) === null, valid, `${kind} ${text}: live source identity`);
          assert.equal((await canonicalizeTurnSceneMetadata({ ...metadata, sceneDocument: annotated })).ok, valid, `${kind} ${text}: canonical save`);
          const jsonRestored = { ...metadata, sceneDocument: JSON.parse(JSON.stringify(annotated)) as SceneDocument };
          assert.equal((await canonicalizeTurnSceneMetadata(jsonRestored)).ok, valid, `${kind} ${text}: JSON revalidation`);
        }
      }
    }
    for (const kind of ["callout", "badge"] as const) {
      for (const text of ["R~(7,8)", String.raw`R\approx(7,8)`, "Q~(7,8)", "(7,8)", "Q=(7,8); R~(7,8)", "R=(7/1,8)", "R=(x,y)", "R=(7,8,9)"]) {
        const unsupported = structuredClone(document);
        const annotation = unsupported.annotations.find((item) => item.targetIds.includes(result))!;
        annotation.kind = kind;
        annotation.text = text;
        assert(liveSceneSaveFailure({ document: unsupported, question: c.question, turnPlan: plan, tier: selected.tier }), `${kind} ${text}: unparsed live claim rejects`);
        assert(!(await canonicalizeTurnSceneMetadata({ ...metadata, sceneDocument: unsupported })).ok, `${kind} ${text}: unparsed save claim rejects`);
        assert(!(await canonicalizeTurnSceneMetadata({ ...metadata, sceneDocument: JSON.parse(JSON.stringify(unsupported)) as SceneDocument })).ok, `${kind} ${text}: unparsed JSON claim rejects`);
      }
    }
    for (const aliases of [["x_A", "y_A", "x_B", "y_B"], ["x1", "y1", "x2", "y2"]]) {
      const aliasPlan = structuredClone(plan);
      aliasPlan.givens = aliasPlan.givens.map((quantity, i) => ({ ...quantity, id: aliases[i]!, symbol: aliases[i]! }));
      assert.equal(liveSceneSaveFailure({ document, question: c.question, turnPlan: aliasPlan, tier: selected.tier }), null);
      assert((await canonicalizeTurnSceneMetadata({ ...metadata, sceneArtifacts: { ...metadata.sceneArtifacts, turnPlan: aliasPlan } })).ok, "explicit Q survives planner aliases without fullIR regeneration");
    }
    for (const kind of ["section", "graph", "conceptual"] as const) {
      const wrong = namedProblemFor(c, "R");
      wrong.representationIntents[0]!.kind = kind;
      const declined = selectVerifiedRepresentation({ question: c.question, problemIR: validated(wrong), turnPlan: plan });
      assert.equal(declined.sceneDocument.visualDecision.mode, "text_only", `${c.id}: ${kind} wrong R declines`);
      assert.equal(declined.renderScene.primitives.length, 0, "wrong identity produces no compiler ink");
      const matching = structuredClone(problem);
      matching.representationIntents[0]!.kind = kind;
      const positive = selectVerifiedRepresentation({ question: c.question, problemIR: validated(matching), turnPlan: plan });
      assert.equal(positive.tier, "exact_verified");
      assert.equal(liveSceneSaveFailure({ document: positive.sceneDocument, question: c.question, turnPlan: plan, tier: positive.tier }), null);
    }
    for (const target of ["entity", "annotation", "both", "coordinate"] as const) {
      const mutate = (copy: SceneDocument): void => {
        if (target === "entity" || target === "both") copy.entities.find((entity) => entity.id === result)!.label = "R";
        if (target !== "entity") copy.annotations.find((annotation) => annotation.targetIds.includes(result))!.text = target === "coordinate" ? "Q=(4,5)" : "R=(7,8)";
        copy.source.pointNameEvidence = { name: "R", quote: "R" }; // Client metadata cannot replace the actual question witness.
      };
      const forged = structuredClone(document);
      mutate(forged);
      assert.equal(compileSceneDocument(forged).ok && liveSceneSaveFailure({ document: forged, question: c.question, turnPlan: plan, tier: selected.tier }) === null, false, `${c.id}: ${target} cannot compile and admit ink`);
      assert(!(await canonicalizeTurnSceneMetadata({ ...metadata, sceneDocument: forged })).ok, `${c.id}: ${target} save rejects`);
      const changedRestore = structuredClone(restored);
      mutate(changedRestore.sceneDocument);
      assert(!(await canonicalizeTurnSceneMetadata(changedRestore)).ok, `${c.id}: ${target} JSON restore rejects`);
    }
  }
  const anonymous = cases[1]!;
  const question = "Find the coordinates for Q. It divides the join of A(1,2) and B(4,5) externally in the ratio 2:1.";
  const unsupported = namedProblemFor({ ...anonymous, question }, "R");
  const submitted = selectVerifiedRepresentation({ question: anonymous.question, problemIR: namedProblemFor(anonymous, "R") }).sceneDocument;
  submitted.source.question = question;
  const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, visualRequirement: "required",
    givens: unsupported.expressions.map((expression) => ({ id: expression.id, symbol: expression.id, value: expression.root.kind === "number" ? expression.root.value : NaN, provenance: "given", sourceText: question })),
    derived: [], unknowns: [], qualitativeClaims: [], assumptions: [], lawIds: [] };
  assert(liveSceneSaveFailure({ document: submitted, question, turnPlan: plan, tier: "exact_verified" }), "an unreadable named source cannot submit anonymous R ink");
  const rejected = await canonicalizeTurnSceneMetadata({ question, sceneDocument: submitted, visualStatus: "validated", segments: [],
    sceneArtifacts: { schemaVersion: "scene-artifacts/v3", representationTier: "exact_verified", nonMetric: false,
      diagramResultStatus: "ready", turnPlan: plan, problemIR: unsupported, solverResult: await new LocalDeterministicSolverProvider().solve(unsupported) } });
  assert(!rejected.ok, "unreadable named source also rejects save/restore admission");
}

async function main(): Promise<void> {
  for (const c of cases) {
    const problem = validated(process.env.SECTION_FULLIR_AUDIT && c.id !== "internal32"
      ? JSON.parse(readFileSync(`${process.env.SECTION_FULLIR_AUDIT}/${c.id}-problem-ir.json`, "utf8")) : problemFor(c));
    const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question: c.question, visualRequirement: "required",
      givens: problem.expressions.map((expression) => ({ id: expression.id, symbol: expression.id, value: expression.root.kind === "number" ? expression.root.value : NaN, provenance: "given", sourceText: c.question })),
      derived: [], qualitativeClaims: [], unknowns: [], assumptions: [], lawIds: [],
    };
    const authority = applySectionFormulaAuthority(c.question, plan);
    assert(authority?.reading.status === "ok");
    const authoritative = authority.plan;
    const capabilities = inferSceneCapabilities(c.question, { problemIR: problem, turnPlan: authoritative, lawIds: [] });
    const selected = selectVerifiedRepresentation({ question: c.question, problemIR: problem, turnPlan: authoritative, families: capabilities.families });
    assert.equal(selected.sceneDocument.visualDecision.mode, "scene", `${c.id}: ${selected.reason}`);
    assert.equal(selected.tier, "exact_verified", c.id);
    const document = selected.sceneDocument;
    assert.equal(liveSceneSaveFailure({ document, question: c.question, turnPlan: authoritative, tier: selected.tier }), null, c.id);
    assert.equal(sceneSaveAdmissionFailure({ document, question: c.question, turnPlan: authoritative, tier: selected.tier }), null, c.id);
    const section = document.constructions.find((construction) => construction.operator === "section_point")!;
    const toPixel = worldToPixel(selected.renderScene, document);
    for (const [id, world] of [[String(section.inputs.a), c.a], [String(section.inputs.b), c.b], [section.outputs[0]!, c.p]] as const) {
      const actual = selected.renderScene.primitives.find((p) => p.kind === "point" && p.entityId === id)?.points[0];
      assert(actual);
      const expected = toPixel(world[0]!, world[1]!);
      assert(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 0.05, `${c.id}: source point ${id}`);
      assert(document.requiredEntityIds.includes(id) && document.revealGroups.some((g) => g.entityIds.includes(id)));
    }
    insideBoard(selected.renderScene, c.id);
    const presentation = buildVerifiedDiagramPresentation(document, selected.renderScene, { figureFamily: selected.family });
    assert(presentation?.diagram.commands.some((command) => command.type === "LABEL" && command.text === `A(${c.a.join(",")})`));
    assert(presentation?.diagram.commands.some((command) => command.type === "LABEL" && command.text === `P=(${c.p.join(",")})`));
    const roundTrip = JSON.parse(JSON.stringify(document)) as SceneDocument;
    assert.equal(liveSceneSaveFailure({ document: roundTrip, question: c.question, turnPlan: authoritative, tier: selected.tier }), null);
    assert.deepEqual(roundTrip.quantities, document.quantities, "source lineage persists");
    const forged = structuredClone(document);
    forged.constructions.find((construction) => construction.id === "place_a")!.inputs.x = c.b[0];
    assert(validateTurnPlanSceneProofs(forged, authoritative).some((issue) => issue.code === "section_source_mismatch"));
    assert(liveSceneSaveFailure({ document: forged, question: c.question, turnPlan: authoritative, tier: selected.tier }));
    const stale = structuredClone(authoritative);
    if (stale.derived[0]) {
      stale.derived[0].value += 100;
      const corrected = applySectionFormulaAuthority(c.question, stale)!;
      assert(corrected.issues.some((issue) => issue.code === "section_value_corrected"), "stale solved scalar corrected before narration");
      const value = corrected.plan.derived.find((q) => q.id === stale.derived[0]!.id)!.value;
      const expected = /ratio/.test(stale.derived[0]!.id) ? c.ratio : c.p[0]!;
      assert(Math.abs(value - expected) < 1e-9, "independent solved value retained");
    }
    const solverResult = await new LocalDeterministicSolverProvider().solve(problem);
    const metadata = { question: c.question, sceneDocument: document, visualStatus: "validated" as const, segments: [],
      sceneArtifacts: { schemaVersion: "scene-artifacts/v3", representationTier: selected.tier, nonMetric: selected.nonMetric,
        diagramResultStatus: "ready", turnPlan: authoritative, problemIR: problem, solverResult } };
    const saved = await canonicalizeTurnSceneMetadata(metadata);
    assert(saved.ok, `${c.id}: ${saved.ok ? "saved" : saved.error}`);
    assert.deepEqual(saved.value.sceneDocument?.quantities, document.quantities, "canonical save retains source lineage");
    assert.deepEqual(saved.value.sceneArtifacts?.problemIR, problem, "canonical save retains every IR fact and intent");
    for (const aliases of [["x_A", "y_A", "x_B", "y_B"], ["x1", "y1", "x2", "y2"]]) {
      const aliased = structuredClone(authoritative);
      aliased.givens = aliased.givens.map((q, i) => ({ ...q, id: aliases[i]!, symbol: aliases[i]! }));
      assert.equal(liveSceneSaveFailure({ document, question: c.question, turnPlan: aliased, tier: selected.tier }), null, "fullIR quantities pass real planner aliases");
      const aliasedSaved = await canonicalizeTurnSceneMetadata({ ...metadata, sceneArtifacts: { ...metadata.sceneArtifacts, turnPlan: aliased } });
      assert(aliasedSaved.ok, `${c.id}: ${aliases.join(",")} save ${aliasedSaved.ok ? "passed" : aliasedSaved.error}`);
      assert.deepEqual(aliasedSaved.value.sceneDocument?.quantities, document.quantities, "IR source roles survive planner alias admission");
    }
    for (const kind of ["graph", "conceptual"] as const) {
      const ir = structuredClone(problem);
      ir.representationIntents[0]!.kind = kind;
      const variant = selectVerifiedRepresentation({ question: c.question, problemIR: validated(ir), turnPlan: authoritative });
      assert.equal(variant.tier, "exact_verified", `normal ${kind} intent`);
      assert.equal(liveSceneSaveFailure({ document: variant.sceneDocument, question: c.question, turnPlan: authoritative, tier: variant.tier }), null);
    }
    const forgedSaved = await canonicalizeTurnSceneMetadata({ ...metadata, sceneDocument: forged });
    assert(!forgedSaved.ok, "canonical save refuses forged coordinates");
    console.log(`${c.id}: validated fullIR -> selection ${selected.tier} -> live/save PASS -> JSON lineage PASS`);
  }
  for (const mutate of [
    (p: ReturnType<typeof problemFor>) => { p.expressions[0]!.root = { kind: "number", value: 3 }; },
    (p: ReturnType<typeof problemFor>) => { p.expressions[0]!.id = "expr1"; },
    (p: ReturnType<typeof problemFor>) => { p.expressions[0]!.root = { kind: "binary", operator: "/", left: { kind: "number", value: 4 }, right: { kind: "number", value: 2 } }; },
    (p: ReturnType<typeof problemFor>) => { p.expressions.push({ id: "height", valueType: "scalar", root: { kind: "number", value: 2 }, evidenceFactIds: ["given"] }); },
    (p: ReturnType<typeof problemFor>) => { p.entities.push({ id: "Q", kind: "point", label: "Q", evidenceFactIds: ["given"] }); p.representationIntents[0]!.entityIds.push("Q"); },
    (p: ReturnType<typeof problemFor>) => { p.constraints.push({ id: "unsupported_picture", kind: "perpendicular", entityIds: ["A", "B"], evidenceFactIds: ["given"] }); },
  ]) {
    const problem = problemFor(cases[0]!);
    mutate(problem);
    const ir = validated(problem);
    const capabilities = inferSceneCapabilities(ir.question, { problemIR: ir, turnPlan: null, lawIds: [] });
    const selected = selectVerifiedRepresentation({ question: ir.question, problemIR: ir, families: capabilities.families });
    assert.equal(selected.sceneDocument.visualDecision.mode, "text_only", "unmet fullIR obligations never render a substitute");
    assert.equal(selected.renderScene.primitives.length, 0);
  }
  for (const question of [
    "Find the point which divides the join of A(1,2) and B(4,5) externally in the ratio 1:1.",
    "Find the point which divides the join of A(1/2,2) and B(4,5) internally in the ratio 1:2.",
    "The point P(5,5) divides the join of A(2,3) and B(8,9) internally in the ratio 1:2. Find the coordinates.",
    "Find the point which divides the join of A(1,2) and B(4,5) internally in the ratio -1:2.",
    "Find the coordinates for Q. It divides the join of A(1,2) and B(4,5) externally in the ratio 2:1.",
  ]) {
    const ir = validated(problemFor({ ...cases[0]!, question }));
    const selected = selectVerifiedRepresentation({ question, problemIR: ir });
    assert.equal(selected.sceneDocument.visualDecision.mode, "text_only");
    assert.equal(selected.renderScene.primitives.length, 0);
  }
  const decimalQuestion = "Find the point which divides the join of A(0.5,2) and B(4,5) internally in the ratio 1:2.";
  const constantAst = problemFor({ ...cases[0]!, question: decimalQuestion, a: [0.5, 2], b: [4, 5] });
  constantAst.expressions[0]!.root = { kind: "binary", operator: "/", left: { kind: "number", value: 1 }, right: { kind: "number", value: 2 } };
  const astSelection = selectVerifiedRepresentation({ question: decimalQuestion, problemIR: validated(constantAst) });
  assert.equal(astSelection.sceneDocument.visualDecision.mode, "text_only", "matching constant fraction AST is an explicit source-binding gap");
  assert.equal(astSelection.renderScene.primitives.length, 0);
  await verifyRequestedNames();
  console.log("w1-section-fullir app: 6 fullIR cases, 12 declines, 5 explicit-Q forms and anonymous naming passed; renamed results reject live/save/restore; planner aliases, graph/conceptual intents, source lineage and authority passed (offline)");
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
