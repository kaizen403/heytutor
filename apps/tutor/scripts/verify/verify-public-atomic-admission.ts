import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getSegmentCommands, serializeSegmentCommands } from "@heytutor/drawing";
import {
  buildAtomicTeachingAuthority, compileGeneratedSceneGuide, compileSceneDocument,
  LocalDeterministicSolverProvider, SCENE_ARTIFACTS_V3_VERSION, synthesizeFamilyScene, synthesizeLastResortScene,
  validateProblemIR, validateSceneDocument, validateTurnPlanV3,
  type SceneConstruction, type SceneDocument, type SceneEntity, type TurnPlanV3,
} from "@heytutor/scene-engine";
import { buildSceneDocumentPlannerPrompt, inferSceneCapabilities } from "@heytutor/tutor-core";
import { isSupportedSceneOperator } from "../../../../packages/scene-engine/src/document/validation";
import {
  selectProductionNativeSourceRepresentation, selectProductionScene, validateProductionSceneCandidate,
} from "../../features/tutor-session/lib/scene/productionSceneSelection";
import type { SelectedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { liveSceneSaveFailure } from "../../lib/scene/sceneSaveAdmission";
import { sourceCheckedStoredDocument, sourceCheckedStoredTurn, storedTurnSourceIssues } from "../../lib/scene/storedSceneSource";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import type { StoredTurn } from "../../lib/boards/boardsClient";

const typedNames = [
  "bohr_orbit", "bohr_transition", "nuclide_state", "radioactive_decay", "nuclear_reaction", "nuclear_binding_curve",
] as const;
const unavailable = new Set<string>(typedNames);
const typedIssue = "atomic_operator_source_unproved";
const numericalDecayIssue = "numeric_decay_plot_source_unproved";
const tier = "qualitative_verified" as const;

interface Given { id: string; symbol: string; value: number; unit: string; sourceText?: string }

let checks = 0;
const failures: string[] = [];
function check(condition: unknown, message: string, actual?: unknown): void {
  checks++;
  if (!condition) failures.push(actual === undefined ? message : `${message}: ${JSON.stringify(actual)}`);
}

function planFor(question: string, givens: readonly Given[] = []): TurnPlanV3 {
  const checked = validateTurnPlanV3({
    schemaVersion: "turn-plan/v3", question, visualRequirement: "required",
    givens: givens.map(given => ({ ...given, provenance: "given" })),
    unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [],
  }, question);
  assert(checked.valid && checked.plan, JSON.stringify(checked.issues));
  return checked.plan;
}

function sceneFor(question: string, givens: readonly Given[], entities: SceneEntity[], constructions: SceneConstruction[]): SceneDocument {
  const entityIds = entities.map(entity => entity.id);
  const checked = validateSceneDocument({
    schemaVersion: "scene-document/v2", source: { question, representationTier: tier, nonMetric: true },
    visualDecision: { mode: "scene", reason: "Show the requested relationship" },
    quantities: givens.map(given => ({ ...given })),
    entities, constructions, annotations: [], relations: [], assertions: [], requiredEntityIds: entityIds,
    revealGroups: [{ id: "setup", entityIds, dependsOn: [], narrationCue: "Show the diagram" }],
    teachingTimeline: [],
  });
  assert(checked.document && checked.report.valid, JSON.stringify(checked.report.issues));
  return checked.document;
}

function operatorScene(question: string, givens: readonly Given[], operator: string,
  inputs: Record<string, unknown>, entities: SceneEntity[]): SceneDocument {
  return sceneFor(question, givens, entities, [{ id: "model", operator, inputs, outputs: entities.map(entity => entity.id) }]);
}

function oldCompiledRepresentation(document: SceneDocument): SelectedRepresentation {
  const result = compileSceneDocument(document, { figureConsistency: true });
  assert(result.ok && result.renderScene?.primitives.length, JSON.stringify(result.report.issues));
  return { tier, nonMetric: true, figureSource: "fast_family", sceneDocument: document,
    renderScene: result.renderScene, validationReport: result.report, reason: "Retained pre-admission scene" };
}

function artifacts(turnPlan: TurnPlanV3 | null) {
  return { schemaVersion: SCENE_ARTIFACTS_V3_VERSION, turnPlan, problemIR: null, solverResult: null,
    representationTier: tier, nonMetric: true, figureSource: "planner", diagramResultStatus: "ready", candidates: [] };
}

function show(candidate: SelectedRepresentation, question: string, turnPlan: TurnPlanV3) {
  return buildVerifiedDiagramPresentation(candidate.sceneDocument, candidate.renderScene, { originalQuestion: question, turnPlan });
}

function introRows(presentation: ReturnType<typeof buildVerifiedDiagramPresentation>) {
  return presentation.introSegments.map((segment, orderIndex) => ({ orderIndex, narration: segment.narration,
    spokenText: segment.narration, command: serializeSegmentCommands(getSegmentCommands(segment), { trustedDiagramGeometry: true }) }));
}

async function refuse(label: string, question: string, turnPlan: TurnPlanV3, old: SelectedRepresentation,
  expectedIssue: typeof typedIssue | typeof numericalDecayIssue,
  isProhibited: (document: SceneDocument) => boolean,
  options: { teaching?: boolean; checkReplay?: boolean; sourceRestated?: boolean } = {}) {
  const { sceneDocument: document, renderScene, validationReport } = old;
  const input = { question, turnPlan, problemIR: null, requiredRetryEnabled: false };
  const candidate = validateProductionSceneCandidate({ ...input, candidate: { ...document }, yieldPolicy: "off" });
  check(!candidate.valid && candidate.errors.some(error => error.code === expectedIssue ||
    options.sourceRestated && error.code?.includes("source") && error.code.includes("mismatch")),
  `${label} candidate rejects on public source truth`, candidate.errors.map(error => error.code));
  const cached = { valid: true, errors: [], value: { document, renderScene, report: validationReport } };
  for (const preferPlanner of [false, true]) {
    const policy = { preferPlanner };
    for (const [path, retained] of Object.entries({ fresh: { candidate: { ...document } },
      cached: { candidateValidation: cached }, fast: { fastRepresentation: old } })) {
      const picked = selectProductionScene({ ...input, policy, ...retained });
      check(!picked.representation || !isProhibited(picked.representation.sceneDocument),
        `${label} ${preferPlanner ? "strict" : "current"} ${path} cannot draw the retained false scene`,
        picked.representation?.figureSource);
    }
  }
  if (options.teaching) {
    check(buildAtomicTeachingAuthority(document, turnPlan) === null, `${label} cannot project operands into teaching authority`);
  }
  for (const retainedPlan of [turnPlan, null]) {
    const metadata = { question, sceneDocument: document, visualStatus: "validated" as const,
      segments: [], sceneArtifacts: artifacts(retainedPlan) };
    const path = retainedPlan ? "with plan" : "without plan";
    const sharedFailure = liveSceneSaveFailure({ document, question, turnPlan: retainedPlan, tier, problemIR: null });
    check(sharedFailure && (sharedFailure.includes(expectedIssue) ||
      options.sourceRestated && /\b[a-z_]*source[a-z_]*mismatch\b/.test(sharedFailure)), `${label} shared live/save ${path}`, sharedFailure);
    const saved = await canonicalizeTurnSceneMetadata(metadata, { curveLabelsEnabled: false });
    check(!saved.ok, `${label} canonical save refuses ${path}`, saved.ok ? saved.value.visualStatus : saved.code);
    const readIssues = storedTurnSourceIssues(document, metadata);
    check(readIssues.some(issue => issue.severity === "fatal" && (issue.code === expectedIssue ||
      options.sourceRestated && issue.code.includes("source") && issue.code.includes("mismatch"))),
    `${label} stored authority ${path}`, readIssues.map(issue => issue.code));
    check(sourceCheckedStoredDocument(document, metadata) === null, `${label} stored document refuses ${path}`);
    check(restoreVerifiedPresentationFromTurn(metadata) === null, `${label} restore refuses ${path}`);
  }
  if (options.checkReplay) {
    const metadata: StoredTurn = { id: "retained-scene", orderIndex: 0, rawResponse: "", speedMultiplier: 1, traceId: null,
      question, sceneDocument: document, sceneEngineVersion: validationReport.engineVersion, validationReport,
      visualStatus: "validated", sceneArtifacts: artifacts(turnPlan),
      segments: introRows(show(old, question, turnPlan)).map(segment => ({ ...segment, id: `retained-${segment.orderIndex}`,
        audioUrl: null, durationMs: null, timings: null })) };
    assert(metadata.segments.some(segment => segment.command !== null), "exercise an actual retained trusted ink row");
    const checked = sourceCheckedStoredTurn(metadata);
    check(checked.visualStatus === "retry_required" && checked.segments.every(segment => segment.command === null),
      `${label} old trusted replay ink is removed`);
  }
}

const orbitQuestion = "Draw the circular Bohr orbit of a hydrogen electron at n = 2 with radius and tangential velocity. For hydrogen use Z=1, ground radius 0.0529 nm and ground speed 2180000 m/s.";
const orbitGivens: Given[] = [
  { id: "Z", symbol: "Z", value: 1, unit: "1", sourceText: "Z=1" },
  { id: "n", symbol: "n", value: 2, unit: "1", sourceText: "n = 2" },
  { id: "r0", symbol: "r_0", value: 0.0529, unit: "nm", sourceText: "ground radius 0.0529 nm" },
  { id: "v0", symbol: "v_0", value: 2180000, unit: "m/s", sourceText: "ground speed 2180000 m/s" },
];
function orbit(givens: readonly Given[]): SceneDocument {
  return operatorScene(orbitQuestion, givens, "bohr_orbit", {
    model: "bohr_hydrogenic", electronCount: 1, Z: "Z", n: "n",
    groundRadius: "r0", radiusUnit: "nm", radiusConvention: "hydrogen_reference",
    groundSpeed: "v0", speedUnit: "m/s", speedConvention: "hydrogen_reference",
  }, [
    { id: "orbit", kind: "circle", role: "orbit", label: "orbit" },
    { id: "electron", kind: "point", role: "electron", label: "electron" },
    { id: "radius", kind: "segment", role: "radius", label: "radius" },
    { id: "velocity", kind: "vector", role: "velocity", label: "velocity" },
  ]);
}

const transitionQuestion = "Draw the energy level diagram for a hydrogen atom emitting a photon during the transition from n = 3 to n = 2. For hydrogen use Z=1 and a ground-state binding energy of 13.6 eV.";
const transitionGivens: Given[] = [
  { id: "Z", symbol: "Z", value: 1, unit: "1", sourceText: "Z=1" },
  { id: "ni", symbol: "n_i", value: 3, unit: "1", sourceText: "n = 3" },
  { id: "nf", symbol: "n_f", value: 2, unit: "1", sourceText: "n = 2" },
  { id: "E0", symbol: "E_0", value: 13.6, unit: "eV", sourceText: "a ground-state binding energy of 13.6 eV" },
];
function transition(givens: readonly Given[]): SceneDocument {
  return operatorScene(transitionQuestion, givens, "bohr_transition", {
    model: "bohr_hydrogenic", electronCount: 1, Z: "Z", nFrom: "ni", nTo: "nf",
    bindingEnergy: "E0", energyUnit: "eV", bindingEnergyConvention: "hydrogen_reference", direction: "emission",
  }, [
    { id: "upper", kind: "segment", role: "upper", label: "upper" },
    { id: "lower", kind: "segment", role: "lower", label: "lower" },
    { id: "emission", kind: "vector", role: "emission", label: "emission" },
  ]);
}

const carbonQuestion = "For carbon-12 with mass number A=12 and atomic number Z=6, draw the nucleus and mark the proton and neutron counts.";
function carbon(A: number, Z: number, element?: string) {
  const givens = [
    { id: "mass_number", symbol: "A", value: A, unit: "1", sourceText: "A=12" },
    { id: "atomic_number", symbol: "Z", value: Z, unit: "1", sourceText: "Z=6" },
  ];
  const document = operatorScene(carbonQuestion, givens, "nuclide_state",
    { A: "mass_number", Z: "atomic_number", ...(element ? { element } : {}) },
    [{ id: "body", kind: "circle", role: "nucleus", label: "nucleus" }]);
  return { document, givens };
}

const decayQuestion = "Draw a numerical radioactive decay graph for the remaining population N(t). The initial population is N0=6000 nuclei. The half-life is 10 min.";
const restatement = "Draw the graph of a decreasing function.";
const decayGivens: Given[] = [
  { id: "initial", symbol: "N0", value: 6000, unit: "nuclei", sourceText: "N0=6000 nuclei" },
  { id: "half", symbol: "T_half", value: 10, unit: "min", sourceText: "10 min" },
];
const falseDecayExpression = "4.5*exp(-0.2599301927099795*x)";
const falseDecayLabel = "N0=60000 nuclei";
function genericDecay(question: string): SceneDocument {
  return sceneFor(question, [], [
    { id: "time_axes", kind: "axes", role: "time and population axes" },
    { id: "population", kind: "polyline", role: "parent population decay", label: falseDecayLabel },
  ], [
    { id: "make_axes", operator: "axes", inputs: { xMin: 0, xMax: 8.3, yMin: 0, yMax: 4.8,
      xLabel: "time (min)", yLabel: "N (nuclei)" }, outputs: ["time_axes"] },
    { id: "make_population", operator: "function_curve", inputs: {
      expression: falseDecayExpression, xMin: 0, xMax: 8, samples: 129,
    }, outputs: ["population"] },
  ]);
}

function hasLabel(candidate: SelectedRepresentation, expected: string): boolean {
  return candidate.renderScene.primitives.some(primitive => primitive.text?.includes(expected));
}

function withValue(givens: readonly Given[], id: string, value: number): Given[] {
  assert(givens.some(given => given.id === id));
  return givens.map(given => given.id === id ? { ...given, value } : given);
}

const withheldDocument = (document: SceneDocument) => document.constructions.some(construction => unavailable.has(construction.operator));
const falsePopulation = (document: SceneDocument) => document.constructions.some(construction =>
  construction.operator === "function_curve" && construction.inputs.expression === falseDecayExpression) &&
  document.entities.some(entity => entity.label === falseDecayLabel);

async function checkBohrAndCarbon() {
  const badOrbit = withValue(orbitGivens, "r0", 0.529);
  const badTransition = withValue(transitionGivens, "E0", 10.2);
  for (const row of [
    { label: "Bohr orbit radius", question: orbitQuestion, givens: badOrbit, document: orbit(badOrbit), falseLabel: "r=2.116 nm" },
    { label: "Bohr transition energy", question: transitionQuestion, givens: badTransition,
      document: transition(badTransition), falseLabel: "Eγ=1.41667 eV" },
    ...[carbon(14, 6, "C"), carbon(12, 7)].map(({ document, givens }, index) => ({
      label: `carbon co-mutated ${index === 0 ? "A" : "Z"}`, question: carbonQuestion, givens, document,
      falseLabel: index === 0 ? "N=8" : "Z=7",
    })),
  ]) {
    const old = oldCompiledRepresentation(row.document);
    check(hasLabel(old, row.falseLabel), `${row.label} old kernel reproduces the actual false label`);
    await refuse(row.label, row.question, planFor(row.question, row.givens), old, typedIssue, withheldDocument,
      { teaching: true, checkReplay: row.question === transitionQuestion });
  }
  for (const [document, expected] of [
    [orbit(orbitGivens), "r=0.2116 nm"], [transition(transitionGivens), "Eγ=1.88889 eV"],
    [carbon(12, 6, "C").document, "N=6"],
  ] as const) {
    check(hasLabel(oldCompiledRepresentation(document), expected), `correct typed kernel still produces ${expected}`);
  }
}

async function checkDecay() {
  const typed = operatorScene(decayQuestion, decayGivens, "radioactive_decay", {
    initial: "initial", halfLife: "half", timeUnit: "min", observable: "population", tMin: 0, tMax: 30,
  }, [{ id: "curve", kind: "polyline", role: "radioactive decay", label: "N(t)" }]);
  const old = oldCompiledRepresentation(typed);
  check(old.renderScene.primitives.some(primitive => primitive.kind === "polyline"),
    "typed decay kernel still executes a population path");
  await refuse("typed decay", decayQuestion, planFor(decayQuestion, decayGivens), old, typedIssue, withheldDocument);
  for (const [question, label] of [[decayQuestion, "generic numerical decay"], [restatement, "restated generic numerical decay"]] as const) {
    const sourceRestated = question !== decayQuestion;
    const generic = oldCompiledRepresentation(genericDecay(question));
    check(!withheldDocument(generic.sceneDocument) && hasLabel(generic, falseDecayLabel) &&
      generic.renderScene.primitives.some(primitive => primitive.kind === "polyline"),
      `${label} is an executable generic-only exponential`);
    const quantities = sourceRestated ? [] : decayGivens;
    await refuse(label, decayQuestion, planFor(question, quantities), generic, numericalDecayIssue, falsePopulation,
      { sourceRestated, checkReplay: !sourceRestated });
  }
  for (const question of ["", "   "]) {
    const document = genericDecay(decayQuestion);
    const turn = { question, sceneDocument: document, sceneArtifacts: artifacts(null) };
    check(sourceCheckedStoredDocument(document, turn) === null &&
      restoreVerifiedPresentationFromTurn(turn) === null, "blank retained question cannot bypass the generic decay source check");
  }
  const measuredPremise = "A radioactive sample has 6000 nuclei and a half-life of 10 minutes.";
  const qualitativeRequest = "Sketch a qualitative radioactive decay curve.";
  for (const [question, wrongRate, operator] of [
    [`${measuredPremise} Include a plot of its activity versus time in Bq.`, "600 decays/min", "function_curve"],
    [`${measuredPremise} Sketch how the activity changes as t increases.`, "A(t)", "parametric_curve"],
    ["A sample of iodine-131 initially gives a detector count rate of 400 cps. It takes eight days for half the nuclei to transmute. Plot its count rate against elapsed time.",
      "900 cps", "function_curve"],
    [qualitativeRequest, "600 decays/min", "function_curve"],
    [qualitativeRequest, "600 cps", "function_curve"],
    [qualitativeRequest, "5.2 mCi", "function_curve"],
  ] as const) {
    const inputs = operator === "parametric_curve"
      ? { xExpression: "t", yExpression: "exp(-t/20)", tMin: 0, tMax: 40 }
      : { expression: "exp(-x/20)", xMin: 0, xMax: 40 };
    const generic = oldCompiledRepresentation(operatorScene(question, [], operator, inputs,
      [{ id: "activity", kind: "polyline", role: "activity curve", label: wrongRate }]));
    check(hasLabel(generic, wrongRate), "generic decay kernel renders the unproved curve");
    await refuse(question, question, planFor(question), generic, numericalDecayIssue,
      document => document.entities.some(entity => entity.label === wrongRate));
  }
  for (const lower of [synthesizeFamilyScene, synthesizeLastResortScene]) {
    const alternative = lower({ question: decayQuestion, turnPlan: planFor(decayQuestion, decayGivens), problemIR: null });
    check(!alternative || !falsePopulation(alternative.document) && !withheldDocument(alternative.document),
      "family lowering cannot replace public decay with unproved typed or generic numeric ink");
  }
  check(!compileGeneratedSceneGuide({ question: decayQuestion, turnPlan: planFor(decayQuestion, decayGivens) }).ok,
    "unproved numerical decay cannot produce conditioning ink");
}

function checkOtherKernelsAndPrompts() {
  const given = (id: string, value: number, unit = "1"): Given => ({ id, symbol: id, value, unit });
  const reactionQuestion = "Draw a deuterium fusion reaction with a helium-3 nucleus and a neutron as products.";
  const reactionGivens = [given("two", 2), given("one", 1), given("three", 3), given("zero", 0)];
  const reaction = operatorScene(reactionQuestion, reactionGivens, "nuclear_reaction", {
      massConvention: "nuclear",
      initial: [{ A: "two", Z: "one", count: "two", element: "H" }],
      final: [{ A: "three", Z: "two", element: "He" }, { A: "one", Z: "zero", particle: "neutron" }],
    }, [{ id: "reaction", kind: "polyline", role: "nuclear reaction", label: "Fusion" }]);
  check(hasLabel(oldCompiledRepresentation(reaction), "A=3, Z=2"), "nuclear reaction kernel still computes a conserved product inventory");
  const bindingQuestion = "Plot the supplied sample binding energies per nucleon against mass number.";
  const bindingGivens = [given("a1", 4), given("a2", 56), given("b1", 7.07, "MeV/nucleon"), given("b2", 8.79, "MeV/nucleon")];
  const binding = operatorScene(bindingQuestion, bindingGivens, "nuclear_binding_curve", { samples: [{ A: "a1", bindingPerNucleon: "b1" }, { A: "a2", bindingPerNucleon: "b2" }] },
    [{ id: "binding", kind: "polyline", role: "binding energy samples per nucleon", label: "Measured samples" }]);
  check(hasLabel(oldCompiledRepresentation(binding), "B/A / MeV per nucleon"), "nuclear binding kernel still draws a calibrated ordinate label");

  for (const [question, givens, document] of [[reactionQuestion, reactionGivens, reaction], [bindingQuestion, bindingGivens, binding]] as const) {
    const candidate = validateProductionSceneCandidate({ question, turnPlan: planFor(question, givens),
      candidate: { ...document }, problemIR: null, yieldPolicy: "off" });
    check(!candidate.valid && candidate.errors.some(issue => issue.code === typedIssue),
      "a correct kernel without a complete source proof is withheld from the public candidate", question);
  }
  for (const operator of typedNames) check(isSupportedSceneOperator(operator), `${operator} remains a recognized document operator`);
  for (const question of [orbitQuestion, transitionQuestion, carbonQuestion, decayQuestion, reactionQuestion, bindingQuestion,
    "Draw a full diagram of the supplied system.", "Draw a fixed-heavy-target Rutherford scattering trajectory."]) {
    const capabilities = inferSceneCapabilities(question, { turnPlan: planFor(question) });
    check(typedNames.every(operator => !capabilities.constructionOperators.includes(operator)),
      "public capabilities withhold all uncertified typed operators", question);
    const prompt = buildSceneDocumentPlannerPrompt(question, capabilities);
    check(typedNames.every(operator => !prompt.includes(operator)), "public planning guidance does not advertise withheld operators", question);
  }
  const explicit = buildSceneDocumentPlannerPrompt(transitionQuestion, { constructionOperators: [...typedNames, "point", "rutherford_scattering"] });
  check(typedNames.every(operator => !explicit.includes(operator)) && explicit.includes("- rutherford_scattering:"),
    "even an explicit planner request withholds the six operators and retains certified Rutherford");
}

interface CertifiedFixture { name: string; question: string; turnPlan: TurnPlanV3; problemIR: unknown }

async function checkCertifiedFixtures() {
  const fixtures: CertifiedFixture[] = JSON.parse(readFileSync(new URL(
    "../../../../packages/scene-engine/scripts/verify/fixtures/native-source-lecture.json", import.meta.url), "utf8"));
  assert.equal(fixtures.length, 3);
  for (const { name, question, turnPlan, problemIR: rawProblem } of fixtures) {
    const { problem } = validateProblemIR(rawProblem, question);
    assert(problem, `${name} retained original IR`);
    const selected = selectProductionNativeSourceRepresentation(question, turnPlan, problem);
    assert(selected, `${name} complete source replay`);
    check(compileGeneratedSceneGuide({ question, turnPlan, problemIR: problem }).ok, `${name} certified guide`);
    const selectionInput = { question, turnPlan, problemIR: problem, fastRepresentation: selected };
    const current = selectProductionScene({ ...selectionInput, policy: { preferPlanner: false } });
    const strict = selectProductionScene({ ...selectionInput, policy: { preferPlanner: true, allowedFigureSources: ["native_source"] } });
    for (const [policy, picked] of [["current", current], ["strict", strict]] as const) {
      check(picked.representation?.figureSource === "native_source" && picked.saveFailure === null,
        `${name} ${policy} final selection`, picked.reason);
    }
    const representation = current.representation;
    assert(representation, `${name} current canonically savable figure`);
    if (name.includes("rutherford")) {
      const authority = buildAtomicTeachingAuthority(representation.sceneDocument, turnPlan, question);
      check(authority?.models.some(model => model.operator === "rutherford_scattering") &&
        authority.bindings.some(result => result.field === "closestApproach" && result.unit === "fm" &&
          Math.abs(result.value - 45.504) < 1e-6), "source-checked Rutherford retains teaching authority with its point-target qualification");
      for (const missingQuestion of [undefined, "", "   "]) {
        check(sourceCheckedStoredDocument(representation.sceneDocument, { question: missingQuestion, sceneArtifacts: artifacts(turnPlan) }) === null,
          "typed Rutherford replay requires an independently retained question");
      }
    }
    const presentation = show(representation, question, turnPlan);
    const solved = await new LocalDeterministicSolverProvider().solve(problem, {
      signal: new AbortController().signal, deadlineMs: Date.now() + 5_000,
    });
    const save = await canonicalizeTurnSceneMetadata({ question, sceneDocument: representation.sceneDocument,
      visualStatus: "validated", segments: introRows(presentation),
      sceneArtifacts: { ...artifacts(turnPlan), representationTier: representation.tier, nonMetric: representation.nonMetric,
        figureSource: representation.figureSource, ...(solved.status === "solved" ? { problemIR: problem, solverResult: solved } : {}) },
    }, { curveLabelsEnabled: false });
    assert(save.ok, save.ok ? "" : `${name} canonical save: ${save.error}`);
    const saved = { ...save.value, question };
    check(sourceCheckedStoredDocument(saved.sceneDocument, saved), `${name} canonical source read`);
    const restored = restoreVerifiedPresentationFromTurn(saved);
    check(restored && JSON.stringify(restored.diagram.commands) === JSON.stringify(presentation.diagram.commands),
      `${name} ordered rendered commands survive save/read/restore`);
  }
}

async function main() {
  await checkBohrAndCarbon();
  await checkDecay();
  checkOtherKernelsAndPrompts();
  await checkCertifiedFixtures();
  assert.deepEqual(failures, [], `${failures.length} of ${checks} public atomic admission assertions failed`);
  console.log(`public atomic admission: ${checks} assertions passed`);
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
