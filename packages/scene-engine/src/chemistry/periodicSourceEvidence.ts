/** Source certificate for the periodic trend graph.
 *
 * Every plotted value of the trend graph is read from the element table
 * (`elements.ts`, or the electron gain enthalpy table beside the builder),
 * never from the planner. A plan rarely restates eight table values, so the
 * generic TurnPlan audit refused every trend graph. This certificate
 * regenerates the graph from the question, checks each plotted quantity
 * against the table for its element and property, requires the submitted
 * document to be exactly that graph, and checks every planner value that
 * names a periodic property and an element against the same table: in the
 * plan's scalars, and in claims that pair an element with a number or rank
 * elements with ">" or "<". A matching value is certified, a value the table
 * contradicts rejects the figure, and a property the table does not hold
 * (a metallic or van der Waals radius, a second ionisation energy) declines it.
 */
import type { TurnPlanQuantityV3, TurnPlanV3 } from "../contracts/contractsV3";
import { displayedSceneQuantityTexts } from "../contracts/contractsV3";
import { compileSceneDocument } from "../compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../document/validation";
import type { SceneDocument, SceneIssue } from "../types";
import { ELEMENTS, elementBySymbol, type ElementRecord } from "./elements";
import { buildPeriodicTrendScene, isPeriodicTrendStem, PERIODIC_FAMILY, propertyValue, type PeriodicProperty } from "./periodicTrend";
import {
  claimVerdict, declarationText, graphMatches, mentionedElements, planClaims, planIssue, planQuantities, type ChemistrySourceCertification,
} from "./sourceEvidenceShared";

/** "ea" is the electron affinity, the negative of the electron gain enthalpy. */
type Property = PeriodicProperty | "ea";

const UNCERTIFIABLE = /\b(?:ionic|metallic|van\s+der\s+waals|vdw|crystal|atomic\s+volume)\s+radi|\b(?:second|third|fourth|successive|2nd|3rd|4th)\s+ioni[sz]ation|\bIE\s*[2-9]\b|\bIE\s*\(\s*[2-9]/i;

const PROPERTIES: ReadonlyArray<[Property, RegExp]> = [
  ["radius", /\b(?:atomic|covalent)\s+(?:radi(?:us|i)|size)\b|\bradi(?:us|i)\b|\batomic\s+size\b/i],
  ["ie1", /\bioni[sz]ation\s+(?:energ(?:y|ies)|enthalp(?:y|ies)|potentials?)\b|\bIE\s*1?\b|\bie1\b/i],
  ["electronegativity", /\belectronegativ(?:e|ity|ities)\b|\bEN\b|χ/i],
  ["egh", /\belectron\s+gain\s+enthalp|Δ\s*\(?\s*eg\s*\)?\s*H|\begh\b/i],
  ["ea", /\belectron\s+affinit/i],
];

/** Units each property may be written in, as factors to the table unit. */
const UNITS: Readonly<Record<Property, Readonly<Record<string, number>>>> = {
  radius: { pm: 1, "å": 100, angstrom: 100, angstroms: 100, nm: 1000 },
  ie1: { "kj/mol": 1, "kj mol-1": 1, "kj mol^-1": 1, "kj·mol⁻¹": 1, ev: 96.485 },
  electronegativity: { "": 1, pauling: 1, "1": 1, dimensionless: 1 },
  egh: { "kj/mol": 1, "kj mol-1": 1, "kj mol^-1": 1, "kj·mol⁻¹": 1, ev: 96.485 },
  ea: { "kj/mol": 1, "kj mol-1": 1, "kj mol^-1": 1, "kj·mol⁻¹": 1, ev: 96.485 },
};

function unitFactor(property: Property, unit: string | undefined | null): number | null {
  const key = (unit ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return UNITS[property][key] ?? null;
}

/** Properties a text names, in the order they first appear. */
function propertiesIn(text: string): { properties: Property[]; uncertifiable: boolean } {
  const plain = declarationText(text);
  const uncertifiable = UNCERTIFIABLE.test(plain);
  // "ionic radius" names an uncertifiable radius, not also the covalent one.
  const otherRadius = /\b(?:ionic|metallic|van\s+der\s+waals|vdw|crystal)\s+radi/i.test(plain) && !/\b(?:atomic|covalent)\s+radi/i.test(plain);
  const properties = PROPERTIES.flatMap(([property, expression]) => {
    const at = plain.search(expression);
    return at >= 0 && !(property === "radius" && otherRadius) ? [{ property, at }] : [];
  }).sort((left, right) => left.at - right.at).map(({ property }) => property);
  return { properties, uncertifiable };
}

function tableValue(property: Property, element: ElementRecord): number | null {
  if (property === "ea") {
    const egh = propertyValue("egh", element);
    return egh === null ? null : -egh;
  }
  return propertyValue(property, element);
}

/** Half a unit in the last written place of a JSON number, so 4.0 (stored as
 * 4) reads to the unit and 3.2 to the tenth. */
function halfStep(value: number): number {
  const text = String(value);
  const decimals = text.includes(".") ? text.split(".")[1]!.length : 0;
  return 0.5 * 10 ** -decimals;
}

const APPROXIMATE = /\b(?:approx(?:imate(?:ly)?)?|about|around|roughly|nearly|typically|~)|≈|~/i;

/** A written value agrees with the table at its own precision; a value
 * marked approximate may also round to 1% of the table value. */
function agrees(written: number, factor: number, table: number, approximate: boolean): boolean {
  const value = written * factor;
  const tolerance = Math.max(halfStep(written) * factor, approximate ? 0.01 * Math.abs(table) : 0, 1e-9 * Math.max(1, Math.abs(table)));
  return Number.isFinite(value) && Math.abs(value - table) <= tolerance + 1e-9;
}

const PROPERTY_UNIT_WORD = /^(?:pm|nm|å|angstroms?|kj\/mol|kj mol-1|ev)$/i;

function planIssues(plan: TurnPlanV3, plotted: Property): SceneIssue[] {
  const issues: SceneIssue[] = [];
  for (const [kind, index, quantity] of planQuantities(plan)) {
    if (quantityAgrees(quantity, plotted, kind)) continue;
    issues.push(planIssue(kind, index, "periodic_plan_fact_unverified",
      "periodic plan scalar lacks an unambiguous element-and-property value that matches the element table"));
  }
  return issues;
}

/** True when the quantity is certified by the table, or is an unrelated given. */
function quantityAgrees(quantity: TurnPlanQuantityV3, plotted: Property, kind: "givens" | "derived"): boolean {
  const symbol = propertiesIn(quantity.symbol);
  const source = propertiesIn(quantity.sourceText ?? "");
  const unitWord = (quantity.unit ?? "").trim();
  const named = symbol.properties.length > 0 || source.properties.length > 0 || symbol.uncertifiable || source.uncertifiable;
  if (!named && kind === "givens" && !PROPERTY_UNIT_WORD.test(unitWord)) return true;
  if (symbol.uncertifiable || (symbol.properties.length === 0 && source.uncertifiable)) return false;
  const properties = symbol.properties.length > 0 ? symbol.properties : source.properties;
  // A bare element value in the plotted property's unit reads as that property.
  const property = properties.length === 1 ? properties[0]!
    : properties.length === 0 && unitFactor(plotted, quantity.unit) !== null && unitWord !== "" ? plotted : null;
  if (!property) return false;
  const symbolElements = mentionedElements(quantity.symbol, ELEMENTS);
  const sourceElements = mentionedElements(quantity.sourceText ?? "", ELEMENTS);
  const elements = symbolElements.length > 0 ? symbolElements : sourceElements;
  if (elements.length !== 1) return false;
  const table = tableValue(property, elements[0]!);
  const factor = unitFactor(property, quantity.unit);
  if (table === null || factor === null) return false;
  return agrees(quantity.value, factor, table, APPROXIMATE.test(quantity.sourceText ?? ""));
}

/** Element symbols (case-sensitive, not followed by a charge) and names. */
function elementPattern(): RegExp {
  const symbols = ELEMENTS.map((element) => element.symbol);
  const names = ELEMENTS.flatMap((element) => [element.name, element.name.toLowerCase()]);
  const tokens = [...symbols, ...names].sort((a, b) => b.length - a.length);
  return new RegExp(`(?<![A-Za-z])(${tokens.join("|")})(?![A-Za-z+\\-^⁺⁻])`, "g");
}

let ELEMENT_PATTERN: RegExp | null = null;

function elementOf(token: string): ElementRecord | null {
  return elementBySymbol(token) ?? ELEMENTS.find((element) => element.name.toLowerCase() === token.toLowerCase()) ?? null;
}

function claimUnit(text: string, property: Property): number | null {
  const lower = text.toLowerCase();
  // Only a written unit word counts; the dimensionless "1" is never read out
  // of a value such as 3.16.
  const written = Object.keys(UNITS[property]).filter((unit) => /[a-zå]/.test(unit)
    && new RegExp(`(?<![a-z])${unit.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![a-z])`).test(lower));
  if (written.length > 1) return null;
  return written.length === 1 ? UNITS[property][written[0]!]! : 1;
}

interface WrittenNumber { readonly start: number; readonly end: number; readonly value: number; readonly step: number }

/**
 * The whole number written at `at`: sign, digits, decimals and a scientific
 * exponent (166e3, 5.20e2, 5.2 × 10^2). `step` is half a unit in the last
 * written place of the mantissa, scaled by the exponent. A multiplier the
 * reader cannot parse (× 10 with no exponent, a caret with nothing after it)
 * leaves the number unread, so its prefix is never taken as the value.
 */
function writtenNumberAt(text: string, at: number): WrittenNumber | null {
  const match = /^[-−]?\d+(?:\.\d+)?/.exec(text.slice(at));
  if (!match) return null;
  const mantissa = Number(match[0].replace("−", "-"));
  const decimals = match[0].includes(".") ? match[0].split(".")[1]!.length : 0;
  let end = at + match[0].length;
  let exponent = 0;
  const scientific = /^\s*(?:[eE]\s*([+\-−]?\d+)|[×x*·]\s*10\s*\^?\s*\(?\s*([+\-−]?\d+)\s*\)?)/.exec(text.slice(end));
  if (scientific) {
    exponent = Number((scientific[1] ?? scientific[2]!).replace("−", "-"));
    end += scientific[0].length;
  } else if (/^\s*(?:[eE](?![a-z])|[×*^]|x\s*10\b)/.test(text.slice(end))) {
    return null;
  }
  const scale = 10 ** exponent;
  return { start: at, end, value: mantissa * scale, step: 0.5 * 10 ** -decimals * scale };
}

/** Every number written in a claim, read whole. */
function writtenNumbers(text: string): Array<WrittenNumber | { start: number; end: number; value: null }> {
  const found: Array<WrittenNumber | { start: number; end: number; value: null }> = [];
  for (const match of text.matchAll(/(?<![\d.])[-−]?\d+(?:\.\d+)?/g)) {
    const at = match.index ?? 0;
    if (found.some((entry) => at < entry.end)) continue;
    found.push(writtenNumberAt(text, at) ?? { start: at, end: at + match[0].length, value: null });
  }
  return found;
}

/** Spans whose digits name no property value: Group 17, Period 2 to 3, a
 * shell list (2,8,1), n = 3, an orbital or ordinal (2p, 1st), a symbol
 * suffix (IE1, sp3) and the per-mole exponent of kJ mol-1. */
function labelSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const add = (expression: RegExp) => {
    for (const match of text.matchAll(expression)) spans.push([match.index ?? 0, (match.index ?? 0) + match[0].length]);
  };
  add(/\b(?:groups?|periods?)\s+\d{1,2}(?:\s*(?:,|and|to|-|–|−)\s*\d{1,2})*\b/gi);
  add(/\(\s*\d{1,2}(?:\s*,\s*\d{1,2})+\s*\)|(?<![\d.])\d{1,2}(?:,\d{1,2})+(?![\d.])/g);
  add(/\bn\s*=\s*\d+/g);
  add(/(?<![\d.])\d+(?:[spdf](?![a-z])|st\b|nd\b|rd\b|th\b)/gi);
  add(/(?<=[A-Za-z^])[-−]?\d+/g);
  return spans;
}

interface ClaimElement { readonly element: ElementRecord; readonly token: string; readonly value: WrittenNumber | null; readonly end: number; readonly start: number }

/** Element tokens in a claim with the number written straight after each
 * ("Li 520", "Na (166 pm)", "F: 3.98", "Li 5.20e2"). A shell list such as
 * "Na (2,8,1)" or an ordinal is not a value. */
function claimElements(text: string): ClaimElement[] {
  ELEMENT_PATTERN ??= elementPattern();
  return [...text.matchAll(ELEMENT_PATTERN)].flatMap((match): ClaimElement[] => {
    const element = elementOf(match[1]!);
    if (!element) return [];
    const start = match.index ?? 0;
    const tokenEnd = start + match[0].length;
    const lead = /^\s*(?:\(|:|=|is)?\s*(?=[-−]?\d)/.exec(text.slice(tokenEnd));
    const number = lead ? writtenNumberAt(text, tokenEnd + lead[0].length) : null;
    const after = number ? text.slice(number.end) : "";
    if (!number || /^\s*,\s*\d|^\d|^\s*(?:th|st|nd|rd)\b/.test(after)) {
      return [{ element, token: match[1]!, value: null, start, end: tokenEnd }];
    }
    const tail = /^(?:\s*(?:pm|nm|å|kj\/mol|kj mol-1|ev))?\s*\)?/i.exec(after)!;
    return [{ element, token: match[1]!, value: number, start, end: number.end + tail[0].length }];
  });
}

/** Claims the planner narrates beside the graph: "Na 186" style element
 * values, a clause naming one element and one value ("F has the highest
 * electronegativity (Pauling value 3.98)") and "Na > Mg > Al" rankings,
 * under the one property the claim names (or, naming none, the plotted
 * one). Every number in the claim must be one of these values or a label
 * (a group, period, shell list or orbital); any other number, a value
 * under no single certifiable property, a mixed unit, or a ranking of
 * signed enthalpies leaves the claim unread, and the figure declines. */
function claimIssues(plan: TurnPlanV3, plotted: Property): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const fail = (index: number, code: string, message: string) => issues.push({ code, severity: "fatal",
    path: `turnPlan.qualitativeClaims[${index}]`, message });
  for (const claim of planClaims(plan)) {
    const text = claim.text.normalize("NFKC");
    const elements = claimElements(text);
    const ranks = elements.slice(1).map((right, i) => {
      const left = elements[i]!;
      const gap = /^\s*([<>])\s*$/.exec(text.slice(left.end, right.start));
      return gap ? { left, right, operator: gap[1]! } : null;
    }).filter((rank) => rank !== null);
    const labels = labelSpans(text);
    const inside = (start: number, end: number, spans: ReadonlyArray<readonly [number, number]>) =>
      spans.some(([from, to]) => start >= from && end <= to);
    const valued: Array<{ token: string; element: ElementRecord; value: WrittenNumber }> = elements
      .flatMap((entry) => entry.value ? [{ token: entry.token, element: entry.element, value: entry.value }] : []);
    const consumed = valued.map((entry) => [entry.value.start, entry.value.end] as const);
    let unread = false;
    const loose = writtenNumbers(text).filter((entry) => !inside(entry.start, entry.end, consumed) && !inside(entry.start, entry.end, labels));
    // A clause naming one element and one value pairs them.
    for (const [from, to] of clauseSpans(text)) {
      const own = loose.filter((entry) => entry.start >= from && entry.end <= to);
      const named = [...new Set(elements.filter((entry) => entry.start >= from && entry.end <= to).map((entry) => entry.element))];
      if (own.length !== 1 || named.length !== 1 || own[0]!.value === null) continue;
      valued.push({ token: named[0]!.symbol, element: named[0]!, value: own[0] as WrittenNumber });
      loose.splice(loose.indexOf(own[0]!), 1);
    }
    if (loose.length > 0) unread = true;
    const facts: boolean[] = [];
    if (valued.length > 0 || ranks.length > 0) {
      const { properties, uncertifiable } = propertiesIn(text);
      // A claim whose subject (its first-named property) is the plotted one
      // states its values about the graph; a cause named later is context.
      const property = uncertifiable ? null : properties.length === 1 ? properties[0]!
        : properties.length === 0 || properties[0] === plotted ? plotted : null;
      const factor = property ? claimUnit(text, property) : null;
      if (!property || factor === null) unread = true;
      else {
        const approximate = APPROXIMATE.test(text);
        for (const entry of valued) {
          const table = tableValue(property, entry.element);
          if (table === null) unread = true;
          else facts.push(agreesWritten(entry.value, factor, table, approximate));
        }
        // A ranking of signed enthalpies is ambiguous (more negative or larger?).
        if (ranks.length > 0 && (property === "egh" || property === "ea")) unread = true;
        else for (const rank of ranks) {
          const a = tableValue(property, rank.left.element);
          const b = tableValue(property, rank.right.element);
          if (a === null || b === null) unread = true;
          else facts.push(rank.operator === ">" ? a > b : a < b);
        }
      }
    }
    const verdict = claimVerdict(claim, { facts, unread });
    if (verdict === "conflict") fail(claim.index, "periodic_plan_claim_conflict", "periodic plan claim contradicts the element table");
    if (verdict === "unread") fail(claim.index, "periodic_plan_claim_unverified",
      "periodic plan claim has a number, property, unit or expectation the element table reader cannot check");
  }
  return issues;
}

/** Sentence and semicolon clauses; a decimal point does not end a clause. */
function clauseSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let from = 0;
  for (const match of text.matchAll(/;|\.(?!\d)|\n/g)) {
    spans.push([from, match.index ?? 0]);
    from = (match.index ?? 0) + match[0].length;
  }
  spans.push([from, text.length]);
  return spans;
}

/** A written value agrees with the table at its own written precision. */
function agreesWritten(written: WrittenNumber, factor: number, table: number, approximate: boolean): boolean {
  const value = written.value * factor;
  const tolerance = Math.max(written.step * factor, approximate ? 0.01 * Math.abs(table) : 0, 1e-9 * Math.max(1, Math.abs(table)));
  return Number.isFinite(value) && Math.abs(value - table) <= tolerance + 1e-9;
}

interface PlottedPoint { readonly property: Property; readonly element: ElementRecord }

/** The plotted element and property of a regenerated quantity, when its value is the table value. */
function plottedPoint(quantity: SceneDocument["quantities"][number]): PlottedPoint | null {
  const match = /^(ie1|electronegativity|radius|egh)\(([A-Z][a-z]?)\)$/.exec(String(quantity.symbol ?? ""));
  if (!match || typeof quantity.value !== "number") return null;
  const property = match[1] as PeriodicProperty;
  const element = elementBySymbol(match[2]!);
  const table = element ? propertyValue(property, element) : null;
  return element && table !== null && quantity.value === table ? { property, element } : null;
}

/** Certify a periodic trend graph of neutral elements. Ionic radius series and
 * the periodic table position figure keep the generic audit. */
export function certifyPeriodicSourceDocument(document: SceneDocument, question: string, plan: TurnPlanV3 | null): ChemistrySourceCertification {
  const claimsFamily = document.source.chemistryFamily === PERIODIC_FAMILY || document.source.archetype === PERIODIC_FAMILY;
  if (!claimsFamily || !isPeriodicTrendStem(question)) return { status: "not_applicable" };
  let raw: SceneDocument | null;
  try {
    raw = buildPeriodicTrendScene(question, [], false);
  } catch {
    return { status: "not_applicable" };
  }
  if (!raw || raw.quantities.length === 0) return { status: "not_applicable" };
  const points = raw.quantities.map(plottedPoint);
  if (points.some((point) => point === null)) return { status: "not_applicable" };
  const plotted = points[0]!.property;
  if (points.some((point) => point!.property !== plotted)) return { status: "not_applicable" };
  const fresh = validateSceneDocument(pruneDeadSceneEntities(raw as unknown as Record<string, unknown>)).document;
  const submitted = validateSceneDocument(document).document;
  if (!fresh || !submitted || !graphMatches(submitted, fresh, plan)) return { status: "not_applicable" };
  const issues = plan ? [...planIssues(plan, plotted), ...claimIssues(plan, plotted)] : [];
  if (issues.length) return { status: "rejected", issues };
  const compiled = compileSceneDocument(fresh);
  if (!compiled.ok || !compiled.renderScene) return { status: "not_applicable" };
  return {
    status: "certified",
    texts: displayedSceneQuantityTexts(fresh),
    quantities: fresh.quantities.map((quantity) => ({ id: quantity.id, value: quantity.value, unit: quantity.unit })),
  };
}
