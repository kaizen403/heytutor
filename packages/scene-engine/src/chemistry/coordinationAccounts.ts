/**
 * Mononuclear IUPAC names, Werner valences, and the NCERT applications.
 *
 * The geometry builder still draws the complex. This module only names it,
 * counts primary and secondary valence, or labels a source-named use. It
 * does not invent a yield, a colour wavelength, or a biological active site.
 */
import type { SceneDocument } from "../types";
import type { ParsedComplex } from "./formula";
import { ChemScene, chemStem, type ChemPlanQuantity } from "./sceneKit";

const COORD_FAMILY = "chem_coordination";

const ROMAN = ["0", "I", "II", "III", "IV", "V", "VI", "VII"] as const;

const METAL_NAME: Record<string, string> = {
  Co: "cobalt", Fe: "iron", Ni: "nickel", Cu: "copper", Cr: "chromium",
  Mn: "manganese", Pt: "platinum", Zn: "zinc", Ag: "silver", Au: "gold", Pd: "palladium",
};

const METAL_ATE: Record<string, string> = {
  Fe: "ferrate", Cu: "cuprate", Ag: "argentate", Au: "aurate", Co: "cobaltate",
  Ni: "nickelate", Cr: "chromate", Mn: "manganate", Zn: "zincate", Pt: "platinate", Pd: "palladate",
};

const COUNTER_WORD: Array<{ test: RegExp; symbol: string; charge: number; name: string }> = [
  { test: /^k\d*$|^potassium$/, symbol: "K", charge: 1, name: "potassium" },
  { test: /^na\d*$|^sodium$/, symbol: "Na", charge: 1, name: "sodium" },
  { test: /^cl\d*$|^chloride$/, symbol: "Cl", charge: -1, name: "chloride" },
  { test: /^br\d*$|^bromide$/, symbol: "Br", charge: -1, name: "bromide" },
  { test: /^so4$|^sulfate$|^sulphate$/, symbol: "SO4", charge: -2, name: "sulfate" },
];

function ligandPhrase(name: string, count: number, denticity: number): string | null {
  const complexPrefix = denticity > 1 || /^(di|tri|tetra|bis|tris)/.test(name);
  const simple = ["", "", "di", "tri", "tetra", "penta", "hexa"];
  const wrapped = ["", "", "bis", "tris", "tetrakis", "pentakis", "hexakis"];
  if (count === 1) return name;
  const prefix = (complexPrefix ? wrapped : simple)[count];
  if (!prefix) return null;
  return complexPrefix ? `${prefix}(${name})` : `${prefix}${name}`;
}

/** NCERT-style mononuclear name. Unknown metals and leftover ligands return null. */
export function iupacName(complex: ParsedComplex): string | null {
  if (!Number.isInteger(complex.oxidationState) || complex.oxidationState < 0 || complex.oxidationState > 7) return null;
  const anionic = complex.charge < 0;
  const metal = anionic ? METAL_ATE[complex.metal.symbol] : METAL_NAME[complex.metal.symbol];
  if (!metal) return null;
  const parts = [...complex.ligands].sort((a, b) => a.spec.name.localeCompare(b.spec.name));
  const ligandText = parts.map((ligand) => ligandPhrase(ligand.spec.name, ligand.count, ligand.spec.denticity));
  if (ligandText.some((part) => part === null)) return null;
  const entity = `${ligandText.join("")}${metal}(${ROMAN[complex.oxidationState]})`;
  if (!complex.counterIon) return complex.charge === 0 ? entity : `${entity} ion`;
  const counter = COUNTER_WORD.find((word) => word.test.test(complex.counterIon!.replace(/[()]/g, "").toLowerCase()));
  if (!counter) return null;
  return complex.charge > 0 ? `${entity} ${counter.name}` : `${counter.name} ${entity}`;
}

const LIGAND_NAMES: Array<{ name: string; key: string; charge: number; denticity: number }> = [
  { name: "ethylenediamine", key: "en", charge: 0, denticity: 2 },
  { name: "oxalato", key: "C2O4", charge: -2, denticity: 2 },
  { name: "ammine", key: "NH3", charge: 0, denticity: 1 },
  { name: "aqua", key: "H2O", charge: 0, denticity: 1 },
  { name: "chlorido", key: "Cl", charge: -1, denticity: 1 },
  { name: "cyanido", key: "CN", charge: -1, denticity: 1 },
  { name: "sulfato", key: "SO4", charge: -2, denticity: 1 },
  { name: "sulphato", key: "SO4", charge: -2, denticity: 1 },
  { name: "fluorido", key: "F", charge: -1, denticity: 1 },
  { name: "bromido", key: "Br", charge: -1, denticity: 1 },
  { name: "carbonyl", key: "CO", charge: 0, denticity: 1 },
  { name: "nitrito-n", key: "NO2", charge: -1, denticity: 1 },
  { name: "nitrito-o", key: "ONO", charge: -1, denticity: 1 },
];

const PREFIXES: Array<{ text: string; count: number }> = [
  { text: "hexakis", count: 6 }, { text: "pentakis", count: 5 }, { text: "tetrakis", count: 4 },
  { text: "hexa", count: 6 }, { text: "penta", count: 5 }, { text: "tetra", count: 4 },
  { text: "tris", count: 3 }, { text: "bis", count: 2 },
  { text: "tri", count: 3 }, { text: "di", count: 2 }, { text: "mono", count: 1 },
];

function consumeLigands(text: string): { rest: string; ligands: Array<{ key: string; count: number }> } | null {
  let rest = text;
  const ligands: Array<{ key: string; count: number }> = [];
  while (rest.length > 0) {
    const prefix = PREFIXES.find((item) => rest.startsWith(item.text));
    const count = prefix?.count ?? 1;
    const afterPrefix = prefix ? rest.slice(prefix.text.length) : rest;
    const wrapped = afterPrefix.startsWith("(");
    const body = wrapped ? afterPrefix.slice(1) : afterPrefix;
    const ligand = LIGAND_NAMES.find((item) => body.startsWith(item.name));
    if (!ligand) break;
    if (wrapped && !body.slice(ligand.name.length).startsWith(")")) return null;
    ligands.push({ key: ligand.key, count });
    rest = body.slice(wrapped ? ligand.name.length + 1 : ligand.name.length);
  }
  return ligands.length > 0 ? { rest, ligands } : null;
}

/** Reverse a mononuclear name the namer itself produces. Anything else is null. */
export function formulaFromIupac(text: string): string | null {
  const compact = text.toLowerCase().replace(/[^a-z0-9()]/g, "");
  const starts = ["potassium", "sodium", "hexa", "penta", "tetra", "tris", "bis", "tri", "di", "ammine", "aqua", "chlorido", "cyanido"];
  for (const start of starts) {
    const index = compact.indexOf(start);
    if (index < 0) continue;
    const parsed = parseIupacBody(compact.slice(index));
    if (parsed) return parsed;
  }
  return null;
}

function parseIupacBody(compact: string): string | null {
  let body = compact;
  let counter: { symbol: string; charge: number } | null = null;
  let counterSide: "before" | "after" | null = null;
  for (const word of ["potassium", "sodium", "chloride", "bromide", "sulfate", "sulphate"]) {
    if (body.startsWith(word)) {
      const found = COUNTER_WORD.find((item) => item.name === word.replace("sulphate", "sulfate") || item.name === word);
      if (!found) return null;
      counter = found;
      counterSide = "before";
      body = body.slice(word.length);
      break;
    }
  }
  const ligands = consumeLigands(body);
  if (!ligands) return null;
  const metalMatch = /^(cobaltate|ferrate|nickelate|cuprate|chromate|manganate|zincate|platinate|palladate|argentate|aurate|cobalt|iron|nickel|copper|chromium|manganese|platinum|zinc|silver|gold|palladium)\(([iv0]+)\)/.exec(ligands.rest);
  if (!metalMatch) return null;
  const metalWord = metalMatch[1]!;
  const roman = metalMatch[2]!;
  const oxidation = ROMAN.findIndex((item) => item.toLowerCase() === roman);
  if (oxidation < 0) return null;
  let tail = ligands.rest.slice(metalMatch[0].length);
  if (!counter && tail.length > 0) {
    const found = COUNTER_WORD.find((item) => item.name === tail);
    if (!found) return null;
    counter = found;
    counterSide = "after";
    tail = "";
  }
  if (tail.length > 0) return null;
  const metalSymbol = Object.keys(METAL_NAME).find((key) => METAL_NAME[key] === metalWord || METAL_ATE[key] === metalWord);
  if (!metalSymbol) return null;
  const ligandCharge = ligands.ligands.reduce((sum, ligand) => {
    const spec = LIGAND_NAMES.find((item) => item.key === ligand.key);
    return sum + (spec ? spec.charge * ligand.count : 0);
  }, 0);
  const entityCharge = oxidation + ligandCharge;
  const inside = `${metalSymbol}${ligands.ligands.map((ligand) => {
    const body = /^[A-Z][a-z]?$/.test(ligand.key) ? ligand.key : `(${ligand.key})`;
    return `${body}${ligand.count > 1 ? ligand.count : ""}`;
  }).join("")}`;
  if (!counter || entityCharge === 0) {
    const sign = entityCharge === 0 ? "" : entityCharge > 0 ? `${entityCharge === 1 ? "" : entityCharge}+` : `${entityCharge === -1 ? "" : Math.abs(entityCharge)}-`;
    return `[${inside}]${sign}`;
  }
  const count = Math.abs(entityCharge / counter.charge);
  if (!Number.isInteger(count) || count <= 0) return null;
  const written = `${counter.symbol}${count > 1 ? count : ""}`;
  return counterSide === "before" ? `${written}[${inside}]` : `[${inside}]${written}`;
}

export function wernerLabels(complex: ParsedComplex): string[] {
  const labels = [
    `CN=${complex.coordinationNumber}`,
    `ox ${complex.oxidationState >= 0 ? "+" : ""}${complex.oxidationState}`,
  ];
  if (complex.charge > 0 && complex.counterIon && complex.oxidationState === complex.charge) {
    labels.push(`primary ${complex.oxidationState}`, `secondary ${complex.coordinationNumber}`);
  }
  return labels.filter((label) => label.length <= 16);
}

interface Application {
  test: RegExp;
  labels: string[];
  caption: string;
}

const APPLICATIONS: readonly Application[] = [
  {
    test: /dimethylglyoxime|\bdmg\b|nickel[\s\S]{0,40}qualitative/,
    labels: ["Ni-DMG", "red ppt", "chelate", "no yield"],
    caption: "NCERT qualitative analysis: nickel(II) and dimethylglyoxime give a red chelate precipitate. No extraction yield is stated.",
  },
  {
    test: /mond process|nickel tetracarbonyl|\bni\(co\)4\b/,
    labels: ["Ni(CO)4", "Mond", "no yield"],
    caption: "The Mond process purifies nickel through volatile Ni(CO)4. No yield is stated, and none is drawn.",
  },
  {
    test: /haemoglobin|hemoglobin/,
    labels: ["haem Fe", "not a site"],
    caption: "Haemoglobin contains iron. The board names the metal only. It is not a map of the active site.",
  },
  {
    test: /chlorophyll/,
    labels: ["chloro Mg", "not a site"],
    caption: "Chlorophyll contains magnesium. The board names the metal only.",
  },
  {
    test: /vitamin b12|\bb12\b/,
    labels: ["B12 has Co", "not a site"],
    caption: "Vitamin B12 contains cobalt. The board names the metal only.",
  },
];

export function isCoordinationApplication(question: string): boolean {
  const stem = chemStem(question);
  return APPLICATIONS.some((item) => item.test.test(stem));
}

export function buildCoordinationApplication(
  question: string,
  quantities: ChemPlanQuantity[],
): SceneDocument | null {
  void quantities;
  const stem = chemStem(question);
  if (/yield|wavelength|active site|spectrum/.test(stem)) return null;
  const application = APPLICATIONS.find((item) => item.test.test(stem));
  if (!application) return null;
  if (application.labels.some((label) => label.length > 16)) return null;
  const scene = new ChemScene(question, "a named coordination application", COORD_FAMILY);
  application.labels.forEach((label, index) => {
    scene.text(`app${index}`, { x: 1.4, y: 4.8 - index * 0.9 }, label, "coordination application");
  });
  return scene.build({ caption: application.caption });
}
