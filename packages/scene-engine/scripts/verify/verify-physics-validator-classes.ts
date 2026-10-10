/**
 * Physics validator classes (Harness 3 round 3, S1). Each validator checks the
 * physics it names, no more and no less. Real strict planner candidates are
 * the fixtures (fixtures/physics-validator-candidates.json), and every
 * positive claim has a negation that must still fail.
 *
 * 1. Parallel proof. A parallel claim needs one pair of elements on a shared
 *    node pair, so a mixed series-parallel network proves it with its branch
 *    pair. "In parallel" is relative to a port: a shared node needs a third
 *    connection (another element, a source or a terminal lead), and the open
 *    far node of a fed pair is the network's exit terminal. A bare two element
 *    ring has no port at all: it is one series loop, and an isolated LC loop
 *    proves `path`, never parallel.
 * 2. opposite_direction on page-normal glyphs. F = I L x B on opposite sides
 *    of a loop in an in-plane field points out of and into the page; two
 *    glyphs are opposite exactly when one is out and the other in.
 * 3. Powered closure. An unloaded series or parallel combination of cells with
 *    free terminals is a two-terminal source; every cell must close a loop only
 *    when the document draws a load or meter, or the plan claims a current.
 */
import { readFileSync } from "node:fs";
import {
  compileSceneDocument, normalizeClaimedClosedRouteGeometry, normalizeClaimedParaxialReflectionGeometry,
  pruneDeadSceneEntities, pruneUnverifiedSceneAnnotations, synthesizeFamilyScene, validateSceneDocument,
  validateTurnPlanSceneProofs, type SceneIssue, type TurnPlanV3,
} from "../../src/index";

type Raw = Record<string, any>;
type Fixture = {
  record: string; note: string; question: string; candidate: Raw;
  plan: { lawIds: string[]; claims: Array<[string, string]>; assumptions: string[] };
};
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/physics-validator-candidates.json", import.meta.url), "utf8")) as Record<string, Fixture>;

let checks = 0;
const failures: string[] = [];
function check(condition: unknown, message: string): void {
  checks += 1;
  if (!condition) failures.push(message);
}

/** The lab keeps claim ids and texts; the stable claim key is not recorded, so the id stands in. */
function planFor(fixture: Pick<Fixture, "question" | "plan">, extra: { lawIds?: string[]; claims?: Array<[string, string]> } = {}): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3", question: fixture.question, givens: [], unknowns: [], derived: [],
    qualitativeClaims: [...fixture.plan.claims, ...(extra.claims ?? [])].map(([id, text]) => ({ id, claim: id, expected: text })),
    lawIds: [...fixture.plan.lawIds, ...(extra.lawIds ?? [])], assumptions: fixture.plan.assumptions, visualRequirement: "required",
  };
}

/** The scene-engine half of production candidate validation, in production order. */
function run(candidate: Raw, plan: TurnPlanV3): { fatal: SceneIssue[]; compiled: boolean } {
  let validated = validateSceneDocument(pruneDeadSceneEntities(structuredClone(candidate)));
  const fatalOf = (issues: SceneIssue[]) => issues.filter((issue) => issue.severity === "fatal");
  if (!validated.document) return { fatal: fatalOf(validated.report.issues), compiled: false };
  const normalized = normalizeClaimedParaxialReflectionGeometry(normalizeClaimedClosedRouteGeometry(validated.document, plan), plan);
  if (normalized !== validated.document) {
    validated = validateSceneDocument(pruneDeadSceneEntities(normalized as unknown as Raw));
    if (!validated.document) return { fatal: fatalOf(validated.report.issues), compiled: false };
  }
  const pruned = pruneUnverifiedSceneAnnotations(validated.document, plan);
  if (pruned !== validated.document) {
    validated = validateSceneDocument(pruneDeadSceneEntities(pruned as unknown as Raw));
    if (!validated.document) return { fatal: fatalOf(validated.report.issues), compiled: false };
  }
  const compiled = compileSceneDocument(validated.document);
  return {
    fatal: fatalOf([...validateTurnPlanSceneProofs(validated.document, plan), ...compiled.report.issues]),
    compiled: compiled.ok && Boolean(compiled.renderScene),
  };
}
const codes = (issues: SceneIssue[]) => issues.map((issue) => issue.code).join(", ") || "none";
const sameSet = (actual: readonly string[] | undefined, expected: readonly string[]) =>
  actual !== undefined && actual.length === expected.length && expected.every((id) => actual.includes(id));
const passes = (result: ReturnType<typeof run>) => result.fatal.length === 0 && result.compiled;

/** Add a lead from a node to a free terminal point, as a repair would. */
function withLead(candidate: Raw, node: string, terminal: string, at: [number, number], group?: string): Raw {
  const next = structuredClone(candidate);
  const wire = `${terminal}_lead`;
  next.entities.push({ id: terminal, kind: "point", role: "terminal" }, { id: wire, kind: "connector", role: "terminal lead" });
  next.constructions.push(
    { id: `make_${terminal}`, operator: "point", inputs: { x: at[0], y: at[1], coordinateSpace: "layout" }, outputs: [terminal] },
    { id: `make_${wire}`, operator: "connect", inputs: { start: node, end: terminal }, outputs: [wire] },
  );
  next.requiredEntityIds?.push(terminal, wire);
  const reveal = group ? next.revealGroups.find((entry: Raw) => entry.id === group) : next.revealGroups[0];
  reveal.entityIds.push(terminal, wire);
  return next;
}

type Part = { id: string; symbol: string; start: string; end: string; role?: string };
/** A small circuit document: points on a grid, symbols, connectors and proofs. */
function circuit(question: string, points: Record<string, [number, number]>, parts: Part[], connectors: Array<[string, string, string]>, assertions: Raw[]): Raw {
  const ids = [...Object.keys(points), ...parts.map((part) => part.id), ...connectors.map(([id]) => id)];
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "physics validator class" },
    source: { question }, quantities: [], relations: [], annotations: [],
    entities: [
      ...Object.keys(points).map((id) => ({ id, kind: "point", role: "node" })),
      ...parts.map((part) => ({ id: part.id, kind: "component", role: part.role ?? part.symbol, label: part.id.toUpperCase() })),
      ...connectors.map(([id]) => ({ id, kind: "connector", role: "wire" })),
    ],
    constructions: [
      ...Object.entries(points).map(([id, [x, y]]) => ({ id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "layout" }, outputs: [id] })),
      ...parts.map((part) => ({ id: `make_${part.id}`, operator: "symbol", inputs: { symbol: part.symbol, start: part.start, end: part.end }, outputs: [part.id] })),
      ...connectors.map(([id, start, end]) => ({ id: `make_${id}`, operator: "connect", inputs: { start, end }, outputs: [id] })),
    ],
    assertions: assertions.map((assertion) => ({ expected: true, severity: "fatal", ...assertion })),
    requiredEntityIds: ids,
    revealGroups: [{ id: "circuit", entityIds: ids, dependsOn: [], narrationCue: "the circuit" }],
    teachingTimeline: [],
  };
}
function synthPlan(question: string, lawIds: string[], claims: Array<[string, string]> = []): TurnPlanV3 {
  return planFor({ question, plan: { lawIds, claims, assumptions: [] } });
}

// ---------- 1. Parallel proof: one branch pair, and a port ----------
{
  const mixed = fixtures.mixed_series_parallel!;
  const plan = planFor(mixed);
  check(plan.lawIds.includes("Series and parallel resistance rules"), "the PA plan asks for the parallel concept only through its law id");

  // (a) Real candidate as drawn: r1 from the free terminal p0 to p1, then r2
  // and r3 between p1 and the exit node p2. It proves the parallel concept
  // with its branch pair instead of needing all three resistors on one pair.
  const asDrawn = run(mixed.candidate, plan);
  check(passes(asDrawn), `1a the real mixed series-parallel network must prove the parallel concept (got ${asDrawn.fatal.map((issue) => `${issue.code}: ${issue.entityIds?.join(",")}`).join("; ") || "no render"})`);
  // A terminal lead at the exit node (the planner's own degree claim updated) changes nothing.
  const leadOut = withLead(mixed.candidate, "p2", "pOut", [7, 0]);
  leadOut.assertions = leadOut.assertions.map((assertion: Raw) =>
    assertion.id === "a2" ? { ...assertion, expected: 3 } : assertion);
  const leadOutResult = run(leadOut, plan);
  check(passes(leadOutResult), `1a the mixed network with an exit lead proves the parallel concept (got ${codes(leadOutResult.fatal)})`);

  // Negative (a): a pure series chain has no pair on a shared node pair.
  const chain = circuit("Resistors with a cell.", { a: [0, 0], b: [2, 0], c: [4, 0], d: [6, 0] },
    [{ id: "r1", symbol: "resistor", start: "a", end: "b" }, { id: "r2", symbol: "resistor", start: "b", end: "c" },
      { id: "r3", symbol: "resistor", start: "c", end: "d" }, { id: "e", symbol: "battery", start: "d", end: "a" }],
    [], [{ id: "chain", predicate: "path", entities: ["r1", "r2", "r3"] }]);
  const chainResult = run(chain, synthPlan("Resistors with a cell.", ["Series and parallel resistance rules"]));
  check(chainResult.fatal.some((issue) => issue.code === "turnplan_parallel_not_proven"), `1a negative: a pure series chain must not prove parallel (got ${codes(chainResult.fatal)})`);

  // (b) Real PC rings: two elements whose shared nodes join nothing else.
  const capacitorRing = fixtures.capacitor_ring!;
  const capacitorResult = run(capacitorRing.candidate, planFor(capacitorRing));
  check(capacitorResult.fatal.some((issue) => issue.code === "assertion_failed" && sameSet(issue.entityIds, ["left", "right"]) && /series loop/i.test(issue.message)),
    `1b the capacitor ring's pathCount 2 must fail as one series loop (got ${codes(capacitorResult.fatal)})`);
  const resistorRing = fixtures.resistor_ring!;
  const resistorResult = run(resistorRing.candidate, planFor(resistorRing));
  check(resistorResult.fatal.some((issue) => issue.code === "turnplan_parallel_not_proven" && /series loop/i.test(issue.message)),
    `1b the resistor ring must not prove "resistors connected in parallel" (got ${codes(resistorResult.fatal)})`);

  // Positive (b): the same rings with terminal leads have a port and are parallel.
  const capacitorLeads = withLead(withLead(capacitorRing.candidate, "left", "tA", [-2, 0]), "right", "tB", [6, 0]);
  const capacitorLeadsResult = run(capacitorLeads, planFor(capacitorRing));
  check(passes(capacitorLeadsResult), `1b capacitors with terminal leads must stay parallel (got ${codes(capacitorLeadsResult.fatal)})`);
  const resistorLeads = withLead(withLead(resistorRing.candidate, "lt", "tA", [-2, 1]), "rt", "tB", [6, 1]);
  const resistorLeadsResult = run(resistorLeads, planFor(resistorRing));
  check(passes(resistorLeadsResult), `1b resistors with terminal leads must prove parallel (got ${codes(resistorLeadsResult.fatal)})`);

  // Isolated LC loop: a series loop. sameTerminalPair fails, path proves it.
  const lcQuestion = "Explain LC oscillations.";
  const lcParts: Part[] = [{ id: "l", symbol: "inductor", start: "a", end: "b" }, { id: "c", symbol: "capacitor", start: "a", end: "b" }];
  const lcPair = run(circuit(lcQuestion, { a: [0, 0], b: [3, 0] }, lcParts, [], [{ id: "pair", predicate: "sameTerminalPair", entities: ["l", "c"] }]), synthPlan(lcQuestion, []));
  check(lcPair.fatal.some((issue) => issue.code === "assertion_failed" && /series loop/i.test(issue.message)), `1b an isolated LC loop must not prove sameTerminalPair (got ${codes(lcPair.fatal)})`);
  const lcPath = run(circuit(lcQuestion, { a: [0, 0], b: [3, 0] }, lcParts, [], [{ id: "loop", predicate: "path", entities: ["l", "c"] }]), synthPlan(lcQuestion, []));
  check(passes(lcPath), `1b an isolated LC loop proves path (got ${codes(lcPath.fatal)})`);

  // Positive (b): three elements on one pair already meet at three-way nodes,
  // and a source across a pair is its third connection.
  const three = run(circuit("Three resistors.", { a: [0, 0], b: [3, 0] },
    [{ id: "r1", symbol: "resistor", start: "a", end: "b" }, { id: "r2", symbol: "resistor", start: "a", end: "b" }, { id: "r3", symbol: "resistor", start: "a", end: "b" }],
    [], [{ id: "pair", predicate: "sameTerminalPair", entities: ["r1", "r2", "r3"] }]), synthPlan("Three resistors.", []));
  check(passes(three), `1b three elements on one node pair are parallel (got ${codes(three.fatal)})`);
  const sourced = run(circuit("Two resistors across a cell.", { a: [0, 0], b: [3, 0] },
    [{ id: "r1", symbol: "resistor", start: "a", end: "b" }, { id: "r2", symbol: "resistor", start: "a", end: "b" }, { id: "e", symbol: "battery", start: "a", end: "b" }],
    [], [{ id: "pair", predicate: "sameTerminalPair", entities: ["r1", "r2"] }]), synthPlan("Two resistors across a cell.", ["parallel resistance"]));
  check(passes(sourced), `1b a source across the pair is the third connection (got ${codes(sourced.fatal)})`);

  // Engine-built banks of two with no source would be the same bare ring:
  // they draw their port as terminal leads and keep their own proof.
  for (const question of [
    "Two resistors of 4 ohm and 6 ohm are connected in parallel. Find the equivalent resistance.",
    "Explain capacitors connected in parallel.",
    "Two resistors 2 ohm and 3 ohm are first connected in series and then in parallel. Find the equivalent resistance in each case.",
  ]) {
    const scene = synthesizeFamilyScene({ question });
    const terminals = scene?.document.entities.filter((entity) => entity.role === "terminal").map((entity) => entity.id) ?? [];
    const leads = scene?.document.constructions.filter((construction) => construction.operator === "connect" &&
      terminals.some((id) => construction.inputs.start === id || construction.inputs.end === id)) ?? [];
    check(scene && leads.length === 2, `1b the engine's unsourced pair for "${question}" draws with two terminal leads (got ${scene ? `${leads.length} leads` : "no scene"})`);
  }
}

// ---------- 2. opposite_direction compares page-normal sense ----------
{
  const torque = fixtures.torque_loop!;
  const plan = planFor(torque);
  const failsOpposite = (result: ReturnType<typeof run>) => result.fatal.some((issue) => issue.code === "assertion_failed" && issue.entityIds?.includes("leftForce"));
  const real = run(torque.candidate, plan);
  check(!failsOpposite(real), `2 forces out of and into the page on opposite sides of the loop are opposite (got ${codes(real.fatal)})`);
  // A separate class still blocks this candidate: a current sense mark on the
  // closed loop polygon has no open edge to follow. Without that mark it draws.
  check(real.fatal.every((issue) => issue.code === "annotation_geometry_unresolved" && issue.entityIds?.includes("currentSense")),
    `2 the real candidate's only remaining failure is its sense mark on a closed polygon (got ${codes(real.fatal)})`);
  const unmarked = structuredClone(torque.candidate);
  unmarked.annotations = unmarked.annotations.filter((annotation: Raw) => annotation.id !== "currentSense");
  const unmarkedResult = run(unmarked, plan);
  check(passes(unmarkedResult), `2 the torque loop with opposite page-normal forces compiles (got ${codes(unmarkedResult.fatal)})`);
  const withForces = (left: number[], right: number[]) => {
    const next = structuredClone(torque.candidate);
    for (const construction of next.constructions) {
      if (construction.id === "makeLeftForce") construction.inputs.direction = left;
      if (construction.id === "makeRightForce") construction.inputs.direction = right;
    }
    return run(next, plan);
  };
  check(failsOpposite(withForces([0, 0, 1], [0, 0, 1])), "2 negative: two out-of-page forces are not opposite");
  check(failsOpposite(withForces([0, 0, -1], [0, 0, -1])), "2 negative: two into-page forces are not opposite");
  check(failsOpposite(withForces([0, 0, 1], [1, 0])), "2 negative: a page-normal force is perpendicular to an in-plane one, never opposite");
  check(!failsOpposite(withForces([-1, 0], [1, 0])), "2 control: in-plane antiparallel forces stay opposite");
  check(failsOpposite(withForces([1, 0], [1, 0])), "2 control: in-plane parallel forces stay not opposite");
  const glyphs = (first: string, second: string) => {
    const next = structuredClone(torque.candidate);
    for (const construction of next.constructions) {
      if (construction.id === "makeLeftForce") Object.assign(construction, { operator: "label", inputs: { target: "leftMid", text: first } });
      if (construction.id === "makeRightForce") Object.assign(construction, { operator: "label", inputs: { target: "rightMid", text: second } });
    }
    return run(next, plan);
  };
  check(!failsOpposite(glyphs("⊙", "⊗")), "2 dot and cross glyph labels are opposite");
  check(failsOpposite(glyphs("⊗", "⊗")), "2 negative: two cross glyph labels are not opposite");
}

// ---------- 3. Closure is demanded only with a load, a meter or a claimed current ----------
{
  const cells = fixtures.cell_combinations!;
  const plan = planFor(cells);
  const closure = (result: ReturnType<typeof run>) => result.fatal.filter((issue) => issue.code === "source_loop_not_closed");

  // The real candidate: the unloaded series chain sc1, sc2 has free terminals.
  const real = run(cells.candidate, plan);
  check(closure(real).length === 0, `3 an unloaded series chain of cells is a two-terminal source (got ${codes(closure(real))})`);
  // Its parallel half is a bare ring of two cells; class 1 asks for its terminal leads.
  check(real.fatal.every((issue) => issue.code === "assertion_failed" && sameSet(issue.entityIds, ["pn", "pp"])),
    `3 the real candidate's only remaining failure is its parallel pair without terminals (got ${codes(real.fatal)})`);
  const leads = withLead(withLead(cells.candidate, "pn", "pA", [-1, -3], "parallel"), "pp", "pB", [6, -3], "parallel");
  const leadsResult = run(leads, plan);
  check(passes(leadsResult), `3 series cells with free terminals and parallel cells with terminal leads are a valid figure (got ${codes(leadsResult.fatal)})`);

  // Negatives: a load, a meter or a claimed current still demands every cell closes a loop.
  const seriesOnly = (extra: Part[], points: Record<string, [number, number]> = {}) => circuit(cells.question,
    { s0: [0, 0], s1: [2, 0], s2: [4, 0], ...points },
    [{ id: "sc1", symbol: "cell", start: "s0", end: "s1" }, { id: "sc2", symbol: "cell", start: "s1", end: "s2" }, ...extra],
    [], [{ id: "series", predicate: "path", entities: ["sc1", "sc2", ...extra.map((part) => part.id)] }]);
  const bare = run(seriesOnly([]), plan);
  check(closure(bare).length === 0 && passes(bare), `3 two cells end to end with free terminals are valid (got ${codes(bare.fatal)})`);
  const loaded = run(seriesOnly([{ id: "r", symbol: "resistor", start: "s2", end: "s3" }], { s3: [6, 0] }), plan);
  check(closure(loaded).length > 0, `3 negative: an open loop with a resistor load stays invalid (got ${codes(loaded.fatal)})`);
  const metered = run(seriesOnly([{ id: "v", symbol: "voltmeter", start: "s2", end: "s3" }], { s3: [6, 0] }), plan);
  check(closure(metered).length > 0, `3 negative: an open loop with a meter stays invalid (got ${codes(metered.fatal)})`);
  // Each load channel on its own: a load symbol whose role names no load, and
  // a lamp drawn as a shape rather than a symbol.
  const unnamed = run(seriesOnly([{ id: "x", symbol: "resistor", start: "s2", end: "s3", role: "element" }], { s3: [6, 0] }), plan);
  check(closure(unnamed).length > 0, `3 negative: a load symbol with an unnamed role stays invalid (got ${codes(unnamed.fatal)})`);
  const drawnLamp = seriesOnly([], { s3: [6, 0] });
  drawnLamp.entities.push({ id: "bulb", kind: "circle", role: "bulb", label: "lamp" });
  drawnLamp.constructions.push({ id: "make_bulb", operator: "circle", inputs: { center: "s3", radius: 0.5 }, outputs: ["bulb"] });
  drawnLamp.requiredEntityIds.push("bulb");
  drawnLamp.revealGroups[0].entityIds.push("bulb");
  const drawnLampResult = run(drawnLamp, plan);
  check(closure(drawnLampResult).length > 0, `3 negative: a lamp drawn as a shape beside open cells stays invalid (got ${codes(drawnLampResult.fatal)})`);
  const currentPlan = planFor(cells, { claims: [["c3", "The same current flows through each cell."]] });
  currentPlan.qualitativeClaims[2]!.claim = "same current through each cell";
  const claimed = run(seriesOnly([]), currentPlan);
  check(closure(claimed).length > 0, `3 negative: a claimed current needs a closed loop (got ${codes(claimed.fatal)})`);
}

if (failures.length > 0) {
  console.error(`physics validator classes: ${failures.length} of ${checks} checks failed`);
  for (const failure of failures) console.error(`  FAIL ${failure}`);
  process.exit(1);
}
console.log(`physics validator classes verified (${checks} checks)`);
