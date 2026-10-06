/**
 * DCP-02 regression gate: required visual obligations from source evidence
 * and structural ProblemIR.
 *
 * A scene that compiles is valid; these checks prove it is also whole. Three
 * source-grounded fixtures (a parallel network, an incline free body, a
 * bounded region) pin the four obligation kinds — named bodies, connections,
 * given dimensions, proved spatial relations — plus the persistence half
 * (requiredEntityIds and reveal coverage). Every fixture asserts the honest
 * scene satisfies its obligations, then mutates it once per kind and asserts
 * the exact miss; wrong-family pairings must reject in both directions, and a
 * compile-valid scene with a dropped label must still reject, proving the
 * compiler alone cannot catch incompleteness.
 *
 * Three independent oracles back the module: hand-written expectations per
 * case, a second implementation of the contract in this file (JSON-string
 * topology extraction and its own graph walk, not the module's helpers), and
 * parameter sweeps that rebuild the source, the structure, and the geometry
 * together. The live synthesis path is pinned too: a stale planner scalar
 * must never pair with an otherwise correct diagram.
 */
import { strict as assert } from "node:assert";
import {
  PROBLEM_IR_VERSION,
  SCENE_DOCUMENT_VERSION,
  checkVisualObligations,
  compileSceneDocument,
  deriveVisualObligations,
  evaluateConstantExpression,
  isFullProblemIRStructure,
  synthesizeFamilyScene,
  validateProblemIR,
  validateSceneDocument,
  visualObligationIssues,
  visualObligationsPlannerCoverage,
  type ProblemIR,
  type QuestionSourceEvidence,
  type SceneDocument,
  type TurnPlanV3,
  type VisualObligationSet,
} from "../../src";

let checks = 0;
function check(condition: unknown, message: string): void {
  checks += 1;
  assert.ok(condition, message);
}

function evidence(question: string, quote: string): QuestionSourceEvidence {
  const start = question.indexOf(quote);
  if (start < 0) throw new Error(`missing fixture quote: ${quote}`);
  return { source: "question", start, end: start + quote.length, quote };
}

function pointAt(id: string, x: number, y: number): SceneDocument["constructions"][number] {
  return { id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "world" }, outputs: [id] };
}

function timelineFor(groups: string[]): SceneDocument["teachingTimeline"] {
  return groups.map((group, index) => ({
    id: `reveal_${group}`,
    action: "reveal" as const,
    targetId: group,
    dependsOn: index === 0 ? [] : [`reveal_${groups[index - 1]!}`],
    narrationIntent: `Reveal ${group}.`,
  }));
}

/* -- Fixture A: three named resistors in parallel across a battery --------- */

const questionA =
  "Three resistors R1 = 12 ohm, R2 = 24 ohm, and R3 = 36 ohm are connected " +
  "in parallel across a 6 V battery. Find the equivalent resistance.";

function problemA(): ProblemIR {
  return {
    schemaVersion: PROBLEM_IR_VERSION,
    id: "parallelCircuit",
    question: questionA,
    facts: [
      { id: "r1Fact", kind: "given", statement: "R1 is 12 ohm.", evidence: evidence(questionA, "R1 = 12 ohm") },
      { id: "r2Fact", kind: "given", statement: "R2 is 24 ohm.", evidence: evidence(questionA, "R2 = 24 ohm") },
      { id: "r3Fact", kind: "given", statement: "R3 is 36 ohm.", evidence: evidence(questionA, "R3 = 36 ohm") },
      { id: "parFact", kind: "given", statement: "The resistors are connected in parallel.", evidence: evidence(questionA, "connected in parallel") },
      { id: "batFact", kind: "given", statement: "A 6 V battery drives the network.", evidence: evidence(questionA, "6 V battery") },
      { id: "reqFact", kind: "requested", statement: "Find the equivalent resistance.", evidence: evidence(questionA, "Find the equivalent resistance") },
    ],
    entities: [
      { id: "res1", kind: "component", label: "R1", evidenceFactIds: ["r1Fact"] },
      { id: "res2", kind: "component", label: "R2", evidenceFactIds: ["r2Fact"] },
      { id: "res3", kind: "component", label: "R3", evidenceFactIds: ["r3Fact"] },
      { id: "bat1", kind: "component", label: "V1", evidenceFactIds: ["batFact"] },
    ],
    expressions: [
      { id: "eR1", valueType: "scalar", root: { kind: "number", value: 12 }, evidenceFactIds: ["r1Fact"] },
      { id: "eR2", valueType: "scalar", root: { kind: "number", value: 24 }, evidenceFactIds: ["r2Fact"] },
      { id: "eR3", valueType: "scalar", root: { kind: "number", value: 36 }, evidenceFactIds: ["r3Fact"] },
      { id: "eV", valueType: "scalar", root: { kind: "number", value: 6 }, evidenceFactIds: ["batFact"] },
    ],
    constraints: [
      { id: "c12", kind: "connected", entityIds: ["res1", "res2"], evidenceFactIds: ["parFact"] },
      { id: "c23", kind: "connected", entityIds: ["res2", "res3"], evidenceFactIds: ["parFact"] },
      { id: "c1b", kind: "connected", entityIds: ["res1", "bat1"], evidenceFactIds: ["parFact", "batFact"] },
    ],
    representationIntents: [
      { id: "net1", kind: "network", entityIds: ["res1", "res2", "res3", "bat1"], evidenceFactIds: ["parFact", "batFact"] },
    ],
    solveRequests: [],
  };
}

function circuitScene(question: string): SceneDocument {
  const entityIds = ["n0", "n1", "r1", "r2", "r3", "batt"];
  return {
    schemaVersion: SCENE_DOCUMENT_VERSION,
    visualDecision: { mode: "scene", reason: "parallel resistors across a battery" },
    source: { question, obligationsFixture: "parallel-circuit" },
    quantities: [
      { id: "R1", symbol: "R1", value: 12, unit: "ohm" },
      { id: "R2", symbol: "R2", value: 24, unit: "ohm" },
      { id: "R3", symbol: "R3", value: 36, unit: "ohm" },
      { id: "V1", symbol: "V1", value: 6, unit: "V" },
    ],
    entities: [
      { id: "n0", kind: "point", role: "node" },
      { id: "n1", kind: "point", role: "node" },
      { id: "r1", kind: "component", role: "resistor", label: "R1" },
      { id: "r2", kind: "component", role: "resistor", label: "R2" },
      { id: "r3", kind: "component", role: "resistor", label: "R3" },
      { id: "batt", kind: "component", role: "source", label: "V1" },
    ],
    constructions: [
      pointAt("n0", 0, 0),
      pointAt("n1", 6, 0),
      { id: "make_r1", operator: "symbol", inputs: { symbol: "resistor", start: "n0", end: "n1" }, outputs: ["r1"] },
      { id: "make_r2", operator: "symbol", inputs: { symbol: "resistor", start: "n0", end: "n1" }, outputs: ["r2"] },
      { id: "make_r3", operator: "symbol", inputs: { symbol: "resistor", start: "n0", end: "n1" }, outputs: ["r3"] },
      { id: "make_batt", operator: "symbol", inputs: { symbol: "battery", start: "n0", end: "n1" }, outputs: ["batt"] },
    ],
    relations: [],
    assertions: [
      { id: "parallel_pair", predicate: "sameTerminalPair", entities: ["r1", "r2", "r3", "batt"], expected: true, severity: "fatal" },
    ],
    annotations: [{ id: "sense", kind: "sense", targetIds: ["r1"] }],
    requiredEntityIds: entityIds,
    revealGroups: [{ id: "setup", entityIds, dependsOn: [], narrationCue: "The parallel network." }],
    teachingTimeline: timelineFor(["setup"]),
  };
}

/* -- Fixture B: a named block on a dimensioned incline ---------------------- */

function inclineQuestion(theta: number, mass: number): string {
  return `A block of mass ${mass} kg rests on a ${theta} degree incline. Draw the free-body diagram.`;
}

function problemB(theta: number, mass: number): ProblemIR {
  const question = inclineQuestion(theta, mass);
  return {
    schemaVersion: PROBLEM_IR_VERSION,
    id: "inclineBlock",
    question,
    facts: [
      { id: "massFact", kind: "given", statement: `The block mass is ${mass} kg.`, evidence: evidence(question, `mass ${mass} kg`) },
      { id: "angleFact", kind: "given", statement: `The incline is ${theta} degrees.`, evidence: evidence(question, `${theta} degree`) },
      { id: "restFact", kind: "given", statement: "The block rests on the incline.", evidence: evidence(question, "rests on") },
      { id: "drawFact", kind: "requested", statement: "Draw the free-body diagram.", evidence: evidence(question, "Draw the free-body diagram") },
    ],
    entities: [
      { id: "block", kind: "body", label: "block", evidenceFactIds: ["massFact", "restFact"] },
      { id: "incline", kind: "line", label: "incline", evidenceFactIds: ["angleFact", "restFact"] },
      { id: "normalF", kind: "other", label: "N", evidenceFactIds: ["restFact", "drawFact"] },
      { id: "weightF", kind: "other", label: "mg", evidenceFactIds: ["massFact", "drawFact"] },
    ],
    expressions: [
      { id: "eMass", valueType: "scalar", root: { kind: "number", value: mass }, evidenceFactIds: ["massFact"] },
      { id: "eAngle", valueType: "scalar", root: { kind: "number", value: theta }, evidenceFactIds: ["angleFact"] },
    ],
    constraints: [
      { id: "perp1", kind: "perpendicular", entityIds: ["normalF", "incline"], evidenceFactIds: ["restFact", "drawFact"] },
      { id: "tan1", kind: "tangent", entityIds: ["block", "incline"], evidenceFactIds: ["restFact"] },
    ],
    representationIntents: [
      { id: "fb1", kind: "free_body", entityIds: ["block", "incline", "normalF", "weightF"], evidenceFactIds: ["drawFact"] },
    ],
    solveRequests: [],
  };
}

function inclineScene(question: string, theta: number, mass: number): SceneDocument {
  const radians = (theta * Math.PI) / 180;
  const endX = 4 * Math.cos(radians);
  const endY = 4 * Math.sin(radians);
  const contactX = endX * 0.45;
  const contactY = endY * 0.45;
  const nx = -Math.sin(radians);
  const ny = Math.cos(radians);
  const entityIds = ["base", "top", "contact", "block_center", "incline", "block", "normal", "weight"];
  return {
    schemaVersion: SCENE_DOCUMENT_VERSION,
    visualDecision: { mode: "scene", reason: "block on an incline with its free-body forces" },
    source: { question, obligationsFixture: "incline-block" },
    quantities: [
      { id: "theta", symbol: "theta", value: theta, unit: "degree" },
      { id: "m", symbol: "m", value: mass, unit: "kg" },
    ],
    entities: [
      { id: "base", kind: "point", role: "incline foot" },
      { id: "top", kind: "point", role: "incline top" },
      { id: "contact", kind: "point", role: "contact point" },
      { id: "block_center", kind: "point", role: "block center" },
      { id: "incline", kind: "segment", role: "inclined plane", label: "incline" },
      { id: "block", kind: "rectangle", role: "block", label: "block" },
      { id: "normal", kind: "vector", role: "normal reaction", label: "N" },
      { id: "weight", kind: "vector", role: "weight", label: "mg" },
    ],
    constructions: [
      pointAt("base", 0, 0),
      pointAt("top", endX, endY),
      pointAt("contact", contactX, contactY),
      pointAt("block_center", contactX + nx * 0.65, contactY + ny * 0.65),
      { id: "make_incline", operator: "segment", inputs: { start: "base", end: "top" }, outputs: ["incline"] },
      { id: "make_block", operator: "rectangle", inputs: { center: "block_center", width: 0.8, height: 0.6 }, outputs: ["block"] },
      { id: "make_normal", operator: "normal_at", inputs: { point: "contact", surface: "incline" }, outputs: ["normal"] },
      { id: "make_weight", operator: "vector", inputs: { start: "contact", direction: [0, -1], length: 1.2 }, outputs: ["weight"] },
    ],
    relations: [],
    assertions: [
      { id: "contact_on_incline", predicate: "on", entities: ["contact", "incline"], expected: true, severity: "fatal" },
      { id: "normal_perp", predicate: "perpendicular", entities: ["normal", "incline"], expected: true, severity: "fatal" },
    ],
    annotations: [{ id: "incline_hatch", kind: "hatch", targetIds: ["incline"] }],
    requiredEntityIds: entityIds,
    revealGroups: [{ id: "setup", entityIds, dependsOn: [], narrationCue: "The block and its forces." }],
    teachingTimeline: timelineFor(["setup"]),
  };
}

/* -- Fixture C: stated curves bounding a region ----------------------------- */

const questionC =
  "A curve y=x^2 and the line y=4 enclose a region. Sketch the region, " +
  "then find its area using integration.";

function problemC(): ProblemIR {
  return {
    schemaVersion: PROBLEM_IR_VERSION,
    id: "boundedRegion",
    question: questionC,
    facts: [
      { id: "curveFact", kind: "given", statement: "The curve is y=x^2.", evidence: evidence(questionC, "y=x^2") },
      { id: "lineFact", kind: "given", statement: "The line is y=4.", evidence: evidence(questionC, "y=4") },
      { id: "areaFact", kind: "requested", statement: "Find the enclosed area using integration.", evidence: evidence(questionC, "find its area using integration") },
      { id: "sketchFact", kind: "requested", statement: "Sketch the enclosed region.", evidence: evidence(questionC, "Sketch the region") },
    ],
    entities: [
      { id: "parabola", kind: "curve", label: "y=x^2", evidenceFactIds: ["curveFact"] },
      { id: "ceiling", kind: "line", label: "y=4", evidenceFactIds: ["lineFact"] },
      { id: "region", kind: "region", evidenceFactIds: ["curveFact", "lineFact", "sketchFact"] },
    ],
    expressions: [
      {
        id: "curveFn", valueType: "function",
        root: { kind: "binary", operator: "^", left: { kind: "variable", name: "x" }, right: { kind: "number", value: 2 } },
        evidenceFactIds: ["curveFact"],
      },
      { id: "lineFn", valueType: "function", root: { kind: "number", value: 4 }, evidenceFactIds: ["lineFact"] },
      { id: "eLevel", valueType: "scalar", root: { kind: "number", value: 4 }, evidenceFactIds: ["lineFact"] },
      { id: "areaScalar", valueType: "scalar", root: { kind: "number", value: 10.6666666667 }, evidenceFactIds: ["areaFact"] },
    ],
    constraints: [
      { id: "eq1", kind: "equation", leftExpressionId: "curveFn", rightExpressionId: "lineFn", evidenceFactIds: ["curveFact", "lineFact"] },
    ],
    representationIntents: [
      { id: "drawRegion", kind: "bounded_region", entityIds: ["parabola", "ceiling", "region"], evidenceFactIds: ["sketchFact"] },
    ],
    solveRequests: [],
  };
}

function regionScene(question: string): SceneDocument {
  const entityIds = ["axes", "upper", "lower", "region"];
  return {
    schemaVersion: SCENE_DOCUMENT_VERSION,
    visualDecision: { mode: "scene", reason: "stated curves bounding their region" },
    source: { question, obligationsFixture: "bounded-region" },
    quantities: [{ id: "level", symbol: "level", value: 4, unit: "1" }],
    entities: [
      { id: "axes", kind: "axes", role: "display axes" },
      { id: "upper", kind: "polyline", role: "upper boundary", label: "y=4" },
      { id: "lower", kind: "polyline", role: "lower boundary", label: "y=x^2" },
      { id: "region", kind: "polygon", role: "bounded region" },
    ],
    constructions: [
      { id: "make_axes", operator: "axes", inputs: { xMin: -3, xMax: 3, yMin: -1, yMax: 5 }, outputs: ["axes"] },
      { id: "make_upper", operator: "function_curve", inputs: { expression: "4", variable: "x", xMin: -2, xMax: 2, samples: 65 }, outputs: ["upper"] },
      { id: "make_lower", operator: "function_curve", inputs: { expression: "x^2", variable: "x", xMin: -2, xMax: 2, samples: 65 }, outputs: ["lower"] },
      { id: "make_region", operator: "function_region", inputs: { upper: "upper", lower: "lower", xMin: -2, xMax: 2, samples: 65 }, outputs: ["region"] },
    ],
    relations: [],
    assertions: [
      { id: "region_exists", predicate: "exists", entities: ["region"], expected: true, severity: "fatal" },
    ],
    annotations: [],
    requiredEntityIds: entityIds,
    revealGroups: [{ id: "setup", entityIds, dependsOn: [], narrationCue: "The stated boundaries and region." }],
    teachingTimeline: timelineFor(["setup"]),
  };
}

/* -- Independent oracle: a second implementation of the same contract ------ */
/* Reads the same inputs through different means (JSON-string topology        */
/* extraction, its own graph walk and tolerance) and must agree with the     */
/* module on every case below. Absolute hand expectations carry the verdict;  */
/* this agreement guards against implementation drift.                       */

function oracleVerdicts(
  set: VisualObligationSet,
  document: SceneDocument,
): Map<string, boolean> {
  const verdicts = new Map<string, boolean>();
  const normalize = (value: string): string => value.trim().replace(/\s+/g, " ");
  const mapping = new Map<string, string>();
  const used = new Set<string>();
  for (const obligation of set.obligations) {
    if (obligation.kind !== "named_body") continue;
    const byId = document.entities.find((entity) => entity.id === obligation.problemEntityId && !used.has(entity.id));
    if (byId) {
      mapping.set(obligation.problemEntityId, byId.id);
      used.add(byId.id);
      continue;
    }
    if (obligation.problemLabel !== null) {
      const wanted = normalize(obligation.problemLabel);
      const byLabel = document.entities.find(
        (entity) => !used.has(entity.id) && typeof entity.label === "string" && normalize(entity.label) === wanted,
      );
      if (byLabel) {
        mapping.set(obligation.problemEntityId, byLabel.id);
        used.add(byLabel.id);
      }
    }
  }

  const known = new Set(document.entities.map((entity) => entity.id));
  const adjacency = new Map<string, Set<string>>();
  const link = (first: string, second: string): void => {
    if (first === second || !known.has(first) || !known.has(second)) return;
    if (!adjacency.has(first)) adjacency.set(first, new Set());
    if (!adjacency.has(second)) adjacency.set(second, new Set());
    adjacency.get(first)!.add(second);
    adjacency.get(second)!.add(first);
  };
  const clique = (ids: readonly string[]): void => {
    const members = [...new Set(ids.filter((id) => known.has(id)))];
    for (const first of members) for (const second of members) link(first, second);
  };
  for (const construction of document.constructions) {
    const refs = [...JSON.stringify(construction.inputs).matchAll(/"([^"]*)"/g)]
      .map((match) => match[1]!)
      .filter((text) => known.has(text));
    clique([...refs, ...construction.outputs]);
  }
  const joined = (ids: readonly string[]): boolean => {
    if (ids.length < 2) return true;
    const reached = new Set([ids[0]!]);
    const stack = [ids[0]!];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const next of adjacency.get(current) ?? []) {
        if (reached.has(next)) continue;
        reached.add(next);
        stack.push(next);
      }
    }
    return ids.every((id) => reached.has(id));
  };
  const resolve = (problemIds: readonly string[]): string[] | null => {
    const sceneIds: string[] = [];
    for (const problemId of problemIds) {
      const mapped = mapping.get(problemId) ?? (known.has(problemId) ? problemId : null);
      if (!mapped) return null;
      sceneIds.push(mapped);
    }
    return sceneIds;
  };

  for (const obligation of set.obligations) {
    if (!obligation.supported) continue;
    switch (obligation.kind) {
      case "named_body": {
        const sceneId = mapping.get(obligation.problemEntityId);
        const covered = sceneId !== undefined
          && document.requiredEntityIds.includes(sceneId)
          && document.revealGroups.some((group) => group.entityIds.includes(sceneId));
        verdicts.set(obligation.id, covered);
        break;
      }
      case "connection": {
        const sceneIds = resolve(obligation.problemEntityIds);
        verdicts.set(obligation.id, sceneIds !== null && joined(sceneIds));
        break;
      }
      case "given_dimension": {
        const held = document.quantities.some((quantity) => {
          if (typeof quantity.value !== "number") return false;
          const gap = Math.abs(quantity.value - obligation.value);
          const scale = Math.max(1, Math.abs(quantity.value), Math.abs(obligation.value));
          return gap <= 1e-9 * scale;
        });
        verdicts.set(obligation.id, held);
        break;
      }
      case "spatial_relation": {
        const sceneIds = resolve(obligation.problemEntityIds);
        const proved = sceneIds !== null && document.assertions.some(
          (assertion) =>
            assertion.severity === "fatal" &&
            obligation.predicates.includes(assertion.predicate) &&
            sceneIds.every((id) => assertion.entities.includes(id)),
        );
        verdicts.set(obligation.id, proved);
        break;
      }
    }
  }
  return verdicts;
}

function expectAgreement(set: VisualObligationSet, document: SceneDocument, label: string): void {
  const moduleResult = checkVisualObligations(set, document);
  const failed = new Set(moduleResult.missing.map((miss) => miss.obligationId));
  const oracle = oracleVerdicts(set, document);
  for (const obligation of set.obligations) {
    if (!obligation.supported) continue;
    const moduleVerdict = !failed.has(obligation.id);
    check(
      oracle.get(obligation.id) === moduleVerdict,
      `${label}: oracle disagrees with the module on ${obligation.id}`,
    );
  }
}

function missIds(set: VisualObligationSet, document: SceneDocument): Set<string> {
  return new Set(checkVisualObligations(set, document).missing.map((miss) => miss.obligationId));
}

/* -- Contract shape and constant evaluation -------------------------------- */

check(isFullProblemIRStructure(problemA()), "fixture A must read as a full ProblemIR");
check(isFullProblemIRStructure(problemB(30, 2)), "fixture B must read as a full ProblemIR");
check(isFullProblemIRStructure(problemC()), "fixture C must read as a full ProblemIR");
check(!isFullProblemIRStructure({ entities: [{ kind: "component", label: "R1" }] }), "a loose view must not trigger obligations");
check(!isFullProblemIRStructure(null), "a missing structure must not trigger obligations");

check(validateProblemIR(problemA()).valid, `fixture A ProblemIR must validate: ${JSON.stringify(validateProblemIR(problemA()).issues)}`);
check(validateProblemIR(problemB(30, 2)).valid, `fixture B ProblemIR must validate: ${JSON.stringify(validateProblemIR(problemB(30, 2)).issues)}`);
check(validateProblemIR(problemC()).valid, `fixture C ProblemIR must validate: ${JSON.stringify(validateProblemIR(problemC()).issues)}`);

check(evaluateConstantExpression({ kind: "number", value: 12 }) === 12, "literal 12 must fold to 12");
check(evaluateConstantExpression({ kind: "constant", name: "pi" }) === Math.PI, "pi must fold to Math.PI");
check(
  evaluateConstantExpression({ kind: "binary", operator: "+", left: { kind: "number", value: 12 }, right: { kind: "number", value: 24 } }) === 36,
  "12 + 24 must fold to 36",
);
check(
  evaluateConstantExpression({ kind: "binary", operator: "/", left: { kind: "number", value: 1 }, right: { kind: "number", value: 0 } }) === null,
  "division by zero must not fold",
);
check(
  evaluateConstantExpression({ kind: "call", function: "sqrt", argument: { kind: "number", value: -1 } }) === null,
  "sqrt of a negative must not fold",
);
check(
  evaluateConstantExpression({ kind: "call", function: "log", argument: { kind: "number", value: 0 } }) === null,
  "log of zero must not fold",
);
check(
  evaluateConstantExpression({ kind: "variable", name: "x" }) === null,
  "a free variable must not fold",
);
check(
  evaluateConstantExpression({ kind: "number", value: Number.POSITIVE_INFINITY }) === null,
  "a non-finite literal must not fold",
);

/* -- Derivation: what each source requires ---------------------------------- */

const setA = deriveVisualObligations(problemA());
check(setA.obligations.length === 11, `fixture A must derive 11 obligations, got ${setA.obligations.length}`);
check(setA.obligations.filter((o) => o.kind === "named_body").length === 4, "fixture A must obligate 4 bodies");
check(setA.obligations.filter((o) => o.kind === "connection").length === 3, "fixture A must obligate 3 connections");
check(setA.obligations.filter((o) => o.kind === "given_dimension").length === 4, "fixture A must obligate 4 dimensions");
check(visualObligationsPlannerCoverage(setA).covered, "fixture A obligations must be planner-expressible");

const setB = deriveVisualObligations(problemB(30, 2));
check(setB.obligations.length === 8, `fixture B must derive 8 obligations, got ${setB.obligations.length}`);
check(setB.obligations.filter((o) => o.kind === "spatial_relation" && o.supported).length === 1, "fixture B must obligate 1 provable relation");
check(
  setB.obligations.filter((o) => !o.supported).map((o) => o.id).join(",") === "relation:tan1",
  "tangent has no executable predicate and must be declared unsupported, not dropped or rejected",
);
check(visualObligationsPlannerCoverage(setB).covered, "fixture B obligations must be planner-expressible");

const setC = deriveVisualObligations(problemC());
check(setC.obligations.length === 4, `fixture C must derive 4 obligations, got ${setC.obligations.length}`);
check(
  setC.obligations.filter((o) => o.kind === "given_dimension").map((o) => o.id).join(",") === "dimension:eLevel",
  "only the given-grounded literal is a dimension; function trees, equations, and requested values obligate nothing",
);

const emptyProblem: ProblemIR = {
  schemaVersion: PROBLEM_IR_VERSION,
  id: "emptyStructure",
  question: "Is this a diagram question?",
  facts: [
    { id: "only", kind: "given", statement: "A bare question.", evidence: evidence("Is this a diagram question?", "diagram question") },
  ],
  entities: [],
  expressions: [],
  constraints: [],
  representationIntents: [],
  solveRequests: [],
};
check(validateProblemIR(emptyProblem).valid, "the empty structure must validate");
const emptySet = deriveVisualObligations(emptyProblem);
check(emptySet.obligations.length === 0, "an empty structure must derive no obligations");
check(checkVisualObligations(emptySet, circuitScene(questionA)).satisfied, "no obligations must pass any scene");

/* -- Honest scenes: satisfy raw, validated, compiled, and rendered --------- */

function validatedScene(document: SceneDocument, label: string): SceneDocument {
  const validated = validateSceneDocument(structuredClone(document));
  check(validated.document !== null, `${label} must validate: ${JSON.stringify(validated.report.issues)}`);
  return validated.document!;
}

function compiledScene(document: SceneDocument, label: string): SceneDocument {
  const validated = validatedScene(document, label);
  const compiled = compileSceneDocument(validated);
  check(compiled.ok && compiled.renderScene !== null, `${label} must compile: ${JSON.stringify(compiled.report.issues)}`);
  check(compiled.renderScene!.primitives.length > 0, `${label} must render ink`);
  return validated;
}

const honestA = circuitScene(questionA);
const honestB = inclineScene(inclineQuestion(30, 2), 30, 2);
const honestC = regionScene(questionC);

check(checkVisualObligations(setA, honestA).satisfied, "the honest network must satisfy its obligations");
check(checkVisualObligations(setB, honestB).satisfied, "the honest free body must satisfy its obligations");
check(checkVisualObligations(setC, honestC).satisfied, "the honest region must satisfy its obligations");
expectAgreement(setA, honestA, "honest network");
expectAgreement(setB, honestB, "honest free body");
expectAgreement(setC, honestC, "honest region");

const renderedA = compiledScene(honestA, "honest network");
const renderedB = compiledScene(honestB, "honest free body");
const renderedC = compiledScene(honestC, "honest region");
check(checkVisualObligations(setA, renderedA).satisfied, "validation must preserve the network obligations");
check(checkVisualObligations(setB, renderedB).satisfied, "validation must preserve the free-body obligations");
check(checkVisualObligations(setC, renderedC).satisfied, "validation must preserve the region obligations");

function expectRenderedEntities(label: string, document: SceneDocument, sceneIds: readonly string[]): void {
  const compiled = compileSceneDocument(document);
  const rendered = new Set((compiled.renderScene?.primitives ?? []).map((primitive) => primitive.entityId));
  for (const sceneId of sceneIds) {
    check(rendered.has(sceneId), `${label} must render obligated entity ${sceneId}`);
  }
}
expectRenderedEntities("honest network", renderedA, ["r1", "r2", "r3", "batt"]);
expectRenderedEntities("honest free body", renderedB, ["block", "incline", "normal", "weight"]);
expectRenderedEntities("honest region", renderedC, ["upper", "lower", "region"]);

// An honest representation is about requirements, not pixels: moved geometry
// with the same bodies, topology, dimensions, and proofs still satisfies.
const altB = inclineScene(inclineQuestion(30, 2), 30, 2);
const altCenter = altB.constructions.find((construction) => construction.outputs.includes("block_center"));
if (altCenter && typeof altCenter.inputs.x === "number") {
  altCenter.inputs.x += 0.2;
  altCenter.inputs.y = Number(altCenter.inputs.y) - 0.1;
}
altB.revealGroups = [
  { id: "bodies", entityIds: ["base", "top", "contact", "block_center", "incline", "block"], dependsOn: [], narrationCue: "Bodies." },
  { id: "forces", entityIds: ["normal", "weight"], dependsOn: ["bodies"], narrationCue: "Forces." },
];
altB.teachingTimeline = timelineFor(["bodies", "forces"]);
check(checkVisualObligations(setB, altB).satisfied, "a repositioned honest representation must still satisfy");
expectAgreement(setB, altB, "honest representation");

/* -- Partial scenes: one mutation per kind, each with its exact miss ------- */

function expectMisses(
  label: string,
  set: VisualObligationSet,
  document: SceneDocument,
  expected: readonly string[],
): void {
  const misses = missIds(set, document);
  check(
    misses.size === expected.length && expected.every((id) => misses.has(id)),
    `${label} must miss exactly [${expected.join(", ")}], got [${[...misses].join(", ")}]`,
  );
  expectAgreement(set, document, label);
}

// A: drop the third resistor outright.
const dropR3 = structuredClone(honestA);
dropR3.entities = dropR3.entities.filter((entity) => entity.id !== "r3");
dropR3.constructions = dropR3.constructions.filter((construction) => !construction.outputs.includes("r3"));
expectMisses("network without R3", setA, dropR3, ["body:res3", "connection:c23"]);

// A: keep the battery body but unwire it.
const unwiredBattery = structuredClone(honestA);
unwiredBattery.constructions = unwiredBattery.constructions.filter((construction) => !construction.outputs.includes("batt"));
expectMisses("network with an unwired battery", setA, unwiredBattery, ["connection:c1b"]);

// A: drop the battery voltage.
const dropVoltage = structuredClone(honestA);
dropVoltage.quantities = dropVoltage.quantities.filter((quantity) => quantity.id !== "V1");
expectMisses("network without its voltage", setA, dropVoltage, ["dimension:eV"]);

// A: mislabel one resistor.
const mislabeledR2 = structuredClone(honestA);
mislabeledR2.entities.find((entity) => entity.id === "r2")!.label = "R2b";
expectMisses("network with R2 mislabeled", setA, mislabeledR2, ["body:res2", "connection:c12", "connection:c23"]);

// A: persistence — obligated ink must be required and revealed.
const unrequiredR1 = structuredClone(honestA);
unrequiredR1.requiredEntityIds = unrequiredR1.requiredEntityIds.filter((id) => id !== "r1");
expectMisses("network with R1 unrequired", setA, unrequiredR1, ["body:res1"]);
const unrevealedR1 = structuredClone(honestA);
unrevealedR1.revealGroups = [{ id: "setup", entityIds: ["n0", "n1", "r2", "r3", "batt"], dependsOn: [], narrationCue: "Partial." }];
expectMisses("network with R1 unrevealed", setA, unrevealedR1, ["body:res1"]);

// B: drop the normal force label.
const unlabeledNormal = structuredClone(honestB);
delete unlabeledNormal.entities.find((entity) => entity.id === "normal")!.label;
expectMisses("free body without the N label", setB, unlabeledNormal, ["body:normalF", "relation:perp1"]);

// B: drop the perpendicular proof.
const unprovedNormal = structuredClone(honestB);
unprovedNormal.assertions = unprovedNormal.assertions.filter((assertion) => assertion.id !== "normal_perp");
expectMisses("free body without its perpendicular proof", setB, unprovedNormal, ["relation:perp1"]);

// B: a stale angle pairs with otherwise correct geometry and must reject.
const staleAngle = structuredClone(honestB);
staleAngle.quantities.find((quantity) => quantity.id === "theta")!.value = 31;
expectMisses("free body with a stale angle", setB, staleAngle, ["dimension:eAngle"]);

// C: drop the region, then the level.
const dropRegion = structuredClone(honestC);
dropRegion.entities = dropRegion.entities.filter((entity) => entity.id !== "region");
dropRegion.constructions = dropRegion.constructions.filter((construction) => !construction.outputs.includes("region"));
expectMisses("region without its region", setC, dropRegion, ["body:region"]);
const dropLevel = structuredClone(honestC);
dropLevel.quantities = [];
expectMisses("region without its level", setC, dropLevel, ["dimension:eLevel"]);

// Compiling cannot catch incompleteness: an unlabeled resistor still renders,
// so the obligations — not the compiler — must reject it.
const unlabeledR3 = structuredClone(honestA);
delete unlabeledR3.entities.find((entity) => entity.id === "r3")!.label;
const unlabeledValidation = validateSceneDocument(unlabeledR3);
check(unlabeledValidation.document !== null, "an unlabeled resistor must still validate");
const unlabeledCompile = compileSceneDocument(unlabeledValidation.document!);
check(
  unlabeledCompile.ok && (unlabeledCompile.renderScene?.primitives.length ?? 0) > 0,
  "an unlabeled resistor must still compile and render",
);
expectMisses("rendered network without the R3 label", setA, unlabeledValidation.document!, ["body:res3", "connection:c23"]);

// Wrong family in both directions: whole scenes, wrong sources.
check(!checkVisualObligations(setA, honestB).satisfied, "network obligations must reject the free-body scene");
check(
  ["body:res1", "body:res2", "body:res3", "body:bat1"].every((id) => missIds(setA, honestB).has(id)),
  "the free-body scene must miss every named network body",
);
check(!checkVisualObligations(setB, honestA).satisfied, "free-body obligations must reject the network scene");
check(!checkVisualObligations(setC, honestA).satisfied, "region obligations must reject the network scene");
check(!checkVisualObligations(setA, honestC).satisfied, "network obligations must reject the region scene");
expectAgreement(setA, honestB, "wrong family network/free-body");
expectAgreement(setB, honestA, "wrong family free-body/network");

// The issues API reports fatal scene issues with the mutation codes.
const staleIssues = visualObligationIssues(problemB(30, 2), staleAngle);
check(
  staleIssues.length === 1 && staleIssues[0]!.code === "missing_given_dimension" && staleIssues[0]!.severity === "fatal",
  `stale-angle issues must be one fatal missing_given_dimension, got ${JSON.stringify(staleIssues)}`,
);
check(visualObligationIssues(problemA(), honestA).length === 0, "the honest network must raise no issues");

/* -- Parameter variations: rebuild source, structure, and geometry together */

for (const theta of [15, 45, 60]) {
  for (const mass of [1, 5]) {
    const variedProblem = problemB(theta, mass);
    check(validateProblemIR(variedProblem).valid, `theta=${theta} mass=${mass} must validate`);
    const variedSet = deriveVisualObligations(variedProblem);
    const variedScene = inclineScene(inclineQuestion(theta, mass), theta, mass);
    check(
      checkVisualObligations(variedSet, variedScene).satisfied,
      `theta=${theta} mass=${mass} must satisfy when source, structure, and geometry agree`,
    );
    const variedStale = structuredClone(variedScene);
    variedStale.quantities.find((quantity) => quantity.id === "theta")!.value = theta + 1;
    expectMisses(`theta=${theta} mass=${mass} stale`, variedSet, variedStale, ["dimension:eAngle"]);
  }
}

/* -- Live synthesis: obligations gate every path, stale scalars never pair */

function livePlan(question: string, givens: TurnPlanV3["givens"]): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3",
    question,
    givens,
    unknowns: [],
    derived: [],
    qualitativeClaims: [],
    lawIds: [],
    assumptions: [],
    visualRequirement: "required",
  };
}

function liveInclineProblem(theta: number): ProblemIR {
  const question = inclineQuestion(theta, 2);
  return {
    schemaVersion: PROBLEM_IR_VERSION,
    id: "liveIncline",
    question,
    facts: [
      { id: "angleFact", kind: "given", statement: `The incline is ${theta} degrees.`, evidence: evidence(question, `${theta} degree`) },
      { id: "restFact", kind: "given", statement: "The block rests on the incline.", evidence: evidence(question, "rests on") },
      { id: "drawFact", kind: "requested", statement: "Draw the free-body diagram.", evidence: evidence(question, "Draw the free-body diagram") },
    ],
    entities: [
      { id: "incline", kind: "line", evidenceFactIds: ["angleFact", "restFact"] },
      { id: "contact", kind: "point", evidenceFactIds: ["restFact"] },
    ],
    expressions: [
      { id: "eAngle", valueType: "scalar", root: { kind: "number", value: theta }, evidenceFactIds: ["angleFact"] },
    ],
    constraints: [
      { id: "inc1", kind: "incident", entityIds: ["contact", "incline"], evidenceFactIds: ["restFact"] },
    ],
    representationIntents: [
      { id: "fb1", kind: "free_body", entityIds: ["incline", "contact"], evidenceFactIds: ["drawFact"] },
    ],
    solveRequests: [],
  };
}

const liveQuestion = inclineQuestion(30, 2);
const liveProblem = liveInclineProblem(30);
check(validateProblemIR(liveProblem).valid, "the live incline structure must validate");
const liveSet = deriveVisualObligations(liveProblem);
const liveHonest = synthesizeFamilyScene({
  question: liveQuestion,
  turnPlan: livePlan(liveQuestion, [
    { id: "m", symbol: "m", value: 2, unit: "kg", provenance: "given" },
    { id: "theta", symbol: "theta", value: 30, unit: "degree", provenance: "given" },
  ]),
  problemIR: liveProblem,
});
check(liveHonest !== null, "live synthesis must still commit when obligations are met");
if (liveHonest) {
  check(
    checkVisualObligations(liveSet, liveHonest.document).satisfied,
    `the committed live scene must satisfy its obligations (family ${liveHonest.family})`,
  );
  expectAgreement(liveSet, liveHonest.document, `live ${liveHonest.family}`);
}

const liveStale = synthesizeFamilyScene({
  question: liveQuestion,
  turnPlan: livePlan(liveQuestion, [
    { id: "m", symbol: "m", value: 2, unit: "kg", provenance: "given" },
    { id: "theta", symbol: "theta", value: 31, unit: "degree", provenance: "given" },
  ]),
  problemIR: liveProblem,
});
check(
  liveStale === null || checkVisualObligations(liveSet, liveStale.document).satisfied,
  "a stale planner scalar must never pair with a committed scene: synthesis must decline or carry the source value",
);

console.log(`verify-visual-obligations: ok (${checks} checks)`);
console.log(`  fixtures=3 (network 11, free-body 7+1 unsupported, region 4) + empty-structure vacuity`);
console.log(`  mutations=12 partial + 4 wrong-family + 1 compile-valid-but-incomplete + 6 parameter sweeps`);
console.log(`  live: honest commits whole${liveHonest ? ` (${liveHonest.family}, ${liveHonest.tier})` : ""}, stale ${liveStale === null ? "declines" : `commits ${liveStale.family} carrying the source value`}`);
