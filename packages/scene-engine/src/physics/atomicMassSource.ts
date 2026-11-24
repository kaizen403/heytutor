import type { SceneConstruction, SceneDocument, SceneIssue } from "../types";
import { unwrapMathMarkup } from "@heytutor/drawing";
import type { TurnPlanQuantityV3, TurnPlanV3 } from "../contracts/contractsV3";
import { CHEMISTRY_SCALAR_PATTERN, chemistryUnitSymbol, convertChemistryValue, parseChemistryScalar, readChemistryUnitLiteral } from "../chemistry/quantityReader";
import { resolveElement } from "../chemistry/elements";
import { readSourceScalarOutput } from "../ir/sourceScalarRelation";
import { ATOMIC_MASS_UNIT_KG } from "./atomicMassConstants";
import { bindIsotopeMeanMassSourceOutput } from "./isotopeMeanMassSource";
import { ATOMIC_OPERATORS } from "../compile/atomicGeometry";
import { MECHANICS_OPERATORS } from "../compile/mechanicsGeometry";

export { ATOMIC_MASS_UNIT_KG } from "./atomicMassConstants";

type MassConvention = "nuclear" | "atomic";
type MassSpecies = "proton" | "hydrogen" | "neutron" | "radiation";
interface NuclideOwner { A: number; Z: number }
interface MassMeaning { convention?: MassConvention; species?: MassSpecies; owner?: NuclideOwner; conflicting: boolean }

function normal(text: string): string { return text.normalize("NFKC").replace(/[−–]/g, "-").replace(/\s+/g, " ").trim(); }
function alias(text: string): string { return normal(text).replace(/[\s_{}()]/g, ""); }
function escape(text: string): string { return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

const SOURCE_MASS_UNIT_PATTERN = "(?:kg|g|u)";
const DISPLAY_MASS_UNITS = `${SOURCE_MASS_UNIT_PATTERN}|[kK]ilograms?|[gG]rams?|[dD]altons?|Da|amu|[aA]tomic mass units?`;
const DISPLAY_MASS_LITERAL = new RegExp(`(?:${CHEMISTRY_SCALAR_PATTERN})\\s*(?:${DISPLAY_MASS_UNITS})(?![\\p{L}\\p{N}_])`, "u");
const DISPLAY_ASSIGNMENT = /(?<![\p{L}\p{N}_])([\p{L}][\p{L}\p{N}_{}]*)\s*[=≈:]/gu;
function sameScalar(first: number, second: number): boolean {
  return Number.isFinite(first) && Number.isFinite(second) && Math.abs(first - second) <=
    32 * Number.EPSILON * Math.max(Math.abs(first), Math.abs(second), Number.MIN_VALUE);
}
function scalarValue(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const text = value.trim(), parsed = parseChemistryScalar(text, { start: 0, end: text.length });
  return parsed.ok ? parsed.reading : undefined;
}
function massInU(value: number, unit: unknown): number | undefined {
  if (typeof unit !== "string" || !Number.isFinite(value)) return undefined;
  const normalized = unit.trim();
  if (normalized === "u") return value;
  const from = chemistryUnitSymbol(normalized, "mass");
  if (!from) return undefined;
  const converted = convertChemistryValue(value, from, "kg", "mass");
  return converted.ok && Number.isFinite(converted.reading / ATOMIC_MASS_UNIT_KG) ? converted.reading / ATOMIC_MASS_UNIT_KG : undefined;
}

function containsMassLiteral(text: string, quantity: TurnPlanQuantityV3): boolean {
  const literal = new RegExp(`(${CHEMISTRY_SCALAR_PATTERN})\\s*(u|kg)(?=$|[\\s,;.)])`, "g");
  for (const match of text.matchAll(literal)) {
    if (match[2] !== quantity.unit?.trim()) continue;
    const start = match.index!, parsed = parseChemistryScalar(text, { start, end: start + match[1]!.length });
    if (parsed.ok && sameScalar(parsed.reading, quantity.value)) return true;
  }
  return false;
}

function canonicalIsotope(name: string): NuclideOwner | undefined {
  if (name === "D" || /^(?:deuterium|deuteron)$/i.test(name)) return { A: 2, Z: 1 };
  if (name === "T" || /^(?:tritium|triton)$/i.test(name)) return { A: 3, Z: 1 };
  if (/^(?:protium|proton)$/i.test(name)) return { A: 1, Z: 1 };
  if (/^(?:alpha|α)$/i.test(name)) return { A: 4, Z: 2 };
  return undefined;
}

/** Isotope names are checked against elemental Z, never against numeric masses. */
function namedOwners(text: string): { owners: NuclideOwner[]; conflicting: boolean } {
  const owners = new Map<string, NuclideOwner>();
  let conflicting = false;
  const add = (owner: NuclideOwner) => { owners.set(`${owner.A}:${owner.Z}`, owner); };
  for (const match of normal(text).matchAll(/\b([A-Za-z]{1,20})\s*[- ]?\s*(\d{1,3})(?![\d.])/g)) {
    const name = match[1]!, A = Number(match[2]), canonical = canonicalIsotope(name), element = resolveElement(name);
    if (canonical) { if (canonical.A !== A) conflicting = true; else add(canonical); }
    else if (element) { if (A < element.z || A > 300) conflicting = true; else add({ A, Z: element.z }); }
  }
  for (const match of text.matchAll(/\b(deuterium|deuteron|tritium|triton|protium|alpha|D|T)\b/gi)) {
    const owner = canonicalIsotope(match[1]!); if (owner) add(owner);
  }
  return { owners: [...owners.values()], conflicting };
}

function massOwner(text: string, symbol: string, question: string, meaning: MassMeaning): { owner?: NuclideOwner; conflicting: boolean } {
  const named = namedOwners(text);
  if (named.conflicting || named.owners.length > 1) return { conflicting: true };
  if (named.owners[0]) return { owner: named.owners[0], conflicting: false };
  // An explicit hydrogen-atom/protium reference is local source evidence;
  // unrelated deuterium/tritium participants cannot change its owner.
  if (meaning.owner) return { owner: meaning.owner, conflicting: false };
  if (meaning.species === "proton") return { owner: { A: 1, Z: 1 }, conflicting: false };
  if (meaning.species === "neutron") return { owner: { A: 1, Z: 0 }, conflicting: false };
  if (meaning.species === "radiation") return { owner: { A: 0, Z: 0 }, conflicting: false };
  const name = alias(symbol).replace(/^m(?=[A-Zα])/, ""), canonical = canonicalIsotope(name);
  if (canonical) return { owner: canonical, conflicting: false };
  const namedAlias = namedOwners(name);
  if (namedAlias.conflicting || namedAlias.owners.length > 1) return { conflicting: true };
  if (namedAlias.owners[0]) return { owner: namedAlias.owners[0], conflicting: false };
  const source = namedOwners(question), element = resolveElement(name);
  if (!element && meaning.species === "hydrogen") return { owner: { A: 1, Z: 1 }, conflicting: false };
  const candidates = source.owners.filter(owner => element ? owner.Z === element.z : owner.A > 1);
  if (candidates.length > 1) return { conflicting: true };
  if (candidates[0]) return { owner: candidates[0], conflicting: false };
  // The source's hydrogen-atom constituent reference denotes protium; an
  // explicitly named H-2/H-3 isotope above never receives this convention.
  if (meaning.species === "hydrogen") return { owner: { A: 1, Z: 1 }, conflicting: false };
  return { conflicting: false };
}

/** Negation belongs to its mass phrase, including a postposed prohibition. */
function positiveMassPhrase(text: string, start: number, end: number): boolean {
  const before = text.slice(0, start).split(/[,;:!?\n]|\.(?!\d)|\b(?:but|however)\b|\b(?:and|or)\s+(?=(?:use|using|take|given|with|do\s+not|don['’]t|never|avoid)\b)/i).at(-1) ?? "";
  const prefix = before.replace(/\bnot\s+only\b/gi, "");
  const suffix = text.slice(end).split(/[,;:!?\n]|\.(?!\d)/)[0] ?? "";
  return !/\b(?:not|no|never|avoid|avoiding|without|ignore|ignoring|exclude|excluding)\b|\bdon['’]t\b|\brather\s+than\b|\binstead\s+of\b/i.test(prefix) &&
    !/^\s*(?:(?:are|is|were|was|must|should|shall|may|can)\s+(?:not|never)(?!\s+only\b)\b|cannot\b|not\s+to\s+be\s+used\b)/i.test(suffix);
}

function hasPositiveMassPhrase(text: string, pattern: RegExp): boolean {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return [...text.matchAll(new RegExp(pattern.source, flags))].some(match => positiveMassPhrase(text, match.index!, match.index! + match[0].length));
}

/** A source mass-declaration grammar, never a chapter or question router. */
function commonConvention(question: string): MassConvention | "mixed" | undefined {
  const conventions = new Set<MassConvention>();
  const add = (name: string) => conventions.add(/nuclear|nucleus/i.test(name) ? "nuclear" : "atomic");
  const declaration = /\b(?:use|using|given|with|take)\s+(?:(?:the|following|supplied|these)\s+)*(nuclear|bare[- ]nucleus|neutral[- ]atom|atomic)\s+masses\b/gi;
  for (const match of question.matchAll(declaration)) {
    if (positiveMassPhrase(question, match.index!, match.index! + match[0].length)) add(match[1]!);
  }
  const coordinated = /\b(?:use|using|given|with|take)\s+(?:(?:the|following|supplied|these)\s+)*(nuclear|bare[- ]nucleus|neutral[- ]atom|atomic)(?:\s+masses)?\s+(and|or|rather\s+than|instead\s+of)\s+(nuclear|bare[- ]nucleus|neutral[- ]atom|atomic)\s+masses\b/gi;
  for (const match of question.matchAll(coordinated)) {
    const first = match.index! + match[0].indexOf(match[1]!), second = match.index! + match[0].lastIndexOf(match[3]!);
    if (positiveMassPhrase(question, first, first + match[1]!.length)) add(match[1]!);
    if (positiveMassPhrase(question, second, match.index! + match[0].length)) add(match[3]!);
  }
  for (const match of question.matchAll(/\b(nuclear|bare[- ]nucleus|neutral[- ]atom|atomic)\s+masses\b/gi)) {
    const end = match.index! + match[0].length;
    if (/^\s+(?:(?:are|were)\s+(?:(?:also|all|here)\s+)*|(?:must|should|shall)\s+be\s+)(?:given|supplied|provided|used)\b/i.test(question.slice(end)) && positiveMassPhrase(question, match.index!, end)) add(match[1]!);
  }
  if (!conventions.size) {
    if (hasPositiveMassPhrase(question, /\b(?:nuclear|bare[- ]nucleus)\s+masses\b/i)) conventions.add("nuclear");
    if (hasPositiveMassPhrase(question, /\b(?:atomic|neutral[- ]atom)\s+masses\b(?!\s+units?\b)/i)) conventions.add("atomic");
  }
  return conventions.size > 1 ? "mixed" : [...conventions][0];
}

function sourceMeaning(text: string, symbol: string, common: MassConvention | "mixed" | undefined): MassMeaning {
  const species = new Set<MassSpecies>(), conventions = new Set<MassConvention>();
  const positive = (pattern: RegExp) => hasPositiveMassPhrase(text, pattern);
  const boundState = positive(/\bnucleus\s+mass\b|\b(?:atomic|neutral[- ]atom)\s+mass\b(?!\s+units?\b)|\bneutral\b[^,;=]{0,80}\batom\s+mass\b/i);
  if ((!boundState && positive(/\bproton\b/i)) || positive(/\bbare\s+hydrogen(?:-1)?\s+nucleus\b/i)) { species.add("proton"); conventions.add("nuclear"); }
  if (!boundState && positive(/\bneutron\b/i)) species.add("neutron");
  const hydrogenReference = positive(/\bhydrogen[- ]atom\b|\b(?:neutral|atomic)\b[^,;=]{0,50}\b(?:hydrogen|protium)\b|\b(?:hydrogen|protium)\b[^,;=]{0,50}\batom(?:ic)?\b/i);
  if (hydrogenReference) { species.add("hydrogen"); conventions.add("atomic"); }
  if (positive(/\bphoton\b|\bgamma\s+rest\s+mass\b|γ/i)) species.add("radiation");
  if (positive(/\bnuclear\s+mass(?:es)?\b|\bnucleus\s+mass\b|\bmass\s+of\s+(?:the\s+)?(?:bare\s+)?nucleus\b/i)) conventions.add("nuclear");
  if (positive(/\b(?:atomic|neutral[- ]atom)\s+mass(?:es)?\b(?!\s+units?\b)|\bneutral\b[^,;=]{0,80}\batom\s+mass\b/i)) conventions.add("atomic");
  if (!species.size && !boundState && !/\b(?:proton|neutron|hydrogen|protium|photon)\b/i.test(text)) {
    const name = alias(symbol);
    if (/^m[pP]$|^proton(?:mass)?$/i.test(name)) { species.add("proton"); conventions.add("nuclear"); }
    else if (/^m[nN]$|^neutron(?:mass)?$/i.test(name)) species.add("neutron");
    else if (/^mH(?:1)?$|^hydrogen(?:atom)?(?:mass)?$/.test(name)) { species.add("hydrogen"); if (common === "atomic") conventions.add("atomic"); }
  }
  const negatedOnlyRole = !species.size && !conventions.size && /\b(?:proton|neutron|hydrogen|protium|photon)\b|\b(?:nuclear|atomic|neutral[- ]atom|nucleus)\s+mass(?:es)?\b|\bmass\s+of\s+(?:the\s+)?(?:bare\s+)?nucleus\b/i.test(text);
  return { species: [...species][0], convention: [...conventions][0], ...(hydrogenReference ? { owner: { A: 1, Z: 1 } } : {}), conflicting: species.size > 1 || conventions.size > 1 || negatedOnlyRole };
}

interface SourceMassContext { text: string; symbol: string; value?: number; unit: string; contextStart: number; literalStart: number; scalarEnd: number; literalEnd: number }

/** Delimit declarations without cutting isotope tuples or decimal centres. */
function sourceClauses(question: string): Array<{ start: number; end: number }> {
  const clauses: Array<{ start: number; end: number }> = [];
  let start = 0, depth = 0;
  for (let index = 0; index < question.length; index++) {
    const character = question[index]!;
    if ("([{".includes(character)) depth++;
    else if (")]}".includes(character)) depth = Math.max(0, depth - 1);
    const separator = /[,;!?\n]/.test(character) || character === "." && !/\d/.test(question[index + 1] ?? "") ||
      character === ":" && !/\bmass\b/i.test(question.slice(start, index));
    if (depth === 0 && separator) { clauses.push({ start, end: index }); start = index + 1; }
  }
  clauses.push({ start, end: question.length });
  return clauses;
}

function sourceMassContexts(question: string): SourceMassContext[] {
  const contexts: SourceMassContext[] = [];
  const literal = new RegExp(`(${CHEMISTRY_SCALAR_PATTERN})\\s*(${SOURCE_MASS_UNIT_PATTERN})(?=$|[\\s,;.)])`, "g");
  for (const clause of sourceClauses(question)) {
    const text = question.slice(clause.start, clause.end), matches = [...text.matchAll(literal)];
    for (let index = 0; index < matches.length; index++) {
      const match = matches[index]!;
      let localStart = index === 0 ? 0 : matches[index - 1]!.index! + matches[index - 1]![0].length;
      const heading = [...text.slice(localStart, match.index!).matchAll(/\b(?:use|using|given|with|take)\s+(?:(?:the|following|supplied|these)\s+)*(?:nuclear|bare[- ]nucleus|neutral[- ]atom|atomic)\s+masses\b/gi)].at(-1);
      if (heading) localStart += heading.index! + heading[0].length;
      const localEnd = matches.length === 1 || index === matches.length - 1 ? text.length : match.index! + match[0].length;
      const context = text.slice(localStart, localEnd);
      const assignments = [...context.slice(0, match.index! - localStart).matchAll(/([\p{L}][\p{L}\p{N}_{}]*)\s*=/gu)];
      const leadingSpace = match[0].length - match[0].trimStart().length;
      const parsed = parseChemistryScalar(text, { start: match.index!, end: match.index! + match[1]!.length });
      contexts.push({ text: context, symbol: assignments.at(-1)?.[1] ?? "", value: parsed.ok ? parsed.reading : undefined, unit: match[2]!,
        contextStart: clause.start + localStart,
        literalStart: clause.start + match.index! + leadingSpace, scalarEnd: clause.start + match.index! + match[1]!.length,
        literalEnd: clause.start + match.index! + match[0].length });
    }
  }
  return contexts;
}

export { sourceMassContexts, namedOwners as readNamedNuclideOwners };

function massContextsInQuote(source: string, quote: string, contexts: SourceMassContext[]): SourceMassContext[] | null {
  const text = normal(quote), spans: Array<{ start: number; end: number }> = [];
  if (!text) return null;
  for (let index = source.indexOf(text); index >= 0; index = source.indexOf(text, index + text.length)) spans.push({ start: index, end: index + text.length });
  return spans.length ? contexts.filter(context => spans.some(span => context.literalStart >= span.start && context.literalEnd <= span.end)) : null;
}

function contextMassMeaning(context: SourceMassContext, source: string, common: MassConvention | "mixed" | undefined, symbol = context.symbol): MassMeaning {
  const meaning = sourceMeaning(context.text, symbol, common), ownership = massOwner(context.text, symbol, source, meaning);
  return { ...meaning, ...ownership, ...(ownership.owner && ownership.owner.A > 1 && meaning.species === "hydrogen" ? { species: undefined } : {}),
    conflicting: meaning.conflicting || ownership.conflicting };
}

/** A noun attached to an original mass literal owns that literal. This also
 * keeps comma-separated attributes ('3 kg, 2 m rod') on the same noun. */
function sourceMassNoun(context: SourceMassContext, source: string): string | undefined {
  const before = source.slice(context.contextStart, context.literalStart);
  const prefix = /\b([\p{L}]+)\s+(?:(?:of|with)\s+)?mass\s*(?:[\p{L}][\p{L}\p{N}_{}]*\s*=\s*)?$/u.exec(before) ??
    /\bmass\s+of\s+(?:(?:the|a|an|uniform|solid)\s+)*([\p{L}]+)(?:\s+(?:is|=))?\s*$/u.exec(before);
  if (prefix && !/^(?:atomic|nuclear|neutral|isotope|nucleus|bare)$/i.test(prefix[1]!)) return prefix[1]!.toLowerCase();
  if (/\bmass\b|=/i.test(before)) return undefined;
  let end = context.literalEnd;
  const attribute = new RegExp(`^\\s*,\\s*(${CHEMISTRY_SCALAR_PATTERN})`);
  for (let match = attribute.exec(source.slice(end)); match; match = attribute.exec(source.slice(end))) {
    const start = end + match[0].indexOf(match[1]!);
    const reading = readChemistryUnitLiteral({ question: source, scalarSpan: { start, end: start + match[1]!.length } });
    if (!reading.ok || reading.reading.dimension === "mass") return undefined;
    end = reading.reading.source.span.end;
  }
  const noun = /^\s+([\p{L}]+)\b/u.exec(source.slice(end))?.[1];
  return noun && !/^(?:and|or|of|at|in|on|with|is|are|was|were|per|to|for|from|then|the|a|an)$/i.test(noun) ? noun.toLowerCase() : undefined;
}

function quotedMassMeaning(quantity: TurnPlanQuantityV3, question: string, common: MassConvention | "mixed" | undefined): MassMeaning | null {
  const source = normal(question), quote = quantity.sourceText?.trim(), inventory = sourceMassContexts(source);
  if (quote && !containsMassLiteral(normal(quote), quantity)) return null;
  const sourceSymbol = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escape(quantity.symbol)}(?:$|[^\\p{L}\\p{N}_])`, "u");
  const cited = quote ? massContextsInQuote(source, quote, inventory) : inventory.filter(context => sourceSymbol.test(context.text));
  const contexts = cited?.filter(context => containsMassLiteral(source.slice(context.literalStart, context.literalEnd), quantity)) ?? [];
  if (!contexts.length) return null;
  const meanings = contexts.map(context => {
    // The source assignment owns the literal. A planner symbol cannot relabel
    // a numeric-only tritium quote as a deuterium mass.
    const symbol = context.symbol || (!quote && sourceSymbol.test(context.text) ? quantity.symbol : "");
    return contextMassMeaning(context, source, common, symbol);
  });
  const identity = (meaning: MassMeaning) => JSON.stringify([meaning.species, meaning.convention ?? common, meaning.owner, meaning.conflicting]);
  return { ...meanings[0]!, conflicting: meanings.some(meaning => meaning.conflicting || identity(meaning) !== identity(meanings[0]!)) };
}

/** A given mass retains its actual source assignment and owner even when a
 * generic drawing, rather than a native physical construction, displays it.
 * Derived/unknown masses keep their existing solver/proof authority. */
export function auditOriginalMassSourceGivens(document: SceneDocument, plan: TurnPlanV3): {
  issues: SceneIssue[]; certifiedQuantityIds: string[]; applicableQuantityIds: string[]; hasOriginalMassDeclarations: boolean;
} {
  const source = normal(plan.question), common = commonConvention(plan.question), contexts = sourceMassContexts(source);
  const declarations = contexts.filter(context => {
    if (context.unit === "u") return !/^\s*c\s*(?:\^\s*2|2)\b/i.test(source.slice(context.literalEnd));
    // The existing complete-unit reader distinguishes a mass from a kg/g
    // prefix in momentum, density or another compound quantity.
    const literal = readChemistryUnitLiteral({ question: source, scalarSpan: { start: context.literalStart, end: context.scalarEnd } });
    return literal.ok && literal.reading.dimension === "mass";
  }).map(context => {
    const meaning = contextMassMeaning(context, source, common), named = namedOwners(context.text);
    const species = hasPositiveMassPhrase(context.text, /\b(?:proton|neutron|hydrogen|protium|photon|deuterium|deuteron|tritium|triton|alpha)\b/i);
    const sourceName = alias(context.symbol).replace(/^m(?=[A-Zα])/, "");
    const owned = named.conflicting || named.owners.length > 0 || species || common !== undefined &&
      (canonicalIsotope(sourceName) !== undefined || Boolean(resolveElement(sourceName)) || meaning.species !== undefined);
    return { context, meaning, owned, noun: owned ? undefined : sourceMassNoun(context, source) };
  });
  type Declaration = (typeof declarations)[number];
  const role = ({ meaning, owned, noun }: Declaration) => JSON.stringify([
    owned ? meaning.owner : undefined, owned ? meaning.species : undefined, owned ? meaning.convention ?? common : undefined, noun]);
  const sameDeclaration = (first: Declaration, second: Declaration) => {
    const firstValue = first.context.value === undefined ? undefined : massInU(first.context.value, first.context.unit);
    const secondValue = second.context.value === undefined ? undefined : massInU(second.context.value, second.context.unit);
    return firstValue !== undefined && secondValue !== undefined && sameScalar(firstValue, secondValue) && role(first) === role(second);
  };
  const sameSourceMass = (declaration: Declaration, value: unknown, unit: unknown) => {
    const parsed = scalarValue(value), sourceValue = declaration.context.value;
    const actual = parsed === undefined ? undefined : massInU(parsed, unit);
    const expected = sourceValue === undefined ? undefined : massInU(sourceValue, declaration.context.unit);
    return actual !== undefined && expected !== undefined && sameScalar(actual, expected);
  };
  const ownerEqual = (first: NuclideOwner, second: NuclideOwner) => first.A === second.A && first.Z === second.Z;
  const knownOwners = [...namedOwners(source).owners, ...declarations.flatMap(declaration => declaration.owned && declaration.meaning.owner ? [declaration.meaning.owner] : [])];
  const references = (names: Set<string>) => declarations.filter(declaration => [...names].some(name => {
    const massName = /^m(.+)$/.exec(name)?.[1];
    if (!massName) return name === "m" && declarations.length === 1 &&
      readSourceScalarOutput(plan.question, "m", "kg").status !== "certified";
    if (declaration.noun) return massName.toLowerCase() === declaration.noun || massName.length === 1 && declaration.noun.startsWith(massName.toLowerCase());
    if (!declaration.owned || !declaration.meaning.owner) return false;
    const numbered = /^\d{1,3}$/.test(massName), named = namedOwners(massName), canonical = canonicalIsotope(massName), element = resolveElement(massName);
    const elemental = element ? knownOwners.filter(owner => owner.Z === element.z) : [];
    const uniqueElemental = [...new Map(elemental.map(owner => [`${owner.A}:${owner.Z}`, owner])).values()];
    const owners = numbered ? knownOwners.filter(owner => owner.A === Number(massName)) : named.owners.length ? named.owners : canonical ? [canonical] : uniqueElemental.length === 1 ? uniqueElemental : [];
    return owners.some(owner => ownerEqual(owner, declaration.meaning.owner!));
  }));
  type AnnotationOwner = { annotation: SceneDocument["annotations"][number]; targetId: string; owner?: NuclideOwner; noun?: string };
  const annotationOwners = (id: string): AnnotationOwner[] => document.annotations.filter(annotation => annotation.quantityId === id).flatMap(annotation =>
    annotation.targetIds.flatMap<AnnotationOwner>(targetId => {
      const entity = document.entities.find(candidate => candidate.id === targetId);
      if (!entity) return [];
      let named = namedOwners(entity.role ?? "");
      if (!named.owners.length && /\bnucleus\b|\bnuclide\b|\bisotope\b|\batom\b|\breactant\b|\bproduct\b|\breaction participant\b/i.test(entity.role ?? "")) named = namedOwners(entity.label ?? "");
      if (!named.owners.length && (!entity.role || entity.role === entity.kind)) {
        const label = namedOwners(entity.label ?? "");
        if (label.owners.every(owner => knownOwners.some(known => ownerEqual(owner, known)))) named = label;
      }
      const nouns = [...new Set(declarations.flatMap(declaration => declaration.noun &&
        new RegExp(`\\b${escape(declaration.noun)}\\b`, "i").test(`${entity.role ?? ""} ${entity.label ?? ""}`) ? [declaration.noun] : []))];
      return !named.conflicting && named.owners.length === 1 ? [{ annotation, targetId, owner: named.owners[0] }] :
        nouns.length === 1 ? [{ annotation, targetId, noun: nouns[0] }] : [];
    }));
  // A source instruction to leave a named mass symbolic is still authority
  // when there is no numeric declaration to inventory. Other derived fields
  // (for example delta_m) keep their existing numeric proof boundary.
  const prohibitNumericalMass = /\b(?:do\s+not|don['’]t|never)\s+(?:give|provide|supply|state|display|label)\s+(?:(?:a|the|any)\s+)?(?:numerical|numeric)\s+mass\b/i.test(source);
  const symbolicFields = prohibitNumericalMass ? sourceClauses(source).flatMap(clause => {
    if (contexts.some(context => context.literalStart >= clause.start && context.literalStart < clause.end)) return [];
    const text = source.slice(clause.start, clause.end), owners = namedOwners(text);
    return [...text.matchAll(/\bmass\s+([\p{L}][\p{L}\p{N}_{}]*)\b/gu)].filter(match =>
      !/^(?:is|was|are|of|in|unit|units|not|unknown|unspecified|defect|difference)$/i.test(match[1]!)).map(match =>
      ({ symbol: alias(match[1]!), owner: !owners.conflicting && owners.owners.length === 1 ? owners.owners[0] : undefined }));
  }) : [];
  const compactAssignmentQuote = (quote: string, names: Set<string>, expected: Declaration, quantity: TurnPlanQuantityV3) => {
    const text = normal(quote), assignment = new RegExp(`^([\\p{L}][\\p{L}\\p{N}_{}]*)\\s*=\\s*(${CHEMISTRY_SCALAR_PATTERN})(?:\\s*(${SOURCE_MASS_UNIT_PATTERN}))?$`, "u").exec(text);
    // Legacy generic mass givens can quote just their field name. They still
    // need the unique original declaration and its exact value/unit below;
    // an isotope-owned mass cannot borrow this shorthand.
    if (!assignment) return !expected.owned && names.has(alias(text)) && sameSourceMass(expected, quantity.value, quantity.unit);
    if (!names.has(alias(assignment[1]!))) return false;
    const numberStart = text.indexOf(assignment[2]!, text.indexOf("=") + 1), numberEnd = numberStart + assignment[2]!.length;
    const parsed = parseChemistryScalar(text, { start: numberStart, end: numberEnd });
    return parsed.ok && (sameSourceMass(expected, parsed.reading, assignment[3] ?? quantity.unit) ||
      !assignment[3] && sameSourceMass(expected, parsed.reading, expected.context.unit));
  };
  const issues: SceneIssue[] = [], certifiedQuantityIds: string[] = [], applicableQuantityIds: string[] = [];
  const native = document.constructions.some(construction => (ATOMIC_OPERATORS as readonly string[]).includes(construction.operator) ||
    (MECHANICS_OPERATORS as readonly string[]).includes(construction.operator));
  const displayed = [...document.entities.flatMap(entity => typeof entity.label === "string" ? [entity.label] : []),
    ...document.annotations.flatMap(annotation => typeof annotation.text === "string" ? [annotation.text] : []),
    ...document.constructions.flatMap(construction => construction.operator === "label" && typeof construction.inputs.text === "string" ? [construction.inputs.text] : [])]
    .map(text => normal(unwrapMathMarkup(text)));
  for (const quantity of [...plan.givens, ...plan.derived]) {
    const priorIssueCount = issues.length;
    const candidate = document.quantities.find(item => item.id === quantity.id);
    const names = new Set([quantity.id, quantity.symbol, typeof candidate?.symbol === "string" ? candidate.symbol : ""].filter(Boolean).map(alias));
    const direct = declarations.filter(({ context }) => context.symbol && names.has(alias(context.symbol)));
    const referenced = references(names);
    const sourceGiven = quantity.provenance === "given";
    const prohibited = symbolicFields.some(field => names.has(field.symbol));
    // Applicability follows the quantity's dimension or its actual source
    // field. The '1 u' operand in an energy conversion is not a mass given.
    const massQuantity = massInU(quantity.value, quantity.unit) !== undefined;
    if (!direct.length && !referenced.length && !massQuantity && !prohibited) continue;
    // A nonphysical legacy figure does not consume an unrelated, unused plan
    // given. Keep its ordinary audit; every actual source mass, native program,
    // candidate operand, bound annotation or displayed mass still needs proof.
    if (!native && !declarations.length && sourceGiven && massQuantity && !prohibited && !candidate &&
        !document.annotations.some(annotation => annotation.quantityId === quantity.id) &&
        !displayed.some(text => DISPLAY_MASS_LITERAL.test(text) ||
          [...text.matchAll(DISPLAY_ASSIGNMENT)].some(match => names.has(alias(match[1]!))))) continue;
    applicableQuantityIds.push(quantity.id);
    if (prohibited) {
      issues.push({ code: "atomic_mass_source_unbound", severity: "fatal", path: `${sourceGiven ? "givens" : "derived"}.${quantity.id}`,
        message: `Mass ${quantity.id} is explicitly left without a numerical value in the original source; changing its provenance or display cannot invent one` });
      continue;
    }
    // A derived tag cannot replace an original mass field. New derived
    // symbols retain the solver/proof authority that already governs them.
    if (!sourceGiven && !direct.length && !referenced.length) continue;
    if (!sourceGiven) {
      // An explicitly source-defined mean symbol can resemble an isotope's
      // conventional mass alias. Its independently proved output binding owns
      // that name; neither number may borrow the individual isotope's mass.
      const mean = bindIsotopeMeanMassSourceOutput({ question: plan.question, turnPlan: plan, quantityId: quantity.id });
      if (mean.status === "certified") {
        const expected = massInU(mean.binding.approximate, mean.binding.unit);
        const actual = massInU(quantity.value, quantity.unit);
        const candidateValue = candidate && scalarValue(candidate.value);
        const candidateMass = candidateValue === undefined || !candidate ? undefined : massInU(candidateValue, candidate.unit);
        if (expected === undefined || actual === undefined || !sameScalar(actual, expected) ||
            candidate && (candidateMass === undefined || !sameScalar(candidateMass, expected))) {
          issues.push({ code: "atomic_mass_source_mismatch", severity: "fatal", path: `derived.${quantity.id}`,
            message: `Source-defined mean mass ${quantity.id} must retain its abundance-weighted value rather than an individual isotope's mass` });
        }
        continue;
      }
    }
    const quote = sourceGiven ? quantity.sourceText?.trim() : undefined, quotedContexts = quote ? massContextsInQuote(source, quote, contexts) : null;
    const quoted = quotedContexts ? declarations.filter(declaration => quotedContexts.includes(declaration.context) && sameSourceMass(declaration, quantity.value, quantity.unit)) : [];
    const targets = annotationOwners(quantity.id);
    const targetBindings = declarations.filter(declaration => targets.some(target =>
      target.owner && declaration.owned && declaration.meaning.owner && ownerEqual(target.owner, declaration.meaning.owner) || target.noun && target.noun === declaration.noun));
    const matches = declarations.filter(declaration => sameSourceMass(declaration, quantity.value, quantity.unit));
    const bindings = direct.length ? direct : referenced.length ? referenced : targetBindings.length ? targetBindings : quoted.length ? quoted : matches;
    if (!bindings.length) {
      issues.push({ code: "atomic_mass_source_unbound", severity: "fatal", path: `${sourceGiven ? "givens" : "derived"}.${quantity.id}`,
        message: `Given mass ${quantity.id} needs an actual numerical mass declaration in the original source question` });
      continue;
    }
    const expected = bindings[0]!, ambiguous = bindings.some(binding => binding.context.value === undefined || binding.owned && binding.meaning.conflicting || !sameDeclaration(binding, expected));
    const mixed = common === "mixed" && bindings.some(binding => binding.owned);
    const quoteInvalid = quote && !compactAssignmentQuote(quote, names, expected, quantity) &&
      (!quoted.length || quoted.some(binding => binding.owned && binding.meaning.conflicting || !sameDeclaration(binding, expected)));
    if (ambiguous || mixed || quoteInvalid || !sameSourceMass(expected, quantity.value, quantity.unit) ||
      candidate && !sameSourceMass(expected, candidate.value, candidate.unit)) {
      issues.push({ code: ambiguous || mixed ? "atomic_mass_source_unbound" : "atomic_mass_source_mismatch", severity: "fatal", path: `${sourceGiven ? "givens" : "derived"}.${quantity.id}`,
        message: `Given mass ${quantity.id} must retain the value, unit and isotope role of its original source mass declaration; another literal, planner alias or drawing primitive cannot replace it` });
      continue;
    }
    for (const target of targets) {
      const mismatch = expected.owned && expected.meaning.owner && (target.noun || target.owner && !ownerEqual(target.owner, expected.meaning.owner)) ||
        expected.noun && (target.owner || target.noun && expected.noun !== target.noun);
      if (mismatch) issues.push({ code: "atomic_mass_source_mismatch", severity: "fatal", entityIds: [target.targetId],
        path: `annotations.${target.annotation.id}.quantityId`, message: `Source mass ${quantity.id} must remain attached to its original ${expected.noun ?? `A=${expected.meaning.owner!.A}, Z=${expected.meaning.owner!.Z}`} owner at target ${target.targetId}` });
    }
    if (issues.length === priorIssueCount) certifiedQuantityIds.push(quantity.id);
  }
  for (const quantity of document.quantities) {
    if (scalarValue(quantity.value) === undefined || [...plan.givens, ...plan.derived].some(item => item.id === quantity.id)) continue;
    const unknown = plan.unknowns.find(item => item.id === quantity.id);
    const names = [quantity.id, typeof quantity.symbol === "string" ? quantity.symbol : "", unknown?.symbol ?? ""].map(alias);
    if (symbolicFields.some(field => names.includes(field.symbol))) issues.push({ code: "atomic_mass_source_unbound", severity: "fatal", path: `quantities.${quantity.id}`,
      message: `The original source leaves mass ${quantity.id} symbolic; an unknown field cannot acquire a numerical candidate value` });
  }
  return { issues, certifiedQuantityIds, applicableQuantityIds, hasOriginalMassDeclarations: declarations.length > 0 };
}

/** Backward-compatible refusal interface. Empty issues alone do not certify an
 * original given: inapplicable fields intentionally produce no refusal. */
export function validateOriginalMassSourceGivens(document: SceneDocument, plan: TurnPlanV3): SceneIssue[] {
  return auditOriginalMassSourceGivens(document, plan).issues;
}

/** Source roles, not construction-authored convention strings, authorize mass arithmetic. */
export function validateAtomicMassSource(construction: SceneConstruction, document: SceneDocument, plan: TurnPlanV3): SceneIssue[] {
  if (construction.operator !== "nuclide_state" && construction.operator !== "nuclear_reaction") return [];
  const { inputs } = construction;
  const requests: Array<{ id: string; path: string; species?: MassSpecies; owner: NuclideOwner }> = [];
  const quantityValue = (id: unknown) => {
    const value = document.quantities.find(quantity => quantity.id === id)?.value;
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };
  if (construction.operator === "nuclide_state" && typeof inputs.boundMass === "string") {
    const A = quantityValue(inputs.A), Z = quantityValue(inputs.Z);
    if (A === undefined || Z === undefined) return [];
    requests.push({ id: inputs.boundMass, path: "boundMass", owner: { A, Z } },
      { id: String(inputs.constituentMass), path: "constituentMass", species: inputs.massConvention === "atomic" ? "hydrogen" : "proton", owner: { A: 1, Z: 1 } },
      { id: String(inputs.neutronMass), path: "neutronMass", species: "neutron", owner: { A: 1, Z: 0 } });
  } else if (construction.operator === "nuclear_reaction") {
    for (const key of ["initial", "final"] as const) {
      if (!Array.isArray(inputs[key])) continue;
      inputs[key].forEach((item, index) => {
        if (!item || typeof item !== "object" || typeof item.mass !== "string") return;
        const A = quantityValue(item.A), Z = quantityValue(item.Z);
        if (A === undefined || Z === undefined) return;
        const species = A === 0 && Z === 0 ? "radiation" : A === 1 && Z === 0 ? "neutron" : A === 1 && Z === 1 ? inputs.massConvention === "atomic" ? "hydrogen" : "proton" : undefined;
        requests.push({ id: item.mass, path: `${key}.${index}.mass`, owner: { A, Z }, ...(species ? { species } : {}) });
      });
    }
  }
  if (!requests.length) return [];
  const common = commonConvention(plan.question), issues: SceneIssue[] = [];
  for (const request of requests) {
    const quantity = [...plan.givens, ...plan.derived].find(quantity => quantity.id === request.id);
    const meaning = quantity ? quotedMassMeaning(quantity, plan.question, common) : null;
    const sourceConvention = meaning?.convention ?? (common === "mixed" ? undefined : common);
    const missing = !meaning || meaning.conflicting || !meaning.owner || common === "mixed" ||
      (request.species ? meaning.species === undefined : sourceConvention === undefined);
    const mismatch = !missing && (request.species && meaning.species !== request.species ||
      request.species === undefined && meaning.species !== undefined ||
      meaning.owner!.A !== request.owner.A || meaning.owner!.Z !== request.owner.Z ||
      request.species !== "neutron" && request.species !== "radiation" && sourceConvention !== inputs.massConvention ||
      common !== undefined && common !== inputs.massConvention);
    if (missing || mismatch) issues.push({ code: missing ? "atomic_mass_source_unbound" : "atomic_mass_source_mismatch", severity: "fatal", constructionId: construction.id,
      path: `constructions.${construction.id}.inputs.${request.path}`, message: missing
        ? `Mass ${request.id} needs an unambiguous role/convention declared in the actual source question; candidate or planner prose cannot invent it`
        : `Source mass ${request.id} describes A=${meaning!.owner!.A}, Z=${meaning!.owner!.Z} (${meaning!.species ?? "bound state"}) under ${sourceConvention ?? "its particle"} conventions and cannot serve ${request.path} for A=${request.owner.A}, Z=${request.owner.Z} in the ${String(inputs.massConvention)} model` });
  }
  return issues;
}
