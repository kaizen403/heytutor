/**
 * Count claims a planner narrates beside a native Lewis structure, read
 * against the regenerated structure.
 *
 * The reader is fail closed. Every count in a claim that sits next to a
 * Lewis role (lone pairs, bonds, sigma and pi bonds, bonding or lone pair
 * electrons, valence electrons, atoms, formal charge, bond order) is a
 * mention, and each mention must be read: its role, its owner (an atom, the
 * central atom, the molecule, or one bond) and its value. A mention the
 * reader cannot place leaves the claim unread, and the certificate declines
 * the figure. Prose without such counts is left to the teaching text.
 */
import { elementByName, elementBySymbol, valenceElectrons, type ElementRecord } from "./elements";
import { parseFormula } from "./formula";
import type { LewisAtom, LewisBond, LewisResult } from "./lewis";
import { namedSpeciesMentions } from "./namedSpecies";
import { declarationText, formulaKey, type ClaimReading } from "./sourceEvidenceShared";

const COUNT_WORDS: Readonly<Record<string, number>> = {
  no: 0, zero: 0, one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/** Words after "electron(s)" or "bond(s)" that make them something else. */
const NOT_ELECTRON_COUNT = new Set(["domain", "domains", "density", "geometry", "cloud", "clouds", "region", "regions", "configuration", "arrangement", "group", "groups"]);
const NOT_BOND_COUNT = new Set(["angle", "angles", "length", "lengths", "energy", "energies", "enthalpy", "enthalpies", "polarity", "dipole", "dipoles", "strength"]);
const ROLE_WORDS = new Set(["lone", "pair", "pairs", "electron", "electrons", "valence", "sigma", "σ", "pi", "π", "bond", "bonds", "bonding",
  "nonbonding", "shared", "atom", "atoms", "formal", "charge", "charges", "fc"]);
const PHRASE_WORDS = new Set(["lone", "pair", "pairs", "electron", "electrons", "total", "valence", "bonding", "nonbonding", "non", "shared",
  "bond", "bonds", "sigma", "σ", "pi", "π", "single", "double", "triple", "covalent", "atom", "atoms"]);
const STOP = new Set([",", ";", ":", ".", "=", "(", ")"]);
const SUBJECT_GLUE = new Set(["has", "have", "forms", "form", "makes", "make", "contains", "contain", "carries", "carry", "with", "uses", "use",
  "shows", "show", "is", "are", "the", "a", "an", "central", "atom", "atoms", "each", "bonded", "to", "total", "of", "its", "also", "only",
  "exactly", "consists", "comprises", "containing", "having", "(", ")", "there", "in"]);

interface Token { readonly text: string; readonly lower: string }

type Role = "lp" | "lpe" | "bp" | "be" | "v" | "tv" | "sigma" | "pi" | "bonds" | "atoms" | "electrons" | "pending";

interface Item {
  readonly at: number;
  readonly value: number;
  role: Role;
  readonly order: 1 | 2 | 3 | null;
  readonly types: ReadonlyArray<readonly [string, string]>;
  readonly element: ElementRecord | null;
  /** Where the count phrase ends, before any "to H" partner phrase. */
  readonly end: number;
  /** The bonded partner a bond count names: "single bonds to H". */
  partner: ElementRecord | null;
  /** Where the item ends after its partner and gloss phrases. */
  after: number;
}

type Owner =
  | { kind: "atom"; atoms: readonly LewisAtom[] }
  | { kind: "molecule" }
  | { kind: "bond"; order: 1 | 2 | 3; types: ReadonlyArray<readonly [string, string]> };

/** Lewis notation folded to words: FC(C) is a formal charge on C, a named
 * species is its formula, and bond notation (N-H, O=C=O) is one chain token
 * N·H, O·C·O, so its atoms are neither owners nor an invented ion. */
export function lewisClaimText(raw: string): string {
  let text = declarationText(raw)
    .replace(/\bFC\s*\(\s*([A-Z][a-z]?)\s*\)/g, "formal charge on $1")
    .replace(/([a-z])[-‐-―](?=[a-z])/g, "$1 ");
  for (const mention of namedSpeciesMentions(text).reverse()) {
    text = `${text.slice(0, mention.start)}${mention.formula}${text.slice(mention.end)}`;
  }
  return text.replace(/([A-Z][a-z]?)\s*[-–=≡]\s*(?=[A-Z])/g, "$1·");
}

function tokens(text: string): Token[] {
  return [...text.matchAll(/[A-Za-z0-9·]+(?:\.\d+)?|[^\sA-Za-z0-9·]/g)].map((match) => ({ text: match[0], lower: match[0].toLowerCase() }));
}

function countOf(token: Token | undefined): number | null {
  if (!token) return null;
  if (/^\d+$/.test(token.text)) return Number(token.text);
  return COUNT_WORDS[token.lower] ?? null;
}

function elementOf(token: Token | undefined): ElementRecord | null {
  if (!token || token.text.includes("·")) return null;
  if (COUNT_WORDS[token.lower] !== undefined) return null;
  const symbol = elementBySymbol(token.text);
  if (symbol) return symbol;
  if (!/^[a-z]{3,}$/i.test(token.text)) return null;
  return elementByName(token.lower) ?? (token.lower.endsWith("s") ? elementByName(token.lower.slice(0, -1)) : null);
}

function chainPairs(token: Token): Array<[string, string]> {
  if (!/^[A-Z][a-z]?(?:·[A-Z][a-z]?)+$/.test(token.text)) return [];
  const symbols = token.text.split("·");
  return symbols.slice(1).map((symbol, index) => [symbols[index]!, symbol]);
}

function isRoleNoun(list: readonly Token[], index: number): boolean {
  const token = list[index]!;
  if (!ROLE_WORDS.has(token.lower)) return false;
  const next = list[index + 1]?.lower ?? "";
  if ((token.lower === "electron" || token.lower === "electrons") && NOT_ELECTRON_COUNT.has(next)) return false;
  if ((token.lower === "bond" || token.lower === "bonds") && NOT_BOND_COUNT.has(next)) return false;
  if (token.lower === "charge" || token.lower === "charges") return list[index - 1]?.lower === "formal";
  return true;
}

/** Count tokens that state a Lewis count: forward ("two lone pairs") or
 * reverse ("formal charge on C = 0", "bond order of 2"). */
function mentions(list: readonly Token[]): Set<number> {
  const found = new Set<number>();
  list.forEach((token, index) => {
    if (countOf(token) === null) return;
    for (let ahead = index + 1; ahead <= index + 4 && ahead < list.length; ahead++) {
      if (STOP.has(list[ahead]!.lower)) break;
      if (isRoleNoun(list, ahead)) { found.add(index); return; }
    }
  });
  list.forEach((token, index) => {
    if (!isRoleNoun(list, index)) return;
    for (let ahead = index + 1; ahead <= index + 6 && ahead < list.length; ahead++) {
      const word = list[ahead]!.lower;
      if ([".", ";", ","].includes(word)) break;
      if (!["is", "are", "=", ":", "of", "equals", "equal"].includes(word)) continue;
      let at = ahead + 1;
      if (["+", "-", "−"].includes(list[at]?.text ?? "")) at++;
      if (countOf(list[at]) !== null) found.add(at);
    }
  });
  return found;
}

function atomsOf(result: LewisResult, element: ElementRecord): LewisAtom[] {
  return result.atoms.filter((atom) => atom.symbol === element.symbol);
}

function centralAtom(result: LewisResult): LewisAtom | null {
  return result.skeleton === "central" ? result.atoms.find((atom) => atom.id === result.centralAtom) ?? null : null;
}

/** One value for every atom of an element, or null when they differ. */
function perAtom(atoms: readonly LewisAtom[], read: (atom: LewisAtom) => number | null): number | null {
  const values = atoms.map(read);
  if (values.length === 0 || values.some((value) => value === null)) return null;
  return values.every((value) => value === values[0]) ? values[0]! : null;
}

function symbolOf(result: LewisResult, id: string): string {
  return result.atoms.find((atom) => atom.id === id)?.symbol ?? "";
}

function bondMatches(result: LewisResult, bond: LewisBond, order: number | null, types: ReadonlyArray<readonly [string, string]>, partner: ElementRecord | null, at?: LewisAtom): boolean {
  if (order !== null && bond.order !== order) return false;
  const a = symbolOf(result, bond.a);
  const b = symbolOf(result, bond.b);
  if (types.length > 0 && !types.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return false;
  if (partner) {
    const other = at ? (bond.a === at.id ? b : a) : null;
    if (other !== null ? other !== partner.symbol : a !== partner.symbol && b !== partner.symbol) return false;
  }
  return true;
}

function incident(result: LewisResult, atom: LewisAtom): LewisBond[] {
  return result.bonds.filter((bond) => bond.a === atom.id || bond.b === atom.id);
}

/** The source value of one read item under its owner, or null when the
 * reader cannot say which value of the structure it names. */
function sourceValue(item: Item, owner: Owner | null, result: LewisResult, partner: ElementRecord | null, bondedTo: boolean): number | null {
  const radical = result.unpairedElectrons > 0;
  if ((item.role === "lp" || item.role === "lpe") && radical) return null;
  if (owner?.kind === "bond") {
    const scoped = result.bonds.filter((bond) => bondMatches(result, bond, owner.order, owner.types, null));
    if (item.role === "sigma") return scoped.length > 0 ? 1 : -1;
    if (item.role === "pi") return scoped.length > 0 ? owner.order - 1 : -1;
    return null;
  }
  if (owner?.kind === "atom") {
    const atoms = owner.atoms;
    switch (item.role) {
      case "lp": return perAtom(atoms, (atom) => atom.lonePairs);
      case "lpe": return perAtom(atoms, (atom) => 2 * atom.lonePairs);
      case "bp": return perAtom(atoms, (atom) => incident(result, atom).reduce((sum, bond) => sum + bond.order, 0));
      case "be": return perAtom(atoms, (atom) => 2 * incident(result, atom).reduce((sum, bond) => sum + bond.order, 0));
      case "v": return perAtom(atoms, (atom) => valenceElectrons(atom.element));
      case "sigma": return perAtom(atoms, (atom) => incident(result, atom).filter((bond) => bondMatches(result, bond, null, item.types, partner, atom)).length);
      case "pi": return perAtom(atoms, (atom) => incident(result, atom).filter((bond) => bondMatches(result, bond, null, item.types, partner, atom))
        .reduce((sum, bond) => sum + bond.order - 1, 0));
      case "bonds": return perAtom(atoms, (atom) => incident(result, atom).filter((bond) => bondMatches(result, bond, item.order, item.types, partner, atom)).length);
      case "atoms": return bondedTo && item.element
        ? perAtom(atoms, (atom) => atom.neighbours.filter((id) => symbolOf(result, id) === item.element!.symbol).length) : null;
      default: return null;
    }
  }
  // A bond type or a bond order names its bonds without an owner.
  const molecular = owner?.kind === "molecule" || ((item.role === "bonds" || item.role === "sigma" || item.role === "pi") && item.types.length > 0);
  if (!molecular) return null;
  const shared = result.bonds.reduce((sum, bond) => sum + bond.order, 0);
  const typed = result.bonds.filter((bond) => bondMatches(result, bond, null, item.types, partner));
  switch (item.role) {
    case "lp": return result.lonePairs;
    case "lpe": return 2 * result.lonePairs;
    case "bp": return shared;
    case "be": return 2 * shared;
    case "tv": return result.totalValenceElectrons;
    case "sigma": return typed.length;
    case "pi": return typed.reduce((sum, bond) => sum + bond.order - 1, 0);
    case "bonds": return result.bonds.filter((bond) => bondMatches(result, bond, item.order, item.types, partner)).length;
    case "atoms": return !bondedTo && item.element ? result.formula.atoms.find((atom) => atom.element === item.element)?.count ?? 0 : null;
    default: return null;
  }
}

/** A count and the Lewis phrase after it, or null when the words are not one. */
function parseItem(list: readonly Token[], at: number): Item | null {
  const value = countOf(list[at]);
  if (value === null) return null;
  const words: string[] = [];
  const types: Array<readonly [string, string]> = [];
  let element: ElementRecord | null = null;
  let end = at + 1;
  for (; end < list.length; end++) {
    const token = list[end]!;
    const pairs = chainPairs(token);
    if (pairs.length) { types.push(...pairs); continue; }
    if (PHRASE_WORDS.has(token.lower)) {
      if ((token.lower === "electron" || token.lower === "electrons") && NOT_ELECTRON_COUNT.has(list[end + 1]?.lower ?? "")) return null;
      if ((token.lower === "bond" || token.lower === "bonds") && NOT_BOND_COUNT.has(list[end + 1]?.lower ?? "")) return null;
      words.push(token.lower);
      continue;
    }
    const named = elementOf(token);
    if (named && !element && ["atom", "atoms"].includes(list[end + 1]?.lower ?? "")) { element = named; continue; }
    if (["σ", "π"].includes(token.text)) { words.push(token.text); continue; }
    break;
  }
  // "one lone pair of electrons" is still a lone-pair count.
  if (words.includes("lone") && list[end]?.lower === "of" && /^electrons?$/.test(list[end + 1]?.lower ?? "")) end += 2;
  const has = (...options: string[]) => options.some((option) => words.includes(option));
  const orders = (["single", "double", "triple"] as const).filter((word) => words.includes(word));
  if (orders.length > 1) return null;
  const order = orders.length ? ({ single: 1, double: 2, triple: 3 } as const)[orders[0]!] : null;
  let role: Role | null = null;
  if (has("lone") || has("nonbonding", "non")) role = has("electron", "electrons") ? "lpe" : has("pair", "pairs") || words.length === 1 ? "lp" : null;
  else if (has("sigma", "σ")) role = has("pi", "π") ? null : "sigma";
  else if (has("pi", "π")) role = "pi";
  else if (has("bonding", "shared", "bond") && has("electron", "electrons")) role = "be";
  else if (has("bonding", "shared", "bond") && has("pair", "pairs")) role = "bp";
  else if (has("valence")) role = has("electron", "electrons") || words.length === 1 || has("total") ? (has("total") ? "tv" : "v") : null;
  else if (has("bond", "bonds")) role = "bonds";
  else if (has("atom", "atoms") && element) role = "atoms";
  else if (words.length === 1 && words[0] === "bonding") role = "pending";
  else if (words.length > 0 && words.every((word) => word === "electron" || word === "electrons")) role = "electrons";
  if (!role) return null;
  if (order !== null && role !== "bonds") return null;
  if (types.length > 0 && !["bonds", "sigma", "pi", "bp", "be"].includes(role)) return null;
  if (element && role !== "atoms") return null;
  return { at, value, role, order, types, element, end, partner: null, after: end };
}

interface OwnerRead { owner: Owner | null; bondedTo: boolean; failed: boolean }

/** The atom, central atom, molecule or bond a list of counts describes. */
function readOwner(list: readonly Token[], start: number, end: number, result: LewisResult): OwnerRead {
  const key = formulaKey(result.formula.text);
  const resolveAtom = (element: ElementRecord): LewisAtom[] | null => {
    const atoms = atomsOf(result, element);
    return atoms.length ? atoms : null;
  };
  let post: Owner | null = null;
  let failed = false;
  // Postposed: on/around/at/of/for/from an atom; in a bond; in the molecule.
  let at = end;
  if (["on", "around", "at", "of", "for", "from"].includes(list[at]?.lower ?? "")) {
    at++;
    while (["the", "each"].includes(list[at]?.lower ?? "")) at++;
    if (list[at]?.lower === "central" && /^atoms?$/.test(list[at + 1]?.lower ?? "")) {
      const central = centralAtom(result);
      post = central ? { kind: "atom", atoms: [central] } : null;
      failed = !central;
    } else {
      const element = elementOf(list[at]);
      if (element) {
        const atoms = resolveAtom(element);
        post = atoms ? { kind: "atom", atoms } : null;
        failed = !atoms;
      } else if (list[at] && parseFormula(list[at]!.text) && formulaKey(list[at]!.text) === key) post = { kind: "molecule" };
    }
  } else if (list[at]?.lower === "in") {
    at++;
    while (["the", "a", "an", "each", "its", "this"].includes(list[at]?.lower ?? "")) at++;
    const types = chainPairs(list[at] ?? { text: "", lower: "" });
    if (types.length) at++;
    const order = ({ single: 1, double: 2, triple: 3 } as const)[list[at]?.lower as "single" | "double" | "triple"];
    if (order && /^bonds?$/.test(list[at + 1]?.lower ?? "")) post = { kind: "bond", order, types };
    else if (list[at]?.lower === "total" || ["molecule", "structure"].includes(list[at]?.lower ?? "")) post = { kind: "molecule" };
    else if (list[at] && parseFormula(list[at]!.text) && formulaKey(list[at]!.text) === key) post = { kind: "molecule" };
  }
  // Subject: the nearest owner before the list across connecting words only.
  let subject: Owner | null = null;
  let central = false;
  let bondedTo = false;
  for (let back = start - 1; back >= 0; back--) {
    const token = list[back]!;
    if (token.lower === "central") central = true;
    if (token.lower === "bonded") bondedTo = true;
    if (/^bonds?$/.test(token.lower)) {
      const order = ({ single: 1, double: 2, triple: 3 } as const)[list[back - 1]?.lower as "single" | "double" | "triple"];
      const types = back >= 2 ? chainPairs(list[back - 2]!) : [];
      if (order) subject = { kind: "bond", order, types };
      break;
    }
    const element = elementOf(token);
    if (element) {
      const atoms = resolveAtom(element);
      if (!atoms) { failed = true; break; }
      const centre = centralAtom(result);
      if (central && (!centre || centre.symbol !== element.symbol)) { failed = true; break; }
      subject = { kind: "atom", atoms };
      break;
    }
    if (parseFormula(token.text) && /[A-Z]/.test(token.text) && !token.text.includes("·")) {
      if (formulaKey(token.text) !== key) { failed = true; break; }
      subject = { kind: "molecule" };
      break;
    }
    if (["molecule", "structure", "compound", "it", "there"].includes(token.lower)) { subject = { kind: "molecule" }; break; }
    if (!SUBJECT_GLUE.has(token.lower)) break;
    if (back === 0 && central) {
      const centre = centralAtom(result);
      subject = centre ? { kind: "atom", atoms: [centre] } : null;
      failed = !centre;
    }
  }
  if (!subject && central && !failed) {
    const centre = centralAtom(result);
    if (centre) subject = { kind: "atom", atoms: [centre] };
  }
  // A postposed atom or bond wins; "in CO2" after an atom subject is context.
  const owner = post && post.kind !== "molecule" ? post : subject ?? post;
  return { owner, bondedTo, failed };
}

/** Formal charge statements: "all formal charges are zero", "formal charge
 * on C = 0", "N has a formal charge of +1", "zero formal charge on O". */
function formalCharges(list: readonly Token[], result: LewisResult, consumed: Set<number>, facts: boolean[]): void {
  const lower = list.map((token) => token.lower);
  const signed = (at: number): { value: number; index: number; end: number } | null => {
    let sign = 1;
    let index = at;
    if (["+", "-", "−"].includes(list[index]?.text ?? "")) { sign = list[index]!.text === "+" ? 1 : -1; index++; }
    const value = countOf(list[index]);
    return value === null ? null : { value: sign * value, index, end: index + 1 };
  };
  const ownerAt = (at: number): { atoms: LewisAtom[]; end: number } | null => {
    let index = at;
    while (["the", "each"].includes(lower[index] ?? "")) index++;
    if (lower[index] === "central" && /^atoms?$/.test(lower[index + 1] ?? "")) {
      const centre = centralAtom(result);
      return centre ? { atoms: [centre], end: index + 2 } : null;
    }
    const element = elementOf(list[index]);
    if (!element) return null;
    const atoms = atomsOf(result, element);
    if (!atoms.length) return null;
    return { atoms, end: /^atoms?$/.test(lower[index + 1] ?? "") ? index + 2 : index + 1 };
  };
  const check = (atoms: readonly LewisAtom[], value: number, index: number) => {
    const source = perAtom(atoms, (atom) => atom.formalCharge);
    if (source === null) return;
    facts.push(source === value);
    consumed.add(index);
  };
  for (let i = 0; i < list.length; i++) {
    // all (the) formal charges are zero / formal charges are all zero / all atoms have zero formal charge
    if (lower[i] === "all") {
      let at = i + 1;
      if (lower[at] === "the") at++;
      if (lower[at] === "formal" && lower[at + 1] === "charges" && lower[at + 2] === "are") {
        const value = signed(at + 3);
        if (value) { facts.push(result.atoms.every((atom) => atom.formalCharge === value.value)); consumed.add(value.index); }
      } else if (lower[at] === "atoms" && ["have", "carry"].includes(lower[at + 1] ?? "")) {
        const value = signed(at + 2);
        if (value && lower[value.end] === "formal" && /^charges?$/.test(lower[value.end + 1] ?? "")) {
          facts.push(result.atoms.every((atom) => atom.formalCharge === value.value)); consumed.add(value.index);
        }
      }
    }
    if (lower[i] === "formal" && lower[i + 1] === "charges" && lower[i + 2] === "are" && lower[i + 3] === "all") {
      const value = signed(i + 4);
      if (value) { facts.push(result.atoms.every((atom) => atom.formalCharge === value.value)); consumed.add(value.index); }
    }
    // formal charge (on|of) OWNER (is|=|:|of) VALUE
    if (lower[i] === "formal" && lower[i + 1] === "charge") {
      let at = i + 2;
      if (["on", "of"].includes(lower[at] ?? "")) at++;
      const owner = ownerAt(at);
      if (owner) {
        let next = owner.end;
        if (["is", "=", ":", "of"].includes(lower[next] ?? "")) next++;
        const value = signed(next);
        if (value) check(owner.atoms, value.value, value.index);
      }
    }
    // OWNER (has|carries) (a) formal charge of VALUE / OWNER has (a) VALUE formal charge
    const owner = ownerAt(i);
    if (owner && ["has", "carries", "bears"].includes(lower[owner.end] ?? "")) {
      let at = owner.end + 1;
      if (["a", "an"].includes(lower[at] ?? "") && lower[at + 1] === "formal") at++;
      if (lower[at] === "formal" && lower[at + 1] === "charge" && lower[at + 2] === "of") {
        const value = signed(at + 3);
        if (value) check(owner.atoms, value.value, value.index);
      } else {
        const value = signed(at);
        if (value && lower[value.end] === "formal" && lower[value.end + 1] === "charge") check(owner.atoms, value.value, value.index);
      }
    }
    // zero formal charge on OWNER
    const leading = signed(i);
    if (leading && lower[leading.end] === "formal" && lower[leading.end + 1] === "charge" && ["on", "of"].includes(lower[leading.end + 2] ?? "")) {
      const target = ownerAt(leading.end + 3);
      if (target) check(target.atoms, leading.value, leading.index);
    }
  }
}

/** Read one claim text against the structure. */
export function readLewisClaim(raw: string, result: LewisResult): ClaimReading {
  const list = tokens(lewisClaimText(raw));
  const wanted = mentions(list);
  const consumed = new Set<number>();
  const facts: boolean[] = [];
  formalCharges(list, result, consumed, facts);
  for (let i = 0; i < list.length; i++) {
    if (!wanted.has(i) || consumed.has(i)) continue;
    const items: Item[] = [];
    let item = parseItem(list, i);
    while (item) {
      items.push(item);
      let next = item.end;
      // "single bonds to H": the bonded partner of a bond count.
      if (["to", "with"].includes(list[next]?.lower ?? "") && ["bonds", "sigma", "pi"].includes(item.role)) {
        let at = next + 1;
        while (["the", "each", "both"].includes(list[at]?.lower ?? "")) at++;
        const partner = elementOf(list[at]);
        if (partner) {
          item.partner = partner;
          next = /^atoms?$/.test(list[at + 1]?.lower ?? "") ? at + 2 : at + 1;
        }
      }
      // A parenthetical gloss does not end the list: "one sigma bond (end-on overlap) and one pi bond".
      if (list[next]?.text === "(") {
        const close = list.findIndex((token, index) => index > next && token.text === ")");
        if (close < 0) break;
        next = close + 1;
      }
      item.after = next;
      const join = list[next]?.lower ?? "";
      if (!["+", "and", ",", "plus"].includes(join) || countOf(list[next + 1]) === null) break;
      item = parseItem(list, next + 1);
    }
    if (!items.length) continue;
    // A shared final noun: "4 bonding + 4 lone pair electrons".
    const last = items[items.length - 1]!;
    for (const entry of items) {
      if (entry.role !== "pending") continue;
      if (last.role === "lpe" || last.role === "be" || last.role === "electrons") entry.role = "be";
      else if (last.role === "lp" || last.role === "bp") entry.role = "bp";
    }
    const end = last.after;
    // "2 electrons form 1 lone pair": the electrons are those pairs.
    if (items.length === 1 && last.role === "electrons" && /^forms?$/.test(list[end]?.lower ?? "")) {
      const pairs = parseItem(list, end + 1);
      if (pairs?.role === "lp") { facts.push(last.value === 2 * pairs.value); consumed.add(i); }
      continue;
    }
    const owner = readOwner(list, items[0]!.at, end, result);
    if (owner.failed) continue;
    for (const entry of items) {
      const source = sourceValue(entry, owner.owner, result, entry.partner, owner.bondedTo);
      if (source === null) continue;
      facts.push(source === entry.value);
      consumed.add(entry.at);
      // "three N-H single bonds using 6 electrons"
      if (entry.role === "bonds" && list[entry.end]?.lower === "using" && /^electrons?$/.test(list[entry.end + 2]?.lower ?? "")) {
        const electrons = countOf(list[entry.end + 1]);
        const bonds = result.bonds.filter((bond) => bondMatches(result, bond, entry.order, entry.types, entry.partner));
        if (electrons !== null && owner.owner?.kind !== "atom") {
          facts.push(electrons === 2 * bonds.reduce((sum, bond) => sum + bond.order, 0));
          consumed.add(entry.end + 1);
        }
      }
    }
  }
  const unread = [...wanted].some((index) => !consumed.has(index));
  return { facts, unread };
}
