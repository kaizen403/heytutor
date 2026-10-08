/**
 * Zero-order curve and the two other pilots survive presentation and
 * canonical persistence. The curve is not a label, and the required labels
 * are named by the scene cue so the opening beat can letter them.
 */
import {
  SCENE_ARTIFACTS_V3_VERSION,
  compileSceneDocument,
  validateTurnPlanV3,
  type SceneArtifactsV3,
  type SceneDocument,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import {
  getSegmentCommands,
  parseStoredSegmentCommands,
  serializeSegmentCommands,
  type DrawCommand,
  type TutorSegment,
} from "@heytutor/drawing";
import { buildVerifiedDiagramPresentation } from "../../../../apps/tutor/features/tutor-session/lib/scene/verifiedScenePresentation";
import {
  canonicalizeTurnSceneMetadata,
  type SubmittedTurnSceneMetadata,
} from "../../../../apps/tutor/lib/scene/turnScenePersistence";
import { buildArrheniusCollisionScene } from "../../src/chemistry/arrheniusCollision";
import { buildOrderKineticsScene } from "../../src/chemistry/orderKinetics";
import { buildPeriodicPlacementScene } from "../../src/chemistry/periodicPlacement";

const failures: string[] = [];
function check(cond: boolean, message: string): void {
  if (!cond) failures.push(message);
}

const ZERO = "A zero-order reaction has [A]0 = 0.50 mol/L and k = 0.10 mol/L/s. Find [A] at t = 2.0 s and the half-life. Stop at exhaustion. Do not draw a negative concentration.";
const ARRHENIUS = "Find the activation energy when the rate constant triples from 290 K to 300 K. R = 8.314 J/mol/K. Plot ln k versus 1/T.";
const HELIUM = "Where is helium placed? Give its block, group, period, and configuration 1s2.";

function commandsOf(segments: TutorSegment[]): DrawCommand[] {
  return segments.flatMap((segment) => getSegmentCommands(segment));
}

function storedCommands(segments: Array<{ command: unknown }>): DrawCommand[] {
  return segments.flatMap((segment) => parseStoredSegmentCommands(segment.command) ?? []);
}

function labelTexts(commands: DrawCommand[]): string[] {
  return commands.flatMap((command) => command.type === "LABEL" && command.text ? [command.text] : []);
}

function hasCurve(commands: DrawCommand[]): boolean {
  return commands.some((command) => command.type === "DRAW_LINE" && command.params.length >= 20);
}

function requireLabels(commands: DrawCommand[], labels: readonly string[], where: string): void {
  const texts = labelTexts(commands);
  for (const label of labels) {
    check(texts.includes(label), `${where} is missing ${label}; got ${texts.join(" | ")}`);
  }
}

function metadataFor(
  question: string,
  document: SceneDocument,
  artifacts: SceneArtifactsV3,
  segments: TutorSegment[],
): SubmittedTurnSceneMetadata {
  return {
    question,
    sceneDocument: document,
    sceneEngineVersion: "client",
    validationReport: { valid: true, issues: [] },
    visualStatus: "validated",
    sceneArtifacts: artifacts,
    segments: segments.map((segment, index) => ({
      orderIndex: index,
      narration: segment.narration,
      spokenText: segment.narration,
      command: serializeSegmentCommands(getSegmentCommands(segment), {
        trustedDiagramGeometry: true,
      }),
    })),
  };
}

function quantity(document: SceneDocument, id: string): { value: number; unit: string } {
  const found = document.quantities.find((candidate) => candidate.id === id);
  if (!found || typeof found.value !== "number") throw new Error(`missing quantity ${id}`);
  return { value: found.value, unit: typeof found.unit === "string" ? found.unit : "" };
}

function given(
  id: string,
  symbol: string,
  value: number,
  unit: string,
  sourceText: string,
): TurnPlanV3["givens"][number] {
  return { id, symbol, value, unit, provenance: "given", sourceText };
}

function derived(
  id: string,
  symbol: string,
  value: number,
  unit: string,
  sourceText: string,
  dependsOn: string[],
): TurnPlanV3["derived"][number] {
  return { id, symbol, value, unit, provenance: "derived", sourceText, dependsOn };
}

function planShell(question: string, givens: TurnPlanV3["givens"], derivedValues: TurnPlanV3["derived"]): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3",
    question,
    givens,
    unknowns: [],
    derived: derivedValues,
    qualitativeClaims: [],
    lawIds: [],
    assumptions: [],
    visualRequirement: "required",
  };
}

function artifacts(plan: TurnPlanV3 | null, tier: "exact_verified" | "qualitative_verified"): SceneArtifactsV3 {
  const nonMetric = tier !== "exact_verified";
  return {
    schemaVersion: SCENE_ARTIFACTS_V3_VERSION,
    turnPlan: plan,
    problemIR: null,
    solverResult: null,
    representationTier: tier,
    nonMetric,
    candidates: [],
    diagramResultStatus: "ready",
  };
}

async function persist(
  question: string,
  document: SceneDocument,
  plan: TurnPlanV3 | null,
  tier: "exact_verified" | "qualitative_verified",
  labels: readonly string[],
  curve: boolean,
): Promise<void> {
  const compiled = compileSceneDocument(document);
  check(compiled.ok && compiled.renderScene !== null, `${question.slice(0, 32)} compiles`);
  if (!compiled.ok || !compiled.renderScene) return;
  const presentation = buildVerifiedDiagramPresentation(document, compiled.renderScene);
  const intro = commandsOf(presentation.introSegments);
  requireLabels(intro, labels, `${question.slice(0, 24)} intro`);
  if (curve) check(hasCurve(intro), `${question.slice(0, 24)} intro has the curve`);
  if (plan) {
    const validated = validateTurnPlanV3(plan, question);
    check(validated.valid && validated.plan !== null, `${question.slice(0, 24)} plan: ${validated.issues.map((issue) => issue.message).join("; ")}`);
  }
  const saved = await canonicalizeTurnSceneMetadata(metadataFor(
    question,
    document,
    artifacts(plan, tier),
    presentation.introSegments,
  ));
  check(saved.ok, `${question.slice(0, 24)} canonical save: ${saved.ok ? "" : saved.error}`);
  if (!saved.ok) return;
  const stored = storedCommands(saved.value.segments);
  requireLabels(stored, labels, `${question.slice(0, 24)} canonical`);
  if (curve) check(hasCurve(stored), `${question.slice(0, 24)} canonical curve`);
}

const eaJ = Math.log(3) * 8.314 / (1 / 290 - 1 / 300);

async function main(): Promise<void> {
  const zero = buildOrderKineticsScene(ZERO, [], false);
  check(zero !== null, "zero-order scene");
  if (zero) {
    const a0 = quantity(zero, "A0");
    const k = quantity(zero, "k");
    const time = quantity(zero, "t");
    const concentration = quantity(zero, "A");
    const half = quantity(zero, "tHalf");
    const end = quantity(zero, "tEnd");
    const plan = planShell(ZERO, [
      given("A0", "[A]0", a0.value, a0.unit, "0.50"),
      given("k", "k", k.value, k.unit, "0.10"),
      given("t", "t", time.value, time.unit, "2.0"),
    ], [
      derived("A", "[A]", concentration.value, concentration.unit, "A = 0.50 - 0.10 * 2.0", ["A0", "k", "t"]),
      derived("tHalf", "t1/2", half.value, half.unit, "tHalf = 0.50 / (2 * 0.10)", ["A0", "k"]),
      derived("tEnd", "t_end", end.value, end.unit, "tEnd = 0.50 / 0.10", ["A0", "k"]),
    ]);
    await persist(ZERO, zero, plan, "exact_verified", [
      "[A]=0.3",
      "t1/2=2.5 s",
      "ends t=5.0 s",
      "[A]=0",
      "no negative",
      "t (s)",
      "[A] mol/L",
    ], true);
  }

  const arrhenius = buildArrheniusCollisionScene(ARRHENIUS, [], false);
  check(arrhenius !== null, "arrhenius scene");
  if (arrhenius) {
    const gas = quantity(arrhenius, "R");
    const t1 = quantity(arrhenius, "T1");
    const t2 = quantity(arrhenius, "T2");
    const energy = quantity(arrhenius, "Ea");
    const ratio = quantity(arrhenius, "ratio");
    check(Math.abs(energy.value - eaJ) < 1e-6, `Ea quantity is ${energy.value}, expected ${eaJ}`);
    const plan = planShell(ARRHENIUS, [
      given("T1", "T1", t1.value, t1.unit, "290"),
      given("T2", "T2", t2.value, t2.unit, "300"),
      given("R", "R", gas.value, gas.unit, "8.314"),
    ], [
      derived("ratio", "k2/k1", ratio.value, ratio.unit, "k2/k1 = 3", []),
      derived("Ea", "Ea", energy.value, energy.unit, "Ea = ln(3) * 8.314 / (1/290 - 1/300)", ["T1", "T2", "R", "ratio"]),
    ]);
    await persist(ARRHENIUS, arrhenius, plan, "exact_verified", [
      "T1=290 K",
      "T2=300 K",
      "k2/k1=3",
      "slope=-Ea/R",
      "basis ln",
      "Ea=79.5 kJ/mol",
      "ln k",
      "1/T",
    ], true);
  }

  const helium = buildPeriodicPlacementScene(HELIUM, [], false);
  check(helium !== null, "helium scene");
  if (helium) {
    await persist(HELIUM, helium, null, "qualitative_verified", [
      "He",
      "He grp 18",
      "block s",
      "period 1",
      "Z=2",
      "1s2",
    ], false);
  }

  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("verify-c08a-orders-persist: ok");
}

await main();
