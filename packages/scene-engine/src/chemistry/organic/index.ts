/**
 * Organic structures for the verified diagram engine.
 *
 * JEE Main organic stems name compounds in words and the OCR'd papers lose
 * the structure images. This family draws the skeletal structure of every
 * compound the stem names (up to six, each its own reveal group), the
 * constitutional isomers of a small formula the stem asks about, and for a
 * reaction stem "reactant -> product" with the reagent over the arrow. It
 * never computes a product: when only the reactant and reagent are named,
 * the product slot is a box with "?" for the tutor to fill while speaking.
 */
import type { SceneDocument } from "../../types";
import { ChemScene, chemStem, type ChemPlanQuantity } from "../sceneKit";
import { complexTokens, formulaTokens, normalizeChemistryText } from "../formula";
import { moleculeFromName, normalizeName } from "./names";
import { layoutBounds, layoutMolecule, type LaidOutMolecule, type Vec2 } from "./layout";
import { estimatePxPerUnit, renderMolecule, structureCaption } from "./render";
import { organicFacts } from "./facts";
import { heavyAtomCount, parseSmiles, type Molecule } from "./smiles";

export const ORGANIC_FAMILY = "chem_organic" as const;

export { moleculeFromName } from "./names";
export { organicFacts } from "./facts";

const MAX_HEAVY_ATOMS = 24;
const MAX_MOLECULES = 6;

/* ------------------------------------------------------------------------- */
/* Finding names in a stem                                                   */
/* ------------------------------------------------------------------------- */

interface Mention {
  readonly molecule: Molecule;
  readonly key: string;
  readonly text: string;
  /** Character offset in the scanned text. */
  readonly start: number;
  readonly end: number;
  /** True when the hit was a condensed formula alias (CH3CHO), not a word name. */
  readonly weak: boolean;
}

const TOKEN_SPLIT = /\s+/;
const TRIM_LEAD = /^[("'[]+/;
const TRIM_TAIL = /[.,;:?!)"'\]]+$/;
const SENTENCE_END = /[.;:?!]$/;
/** A name followed by one of these is a named test or reaction, not a compound in the question. */
const NAMED_PROCESS = /^(?:test|tests|reagent|reagents|reaction|reactions|rearrangement|synthesis|condensation|coupling|ring|rings|nucleus)$/i;
/** Solvents named in passing; they never carry the cue on their own. */
const SOLVENT = /^(?:dmf|thf|dioxane|1,4-dioxane|tetrahydrofuran|dimethylformamide|n,n-dimethylformamide|dichloromethane|ccl4|chcl3)$/i;

/** Every compound name in the stem, longest span first, in order of appearance. */
export function findMentions(text: string): Mention[] {
  const raw = text.split(TOKEN_SPLIT).filter(Boolean);
  const tokens: Array<{ text: string; start: number; end: number; breaks: boolean }> = [];
  let cursor = 0;
  for (const piece of raw) {
    const start = text.indexOf(piece, cursor);
    cursor = start + piece.length;
    const trimmed = piece.replace(TRIM_LEAD, "").replace(TRIM_TAIL, "");
    tokens.push({ text: trimmed, start, end: cursor, breaks: SENTENCE_END.test(piece) });
  }
  const mentions: Mention[] = [];
  let i = 0;
  while (i < tokens.length) {
    let found: Mention | null = null;
    let used = 1;
    for (let span = Math.min(4, tokens.length - i); span >= 1; span -= 1) {
      const slice = tokens.slice(i, i + span);
      if (slice.slice(0, -1).some((token) => token.breaks)) continue;
      if (slice.some((token) => token.text.length === 0)) continue;
      let candidate = slice.map((token) => token.text).join(" ");
      if (!/[a-z]/i.test(candidate)) continue;
      // OCR splits a systematic name at its substituent prefix: "2,4-dimethyl
      // pentane". Read it whole, and never take the bare parent on its own,
      // which drew pentane for 2,4-dimethylpentane.
      if (span > 1 && /(?:yl|-)$/i.test(slice[0]!.text) && !moleculeFromName(candidate)) {
        candidate = slice.map((token) => token.text).join("");
      }
      if (span === 1 && i > 0 && !tokens[i - 1]!.breaks && /(?:yl|-|\d-[a-z]+o)$/i.test(tokens[i - 1]!.text)) continue;
      // A formula split across tokens ("CH3 OH", "(CH3 CO),0") is OCR debris
      // from a drawn structure; a student writes CH3OH as one token.
      if (span > 1 && !/[a-z]{3,}/.test(candidate)) continue;
      if (span === 1 && candidate.length < 3) continue;
      const molecule = moleculeFromName(candidate);
      if (!molecule) continue;
      if (heavyAtomCount(molecule) > MAX_HEAVY_ATOMS) continue;
      const following = tokens[i + span];
      if (following && NAMED_PROCESS.test(following.text) && !slice[slice.length - 1]!.breaks) continue;
      const weak = SOLVENT.test(candidate) || (/\d/.test(candidate) && !/[a-z]{4,}/i.test(candidate.replace(/[^a-z]/gi, "").replace(/^(ch|c\d|h\d)+$/i, "")));
      found = { molecule, key: molecule.name ?? normalizeName(candidate), text: candidate, start: slice[0]!.start, end: slice[slice.length - 1]!.end, weak };
      used = span;
      break;
    }
    if (found) mentions.push(found);
    i += used;
  }
  return mentions;
}

function distinctMentions(mentions: Mention[]): Mention[] {
  const seen = new Set<string>();
  const out: Mention[] = [];
  for (const mention of mentions) {
    if (seen.has(mention.key)) continue;
    seen.add(mention.key);
    out.push(mention);
  }
  return out;
}

/* ------------------------------------------------------------------------- */
/* Reagents                                                                  */
/* ------------------------------------------------------------------------- */

const REAGENTS: ReadonlyArray<[RegExp, string]> = [
  [/conc(?:entrated|\.)?\s*h2so4|concentrated sulph?uric acid/, "conc. H_2SO_4"],
  [/dil(?:ute|\.)?\s*h2so4|dilute sulph?uric acid/, "dil. H_2SO_4"],
  [/hno3\s*(?:\/|\+|and|,)\s*(?:conc\.?\s*)?h2so4|nitrating mixture|conc(?:entrated|\.)?\s*hno3|concentrated nitric acid/, "HNO_3/H_2SO_4"],
  [/dil(?:ute|\.)?\s*(?:hno3|nitric acid)/, "dil. HNO_3"],
  [/\bhbr\b.{0,40}(?:peroxide|roor|\(c6h5co\)2o2|benzoyl peroxide)|(?:peroxide|\(c6h5co\)2o2).{0,40}\bhbr\b/, "HBr/ROOR"],
  [/carbon monoxide.{0,20}hydrogen chloride|\bco\s*(?:\/|\+|and)\s*hcl|gattermann/, "CO/HCl, AlCl_3"],
  [/alc(?:oholic|\.)?\s*koh|ethanolic koh/, "alc. KOH"],
  [/aq(?:ueous|\.)?\s*koh/, "aq. KOH"],
  [/aq(?:ueous|\.)?\s*naoh/, "aq. NaOH"],
  [/naoh\s*\/\s*cao|soda ?lime/, "NaOH/CaO, Δ"],
  [/br2\s*(?:\/|in)\s*ccl4|bromine in ccl4/, "Br_2/CCl_4"],
  [/br2\s*(?:\/|in)\s*(?:h2o|water)|bromine water/, "Br_2/H_2O"],
  [/br2\s*\/\s*febr3|br2\s*(?:in presence of|with)\s*febr3/, "Br_2/FeBr_3"],
  [/cl2\s*\/\s*(?:hv|hν|light|uv)|cl2\s*in\s*(?:presence of\s*)?(?:sunlight|light|uv)/, "Cl_2/hν"],
  [/cl2\s*\/\s*(?:fecl3|alcl3)/, "Cl_2/FeCl_3"],
  [/hbr\s*(?:\/|in presence of|with)\s*(?:peroxide|roor|h2o2)/, "HBr/ROOR"],
  [/alkaline kmno4|kmno4\s*\/\s*(?:koh|naoh|oh)|cold dilute kmno4|baeyer/, "KMnO_4/KOH"],
  [/acidic kmno4|kmno4\s*\/\s*h(?:\^?\(?\+\)?|2so4)|hot kmno4/, "KMnO_4/H^(+)"],
  [/k2cr2o7\s*\/?\s*h2so4|acidified k2cr2o7|acidic k2cr2o7/, "K_2Cr_2O_7/H^(+)"],
  [/jones reagent|cro3\s*\/\s*h2so4/, "CrO_3/H_2SO_4"],
  [/\bpcc\b|pyridinium chlorochromate/, "PCC"],
  [/tollens?/, "Tollens reagent"],
  [/fehling/, "Fehling soln"],
  [/h2\s*(?:\/|,)\s*(?:pd|pt|ni)|h2\s*in presence of\s*(?:pd|pt|ni|raney)|catalytic hydrogenation/, "H_2/Pd"],
  [/lindlar/, "H_2/Lindlar"],
  [/na\s*(?:\/|in)\s*liq(?:uid|\.)?\s*nh3/, "Na/liq. NH_3"],
  [/nabh4/, "NaBH_4"],
  [/lialh4/, "LiAlH_4"],
  [/zn\s*(?:\/|-)\s*hg\s*(?:\/|,|and)?\s*(?:conc\.?\s*)?hcl|clemmensen/, "Zn/Hg, HCl"],
  [/nh2nh2\s*\/?\s*koh|n2h4\s*\/?\s*koh|wolff|hydrazine/, "N_2H_4/KOH"],
  [/sn\s*\/\s*hcl|sn and hcl/, "Sn/HCl"],
  [/fe\s*\/\s*hcl|fe and hcl/, "Fe/HCl"],
  [/socl2|thionyl chloride/, "SOCl_2"],
  [/pcl5/, "PCl_5"],
  [/pcl3/, "PCl_3"],
  [/pbr3/, "PBr_3"],
  [/nano2\s*(?:\/|\+|and|,)?\s*hcl|nitrous acid|hno2/, "NaNO_2/HCl"],
  [/ch3cocl\s*\/?\s*alcl3|acetyl chloride.{0,20}alcl3|friedel.?crafts? acylation/, "CH_3COCl/AlCl_3"],
  [/ch3cl\s*\/?\s*alcl3|friedel.?crafts? alkylation/, "CH_3Cl/AlCl_3"],
  [/anhydrous alcl3|alcl3/, "AlCl_3"],
  [/o3\s*(?:\/|,|followed by|then)\s*zn|ozonolysis|reductive ozonolysis/, "O_3/Zn, H_2O"],
  [/na\s*(?:\/|in)\s*(?:dry\s*)?ether|wurtz/, "Na/dry ether"],
  [/mg\s*(?:\/|in)\s*(?:dry\s*)?ether/, "Mg/dry ether"],
  [/nanh2|sodamide/, "NaNH_2"],
  [/chcl3\s*(?:\/|\+|and|,)\s*(?:alc\.?\s*)?koh|carbylamine/, "CHCl_3/KOH"],
  [/chcl3\s*(?:\/|\+|and|,)\s*naoh|reimer.?tiemann/, "CHCl_3/NaOH"],
  [/co2\s*(?:\/|,|and)?\s*naoh|kolbe/, "CO_2/NaOH"],
  [/ch3mgbr|methyl ?magnesium bromide/, "CH_3MgBr"],
  [/i2\s*(?:\/|\+|and|,)\s*naoh|naoi|iodoform/, "I_2/NaOH"],
  [/hgso4\s*\/?\s*h2so4|hg\^?\(?2\+\)?\s*\/\s*h2so4/, "HgSO_4/H_2SO_4"],
  [/b2h6|bh3.{0,10}(?:thf|h2o2)|hydroboration/, "B_2H_6; H_2O_2"],
  [/cu\s*(?:\/|,|at)\s*573\s*k|cu\s*\/\s*300\s*(?:°|deg)?\s*c/, "Cu, 573 K"],
  [/al2o3\s*(?:\/|,|at)?\s*\d*\s*k?/, "Al_2O_3, Δ"],
  [/zncl2\s*(?:\/|\+|and|,)?\s*(?:conc\.?\s*)?hcl|lucas/, "ZnCl_2/HCl"],
  [/cucl\s*\/?\s*hcl|cu2cl2\s*\/?\s*hcl|sandmeyer/, "CuCl/HCl"],
  [/cubr\s*\/?\s*hbr/, "CuBr/HBr"],
  [/cucn\s*\/?\s*kcn/, "CuCN/KCN"],
  [/h3po2|hypophosphorous/, "H_3PO_2"],
  [/hbf4/, "HBF_4"],
  [/zn dust/, "Zn dust, Δ"],
  [/red p\s*(?:\/|\+|and|,)\s*hi|hi\s*\/\s*red p/, "red P/HI"],
  [/\bhbr\b/, "HBr"],
  [/\bhcl\b/, "HCl"],
  [/\bhi\b/, "HI"],
  [/h3o\^?\(?\+\)?|h2o\s*\/\s*h\^?\(?\+\)?|dil(?:ute|\.)?\s*acid/, "H_3O^(+)"],
  [/\bkmno4\b/, "KMnO_4"],
  [/\bk2cr2o7\b/, "K_2Cr_2O_7"],
  [/\bcro3\b/, "CrO_3"],
  [/\bbr2\b|bromine/, "Br_2"],
  [/\bcl2\b|chlorine/, "Cl_2"],
  [/\bkoh\b/, "KOH"],
  [/\bnaoh\b/, "NaOH"],
  [/\bnh3\b|ammonia/, "NH_3"],
  [/\bkcn\b/, "KCN"],
  [/\bnacn\b/, "NaCN"],
  [/\bagcn\b/, "AgCN"],
  [/\bh2\b|hydrogen gas/, "H_2"],
  [/\bh2o\b|water/, "H_2O"],
  [/\bheat\b|\bheated\b|\bheating\b|\bΔ\b|\bdelta\b/, "Δ"],
  [/\bhv\b|\bhν\b|sunlight|uv light/, "hν"],
];

/** Reagent label read from a reagent phrase; up to two joined when they fit in 16 characters. */
/** OCR writes subscripts as commas: "H,SO," is H2SO4, "KMnO," is KMnO4. */
function repairReagentOcr(phrase: string): string {
  return phrase
    .replace(/\bh[,;]so[,;]/g, "h2so4")
    .replace(/\bkmno[,;]/g, "kmno4")
    .replace(/\bnano[,;]/g, "nano2")
    .replace(/\bhno[,;]/g, "hno3")
    .replace(/\bnabh[,;]/g, "nabh4")
    .replace(/\blialh[,;]/g, "lialh4")
    .replace(/\bsocl[,;]/g, "socl2")
    .replace(/\balcl[,;]/g, "alcl3")
    .replace(/\bccl[,;]/g, "ccl4")
    .replace(/\bbr[,;](?=\s|\/|$)/g, "br2")
    .replace(/\bcl[,;](?=\s|\/|$)/g, "cl2")
    .replace(/\bnh[,;](?=\s|\/|$)/g, "nh3");
}

function readReagent(rawPhrase: string): string | null {
  const phrase = repairReagentOcr(rawPhrase);
  const hits: Array<{ label: string; at: number }> = [];
  const claimed: Array<[number, number]> = [];
  for (const [pattern, label] of REAGENTS) {
    const match = pattern.exec(phrase);
    if (!match) continue;
    const span: [number, number] = [match.index, match.index + match[0].length];
    if (claimed.some(([start, end]) => span[0] < end && span[1] > start)) continue;
    claimed.push(span);
    if (!hits.some((hit) => hit.label === label)) hits.push({ label, at: match.index });
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.at - b.at);
  const first = hits[0]!.label;
  if (hits.length > 1) {
    const joined = `${first}, ${hits[1]!.label}`;
    if (joined.length <= 16) return joined;
  }
  return first.slice(0, 16);
}

/* ------------------------------------------------------------------------- */
/* Isomers                                                                   */
/* ------------------------------------------------------------------------- */

interface IsomerEntry { readonly name: string; readonly smiles: string; readonly kind: "alkane" | "alkene" | "cycloalkane" | "alcohol" | "ether" | "carbonyl" | "haloalkane" | "aromatic"; readonly geometric?: boolean }

const ISOMERS: Record<string, readonly IsomerEntry[]> = {
  c4h10: [{ name: "butane", smiles: "CCCC", kind: "alkane" }, { name: "2-methylpropane", smiles: "CC(C)C", kind: "alkane" }],
  c5h12: [{ name: "pentane", smiles: "CCCCC", kind: "alkane" }, { name: "2-methylbutane", smiles: "CC(C)CC", kind: "alkane" }, { name: "2,2-dimethylpropane", smiles: "CC(C)(C)C", kind: "alkane" }],
  c6h14: [
    { name: "hexane", smiles: "CCCCCC", kind: "alkane" }, { name: "2-methylpentane", smiles: "CC(C)CCC", kind: "alkane" }, { name: "3-methylpentane", smiles: "CCC(C)CC", kind: "alkane" },
    { name: "2,2-dimethylbutane", smiles: "CC(C)(C)CC", kind: "alkane" }, { name: "2,3-dimethylbutane", smiles: "CC(C)C(C)C", kind: "alkane" },
  ],
  c3h6: [{ name: "propene", smiles: "C=CC", kind: "alkene" }, { name: "cyclopropane", smiles: "C1CC1", kind: "cycloalkane" }],
  c4h8: [
    { name: "but-1-ene", smiles: "C=CCC", kind: "alkene" }, { name: "but-2-ene", smiles: "CC=CC", kind: "alkene" },
    { name: "cis-but-2-ene", smiles: "C/C=C\\C", kind: "alkene", geometric: true }, { name: "trans-but-2-ene", smiles: "C/C=C/C", kind: "alkene", geometric: true },
    { name: "2-methylpropene", smiles: "C=C(C)C", kind: "alkene" },
    { name: "cyclobutane", smiles: "C1CCC1", kind: "cycloalkane" }, { name: "methylcyclopropane", smiles: "CC1CC1", kind: "cycloalkane" },
  ],
  c5h10: [
    { name: "pent-1-ene", smiles: "C=CCCC", kind: "alkene" }, { name: "pent-2-ene", smiles: "CC=CCC", kind: "alkene" },
    { name: "cis-pent-2-ene", smiles: "C/C=C\\CC", kind: "alkene", geometric: true }, { name: "trans-pent-2-ene", smiles: "C/C=C/CC", kind: "alkene", geometric: true },
    { name: "2-methylbut-1-ene", smiles: "C=C(C)CC", kind: "alkene" }, { name: "3-methylbut-1-ene", smiles: "C=CC(C)C", kind: "alkene" }, { name: "2-methylbut-2-ene", smiles: "CC=C(C)C", kind: "alkene" },
    { name: "cyclopentane", smiles: "C1CCCC1", kind: "cycloalkane" }, { name: "methylcyclobutane", smiles: "CC1CCC1", kind: "cycloalkane" },
  ],
  c2h6o: [{ name: "ethanol", smiles: "CCO", kind: "alcohol" }, { name: "dimethyl ether", smiles: "COC", kind: "ether" }],
  c3h8o: [{ name: "propan-1-ol", smiles: "CCCO", kind: "alcohol" }, { name: "propan-2-ol", smiles: "CC(C)O", kind: "alcohol" }, { name: "methoxyethane", smiles: "COCC", kind: "ether" }],
  c4h10o: [
    { name: "butan-1-ol", smiles: "CCCCO", kind: "alcohol" }, { name: "butan-2-ol", smiles: "CCC(C)O", kind: "alcohol" },
    { name: "2-methylpropan-1-ol", smiles: "CC(C)CO", kind: "alcohol" }, { name: "2-methylpropan-2-ol", smiles: "CC(C)(C)O", kind: "alcohol" },
    { name: "ethoxyethane", smiles: "CCOCC", kind: "ether" }, { name: "1-methoxypropane", smiles: "COCCC", kind: "ether" }, { name: "2-methoxypropane", smiles: "COC(C)C", kind: "ether" },
  ],
  c3h6o: [{ name: "propanal", smiles: "CCC=O", kind: "carbonyl" }, { name: "propanone", smiles: "CC(C)=O", kind: "carbonyl" }],
  c4h8o: [{ name: "butanal", smiles: "CCCC=O", kind: "carbonyl" }, { name: "2-methylpropanal", smiles: "CC(C)C=O", kind: "carbonyl" }, { name: "butanone", smiles: "CCC(C)=O", kind: "carbonyl" }],
  c3h7cl: [{ name: "1-chloropropane", smiles: "CCCCl", kind: "haloalkane" }, { name: "2-chloropropane", smiles: "CC(C)Cl", kind: "haloalkane" }],
  c4h9cl: [
    { name: "1-chlorobutane", smiles: "CCCCCl", kind: "haloalkane" }, { name: "2-chlorobutane", smiles: "CCC(C)Cl", kind: "haloalkane" },
    { name: "1-chloro-2-methylpropane", smiles: "CC(C)CCl", kind: "haloalkane" }, { name: "2-chloro-2-methylpropane", smiles: "CC(C)(C)Cl", kind: "haloalkane" },
  ],
  c4h9br: [
    { name: "1-bromobutane", smiles: "CCCCBr", kind: "haloalkane" }, { name: "2-bromobutane", smiles: "CCC(C)Br", kind: "haloalkane" },
    { name: "1-bromo-2-methylpropane", smiles: "CC(C)CBr", kind: "haloalkane" }, { name: "2-bromo-2-methylpropane", smiles: "CC(C)(C)Br", kind: "haloalkane" },
  ],
  c8h10: [{ name: "ethylbenzene", smiles: "CCc1ccccc1", kind: "aromatic" }, { name: "o-xylene", smiles: "Cc1ccccc1C", kind: "aromatic" }, { name: "m-xylene", smiles: "Cc1cccc(C)c1", kind: "aromatic" }, { name: "p-xylene", smiles: "Cc1ccc(C)cc1", kind: "aromatic" }],
  c7h8o: [
    { name: "benzyl alcohol", smiles: "OCc1ccccc1", kind: "alcohol" }, { name: "anisole", smiles: "COc1ccccc1", kind: "ether" },
    { name: "o-cresol", smiles: "Cc1ccccc1O", kind: "aromatic" }, { name: "m-cresol", smiles: "Cc1cccc(O)c1", kind: "aromatic" }, { name: "p-cresol", smiles: "Cc1ccc(O)cc1", kind: "aromatic" },
  ],
};

/**
 * The isomer set a stem asks for: a formula from the table, narrowed by the
 * class word the stem uses (alkene, alcohol, ether, cyclic ...). Geometric
 * pairs replace the flat alkene only when the stem asks for geometrical or
 * stereo isomers or says "all".
 */
function isomerSet(stem: string, formulas: string[]): { formula: string; members: IsomerEntry[] } | null {
  for (const formula of formulas) {
    const table = ISOMERS[formula.toLowerCase()];
    if (!table) continue;
    const wantsGeometric = /geometric|cis|trans|stereo|\ball\b|total/.test(stem);
    let members = table.filter((entry) => !entry.geometric || wantsGeometric);
    if (wantsGeometric) members = members.filter((entry) => !(entry.kind === "alkene" && !entry.geometric && table.some((other) => other.geometric && other.name.endsWith(entry.name))));
    const classes: Array<[RegExp, IsomerEntry["kind"][]]> = [
      [/alkene|olefin|double bond/, ["alkene"]],
      [/cyclic|cycloalkane|ring/, ["cycloalkane"]],
      [/alcohol/, ["alcohol"]],
      [/ether/, ["ether"]],
      [/aldehyde|ketone|carbonyl/, ["carbonyl"]],
      [/alkane|saturated|paraffin/, ["alkane"]],
      [/aromatic|benzene/, ["aromatic"]],
    ];
    for (const [pattern, kinds] of classes) {
      if (pattern.test(stem) && members.some((entry) => kinds.includes(entry.kind))) {
        members = members.filter((entry) => kinds.includes(entry.kind));
        break;
      }
    }
    if (members.length === 0 || members.length > MAX_MOLECULES) return null;
    return { formula, members };
  }
  return null;
}

/* ------------------------------------------------------------------------- */
/* Cue                                                                       */
/* ------------------------------------------------------------------------- */

const ORGANIC_CONTEXT = /\b(?:iupac|structure|structural|isomer|hybridi[sz]|chiral|optically|unsaturation|functional group|major product|reaction sequence|treatment|treated|reagent|reacts?|gives?|grignard|carbocation|nucleophil|electrophil|sn1|sn2|e1|e2|ester|alcohol|aldehyde|ketone|amine|alkene|alkyne|alkane|aromatic|benzene ring|oxidation|reduction|hydrolysis|dehydration|halogenation|nitration|sulphonation|sulfonation|acylation|alkylation|ozonolysis|polymer|monomer)\b/;
const NOT_ORGANIC = /\b(?:molal|molality|molarity|freezing point|boiling point (?:of|elevation)|osmotic|vapou?r pressure|enthalpy of (?:combustion|formation|neutrali)|heat of|calorimet|rate constant|half.?life|order of (?:the )?reaction|activation energy|equilibrium constant|solubility product|buffer|electrode potential|emf|conductivity|crystal field|coordination number|ligand|unit cell|lattice|radioactive|nearest integer|weight percentage|molar mass of the compound|empirical formula|how many grams|mass of|[xy] g of|quantitatively produced|fuel cell|cell potential|electrochemical cell|galvanic|flame test|group (?:reagent|precipitate)|salt analysis|sodium carbonate extract|moles? of [a-z0-9 ]{1,30} required|required to produce|adsorption|freundlich|langmuir|isotonic|total number of atoms|number of (?:atoms|molecules) present|at stp|charged comb|decay sequence|particles?\/radiation)\b/;
const FIGURE_ONLY = /\b(?:the following (?:compound|structure|reaction|molecule|reaction sequence)|given (?:compound|structure|reaction)|shown below|structure shown|compound \([a-z]\))\b/;

/** Exam-paper scaffolding an OCR pass leaves in front of the question. */
const SCAFFOLD = /topic\s*name\s*:\s*chemistry\s*-?\s*section\s*[ab]\s*[it]?[lt]?em\s*code\s*:?\s*\d+|\bquestion\s*[:;]/gi;

/** Two statements or an assertion: several claims, not one reaction to draw. */
const STATEMENT_STEM = /\bstatement\s*[-(]?\s*(?:i|1)\b|\bassertion\b/i;

/**
 * Words that make the compound after them a reagent, a solvent or a scheme
 * step, never the reactant: "treatment of P with excess methyl iodide",
 * "hot KOH dissolved in ethanol", "(iii) cyclohexanone". Drawing one of
 * those as "reactant -> ?" was the most common wrong picture on the bank.
 */
const REAGENT_BEFORE = /(?:\bwith|\busing|\bdissolved in|\bin (?:the )?presence of|\bexcess(?: of)?|\bcatal[yi][sz](?:ed|t)(?: by)?|\bsolvent|\bmedium|\bsolution in)\s*(?:\S+\s+){0,3}$/;

/** A numbered step in a reaction scheme, "(iii) cyclohexanone", but not "Statement (I):". */
const SCHEME_STEP_BEFORE = /(?<!(?:statement|list|column|option)\s*[-]?\s*)\(\s*(?:i{1,3}|iv|vi{0,3})\s*\)\s*$/;

/** Words that make the compound after them a product. */
const PRODUCT_BEFORE = /(?:\bgives?|\bto give|\bforms?|\bto form|\bproduces?|\bproduce\(s\)|\byields?|\bto yield|\bobtained|\bmixture of|\bproducts?(?: is| are| formed| obtained)?|\bconverted (?:in)?to|\bresulted in)\s*(?:\S+\s+){0,3}$/;

/** Common reaction solvents: "KI in acetone", "dissolved in 50 mL ethyl acetate". */
const COMMON_SOLVENT = /^(?:acetone|propanone|ethanol|methanol|ethyl acetate|diethyl ether|ether|dmso|dmf|thf|tetrahydrofuran|dioxane|1,4-dioxane|chloroform|dichloromethane|ccl4|chcl3|acetic acid|pyridine|hexane|benzene|water|acetonitrile)$/i;

export function mentionRole(lower: string, mention: Mention): "reagent" | "product" | null {
  const clauseStart = Math.max(
    lower.lastIndexOf(". ", mention.start - 1),
    lower.lastIndexOf(";", mention.start - 1),
    lower.lastIndexOf("?", mention.start - 1),
  ) + 1;
  const pre = lower.slice(Math.max(clauseStart, mention.start - 60), mention.start);
  if (REAGENT_BEFORE.test(pre) || SCHEME_STEP_BEFORE.test(pre)) return "reagent";
  if ((COMMON_SOLVENT.test(mention.text) || COMMON_SOLVENT.test(mention.molecule.name ?? "")) && /\bin\s*(?:\S+\s+){0,2}$/.test(pre)) return "reagent";
  if (PRODUCT_BEFORE.test(pre)) return "product";
  return null;
}

/** True when the stem names a compound the family can draw, or asks for isomers of a tabled formula. */
export function isOrganicStem(question: string): boolean {
  const stem = chemStem(question);
  if (NOT_ORGANIC.test(stem)) return false;
  const complexes = complexTokens(question);
  const mentions = distinctMentions(findMentions(question));
  const strong = mentions.filter((mention) => !mention.weak);
  if (complexes.length > 0 && strong.length === 0) return false;
  // "The following reaction/compound" means a lost image; one name beside it
  // is a solvent or a passing mention, not the figure the stem needs.
  if (FIGURE_ONLY.test(stem) && strong.length <= 1) return false;
  if (strong.length > 0) return true;
  if (mentions.length > 0 && ORGANIC_CONTEXT.test(stem)) return true;
  if (/\bisomers?\b/.test(stem) && isomerSet(stem, formulaTokens(question))) return true;
  return false;
}

/* ------------------------------------------------------------------------- */
/* Scene                                                                     */
/* ------------------------------------------------------------------------- */

interface Slot {
  readonly laid: LaidOutMolecule;
  readonly caption: string;
  readonly cue: string;
}

/** Lettered or numbered answer items, and the ten-digit option ids NTA papers print. */
const ITEM_MARKER = /\(\s*(?:[a-d]|[1-4])\s*\)|(?:^|\s)[a-d]\.\s|\b\d{9,11}[.,]/gi;

const OPTIONS_START = /\boptions?\s*:|\(a\)|\(1\)|(?:^|\s)a\.\s|(?:^|\s)1\.\s|(?:^|\s)a\)\s/;
const PRODUCT_CUE = /\b(?:gives?|to give|to form|forms?|produces?|yields?|is converted (?:in)?to|to yield|major product (?:is|formed|obtained)|product (?:is|formed|obtained))\b|->/;
const REACTION_CUE = /->|\b(?:gives?|to give|on treatment with|treated with|reacts? with|on reaction with|on heating with|on oxidation|on reduction|on hydrolysis|on dehydration|produces?|forms|yields?|is converted (?:in)?to|major product|product of|in presence of)\b/;

function prepareSlot(molecule: Molecule, cue: string): Slot | null {
  const laid = layoutMolecule(molecule);
  if (!laid) return null;
  return { laid, caption: structureCaption(laid), cue };
}

function factsLine(stem: string, molecule: Molecule): string {
  const facts = organicFacts(molecule);
  const parts: string[] = [`${molecule.name ?? "compound"} ${facts.formulaPlain}`];
  if (/hybridi[sz]|\bsp\b|sp2|sp3/.test(stem)) parts.push(`sp ${facts.counts.sp}, sp2 ${facts.counts.sp2}, sp3 ${facts.counts.sp3} carbons`);
  if (/unsaturation|double bond equivalent|\bdbe\b/.test(stem)) parts.push(`degree of unsaturation ${facts.degreeOfUnsaturation}`);
  if (/chiral|stereocent|asymmetric carbon|optical/.test(stem)) parts.push(`chiral centres ${facts.chiralCentres.length}`);
  if (/functional group/.test(stem) && facts.functionalGroups.length) parts.push(`groups: ${facts.functionalGroups.join(", ")}`);
  return parts.join("; ");
}

/**
 * The figure, or null. Reads named compounds in order of appearance; with a
 * reaction cue draws reactant, reagent arrow, and the named product or a
 * "?" box; with an isomer question draws the tabled isomers; otherwise the
 * named compounds in a row, each in its own reveal group.
 */
export function buildOrganicScene(question: string, _quantities: ChemPlanQuantity[], _schematic: boolean): SceneDocument | null {
  if (!isOrganicStem(question)) return null;
  // One text for every index: mentions, cues and roles are all read from the
  // same normalised string. Mixing raw-question indices with a whitespace-
  // collapsed copy shifted every cue on an OCR stem.
  const text = normalizeChemistryText(question).replace(SCAFFOLD, " ").replace(/\s+/g, " ").trim();
  const stem = text.toLowerCase();
  const optionsAt = OPTIONS_START.exec(stem)?.index ?? -1;
  const body = optionsAt > 0 ? text.slice(0, optionsAt) : text;
  const bodyStem = optionsAt > 0 ? stem.slice(0, optionsAt) : stem;

  // Isomers of a formula.
  const isomerAsk = /\bisomers?\b/.test(stem) ? isomerSet(stem, formulaTokens(question)) : null;
  const geometricAsk = /geometrical isomer|geometric isomer|cis.?trans|\bcis\b|\btrans\b|\(e\)|\(z\)/.test(stem);

  // Roles are read per occurrence before de-duplication: "aniline" can be a
  // reagent in one clause and the subject of the next.
  const allMentions = distinctMentions(findMentions(text).filter((mention) => mentionRole(stem, mention) !== "reagent"));
  const bodyMentions = distinctMentions(findMentions(body));
  // A reaction stem names its reactant before the reaction verb ("X on
  // treatment with", "X gives"). A verb before every name, or more than two
  // names before it, is a list of compounds, drawn as a row. The reactant
  // must not itself be a reagent or a product, and the verb must follow it
  // in the same clause; a statement stem is a list of claims, never a scheme.
  const firstBody = bodyMentions[0];
  const reactionCueAt = firstBody ? (() => {
    const window = bodyStem.slice(firstBody.end, firstBody.end + 90);
    const clauseEnd = /[.;?]\s/.exec(window);
    const match = REACTION_CUE.exec(clauseEnd ? window.slice(0, clauseEnd.index) : window);
    return match ? firstBody.end + match.index : -1;
  })() : -1;
  const reaction = reactionCueAt >= 0
    && !isomerAsk
    && !STATEMENT_STEM.test(stem)
    && mentionRole(bodyStem, firstBody!) === null
    && bodyMentions.filter((mention) => mention.start < reactionCueAt).length <= 2;

  const slots: Slot[] = [];
  let caption = "";
  const c = new ChemScene(question, "skeletal structures of the named compounds", ORGANIC_FAMILY);

  if (isomerAsk && !reaction) {
    for (const entry of isomerAsk.members) {
      const molecule = parseSmiles(entry.smiles);
      if (!molecule) return null;
      molecule.name = entry.name;
      const slot = prepareSlot(molecule, `${entry.name}, one isomer of ${isomerAsk.formula}`);
      if (!slot) return null;
      slots.push(slot);
    }
    caption = `${isomerAsk.members.length} isomers of ${isomerAsk.formula}: ${isomerAsk.members.map((entry) => entry.name).join(", ")}`;
    return assembleRow(c, slots, caption);
  }

  if (reaction) {
    const reactant = bodyMentions[0]!;
    const productCue = PRODUCT_CUE.exec(bodyStem.slice(reactant.end));
    const productCueAt = productCue ? reactant.end + productCue.index + productCue[0].length : -1;
    const after = productCueAt >= 0 ? bodyMentions.filter((mention) => mention.start >= productCueAt) : [];
    const sentenceEnd = productCueAt >= 0 ? (() => { const dot = /[.?;]/.exec(bodyStem.slice(productCueAt)); return dot ? productCueAt + dot.index : bodyStem.length; })() : -1;
    const inSentence = after.filter((mention) => mention.start <= sentenceEnd);
    const product = inSentence.length === 1 && inSentence[0]!.key !== reactant.key ? inSentence[0]! : null;
    const secondReactant = bodyMentions.find((mention) => mention !== reactant && mention.start < (productCueAt >= 0 ? productCueAt : bodyStem.length) && /\b(?:and|with|\+)\s*$/.test(bodyStem.slice(reactant.end, mention.start).trim() + " ") && (!product || mention !== product));
    const sentenceStop = /[.;?]/.exec(bodyStem.slice(reactant.end));
    const phraseEnd = productCueAt >= 0 ? productCueAt : Math.min(bodyStem.length, reactant.end + 160, sentenceStop ? reactant.end + sentenceStop.index : Infinity);
    const reagentPhrase = bodyStem.slice(reactant.end, phraseEnd);
    const reagentText = readReagent(secondReactant ? reagentPhrase.replace(secondReactant.text.toLowerCase(), " ") : reagentPhrase)
      ?? (product ? readReagent(bodyStem.slice(productCueAt)) : null);
    const reactantSlot = prepareSlot(reactant.molecule, `reactant ${reactant.molecule.name ?? reactant.text}`);
    if (!reactantSlot) return null;
    const secondSlot = secondReactant ? prepareSlot(secondReactant.molecule, `second reactant ${secondReactant.molecule.name ?? secondReactant.text}`) : null;
    const productSlot = product ? prepareSlot(product.molecule, `product ${product.molecule.name ?? product.text}`) : null;
    if (product && !productSlot) return null;
    const names = [reactant, ...(secondReactant ? [secondReactant] : []), ...(product ? [product] : [])];
    caption = names.map((mention) => factsLine(stem, mention.molecule)).join(". ")
      + (reagentText ? `. Reagent ${reagentText.replace(/_/g, "").replace(/\^\(([^)]*)\)/g, "$1")}` : "")
      + (product ? "" : ". Product left for the tutor to name");
    return assembleReaction(c, reactantSlot, secondSlot, reagentText, productSlot, caption);
  }

  // Named compounds in a row; a geometrical isomer question draws cis and trans of the one alkene.
  // A reagent or solvent is never drawn as a structure of its own, and a
  // formula alias read out of OCR'd answer options is not a named compound.
  let mentions = allMentions.filter((mention) =>
    (!mention.weak || ORGANIC_CONTEXT.test(stem))
    && !(mention.weak && optionsAt > 0 && mention.start >= optionsAt));
  if (mentions.length === 0) return null;
  // Every name read out of the answer options: draw the options only when all
  // of them resolved. One or two of four structures reads as "the" compound.
  // A name that fills a short lettered item is an answer option; a name
  // inside a long item is the subject of a statement and counts like the
  // body. Options drawn alone mislead: one structure out of four reads as
  // "the" compound, so a lone option, or a row missing more than one of
  // three or more short options, draws nothing.
  if (optionsAt > 0) {
    const marks = [...stem.slice(optionsAt).matchAll(ITEM_MARKER)].map((mark) => optionsAt + (mark.index ?? 0));
    const items = marks.map((itemStart, index) => ({ start: itemStart, end: marks[index + 1] ?? stem.length }));
    const shortItems = items.filter((item) => item.end - item.start <= 48);
    const isOption = (mention: Mention) => items.some((item) =>
      mention.start >= item.start && mention.end <= item.end && (item.end - item.start) - mention.text.length <= 30);
    const optionMentions = mentions.filter(isOption);
    if (optionMentions.length === mentions.length) {
      if (optionMentions.length === 1 && items.length >= 2) return null;
      if (shortItems.length >= 3 && optionMentions.length < shortItems.length - 1) return null;
    }
  }
  if (geometricAsk && mentions.length === 1) {
    const base = mentions[0]!;
    const cis = moleculeFromName(`cis-${base.text}`);
    const trans = moleculeFromName(`trans-${base.text}`);
    if (cis && trans) {
      const cisSlot = prepareSlot(cis, `cis isomer of ${base.molecule.name ?? base.text}`);
      const transSlot = prepareSlot(trans, `trans isomer of ${base.molecule.name ?? base.text}`);
      if (!cisSlot || !transSlot) return null;
      return assembleRow(c, [cisSlot, transSlot], `${cis.name} and ${trans.name}: the two geometrical isomers of ${base.molecule.name ?? base.text}, ${organicFacts(base.molecule).formulaPlain}`);
    }
  }
  if (mentions.length > MAX_MOLECULES) mentions = mentions.slice(0, MAX_MOLECULES);
  for (const mention of mentions) {
    const slot = prepareSlot(mention.molecule, `structure of ${mention.molecule.name ?? mention.text}`);
    if (!slot) return null;
    slots.push(slot);
  }
  caption = mentions.map((mention) => factsLine(stem, mention.molecule)).join(". ");
  return assembleRow(c, slots, caption);
}

const GAP = 1.5;

function assembleRow(c: ChemScene, slots: Slot[], caption: string): SceneDocument | null {
  if (slots.length === 0) return null;
  const perRow = slots.length <= 4 ? slots.length : Math.ceil(slots.length / 2);
  const rowHeight = Math.max(...slots.map((slot) => { const b = layoutBounds(slot.laid); return b.maxY - b.minY + 0.8; }));
  const rows = Math.ceil(slots.length / perRow);
  const rowWidth = Math.max(...Array.from({ length: rows }, (_, row) => slots.slice(row * perRow, (row + 1) * perRow)
    .reduce((sum, slot) => { const b = layoutBounds(slot.laid); return sum + (b.maxX - b.minX) + 0.3 + GAP; }, 0)));
  const pxPerUnit = estimatePxPerUnit(rowWidth, rows * (rowHeight + 0.6));
  let index = 0;
  for (let row = 0; index < slots.length; row += 1) {
    let cursor = 0;
    const y = -row * (rowHeight + 0.6);
    for (let column = 0; column < perRow && index < slots.length; column += 1, index += 1) {
      const slot = slots[index]!;
      const bounds = layoutBounds(slot.laid);
      const origin: Vec2 = { x: cursor - bounds.minX, y: y - (bounds.minY + bounds.maxY) / 2 };
      const drawn = renderMolecule(c, slot.laid, `m${index}`, origin, slot.caption, pxPerUnit);
      c.scene.labelled(...drawn.labelledAtomIds.slice(0, 6));
      c.scene.group(`m${index}_group`, drawn.ids, slot.cue);
      cursor = drawn.bounds.maxX + GAP;
    }
  }
  return c.build({ caption });
}

function assembleReaction(c: ChemScene, reactant: Slot, second: Slot | null, reagent: string | null, product: Slot | null, caption: string): SceneDocument | null {
  let cursor = 0;
  const leftIds: string[] = [];
  const parts = [reactant, ...(second ? [second] : []), ...(product ? [product] : [])].map((slot) => layoutBounds(slot.laid));
  const totalWidth = parts.reduce((sum, b) => sum + (b.maxX - b.minX) + 0.3, 0) + 4.0 + (second ? 1.5 : 0) + (product ? 0 : 2.1);
  const totalHeight = Math.max(...parts.map((b) => b.maxY - b.minY + 0.8));
  const pxPerUnit = estimatePxPerUnit(totalWidth, totalHeight);
  const place = (slot: Slot, prefix: string): ReturnType<typeof renderMolecule> => {
    const bounds = layoutBounds(slot.laid);
    const origin: Vec2 = { x: cursor - bounds.minX, y: -(bounds.minY + bounds.maxY) / 2 };
    const drawn = renderMolecule(c, slot.laid, prefix, origin, slot.caption, pxPerUnit);
    c.scene.labelled(...drawn.labelledAtomIds.slice(0, 6));
    cursor = drawn.bounds.maxX;
    return drawn;
  };
  const first = place(reactant, "r0");
  leftIds.push(...first.ids);
  if (second) {
    cursor += 0.6;
    leftIds.push(c.text("plus", { x: cursor + 0.2, y: 0 }, "+", "plus sign"));
    cursor += 0.9;
    leftIds.push(...place(second, "r1").ids);
  }
  cursor += 0.7;
  const arrowLength = 2.6;
  const tail: Vec2 = { x: cursor, y: 0 };
  const head: Vec2 = { x: cursor + arrowLength, y: 0 };
  leftIds.push(c.arrow("reaction_arrow", tail, head, "reaction arrow"));
  if (reagent) leftIds.push(c.text("reagent", { x: (tail.x + head.x) / 2, y: 0.45 }, reagent, "reagent"));
  cursor = head.x + 0.7;
  c.scene.group("reactant_group", leftIds, `reactant${second ? "s" : ""} and reagent${reagent ? ` ${reagent}` : ""}`);
  const rightIds: string[] = [];
  if (product) {
    rightIds.push(...place(product, "p0").ids);
    c.scene.group("product_group", rightIds, `product ${product.laid.molecule.name ?? ""}`.trim(), ["reactant_group"]);
  } else {
    const centre: Vec2 = { x: cursor + 0.7, y: 0 };
    const helper = c.scene.helper("unknown_c", centre, "product box centre helper");
    rightIds.push(c.scene.rectangle("unknown_box", helper, 1.4, 1.4, "unknown product box"));
    rightIds.push(c.text("unknown_mark", centre, "?", "unknown product"));
    c.scene.group("product_group", rightIds, "product to be named", ["reactant_group"]);
  }
  return c.build({ caption });
}

/* ------------------------------------------------------------------------- */
/* Probes                                                                    */
/* ------------------------------------------------------------------------- */

export const ORGANIC_PROBES: ReadonlyArray<{
  question: string;
  expect: "draw" | "decline";
  labels?: string[];
  forbidLabels?: string[];
  note?: string;
}> = [
  { question: "Draw the structure of 2-methylpropan-2-ol.", expect: "draw", labels: ["OH"], note: "tertiary alcohol: cross carbon with OH" },
  { question: "Write the structure of 3-methylbut-1-ene.", expect: "draw", labels: ["C_5H_10"], note: "terminal alkene, isopropyl end; the 17-character name gives way to the formula caption" },
  { question: "The structure of 2,4,6-trinitrophenol is", expect: "draw", labels: ["OH", "NO_2"], note: "picric acid, three collapsed nitro groups" },
  { question: "Draw p-nitroaniline.", expect: "draw", labels: ["NH_2", "NO_2"], note: "para positions across the ring" },
  { question: "Draw the structure of ethyl ethanoate.", expect: "draw", labels: ["O"], note: "ester: C=O and ether O" },
  { question: "Benzoic acid has the structure", expect: "draw", labels: ["OH", "O", "benzoic acid"] },
  { question: "The structure of acetophenone is", expect: "draw", labels: ["O", "acetophenone"] },
  { question: "Draw the geometrical isomers of but-2-ene.", expect: "draw", labels: ["cis-but-2-ene", "trans-but-2-ene"], note: "cis and trans drawn side by side" },
  { question: "Draw the structure of naphthalene.", expect: "draw", labels: ["naphthalene"], note: "two fused hexagons, each with an inner circle" },
  { question: "Draw all the structural isomers of C4H10.", expect: "draw", labels: ["butane", "2-methylpropane"] },
  { question: "2-chloro-2-methylpropane on treatment with aqueous KOH gives 2-methylpropan-2-ol.", expect: "draw", labels: ["Cl", "OH", "aq. KOH"], note: "reactant, reagent arrow, product" },
  { question: "Propene reacts with HBr to give the major product", expect: "draw", labels: ["HBr", "?", "propene"], note: "no product named: ? box" },
  { question: "The number of sp2 hybridised carbon atoms in benzaldehyde is", expect: "draw", labels: ["O", "H", "benzaldehyde"], note: "caption carries sp2 = 7" },
  { question: "The number of chiral centres in 2-chlorobutane is", expect: "draw", labels: ["Cl", "2-chlorobutane"], note: "caption carries chiral centres 1" },
  { question: "The hybridisation of cobalt in [Co(NH3)6]3+ is", expect: "decline", note: "coordination complex, no organic name" },
  { question: "The major product of the following reaction is", expect: "decline", note: "figure absent, nothing named" },
];
