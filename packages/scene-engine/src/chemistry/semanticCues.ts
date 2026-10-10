/** Positive chemical roles for vocabulary shared with other subjects. */
import { complexTokens, ligandSpec, parseComplex, parseFormula } from "./formula";

/** Bracketed unit notation such as V[V] supplies no coordinating ligand. */
export function coordinationSpeciesTokens(question: string): string[] {
  return complexTokens(question).filter(token => (parseComplex(token)?.ligands.length ?? 0) > 0);
}
export function molecularOverlapRequested(stem: string): boolean {
  return /orbital overlap|(?:head[- ]?on|end[- ]?on|sideways|axial|lateral)\s+(?:orbital\s+)?overlap/.test(stem);
}

/** Order/half-life alone can describe a differential equation or generic decay. */
export function chemicalKineticsContext(stem: string): boolean {
  return /\breactions?\b|\breactants?\b|\bchemical kinetics\b|\bconcentration\b|\brate (?:law|constant)\b|\barrhenius\b|\[(?:a|b)\]/.test(stem);
}

/** A complex is a species with coordination/ligand identity, not a number. */
export function coordinationContext(stem: string): boolean {
  if (/\bcoordination (?:complex|compound|entity|number)\b|\bmetal complexes?\b|\bligands?\b/.test(stem)) return true;
  if (!/\bcomplex(?:es)?\b/.test(stem)) return false;
  if (/\b(?:dsp\^?2|d\^?2sp\^?3|sp\^?3d(?:\^?2)?|sp\^?3|sp\^?2)\b|octahedral|tetrahedral|square planar|hybridi[sz]/.test(stem)) return true;
  // Reuse the chemical ligand registry; ordinary complex variables carry no ligand identity.
  return [...stem.matchAll(/\b[A-Za-z][A-Za-z0-9]{2,}\b/g)].some(match => ligandSpec(match[0]) !== null);
}

/** Magnetic response belongs here when the question relates it to electrons. */
export function electronicMagnetismContext(stem: string): boolean {
  return /\b(?:para|dia)magnetic\b/.test(stem)
    && /\borbitals?\b|\belectrons?\b|\belectron(?:ic)? configuration\b|\b(?:atoms?|ions?|molecules?)\b|\bspin[ -]?only\b|\bligands?\b/.test(stem);
}

/** Heat capacity needs its molar/chemical role or a complete Cp/Cv symbol. */
export function chemicalHeatCapacityRequested(stem: string): boolean {
  if (/\b(?:molar)?c_?[pv](?:,m)?\b/.test(stem)) return true;
  return /\bheat capacity\b/.test(stem)
    && /\bmolar\b|\bper mole\b|\bmol\b|\bgas\b|\bchemical\b|\breaction\b|\bsolution\b/.test(stem);
}

type AtomicMention = { start: number; end: number; species?: { symbol: string; charge: number } };

// Only complete recognized roles/parsed species may connect a local list.
// A verb, another subject or a clause boundary cannot connect its members.
const ATOMIC_LIST_SEPARATOR = /^[\s,]*(?:(?:or|and|nor)\s+)?(?:(?:a|an|the|any)\s+)?$/i;
const NEGATIVE_ATOMIC_PREFIX = /\b(?:no|not|without|absence of|lack of|lacking|excluding|except(?: for)?)\s+(?:(?:a|an|the|any)\s+)?$/i;
const ABSENT_ATOMIC_SUFFIX = /^\s+(?:(?:is|are|was|were)\s+)?(?:absent|excluded|irrelevant)\b/i;

/** Negation belongs to the complete recognized list, rather than the question. */
function positiveAtomicMention(question: string, mentions: AtomicMention[], index: number): boolean {
  const mention = mentions[index]!;
  if (/^(?:[- ]free|less)\b/i.test(question.slice(mention.end))) return false;
  let first = index; let last = index;
  while (first > 0 && ATOMIC_LIST_SEPARATOR.test(question.slice(mentions[first - 1]!.end, mentions[first]!.start))) first--;
  while (last + 1 < mentions.length && ATOMIC_LIST_SEPARATOR.test(question.slice(mentions[last]!.end, mentions[last + 1]!.start))) last++;
  if (ABSENT_ATOMIC_SUFFIX.test(question.slice(mentions[last]!.end))) return false;
  const prefix = question.slice(0, mentions[first]!.start).split(/[.;:]|\b(?:but|however)\b/i).at(-1) ?? "";
  return !NEGATIVE_ATOMIC_PREFIX.test(prefix)
    && !/\b(?:background|unrelated|irrelevant|incidental)(?:\s+(?:mention|reference)(?:\s+(?:of|to))?)?(?:\s+(?:a|an|the))?\s*$/i.test(prefix);
}

/**
 * Only a complete original charged atom supplies a species role on its own.
 * Existing formula parsing owns element/charge semantics. Adjacent formula,
 * group, isotope, unit or script syntax must not turn a prefix into evidence.
 */
function chargedAtomicMentions(question: string): AtomicMention[] {
  const mentions: AtomicMention[] = [];
  const chargedAtom = /[A-Z][a-z]?(?:\d*[+-]|\^(?:\(\d*[+-]\)|\{\d*[+-]\}|\d*[+-])|[⁰¹²³⁴⁵⁶⁷⁸⁹]*[⁺⁻])/g;
  for (const match of question.matchAll(chargedAtom)) {
    let start = match.index; let end = start + match[0].length;
    // Check the outer boundary of a whole optional wrapper, never its inner ion.
    if (question[start - 1] === "(" || question[end] === ")") {
      if (question[start - 1] !== "(" || question[end] !== ")") continue;
      start--; end++;
    }
    const before = question[start - 1] ?? ""; const after = question[end] ?? "";
    if (/[\p{L}\p{N}\p{M}_+⁺⁻−\-^/·•.*()[\]{}]/u.test(before)) continue;
    if (/[\p{L}\p{N}\p{M}_+⁺⁻−\-^/·•*()[{\]}]/u.test(after)) continue;
    if (after === "." && /[\p{L}\p{N}]/u.test(question[end + 1] ?? "")) continue;
    const suffix = question.slice(end);
    if (/^\s+[\^_/·•*+⁺⁻−]/.test(suffix)) continue;
    const hydrate = /^\s+\.\s*(\S+)/.exec(suffix)?.[1];
    if (hydrate && parseFormula(hydrate.replace(/[.,;]$/, ""))) continue;
    const parsed = parseFormula(match[0]);
    if (parsed?.atoms.length === 1 && parsed.totalAtoms === 1 && parsed.charge !== 0
      && parsed.atoms[0]!.element.z - parsed.charge >= 0) mentions.push({ start, end, species: { symbol: parsed.atoms[0]!.symbol, charge: parsed.charge } });
  }
  return mentions;
}

function atomicMentions(question: string): AtomicMention[] {
  const roles = /\batomic (?:structure|electrons?|models?|masses?)\b|\bbound[ -]electrons?\b|\b(?:hydrogen[ -]like|hydrogenic|hydrogen)(?:[ -](?:models?|atoms?|ions?))?\b|\b(?:atoms?|ions?)\b|\bphotoioni[sz]ation\b/gi;
  return [...chargedAtomicMentions(question), ...[...question.matchAll(roles)].map(match => ({
    start: match.index, end: match.index + match[0].length,
  }))].sort((a, b) => a.start - b.start || b.end - a.end)
    // A multiword role owns the contained atom/ion noun as one list member.
    .filter((mention, index, all) => index === 0 || mention.start >= all[index - 1]!.end);
}

/** Only matching complete original atomic identities can lose formula evidence. */
export function isExcludedAtomicFormula(question: string, token: string): boolean {
  const parsed = parseFormula(token);
  if (!parsed || parsed.atoms.length !== 1 || parsed.totalAtoms !== 1 || parsed.charge === 0) return false;
  const mentions = atomicMentions(question);
  const matching = mentions.flatMap((mention, index) => mention.species?.symbol === parsed.atoms[0]!.symbol
    && mention.species.charge === parsed.charge ? [index] : []);
  // Unmatched tokens retain existing subject scoring; this is no general veto.
  return matching.length > 0 && matching.every(index => !positiveAtomicMention(question, mentions, index));
}

/** Radiation in this lane explains a positive atom/species or bound-electron role. */
export function atomicElectronContext(question: string): boolean {
  const mentions = atomicMentions(question);
  return mentions.some((_, index) => positiveAtomicMention(question, mentions, index));
}
