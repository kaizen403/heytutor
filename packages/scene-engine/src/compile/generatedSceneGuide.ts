/**
 * Source-owned conditioning only. Neither this guide nor a matching guide
 * receipt admits a raster or a student-facing diagram. The app must check the
 * generated pixels, source correspondence and its own admission policy.
 *
 * This is a composition leaf: never import it from a native compiler or source
 * validator. The once-installed independent replayer remains owned by index.ts.
 */
import { arrowPath, dimensionPath } from "@heytutor/drawing";
import { synthesizeFamilyScene, type SynthesizedFamilyScene } from "../synthesize/familyScene";
import { independentlyReplayedSourceDocument } from "../physics/independentSourceScene";
import { validateSceneDocument } from "../document/validation";
import { validateTurnPlanV3, validateTurnPlanSceneProofs, validateSceneQuantityAgreement,
  displayedSceneQuantityTexts, validateCircuitTerminalClosure, convertMeasuredValue, type TurnPlanV3 } from "../contracts/contractsV3";
import { validateProblemIR, type ProblemIR, type SolveRequest } from "../ir/problemIR";
import { solveMechanicsProgram } from "../ir/mechanicsProgram";
import { mechanicsRequestedOutputIssues } from "../ir/mechanicsRequestedOutputs";
import { validateMechanicsSceneSourceBinding, withMechanicsSceneSource } from "../physics/mechanicsSceneAuthority";
import { buildMechanicsTeachingAuthority } from "../physics/mechanicsTeachingAuthority";
import { validateAtomicSourceBinding, validateAtomicSceneTruth } from "../physics/atomicSceneAuthority";
import { readOriginalCoulombModel } from "../physics/sourceCoulombObligation";
import { deriveRutherfordScattering } from "../physics/nuclearAuthority";
import { validateRelativeMotionSourceInputs } from "../synthesize/relativeMotionScene";
import { validateUniformCircularSourceInputs } from "../physics/uniformCircularSourceBinding";
import { validateProjectileMeasurementPlan } from "../physics/projectileMeasurementPlan";
import { compileSceneDocument } from "./compiler";
import { MECHANICS_OPERATORS, mechanicsPhysicalClaims } from "./mechanicsGeometry";
import { validatePvSourceBinding } from "./pvSourceBinding";
import { validateFluidApparatusSourceInputs } from "./fluidApparatusGeometry";
import { validateMatrixSourceBinding } from "./matrixSourceBinding";
import { validateLinearSourcePlan } from "./linearSourceAgreement";
import { certifyNativeGuideSourceBindings, type NativeGuideSourceQuantityBinding } from "./nativeGuideSourceBindings";
import { rebuildNativeMathSourceScene } from "./nativeMathSource";
import { withDiagramYieldPolicy } from "./yieldPolicy";
import { sourceDirectedDisplayIssues } from "./sourceDirectedDisplay";
import { directedCurveInk } from "./directedCurve";
import { validateLabelOwnerTruth, validateStraightLineNames } from "./labelOwnerTruth";
import { validateAngleLabelWedge, validateAxisNamePlacement, validateDimensionAnchors,
  validateFieldLineShape, validateFigureLegibility, validatePointLabelPlacement } from "./figureFeatureTruth";
import { deriveGeneratedSceneGuideLabels, deriveGeneratedSceneGuideCaption, GeneratedSceneGuideLabelError, guidePoint,
  type GeneratedSceneGuideAffine, type GeneratedSceneGuideLabelSlot, type GeneratedSceneGuideCaption } from "../labels/generatedSceneGuideLabels";
import type { LabelBounds } from "../labels/labelEngine";
import { SCENE_ENGINE_VERSION, type RenderPoint, type RenderPrimitive, type SceneDocument,
  type SceneIssue, type RenderScene } from "../types";

export type { GeneratedSceneGuideAffine, GeneratedSceneGuideLabelSlot } from "../labels/generatedSceneGuideLabels";
export const GENERATED_SCENE_GUIDE_SCHEMA = "generated-scene-guide/v1" as const;
export const GENERATED_SCENE_GUIDE_ZONE = Object.freeze({ x: 400, y: 100, width: 760, height: 520 });
export interface GeneratedSceneGuideSourceInput {
  question: string;
  turnPlan?: unknown;
  problemIR?: unknown;
  imageWidth?: number;
  imageHeight?: number;
}
interface SourceInput {
  question: string;
  turnPlan: unknown;
  problemIR: unknown;
  imageWidth: number;
  imageHeight: number;
}
interface InkIdentity {
  id: string; primitiveId: string; entityId: string; groupId: string;
  strokeWidthPx: number; dashed: boolean; fill: "none" | "black" | "region";
}
/** All coordinates and widths in the ink inventory are guide-image pixels. */
export type GeneratedSceneGuideInk = InkIdentity & (
  | { kind: "polyline"; points: RenderPoint[]; closed: boolean }
  | { kind: "circle"; center: RenderPoint; radiusPx: number }
  | { kind: "arc"; center: RenderPoint; radiusPx: number; startAngle: number; endAngle: number }
);
export interface GeneratedSceneGuideArrowTip {
  id: string;
  primitiveId: string;
  entityId: string;
  /** Renderer-rounded shaft and wings in image pixels, not a bounding box. */
  shaftStart: RenderPoint;
  tip: RenderPoint;
  wings: [RenderPoint, RenderPoint];
  inkIds: [string, string, string];
}
export interface GeneratedSceneGuideObject {
  id: string;
  kind: string;
  role: string;
  sourceKind: "entity" | "annotation";
  required: boolean;
  primitiveIds: string[];
  labelSlotIds: string[];
}
type Frozen<T> = T extends (...args: never[]) => unknown ? T : T extends object ? { readonly [K in keyof T]: Frozen<T[K]> } : T;
interface GuideData {
  schema: typeof GENERATED_SCENE_GUIDE_SCHEMA;
  purpose: "conditioning_only";
  accepted: false;
  automaticAdmission: false;
  sourceInput: SourceInput;
  /** Rebuilt internally; never an accepted input document or render report. */
  sourceScene: { document: SceneDocument; family: string; tier: SynthesizedFamilyScene["tier"]; nonMetric: boolean };
  image: { width: number; height: number; svg: string };
  transform: {
    canvas: { width: 1200; height: 700 };
    nativeFrame: "final_board";
    pictureBounds: LabelBounds;
    boardToImage: GeneratedSceneGuideAffine;
    imageToBoard: GeneratedSceneGuideAffine;
  };
  /** Complete native engine inventory in final BOARD pixels, including text. */
  primitives: RenderPrimitive[];
  revealGroups: RenderScene["revealGroups"];
  timeline: RenderScene["timeline"];
  objects: GeneratedSceneGuideObject[];
  ink: GeneratedSceneGuideInk[];
  arrowTips: GeneratedSceneGuideArrowTip[];
  labelSlots: GeneratedSceneGuideLabelSlot[];
  caption?: GeneratedSceneGuideCaption;
  proof: {
    basis: "independent_source_replay" | "native_mechanics_source_program" | "native_mathematical_source_program" | "native_atomic_source_program";
    engineVersion: typeof SCENE_ENGINE_VERSION;
    yieldPolicy: "off";
    figureConsistency: true;
    /** Optional inputs can constrain a replay; only native source proof adds operands. */
    plannerOperandsUsed: boolean;
    sourceQuantityBindings: NativeGuideSourceQuantityBinding[];
    sourceAndNumericIssues: SceneIssue[];
    compileIssues: SceneIssue[];
  };
  /** Canonical sorted JSON bytes for app SHA256. No engine hash is an admission receipt. */
  sourcePayload: string;
  guidePayload: string;
}
export type GeneratedSceneGuide = Frozen<GuideData>;
export interface GeneratedSceneGuideDecline { code: string; message: string; entityIds: readonly string[] }
interface NonAdmission { accepted: false; automaticAdmission: false }
export type GeneratedSceneGuideCompileResult = NonAdmission & (
  | { ok: true; guide: GeneratedSceneGuide }
  | { ok: false; decline: GeneratedSceneGuideDecline }
);
export type GeneratedSceneGuideVerificationResult = GeneratedSceneGuideCompileResult;

class GuideDecline extends Error {
  constructor(readonly code: string, message: string, readonly entityIds: string[] = []) { super(message); }
}
function fail(code: string, message: string, entityIds: string[] = []): never { throw new GuideDecline(code, message, entityIds); }
function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function fields(raw: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!plain(raw)) fail("invalid_guide_input", "Expected a plain source request");
  for (const key of Reflect.ownKeys(raw)) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key)!;
    if (typeof key !== "string" || !allowed.includes(key) || !descriptor.enumerable || !("value" in descriptor)) {
      fail("invalid_guide_input", "Caller scenes, render geometry, proof reports, overrides and accessors are forbidden");
    }
  }
  return raw;
}
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
interface CopyBudget { nodes: number; text: number; array: number; string: number; omitUndefined?: boolean }
/** Bounded data-only canonicalization; never executes toJSON, getters or iterators. */
function jsonCopy(value: unknown, budget: CopyBudget, depth = 0, active = new Set<object>()): Json {
  if (--budget.nodes < 0 || depth > 40) fail("guide_data_limit", "Guide/source data exceeds its structural bound");
  if (typeof value === "string") {
    if (value.length > budget.string || (budget.text -= value.length) < 0) fail("guide_data_limit", "Guide/source text exceeds its bound");
    return value;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("invalid_guide_data", "Guide/source numbers must be finite");
    return value === 0 ? 0 : value;
  }
  if (typeof value !== "object" || active.has(value)) fail("invalid_guide_data", "Guide/source data must be acyclic JSON");
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  if (prototype !== (array ? Array.prototype : Object.prototype) && prototype !== null || Object.getOwnPropertySymbols(value).length) {
    fail("invalid_guide_data", "Guide/source data requires plain JSON records and arrays");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  active.add(value);
  try {
    if (array) {
      const length: unknown = descriptors.length?.value;
      if (typeof length !== "number" || !Number.isInteger(length) || length < 0 || length > budget.array ||
        Object.keys(descriptors).length !== length + 1) fail("invalid_guide_data", "Arrays must be dense bounded data without extra properties");
      const result: Json[] = [];
      for (let index = 0; index < length; index++) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) fail("invalid_guide_data", "Array accessors and holes are forbidden");
        result.push(jsonCopy(descriptor.value, budget, depth + 1, active));
      }
      return result;
    }
    const keys = Object.keys(descriptors).sort();
    if (keys.length > 2048) fail("guide_data_limit", "A guide/source object has too many fields");
    const result: Array<[string, Json]> = [];
    for (const key of keys) {
      const descriptor = descriptors[key]!;
      if (!descriptor.enumerable || !("value" in descriptor)) fail("invalid_guide_data", "Non-data object properties are forbidden");
      // Optional engine fields are JSON-absent, including on a structured clone.
      if (descriptor.value === undefined && budget.omitUndefined === false) fail("invalid_guide_data", "Submitted guides require explicit JSON data for every field");
      if (descriptor.value !== undefined) result.push([key, jsonCopy(descriptor.value, budget, depth + 1, active)]);
    }
    return Object.fromEntries(result);
  } finally { active.delete(value); }
}
function canonical(value: unknown, omitUndefined = true): string {
  return JSON.stringify(jsonCopy(value, { nodes: 300_000, text: 8_388_608, array: 32_768, string: 4_194_304, omitUndefined }));
}
function frozen<T>(value: T): Frozen<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(child => frozen(child)); Object.freeze(value);
  }
  return value as Frozen<T>;
}
function imageDimension(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 128 || value > 4096) fail("invalid_guide_input", "Image dimensions must be integers from 128 to 4096");
  return value;
}
function sourceInput(raw: unknown): SourceInput {
  const input = fields(raw, ["question", "turnPlan", "problemIR", "imageWidth", "imageHeight"]);
  if (typeof input.question !== "string" || !input.question.trim() || input.question.length > 16_384) fail("invalid_guide_input", "An exact nonempty source question of at most 16384 characters is required");
  const copy = (value: unknown) => value == null ? null : jsonCopy(value, { nodes: 40_000, text: 524_288, array: 2048, string: 16_384 });
  return { question: input.question, turnPlan: copy(input.turnPlan), problemIR: copy(input.problemIR),
    imageWidth: imageDimension(input.imageWidth, 1024), imageHeight: imageDimension(input.imageHeight, 768) };
}
function originalIdentity(raw: unknown, question: string): void {
  if (!plain(raw) || raw.question !== question) fail("guide_source_question_mismatch", "Optional plan/IR must retain the exact submitted question");
}
function rejected(issues: readonly { code?: string; message: string; entityIds?: string[]; severity?: string }[], code: string): void {
  const fatal = issues.filter(issue => issue.severity === undefined || issue.severity === "fatal");
  if (fatal.length) fail(code, fatal.slice(0, 4).map(issue => `${issue.code ?? code}: ${issue.message}`).join("; "), [...new Set(fatal.flatMap(issue => issue.entityIds ?? []))]);
}
/** Expose retained intermediates through existing native outputs, not new facts
 * or arithmetic. A plan dependency only narrows the selection; the complete
 * original program, owner, axis and source evidence must independently replay
 * for the selected observable. Never trim a program to make a binding pass. */
function bindNativeIntermediates(problem: ProblemIR, plan: TurnPlanV3): ProblemIR {
  type NativeRequest = Extract<SolveRequest, { kind: "mechanics" }>;
  const requests = problem.solveRequests.filter((request): request is NativeRequest => request.kind === "mechanics");
  // A self-consistent supplied program can rename an aggregate as one of its
  // parts. Anchor its full graph and source identities to fresh native recovery;
  // additional scalar outputs may select that graph, never replace its owners.
  const recovered = synthesizeFamilyScene({ question: problem.question, turnPlan: plan, problemIR: null });
  const source = validateProblemIR(recovered?.document.source.mechanicsProblemIR, problem.question).problem;
  if (!source || !source.solveRequests.length || source.solveRequests.some(request => request.kind !== "mechanics")) {
    fail("guide_source_authority_unproved", "Native guide outputs require a complete independently source-recovered program");
  }
  const graph = (request: NativeRequest): string => canonical({ ...request.program, output: {
    stepId: request.program.output.stepId, ownerId: request.program.output.ownerId, axisId: request.program.output.axisId,
  } });
  const sourceGraphs = new Set(source.solveRequests.flatMap(request => request.kind === "mechanics" ? [graph(request)] : []));
  if (canonical({ ...problem, solveRequests: [] }) !== canonical({ ...source, solveRequests: [] }) ||
      requests.some(request => !sourceGraphs.has(graph(request)))) {
    fail("guide_native_program_mismatch", "Native outputs must preserve the complete recovered source facts, identities, inputs, steps and owner/axis bindings");
  }
  const replays = requests.map(request => ({ request, solved: solveMechanicsProgram(problem, request.program, request.resultBinding) }));
  const derived = new Map(plan.derived.map(quantity => [quantity.id, quantity]));
  const boundIds = new Set(requests.map(request => request.resultBinding?.turnPlanQuantityId));
  const requestIds = new Set(problem.solveRequests.map(request => request.id));
  const additions: NativeRequest[] = [];
  const dependsOn = (resultId: string, intermediateId: string): boolean => {
    const pending = [...derived.get(resultId)?.dependsOn ?? []], seen = new Set<string>([resultId]);
    while (pending.length) {
      const id = pending.pop()!;
      if (id === intermediateId) return true;
      if (seen.has(id)) continue;
      seen.add(id); pending.push(...derived.get(id)?.dependsOn ?? []);
    }
    return false;
  };
  for (const quantity of plan.derived) {
    if (boundIds.has(quantity.id) || !quantity.unit) continue;
    const candidates = new Map<string, NativeRequest>();
    for (const { request, solved } of replays) {
      const binding = request.resultBinding;
      if (!binding || !dependsOn(binding.turnPlanQuantityId, quantity.id)) continue;
      const output = solved.snapshots.get(request.program.output.stepId);
      if (!output || !mechanicsPhysicalClaims(output.geometry).some(claim => claim.symbol === quantity.symbol)) continue;
      const program = { ...request.program, output: { ...request.program.output, symbol: quantity.symbol, unit: quantity.unit } };
      const resultBinding = { ...binding, turnPlanQuantityId: quantity.id, symbol: quantity.symbol, unit: quantity.unit };
      try { solveMechanicsProgram(problem, program, resultBinding); }
      catch { continue; } // An existing claim alone is insufficient source authority.
      candidates.set(canonical({ program, resultBinding }), { ...request, program, resultBinding });
    }
    if (candidates.size > 1) fail("guide_native_intermediate_ambiguous", `Intermediate ${quantity.id} selects different native source programs`);
    const candidate = candidates.values().next().value;
    if (!candidate) continue; // Retain the scalar; the unchanged source guards decide it.
    let suffix = additions.length;
    while (requestIds.has(`guide_intermediate_${suffix}`)) suffix++;
    const id = `guide_intermediate_${suffix}`; requestIds.add(id);
    additions.push({ ...candidate, id });
  }
  if (!additions.length) return problem;
  const checked = validateProblemIR({ ...problem, solveRequests: [...problem.solveRequests, ...additions] }, problem.question);
  if (!checked.problem) { rejected(checked.issues, "guide_numeric_source_unproved"); fail("guide_numeric_source_unproved", "Native intermediate bindings did not revalidate"); }
  return checked.problem;
}
function proveSource(input: SourceInput): {
  scene: SynthesizedFamilyScene; document: SceneDocument; plan: TurnPlanV3 | null; problem: ProblemIR | null;
  basis: GuideData["proof"]["basis"]; plannerOperandsUsed: boolean; issues: SceneIssue[];
  sourceQuantityBindings: NativeGuideSourceQuantityBinding[];
} {
  const question = input.question.trim();
  let plan: TurnPlanV3 | null = null, problem: ProblemIR | null = null;
  if (input.turnPlan !== null) {
    originalIdentity(input.turnPlan, input.question);
    const checked = validateTurnPlanV3(input.turnPlan, question, { freshFromModel: true });
    if (!checked.valid || !checked.plan) { rejected(checked.issues, "guide_plan_invalid"); fail("guide_plan_invalid", "The supplied plan did not validate"); }
    plan = checked.plan;
    if (plan.visualRequirement === "none") fail("guide_not_requested", "The supplied plan declines a scene");
  }
  if (input.problemIR !== null) {
    originalIdentity(input.problemIR, input.question);
    const checked = validateProblemIR(input.problemIR, question);
    if (!checked.problem) { rejected(checked.issues, "guide_problem_invalid"); fail("guide_problem_invalid", "The supplied ProblemIR did not validate"); }
    problem = checked.problem;
  }
  // Always ask the existing source compiler first, without model operands.
  // Optional IR/plan data may add operands only through the native proof below.
  const mathematical = rebuildNativeMathSourceScene({ question, plan, problem });
  if (mathematical?.status === "unproved") {
    rejected(mathematical.issues, "guide_mathematical_source_unproved");
    fail("guide_mathematical_source_unproved", "The complete original mathematical source could not be proved");
  }
  // The closed original-source Coulomb certificate may retain the accepted
  // plan's IDs, charge units and result identity. Rebuild that whole projection;
  // a caller tag or supplied document never selects this authority branch.
  const atomicProjection = plan && readOriginalCoulombModel(question)
    ? synthesizeFamilyScene({ question, turnPlan: plan, problemIR: problem }) : null;
  const nativeAtomic = atomicProjection &&
    atomicProjection.document.constructions.length > 0 &&
    atomicProjection.document.constructions.every(step => step.operator === "rutherford_scattering")
    ? atomicProjection : null;
  let scene = mathematical?.scene ?? nativeAtomic ?? synthesizeFamilyScene({ question, turnPlan: null, problemIR: null });
  const plannerOperandsUsed = mathematical ? mathematical.resultBounds.size > 0 : nativeAtomic !== null || scene === null && plan !== null;
  if (!scene && plan) scene = synthesizeFamilyScene({ question, turnPlan: plan, problemIR: problem });
  if (!scene) fail("unsupported_source_scene", "The existing source compiler cannot rebuild this complete requested scene");
  const validated = validateSceneDocument(scene.document);
  if (!validated.document || !validated.report.valid || canonical(validated.document) !== canonical(scene.document)) {
    fail("guide_source_document_invalid", "The native source scene must validate without discarding or rewriting parts");
  }
  let document = withDiagramYieldPolicy(validated.document, "off");
  if (document.visualDecision.mode !== "scene" || document.source.question !== question) fail("guide_source_question_mismatch", "The rebuilt native scene must preserve the exact source question");
  if (Array.isArray(document.source.yieldDemotions) && document.source.yieldDemotions.length) fail("guide_source_demoted", "A conditioning guide cannot inherit omitted proof obligations");
  if (nativeAtomic && plan) {
    // Prove the entire freshly projected program before exposing any retained
    // output as a scalar. Result values come only from the original-source
    // theorem; the accepted plan supplies identity and constrains the result.
    rejected(validateTurnPlanSceneProofs(document, plan, problem), "guide_numeric_source_unproved");
    rejected(validateAtomicSourceBinding(document, plan), "guide_numeric_source_unproved");
    const original = readOriginalCoulombModel(question)!;
    const v = original.inputs;
    const theorem = deriveRutherfordScattering(v.projectileCharge.value, v.targetCharge.value,
      v.kEnergyLength.value, v.energy.value, v.impactParameter.value);
    const quantities = [...document.quantities];
    for (const step of document.constructions) {
      const results = step.inputs.resultBindings;
      if (!plain(results)) continue;
      for (const field of ["closestApproach", "thetaDegrees"] as const) {
        const id = results[field];
        if (typeof id !== "string") continue;
        const identity = [...plan.unknowns, ...plan.derived].find(row => row.id === id);
        if (!identity) fail("guide_numeric_source_unproved", "Every native atomic output requires its accepted result identity");
        const unit = field === "closestApproach" ? "fm" : "deg", value = theorem[field];
        const existing = quantities.find(row => row.id === id);
        if (existing) {
          if (existing.provenance !== "derived" || existing.value !== value || existing.unit !== unit)
            fail("guide_numeric_source_unproved", "A native atomic result cannot replace a source input or a different computed value");
        } else quantities.push({ id, symbol: identity.symbol, value, unit, provenance: "derived", nativeOwnerId: step.outputs[0] });
      }
    }
    const checked = validateSceneDocument({ ...document, quantities });
    if (!checked.document || !checked.report.valid || canonical(checked.document) !== canonical({ ...document, quantities }))
      fail("guide_numeric_source_unproved", "Native atomic output materialization must preserve the complete validated scene");
    document = checked.document;
  }
  const independent = independentlyReplayedSourceDocument(document, question, plan);
  const numericBounds = mathematical?.resultBounds ?? new Map<string, number>();
  let basis: GuideData["proof"]["basis"] = mathematical ? "native_mathematical_source_program"
    : nativeAtomic ? "native_atomic_source_program" : "independent_source_replay";
  // Atomic authority below re-executes every original-source operand, result,
  // requested event, finite-body restriction and accepted-plan binding. The
  // mechanics branch retains its complete source-program proof unchanged.
  if (!independent && !mathematical && !nativeAtomic) {
    const native = document.constructions.some(construction => (MECHANICS_OPERATORS as readonly string[]).includes(construction.operator));
    if (!native || !plan) fail("guide_source_authority_unproved", "Fresh synthesis or declared source flags alone do not establish independent source authority");
    const checked = validateProblemIR(problem ?? document.source.mechanicsProblemIR, question);
    if (!checked.problem || !checked.problem.solveRequests.length || checked.problem.solveRequests.some(request => request.kind !== "mechanics")) {
      fail("guide_source_authority_unproved", "Native mechanics requires a complete revalidated original-source program");
    }
    // Prove the supplied native scene before extending only its output roster.
    rejected(validateMechanicsSceneSourceBinding(document, checked.problem, question, plan), "guide_numeric_source_unproved");
    problem = bindNativeIntermediates(checked.problem, plan);
    document = withMechanicsSceneSource(document, problem);
    for (const request of problem.solveRequests) if (request.kind === "mechanics") {
      // Executes and rechecks every input/owner/source law, not a serialized proof.
      const solved = solveMechanicsProgram(problem, request.program, request.resultBinding);
      if (!request.resultBinding) fail("guide_numeric_source_unproved", "Every native source result requires its checked quantity binding");
      numericBounds.set(request.resultBinding.turnPlanQuantityId, solved.errorBound);
    }
    const authority = buildMechanicsTeachingAuthority(document, plan);
    if (!authority || authority.bindings.length !== problem.solveRequests.length) {
      fail("guide_numeric_source_unproved", "Every native result must retain a unique plan quantity with its source-proved symbol, unit and recomputed value");
    }
    rejected(mechanicsRequestedOutputIssues(problem, plan), "guide_numeric_source_unproved");
    rejected(validateMechanicsSceneSourceBinding(document, problem, question, plan), "guide_numeric_source_unproved");
    basis = "native_mechanics_source_program";
  }
  const issues = [
    ...validateTurnPlanSceneProofs(document, plan, problem),
    ...validateMechanicsSceneSourceBinding(document, problem, question, plan),
    ...validateAtomicSourceBinding(document, plan ?? undefined),
    ...validateAtomicSceneTruth(document, plan ?? undefined, problem),
    ...validateRelativeMotionSourceInputs(document, question),
    ...validateUniformCircularSourceInputs(document, question),
    ...validateMatrixSourceBinding(document, question, plan),
    ...validateLinearSourcePlan(question, plan),
    ...validatePvSourceBinding(document, question, plan),
    ...validateFluidApparatusSourceInputs(document, question, plan),
    ...validateCircuitTerminalClosure(document, question, plan),
    ...(plan ? validateProjectileMeasurementPlan(document, plan) : []),
  ];
  rejected(issues, "guide_source_proof_failed");
  const sourceBindings = certifyNativeGuideSourceBindings({ question, document, plan, problem });
  rejected(sourceBindings.issues, "guide_plan_operand_unproved");
  if (plan) {
    rejected(validateSceneQuantityAgreement(document.quantities, plan, displayedSceneQuantityTexts(document)), "guide_numeric_plan_mismatch");
    // A hidden planner scalar cannot accompany a source-correct picture unless
    // the independently rebuilt document also owns its numeric identity.
    for (const quantity of [...plan.givens, ...plan.derived]) {
      const binding = sourceBindings.bindings.find(value => value.planQuantityId === quantity.id && value.provenance !== "unknown");
      const sourceQuantity = document.quantities.find(value => value.id === binding?.nativeQuantityId);
      if (!sourceQuantity || typeof sourceQuantity.value !== "number") {
        fail("guide_plan_operand_unproved", "Every supplied planner scalar needs an independently source-proved numeric identity");
      }
      const value = convertMeasuredValue(quantity.value, quantity.unit, sourceQuantity.unit);
      const bound = numericBounds.get(quantity.id);
      const convertedBound = bound === undefined ? 0 : convertMeasuredValue(bound, quantity.unit, sourceQuantity.unit);
      const tolerance = Math.max(convertedBound ?? 0, 64 * Number.EPSILON * Math.abs(sourceQuantity.value));
      if (value === null || convertedBound === null || value !== sourceQuantity.value &&
        (sourceQuantity.value === 0 || value === 0 || Math.abs(value - sourceQuantity.value) > tolerance)) {
        fail("guide_numeric_plan_mismatch", `Planner scalar ${quantity.id} differs from its recomputed source value or source uncertainty`);
      }
    }
  }
  return { scene, document, plan, problem, basis, plannerOperandsUsed, issues,
    sourceQuantityBindings: sourceBindings.bindings };
}

function transformFor(input: SourceInput): GuideData["transform"] {
  const scale = Math.min(GENERATED_SCENE_GUIDE_ZONE.width / input.imageWidth, GENERATED_SCENE_GUIDE_ZONE.height / input.imageHeight);
  const width = input.imageWidth * scale, height = input.imageHeight * scale;
  if (width < 128 || height < 96) fail("guide_picture_too_small", "The requested aspect ratio leaves too little board space for engine labels");
  const x = GENERATED_SCENE_GUIDE_ZONE.x + (GENERATED_SCENE_GUIDE_ZONE.width - width) / 2;
  const y = GENERATED_SCENE_GUIDE_ZONE.y + (GENERATED_SCENE_GUIDE_ZONE.height - height) / 2;
  return { canvas: { width: 1200, height: 700 }, nativeFrame: "final_board", pictureBounds: { x, y, width, height },
    imageToBoard: { xx: scale, xy: 0, yx: 0, yy: scale, tx: x, ty: y },
    boardToImage: { xx: 1 / scale, xy: 0, yx: 0, yy: 1 / scale, tx: -x / scale, ty: -y / scale } };
}
/** Parse only the M/L grammar emitted by the engine's two linear ink helpers. */
function rendererSegments(path: string): Array<[RenderPoint, RenderPoint]> {
  const tokens = path.trim().split(/\s+/u), result: Array<[RenderPoint, RenderPoint]> = [];
  if (!tokens.length || tokens.length % 6 !== 0) fail("unsupported_native_ink", "Unexpected native arrow/dimension path grammar");
  for (let i = 0; i < tokens.length; i += 6) {
    if (tokens[i] !== "M" || tokens[i + 3] !== "L") fail("unsupported_native_ink", "Unexpected native arrow/dimension path command");
    const values = [tokens[i + 1], tokens[i + 2], tokens[i + 4], tokens[i + 5]].map(Number);
    if (!values.every(Number.isFinite)) fail("unsupported_native_ink", "Non-finite native stroke");
    result.push([{ x: values[0]!, y: values[1]! }, { x: values[2]!, y: values[3]! }]);
  }
  return result;
}
function inkInventory(scene: RenderScene, matrix: GeneratedSceneGuideAffine, picture: LabelBounds): {
  ink: GeneratedSceneGuideInk[]; arrowTips: GeneratedSceneGuideArrowTip[]; inkPrimitives: RenderPrimitive[];
} {
  const ink: GeneratedSceneGuideInk[] = [], arrowTips: GeneratedSceneGuideArrowTip[] = [], inkPrimitives: RenderPrimitive[] = [];
  const ids = new Set<string>();
  for (const primitive of scene.primitives) {
    if (ids.has(primitive.id)) fail("guide_primitive_identity_invalid", "Every native primitive must have a unique identity");
    ids.add(primitive.id);
    if (primitive.kind === "label") continue;
    const points = primitive.points;
    if (!points.length || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) fail("unsupported_native_ink", "A native mark has no finite geometry", [primitive.entityId]);
    const stroke = primitive.provenance?.fillOnly === true ? 0 : primitive.provenance?.strokeWidth ?? 2;
    if (typeof stroke !== "number" || !Number.isFinite(stroke) || stroke < 0 || stroke > 12) fail("unsupported_native_ink", "A native stroke has unsupported width", [primitive.entityId]);
    const fill = primitive.provenance?.fillOnly === true || primitive.provenance?.fillRole === "region" ? "region" : "none";
    const identity = (suffix: string): InkIdentity => ({ id: `${primitive.id}:${suffix}`, primitiveId: primitive.id,
      entityId: primitive.entityId, groupId: primitive.groupId, strokeWidthPx: stroke * matrix.xx,
      dashed: primitive.provenance?.dashed === true, fill });
    const keep = (mark: RenderPrimitive) => {
      // Include finite stroke widths and circular extent, never clip lost ink.
      const radius = mark.kind === "point" ? mark.radius ?? 2 : mark.kind === "circle" || mark.kind === "arc" ? mark.radius! : 0;
      const padding = stroke / 2 + radius;
      for (const point of mark.points) if (point.x - padding < picture.x || point.x + padding > picture.x + picture.width ||
        point.y - padding < picture.y || point.y + padding > picture.y + picture.height) {
        fail("guide_ink_outside_picture", "Every complete native mark and arrow tip must fit the exact picture bounds", [primitive.entityId]);
      }
      inkPrimitives.push(mark);
    };
    const line = (suffix: string, vertices: RenderPoint[], closed = false, paintFromEnd = false): string => {
      if (vertices.length < 2) fail("unsupported_native_ink", "A native stroke is incomplete", [primitive.entityId]);
      const id = identity(suffix);
      ink.push({ ...id, kind: "polyline", points: (paintFromEnd ? [...vertices].reverse() : vertices).map(point => guidePoint(matrix, point)), closed });
      keep({ ...primitive, id: id.id, kind: closed ? "polygon" : "polyline", points: vertices });
      return id.id;
    };
    switch (primitive.kind) {
      case "line": {
        // The fresh native compiler owns this undirected measurement span.
        // Between two straight markers, start decorative dash paint at the
        // outer end so the bar does not cover its cap's independent ink.
        // Native primitive order stays intact; the complete guide ink/SVG
        // binding records this paint order instead of introducing a phase knob.
        const bar = scene.primitives.find(candidate => candidate.kind === "dimension" && candidate.entityId === primitive.entityId &&
          candidate.provenance?.measurementRole === "bar");
        const measured = bar ? [bar.provenance?.measuredStart, bar.provenance?.measuredEnd] as Array<RenderPoint | undefined> : [];
        const markerPair = bar?.points.length === 2 && measured.every(point => point && scene.primitives.some(candidate => {
          if (candidate.kind !== "line" || candidate.entityId === primitive.entityId || candidate.points.length !== 2 ||
            !candidate.points.some(end => end.x === point.x && end.y === point.y)) return false;
          const [a, b] = candidate.points, [start, end] = bar.points;
          return (b!.x - a!.x) * (end!.x - start!.x) + (b!.y - a!.y) * (end!.y - start!.y) === 0;
        }));
        const witness = primitive.provenance?.measurementRole === "witness" && primitive.provenance?.dashed === true && points.length === 2 &&
          markerPair && measured.some(point => point?.x === points[0]!.x && point.y === points[0]!.y);
        line("stroke", points, false, witness);
        break;
      }
      case "polyline": line("stroke", points); break;
      case "polygon": line("outline", points, true); break;
      case "rectangle": {
        if (points.length !== 4 || points.some(p => !points.some(q => q.x === p.x && q.y !== p.y) || !points.some(q => q.y === p.y && q.x !== p.x))) {
          fail("unsupported_native_ink", "A rectangle must retain its four native axis-aligned corners", [primitive.entityId]);
        }
        line("outline", points, true); break;
      }
      case "axes":
        if (points.length !== 4) fail("unsupported_native_ink", "Native axes require exactly two separate strokes", [primitive.entityId]);
        line("axis_x", [points[0]!, points[1]!]); line("axis_y", [points[2]!, points[3]!]); break;
      case "dimension": {
        if (points.length !== 2) fail("unsupported_native_ink", "Native dimension endpoints are incomplete", [primitive.entityId]);
        rendererSegments(dimensionPath(points[0]!.x, points[0]!.y, points[1]!.x, points[1]!.y, 0).path)
          .forEach((segment, index) => line(`dimension_${index}`, segment));
        break;
      }
      case "ray": case "vector": {
        const directed = directedCurveInk(points);
        if (!directed.arrow) fail("guide_arrow_tip_missing", "A directed native mark requires its actual arrowhead", [primitive.entityId]);
        if (directed.stroke.length > 2) line("curve", [...directed.stroke]);
        const [a, b] = directed.arrow;
        const segments = rendererSegments(arrowPath(a.x, a.y, b.x, b.y));
        if (segments.length !== 3) fail("guide_arrow_tip_missing", "The native renderer cannot resolve this arrowhead", [primitive.entityId]);
        const inkIds = segments.map((segment, index) => line(`arrow_${index}`, segment)) as [string, string, string];
        arrowTips.push({ id: `${primitive.id}:tip`, primitiveId: primitive.id, entityId: primitive.entityId,
          shaftStart: guidePoint(matrix, segments[0]![0]), tip: guidePoint(matrix, segments[0]![1]),
          wings: [guidePoint(matrix, segments[1]![1]), guidePoint(matrix, segments[2]![1])], inkIds });
        break;
      }
      case "point": case "circle": case "arc": {
        if (points.length !== 1) fail("unsupported_native_ink", "Circular native marks require one centre", [primitive.entityId]);
        const radius = primitive.kind === "point" ? primitive.radius ?? 2 : primitive.radius;
        if (typeof radius !== "number" || !Number.isFinite(radius) || radius <= 0) fail("unsupported_native_ink", "Circular native marks require a positive finite radius", [primitive.entityId]);
        if (primitive.kind === "arc") {
          if (typeof primitive.startAngle !== "number" || typeof primitive.endAngle !== "number" ||
            !Number.isFinite(primitive.startAngle) || !Number.isFinite(primitive.endAngle) || primitive.startAngle === primitive.endAngle) fail("unsupported_native_ink", "Native arcs require an explicit finite sweep", [primitive.entityId]);
          ink.push({ ...identity("arc"), kind: "arc", center: guidePoint(matrix, points[0]!), radiusPx: radius * matrix.xx,
            startAngle: primitive.startAngle, endAngle: primitive.endAngle });
        } else ink.push({ ...identity("circle"), kind: "circle", center: guidePoint(matrix, points[0]!), radiusPx: radius * matrix.xx,
          ...(primitive.kind === "point" && primitive.provenance?.pointStyle !== "open" ? { fill: "black" } : {}) });
        keep({ ...primitive, radius }); break;
      }
      default: fail("unsupported_native_ink", "The guide cannot silently discard an unsupported native primitive", [primitive.entityId]);
    }
  }
  if (!ink.length) fail("unsupported_source_scene", "A conditioning guide requires native geometry");
  return { ink, arrowTips, inkPrimitives };
}
const xml = (text: string): string => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
function imageSvg(width: number, height: number, ink: GeneratedSceneGuideInk[]): string {
  const shapes = ink.map(mark => {
    // A black circular fill plus its centred black stroke is exactly one disk.
    // Paint that union directly: a renderer's approximation of a stroked small
    // circle must not shrink the source-owned outer boundary. The inventory
    // retains the original radius and stroke width for complete source binding.
    const solidDisk = mark.kind === "circle" && mark.fill === "black" && !mark.dashed;
    const style = `id="${xml(mark.id)}" fill="${mark.fill === "black" ? "#000" : mark.fill === "region" ? "#dcecf1" : "none"}" stroke="#000" stroke-width="${solidDisk ? 0 : mark.strokeWidthPx}" stroke-linecap="round" stroke-linejoin="round"${mark.dashed ? ` stroke-dasharray="${6 * mark.strokeWidthPx / 2} ${4 * mark.strokeWidthPx / 2}"` : ""}`;
    if (mark.kind === "polyline") return `<${mark.closed ? "polygon" : "polyline"} points="${mark.points.map(point => `${point.x},${point.y}`).join(" ")}" ${style}/>`;
    if (mark.kind === "circle" || Math.abs(mark.endAngle - mark.startAngle) >= 2 * Math.PI) {
      return `<circle cx="${mark.center.x}" cy="${mark.center.y}" r="${mark.radiusPx + (solidDisk ? mark.strokeWidthPx / 2 : 0)}" ${style}/>`;
    }
    const start = { x: mark.center.x + mark.radiusPx * Math.cos(mark.startAngle), y: mark.center.y + mark.radiusPx * Math.sin(mark.startAngle) };
    const end = { x: mark.center.x + mark.radiusPx * Math.cos(mark.endAngle), y: mark.center.y + mark.radiusPx * Math.sin(mark.endAngle) };
    return `<path d="M ${start.x} ${start.y} A ${mark.radiusPx} ${mark.radiusPx} 0 ${Math.abs(mark.endAngle - mark.startAngle) > Math.PI ? 1 : 0} ${mark.endAngle > mark.startAngle ? 1 : 0} ${end.x} ${end.y}" ${style}/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#fff"/>${shapes.join("")}</svg>`;
}
function objectInventory(document: SceneDocument, primitives: RenderPrimitive[], slots: GeneratedSceneGuideLabelSlot[]): GeneratedSceneGuideObject[] {
  const objects: GeneratedSceneGuideObject[] = document.entities.map(entity => ({ id: entity.id, kind: entity.kind, role: entity.role,
    sourceKind: "entity", required: document.requiredEntityIds.includes(entity.id),
    primitiveIds: primitives.filter(primitive => primitive.entityId === entity.id).map(primitive => primitive.id),
    labelSlotIds: slots.filter(slot => slot.owners.some(owner => owner.entityId === entity.id)).map(slot => slot.id) }));
  for (const annotation of document.annotations) if (!objects.some(object => object.id === annotation.id)) {
    objects.push({ id: annotation.id, kind: annotation.kind, role: annotation.kind, sourceKind: "annotation",
      required: annotation.targetIds.some(id => document.requiredEntityIds.includes(id)),
      primitiveIds: primitives.filter(primitive => primitive.entityId === annotation.id || primitive.provenance?.annotationId === annotation.id).map(primitive => primitive.id),
      labelSlotIds: slots.filter(slot => primitives.some(primitive => primitive.id === slot.primitiveId && primitive.provenance?.annotationId === annotation.id)).map(slot => slot.id) });
  }
  return objects;
}
function compile(input: SourceInput): GeneratedSceneGuide {
  const source = proveSource(input), transform = transformFor(input);
  const compiled = compileSceneDocument(source.document, { yieldPolicy: "off", figureConsistency: true,
    linearLabelFontPx: 24, viewport: { ...transform.pictureBounds, padding: 24 } });
  if (!compiled.ok || !compiled.report.valid || !compiled.renderScene?.primitives.length) {
    rejected(compiled.report.issues, "guide_native_compile_failed"); fail("guide_native_compile_failed", "The current native compiler could not prove a complete scene");
  }
  const scene = compiled.renderScene, primitives = scene.primitives;
  // Keep these proof guards active while yield is OFF: a failure declines the
  // whole guide, rather than omitting a dimension, label or arrow.
  const geometryIssues = [
    ...sourceDirectedDisplayIssues(source.document, scene, input.question.trim()),
    ...validateLabelOwnerTruth(source.document, primitives),
    ...validateStraightLineNames(source.document, primitives),
    ...validateDimensionAnchors(primitives),
    ...validateFieldLineShape(source.document, primitives),
    ...validatePointLabelPlacement(source.document, primitives),
    ...validateFigureLegibility(primitives, source.document),
    ...validateAxisNamePlacement(primitives),
    ...validateAngleLabelWedge(source.document, primitives),
  ];
  rejected(geometryIssues, "guide_geometry_proof_failed");
  const { ink, arrowTips, inkPrimitives } = inkInventory(scene, transform.boardToImage, transform.pictureBounds);
  const labelSlots = deriveGeneratedSceneGuideLabels({ document: source.document, scene, plan: source.plan,
    pictureBounds: transform.pictureBounds, boardToImage: transform.boardToImage, inkPrimitives });
  const caption = deriveGeneratedSceneGuideCaption({ document: source.document, scene, plan: source.plan,
    pictureBounds: transform.pictureBounds, canvas: transform.canvas });
  const data: GuideData = {
    schema: GENERATED_SCENE_GUIDE_SCHEMA, purpose: "conditioning_only", accepted: false, automaticAdmission: false,
    sourceInput: input, sourceScene: { document: source.document, family: source.scene.family, tier: source.scene.tier, nonMetric: source.scene.nonMetric },
    image: { width: input.imageWidth, height: input.imageHeight, svg: imageSvg(input.imageWidth, input.imageHeight, ink) }, transform,
    primitives, revealGroups: scene.revealGroups, timeline: scene.timeline, objects: objectInventory(source.document, primitives, labelSlots),
    ink, arrowTips, labelSlots, ...(caption ? { caption } : {}),
    proof: { basis: source.basis, engineVersion: SCENE_ENGINE_VERSION, yieldPolicy: "off", figureConsistency: true,
      plannerOperandsUsed: source.plannerOperandsUsed, sourceQuantityBindings: source.sourceQuantityBindings,
      sourceAndNumericIssues: source.issues, compileIssues: [...compiled.report.issues, ...geometryIssues] },
    sourcePayload: canonical({ schema: "generated-scene-guide-source/v1", question: input.question, turnPlan: input.turnPlan, problemIR: input.problemIR }),
    guidePayload: "",
  };
  data.guidePayload = canonical(Object.fromEntries(Object.entries(data).filter(([key]) => key !== "guidePayload")));
  // Freeze a private JSON copy, never an engine cache or the caller's objects.
  return frozen(JSON.parse(canonical(data)) as GuideData);
}
function decline(error: unknown): GeneratedSceneGuideCompileResult {
  if (error instanceof GuideDecline || error instanceof GeneratedSceneGuideLabelError) {
    return frozen({ ok: false, accepted: false, automaticAdmission: false, decline: { code: error.code, message: error.message, entityIds: [...error.entityIds] } });
  }
  // Native source readers may throw on unsupported arithmetic. No exception
  // turns into partial guidance or a provenance-only fallback.
  return frozen({ ok: false, accepted: false, automaticAdmission: false,
    decline: { code: "guide_native_proof_failed", message: error instanceof Error ? error.message : "Native source proof failed", entityIds: [] } });
}

/** Source requests only. The engine composition root must install its source replayer. */
export function compileGeneratedSceneGuide(raw: unknown): GeneratedSceneGuideCompileResult {
  try { return frozen({ ok: true, accepted: false, automaticAdmission: false, guide: compile(sourceInput(raw)) }); }
  catch (error) { return decline(error); }
}

/** Freshly reconstruct and compare EVERYTHING, including extra fields and payload strings. */
export function verifyGeneratedSceneGuide(raw: { sourceInput: unknown; guide: unknown }): GeneratedSceneGuideVerificationResult {
  try {
    const input = fields(raw, ["sourceInput", "guide"]);
    const expected = compileGeneratedSceneGuide(input.sourceInput);
    if (!expected.ok) return expected;
    if (canonical(input.guide, false) !== canonical(expected.guide)) fail("guide_replay_mismatch", "Guide contents differ from the complete fresh source reconstruction");
    return expected;
  } catch (error) { return decline(error); }
}
