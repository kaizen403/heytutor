/** Free, independently authored controls for the default-off visual policy. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  validateProblemIR, validateTurnPlanV3,
  type ProblemIR, type TurnPlanV3, type VisualRequirement,
} from "@heytutor/scene-engine";
import * as planner from "../../src/planners/turnPlannerV3";

interface PolicyOptions { visualDecisionEnabled?: boolean }
interface DecisionInput extends PolicyOptions {
  question: string;
  selectedPlan: TurnPlanV3;
  visualNeedRequirement: VisualRequirement | null;
  problemIR?: ProblemIR | null;
  peerTurnPlans?: readonly TurnPlanV3[];
  hasSourceProgram?: boolean;
}
interface VisualApi {
  isVisualDecisionEnabled(options?: PolicyOptions): boolean;
  resolveVisualDecision(input: DecisionInput): { requirement: VisualRequirement; reason: string };
  SCENE_VISUAL_DECISION_ENABLED: boolean;
  SCENE_VISUAL_DECISION_POLICY: string;
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right); }

const enforcement = "A verified illustration is required by the question's spatial or explicit visual request.";
const fallbackAssumption = "Turn-plan model was unavailable; visual requirement was classified conservatively.";
const scalarQuestion = "Find the sum of 2 and 3.";
const scalarPlan: TurnPlanV3 = freezeDeep({
  schemaVersion: "turn-plan/v3", question: scalarQuestion,
  givens: [
    { id: "left", symbol: "p", value: 2, unit: "1", provenance: "given", sourceText: "p = 2" },
    { id: "right", symbol: "q", value: 3, unit: "1", provenance: "given", sourceText: "q = 3" },
  ],
  unknowns: [{ id: "answer", symbol: "S", unit: "1" }],
  derived: [{ id: "answer", symbol: "S", value: 5, unit: "1", provenance: "derived",
    dependsOn: ["left", "right"], sourceText: "S = 2 + 3 = 5" }],
  qualitativeClaims: [{ id: "sum", claim: "addition_result", expected: 5, relatedQuantityIds: ["answer"] }],
  lawIds: ["addition"], assumptions: [], visualRequirement: "none",
});

function conceptPlan(question: string, requirement: VisualRequirement = "none"): TurnPlanV3 {
  return { schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [], derived: [],
    qualitativeClaims: [{ id: "relation", claim: "source_relation", expected: true }],
    lawIds: [], assumptions: [], visualRequirement: requirement };
}
function withRequirement(plan: TurnPlanV3, visualRequirement: VisualRequirement): TurnPlanV3 {
  return { ...structuredClone(plan), visualRequirement };
}
function parse(raw: unknown, question: string, options?: PolicyOptions): TurnPlanV3 | null {
  return Reflect.apply(planner.parseTurnPlanV3Content, undefined, [JSON.stringify(raw), question, undefined, options]);
}
function minimum(question: string, options?: PolicyOptions): boolean {
  return Reflect.apply(planner.questionRequiresVisual, undefined, [question, options]);
}
function fallback(question: string, options?: PolicyOptions): TurnPlanV3 {
  return Reflect.apply(planner.createFallbackTurnPlanV3, undefined, [question, options]);
}

// Authored C07 causal controls: new mass and answer, same two audited cues.
const chemistryWordings = freezeDeep([
  "15 g of calcium carbonate decomposes completely: CaCO3 -> CaO + CO2. Use molar masses 100 g/mol and 44 g/mol. Find the mass of CO2.",
  "15 g of calcium carbonate decomposes completely: CaCO3 -> CaO + CO2. Use relative formula masses 100 g/mol and 44 g/mol. Find the mass of CO2.",
]);
function chemistryPlan(question: string, visualRequirement: VisualRequirement): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3", question,
    givens: [
      { id: "mass", symbol: "m", value: 15, unit: "g", provenance: "given", sourceText: "15 g of calcium carbonate" },
      { id: "reactant_molar_mass", symbol: "M1", value: 100, unit: "g/mol", provenance: "given", sourceText: "100 g/mol" },
      { id: "product_molar_mass", symbol: "M2", value: 44, unit: "g/mol", provenance: "given", sourceText: "44 g/mol" },
    ],
    unknowns: [{ id: "co2_mass", symbol: "m_CO2", unit: "g" }],
    derived: [{ id: "co2_mass", symbol: "m_CO2", value: 6.6, unit: "g", provenance: "derived",
      dependsOn: ["mass", "reactant_molar_mass", "product_molar_mass"], sourceText: "m_CO2 = 15 / 100 * 44 = 6.6 g" }],
    qualitativeClaims: [], lawIds: ["stoichiometry"], assumptions: [], visualRequirement,
  };
}

const graphQuestion = "For t in [0, 2], the trajectory q(t)=t^2 passes through O=(0,0). Describe how q changes.";
function fact(id: string, quote: string, question: string, kind: "given" | "requested" | "assumption" = "given") {
  const start = question.indexOf(quote);
  return { id, kind, statement: quote, evidence: { source: "question" as const, start, end: start + quote.length, quote } };
}
export const graphProblemIR: ProblemIR = freezeDeep({
  schemaVersion: "problem-ir/v1", id: "trajectory", question: graphQuestion,
  facts: [fact("function_fact", "q(t)=t^2", graphQuestion), fact("point_fact", "O=(0,0)", graphQuestion), fact("relation_fact", "passes through", graphQuestion)],
  entities: [
    { id: "path", kind: "curve", label: "q", evidenceFactIds: ["function_fact"] },
    { id: "anchor", kind: "point", label: "O", evidenceFactIds: ["point_fact"] },
  ],
  expressions: [{ id: "function", valueType: "function", root: { kind: "binary", operator: "^", left: { kind: "variable", name: "t" }, right: { kind: "number", value: 2 } }, evidenceFactIds: ["function_fact"] }],
  constraints: [{ id: "passes_through", kind: "incident", entityIds: ["path", "anchor"], evidenceFactIds: ["relation_fact"] }],
  representationIntents: [{ id: "show_relation", kind: "graph", entityIds: ["path", "anchor"], evidenceFactIds: ["function_fact", "point_fact", "relation_fact"] }],
  solveRequests: [],
});
function editIR(edit: (ir: ProblemIR) => void): ProblemIR {
  const ir = structuredClone(graphProblemIR); edit(ir); return ir;
}
const renamedIR = editIR((ir) => {
  ir.question = "For z in [0, 2], r(z)=z^3 passes through H=(0,0). Describe how r changes.";
  ir.facts = [fact("function_fact", "r(z)=z^3", ir.question), fact("point_fact", "H=(0,0)", ir.question), fact("relation_fact", "passes through", ir.question)];
  ir.entities[0]!.id = "entity_beta"; ir.entities[0]!.label = "opaque_label";
  ir.entities[1]!.id = "anchor_7"; ir.entities[1]!.label = "arbitrary_anchor";
  ir.expressions[0]!.root = { kind: "binary", operator: "^", left: { kind: "variable", name: "z" }, right: { kind: "number", value: 3 } };
  ir.constraints = [{ id: "other_relation", kind: "incident", entityIds: ["entity_beta", "anchor_7"], evidenceFactIds: ["relation_fact"] }];
  ir.representationIntents[0]!.entityIds = ["entity_beta", "anchor_7"];
});
const networkQuestion = "Terminal A is connected to terminal B. Explain the relation.";
const networkIR: ProblemIR = {
  schemaVersion: "problem-ir/v1", id: "terminals", question: networkQuestion,
  facts: [fact("connection_fact", "Terminal A is connected to terminal B", networkQuestion)],
  entities: [{ id: "first", kind: "component", evidenceFactIds: ["connection_fact"] }, { id: "second", kind: "component", evidenceFactIds: ["connection_fact"] }],
  expressions: [], constraints: [{ id: "connected_pair", kind: "connected", entityIds: ["first", "second"], evidenceFactIds: ["connection_fact"] }],
  representationIntents: [{ id: "topology", kind: "network", entityIds: ["first", "second"], evidenceFactIds: ["connection_fact"] }], solveRequests: [],
};

export const visualDecisionFixtures = freezeDeep([
  { id: "source-graph", ir: graphProblemIR, valid: true, requirement: "optional" },
  { id: "renamed-structure", ir: renamedIR, valid: true, requirement: "optional" },
  { id: "typed-connected-pair", ir: networkIR, valid: true, requirement: "optional" },
  { id: "bare-entity", ir: editIR((ir) => { ir.expressions = []; ir.constraints = []; }), valid: true, requirement: "none" },
  { id: "scalar-only", ir: editIR((ir) => { ir.expressions[0]!.valueType = "scalar"; ir.expressions[0]!.root = { kind: "number", value: 2 }; ir.constraints = []; }), valid: true, requirement: "none" },
  { id: "conceptual-only", ir: editIR((ir) => { ir.representationIntents[0]!.kind = "conceptual"; }), valid: true, requirement: "none" },
  { id: "assumption-only", ir: editIR((ir) => { ir.facts.forEach((entry) => { entry.kind = "assumption"; }); }), valid: true, requirement: "none" },
  { id: "assumption-backed-entity", ir: editIR((ir) => { ir.facts[1]!.kind = "assumption"; }), valid: true, requirement: "none" },
  { id: "missing-entity-reference", ir: editIR((ir) => { ir.representationIntents[0]!.entityIds = ["missing_entity"]; }), valid: false, requirement: "none" },
  { id: "ungrounded-quote", ir: editIR((ir) => { ir.facts[0]!.evidence.quote = "this text is absent from the source"; }), valid: false, requirement: "none" },
  { id: "missing-fact-reference", ir: editIR((ir) => { ir.entities[0]!.evidenceFactIds = ["missing_fact"]; }), valid: false, requirement: "none" },
]);

const failures: string[] = [];
let checks = 0;
function check(condition: boolean, name: string, detail: string): void {
  checks += 1; if (!condition) failures.push(`${name}: ${detail}`);
}
function test(name: string, run: () => void): void {
  try { run(); } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

// Frozen complete request-body byte fingerprints captured before source edits.
const legacyRequestHashes = freezeDeep([
  "209ba5bfa2dff1edde1690ccb7aa854d80cdeec4582236ed7abd13e3965f4f71",
  "6dbf31226eb95a7bce90d48b81d4f85d520fcffebc900ce329579753750948cb",
]);
let visual: VisualApi | null = null;
const visualModulePath = "../../src/planners/visualDecision";
try { visual = await import(visualModulePath); }
catch { check(false, "public-visual-decision", "agreed public visualDecision module is not implemented"); }

for (const [index, question] of chemistryWordings.entries()) {
  for (const requirement of ["none", "optional", "required"] as const) {
    const raw = freezeDeep(chemistryPlan(question, requirement));
    const legacy = index === 0 && requirement !== "required"
      ? { ...raw, visualRequirement: "required", assumptions: [enforcement] } : raw;
    for (const options of [undefined, { visualDecisionEnabled: false }] as const) {
      test(`chemistry-${index}-${requirement}/off`, () => {
        check(same(parse(raw, question, options), legacy), `chemistry-${index}-${requirement}/off`, "full legacy parsed plan changed");
      });
    }
    test(`chemistry-${index}-${requirement}/on`, () => {
      const parsed = parse(raw, question, { visualDecisionEnabled: true });
      check(same(parsed, raw), `chemistry-${index}-${requirement}/on`, "family-only enforcement changed model requirement or numeric authority");
    });
  }
  for (const invalid of [undefined, "unknown", { description: "model asks for an illustration" }]) {
    const raw = { ...chemistryPlan(question, "none"), visualRequirement: invalid };
    const isModelObject = typeof invalid === "object" && invalid !== null;
    const expectedOff = { ...raw, visualRequirement: isModelObject || index === 0 ? "required" : "optional" };
    check(same(parse(raw, question, { visualDecisionEnabled: false }), expectedOff), `normalization-${index}-${String(invalid)}/off`, "full legacy enum normalization changed");
    const expectedOn = { ...raw, visualRequirement: isModelObject ? "required" : "optional" };
    check(same(parse(raw, question, { visualDecisionEnabled: true }), expectedOn), `normalization-${index}-${String(invalid)}/on`, "family-only invalid enum became required or model requirement was lost");
  }
  const legacyFallback = { ...conceptPlan(question, index === 0 ? "required" : "optional"), qualitativeClaims: [], assumptions: [fallbackAssumption] };
  check(same(fallback(question, { visualDecisionEnabled: false }), legacyFallback), `fallback-${index}/off`, "full fallback plan differs from legacy");
  check(same(fallback(question, { visualDecisionEnabled: true }), { ...legacyFallback, visualRequirement: "optional" }), `fallback-${index}/on`, "family alone forced required fallback");
  check(minimum(question, { visualDecisionEnabled: false }) === (index === 0), `minimum-${index}/off`, "legacy minimum changed");
  check(!minimum(question, { visualDecisionEnabled: true }), `minimum-${index}/on`, "scalar chemistry family supplied a minimum");
}

for (const question of ["Draw an unsupported abstract illustration.", "As shown in the figure, find the answer.", "Find the image formed by a convex lens."]) {
  const raw = freezeDeep(conceptPlan(question));
  const expected = { ...raw, visualRequirement: "required", assumptions: [enforcement] };
  check(minimum(question, { visualDecisionEnabled: true }), "explicit-reference-spatial/minimum", "explicit/reference/spatial requirement was lost");
  check(same(parse(raw, question, { visualDecisionEnabled: true }), expected), "explicit-reference-spatial/parser", "required authority was not preserved");
}

for (const fixture of visualDecisionFixtures) {
  const validation = validateProblemIR(fixture.ir, fixture.ir.question);
  check(validation.valid === fixture.valid, `${fixture.id}/fixture`, `authored IR validity differs: ${JSON.stringify(validation.issues)}`);
  if (visual) test(`${fixture.id}/decision`, () => {
    const selectedPlan = freezeDeep(conceptPlan(fixture.ir.question));
    const before = JSON.stringify(selectedPlan);
    const decision = visual!.resolveVisualDecision({ question: fixture.ir.question, selectedPlan,
      visualNeedRequirement: null, problemIR: fixture.ir, visualDecisionEnabled: true });
    check(decision.requirement === fixture.requirement, `${fixture.id}/decision`, `expected ${fixture.requirement}, got ${decision.requirement}`);
    check(JSON.stringify(selectedPlan) === before, `${fixture.id}/authority`, "typed evidence mutated selected authority");
  });
}

function peerVariant(edit: (plan: TurnPlanV3) => void): TurnPlanV3 {
  const plan = withRequirement(scalarPlan, "optional"); edit(plan); return plan;
}
const peers = freezeDeep([
  { id: "full-equivalent", plan: withRequirement(scalarPlan, "optional"), valid: true, expected: "optional" },
  { id: "different-enforcement-string-assumption", plan: peerVariant((plan) => { plan.assumptions = [enforcement]; }), valid: true, expected: "none" },
  { id: "equivalent-required", plan: withRequirement(scalarPlan, "required"), valid: true, expected: "optional" },
  { id: "peer-none", plan: withRequirement(scalarPlan, "none"), valid: true, expected: "none" },
  { id: "different-given", plan: peerVariant((plan) => { plan.givens[0]!.value = 4; }), valid: true, expected: "none" },
  { id: "different-unknown", plan: peerVariant((plan) => { plan.unknowns[0]!.unit = "m"; }), valid: true, expected: "none" },
  { id: "different-derived-authority", plan: peerVariant((plan) => { plan.derived.push({ id: "other", symbol: "T", value: 8, unit: "1", provenance: "derived" }); }), valid: true, expected: "none" },
  { id: "different-claim", plan: peerVariant((plan) => { plan.qualitativeClaims[0]!.claim = "a_distinct_proposition"; }), valid: true, expected: "none" },
  { id: "different-claim-value", plan: peerVariant((plan) => { plan.qualitativeClaims[0]!.expected = false; }), valid: true, expected: "none" },
  { id: "different-assumption", plan: peerVariant((plan) => { plan.assumptions = ["unproved extra premise"]; }), valid: true, expected: "none" },
  { id: "different-law-authority", plan: peerVariant((plan) => { plan.lawIds = ["a_distinct_law"]; }), valid: true, expected: "none" },
  { id: "invalid-claim-reference", plan: peerVariant((plan) => { plan.qualitativeClaims[0]!.relatedQuantityIds = ["missing"]; }), valid: false, expected: "none" },
  { id: "invalid-numeric", plan: peerVariant((plan) => { plan.derived[0]!.value = Number.NaN; }), valid: false, expected: "none" },
  { id: "invalid-question", plan: peerVariant((plan) => { plan.question = "A different source question."; }), valid: false, expected: "none" },
]);
for (const peer of peers) {
  check(validateTurnPlanV3(peer.plan, scalarQuestion).valid === peer.valid, `${peer.id}/fixture`, "peer admission fixture differs");
  if (visual) test(peer.id, () => {
    const before = JSON.stringify(scalarPlan);
    const decision = visual!.resolveVisualDecision({ question: scalarQuestion, selectedPlan: scalarPlan,
      visualNeedRequirement: null, peerTurnPlans: [peer.plan], visualDecisionEnabled: true });
    check(decision.requirement === peer.expected, `${peer.id}/vote`, `expected ${peer.expected}, got ${decision.requirement}`);
    check(JSON.stringify(scalarPlan) === before, `${peer.id}/authority`, "peer replaced selected numeric authority");
  });
}

const conceptualAuthority = freezeDeep(conceptPlan("Explain a relation."));
for (const expected of [true, false]) {
  const peer = withRequirement(conceptualAuthority, "optional");
  peer.qualitativeClaims[0]!.expected = expected;
  freezeDeep(peer);
  check(validateTurnPlanV3(peer, conceptualAuthority.question).valid, "zero-unknown-peer/fixture", "authored conceptual peer is invalid");
  if (visual) {
    const result = visual.resolveVisualDecision({ question: conceptualAuthority.question,
      selectedPlan: conceptualAuthority, peerTurnPlans: [peer], visualNeedRequirement: null, visualDecisionEnabled: true });
    check(result.requirement === (expected ? "optional" : "none"), "zero-unknown-peer/full-claim-authority", "empty numeric fingerprints hid conflicting conceptual claims");
  }
}

if (visual) {
  const api = visual;
  const reasonCodes = ["required", "evaluated", "source_program", "compatible_peer", "source_structure", "planned"];
  for (const fixture of [
    { planned: "none", jev: null, source: false, expected: "none" },
    { planned: "none", jev: null, source: true, expected: "optional" },
    { planned: "none", jev: "none", source: true, expected: "none" },
    { planned: "none", jev: "optional", source: false, expected: "optional" },
    { planned: "none", jev: "required", source: false, expected: "required" },
    { planned: "optional", jev: "none", source: false, expected: "none" },
    { planned: "required", jev: "none", source: false, expected: "required" },
  ] satisfies Array<{ planned: VisualRequirement; jev: VisualRequirement | null; source: boolean; expected: VisualRequirement }>) {
    const selectedPlan = freezeDeep(withRequirement(scalarPlan, fixture.planned));
    const before = JSON.stringify(selectedPlan);
    const result = api.resolveVisualDecision({ question: scalarQuestion, selectedPlan,
      visualNeedRequirement: fixture.jev, hasSourceProgram: fixture.source,
      peerTurnPlans: [withRequirement(selectedPlan, "optional")], problemIR: graphProblemIR,
      visualDecisionEnabled: false });
    check(result.requirement === fixture.expected, "off-resolver/legacy-merger", `expected ${fixture.expected}, got ${result.requirement}`);
    check(JSON.stringify(selectedPlan) === before, "off-resolver/full-authority", "off resolver mutated full selected plan");
  }
  const decisions = freezeDeep([
    { id: "no-evidence", planned: "none", jev: null, expected: "none" },
    { id: "jev-veto-peer", planned: "none", jev: "none", peer: true, expected: "none" },
    { id: "jev-veto-ir", planned: "none", jev: "none", ir: true, expected: "none" },
    { id: "jev-required", planned: "none", jev: "required", expected: "required" },
    { id: "jev-optional", planned: "none", jev: "optional", expected: "optional" },
    { id: "required-wins", planned: "required", jev: "none", expected: "required" },
    { id: "optional-veto", planned: "optional", jev: "none", expected: "none" },
    { id: "optional-unavailable", planned: "optional", jev: null, expected: "optional" },
    { id: "matrix-source", planned: "none", jev: null, source: true, expected: "optional" },
    { id: "matrix-source-veto", planned: "none", jev: "none", source: true, expected: "none" },
  ] satisfies Array<{ id: string; planned: VisualRequirement; jev: VisualRequirement | null; expected: VisualRequirement; peer?: boolean; ir?: boolean; source?: boolean }>);
  for (const fixture of decisions) test(fixture.id, () => {
    const plan = freezeDeep(conceptPlan(graphQuestion, fixture.planned));
    const input: DecisionInput = { question: graphQuestion, selectedPlan: plan, visualNeedRequirement: fixture.jev,
      ...(fixture.peer ? { peerTurnPlans: [withRequirement(plan, "optional")] } : {}),
      ...(fixture.ir ? { problemIR: graphProblemIR } : {}), hasSourceProgram: fixture.source, visualDecisionEnabled: true };
    const result = api.resolveVisualDecision(input);
    check(result.requirement === fixture.expected, `${fixture.id}/requirement`, `expected ${fixture.expected}, got ${result.requirement}`);
    check(reasonCodes.includes(result.reason), `${fixture.id}/reason`, `unbounded reason ${result.reason}`);
  });
  for (const question of chemistryWordings) {
    const persisted = freezeDeep({ ...chemistryPlan(question, "required"), assumptions: [enforcement] });
    const before = JSON.stringify(persisted);
    check(api.resolveVisualDecision({ question, selectedPlan: persisted, visualNeedRequirement: "none", visualDecisionEnabled: true }).requirement === "required", "persisted-required", "persisted Continue authority was demoted");
    check(JSON.stringify(persisted) === before, "persisted-required/full-authority", "persisted authority mutated");
  }
  for (const question of [
    "Explain how to find both roots of w = a + bi using real equations.",
    "Give everyday examples of derivatives as rates of change.",
    "Does continuity alone ensure a finite derivative at each input?",
    "Teach differentiation when two variables are related by an equation.",
  ]) {
    check(api.resolveVisualDecision({ question, selectedPlan: freezeDeep(conceptPlan(question)), visualNeedRequirement: null, visualDecisionEnabled: true }).requirement === "none", "authored-evidence-gap", "missing peer/IR evidence was invented");
  }
  check(api.SCENE_VISUAL_DECISION_POLICY === "scene-visual-decision/v1", "policy-version", "policy identity missing or changed");
  check(api.isVisualDecisionEnabled({ visualDecisionEnabled: true }), "inject-on", "injected true was ignored");
  check(!api.isVisualDecisionEnabled({ visualDecisionEnabled: false }), "inject-off", "injected false was ignored");
  // These local subprocesses exercise module initialization, not a cached
  // imported constant. They make no HTTP or provider requests.
  for (const value of [undefined, "0", "false", "true", "01", " 1", "1 ", "1"]) test(`flag-${String(value)}`, () => {
    const environment = { ...process.env }; delete environment.NEXT_PUBLIC_SCENE_VISUAL_DECISION;
    if (value !== undefined) environment.NEXT_PUBLIC_SCENE_VISUAL_DECISION = value;
    const moduleUrl = new URL("../../src/planners/visualDecision.ts", import.meta.url).href;
    const code = `const m=await import(${JSON.stringify(moduleUrl)});process.stdout.write(JSON.stringify({constant:m.SCENE_VISUAL_DECISION_ENABLED,helper:m.isVisualDecisionEnabled()}));`;
    const result = JSON.parse(execFileSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "-e", code], { env: environment, encoding: "utf8" }));
    check(result.constant === (value === "1") && result.helper === (value === "1"), `flag-${String(value)}`, "rollout was not exact-1 default-off");
  });
}

class MockClock {
  now = 0;
  private nextId = 1;
  private timers = new Map<number, { at: number; run: () => void }>();
  private realNow = Date.now;
  private realSet = globalThis.setTimeout;
  private realClear = globalThis.clearTimeout;
  install(): void {
    Date.now = () => this.now;
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay = 0, ...args: unknown[]) => {
      const id = this.nextId++; this.timers.set(id, { at: this.now + delay, run: () => callback(...args) }); return id;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout>) => { this.timers.delete(Number(id)); }) as typeof clearTimeout;
  }
  async flush(): Promise<void> { for (let index = 0; index < 30; index += 1) await Promise.resolve(); }
  async advance(ms: number): Promise<void> {
    const target = this.now + ms;
    for (;;) {
      const next = [...this.timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      this.now = next[1].at; this.timers.delete(next[0]); next[1].run(); await this.flush();
    }
    this.now = target; await this.flush();
  }
  restore(): void { Date.now = this.realNow; globalThis.setTimeout = this.realSet; globalThis.clearTimeout = this.realClear; }
}

async function laneRun(enabled: boolean | undefined, peerDelay: number, peerKind: "valid" | "invalid" | "cancelled" | "conflicting" = "valid") {
  const clock = new MockClock(); const realFetch = globalThis.fetch;
  const requests: Array<{ lane: string; body: string; deadline: string | null }> = [];
  const aborts: Array<{ lane: string; at: number }> = [];
  clock.install();
  globalThis.fetch = async (_url, init) => {
    const headers = new Headers(init?.headers); const lane = headers.get("x-turn-planner-lane") ?? "";
    requests.push({ lane, body: String(init?.body ?? ""), deadline: headers.get("x-planner-deadline-ms") });
    const contradictoryPeer = peerVariant((plan) => {
      plan.givens[0]!.value = 4; plan.givens[0]!.sourceText = "p = 4";
      plan.derived[0]!.value = 7; plan.derived[0]!.sourceText = "S = 4 + 3 = 7";
      plan.qualitativeClaims[0]!.expected = 7;
    });
    const content = lane === "primary" ? JSON.stringify(scalarPlan)
      : peerKind === "invalid" ? "not a JSON plan"
      : JSON.stringify(peerKind === "conflicting" ? contradictoryPeer : withRequirement(scalarPlan, "optional"));
    const response = () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    if (lane === "primary") return response();
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => peerKind === "cancelled" ? reject(new DOMException("Peer cancelled", "AbortError")) : resolve(response()), peerDelay);
      init?.signal?.addEventListener("abort", () => { aborts.push({ lane, at: clock.now }); clearTimeout(timer); reject(new DOMException("Peer cancelled", "AbortError")); }, { once: true });
    });
  };
  try {
    const pending = planner.planTurnV3(scalarQuestion, { proxyUrl: "http://visual-policy.test", timeoutMs: 9000,
      ...(enabled === undefined ? {} : { visualDecisionEnabled: enabled }) });
    let settled = false; let returned: Awaited<typeof pending> = null;
    void pending.then((value) => { settled = true; returned = value; });
    await clock.flush();
    if (peerDelay >= 3000) {
      await clock.advance(2999);
      check(!settled, `grace-${String(enabled)}-${peerKind}`, "peer grace ended before three seconds");
      await clock.advance(1);
      check(settled, `grace-${String(enabled)}-${peerKind}`, "peer grace extended beyond three seconds");
    } else await clock.advance(peerDelay);
    const response = await pending;
    check(response === returned, "mock-clock-return", "mock clock did not observe the actual public response");
    return { response, requests, aborts, finishedAt: clock.now };
  } finally { globalThis.fetch = realFetch; clock.restore(); }
}

for (const enabled of [undefined, false, true]) {
  for (const [delay, kind] of [[0, "valid"], [2999, "valid"], [3001, "valid"], [100, "invalid"], [100, "cancelled"], [100, "conflicting"]] as const) {
    try {
      const run = await laneRun(enabled, delay, kind);
      const name = `lanes-${String(enabled)}-${delay}-${kind}`;
      check(run.requests.length === 2, `${name}/calls`, `expected two existing calls, got ${run.requests.length}`);
      check(run.requests.map((request) => request.lane).join(",") === "primary,alternate", `${name}/order`, "lane request order changed");
      check(run.requests.every((request) => request.deadline === "9000"), `${name}/deadline`, "deadline changed or extended");
      if (process.argv.includes("--baseline")) console.log(JSON.stringify({ name, requestHashes: run.requests.map((request) => hash(request.body)), selectedPlan: run.response?.turnPlan, finishedAt: run.finishedAt, aborts: run.aborts }));
      check(same(run.requests.map((request) => hash(request.body)), legacyRequestHashes), `${name}/request-bytes`, "complete request body bytes differ from frozen legacy");
      const acceptedPeer = delay < 3000 && (kind === "valid" || kind === "conflicting");
      const compatiblePeer = acceptedPeer && kind === "valid";
      const expectedPlan = enabled === true && compatiblePeer ? withRequirement(scalarPlan, "optional") : scalarPlan;
      check(same(run.response?.turnPlan, expectedPlan), `${name}/selected-authority`, "selected authority changed beyond the permitted visual enum");
      check(run.response?.peerTurnPlans?.length === (acceptedPeer ? 1 : 0), `${name}/completed-peers`, "invalid/cancelled/late peer was retained or timely peer lost");
      if (delay > 3000) check(same(run.aborts, [{ lane: "alternate", at: 3000 }]), `${name}/abort`, "late peer not aborted at the existing grace boundary");
      if (enabled !== true) check(run.response !== null && !Object.hasOwn(run.response, "visualDecision"), `${name}/off-metadata`, "off response added policy metadata");
      if (enabled === true) {
        const metadata = Object.getOwnPropertyDescriptor(run.response ?? {}, "visualDecision")?.value;
        check(metadata?.declaredRequirement === "none" && metadata?.minimumRequired === false,
          `${name}/declaration-metadata`, "pre-enforcement requirement or minimum metadata was lost");
        check(metadata?.reason === (compatiblePeer ? "compatible_peer" : "planned"),
          `${name}/reason-metadata`, "response lost the original promotion reason");
      }
      if (visual && run.response) {
        const requirement = visual.resolveVisualDecision({ question: scalarQuestion, selectedPlan: scalarPlan,
          peerTurnPlans: run.response.peerTurnPlans, visualNeedRequirement: null, visualDecisionEnabled: true }).requirement;
        check(requirement === (compatiblePeer ? "optional" : "none"), `${name}/peer-vote`, "unaccepted, conflicting, or late peer reopened none");
      }
    } catch (error) { failures.push(`lane-run: ${error instanceof Error ? error.message : String(error)}`); }
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  console.error(`Visual-decision gate RED: ${failures.length} failures across ${checks} checks; no provider calls.`);
  process.exitCode = 1;
} else console.log(`Visual-decision gate GREEN: ${checks} checks; no provider calls.`);
