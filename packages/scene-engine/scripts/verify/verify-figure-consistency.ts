/**
 * Figure consistency rules (compile/figureConsistency.ts), on synthetic documents.
 * The rules run when compile is asked for them (planner candidate admission).
 *
 * Production admitted planner figures whose ink contradicted their own
 * document: a current mark running against the cell, a cell drawn inside a
 * galvanometer ring, force arrows stacked on one line, unnamed arrows, and a
 * region name placed inside a body nested in that region. Each rule is checked
 * on a figure built here, then mutated so the defect disappears (or appears)
 * and the verdict must flip. A rule that does not react to its mutation fails.
 *
 *   pnpm --filter @heytutor/scene-engine exec tsx scripts/verify/verify-figure-consistency.ts
 */
import { compileSceneDocument, validateSceneDocument } from "../../src/index";

type Doc = Record<string, unknown>;
type Entity = { id: string; kind: string; role: string; label?: string };
type Construction = { id: string; operator: string; inputs: Record<string, unknown>; outputs: string[] };

const failures: string[] = [];
let passed = 0;

function scene(entities: Entity[], constructions: Construction[]): Doc {
  return {
    schemaVersion: "scene-document/v2",
    source: { nonMetric: true, representationTier: "qualitative_verified" },
    visualDecision: { mode: "scene", reason: "synthetic consistency fixture" },
    entities, relations: [], assertions: [], quantities: [], annotations: [], teachingTimeline: [],
    revealGroups: [{ id: "setup", dependsOn: [], entityIds: entities.map((entity) => entity.id), narrationCue: "setup" }],
    constructions, requiredEntityIds: entities.map((entity) => entity.id),
  };
}
const point = (id: string, x: number, y: number, role = "node"): [Entity, Construction] =>
  [{ id, kind: "point", role }, { id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "layout" }, outputs: [id] }];
function build(parts: Array<[Entity, Construction]>): Doc {
  return scene(parts.map((part) => part[0]), parts.map((part) => part[1]));
}
function annotate(document: Doc, ...annotations: Array<{ id: string; kind: string; targetIds: string[] }>): Doc {
  (document.annotations as unknown[]).push(...annotations);
  return document;
}

function codes(document: Doc, figureConsistency = true): string[] {
  const validated = validateSceneDocument(structuredClone(document));
  if (!validated.document) return [`invalid:${validated.report.issues.map((issue) => `${issue.code} ${issue.message}`).join(",")}`];
  // Planner candidate admission opts in; engine built figures keep their own conventions.
  const compiled = compileSceneDocument(validated.document, { figureConsistency });
  return compiled.report.issues.filter((issue) => issue.severity === "fatal").map((issue) => issue.code);
}

function expect(name: string, document: Doc, code: string, present: boolean): void {
  const found = codes(document);
  if (found.some((value) => value.startsWith("invalid:"))) { failures.push(`${name}: ${found.join(" ")}`); console.log(`FAIL ${name}: ${found.join(" ")}`); return; }
  if (found.includes(code) === present) { passed += 1; console.log(`pass ${name}`); return; }
  const message = `${name}: expected ${code} ${present ? "present" : "absent"}, fatal codes [${found.join(", ")}]`;
  failures.push(message); console.log(`FAIL ${message}`);
}

// --- current sense against the cell -------------------------------------------------
// One loop P -cell- S -wire- R -resistor- Q -wire- P. The cell's long plate is at its
// start, P, so conventional current runs P to Q along the bottom wire.
function loop(sense: string, role = "current direction", extraSource = false): Doc {
  return build([
    point("P", 0, 0), point("Q", 5, 0), point("R", 5, 3), point("S", 0, 3),
    [{ id: "cell", kind: "component", role: "source", label: "E" }, { id: "make_cell", operator: "symbol", inputs: { start: "P", end: "S", symbol: "cell" }, outputs: ["cell"] }],
    [{ id: "top", kind: "connector", role: "wire" }, { id: "make_top", operator: "connect", inputs: { start: "S", end: "R" }, outputs: ["top"] }],
    [{ id: "load", kind: "component", role: extraSource ? "source" : "resistor", label: "R" }, { id: "make_load", operator: "symbol", inputs: { start: "R", end: "Q", symbol: extraSource ? "battery" : "resistor" }, outputs: ["load"] }],
    [{ id: "bottom", kind: "connector", role: "wire" }, { id: "make_bottom", operator: "connect", inputs: { start: "P", end: "Q" }, outputs: ["bottom"] }],
    [{ id: "flow", kind: "sign_badge", role, label: "I" }, { id: "make_flow", operator: "sign_badge", inputs: { target: "bottom", at: 0.5, sense }, outputs: ["flow"] }],
  ]);
}
expect("current leaving the positive plate is admitted", loop("positive"), "current_against_source_polarity", false);
expect("mutation: the same mark reversed is refused", loop("negative"), "current_against_source_polarity", true);
expect("an electron flow mark runs the other way and is not judged", loop("negative", "electron flow"), "current_against_source_polarity", false);
expect("two cells: the polarity alone does not fix the current", loop("negative", "current direction", true), "current_against_source_polarity", false);

// A stub off the loop carries no current, so a mark on it is not the source current.
const stub = loop("positive");
(stub.entities as Entity[]).push({ id: "T", kind: "point", role: "node" }, { id: "stub", kind: "connector", role: "wire" }, { id: "stubFlow", kind: "sign_badge", role: "current direction", label: "I2" });
(stub.constructions as Construction[]).push({ id: "make_T", operator: "point", inputs: { x: 7, y: 0, coordinateSpace: "layout" }, outputs: ["T"] },
  { id: "make_stub", operator: "connect", inputs: { start: "T", end: "Q" }, outputs: ["stub"] },
  { id: "make_stubFlow", operator: "sign_badge", inputs: { target: "stub", at: 0.5, sense: "positive" }, outputs: ["stubFlow"] });
for (const key of ["requiredEntityIds"]) (stub[key] as string[]).push("T", "stub", "stubFlow");
((stub.revealGroups as Array<{ entityIds: string[] }>)[0]!.entityIds).push("T", "stub", "stubFlow");
expect("a mark on a dead end stub off the loop is not judged", stub, "current_against_source_polarity", false);

// A switch drawn open (the renderer's default when no state is given) is no bypass:
// the resistor still carries the whole cell current, so a reversed mark on it is refused.
// Current runs P to Q along the bottom and so Q to R through the resistor, against its start-to-end sense.
function bypassed(state?: string): Doc {
  return build([
    point("P", 0, 0), point("Q", 5, 0), point("R", 5, 3), point("S", 0, 3),
    [{ id: "cell", kind: "component", role: "source", label: "E" }, { id: "make_cell", operator: "symbol", inputs: { start: "P", end: "S", symbol: "cell" }, outputs: ["cell"] }],
    [{ id: "top", kind: "connector", role: "wire" }, { id: "make_top", operator: "connect", inputs: { start: "S", end: "R" }, outputs: ["top"] }],
    [{ id: "load", kind: "component", role: "resistor", label: "R" }, { id: "make_load", operator: "symbol", inputs: { start: "R", end: "Q", symbol: "resistor" }, outputs: ["load"] }],
    [{ id: "bottom", kind: "connector", role: "wire" }, { id: "make_bottom", operator: "connect", inputs: { start: "P", end: "Q" }, outputs: ["bottom"] }],
    [{ id: "key", kind: "component", role: "switch", label: "K" }, { id: "make_key", operator: "symbol", inputs: { start: "R", end: "Q", symbol: "switch", ...(state ? { state } : {}) }, outputs: ["key"] }],
    [{ id: "flow", kind: "sign_badge", role: "current direction", label: "I" }, { id: "make_flow", operator: "sign_badge", inputs: { target: "load", at: 0.5, sense: "positive" }, outputs: ["flow"] }],
  ]);
}
expect("an open switch bypass with no state (drawn open) does not hide a reversed current mark", bypassed(), "current_against_source_polarity", true);
expect("an open switch bypass with state open does not hide a reversed current mark", bypassed("open"), "current_against_source_polarity", true);
expect("mutation: a closed switch bypass shares the current, so the mark is not judged", bypassed("closed"), "current_against_source_polarity", false);

// --- glyphs on top of each other ----------------------------------------------------
// A bridge on A B C D with the meter across B D. With the cell across A C its plates
// sit inside the meter ring; routed outside the diamond the two glyphs are apart.
function bridge(cellAcross: boolean): Doc {
  const parts: Array<[Entity, Construction]> = [
    point("A", 0, 2), point("B", 2, 4), point("C", 4, 2), point("D", 2, 0),
    [{ id: "r1", kind: "component", role: "arm", label: "P" }, { id: "make_r1", operator: "symbol", inputs: { start: "A", end: "B", symbol: "resistor" }, outputs: ["r1"] }],
    [{ id: "r2", kind: "component", role: "arm", label: "Q" }, { id: "make_r2", operator: "symbol", inputs: { start: "B", end: "C", symbol: "resistor" }, outputs: ["r2"] }],
    [{ id: "r3", kind: "component", role: "arm", label: "S" }, { id: "make_r3", operator: "symbol", inputs: { start: "A", end: "D", symbol: "resistor" }, outputs: ["r3"] }],
    [{ id: "r4", kind: "component", role: "arm", label: "T" }, { id: "make_r4", operator: "symbol", inputs: { start: "D", end: "C", symbol: "resistor" }, outputs: ["r4"] }],
    [{ id: "meter", kind: "component", role: "galvanometer", label: "G" }, { id: "make_meter", operator: "symbol", inputs: { start: "B", end: "D", symbol: "galvanometer" }, outputs: ["meter"] }],
  ];
  if (cellAcross) {
    parts.push([{ id: "cell", kind: "component", role: "source", label: "E" }, { id: "make_cell", operator: "symbol", inputs: { start: "A", end: "C", symbol: "cell" }, outputs: ["cell"] }]);
  } else {
    parts.push(point("E1", 0, -2), point("E2", 4, -2),
      [{ id: "cell", kind: "component", role: "source", label: "E" }, { id: "make_cell", operator: "symbol", inputs: { start: "E1", end: "E2", symbol: "cell" }, outputs: ["cell"] }],
      [{ id: "lead1", kind: "connector", role: "wire" }, { id: "make_lead1", operator: "connect", inputs: { start: "A", end: "E1" }, outputs: ["lead1"] }],
      [{ id: "lead2", kind: "connector", role: "wire" }, { id: "make_lead2", operator: "connect", inputs: { start: "C", end: "E2" }, outputs: ["lead2"] }]);
  }
  return build(parts);
}
expect("a cell across the meter's diagonal is refused", bridge(true), "component_glyph_overlap", true);
expect("mutation: the cell routed outside the bridge is admitted", bridge(false), "component_glyph_overlap", false);

// --- arrows stacked on one line, and unnamed arrows ---------------------------------
function body(arrows: Array<{ id: string; from: [number, number]; to: [number, number]; label?: string; role?: string; operator?: string; inputs?: Record<string, unknown> }>): Doc {
  const parts: Array<[Entity, Construction]> = [
    point("centre", 3, 2, "construction helper"),
    [{ id: "block", kind: "rectangle", role: "body", label: "block" }, { id: "make_block", operator: "rectangle", inputs: { center: "centre", width: 2, height: 1.4 }, outputs: ["block"] }],
  ];
  for (const arrow of arrows) {
    parts.push(point(`${arrow.id}_a`, ...arrow.from, "construction helper"), point(`${arrow.id}_b`, ...arrow.to, "construction helper"));
    parts.push([{ id: arrow.id, kind: "vector", role: arrow.role ?? "force", ...(arrow.label ? { label: arrow.label } : {}) },
      { id: `make_${arrow.id}`, operator: arrow.operator ?? "vector", inputs: arrow.inputs ?? { start: `${arrow.id}_a`, end: `${arrow.id}_b` }, outputs: [arrow.id] }]);
  }
  return build(parts);
}
expect("two forces drawn through one line are refused", body([
  { id: "down", from: [3, 2.7], to: [3, 1.8], label: "F1" }, { id: "up", from: [3, 1.3], to: [3, 2.5], label: "F2" },
]), "vector_collinear_overlap", true);
expect("mutation: the same forces side by side are admitted", body([
  { id: "down", from: [2.6, 2.7], to: [2.6, 1.8], label: "F1" }, { id: "up", from: [3.4, 1.3], to: [3.4, 2.5], label: "F2" },
]), "vector_collinear_overlap", false);
expect("opposite forces meeting at one point do not overlap", body([
  { id: "down", from: [3, 2], to: [3, 0.5], label: "W" }, { id: "up", from: [3, 2], to: [3, 3.5], label: "N" },
]), "vector_collinear_overlap", false);
expect("a projection on its basis line is not an overlap", body([
  { id: "a", from: [1, 0], to: [4, 3], label: "a" }, { id: "b", from: [1, 0], to: [6, 0], label: "b" },
  { id: "pa", from: [1, 0], to: [1, 0], label: "p", operator: "vector_projection", inputs: { vector: "a", onto: "b", origin: "a_a" } },
]), "vector_collinear_overlap", false);
expect("an unnamed arrow is refused", body([
  { id: "push", from: [1, 2], to: [2, 2], label: "F", role: "push" }, { id: "pull", from: [4, 2], to: [5.5, 2], role: "pull" },
]), "vector_without_label", true);
expect("mutation: the arrow named is admitted", body([
  { id: "push", from: [1, 2], to: [2, 2], label: "F", role: "push" }, { id: "pull", from: [4, 2], to: [5.5, 2], label: "T", role: "pull" },
]), "vector_without_label", false);
expect("an arrow mirroring a named arrow is read as its twin", body([
  { id: "push", from: [1, 2], to: [2, 2], label: "F", role: "push" }, { id: "pull", from: [5, 2], to: [4, 2], role: "pull" },
]), "vector_without_label", false);
expect("an unnamed arrow beside a named arrow of the same length and direction is refused", body([
  { id: "push", from: [0.5, 3.5], to: [1.5, 3.5], label: "F", role: "push" }, { id: "pull", from: [4.5, 3.5], to: [5.5, 3.5], role: "pull" },
]), "vector_without_label", true);
expect("an unnamed arrow parallel to a named one, same length and sense, is refused", body([
  { id: "push", from: [0.5, 0.5], to: [0.5, 1.5], label: "F", role: "push" }, { id: "pull", from: [5.5, 2.5], to: [5.5, 3.5], role: "pull" },
]), "vector_without_label", true);
expect("a family of like arrows sharing one role is named once", body([
  { id: "line1", from: [0.5, 3.5], to: [2, 3.5], role: "field line" }, { id: "line2", from: [4, 0.5], to: [5.5, 0.5], role: "field line" },
]), "vector_without_label", false);

// A trace annotation redraws its arrow's own ink; the copy is not a second arrow on that line.
const traced = () => annotate(body([
  { id: "down", from: [2.6, 2.7], to: [2.6, 1.8], label: "F1" }, { id: "up", from: [3.4, 1.3], to: [3.4, 2.5], label: "F2" },
]), { id: "traceUp", kind: "trace", targetIds: ["up"] });
expect("tracing an arrow is not a collinear overlap", traced(), "vector_collinear_overlap", false);
expect("a trace of a named arrow is not an unnamed arrow", traced(), "vector_without_label", false);
expect("tracing still leaves two forces through one line refused", annotate(body([
  { id: "down", from: [3, 2.7], to: [3, 1.8], label: "F1" }, { id: "up", from: [3, 1.3], to: [3, 2.5], label: "F2" },
]), { id: "traceUp", kind: "trace", targetIds: ["up"] }), "vector_collinear_overlap", true);

// --- a region name inside a nested body ---------------------------------------------
function tank(bodyAt: number): Doc {
  return build([
    point("t1", 0, 0, "construction helper"), point("t2", 6, 0, "construction helper"), point("t3", 6, 4, "construction helper"), point("t4", 0, 4, "construction helper"),
    [{ id: "liquid", kind: "polygon", role: "liquid region" }, { id: "make_liquid", operator: "polygon", inputs: { points: ["t1", "t2", "t3", "t4"] }, outputs: ["liquid"] }],
    point("bodyCentre", bodyAt, 2, "construction helper"),
    [{ id: "solid", kind: "rectangle", role: "immersed body", label: "body" }, { id: "make_solid", operator: "rectangle", inputs: { center: "bodyCentre", width: 1.6, height: 1.2 }, outputs: ["solid"] }],
    [{ id: "liquidName", kind: "label", role: "region name", label: "liquid" }, { id: "make_liquidName", operator: "label", inputs: { text: "liquid", target: "liquid" }, outputs: ["liquidName"] }],
  ]);
}
expect("a region name inside the body nested in it is refused", tank(3), "region_label_in_nested_body", true);
expect("mutation: the body moved aside, the name stays in the liquid", tank(1.2), "region_label_in_nested_body", false);
// A loop highlight draws a larger outline around its target under the annotation's own id.
// Around a diagonal rod in the liquid that outline is a box holding the liquid's name,
// which sits clear of every body: the highlight is not a body.
function highlightedRod(): Doc {
  const document = tank(1.2);
  const parts: Array<[Entity, Construction]> = [point("r1", 2.5, 0.5, "construction helper"), point("r2", 5.5, 3.5, "construction helper"),
    [{ id: "rod", kind: "segment", role: "rod", label: "rod" }, { id: "make_rod", operator: "segment", inputs: { start: "r1", end: "r2" }, outputs: ["rod"] }]];
  for (const [entity, construction] of parts) {
    (document.entities as Entity[]).push(entity);
    (document.constructions as Construction[]).push(construction);
    (document.requiredEntityIds as string[]).push(entity.id);
    ((document.revealGroups as Array<{ entityIds: string[] }>)[0]!.entityIds).push(entity.id);
  }
  return annotate(document, { id: "ring", kind: "loop", targetIds: ["rod"] });
}
expect("a loop highlight holding the region name does not count as a nested body", highlightedRod(), "region_label_in_nested_body", false);
expect("mutation: a highlighted body still refuses a name inside the body", annotate(tank(3), { id: "ring", kind: "loop", targetIds: ["solid"] }), "region_label_in_nested_body", true);

// Scope: without the option (engine built figures) the rules do not run.
if (codes(loop("negative"), false).includes("current_against_source_polarity")) { failures.push("the rules ran without the figureConsistency option"); console.log("FAIL the rules ran without the figureConsistency option"); }
else { passed += 1; console.log("pass the rules run only when admission opts in"); }

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
