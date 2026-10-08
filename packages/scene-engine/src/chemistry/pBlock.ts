/**
 * p-Block structures that are not a one-centre VSEPR shape.
 *
 * Diborane, the borax anion, oxoacids with a direct P-H bond, peroxo acids,
 * and extended C/Si-O networks each have a connectivity the one-centre
 * solver would flatten. Positions are a schematic layout. No bond length or
 * angle is treated as a measurement. Xenon fluorides and interhalogens stay
 * on chem_vsepr.
 *
 * Connectivity used here is the NCERT p-block account: diborane has four
 * terminal 2c-2e B-H bonds and two B-H-B 3c-2e bridges and no direct B-B
 * bond; borax's anion is [B4O5(OH)4]2- with two trigonal and two tetrahedral
 * boron atoms; H3PO4 / H3PO3 / H3PO2 have three, two, and one acidic O-H
 * hydrogens; H2S2O8 and H2SO5 contain a peroxo link that sulfate does not.
 */
import type { SceneDocument } from "../types";
import { ChemScene, chemStem, type ChemPlanQuantity } from "./sceneKit";

export const PBLOCK_FAMILY = "chem_pblock" as const;

interface Node {
  id: string;
  symbol: string;
  x: number;
  y: number;
}

interface Edge {
  id: string;
  a: string;
  b: string;
  order?: 1 | 2;
  role: string;
}

interface Tag {
  id: string;
  text: string;
  x: number;
  y: number;
}

interface Species {
  id: string;
  test: RegExp;
  /** Common reagents also appear as solvents. Claim them only when the stem asks for structure. */
  needsStructure?: boolean;
  nodes: Node[];
  edges: Edge[];
  tags: Tag[];
  caption: string;
}

const SPECIES: readonly Species[] = [
  {
    id: "b2h6",
    test: /diborane|\bb2h6\b/,
    nodes: [
      { id: "b1", symbol: "B", x: 2.2, y: 3 },
      { id: "b2", symbol: "B", x: 5.2, y: 3 },
      { id: "ht1", symbol: "H", x: 1.1, y: 4.3 },
      { id: "ht2", symbol: "H", x: 1.1, y: 1.7 },
      { id: "ht3", symbol: "H", x: 6.3, y: 4.3 },
      { id: "ht4", symbol: "H", x: 6.3, y: 1.7 },
      { id: "hb1", symbol: "H", x: 3.7, y: 4.5 },
      { id: "hb2", symbol: "H", x: 3.7, y: 1.5 },
    ],
    edges: [
      { id: "t1", a: "b1", b: "ht1", role: "terminal B-H" },
      { id: "t2", a: "b1", b: "ht2", role: "terminal B-H" },
      { id: "t3", a: "b2", b: "ht3", role: "terminal B-H" },
      { id: "t4", a: "b2", b: "ht4", role: "terminal B-H" },
      { id: "br1a", a: "b1", b: "hb1", role: "3c-2e bridge" },
      { id: "br1b", a: "b2", b: "hb1", role: "3c-2e bridge" },
      { id: "br2a", a: "b1", b: "hb2", role: "3c-2e bridge" },
      { id: "br2b", a: "b2", b: "hb2", role: "3c-2e bridge" },
    ],
    tags: [
      { id: "name", text: "B2H6", x: 3.7, y: 5.6 },
      { id: "bridge", text: "3c-2e", x: 5.4, y: 4.5 },
      { id: "count", text: "2 bridge H", x: 5.4, y: 1.5 },
    ],
    caption: "Diborane, B2H6: four terminal 2c-2e B-H bonds and two bridging hydrogens, each in a 3c-2e B-H-B bond. There is no direct B-B bond. The layout is schematic, not a measured angle.",
  },
  {
    id: "al2cl6",
    test: /\bal2cl6\b|aluminium chloride dimer|aluminum chloride dimer/,
    nodes: [
      { id: "al1", symbol: "Al", x: 2.2, y: 3 },
      { id: "al2", symbol: "Al", x: 5.2, y: 3 },
      { id: "ct1", symbol: "Cl", x: 1.0, y: 4.4 },
      { id: "ct2", symbol: "Cl", x: 1.0, y: 1.6 },
      { id: "ct3", symbol: "Cl", x: 6.4, y: 4.4 },
      { id: "ct4", symbol: "Cl", x: 6.4, y: 1.6 },
      { id: "cb1", symbol: "Cl", x: 3.7, y: 4.6 },
      { id: "cb2", symbol: "Cl", x: 3.7, y: 1.4 },
    ],
    edges: [
      { id: "t1", a: "al1", b: "ct1", role: "terminal Al-Cl" },
      { id: "t2", a: "al1", b: "ct2", role: "terminal Al-Cl" },
      { id: "t3", a: "al2", b: "ct3", role: "terminal Al-Cl" },
      { id: "t4", a: "al2", b: "ct4", role: "terminal Al-Cl" },
      { id: "b1a", a: "al1", b: "cb1", role: "bridge Cl" },
      { id: "b1b", a: "al2", b: "cb1", role: "bridge Cl" },
      { id: "b2a", a: "al1", b: "cb2", role: "bridge Cl" },
      { id: "b2b", a: "al2", b: "cb2", role: "bridge Cl" },
    ],
    tags: [
      { id: "name", text: "Al2Cl6", x: 3.7, y: 5.6 },
      { id: "bridge", text: "bridge Cl", x: 5.5, y: 4.6 },
    ],
    caption: "The vapour dimer Al2Cl6 has four terminal chlorines and two bridging chlorines. This is not a one-centre AlCl3 shape.",
  },
  {
    id: "borax",
    test: /\bborax\b|b4o5\(oh\)4|\[b4o5\(oh\)4\]/,
    nodes: [
      { id: "bt1", symbol: "B", x: 3.2, y: 4.4 },
      { id: "bt2", symbol: "B", x: 3.2, y: 1.4 },
      { id: "bg1", symbol: "B", x: 1.2, y: 2.9 },
      { id: "bg2", symbol: "B", x: 5.2, y: 2.9 },
      { id: "oa", symbol: "O", x: 2.0, y: 3.9 },
      { id: "ob", symbol: "O", x: 4.4, y: 3.9 },
      { id: "oc", symbol: "O", x: 2.0, y: 1.9 },
      { id: "od", symbol: "O", x: 4.4, y: 1.9 },
      { id: "oe", symbol: "O", x: 3.2, y: 2.9 },
      { id: "h1", symbol: "OH", x: 3.2, y: 5.6 },
      { id: "h2", symbol: "OH", x: 3.2, y: 0.2 },
      { id: "h3", symbol: "OH", x: 0.0, y: 2.9 },
      { id: "h4", symbol: "OH", x: 6.4, y: 2.9 },
    ],
    edges: [
      { id: "e1", a: "bt1", b: "oa", role: "bridge O" },
      { id: "e2", a: "bg1", b: "oa", role: "bridge O" },
      { id: "e3", a: "bt1", b: "ob", role: "bridge O" },
      { id: "e4", a: "bg2", b: "ob", role: "bridge O" },
      { id: "e5", a: "bt2", b: "oc", role: "bridge O" },
      { id: "e6", a: "bg1", b: "oc", role: "bridge O" },
      { id: "e7", a: "bt2", b: "od", role: "bridge O" },
      { id: "e8", a: "bg2", b: "od", role: "bridge O" },
      { id: "e9", a: "bt1", b: "oe", role: "bridge O" },
      { id: "e10", a: "bt2", b: "oe", role: "bridge O" },
      { id: "oh1", a: "bt1", b: "h1", role: "B-OH" },
      { id: "oh2", a: "bt2", b: "h2", role: "B-OH" },
      { id: "oh3", a: "bg1", b: "h3", role: "B-OH" },
      { id: "oh4", a: "bg2", b: "h4", role: "B-OH" },
    ],
    tags: [
      { id: "anion", text: "borax anion", x: 7.6, y: 4.6 },
      { id: "tetra", text: "2 tetra B", x: 7.6, y: 3.8 },
      { id: "trig", text: "2 trigonal B", x: 7.6, y: 3.0 },
      { id: "charge", text: "anion 2-", x: 7.6, y: 2.2 },
    ],
    caption: "The borax anion is [B4O5(OH)4]2-. Two boron atoms are tetrahedral and two are trigonal. Each boron carries one OH, and five oxide oxygens bridge them. The hydration number is not drawn unless the question states it.",
  },
  {
    id: "b(oh)3",
    test: /orthoboric|\bb\(oh\)3\b/,
    nodes: [
      { id: "b", symbol: "B", x: 3, y: 3 },
      { id: "o1", symbol: "O", x: 3, y: 4.5 },
      { id: "o2", symbol: "O", x: 1.6, y: 2.1 },
      { id: "o3", symbol: "O", x: 4.4, y: 2.1 },
      { id: "h1", symbol: "H", x: 3, y: 5.6 },
      { id: "h2", symbol: "H", x: 0.6, y: 1.4 },
      { id: "h3", symbol: "H", x: 5.4, y: 1.4 },
    ],
    edges: [
      { id: "o1", a: "b", b: "o1", role: "B-O" },
      { id: "o2", a: "b", b: "o2", role: "B-O" },
      { id: "o3", a: "b", b: "o3", role: "B-O" },
      { id: "h1", a: "o1", b: "h1", role: "O-H" },
      { id: "h2", a: "o2", b: "h2", role: "O-H" },
      { id: "h3", a: "o3", b: "h3", role: "O-H" },
    ],
    tags: [
      { id: "name", text: "B(OH)3", x: 6.2, y: 4.4 },
      { id: "site", text: "H on O", x: 6.2, y: 3.6 },
    ],
    caption: "Orthoboric acid, B(OH)3, has hydrogen on oxygen, not on boron. Layer hydrogen bonds are real and are not given a measured length here.",
  },
  {
    id: "bf3",
    test: /electron[- ]deficient[\s\S]{0,40}\bbf3\b|\bbf3\b[\s\S]{0,40}electron[- ]deficient/,
    nodes: [
      { id: "b", symbol: "B", x: 3, y: 3 },
      { id: "f1", symbol: "F", x: 3, y: 4.6 },
      { id: "f2", symbol: "F", x: 1.6, y: 2.1 },
      { id: "f3", symbol: "F", x: 4.4, y: 2.1 },
    ],
    edges: [
      { id: "f1", a: "b", b: "f1", role: "B-F" },
      { id: "f2", a: "b", b: "f2", role: "B-F" },
      { id: "f3", a: "b", b: "f3", role: "B-F" },
    ],
    tags: [
      { id: "name", text: "BF3", x: 6, y: 4.2 },
      { id: "count", text: "6 e on B", x: 6, y: 3.4 },
      { id: "lack", text: "e deficient", x: 6, y: 2.6 },
    ],
    caption: "BF3 is trigonal and electron deficient: boron has six valence electrons in the three B-F bonds. A shape-only question stays on the VSEPR figure.",
  },
  {
    id: "h3po4",
    needsStructure: true,
    test: /\bh3po4\b|orthophosphoric|phosphoric acid/,
    nodes: [
      { id: "p", symbol: "P", x: 3, y: 3 },
      { id: "od", symbol: "O", x: 3, y: 4.6 },
      { id: "o1", symbol: "O", x: 1.5, y: 2.2 },
      { id: "o2", symbol: "O", x: 3, y: 1.4 },
      { id: "o3", symbol: "O", x: 4.5, y: 2.2 },
      { id: "h1", symbol: "H", x: 0.4, y: 1.6 },
      { id: "h2", symbol: "H", x: 3, y: 0.3 },
      { id: "h3", symbol: "H", x: 5.6, y: 1.6 },
    ],
    edges: [
      { id: "d", a: "p", b: "od", order: 2, role: "P=O" },
      { id: "a1", a: "p", b: "o1", role: "P-O" },
      { id: "a2", a: "p", b: "o2", role: "P-O" },
      { id: "a3", a: "p", b: "o3", role: "P-O" },
      { id: "h1", a: "o1", b: "h1", role: "O-H" },
      { id: "h2", a: "o2", b: "h2", role: "O-H" },
      { id: "h3", a: "o3", b: "h3", role: "O-H" },
    ],
    tags: [
      { id: "name", text: "H3PO4", x: 6.4, y: 4.4 },
      { id: "acid", text: "3 acidic H", x: 6.4, y: 3.6 },
      { id: "ph", text: "no direct P-H", x: 6.4, y: 2.8 },
    ],
    caption: "Phosphoric acid has three P-OH groups and one P=O. It has no direct P-H bond, so all three hydrogens are acidic.",
  },
  {
    id: "h3po3",
    needsStructure: true,
    test: /\bh3po3\b|phosphorous acid/,
    nodes: [
      { id: "p", symbol: "P", x: 3, y: 3 },
      { id: "od", symbol: "O", x: 3, y: 4.6 },
      { id: "hp", symbol: "H", x: 1.4, y: 3.6 },
      { id: "o1", symbol: "O", x: 2.2, y: 1.5 },
      { id: "o2", symbol: "O", x: 4.4, y: 2.0 },
      { id: "h1", symbol: "H", x: 1.2, y: 0.5 },
      { id: "h2", symbol: "H", x: 5.6, y: 1.3 },
    ],
    edges: [
      { id: "d", a: "p", b: "od", order: 2, role: "P=O" },
      { id: "ph", a: "p", b: "hp", role: "P-H" },
      { id: "a1", a: "p", b: "o1", role: "P-O" },
      { id: "a2", a: "p", b: "o2", role: "P-O" },
      { id: "h1", a: "o1", b: "h1", role: "O-H" },
      { id: "h2", a: "o2", b: "h2", role: "O-H" },
    ],
    tags: [
      { id: "name", text: "H3PO3", x: 6.4, y: 4.4 },
      { id: "acid", text: "2 acidic H", x: 6.4, y: 3.6 },
      { id: "ph", text: "1 direct P-H", x: 6.4, y: 2.8 },
    ],
    caption: "Phosphorous acid has one direct P-H bond, which is not acidic, and two P-OH groups, which are. Basicity is 2, not 3.",
  },
  {
    id: "h3po2",
    needsStructure: true,
    test: /\bh3po2\b|hypophosphorous/,
    nodes: [
      { id: "p", symbol: "P", x: 3, y: 3 },
      { id: "od", symbol: "O", x: 3, y: 4.6 },
      { id: "hp1", symbol: "H", x: 1.4, y: 3.8 },
      { id: "hp2", symbol: "H", x: 1.6, y: 2.0 },
      { id: "o1", symbol: "O", x: 4.5, y: 2.2 },
      { id: "h1", symbol: "H", x: 5.6, y: 1.3 },
    ],
    edges: [
      { id: "d", a: "p", b: "od", order: 2, role: "P=O" },
      { id: "ph1", a: "p", b: "hp1", role: "P-H" },
      { id: "ph2", a: "p", b: "hp2", role: "P-H" },
      { id: "a1", a: "p", b: "o1", role: "P-O" },
      { id: "h1", a: "o1", b: "h1", role: "O-H" },
    ],
    tags: [
      { id: "name", text: "H3PO2", x: 6.4, y: 4.4 },
      { id: "acid", text: "1 acidic H", x: 6.4, y: 3.6 },
      { id: "ph", text: "2 direct P-H", x: 6.4, y: 2.8 },
    ],
    caption: "Hypophosphorous acid has two direct P-H bonds and one P-OH. Only the O-H hydrogen is acidic.",
  },
  {
    id: "n2o5",
    needsStructure: true,
    test: /\bn2o5\b/,
    nodes: [
      { id: "n1", symbol: "N", x: 1.8, y: 3 },
      { id: "n2", symbol: "N", x: 5.0, y: 3 },
      { id: "ob", symbol: "O", x: 3.4, y: 3 },
      { id: "o1", symbol: "O", x: 0.6, y: 4.3 },
      { id: "o2", symbol: "O", x: 0.6, y: 1.7 },
      { id: "o3", symbol: "O", x: 6.2, y: 4.3 },
      { id: "o4", symbol: "O", x: 6.2, y: 1.7 },
    ],
    edges: [
      { id: "b1", a: "n1", b: "ob", role: "bridge O" },
      { id: "b2", a: "n2", b: "ob", role: "bridge O" },
      { id: "d1", a: "n1", b: "o1", order: 2, role: "N=O" },
      { id: "d2", a: "n1", b: "o2", order: 2, role: "N=O" },
      { id: "d3", a: "n2", b: "o3", order: 2, role: "N=O" },
      { id: "d4", a: "n2", b: "o4", order: 2, role: "N=O" },
    ],
    tags: [
      { id: "name", text: "N2O5", x: 3.4, y: 5.2 },
      { id: "bridge", text: "bridge O", x: 3.4, y: 4.4 },
    ],
    caption: "Molecular N2O5 is two NO2 units joined by a bridging oxygen, not a one-nitrogen oxide.",
  },
  {
    id: "p4",
    test: /white phosphorus|\bp4\b/,
    nodes: [
      { id: "p1", symbol: "P", x: 3, y: 4.4 },
      { id: "p2", symbol: "P", x: 1.6, y: 2.2 },
      { id: "p3", symbol: "P", x: 4.4, y: 2.2 },
      { id: "p4", symbol: "P", x: 3, y: 3.1 },
    ],
    edges: [
      { id: "a", a: "p1", b: "p2", role: "P-P" },
      { id: "b", a: "p1", b: "p3", role: "P-P" },
      { id: "c", a: "p2", b: "p3", role: "P-P" },
      { id: "d", a: "p4", b: "p1", role: "P-P" },
      { id: "e", a: "p4", b: "p2", role: "P-P" },
      { id: "f", a: "p4", b: "p3", role: "P-P" },
    ],
    tags: [
      { id: "name", text: "white P4", x: 6, y: 4.2 },
      { id: "bonds", text: "6 P-P", x: 6, y: 3.4 },
    ],
    caption: "White phosphorus is a P4 tetrahedron, six P-P bonds, not a one-centre hydride and not a measured bond length.",
  },
  {
    id: "h2so4",
    needsStructure: true,
    test: /\bh2so4\b|sulfuric acid|sulphuric acid/,
    nodes: [
      { id: "s", symbol: "S", x: 3, y: 3 },
      { id: "o1", symbol: "O", x: 1.8, y: 4.3 },
      { id: "o2", symbol: "O", x: 4.2, y: 4.3 },
      { id: "o3", symbol: "O", x: 1.8, y: 1.7 },
      { id: "o4", symbol: "O", x: 4.2, y: 1.7 },
      { id: "h1", symbol: "H", x: 0.7, y: 1.0 },
      { id: "h2", symbol: "H", x: 5.3, y: 1.0 },
    ],
    edges: [
      { id: "d1", a: "s", b: "o1", order: 2, role: "S=O" },
      { id: "d2", a: "s", b: "o2", order: 2, role: "S=O" },
      { id: "a1", a: "s", b: "o3", role: "S-O" },
      { id: "a2", a: "s", b: "o4", role: "S-O" },
      { id: "h1", a: "o3", b: "h1", role: "O-H" },
      { id: "h2", a: "o4", b: "h2", role: "O-H" },
    ],
    tags: [
      { id: "name", text: "H2SO4", x: 6.2, y: 4.2 },
      { id: "per", text: "no peroxo", x: 6.2, y: 3.4 },
    ],
    caption: "Sulphuric acid has two S=O and two S-OH bonds and no O-O peroxo link.",
  },
  {
    id: "h2so5",
    test: /\bh2so5\b|peroxomonosulph|peroxomonosulf|caro/,
    nodes: [
      { id: "s", symbol: "S", x: 2.6, y: 3 },
      { id: "o1", symbol: "O", x: 1.4, y: 4.4 },
      { id: "o2", symbol: "O", x: 3.8, y: 4.4 },
      { id: "o3", symbol: "O", x: 1.2, y: 1.8 },
      { id: "h1", symbol: "H", x: 0.2, y: 1.0 },
      { id: "op", symbol: "O", x: 4.2, y: 2.2 },
      { id: "oh", symbol: "O", x: 5.4, y: 1.2 },
      { id: "h2", symbol: "H", x: 6.5, y: 0.5 },
    ],
    edges: [
      { id: "d1", a: "s", b: "o1", order: 2, role: "S=O" },
      { id: "d2", a: "s", b: "o2", order: 2, role: "S=O" },
      { id: "a1", a: "s", b: "o3", role: "S-O" },
      { id: "h1", a: "o3", b: "h1", role: "O-H" },
      { id: "sp", a: "s", b: "op", role: "S-O" },
      { id: "oo", a: "op", b: "oh", role: "peroxo O-O" },
      { id: "h2", a: "oh", b: "h2", role: "O-H" },
    ],
    tags: [
      { id: "name", text: "H2SO5", x: 6.2, y: 4.6 },
      { id: "per", text: "peroxo", x: 6.2, y: 3.8 },
      { id: "not", text: "not H2SO4", x: 6.2, y: 3.0 },
    ],
    caption: "Peroxomonosulphuric acid has an S-O-O-H peroxo link. It is not sulphuric acid.",
  },
  {
    id: "h2s2o8",
    test: /\bh2s2o8\b|peroxodisulph|peroxodisulf|marshall/,
    nodes: [
      { id: "s1", symbol: "S", x: 1.8, y: 3 },
      { id: "s2", symbol: "S", x: 5.4, y: 3 },
      { id: "oa", symbol: "O", x: 3.0, y: 3 },
      { id: "ob", symbol: "O", x: 4.2, y: 3 },
      { id: "o1", symbol: "O", x: 0.8, y: 4.3 },
      { id: "o2", symbol: "O", x: 0.8, y: 1.7 },
      { id: "o3", symbol: "O", x: 6.4, y: 4.3 },
      { id: "o4", symbol: "O", x: 6.4, y: 1.7 },
      { id: "oh1", symbol: "O", x: 1.8, y: 1.4 },
      { id: "oh2", symbol: "O", x: 5.4, y: 1.4 },
      { id: "h1", symbol: "H", x: 1.8, y: 0.4 },
      { id: "h2", symbol: "H", x: 5.4, y: 0.4 },
    ],
    edges: [
      { id: "d1", a: "s1", b: "o1", order: 2, role: "S=O" },
      { id: "d2", a: "s1", b: "o2", order: 2, role: "S=O" },
      { id: "d3", a: "s2", b: "o3", order: 2, role: "S=O" },
      { id: "d4", a: "s2", b: "o4", order: 2, role: "S=O" },
      { id: "s1o", a: "s1", b: "oa", role: "S-O" },
      { id: "oo", a: "oa", b: "ob", role: "peroxo O-O" },
      { id: "s2o", a: "s2", b: "ob", role: "S-O" },
      { id: "a1", a: "s1", b: "oh1", role: "S-O" },
      { id: "a2", a: "s2", b: "oh2", role: "S-O" },
      { id: "h1", a: "oh1", b: "h1", role: "O-H" },
      { id: "h2", a: "oh2", b: "h2", role: "O-H" },
    ],
    tags: [
      { id: "name", text: "H2S2O8", x: 3.6, y: 5.4 },
      { id: "per", text: "peroxo O-O", x: 3.6, y: 4.2 },
      { id: "not", text: "not sulfate", x: 3.6, y: 1.6 },
    ],
    caption: "Peroxodisulphuric acid links two sulphur atoms by a peroxo O-O bridge. It is not a picture of sulfate.",
  },
  {
    id: "s8",
    test: /\bs8\b|sulphur crown|sulfur crown|rhombic sulphur|rhombic sulfur/,
    nodes: [0, 1, 2, 3, 4, 5, 6, 7].map((index) => {
      const angle = (-Math.PI / 2) + (index * Math.PI) / 4;
      return { id: `s${index}`, symbol: "S", x: 3 + Math.cos(angle) * 1.8, y: 3 + Math.sin(angle) * 1.8 };
    }),
    edges: [0, 1, 2, 3, 4, 5, 6, 7].map((index) => ({
      id: `e${index}`,
      a: `s${index}`,
      b: `s${(index + 1) % 8}`,
      role: "S-S",
    })),
    tags: [
      { id: "name", text: "S8 crown", x: 6.2, y: 4.2 },
      { id: "not", text: "not one centre", x: 6.2, y: 3.4 },
    ],
    caption: "Rhombic sulphur is a crown of eight sulphur atoms. It is not a one-centre VSEPR picture and the S-S length is not measured here.",
  },
  {
    id: "graphite",
    needsStructure: true,
    test: /\bgraphite\b/,
    nodes: [
      { id: "c1", symbol: "C", x: 2.2, y: 4.2 },
      { id: "c2", symbol: "C", x: 3.8, y: 4.2 },
      { id: "c3", symbol: "C", x: 4.6, y: 2.8 },
      { id: "c4", symbol: "C", x: 3.8, y: 1.4 },
      { id: "c5", symbol: "C", x: 2.2, y: 1.4 },
      { id: "c6", symbol: "C", x: 1.4, y: 2.8 },
    ],
    edges: [
      { id: "a", a: "c1", b: "c2", role: "C-C layer" },
      { id: "b", a: "c2", b: "c3", role: "C-C layer" },
      { id: "c", a: "c3", b: "c4", role: "C-C layer" },
      { id: "d", a: "c4", b: "c5", role: "C-C layer" },
      { id: "e", a: "c5", b: "c6", role: "C-C layer" },
      { id: "f", a: "c6", b: "c1", role: "C-C layer" },
    ],
    tags: [
      { id: "name", text: "graphite", x: 6.4, y: 4.4 },
      { id: "layer", text: "sheet", x: 6.4, y: 3.6 },
      { id: "rep", text: "repeat", x: 6.4, y: 2.8 },
    ],
    caption: "Graphite is an extended sheet. The hexagon is one repeat of the layer, not a finite benzene molecule and not a measured bond length.",
  },
  {
    id: "diamond",
    needsStructure: true,
    test: /\bdiamond\b/,
    nodes: [
      { id: "c", symbol: "C", x: 3, y: 3 },
      { id: "a", symbol: "C", x: 1.6, y: 4.4 },
      { id: "b", symbol: "C", x: 4.4, y: 4.4 },
      { id: "d", symbol: "C", x: 2.2, y: 1.4 },
      { id: "e", symbol: "C", x: 4.6, y: 1.6 },
    ],
    edges: [
      { id: "a", a: "c", b: "a", role: "C-C network" },
      { id: "b", a: "c", b: "b", role: "C-C network" },
      { id: "d", a: "c", b: "d", role: "C-C network" },
      { id: "e", a: "c", b: "e", role: "C-C network" },
    ],
    tags: [
      { id: "name", text: "diamond", x: 6.2, y: 4.4 },
      { id: "ext", text: "extended", x: 6.2, y: 3.6 },
      { id: "rep", text: "repeat", x: 6.2, y: 2.8 },
    ],
    caption: "Diamond is an extended tetrahedral network. The fragment shows the repeat, not a finite molecule and not a measured bond length.",
  },
  {
    id: "sio2",
    test: /silica network|\bsio2\b[\s\S]{0,40}network|network[\s\S]{0,40}\bsio2\b|extended silica/,
    nodes: [
      { id: "si", symbol: "Si", x: 3, y: 3 },
      { id: "o1", symbol: "O", x: 3, y: 4.5 },
      { id: "o2", symbol: "O", x: 4.6, y: 3 },
      { id: "o3", symbol: "O", x: 3, y: 1.5 },
      { id: "o4", symbol: "O", x: 1.4, y: 3 },
    ],
    edges: [
      { id: "a", a: "si", b: "o1", role: "Si-O-Si bridge" },
      { id: "b", a: "si", b: "o2", role: "Si-O-Si bridge" },
      { id: "c", a: "si", b: "o3", role: "Si-O-Si bridge" },
      { id: "d", a: "si", b: "o4", role: "Si-O-Si bridge" },
    ],
    tags: [
      { id: "name", text: "SiO2 net", x: 6.2, y: 4.4 },
      { id: "ext", text: "extended", x: 6.2, y: 3.6 },
      { id: "not", text: "not a molecule", x: 6.2, y: 2.8 },
    ],
    caption: "Silica is an extended Si-O network. Each oxygen continues to another silicon. A finite SiO2 molecule is not the crystal.",
  },
  {
    id: "silicone",
    test: /\bsilicone\b/,
    nodes: [
      { id: "si", symbol: "Si", x: 3, y: 3 },
      { id: "c1", symbol: "C", x: 3, y: 4.5 },
      { id: "c2", symbol: "C", x: 3, y: 1.5 },
      { id: "o1", symbol: "O", x: 1.4, y: 3 },
      { id: "o2", symbol: "O", x: 4.6, y: 3 },
    ],
    edges: [
      { id: "c1", a: "si", b: "c1", role: "Si-C" },
      { id: "c2", a: "si", b: "c2", role: "Si-C" },
      { id: "o1", a: "si", b: "o1", role: "Si-O repeat" },
      { id: "o2", a: "si", b: "o2", role: "Si-O repeat" },
    ],
    tags: [
      { id: "name", text: "silicone", x: 6.2, y: 4.4 },
      { id: "rep", text: "repeat", x: 6.2, y: 3.6 },
      { id: "not", text: "not finite", x: 6.2, y: 2.8 },
    ],
    caption: "A silicone is a repeating -SiR2-O- chain. One unit is drawn with the chain continuing. It is not a finite molecule.",
  },
  {
    id: "bleach",
    test: /bleaching powder|ca\(ocl\)cl/,
    nodes: [
      { id: "ca", symbol: "Ca", x: 2.4, y: 3 },
      { id: "cl", symbol: "Cl", x: 4.2, y: 4.2 },
      { id: "o", symbol: "O", x: 4.6, y: 2.4 },
      { id: "cl2", symbol: "Cl", x: 6.0, y: 2.4 },
    ],
    edges: [
      { id: "a", a: "ca", b: "cl", role: "chloride" },
      { id: "b", a: "ca", b: "o", role: "hypochlorite" },
      { id: "c", a: "o", b: "cl2", role: "hypochlorite" },
    ],
    tags: [
      { id: "name", text: "Ca(OCl)Cl", x: 2.4, y: 5.2 },
      { id: "sites", text: "two Cl sites", x: 2.4, y: 1.4 },
      { id: "not", text: "not Cl2", x: 4.6, y: 1.2 },
    ],
    caption: "Bleaching powder has chloride and hypochlorite on calcium. The two chlorine atoms are not a chlorine molecule.",
  },
  {
    id: "hclo",
    needsStructure: true,
    test: /\bhclo\b(?!2|3|4)|hypochlorous/,
    nodes: [
      { id: "cl", symbol: "Cl", x: 2.4, y: 3 },
      { id: "o", symbol: "O", x: 4.0, y: 3 },
      { id: "h", symbol: "H", x: 5.4, y: 3 },
    ],
    edges: [
      { id: "a", a: "cl", b: "o", role: "Cl-O" },
      { id: "b", a: "o", b: "h", role: "O-H" },
    ],
    tags: [
      { id: "name", text: "HOCl", x: 3.6, y: 4.6 },
      { id: "ox", text: "Cl ox +1", x: 3.6, y: 1.6 },
    ],
    caption: "Hypochlorous acid is HO-Cl. Chlorine's oxidation state is +1. The hydrogen is on oxygen.",
  },
  {
    id: "hclo4",
    needsStructure: true,
    test: /\bhclo4\b|perchloric/,
    nodes: [
      { id: "cl", symbol: "Cl", x: 3, y: 3 },
      { id: "o1", symbol: "O", x: 3, y: 4.6 },
      { id: "o2", symbol: "O", x: 1.5, y: 3.6 },
      { id: "o3", symbol: "O", x: 1.8, y: 1.6 },
      { id: "o4", symbol: "O", x: 4.4, y: 2.0 },
      { id: "h", symbol: "H", x: 5.6, y: 1.3 },
    ],
    edges: [
      { id: "d1", a: "cl", b: "o1", order: 2, role: "Cl=O" },
      { id: "d2", a: "cl", b: "o2", order: 2, role: "Cl=O" },
      { id: "d3", a: "cl", b: "o3", order: 2, role: "Cl=O" },
      { id: "a", a: "cl", b: "o4", role: "Cl-O" },
      { id: "h", a: "o4", b: "h", role: "O-H" },
    ],
    tags: [
      { id: "name", text: "HClO4", x: 6.2, y: 4.4 },
      { id: "ox", text: "Cl ox +7", x: 6.2, y: 3.6 },
      { id: "oh", text: "H on O", x: 6.2, y: 2.8 },
    ],
    caption: "Perchloric acid is HO-ClO3. Chlorine's oxidation state is +7. The acidic hydrogen is on oxygen.",
  },
];

const TREND_TAGS: Tag[] = [
  { id: "b", text: "B is covalent", x: 1.2, y: 5.2 },
  { id: "c", text: "C catenates", x: 1.2, y: 4.4 },
  { id: "n", text: "N has no d", x: 1.2, y: 3.6 },
  { id: "o", text: "O has no d", x: 1.2, y: 2.8 },
  { id: "f", text: "F has no d", x: 1.2, y: 2.0 },
  { id: "he", text: "He is 1s2", x: 1.2, y: 1.2 },
  { id: "not", text: "not one arrow", x: 4.6, y: 3.2 },
];

const TREND = /p-?block (?:element|trend|group)|first element|unique behaviour|unique behavior/;
const STRUCTURE = /structure|connectiv|bridg|peroxo|acidic|basicity|\bp-?h\b|network|allotrope|repeat|\bdraw\b|oxoacid/;
const REFUSE = /zeolite|bond angle|\bb2h\b(?!6)/;
const SHIFT = 9;

function matchedSpecies(stem: string): Species[] {
  const structural = STRUCTURE.test(stem);
  return SPECIES.filter((species) => species.test.test(stem) && (!species.needsStructure || structural));
}

export function isPBlockStem(question: string): boolean {
  const stem = chemStem(question);
  if (REFUSE.test(stem) && matchedSpecies(stem).length === 0 && !TREND.test(stem)) return /zeolite|\bb2h\b(?!6)/.test(stem);
  return matchedSpecies(stem).length > 0 || TREND.test(stem) || /zeolite|\bb2h\b(?!6)/.test(stem);
}

function drawSpecies(scene: ChemScene, species: Species, shift: number, prefix: string): void {
  const at = (node: Node) => ({ x: node.x + shift, y: node.y });
  for (const node of species.nodes) {
    scene.atom(`${prefix}${node.id}`, node.symbol, at(node));
  }
  for (const edge of species.edges) {
    const order = edge.order ?? 1;
    scene.bond(`${prefix}e_${edge.id}`, `${prefix}${edge.a}`, `${prefix}${edge.b}`, { order, role: edge.role });
  }
  for (const tag of species.tags) {
    scene.text(`${prefix}t_${tag.id}`, { x: tag.x + shift, y: tag.y }, tag.text, "p-block label");
  }
}

export function buildPBlockScene(
  question: string,
  quantities: ChemPlanQuantity[],
  _schematic: boolean,
): SceneDocument | null {
  void quantities;
  const stem = chemStem(question);
  if (/zeolite/.test(stem)) return null;
  if (/\bb2h\b(?!6)/.test(stem) && !/\bb2h6\b|diborane/.test(stem)) return null;
  if (/bond angle/.test(stem) && /diborane|\bb2h6\b/.test(stem)) return null;
  const species = matchedSpecies(stem).slice(0, 2);
  if (species.length === 0) {
    if (!TREND.test(stem)) return null;
    if (TREND_TAGS.some((tag) => tag.text.length > 16)) return null;
    const scene = new ChemScene(question, "first-element anomalies in the p-block", PBLOCK_FAMILY);
    for (const tag of TREND_TAGS) scene.text(tag.id, { x: tag.x, y: tag.y }, tag.text, "p-block anomaly");
    return scene.build({
      caption: "The first element of each p-block group is not a smooth continuation of the rest: boron is covalent, carbon catenates, and N, O and F have no d orbitals. Helium is 1s2. This is not one monotonic arrow.",
    });
  }
  for (const item of species) {
    if (item.tags.some((tag) => tag.text.length > 16)) return null;
  }
  const scene = new ChemScene(question, species.map((item) => item.id).join(", "), PBLOCK_FAMILY);
  species.forEach((item, index) => drawSpecies(scene, item, index * SHIFT, `s${index}_`));
  const omitted = matchedSpecies(stem).length > 2 ? " Further named species are not drawn on this board." : "";
  return scene.build({ caption: `${species.map((item) => item.caption).join(" ")}${omitted}` });
}

export const PBLOCK_PROBES: ReadonlyArray<{
  question: string;
  expect: "draw" | "decline";
  labels?: string[];
  forbidLabels?: string[];
  note?: string;
}> = [
  { question: "Draw the structure of diborane, B2H6, including the bridging hydrogens.", expect: "draw", labels: ["B2H6", "3c-2e", "2 bridge H", "B", "H"], forbidLabels: ["tetrahedral"], note: "3c-2e bridges, no one-centre shape" },
  { question: "Draw the aluminium chloride dimer Al2Cl6.", expect: "draw", labels: ["Al2Cl6", "bridge Cl"], note: "bridging chlorines" },
  { question: "Draw the borax anion and state how many boron atoms are tetrahedral.", expect: "draw", labels: ["borax anion", "2 tetra B", "2 trigonal B", "anion 2-"], note: "two of each boron coordination" },
  { question: "How many acidic hydrogens does phosphorous acid H3PO3 have? Show the P-H bond.", expect: "draw", labels: ["H3PO3", "2 acidic H", "1 direct P-H"], forbidLabels: ["3 acidic H"], note: "one direct P-H is not acidic" },
  { question: "Draw phosphoric acid H3PO4 and count the acidic hydrogens.", expect: "draw", labels: ["H3PO4", "3 acidic H", "no direct P-H"], note: "no P-H" },
  { question: "Draw hypophosphorous acid H3PO2.", expect: "draw", labels: ["H3PO2", "1 acidic H", "2 direct P-H"], note: "two direct P-H" },
  { question: "Draw peroxodisulphuric acid H2S2O8 and show the peroxo bond.", expect: "draw", labels: ["H2S2O8", "peroxo O-O", "not sulfate"], note: "O-O bridge" },
  { question: "Draw Caro's acid H2SO5.", expect: "draw", labels: ["H2SO5", "peroxo", "not H2SO4"], note: "peroxo, not sulfate" },
  { question: "Draw the silica network. Do not draw a finite SiO2 molecule.", expect: "draw", labels: ["SiO2 net", "extended", "not a molecule"], note: "repeat boundary" },
  { question: "Compare graphite and diamond as carbon allotropes.", expect: "draw", labels: ["graphite", "diamond", "repeat", "extended"], note: "both extended" },
  { question: "What is unusual about the first element of each p-block group?", expect: "draw", labels: ["B is covalent", "C catenates", "He is 1s2", "not one arrow"], note: "anomalies, not a monotonic arrow" },
  { question: "Draw bleaching powder and the two chlorine sites.", expect: "draw", labels: ["Ca(OCl)Cl", "two Cl sites", "not Cl2"], note: "chloride and hypochlorite" },
  { question: "Draw the structure of a zeolite.", expect: "decline", note: "no named framework" },
  { question: "State the B-H-B bond angle in diborane.", expect: "decline", note: "no measured angle is supplied" },
  { question: "Draw B2H.", expect: "decline", note: "the formula is incomplete" },
];
