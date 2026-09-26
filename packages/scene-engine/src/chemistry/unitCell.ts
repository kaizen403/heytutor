/**
 * Solid state unit cells for JEE Main.
 *
 * A cubic cell is drawn as an isometric cube (x to the right, y into depth
 * up and right, z up) with its three hidden back edges dashed, atoms as discs
 * on their lattice sites, a dimension along the front bottom edge for `a`,
 * and, when the stem is about radius, packing or distances, the diagonal
 * along which the atoms touch. hcp is drawn as ABAB layers: a hexagonal
 * prism does not read on a 2D board. The ionic templates (rock salt, CsCl,
 * zinc blende, fluorite, antifluorite) place both ions; the stoichiometry
 * puzzles ("A at corners, B at face centres, one corner removed") draw the
 * described cell and state the count in the caption.
 *
 * Nothing is guessed. The lattice comes from the stem's own word, every
 * number on the figure comes from the stem or the plan, and a stem with no
 * lattice (Schottky or Frenkel defects, amorphous solids, a physics block, a
 * cell "shown below" that we do not have) draws nothing.
 */
import type { SceneDocument } from "../types";
import { ChemScene, chemStem, planQuantity, type ChemPlanQuantity, type Vec2 } from "./sceneKit";
import { normalizeChemistryText } from "./formula";
import { elementBySymbol } from "./elements";

export const SOLID_FAMILY = "chem_unit_cell" as const;
const AVOGADRO = 6.022e23;

export type Lattice = "sc" | "bcc" | "fcc" | "hcp";

export interface UnitCellFacts {
  atomsPerCell: number;
  coordinationNumber: number;
  /** Percent, as the textbook quotes it. */
  packingEfficiency: number;
  radiusRelation: string;
  /** Voids per unit cell. sc has only a cubic void, so both are 0 there. */
  voids: { octahedral: number; tetrahedral: number };
}

const FACTS: Record<Lattice, UnitCellFacts> = {
  sc: { atomsPerCell: 1, coordinationNumber: 6, packingEfficiency: 52.4, radiusRelation: "a = 2r", voids: { octahedral: 0, tetrahedral: 0 } },
  // bcc is not close packed; the crystallographic count is 6 distorted
  // octahedral (6 faces × 1/2 + 12 edges × 1/4) and 12 distorted tetrahedral sites.
  bcc: { atomsPerCell: 2, coordinationNumber: 8, packingEfficiency: 68, radiusRelation: "√3a = 4r", voids: { octahedral: 6, tetrahedral: 12 } },
  fcc: { atomsPerCell: 4, coordinationNumber: 12, packingEfficiency: 74, radiusRelation: "√2a = 4r", voids: { octahedral: 4, tetrahedral: 8 } },
  hcp: { atomsPerCell: 6, coordinationNumber: 12, packingEfficiency: 74, radiusRelation: "a = 2r", voids: { octahedral: 6, tetrahedral: 12 } },
};

const LATTICE_NAME: Record<Lattice, string> = { sc: "simple cubic", bcc: "bcc", fcc: "fcc (ccp)", hcp: "hcp" };
const LATTICE_SHORT: Record<Lattice, string> = { sc: "sc", bcc: "bcc", fcc: "fcc", hcp: "hcp" };

/** Read a lattice from a word the student used: "ccp", "face centred cubic", "body-centered", "hcp". */
function latticeFromWord(word: string): Lattice | null {
  const w = word.toLowerCase().trim();
  if (/\b(?:fcc|ccp)\b|cubic close|face[ -]?cent/.test(w)) return "fcc";
  if (/\bbcc\b|body[ -]?cent/.test(w)) return "bcc";
  if (/\bhcp\b|hexagonal close/.test(w)) return "hcp";
  if (/simple cubic|primitive cubic|\bsc\b|primitive/.test(w)) return "sc";
  return null;
}

/** Textbook facts for a lattice; throws on a word that names no lattice. */
export function unitCellFacts(lattice: Lattice | string): UnitCellFacts {
  const key = (["sc", "bcc", "fcc", "hcp"] as const).includes(lattice as Lattice) ? (lattice as Lattice) : latticeFromWord(lattice);
  if (!key) throw new Error(`unknown lattice "${lattice}"`);
  return { ...FACTS[key], voids: { ...FACTS[key].voids } };
}

/** ρ = Z·M / (a³·N_A) in g/cm³ with a given in pm. */
export function unitCellDensity(input: { z: number; molarMass: number; edgeLengthPm: number; avogadro?: number }): number {
  const aCm = input.edgeLengthPm * 1e-10;
  return (input.z * input.molarMass) / (aCm ** 3 * (input.avogadro ?? AVOGADRO));
}

/* ------------------------------------------------------------------ cues */

const LATTICE_WORD = /\b(?:fcc|ccp|bcc|hcp)\b|simple cubic|primitive cubic|body[ -]?cent(?:re|er)(?:e?d)?|face[ -]?cent(?:re|er)(?:e?d)?|cubic close[ -]?pack|hexagonal close[ -]?pack|rock[ -]?salt|nacl[ -]?(?:type|structure|like)|\bcscl\b|zinc blende|sphalerite|antifluorite|anti-fluorite|\bfluorite\b/;
const SOLID_CUE = /unit cells?|packing (?:efficiency|fraction)|octahedral (?:voids?|holes?|sites?)|tetrahedral (?:voids?|holes?|sites?)|edge length|cubic (?:lattice|unit|crystal|close)|lattice[^.]{0,20}cubic|close[ -]?pack/;
const VETO = /schottky|frenkel|vacancy|interstitial defect|\bf[ -]cent(?:re|er)s?\b|metal (?:deficiency|excess)|non[ -]?stoichiometr|point defects?|amorphous|cubical|cube of side|lattice (?:energy|enthalpy)|hydration energ|crystal field|tetragonal|orthorhombic|monoclinic|triclinic|rhombohedral|shown (?:below|above|in the figure)|given figure|following figure|structure (?:shown|given)|figure (?:shown|given|below)/;

/** True when the stem names a lattice or a unit cell question and vetoes nothing. */
export function isUnitCellStem(question: string): boolean {
  const stem = chemStem(question);
  if (VETO.test(stem)) return false;
  return LATTICE_WORD.test(stem) || SOLID_CUE.test(stem);
}

/* ------------------------------------------------------------ geometry */

type Triple = readonly [number, number, number];
type SiteKind = "corner" | "face" | "edge" | "body" | "tet";

const SITE_SHARE: Record<SiteKind, number> = { corner: 1 / 8, face: 1 / 2, edge: 1 / 4, body: 1, tet: 1 };
const SITE_TOTAL: Record<SiteKind, number> = { corner: 8, face: 6, edge: 12, body: 1, tet: 8 };

const CORNERS: Triple[] = [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0], [0, 1, 1], [0, 1, 0]];
const FACES: Triple[] = [[0.5, 0, 0.5], [0.5, 0.5, 1], [1, 0.5, 0.5], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 1, 0.5]];
const EDGES: Triple[] = [
  [0, 0, 0.5], [0.5, 0, 0], [1, 0, 0.5], [0.5, 0, 1],
  [0, 0.5, 0], [1, 0.5, 0], [0, 0.5, 1], [1, 0.5, 1],
  [0.5, 1, 0], [0, 1, 0.5], [1, 1, 0.5], [0.5, 1, 1],
];
const BODY: Triple = [0.5, 0.5, 0.5];
/** Alternate tetrahedral sites (zinc blende Zn positions), then the other four. */
const TET: Triple[] = [
  [0.25, 0.25, 0.25], [0.75, 0.75, 0.25], [0.75, 0.25, 0.75], [0.25, 0.75, 0.75],
  [0.75, 0.25, 0.25], [0.25, 0.75, 0.25], [0.25, 0.25, 0.75], [0.75, 0.75, 0.75],
];
const SITES: Record<SiteKind, Triple[]> = { corner: CORNERS, face: FACES, edge: EDGES, body: [BODY], tet: TET };
const HIDDEN_CORNER: Triple = [0, 1, 0];

const DEPTH: Vec2 = { x: 0.6, y: 0.3 };
const SCALE = 2;
const CELL_WIDTH = SCALE * (1 + DEPTH.x);
const SLOT_GAP = 1.4;

const same = (a: Triple, b: Triple): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

function project(p: Triple, origin: Vec2): Vec2 {
  return { x: origin.x + SCALE * (p[0] + DEPTH.x * p[1]), y: origin.y + SCALE * (DEPTH.y * p[1] + p[2]) };
}

interface CubeIds { ids: string[]; frontBottom: string; frontLeft: string }

/** The twelve edges of the cube; the three meeting the hidden back corner are dashed. */
function drawCube(c: ChemScene, prefix: string, origin: Vec2): CubeIds {
  const ids: string[] = [];
  let frontBottom = "";
  let frontLeft = "";
  let index = 0;
  for (let i = 0; i < CORNERS.length; i += 1) {
    for (let j = i + 1; j < CORNERS.length; j += 1) {
      const a = CORNERS[i]!;
      const b = CORNERS[j]!;
      const differing = [0, 1, 2].filter((k) => a[k] !== b[k]);
      if (differing.length !== 1) continue;
      const hidden = same(a, HIDDEN_CORNER) || same(b, HIDDEN_CORNER);
      index += 1;
      const id = `${prefix}_edge${index}`;
      c.link(id, project(a, origin), project(b, origin), hidden ? "hidden unit cell edge" : "unit cell edge", hidden);
      ids.push(id);
      const onFront = a[1] === 0 && b[1] === 0;
      if (onFront && a[2] === 0 && b[2] === 0) frontBottom = id;
      if (onFront && a[0] === 0 && b[0] === 0) frontLeft = id;
    }
  }
  return { ids, frontBottom, frontLeft };
}

interface Sphere { at: Triple; radius: number; label?: string; role: string; labelMode?: "pin" | "beside" }

/**
 * Where a sphere's symbol goes. Cube edges meet at a corner sphere's centre
 * and run through an edge-centre sphere, so a symbol pinned there would be
 * struck through; those symbols are set beside the sphere by the solver. A
 * face, body or tetrahedral sphere carries its symbol inside unless a drawn
 * diagonal passes through it.
 */
function labelModeFor(kind: SiteKind, at: Triple, through: readonly Triple[]): "pin" | "beside" {
  if (kind === "corner" || kind === "edge") return "beside";
  return through.some((crossed) => same(crossed, at)) ? "beside" : "pin";
}

/**
 * A sphere on a lattice site. A short symbol (A, B, O, Cl) is pinned inside
 * the disc; an ion with a charge is too wide for a small disc, so the
 * placement solver sets it beside the sphere instead.
 */
function drawSphere(c: ChemScene, id: string, at: Vec2, sphere: Sphere): string {
  const pinned = sphere.label !== undefined && (sphere.labelMode ?? "pin") === "pin";
  if (pinned || sphere.label === undefined) {
    c.atom(id, sphere.label ?? "", at, { radius: sphere.radius, text: sphere.label ?? null, role: sphere.role });
  } else {
    const centre = c.scene.helper(`${id}_c`, at, `${sphere.role} centre helper`);
    c.scene.circle(id, centre, sphere.radius, sphere.role, sphere.label);
  }
  if (sphere.label) c.scene.labelled(id);
  return id;
}

/** A dashed ghost where an atom was removed, at the radius of the species that left. */
function drawVacancy(c: ChemScene, id: string, at: Vec2, radius: number): string {
  const centre = c.scene.helper(`${id}_c`, at, "vacant site centre helper");
  c.scene.circle(id, centre, radius, "vacant site (atom removed)");
  const entity = c.scene.entities.find((candidate) => candidate.id === id);
  if (entity) entity.provenance = { dashed: true, strokeRole: "construction" };
  return id;
}

function drawSpheres(c: ChemScene, prefix: string, origin: Vec2, spheres: readonly Sphere[]): string[] {
  return spheres.map((sphere, index) => drawSphere(c, `${prefix}_atom${index + 1}`, project(sphere.at, origin), sphere));
}

/** Dimension `a` under the front bottom edge. */
function drawEdgeDimension(c: ChemScene, prefix: string, origin: Vec2, text: string): string {
  const a = c.scene.helper(`${prefix}_dim_a`, project([0, 0, 0], origin), "dimension end helper");
  const b = c.scene.helper(`${prefix}_dim_b`, project([1, 0, 0], origin), "dimension end helper");
  const id = c.scene.dimension(`${prefix}_dim`, a, b, "edge length dimension", text);
  c.scene.labelled(id);
  return id;
}

/** A dashed diagonal with a solver-placed relation label. */
function drawDiagonal(c: ChemScene, id: string, from: Vec2, to: Vec2, role: string, label: string): string {
  const a = c.scene.helper(`${id}_a`, from, "diagonal end helper");
  const b = c.scene.helper(`${id}_b`, to, "diagonal end helper");
  c.scene.segment(id, a, b, role, label);
  const entity = c.scene.entities.find((candidate) => candidate.id === id);
  if (entity) entity.provenance = { dashed: true, strokeRole: "construction" };
  c.scene.labelled(id);
  return id;
}

/** A small hollow ring on a void; its name is set beside it by the solver. */
function drawVoidMark(c: ChemScene, id: string, at: Vec2, role: string, label?: string): string {
  const centre = c.scene.helper(`${id}_c`, at, `${role} centre helper`);
  c.scene.circle(id, centre, 0.07, role, label);
  if (label) c.scene.labelled(id);
  return id;
}

/* ----------------------------------------------------------- readers */

const NUMBER = "(\\d+(?:\\.\\d+)?)(?:\\s*[x×*]\\s*10\\s*\\^?\\s*\\(?(-?\\d+)\\)?)?";
const LENGTH_UNIT = "(pm|nm|å|angstroms?|a°|cm)(?![a-z])";

function scientific(mantissa: string, exponent: string | undefined): number {
  return Number(mantissa) * Math.pow(10, exponent === undefined ? 0 : Number(exponent));
}

function toPm(value: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u === "pm") return value;
  if (u === "nm") return value * 1000;
  if (u === "cm") return value * 1e10;
  return value * 100;
}

function readLengthPm(stem: string, cue: RegExp): number | null {
  const pattern = new RegExp(`(?:${cue.source})[^.;:]{0,32}?${NUMBER}\\s*${LENGTH_UNIT}`, "i");
  const match = pattern.exec(stem);
  if (!match) return null;
  return toPm(scientific(match[1]!, match[2]), match[3]!);
}

const EDGE_CUE = /edge(?:\s*length)?|cell edge|axial distance|lattice (?:parameter|constant)|side of (?:the )?(?:cube|cell|unit cell)|\ba\s*(?:=|is)/;
const RADIUS_CUE = /(?:atomic|metallic|ionic|covalent)?\s*radius(?!\s*ratio)(?:\s+of\s+(?:the\s+)?(?:atom|metal|element|[a-z]+))?|\br\s*(?:=|is)/;

function readMolarMass(stem: string): number | null {
  const named = new RegExp(`(?:atomic|molar|molecular|formula|relative atomic)\\s*(?:mass|weight)(?:\\s+of\\s+(?:the\\s+)?[a-z]+)?[^.;:]{0,16}?${NUMBER}\\s*(?:g\\s*\\/?\\s*mol|g mol|amu|u(?![a-z]))`, "i");
  const match = named.exec(stem);
  if (match) return scientific(match[1]!, match[2]);
  const symbol = new RegExp(`\\bm\\s*=\\s*${NUMBER}(?:\\s*(?:g\\s*\\/?\\s*mol|g mol|amu|u(?![a-z])))?`, "i").exec(stem);
  return symbol ? scientific(symbol[1]!, symbol[2]) : null;
}

function readDensity(stem: string): number | null {
  const match = new RegExp(`density[^.;:]{0,40}?${NUMBER}\\s*(?:g\\s*\\/?\\s*cm|g cm|kg)`, "i").exec(stem);
  return match ? scientific(match[1]!, match[2]) : null;
}

function readAvogadro(stem: string): number | null {
  const match = /avogadro[^.;]{0,40}?(\d(?:\.\d+)?)\s*[x×*]\s*10\s*\^?\s*\(?(\d+)\)?/i.exec(stem);
  if (!match || Number(match[2]) !== 23) return null;
  return Number(match[1]) * 1e23;
}

function planLengthPm(quantities: readonly ChemPlanQuantity[], aliases: readonly string[]): number | null {
  const value = planQuantity(quantities, aliases);
  if (value === null) return null;
  const match = quantities.find((quantity) => planQuantity([quantity], aliases) !== null);
  const unit = (match?.unit ?? "pm").toLowerCase();
  if (/cm/.test(unit)) return value * 1e10;
  if (/nm/.test(unit)) return value * 1000;
  if (/å|angstrom|^a$/.test(unit)) return value * 100;
  if (/^m$/.test(unit)) return value * 1e12;
  return value;
}

/** Three significant figures, keeping a trailing zero (11.0, 6.23). */
function fmt(value: number, digits = 3): string {
  const text = value.toPrecision(digits);
  return text.includes("e") ? String(Number(text)) : text;
}

/** A length in pm to a tenth: 400, 124.7. */
function fmtPm(value: number): string {
  return String(Number(value.toFixed(1)));
}

/** "400 pm" as a label; a length that does not fit 16 chars falls back to the bare symbol. */
function edgeLabel(edgePm: number | null): string {
  if (edgePm === null) return "a";
  const text = `a = ${fmtPm(edgePm)} pm`;
  return text.length <= 16 ? text : "a";
}

/* ------------------------------------------------------ ionic templates */

type IonicKey = "nacl" | "cscl" | "zns" | "caf2" | "na2o";

interface IonicTemplate {
  name: string;
  /** The structure type as a student names it: "rock salt", "fluorite". */
  typeName: string;
  /** Where each ion sits, with {cation} and {anion} placeholders. */
  sites: string;
  cation: string;
  anion: string;
  cationSites: SiteKind[];
  anionSites: SiteKind[];
  /** Number of tetrahedral sites the cation (or anion) takes: 4 alternate or all 8. */
  tetCount: number;
  /** Drawn radii: the eight tetrahedral-site ions of fluorite are drawn smaller so the cell stays readable. */
  anionRadius: number;
  cationRadius: number;
  z: number;
  cn: string;
  relation: string;
}

const IONIC: Record<IonicKey, IonicTemplate> = {
  nacl: { name: "NaCl (rock salt)", typeName: "rock salt", sites: "{anion} ccp, {cation} in all octahedral voids", cation: "Na^+", anion: "Cl^-", cationSites: ["edge", "body"], anionSites: ["corner", "face"], tetCount: 0, anionRadius: 0.22, cationRadius: 0.14, z: 4, cn: "6:6", relation: "a = 2(r+ + r-)" },
  cscl: { name: "CsCl", typeName: "CsCl", sites: "{anion} simple cubic, {cation} at the body centre", cation: "Cs^+", anion: "Cl^-", cationSites: ["body"], anionSites: ["corner"], tetCount: 0, anionRadius: 0.22, cationRadius: 0.16, z: 1, cn: "8:8", relation: "√3a = 2(r+ + r-)" },
  zns: { name: "ZnS (zinc blende)", typeName: "zinc blende", sites: "{anion} ccp, {cation} in alternate tetrahedral voids", cation: "Zn^(2+)", anion: "S^(2-)", cationSites: ["tet"], anionSites: ["corner", "face"], tetCount: 4, anionRadius: 0.22, cationRadius: 0.14, z: 4, cn: "4:4", relation: "√3a = 4(r+ + r-)" },
  caf2: { name: "CaF2 (fluorite)", typeName: "fluorite", sites: "{cation} ccp, {anion} in all tetrahedral voids", cation: "Ca^(2+)", anion: "F^-", cationSites: ["corner", "face"], anionSites: ["tet"], tetCount: 8, anionRadius: 0.17, cationRadius: 0.14, z: 4, cn: "8:4", relation: "√3a = 4(r+ + r-)" },
  na2o: { name: "Na2O (antifluorite)", typeName: "antifluorite", sites: "{anion} ccp, {cation} in all tetrahedral voids", cation: "Na^+", anion: "O^(2-)", cationSites: ["tet"], anionSites: ["corner", "face"], tetCount: 8, anionRadius: 0.22, cationRadius: 0.12, z: 4, cn: "4:8", relation: "√3a = 4(r+ + r-)" },
};

function readIonicTemplate(stem: string): IonicKey | null {
  const structural = /structure|unit cell|lattice|type|coordination|void|packing|edge|radius|radii|crystal|density|formula units?|nearest/.test(stem);
  if (!structural) return null;
  if (/antifluorite|anti-fluorite|\bna2o\b/.test(stem)) return "na2o";
  if (/\bfluorite\b|\bcaf2\b/.test(stem)) return "caf2";
  if (/zinc blende|sphalerite|\bzns\b/.test(stem)) return "zns";
  if (/\bcscl\b|c(?:a)?esium chloride/.test(stem)) return "cscl";
  if (/rock[ -]?salt|\bnacl\b|sodium chloride/.test(stem)) return "nacl";
  return null;
}

/**
 * "an ionic solid MX with NaCl structure": the stem's own letters replace Na
 * and Cl. The pair must be introduced as a solid or compound, or be the thing
 * said to adopt the structure; a stray capital pair in OCR noise is ignored.
 */
function genericIonPair(question: string): { cation: string; anion: string } | null {
  const text = normalizeChemistryText(question);
  const introduced = /(?:solid|compound|crystal|salt|structure of)\s+([A-Z])([A-Z])(?:_?\d)?(?![A-Za-z])/.exec(text);
  const adopts = /(?<![A-Za-z])([A-Z])([A-Z])(?:_?\d)?\s+(?:has|having|with|adopts|crystalli[sz]es|exists)\b/.exec(text);
  const pair = introduced ?? adopts;
  if (!pair) return null;
  const word = pair[1]! + pair[2]!;
  if (elementBySymbol(word) || /^(?:CN|NA|PE|TV|IE|EA|EN|PV|UV|IR|AC|DC)$/.test(word)) return null;
  return { cation: pair[1]!, anion: pair[2]! };
}

/* ------------------------------------------------- occupancy puzzles */

interface Occupant {
  species: string;
  /** Sites occupied per kind, as a count of sites (8 corners, 6 faces …). */
  sites: Partial<Record<SiteKind, number>>;
  hcp?: boolean;
  /** Atoms per hexagonal cell in the voids of an hcp lattice (6 octahedral, 12 tetrahedral). */
  hcpVoidAtoms?: number;
  /** A void fraction the stem names by a letter ("m fraction"): known to exist, count unknown. */
  unknownVoid?: boolean;
}

const SPECIES_WORDS: Array<[RegExp, string]> = [
  [/\boxide ions?\b/i, "O^(2-)"], [/\boxygen (?:atoms?|ions?)\b/i, "O"], [/\bsulph?ide ions?\b/i, "S^(2-)"],
  [/\bchloride ions?\b/i, "Cl^-"], [/\bbromide ions?\b/i, "Br^-"], [/\biodide ions?\b/i, "I^-"], [/\bfluoride ions?\b/i, "F^-"],
  [/\bsodium ions?\b/i, "Na^+"], [/\bpotassium ions?\b/i, "K^+"], [/\bc(?:a)?esium ions?\b/i, "Cs^+"], [/\blithium ions?\b/i, "Li^+"],
  [/\bcalcium ions?\b/i, "Ca^(2+)"], [/\bmagnesium ions?\b/i, "Mg^(2+)"], [/\bzinc ions?\b/i, "Zn^(2+)"], [/\balumini?um ions?\b/i, "Al^(3+)"],
  [/\bcations?\b/i, "cation"], [/\banions?\b/i, "anion"],
];

const FRACTION_WORDS: Array<[RegExp, number | null]> = [
  [/\ball\b/, 1], [/\bhalf\b|\balternate\b/, 0.5], [/\bone[ -]?(?:fourth|quarter)\b|\ba quarter\b|\b1\/4\b/, 0.25],
  [/\bone[ -]?third\b|\b1\/3\b/, 1 / 3], [/\btwo[ -]?thirds?\b|\b2\/3\b/, 2 / 3], [/\bthree[ -]?fourths?\b|\b3\/4\b/, 0.75],
  [/\bone[ -]?eighth\b|\b1\/8\b/, 0.125], [/\bthree[ -]?eighths?\b|\b3\/8\b/, 0.375], [/\bone[ -]?sixth\b|\b1\/6\b/, 1 / 6],
];

function readFraction(before: string): number | null | "unknown" {
  const tail = before.slice(-40);
  const general = /(\d+)\s*\/\s*(\d+)(?:\s*(?:of|th))?\s*(?:of\s+)?(?:the\s+|its\s+)?(?:available\s+)?$/i.exec(tail);
  if (general) return Number(general[1]) / Number(general[2]);
  const percent = /(\d+(?:\.\d+)?)\s*%\s*(?:of\s+)?(?:the\s+|its\s+)?$/i.exec(tail);
  if (percent) return Number(percent[1]) / 100;
  for (const [pattern, value] of FRACTION_WORDS) if (pattern.test(tail)) return value;
  // "m fraction of", "x of the": a letter stands for the fraction.
  if (/\b[a-z]\s+(?:fraction\s+)?of\s+(?:the\s+|its\s+)?$/i.test(tail)) return "unknown";
  if (/\bfraction\b/i.test(tail)) return "unknown";
  return null;
}

/** Species tokens in reading order: single capitals not in option lists, element symbols with charges, named ions. */
function speciesIn(fragment: string): Array<{ token: string; index: number }> {
  const found: Array<{ token: string; index: number }> = [];
  const single = /(?<![([])\b([A-Z])(?![a-z])(?!\)|\.)(?=\s*(?:atoms?|ions?|is|are|occup|at\b|form|present|,|and\b|\(|\^|\d|$))/g;
  for (const match of fragment.matchAll(single)) found.push({ token: match[1]!, index: match.index ?? 0 });
  const element = /\b([A-Z][a-z])(?:\^?\(?(\d?[+-])\)?)?(?=\s*(?:atoms?|ions?|is|are|occup|at\b|form|present|,|and\b))/g;
  for (const match of fragment.matchAll(element)) {
    if (!elementBySymbol(match[1]!)) continue;
    const charge = match[2] ? (match[2].length > 1 ? `^(${match[2]})` : `^${match[2]}`) : "";
    found.push({ token: `${match[1]}${charge}`, index: match.index ?? 0 });
  }
  for (const [pattern, token] of SPECIES_WORDS) {
    const match = pattern.exec(fragment);
    if (match) found.push({ token, index: match.index });
  }
  return found.sort((a, b) => a.index - b.index);
}

interface SitePhrase { index: number; kind: SiteKind | "hcp" | "oct" | "tet_void"; count: number }

/**
 * Site phrases in one sentence with their positions: a lattice word expands
 * to its sites, a void phrase carries the fraction written before it (NaN
 * when the fraction is a letter such as "m fraction of").
 */
function sitePhrases(sentence: string): SitePhrase[] {
  const lower = sentence.toLowerCase();
  const phrases: SitePhrase[] = [];
  const first = (pattern: RegExp): number => { const match = pattern.exec(lower); return match ? match.index : -1; };
  const at = (index: number, kind: SitePhrase["kind"], count: number) => { if (index >= 0) phrases.push({ index, kind, count }); };
  const fcc = first(/\b(?:fcc|ccp)\b|cubic close|face[ -]?cent(?:re|er)e?d cubic/);
  const bcc = first(/\bbcc\b|body[ -]?cent(?:re|er)e?d cubic/);
  const sc = first(/simple cubic|primitive cubic/);
  if (fcc >= 0) { at(fcc, "corner", 8); at(fcc, "face", 6); }
  else if (bcc >= 0) { at(bcc, "corner", 8); at(bcc, "body", 1); }
  else if (sc >= 0) at(sc, "corner", 8);
  else {
    at(first(/\bcorners?\b/), "corner", 8);
    at(first(/face[ -]?cent(?:re|er)s?|cent(?:re|er)s? of (?:the |each |all (?:the )?)?faces?|\bfaces\b/), "face", 6);
    at(first(/edge[ -]?cent(?:re|er)s?|cent(?:re|er)s? of (?:the |each |all (?:the )?)?edges?|\bedges\b/), "edge", 12);
    at(first(/body[ -]?cent(?:re|er)\b|cent(?:re|er) of (?:the )?(?:cube|unit cell|body)|\bbody\b(?! diagonal)/), "body", 1);
  }
  at(first(/\bhcp\b|hexagonal close/), "hcp", 6);
  for (const [kind, pattern] of [["oct", /octahedral (?:voids?|sites?|holes?|positions?)/g], ["tet_void", /tetrahedral (?:voids?|sites?|holes?|positions?)/g]] as const) {
    for (const match of lower.matchAll(pattern)) {
      const fraction = readFraction(lower.slice(0, match.index));
      phrases.push({ index: match.index ?? 0, kind, count: fraction === "unknown" ? Number.NaN : (fraction ?? 1) });
    }
  }
  return phrases.sort((a, b) => a.index - b.index);
}

/**
 * "A at corners, B at face centres": every site phrase belongs to the last
 * species named before it in the sentence, or to the species carried over
 * from the previous sentence when the sentence names none first.
 */
function readOccupancy(question: string): Occupant[] {
  const text = normalizeChemistryText(question).replace(/\n/g, " ");
  const hcp = /\bhcp\b|hexagonal close/i.test(text);
  const sentences = text.split(/(?<=[.;:?])\s+/);
  const occupants: Occupant[] = [];
  let carried: string | null = null;
  const occupantFor = (species: string): Occupant => {
    let occupant = occupants.find((candidate) => candidate.species === species);
    if (!occupant) { occupant = { species, sites: {} }; occupants.push(occupant); }
    return occupant;
  };
  for (const sentence of sentences) {
    if (/\b(?:removed|missing|absent|vacant|taken out|replace)/i.test(sentence)) continue;
    const species = speciesIn(sentence);
    const phrases = sitePhrases(sentence);
    if (phrases.length === 0) { if (species.length > 0) carried = species.at(-1)!.token; continue; }
    for (const phrase of phrases) {
      const before = species.filter((candidate) => candidate.index < phrase.index);
      const after = species.find((candidate) => candidate.index > phrase.index && candidate.index - phrase.index < 70);
      const bridge = after ? sentence.slice(phrase.index, after.index) : "";
      // "holes occupied by aluminium ions" names the occupant after the site;
      // "ccp array of oxygen atoms" names the lattice former after the lattice word.
      const owner = after && /\b(?:occupied|filled|taken)\s+(?:up\s+)?(?:by|with)\s+(?:the\s+)?$/i.test(bridge)
        ? after.token
        : before.length > 0
          ? before.at(-1)!.token
          : after && /\b(?:of|by)\s+(?:the\s+)?$/i.test(bridge)
            ? after.token
            : carried;
      if (!owner) continue;
      const occupant = occupantFor(owner);
      if (phrase.kind === "hcp") { occupant.hcp = true; continue; }
      if (Number.isNaN(phrase.count)) { occupant.unknownVoid = true; continue; }
      const add = (kind: SiteKind, count: number) => { occupant.sites[kind] = Math.min(SITE_TOTAL[kind], Math.max(occupant.sites[kind] ?? 0, count)); };
      if (phrase.kind === "oct") {
        if (hcp) occupant.hcpVoidAtoms = (occupant.hcpVoidAtoms ?? 0) + 6 * phrase.count;
        else { add("edge", 12 * phrase.count); add("body", phrase.count); }
      } else if (phrase.kind === "tet_void") {
        if (hcp) occupant.hcpVoidAtoms = (occupant.hcpVoidAtoms ?? 0) + 12 * phrase.count;
        else add("tet", 8 * phrase.count);
      } else add(phrase.kind, phrase.count);
    }
    if (species.length > 0) carried = species.at(-1)!.token;
  }
  return occupants.filter((occupant) => occupant.hcp || occupant.unknownVoid || occupant.hcpVoidAtoms !== undefined || Object.keys(occupant.sites).length > 0);
}

interface Removal { kind: SiteKind; count: number; positions: Triple[] }

/** Corners emptied first are the visible front ones, so a missing atom is seen. */
const REMOVAL_CORNER_ORDER: Triple[] = [[1, 0, 1], [0, 0, 1], [1, 0, 0], [0, 0, 0], [1, 1, 1], [0, 1, 1], [1, 1, 0], [0, 1, 0]];

const COUNT_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, "1": 1, "2": 2, "3": 3, "4": 4 };

/** Removed sites in a stoichiometry puzzle, with the positions left empty on the figure. */
function readRemovals(stem: string): Removal[] {
  const removals: Removal[] = [];
  const pattern = /(?:(one|two|three|four|1|2|3|4|all(?: the| of the)?|half(?: of the)?)\s+)?(?:(?:of the\s+)?(?:atoms?|ions?|[a-z]+ atoms?|[a-z]+ ions?)\s+)?(?:(?:present|lying|located|situated|placed)\s+)?(?:(?:at|on|from|along|in)\s+)?(?:the\s+|one\s+|a\s+|any\s+|one of the\s+|two of the\s+)?(corners?|face[ -]?cent(?:re|er)s?|body[ -]?cent(?:re|er)|edge[ -]?cent(?:re|er)s?|body diagonals?|face diagonals?|opposite faces|faces?|edges?)(?:\s+atoms?|\s+ions?)?\s+(?:(?:is|are|were|get|gets|being|be)\s+)?(?:removed|missing|absent|vacant|taken out)/g;
  for (const match of stem.matchAll(pattern)) {
    const countWord = match[1]?.trim();
    const site = match[2]!;
    const count = countWord ? (COUNT_WORDS[countWord] ?? (/^all/.test(countWord) ? Infinity : /^half/.test(countWord) ? 0.5 : 1)) : 1;
    const push = (kind: SiteKind, n: number, positions: Triple[]) => removals.push({ kind, count: n, positions });
    if (/body diagonal/.test(site)) { push("corner", 2, [[0, 0, 0], [1, 1, 1]]); push("body", 1, [BODY]); }
    else if (/face diagonal/.test(site)) { push("corner", 2, [[0, 0, 0], [1, 0, 1]]); push("face", 1, [[0.5, 0, 0.5]]); }
    else if (/opposite faces/.test(site)) push("face", 2, [[0.5, 0, 0.5], [0.5, 1, 0.5]]);
    else if (/^corner/.test(site)) {
      const n = count === Infinity ? 8 : count === 0.5 ? 4 : count;
      push("corner", n, REMOVAL_CORNER_ORDER.slice(0, n));
    } else if (/^face/.test(site)) {
      const n = count === Infinity ? 6 : count === 0.5 ? 3 : count;
      push("face", n, FACES.slice(0, n));
    } else if (/^body/.test(site)) push("body", 1, [BODY]);
    else if (/^edge/.test(site)) {
      const n = count === Infinity ? 12 : count === 0.5 ? 6 : count;
      push("edge", n, EDGES.slice(0, n));
    }
  }
  return removals;
}

interface Rational { num: number; den: number }

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

function rational(value: number): Rational {
  for (let den = 1; den <= 48; den += 1) {
    const num = value * den;
    if (Math.abs(num - Math.round(num)) < 1e-9) {
      const g = gcd(Math.round(num), den) || 1;
      return { num: Math.round(num) / g, den: den / g };
    }
  }
  return { num: Number(value.toFixed(2)), den: 1 };
}

const rationalText = (r: Rational): string => (r.den === 1 ? String(r.num) : `${r.num}/${r.den}`);

/** Whole-number formula from per-cell counts: A 7/8, B 3 gives A7B24. */
function formulaFrom(counts: Array<{ species: string; count: Rational }>): string {
  const lcm = counts.reduce((acc, item) => (acc * item.count.den) / gcd(acc, item.count.den), 1);
  const whole = counts.map((item) => ({ species: item.species, n: (item.count.num * lcm) / item.count.den }));
  const g = whole.reduce((acc, item) => gcd(acc, item.n), 0) || 1;
  return whole.map((item) => `${plainSpecies(item.species)}${item.n / g === 1 ? "" : item.n / g}`).join("");
}

/** The species as it reads in running text: a charge is dropped from a formula. */
function plainSpecies(species: string): string {
  return species.replace(/\^\(?[^)]*\)?/g, "");
}

/* ------------------------------------------------------------- build */

interface CellNumbers {
  edgePm: number | null;
  radiusPm: number | null;
  molarMass: number | null;
  densityGiven: number | null;
  avogadro: number;
}

function readNumbers(stem: string, quantities: readonly ChemPlanQuantity[]): CellNumbers {
  return {
    edgePm: planLengthPm(quantities, ["a", "edge", "edge_length", "edgeLength", "cell_edge", "cellEdge", "lattice_parameter"]) ?? readLengthPm(stem, EDGE_CUE),
    radiusPm: planLengthPm(quantities, ["r", "radius", "atomic_radius", "atomicRadius"]) ?? readLengthPm(stem, RADIUS_CUE),
    molarMass: planQuantity(quantities, ["M", "molar_mass", "molarMass", "atomic_mass", "atomicMass"]) ?? readMolarMass(stem),
    densityGiven: planQuantity(quantities, ["rho", "density", "ρ", "d"]) ?? readDensity(stem),
    avogadro: readAvogadro(stem) ?? AVOGADRO,
  };
}

function radiusFromEdge(lattice: Lattice, edgePm: number): number {
  if (lattice === "fcc") return (Math.SQRT2 * edgePm) / 4;
  if (lattice === "bcc") return (Math.sqrt(3) * edgePm) / 4;
  return edgePm / 2;
}

function edgeFromRadius(lattice: Lattice, radiusPm: number): number {
  if (lattice === "fcc") return (4 * radiusPm) / Math.SQRT2;
  if (lattice === "bcc") return (4 * radiusPm) / Math.sqrt(3);
  return 2 * radiusPm;
}

/** Lattices the stem names, in reading order, without repeats. */
function readLattices(stem: string): Lattice[] {
  const found: Array<{ lattice: Lattice; index: number }> = [];
  const patterns: Array<[RegExp, Lattice]> = [
    [/\b(?:fcc|ccp)\b|cubic close[ -]?pack|face[ -]?cent(?:re|er)(?:e?d)?(?: cubic)?/g, "fcc"],
    [/\bbcc\b|body[ -]?cent(?:re|er)(?:e?d)?(?: cubic)?/g, "bcc"],
    [/\bhcp\b|hexagonal close[ -]?pack/g, "hcp"],
    [/simple cubic|primitive cubic/g, "sc"],
  ];
  for (const [pattern, lattice] of patterns) {
    const match = pattern.exec(stem);
    if (match) found.push({ lattice, index: match.index });
  }
  return found.sort((a, b) => a.index - b.index).map((item) => item.lattice);
}

interface Slot { origin: Vec2; prefix: string; ids: string[] }

const WANTS_RELATION = /radius|radii|packing|nearest|neighbou?r|distance|relation|touch|contact|in terms of|diagonal/;
const WANTS_VOIDS = /octahedral (?:voids?|holes?|sites?)|tetrahedral (?:voids?|holes?|sites?)|\bvoids?\b|\bholes?\b|interstitial/;

function drawLatticeCell(c: ChemScene, slot: Slot, lattice: Exclude<Lattice, "hcp">, numbers: CellNumbers, stem: string, options: { voids: boolean; relation: boolean; label?: string; species?: string }): { caption: string; exact: boolean } {
  const facts = FACTS[lattice];
  const cube = drawCube(c, slot.prefix, slot.origin);
  slot.ids.push(...cube.ids);
  const spheres: Sphere[] = [];
  const role = options.species ? `${plainSpecies(options.species)} atom` : "lattice atom";
  const through: Triple[] = options.relation ? (lattice === "fcc" ? [[0.5, 0, 0.5]] : lattice === "bcc" ? [BODY] : []) : [];
  const labelAt = (kind: SiteKind, site: Triple, wanted: Triple): Pick<Sphere, "label" | "labelMode"> =>
    options.species && same(site, wanted) ? { label: options.species, labelMode: labelModeFor(kind, site, through) } : {};
  for (const corner of CORNERS) spheres.push({ at: corner, radius: options.species ? 0.16 : 0.12, role, ...labelAt("corner", corner, [0, 0, 1]) });
  if (lattice === "fcc") for (const face of FACES) spheres.push({ at: face, radius: options.species ? 0.16 : 0.12, role, ...labelAt("face", face, [0.5, 0, 0.5]) });
  if (lattice === "bcc") spheres.push({ at: BODY, radius: options.species ? 0.18 : 0.15, role: `${role} (body centre)`, ...labelAt("body", BODY, BODY) });
  slot.ids.push(...drawSpheres(c, slot.prefix, slot.origin, spheres));

  let edgePm = numbers.edgePm;
  let radiusPm = numbers.radiusPm;
  const captionBits: string[] = [];
  let computedRadius: number | null = null;
  let computedEdge: number | null = null;
  if (edgePm === null && radiusPm !== null) { computedEdge = edgeFromRadius(lattice, radiusPm); edgePm = computedEdge; }
  if (radiusPm === null && edgePm !== null && /radius|radii/.test(stem)) { computedRadius = radiusFromEdge(lattice, edgePm); radiusPm = computedRadius; }

  const dimensionText = computedEdge !== null ? "a" : edgeLabel(numbers.edgePm);
  slot.ids.push(drawEdgeDimension(c, slot.prefix, slot.origin, options.relation && lattice === "sc" && dimensionText === "a" ? "a = 2r" : dimensionText));

  let exact = false;
  if (options.relation && lattice === "fcc") {
    const id = drawDiagonal(c, `${slot.prefix}_diag`, project([0, 0, 0], slot.origin), project([1, 0, 1], slot.origin), "face diagonal", "√2a = 4r");
    slot.ids.push(id);
    c.scene.assert(`${slot.prefix}_face_diagonal_45`, "angle_between", [id, cube.frontBottom], { value: 45, unit: "degrees" });
    exact = true;
  } else if (options.relation && lattice === "bcc") {
    slot.ids.push(drawDiagonal(c, `${slot.prefix}_diag`, project([0, 0, 0], slot.origin), project([1, 1, 1], slot.origin), "body diagonal", "√3a = 4r"));
  }

  if (options.voids && lattice === "fcc") {
    slot.ids.push(drawVoidMark(c, `${slot.prefix}_oct1`, project(BODY, slot.origin), "octahedral void", "oct. void"));
    slot.ids.push(drawVoidMark(c, `${slot.prefix}_oct2`, project([1, 0, 0.5], slot.origin), "octahedral void"));
    slot.ids.push(drawVoidMark(c, `${slot.prefix}_tet1`, project([0.25, 0.25, 0.25], slot.origin), "tetrahedral void", "tet. void"));
  }

  if (options.label) slot.ids.push(c.text(`${slot.prefix}_name`, { x: slot.origin.x + 1.6, y: slot.origin.y + SCALE * (1 + DEPTH.y) + 0.45 }, options.label, "cell name"));

  captionBits.push(`${LATTICE_NAME[lattice]}: Z = ${facts.atomsPerCell}, CN = ${facts.coordinationNumber}, packing ${facts.packingEfficiency}%, ${facts.radiusRelation}`);
  if (options.voids && lattice === "fcc") captionBits.push(`${facts.voids.octahedral} oct. and ${facts.voids.tetrahedral} tet. voids per cell`);
  c.scene.quantity(`${slot.prefix}_Z`, "Z", facts.atomsPerCell);
  if (numbers.edgePm !== null) c.scene.quantity(`${slot.prefix}_a`, "a", numbers.edgePm, "pm");
  if (computedEdge !== null) { captionBits.push(`a = ${fmtPm(computedEdge)} pm`); c.scene.quantity(`${slot.prefix}_a`, "a", computedEdge, "pm"); }
  if (computedRadius !== null) { captionBits.push(`r = ${fmtPm(computedRadius)} pm`); c.scene.quantity(`${slot.prefix}_r`, "r", computedRadius, "pm"); }
  if (edgePm !== null && numbers.molarMass !== null && numbers.densityGiven === null) {
    const density = unitCellDensity({ z: facts.atomsPerCell, molarMass: numbers.molarMass, edgeLengthPm: edgePm, avogadro: numbers.avogadro });
    captionBits.push(`ρ = ${fmt(density, 3)} g/cm³`);
    c.scene.quantity(`${slot.prefix}_rho`, "ρ", density, "g/cm^3");
  }
  return { caption: captionBits.join("; "), exact };
}

/** hcp as three close-packed rows: A, B offset by half a sphere, A again; the layer letter sits in the first sphere of its row. */
function drawHcpLayers(c: ChemScene, slot: Slot, species?: string, label?: string): string {
  const rows: Array<{ y: number; dx: number; tag: string }> = [
    { y: 0, dx: 0, tag: "A" }, { y: Math.sqrt(3) / 2, dx: 0.5, tag: "B" }, { y: Math.sqrt(3), dx: 0, tag: "A" },
  ];
  rows.forEach((row, rowIndex) => {
    for (let i = 0; i < 4; i += 1) {
      const id = `${slot.prefix}_${row.tag}${rowIndex}_${i}`;
      const text = i === 0 ? row.tag : rowIndex === 0 && i === 1 && species ? species : undefined;
      slot.ids.push(drawSphere(c, id, { x: slot.origin.x + row.dx + i, y: slot.origin.y + row.y }, { at: [0, 0, 0], radius: 0.5, role: `${row.tag} layer sphere`, label: text }));
    }
  });
  if (label) slot.ids.push(c.text(`${slot.prefix}_name`, { x: slot.origin.x + 1.75, y: slot.origin.y + Math.sqrt(3) + 0.95 }, label, "cell name"));
  c.scene.quantity(`${slot.prefix}_Z`, "Z", 6);
  return `hcp${species ? ` ${plainSpecies(species)}` : ""}: ABAB layers, Z = 6, CN = 12, packing 74%, a = 2r`;
}

function drawIonicCell(c: ChemScene, slot: Slot, key: IonicKey, labels: { cation: string; anion: string }, numbers: CellNumbers, stem: string): string {
  const template = IONIC[key];
  const cube = drawCube(c, slot.prefix, slot.origin);
  slot.ids.push(...cube.ids);
  const spheres: Sphere[] = [];
  const relation = WANTS_RELATION.test(stem);
  const through: Triple[] = !relation ? [] : key === "cscl" ? [BODY] : key === "nacl" ? [] : [[0.25, 0.25, 0.25]];
  const place = (ion: string, sites: SiteKind[], radius: number, role: string) => {
    let labelled = 0;
    for (const kind of sites) {
      const positions = kind === "tet" ? TET.slice(0, template.tetCount) : SITES[kind];
      const showAt: Triple[] = kind === "corner" ? [[0, 0, 1]] : kind === "face" ? [[0.5, 0, 0.5]] : kind === "edge" ? [[0, 0, 0.5]] : kind === "body" ? [BODY] : [[0.25, 0.25, 0.25]];
      for (const at of positions) {
        const label = labelled < 2 && showAt.some((wanted) => same(wanted, at)) ? ion : undefined;
        if (label) labelled += 1;
        spheres.push({ at, radius, role, label, labelMode: label ? labelModeFor(kind, at, through) : undefined });
      }
    }
  };
  place(labels.anion, template.anionSites, template.anionRadius, `${plainSpecies(labels.anion)} anion`);
  place(labels.cation, template.cationSites, template.cationRadius, `${plainSpecies(labels.cation)} cation`);
  slot.ids.push(...drawSpheres(c, slot.prefix, slot.origin, spheres));
  slot.ids.push(drawEdgeDimension(c, slot.prefix, slot.origin, edgeLabel(numbers.edgePm)));
  if (relation) {
    if (key === "cscl") slot.ids.push(drawDiagonal(c, `${slot.prefix}_diag`, project([0, 0, 0], slot.origin), project([1, 1, 1], slot.origin), "body diagonal", template.relation));
    else if (key !== "nacl") slot.ids.push(drawDiagonal(c, `${slot.prefix}_diag`, project([0, 0, 0], slot.origin), project([0.5, 0.5, 0.5], slot.origin), "quarter body diagonal", template.relation));
  }
  c.scene.quantity(`${slot.prefix}_Z`, "Z", template.z);
  if (numbers.edgePm !== null) c.scene.quantity(`${slot.prefix}_a`, "a", numbers.edgePm, "pm");
  const name = labels.cation === template.cation ? template.name : `${plainSpecies(labels.cation)}${plainSpecies(labels.anion)} (${template.typeName} type)`;
  const sitesText = template.sites.replace("{cation}", plainSpecies(labels.cation)).replace("{anion}", plainSpecies(labels.anion));
  const bits = [`${name}: ${sitesText}`, `Z = ${template.z}, CN ${template.cn}, ${template.relation}`];
  if (numbers.edgePm !== null && numbers.molarMass !== null && numbers.densityGiven === null) {
    const density = unitCellDensity({ z: template.z, molarMass: numbers.molarMass, edgeLengthPm: numbers.edgePm, avogadro: numbers.avogadro });
    bits.push(`ρ = ${fmt(density, 3)} g/cm³`);
    c.scene.quantity(`${slot.prefix}_rho`, "ρ", density, "g/cm^3");
  }
  return bits.join("; ");
}

function drawOccupancyCell(c: ChemScene, slot: Slot, occupants: Occupant[], removals: Removal[], numbers: CellNumbers): string | null {
  const cube = drawCube(c, slot.prefix, slot.origin);
  slot.ids.push(...cube.ids);
  const spheres: Sphere[] = [];
  const removedAt: Array<{ at: Triple; radius: number }> = [];
  const counts: Array<{ species: string; count: Rational; working: string }> = [];
  const voidMarkers: Triple[] = [];
  occupants.forEach((occupant, index) => {
    const radius = index === 0 ? 0.16 : 0.12;
    const role = `${plainSpecies(occupant.species)} ${/\^/.test(occupant.species) || /cation|anion/.test(occupant.species) ? "ion" : "atom"}`;
    const label = /^(?:cation|anion)$/.test(occupant.species) ? undefined : occupant.species;
    const working: string[] = [];
    let total = 0;
    let labelled = 0;
    for (const [kind, occupied] of Object.entries(occupant.sites) as Array<[SiteKind, number]>) {
      const removed = removals.filter((removal) => removal.kind === kind && occupant.sites[kind]);
      const removedCount = removed.reduce((sum, removal) => sum + removal.count, 0);
      const remaining = Math.max(0, occupied - removedCount);
      total += remaining * SITE_SHARE[kind];
      const shareText = SITE_SHARE[kind] === 1 ? "" : ` × ${rationalText(rational(SITE_SHARE[kind]))}`;
      working.push(`${rationalText(rational(remaining))}${shareText}`);
      const positions = SITES[kind];
      const wholeSites = Number.isInteger(occupied) ? occupied : null;
      if (wholeSites === null) { voidMarkers.push(...positions); continue; }
      const removedPositions = removed.flatMap((removal) => removal.positions);
      const showAt: Triple[] = kind === "corner" ? [[0, 0, 1]] : kind === "face" ? [[0.5, 0, 0.5]] : kind === "edge" ? [[0, 0, 0.5]] : kind === "body" ? [BODY] : [[0.25, 0.25, 0.25]];
      for (const at of positions.slice(0, wholeSites)) {
        if (removedPositions.some((gone) => same(gone, at))) { removedAt.push({ at, radius }); continue; }
        const text = label && labelled < 2 && showAt.some((wanted) => same(wanted, at)) ? label : undefined;
        if (text) labelled += 1;
        spheres.push({ at, radius: text ? Math.max(radius, 0.16) : radius, role, label: text, labelMode: text ? labelModeFor(kind, at, []) : undefined });
      }
    }
    counts.push({ species: occupant.species, count: rational(total), working: working.join(" + ") });
  });
  if (counts.length === 0) return null;
  slot.ids.push(...drawSpheres(c, slot.prefix, slot.origin, spheres));
  removedAt.forEach((gone, index) => slot.ids.push(drawVacancy(c, `${slot.prefix}_gone${index + 1}`, project(gone.at, slot.origin), gone.radius)));
  voidMarkers.forEach((at, index) => slot.ids.push(drawVoidMark(c, `${slot.prefix}_void${index + 1}`, project(at, slot.origin), "void site")));
  slot.ids.push(drawEdgeDimension(c, slot.prefix, slot.origin, edgeLabel(numbers.edgePm)));
  const perSpecies = counts.map((item) => `${plainSpecies(item.species)}: ${item.working} = ${rationalText(item.count)}`).join(", ");
  const formula = counts.length > 1 ? ` → ${formulaFrom(counts)}` : ` atom${counts[0]!.count.num === 1 && counts[0]!.count.den === 1 ? "" : "s"} per cell`;
  counts.forEach((item, index) => c.scene.quantity(`${slot.prefix}_n${index + 1}`, `n(${plainSpecies(item.species)})`, item.count.num / item.count.den));
  return `${perSpecies}${formula}`;
}

/**
 * The figure, or null when the stem grounds no lattice. `schematic` changes
 * nothing here: a cell is always qualitative unless a number is read.
 */
export function buildUnitCellScene(question: string, quantities: ChemPlanQuantity[], schematic: boolean): SceneDocument | null {
  void schematic;
  if (!isUnitCellStem(question)) return null;
  const stem = chemStem(question);
  const numbers = readNumbers(stem, quantities);
  const c = new ChemScene(question, "unit cell of the named lattice", SOLID_FAMILY);
  const captions: string[] = [];
  const slots: Slot[] = [];
  const newSlot = (prefix: string, width: number): Slot => {
    const x = slots.reduce((acc, slot) => Math.max(acc, slot.origin.x), -Infinity);
    const origin = { x: slots.length === 0 ? 0 : x + width + SLOT_GAP, y: 0 };
    const slot = { origin, prefix, ids: [] };
    slots.push(slot);
    return slot;
  };

  const ionic = readIonicTemplate(stem);
  if (ionic) {
    const template = IONIC[ionic];
    const generic = genericIonPair(question);
    const labels = generic ?? { cation: template.cation, anion: template.anion };
    const slot = newSlot("cell", CELL_WIDTH);
    captions.push(drawIonicCell(c, slot, ionic, labels, numbers, stem));
  } else {
    const occupants = readOccupancy(question);
    const removals = readRemovals(stem);
    const hcpOccupant = occupants.find((occupant) => occupant.hcp);
    const cubicOccupants = occupants.filter((occupant) => !occupant.hcp && Object.keys(occupant.sites).length > 0);
    const lattices = readLattices(stem);
    if (hcpOccupant && cubicOccupants.length === 0) {
      const slot = newSlot("hcp", 4.5);
      const others = occupants.filter((occupant) => occupant !== hcpOccupant && !occupant.unknownVoid && occupant.hcpVoidAtoms !== undefined);
      const captionParts = [drawHcpLayers(c, slot, hcpOccupant.species)];
      if (others.length > 0) {
        const counts = [{ species: hcpOccupant.species, count: rational(6), working: "6" }, ...others.map((occupant) => ({ species: occupant.species, count: rational(occupant.hcpVoidAtoms!), working: rationalText(rational(occupant.hcpVoidAtoms!)) }))];
        captionParts.push(`${counts.map((item) => `${plainSpecies(item.species)}: ${item.working}`).join(", ")} → ${formulaFrom(counts)}`);
      }
      captions.push(captionParts.join("; "));
    } else if (cubicOccupants.length > 0 && (cubicOccupants.length > 1 || removals.length > 0 || lattices.length === 0 || cubicOccupants.some((occupant) => occupant.sites.tet !== undefined || (occupant.sites.edge !== undefined && occupant.sites.body !== undefined)))) {
      const slot = newSlot("cell", CELL_WIDTH);
      const caption = drawOccupancyCell(c, slot, cubicOccupants, removals, numbers);
      if (!caption) return null;
      captions.push(caption);
    } else if (lattices.length > 0) {
      const relation = WANTS_RELATION.test(stem) || numbers.radiusPm !== null;
      const voids = WANTS_VOIDS.test(stem);
      const species = cubicOccupants[0]?.species;
      for (const lattice of lattices.slice(0, 3)) {
        const label = lattices.length > 1 ? LATTICE_SHORT[lattice] : undefined;
        if (lattice === "hcp") {
          const slot = newSlot(`hcp${slots.length + 1}`, 4.5);
          captions.push(drawHcpLayers(c, slot, undefined, label));
          continue;
        }
        const slot = newSlot(`cell${slots.length + 1}`, CELL_WIDTH);
        const drawn = drawLatticeCell(c, slot, lattice, numbers, stem, { voids, relation, label, species: lattices.length === 1 ? species : undefined });
        captions.push(drawn.caption);
      }
    } else {
      return null;
    }
  }
  if (slots.length === 0) return null;
  for (const slot of slots) c.scene.group(slot.prefix, slot.ids, `${slot.prefix} unit cell`);
  return c.build({ caption: captions.join(". ") });
}

/* ------------------------------------------------------------- probes */

export const SOLID_PROBES: ReadonlyArray<{
  question: string;
  expect: "draw" | "decline";
  labels?: string[];
  forbidLabels?: string[];
  note?: string;
}> = [
  { question: "An element crystallises in a face centred cubic (fcc) lattice. Find the number of atoms per unit cell, the coordination number and the packing efficiency.", expect: "draw", labels: ["a", "√2a = 4r"], note: "fcc facts; the face diagonal carries the r to a relation because the stem asks about packing" },
  { question: "A metal crystallises in a body centred cubic (bcc) structure. What is the relation between the edge length a and the atomic radius r?", expect: "draw", labels: ["a", "√3a = 4r"], note: "bcc body diagonal" },
  { question: "Polonium crystallises in a simple cubic unit cell. How many atoms are there per unit cell and what is the coordination number?", expect: "draw", labels: ["a"], forbidLabels: ["√2a = 4r", "√3a = 4r"], note: "sc: 8 corners only" },
  { question: "Describe the structure of NaCl (rock salt). What are the coordination numbers of Na+ and Cl- and the number of formula units per unit cell?", expect: "draw", labels: ["Na^+", "Cl^-", "a"], note: "Cl ccp, Na in all octahedral voids" },
  { question: "In the CsCl unit cell, Cl- ions are at the corners and Cs+ at the body centre. What is the coordination number of each ion and the relation between the edge length a and the ionic radii?", expect: "draw", labels: ["Cs^+", "Cl^-"], note: "CsCl: sc anions, cation at the body centre, body diagonal relation" },
  { question: "Zinc blende (ZnS) has S2- ions in ccp and Zn2+ ions in alternate tetrahedral voids. Find the coordination number of Zn2+ and the number of formula units per unit cell.", expect: "draw", labels: ["Zn^(2+)", "S^(2-)"], note: "four alternate tetrahedral sites" },
  { question: "In fluorite (CaF2) structure, Ca2+ ions form a ccp lattice and F- ions occupy all the tetrahedral voids. What are the coordination numbers of Ca2+ and F-?", expect: "draw", labels: ["Ca^(2+)", "F^-"], note: "all eight tetrahedral sites" },
  { question: "An element crystallises in fcc with edge length 400 pm and atomic mass 60 g/mol. Find the density of the element.", expect: "draw", labels: ["a = 400 pm"], note: "ρ = 4 × 60 / ((4e-8)³ × 6.022e23) = 6.23 g/cm³" },
  { question: "A metal crystallises in bcc with a = 288 pm. Calculate the atomic radius of the metal.", expect: "draw", labels: ["a = 288 pm", "√3a = 4r"], note: "r = √3 × 288 / 4 = 124.7 pm" },
  { question: "In a cubic close packed (ccp) structure, locate the octahedral and tetrahedral voids. How many of each are present per unit cell?", expect: "draw", labels: ["oct. void", "tet. void"], note: "voids marked at the body centre, an edge centre and (1/4,1/4,1/4)" },
  { question: "A compound is formed by A atoms at the corners of the cube and B atoms at the face centres. If one corner atom is removed, what is the formula of the compound?", expect: "draw", labels: ["A", "B"], note: "A: 7 × 1/8 = 7/8, B: 6 × 1/2 = 3, so A7B24; the empty corner is marked" },
  { question: "Magnesium crystallises in a hexagonal close packed (hcp) lattice. How many atoms are there per unit cell and what is the coordination number?", expect: "draw", labels: ["A", "B"], note: "ABAB layer sketch instead of a hexagonal prism" },
  { question: "Which point defect lowers the density of a crystal: Schottky defect or Frenkel defect? Explain with an example.", expect: "decline", note: "defect stem with no lattice" },
  { question: "A cubical block of side 2 m and density 500 kg/m3 floats in water. Find the fraction of the block submerged.", expect: "decline", note: "physics block, not a unit cell" },
];
