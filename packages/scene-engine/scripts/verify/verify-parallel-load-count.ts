/** Synthetic topology oracles; no recorded questions or model output. */
import assert from "node:assert/strict";
import { evaluateTopologyAssertion, readParallelLoadCount, validateTopologyInvariants } from "../../src/topology/topology";
import type { SceneAssertion, SceneDocument, SceneIssue } from "../../src/types";

function parallel(): SceneDocument {
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "Parallel topology proof" },
    source: { question: "Explain a parallel circuit.", nonMetric: true, representationTier: "qualitative_verified" },
    quantities: [],
    entities: [
      { id: "A", kind: "point", role: "node" },
      { id: "B", kind: "point", role: "node" },
      { id: "V", kind: "component", role: "source" },
      { id: "R1", kind: "component", role: "resistor" },
      { id: "R2", kind: "component", role: "resistor" },
    ],
    constructions: [
      { id: "make_A", operator: "point", inputs: { x: 0, y: 2, coordinateSpace: "layout" }, outputs: ["A"] },
      { id: "make_B", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "layout" }, outputs: ["B"] },
      { id: "make_V", operator: "symbol", inputs: { symbol: "battery", start: "A", end: "B" }, outputs: ["V"] },
      { id: "make_R1", operator: "symbol", inputs: { symbol: "resistor", start: "A", end: "B" }, outputs: ["R1"] },
      { id: "make_R2", operator: "symbol", inputs: { symbol: "resistor", start: "A", end: "B" }, outputs: ["R2"] },
    ],
    relations: [],
    assertions: [{ id: "all_loads_parallel", predicate: "sameTerminalPair", entities: ["R1", "R2"], expected: true, severity: "fatal" }],
    annotations: [],
    requiredEntityIds: ["A", "B", "V", "R1", "R2"],
    revealGroups: [{ id: "circuit", entityIds: ["A", "B", "V", "R1", "R2"], dependsOn: [], narrationCue: "Parallel loads" }],
    teachingTimeline: [],
  };
}

let checks = 0;
function check(value: unknown, message: string): asserts value {
  checks += 1;
  assert.ok(value, message);
}
function evaluate(document: SceneDocument, predicate: string, expected: unknown, entities = ["A", "B"]) {
  const issues: SceneIssue[] = [];
  const assertion: SceneAssertion = { id: "branch_count", predicate, entities, expected, severity: "fatal" };
  return { passed: evaluateTopologyAssertion(assertion, document, issues), issues };
}
function branch(document: SceneDocument, id: string, symbol: string, start = "A", end = "B", role = symbol) {
  document.entities.push({ id, kind: "component", role });
  document.constructions.push({ id: `make_${id}`, operator: "symbol", inputs: { symbol, start, end }, outputs: [id] });
  document.requiredEntityIds.push(id);
  document.revealGroups[0]!.entityIds.push(id);
}
function point(document: SceneDocument, id: string, x = 3, y = 1) {
  document.entities.push({ id, kind: "point", role: "node" });
  document.constructions.push({ id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "layout" }, outputs: [id] });
  document.requiredEntityIds.push(id);
  document.revealGroups[0]!.entityIds.push(id);
}
function wire(document: SceneDocument, id: string, start: string, end: string) {
  document.entities.push({ id, kind: "connector", role: "wire" });
  document.constructions.push({ id: `make_${id}`, operator: "connect", inputs: { start, end }, outputs: [id] });
  document.requiredEntityIds.push(id);
  document.revealGroups[0]!.entityIds.push(id);
}
function remove(document: SceneDocument, id: string) {
  document.entities = document.entities.filter((entity) => entity.id !== id);
  document.constructions = document.constructions.filter((construction) => !construction.outputs.includes(id));
  document.requiredEntityIds = document.requiredEntityIds.filter((entityId) => entityId !== id);
  document.revealGroups.forEach((group) => { group.entityIds = group.entityIds.filter((entityId) => entityId !== id); });
}
function moveTerminal(document: SceneDocument, id: string, end: string, endpoint = "end") {
  document.constructions.find((construction) => construction.outputs.includes(id))!.inputs[endpoint] = end;
}
function refuse(document: SceneDocument, name: string) {
  check(!readParallelLoadCount(document, "A", "B").ok, `${name}: direct parallel load proof must refuse`);
  check(evaluate(document, "loadBranchCount", 2).passed === false, `${name}: loadBranchCount must refuse`);
  check(evaluate(document, "pathCount", 2).passed === false, `${name}: no new legacy compatibility`);
}

const base = parallel();
const query = readParallelLoadCount(base, "A", "B");
check(query.ok && query.count === 2 && query.sourceId === "V" && query.loadIds.join(",") === "R1,R2",
  "A source and two loads have two load branches");
check(evaluate(base, "loadBranchCount", 2).passed === true, "Explicit loadBranchCount excludes the source");
const compatibility = evaluate(base, "pathCount", 2);
check(compatibility.passed === true, `A complete independent load proof must enable legacy compatibility: ${JSON.stringify(compatibility.issues)}`);
check(compatibility.issues.some((issue) => issue.code === "path_count_load_branch_compatibility" && issue.severity === "warning"),
  "Legacy reinterpretation must be observable");
const strict = evaluate(base, "pathCount", 3);
check(strict.passed === true && strict.issues.length === 0, "Existing strict pathCount=3 behavior stays unchanged");
for (const expected of [0, 1, 3, 4]) {
  check(evaluate(base, "loadBranchCount", expected).passed === false, `Wrong claimed load count ${expected} must refuse`);
}
for (const expected of [true, false, "2", -1, 2.5, NaN, Infinity, null, undefined]) {
  check(evaluate(base, "loadBranchCount", expected).passed === false, `Invalid load count ${String(expected)} must refuse`);
}
for (const entities of [["A"], ["A", "B", "V"], ["A", "A"], ["V", "B"], ["missing", "B"]]) {
  check(evaluate(base, "loadBranchCount", 2, entities).passed === false, `Bad terminal query ${entities.join(",")} must refuse`);
}
const wrongCount = parallel();
branch(wrongCount, "R3", "resistor");
const threeLoads = readParallelLoadCount(wrongCount, "A", "B");
check(threeLoads.ok && threeLoads.count === 3, "Three actual loads must be counted as three");
check(evaluate(wrongCount, "loadBranchCount", 2).passed === false, "Three loads cannot claim two load branches");
check(evaluate(wrongCount, "pathCount", 2).passed === false, "Three loads cannot acquire two-load compatibility");
const oneLoad = parallel();
remove(oneLoad, "R2");
check(evaluate(oneLoad, "pathCount", 2).passed === true, "One load plus source retains strict two-graph-path semantics");
check(evaluate(oneLoad, "pathCount", 2).issues.length === 0, "Strict graph-path success must not claim a load interpretation");
check(evaluate(oneLoad, "loadBranchCount", 2).passed === false, "One load cannot claim two load branches");

const directShort = parallel();
wire(directShort, "short", "A", "B");
refuse(directShort, "Wire directly shorting the loads");
const directIssues: SceneIssue[] = [];
validateTopologyInvariants(directShort, directIssues);
check(directIssues.some((issue) => issue.code === "component_bypassed"), "Direct short keeps the unconditional invariant");
const bypass = parallel();
point(bypass, "X");
wire(bypass, "w1", "A", "X");
wire(bypass, "w2", "X", "B");
refuse(bypass, "Multi-wire bypass around loads");
const bypassIssues: SceneIssue[] = [];
validateTopologyInvariants(bypass, bypassIssues);
check(bypassIssues.some((issue) => issue.code === "component_bypassed"), "Multi-wire short keeps the unconditional invariant");
const selfLoop = parallel();
branch(selfLoop, "shorted_load", "resistor", "A", "A");
refuse(selfLoop, "A shorted self-loop load cannot silently disappear from the graph");
const twoSources = parallel();
branch(twoSources, "V2", "cell");
refuse(twoSources, "Two DC sources");
const fakeSource = parallel();
fakeSource.constructions.find((construction) => construction.outputs.includes("V"))!.inputs.symbol = "resistor";
refuse(fakeSource, "A resistor with a source role cannot become a source");
const falseLabel = parallel();
falseLabel.entities.find((entity) => entity.id === "V")!.label = "battery";
falseLabel.constructions.find((construction) => construction.outputs.includes("V"))!.inputs.symbol = "lamp";
refuse(falseLabel, "A source label does not classify a lamp as a source");
const noSource = parallel();
remove(noSource, "V");
check(!readParallelLoadCount(noSource, "A", "B").ok, "Source-free load graphs need a different explicit proof");
const acSource = parallel();
acSource.constructions.find((construction) => construction.outputs.includes("V"))!.inputs.symbol = "ac_source";
refuse(acSource, "An AC source is outside the direct DC proof");
const unclassified = parallel();
branch(unclassified, "open_branch", "open");
refuse(unclassified, "An unsupported/open symbol cannot be counted as a passive load");
const sourceWithSeriesLoad = parallel();
point(sourceWithSeriesLoad, "X");
moveTerminal(sourceWithSeriesLoad, "V", "X");
branch(sourceWithSeriesLoad, "Rs", "resistor", "X", "B");
refuse(sourceWithSeriesLoad, "A source and series resistor are not a direct source branch");
const loadChain = parallel();
point(loadChain, "X");
moveTerminal(loadChain, "R1", "X");
branch(loadChain, "Rs", "resistor", "X", "B");
refuse(loadChain, "A series chain is not a direct passive branch");
const bridge = parallel();
point(bridge, "X"); point(bridge, "Y", 4, 1);
moveTerminal(bridge, "R1", "X"); moveTerminal(bridge, "R2", "Y");
branch(bridge, "Rx", "resistor", "X", "B");
branch(bridge, "Ry", "resistor", "Y", "B");
branch(bridge, "Rxy", "resistor", "X", "Y");
refuse(bridge, "A bridged network cannot count simple paths as parallel branches");

const wired = parallel();
point(wired, "C"); point(wired, "D", 3, -1);
moveTerminal(wired, "R2", "C", "start"); moveTerminal(wired, "R2", "D");
wire(wired, "top_rail", "A", "C"); wire(wired, "bottom_rail", "B", "D");
check(evaluate(wired, "loadBranchCount", 2).passed === true, "Wire-connected load terminals share electrical nodes");
check(evaluate(wired, "pathCount", 2).passed === true, "Legacy compatibility supports ordinary rails");
const subdivided = structuredClone(wired);
point(subdivided, "E", 1.5, 2);
moveTerminal(subdivided, "top_rail", "E");
wire(subdivided, "top_rail_2", "E", "C");
check(evaluate(subdivided, "loadBranchCount", 2).passed === true, "Subdividing a wire must not add a load branch");
const normalizedSymbols = parallel();
normalizedSymbols.constructions.find((construction) => construction.outputs.includes("V"))!.inputs.symbol = " CELL ";
normalizedSymbols.constructions.find((construction) => construction.outputs.includes("R1"))!.inputs.symbol = " LAMP ";
normalizedSymbols.entities.find((entity) => entity.id === "V")!.role = "ordinary component";
check(evaluate(normalizedSymbols, "loadBranchCount", 2).passed === true, "Canonical symbols control classification after compiler normalization");
const disjoint = parallel();
point(disjoint, "P", 8, 2); point(disjoint, "Q", 8, 0);
branch(disjoint, "other_source", "battery", "P", "Q");
branch(disjoint, "other_load", "resistor", "P", "Q");
check(evaluate(disjoint, "loadBranchCount", 2).passed === true, "A disjoint panel cannot contaminate the queried load count");
const borrowedSource = structuredClone(disjoint);
remove(borrowedSource, "V");
check(!readParallelLoadCount(borrowedSource, "A", "B").ok, "A source in another panel cannot certify this panel");
check(evaluate(borrowedSource, "loadBranchCount", 2).passed === false, "A borrowed disjoint source remains refused");
check(evaluate(disjoint, "loadBranchCount", 2, ["A", "P"]).passed === false, "Two unrelated panels cannot share a branch-count proof");

for (const [name, mutate] of [
  ["missing same-pair proof", (document: SceneDocument) => { document.assertions = []; }],
  ["warning-only same-pair proof", (document: SceneDocument) => { document.assertions[0]!.severity = "warning"; }],
  ["false same-pair proof", (document: SceneDocument) => { document.assertions[0]!.expected = false; }],
  ["duplicate proof members", (document: SceneDocument) => { document.assertions[0]!.entities = ["R1", "R1"]; }],
  ["missing proof member", (document: SceneDocument) => { document.assertions[0]!.entities = ["R1"]; }],
  ["source included in proof", (document: SceneDocument) => { document.assertions[0]!.entities = ["R1", "V"]; }],
  ["undeclared nonmetric tier", (document: SceneDocument) => { delete document.source.nonMetric; }],
  ["exact tier", (document: SceneDocument) => { document.source.representationTier = "exact_verified"; }],
  ["declared numeric quantity", (document: SceneDocument) => { document.quantities.push({ id: "r", value: 6, unit: "ohm" }); }],
  ["unverified vector", (document: SceneDocument) => {
    document.entities.push({ id: "I", kind: "vector", role: "current" });
    document.constructions.push({ id: "make_I", operator: "vector", inputs: { start: "A", direction: [0, -1], length: 1 }, outputs: ["I"] });
  }],
  ["unverified sense", (document: SceneDocument) => { document.annotations.push({ id: "sense", kind: "sense", targetIds: ["R1"] }); }],
  ["unverified polarity", (document: SceneDocument) => { document.annotations.push({ id: "polarity", kind: "polarity", targetIds: ["R1"] }); }],
] satisfies Array<[string, (document: SceneDocument) => void]>) {
  const document = parallel(); mutate(document);
  check(evaluate(document, "pathCount", 2).passed === false, `${name}: legacy interpretation stays fail closed`);
  check(evaluate(document, "pathCount", 3).passed === true, `${name}: old strict graph path semantics remain unchanged`);
}
const explicitNumeric = parallel();
explicitNumeric.source.nonMetric = false;
explicitNumeric.source.representationTier = "exact_verified";
explicitNumeric.quantities.push({ id: "r", value: 6, unit: "ohm" });
check(evaluate(explicitNumeric, "loadBranchCount", 2).passed === true,
  "The explicit topology predicate does not inherit legacy qualitative/numeric restrictions");
const directedCandidates: Array<[string, SceneDocument]> = [];
for (const kind of ["vector", "sense", "polarity"]) {
  const document = parallel();
  if (kind === "vector") {
    document.entities.push({ id: "I", kind: "vector", role: "current" });
    document.constructions.push({ id: "make_I", operator: "vector", inputs: { start: "A", direction: [0, -1], length: 1 }, outputs: ["I"] });
    document.requiredEntityIds.push("I");
    document.revealGroups[0]!.entityIds.push("I");
  } else {
    document.annotations.push({ id: `unverified_${kind}`, kind, targetIds: ["R1"] });
  }
  const pureQuery = readParallelLoadCount(document, "A", "B");
  check(pureQuery.ok && pureQuery.count === 2, `${kind}: the measured topology remains a pure two-load count`);
  const result = evaluate(document, "loadBranchCount", 2);
  check(result.passed === false && result.issues.some((issue) => issue.code === "parallel_direction_unverified" && issue.severity === "fatal" && issue.actual === 2),
    `${kind}: a correct explicit count must not newly admit unproved physical ink`);
  check(evaluate(document, "pathCount", 3).passed === true, `${kind}: old strict graph-path semantics remain unchanged`);
  directedCandidates.push([`explicit unverified ${kind}`, document]);
}

const polarityTextCandidates: Array<[string, SceneDocument]> = [];
for (const [name, negative, positive] of [
  ["ASCII signs", "-", "+"],
  ["Unicode minus", "−", "+"],
  ["fullwidth signs", "－", "＋"],
  ["polarity words", "negative", "positive"],
  ["terminal polarity prose", "negative terminal", "positive terminal"],
]) {
  for (const kind of ["entity", "label", "callout"]) {
    const document = parallel();
    if (kind === "entity") {
      document.entities.find((entity) => entity.id === "A")!.label = negative;
      document.entities.find((entity) => entity.id === "B")!.label = positive;
    } else {
      document.annotations.push(
        { id: "wrong_negative", kind, targetIds: ["A"], text: negative },
        { id: "wrong_positive", kind, targetIds: ["B"], text: positive },
      );
    }
    check(readParallelLoadCount(document, "A", "B").ok, `${kind} ${name}: polarity text does not change measured topology`);
    check(evaluate(document, "pathCount", 2).passed === false, `${kind} ${name}: legacy count cannot admit swapped polarity text`);
    const result = evaluate(document, "loadBranchCount", 2);
    check(result.passed === false && result.issues.some((issue) => issue.code === "parallel_direction_unverified" && issue.severity === "fatal"),
      `${kind} ${name}: explicit count cannot admit swapped polarity text`);
    polarityTextCandidates.push([`${kind} ${name}`, document]);
  }
}

const identityLabels = parallel();
for (const [id, label] of [["A", "A"], ["B", "B"], ["V", "V"], ["R1", "R_1"], ["R2", "R₂"]]) {
  identityLabels.entities.find((entity) => entity.id === id)!.label = label;
}
identityLabels.annotations.push(
  { id: "identity_label", kind: "label", targetIds: ["R1"], text: "R_{1}" },
  { id: "component_word", kind: "callout", targetIds: ["V"], text: "battery" },
  { id: "not_ink", kind: "narration", targetIds: ["R1", "R2"], text: "The source has positive and negative terminals." },
);
check(evaluate(identityLabels, "loadBranchCount", 2).passed === true, "Short identities, bound component words, and non-ink narration are allowed");
check(evaluate(identityLabels, "pathCount", 2).passed === true, "Ordinary R_1/R₂/V labels retain the legacy compatibility target");
for (const [name, annotation] of [
  ["wrong component word", { id: "bad_word", kind: "label", targetIds: ["R1"], text: "battery" }],
  ["ambiguous annotation owner", { id: "bad_owners", kind: "callout", targetIds: ["A", "B"], text: "A" }],
  ["different owner identity", { id: "bad_identity", kind: "label", targetIds: ["A"], text: "B" }],
  ["quantity-bound ink", { id: "bad_quantity", kind: "label", targetIds: ["R1"], text: "R1", quantityId: "r" }],
]) {
  const document = parallel();
  document.quantities.push({ id: "r", value: 6, unit: "ohm" });
  document.annotations.push(annotation);
  check(evaluate(document, "loadBranchCount", 2).passed === false, `${name}: topology cannot establish arbitrary claim ink`);
}

const quantityInkCandidates: Array<[string, SceneDocument]> = [];
for (const [name, quantity] of [
  ["quantity label polarity", { id: "q_R1", symbol: "R1", label: "−+", value: 6, unit: "ohm" }],
  ["quantity label physical prose", { id: "q_R1", symbol: "R1", label: "negative terminal", value: 6, unit: "ohm" }],
  ["quantity value and unit", { id: "q_R1", symbol: "R1", value: 6, unit: "ohm" }],
  ["case-folded quantity ID", { id: "r1", value: 6, unit: "ohm" }],
  ["quantity symbol match", { id: "resistance", symbol: "r1", value: 6, unit: "ohm" }],
  ["subscript quantity ID", { id: "R₁", value: 6, unit: "ohm" }],
]) {
  const document = parallel();
  document.entities.find((entity) => entity.id === "R1")!.label = "R1";
  document.quantities.push(quantity);
  const query = readParallelLoadCount(document, "A", "B");
  check(query.ok && query.count === 2, `${name}: automatic quantity ink does not alter the pure topology count`);
  const result = evaluate(document, "loadBranchCount", 2);
  check(result.passed === false && result.issues.some((issue) => issue.code === "parallel_direction_unverified" && issue.severity === "fatal"),
    `${name}: component identity cannot silently expand into unverified quantity ink`);
  quantityInkCandidates.push([name, document]);
}
const unmatchedNumeric = parallel();
unmatchedNumeric.entities.find((entity) => entity.id === "R1")!.label = "R1";
unmatchedNumeric.quantities.push({ id: "elsewhere", value: 6, unit: "ohm" });
check(evaluate(unmatchedNumeric, "loadBranchCount", 2).passed === true,
  "Numeric quantities without an automatic label expansion remain available to the explicit topology API");
const quantityIdentity = parallel();
quantityIdentity.entities.find((entity) => entity.id === "R1")!.label = "R1";
quantityIdentity.quantities.push({ id: "q_R1", symbol: "R1", label: "R_1", value: 6, unit: "ohm" });
check(evaluate(quantityIdentity, "loadBranchCount", 2).passed === true,
  "A quantity's overriding label can remain a bound mathematical identity");

const outputKindCandidates: Array<[string, SceneDocument]> = [];
for (const kind of ["ray", "vector", "line", "segment", "polyline", "point", "component"]) {
  const document = parallel();
  point(document, "X", -2, 2);
  moveTerminal(document, "R2", "X", "start");
  wire(document, "lead", "X", "A");
  document.entities.find((entity) => entity.id === "lead")!.kind = kind;
  const query = readParallelLoadCount(document, "A", "B");
  check(query.ok && query.count === 2, `connect→${kind}: output presentation does not change pure topology`);
  check(evaluate(document, "pathCount", 2).passed === false, `connect→${kind}: legacy count cannot admit noncanonical or reversed arrow ink`);
  const result = evaluate(document, "loadBranchCount", 2);
  check(result.passed === false && result.issues.some((issue) => issue.code === "parallel_direction_unverified" && issue.severity === "fatal"),
    `connect→${kind}: explicit count cannot admit noncanonical or reversed arrow ink`);
  outputKindCandidates.push([`connect to ${kind}`, document]);
}
const componentRay = parallel();
componentRay.entities.find((entity) => entity.id === "R1")!.kind = "ray";
check(evaluate(componentRay, "loadBranchCount", 2).passed === false, "symbol→ray cannot inherit the canonical component proof");
const pointComponent = parallel();
pointComponent.entities.find((entity) => entity.id === "A")!.kind = "component";
check(evaluate(pointComponent, "loadBranchCount", 2).passed === false, "point→component cannot inherit the canonical point proof");

const tooLarge = parallel();
for (let index = 0; index < 48; index += 1) branch(tooLarge, `extra_${index}`, "resistor");
check(!readParallelLoadCount(tooLarge, "A", "B").ok, "Explicit count keeps deterministic graph limits");
check(evaluate(tooLarge, "pathCount", 2).passed === false, "Complex legacy graphs must not bypass the old path budget");

// Actual validation/compile boundary: topology truth must survive normal ink
// compilation, and shorts must remain fatal even with a matching count claim.
const { validateSceneDocument, compileSceneDocument } = await import("../../src/index");
for (const [name, document, expectedValid] of [
  ["explicit direct loads", parallel(), true],
  ["explicit wrong load count", wrongCount, false],
  ["explicit direct short", directShort, false],
  ["explicit multi-wire bypass", bypass, false],
  ["explicit source series load", sourceWithSeriesLoad, false],
  ...directedCandidates.map(([name, document]): [string, SceneDocument, boolean] => [name, document, false]),
  ...quantityInkCandidates.map(([name, document]): [string, SceneDocument, boolean] => [name, document, false]),
] satisfies Array<[string, SceneDocument, boolean]>) {
  const candidate = structuredClone(document);
  candidate.assertions.push({ id: "count", predicate: "loadBranchCount", entities: ["A", "B"], expected: 2, severity: "fatal" });
  const validation = validateSceneDocument(candidate);
  check(Boolean(validation.document), `${name}: structural validation reaches the topology proof: ${JSON.stringify(validation.report.issues)}`);
  const compiled = compileSceneDocument(validation.document!);
  check(compiled.ok === expectedValid, `${name}: actual compiler result ${JSON.stringify(compiled.report.issues)}`);
}
for (const [name, document, expected] of [
  ["wrong number of loads", parallel(), 3],
  ["unsupported source/series branch", sourceWithSeriesLoad, 2],
] satisfies Array<[string, SceneDocument, number]>) {
  const candidate = structuredClone(document);
  candidate.assertions.push({ id: "warning_count", predicate: "loadBranchCount", entities: ["A", "B"], expected, severity: "warning" });
  const evaluatedIssues: SceneIssue[] = [];
  const assertion = candidate.assertions.at(-1)!;
  check(evaluateTopologyAssertion(assertion, candidate, evaluatedIssues) === false &&
    evaluatedIssues.some((issue) => issue.code === "assertion_failed" && issue.severity === "fatal"),
  `${name}: a planner warning cannot downgrade a failed strict load count`);
  const compiled = compileSceneDocument(candidate);
  check(!compiled.ok && compiled.report.issues.some((issue) => issue.code === "assertion_failed" && issue.severity === "fatal"),
    `${name}: warning-severity count failure remains fatal at the compiler`);
}

// Render-boundary regressions include ordinary label/callout aliases: neither
// their direct document shape nor normalization may turn swapped polarity into
// newly admitted ink under the count proof.
for (const [name, document] of polarityTextCandidates) {
  for (const predicate of ["pathCount", "loadBranchCount"]) {
    const candidate = structuredClone(document);
    candidate.assertions.push({ id: "count", predicate, entities: ["A", "B"], expected: 2, severity: "fatal" });
    const direct = compileSceneDocument(candidate);
    check(!direct.ok, `${name}/${predicate}: direct compiler must refuse swapped polarity`);
    const validation = validateSceneDocument(candidate);
    check(Boolean(validation.document), `${name}/${predicate}: normalized document must reach the count proof`);
    const normalized = compileSceneDocument(validation.document!);
    check(!normalized.ok && normalized.report.issues.some((issue) =>
      issue.code === (predicate === "loadBranchCount" ? "parallel_direction_unverified" : "assertion_failed")),
    `${name}/${predicate}: normalized compiler must retain the refusal`);
    if (document.annotations.some((annotation) => annotation.kind === "callout")) {
      const aliased = {
        ...candidate,
        annotations: candidate.annotations.map(({ kind, targetIds, ...annotation }) => ({
          ...annotation, kind: kind === "callout" ? "note" : kind, targetId: targetIds[0],
        })),
      };
      const aliasValidation = validateSceneDocument(aliased);
      check(Boolean(aliasValidation.document), `${name}/${predicate}: note/targetId alias remains structurally valid`);
      check(!compileSceneDocument(aliasValidation.document!).ok, `${name}/${predicate}: normalization cannot hide polarity behind note aliases`);
    }
  }
}
for (const [name, document] of outputKindCandidates) {
  for (const predicate of ["pathCount", "loadBranchCount"]) {
    const candidate = structuredClone(document);
    candidate.assertions.push({ id: "count", predicate, entities: ["A", "B"], expected: 2, severity: "fatal" });
    const direct = compileSceneDocument(candidate);
    check(!direct.ok, `${name}/${predicate}: direct compiler refuses noncanonical arrow/presentation ink`);
    const normalized = validateSceneDocument(candidate);
    check(Boolean(normalized.document), `${name}/${predicate}: normalizer must retain a structurally valid presentation test: ${JSON.stringify(normalized.report.issues)}`);
    check(!compileSceneDocument(normalized.document!).ok, `${name}/${predicate}: normalization must retain the output-kind refusal`);
  }
}

// Integration: component symbol preference must not let a benign first ID
// alias conceal unproved ink on the quantity the compiler actually selects.
const aliasCollision = parallel();
remove(aliasCollision, "R1");
branch(aliasCollision, "load_one", "resistor");
aliasCollision.entities.find((entity) => entity.id === "load_one")!.label = "R1";
aliasCollision.assertions[0]!.entities = ["load_one", "R2"];
aliasCollision.quantities = [
  { id: "R1", symbol: "unused", label: "R1", value: 6, unit: "ohm" },
  { id: "physical", symbol: "R1", label: "−", value: 7, unit: "ohm" },
];
aliasCollision.assertions.push({ id: "count", predicate: "loadBranchCount", entities: ["A", "B"], expected: 2, severity: "fatal" });
const collisionValidation = validateSceneDocument(aliasCollision);
check(Boolean(collisionValidation.document), "Symbol-priority collision must reach the actual count compiler");
const collisionCompiled = compileSceneDocument(collisionValidation.document!);
check(!collisionCompiled.ok, `A benign first ID must not conceal the compiler-selected polarity label: ${JSON.stringify(collisionCompiled.renderScene?.primitives.filter((primitive) => primitive.kind === "label"))}`);

for (const owner of ["load", "source"]) {
  for (const reverse of [false, true]) {
    for (const ink of ["polarity", "physical prose", "numeric value"]) {
      const candidate = structuredClone(aliasCollision);
      const designator = owner === "load" ? "R1" : "E";
      const unit = owner === "load" ? "ohm" : "V";
      if (owner === "source") {
        delete candidate.entities.find((entity) => entity.id === "load_one")!.label;
        candidate.entities.find((entity) => entity.id === "V")!.label = designator;
      }
      candidate.quantities = [
        { id: designator, symbol: "unused", label: designator, value: 6, unit },
        { id: "physical", symbol: designator, value: 7, unit,
          ...(ink === "numeric value" ? {} : { label: ink === "polarity" ? "−" : "negative terminal" }) },
      ];
      if (reverse) candidate.quantities.reverse();
      const name = `${owner}/${ink}/${reverse ? "reversed" : "original"}`;
      check(readParallelLoadCount(candidate, "A", "B").ok, `${name}: aliases cannot change pure topology`);
      check(evaluate(candidate, "pathCount", 3).passed === true, `${name}: existing strict graph-path meaning is unchanged`);
      const result = evaluate(candidate, "loadBranchCount", 2);
      check(result.passed === false && result.issues.some((issue) => issue.code === "parallel_direction_unverified"),
        `${name}: every possible matching alias must have identity-only ink`);
      const normalized = validateSceneDocument(candidate);
      check(Boolean(normalized.document), `${name}: normalized alias collision reaches the count proof`);
      check(!compileSceneDocument(normalized.document!).ok, `${name}: normalized compiler refuses matching physical/numeric aliases`);
    }
    const benign = structuredClone(aliasCollision);
    const designator = owner === "load" ? "R1" : "E";
    if (owner === "source") {
      delete benign.entities.find((entity) => entity.id === "load_one")!.label;
      benign.entities.find((entity) => entity.id === "V")!.label = designator;
    }
    benign.quantities = [
      { id: designator, symbol: "unused", label: designator, value: 6, unit: "1" },
      { id: "physical", symbol: designator, label: designator, value: 7, unit: "1" },
    ];
    if (reverse) benign.quantities.reverse();
    check(evaluate(benign, "loadBranchCount", 2).passed === true, `${owner}: benign identity-only aliases remain available`);
    check(compileSceneDocument(benign).ok, `${owner}: identity-only alias collision still compiles in either inventory order`);
  }
}
const unlabeledNumeric = structuredClone(explicitNumeric);
unlabeledNumeric.assertions.push({ id: "count", predicate: "loadBranchCount", entities: ["A", "B"], expected: 2, severity: "fatal" });
check(compileSceneDocument(unlabeledNumeric).ok, "Unlabeled numeric geometry remains available to the explicit topology API");

const validIdentityScene = structuredClone(identityLabels);
validIdentityScene.assertions.push({ id: "count", predicate: "loadBranchCount", entities: ["A", "B"], expected: 2, severity: "fatal" });
check(compileSceneDocument(validIdentityScene).ok, "The ordinary identity-only label scene still compiles");

console.log(`parallel load count: ${checks} checks passed`);
