/** Offline normal-path section cases; expected points/ratios were computed independently. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateProblemIR, type ProblemIR } from "../../src/ir/problemIR";
import { compileSceneDocument } from "../../src/compile/compiler";
import { readSectionFormulaSource, sectionFormulaScene, validateSectionPointSourceInputs } from "../../src/ir/sectionFormulaSource";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { checkVisualObligations, deriveVisualObligations } from "../../src/synthesize/visualObligations";
import type { SceneDocument } from "../../src/types";

export const cases = [
  { id: "SF1", question: "Find the coordinates of the point which divides the join of A(2,3) and B(8,9) internally in the ratio 1:2.", a: [2, 3], b: [8, 9], p: [4, 5], t: 1 / 3, ratio: 1 / 2 },
  { id: "SF3", question: "Find the coordinates of the point which divides the join of A(1,2) and B(4,5) externally in the ratio 2:1.", a: [1, 2], b: [4, 5], p: [7, 8], t: 2, ratio: 2 },
  { id: "SF4", question: "Find the midpoint of the join of A(-2,4) and B(6,-8).", a: [-2, 4], b: [6, -8], p: [2, -2], t: 1 / 2, ratio: 1 },
  { id: "SF5", question: "In what ratio does P(4,5) divide the join of A(2,3) and B(8,9)?", a: [2, 3], b: [8, 9], p: [4, 5], t: 1 / 3, ratio: 1 / 2 },
  { id: "SF6", question: "In what ratio does P(1,1) divide the join of A(2,3) and B(5,9)?", a: [2, 3], b: [5, 9], p: [1, 1], t: -1 / 3, ratio: 1 / 4 },
  // P = A + (3/5)(B-A), independently: (-3,7) + (6,-9) = (3,-2).
  { id: "internal32", question: "Find the coordinates of the point which divides the join of A(-3,7) and B(7,-8) internally in the ratio 3:2.", a: [-3, 7], b: [7, -8], p: [3, -2], t: 3 / 5, ratio: 3 / 2 },
];
export type SectionCase = typeof cases[number];
export function problemFor(c: SectionCase): ProblemIR {
  const evidence = { source: "question" as const, start: 0, end: c.question.length, quote: c.question };
  return {
    schemaVersion: "problem-ir/v1", id: `audit_${c.id}`, question: c.question,
    facts: [{ id: "given", kind: "given", statement: c.question, evidence }, { id: "requested", kind: "requested", statement: c.question, evidence }],
    entities: ["A", "B", "P"].map((id) => ({ id, kind: "point", label: id, evidenceFactIds: [id === "P" ? "requested" : "given"] })),
    expressions: [c.a[0]!, c.a[1]!, c.b[0]!, c.b[1]!].map((value, i) => ({ id: ["Ax", "Ay", "Bx", "By"][i]!, valueType: "scalar", root: { kind: "number", value }, evidenceFactIds: ["given"] })),
    constraints: [], representationIntents: [{ id: "section", kind: "section", entityIds: ["A", "B", "P"], evidenceFactIds: ["given", "requested"] }], solveRequests: [],
  };
}
export function validated(problem: ProblemIR): ProblemIR {
  const v = validateProblemIR(problem, problem.question);
  assert(v.valid && v.problem, JSON.stringify(v.issues));
  return v.problem;
}

export const requestedNameCases: SectionCase[] = [
  "Find coordinates of Q which divides the join of A(1,2) and B(4,5) externally in the ratio 2:1.",
  "Find the coordinates of Q dividing the join of A(1,2) and B(4,5) externally in the ratio 2:1.",
  "Find Point Q which divides the join of A(1,2) and B(4,5) externally in the ratio 2:1.",
  "Find point Q which divides the join of A(1,2) and B(4,5) externally in the ratio 2:1.",
  "FIND THE COORDINATES OF  Q  WHICH DIVIDES the join of A(1,2) and B(4,5) externally in the ratio 2:1.",
].map((question, i) => ({ ...cases[1]!, id: `explicitQ${i + 1}`, question }));

export function namedProblemFor(c: SectionCase, name: string): ProblemIR {
  const problem = problemFor(c);
  problem.entities.find((entity) => entity.id === "P")!.label = name;
  return validated(problem);
}

function verifyRequestedNames(): void {
  for (const c of requestedNameCases) {
    // The requested name comes from the source role, independently of IR's chosen label.
    const reading = readSectionFormulaSource(c.question);
    assert(reading.status === "ok");
    assert.equal(reading.source.point.name, "Q");
    const witness = reading.source.pointNameEvidence;
    assert(witness && witness.name === "Q" && c.question.slice(witness.start, witness.end) === witness.quote, "requested identity has an actual source quote");
    const legacy = sectionFormulaScene(c.question)!;
    assert.equal(legacy.quantities.length, 0);
    assert.equal(legacy.annotations.length, 0);
    assert.equal(legacy.entities.find((entity) => entity.id === "pt_Q")!.label, "Q=(7,8)");
    assert.deepEqual(validateSectionPointSourceInputs(legacy, c.question), []);
    for (const kind of ["section", "graph", "conceptual"] as const) {
      const wrong = namedProblemFor(c, "R");
      wrong.representationIntents[0]!.kind = kind;
      assert.equal(sectionFormulaScene(c.question, wrong), null, "wrong requested name declines before compiler input");
      assert.equal(synthesizeFamilyScene({ question: c.question, problemIR: wrong }), null);
      const matching = namedProblemFor(c, "Q");
      matching.representationIntents[0]!.kind = kind;
      const scene = synthesizeFamilyScene({ question: c.question, problemIR: matching });
      assert.equal(scene?.tier, "exact_verified", `${c.id}: ${kind} Q positive`);
      assert(scene && checkVisualObligations(deriveVisualObligations(matching), scene.document).satisfied);
      const section = scene.document.constructions.find((construction) => construction.operator === "section_point")!;
      const result = section.outputs[0]!;
      assert.equal(scene.document.entities.find((entity) => entity.id === result)!.label, "Q");
      assert.equal(scene.document.annotations.find((annotation) => annotation.targetIds.includes(result))!.text, "Q=(7,8)");
      if (c === requestedNameCases[0] && kind === "section") {
        for (const target of ["target", "at", "point"]) {
          for (const [text, valid] of [["Q≈[7,8]", true], ["R≈[7,8]", false], ["Q≈[4,5]", false]] as const) {
            const labelled: SceneDocument = structuredClone(scene.document);
            labelled.entities.push({ id: "coordinate_caption", kind: "label", role: "coordinate caption", label: text });
            labelled.constructions.push({ id: "coordinate_caption_op", operator: "label", inputs: { [target]: result, text }, outputs: ["coordinate_caption"] });
            assert.equal(validateSectionPointSourceInputs(labelled, c.question).some((issue) => issue.severity === "fatal"), !valid, `${target} label ${text}: every label channel is bound`);
          }
        }
        for (const annotationKind of ["label", "callout", "badge"] as const) {
          for (const [text, valid] of [["Q≈[7,8]", true], ["R≈[7,8]", false], ["Q≈[4,5]", false]] as const) {
            const square: SceneDocument = structuredClone(scene.document);
            const annotation = square.annotations.find((item) => item.targetIds.includes(result))!;
            annotation.kind = annotationKind;
            annotation.text = text;
            assert.equal(validateSectionPointSourceInputs(square, c.question).some((issue) => issue.severity === "fatal"), !valid, `${annotationKind} ${text}: compiled tuple grammar is source-bound`);
          }
        }
      }
      for (const kind of ["label", "callout", "badge"] as const) {
        for (const separator of ["=", "≈", ":"]) {
          for (const [text, valid] of [[`Q${separator}(7,8)`, true], [`R${separator}(7,8)`, false], [`Q${separator}(4,5)`, false]] as const) {
            const annotated: SceneDocument = structuredClone(scene.document);
            const annotation = annotated.annotations.find((item) => item.targetIds.includes(result))!;
            annotation.kind = kind;
            annotation.text = text;
            assert.equal(validateSectionPointSourceInputs(annotated, c.question).some((issue) => issue.severity === "fatal"), !valid, `${kind} ${text}: identity and coordinates remain source-bound`);
          }
        }
      }
      for (const kind of ["callout", "badge"] as const) {
        for (const text of ["R~(7,8)", String.raw`R\approx(7,8)`, "Q~(7,8)", "(7,8)", "Q=(7,8); R~(7,8)", "R=(7/1,8)", "R=(x,y)", "R=(7,8,9)"]) {
          const unsupported: SceneDocument = structuredClone(scene.document);
          const annotation = unsupported.annotations.find((item) => item.targetIds.includes(result))!;
          annotation.kind = kind;
          annotation.text = text;
          assert(validateSectionPointSourceInputs(unsupported, c.question).some((issue) => issue.severity === "fatal"), `${kind} ${text}: unparsed coordinate claims decline`);
        }
        const caption: SceneDocument = structuredClone(scene.document);
        const annotation = caption.annotations.find((item) => item.targetIds.includes(result))!;
        annotation.kind = kind;
        annotation.text = "AP:PB=2:1";
        assert.deepEqual(validateSectionPointSourceInputs(caption, c.question), [], "zero-pair ratio caption remains valid");
      }
      for (const target of ["entity", "annotation", "both"] as const) {
        const renamed = structuredClone(scene.document);
        if (target !== "annotation") renamed.entities.find((entity) => entity.id === result)!.label = "R";
        if (target !== "entity") renamed.annotations.find((annotation) => annotation.targetIds.includes(result))!.text = "R=(7,8)";
        assert(validateSectionPointSourceInputs(renamed, c.question).some((issue) => issue.code === "section_source_mismatch"), `${c.id}: ${target} rename rejects despite equal coordinates`);
      }
    }
  }
  const anonymous = cases[1]!;
  const chosen = synthesizeFamilyScene({ question: anonymous.question, problemIR: namedProblemFor(anonymous, "R") });
  assert.equal(chosen?.tier, "exact_verified", "anonymous source permits requested IR name R");
  assert(chosen && chosen.document.annotations.some((annotation) => annotation.text === "R=(7,8)"));
  assert.deepEqual(validateSectionPointSourceInputs(chosen.document, anonymous.question), []);
  for (const question of [
    "Find point Q which divides the join of A(1,2) and B(4,5) externally in the ratio 2:1. Find coordinates of R.",
    "Find point A which divides the join of A(1,2) and B(4,5) externally in the ratio 2:1.",
    "Find the coordinates for Q. It divides the join of A(1,2) and B(4,5) externally in the ratio 2:1.",
  ]) {
    assert.equal(readSectionFormulaSource(question).status, "declined", "conflicting or unbound explicit identities decline honestly");
    const c = { ...cases[1]!, question };
    assert.equal(synthesizeFamilyScene({ question, problemIR: namedProblemFor(c, "R") }), null, "unsupported names cannot fall through to substitute ink");
    const submitted = structuredClone(chosen.document);
    submitted.source.question = question;
    assert(validateSectionPointSourceInputs(submitted, question).some((issue) => issue.severity === "fatal"), "unsupported named source must also reject a submitted result");
  }
  for (const name of ["T_1", "R'"]) {
    const c = { ...requestedNameCases[0]!, question: requestedNameCases[0]!.question.replace("Q", name) };
    const scene = synthesizeFamilyScene({ question: c.question, problemIR: namedProblemFor(c, name) });
    assert.equal(scene?.tier, "exact_verified", "source identity is independent of the chosen point name");
    assert.equal(synthesizeFamilyScene({ question: c.question, problemIR: namedProblemFor(c, "Q") }), null);
  }
}

export function verifyEngine(): void {
  for (const c of cases) {
    const raw = process.env.SECTION_FULLIR_AUDIT && c.id !== "internal32"
      ? JSON.parse(readFileSync(`${process.env.SECTION_FULLIR_AUDIT}/${c.id}-problem-ir.json`, "utf8")) : problemFor(c);
    const problem = validated(raw);
    const scene = synthesizeFamilyScene({ question: c.question, problemIR: problem });
    if (process.argv.includes("--report")) {
      console.log(JSON.stringify({ id: c.id, validIR: true, scene: Boolean(scene), tier: scene?.tier }));
      continue;
    }
    assert(scene, `${c.id}: fullIR must produce a scene`);
    assert.equal(scene.tier, "exact_verified");
    assert(checkVisualObligations(deriveVisualObligations(problem), scene.document).satisfied);
  }
  if (process.argv.includes("--report")) return;
  verifyControls();
  verifyRequestedNames();
  console.log("w1-section-fullir engine: 6 normal cases, 5 explicit-Q forms, anonymous naming and body/dimension/source controls passed");
}
function verifyControls(): void {
  const c = cases[0]!;
  const problem = validated(problemFor(c));
  const scene = synthesizeFamilyScene({ question: c.question, problemIR: problem })!;
  const legacy = sectionFormulaScene(c.question)!;
  assert.equal(legacy.quantities.length, 0);
  assert.equal(legacy.annotations.length, 0);
  assert.equal(legacy.entities.find((e) => e.id === "pt_A")!.label, "A(2,3)");
  legacy.quantities.push({ id: "Ax", symbol: "Ax", value: 2, unit: "" });
  assert.deepEqual(validateSectionPointSourceInputs(legacy, c.question), [], "old nullIR scalar spelling stays compatible");
  const ratioGiven = structuredClone(problem);
  ratioGiven.expressions.push(...[1, 2].map((value, i) => ({ id: ["m", "n"][i]!, valueType: "scalar" as const, root: { kind: "number" as const, value }, evidenceFactIds: ["given"] })));
  const withRatio = synthesizeFamilyScene({ question: c.question, problemIR: validated(ratioGiven) });
  assert(withRatio && checkVisualObligations(deriveVisualObligations(ratioGiven), withRatio.document).satisfied, "explicit ratio scalar roles bind honestly");
  const obligations = deriveVisualObligations(problem);
  for (const name of ["A", "B", "P"]) {
    const removed = structuredClone(scene.document);
    removed.entities = removed.entities.filter((entity) => entity.label !== name);
    assert(checkVisualObligations(obligations, removed).missing.some((miss) => miss.code === "missing_named_body"));
    const renamed = structuredClone(scene.document);
    renamed.entities.find((entity) => entity.label === name)!.label = "Q";
    assert(checkVisualObligations(obligations, renamed).missing.some((miss) => miss.code === "missing_named_body"));
  }
  for (const id of ["Ax", "Ay", "Bx", "By"]) {
    const removed = structuredClone(scene.document);
    removed.quantities = removed.quantities.filter((quantity) => quantity.id !== id);
    assert(checkVisualObligations(obligations, removed).missing.some((miss) => miss.obligationId === `dimension:${id}`));
  }
  const mutateIR = (change: (p: ProblemIR) => void): void => {
    const copy = structuredClone(problem);
    change(copy);
    assert.equal(synthesizeFamilyScene({ question: c.question, problemIR: validated(copy) }), null);
  };
  mutateIR((p) => {
    p.entities.push({ id: "Q", kind: "point", label: "Q", evidenceFactIds: ["given"] });
    p.representationIntents[0]!.entityIds.push("Q");
  });
  mutateIR((p) => { p.constraints.push({ id: "false_relation", kind: "perpendicular", entityIds: ["A", "B"], evidenceFactIds: ["given"] }); });
  // Both swapped values occur elsewhere in the source. They still contradict their roles.
  mutateIR((p) => { p.expressions[0]!.root = { kind: "number", value: 3 }; p.expressions[1]!.root = { kind: "number", value: 2 }; });
  mutateIR((p) => { p.expressions.push({ id: "height", valueType: "scalar", root: { kind: "number", value: 2 }, evidenceFactIds: ["given"] }); });
  mutateIR((p) => { p.entities[0]!.kind = "body"; });
  mutateIR((p) => {
    const start = c.question.indexOf("ratio");
    p.facts[0]!.evidence = { source: "question", start, end: c.question.length, quote: c.question.slice(start) };
    p.facts[0]!.statement = c.question.slice(start);
  });
  for (const mutate of [
    (doc: typeof scene.document) => { doc.entities.find((e) => e.id === "pt_A")!.label = "B"; doc.entities.find((e) => e.id === "pt_B")!.label = "A"; },
    (doc: typeof scene.document) => { doc.annotations.find((a) => a.targetIds.includes("pt_A"))!.text = "A(8,9)"; },
  ]) {
    const copy = structuredClone(scene.document);
    mutate(copy);
    assert(validateSectionPointSourceInputs(copy, c.question).some((issue) => issue.code === "section_source_mismatch"), "endpoint identity and annotation forgery rejected");
  }
  for (const kind of ["graph", "conceptual"] as const) {
    const copy = structuredClone(problem);
    copy.representationIntents[0]!.kind = kind;
    const normal = synthesizeFamilyScene({ question: c.question, problemIR: validated(copy) });
    assert(normal?.tier === "exact_verified", `${kind}: the same source points and obligations`);
    assert(checkVisualObligations(deriveVisualObligations(copy), normal.document).satisfied);
  }
  mutateIR((p) => { p.expressions[0]!.id = "expr1"; });
  mutateIR((p) => { p.expressions[0]!.root = { kind: "binary", operator: "/", left: { kind: "number", value: 4 }, right: { kind: "number", value: 2 } }; });
  mutateIR((p) => { p.expressions[0]!.root = { kind: "binary", operator: "/", left: { kind: "number", value: 6 }, right: { kind: "number", value: 2 } }; });
  const unit = structuredClone(scene.document);
  unit.quantities[0]!.unit = "cm";
  assert(!checkVisualObligations(obligations, unit).satisfied);
  assert(validateSectionPointSourceInputs(unit, c.question).some((issue) => issue.code === "section_source_mismatch"));
  const lineage = structuredClone(scene.document);
  lineage.quantities[0]!.evidenceFactIds = ["requested"];
  assert(!checkVisualObligations(obligations, lineage).satisfied);
  const moved = structuredClone(scene.document);
  moved.constructions.find((construction) => construction.id === "place_a")!.inputs.x = 8;
  assert(validateSectionPointSourceInputs(moved, c.question).some((issue) => issue.code === "section_source_mismatch"));
  const wrongLabel = structuredClone(scene.document);
  wrongLabel.annotations.find((annotation) => annotation.targetIds.includes("pt_P"))!.text = "P=(8,9)";
  assert.equal(compileSceneDocument(wrongLabel).ok, false, "derived coordinate annotations are proved");
  const collision: SectionCase = { ...c, id: "equalCoordinates", question: "Find the point which divides the join of A(2,2) and B(8,8) internally in the ratio 1:2.", a: [2, 2], b: [8, 8], p: [4, 4] };
  const collisionIR = validated(problemFor(collision));
  const collisionScene = synthesizeFamilyScene({ question: collision.question, problemIR: collisionIR })!;
  collisionScene.document.quantities = collisionScene.document.quantities.filter((q) => q.id !== "Ay");
  assert(checkVisualObligations(deriveVisualObligations(collisionIR), collisionScene.document).missing.some((miss) => miss.obligationId === "dimension:Ay"), "Ax=2 cannot cover missing Ay=2");
  const role = structuredClone(scene.document);
  role.quantities[0]!.symbol = "A_y";
  assert(!checkVisualObligations(obligations, role).satisfied);
  assert(validateSectionPointSourceInputs(role, c.question).some((issue) => issue.code === "section_source_mismatch"));
  // Same source value in the wrong role must also reject scalar forgery after selection.
  const scalar = structuredClone(scene.document);
  scalar.quantities[0]!.value = 3;
  assert(!checkVisualObligations(obligations, scalar).satisfied);
  assert(validateSectionPointSourceInputs(scalar, c.question).some((issue) => issue.code === "section_source_mismatch"));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) verifyEngine();
