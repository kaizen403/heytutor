import { resolveElement } from "./elements";
import { parseFormula } from "./formula";
import { molecularShapeMethodRequested } from "./foundation/molecularShapeRequest";
import { namedSpeciesMentions } from "./namedSpecies";
import { findMentions } from "./organic";

type Span = { start: number; end: number };

function composition(formula: string): string | null {
  const parsed = parseFormula(formula);
  return parsed ? `${parsed.atoms.map(atom => `${atom.symbol}:${atom.count}`).sort().join("|")}/${parsed.charge}` : null;
}

const argumentArticles = "(?:(?:the|a|an|molecular|molecules?|compounds?|species|ions?|shapes?|structures?|geometr(?:y|ies))\\s+)*";

/** Every nominal request owns its members; only a method head can exempt a modifier. */
function requestArgumentRole(text: string, start: number, end: number): "modifier" | "member" | null {
  for (const match of text.matchAll(/\b(?:draw|show|sketch|depict|illustrate|include|including|add)\b([^.;!?]*?)\b(?:of|for)\s+/gi)) {
    const descriptor = match[1]!;
    const descriptorStart = match.index + match[0].indexOf(descriptor);
    const memberStart = match.index + match[0].length;
    const memberPrefix = text.slice(memberStart, start);
    if (start >= memberStart && new RegExp(`^${argumentArticles}$`, "i").test(memberPrefix)) return "member";
    // A coordinated nominal argument remains a member even when it repeats
    // the figure noun ("and a model of XYZ"). Its noun/adjectives are open;
    // method-application clauses such as "and use SI notation" do not fit.
    const coordinated = start >= memberStart ? /(?:,|\b(?:and|or|with|versus|vs)\b)\s+([^,;.!?]*)$/i.exec(memberPrefix)?.[1] : null;
    if (coordinated && (/^(?:a|an|the|another)\s+(?:[A-Za-z]+(?:-[A-Za-z]+)?\s+)*$/i.test(coordinated)
      || /^(?:[A-Za-z]+(?:-[A-Za-z]+)?\s+)+of\s+$/i.test(coordinated))) return "member";
    if (!molecularShapeMethodRequested(descriptor) || start < descriptorStart || end > descriptorStart + descriptor.length) continue;
    // Parsed identities such as HCN/CO remain chemical, even inside a head.
    if (parseFormula(text.slice(start, end))) continue;
    const remainingHead = text.slice(start, descriptorStart + descriptor.length);
    const method = /\bvsepr\b/i.exec(remainingHead);
    // Only adjacent acronym modifiers can precede the method. An actual
    // object in "Draw XYZ using VSEPR ..." remains a chemical argument.
    if (method && /^(?:[A-Z]+\s+)*$/.test(remainingHead.slice(0, method.index))
      && end <= start + method.index + method[0].length) return "modifier";
  }
  return null;
}

/** Bare abbreviations become species only in a chemical member argument. */
function chemicalArgument(text: string, start: number, end: number): boolean {
  const requestRole = requestArgumentRole(text, start, end);
  if (requestRole) return requestRole === "member";
  const before = text.slice(0, start).split(/[.;!?]/).at(-1)!;
  const direct = new RegExp(`(?:\\b(?:between|compare|draw|show|sketch|depict|illustrate|include|including|add)\\s+|\\b(?:shapes?|geometr(?:y|ies)|structures?|molecules?|species|bond angles?)\\s+(?:of|for|is|are)\\s+)${argumentArticles}$`, "i");
  if (direct.test(before)) return true;
  // A conjunction/comma continues a figure's member list, not a preposed
  // method phrase such as "Using SI notation" or "use VBT to explain".
  if (/(?:,|\b(?:and|or|with|versus|vs)\b)\s*$/i.test(before)
    && /\b(?:shapes?|geometr(?:y|ies)|molecules?|species|compare|draw|show|sketch|include|add)\b/i.test(before)) return true;
  return /^\s+(?:is|are|has|have)\s+(?:(?:a|an|the|molecular|electron|pair|domain)\s+)*(?:shape|geometry|linear|bent|tetrahedral|trigonal|octahedral|lone)\b/i.test(text.slice(end));
}

/** Formula parsing still owns identity; prose abbreviations are not members. */
export function vseprFormulaArguments(text: string, formulas: readonly string[]): string[] {
  return formulas.filter(formula => {
    if (/[a-z\d+-]/.test(formula)) return true;
    return [...text.matchAll(new RegExp(`(?<![A-Za-z0-9])${escape(formula)}(?![A-Za-z0-9])`, "g"))]
      .some(match => chemicalArgument(text, match.index, match.index + match[0].length));
  });
}

/** A name is an alias only when its neighbouring formula states its identity. */
function aliasFormula(sentence: string, name: Span, formulas: readonly string[]): boolean {
  return formulas.some(formula => {
    const pattern = new RegExp(`(?<![A-Za-z0-9])${escape(formula)}(?![A-Za-z0-9])`, "g");
    return [...sentence.matchAll(pattern)].some(match => {
      const start = match.index;
      const end = start + match[0].length;
      const bridge = start >= name.end ? sentence.slice(name.end, start)
        : name.start >= end ? sentence.slice(end, name.start) : null;
      return bridge !== null && (/^\s*(?:(?:molecule|ion|species)\s*)?[,([]\s*$/i.test(bridge)
        || /^[([]/.test(formula) && /^\s*(?:(?:molecule|ion|species)\s*)?$/i.test(bridge));
    });
  });
}

/**
 * Inventory chemical members, rather than rejecting unlisted English prose.
 * Every named member needs its own local formula alias. Formula-shaped unknowns
 * and explicit unresolved molecule arguments refuse the whole requested set.
 * This checks source membership only; it grants no numeric or label authority.
 */
export function vseprSourceArgumentsComplete(
  sentences: readonly string[],
  formulas: readonly string[],
): boolean {
  const knownFormula = (token: string): boolean => {
    const key = composition(token);
    return key !== null && formulas.some(formula => composition(formula) === key);
  };
  for (const sentence of sentences) {
    const names = namedSpeciesMentions(sentence);
    for (const name of names) {
      const aliases = formulas.filter(formula => composition(formula) === composition(name.formula));
      if (!aliasFormula(sentence, name, aliases)) return false;
    }
    const covered = (span: Span) => names.some(name => span.start >= name.start && span.end <= name.end);
    // Reuse the organic name reader as well: an ethanol/benzene member cannot
    // disappear just because the resolved inorganic formula came first.
    for (const mention of findMentions(sentence)) {
      if (!covered(mention) && !knownFormula(mention.text)) return false;
    }
    // Binary inorganic names absent from the catalog remain unresolved names,
    // not decorative words (for example nitrogen trifluoride).
    for (const match of sentence.matchAll(/\b([A-Za-z]+)\s+([a-z]+(?:ide|ate|ite))\b/gi)) {
      if (resolveElement(match[1]!) && !covered({ start: match.index, end: match.index + match[0].length })) return false;
    }
    for (const match of sentence.matchAll(/(?<![\p{L}\p{N}])\[?(?:[A-Z][a-z]?\d*){1,}\]?\d*(?:\^?\(?\d*[+-]\)?)?(?![\p{L}\p{N}])/gu)) {
      const token = match[0];
      if (/^[A-Z][a-z]?$/.test(token)) continue;
      if (!/[\d+-]/.test(token) && !(token.length > 2 && /[a-z]/.test(token))
        && !chemicalArgument(sentence, match.index, match.index + token.length)) continue;
      if (!knownFormula(token)) return false;
    }
    // An explicitly named placeholder cannot borrow a prior molecule identity.
    for (const match of sentence.matchAll(/\b(?:molecule|compound|species|ion)\s+([A-Z][A-Za-z0-9]*)\b/g)) {
      if (!knownFormula(match[1]!)) return false;
    }
    if (/\b(?:unspecified|unknown|unidentified|another|second)\s+(?:molecule|compound|species|ion)\b/i.test(sentence)
      || /\b(?:molecule|compound|species|ion)\b[^.;!?]*\bidentity\s+(?:is|remains)\s+(?:unknown|unspecified|unidentified)\b/i.test(sentence)) return false;
  }
  return true;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
