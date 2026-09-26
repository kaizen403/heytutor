/**
 * Periodic table data the chemistry families compute from.
 *
 * Every number here is a textbook value (NCERT / IUPAC 2021 rounding): Pauling
 * electronegativity, Cordero covalent radius in pm, first ionisation enthalpy
 * in kJ/mol, and the standard atomic mass. A figure that plots a trend or
 * labels a radius reads these, never a planner scalar, so the picture cannot
 * disagree with the periodic table.
 */

export type ElementBlock = "s" | "p" | "d" | "f";

export interface ElementRecord {
  readonly z: number;
  readonly symbol: string;
  readonly name: string;
  readonly mass: number;
  /** Pauling scale; null where no accepted value exists (most noble gases). */
  readonly electronegativity: number | null;
  /** Covalent radius, pm (Cordero et al. 2008). */
  readonly radiusPm: number;
  /** First ionisation enthalpy, kJ/mol. */
  readonly ie1: number;
  readonly group: number | null;
  readonly period: number;
  readonly block: ElementBlock;
}

// z symbol name mass en radius ie1 group period block   (en "-" = none)
const TABLE = `
1 H Hydrogen 1.008 2.20 31 1312 1 1 s
2 He Helium 4.0026 - 28 2372 18 1 s
3 Li Lithium 6.94 0.98 128 520 1 2 s
4 Be Beryllium 9.0122 1.57 96 899 2 2 s
5 B Boron 10.81 2.04 84 801 13 2 p
6 C Carbon 12.011 2.55 76 1086 14 2 p
7 N Nitrogen 14.007 3.04 71 1402 15 2 p
8 O Oxygen 15.999 3.44 66 1314 16 2 p
9 F Fluorine 18.998 3.98 57 1681 17 2 p
10 Ne Neon 20.180 - 58 2081 18 2 p
11 Na Sodium 22.990 0.93 166 496 1 3 s
12 Mg Magnesium 24.305 1.31 141 738 2 3 s
13 Al Aluminium 26.982 1.61 121 578 13 3 p
14 Si Silicon 28.085 1.90 111 786 14 3 p
15 P Phosphorus 30.974 2.19 107 1012 15 3 p
16 S Sulphur 32.06 2.58 105 1000 16 3 p
17 Cl Chlorine 35.45 3.16 102 1251 17 3 p
18 Ar Argon 39.948 - 106 1521 18 3 p
19 K Potassium 39.098 0.82 203 419 1 4 s
20 Ca Calcium 40.078 1.00 176 590 2 4 s
21 Sc Scandium 44.956 1.36 170 633 3 4 d
22 Ti Titanium 47.867 1.54 160 659 4 4 d
23 V Vanadium 50.942 1.63 153 651 5 4 d
24 Cr Chromium 51.996 1.66 139 653 6 4 d
25 Mn Manganese 54.938 1.55 139 717 7 4 d
26 Fe Iron 55.845 1.83 132 762 8 4 d
27 Co Cobalt 58.933 1.88 126 760 9 4 d
28 Ni Nickel 58.693 1.91 124 737 10 4 d
29 Cu Copper 63.546 1.90 132 745 11 4 d
30 Zn Zinc 65.38 1.65 122 906 12 4 d
31 Ga Gallium 69.723 1.81 122 579 13 4 p
32 Ge Germanium 72.630 2.01 120 762 14 4 p
33 As Arsenic 74.922 2.18 119 947 15 4 p
34 Se Selenium 78.971 2.55 120 941 16 4 p
35 Br Bromine 79.904 2.96 120 1140 17 4 p
36 Kr Krypton 83.798 3.00 116 1351 18 4 p
37 Rb Rubidium 85.468 0.82 220 403 1 5 s
38 Sr Strontium 87.62 0.95 195 550 2 5 s
39 Y Yttrium 88.906 1.22 190 600 3 5 d
40 Zr Zirconium 91.224 1.33 175 640 4 5 d
41 Nb Niobium 92.906 1.60 164 652 5 5 d
42 Mo Molybdenum 95.95 2.16 154 684 6 5 d
43 Tc Technetium 98 1.90 147 702 7 5 d
44 Ru Ruthenium 101.07 2.20 146 710 8 5 d
45 Rh Rhodium 102.91 2.28 142 720 9 5 d
46 Pd Palladium 106.42 2.20 139 804 10 5 d
47 Ag Silver 107.87 1.93 145 731 11 5 d
48 Cd Cadmium 112.41 1.69 144 868 12 5 d
49 In Indium 114.82 1.78 142 558 13 5 p
50 Sn Tin 118.71 1.96 139 709 14 5 p
51 Sb Antimony 121.76 2.05 139 834 15 5 p
52 Te Tellurium 127.60 2.10 138 869 16 5 p
53 I Iodine 126.90 2.66 139 1008 17 5 p
54 Xe Xenon 131.29 2.60 140 1170 18 5 p
55 Cs Caesium 132.91 0.79 244 376 1 6 s
56 Ba Barium 137.33 0.89 215 503 2 6 s
57 La Lanthanum 138.91 1.10 207 538 3 6 d
58 Ce Cerium 140.12 1.12 204 534 - 6 f
59 Pr Praseodymium 140.91 1.13 203 527 - 6 f
60 Nd Neodymium 144.24 1.14 201 533 - 6 f
61 Pm Promethium 145 1.13 199 540 - 6 f
62 Sm Samarium 150.36 1.17 198 545 - 6 f
63 Eu Europium 151.96 1.20 198 547 - 6 f
64 Gd Gadolinium 157.25 1.20 196 593 - 6 f
65 Tb Terbium 158.93 1.20 194 566 - 6 f
66 Dy Dysprosium 162.50 1.22 192 573 - 6 f
67 Ho Holmium 164.93 1.23 192 581 - 6 f
68 Er Erbium 167.26 1.24 189 589 - 6 f
69 Tm Thulium 168.93 1.25 190 597 - 6 f
70 Yb Ytterbium 173.05 1.10 187 603 - 6 f
71 Lu Lutetium 174.97 1.27 187 524 - 6 f
72 Hf Hafnium 178.49 1.30 175 659 4 6 d
73 Ta Tantalum 180.95 1.50 170 761 5 6 d
74 W Tungsten 183.84 2.36 162 770 6 6 d
75 Re Rhenium 186.21 1.90 151 760 7 6 d
76 Os Osmium 190.23 2.20 144 840 8 6 d
77 Ir Iridium 192.22 2.20 141 880 9 6 d
78 Pt Platinum 195.08 2.28 136 870 10 6 d
79 Au Gold 196.97 2.54 136 890 11 6 d
80 Hg Mercury 200.59 2.00 132 1007 12 6 d
81 Tl Thallium 204.38 1.62 145 589 13 6 p
82 Pb Lead 207.2 2.33 146 716 14 6 p
83 Bi Bismuth 208.98 2.02 148 703 15 6 p
84 Po Polonium 209 2.00 140 812 16 6 p
85 At Astatine 210 2.20 150 890 17 6 p
86 Rn Radon 222 2.20 150 1037 18 6 p
87 Fr Francium 223 0.70 260 380 1 7 s
88 Ra Radium 226 0.90 221 509 2 7 s
89 Ac Actinium 227 1.10 215 499 3 7 d
90 Th Thorium 232.04 1.30 206 587 - 7 f
91 Pa Protactinium 231.04 1.50 200 568 - 7 f
92 U Uranium 238.03 1.38 196 598 - 7 f
93 Np Neptunium 237 1.36 190 605 - 7 f
94 Pu Plutonium 244 1.28 187 585 - 7 f
95 Am Americium 243 1.30 180 578 - 7 f
96 Cm Curium 247 1.30 169 581 - 7 f
97 Bk Berkelium 247 1.30 168 601 - 7 f
98 Cf Californium 251 1.30 168 608 - 7 f
99 Es Einsteinium 252 1.30 165 619 - 7 f
100 Fm Fermium 257 1.30 167 627 - 7 f
101 Md Mendelevium 258 1.30 173 635 - 7 f
102 No Nobelium 259 1.30 176 642 - 7 f
103 Lr Lawrencium 266 1.30 161 470 3 7 d
`;

function parseTable(): ElementRecord[] {
  return TABLE.trim().split("\n").map((line) => {
    const [z, symbol, name, mass, en, radius, ie1, group, period, block] = line.trim().split(/\s+/) as [string, string, string, string, string, string, string, string, string, string];
    return {
      z: Number(z),
      symbol,
      name,
      mass: Number(mass),
      electronegativity: en === "-" ? null : Number(en),
      radiusPm: Number(radius),
      ie1: Number(ie1),
      group: group === "-" ? null : Number(group),
      period: Number(period),
      block: block as ElementBlock,
    };
  });
}

export const ELEMENTS: readonly ElementRecord[] = parseTable();

const BY_SYMBOL = new Map(ELEMENTS.map((element) => [element.symbol, element]));
const BY_NAME = new Map(ELEMENTS.map((element) => [element.name.toLowerCase(), element]));
BY_NAME.set("aluminum", BY_SYMBOL.get("Al")!);
BY_NAME.set("sulfur", BY_SYMBOL.get("S")!);
BY_NAME.set("cesium", BY_SYMBOL.get("Cs")!);

export function elementBySymbol(symbol: string): ElementRecord | null {
  return BY_SYMBOL.get(symbol) ?? null;
}

export function elementByName(name: string): ElementRecord | null {
  return BY_NAME.get(name.trim().toLowerCase()) ?? null;
}

export function elementByZ(z: number): ElementRecord | null {
  return ELEMENTS[z - 1] ?? null;
}

/** Symbol or full name, case-insensitive for names; symbols are exact (Co is not CO). */
export function resolveElement(token: string): ElementRecord | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  return elementBySymbol(trimmed) ?? elementByName(trimmed);
}

/**
 * Valence electrons as the VSEPR and Lewis models count them: the group
 * number for s and p blocks (18-column table), the s + d electrons for the
 * transition metals.
 */
export function valenceElectrons(element: ElementRecord): number {
  if (element.block === "s") return element.group === 18 ? 2 : (element.group ?? 1);
  if (element.block === "p") return (element.group ?? 18) - 10;
  if (element.block === "d") return element.group ?? 3;
  return 3;
}

/** Elements the exam treats as forming exactly one bond (VSEPR "monovalent"). */
export function isMonovalent(element: ElementRecord): boolean {
  return element.symbol === "H" || element.group === 17;
}

export function isMetal(element: ElementRecord): boolean {
  if (element.block === "s") return element.symbol !== "H" && element.symbol !== "He";
  if (element.block === "d" || element.block === "f") return true;
  const metalsP = new Set(["Al", "Ga", "In", "Sn", "Tl", "Pb", "Bi", "Po"]);
  return metalsP.has(element.symbol);
}

/** Elements in one period (main groups only when `mainOnly`). */
export function periodElements(period: number, mainOnly = true): ElementRecord[] {
  return ELEMENTS.filter((element) => element.period === period
    && (!mainOnly || element.block === "s" || element.block === "p"));
}
