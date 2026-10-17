/** Source-named molecular comparisons whose class follows from local connectivity. */
import { normalizeChemistryText } from "../formula";
import { organicFacts, type Hybridisation } from "./facts";
import { moleculeFromName } from "./names";
import { neighbours, type Molecule } from "./smiles";

export type CarbonSiteKind = "halide" | "alcohol" | "carbonyl";
export interface CarbonSite {
  readonly atom: number;
  readonly boundAtom: number;
  readonly carbonNeighbours: number[];
  readonly hydrogens: number;
  readonly hybridisation: Hybridisation;
  readonly classification: string;
  readonly phenyl: boolean;
}
export interface MolecularNeighbourhood {
  readonly name: string;
  readonly molecule: Molecule;
  readonly site: CarbonSite;
}

/** Only a structural-neighbourhood ask; names do not determine a class. */
export function carbonSiteRequest(question: string): CarbonSiteKind | null {
  const text = normalizeChemistryText(question).toLowerCase();
  if (/carbonyl/.test(text) && /attached|substituent|bound h|trigonal[- ]planar|centres?|centers?/.test(text)) return "carbonyl";
  if (/oh[- ]bearing/.test(text) || (/alcohol/.test(text) && /classif|primary|secondary|tertiary|neighbou?r/.test(text))) return "alcohol";
  if (/carbon (?:carrying|bonded to) (?:cl|br|f|i)\b|c\s*[-–]\s*(?:cl|br|f|i)\b|halogen[- ]bearing/.test(text) && /classif|hybridi[sz]|benzylic|aryl/.test(text)) return "halide";
  return null;
}

/** A complete neutral C/O/halogen graph, not a fragment or a radical. */
function closedGraph(molecule: Molecule): boolean {
  if (molecule.atoms.length === 0 || molecule.atoms.length > 24) return false;
  const valence: Record<string, number> = { C: 4, O: 2, F: 1, Cl: 1, Br: 1, I: 1 };
  if (molecule.atoms.some((atom) => atom.charge !== 0 || valence[atom.element] === undefined ||
    neighbours(molecule, atom.index).reduce((sum, edge) => sum + edge.bond.order, atom.hydrogens) !== valence[atom.element])) return false;
  const seen = new Set<number>();
  const pending = [0];
  while (pending.length) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    pending.push(...neighbours(molecule, current).map((edge) => edge.atom));
  }
  return seen.size === molecule.atoms.length;
}

/** One unambiguous requested site per molecule; unsupported sites decline. */
export function carbonSiteFacts(molecule: Molecule, kind: CarbonSiteKind): CarbonSite | null {
  if (!closedGraph(molecule)) return null;
  const hybridisation = organicFacts(molecule).hybridisation;
  const candidates: CarbonSite[] = [];
  let requestedMotifs = 0;
  const degreeName = ["methyl", "primary", "secondary", "tertiary"];
  for (const atom of molecule.atoms) {
    if (atom.element !== "C") continue;
    const around = neighbours(molecule, atom.index);
    const carbonNeighbours = around.filter((edge) => molecule.atoms[edge.atom]!.element === "C").map((edge) => edge.atom);
    const hybrid = hybridisation.get(atom.index)!;
    let boundAtom: number | null = null;
    let classification: string | null = null;
    if (kind === "halide") {
      const halogens = around.filter((edge) => edge.bond.order === 1 && /^(?:F|Cl|Br|I)$/.test(molecule.atoms[edge.atom]!.element));
      requestedMotifs += halogens.length;
      if (halogens.length !== 1) continue;
      boundAtom = halogens[0]!.atom;
      const benzylic = carbonNeighbours.some((index) => molecule.atoms[index]!.aromatic);
      const allylic = carbonNeighbours.some((index) => !molecule.atoms[index]!.aromatic &&
        neighbours(molecule, index).some((edge) => edge.bond.order === 2 && !edge.bond.aromatic &&
          molecule.atoms[edge.atom]!.element === "C" && !molecule.atoms[edge.atom]!.aromatic));
      const vinylic = around.some((edge) => edge.bond.order === 2 && !edge.bond.aromatic &&
        molecule.atoms[edge.atom]!.element === "C" && !molecule.atoms[edge.atom]!.aromatic);
      const acyl = around.some((edge) => edge.bond.order === 2 && molecule.atoms[edge.atom]!.element === "O");
      if (atom.aromatic) classification = "aryl";
      else if (hybrid === "sp2" && vinylic) classification = "vinylic";
      else if (hybrid === "sp2" && acyl) classification = "acyl halide";
      else if (hybrid === "sp3" && carbonNeighbours.length <= 3) classification = carbonNeighbours.length === 0 ? "methyl halide" : `${degreeName[carbonNeighbours.length]} ${[...(benzylic ? ["benzylic"] : []), ...(allylic ? ["allylic"] : [])].join(" ") || "alkyl"}`;
    } else if (kind === "alcohol") {
      const hydroxyl = around.filter((edge) => edge.bond.order === 1 && molecule.atoms[edge.atom]!.element === "O" &&
        molecule.atoms[edge.atom]!.hydrogens === 1 && neighbours(molecule, edge.atom).length === 1);
      requestedMotifs += hydroxyl.length;
      if (hydroxyl.length !== 1 || hybrid !== "sp3" || carbonNeighbours.length < 1 || carbonNeighbours.length > 3) continue;
      boundAtom = hydroxyl[0]!.atom;
      classification = `${degreeName[carbonNeighbours.length]} alcohol`;
    } else {
      const oxo = around.filter((edge) => edge.bond.order === 2 && molecule.atoms[edge.atom]!.element === "O" && neighbours(molecule, edge.atom).length === 1);
      requestedMotifs += oxo.length;
      if (oxo.length !== 1 || around.length !== carbonNeighbours.length + 1 || hybrid !== "sp2") continue;
      boundAtom = oxo[0]!.atom;
      if (carbonNeighbours.length === 1 && atom.hydrogens === 1) classification = "aldehyde";
      if (carbonNeighbours.length === 2 && atom.hydrogens === 0) classification = "ketone";
    }
    if (boundAtom === null || classification === null) continue;
    candidates.push({ atom: atom.index, boundAtom, carbonNeighbours, hydrogens: atom.hydrogens,
      hybridisation: hybrid, classification, phenyl: molecule.atoms.filter((entry) => entry.aromatic).length === 6 });
  }
  return requestedMotifs === 1 && candidates.length === 1 ? candidates[0]! : null;
}

/** A complete name token at the current source position, never a substring mention. */
function namedGraphAt(text: string): { name: string; molecule: Molecule; length: number } | null {
  // Bounds limit name-parser work, not the accepted prefix of a longer name.
  // The caller must consume every remaining source token independently.
  const ends = [...text.slice(0, 180).matchAll(/\s+|[;.!?](?=\s|$)|$/g)]
    .slice(0, 9).map((match) => match.index);
  for (const end of ends.reverse()) {
    const name = text.slice(0, end).trimEnd().replace(/[,;.!?]$/, "");
    if (!name) continue;
    const molecule = moleculeFromName(name);
    if (molecule) return { name, molecule, length: name.length };
  }
  return null;
}

/**
 * This operator's structural request vocabulary is deliberately closed.
 * Each phrase describes actual graph ink, a displayed derived property, or
 * grammar joining those objects. Unknown members and unsupported properties
 * leave unconsumed source, including after punctuation or another command.
 * These are reusable capability arguments, not question/name templates.
 */
interface StructuralPhrase {
  length: number;
  action?: string;
  argument?: "extra-structure" | "structure-object" | "phenyl-ring" | "reference" | "singular-reference" | "member-description" | "ordinal-reference" | "last-two-reference" | "halogen-value" | "hybrid-value" | "class-value" | "class-options" | "alternative";
  count?: number;
  definite?: boolean;
  values?: string[];
}

function structuralPhraseAt(text: string, kind: CarbonSiteKind): StructuralPhrase {
  const common = [
    /^(?:please|also|then|and|or|versus|vs|with|as|so that|to|for|from|by|of|on|in|its|their|the|a|an|each|every|both|all|which|has|have|is|are|it|them|separate|clearly|enough|approximately|explicit|identified|labelled|labeled|marked)\b/i,
    /^(?:draw|sketch|compare|show|mark|identify|label|classify|explain|distinguish)(?:ing)?\b/i,
    /^(?:(?:structural|skeletal)\s+)?(?:diagrams?|structures?)\b/i,
    /^(?:molecular\s+)?names?\b/i,
    /^(?:classifications?|(?:drawn\s+)?neighbou?rhoods?|carbon\s+neighbou?rs?|carbon\s+connectivity)\b/i,
    /^(?:carbon|carbons)\s+directly\s+(?:bonded|attached)\s+to\s+that\s+carbon\b/i,
    /^that\s+carbon\b/i,
    // A stated exclusion in a verbal explanation is not a requested label.
    /^rather\s+than\s+(?:from\s+)?(?:the\s+)?compound[’']s\s+total\s+carbon\s+count\b/i,
  ];
  const alcohol = [
    /^OH[- ]bearing\s+carbon\b/i,
    /^alcohols?\b/i,
    /^(?:primary|secondary|tertiary)\b/i,
  ];
  const halide = [
    /^carbon\s+(?:carrying|bonded\s+to)\s+(?:Cl|Br|F|I)\b/i,
    /^C\s*[-–]\s*(?:Cl|Br|F|I)\s+sites?\b/i,
    /^halogen[- ]bearing\s+carbon\b/i,
    /^(?:sites?|hybridi[sz]ation|sp2|sp3|aryl|benzylic|allylic|alkyl|primary|secondary|tertiary|methyl)\b/i,
    /^(?:phenyl\s+ring|ring[- ]bound\s+(?:chloride|bromide|fluoride|iodide))\b/i,
    /^that\s+(?:the\s+)?last\s+two\s+cannot\s+be\s+mistaken\s+for\b/i,
  ];
  const carbonyl = [
    /^(?:the\s+)?(?:three\s+)?atoms\s+(?:directly\s+)?attached\s+to\s+each\s+carbonyl\s+carbon\b/i,
    /^carbonyl[- ]bound\s+H\b/i,
    /^carbonyl\s+(?:carbons?|centres?|centers?|H)\b/i,
    /^(?:two\s+)?carbon\s+substituents?\b/i,
    /^trigonal[- ]planar\b/i,
    /^(?:centres?|centers?|hybridi[sz]ation|sp2|aldehyde|ketone)\b/i,
  ];
  // Longest phrase first prevents a grammar token ("three", "that") from
  // consuming the start of an owned structural noun phrase.
  const candidates: StructuralPhrase[] = [...common, ...(kind === "alcohol" ? alcohol : kind === "halide" ? halide : carbonyl)]
    .map((phrase) => ({ length: phrase.exec(text)?.[0].length ?? 0 }));
  const action = /^(draw|sketch|compare|show|mark|identify|label|classify|explain|distinguish)\b/i.exec(text);
  if (action) candidates.push({ length: action[0].length, action: action[1]!.toLowerCase() });
  const counts: Record<string, number> = { one: 1, two: 2, three: 3, first: 1, second: 2, third: 3 };
  const count = (word: string | undefined): number | undefined => word ? (counts[word.toLowerCase()] ?? (/^[1-3]$/.test(word) ? Number(word) : undefined)) : undefined;
  const description = /^as\s+(?:(?:a|an|the)\s+)?(?:(one|two|three|[1-3]|first|second|third|another|other)\s+)?(?:separate\s+)?(?:(?:structural|skeletal)\s+)?(?:diagrams?|structures?)\b/i.exec(text);
  if (description) candidates.push({ length: description[0].length, argument: "member-description", count: description[1] && /^(?:first|second|third|another|other)$/i.test(description[1]) ? 1 : count(description[1]) });
  const extra = /^(?:(?:a|an|the)\s+)?(?:another|other|additional)\s+(?:(?:structural|skeletal)\s+)?(?:diagrams?|structures?)\b/i.exec(text);
  if (extra) candidates.push({ length: extra[0].length, argument: "extra-structure" });
  const ordinal = /^(?:the\s+)?(first|second|third)\s+(?:(?:structural|skeletal)\s+)?(?:diagram|structure)\b/i.exec(text);
  if (ordinal) candidates.push({ length: ordinal[0].length, argument: "ordinal-reference", count: count(ordinal[1]) });
  const object = /^(the\s+)?(?:(?:structural|skeletal)\s+)?(?:diagrams?|structures?)\b/i.exec(text);
  if (object) candidates.push({ length: object[0].length, argument: "structure-object", definite: !!object[1] });
  const reference = /^(its|their|it|them|each|every|both|all)\b/i.exec(text);
  if (reference) candidates.push({ length: reference[0].length, argument: /^(its|it)$/i.test(reference[1]!) ? "singular-reference" : "reference" });
  const phenyl = /^phenyl\s+ring\b/i.exec(text);
  if (phenyl) candidates.push({ length: phenyl[0].length, argument: "phenyl-ring" });
  const lastTwo = /^that\s+(?:the\s+)?last\s+two\s+cannot\s+be\s+mistaken\s+for\b/i.exec(text);
  if (lastTwo) candidates.push({ length: lastTwo[0].length, argument: "last-two-reference" });
  const halogen = /^(?:carbon\s+(?:carrying|bonded\s+to)\s+(Cl|Br|F|I)\b|C\s*[-–]\s*(Cl|Br|F|I)\s+sites?\b)/i.exec(text);
  if (halogen) candidates.push({ length: halogen[0].length, argument: "halogen-value", values: [halogen[1] ?? halogen[2]!] });
  const hybrid = /^(sp[23])(?:\s+or\s+(sp[23]))?\b/i.exec(text);
  if (hybrid) candidates.push({ length: hybrid[0].length, argument: "hybrid-value", values: hybrid.slice(1).filter((value): value is string => !!value) });
  const classification = /^(?:(?:primary|secondary|tertiary)\s+(?:(?:benzylic|allylic)(?:\s+allylic)?|alkyl|alcohols?)|acyl\s+halides?|methyl(?:\s+halide)?|primary|secondary|tertiary|benzylic|allylic|alkyl|aryl|vinylic|aldehyde|ketone)\b/i.exec(text);
  if (classification) candidates.push({ length: classification[0].length, argument: "class-value", values: [classification[0].toLowerCase().replace(/\s+/g, " ").replace(/\b(alcohol|halide)s\b/g, "$1")] });
  if (/^as\b/i.test(text)) candidates.push({ length: 2, argument: "class-options" });
  if (/^or\b/i.test(text)) candidates.push({ length: 2, argument: "alternative" });
  // An equal-length owned argument wins over a grammar-only token.
  return candidates.reduce((best, candidate) => candidate.length >= best.length ? candidate : best, { length: 0 });
}

/** All source arguments must be consumed; no suffix or later sentence is dropped. */
export function molecularNeighbourhoods(question: string, kind: CarbonSiteKind): MolecularNeighbourhood[] | null {
  const text = normalizeChemistryText(question);
  if (text.length > 3000 || !/\b(?:draw|sketch|compare)\b/i.test(text)) return null;
  const models: MolecularNeighbourhood[] = [];
  interface Request {
    action: string;
    context: MolecularNeighbourhood[];
    members: Array<{ model: MolecularNeighbourhood; at: number }>;
    extraStructures: number[];
    objects: Array<{ at: number; reference: boolean; definite: boolean }>;
    reference: boolean;
    singularReference: boolean;
    ordinal: number;
    phenyl: boolean;
    lastTwo: boolean;
    described: number;
    targeted: number;
    hybridBound: number;
    classBound: number;
    properties: Array<{ models: MolecularNeighbourhood[]; kind: "halogen-value" | "hybrid-value"; values: string[] }>;
    classes: Array<{ models: MolecularNeighbourhood[]; values: string[]; alternatives: boolean }>;
  }
  const requests: Request[] = [];
  let request: Request | null = null;
  let at = 0;
  while (at < text.length) {
    const separator = /^[\s,.;?!]+/.exec(text.slice(at));
    if (separator) { at += separator[0].length; continue; }
    const tail = text.slice(at);
    const named = namedGraphAt(tail);
    if (named) {
      const site = carbonSiteFacts(named.molecule, kind);
      if (!site) return null;
      const existing = models.filter(model => model.molecule.smiles === named.molecule.smiles);
      const propertyReference = request && !/^(draw|sketch|compare)$/.test(request.action);
      if (propertyReference && existing.length !== 1 && request?.action !== "show") return null;
      const model = propertyReference && existing.length === 1 ? existing[0]! : { name: named.name, molecule: named.molecule, site };
      if (!models.includes(model)) {
        if (models.length === 3) return null;
        models.push(model);
      }
      request?.members.push({ model, at });
      at += named.length;
      continue;
    }
    const phrase = structuralPhraseAt(tail, kind);
    if (!phrase.length) return null;
    if (phrase.action) {
      request = { action: phrase.action, context: [...models], members: [], extraStructures: [], objects: [], reference: false,
        singularReference: false, ordinal: 0, phenyl: false, lastTwo: false, described: 0,
        targeted: 0, hybridBound: 0, classBound: 0, properties: [], classes: [] };
      requests.push(request);
    }
    if (phrase.argument) {
      if (!request) return null;
      if (phrase.argument === "extra-structure") request.extraStructures.push(at + phrase.length);
      if (phrase.argument === "structure-object") request.objects.push({ at: at + phrase.length,
        reference: /\b(?:its|their|each|every|both|all)\s+$/i.test(text.slice(0, at)), definite: !!phrase.definite });
      if (phrase.argument === "phenyl-ring") request.phenyl = true;
      if (phrase.argument === "reference" || phrase.argument === "singular-reference") request.reference = true;
      if (phrase.argument === "singular-reference") request.singularReference = true;
      if (phrase.argument === "ordinal-reference") { request.reference = true; request.ordinal = Math.max(request.ordinal, phrase.count!); }
      if (phrase.argument === "last-two-reference") request.lastTwo = true;
      const owners = (cursor: "targeted" | "hybridBound" | "classBound"): MolecularNeighbourhood[] => {
        const fresh = request!.members.slice(request![cursor]).map(member => member.model);
        request![cursor] = request!.members.length;
        return fresh.length ? fresh : request!.members.length ? request!.members.map(member => member.model) : request!.context;
      };
      if (phrase.argument === "halogen-value" || phrase.argument === "hybrid-value") request.properties.push({
        models: owners(phrase.argument === "halogen-value" ? "targeted" : "hybridBound"), kind: phrase.argument, values: phrase.values!,
      });
      if (phrase.argument === "class-options" && /^(classify|label)$/.test(request.action)) request.classes.push({ models: owners("classBound"), values: [], alternatives: false });
      if (phrase.argument === "class-value") {
        if (!request.classes.length || request.members.length > request.classBound) request.classes.push({ models: owners("classBound"), values: [], alternatives: false });
        request.classes.at(-1)!.values.push(...phrase.values!);
      }
      if (phrase.argument === "alternative" && request.classes.length) request.classes.at(-1)!.alternatives = true;
      if (phrase.argument === "member-description") {
        const described = request.members.length - request.described;
        if (described === 0 || (phrase.count !== undefined && described !== phrase.count)) return null;
        request.described = request.members.length;
      }
    }
    at += phrase.length;
  }
  for (const part of requests) {
    const scope = part.members.length ? part.members.map(member => member.model) : part.context;
    if (/^(draw|sketch|compare)$/.test(part.action) && !part.members.length && !part.reference) return null;
    if (part.action === "compare" && scope.length < 2) return null;
    const argumentsAt = [...part.extraStructures, ...part.objects.filter(object =>
      !(object.reference && scope.length) && !(object.definite && part.context.length === 1)).map(object => object.at)].sort((a, b) => a - b);
    const used = new Set<number>();
    for (const position of argumentsAt) {
      const member = part.members.findIndex((candidate, index) => candidate.at >= position && !used.has(index));
      if (member < 0) return null;
      used.add(member);
    }
    if (part.ordinal > scope.length || (part.lastTwo && scope.length < 2)) return null;
    if (part.phenyl && (!scope.length || scope.some(model => !model.site.phenyl) || (part.singularReference && scope.length !== 1))) return null;
    for (const property of part.properties) {
      if (!property.models.length || property.models.some(model => !property.values.some(value => value.toLowerCase() ===
        (property.kind === "halogen-value" ? model.molecule.atoms[model.site.boundAtom]!.element.toLowerCase() : model.site.hybridisation)))) return null;
    }
    for (const classification of part.classes) {
      if (!classification.values.length) continue;
      const matches = (model: MolecularNeighbourhood, value: string): boolean => (` ${model.site.classification} `).includes(` ${value} `);
      if (!classification.models.length || classification.models.some(model => classification.alternatives || classification.models.length > 1
        ? !classification.values.some(value => matches(model, value)) : !classification.values.every(value => matches(model, value)))) return null;
    }
  }
  return models.length ? models : null;
}
