import type { TurnPlanV3 } from "../contracts/contractsV3";
import { compileSceneDocument } from "../compile/compiler";
import { readSourceInstantaneousActivity, type SourceInstantaneousActivityCertificate } from "../physics/sourceInstantaneousActivity";
import { readSourceDrawingRequests, sourceUnquotedText } from "./sourceRequestScope";
import { convertObservableValue, decodeObservableUnit, observableMathText, readObservableScalar, type ObservableUnit } from "./sourceObservableUnits";
import type { SceneDocument, SceneIssue } from "../types";

interface Span { start: number; end: number }
interface Obligation extends Span { text: string; owner: string; units: ObservableUnit[]; supported: boolean }
interface ValueProof {
  originalQuestion: string;
  requestedOwner: string;
  request: Span;
  value: number;
  unit: ObservableUnit;
  evidence: { kind: "original_literal"; text: string } | SourceInstantaneousActivityCertificate;
}
interface Display { value: number; unit: ObservableUnit; tolerance: number; owner?: string }
const NUMBER = String.raw`[+\-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+\-]?\d+)?`;
const name = (raw: string) => observableMathText(raw).replace(/^the\s+/i, "").trim();
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const sameQuestion = (a: string, b: string) => a.trim().replace(/\s+/g, " ") === b.trim().replace(/\s+/g, " ");

/** Narrow request grammar, independent of figure families, IDs and inventories.
 * An explicit pair whose operands/owner cannot be read remains an obligation,
 * with no value authority. Only affirmative current source requests participate. */
export function readSourceObservableUnitObligations(question: string): Obligation[] {
  // Legacy quantity-audit callers can provide an inventory without a question.
  // No independent source means no additional observable value authority.
  if (typeof question !== "string") return [];
  return readSourceDrawingRequests(question).filter(request => request.scope === "current" &&
    ["show", "label", "mark"].includes(request.action)).flatMap(request => {
    let body = request.text.slice(request.action.length).trim()
      .replace(/\s+without\s+swapping\s+(?:their|the)\s+values\s*$/i, "")
      .replace(/[,\s]+(?:and|then|also)\s*$/i, "");
    const indirect = /^(?:the\s+)?(?:two|both)\s+unit\s+labels$/i.test(body);
    if (indirect) {
      // The immediately preceding calculation is itself a current imperative.
      // Decimal points are not sentence boundaries. No earlier history is used.
      const before = sourceUnquotedText(question.slice(0, request.start)).trim();
      const clauses = before.split(/[;!?\n]|\.(?=\s|$)/).map(value => value.trim()).filter(Boolean);
      const previous = clauses.at(-1) ?? "";
      const imperative = /^(?:please\s+)?(?:calculate|compute|find|determine|compare)\s+(.+)$/i.exec(previous);
      body = imperative?.[1] ?? "";
    }
    const activityComparison = /^activity\s+in\s+(.+?)\s+and\s+compare\s+(?:it|activity)\s+with\s+(?:the\s+)?decay\s+rate\s+(per\s+\w+|in\s+.+)$/i.exec(body);
    let owner = "", rawUnits: string[] = [];
    if (activityComparison) {
      owner = "activity";
      rawUnits = [activityComparison[1]!, activityComparison[2]!.replace(/^per\s+/, "decays/").replace(/^in\s+/, "")];
    } else {
      const pair = /^(.+?)\s+in\s+(.+?)\s+(?:and|versus|vs\.?)\s+(?:in\s+)?(.+)$/i.exec(body);
      if (pair) { owner = name(pair[1]!); rawUnits = [pair[2]!, pair[3]!]; }
    }
    const units = rawUnits.flatMap(raw => { const unit = decodeObservableUnit(raw); return unit ? [unit] : []; });
    // Eligibility is separate from proof. Unsupported pair syntax is refused
    // when it explicitly asks for unit labels; ordinary time plots are untouched.
    const pairCue = /\bin\b.+\b(?:and|versus|vs)\b/.test(body) && rawUnits.some(raw => decodeObservableUnit(raw));
    if (!indirect && !pairCue && units.length !== 2) return [];
    return [{ start: request.start, end: request.end, text: request.text, owner, units,
      supported: units.length === 2 && units[0]!.key !== units[1]!.key &&
        units[0]!.dimension === units[1]!.dimension && units[0]!.meaning === units[1]!.meaning }];
  });
}

/** Generic original literal: a whole named declaration, not a number mined
 * from prose or a planner restatement. This permits equivalent-unit labels in
 * other domains (v, d, energy, etc.) without dispatching on a chapter. */
function originalLiteral(question: string, obligation: Obligation): ValueProof | null {
  if (question.length > 8192 || sourceUnquotedText(question) !== question ||
      question.slice(obligation.end).replace(/[.;\s]/g, "") || !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(obligation.owner)) return null;
  const clauses = sourceUnquotedText(question).slice(0, obligation.start).split(/[;!?\n]|\.(?=\s|$)/).map(text => text.trim()).filter(Boolean);
  const declarations = clauses.flatMap(text => {
    const match = new RegExp(`^(?:Given\\s+)?([A-Za-z][A-Za-z0-9_]{0,31})\\s*=\\s*(${NUMBER})\\s+(.+)$`, "i").exec(text);
    if (!match || match[1] !== obligation.owner) return [];
    const unit = decodeObservableUnit(match[3]);
    const value = readObservableScalar(match[2]!);
    return unit && value !== null ? [{ value, unit, text }] : [];
  });
  // Any context beyond the one literal and current request is outside this
  // bounded generic proof. It cannot silently discard a conditional qualifier.
  if (declarations.length !== 1 || clauses.length !== 1) return null;
  const declaration = declarations[0]!;
  if (obligation.units.some(unit => convertObservableValue(declaration.value, declaration.unit, unit) === null)) return null;
  return { originalQuestion: question, requestedOwner: obligation.owner, request: obligation,
    value: declaration.value, unit: declaration.unit, evidence: { kind: "original_literal", text: declaration.text } };
}
function valueProof(question: string, obligation: Obligation): ValueProof | null {
  if (!obligation.supported) return null;
  if (obligation.owner === "activity" && obligation.units.every(unit => unit.meaning === "decay_activity")) {
    const read = readSourceInstantaneousActivity(question, obligation, "activity");
    if (read.status !== "certified") return null;
    return { originalQuestion: question, requestedOwner: "activity", request: obligation,
      value: read.certificate.value, unit: decodeObservableUnit(read.certificate.unit)!, evidence: read.certificate };
  }
  return originalLiteral(question, obligation);
}
function proofs(question: string): ValueProof[] {
  return readSourceObservableUnitObligations(question).flatMap(request => { const proof = valueProof(question, request); return proof ? [proof] : []; });
}
function ownerAgrees(owner: string | undefined, proof: ValueProof): boolean {
  if (!owner) return true; // A unique current requested owner plus typed units.
  return proof.requestedOwner === "activity" ? ["A", "R", "activity", "decay rate"].includes(name(owner)) : name(owner) === proof.requestedOwner;
}
function originalActivityInput(proof: ValueProof, value: unknown, rawUnit: unknown, symbol: string | undefined): boolean | null {
  if (!("version" in proof.evidence) || !["λ", "lambda", "N"].includes(symbol ?? "")) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  const certificate = proof.evidence;
  if (symbol === "N") return rawUnit === "nuclei" && value === certificate.inputs.population.value;
  const unit = decodeObservableUnit(rawUnit), sourceUnit = decodeObservableUnit(`${certificate.inputs.lambda.timeUnit}^-1`)!;
  const expected = unit && convertObservableValue(certificate.inputs.lambda.value, sourceUnit, unit);
  return typeof expected === "number" && Math.abs(value - expected) <= 32 * Number.EPSILON * Math.max(Math.abs(value), Math.abs(expected));
}
function originalActivityInputText(proof: ValueProof, text: string): boolean | null {
  const match = new RegExp(`^(λ|lambda|N)\\s*=\\s*(${NUMBER})\\s*(.+)$`).exec(observableMathText(text));
  return match ? originalActivityInput(proof, Number(match[2]), match[3], match[1]) : null;
}
function agrees(display: Display, proof: ValueProof): boolean {
  const expected = convertObservableValue(proof.value, proof.unit, display.unit);
  if (expected === null || !ownerAgrees(display.owner, proof)) return false;
  const roundoff = 32 * Number.EPSILON * Math.max(Math.abs(expected), Math.abs(display.value));
  // Exact displays have no rounding allowance; ≈ explicitly earns half a
  // final printed place. Neither an absolute floor nor candidate uncertainty
  // can make an invented zero/sign acceptable.
  return (expected === 0) === (display.value === 0) && (expected === 0 || Math.sign(expected) === Math.sign(display.value)) &&
    Math.abs(expected - display.value) <= display.tolerance + roundoff;
}
function unwrapGroup(raw: string): string {
  let result = raw.trim();
  for (let depth = 0; depth < 4 && /^(?:\([^()]*\)|\[[^[\]]*\])$/.test(result); depth++) result = result.slice(1, -1).trim();
  return result;
}
/** Full label cells only. Unknown prose, an extra unit suffix or an expression
 * cannot be excused by a correct measured prefix. Native math wrappers use the
 * same decoder as displayed board text. */
function displays(raw: string): Display[] | null {
  const text = unwrapGroup(observableMathText(raw));
  const assigned = /^([^=≈≃≅:]+?)\s*(=|≈|≃|≅|:)\s*(.+)$/.exec(text);
  const owner = assigned && !/^[-+~.\d]/.test(assigned[1]!.trim()) ? name(assigned[1]!) : undefined;
  const body = owner ? assigned![3]! : text;
  const cells = body.split(/\s*(?:=|;|,|\band\b)\s*/);
  if (cells.length > 4) return null;
  const result: Display[] = [];
  for (const cell of cells) {
    const match = new RegExp(`^([~≈≃≅]?)\\s*(${NUMBER})\\s*(.+)$`).exec(unwrapGroup(cell));
    if (!match) return null;
    const unit = decodeObservableUnit(match[3]);
    const value = readObservableScalar(match[2]!);
    if (!unit || value === null) return null;
    const approximate = Boolean(match[1]) || Boolean(owner && assigned && ["≈", "≃", "≅"].includes(assigned[2]!));
    const [mantissa, exponent = "0"] = match[2]!.toLowerCase().split("e");
    const places = mantissa!.split(".")[1]?.length ?? 0;
    const tolerance = approximate ? 0.5 * 10 ** (Number(exponent) - places) : 0;
    result.push({ value, unit, tolerance, ...(owner ? { owner } : {}) });
  }
  return result;
}
/** Additional display support for the existing scalar-agreement/pruning path.
 * Recomputed only from the current original source; it grants no geometry,
 * equation, native input, provenance, ID or general physics exemption. */
export function sourceObservableUnitMeasurements(question: string): Array<{ value: number; unit: string }> {
  return readSourceObservableUnitObligations(question).flatMap(request => {
    const proof = valueProof(question, request);
    return proof ? request.units.flatMap(unit => { const value = convertObservableValue(proof.value, proof.unit, unit);
      return value === null ? [] : [{ value, unit: unit.key }]; }) : [];
  });
}
export function sourceObservableQuantityProved(question: string, quantity: Record<string, unknown>): boolean {
  const unit = decodeObservableUnit(quantity.unit);
  if (!unit || typeof quantity.value !== "number" || !Number.isFinite(quantity.value)) return false;
  const owner = typeof quantity.symbol === "string" ? quantity.symbol : undefined;
  return proofs(question).some(proof => agrees({ value: quantity.value as number, unit, tolerance: 0, owner }, proof));
}

/** Negative eligibility only: even prose around a measurement cannot hide
 * a contradictory extra unit claim before optional annotation pruning. */
function mentionsDimension(raw: string, dimension: string): boolean {
  const text = observableMathText(raw);
  if (text.length > 1000) return true;
  for (const match of text.matchAll(new RegExp(NUMBER, "g"))) {
    const suffix = text.slice(match.index! + match[0].length).trim().slice(0, 128);
    const ends = [...suffix.matchAll(/(?=$|[\s,;.)\]])/g)].map(boundary => boundary.index!);
    for (const end of ends.slice(0, 32)) if (decodeObservableUnit(suffix.slice(0, end))?.dimension === dimension) return true;
  }
  return false;
}
/** Required display is source-owned at every lifecycle tier, even with empty
 * candidate/plan inventories. Compile is used only to measure actual label ink;
 * matching an archetype, a candidate certificate or a regenerated scene never
 * proves this observable or the law supplying its value. */
export function validateSourceObservableUnitObligations(document: SceneDocument, plan?: TurnPlanV3 | null, originalIR?: unknown, originalQuestion?: string): SceneIssue[] {
  const irQuestion = record(originalIR) && originalIR.schemaVersion === "problem-ir/v1" && typeof originalIR.question === "string" ? originalIR.question : undefined;
  const documentQuestion = typeof document.source.question === "string" ? document.source.question : "";
  const question = originalQuestion ?? irQuestion ?? plan?.question ?? documentQuestion;
  const requests = readSourceObservableUnitObligations(question);
  const authorities = [originalQuestion, irQuestion, plan?.question, documentQuestion].filter((value): value is string => typeof value === "string");
  const otherRequests = authorities.some(other => readSourceObservableUnitObligations(other).length > 0);
  if (!requests.length && !otherRequests) return [];
  const issues: SceneIssue[] = [];
  const fail = (code: string, message: string, path = "source.question") => issues.push({ code, message, path, severity: "fatal", failureKind: "truth" });
  if (authorities.some(other => !sameQuestion(other, question))) {
    fail("source_observable_question_mismatch", "Observable display authority must bind the original question and requested owner.");
    return issues;
  }
  const compiled = compileSceneDocument(document, { figureConsistency: true });
  const ink = compiled.ok ? compiled.renderScene?.primitives.filter(primitive => primitive.kind === "label").map(primitive => primitive.text ?? "") ?? [] : [];
  const authoredTexts = [
    ...document.entities.flatMap(entity => typeof entity.label === "string" ? [entity.label] : []),
    ...document.annotations.flatMap(annotation => typeof annotation.text === "string" && ["label", "callout"].includes(annotation.kind) ? [annotation.text] : []),
    ...document.constructions.flatMap(construction => construction.operator === "label" && typeof construction.inputs.text === "string" ? [construction.inputs.text] : []),
  ];
  for (const request of requests) {
    const proof = valueProof(question, request);
    if (!proof) { fail("source_observable_value_unproved", "The requested equivalent-unit display lacks an original-source owner, law/input or literal certificate."); continue; }
    // Audit all retained values in the requested dimension, independently of
    // provenance/IDs and of whether another label supplies the correct pair.
    for (const quantity of [...document.quantities, ...plan?.givens ?? [], ...plan?.derived ?? []]) {
      const sourceInput = originalActivityInput(proof, quantity.value, quantity.unit, typeof quantity.symbol === "string" ? quantity.symbol : undefined);
      if (sourceInput !== null) {
        if (!sourceInput) fail("source_observable_input_false", "A retained physical input disagrees with the original same-instant source certificate.", `quantities.${quantity.id}`);
        continue;
      }
      const unit = decodeObservableUnit(quantity.unit);
      const semanticOwner = typeof quantity.symbol === "string" && ownerAgrees(quantity.symbol, proof);
      const disguisedUnit = !unit && typeof quantity.unit === "string" &&
        decodeObservableUnit(quantity.unit.replace(/\s+/g, ""))?.dimension === proof.unit.dimension;
      if (unit?.dimension !== proof.unit.dimension && !semanticOwner && !disguisedUnit) continue;
      if (typeof quantity.value !== "number" || !unit || !agrees({ value: quantity.value, unit, tolerance: 0,
        owner: typeof quantity.symbol === "string" ? quantity.symbol : undefined }, proof))
        fail("source_observable_quantity_false", "A retained quantity does not have the source-proved requested observable value and unit meaning.", `quantities.${quantity.id}`);
    }
    for (const text of new Set([...authoredTexts, ...ink])) {
      const sourceInput = originalActivityInputText(proof, text);
      if (sourceInput !== null) {
        if (!sourceInput) fail("source_observable_input_false", "A displayed physical input disagrees with its original same-instant source meaning.", "entities.label");
        continue;
      }
      const parsed = displays(text);
      // Owner relevance is independent of dimensions: A=300 nuclei is still
      // an activity claim, even though nuclei cannot decode as activity units.
      const assignedOwner = /^([^=≈≃≅:]+?)\s*[=≈≃≅:]/.exec(unwrapGroup(observableMathText(text)))?.[1];
      const ownedClaim = assignedOwner !== undefined && ownerAgrees(name(assignedOwner), proof);
      const relevant = ownedClaim || parsed?.some(display => display.unit.dimension === proof.unit.dimension) || mentionsDimension(text, proof.unit.dimension) ||
        /\d/.test(text) && (proof.requestedOwner === "activity" && /B\s*q|decays?\b|counts?\s*(?:\/|per)/i.test(text) ||
          new RegExp(`^\\s*${proof.requestedOwner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[=≈:]`).test(text));
      if (!relevant) continue;
      if (!parsed || parsed.some(display => (ownedClaim || display.unit.dimension === proof.unit.dimension) && !agrees(display, proof)))
        fail("source_observable_display_false", "A displayed observable/unit claim is unsupported or disagrees with its independently proved quantity meaning.", "entities.label");
    }
    for (const unit of request.units) {
      if (!ink.some(text => displays(text)?.some(display => display.unit.key === unit.key && agrees(display, proof))))
        fail("source_observable_unit_label_missing", `The current request requires actual source-proved ${unit.key} label ink; quantities or metadata cannot replace it.`, "entities.label");
    }
  }
  return issues;
}
