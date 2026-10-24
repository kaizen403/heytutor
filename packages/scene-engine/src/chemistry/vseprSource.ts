import { resolveElement } from "./elements";
import { binaryCovalentNameMentions } from "./binaryCovalentName";
import { parseFormula } from "./formula";
import { molecularShapeMethodRequested } from "./foundation/molecularShapeRequest";
import { namedSpeciesMentions } from "./namedSpecies";
import { findMentions } from "./organic";

type Span = { start: number; end: number };

function composition(formula: string): string | null {
  const parsed = parseFormula(formula);
  return parsed ? `${parsed.atoms.map(atom => `${atom.symbol}:${atom.count}`).sort().join("|")}/${parsed.charge}` : null;
}

/** Counts come only from the freshly solved source species, never the planner. */
export interface VseprNotationSpecies {
  formula: string; bondPairs: number; lonePairs: number; unpairedElectron: boolean;
}
interface FormulaOwner extends Span { key: string }
function formulaOwners(text: string, formulas: readonly string[]): FormulaOwner[] {
  return [...new Set(formulas)].flatMap(formula => {
    const key=composition(formula);if(!key)return [];
    return [...text.matchAll(new RegExp(`(?<![A-Za-z0-9])${escape(formula)}(?![A-Za-z0-9])`,"g"))]
      .map(match=>({start:match.index,end:match.index+match[0].length,key}));
  }).sort((a,b)=>a.start-b.start||b.end-a.end)
    .filter((owner,index,all)=>!all.slice(0,index).some(previous=>owner.start>=previous.start&&owner.end<=previous.end));
}
const ownerJoin=/^\s*(?:,\s*(?:(?:and|or)\s+)?|(?:and|or)\s+)(?:the\s+)?(?:(?:molecule|ion|species)\s+)?$/i;
/** Only a closed notation operator can own an AX literal. Every local/shared
 * owner must independently agree; matching one member never selects a subset. */
function notationSpans(text:string,formulas:readonly string[],species:readonly VseprNotationSpecies[]):Span[]|null {
  const headers=[...text.matchAll(/\b(?:using|use|in|with|according\s+to)\s+(?:the\s+)?(?:VSEPR\s+)?(AX[A-Za-z0-9_+-]*)\s+notation\b/gdi)];
  const candidates=[...text.matchAll(/\bAX\d[A-Za-z0-9_]*\b/gi)].map(match=>({start:match.index,end:match.index+match[0].length}));
  for(const header of headers){const span=header.indices![1]!;candidates.push({start:span[0],end:span[1]});}
  if(!candidates.length)return [];
  if(candidates.some(span=>!headers.some(header=>header.indices![1]![0]===span.start&&header.indices![1]![1]===span.end)))return null;
  const mentions=formulaOwners(text,formulas),out:Span[]=[];
  let previousEnd=0;
  for(const header of headers){
    const count=/^AX([1-7])(?:E([0-7])?)?$/i.exec(header[1]!);if(!count)return null;
    const x=Number(count[1]),e=/E/i.test(header[1]!)?Number(count[2]??1):0;
    const headerEnd=header.index+header[0].length;
    const post=/^\s+(?:for|of)\s+(?:(?:the|molecular|shapes?|geometr(?:y|ies)|of|molecule|ion|species|both)\s+)*/i.exec(text.slice(headerEnd));
    let owners:readonly string[],consumedEnd=headerEnd;
    if(post){
      const first=mentions.find(mention=>mention.start===headerEnd+post[0].length);if(!first)return null;
      const roster=[first];let index=mentions.indexOf(first);
      while(index+1<mentions.length&&ownerJoin.test(text.slice(mentions[index]!.end,mentions[index+1]!.start)))roster.push(mentions[++index]!);
      owners=[...new Set(roster.map(owner=>owner.key))];consumedEnd=roster.at(-1)!.end;
      if(/\bboth\s+$/i.test(post[0])&&owners.length!==2)return null;
    }else{
      const before=mentions.filter(mention=>mention.start>=previousEnd&&mention.end<=header.index);
      if(before.length){
        if(before.slice(1).some((owner,index)=>!ownerJoin.test(text.slice(before[index]!.end,owner.start)))
          ||!/^\s*(?:(?:molecule|ion|species)\s*)?$/i.test(text.slice(before.at(-1)!.end,header.index)))return null;
        owners=[...new Set(before.map(owner=>owner.key))];
        if(/\bboth\s+$/i.test(text.slice(previousEnd,before[0]!.start))&&owners.length!==2)return null;
      }else{
        if(species.length!==1)return null;
        owners=[composition(species[0]!.formula)!];
      }
    }
    if(!owners.length||owners.some(key=>{
      const actual=species.find(item=>composition(item.formula)===key);
      return !actual||actual.unpairedElectron||actual.bondPairs!==x||actual.lonePairs!==e;
    }))return null;
    const span=header.indices![1]!;out.push({start:span[0],end:span[1]});previousEnd=consumedEnd;
  }
  return out;
}
/** A validated source operator can supply VSEPR intent without a token router. */
export function hasValidatedVseprNotation(sentences:readonly string[],formulas:readonly string[],species:readonly VseprNotationSpecies[]):boolean {
  let found=false;
  for(const sentence of sentences){const owned=notationSpans(sentence,formulas,species);if(!owned)return false;found ||= owned.length>0;}
  return found;
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

/** A notation operator owns its adjacent modifier, never a molecule member. */
function notationModifier(text: string, start: number, end: number): boolean {
  if (requestArgumentRole(text, start, end) === "member") return false;
  return /\b(?:using|use|in|with|according to)\s+$/i.test(text.slice(0, start))
    && /^\s+notation\b/i.test(text.slice(end));
}

/** Parsed formulas keep identity without requiring a particular request verb. */
export function vseprFormulaArguments(text: string, formulas: readonly string[]): string[] {
  return formulas.filter(formula => [...text.matchAll(new RegExp(`(?<![A-Za-z0-9])${escape(formula)}(?![A-Za-z0-9])`, "g"))]
    .some(match => {
      const end = match.index + match[0].length;
      if (notationModifier(text, match.index, end)) return false;
      return parseFormula(formula) !== null || chemicalArgument(text, match.index, end);
    }));
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

/** A directly adjacent name parenthesis is owned in full, not by a substring. */
function adjacentNamesComplete(sentence: string, formulas: readonly string[], names: readonly (Span & { formula: string })[]): boolean {
  return formulas.every(formula => [...sentence.matchAll(new RegExp(`(?<![A-Za-z0-9])${escape(formula)}(?![A-Za-z0-9])`, "g"))]
    .every(match => {
      const end = match.index + match[0].length;
      const alias = /^\s*\(\s*([A-Za-z]+(?:[ -]+[A-Za-z]+)*)\s*\)/d.exec(sentence.slice(end));
      if (!alias) return true;
      // Standard phase suffixes are a closed state operator, not name aliases.
      if (/^(?:g|s|l|aq)$/.test(alias[1]!)) return true;
      const span = alias.indices![1]!;
      return names.some(name => name.start === end + span[0] && name.end === end + span[1]
        && composition(name.formula) === composition(formula));
    }));
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
  species: readonly VseprNotationSpecies[] = [],
): boolean {
  const knownFormula = (token: string): boolean => {
    const key = composition(token);
    return key !== null && formulas.some(formula => composition(formula) === key);
  };
  for (const sentence of sentences) {
    const notation=notationSpans(sentence,formulas,species);if(!notation)return false;
    const names = [...namedSpeciesMentions(sentence), ...binaryCovalentNameMentions(sentence)]
      .sort((a, b) => b.end - b.start - (a.end - a.start))
      .filter((name, index, all) => !all.slice(0, index).some(other => name.start < other.end && name.end > other.start));
    if (!adjacentNamesComplete(sentence, formulas, names)) return false;
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
      if(notation.some(span=>span.start===match.index&&span.end===match.index+token.length))continue;
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
