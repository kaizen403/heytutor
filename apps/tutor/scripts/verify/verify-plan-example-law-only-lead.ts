/**
 * #303: a checked plan example is the one figure a law only lead may draw.
 *
 * On six hybridisation topic asks (round topic-asks-e1, recorded 24 Oct) the
 * plan's laws ("orbital hybridisation model", "LCAO") lead an archetype the
 * question never names, and main's guard in `selectProductionScene` declined
 * the whole figure before the plan example was tried. The exemption admits
 * exactly the figure the plan example path built and checked (provenance
 * `plan_example`, regenerated from the question and the plan with the same
 * species). Everything else under a law only lead declines as on main: the
 * archetype, a planner figure, any other family or fast figure, and a plan
 * example that fails any of its own checks.
 *
 * `--mutate-exempt-every-figure` loads a copy of the selection module whose
 * exemption admits every figure; the normal run spawns it and requires it red.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lawOnlyArchetypeLead, type TurnPlanV3 } from "@heytutor/scene-engine";
import { selectFastVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";

const MUTATION_FLAG = "--mutate-exempt-every-figure";
const mutate = process.argv.includes(MUTATION_FLAG);
const modulePath = join(__dirname, "../../features/tutor-session/lib/scene/productionSceneSelection.ts");

type SelectionModule = typeof import("../../features/tutor-session/lib/scene/productionSceneSelection");

async function loadSelection(): Promise<{ module: SelectionModule; cleanup: () => void }> {
  if (!mutate) return { module: await import("../../features/tutor-session/lib/scene/productionSceneSelection"), cleanup: () => {} };
  const source = readFileSync(modulePath, "utf8");
  // Anchor both ends of the exemption's decision so a moved body fails loudly.
  const anchor = /(export function lawOnlyLeadExemptExample\([^)]*\): boolean \{\n)([\s\S]*?)(\n\}\n)/;
  const match = source.match(anchor);
  assert.ok(match, "mutation anchor: lawOnlyLeadExemptExample body not found");
  assert.ok(match[2]!.includes("PLAN_EXAMPLE_PROVENANCE") && match[2]!.includes("buildPlanExampleDocument"),
    "mutation anchor: the exemption body no longer reads provenance and regenerates the example");
  const mutated = source.replace(anchor, (_all, head: string, _body: string, tail: string) =>
    `${head}  void selected; void question; void turnPlan;\n  return true;${tail}`);
  assert.notEqual(mutated, source, "the mutation changed the module");
  const mutantPath = modulePath.replace(/\.ts$/, `.mutant-${process.pid}.ts`);
  writeFileSync(mutantPath, mutated);
  const loaded = await import(mutantPath) as SelectionModule;
  console.log("mutant loaded: every figure exempt from the law only guard");
  return { module: loaded, cleanup: () => unlinkSync(mutantPath) };
}

const plan = (question: string, lawIds: string[], exampleSpecies: TurnPlanV3["exampleSpecies"], extra: Partial<TurnPlanV3> = {}): TurnPlanV3 => ({
  schemaVersion: "turn-plan/v3", question, visualRequirement: "optional",
  givens: [], unknowns: [], derived: [], qualitativeClaims: [], assumptions: [], lawIds,
  ...(exampleSpecies ? { exampleSpecies } : {}), ...extra,
});

// The six recorded asks: question, recorded laws and recorded plan example.
const SIX: Array<{ id: string; plan: TurnPlanV3; formula: string }> = [
  { id: "hybridisation-topic", formula: "CH4", plan: plan("explain hybridisation", ["VSEPR theory", "orbital hybridisation model"],
    [{ formula: "CH4", claim: "In methane CH4 the central carbon is sp3 hybridised, giving a tetrahedral shape with bond angles of 109.5° and no lone pairs on carbon." }]) },
  { id: "hybrid-example", formula: "CH4", plan: plan("explain hybridization with example", ["valence-bond-theory", "orbital-hybridization-model", "VSEPR"],
    [{ formula: "CH4", claim: "In methane (CH4), the central carbon is sp3 hybridized, has zero lone pairs, and the molecule is tetrahedral with 109.5° H-C-H bond angles." }]) },
  { id: "sp-hybridisation", formula: "CO2", plan: plan("explain sp hybridisation", ["valence bond theory", "VSEPR theory", "orbital hybridisation"],
    [{ formula: "CO2", claim: "In CO2 the central carbon is sp hybridised, has no lone pairs, and the molecule is linear with O=C=O bond angle 180 degrees." }],
    { visualRequirement: "required" }) },
  { id: "sp2-hybridisation", formula: "BF3", plan: plan("what is sp2 hybridisation",
    ["valence bond theory of orbital hybridisation", "VSEPR theory", "linear combination of atomic orbitals (LCAO)"],
    [{ formula: "BF3", claim: "In BF3 the boron atom is sp2 hybridised with a trigonal planar shape, 120 degree F-B-F bond angles and no lone pairs on boron." }]) },
  { id: "sp3d-hybridisation", formula: "PCl5", plan: plan("explain sp3d hybridisation",
    ["valence bond theory of orbital hybridisation", "VSEPR theory (electron pairs repel and maximise separation)", "conservation of orbital number (n atomic orbitals give n hybrid orbitals)"],
    [{ formula: "PCl5", claim: "In PCl5 the phosphorus atom is sp3d hybridised, has a trigonal bipyramidal shape with five bond pairs and no lone pairs on the central atom." }],
    { visualRequirement: "required" }) },
  { id: "sp3d2-hybridisation", formula: "SF6", plan: plan("what is sp3d2 hybridisation",
    ["valence bond theory: orbital hybridisation", "VSEPR theory: electron domains repel and maximise separation"],
    [{ formula: "SF6", claim: "In SF6 the central sulfur atom is sp3d2 hybridised, the molecule is octahedral, and sulfur carries no lone pairs." }],
    { qualitativeClaims: [{ id: "c4", claim: "In SF6, sulfur undergoes sp3d2 hybridisation: its six hybrid orbitals bond six fluorines.",
      expected: "SF6: S is sp3d2 hybridised, octahedral shape, 0 lone pairs on S, F-S-F angles 90 degrees" }] as TurnPlanV3["qualitativeClaims"] }) },
];

const LAW_ONLY_REASON = "the stem matched an archetype only through its plan's laws";

// A valid planner candidate: on main a law only lead drops it by name.
const plannerCandidate = (question: string): Record<string, unknown> => ({
  schemaVersion: "scene-document/v2", source: { question },
  visualDecision: { mode: "scene", reason: "a labelled axis segment" }, quantities: [],
  entities: [{ id: "a", kind: "point", role: "endpoint", label: "A" }, { id: "b", kind: "point", role: "endpoint", label: "B" },
    { id: "ab", kind: "segment", role: "segment", label: "AB" }],
  constructions: [{ id: "pa", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] },
    { id: "pb", operator: "point", inputs: { x: 3, y: 0 }, outputs: ["b"] },
    { id: "sab", operator: "segment", inputs: { start: "a", end: "b" }, outputs: ["ab"] }],
  relations: [], assertions: [{ id: "exists", predicate: "exists", entities: ["ab"], expected: true, severity: "fatal" }],
  annotations: [], requiredEntityIds: ["a", "b", "ab"],
  revealGroups: [{ id: "setup", entityIds: ["a", "b", "ab"], dependsOn: [], narrationCue: "Draw AB." }],
  teachingTimeline: [{ id: "reveal", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Draw AB." }],
});

async function main(): Promise<void> {
const { module: selection, cleanup } = await loadSelection();
const { selectProductionScene } = selection;
type Input = Parameters<typeof selectProductionScene>[0];
const select = (turnPlan: TurnPlanV3, extra: Partial<Input> = {}) =>
  selectProductionScene({ question: turnPlan.question, turnPlan, problemIR: null, ...extra } as Input);

let failures = 0;
const check = (name: string, run: () => void) => {
  try { run(); } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
};
const declinesAsMain = (name: string, turnPlan: TurnPlanV3, extra: Partial<Input> = {}) => check(name, () => {
  assert.equal(lawOnlyArchetypeLead(turnPlan.question, { turnPlan, problemIR: null }), true, "fixture must be a law only lead");
  const selection = select(turnPlan, extra);
  assert.equal(selection.representation, null, "a law only lead draws nothing here");
  assert.equal(selection.reason, LAW_ONLY_REASON, "the decline is main's law only decline");
  if (extra.candidate) assert.equal(selection.droppedCandidate?.code, "law_only_archetype_lead", "the planner candidate is dropped by name");
});

try {
  // 1. The six asks draw their checked example, and only it.
  for (const ask of SIX) {
    check(`${ask.id} draws its checked example`, () => {
      assert.equal(lawOnlyArchetypeLead(ask.plan.question, { turnPlan: ask.plan, problemIR: null }), true, "fixture must be a law only lead");
      const selection = select(ask.plan);
      const rep = selection.representation;
      assert.ok(rep, `drew nothing: ${selection.reason}`);
      assert.equal(rep.sceneDocument.source.figureProvenance, "plan_example", "the figure is the plan example");
      assert.equal(rep.sceneDocument.source.exampleSpecies, ask.formula, "the figure is the plan's species");
      assert.equal(rep.family, "chem_vsepr");
      assert.equal(rep.tier, "qualitative_verified");
      assert.equal(selection.saveFailure, null, "the example saves");
    });
    // A valid planner candidate does not displace the example and is still
    // dropped by the guard's name.
    check(`${ask.id} keeps the example over a planner candidate`, () => {
      const selection = select(ask.plan, { candidate: plannerCandidate(ask.plan.question) });
      assert.equal(selection.representation?.sceneDocument.source.figureProvenance, "plan_example", `drew ${selection.representation?.figureSource ?? "nothing"}: ${selection.reason}`);
      assert.equal(selection.droppedCandidate?.code, "law_only_archetype_lead", "the planner candidate is dropped by the guard");
    });
  }

  // 2. An archetype led only by a law, with no plan example, declines as on main.
  const bubble = "A small air bubble sits inside a glass sphere of radius 5 cm, 3 cm from its surface. Where does it appear when viewed from outside?";
  const bubblePlan = { ...plan(bubble, ["refraction at a spherical surface", "spherical refraction formula"], undefined), visualRequirement: "required" as const };
  declinesAsMain("air bubble planner candidate", bubblePlan, { candidate: plannerCandidate(bubble) });
  for (const ask of SIX) {
    const noExample = structuredClone(ask.plan);
    delete noExample.exampleSpecies;
    declinesAsMain(`${ask.id} without a plan example`, noExample);
    declinesAsMain(`${ask.id} without a plan example, planner candidate`, noExample, { candidate: plannerCandidate(ask.plan.question) });
  }

  // The fast path hands the same checked example in: it draws.
  const topic = SIX[0]!.plan;
  const fast = (turnPlan: TurnPlanV3) => selectFastVerifiedRepresentation({ question: turnPlan.question, turnPlan, problemIR: null });
  const ch4 = fast(topic);
  const bf3 = fast(SIX[3]!.plan);
  check("the fast path builds the checked examples", () => {
    assert.equal(ch4?.sceneDocument.source.exampleSpecies, "CH4");
    assert.equal(bf3?.sceneDocument.source.exampleSpecies, "BF3");
  });
  check("a fast checked example draws under a law only lead", () => {
    assert.ok(ch4);
    const selection = select(topic, { fastRepresentation: structuredClone(ch4) });
    assert.equal(selection.representation?.sceneDocument.source.exampleSpecies, "CH4", `drew nothing: ${selection.reason}`);
  });

  // Any other figure handed in under a law only lead declines: a fast figure
  // that is not a plan example, one built for another plan's species, one
  // claiming another species, and one whose graph differs from the
  // regenerated example.
  if (ch4 && bf3) {
    const stripped = structuredClone(ch4);
    delete (stripped.sceneDocument.source as { figureProvenance?: unknown }).figureProvenance;
    declinesAsMain("a fast figure without plan example provenance", topic, { fastRepresentation: stripped });
    declinesAsMain("a plan example for another plan's species", topic, { fastRepresentation: structuredClone(bf3) });
    const forged = structuredClone(ch4);
    forged.sceneDocument.source = { ...forged.sceneDocument.source, exampleSpecies: "NH3" };
    declinesAsMain("a plan example claiming another species", topic, { fastRepresentation: forged });
    const regraphed = structuredClone(ch4);
    const atom = regraphed.sceneDocument.entities.find((entity) => entity.label === "H");
    check("the CH4 figure labels a hydrogen", () => assert.ok(atom));
    if (atom) atom.label = "F";
    declinesAsMain("a plan example whose graph differs from the regenerated one", topic, { fastRepresentation: regraphed });
  }

  // 3. A plan example that fails any of its own checks still declines.
  const sp2 = SIX[3]!.plan;
  const withExample = (base: TurnPlanV3, exampleSpecies: TurnPlanV3["exampleSpecies"], extra: Partial<TurnPlanV3> = {}) =>
    ({ ...base, exampleSpecies, ...extra }) as TurnPlanV3;
  const failing: Array<[string, TurnPlanV3]> = [
    ["the example is not the named hybridisation (CH4 for sp2)", withExample(sp2,
      [{ formula: "CH4", claim: "In CH4 the carbon is sp3 hybridised and tetrahedral." }])],
    ["the claim contradicts the computed hybridisation", withExample(sp2,
      [{ formula: "BF3", claim: "In BF3 the boron atom is sp2 hybridised with one lone pair on boron." }])],
    ["the claim states no checkable fact", withExample(sp2,
      [{ formula: "BF3", claim: "BF3 is a good example to remember." }])],
    ["another plan claim about the species contradicts it", withExample(sp2,
      [{ formula: "BF3", claim: "In BF3 the boron atom is sp2 hybridised and trigonal planar." }],
      { qualitativeClaims: [{ id: "c9", claim: "BF3 is trigonal pyramidal.", expected: true }] as TurnPlanV3["qualitativeClaims"] })],
    ["the formula is not one species", withExample(topic,
      [{ formula: "CH4 + 2O2", claim: "CH4 is sp3 hybridised and tetrahedral." }])],
    ["the charge is not written whole", withExample(topic,
      [{ formula: "SO42-", claim: "SO4 2- is sp3 hybridised and tetrahedral." }])],
    ["two examples", withExample(topic,
      [{ formula: "CH4", claim: "CH4 is sp3 hybridised and tetrahedral." }, { formula: "NH3", claim: "NH3 is sp3 hybridised and trigonal pyramidal." }])],
  ];
  for (const [name, turnPlan] of failing) {
    declinesAsMain(`failing example: ${name}`, turnPlan);
    declinesAsMain(`failing example with a planner candidate: ${name}`, turnPlan, { candidate: plannerCandidate(turnPlan.question) });
  }
  // A question that names its own species is not a plan example ask.
  const named = plan("what is sp2 hybridisation, as in BF3", sp2.lawIds, sp2.exampleSpecies);
  if (lawOnlyArchetypeLead(named.question, { turnPlan: named, problemIR: null })) {
    declinesAsMain("failing example: the question names its own species", named);
  }

  // Strict, which prefers the planner, is unchanged: the guard never applied.
  check("strict keeps its own path", () => {
    const strict = select(bubblePlan, { candidate: plannerCandidate(bubble),
      policy: { preferPlanner: true, allowedFigureSources: ["planner", "verified_recovery", "linear_source", "text_only"] } } as Partial<Input>);
    assert.notEqual(strict.reason, LAW_ONLY_REASON);
  });
} finally {
  cleanup();
}

if (mutate) {
  if (failures > 0) { console.error(`mutant red: ${failures} failures`); process.exit(1); }
  console.log("mutant green");
  process.exit(0);
}

// The mutation that exempts every figure must go red.
check("mutation: exempt every figure goes red", () => {
  const child = spawnSync(process.execPath, [...process.execArgv, __filename, MUTATION_FLAG],
    { encoding: "utf8", cwd: process.cwd() });
  const output = `${child.stdout}\n${child.stderr}`;
  assert.ok(output.includes("mutant loaded"), `the mutant did not load:\n${output.slice(-2000)}`);
  assert.notEqual(child.status, 0, "the mutant passed");
  const red = output.match(/mutant red: (\d+) failures/);
  assert.ok(red, `the mutant failed outside its checks:\n${output.slice(-2000)}`);
  console.log(`mutation exempting every figure: ${red[1]} failures`);
});

if (failures > 0) {
  console.error(`plan example law only lead: ${failures} failures`);
  process.exit(1);
}
console.log("plan example law only lead: six asks draw their checked example; law only archetypes, other figures and failing examples decline; the exempt every figure mutation is red");
}

void main();
