import { validateSourceEnergyLevelTruth } from "./sourceEnergyLevelTruth";
import { declaredElectronCounts } from "./bohrSourceElectronInventory";
import type { SceneDocument, SceneIssue } from "../types";
import type { TurnPlanV3 } from "../contracts/contractsV3";
import { analyzePhysicalCurve } from "./physicalCurveModels";
import { ATOMIC_OPERATORS, evaluateAtomicConstruction } from "../compile/atomicGeometry";
import { validationNumber } from "../compile/sourceScalars";
import { validateAtomicMassSource, validateOriginalMassSourceGivens } from "./atomicMassSource";
import { ATOMIC_MASS_UNIT_KG } from "./atomicMassConstants";
import { proveSourceBindingPlot, validateSourceBindingObservable } from "./sourceBindingObservable";
import { buildNeutralDecayScene } from "./neutralDecaySource";
import { sourceDocumentMatchesRebuiltSource } from "./independentSourceScene";
import { validatePublicAtomicSceneAdmission } from "./atomicPublicAdmission";
import { validateSourceCoulombObligation } from "./sourceCoulombObligation";

export function hasAtomicSourceProgram(document: Pick<SceneDocument, "constructions">): boolean {
  return document.constructions.some(construction => (ATOMIC_OPERATORS as readonly string[]).includes(construction.operator));
}
const RESULT_UNITS: Readonly<Record<string, readonly [string, number]>> = {
  "1": ["dimensionless", 1], count: ["dimensionless", 1], nuclei: ["population", 1],
  MeV: ["energy", 1], eV: ["energy", 1e-6], J: ["energy", 1 / 1.602176634e-13],
  "MeV/nucleon": ["binding", 1], "eV/nucleon": ["binding", 1e-6],
  m: ["length", 1], nm: ["length", 1e-9], fm: ["length", 1e-15],
  "m/s": ["speed", 1], "km/s": ["speed", 1000], u: ["mass", 1], kg: ["mass", 1 / ATOMIC_MASS_UNIT_KG],
  deg: ["angle", 1], degree: ["angle", 1], rad: ["angle", 180 / Math.PI],
  Bq: ["rate", 1], "s^-1": ["rate", 1], "1/s": ["rate", 1], s: ["time", 1], min: ["time", 60], h: ["time", 3600], d: ["time", 86400], y: ["time", 31557600],
};
function sameResult(value: number, unit: string, expected: number, expectedUnit: string | undefined): boolean {
  const from = RESULT_UNITS[unit], to = RESULT_UNITS[expectedUnit ?? unit];
  if (!from || !to || from[0] !== to[0]) return false;
  const actual = value * from[1] / to[1];
  return Math.abs(actual - expected) <= 1e-6 * Math.max(Math.abs(actual), Math.abs(expected), Number.MIN_VALUE);
}
function compatibleResultUnit(unit: string, target: string | undefined): boolean {
  return target === undefined || Boolean(RESULT_UNITS[unit] && RESULT_UNITS[target] && RESULT_UNITS[unit]![0] === RESULT_UNITS[target]![0]);
}

function claimsBindingObservable(text: string): boolean {
  return /binding[\s-]+energy\s*(?:per|\/)\s*nucleon|\bB\s*\/\s*A\b/i.test(text);
}


function validateBohrSourceApplicability(document: SceneDocument, plan?: TurnPlanV3): SceneIssue[] {
  const models = document.constructions.filter(construction => construction.operator === "bohr_orbit" || construction.operator === "bohr_transition");
  if (!models.length) return [];
  const counts = declaredElectronCounts(typeof document.source.question === "string" ? document.source.question : "");
  const countQuantities = (quantities: readonly { id: string; symbol?: unknown; unit?: unknown; value?: unknown }[]) => quantities.flatMap(quantity => {
    const names = [quantity.id, typeof quantity.symbol === "string" ? quantity.symbol : ""];
    const strong = names.some(name => /^(?:electroncount|numberofelectrons|electrons)$/.test(name.replace(/[\s_{}-]/g, "").toLowerCase()));
    const indexed = names.some(name => /^[nN]_+\{?[eE]\}?$/.test(name)) &&
      (quantity.unit === undefined || typeof quantity.unit === "string" && ["1", "count", "electrons"].includes(quantity.unit));
    return (strong || indexed) && typeof quantity.value === "number" ? [quantity.value] : [];
  });
  counts.push(...countQuantities(document.quantities));
  if (plan) {
    counts.push(...declaredElectronCounts([plan.question, ...plan.assumptions].join("; ")));
    for (const claim of plan.qualitativeClaims) {
      const declared = typeof claim.expected === "number" ? countQuantities([{ id: claim.claim, value: claim.expected }])
        : declaredElectronCounts(`${claim.claim}; ${typeof claim.expected === "string" ? claim.expected : ""}`, true);
      counts.push(...(claim.expected === false ? declared.filter(count => count === 1).map(() => 2) : declared));
    }
    counts.push(...countQuantities([...plan.givens, ...plan.derived]));
  }
  if (!counts.some(count => count !== 1)) return [];
  return models.map(construction => ({ code: "atomic_model_source_mismatch", severity: "fatal", constructionId: construction.id,
    message: "The source or accepted plan explicitly declares an electron inventory outside the one-electron hydrogenic model; a construction's electronCount/model cannot replace it" }));
}

function parentCurveMeaning(construction: SceneDocument["constructions"][number], document: SceneDocument, plan?: TurnPlanV3) {
  const role = document.entities.filter(entity => construction.outputs.includes(entity.id)).map(entity => `${entity.role ?? ""} ${entity.label ?? ""}`).join(" ");
  const source = plan?.question ?? (typeof document.source.question === "string" ? document.source.question : "");
  const viewIds = new Set(document.revealGroups.filter(group => group.entityIds.some(id => construction.outputs.includes(id))).flatMap(group => group.entityIds));
  const axes = document.constructions.filter(candidate => candidate.operator === "axes" && candidate.outputs.some(id =>
    construction.inputs.axes === id || viewIds.has(id)));
  const xTitle = axes.length === 1 && typeof axes[0]!.inputs.xLabel === "string" ? axes[0]!.inputs.xLabel : undefined;
  const yTitle = axes.length === 1 && typeof axes[0]!.inputs.yLabel === "string" ? axes[0]!.inputs.yLabel : undefined;
  const decay = !/daughter|growth/i.test(role) && (/radioactive decay|undecayed|decay curve|activity curve/i.test(role) ||
    /radioactiv|half[\s-]?life|decay/i.test(source) && /\bpopulation\b|\bactivity\b|\bfraction\b|\bparent\b/i.test(role));
  const normalized = /normalized|fraction|\b[NA]\s*\/\s*[NA](?:₀|0|_\{?0\}?)/i.test(`${role} ${yTitle ?? source}`);
  const halfLifeTime = /\bt\s*\/\s*T(?:½|_?\{?(?:half|1\/2)\}?)/i.test(`${role} ${xTitle ?? source}`);
  return { role, source, decay, normalized, halfLifeTime };
}

/** Physical input references must survive the independent plan/source boundary. */
export function validateAtomicSourceBinding(document: SceneDocument, plan?: TurnPlanV3): SceneIssue[] {
  const issues: SceneIssue[] = validateBohrSourceApplicability(document, plan);
  const sourceIds = new Set<string>();
  const resultIds = new Set<string>();
  const resultValues = new Map<string, { value: number; unit: string }>();
  for (const construction of document.constructions) {
    if (!(ATOMIC_OPERATORS as readonly string[]).includes(construction.operator)) continue;
    try {
      const values = evaluateAtomicConstruction(construction.operator, construction.inputs, {
        number: value => validationNumber(value, document), geometry: () => undefined,
        point: value => {
          if (typeof value !== "string" || !document.entities.some(entity => entity.id === value && entity.kind === "point")) throw new Error("Physical relation origin must name a point");
          return { x: 0, y: 0 };
        },
      }, document);
      if (!plan) continue;
      const authoritative = [...plan.givens, ...plan.derived];
      for (const id of new Set(values.flatMap(value => value.atomicObservable.sourceRefs))) {
        sourceIds.add(id);
        const quantity = document.quantities.find(item => item.id === id);
        const source = authoritative.find(item => item.id === id);
        if (!source || !quantity || source.value !== quantity.value || (source.unit ?? "1") !== (quantity.unit ?? "1")) {
          issues.push({ code: "atomic_source_quantity_unbound", severity: "fatal", constructionId: construction.id,
            path: `quantities.${id}`, message: `Physical source ${id} must retain its authoritative id, value, and unit` });
        }
      }
      issues.push(...validateAtomicMassSource(construction, document, plan));
      const model = values[0]!.atomicObservable;
      if ((construction.operator === "nuclear_reaction" && construction.inputs.massUnit === "u" || construction.operator === "nuclide_state" && construction.inputs.boundMass !== undefined && construction.inputs.massUnit === "u") &&
        plan.givens.some(quantity => quantity.unit === "MeV/u") && construction.inputs.energyPerU === undefined) {
        issues.push({ code: "atomic_reference_convention_missing", severity: "fatal", constructionId: construction.id, message: "The source supplies a MeV/u conversion; the physical model must reference it instead of silently substituting a different constant" });
      }
      for (const [field, id] of Object.entries(model.resultBindings ?? {})) {
        resultIds.add(id);
        const expected = authoritative.find(quantity => quantity.id === id);
        const unknown = plan.unknowns.find(quantity => quantity.id === id);
        const unit = model.valueUnits?.[field] ?? "1";
        const prior = resultValues.get(id);
        resultValues.set(id, { value: model.values[field]!, unit });
        if (!expected && !unknown || unknown && !compatibleResultUnit(unit, unknown.unit) || expected && !sameResult(model.values[field]!, unit, expected.value, expected.unit) || prior && !sameResult(model.values[field]!, unit, prior.value, prior.unit)) {
          issues.push({ code: "atomic_result_disagrees", severity: "fatal", constructionId: construction.id, path: `constructions.${construction.id}.inputs.resultBindings.${field}`,
            message: `Recomputed ${field} must agree with its explicitly bound plan result ${id}; a valid figure cannot retain a stale narrated answer` });
        }
      }
    } catch (error) {
      issues.push({ code: "invalid_atomic_source", severity: "fatal", constructionId: construction.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  // Native mass failures already close admission; retain their precise paths
  // without duplicating them. Otherwise source givens bind for every primitive.
  if (plan && !issues.some(issue => issue.severity === "fatal" && issue.code.startsWith("atomic_mass_source_"))) {
    issues.push(...validateOriginalMassSourceGivens(document, plan));
  }
  if (plan && hasAtomicSourceProgram(document)) {
    for (const target of [...plan.unknowns, ...plan.derived]) {
      if (!sourceIds.has(target.id) && !resultIds.has(target.id)) issues.push({ code: "atomic_result_binding_missing", severity: "fatal", path: `unknowns.${target.id}`, message: `The physical program must bind requested or derived result ${target.id} to a recomputed output field` });
    }
  }
  return issues;
}

/** Physical plots are checked against a globally proved relation, not isolated samples. */
export function validateAtomicSceneTruth(document: SceneDocument, plan?: TurnPlanV3, problemIR?: unknown): SceneIssue[] {
  const issues: SceneIssue[] = plan ? validateAtomicSourceBinding(document, plan) : [];
  issues.push(...validateSourceEnergyLevelTruth(document, plan, problemIR));
  issues.push(...validateSourceBindingObservable(document, plan, problemIR));
  for (const construction of document.constructions) {
    if (construction.operator !== "function_curve") continue;
    const meaning = parentCurveMeaning(construction, document, plan);
    const binding = claimsBindingObservable(meaning.role), decay = meaning.decay;
    if (!binding && !decay) continue;
    const { expression, xMin, xMax } = construction.inputs;
    let model = null;
    try { if (typeof expression === "string" && typeof xMin === "number" && typeof xMax === "number") model = analyzePhysicalCurve(expression, xMin, xMax, binding ? "binding" : "decay"); } catch { /* Unsupported or discontinuous relations fail closed. */ }
    const normalizedLawFailed = decay && model && "amplitude" in model &&
      (meaning.normalized && !model.normalizedPopulation || meaning.halfLifeTime && !model.normalizedHalfLifeTime);
    const sourceScaledFraction = normalizedLawFailed && sourceDocumentMatchesRebuiltSource(document, meaning.source, buildNeutralDecayScene(meaning.source));
    if (!model || normalizedLawFailed && !sourceScaledFraction) issues.push({ code: "physical_curve_shape_failed", severity: "fatal", constructionId: construction.id, entityIds: construction.outputs,
      message: binding ? "A binding-energy schematic needs a proved single broad maximum and gradual heavy-nucleus decline. Use a supported concave saturation-minus-linear relation, or source tabulated nuclear_binding_curve for isotope values. Arbitrary sampled functions do not prove this physical observable."
        : "A single-parent decay/activity curve must be a positive decreasing exponential. A fraction starts at one, and the t/T½ coordinate requires rate ln(2). Use a proved exp(-k*x) relation or source-bound radioactive_decay; sampled coincidences cannot establish this law." });
  }
  return issues;
}

/** Qualitative descriptors require the source's physical relation and a globally proved curve model. */
export function describeAtomicScenePlot(construction: SceneDocument["constructions"][number], document: SceneDocument, plan?: TurnPlanV3) {
  const sourceBinding = construction.outputs.length === 1 ? proveSourceBindingPlot(document, construction.outputs[0]!, plan) : null;
  if (sourceBinding) return { x: sourceBinding.x, y: sourceBinding.y, observable: "qualitative_binding_per_nucleon" };
  if (construction.operator !== "function_curve" || document.source.nonMetric !== true || document.source.representationTier !== "qualitative_verified" || !plan) return null;
  const question = plan.question.toLowerCase(), meaning = parentCurveMeaning(construction, document, plan), role = meaning.role.toLowerCase();
  const { expression, xMin, xMax } = construction.inputs;
  if (typeof expression !== "string" || typeof xMin !== "number" || typeof xMax !== "number") return null;
  try {
    if (claimsBindingObservable(role) && claimsBindingObservable(question) && analyzePhysicalCurve(expression, xMin, xMax, "binding")) {
      return { x: { symbol: "A", unit: "", titles: ["A", "Mass number A", "Mass number"] }, y: { symbol: "B/A", unit: "", titles: ["B/A", "Binding energy per nucleon", "Binding energy/nucleon"] }, observable: "qualitative_binding_per_nucleon" };
    }
    if (!meaning.decay) return null;
    const model = analyzePhysicalCurve(expression, xMin, xMax, "decay");
    if (!model || !("amplitude" in model)) return null;
    const activity = /activity/.test(role), normalized = meaning.normalized;
    if (normalized && !model.normalizedPopulation || meaning.halfLifeTime && !model.normalizedHalfLifeTime) return null;
    const timeTitles = ["t", "time", "time t", ...(model.normalizedHalfLifeTime ? ["t/T½", "t/T_half"] : [])];
    return { x: { symbol: "t", unit: "", titles: timeTitles }, y: { symbol: normalized ? activity ? "A/A₀" : "N/N₀" : activity ? "A" : "N", unit: "", titles: normalized ? activity ? ["A/A₀", "A/A0"] : ["N/N₀", "N/N0"] : activity ? ["A", "A(t)", "activity"] : ["N", "N(t)", "undecayed nuclei", "number of nuclei"] }, observable: activity ? "qualitative_activity" : "qualitative_population" };
  } catch { return null; }
}

export interface AtomicTeachingAuthority {
  models: Array<{ constructionId: string; operator: string; sourceRefs: string[]; series?: { lowerN: number; shortWavelengthLimitNm: number; longestWavelengthNm: number; transitionWavelengthNm: number } }>;
  bindings: Array<{ resultId: string; field: string; value: number; unit: string }>;
  conditions: string[];
}

/** Only independently checked model outputs are projected into teaching authority. */
export function buildAtomicTeachingAuthority(document: SceneDocument, acceptedPlan: TurnPlanV3,
  originalQuestion = acceptedPlan.question): AtomicTeachingAuthority | null {
  if (originalQuestion !== acceptedPlan.question || acceptedPlan.question !== document.source.question ||
      !hasAtomicSourceProgram(document) || validatePublicAtomicSceneAdmission(document, originalQuestion).length ||
      validateSourceCoulombObligation(document, acceptedPlan, originalQuestion).some(issue => issue.severity === "fatal") ||
      validateAtomicSceneTruth(document, acceptedPlan).length) return null;
  const projection: AtomicTeachingAuthority = { models: [], bindings: [], conditions: [] };
  for (const construction of document.constructions) {
    if (!(ATOMIC_OPERATORS as readonly string[]).includes(construction.operator)) continue;
    const outputs = evaluateAtomicConstruction(construction.operator, construction.inputs, { number: value => validationNumber(value, document), geometry: () => undefined, point: () => ({ x: 0, y: 0 }) }, document);
    const model = outputs[0]!.atomicObservable;
    projection.models.push({ constructionId: construction.id, operator: construction.operator, sourceRefs: model.sourceRefs,
      ...(construction.operator === "bohr_transition" ? { series: { lowerN: model.values.seriesLowerN!, shortWavelengthLimitNm: model.values.seriesLimitNm!, longestWavelengthNm: model.values.seriesLongestNm!, transitionWavelengthNm: model.values.wavelengthNm! } } : {}) });
    projection.conditions.push(...model.conditions ?? []);
    for (const [field, resultId] of Object.entries(model.resultBindings ?? {})) projection.bindings.push({ resultId, field, value: model.values[field]!, unit: model.valueUnits?.[field] ?? "1" });
  }
  projection.conditions = [...new Set(projection.conditions)];
  return projection;
}
