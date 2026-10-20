/**
 * Floor figure (DIAGRAM_FLOOR_FIGURE), structure-only design: values bind to
 * parts only through shared ProblemIR evidence, the binding audit refuses a
 * text that is not bound to the element that carries it, the floor never runs
 * without a ProblemIR, and a stated node network's loop count is exact.
 * Synthetic questions only; the adversarial set has its own gate.
 */
import assert from "node:assert/strict";
import {
  auditFloorFigure,
  buildFloorFigure,
  circuitTopologyFromProblemStructure,
  compileSceneDocument,
  readFloorBindings,
  readFloorFacts,
  type SceneDocument,
} from "../../src/index";
import { FLOOR_ADVERSARIAL_CASES } from "./fixtures/floorAdversarial";

let checks = 0;
const check = (condition: unknown, message: string) => { assert.ok(condition, message); checks += 1; };
const byId = (id: string) => FLOOR_ADVERSARIAL_CASES.find((item) => item.id === id)!;

// 1. Bindings: one value shared by a counted pair binds to both; a quote with two values binds nothing.
{
  const divider = byId("circuit-divider-nodes");
  const bindings = readFloorBindings(readFloorFacts(divider)!);
  const shared = bindings.find((binding) => binding.valueText === "4.7 kΩ");
  check(shared && shared.entityIds.length === 2 && shared.entityIds.includes("r1") && shared.entityIds.includes("r2"), "one stated value binds to every part its quote names");
  check(bindings.find((binding) => binding.valueText === "9 V")?.entityIds.join() === "sup", "a value binds to the part its own quote names");
  check(readFloorBindings(readFloorFacts(byId("body-shared-quote"))!).length === 0, "a quote stating two values binds neither");
}

// 2. No ProblemIR, no floor: text never chooses a kind.
for (const item of FLOOR_ADVERSARIAL_CASES.filter((candidate) => candidate.problemIR === null)) {
  const result = buildFloorFigure(item);
  check(result.figure === null && result.attempts.length === 0, `${item.id}: no kind is tried without a ProblemIR`);
}

// 3. The binding audit: the drawn divider passes; each mutation is refused.
{
  const divider = byId("circuit-divider-nodes");
  const facts = readFloorFacts(divider)!;
  const figure = buildFloorFigure(divider).figure!;
  check(figure.kind === "circuit", "the node divider draws");
  check(auditFloorFigure(figure.document, figure.renderScene, facts).length === 0, "the unmutated figure passes the binding audit");
  const mutate = (change: (document: SceneDocument) => void) => {
    const document = structuredClone(figure.document);
    change(document);
    const compiled = compileSceneDocument(document);
    assert.ok(compiled.renderScene, `mutation still compiles: ${JSON.stringify(compiled.report.issues.filter((issue) => issue.severity === "fatal")).slice(0, 300)}`);
    return auditFloorFigure(document, compiled.renderScene!, facts).map((issue) => issue.code);
  };
  const retarget = (id: string, target: string) => (document: SceneDocument) => {
    document.annotations = document.annotations.map((annotation) => annotation.id === id ? { ...annotation, targetIds: [target] } : annotation);
  };
  check(mutate(retarget("value_sup", "r1")).includes("floor_unbound_text"), "the supply's 9 V written on a resistor is refused");
  check(mutate(retarget("value_r1", "sup")).includes("floor_unbound_text"), "a resistor's 4.7 kΩ written on the supply is refused");
  check(mutate((document) => { document.annotations.push({ id: "solved", kind: "label", targetIds: ["r1"], text: "4.5 V", labelMode: "append" }); })
    .includes("floor_unbound_text"), "a solved value is refused");
  check(mutate((document) => { document.annotations.push({ id: "invented", kind: "label", targetIds: ["r2"], text: "10 kΩ", labelMode: "append" }); })
    .includes("floor_unbound_text"), "an invented value is refused");
  check(mutate((document) => { document.entities.find((entity) => entity.id === "r1")!.label = "battery"; }).includes("floor_unbound_text"),
    "another part's name is refused");
  check(mutate((document) => {
    document.entities.push({ id: "arrow", kind: "vector", role: "current", provenance: { floor: true } });
    document.constructions.push({ id: "draw_arrow", operator: "vector", inputs: { start: "n1", end: "n2" }, outputs: ["arrow"] });
    document.requiredEntityIds.push("arrow");
    document.revealGroups[0]!.entityIds.push("arrow");
  }).includes("floor_analysis_ink"), "any arrow is refused");
  check(mutate((document) => { delete document.entities[0]!.provenance; }).includes("floor_unsourced_entity"), "an entity with no stated source is refused");
  check(mutate((document) => { document.source = { ...document.source, question: "Another question." }; }).includes("floor_question"), "a figure built for another question is refused");
}

// 4. A stated node network's loops are exact: a series chain of five is one loop, a bridge is not.
{
  const series = circuitTopologyFromProblemStructure(byId("circuit-five-resistors").problemIR);
  check(series && !series.twoLoop, "five resistors in one stated loop are one loop");
  check(circuitTopologyFromProblemStructure(byId("circuit-bridge").problemIR)?.twoLoop === true, "a stated bridge is more than one loop");
  const divider = circuitTopologyFromProblemStructure(byId("circuit-divider-nodes").problemIR);
  check(divider && !divider.twoLoop, "a node that joins two parts is not a junction");
}

// 5. Every drawn adversarial case passes the audit independently of the builder.
for (const item of FLOOR_ADVERSARIAL_CASES.filter((candidate) => candidate.expect === "draw")) {
  const figure = buildFloorFigure(item).figure!;
  check(auditFloorFigure(figure.document, figure.renderScene, readFloorFacts(item)!).length === 0, `${item.id} passes the binding audit`);
}

console.log(`verify-floor-figure: ${checks} checks passed`);
