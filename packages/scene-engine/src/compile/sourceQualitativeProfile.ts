import { unwrapMathMarkup } from "@heytutor/drawing";
import type { TurnPlanV3 } from "../contracts/contractsV3";
import { readSourceDrawingRequests, sourceUnquotedText, type SourceDrawingRequest } from "../document/sourceRequestScope";
import type { SceneDocument, SceneIssue } from "../types";

type Point = { x: number; y: number };
type AxisDeclaration = { symbol: string; claimId: string; phrase: string };
type Claim = TurnPlanV3["qualitativeClaims"][number];
interface ProfileRequest { x: AxisDeclaration; y: AxisDeclaration; names: string[][] }
export interface SourceQualitativeProfileProof {
  axesId: string;
  curveId: string;
  x: AxisDeclaration;
  y: AxisDeclaration;
  ownerIds: string[];
  marks: Array<{ entityId: string; name: string[] }>;
}
const text = (claim: Claim) => `${claim.claim}. ${typeof claim.expected === "string" ? claim.expected : ""}`;
const words = (value: string): string[] => unwrapMathMarkup(value).normalize("NFKC").toLowerCase().replace(/[−–—_-]/g, " ").match(/[\p{L}\p{N}]+/gu) ?? [];
const contains = (value: string, name: string[]) => { const available = words(value); return name.length > 0 && available.some((_, index) => name.every((word, offset) => available[index + offset] === word)); };
const shape = (value: string, name: string) => value.split(/[.;!?]/).some(clause => {
  const at = new RegExp(`\\b${name}\\b`, "i").exec(clause)?.index;
  return at !== undefined && !/\b(?:no|not|never|without|cannot|don['’]t|can['’]t)\b/i.test(clause.slice(0, at));
});
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const PHYSICAL_UNITS = /\b(?:[yzafpnumcdhkMGTPEZYµμ]?eV|[yzafpnumcdhkMGTPEZYµμ]?[mgsAKJNCVW]|Bq|Gy|Sv|Hz|Pa|Wb|mol|ohms?|joules?|electron[- ]volts?|met(?:er|re)s?|seconds?|kelvin|tesla|newtons?|volts?|watts?|coulombs?|ergs?|calories?)\b/;

function profileActions(question: string): SourceDrawingRequest[] {
  return readSourceDrawingRequests(question).filter(request => ["draw", "sketch", "plot", "graph", "show"].includes(request.action) &&
    /\b(?:qualitative|schematic|illustrative)\b/i.test(request.text) && /\b(?:interaction|potential)\b/i.test(request.text) &&
    /\b(?:sketch|profile|curve|graph|plot|barrier|well)\b/i.test(request.text) && /\bseparation\b/i.test(question));
}

/** Recognition cannot depend on a successful plan/proof or removable metadata.
 * Even a reported/retracted profile mention needs source truth before a scene
 * with that requested physical model can be admitted by another policy. */
export function hasSourceQualitativeProfileMention(question: string): boolean {
  return /\bseparation\b/i.test(question) && question.split(/[.!?;\n]/).some(clause =>
    /\b(?:qualitative|schematic|illustrative)\b/i.test(clause) && /\b(?:interaction|potential)\b/i.test(clause) &&
    /\b(?:sketch|profile|curve|graph|plot|barrier|well)\b/i.test(clause));
}

function sourceAxisAgrees(question: string, x: AxisDeclaration, y: AxisDeclaration): boolean {
  const source = sourceUnquotedText(question);
  const clauses = source.split(/[.;!?]/);
  // A forbidden observable cannot be recovered from an accepted-plan rewrite.
  if (clauses.some(clause => /\b(?:axis|axes)\b/i.test(clause) && /\b(?:separation|energy)\b/i.test(clause) &&
    /\b(?:do\s+not|don['’]t|not\s+to|never|cannot|can['’]t|must\s+not|should\s+not|without)\b/i.test(clause))) return false;
  const declarations: Array<{ key: "x" | "y"; phrase: string }> = [];
  for (const clause of clauses) {
    for (const match of clause.matchAll(/\b(horizontal|vertical|x|y)\s+axis\s*(?::|=|\b(?:is|shows|represents|denotes|plots)\b)?\s*/gi)) {
      if (/(?:on|along)\s+(?:the\s+)?$/i.test(clause.slice(0, match.index))) continue;
      const phrase = clause.slice(match.index! + match[0].length)
        .split(/\band\s+(?:the\s+)?(?:horizontal|vertical|x|y)\s+axis|,|\brather\s+than\b|\binstead\b/i, 1)[0]!.trim();
      declarations.push({ key: /^(?:horizontal|x)$/i.test(match[1]!) ? "x" : "y", phrase });
    }
    for (const match of clause.matchAll(/(?:^|\band\b)\s*(?:use|label|put|show|plot)?\s*([^,;]{1,160}?)\s+(?:on|along)\s+(?:the\s+)?(horizontal|vertical|x|y)\s+axis/gi)) {
      declarations.push({ key: /^(?:horizontal|x)$/i.test(match[2]!) ? "x" : "y", phrase: match[1]!.trim() });
    }
  }
  return declarations.every(declaration => {
    const expected = declaration.key === "x" ? x : y;
    const observable = declaration.key === "x" ? /\bseparation\b/i : /\benergy\b/i;
    const symbol = declaration.phrase.match(/\b([A-Za-z])\s*$/)?.[1];
    const meaning = symbol ? declaration.phrase.slice(0, -symbol.length).trim() : declaration.phrase;
    return observable.test(declaration.phrase) && (!symbol || symbol === expected.symbol) &&
      !/[()[\]/_^*=<>±\d]/.test(meaning) && !PHYSICAL_UNITS.test(meaning);
  });
}

/** Source declaration grammar for a qualitative energy/separation profile.
 * No title, role, operator name or source metadata supplies this request. */
export function sourceQualitativeProfileRequest(plan: TurnPlanV3): ProfileRequest | null {
  if (plan.visualRequirement !== "required" || plan.givens.length || plan.unknowns.length || plan.derived.length) return null;
  const actions = readSourceDrawingRequests(plan.question);
  const profiles = profileActions(plan.question).filter(request => request.scope === "current");
  if (profiles.length !== 1) return null;
  const profile = profiles[0]!;
  const clauseEnd = plan.question.slice(profile.start).search(/[.!?;\n]/);
  const named = actions.filter(request => request.scope === "current" && ["identify", "mark", "label", "name"].includes(request.action) &&
    request.start >= profile.end && (clauseEnd < 0 || request.start < profile.start + clauseEnd)).flatMap(request =>
    request.text.replace(/^\w+\s+/i, "").replace(/\s+and\s*$/i, "").split(/,|\band\b/i)
      .map(name => words(name.replace(/^\s*(?:a|an|the)\s+/i, ""))).filter(name => name.length > 0));
  if (named.length < 2 || named.length > 16) return null;
  if (actions.some(request => request.start > profile.start && ["negated", "retracted"].includes(request.scope) &&
    ["draw", "show", "mark", "identify", "label", "name"].includes(request.action) && named.some(name => contains(request.text, name)))) return null;
  const claims = plan.qualitativeClaims.filter(claim => claim.expected !== false);
  if (!claims.some(claim => shape(text(claim), "peak")) || !claims.some(claim => shape(text(claim), "well"))) return null;
  const declarations = claims.flatMap(claim => [...text(claim).matchAll(/\b(horizontal|vertical|x|y)\s+axis\s*(?::|=|\b(?:is|shows|represents|denotes|plots)\b)?\s*/gi)].flatMap(match => {
    const phrase = text(claim).slice(match.index! + match[0].length).split(/[.;]/, 1)[0]!
      .split(/\band\s+(?:the\s+)?(?:horizontal|vertical|x|y)\s+axis/i, 1)[0]!.trim();
    const symbol = phrase.match(/\b([A-Za-z])\s*$/)?.[1];
    return symbol ? [{ key: /^(?:horizontal|x)$/i.test(match[1]!) ? "x" : "y", symbol, claimId: claim.id, phrase }] : [];
  }));
  const x = declarations.find(axis => axis.key === "x" && /\bseparation\b/i.test(axis.phrase));
  const y = declarations.find(axis => axis.key === "y" && /\benergy\b/i.test(axis.phrase));
  return x && y && x.symbol !== y.symbol && sourceAxisAgrees(plan.question, x, y) ? { x, y, names: named } : null;
}

function point(document: SceneDocument, id: string): Point | null {
  const construction = document.constructions.find(item => item.outputs.includes(id));
  if (!construction || construction.operator !== "point" || construction.outputs.length !== 1 || construction.inputs.coordinateSpace !== "layout" ||
    Object.keys(construction.inputs).some(key => !["x", "y", "coordinateSpace", "axes"].includes(key)) || !finite(construction.inputs.x) || !finite(construction.inputs.y)) return null;
  const axes = document.constructions.filter(item => item.operator === "axes" && item.outputs.some(id => document.requiredEntityIds.includes(id)));
  if (construction.inputs.axes !== undefined && (axes.length !== 1 || construction.inputs.axes !== axes[0]!.outputs[0])) return null;
  return { x: construction.inputs.x, y: construction.inputs.y };
}
function path(document: SceneDocument, id: string): Point[] | null {
  const construction = document.constructions.find(item => item.outputs.includes(id));
  if (!construction || construction.outputs.length !== 1) return null;
  const axes = document.constructions.filter(item => item.operator === "axes" && item.outputs.some(id => document.requiredEntityIds.includes(id)));
  if (construction.inputs.axes !== undefined && (axes.length !== 1 || construction.inputs.axes !== axes[0]!.outputs[0])) return null;
  if (construction.operator === "vector" && typeof construction.inputs.start === "string" && Array.isArray(construction.inputs.direction) &&
      construction.inputs.direction.length === 2 && construction.inputs.direction.every(finite) && finite(construction.inputs.length) && construction.inputs.length > 0) {
    const start = point(document, construction.inputs.start), [dx, dy] = construction.inputs.direction as [number, number];
    const norm = Math.hypot(dx, dy);
    return start && norm > 0 ? [start, { x: start.x + dx / norm * construction.inputs.length, y: start.y + dy / norm * construction.inputs.length }] : null;
  }
  const ids = construction.operator === "polyline" && Array.isArray(construction.inputs.points) ? construction.inputs.points
    : ["segment", "line", "vector"].includes(construction.operator) ? [construction.inputs.start, construction.inputs.end] : [];
  if (ids.length < 2 || ids.some(id => typeof id !== "string")) return null;
  const points = ids.map(id => point(document, id as string));
  return points.every((value): value is Point => value !== null) ? points : null;
}
function labels(document: SceneDocument): Array<{ entityId: string; text: string }> {
  const required = new Set(document.requiredEntityIds);
  const labelAnnotations = document.annotations.filter(annotation => annotation.kind === "label" && typeof annotation.text === "string");
  const entities = document.entities.filter(entity => required.has(entity.id) && entity.kind !== "label" && entity.kind !== "group");
  return entities.flatMap(entity => {
    const annotations = labelAnnotations.filter(annotation => annotation.targetIds.includes(entity.id));
    const replaced = annotations.some(annotation => annotation.labelMode !== "append");
    return [
      ...(!replaced && entity.label ? [{ entityId: entity.id, text: entity.label }] : []),
      ...annotations.map(annotation => ({ entityId: entity.id, text: annotation.text! })),
    ];
  });
}
const labelMatches = (name: string[], value: string) => { const label = words(value); return label.length >= Math.min(2, name.length) && label.length <= name.length && label.every((word, index) => word === name[index]); };

function labelTextIsQualitative(value: string, request: ProfileRequest): boolean {
  const clean = unwrapMathMarkup(value).normalize("NFKC").replace(/[{}\s]/g, "");
  if (clean === request.x.symbol || clean === request.y.symbol || clean === `${request.y.symbol}=0`) return true;
  if (/\d/.test(clean)) return /^(?:[A-Za-z_]+\d+|\d+(?:st|nd|rd|th)[A-Za-z_]*)$/.test(clean) && request.names.some(name => labelMatches(name, value));
  // No source unit or normalization exists for this literal qualitative model.
  // Check every possible emitted label, including native/group/callout labels,
  // rather than only the two axis-title slots.
  if (/[/_^*=<>±]/.test(clean) || PHYSICAL_UNITS.test(unwrapMathMarkup(value))) return false;
  if (/[()[\]]/.test(clean) && [request.x.symbol, request.y.symbol].some(symbol => new RegExp(`\\b${symbol}\\b`).test(value))) return false;
  return ![request.x.symbol, request.y.symbol].some(symbol => clean.startsWith(symbol) && PHYSICAL_UNITS.test(clean.slice(symbol.length)));
}

/** Literal coordinates prove qualitative inequalities only. They never
 * certify a measured radius, interaction energy, height, or bound-state value. */
export function proveSourceQualitativeProfile(document: SceneDocument, plan: TurnPlanV3): SourceQualitativeProfileProof | null {
  const request = sourceQualitativeProfileRequest(plan);
  if (!request || document.visualDecision.mode !== "scene" || document.quantities.length || typeof document.source.question !== "string" ||
      document.source.question.trim().toLowerCase().replace(/\s+/g, " ") !== plan.question.trim().toLowerCase().replace(/\s+/g, " ")) return null;
  const axes = document.constructions.filter(item => item.operator === "axes" && item.outputs.length === 1 && document.requiredEntityIds.includes(item.outputs[0]!));
  const curves = document.constructions.filter(item => item.operator === "polyline" && item.outputs.length === 1 && document.requiredEntityIds.includes(item.outputs[0]!));
  if (axes.length !== 1 || curves.length !== 1) return null;
  const axis = axes[0]!.inputs;
  if (![axis.xMin, axis.xMax, axis.yMin, axis.yMax].every(finite) ||
    typeof axis.xLabel !== "string" || axis.xLabel.trim() !== request.x.symbol ||
    typeof axis.yLabel !== "string" || axis.yLabel.trim() !== request.y.symbol) return null;
  const inside = (value: Point) => value.x >= (axis.xMin as number) && value.x <= (axis.xMax as number) && value.y >= (axis.yMin as number) && value.y <= (axis.yMax as number);
  const curve = path(document, curves[0]!.outputs[0]!);
  if (!curve || !curve.every(inside) || !curve.every((value, index) => index === 0 || value.x > curve[index - 1]!.x)) return null;
  const minima = curve.filter((value, index) => index > 0 && index < curve.length - 1 && value.y < curve[index - 1]!.y && value.y < curve[index + 1]!.y);
  const maxima = curve.filter((value, index) => index > 0 && index < curve.length - 1 && value.y > curve[index - 1]!.y && value.y > curve[index + 1]!.y);
  if (!minima.some(value => value.y < 0) || !maxima.some(value => value.y > 0)) return null;
  const displayed = labels(document);
  const descriptions = plan.qualitativeClaims.filter(claim => claim.expected !== false).map(text);
  // An uncalibrated profile exposes reference/sign/named-ordinal facts, never
  // numeric potential values or an invented physical scale.
  const emittedText = [...document.entities.map(entity => entity.label), ...document.annotations.map(annotation => annotation.text)]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  if (emittedText.some(value => !labelTextIsQualitative(value, request))) return null;
  const reference = displayed.find(label => {
    const value = unwrapMathMarkup(label.text).replace(/[{}\s]/g, ""), at = point(document, label.entityId);
    return value === `${request.y.symbol}=0` && descriptions.some(description => unwrapMathMarkup(description).replace(/[{}\s]/g, "").includes(value)) && at?.y === 0 && inside(at);
  });
  if (!reference) return null;
  const marked: Array<{ entityId: string; name: string[] }> = [];
  for (const name of request.names) {
    const matching = displayed.filter(label => labelMatches(name, label.text));
    if (new Set(matching.map(label => label.entityId)).size !== 1) return null;
    const owner = matching[0]!.entityId;
    if (marked.some(mark => mark.entityId === owner)) return null;
    const ownerName = name.filter(word => !["a", "an", "the", "possible"].includes(word));
    const stated = plan.qualitativeClaims.filter(claim => claim.expected !== false && contains(claim.claim, ownerName)).map(text).join("; ");
    const at = point(document, owner), line = path(document, owner);
    if (at) {
      const peak = shape(stated, "peak") || shape(stated, "maximum");
      const minimum = shape(stated, "minimum") && shape(stated, "well");
      const extrema = peak && !minimum ? maxima : minimum && !peak ? minima : [];
      if (!Array.isArray(curves[0]!.inputs.points) || !curves[0]!.inputs.points.includes(owner) || !inside(at) ||
        !extrema.some(value => value.x === at.x && value.y === at.y)) return null;
    } else {
      if (!line || !line.every(inside)) return null;
      const kind = document.entities.find(entity => entity.id === owner)?.kind;
      if (kind === "vector") {
        const decreasing = new RegExp(`\\bdecreasing\\s+${request.x.symbol}\\b`, "i");
        if (!shape(stated, "arrow") || !decreasing.test(stated) || !(line.at(-1)!.x < line[0]!.x)) return null;
        if (/\brising\b/i.test(stated) && curve.slice(1).some((value, index) => value.x >= line.at(-1)!.x && curve[index]!.x <= line[0]!.x && !(value.y < curve[index]!.y))) return null;
      } else if (!shape(stated, "level") || !shape(stated, "below") || !/\bbelow\b[^.;]*\breference\b/i.test(stated) ||
          !line.every(value => value.y < 0) || line[0]!.y !== line.at(-1)!.y || !minima.some(value => value.y < line[0]!.y && value.x >= Math.min(line[0]!.x, line.at(-1)!.x) && value.x <= Math.max(line[0]!.x, line.at(-1)!.x))) return null;
    }
    marked.push({ entityId: owner, name });
  }
  return { axesId: axes[0]!.outputs[0]!, curveId: curves[0]!.outputs[0]!, x: request.x, y: request.y,
    ownerIds: [axes[0]!.outputs[0]!, curves[0]!.outputs[0]!, reference.entityId, ...marked.map(mark => mark.entityId)], marks: marked };
}

export function validateSourceQualitativeProfile(document: SceneDocument, plan?: TurnPlanV3 | null): SceneIssue[] {
  const question = typeof document.source.question === "string" ? document.source.question : plan?.question ?? "";
  const required = hasSourceQualitativeProfileMention(question) || Boolean(plan && hasSourceQualitativeProfileMention(plan.question));
  return document.visualDecision.mode === "scene" && required && (!plan || !proveSourceQualitativeProfile(document, plan))
    ? [{ code: "source_qualitative_profile_unproved", severity: "fatal", failureKind: "truth",
      message: "The source-requested qualitative profile needs its actual axes, ordered path, named extrema/state/approach, and zero reference. Layout numbers cannot stand in for measured physical values." }] : [];
}
