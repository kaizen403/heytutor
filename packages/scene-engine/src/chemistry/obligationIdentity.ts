/**
 * Chemistry body identity for the visual-obligation check.
 *
 * ProblemIR names chemistry bodies in model words: "NH3 molecule", "central P
 * atom", "Period 3 elements". The figure draws them as a formula heading, atom
 * glyphs and a plotted series. This reader binds such a name to the figure's
 * own certified identity, and to nothing else:
 *
 * - certification: the candidate must be exactly the figure its family
 *   builder recomputes from the original question, and the identity is the
 *   record that fresh build made of what it parsed and drew. A caption, title
 *   or label string is never the authority;
 * - species: a formula or a known name plus descriptor words binds only to a
 *   drawn species of that same formula identity;
 * - atom: an element name or symbol plus "atom(s)", "central", a count or an
 *   index binds only to an unconsumed drawn atom of that element; "central"
 *   binds only to the atom the family placed at the centre;
 * - element set: "Period n elements", "Group n ..." binds only when every
 *   plotted element belongs to that period or group.
 *
 * Every other name (orbitals, energy levels, a property, bonds as bodies)
 * returns null and stays with the ordinary exact-label rule. This is one
 * grammar over formula, element and period tables; there is no question or
 * topic routing here.
 */
import { pruneDeadSceneEntities, validateSceneDocument } from "../document/validation";
import type { SceneDocument } from "../types";
import { elementByName, elementBySymbol, type ElementRecord } from "./elements";
import { builtChemistryFigureIdentity, type ChemistryFigureIdentity } from "./figureIdentity";
import { normalizeChemistryText, parseFormula, splitCharge } from "./formula";
import { buildLewisScene } from "./lewis";
import { buildMoScene } from "./moDiagram";
import { namedSpeciesMentions } from "./namedSpecies";
import { buildOrbitalScene } from "./orbitalBox";
import { buildPeriodicTrendScene } from "./periodicTrend";
import type { ChemFamilyBuilder } from "./sceneKit";
import { buildVseprScene } from "./vsepr";

/** Families whose builders record a parsed identity on the figure they return. */
const IDENTITY_BUILDERS: Readonly<Record<string, ChemFamilyBuilder>> = {
  chem_vsepr: buildVseprScene,
  chem_lewis: buildLewisScene,
  chem_mo: buildMoScene,
  chem_orbital: buildOrbitalScene,
  chem_periodic: buildPeriodicTrendScene,
};

/**
 * The identity of a chemistry candidate, or null. The family builder is rerun
 * on the original question with no plan quantities, and the candidate's whole
 * ink, topology, quantities and reveal schedule must equal that fresh figure.
 */
export function certifiedChemistryFigureIdentity(document: SceneDocument, originalQuestion?: string): ChemistryFigureIdentity | null {
  if (!originalQuestion?.trim() || document.source.question !== originalQuestion.trim()) return null;
  const family = String(document.source.chemistryFamily ?? "");
  const builder = Object.prototype.hasOwnProperty.call(IDENTITY_BUILDERS, family) ? IDENTITY_BUILDERS[family] : undefined;
  if (!builder) return null;
  let fresh: SceneDocument | null;
  try {
    fresh = builder(originalQuestion, [], false);
  } catch {
    return null;
  }
  const identity = builtChemistryFigureIdentity(fresh);
  if (!fresh || !identity || fresh.source.chemistryFamily !== family) return null;
  return sameRecomputedFigure(document, fresh) ? identity : null;
}

/** Same comparison the VSEPR structure certificate uses, for any fresh figure. */
function sameRecomputedFigure(document: SceneDocument, fresh: SceneDocument): boolean {
  // Validation reconciles labels with their constructions. A contradictory
  // redundant label is not a membership certificate before that repair.
  const labels = new Map(fresh.entities.map((entity) => [entity.id, entity.label]));
  if (document.entities.some((entity) => entity.label !== labels.get(entity.id))) return false;
  const normalize = (input: SceneDocument) => validateSceneDocument(pruneDeadSceneEntities(input as unknown as Record<string, unknown>));
  const expected = normalize(fresh);
  const actual = normalize(document);
  if (!expected.document || !actual.document) return false;
  const content = (input: SceneDocument) => Object.fromEntries(Object.entries(input).filter(([key]) => key !== "source"));
  return stableValue(content(actual.document)) === stableValue(content(expected.document));
}

function stableValue(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([first], [second]) => first.localeCompare(second)));
  });
}

export interface ChemistryBodyBinding {
  /** The scene entity the body maps to. */
  entityId: string;
  /** Every scene entity this body denotes; none may serve another body. */
  consumes: string[];
}

/** ProblemIR kinds that may name a physical chemical body. */
const BODY_KINDS = new Set(["body", "component", "other"]);
/** An atom is also a located point of the structure. */
const ATOM_KINDS = new Set(["point", "body", "component", "other"]);

/**
 * Bind one obligated body name to the certified figure, or null when the
 * name is not a species, atom or element set the figure provably draws.
 */
export function bindChemistryBody(
  identity: ChemistryFigureIdentity,
  problemKind: string,
  problemLabel: string,
  consumed: ReadonlySet<string>,
): ChemistryBodyBinding | null {
  const label = normalizeChemistryText(problemLabel).trim().replace(/\s+/g, " ");
  if (!label) return null;
  if (BODY_KINDS.has(problemKind)) {
    const set = readElementSet(label);
    if (set) return bindElementSet(identity, set, consumed);
  }
  if (ATOM_KINDS.has(problemKind)) {
    const atom = readAtomRequest(label);
    if (atom) return bindAtom(identity, atom, consumed);
  }
  if (BODY_KINDS.has(problemKind)) {
    const key = speciesKeyOfLabel(label);
    if (key) {
      const species = identity.species.find((candidate) => !consumed.has(candidate.entityId) && formulaKey(candidate.formula) === key);
      if (species) return { entityId: species.entityId, consumes: [species.entityId] };
    }
  }
  return null;
}

/**
 * Atoms of one certified species joined by bonds among the requested atoms
 * only; a third, unrequested atom never bridges two requested ones.
 */
export function certifiedAtomsBonded(identity: ChemistryFigureIdentity | null, ids: readonly string[]): boolean {
  if (!identity || ids.length < 2) return false;
  return identity.species.some((species) => {
    const atomIds = species.atoms.map((atom) => atom.entityId);
    if (!ids.every((id) => atomIds.includes(id))) return false;
    const reached = new Set([ids[0]!]);
    for (let pass = 0; pass < ids.length; pass += 1) {
      for (const [a, b] of species.bonds) {
        if (!ids.includes(a) || !ids.includes(b)) continue;
        if (reached.has(a)) reached.add(b);
        if (reached.has(b)) reached.add(a);
      }
    }
    return ids.every((id) => reached.has(id));
  });
}

/* ------------------------------------------------------------------------- */
/* Species                                                                   */
/* ------------------------------------------------------------------------- */

const SPECIES_DESCRIPTORS = new Set(["the", "a", "an", "molecule", "molecules", "ion", "ions", "species", "compound"]);

/**
 * One formula identity for the whole label, or null. Named species are read
 * first so "nitrogen molecule" is N2; every other word must be a descriptor
 * or a formula, and every formula read must be the same identity.
 */
function speciesKeyOfLabel(label: string): string | null {
  const keys = new Set<string>();
  let rest = "";
  let cursor = 0;
  for (const mention of namedSpeciesMentions(label)) {
    rest += ` ${label.slice(cursor, mention.start)} `;
    keys.add(formulaKey(mention.formula) ?? "");
    cursor = mention.end;
  }
  rest += ` ${label.slice(cursor)}`;
  for (const word of rest.split(" ").filter(Boolean)) {
    if (SPECIES_DESCRIPTORS.has(word.toLowerCase())) continue;
    const key = formulaKey(word);
    if (!key) return null;
    keys.add(key);
  }
  if (keys.size !== 1) return null;
  const [only] = [...keys];
  return only || null;
}

/**
 * One identity for the board and source spellings of a formula (NH_3, NH3;
 * SO_4^(2-), SO4^2-): the formula body as written, with its groups and atom
 * order kept, and the net charge, kept apart. O_2^(-) (superoxide, body O2,
 * charge -1) and O^(2-) (oxide, body O, charge -2) never share a key,
 * although both flatten to the same characters, and isomers written
 * differently (CH3COOH, CH3OCHO) keep their own keys, although their atom
 * counts agree. Anything the formula reader cannot parse has no key.
 */
function formulaKey(value: string): string | null {
  const text = normalizeChemistryText(value.trim().replace(/_(\d+)/g, "$1")).replace(/\s+/g, "");
  if (!parseFormula(text)) return null;
  const { body, charge } = splitCharge(text);
  return `${body} | ${charge}`;
}

/* ------------------------------------------------------------------------- */
/* Atoms                                                                     */
/* ------------------------------------------------------------------------- */

interface AtomRequest {
  element: ElementRecord;
  central: boolean;
  plural: boolean;
  count: number | null;
}

const COUNT_WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
};

/**
 * "central carbon atom", "Boron central atom", "Cl atoms", "four hydrogen
 * atoms", "carbon atom 1". Exactly one element, and the word atom(s) or
 * central must say it is an atom; any other word refuses the reading.
 */
function readAtomRequest(label: string): AtomRequest | null {
  let element: ElementRecord | null = null;
  let central = false;
  let atomWord = false;
  let plural = false;
  let count: number | null = null;
  for (const word of label.split(" ")) {
    const lower = word.toLowerCase();
    if (lower === "atom" || lower === "atoms") {
      atomWord = true;
      plural = plural || lower === "atoms";
      continue;
    }
    if (lower === "central" || lower === "centre" || lower === "center") { central = true; continue; }
    if (lower === "the" || lower === "a" || lower === "an") continue;
    const number = /^\d+$/.test(word) ? Number(word) : COUNT_WORDS[lower] ?? null;
    if (number !== null) {
      // Before the element a number counts atoms; after it, it is an index.
      if (element === null) {
        if (count !== null) return null;
        count = number;
      }
      continue;
    }
    const named = elementBySymbol(word) ?? (/^[a-z]+$/i.test(word) && word.length > 2 ? elementByName(lower) : null);
    if (!named || element !== null) return null;
    element = named;
  }
  if (!element || !(atomWord || central)) return null;
  if (count !== null && count < 1) return null;
  return { element, central, plural, count };
}

function bindAtom(identity: ChemistryFigureIdentity, request: AtomRequest, consumed: ReadonlySet<string>): ChemistryBodyBinding | null {
  for (const species of identity.species) {
    if (request.central && !species.knowsCentral) continue;
    const pool = species.atoms.filter((atom) => atom.symbol === request.element.symbol && (!request.central || atom.central));
    if (pool.length === 0) continue;
    if (request.count !== null || request.plural) {
      // A counted or plural body is every such atom of the species at once.
      if (pool.some((atom) => consumed.has(atom.entityId))) continue;
      if (request.count !== null ? pool.length !== request.count : pool.length < 2) continue;
      return { entityId: pool[0]!.entityId, consumes: pool.map((atom) => atom.entityId) };
    }
    const free = pool.find((atom) => !consumed.has(atom.entityId));
    if (free) return { entityId: free.entityId, consumes: [free.entityId] };
  }
  return null;
}

/* ------------------------------------------------------------------------- */
/* Element sets                                                              */
/* ------------------------------------------------------------------------- */

interface ElementSetRequest {
  period: number | null;
  group: number | null;
  /** Alkali metals exclude hydrogen from group 1. */
  metalsOnly: boolean;
}

const GROUP_FAMILIES: Readonly<Record<string, number>> = {
  "alkali metals": 1, "alkaline earth metals": 2, pnictogens: 15, chalcogens: 16, halogens: 17, "noble gases": 18,
};

function readElementSet(label: string): ElementSetRequest | null {
  const lower = label.toLowerCase();
  const period = /^(?:the )?(?:elements? (?:of|in|across) )?period ([1-7])(?: elements?)?$/.exec(lower);
  if (period) return { period: Number(period[1]), group: null, metalsOnly: false };
  const families = Object.keys(GROUP_FAMILIES).join("|");
  const group = new RegExp(`^(?:the )?(?:elements? (?:of|in|down) )?group (\\d{1,2})(?: (elements?|${families}))?$`).exec(lower);
  if (group) {
    const number = Number(group[1]);
    if (number < 1 || number > 18) return null;
    const family = group[2];
    if (family && !/^elements?$/.test(family) && GROUP_FAMILIES[family] !== number) return null;
    return { period: null, group: number, metalsOnly: family === "alkali metals" };
  }
  const named = new RegExp(`^(?:the )?(${families})$`).exec(lower);
  if (named) return { period: null, group: GROUP_FAMILIES[named[1]!]!, metalsOnly: named[1] === "alkali metals" };
  return null;
}

function bindElementSet(identity: ChemistryFigureIdentity, request: ElementSetRequest, consumed: ReadonlySet<string>): ChemistryBodyBinding | null {
  const member = (symbol: string): boolean => {
    const element = elementBySymbol(symbol);
    if (!element) return false;
    if (request.period !== null && element.period !== request.period) return false;
    if (request.group !== null && element.group !== request.group) return false;
    return !request.metalsOnly || element.symbol !== "H";
  };
  const set = identity.elementSets.find((candidate) =>
    !consumed.has(candidate.entityId) && candidate.symbols.length >= 2 && candidate.symbols.every(member));
  return set ? { entityId: set.entityId, consumes: [set.entityId] } : null;
}
