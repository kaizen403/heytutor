/** Private composition proof for quantities on a freshly source-rebuilt scene.
 * Numeric coincidence and a caller's ID never establish semantic ownership.
 */
import { convertMeasuredValue, type TurnPlanV3 } from "../contracts/contractsV3";
import type { ProblemIR } from "../ir/problemIR";
import { readSourcePhysicalPointDeclarations } from "../ir/sourcePhysicalPointDeclarations";
import { sourceUnquotedText } from "../document/sourceRequestScope";
import { readCurrentMeasurementFacts, type SourceMeasurementFact } from "../document/sourceMeasurementFacts";
import { sourceObservableQuantityProved } from "../document/sourceObservableUnitObligation";
import { readOriginalCoulombModel } from "../physics/sourceCoulombObligation";
import type { RenderPrimitive, SceneDocument, SceneIssue } from "../types";

export interface NativeGuideSourceQuantityBinding {
  planQuantityId: string; nativeQuantityId: string; symbol: string;
  ownerIds: string[]; role: string; provenance: "given" | "derived" | "unknown";
  sourceQuote?: string;
  sourceSpan?: SourceMeasurementFact;
}
export interface NativeGuideSourceBindings {
  bindings: NativeGuideSourceQuantityBinding[]; issues: SceneIssue[];
}
const spelling = (value: string) => value.normalize("NFKC").replace(/\\(?:mathrm|text)\s*/gu, "").replace(/[{}\s]/gu, "");
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const NON_FACT_PREFIX = /\b(?:no|not|never|false|falsely|incorrect|ignore|ignored|disregard|retract(?:ed)?|withdrawn|cancelled|hypothetical|example|reported|claims?|says?|according|if|unless|suppose|would|could|might|previously|earlier|obsolete|superseded)\b/iu;
const NON_FACT_STATEMENT = /\b(?:false|falsely|incorrect|ignore|ignored|disregard|retract(?:ed)?|withdrawn|cancelled|hypothetical|example|reported|claims?|says?|according|previously|earlier|obsolete|superseded)\b|\bnot\s+(?:(?:a|the|current|positive)\s+)*(?:source\s+)?(?:fact|given|declaration|measurement|reading|true)\b/iu;
function positiveSourceSpan(question: string, start: number, end: number): boolean {
  const unquoted = sourceUnquotedText(question);
  if (unquoted.slice(start, end) !== question.slice(start, end)) return false;
  const boundary = [...question.slice(0, start).matchAll(/[!?;\n]|\.(?=\s|$)/gu)].at(-1);
  const clauseStart = boundary ? boundary.index! + boundary[0].length : 0;
  const following = /[!?;\n]|\.(?=\s|$)/u.exec(question.slice(end));
  const clauseEnd = following ? end + following.index : question.length;
  return !NON_FACT_PREFIX.test(unquoted.slice(clauseStart, start)) && !NON_FACT_STATEMENT.test(unquoted.slice(clauseStart, clauseEnd));
}
function positiveSourceQuote(question: string, quote: string): boolean {
  if (!quote.trim()) return false;
  const start = question.indexOf(quote);
  if (start < 0 || question.indexOf(quote, start + 1) !== -1 || sourceUnquotedText(question).slice(start, start + quote.length) !== quote) return false;
  return positiveSourceSpan(question, start, start + quote.length);
}
/** A result binding retains its accepted unit scale and SI letter case.
 * Whitespace may vary; token boundaries such as m s versus ms may not. */
function resultUnitSpelling(unit: string | undefined): string {
  return unit?.trim().replace(/\s+/gu, " ") || "1";
}
function problemRole(problem: ProblemIR | null, id: string, symbol: string, unit: string | undefined): boolean {
  return problem?.solveRequests.some(request => request.resultBinding?.turnPlanQuantityId === id &&
    spelling(request.resultBinding.symbol) === spelling(symbol) &&
    resultUnitSpelling(request.resultBinding.unit) === resultUnitSpelling(unit)) ?? false;
}
function sourceRequestsUnknown(question: string, native: SceneDocument["quantities"][number], symbol: string, document: SceneDocument): boolean {
  // This private composition check follows complete fresh native source proof.
  // Only the source-requested closest-approach output gets this result role;
  // a tag, name, coincident scalar or unbound operator result cannot supply it.
  const coulomb = readOriginalCoulombModel(question);
  if (coulomb && (coulomb.turning || /closest approach/i.test(coulomb.request.text)) &&
    native.provenance === "derived" && native.unit === "fm" &&
    document.constructions.some(step => step.operator === "rutherford_scattering" &&
      typeof step.inputs.resultBindings === "object" && step.inputs.resultBindings !== null &&
      "closestApproach" in step.inputs.resultBindings && step.inputs.resultBindings.closestApproach === native.id)) return true;
  if (sourceObservableQuantityProved(question, { ...native, symbol })) return true;
  if (native.nativeSourceRole === "unique_source_linear_coordinate" || native.nativeSourceRole === "unique_source_linear_boundary") return true;
  const points = readSourcePhysicalPointDeclarations(question);
  if (!points) return false;
  const wanted = spelling(symbol);
  return wanted === "M" ? points.totalMassRequested : points.centre.components.some(component =>
    [`${component}_CM`, `${component}_${points.centre.label}`, `${points.centre.label}_${component}`, `${points.centre.label}${component}`].includes(wanted));
}
function identity(document: SceneDocument, quantity: SceneDocument["quantities"][number]) {
  const symbol = typeof quantity.symbol === "string" ? quantity.symbol : "";
  const owners = document.annotations.filter(annotation => annotation.quantityId === quantity.id).flatMap(annotation => annotation.targetIds);
  if (typeof quantity.nativeOwnerId === "string" && document.entities.some(entity => entity.id === quantity.nativeOwnerId)) owners.push(quantity.nativeOwnerId);
  const aliases = new Set<string>(symbol ? [spelling(symbol)] : []), sourceNames = new Set<string>(aliases);
  // A native side label owns its two actual segment endpoints. The complete
  // source/geometry proof has already run; a matching numeric label alone does not.
  for (const entity of document.entities) {
    if (!symbol || !entity.label || !new RegExp(`^${escape(symbol)}\\s*=` , "u").test(entity.label)) continue;
    const segment = document.constructions.find(construction => construction.operator === "segment" && construction.outputs.includes(entity.id));
    const start = segment?.inputs.start, end = segment?.inputs.end;
    if (typeof start !== "string" || typeof end !== "string" || entity.role !== `side ${start}${end}`) continue;
    owners.push(entity.id);
    sourceNames.delete(spelling(symbol));
    for (const name of [`${start}${end}`, `${end}${start}`]) { aliases.add(name); sourceNames.add(name); }
  }
  return { symbol, aliases, sourceNames, owners: [...new Set(owners)].sort() };
}
/** Complete direct scalar declarations, including their unit and token boundary.
 * Other source forms need a fresh native quote/owner witness, never a numeric substring. */
function scalarQuoteWitness(question: string, quote: string, sourceNames: Set<string>, native: SceneDocument["quantities"][number]): SourceMeasurementFact | null {
  if (typeof native.value !== "number" || !quote.trim()) return null;
  const spans: Array<{ start: number; end: number }> = [];
  const unquoted = sourceUnquotedText(question);
  for (let start = question.indexOf(quote); start >= 0; start = question.indexOf(quote, start + 1)) {
    if (unquoted.slice(start, start + quote.length) === quote) spans.push({ start, end: start + quote.length });
  }
  if (!spans.length) return null;
  const program = readCurrentMeasurementFacts(question, {
    constructors: [{ noun: "triangle", name: "ABC" }], aliases: [[...sourceNames]],
  });
  if (!program) return null;
  return program.facts.find(fact => sourceNames.has(fact.owner) && spans.some(span => fact.start >= span.start && fact.end <= span.end) &&
    convertMeasuredValue(fact.value, fact.unit, native.unit) === native.value) ?? null;
}
/** One source-given role proof, reused by native aggregate owner checks. The
 * document must be freshly source-rebuilt; this is not scene admission. */
export function nativeGivenSourceRoleProved(input: {
  question: string; document: SceneDocument; given: TurnPlanV3["givens"][number];
}): boolean {
  const { question, document, given } = input;
  const candidates = document.quantities.map(quantity => ({ quantity, role: identity(document, quantity) }))
    .filter(candidate => candidate.role.aliases.has(spelling(given.symbol)))
    .filter(candidate => sourceGivenQuoteSelects(question, given, candidate.quantity));
  if (candidates.length !== 1) return false;
  const native = candidates[0]!, source = native.quantity;
  if (source.provenance === "derived" || typeof source.value !== "number") return false;
  const value = convertMeasuredValue(given.value, given.unit, source.unit);
  if (value === null || value !== source.value && Math.abs(value - source.value) > 64 * Number.EPSILON * Math.abs(source.value)) return false;
  const quote = given.sourceText ?? "", nativeQuote = typeof source.sourceText === "string" ? source.sourceText : "";
  if (!nativeQuote) return scalarQuoteWitness(question, quote, native.role.sourceNames, source) !== null;
  const start = question.indexOf(quote) + quote.indexOf(nativeQuote);
  return positiveSourceQuote(question, quote) && quote.includes(nativeQuote) && !NON_FACT_PREFIX.test(nativeQuote) &&
    positiveSourceSpan(question, start, start + nativeQuote.length);
}

/** Timing only, on the freshly rebuilt document. A given label needs its
 * exact original declaration, unit/value and real owner; numeric equality
 * elsewhere in the scene cannot move a computed answer into setup. */
export function nativeGivenLabelTimingProved(input: {
  question: string; document: SceneDocument; label: Pick<RenderPrimitive, "entityId" | "text">;
}): boolean {
  const { question, document, label } = input;
  if (!label.text) return false;
  const candidates = document.quantities.filter(quantity => quantity.provenance === "given" &&
    typeof quantity.value === "number" && typeof quantity.unit === "string" && typeof quantity.symbol === "string" &&
    typeof quantity.sourceText === "string" && spelling(quantity.sourceText) === spelling(label.text!) &&
    identity(document, quantity).owners.includes(label.entityId));
  if (candidates.length !== 1) return false;
  const quantity = candidates[0]!;
  const declaration = new RegExp(`^\\s*${escape(String(quantity.symbol))}\\s*=\\s*([+−-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+−-]?\\d+)?)\\s*(.*?)\\s*$`, "u").exec(String(quantity.sourceText));
  if (!declaration || convertMeasuredValue(Number(declaration[1]!.replaceAll("−", "-")), declaration[2] || "1", quantity.unit) !== quantity.value) return false;
  return nativeGivenSourceRoleProved({ question, document, given: { id: quantity.id,
    symbol: String(quantity.symbol), value: Number(quantity.value), unit: String(quantity.unit), sourceText: String(quantity.sourceText), provenance: "given" } });
}

/** Repeated symbols (for example two requested principal states both called
 * n) need their distinct original quote and native owner. This disambiguates
 * by source identity, never by the proposed scalar value or a caller id. */
function sourceGivenQuoteSelects(question: string, given: { id: string; sourceText?: string }, native: SceneDocument["quantities"][number]): boolean {
  if (typeof native.sourceText !== "string") return true;
  const quote = given.sourceText ?? "";
  return positiveSourceQuote(question, quote) && quote.includes(native.sourceText);
}

/** Called only after independent full-source replay/native source programs.
 * This leaf emits no geometry and confers no diagram/raster admission. */
export function certifyNativeGuideSourceBindings(input: {
  question: string; document: SceneDocument; plan: TurnPlanV3 | null; problem: ProblemIR | null;
}): NativeGuideSourceBindings {
  const { question, document, plan, problem } = input;
  if (!plan) return { bindings: [], issues: [] };
  const bindings: NativeGuideSourceQuantityBinding[] = [], issues: SceneIssue[] = [];
  const fail = (quantityId: string, code: string, message: string) => issues.push({ code, message, severity: "fatal", path: `quantities.${quantityId}` });
  const natives = document.quantities.map(quantity => ({ quantity, identity: identity(document, quantity) }));
  for (const [role, rows] of [["given", plan.givens], ["derived", plan.derived], ["unknown", plan.unknowns]] as const) {
    for (const quantity of rows) {
      const wanted = spelling(quantity.symbol);
      const candidates = natives.filter(native => native.identity.aliases.has(wanted))
        .filter(native => role !== "given" || sourceGivenQuoteSelects(question, quantity, native.quantity));
      if (candidates.length !== 1) { fail(quantity.id, "guide_plan_operand_unproved", "Each scalar requires one unique native symbol/owner role, independently of its caller ID or value"); continue; }
      const native = candidates[0]!, source = native.quantity;
      if (role === "given") {
        if (source.provenance === "derived") { fail(quantity.id, "guide_plan_source_role_mismatch", "A computed native result cannot become a supplied source fact"); continue; }
        if (!("sourceText" in quantity) || typeof quantity.sourceText !== "string" || !nativeGivenSourceRoleProved({ question, document, given: quantity })) {
          fail(quantity.id, "guide_plan_source_role_mismatch", "The complete given quote must own this native source quantity and its measurement"); continue;
        }
      } else if (role === "derived" && (source.provenance !== "derived" || !problemRole(problem, quantity.id, quantity.symbol, quantity.unit))) {
        fail(quantity.id, "guide_plan_result_role_unproved", "Computed scalars require the complete native/source result request identity"); continue;
      } else if (role === "unknown" && (source.provenance !== "derived" || !sourceRequestsUnknown(question, source, quantity.symbol, document) ||
        !problemRole(problem, quantity.id, quantity.symbol, quantity.unit) || !plan.derived.some(row => row.id === quantity.id && spelling(row.symbol) === wanted))) {
        fail(quantity.id, "guide_plan_result_role_unproved", "Unknown scalars must retain their recomputed result and original requested identity"); continue;
      }
      bindings.push({ planQuantityId: quantity.id, nativeQuantityId: source.id, symbol: quantity.symbol,
        ownerIds: native.identity.owners, role: native.identity.owners.length ? "owned_native_measurement" : "native_source_scalar",
        provenance: role, ...(role === "given" && "sourceText" in quantity && typeof quantity.sourceText === "string" ? {
          sourceQuote: quantity.sourceText,
          ...(typeof source.sourceText !== "string" ? { sourceSpan: scalarQuoteWitness(question, quantity.sourceText, native.identity.sourceNames, source) ?? undefined } : {}),
        } : {}) });
    }
  }
  return { bindings, issues };
}
