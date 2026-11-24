import { unwrapMathMarkup } from "@heytutor/drawing";
import type { TurnPlanV3 } from "../contracts/contractsV3";
import type { SceneConstruction, SceneDocument, SceneIssue } from "../types";
import { evaluateAtomicConstruction } from "../compile/atomicGeometry";
import { compactNumber, placement, preserveLiteral, validationNumber } from "../compile/sourceScalars";
import { readSourceDrawingRequests, sourceUnquotedText } from "../document/sourceRequestScope";
import { readSourcePlanarGeometry } from "../document/sourcePlanarGeometry";
import { validateSceneDocument } from "../document/validation";
import { deriveRutherfordScattering } from "./nuclearAuthority";

type Field = "projectileCharge" | "targetCharge" | "energy" | "kEnergyLength" | "impactParameter";
type ObservableField = Field | "closestApproach" | "thetaDegrees";
type Evidence = { start: number; end: number; text: string; inference?: "head_on_implies_zero_impact" };
type Premise = { value: number; unit: string; evidence: Evidence };
type SourceModel = {
  inputs: Record<Field, Premise>;
  model: Evidence;
  request: Evidence;
  turning: boolean;
  outside: boolean;
};
const NUMBER = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const SIGNED = "[+-](?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const ENERGY: Readonly<Record<string, number>> = { eV: 1e-6, keV: 1e-3, MeV: 1, GeV: 1e3, J: 1 / 1.602176634e-13 };
const LENGTH: Readonly<Record<string, number>> = { fm: 1, pm: 1e3, nm: 1e6, m: 1e15 };
const COUPLING = "(?:MeV fm|keV fm|eV fm|eV nm|J m)";
// Closed statement grammars for a native physical model's premises. They do
// not choose a figure or prescribe geometry. Statements compose in any order;
// no unconsumed word may import a conditional, historical or competing model.
const MODEL_PREFIX = /^(?<model>In the classical (?:nonrelativistic )?(?:repulsive )?heavy fixed[- ]target (?:Coulomb )?(?:approximation|model)),\s*/id;
const MODEL = /^(?<model>(?:Use|Assume|Consider|The model is) (?:the )?classical (?:nonrelativistic )?repulsive (?:Coulomb (?:model|scattering) with a fixed heavy target|fixed[- ]heavy[- ]target Coulomb model))$/id;
const ENCOUNTER = new RegExp(`^(?:a|the) (?<q>${SIGNED})\\s*e (?<projectile>alpha particle|projectile|particle) with kinetic energy (?<energy>${NUMBER}) (?<energyUnit>eV|keV|MeV|GeV|J) approaches (?:a|the) (?<z>${SIGNED})\\s*e (?<target>nucleus|point target|target)(?: (?<head>head[- ]on)| with impact parameter (?:b\\s*=\\s*)?(?<impact>${NUMBER}) (?<impactUnit>fm|pm|nm|m))$`, "id");
const PROJECTILE = new RegExp(`^(?:The )?projectile (?:has )?charge (?:q1\\s*=\\s*)?(?<q>${SIGNED})\\s*e(?: and kinetic energy (?<energy>${NUMBER}) (?<energyUnit>eV|keV|MeV|GeV|J))?$`, "id");
const TARGET = new RegExp(`^(?:The )?(?:heavy )?(?<target>nucleus|point target|target) (?:has )?charge (?:q2\\s*=\\s*)?(?<z>${SIGNED})\\s*e$`, "id");
const KINETIC = new RegExp(`^(?:The )?projectile (?:has )?kinetic energy (?:E\\s*=\\s*)?(?<energy>${NUMBER}) (?<energyUnit>eV|keV|MeV|GeV|J)$`, "id");
// English wording may change case; mathematical k and e may not.
const COULOMB_CONSTANT = new RegExp(`^(?:[Uu][Ss][Ee] )?k\\s*e(?:\\^2|²)\\s*=\\s*(?<k>${NUMBER}) (?<kUnit>${COUPLING})$`, "d");
const IMPACT = new RegExp(`^(?:The )?impact parameter (?:is )?(?:b\\s*=\\s*)?(?<impact>${NUMBER}) (?<impactUnit>fm|pm|nm|m)$`, "id");
const HEAD_ON = /^(?:The )?projectile approaches (?:the )?target (?<head>head[- ]on)$/id;
const REQUEST = /^(?:(?:Find|Calculate|Determine) the closest approach and )?(?:draw|sketch|show|mark) the (?<object>(?:head[- ]on )?turning point|trajectory|closest approach)(?<outside> outside the nucleus)?(?: and mark the closest approach)?$/id;
const normal = (text: string) => unwrapMathMarkup(text).normalize("NFKC").replace(/−/g, "-")
  .replace(/([_^])\{([\p{L}\p{N}]+)\}/gu, "$1$2").replace(/\s+/g, " ").trim();
const same = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b) &&
  Math.abs(a - b) <= 1e-10 * Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE);
const fatal = (code: string, message: string, construction?: SceneConstruction): SceneIssue => ({ code, message,
  severity: "fatal", failureKind: "truth", ...(construction ? { constructionId: construction.id, entityIds: construction.outputs } : {}) });

/** Preserve complete mathematical notation: powers, indices and decorations
 * are semantic. This grammar is folded from the independently reviewed peer
 * whole-symbol proof; no generic lossy math unwrapping grants identity. */
function provedCalloutSymbol(symbol: unknown, field: ObservableField, unit: unknown): boolean {
  if (symbol === undefined) return true;
  if (typeof symbol !== "string") return false;
  if (!symbol.trim()) return true; // The formatter emits just the scalar, never the id.
  // Script attachment is mathematical meaning: q² is not q₂, and k_e² is
  // not k·e². Match the complete notation without flattening scripts/groups.
  // Generic markup unwrapping drops scientific operators such as hats. Only
  // these exact glyph spellings are equivalent; all other commands remain
  // in the token and fail the closed notation grammar below.
  const glyphs: Record<string, string> = { alpha: "α", theta: "θ", cdot: "·" };
  const token = symbol.normalize("NFC").trim().replace(/\\(alpha|theta|cdot)\b/g,
    (_command, glyph: string) => glyphs[glyph]!);
  const chargeIndex = field === "projectileCharge" ? "(?:1|₁|α|alpha|p|projectile)" : "(?:2|₂|N|t|target)";
  const charge = `q(?:${chargeIndex}|_(?:${chargeIndex}|\\{\\s*${chargeIndex}\\s*\\}))`;
  if (field === "projectileCharge" || field === "targetCharge") {
    if (unit === "1" || unit === undefined || unit === "dimensionless") {
      const countSymbol = field === "projectileCharge" ? /^(?:Z1|Z₁|Zα|Z_α|Z_\{α\})$/ : /^(?:Z|Z2|Z₂|ZN|Z_N|Z_\{N\})$/;
      return countSymbol.test(token) || new RegExp(`^(?:${charge})\\s*/\\s*e$`).test(token);
    }
    return unit === "e" && new RegExp(`^${charge}$`).test(token);
  }
  const notation: Record<Exclude<ObservableField, "projectileCharge" | "targetCharge">, RegExp> = {
    energy: /^(?:K|E|KE|E_k|E_\{\s*k\s*\})$/,
    kEnergyLength: /^k\s*(?:[·*]\s*)?e(?:²|\^\s*(?:2|\{\s*2\s*\}))$/,
    impactParameter: /^b$/,
    closestApproach: /^r(?:min|_min|_\{\s*min\s*\})$/,
    thetaDegrees: /^(?:θ|theta)$/,
  };
  return notation[field].test(token);
}


function displayedField(label: string): ObservableField | undefined {
  if (!label.trim()) return undefined;
  const fields: ObservableField[] = ["projectileCharge", "targetCharge", "energy", "kEnergyLength", "impactParameter", "closestApproach", "thetaDegrees"];
  const matches = fields.filter(field => provedCalloutSymbol(label, field, "e") || provedCalloutSymbol(label, field, "1"));
  if (matches.length === 1) return matches[0];
  const descriptions: Record<string, ObservableField> = {
    "projectile charge": "projectileCharge", "target charge": "targetCharge", "kinetic energy": "energy",
    "coulomb constant": "kEnergyLength", "coulomb coupling": "kEnergyLength", "impact parameter": "impactParameter",
    "closest approach": "closestApproach", "turning distance": "closestApproach", "deflection angle": "thetaDegrees",
  };
  const key = label.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
  return Object.hasOwn(descriptions, key) ? descriptions[key] : undefined;
}

/** Numeric caption syntax must not flatten a superscript into an extra
 * digit or erase a mathematical operator that the renderer retains. */
function displayedValue(text: string): string | undefined {
  const commands = [...text.matchAll(/\\([A-Za-z]+)/g)].map(match => match[1]);
  if (commands.some(command => !["mathrm", "textrm", "text", "circ", "degree"].includes(command!))) return undefined;
  const powers = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  return unwrapMathMarkup(text.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, digit => `^${powers.indexOf(digit)}`))
    .normalize("NFC").replace(/−/g, "-").replace(/\s+/g, " ").trim();
}

/** Every inferred operand retains the exact original words that entail it.
 * In particular b=0 is never a default, a label or a candidate source tag. */
export function readOriginalCoulombModel(question: string): SourceModel | null {
  if (sourceUnquotedText(question) !== question || question.includes("?")) return null;
  const inputs: Partial<Record<Field, Premise>> = {};
  let model: Evidence | undefined, request: Evidence | undefined, turning = false, outside = false;
  let alpha = false, nucleus = false, conflict = false;
  const number = (token: string): number => {
    try { preserveLiteral(token, "original Coulomb premise"); } catch { conflict = true; }
    return Number(token);
  };
  const add = (field: Field, value: number, unit: string, evidence: Evidence) => {
    if (!Number.isFinite(value) || inputs[field] && !same(inputs[field]!.value, value)) conflict = true;
    inputs[field] ??= { value, unit, evidence };
  };
  const requests = readSourceDrawingRequests(question);
  // A decimal point is not a sentence delimiter. Offsets always index the
  // original string, including source spelling and scientific notation.
  for (const sentence of question.matchAll(/(?:[^.!?;\n]|\.(?!\s|$))+/g)) {
    let start = sentence.index! + sentence[0].length - sentence[0].trimStart().length;
    let clause = sentence[0].trim();
    const heading = /^(?:Current )?(?:question|task):\s*/i.exec(clause);
    if (heading) { start += heading[0].length; clause = clause.slice(heading[0].length); }
    const evidence = (match: RegExpExecArray, name: string): Evidence => {
      const [a, b] = match.indices!.groups![name]!;
      return { start: start + a, end: start + b, text: question.slice(start + a, start + b) };
    };
    const prefix = MODEL_PREFIX.exec(clause);
    if (prefix) { model = evidence(prefix, "model"); start += prefix[0].length; clause = clause.slice(prefix[0].length); }
    const modelMatch = MODEL.exec(clause);
    if (modelMatch) { model = evidence(modelMatch, "model"); continue; }
    const match = ENCOUNTER.exec(clause) ?? PROJECTILE.exec(clause) ?? TARGET.exec(clause) ?? KINETIC.exec(clause) ??
      COULOMB_CONSTANT.exec(clause) ?? IMPACT.exec(clause) ?? HEAD_ON.exec(clause);
    if (match?.groups) {
      const g = match.groups;
      // The surrounding English grammar is case-insensitive, but E is not
      // the elementary-charge unit e. Preserve that distinction in every
      // projectile/target charge declaration as well as in the coupling.
      for (const name of ["q", "z"]) {
        const span = match.indices!.groups?.[name];
        if (span && clause.slice(span[1]).trimStart()[0] !== "e") return null;
      }
      if (g.q) add("projectileCharge", number(g.q), "1", evidence(match, "q"));
      if (g.z) add("targetCharge", number(g.z), "1", evidence(match, "z"));
      if (g.energy) add("energy", number(g.energy) * ENERGY[g.energyUnit!]!, "MeV", evidence(match, "energy"));
      if (g.k) {
        const [energyUnit, lengthUnit] = g.kUnit!.split(" ");
        add("kEnergyLength", number(g.k) * ENERGY[energyUnit!]! * LENGTH[lengthUnit!]!, "MeV fm", evidence(match, "k"));
      }
      if (g.impact) add("impactParameter", number(g.impact) * LENGTH[g.impactUnit!]!, "fm", evidence(match, "impact"));
      if (g.head) add("impactParameter", 0, "fm", { ...evidence(match, "head"), inference: "head_on_implies_zero_impact" });
      alpha ||= g.projectile?.toLowerCase() === "alpha particle";
      nucleus ||= g.target?.toLowerCase() === "nucleus";
      continue;
    }
    const asked = REQUEST.exec(clause);
    if (asked && requests.some(item => item.scope === "current" && item.start >= start && item.end <= start + clause.length)) {
      if (request) return null; // Multiple independent views need a richer proof.
      request = { start, end: start + clause.length, text: question.slice(start, start + clause.length) };
      turning = /turning point/i.test(asked.groups!.object!); outside = Boolean(asked.groups!.outside);
      const head = /^head[- ]on/i.exec(asked.groups!.object!);
      if (head) {
        const at = start + asked.indices!.groups!.object![0];
        add("impactParameter", 0, "fm", { start: at, end: at + head[0].length, text: question.slice(at, at + head[0].length), inference: "head_on_implies_zero_impact" });
      }
      continue;
    }
    return null;
  }
  if (!model || !request || conflict || Object.keys(inputs).length !== 5) return null;
  const complete = inputs as Record<Field, Premise>;
  if (alpha && complete.projectileCharge.value !== 2 || nucleus && (!Number.isInteger(complete.targetCharge.value) || complete.targetCharge.value <= 0)) return null;
  try { deriveRutherfordScattering(complete.projectileCharge.value, complete.targetCharge.value, complete.kEnergyLength.value, complete.energy.value, complete.impactParameter.value); } catch { return null; }
  return { model, request, turning, outside, inputs: complete };
}

function requestedTurning(question: string): boolean {
  return readSourceDrawingRequests(question).some(request => request.scope === "current" &&
    /\b(?:turning point|closest approach)\b/i.test(sourceUnquotedText(request.text))) &&
    /\b(?:Coulomb|fixed[- ]target|nucleus)\b|\bk\s*e(?:\^2|²)/i.test(sourceUnquotedText(question));
}
function texts(document: SceneDocument) {
  return [
    ...document.entities.flatMap(entity => typeof entity.label === "string" ? [{ text: entity.label, owners: [entity.id] }] : []),
    ...document.annotations.flatMap(annotation => {
      const quantity = annotation.quantityId ? document.quantities.find(item => item.id === annotation.quantityId) : undefined;
      const text = annotation.text || (quantity ? `${quantity.symbol ?? quantity.id}=${quantity.value} ${quantity.unit ?? "1"}` : undefined);
      return typeof text === "string" ? [{ text, owners: annotation.targetIds, annotationId: annotation.id }] : [];
    }),
    ...document.constructions.flatMap(construction => construction.operator === "label" && typeof construction.inputs.text === "string" ?
      [{ text: construction.inputs.text, owners: [construction.inputs.target, construction.inputs.at, construction.inputs.anchor].filter((id): id is string => typeof id === "string") }] : []),
  ];
}

/** A native operand can change representation, never its source meaning.
 * Omission is supported only for b=0 entailed by the closed head-on proof.
 * Keeping a quantity id here retains the ordinary accepted-plan audit. */
export function readOriginalCoulombOperand(document: SceneDocument, field: Field, ref: unknown): { value: number; id?: string } | null {
  const source = readOriginalCoulombModel(typeof document.source.question === "string" ? document.source.question : "");
  if (!source) return null;
  const expected = source.inputs[field];
  if (ref === undefined && field === "impactParameter" && expected.value === 0 && expected.evidence.inference === "head_on_implies_zero_impact")
    return { value: 0 };
  const quantity = typeof ref === "string" ? document.quantities.find(item => item.id === ref) : undefined;
  const charge = field === "projectileCharge" || field === "targetCharge";
  if (!quantity || typeof quantity.value !== "number" || !same(quantity.value, expected.value) ||
      !(charge ? quantity.unit === "e" || (quantity.unit ?? "1") === "1" : (quantity.unit ?? "1") === expected.unit) ||
      quantity.provenance !== undefined && quantity.provenance !== "given" && !(field === "impactParameter" && expected.evidence.inference && quantity.provenance === "derived") ||
      quantity.sourceText !== undefined && quantity.sourceText !== expected.evidence.text) return null;
  return { value: quantity.value, id: quantity.id };
}

function sourcePlanGivenIssues(document: SceneDocument, plan: TurnPlanV3 | null | undefined, source: SourceModel, question: string): SceneIssue[] {
  const programs = document.constructions.filter(item => item.operator === "rutherford_scattering");
  const fields = Object.keys(source.inputs) as Field[];
  const canonicalValue = (quantity: TurnPlanV3["givens"][number], field: Field): number | undefined => {
    if (typeof quantity.value !== "number" || !Number.isFinite(quantity.value)) return undefined;
    const unit = quantity.unit?.trim() ?? "1";
    const coupling = /^(\S+)\s+(\S+)$/.exec(unit);
    const factor = field === "projectileCharge" || field === "targetCharge" ? unit === "e" || unit === "1" ? 1 : undefined
      : field === "energy" ? ENERGY[unit] : field === "impactParameter" ? LENGTH[unit]
        : coupling ? ENERGY[coupling[1]!]! * LENGTH[coupling[2]!]! : undefined;
    return factor !== undefined && Number.isFinite(factor) ? quantity.value * factor : undefined;
  };
  return (plan?.givens ?? []).flatMap(quantity => {
    // A referenced native operand already has a proved physical slot. Extra
    // givens need an original-source evidence span identifying one slot;
    // neither an alias nor a coincident value establishes that identity.
    const bound = fields.filter(field => programs.some(program => program.inputs[field] === quantity.id));
    const quote = quantity.sourceText?.trim();
    const spans: Array<[number, number]> = [];
    if (quote) for (let start = question.indexOf(quote); start !== -1; start = question.indexOf(quote, start + 1))
      spans.push([start, start + quote.length]);
    const roles = bound.length ? bound : fields.filter(field => canonicalValue(quantity, field) !== undefined &&
      spans.some(([start, end]) => start < source.inputs[field].evidence.end && end > source.inputs[field].evidence.start));
    const named = [displayedField(quantity.symbol)].filter((field): field is ObservableField => field !== undefined);
    const alias = quantity.symbol.normalize("NFC").replace(/[₀-₉]/g, digit => `_${"₀₁₂₃₄₅₆₇₈₉".indexOf(digit)}`);
    const scalarAlias = /^[A-Za-zα-ωΑ-Ω][A-Za-zα-ωΑ-Ω0-9]*(?:_(?:[A-Za-zα-ωΑ-Ω0-9]+|\{[A-Za-zα-ωΑ-Ω0-9]+\}))?$/u.test(alias);
    const countOnly = roles.some(field => (field === "projectileCharge" || field === "targetCharge") &&
      provedCalloutSymbol(quantity.symbol, field, "1") && !provedCalloutSymbol(quantity.symbol, field, "e"));
    const symbolProved = (!countOnly || (quantity.unit?.trim() ?? "1") === "1") &&
      (scalarAlias || roles.some(field => provedCalloutSymbol(quantity.symbol, field, quantity.unit)));
    const proved = roles.length > 0 && symbolProved && (bound.length > 0 || roles.length === 1) && named.every(name => roles.every(field => field === name)) && roles.every(field => {
      const value = canonicalValue(quantity, field);
      return value !== undefined && same(value, source.inputs[field].value);
    });
    return proved ? [] :
      [fatal("coulomb_plan_given_unproved", `Planner given ${quantity.id} must retain one original-source physical input role, value and unit, including unused aliases.`)];
  });
}

function nativeProof(document: SceneDocument, construction: SceneConstruction, source: SourceModel): SceneIssue[] {
  const issues: SceneIssue[] = [];
  for (const field of Object.keys(source.inputs) as Field[]) {
    const expected = source.inputs[field], ref = construction.inputs[field];
    // Slot meaning, source numeric value and unit all agree independently of
    // ids/symbols/tags. A unit wrapper/literal cannot masquerade as a native ref.
    if (!readOriginalCoulombOperand(document, field, ref)) {
      issues.push(fatal("coulomb_source_operand_unproved", `${field} must mean the original source's ${expected.value} ${expected.unit}; ids, candidate labels and planner givens supply no physical premise.`, construction));
    }
  }
  if (issues.length) return issues;
  try {
    const planar = readSourcePlanarGeometry(document);
    const context = { number: (value: unknown) => validationNumber(value, document), geometry: () => undefined,
      point: (id: unknown) => {
        const point = planar.point(id);
        if (!point || point.frame !== "world:") throw Error("Unproved native origin frame");
        return point;
      } };
    const origin = placement(construction.inputs.origin, "origin", context);
    const outputs = evaluateAtomicConstruction(construction.operator, construction.inputs, context, document);
    const geometry = outputs[0];
    const v = source.inputs;
    const theorem = deriveRutherfordScattering(v.projectileCharge.value, v.targetCharge.value, v.kEnergyLength.value, v.energy.value, v.impactParameter.value);
    if (!geometry || geometry.kind !== "path" || outputs.length !== 1 || construction.outputs.length !== 1 ||
      document.entities.find(entity => entity.id === construction.outputs[0])?.kind !== "polyline" ||
      !document.requiredEntityIds.includes(construction.outputs[0]!) ||
      !document.revealGroups.some(group => group.entityIds.includes(construction.outputs[0]!))) throw Error("The physical path must be a required revealed output");
    const info = geometry.atomicObservable;
    if (!same(info.values.closestApproach!, theorem.closestApproach) || !same(info.values.thetaDegrees!, theorem.thetaDegrees)) throw Error("Native observable differs from original-source theorem");
    if (!info.labels.some(label => label.text === `r_min=${compactNumber(theorem.closestApproach)} fm` && label.resultFields?.includes("closestApproach")) ||
      !info.labels.some(label => label.text === `θ=${compactNumber(theorem.thetaDegrees)}°` && label.resultFields?.includes("thetaDegrees"))) throw Error("Executed native result labels must retain the source-recomputed observable and physical unit");
    if (v.impactParameter.value === 0) {
      const scale = construction.inputs.displayScale === undefined ? 1 / theorem.closestApproach : Number(construction.inputs.displayScale);
      const [start, endpoint] = geometry.points;
      const marks = info.marks ?? [];
      if (!geometry.directed || geometry.points.length !== 2 || !start || !endpoint || start.x <= endpoint.x ||
        !same(Math.hypot(endpoint.x - origin.x, endpoint.y - origin.y) / scale, theorem.closestApproach) ||
        geometry.points.some(point => !same(point.y - origin.y, 0) || (point.x - origin.x) / scale < theorem.closestApproach * (1 - 1e-10)) ||
        !marks.some(mark => mark.kind === "point" && mark.points.some(point => point.x === endpoint.x && point.y === endpoint.y)) ||
        !info.labels.some(label => /turning point/i.test(label.text) && label.resultFields?.includes("closestApproach"))) throw Error("The executed native incoming path must terminate at its source-computed, marked turning point");
      const setupLabels = [`${v.targetCharge.value > 0 ? "Positive" : "Negative"} point target; size not modelled`,
        `Incoming ${v.projectileCharge.value > 0 ? "positive" : "negative"} projectile`];
      if (!marks.some(mark => mark.kind === "point" && mark.points.some(point => point.x === start.x && point.y === start.y)) ||
        !setupLabels.every(text =>
          info.labels.some(label => label.text === text && !label.resultFields?.length)))
        throw Error("The executed head-on setup must retain the source charge signs on the target and incoming projectile");
    }
    // Model disclosure is regenerated by the operator, never certified by a
    // candidate caption or a circle called 'nucleus'. The target is a point.
    if (!info.labels.some(label => /classical.*fixed heavy.*point.*Coulomb/i.test(label.text)) ||
      !(info.marks ?? []).some(mark => mark.kind === "point" && mark.points.some(point => point.x === origin.x && point.y === origin.y)) ||
      (info.marks ?? []).some(mark => mark.kind === "circle")) throw Error("The native figure must disclose its classical fixed-heavy-point-target Coulomb model");
  } catch (error) {
    issues.push(fatal("coulomb_native_event_unproved", error instanceof Error ? error.message : String(error), construction));
  }
  return issues;
}

/** Refusal-only original-source applicability + requested-event obligation.
 * It applies even to generic ink, absent planner/IR inventories and every
 * representation tier. It never selects a family or authors a scene. */
export function validateSourceCoulombObligation(document: SceneDocument, plan?: TurnPlanV3 | null, originalQuestion?: string): SceneIssue[] {
  if (document.visualDecision.mode !== "scene") return [];
  const question = originalQuestion ?? plan?.question ?? (typeof document.source.question === "string" ? document.source.question : "");
  const programs = document.constructions.filter(construction => construction.operator === "rutherford_scattering");
  const requested = requestedTurning(question);
  const source = readOriginalCoulombModel(question);
  // Every supported request for this proved source model carries its physical
  // obligation, including a trajectory request without a named turning point.
  if (!programs.length && !requested && !source) return [];
  if (typeof document.source.question !== "string" || document.source.question.trim().replace(/\s+/g, " ") !== question.trim().replace(/\s+/g, " "))
    return [fatal("coulomb_original_source_mismatch", "A candidate restatement cannot replace the original Coulomb source question.")];
  if (!source) return [fatal("coulomb_original_model_unproved", "Original-source applicability, repulsive charge ownership, kinetic energy, Coulomb coupling and impact parameter need one unambiguous classical fixed-heavy-target declaration. Unsupported source syntax/model remains unproved.")];
  const issues = [...programs.flatMap(program => nativeProof(document, program, source)), ...sourcePlanGivenIssues(document, plan, source, question)];
  // This closed source model supplies operands and a requested result, not a
  // stated scattering angle or closest distance. A planner cannot relabel a
  // computed field as a given to release its answer during the introduction.
  for (const program of programs) {
    const results = program.inputs.resultBindings as Record<string, unknown> | undefined;
    for (const field of ["closestApproach", "thetaDegrees"]) {
      const id = results?.[field];
      if (typeof id === "string" && (plan?.givens.some(quantity => quantity.id === id) ||
          document.quantities.some(quantity => quantity.id === id && quantity.provenance === "given")))
        issues.push(fatal("coulomb_result_given_unproved", "A source-computed Coulomb result cannot acquire given status from the planner or candidate.", program));
    }
  }
  if ((requested || source) && !programs.length) issues.push(fatal("coulomb_requested_event_unproved", "The requested source-bound turning/closest-approach event needs a proved physical program; a collision before/after view or static pair cannot discharge it."));
  // Optional captions cannot override the proved program. All displayed
  // physical numbers have closed observable syntax, a checked owner and a
  // source-derived value/unit, including captions on generic extra ink.
  const nativeOwners = new Set(programs.flatMap(program => program.outputs));
  const v = source.inputs;
  const theorem = deriveRutherfordScattering(v.projectileCharge.value, v.targetCharge.value, v.kEnergyLength.value, v.energy.value, v.impactParameter.value);
  // Quantity-only callouts are rendered numbers too. Reconstruct their native
  // field meaning instead of treating a quantityId/provenance as authority.
  const checkedQuantityRows = new Set<string>();
  for (const annotation of document.annotations.filter(item => item.quantityId !== undefined)) {
    const quantity = document.quantities.find(item => item.id === annotation.quantityId);
    const bindings = programs.flatMap(program => {
      const input = (Object.keys(v) as Field[]).filter(field => program.inputs[field] === annotation.quantityId).map(field => ({ ...v[field], field }));
      const results = program.inputs.resultBindings as Record<string, unknown> | undefined;
      const output = (["closestApproach", "thetaDegrees"] as const).flatMap(field => results?.[field] === annotation.quantityId
        ? [{ field, value: field === "closestApproach" ? theorem.closestApproach : theorem.thetaDegrees,
          unit: field === "closestApproach" ? "fm" : "deg" }] : []);
      return [...input, ...output].map(binding => ({ ...binding, owner: program.outputs[0] }));
    });
    const binding = bindings[0];
    // The closed source proof represents its two charges as counts in e.
    // A bound charge input retained in unit e has the same count, while the
    // accepted-plan unit audit still rejects representation-only mutations.
    const factor = binding?.unit === "1" && quantity?.unit === "e" ? 1
      : binding?.unit === "fm" && typeof quantity?.unit === "string" ? LENGTH[quantity.unit]
      : binding?.unit === "MeV" && typeof quantity?.unit === "string" ? ENERGY[quantity.unit]
        : binding?.unit === "deg" && quantity?.unit === "rad" ? 180 / Math.PI
          : quantity?.unit === binding?.unit || quantity?.unit === undefined && binding?.unit === "1" ? 1 : undefined;
    if (!quantity || typeof quantity.value !== "number" || bindings.length !== 1 || factor === undefined || !same(quantity.value * factor, binding!.value) ||
      annotation.targetIds.length !== 1 || annotation.targetIds[0] !== binding!.owner)
      issues.push(fatal("coulomb_displayed_binding_unproved", "A displayed quantity binding must retain its independently recomputed native field value, unit and owner."));
    else {
      const name = annotation.text ? /^\s*([^=≈:]+)\s*[=≈:]/u.exec(annotation.text.normalize("NFC"))?.[1] : undefined;
      if (annotation.kind === "callout" && !annotation.text) {
        if (provedCalloutSymbol(quantity.symbol, binding!.field, quantity.unit)) checkedQuantityRows.add(annotation.id);
        else issues.push(fatal("coulomb_displayed_identity_unproved", "A complete quantity symbol must denote its proved native field without extra assignments, prose, powers or decorations."));
      } else if (name !== undefined && displayedField(name) !== binding!.field)
        issues.push(fatal("coulomb_displayed_identity_unproved", "A displayed quantity name must denote its proved native physical field, even when another field has the same value."));
    }
  }
  const claims = texts(document);
  // A verified repulsive point-target program does not certify contact or a
  // collision drawn beside it. Check authored roles as well as visible text
  // before normalization can drop the extra caption or geometry.
  const collisionAcknowledgement = /^(?:no (?:collision|contact)(?: occurs)?|(?:the )?(?:collision|contact)(?: claim| request| model)? (?:is |was )?(?:rejected|retracted|withdrawn|cancelled|canceled)|(?:the )?(?:previous|historical|reported|rejected|retracted|cancelled|canceled) (?:collision|contact)(?: claim| model| event)?)$/i;
  const collisionClaim = (value: string) => normal(sourceUnquotedText(value)).split(/[.;\n]|\b(?:but|and)\b/i).some(clause => {
    const text = clause.trim();
    if (!/\b(?:collision|collid(?:e|es|ed|ing)|contact)\b/i.test(text)) return false;
    // A negated, quoted or explicitly withdrawn/reported caption asserts no
    // current event. Closed forms avoid letting a negation elsewhere mask a
    // second, positive collision claim in the same authored caption.
    return !collisionAcknowledgement.test(text);
  });
  if (document.constructions.some(construction => construction.operator === "collision") ||
      document.entities.some(entity => collisionClaim(entity.role ?? "")) ||
      claims.some(claim => collisionClaim(claim.text)))
    issues.push(fatal("coulomb_collision_claim_unproved", "A repulsive point-target Coulomb trajectory proves no contact/collision event; extra collision claims and geometry remain unproved."));
  if (document.entities.some(entity => ["circle", "ellipse", "arc"].includes(entity.kind) &&
    /\b(?:nucleus|nuclear|target|surface|boundary)\b/i.test(`${entity.role} ${entity.label ?? ""}`)))
    issues.push(fatal("coulomb_finite_body_claim_unproved", "A finite target outline needs original-source size authority; the point-target model supplies none."));
  for (const claim of claims) {
    const text = claim.text.normalize("NFC").replace(/−/g, "-").replace(/\s+/g, " ").trim();
    if (/\b(?:outside (?:the )?nucleus|nuclear (?:radius|surface|boundary)|nucleus surface)\b/i.test(text))
      issues.push(fatal("coulomb_finite_body_claim_unproved", "No finite nuclear radius is supplied/proved; point-target geometry cannot certify an outside-surface assertion."));
    const equation = /^\s*([^=≈:]+)\s*[=≈:]\s*(.*)$/u.exec(text);
    const checkedQuantityRow = "annotationId" in claim && typeof claim.annotationId === "string" && checkedQuantityRows.has(claim.annotationId);
    const field = !checkedQuantityRow && equation ? displayedField(equation[1]!) : undefined;
    const recognized = checkedQuantityRow || field !== undefined;
    if (field !== undefined) {
      const expected = field === "closestApproach" ? theorem.closestApproach : field === "thetaDegrees" ? theorem.thetaDegrees : source.inputs[field].value;
      const dimension = field === "projectileCharge" || field === "targetCharge" ? "charge" : field === "energy" ? "energy"
        : field === "kEnergyLength" ? "coupling" : field === "thetaDegrees" ? "angle" : "length";
      const literal = displayedValue(equation![2]!);
      const value = literal === undefined ? null : new RegExp(`^(${NUMBER})(?:\\s*(fm|pm|nm|m|eV|keV|MeV|GeV|J|e|1|deg|°|rad|MeV fm|keV fm|eV fm|eV nm|J m))?$`).exec(literal);
      const unit = value?.[2] ?? "";
      const chargeName = dimension !== "charge" || (unit === "e" ? provedCalloutSymbol(equation![1], field, "e") ||
        /^(?:projectile charge|target charge)$/i.test(equation![1]!.trim()) :
        (unit === "1" || !unit) && provedCalloutSymbol(equation![1], field, "1"));
      const factor = dimension === "length" ? LENGTH[unit] : dimension === "energy" ? ENERGY[unit] : dimension === "charge" ? chargeName ? 1 : undefined
        : dimension === "angle" ? unit === "rad" ? 180 / Math.PI : unit === "deg" || unit === "°" ? 1 : undefined
          : unit.includes(" ") ? ENERGY[unit.split(" ")[0]!]! * LENGTH[unit.split(" ")[1]!]! : undefined;
      if (!value || factor === undefined || !same(Number(value[1]) * factor, expected) || claim.owners.length !== 1 || !nativeOwners.has(claim.owners[0]!))
        issues.push(fatal("coulomb_displayed_observable_unproved", `Displayed ${text} needs the correct original-source value, physical unit and native owner; provenance cannot supply them.`));
    }
    // Authored event captions are not the native event mark. In particular,
    // attaching this name to a generic point supplies neither the computed
    // event location nor its answer-release restriction. The operator emits
    // its own verified/staged event label; ordinary numeric fields above keep
    // their separately checked source value and owner.
    if (!recognized && /\b(?:turning point|closest approach|turning distance)\b|\br_?min\b/i.test(text))
      issues.push(fatal("coulomb_event_caption_unproved", "An authored event caption cannot replace or duplicate the source-computed native event mark and its answer staging."));
    const physicalModelClaim = /\b(?:recoils?|recoil|attract(?:ion|ive|s|ed|ing)?|repel(?:s|led|ling)?|repulsion|repulsive|nuclear forces?|relativistic|nonrelativistic|classical|fixed|stationary|moving target|target moves|target is moving)\b/i.test(text);
    const supportedModelCaptions = new Set([
      "repulsive coulomb model", "classical repulsive coulomb model", "fixed heavy target",
      "repulsion", "coulomb repulsion", "electrostatic repulsion", "no attraction",
      "trajectory", "projectile trajectory", "coulomb trajectory",
      "the target is fixed", "no target recoil", "nuclear forces neglected", normal(source.model.text).toLowerCase(),
    ]);
    if (physicalModelClaim && !recognized && !supportedModelCaptions.has(text.toLowerCase()))
      issues.push(fatal("coulomb_model_caption_unproved", "A physical model caption must agree with the proved classical repulsive fixed-heavy-target model; unsupported qualifications remain unproved."));
    // Unknown physical numeric prose is not silently promoted to evidence.
    if (!recognized && /\d/.test(text) && /\b(?:fm|pm|nm|m|eV|keV|MeV|GeV|J|rad|deg)\b|\d\s*e\b|\bcharge\b|\b(?:approach|turning|Coulomb)\b|r_?min|[θ°]/i.test(text))
      issues.push(fatal("coulomb_displayed_observable_unproved", "Unsupported physical numeric caption syntax remains unproved."));
    // The source theorem proves the native path and regenerated facts, not
    // arbitrary authored prose. A keyword list cannot establish that an
    // otherwise unparsed caption agrees with the physical model.
    const unquoted = sourceUnquotedText(text).normalize("NFC").replace(/\s+/g, " ").trim();
    const nonCurrentCollision = collisionAcknowledgement.test(unquoted) ||
      !unquoted && /\b(?:collision|contact)\b/i.test(text);
    if (!recognized && !supportedModelCaptions.has(text.toLowerCase()) && !nonCurrentCollision)
      issues.push(fatal("coulomb_caption_unproved", "Use the native source-computed labels or a checked field/model caption; unsupported authored prose supplies no physical authority."));
  }
  if (source.outside) issues.push({ code: "coulomb_finite_body_unproved", severity: "warning",
    message: "This source supplies no nuclear radius. A point-target Coulomb program cannot certify an outside-finite-nucleus assertion." });
  return issues;
}

/** Candidate text can disappear during normalization/pruning. Validate its
 * submitted physical claims against the same source theorem first. Structural
 * failures still belong to the ordinary validator; raw records execute no ink. */
export function validateSubmittedCoulombSceneTruth(candidate: unknown, plan: TurnPlanV3, question: string): SceneIssue[] {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
  const raw = candidate as Record<string, unknown>;
  const records = (value: unknown): Record<string, unknown>[] => Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
  if (!requestedTurning(question) && !readOriginalCoulombModel(question) && !records(raw.constructions).some(item => item.operator === "rutherford_scattering")) return [];
  const checked = validateSceneDocument(candidate);
  if (!checked.document) return [];
  const restore = <T extends { id: string }>(normalized: T[], submitted: unknown, key: string): T[] => normalized.map(item => {
    const original = records(submitted).find(record => record.id === item.id);
    return typeof original?.[key] === "string" ? { ...item, [key]: original[key] } : item;
  });
  const document = { ...checked.document,
    entities: restore(checked.document.entities, raw.entities, "label"),
    annotations: restore(checked.document.annotations, raw.annotations, "text"),
  };
  return validateSourceCoulombObligation(document, plan, question);
}
