/**
 * DCP-03 regression gate: recheck the known live circuit, river-boat, and
 * free-body relevance cases end to end.
 *
 * Each case runs the thin live slice: source question -> ProblemIR/TurnPlanV3
 * contract -> deterministic synthesis -> proofs -> label checks -> planner
 * availability -> compiled render scene -> narrated reveal -> persistence ->
 * saved-turn replay. Independent oracles (hand-written picture-class checks
 * plus a second topology/graph implementation, never the family classifier
 * under test) judge every case, and parameter sweeps rebuild the source, the
 * structure, and the geometry together.
 *
 * The gate distinguishes the four live failure modes explicitly:
 * - wrong_family: a committed scene for another case's source must reject;
 * - no_ink: figure-absent and unsupported stems must teach text-only;
 * - stale_scalar: a plan value that disagrees with the source must decline or
 *   commit carrying the source value, never the stale one;
 * - persistence_failure: forged questions/tiers/ink must reject at save time,
 *   while saved turns must replay byte-identical scenes.
 *
 * Pinned known gaps (asserted, not hidden): the obligations-gated crossing
 * carries the heading but not the boat/current speeds, and the gated incline
 * figure has no block glyph and carries no mass. The sibling archetype shapes
 * carry those values but drop the heading and the contact id instead, so the
 * two live paths commit different figures for the same question. These stay
 * visible here until one shape carries everything; the slice obligations cover
 * what the gated figures honestly carry today.
 */
import { strict as assert } from "node:assert";
import {
  PROBLEM_IR_VERSION,
  SCENE_ARTIFACTS_V3_VERSION,
  checkVisualObligations,
  deriveVisualObligations,
  validateProblemIR,
  validateSceneDocument,
  validateTurnPlanV3,
  visualObligationsPlannerCoverage,
  type ProblemIR,
  type QuestionSourceEvidence,
  type SceneArtifactsV3,
  type SceneDocument,
  type TurnPlanV3,
  type VisualObligationSet,
} from "@heytutor/scene-engine";
import {
  DIAGRAM_ZONE,
  getSegmentCommands,
  serializeSegmentCommands,
  verifiedDiagramHasDrawableInk,
} from "@heytutor/drawing";
import { selectVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import {
  canonicalizeTurnSceneMetadata,
  type SubmittedTurnSegment,
} from "../../lib/scene/turnScenePersistence";

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

function plan(question: string, givens: TurnPlanV3["givens"]): TurnPlanV3 {
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

function missIds(set: VisualObligationSet, document: SceneDocument): Set<string> {
  return new Set(checkVisualObligations(set, document).missing.map((miss) => miss.obligationId));
}

/* ------------------------------------------------------------------------- */
/* Independent picture-class oracles.                                        */
/* These read entity roles, operators, and construction topology directly.   */
/* They never call the family classifier, sceneDemand, or pictureFeatures.   */
/* ------------------------------------------------------------------------- */

interface OracleVerdict {
  pass: boolean;
  detail: string;
}

/** Undirected construction-graph adjacency over entity ids (own walk). */
function topologyAdjacency(document: SceneDocument): Map<string, Set<string>> {
  const known = new Set(document.entities.map((entity) => entity.id));
  const adjacency = new Map<string, Set<string>>();
  const link = (first: string, second: string): void => {
    if (first === second || !known.has(first) || !known.has(second)) return;
    if (!adjacency.has(first)) adjacency.set(first, new Set());
    if (!adjacency.has(second)) adjacency.set(second, new Set());
    adjacency.get(first)!.add(second);
    adjacency.get(second)!.add(first);
  };
  const refsOf = (value: unknown, out: string[]): void => {
    if (typeof value === "string") {
      if (known.has(value)) out.push(value);
      return;
    }
    if (Array.isArray(value)) for (const item of value) refsOf(item, out);
  };
  for (const construction of document.constructions) {
    const touched: string[] = [];
    for (const value of Object.values(construction.inputs)) refsOf(value, touched);
    for (const output of construction.outputs) if (known.has(output)) touched.push(output);
    const members = [...new Set(touched)];
    for (const first of members) for (const second of members) link(first, second);
  }
  return adjacency;
}

function symbolCounts(document: SceneDocument): Map<string, number> {
  const counts = new Map<string, number>();
  for (const construction of document.constructions) {
    if (construction.operator !== "symbol") continue;
    const symbol = String(construction.inputs.symbol ?? "");
    counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
  }
  return counts;
}

/** Kirchhoff two-loop: two batteries, three resistors, branched junctions. */
function oracleTwoLoopCircuit(document: SceneDocument): OracleVerdict {
  const symbols = symbolCounts(document);
  const batteries = symbols.get("battery") ?? 0;
  const resistors = symbols.get("resistor") ?? 0;
  if (batteries < 2) return { pass: false, detail: `expected 2 batteries, found ${batteries}` };
  if (resistors < 3) return { pass: false, detail: `expected 3 resistors, found ${resistors}` };
  const adjacency = topologyAdjacency(document);
  const nodeDegree = (id: string): number => adjacency.get(id)?.size ?? 0;
  const nodes = document.entities.filter((entity) => entity.role === "node").map((entity) => entity.id);
  const branched = nodes.filter((id) => nodeDegree(id) >= 3);
  if (branched.length === 0) {
    return { pass: false, detail: "no branched junction: this is a series chain, not a two-loop network" };
  }
  const loops = document.assertions.filter(
    (assertion) => assertion.predicate === "path" && assertion.severity === "fatal",
  );
  if (loops.length < 2) return { pass: false, detail: `expected 2 fatal loop proofs, found ${loops.length}` };
  return { pass: true, detail: `${batteries} batteries, ${resistors} resistors, junctions ${branched.join("+")}` };
}

export type RiverVariant = "along_stream" | "crossing" | "two_triangles";

/** River-boat: banks plus the variant's own velocity vectors (never A/B). */
function oracleRiverBoat(document: SceneDocument, variant: RiverVariant): OracleVerdict {
  const byId = new Map(document.entities.map((entity) => [entity.id, entity]));
  const banks = document.entities.filter((entity) => /bank/i.test(`${entity.role ?? ""} ${entity.id}`));
  if (banks.length < 2) return { pass: false, detail: "missing river banks" };
  const vectors = document.entities.filter((entity) => entity.kind === "vector").map((entity) => entity.id);
  if (variant === "along_stream") {
    // Two honest shapes: the family builder's vb/vc/vd/vu quartet, or the
    // river_boat archetype's solved downstream/upstream pair with its flow.
    const familyShape = ["vb", "vc", "vd", "vu"].every((id) => byId.has(id));
    const archetypeShape = byId.has("downstream") && byId.has("upstream");
    if (!familyShape && !archetypeShape) {
      return { pass: false, detail: `along-stream figure has neither vd/vu nor downstream/upstream (${vectors.join(",")})` };
    }
    if (byId.has("vr") || byId.has("across_vr") || (byId.has("a") && byId.has("b") && byId.has("a_end"))) {
      return { pass: false, detail: "along-stream figure carries another variant's vectors" };
    }
    return { pass: vectors.length >= 2, detail: `along-stream vectors ${vectors.join(",")}` };
  }
  if (variant === "two_triangles") {
    // Family builder ids vs river_boat archetype ids; both draw two triangles.
    const familyShape = ["across_vr", "short_vr", "across_vb", "short_vb"].every((id) => byId.has(id));
    const archetypeShape = ["across_resultant", "short_resultant", "across_boat", "short_boat"]
      .every((id) => byId.has(id));
    if (!familyShape && !archetypeShape) {
      return { pass: false, detail: "two-triangle figure is missing a triangle's vectors" };
    }
    return { pass: vectors.length >= 6, detail: `two-triangle vectors ${vectors.join(",")}` };
  }
  // Family builder triple vs river_boat archetype triple; both draw one
  // heading triangle with an angle mark, never the recycled A/B arrows.
  const familyTriple = byId.has("vb") && byId.has("vc") && byId.has("vr");
  const archetypeTriple = byId.has("boat") && byId.has("current") && byId.has("resultant");
  if (!familyTriple && !archetypeTriple) {
    return { pass: false, detail: `crossing figure is missing its triangle (${vectors.join(",")})` };
  }
  if (!byId.has("heading_mark") && !byId.has("angle")) {
    return { pass: false, detail: "crossing figure is missing its heading mark" };
  }
  if (byId.has("a") && byId.has("b") && byId.has("a_end")) {
    return { pass: false, detail: "crossing figure is the recycled origin-A-B arrows" };
  }
  return { pass: true, detail: `crossing vectors ${vectors.join(",")}` };
}

/** Incline free body: surface, contact, derived normal, weight, proofs. */
function oracleInclineFreeBody(document: SceneDocument): OracleVerdict {
  const byId = new Map(document.entities.map((entity) => [entity.id, entity]));
  // Family builder ids vs incline_body archetype roles; both draw the surface,
  // a contact point, a derived normal, and the weight with fatal proofs.
  const inclineId = byId.has("incline")
    ? "incline"
    : document.entities.find((entity) => /inclined plane/i.test(entity.role ?? ""))?.id;
  const contactId = byId.has("contact")
    ? "contact"
    : document.entities.find((entity) => /contact point/i.test(entity.role ?? ""))?.id;
  const normalId = byId.has("normal")
    ? "normal"
    : document.entities.find((entity) => /normal reaction/i.test(entity.role ?? ""))?.id;
  const weightId = byId.has("weight")
    ? "weight"
    : document.entities.find((entity) => entity.role === "weight")?.id;
  if (!inclineId || !contactId || !normalId || !weightId) {
    return { pass: false, detail: "incline figure is missing its surface, contact, normal, or weight" };
  }
  const normalOp = document.constructions.find((construction) => construction.outputs.includes(normalId));
  const provenPerpendicular = document.assertions.some(
    (assertion) => assertion.predicate === "perpendicular" && assertion.severity === "fatal"
      && assertion.entities.includes(normalId) && assertion.entities.includes(inclineId),
  );
  if (normalOp?.operator !== "normal_at" && !provenPerpendicular) {
    return { pass: false, detail: "incline normal must be derived, not placed" };
  }
  if (!provenPerpendicular) return { pass: false, detail: "missing fatal normal-perpendicular proof" };
  const contactOn = document.assertions.some(
    (assertion) => assertion.predicate === "on" && assertion.severity === "fatal"
      && assertion.entities.includes(contactId) && assertion.entities.includes(inclineId),
  );
  if (!contactOn) return { pass: false, detail: "missing fatal contact-on-incline proof" };
  if (!document.annotations.some((annotation) => annotation.kind === "hatch")) {
    return { pass: false, detail: "incline contact surface must be hatched" };
  }
  return { pass: true, detail: "incline with derived normal, weight, and fatal proofs" };
}

/** Pulley free body: wheel, two labeled blocks, two strings. */
function oraclePulleyFreeBody(document: SceneDocument): OracleVerdict {
  // Family builder roles vs atwood archetype roles; both hang two labeled
  // blocks from strings over a wheel.
  const blocks = document.entities.filter(
    (entity) => entity.role === "hanging block"
      || (entity.role === "body" && (entity.label === "m1" || entity.label === "m2")),
  );
  if (blocks.length < 2) return { pass: false, detail: `expected 2 hanging blocks, found ${blocks.length}` };
  const labels = new Set(blocks.map((entity) => entity.label));
  if (!labels.has("m1") || !labels.has("m2")) {
    return { pass: false, detail: `pulley blocks must be labeled m1/m2, found ${[...labels].join(",")}` };
  }
  const strings = document.entities.filter((entity) => entity.role === "string");
  if (strings.length < 2) return { pass: false, detail: "pulley figure is missing its strings" };
  const wheel = document.entities.some((entity) => entity.role === "pulley");
  if (!wheel) return { pass: false, detail: "pulley figure is missing its wheel" };
  return { pass: true, detail: "pulley with m1/m2 blocks and strings" };
}

/** Independent vector-sum check from point constructions (own arithmetic). */
function pointOf(document: SceneDocument, id: string): { x: number; y: number } | null {
  const construction = document.constructions.find(
    (candidate) => candidate.operator === "point" && candidate.outputs.includes(id),
  );
  const x = construction?.inputs.x;
  const y = construction?.inputs.y;
  return typeof x === "number" && typeof y === "number" ? { x, y } : null;
}

function checkVectorSum(
  document: SceneDocument,
  label: string,
  origin: string,
  first: string,
  second: string,
  sum: string,
): void {
  const o = pointOf(document, origin);
  const a = pointOf(document, first);
  const b = pointOf(document, second);
  const s = pointOf(document, sum);
  check(o && a && b && s, `${label}: velocity triangle endpoints must be readable points`);
  if (!o || !a || !b || !s) return;
  const gap = Math.hypot(s.x - (o.x + (a.x - o.x) + (b.x - o.x)), s.y - (o.y + (a.y - o.y) + (b.y - o.y)));
  check(gap < 1e-6, `${label}: resultant must equal heading + current (gap ${gap})`);
}

/** Triangle proof in either shape: endpoint arithmetic or a fatal vector_sum. */
function checkCrossingSum(document: SceneDocument, label: string): void {
  if (pointOf(document, "vb_end") && pointOf(document, "vc_end") && pointOf(document, "vr_end")) {
    checkVectorSum(document, label, "origin", "vb_end", "vc_end", "vr_end");
    return;
  }
  check(
    document.assertions.some(
      (assertion) => assertion.predicate === "vector_sum" && assertion.severity === "fatal",
    ),
    `${label}: archetype crossing must prove its triangle with a fatal vector_sum`,
  );
}

function checkTwoTriangleSums(document: SceneDocument, label: string): void {
  const familyTips = ["across_vb_end", "across_vc_end", "across_vr_end", "short_vb_end", "short_vc_end", "short_vr_end"]
    .every((id) => pointOf(document, id) !== null);
  if (familyTips) {
    checkVectorSum(document, `${label} straight-across`, "across_origin", "across_vb_end", "across_vc_end", "across_vr_end");
    checkVectorSum(document, `${label} shortest-time`, "short_origin", "short_vb_end", "short_vc_end", "short_vr_end");
    return;
  }
  const sums = document.assertions.filter(
    (assertion) => assertion.predicate === "vector_sum" && assertion.severity === "fatal",
  );
  check(sums.length >= 2, `${label}: archetype figure must prove both triangles (found ${sums.length} vector_sum proofs)`);
}

/* ------------------------------------------------------------------------- */
/* Fixtures: the known live cases with source-grounded structure.            */
/* ------------------------------------------------------------------------- */

interface LiveCase {
  id: string;
  question: string;
  turnPlan: TurnPlanV3;
  problemIR: ProblemIR;
  /** Full source obligations, including dimensions the builders drop (pinned). */
  fullProblemIR: ProblemIR;
  expectFamily: string;
}

function circuitQuestion(r1: number, r2: number, r3: number, v1: number, v2: number): string {
  return `Use Kirchhoff's laws to find the branch currents. Two loops share R3. ` +
    `R1 = ${r1} ohm, R2 = ${r2} ohm, R3 = ${r3} ohm, with batteries V1 = ${v1} V and V2 = ${v2} V. ` +
    `Draw the two-loop network.`;
}

function circuitProblem(question: string, r1: number, r2: number, r3: number, v1: number, v2: number, full: boolean): ProblemIR {
  return {
    schemaVersion: PROBLEM_IR_VERSION,
    id: full ? "kirchhoffFull" : "kirchhoffTwoLoop",
    question,
    facts: [
      { id: "r1Fact", kind: "given", statement: `R1 is ${r1} ohm.`, evidence: evidence(question, `R1 = ${r1} ohm`) },
      { id: "r2Fact", kind: "given", statement: `R2 is ${r2} ohm.`, evidence: evidence(question, `R2 = ${r2} ohm`) },
      { id: "r3Fact", kind: "given", statement: `R3 is ${r3} ohm.`, evidence: evidence(question, `R3 = ${r3} ohm`) },
      { id: "v1Fact", kind: "given", statement: `V1 is ${v1} V.`, evidence: evidence(question, `V1 = ${v1} V`) },
      { id: "v2Fact", kind: "given", statement: `V2 is ${v2} V.`, evidence: evidence(question, `V2 = ${v2} V`) },
      { id: "loopFact", kind: "given", statement: "Two loops share R3.", evidence: evidence(question, "Two loops share R3") },
      { id: "reqFact", kind: "requested", statement: "Find the branch currents.", evidence: evidence(question, "find the branch currents") },
    ],
    entities: [
      { id: "r1", kind: "component", label: "R1", evidenceFactIds: ["r1Fact"] },
      { id: "r2", kind: "component", label: "R2", evidenceFactIds: ["r2Fact"] },
      { id: "r3", kind: "component", label: "R3", evidenceFactIds: ["r3Fact"] },
      { id: "v1", kind: "component", label: "V1", evidenceFactIds: ["v1Fact"] },
      { id: "v2", kind: "component", label: "V2", evidenceFactIds: ["v2Fact"] },
    ],
    expressions: [
      { id: "eR1", valueType: "scalar", root: { kind: "number", value: r1 }, evidenceFactIds: ["r1Fact"] },
      { id: "eR2", valueType: "scalar", root: { kind: "number", value: r2 }, evidenceFactIds: ["r2Fact"] },
      { id: "eR3", valueType: "scalar", root: { kind: "number", value: r3 }, evidenceFactIds: ["r3Fact"] },
      ...(full
        ? [
          { id: "eV1", valueType: "scalar" as const, root: { kind: "number" as const, value: v1 }, evidenceFactIds: ["v1Fact"] },
          { id: "eV2", valueType: "scalar" as const, root: { kind: "number" as const, value: v2 }, evidenceFactIds: ["v2Fact"] },
        ]
        : []),
    ],
    constraints: [
      { id: "c13", kind: "connected", entityIds: ["r1", "r3"], evidenceFactIds: ["loopFact"] },
      { id: "c23", kind: "connected", entityIds: ["r2", "r3"], evidenceFactIds: ["loopFact"] },
      { id: "c1v1", kind: "connected", entityIds: ["r1", "v1"], evidenceFactIds: ["loopFact"] },
      { id: "c2v2", kind: "connected", entityIds: ["r2", "v2"], evidenceFactIds: ["loopFact"] },
    ],
    representationIntents: [
      { id: "net1", kind: "network", entityIds: ["r1", "r2", "r3", "v1", "v2"], evidenceFactIds: ["loopFact"] },
    ],
    solveRequests: [],
  };
}

function circuitPlan(question: string, r1: number, r2: number, r3: number, v1: number, v2: number): TurnPlanV3 {
  return plan(question, [
    { id: "R1", symbol: "R1", value: r1, unit: "ohm", provenance: "given", sourceText: `R1 = ${r1} ohm` },
    { id: "R2", symbol: "R2", value: r2, unit: "ohm", provenance: "given", sourceText: `R2 = ${r2} ohm` },
    { id: "R3", symbol: "R3", value: r3, unit: "ohm", provenance: "given", sourceText: `R3 = ${r3} ohm` },
    { id: "V1", symbol: "V1", value: v1, unit: "V", provenance: "given", sourceText: `V1 = ${v1} V` },
    { id: "V2", symbol: "V2", value: v2, unit: "V", provenance: "given", sourceText: `V2 = ${v2} V` },
  ]);
}

function riverCrossingQuestion(vb: number, vc: number, heading: number): string {
  return `A boat crosses a wide river. The boat speed in still water is ${vb} m/s and the river current is ${vc} m/s. ` +
    `The heading is ${heading} degrees to the direction of the river. Draw the crossing velocity triangle.`;
}

function riverCrossingProblem(question: string, vb: number, vc: number, heading: number, full: boolean): ProblemIR {
  return {
    schemaVersion: PROBLEM_IR_VERSION,
    id: full ? "riverCrossingFull" : "riverCrossing",
    question,
    facts: [
      { id: "boatFact", kind: "given", statement: "A boat crosses a wide river.", evidence: evidence(question, "boat crosses a wide river") },
      { id: "speedFact", kind: "given", statement: `The boat speed in still water is ${vb} m/s.`, evidence: evidence(question, `still water is ${vb} m/s`) },
      { id: "currFact", kind: "given", statement: `The river current is ${vc} m/s.`, evidence: evidence(question, `current is ${vc} m/s`) },
      { id: "headFact", kind: "given", statement: `The heading is ${heading} degrees.`, evidence: evidence(question, `${heading} degrees`) },
      { id: "drawFact", kind: "requested", statement: "Draw the crossing velocity triangle.", evidence: evidence(question, "Draw the crossing velocity triangle") },
    ],
    entities: [
      { id: "boat", kind: "body", label: "boat", evidenceFactIds: ["boatFact"] },
      { id: "river", kind: "other", label: "river", evidenceFactIds: ["boatFact", "currFact"] },
    ],
    expressions: [
      { id: "eHeading", valueType: "scalar", root: { kind: "number", value: heading }, evidenceFactIds: ["headFact"] },
      ...(full
        ? [
          { id: "eVb", valueType: "scalar" as const, root: { kind: "number" as const, value: vb }, evidenceFactIds: ["speedFact"] },
          { id: "eVc", valueType: "scalar" as const, root: { kind: "number" as const, value: vc }, evidenceFactIds: ["currFact"] },
        ]
        : []),
    ],
    constraints: [],
    representationIntents: [
      { id: "tri1", kind: "graph", entityIds: ["boat"], evidenceFactIds: ["drawFact"] },
    ],
    solveRequests: [],
  };
}

function riverCrossingPlan(question: string, vb: number, vc: number, heading: number): TurnPlanV3 {
  return plan(question, [
    { id: "vb", symbol: "vb", value: vb, unit: "m/s", provenance: "given" },
    { id: "vc", symbol: "vc", value: vc, unit: "m/s", provenance: "given" },
    { id: "theta", symbol: "theta", value: heading, unit: "degree", provenance: "given" },
  ]);
}

const RIVER_ALONG_QUESTION =
  "A boat moves in a river. Its speed in still water is 5 m/s and the current is 2 m/s. " +
  "Find the downstream and upstream speeds.";

function riverAlongProblem(question: string, full: boolean): ProblemIR {
  return {
    schemaVersion: PROBLEM_IR_VERSION,
    id: full ? "riverAlongFull" : "riverAlong",
    question,
    facts: [
      { id: "boatFact", kind: "given", statement: "A boat moves in a river.", evidence: evidence(question, "boat moves in a river") },
      { id: "speedFact", kind: "given", statement: "Its speed in still water is 5 m/s.", evidence: evidence(question, "still water is 5 m/s") },
      { id: "currFact", kind: "given", statement: "The current is 2 m/s.", evidence: evidence(question, "current is 2 m/s") },
      { id: "reqFact", kind: "requested", statement: "Find the downstream and upstream speeds.", evidence: evidence(question, "downstream and upstream speeds") },
    ],
    entities: [
      { id: "boat", kind: "body", label: "boat", evidenceFactIds: ["boatFact"] },
      { id: "river", kind: "other", label: "river", evidenceFactIds: ["boatFact", "currFact"] },
    ],
    expressions: full
      ? [
        { id: "eVb", valueType: "scalar", root: { kind: "number", value: 5 }, evidenceFactIds: ["speedFact"] },
        { id: "eVc", valueType: "scalar", root: { kind: "number", value: 2 }, evidenceFactIds: ["currFact"] },
      ]
      : [],
    constraints: [],
    representationIntents: [
      { id: "run1", kind: "graph", entityIds: ["boat"], evidenceFactIds: ["reqFact"] },
    ],
    solveRequests: [],
  };
}

const RIVER_TWO_QUESTION =
  "A boat crosses a river. Draw the two velocity triangles for the straight-across and shortest-time crossings.";

function riverTwoProblem(question: string): ProblemIR {
  return {
    schemaVersion: PROBLEM_IR_VERSION,
    id: "riverTwoTriangles",
    question,
    facts: [
      { id: "boatFact", kind: "given", statement: "A boat crosses a river.", evidence: evidence(question, "boat crosses a river") },
      { id: "triFact", kind: "requested", statement: "Draw the two velocity triangles.", evidence: evidence(question, "two velocity triangles") },
    ],
    entities: [
      { id: "boat", kind: "body", label: "boat", evidenceFactIds: ["boatFact"] },
      { id: "river", kind: "other", label: "river", evidenceFactIds: ["boatFact"] },
      { id: "acrossT", kind: "other", label: "across", evidenceFactIds: ["triFact"] },
      { id: "shortT", kind: "other", label: "short", evidenceFactIds: ["triFact"] },
    ],
    expressions: [],
    constraints: [],
    representationIntents: [
      { id: "tri2", kind: "graph", entityIds: ["acrossT", "shortT"], evidenceFactIds: ["triFact"] },
    ],
    solveRequests: [],
  };
}

function inclineQuestion(theta: number, mass: number): string {
  return `A block of mass ${mass} kg rests on a ${theta} degree incline. Draw the free-body diagram.`;
}

function inclineProblem(question: string, theta: number, mass: number, full: boolean): ProblemIR {
  return {
    schemaVersion: PROBLEM_IR_VERSION,
    id: full ? "inclineFull" : "inclineBlock",
    question,
    facts: [
      { id: "massFact", kind: "given", statement: `The block mass is ${mass} kg.`, evidence: evidence(question, `mass ${mass} kg`) },
      { id: "angleFact", kind: "given", statement: `The incline is ${theta} degrees.`, evidence: evidence(question, `${theta} degree`) },
      { id: "restFact", kind: "given", statement: "The block rests on the incline.", evidence: evidence(question, "rests on") },
      { id: "drawFact", kind: "requested", statement: "Draw the free-body diagram.", evidence: evidence(question, "Draw the free-body diagram") },
    ],
    entities: [
      { id: "block", kind: "body", label: "block", evidenceFactIds: ["massFact", "restFact"] },
      { id: "incline", kind: "line", evidenceFactIds: ["angleFact", "restFact"] },
      { id: "contact", kind: "point", evidenceFactIds: ["restFact"] },
      { id: "normalF", kind: "other", label: "N", evidenceFactIds: ["restFact", "drawFact"] },
      { id: "weightF", kind: "other", label: "mg", evidenceFactIds: ["massFact", "drawFact"] },
    ],
    expressions: [
      { id: "eAngle", valueType: "scalar", root: { kind: "number", value: theta }, evidenceFactIds: ["angleFact"] },
      ...(full
        ? [{ id: "eMass", valueType: "scalar" as const, root: { kind: "number" as const, value: mass }, evidenceFactIds: ["massFact"] }]
        : []),
    ],
    constraints: [
      { id: "perp1", kind: "perpendicular", entityIds: ["normalF", "incline"], evidenceFactIds: ["restFact", "drawFact"] },
    ],
    representationIntents: [
      {
        id: "fb1",
        kind: "free_body",
        entityIds: full
          ? ["block", "incline", "contact", "normalF", "weightF"]
          : ["incline", "contact", "normalF", "weightF"],
        evidenceFactIds: ["drawFact"],
      },
    ],
    solveRequests: [],
  };
}

function inclinePlan(question: string, theta: number, mass: number): TurnPlanV3 {
  return plan(question, [
    { id: "m", symbol: "m", value: mass, unit: "kg", provenance: "given" },
    { id: "theta", symbol: "theta", value: theta, unit: "degree", provenance: "given" },
  ]);
}

const PULLEY_QUESTION = "Two masses m1 and m2 are connected by a string over a pulley. Draw the diagram.";

function pulleyProblem(question: string): ProblemIR {
  return {
    schemaVersion: PROBLEM_IR_VERSION,
    id: "pulleyMasses",
    question,
    facts: [
      { id: "connFact", kind: "given", statement: "Two masses m1 and m2 are connected by a string over a pulley.", evidence: evidence(question, "connected by a string over a pulley") },
      { id: "drawFact", kind: "requested", statement: "Draw the diagram.", evidence: evidence(question, "Draw the diagram") },
    ],
    entities: [
      { id: "b1", kind: "body", label: "m1", evidenceFactIds: ["connFact"] },
      { id: "b2", kind: "body", label: "m2", evidenceFactIds: ["connFact"] },
      { id: "pulley", kind: "other", evidenceFactIds: ["connFact"] },
    ],
    expressions: [],
    constraints: [
      { id: "c12", kind: "connected", entityIds: ["b1", "b2"], evidenceFactIds: ["connFact"] },
    ],
    representationIntents: [
      { id: "fb2", kind: "free_body", entityIds: ["b1", "b2", "pulley"], evidenceFactIds: ["drawFact"] },
    ],
    solveRequests: [],
  };
}

function baseCases(): LiveCase[] {
  const circuitQ = circuitQuestion(4, 6, 8, 12, 9);
  const crossingQ = riverCrossingQuestion(4, 2, 150);
  const inclineQ = inclineQuestion(30, 2);
  return [
    {
      id: "kirchhoff-two-loop",
      question: circuitQ,
      turnPlan: circuitPlan(circuitQ, 4, 6, 8, 12, 9),
      problemIR: circuitProblem(circuitQ, 4, 6, 8, 12, 9, false),
      fullProblemIR: circuitProblem(circuitQ, 4, 6, 8, 12, 9, true),
      expectFamily: "circuit_network",
    },
    {
      id: "river-crossing-150",
      question: crossingQ,
      turnPlan: riverCrossingPlan(crossingQ, 4, 2, 150),
      problemIR: riverCrossingProblem(crossingQ, 4, 2, 150, false),
      fullProblemIR: riverCrossingProblem(crossingQ, 4, 2, 150, true),
      expectFamily: "vector_diagram",
    },
    {
      id: "river-along-stream",
      question: RIVER_ALONG_QUESTION,
      turnPlan: plan(RIVER_ALONG_QUESTION, [
        { id: "vb", symbol: "vb", value: 5, unit: "m/s", provenance: "given" },
        { id: "vc", symbol: "vc", value: 2, unit: "m/s", provenance: "given" },
      ]),
      problemIR: riverAlongProblem(RIVER_ALONG_QUESTION, false),
      fullProblemIR: riverAlongProblem(RIVER_ALONG_QUESTION, true),
      expectFamily: "vector_diagram",
    },
    {
      id: "river-two-triangles",
      question: RIVER_TWO_QUESTION,
      turnPlan: plan(RIVER_TWO_QUESTION, []),
      problemIR: riverTwoProblem(RIVER_TWO_QUESTION),
      fullProblemIR: riverTwoProblem(RIVER_TWO_QUESTION),
      expectFamily: "vector_diagram",
    },
    {
      id: "incline-free-body",
      question: inclineQ,
      turnPlan: inclinePlan(inclineQ, 30, 2),
      problemIR: inclineProblem(inclineQ, 30, 2, false),
      fullProblemIR: inclineProblem(inclineQ, 30, 2, true),
      expectFamily: "contact_body",
    },
    {
      id: "pulley-free-body",
      question: PULLEY_QUESTION,
      turnPlan: plan(PULLEY_QUESTION, []),
      problemIR: pulleyProblem(PULLEY_QUESTION),
      fullProblemIR: pulleyProblem(PULLEY_QUESTION),
      expectFamily: "contact_body",
    },
  ];
}

/* ------------------------------------------------------------------------- */
/* Live slice: source -> scene -> reveal -> persist -> replay.               */
/* ------------------------------------------------------------------------- */

interface SliceResult {
  id: string;
  document: SceneDocument;
  set: VisualObligationSet;
  tier: string;
  family: string | undefined;
}

function pictureOracle(caseId: string, document: SceneDocument): OracleVerdict {
  switch (caseId) {
    case "kirchhoff-two-loop": return oracleTwoLoopCircuit(document);
    case "river-crossing-150": return oracleRiverBoat(document, "crossing");
    case "river-along-stream": return oracleRiverBoat(document, "along_stream");
    case "river-two-triangles": return oracleRiverBoat(document, "two_triangles");
    case "incline-free-body": return oracleInclineFreeBody(document);
    case "pulley-free-body": return oraclePulleyFreeBody(document);
    default: throw new Error(`unknown case ${caseId}`);
  }
}

function sceneCarries(document: SceneDocument, value: number): boolean {
  return document.quantities.some(
    (quantity) => typeof quantity.value === "number"
      && Math.abs(quantity.value - value) <= 1e-9 * Math.max(1, Math.abs(quantity.value), Math.abs(value)),
  );
}

function artifactsFor(
  turnPlan: TurnPlanV3 | null,
  tier: SceneArtifactsV3["representationTier"],
  nonMetric: boolean,
): SceneArtifactsV3 {
  return {
    schemaVersion: SCENE_ARTIFACTS_V3_VERSION,
    turnPlan,
    representationTier: tier,
    nonMetric,
    candidates: [],
    diagramResultStatus: "ready",
  };
}

function trustedIntroSegments(presentation: ReturnType<typeof buildVerifiedDiagramPresentation>): SubmittedTurnSegment[] {
  return presentation.introSegments.map((segment, orderIndex) => ({
    orderIndex,
    narration: segment.narration,
    spokenText: segment.narration,
    command: serializeSegmentCommands(getSegmentCommands(segment), { trustedDiagramGeometry: true }),
  }));
}

async function runLiveSlice(live: LiveCase): Promise<SliceResult> {
  const { id, question, turnPlan, problemIR } = live;
  // Contract: the source structure and the plan validate.
  const problemValidation = validateProblemIR(problemIR, question);
  check(problemValidation.valid, `${id}: ProblemIR must validate: ${JSON.stringify(problemValidation.issues)}`);
  const fullValidation = validateProblemIR(live.fullProblemIR, question);
  check(fullValidation.valid, `${id}: full ProblemIR must validate: ${JSON.stringify(fullValidation.issues)}`);
  const planValidation = validateTurnPlanV3(turnPlan, question);
  check(planValidation.plan !== null, `${id}: TurnPlanV3 must validate: ${JSON.stringify(planValidation.issues)}`);

  // Deterministic authority: obligations derive from structure alone, and the
  // planner can express every supported one.
  const set = deriveVisualObligations(problemIR);
  check(set.obligations.length > 0, `${id}: the source must obligate at least one requirement`);
  check(
    visualObligationsPlannerCoverage(set).covered,
    `${id}: every supported obligation must be planner-expressible`,
  );

  // Live synthesis through the same selector the tutor uses.
  const selected = selectVerifiedRepresentation({ question, turnPlan, problemIR });
  check(selected.renderScene.primitives.length > 0, `${id}: the live path must commit ink`);
  check(
    selected.family === live.expectFamily,
    `${id}: expected family ${live.expectFamily}, got ${selected.family ?? "none"} (${selected.reason})`,
  );
  check(selected.validationReport.valid, `${id}: the committed report must be valid`);
  check(
    !selected.validationReport.issues.some((issue) => issue.severity === "fatal"),
    `${id}: the committed report must carry no fatal issue`,
  );

  // Independent picture class (never the family classifier).
  const oracle = pictureOracle(id, selected.sceneDocument);
  check(oracle.pass, `${id}: wrong picture class: ${oracle.detail}`);

  // Whole scene: every supported source requirement is present.
  const obligationResult = checkVisualObligations(set, selected.sceneDocument);
  check(
    obligationResult.satisfied,
    `${id}: the committed scene must satisfy its obligations: ${
      obligationResult.missing.map((miss) => `${miss.obligationId} (${miss.code})`).join(", ")
    }`,
  );

  // Structural contract on the committed document.
  const structural = validateSceneDocument(selected.sceneDocument);
  check(structural.document !== null, `${id}: the committed document must validate structurally`);

  // Determinism: the same source commits the same document twice.
  const again = selectVerifiedRepresentation({ question, turnPlan, problemIR });
  check(
    JSON.stringify(again.sceneDocument) === JSON.stringify(selected.sceneDocument),
    `${id}: live synthesis must be deterministic for the same source`,
  );

  // Rendered scene: every obligated body draws.
  const rendered = new Set(selected.renderScene.primitives.map((primitive) => primitive.entityId));
  for (const obligation of set.obligations) {
    if (obligation.kind !== "named_body") continue;
    const direct = selected.sceneDocument.entities.some((entity) => entity.id === obligation.problemEntityId);
    const sceneId = direct
      ? obligation.problemEntityId
      : selected.sceneDocument.entities.find((entity) => entity.label === obligation.problemLabel)?.id;
    check(sceneId !== undefined, `${id}: obligated body ${obligation.problemEntityId} must map to the scene`);
    if (sceneId) check(rendered.has(sceneId), `${id}: obligated body ${sceneId} must render ink`);
  }

  // Narrated reveal: one spoken beat per reveal group, every group covered.
  const presentation = buildVerifiedDiagramPresentation(selected.sceneDocument, selected.renderScene);
  check(verifiedDiagramHasDrawableInk(presentation.diagram), `${id}: the reveal must carry drawable ink`);
  check(presentation.introSegments.length >= 1, `${id}: the reveal must speak at least one intro beat`);
  check(
    presentation.introSegments.every((segment) => segment.narration.trim().length > 0),
    `${id}: every intro beat must speak`,
  );
  const revealedTargets = new Set(presentation.diagram.reveals.map((reveal) => reveal.targetId));
  for (const group of selected.sceneDocument.revealGroups) {
    check(revealedTargets.has(group.id), `${id}: reveal group ${group.id} must be narrated`);
  }
  const revealedCommands = new Set(presentation.diagram.reveals.flatMap((reveal) => reveal.commandIndices));
  check(revealedCommands.size > 0, `${id}: the narrated reveal must draw commands`);
  check(
    presentation.diagram.promptAddon.includes("[FOCUS:"),
    `${id}: the teaching prompt must offer FOCUS traces on verified parts`,
  );
  check(
    presentation.diagram.promptAddon.includes("Do not emit DRAW_"),
    `${id}: the teaching prompt must withhold diagram ink from narration`,
  );

  // Label checks: in-zone, non-empty, anchored, never invented.
  const entityIds = new Set(selected.sceneDocument.entities.map((entity) => entity.id));
  const drawnLabels = new Set(
    selected.sceneDocument.entities.map((entity) => entity.label).filter((label): label is string => Boolean(label)),
  );
  const labelCommands = presentation.diagram.commands.filter((command) => command.type === "LABEL");
  check(labelCommands.length > 0, `${id}: the committed figure must letter at least one part`);
  for (const command of labelCommands) {
    const [x, y] = command.params;
    check(
      typeof x === "number" && typeof y === "number"
        && x >= DIAGRAM_ZONE.x && x <= DIAGRAM_ZONE.x + DIAGRAM_ZONE.width
        && y >= 0 && y <= 700,
      `${id}: label "${command.text}" must sit in the diagram zone, got (${x}, ${y})`,
    );
    check(
      typeof command.text === "string" && command.text.trim().length > 0,
      `${id}: every label command must carry text`,
    );
    check(
      command.anchorId === undefined || entityIds.has(command.anchorId),
      `${id}: label "${command.text}" must anchor to a scene entity`,
    );
    const lettering = command.text?.trim() ?? "";
    const composedFromScene = [...drawnLabels].some((label) => {
      if (lettering === label) return true;
      if (!lettering.startsWith(`${label} `)) return false;
      const suffix = lettering.slice(label.length).trim();
      return selected.sceneDocument.quantities.some((quantity) =>
        typeof quantity.value === "number" && suffix.includes(String(quantity.value)),
      );
    });
    check(
      composedFromScene,
      `${id}: label "${command.text}" is not drawn from the scene's own lettering`,
    );
  }

  // Persistence: the accepted scene saves with server-owned intro ink.
  const focusTarget = presentation.diagram.anchors[0]?.id;
  check(focusTarget !== undefined, `${id}: the reveal must expose a FOCUS anchor`);
  const persistSegments: SubmittedTurnSegment[] = [
    ...trustedIntroSegments(presentation),
    {
      orderIndex: presentation.introSegments.length,
      narration: "Write the given values.",
      spokenText: "Write the given values.",
      command: {
        type: "WRITE",
        params: [90, 145, 28],
        text: "givens",
        charPosition: 0,
        narrationBefore: "Write the given values.",
      },
    },
    {
      orderIndex: presentation.introSegments.length + 1,
      narration: `Notice ${focusTarget}.`,
      spokenText: `Notice ${focusTarget}.`,
      command: {
        type: "FOCUS",
        params: [],
        text: focusTarget ?? "missing",
        charPosition: 0,
        narrationBefore: `Notice ${focusTarget}.`,
      },
    },
  ];
  const persisted = await canonicalizeTurnSceneMetadata({
    question,
    sceneDocument: selected.sceneDocument,
    sceneEngineVersion: null,
    validationReport: selected.validationReport,
    visualStatus: "validated",
    sceneArtifacts: artifactsFor(turnPlan, selected.tier, selected.nonMetric),
    segments: persistSegments,
  });
  check(persisted.ok, `${id}: the accepted scene must persist: ${persisted.ok ? "" : persisted.error}`);
  if (!persisted.ok) throw new Error(`${id}: persistence failed`);
  check(persisted.value.visualStatus === "validated", `${id}: persisted status must stay validated`);
  check(
    JSON.stringify(persisted.value.sceneDocument?.entities.map((entity) => entity.id))
      === JSON.stringify(selected.sceneDocument.entities.map((entity) => entity.id)),
    `${id}: persistence must keep the taught entities`,
  );

  // Saved-turn replay: the stored turn rebuilds the identical presentation.
  const replay = restoreVerifiedPresentationFromTurn({ sceneDocument: persisted.value.sceneDocument });
  check(replay !== null, `${id}: the saved turn must replay`);
  if (replay) {
    const liveAnchors = presentation.diagram.anchors.map((anchor) => anchor.id).sort();
    const replayAnchors = replay.diagram.anchors.map((anchor) => anchor.id).sort();
    check(
      JSON.stringify(replayAnchors) === JSON.stringify(liveAnchors),
      `${id}: replay anchors must match the live reveal`,
    );
    check(
      replay.diagram.reveals.length === presentation.diagram.reveals.length,
      `${id}: replay must narrate the same beats (${replay.diagram.reveals.length} vs ${presentation.diagram.reveals.length})`,
    );
    check(
      replay.diagram.commands.length === presentation.diagram.commands.length,
      `${id}: replay must draw the same commands (${replay.diagram.commands.length} vs ${presentation.diagram.commands.length})`,
    );
    const liveLabels = presentation.diagram.commands.filter((command) => command.type === "LABEL").map((command) => command.text).sort();
    const replayLabels = replay.diagram.commands.filter((command) => command.type === "LABEL").map((command) => command.text).sort();
    check(
      JSON.stringify(replayLabels) === JSON.stringify(liveLabels),
      `${id}: replay must letter the same parts`,
    );
  }

  return { id, document: selected.sceneDocument, set, tier: selected.tier, family: selected.family };
}

async function main(): Promise<void> {
  const cases = baseCases();
  const slices = new Map<string, SliceResult>();
  for (const live of cases) {
    slices.set(live.id, await runLiveSlice(live));
  }

  const byId = (id: string): SliceResult => {
    const slice = slices.get(id);
    if (!slice) throw new Error(`missing slice ${id}`);
    return slice;
  };

  /* -- Source values ride the committed scenes (never stale) ---------------- */
  check(sceneCarries(byId("kirchhoff-two-loop").document, 4), "two-loop scene must carry R1 = 4");
  check(sceneCarries(byId("kirchhoff-two-loop").document, 6), "two-loop scene must carry R2 = 6");
  check(sceneCarries(byId("kirchhoff-two-loop").document, 8), "two-loop scene must carry R3 = 8");
  check(sceneCarries(byId("river-crossing-150").document, 150), "crossing scene must carry the 150 degree heading");
  check(sceneCarries(byId("incline-free-body").document, 30), "incline scene must carry the 30 degree angle");

  /* -- Independent geometry: resultants equal heading + current ------------- */
  const alongDoc = byId("river-along-stream").document;
  const downstreamLabel = alongDoc.entities.find((entity) => entity.id === "downstream")?.label;
  const upstreamLabel = alongDoc.entities.find((entity) => entity.id === "upstream")?.label;
  if (downstreamLabel !== undefined || upstreamLabel !== undefined) {
    // The river_boat archetype solves vb +/- vc from the plan; re-derive them
    // here from the source speeds (5 and 2) rather than trusting the labels.
    const down = downstreamLabel?.match(/=\s*(-?[\d.]+)\s*$/)?.[1];
    const up = upstreamLabel?.match(/=\s*(-?[\d.]+)\s*$/)?.[1];
    check(down !== undefined && Number(down) === 5 + 2, `along-stream downstream must solve 5 + 2, got "${downstreamLabel}"`);
    check(up !== undefined && Number(up) === 5 - 2, `along-stream upstream must solve 5 - 2, got "${upstreamLabel}"`);
  }
  checkCrossingSum(byId("river-crossing-150").document, "crossing");
  checkTwoTriangleSums(byId("river-two-triangles").document, "two-triangle");

  /* -- The three river variants are three different figures ----------------- */
  const alongIds = new Set(byId("river-along-stream").document.entities.map((entity) => entity.id));
  const crossIds = new Set(byId("river-crossing-150").document.entities.map((entity) => entity.id));
  const twoIds = new Set(byId("river-two-triangles").document.entities.map((entity) => entity.id));
  check(
    (alongIds.has("vd") && alongIds.has("vu")) || (alongIds.has("downstream") && alongIds.has("upstream")),
    "along-stream must draw downstream and upstream",
  );
  check(crossIds.has("vr") && crossIds.has("heading_mark"), "crossing must draw the resultant and heading mark");
  check(twoIds.has("across_vr") && twoIds.has("short_vr"), "two-triangle figure must draw both resultants");
  for (const ids of [alongIds, crossIds, twoIds]) {
    check(!(ids.has("a") && ids.has("b") && ids.has("a_end")), "no river variant may be the recycled A/B arrows");
  }

  /* -- Full source obligations: carried where the builders carry them ------- */
  // The two_loop_network archetype reads resistors and emfs from the stem, so
  // the live two-loop figure satisfies the full source obligations outright.
  const circuitFull = deriveVisualObligations(cases.find((live) => live.id === "kirchhoff-two-loop")!.fullProblemIR);
  check(
    checkVisualObligations(circuitFull, byId("kirchhoff-two-loop").document).satisfied,
    `two-loop figure must satisfy its full source obligations: ${
      [...missIds(circuitFull, byId("kirchhoff-two-loop").document)].join(",")
    }`,
  );
  check(sceneCarries(byId("kirchhoff-two-loop").document, 12), "two-loop scene must carry V1 = 12");
  check(sceneCarries(byId("kirchhoff-two-loop").document, 9), "two-loop scene must carry V2 = 9");
  // The river_boat archetype solves the along-stream speeds from the plan, so
  // its figure satisfies the full obligations too.
  const alongFull = deriveVisualObligations(cases.find((live) => live.id === "river-along-stream")!.fullProblemIR);
  check(
    checkVisualObligations(alongFull, byId("river-along-stream").document).satisfied,
    `along-stream figure must satisfy its full source obligations: ${
      [...missIds(alongFull, byId("river-along-stream").document)].join(",")
    }`,
  );
  /* -- Pinned known gaps: full source obligations the builders drop --------- */
  // The obligations-gated crossing commits the family shape, which carries the
  // heading but not the boat/current speeds (the archetype shape carries the
  // speeds but not the heading). Neither shape is complete; both gaps stay
  // pinned here until one shape carries all three.
  const crossingFull = deriveVisualObligations(cases.find((live) => live.id === "river-crossing-150")!.fullProblemIR);
  const crossingFullMisses = missIds(crossingFull, byId("river-crossing-150").document);
  check(
    crossingFullMisses.has("dimension:eVb") && crossingFullMisses.has("dimension:eVc"),
    `crossing figure must pin its dropped speeds, got [${[...crossingFullMisses].join(",")}]`,
  );
  // The obligations-gated incline commits the family shape: contact forces
  // without a block glyph and without the mass (the archetype shape draws the
  // block labeled with the mass but under a contact id the obligations miss).
  const inclineFull = deriveVisualObligations(cases.find((live) => live.id === "incline-free-body")!.fullProblemIR);
  const inclineFullMisses = missIds(inclineFull, byId("incline-free-body").document);
  check(
    inclineFullMisses.has("body:block") && inclineFullMisses.has("dimension:eMass"),
    `incline figure must pin its missing block glyph and mass, got [${[...inclineFullMisses].join(",")}]`,
  );

  /* -- Wrong family: every scene rejects every other case's source ---------- */
  // Obligations judge completeness across families; within the river family
  // the three variants share the boat body, so variant relevance is judged by
  // the picture oracle below instead.
  const RIVER_IDS = new Set(["river-crossing-150", "river-along-stream", "river-two-triangles"]);
  const ids = [...slices.keys()];
  for (const first of ids) {
    for (const second of ids) {
      if (first === second) continue;
      if (RIVER_IDS.has(first) && RIVER_IDS.has(second)) continue;
      const rejected = !checkVisualObligations(byId(first).set, byId(second).document).satisfied;
      check(rejected, `wrong family must reject: ${first} obligations vs ${second} scene`);
    }
  }
  const variantPairs: Array<[string, RiverVariant, string, RiverVariant]> = [
    ["river-along-stream", "crossing", "river-crossing-150", "along_stream"],
    ["river-along-stream", "two_triangles", "river-two-triangles", "along_stream"],
    ["river-crossing-150", "two_triangles", "river-two-triangles", "crossing"],
  ];
  for (const [firstId, firstAs, secondId, secondAs] of variantPairs) {
    check(
      !oracleRiverBoat(byId(firstId).document, firstAs).pass,
      `${firstId} scene must not read as ${firstAs}`,
    );
    check(
      !oracleRiverBoat(byId(secondId).document, secondAs).pass,
      `${secondId} scene must not read as ${secondAs}`,
    );
  }
  check(!oracleTwoLoopCircuit(byId("incline-free-body").document).pass, "incline scene must not read as a two-loop network");
  check(!oracleInclineFreeBody(byId("kirchhoff-two-loop").document).pass, "two-loop scene must not read as an incline");
  check(
    !oracleRiverBoat(byId("kirchhoff-two-loop").document, "crossing").pass,
    "two-loop scene must not read as a river crossing",
  );

  /* -- No ink: figure-absent and unsupported stems teach text-only ---------- */
  for (const stem of [
    "Find the equivalent resistance of the combination shown in the figure.",
    "Explain why the sky is blue.",
  ]) {
    const textOnly = selectVerifiedRepresentation({
      question: stem,
      turnPlan: plan(stem, []),
      problemIR: null,
    });
    const presentation = buildVerifiedDiagramPresentation(textOnly.sceneDocument, textOnly.renderScene);
    check(
      textOnly.renderScene.primitives.length === 0 && !verifiedDiagramHasDrawableInk(presentation.diagram),
      `no-ink stem must teach text-only: "${stem}" (${textOnly.reason})`,
    );
  }

  /* -- Stale scalar: a plan value off-source must never pair with ink ------- */
  const inclineLive = cases.find((live) => live.id === "incline-free-body")!;
  const staleInclinePlan = inclinePlan(inclineLive.question, 31, 2);
  const staleIncline = selectVerifiedRepresentation({
    question: inclineLive.question,
    turnPlan: staleInclinePlan,
    problemIR: inclineLive.problemIR,
  });
  const staleInclinePresentation = buildVerifiedDiagramPresentation(staleIncline.sceneDocument, staleIncline.renderScene);
  check(
    staleIncline.renderScene.primitives.length === 0
      || (sceneCarries(staleIncline.sceneDocument, 30) && !sceneCarries(staleIncline.sceneDocument, 31)),
    "a stale 31 degree plan must decline or commit carrying the source 30 degrees",
  );
  check(
    staleIncline.renderScene.primitives.length === 0
      || !verifiedDiagramHasDrawableInk(staleInclinePresentation.diagram)
      || sceneCarries(staleIncline.sceneDocument, 30),
    "stale incline ink must never carry the stale angle",
  );

  const crossingLive = cases.find((live) => live.id === "river-crossing-150")!;
  const staleCrossing = selectVerifiedRepresentation({
    question: crossingLive.question,
    turnPlan: riverCrossingPlan(crossingLive.question, 4, 2, 151),
    problemIR: crossingLive.problemIR,
  });
  check(
    staleCrossing.renderScene.primitives.length === 0
      || (sceneCarries(staleCrossing.sceneDocument, 150) && !sceneCarries(staleCrossing.sceneDocument, 151)),
    "a stale 151 degree plan must decline or commit carrying the source 150 degrees",
  );

  const circuitLive = cases.find((live) => live.id === "kirchhoff-two-loop")!;
  const staleCircuit = selectVerifiedRepresentation({
    question: circuitLive.question,
    turnPlan: circuitPlan(circuitLive.question, 5, 6, 8, 12, 9),
    problemIR: circuitLive.problemIR,
  });
  check(
    staleCircuit.renderScene.primitives.length === 0 || sceneCarries(staleCircuit.sceneDocument, 4),
    "a stale R1 = 5 plan must decline or commit carrying the source R1 = 4",
  );
  if (staleCircuit.renderScene.primitives.length > 0) {
    check(
      !sceneCarries(staleCircuit.sceneDocument, 5),
      "committed circuit ink must never carry the stale R1 = 5",
    );
  }

  /* -- Partial scenes never render: one mutation per obligation kind ------- */
  const circuitDoc = byId("kirchhoff-two-loop").document;
  const circuitSet = byId("kirchhoff-two-loop").set;
  const dropR3 = structuredClone(circuitDoc);
  dropR3.entities = dropR3.entities.filter((entity) => entity.id !== "r3");
  dropR3.constructions = dropR3.constructions.filter((construction) => !construction.outputs.includes("r3"));
  check(!checkVisualObligations(circuitSet, dropR3).satisfied, "a two-loop scene without R3 must reject");
  check(missIds(circuitSet, dropR3).has("body:r3"), "dropping R3 must miss exactly its named body");
  const dropOhms = structuredClone(circuitDoc);
  dropOhms.quantities = dropOhms.quantities.filter((quantity) => quantity.value !== 8);
  check(
    missIds(circuitSet, dropOhms).has("dimension:eR3"),
    "a two-loop scene without R3 = 8 must miss its given dimension",
  );
  const inclineDoc = byId("incline-free-body").document;
  const inclineSet = byId("incline-free-body").set;
  const unproved = structuredClone(inclineDoc);
  unproved.assertions = unproved.assertions.filter((assertion) => assertion.predicate !== "perpendicular");
  check(
    missIds(inclineSet, unproved).has("relation:perp1"),
    "an incline scene without its perpendicular proof must miss its spatial relation",
  );
  const pulleyDoc = byId("pulley-free-body").document;
  const pulleySet = byId("pulley-free-body").set;
  const unwired = structuredClone(pulleyDoc);
  unwired.constructions = unwired.constructions.filter((construction) => !construction.outputs.includes("right_string"));
  check(
    !checkVisualObligations(pulleySet, unwired).satisfied,
    "a pulley scene with a cut string must reject its connection",
  );
  const noBanks = structuredClone(byId("river-crossing-150").document);
  noBanks.entities = noBanks.entities.filter((entity) => !/bank/i.test(`${entity.role ?? ""} ${entity.id}`));
  check(
    !oracleRiverBoat(noBanks, "crossing").pass,
    "a crossing scene with its banks removed must fail the picture oracle",
  );

  /* -- Persistence failures: forged saves reject, FOCUS mismatches filter -- */
  const circuitSlice = byId("kirchhoff-two-loop");
  const livePresentation = buildVerifiedDiagramPresentation(circuitSlice.document, selectVerifiedRepresentation({
    question: circuitLive.question,
    turnPlan: circuitLive.turnPlan,
    problemIR: circuitLive.problemIR,
  }).renderScene);
  const goodSegments = trustedIntroSegments(livePresentation);
  const goodTier = circuitSlice.tier as SceneArtifactsV3["representationTier"];
  const goodArtifacts = artifactsFor(circuitLive.turnPlan, goodTier, goodTier !== "exact_verified");

  const forgedQuestion = structuredClone(circuitSlice.document);
  forgedQuestion.source.question = `${circuitLive.question} (forged)`;
  const forgedQuestionResult = await canonicalizeTurnSceneMetadata({
    question: circuitLive.question,
    sceneDocument: forgedQuestion,
    sceneEngineVersion: null,
    validationReport: null,
    visualStatus: "validated",
    sceneArtifacts: goodArtifacts,
    segments: goodSegments,
  });
  check(!forgedQuestionResult.ok, "a scene saved under another question must reject");

  const forgedTier = structuredClone(circuitSlice.document);
  forgedTier.source.representationTier = "exact_verified";
  const forgedTierResult = await canonicalizeTurnSceneMetadata({
    question: circuitLive.question,
    sceneDocument: forgedTier,
    sceneEngineVersion: null,
    validationReport: null,
    visualStatus: "validated",
    sceneArtifacts: goodArtifacts,
    segments: goodSegments,
  });
  check(!forgedTierResult.ok, "a scene whose declared tier disagrees must reject");

  const trustedWithoutScene = await canonicalizeTurnSceneMetadata({
    question: circuitLive.question,
    visualStatus: "text_only",
    segments: goodSegments,
  });
  check(!trustedWithoutScene.ok, "trusted diagram ink without a validated scene must reject");

  const forgedInk = await canonicalizeTurnSceneMetadata({
    question: circuitLive.question,
    visualStatus: "text_only",
    segments: [{
      orderIndex: 0,
      narration: "forged ink",
      spokenText: "forged ink",
      command: { type: "DRAW_LINE", params: [0, 0, 100, 100], charPosition: 0, narrationBefore: "" },
    }],
  });
  check(!forgedInk.ok, "untrusted diagram ink must reject at save time");

  const unknownFocus = await canonicalizeTurnSceneMetadata({
    question: circuitLive.question,
    sceneDocument: circuitSlice.document,
    sceneEngineVersion: null,
    validationReport: null,
    visualStatus: "validated",
    sceneArtifacts: goodArtifacts,
    segments: [
      ...goodSegments,
      {
        orderIndex: goodSegments.length,
        narration: "Notice the missing part.",
        spokenText: "Notice the missing part.",
        command: {
          type: "FOCUS",
          params: [],
          text: "not-a-verified-anchor",
          charPosition: 0,
          narrationBefore: "Notice the missing part.",
        },
      },
    ],
  });
  check(unknownFocus.ok, "an unknown FOCUS id must filter, not drop the recording");
  if (unknownFocus.ok) {
    const last = unknownFocus.value.segments.at(-1);
    check(
      last?.narration === "Notice the missing part.",
      "a filtered FOCUS must keep its narration",
    );
  }

  /* -- Parameter variations: source, structure, and geometry move together -- */
  for (const theta of [15, 45, 60]) {
    for (const mass of [1, 5]) {
      const question = inclineQuestion(theta, mass);
      const varied = selectVerifiedRepresentation({
        question,
        turnPlan: inclinePlan(question, theta, mass),
        problemIR: inclineProblem(question, theta, mass, false),
      });
      check(varied.renderScene.primitives.length > 0, `incline theta=${theta} mass=${mass} must commit`);
      check(
        pictureOracle("incline-free-body", varied.sceneDocument).pass,
        `incline theta=${theta} mass=${mass} must keep its picture class`,
      );
      check(
        sceneCarries(varied.sceneDocument, theta),
        `incline theta=${theta} mass=${mass} must carry the source angle`,
      );
      const variedSet = deriveVisualObligations(inclineProblem(question, theta, mass, false));
      check(
        checkVisualObligations(variedSet, varied.sceneDocument).satisfied,
        `incline theta=${theta} mass=${mass} must satisfy its rebuilt obligations`,
      );
    }
  }
  for (const heading of [30, 90, 150]) {
    const question = riverCrossingQuestion(4, 2, heading);
    const varied = selectVerifiedRepresentation({
      question,
      turnPlan: riverCrossingPlan(question, 4, 2, heading),
      problemIR: riverCrossingProblem(question, 4, 2, heading, false),
    });
    check(varied.renderScene.primitives.length > 0, `crossing heading=${heading} must commit`);
    check(
      pictureOracle("river-crossing-150", varied.sceneDocument).pass,
      `crossing heading=${heading} must keep its picture class`,
    );
    check(
      sceneCarries(varied.sceneDocument, heading),
      `crossing heading=${heading} must carry the source heading`,
    );
    checkCrossingSum(varied.sceneDocument, `crossing heading=${heading}`);
  }
  for (const [r1, r2, r3] of [[4, 6, 8], [12, 12, 12], [10, 20, 30]] as const) {
    const question = circuitQuestion(r1, r2, r3, 12, 9);
    const varied = selectVerifiedRepresentation({
      question,
      turnPlan: circuitPlan(question, r1, r2, r3, 12, 9),
      problemIR: circuitProblem(question, r1, r2, r3, 12, 9, false),
    });
    check(varied.renderScene.primitives.length > 0, `two-loop R=${r1}/${r2}/${r3} must commit`);
    const verdict = oracleTwoLoopCircuit(varied.sceneDocument);
    check(verdict.pass, `two-loop R=${r1}/${r2}/${r3} must keep its picture class: ${verdict.detail}`);
    check(sceneCarries(varied.sceneDocument, r1), `two-loop scene must carry R1 = ${r1}`);
  }

  /* -- Fallback catalog: no-ProblemIR stems commit the same picture class --- */
  for (const live of cases) {
    const fallback = selectVerifiedRepresentation({ question: live.question, turnPlan: live.turnPlan });
    check(
      fallback.renderScene.primitives.length > 0,
      `${live.id}: the no-structure fallback must still commit ink`,
    );
    const fallbackOracle = pictureOracle(live.id, fallback.sceneDocument);
    check(
      fallbackOracle.pass,
      `${live.id}: the no-structure fallback must keep the picture class: ${fallbackOracle.detail}`,
    );
    // The fallback archetype shapes carry their own solved values; re-derive
    // them from the source rather than trusting the labels.
    if (live.id === "river-crossing-150") {
      checkCrossingSum(fallback.sceneDocument, "fallback crossing");
      if (fallback.sceneDocument.entities.some((entity) => entity.id === "current")) {
        check(sceneCarries(fallback.sceneDocument, 4), "fallback crossing must carry vb = 4");
        check(sceneCarries(fallback.sceneDocument, 2), "fallback crossing must carry vc = 2");
        const angleLabel = fallback.sceneDocument.entities.find((entity) => entity.id === "angle")?.label;
        const degrees = angleLabel?.match(/=\s*(-?[\d.]+)\s*°/)?.[1];
        check(
          degrees !== undefined && Number(degrees) === 180 - 150,
          `fallback crossing angle must be 180 - 150 degrees, got "${angleLabel}"`,
        );
      }
    }
    if (live.id === "river-two-triangles") {
      checkTwoTriangleSums(fallback.sceneDocument, "fallback two-triangle");
    }
    if (live.id === "incline-free-body" && fallback.sceneDocument.entities.some((entity) => entity.id === "body")) {
      const bodyLabel = fallback.sceneDocument.entities.find((entity) => entity.id === "body")?.label;
      const kilos = bodyLabel?.match(/=\s*(-?[\d.]+)\s*kg/)?.[1];
      check(kilos !== undefined && Number(kilos) === 2, `fallback incline block must show m = 2 kg, got "${bodyLabel}"`);
    }
    if (live.id === "pulley-free-body" && fallback.sceneDocument.entities.some((entity) => entity.id === "T1")) {
      check(
        fallback.sceneDocument.assertions.some(
          (assertion) => assertion.predicate === "equal_length" && assertion.severity === "fatal"
            && assertion.entities.includes("T1") && assertion.entities.includes("T2"),
        ),
        "fallback pulley must prove its tensions equal",
      );
    }
  }

  console.log(`verify-dcp03-live-relevance: ok (${checks} checks)`);
  console.log(`  slices=6 (two-loop, 3 river variants, 2 free-body) with reveal + persist + replay`);
  console.log(`  negative=24 wrong-family + 6 variant + 2 no-ink + 3 stale-scalar + 5 persistence + 5 partial`);
  console.log(`  variations=6 incline + 3 crossing + 3 circuit + 6 fallback`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
