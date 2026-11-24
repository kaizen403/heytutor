import { unwrapMathMarkup } from "@heytutor/drawing";
import type { TurnPlanV3 } from "../contracts/contractsV3";
import { readSourceDrawingRequests } from "../document/sourceRequestScope";
import { sourceFigureForegroundContext } from "../chemistry/figureSourceOwnership";
import { parseMathExpression } from "../math/expression";
import type { SceneConstruction, SceneDocument, SceneIssue } from "../types";
import { analyzePhysicalCurve } from "./physicalCurveModels";
import { validationNumber } from "../compile/sourceScalars";

/** This is a requested physical observable, not a figure producer or a topic id. */
interface BindingRequest { question: string; claimId: string }
export interface SourceBindingPlotProof {
  axesId: string;
  curveId: string;
  claimId: string;
  x: { symbol: "A"; unit: ""; titles: readonly string[] };
  y: { symbol: "B/A"; unit: ""; titles: readonly string[] };
  peak: number;
  maximum: number;
}
export const SOURCE_BINDING_OBSERVABLE = "source_binding_observable";
const X_TITLES = ["A", "Mass number A", "Mass number"] as const;
const Y_TITLES = ["B/A", "BE/A", "E_b/A", "E_bind/A", "Binding energy per nucleon", "Binding energy/nucleon"] as const;
const bindingWords = /\bbinding[\s-]+energy\s*(?:per|\/)\s*nucleon\b/i;
const massWords = /\bmass[\s-]+number\b/i;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const sameQuestion = (left: string, right: string) => left.trim().toLowerCase().replace(/\s+/g, " ") === right.trim().toLowerCase().replace(/\s+/g, " ");

function positiveObject(body: string, expression: RegExp): boolean {
  const match = expression.exec(body);
  if (!match) return false;
  const prefix = body.slice(0, match.index);
  const excluded = [...prefix.matchAll(/\b(?:without|excluding|except|omit(?:ting)?|no|not)\b/gi)].at(-1)?.index ?? -1;
  const resumed = [...prefix.matchAll(/\b(?:with|but|instead|rather|however)\b/gi)].at(-1)?.index ?? -1;
  return excluded <= resumed;
}

function request(question: string): BindingRequest | null {
  const foreground = sourceFigureForegroundContext(question);
  const current = readSourceDrawingRequests(question).find(action => action.scope === "current" &&
    ["draw", "sketch", "plot", "graph", "show"].includes(action.action) &&
    (positiveObject(action.text, bindingWords) || bindingWords.test(foreground) && /\b(?:BE|B)\s*\/\s*A\b/.test(action.text)) &&
    (positiveObject(action.text, massWords) || massWords.test(foreground) && /\b(?:against|versus|vs\.?)\s+A\b/.test(action.text)));
  return current ? { question, claimId: `source_binding_observable_${current.start}` } : null;
}

/** Only a caller's explicit original IR participates; embedded candidate IR never does. */
function questionContext(document: SceneDocument, plan?: TurnPlanV3 | null, originalIR?: unknown) {
  const irQuestion = record(originalIR) && originalIR.schemaVersion === "problem-ir/v1" && typeof originalIR.question === "string"
    ? originalIR.question : undefined;
  const documentQuestion = typeof document.source.question === "string" ? document.source.question : "";
  const question = irQuestion ?? plan?.question ?? documentQuestion;
  const required = request(question) ?? request(documentQuestion) ?? (plan ? request(plan.question) : null);
  const mismatch = Boolean(required && (documentQuestion && !sameQuestion(documentQuestion, question) || plan && !sameQuestion(plan.question, question)));
  return { question, required, mismatch };
}

function cleanTitle(value: string): string {
  return unwrapMathMarkup(value).normalize("NFKC").replace(/[{}\s]/g, "");
}
export function sourceBindingAxisTitleMatches(value: unknown, key: "xLabel" | "yLabel"): boolean {
  if (typeof value !== "string") return false;
  const compact = cleanTitle(value);
  const titles: readonly string[] = key === "xLabel" ? X_TITLES : Y_TITLES;
  return titles.some(title => /\s/.test(title) ? cleanTitle(title).toLowerCase() === compact.toLowerCase() : cleanTitle(title) === compact);
}
/** Preserve a source-proved mathematical designator; descriptive titles use
 * the conventional compact symbol rather than inventing a new abbreviation. */
export function sourceBindingAxisDisplayTitle(value: unknown, key: "xLabel" | "yLabel"): string | null {
  if (!sourceBindingAxisTitleMatches(value, key) || typeof value !== "string") return null;
  const compact = cleanTitle(value);
  const mathematical: readonly string[] = key === "xLabel" ? ["A"] : ["B/A", "BE/A", "E_b/A", "E_bind/A"];
  return mathematical.includes(compact) ? compact : key === "xLabel" ? "A" : "B/A";
}

function planAxisMeaningAgrees(plan: TurnPlanV3 | null | undefined, axes: SceneConstruction): boolean {
  if (!plan) return true;
  for (const claim of plan.qualitativeClaims) {
    const text = unwrapMathMarkup(`${claim.claim}. ${typeof claim.expected === "string" ? claim.expected : ""}`)
      .normalize("NFKC").replace(/[{}]/g, "").replace(/\s*\/\s*/g, "/");
    for (const match of text.matchAll(/\b(horizontal|vertical|x|y)\s+axis\s*(?::|=|\b(?:is|shows|represents|denotes|plots)\b)?\s*/gi)) {
      const key = /^(?:horizontal|x)$/i.test(match[1]!) ? "xLabel" : "yLabel";
      const title = axes.inputs[key];
      if (typeof title !== "string") continue;
      const phrase = text.slice(match.index! + match[0].length).split(/[.;]|\band\s+(?:the\s+)?(?:horizontal|vertical|x|y)\s+axis/i, 1)[0]!
        .split(/\b(?:increases?|decreases?)\b/i, 1)[0]!.trim();
      const symbol = cleanTitle(title).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const designator = new RegExp(`(?<![\\p{L}\\p{N}_])${symbol}(?![\\p{L}\\p{N}_])`, "u");
      if (!designator.test(phrase)) continue; // A declaration for another view.
      if (claim.expected === false) return false;
      const physicalMeaning = key === "xLabel" ? massWords : bindingWords;
      if (physicalMeaning.test(phrase)) continue;
      // A bare mathematical title does not contradict its original-source
      // meaning. A different explicitly named quantity does.
      if (phrase.replace(designator, "").replace(/\b(?:the|quantity|observable)\b/gi, "").trim()) return false;
    }
  }
  return true;
}
function curveClaimsBinding(curve: SceneConstruction, document: SceneDocument): boolean {
  return document.entities.filter(entity => curve.outputs.includes(entity.id)).some(entity =>
    /^(?:bindingcurve|bindingenergycurve|bindingpernucleoncurve|bindingenergypernucleon)$/.test((entity.role ?? "").toLowerCase().replace(/[\s_-]/g, "")) ||
    sourceBindingAxisTitleMatches(entity.label, "yLabel"));
}
/** Existing Cartesian figures can state the ordinate-abscissa pair on the
 * owning axes entity instead of separate title fields. Resolve only complete
 * mathematical designators; explicit title fields retain priority and cannot
 * be repaired from another label. This supplies meaning, never shape proof. */
function bindingAxesTitles(axes: SceneConstruction, document: SceneDocument): { xLabel: string; yLabel: string } | null {
  const { xLabel, yLabel } = axes.inputs;
  if (xLabel !== undefined || yLabel !== undefined) return typeof xLabel === "string" && typeof yLabel === "string" &&
    sourceBindingAxisTitleMatches(xLabel, "xLabel") && sourceBindingAxisTitleMatches(yLabel, "yLabel") ? { xLabel, yLabel } : null;
  const owner = document.entities.find(entity => entity.kind === "axes" && axes.outputs.includes(entity.id));
  if (typeof owner?.label !== "string") return null;
  const pair = cleanTitle(owner.label).split("-");
  return pair.length === 2 && sourceBindingAxisTitleMatches(pair[0], "yLabel") && sourceBindingAxisTitleMatches(pair[1], "xLabel")
    ? { xLabel: pair[1]!, yLabel: pair[0]! } : null;
}
function owningAxes(curve: SceneConstruction, document: SceneDocument): SceneConstruction | null {
  const axes = document.constructions.filter(item => item.operator === "axes" && item.outputs.length === 1);
  if (curve.inputs.axes !== undefined) return axes.find(item => item.outputs[0] === curve.inputs.axes) ?? null;
  // The existing compiler binds an implicit Cartesian graph only to its unique axes.
  // This inference never disables a source requirement on zero or multiple axes.
  return axes.length === 1 ? axes[0]! : null;
}
function bindingCurves(document: SceneDocument): SceneConstruction[] {
  return document.constructions.filter(curve => curve.operator === "function_curve" &&
    (curveClaimsBinding(curve, document) || sourceBindingAxisTitleMatches(owningAxes(curve, document)?.inputs.yLabel, "yLabel")));
}

function model(curve: SceneConstruction) {
  const { expression, xMin, xMax } = curve.inputs;
  if (typeof expression !== "string" || !finite(xMin) || !finite(xMax)) return null;
  if (curve.inputs.variable !== undefined && curve.inputs.variable !== "x") return null;
  // The executed one-dimensional curve evaluator parses this exact expression
  // in x. A candidate's variable metadata cannot substitute another evaluator.
  try {
    const executed = parseMathExpression(expression);
    executed.assertContinuousOn(xMin, xMax);
    const proved = analyzePhysicalCurve(expression, xMin, xMax, "binding");
    const minimum = Math.min(executed.evaluate(xMin), executed.evaluate(xMax));
    return proved && "peak" in proved && finite(proved.peak) && finite(proved.maximum) && finite(minimum)
      ? { peak: proved.peak, maximum: proved.maximum, minimum } : null;
  } catch { return null; }
}

export function proveSourceBindingPlot(document: SceneDocument, curveId: string, plan?: TurnPlanV3 | null, originalIR?: unknown): SourceBindingPlotProof | null {
  const context = questionContext(document, plan, originalIR);
  if (!context.required || context.mismatch || document.visualDecision.mode !== "scene") return null;
  const curve = bindingCurves(document).find(item => item.outputs.length === 1 && item.outputs[0] === curveId);
  if (!curve || !document.requiredEntityIds.includes(curveId) || !document.entities.some(entity => entity.id === curveId && entity.kind === "polyline")) return null;
  const proved = model(curve), axes = owningAxes(curve, document);
  const titles = axes && bindingAxesTitles(axes, document);
  if (!proved || !("peak" in proved) || !axes || !document.requiredEntityIds.includes(axes.outputs[0]!) ||
    !titles || !planAxisMeaningAgrees(plan, { ...axes, inputs: { ...axes.inputs, ...titles } })) return null;
  const { xMin, xMax, yMin, yMax } = axes.inputs;
  if (![xMin, xMax, yMin, yMax].every(finite) || !(xMax as number > (xMin as number)) || !(yMax as number > (yMin as number)) ||
    (curve.inputs.xMin as number) < (xMin as number) || (curve.inputs.xMax as number) > (xMax as number) ||
    (yMin as number) > proved.minimum || (yMax as number) < proved.maximum) return null;
  return { axesId: axes.outputs[0]!, curveId, claimId: context.required.claimId,
    x: { symbol: "A", unit: "", titles: X_TITLES }, y: { symbol: "B/A", unit: "", titles: Y_TITLES },
    peak: proved.peak, maximum: proved.maximum };
}

export function sourceBindingPlotProofs(document: SceneDocument, plan?: TurnPlanV3 | null, originalIR?: unknown): SourceBindingPlotProof[] {
  return bindingCurves(document).flatMap(curve => curve.outputs.flatMap(id => {
    const proof = proveSourceBindingPlot(document, id, plan, originalIR);
    return proof ? [proof] : [];
  }));
}

/** A visible extremum claim belongs to its executed curve anchor. Internal
 * IDs/roles alone do not assert that a neutral point is an extremum. */
function validateMaximumOwners(document: SceneDocument, curve: SceneConstruction, proved: SourceBindingPlotProof): SceneIssue[] {
  const byOutput = new Map(document.constructions.flatMap(item => item.outputs.map(id => [id, item] as const)));
  const claims: Array<{ ownerId: string; text: string }> = [];
  for (const entity of document.entities) if (entity.label) claims.push({ ownerId: entity.id, text: entity.label });
  for (const item of document.constructions) if (item.operator === "label" && typeof item.inputs.text === "string") {
    const target = item.inputs.target ?? item.inputs.at ?? item.inputs.point;
    if (typeof target === "string") claims.push({ ownerId: target, text: item.inputs.text });
  }
  for (const item of document.annotations) if (["label", "callout"].includes(item.kind) && typeof item.text === "string") {
    for (const ownerId of item.targetIds) claims.push({ ownerId, text: item.text });
  }
  const meaning = (value: string): { coordinate: "x" | "y"; required: boolean } | null => {
    const text = unwrapMathMarkup(value).normalize("NFKC").replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    // The abscissa's endpoint is a different property from the ordinate peak.
    const abscissa = /\bmax(?:imum)?\s+(?:A\b|mass\s+number\b)/i.exec(text);
    const match = abscissa ?? /\b(?:most\s+stable|maximum|max|peak)\b/i.exec(text);
    if (!match) return null;
    return { coordinate: abscissa ? "x" : "y",
      required: !/\b(?:not|no|non)\s+(?:(?:a|the|local|global)\s+)*$/i.test(text.slice(0, match.index)) };
  };
  type Anchor = { curveId?: string; parameter: number; ordinate?: number };
  const anchor = (id: string, visited = new Set<string>()): Anchor | null => {
    if (visited.has(id)) return null;
    visited.add(id);
    const producer = byOutput.get(id);
    if (!producer) return null;
    try {
      if (producer.operator === "label") {
        const target = producer.inputs.target ?? producer.inputs.at ?? producer.inputs.point;
        return typeof target === "string" ? anchor(target, visited) : null;
      }
      if (producer.operator === "curve_anchor" && typeof producer.inputs.curve === "string")
        return { curveId: producer.inputs.curve, parameter: validationNumber(producer.inputs.at, document) };
      if (producer.operator === "point" && producer.inputs.coordinateSpace !== "layout")
        return { parameter: validationNumber(producer.inputs.x, document), ordinate: validationNumber(producer.inputs.y, document) };
    } catch { /* Unproved anchors never acquire a physical extremum identity. */ }
    return null;
  };
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE);
  const failures = new Set<string>();
  for (const claim of claims) {
    const requiredMaximum = meaning(claim.text);
    if (requiredMaximum === null) continue;
    const at = anchor(claim.ownerId);
    if (at?.curveId && at.curveId !== proved.curveId) continue;
    const isMaximum = at !== null && (requiredMaximum.coordinate === "x"
      ? finite(curve.inputs.xMax) && close(at.parameter, curve.inputs.xMax)
      : close(at.parameter, proved.peak) && (at.ordinate === undefined || close(at.ordinate, proved.maximum)));
    if (!at || isMaximum !== requiredMaximum.required) failures.add(claim.ownerId);
  }
  return [...failures].map(ownerId => ({ code: "curve_extremum_owner_unproved", severity: "fatal", failureKind: "truth",
    constructionId: curve.id, entityIds: [ownerId, proved.curveId],
    message: "A visible maximum/stability caption must retain its proved ordinate peak or named abscissa endpoint; a neutral name or internal role supplies no extremum proof" }));
}

/** Source recognition is independent of fallback claims, aliases and removable metadata. */
export function validateSourceBindingObservable(document: SceneDocument, plan?: TurnPlanV3 | null, originalIR?: unknown,
  requireRetainedPlan = false): SceneIssue[] {
  if (document.visualDecision.mode !== "scene") return [];
  const context = questionContext(document, plan, originalIR);
  if (!context.required) return [];
  const issue = (code: string, message: string, construction?: SceneConstruction): SceneIssue => ({ code, severity: "fatal", failureKind: "truth", message,
    ...(construction ? { constructionId: construction.id, entityIds: construction.outputs } : {}) });
  if (context.mismatch) return [issue("binding_observable_source_mismatch", "The binding plot must retain the original requested physical observable and question")];
  if (requireRetainedPlan && !plan) return [issue("binding_observable_source_plan_missing", "A stored source-requested binding plot requires its retained accepted plan")];
  const curves = bindingCurves(document);
  const native = document.constructions.some(item => item.operator === "nuclear_binding_curve");
  if (!curves.length) return native ? [] : [issue("binding_observable_plot_missing", "The source requests binding energy per nucleon against mass number; its actual plotted owner is missing")];
  const issues: SceneIssue[] = [];
  for (const curve of curves) {
    if (!model(curve)) issues.push(issue("physical_curve_shape_failed", "The requested binding observable needs a proved broad maximum and gradual heavy-nucleus decline; an arbitrary bell curve cannot certify it", curve));
    const proved = proveSourceBindingPlot(document, curve.outputs[0]!, plan, originalIR);
    if (!proved) issues.push(issue("binding_observable_axes_unproved", "The proved binding curve must own its actual mass-number and binding-energy-per-nucleon axes; floating labels, helper axes and omitted titles do not supply them", curve));
    else issues.push(...validateMaximumOwners(document, curve, proved));
  }
  return issues;
}
