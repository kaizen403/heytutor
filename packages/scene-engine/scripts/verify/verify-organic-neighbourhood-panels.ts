/** Complete source-named molecular comparisons; no planner, private patches or bank holdout. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildOrganicScene } from "../../src/chemistry/organic";
import { carbonSiteFacts } from "../../src/chemistry/organic/neighbourhood";
import { parseSmiles, type Molecule } from "../../src/chemistry/organic/smiles";
import { compileForLab } from "../chemistry-lab/lab";
import { renderSceneSvg } from "../lib/renderSceneSvg";
import { boundsOverlap, type LabelBounds } from "../../src/labels/labelEngine";

const outputAt = process.argv.indexOf("--out");
const output = outputAt < 0 ? null : resolve(process.argv[outputAt + 1]!);
if (output) mkdirSync(output, { recursive: true });
const failures: string[] = [];
const evidence: unknown[] = [];
let passed = 0;
function check(name: string, run: () => void): void {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
const normalized = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, "");
interface ExpectedPanel { name: string; smiles: string; labels: string[]; carbons: number; hydrogens: number; hybridisation: string }
interface Case { name: string; question: string; panels: ExpectedPanel[] }
const cases: Case[] = [
  {
    name: "real-aryl-benzylic-comparison",
    question: "Draw chlorobenzene, benzyl chloride and 1-chloro-1-phenylethane as three separate structural diagrams. Identify the carbon carrying Cl in each, label its hybridisation, and classify the C–Cl site as aryl, primary benzylic or secondary benzylic. Show enough carbon connectivity that the last two cannot be mistaken for ring-bound chloride.",
    panels: [
      { name: "chlorobenzene", smiles: "Clc1ccccc1", labels: ["aryl C-Cl", "sp2", "Phenyl ring"], carbons: 2, hydrogens: 0, hybridisation: "sp2" },
      { name: "benzyl chloride", smiles: "ClCc1ccccc1", labels: ["primary benzylic", "sp3", "Phenyl ring"], carbons: 1, hydrogens: 2, hybridisation: "sp3" },
      { name: "1-chloro-1-phenylethane", smiles: "CC(Cl)c1ccccc1", labels: ["secondary benzylic", "sp3", "Phenyl ring"], carbons: 2, hydrogens: 1, hybridisation: "sp3" },
    ],
  },
  {
    name: "real-alcohol-carbon-neighbours",
    question: "Draw butan-1-ol, butan-2-ol and 2-methylpropan-2-ol with their OH-bearing carbon clearly identified. For each structure, show every carbon directly bonded to that carbon and classify the alcohol as primary, secondary or tertiary. Explain the classification from the drawn neighbourhood rather than from the compound’s total carbon count.",
    panels: [
      { name: "butan-1-ol", smiles: "CCCCO", labels: ["OH-bearing C", "primary alcohol"], carbons: 1, hydrogens: 2, hybridisation: "sp3" },
      { name: "butan-2-ol", smiles: "CCC(C)O", labels: ["OH-bearing C", "secondary alcohol"], carbons: 2, hydrogens: 1, hybridisation: "sp3" },
      { name: "2-methylpropan-2-ol", smiles: "CC(C)(C)O", labels: ["OH-bearing C", "tertiary alcohol"], carbons: 3, hydrogens: 0, hybridisation: "sp3" },
    ],
  },
  {
    name: "real-carbonyl-neighbours-and-planarity",
    question: "Draw hexanal and hexan-2-one so that the three atoms directly attached to each carbonyl carbon are explicit. Mark the approximately trigonal-planar carbonyl centres and show which has a carbonyl-bound H and which has two carbon substituents.",
    panels: [
      { name: "hexanal", smiles: "CCCCCC=O", labels: ["aldehyde", "carbonyl H", "sp2", "trigonal planar", "120"], carbons: 1, hydrogens: 1, hybridisation: "sp2" },
      { name: "hexan-2-one", smiles: "CC(=O)CCCC", labels: ["ketone", "two C substituents", "sp2", "trigonal planar", "120"], carbons: 2, hydrogens: 0, hybridisation: "sp2" },
    ],
  },
  {
    name: "fresh-alcohol-classes-different-carbon-totals",
    question: "Draw propan-1-ol, propan-2-ol and 2-methylbutan-2-ol with the OH-bearing carbon labelled. Classify each alcohol from its carbon neighbours.",
    panels: [
      { name: "propan-1-ol", smiles: "CCCO", labels: ["primary alcohol"], carbons: 1, hydrogens: 2, hybridisation: "sp3" },
      { name: "propan-2-ol", smiles: "CC(C)O", labels: ["secondary alcohol"], carbons: 2, hydrogens: 1, hybridisation: "sp3" },
      { name: "2-methylbutan-2-ol", smiles: "CCC(C)(C)O", labels: ["tertiary alcohol"], carbons: 3, hydrogens: 0, hybridisation: "sp3" },
    ],
  },
  {
    name: "fresh-alkyl-bromides",
    question: "Draw 1-bromopropane and 2-bromopropane with the carbon carrying Br identified; classify each site and label its hybridisation.",
    panels: [
      { name: "1-bromopropane", smiles: "CCCBr", labels: ["primary alkyl", "sp3"], carbons: 1, hydrogens: 2, hybridisation: "sp3" },
      { name: "2-bromopropane", smiles: "CC(C)Br", labels: ["secondary alkyl", "sp3"], carbons: 2, hydrogens: 1, hybridisation: "sp3" },
    ],
  },
  {
    name: "fresh-carbonyl-chain-length-and-position",
    question: "Draw butanal and pentan-3-one so that the atoms attached to each carbonyl carbon are explicit. Show the trigonal-planar centres and distinguish the carbonyl-bound H from the two carbon substituents.",
    panels: [
      { name: "butanal", smiles: "CCCC=O", labels: ["aldehyde", "carbonyl H", "sp2", "120"], carbons: 1, hydrogens: 1, hybridisation: "sp2" },
      { name: "pentan-3-one", smiles: "CCC(=O)CC", labels: ["ketone", "two C substituents", "sp2", "120"], carbons: 2, hydrogens: 0, hybridisation: "sp2" },
    ],
  },
];

/** Exact atom/bond graph isomorphism, independent of name-parser atom ordering. */
function isomorphic(actual: Molecule, expected: Molecule): boolean {
  if (actual.atoms.length !== expected.atoms.length || actual.bonds.length !== expected.bonds.length) return false;
  const descriptor = (m: Molecule, index: number): string => {
    const a = m.atoms[index]!;
    return `${a.element}|${a.aromatic}|${a.charge}|${a.hydrogens}|${m.bonds.filter((b) => b.a === index || b.b === index).length}`;
  };
  const bond = (m: Molecule, a: number, b: number): string => {
    const found = m.bonds.find((edge) => (edge.a === a && edge.b === b) || (edge.a === b && edge.b === a));
    return found ? `${found.order}|${found.aromatic}` : "none";
  };
  const mapping = new Map<number, number>();
  const used = new Set<number>();
  const order = [...actual.atoms].sort((a, b) => expected.atoms.filter((e) => descriptor(actual, a.index) === descriptor(expected, e.index)).length - expected.atoms.filter((e) => descriptor(actual, b.index) === descriptor(expected, e.index)).length);
  const search = (at: number): boolean => {
    if (at === order.length) return true;
    const a = order[at]!.index;
    for (const e of expected.atoms) {
      if (used.has(e.index) || descriptor(actual, a) !== descriptor(expected, e.index)) continue;
      if ([...mapping].some(([other, target]) => bond(actual, a, other) !== bond(expected, e.index, target))) continue;
      mapping.set(a, e.index); used.add(e.index);
      if (search(at + 1)) return true;
      mapping.delete(a); used.delete(e.index);
    }
    return false;
  };
  return search(0);
}

for (const row of cases) check(row.name, () => {
  const raw = buildOrganicScene(row.question, [], false);
  const result = compileForLab(raw);
  assert(result.ok && result.renderScene && raw, `atomic builder/compile refusal: ${JSON.stringify(result.issues)}`);
  if (output) writeFileSync(resolve(output, `${row.name}.svg`), renderSceneSvg(result.renderScene, { title: row.question, subtitle: "source graph neighbourhood comparison" }));
  const labelPrimitives = result.renderScene.primitives.filter((p) => p.kind === "label");
  for (const [index, label] of labelPrimitives.entries()) {
    const box = (label.provenance?.labelCollisionBounds ?? label.provenance?.labelBounds) as LabelBounds | undefined;
    assert(box && box.x >= 400 && box.x + box.width <= 1160 && box.y >= 0 && box.y + box.height <= 700, `label clipped: ${label.text}`);
    for (const other of labelPrimitives.slice(index + 1)) {
      const otherBox = (other.provenance?.labelCollisionBounds ?? other.provenance?.labelBounds) as LabelBounds | undefined;
      assert(otherBox && !boundsOverlap(box, otherBox), `labels overlap: ${label.text} / ${other.text}`);
    }
  }
  const allLabels = result.labels;
  evidence.push({ name: row.name, compiled: true, labels: allLabels });
  for (const [index, expected] of row.panels.entries()) {
    const labels = result.renderScene.primitives.filter((p) => p.groupId === `m${index}_group` && p.kind === "label").map((p) => p.text ?? "");
    const text = normalized(labels.join(" "));
    assert(text.includes(normalized(expected.name)), `panel ${index}: full source name missing: ${JSON.stringify(labels)}`);
    for (const label of expected.labels) assert(text.includes(normalized(label)), `panel ${index}: missing ${label}: ${JSON.stringify(labels)}`);
  }
  const source = raw.source.organicComparison as { kind: string; models?: Array<{ molecule: Molecule; site: { atom: number; boundAtom: number; carbonNeighbours: number[]; hydrogens: number; hybridisation: string } }> } | undefined;
  assert(source?.models && source.models.length === row.panels.length, "all requested molecular graphs must be retained as computed source evidence");
  for (const [index, expected] of row.panels.entries()) {
    const model = source.models[index]!;
    assert(isomorphic(model.molecule, parseSmiles(expected.smiles)!), `panel ${index}: wrong complete connectivity`);
    assert.equal(model.site.carbonNeighbours.length, expected.carbons);
    assert.equal(model.site.hydrogens, expected.hydrogens);
    assert.equal(model.site.hybridisation, expected.hybridisation);
    const visibleLabel = (id: string): void => {
      assert(result.renderScene!.primitives.some((primitive) => primitive.kind === "label" && primitive.entityId === id), `explicit site/neighbour label missing: ${id}`);
    };
    for (const atom of [model.site.atom, model.site.boundAtom, ...model.site.carbonNeighbours]) visibleLabel(`m${index}_a${atom}`);
    if (source.kind === "carbonyl") {
      const point = (id: string): { x: number; y: number } => {
        const found = raw.constructions.find((construction) => construction.outputs.includes(`${id}_p`));
        assert(found && typeof found.inputs.x === "number" && typeof found.inputs.y === "number", `missing rendered anchor ${id}`);
        return { x: found.inputs.x, y: found.inputs.y };
      };
      const center = point(`m${index}_a${model.site.atom}`);
      const neighbours = [model.site.boundAtom, ...model.site.carbonNeighbours].map((atom) => point(`m${index}_a${atom}`));
      if (model.site.hydrogens === 1) { visibleLabel(`m${index}_h0`); neighbours.push(point(`m${index}_h0`)); }
      assert.equal(neighbours.length, 3, "all three carbonyl neighbours are explicit in the rendered graph");
      const vectors = neighbours.map((neighbour) => ({ x: neighbour.x - center.x, y: neighbour.y - center.y }));
      for (const [at, a] of vectors.entries()) for (const b of vectors.slice(at + 1)) {
        const angle = Math.acos((a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y))) * 180 / Math.PI;
        assert(Math.abs(angle - 120) < 0.1, `rendered carbonyl angle ${angle} is not approximately 120 degrees`);
      }
    }
  }
  assert.equal(raw.revealGroups.filter((group) => /^m\d+_group$/.test(group.id)).length, row.panels.length, "one complete reveal group per requested molecule");
  assert(!allLabels.some((label) => /primary.*secondary|secondary.*tertiary/.test(label)), "classes remain separate per panel");
});

for (const question of [
  "Draw butan-1-ol and unresolvablebutanol with their OH-bearing carbon identified. Classify each alcohol from its neighbours.",
  "Draw unresolvablebutanol, propan-1-ol and propan-2-ol with the OH-bearing carbon identified; classify each alcohol.",
  "Draw ethanol, propan-1-ol, butan-1-ol and pentan-1-ol with each OH-bearing carbon marked; classify all alcohols.",
  "Draw ethane-1,2-diol and propan-1-ol with the OH-bearing carbon identified; classify each alcohol.",
  "Draw butan-1-ol and butan-2-ol with their OH-bearing carbon marked, then show the complete oxidation mechanism.",
  "Draw hexanal and hexan-2-one with the carbonyl centres marked and show a measured carbonyl angle of 150 degrees.",
]) check(`atomic-decline-${question.slice(0, 45)}`, () => {
  assert.equal(buildOrganicScene(question, [], false) === null, true, "never draw a supported fragment of an unsupported requested comparison");
});
check("independent-connectivity-oracle-rejects-nearby-mutants", () => {
  for (const [a, b] of [["CCCCO", "CC(C)(C)O"], ["ClCc1ccccc1", "ClCCc1ccccc1"], ["CCCCCC=O", "CC(=O)CCCC"], ["CCCBr", "CC(C)Br"]]) {
    assert.equal(isomorphic(parseSmiles(a!)!, parseSmiles(b!)!), false);
  }
});


/** Whole-request admission: no delimiter may silently remove a requested member. */
for (const [name, question, expected] of [
  ["with-interleaved-members", "Draw butan-1-ol with its OH-bearing carbon labelled and butan-2-ol with its OH-bearing carbon labelled. Classify each alcohol.", ["butan-1-ol", "butan-2-ol"]],
  ["second-draw-sentence", "Draw butan-1-ol with the OH-bearing carbon labelled. Draw butan-2-ol as a second structure and classify both alcohols.", ["butan-1-ol", "butan-2-ol"]],
  ["semicolon-members", "Draw propan-1-ol; propan-2-ol. Mark each OH-bearing carbon and classify both alcohols.", ["propan-1-ol", "propan-2-ol"]],
  ["as-interleaved-members", "Sketch propan-2-ol as one structural diagram and propan-1-ol as another structural diagram. Identify each OH-bearing carbon and classify both alcohols.", ["propan-2-ol", "propan-1-ol"]],
  ["compare-with-member", "Compare butan-2-ol with butan-1-ol, marking each OH-bearing carbon and classifying both alcohols.", ["butan-2-ol", "butan-1-ol"]],
  ["also-draw-member", "Draw the structure of pentan-1-ol. Also draw pentan-2-ol. Mark each OH-bearing carbon and classify both alcohols.", ["pentan-1-ol", "pentan-2-ol"]],
] as const) check(`complete-request-${name}`, () => {
  const raw = buildOrganicScene(question, [], false);
  const compiled = compileForLab(raw);
  assert(raw && compiled.ok && compiled.renderScene, "all supported requested structures must draw together");
  const source = raw.source.organicComparison as { models: Array<{ name: string }> };
  assert.deepEqual(source.models.map((model) => model.name), [...expected], "preserve complete source member order");
  for (const [index, member] of expected.entries()) {
    const labels = compiled.renderScene.primitives.filter((primitive) => primitive.kind === "label" && primitive.groupId === `m${index}_group`).map((primitive) => primitive.text ?? "");
    assert(normalized(labels.join(" ")).includes(normalized(member)), `complete member missing from actual render: ${member}`);
  }
});
for (const [name, question] of [
  ["unknown-after-with", "Draw butan-1-ol with its OH-bearing carbon labelled and unresolvablebutanol alongside it. Classify both alcohols."],
  ["unknown-semicolon-tail", "Draw propan-1-ol; propan-2-ol; unresolvablebutanol. Mark each OH-bearing carbon and classify all three alcohols."],
  ["unknown-first", "Draw mysteryalcohol with its OH-bearing carbon marked and butan-1-ol beside it. Classify both alcohols."],
  ["unknown-second-sentence", "Draw propan-2-ol with the OH-bearing carbon identified. Also draw puzzlingbutanol. Classify both alcohols."],
  ["unknown-middle", "Compare butan-1-ol; unparsedpentanol; butan-2-ol. Mark the OH-bearing carbon and classify each alcohol."],
  ["unknown-after-as", "Sketch butan-2-ol as one structure and unseenhexanol as the other. Mark the OH-bearing carbon and classify each alcohol."],
  ["unsupported-known-member-after-with", "Draw butan-1-ol with its OH-bearing carbon labelled and ethanoic acid alongside it. Classify each alcohol."],
  ["boiling-order", "Draw butan-1-ol and butan-2-ol with their OH-bearing carbon marked, and show their boiling-point order on the diagram. Classify each alcohol."],
  ["formula-labels", "Draw butan-1-ol and butan-2-ol with their OH-bearing carbon marked. Label each structure with its molecular formula and classify each alcohol."],
  ["sigma-pi-labels", "Draw hexanal and hexan-2-one so that their carbonyl centres are marked. Label the total sigma and pi bond counts on each structure."],
  ["formula-before-draw", "Label each molecular formula, then draw butan-1-ol and butan-2-ol with their OH-bearing carbon marked. Classify each alcohol."],
  ["boiling-second-sentence", "Draw propan-1-ol with its OH-bearing carbon identified; classify the alcohol. Show its boiling point."],
  ["carbon-bound-hydrogen-count", "Draw butan-1-ol with its OH-bearing carbon marked. Label its total carbon-bound hydrogen count and classify the alcohol."],
  ["unsupported-geometry", "Draw butan-1-ol with its OH-bearing carbon marked, and show its dipole moment. Classify the alcohol."],
] as const) check(`whole-request-decline-${name}`, () => {
  assert.equal(buildOrganicScene(question, [], false), null, "never admit a partial member set or an unfulfilled diagram obligation");
});
for (const name of ["allyl chloride", "3-chloroprop-1-ene"]) check(`allylic-name-${name}`, () => {
  const question = `Draw ${name} with the carbon carrying Cl identified; label its hybridisation and classify the C-Cl site as allylic.`;
  const raw = buildOrganicScene(question, [], false);
  const compiled = compileForLab(raw);
  assert(raw && compiled.ok && compiled.renderScene, "supported allylic graph must compile");
  const labels = normalized(compiled.labels.join(" "));
  assert(labels.includes("primaryallylic") && labels.includes("sp3"), "actual labels must include graph-derived primary allylic sp3 site");
  const source = raw.source.organicComparison as { models: Array<{ site: { classification: string; carbonNeighbours: number[]; hybridisation: string } }> };
  assert.equal(source.models[0]!.site.classification, "primary allylic");
  assert.equal(source.models[0]!.site.carbonNeighbours.length, 1);
  assert.equal(source.models[0]!.site.hybridisation, "sp3");
});
for (const [name, smiles, classification, degree, hybridisation] of [
  ["primary-allylic", "C=CCCl", "primary allylic", 1, "sp3"],
  ["secondary-allylic", "CC(Cl)C=C", "secondary allylic", 2, "sp3"],
  ["tertiary-allylic", "CC(C)(Cl)C=C", "tertiary allylic", 3, "sp3"],
  ["internal-alkene-allylic", "CC=CCCl", "primary allylic", 1, "sp3"],
  ["homoallylic-is-alkyl", "C=CCCCl", "primary alkyl", 1, "sp3"],
  ["saturated-primary", "CCCCl", "primary alkyl", 1, "sp3"],
  ["vinylic-is-not-allylic", "ClC=C", "vinylic", 1, "sp2"],
  ["aryl-is-not-allylic", "Clc1ccccc1", "aryl", 2, "sp2"],
  ["benzylic-is-not-allylic", "ClCc1ccccc1", "primary benzylic", 1, "sp3"],
  ["dual-benzylic-allylic", "C=CC(Cl)c1ccccc1", "secondary benzylic allylic", 2, "sp3"],
] as const) check(`graph-derived-site-${name}`, () => {
  const graph = parseSmiles(smiles);
  assert(graph);
  const site = carbonSiteFacts(graph, "halide");
  assert(site);
  assert.equal(site.classification, classification);
  assert.equal(site.carbonNeighbours.length, degree);
  assert.equal(site.hybridisation, hybridisation);
});
for (const smiles of ["CC(Cl)Cl", "ClCCCCl", "ClC#C", "ClCC.CC", "Cl[CH-]C"]) check(`unsafe-halide-site-${smiles}`, () => {
  const graph = parseSmiles(smiles);
  assert(!graph || carbonSiteFacts(graph, "halide") === null, "ambiguous, disconnected, charged or unsupported site cannot be labelled by this operator");
});


for (const [kind, smiles] of [
  ["halide", "ClCCC(Cl)Cl"],
  ["halide", "ClC#CCCCl"],
  ["alcohol", "OCCc1ccccc1O"],
  ["carbonyl", "CC(=O)CCC(=O)O"],
] as const) check(`complete-target-motif-inventory-${kind}-${smiles}`, () => {
  const graph = parseSmiles(smiles);
  assert(graph);
  assert.equal(carbonSiteFacts(graph, kind), null, "an unsupported second requested motif must not disappear from the site inventory");
});

/** Carbonyl C-X is acyl, not the alkene C-X required for a vinylic site. */
for (const [name, smiles] of [
  ["acetyl chloride", "CC(=O)Cl"],
  ["ethanoyl chloride", "CC(=O)Cl"],
  ["benzoyl chloride", "O=C(Cl)c1ccccc1"],
] as const) check(`acyl-connectivity-${name}`, () => {
  const question = `Draw ${name} with the carbon carrying Cl identified; classify the C-Cl site and label its hybridisation.`;
  const raw = buildOrganicScene(question, [], false);
  const result = compileForLab(raw);
  assert(raw && result.ok && result.renderScene);
  const source = raw.source.organicComparison as { models: Array<{ molecule: Molecule; site: { classification: string; hybridisation: string } }> };
  assert.equal(source.models.length, 1);
  assert(isomorphic(source.models[0]!.molecule, parseSmiles(smiles)!));
  assert.equal(source.models[0]!.site.classification, "acyl halide");
  assert.equal(source.models[0]!.site.hybridisation, "sp2");
  assert(normalized(result.labels.join(" ")).includes("acylhalide"));
  assert(!result.labels.some(label => /vinylic/i.test(label)));
});
check("distinct-benzylic-and-acyl-panels", () => {
  const raw = buildOrganicScene("Draw benzyl chloride and acetyl chloride with the carbon carrying Cl identified; classify the C-Cl site and label its hybridisation.", [], false);
  const result = compileForLab(raw);
  assert(raw && result.ok && result.renderScene);
  const source = raw.source.organicComparison as { models: Array<{ site: { classification: string } }> };
  assert.deepEqual(source.models.map(model => model.site.classification), ["primary benzylic", "acyl halide"]);
  assert.equal(raw.revealGroups.filter(group => /^m\d+_group$/.test(group.id)).length, 2);
});
for (const [name, question] of [
  ["another-structure", "Draw chloroethane with the carbon carrying Cl marked. Also draw another structure. Classify each C-Cl site."],
  ["other-structure", "Draw chloroethane. Also draw the other structure. Identify the carbon carrying Cl in each, label its hybridisation and classify each C-Cl site."],
  ["missing-phenyl", "Draw chloroethane with the carbon carrying Cl identified. Show the phenyl ring and classify the C-Cl site."],
  ["new-phenyl-object", "Draw chloroethane with the carbon carrying Cl identified. Also draw a phenyl ring as another structural diagram. Classify the C-Cl site."],
  ["and-another-object", "Draw chloroethane and another structure with the carbon carrying Cl marked; classify each C-Cl site."],
  ["new-sketch-object", "Draw benzyl chloride with the carbon carrying Cl identified. Then sketch another diagram and classify each C-Cl site."],
  ["possessive-missing-ring", "Draw chloroethane with the carbon carrying Cl identified. Show its phenyl ring and classify the C-Cl site."],
  ["wrong-figure-cardinality", "Draw chloroethane as three separate structural diagrams. Identify the carbon carrying Cl and classify each C-Cl site."],
  ["unresolved-ordinal", "Draw chloroethane with the carbon carrying Cl identified. Draw the second structure and classify each C-Cl site."],
] as const) check(`bound-request-refusal-${name}`, () => {
  assert.equal(buildOrganicScene(question, [], false), null, "every drawn object and graph property needs a resolved source member");
});
for (const [name, question, names] of [
  ["named-additional-object", "Draw chloroethane with the carbon carrying Cl marked. Also draw another structure of chlorobenzene and classify each C-Cl site.", ["chloroethane", "chlorobenzene"]],
  ["real-phenyl-property", "Draw benzyl chloride with the carbon carrying Cl identified. Show its phenyl ring and classify the C-Cl site.", ["benzyl chloride"]],
  ["resolved-repeat-reference", "Draw chloroethane with the carbon carrying Cl identified. Draw its structure and classify the C-Cl site.", ["chloroethane"]],
] as const) check(`bound-request-control-${name}`, () => {
  const raw = buildOrganicScene(question, [], false);
  const result = compileForLab(raw);
  assert(raw && result.ok && result.renderScene);
  const source = raw.source.organicComparison as { models: Array<{ name: string }> };
  assert.deepEqual(source.models.map(model => model.name), names);
});

for (const question of [
  "Draw chloroethane with its carbon carrying Cl marked and a structural diagram. Classify each C-Cl site.",
  "Draw chloroethane with the carbon carrying Cl marked and another. Classify each C-Cl site.",
]) check(`unbound-structural-argument-${question}`, () => {
  assert.equal(buildOrganicScene(question, [], false), null, "structural arguments cannot be discharged as grammar words");
});
check("named-structure-object-before-member", () => {
  const raw = buildOrganicScene("Draw the structure of chloroethane with the carbon carrying Cl identified; classify the C-Cl site.", [], false);
  assert(raw && compileForLab(raw).ok);
});


/** Independent second review: member counts, target atoms and explicit properties. */
for (const [name, question] of [
  [
    "wrong-target-Cl-on-Br",
    "Draw bromoethane with the carbon carrying Cl identified; classify the C-Cl site and label its hybridisation."
  ],
  [
    "wrong-target-Br-on-Cl",
    "Draw chloroethane with the carbon carrying Br identified; classify the C-Br site and label its hybridisation."
  ],
  [
    "multi-extra-one-later-member",
    "Draw chloroethane. Also draw another structure and another structure, chloromethane. Classify each C-Cl site and label its hybridisation."
  ],
  [
    "multi-extra-no-initial",
    "Draw another structure and another structure, chloroethane. Classify the C-Cl site and label its hybridisation."
  ],
  [
    "contradictory-sp3-acyl",
    "Draw acetyl chloride with the carbon carrying Cl identified. Label its hybridisation as sp3 and classify the C-Cl site."
  ],
  [
    "contradictory-class-alcohol",
    "Draw propan-2-ol as a structural diagram with its OH-bearing carbon marked. Classify it as a primary alcohol from its carbon neighbours."
  ],
  [
    "swapped-named-classification",
    "Draw propan-1-ol and propan-2-ol with their OH-bearing carbon marked. Classify propan-1-ol as secondary and propan-2-ol as primary alcohols."
  ]
] as const) check(`bound-property-refusal-${name}`, () => {
  assert.equal(buildOrganicScene(question, [], false), null);
});
for (const [name, question, expected] of [
  [
    "correct-acyl-hybrid",
    "Draw acetyl chloride with the carbon carrying Cl identified. Label its hybridisation as sp2 and classify the C-Cl site.",
    [
      "acetyl chloride"
    ]
  ],
  [
    "correct-alcohol-class",
    "Draw propan-2-ol as a structural diagram with its OH-bearing carbon marked. Classify it as a secondary alcohol from its carbon neighbours.",
    [
      "propan-2-ol"
    ]
  ],
  [
    "distinct-extra-members",
    "Draw another structure, chloroethane, and another structure, chloromethane. Classify each C-Cl site and label its hybridisation.",
    [
      "chloroethane",
      "chloromethane"
    ]
  ],
  [
    "class-options",
    "Draw propan-2-ol with its OH-bearing carbon marked. Classify it as primary or secondary alcohol.",
    [
      "propan-2-ol"
    ]
  ],
  [
    "local-mixed-targets",
    "Draw chloroethane with the carbon carrying Cl identified and bromoethane with the carbon carrying Br identified. Classify each site and label its hybridisation.",
    [
      "chloroethane",
      "bromoethane"
    ]
  ],
  [
    "named-label-reference",
    "Draw chloroethane with the carbon carrying Cl marked. Label chloroethane hybridisation as sp3 and classify the C-Cl site.",
    [
      "chloroethane"
    ]
  ],
  [
    "named-class-references",
    "Draw propan-1-ol and propan-2-ol with their OH-bearing carbon marked. Classify propan-1-ol as primary and propan-2-ol as secondary alcohols.",
    [
      "propan-1-ol",
      "propan-2-ol"
    ]
  ]
] as const) check(`bound-property-control-${name}`, () => {
  const raw = buildOrganicScene(question, [], false);
  assert(raw && compileForLab(raw).ok);
  const source = raw.source.organicComparison as { models: Array<{ name: string }> };
  assert.deepEqual(source.models.map(model => model.name), expected);
});

for (const verb of ["Label", "Classify"]) check(`no-as-class-refusal-${verb}`, () => {
  assert.equal(buildOrganicScene(`Draw propan-2-ol with the OH-bearing carbon marked. ${verb} it primary alcohol.`, [], false), null);
});
check("no-as-correct-class-control", () => {
  const raw = buildOrganicScene("Draw propan-2-ol with the OH-bearing carbon marked. Label it secondary alcohol.", [], false);
  assert(raw && compileForLab(raw).ok);
});

for (const verb of ["Classify", "Label"]) for (const secondClass of ["primary", "secondary"]) check(`no-as-named-owner-${verb}-${secondClass}`, () => {
  const question = `Draw propan-1-ol and propan-2-ol with their OH-bearing carbon marked. ${verb} propan-1-ol primary and propan-2-ol ${secondClass} alcohols.`;
  const raw = buildOrganicScene(question, [], false);
  if (secondClass === "primary") { assert.equal(raw, null); return; }
  assert(raw && compileForLab(raw).ok);
  const source = raw.source.organicComparison as { models: Array<{ name: string; site: { classification: string } }> };
  assert.deepEqual(source.models.map(model => [model.name, model.site.classification]), [["propan-1-ol", "primary alcohol"], ["propan-2-ol", "secondary alcohol"]]);
});

/** Accepted property obligations must appear on the compiled owning panel. */
for (const [name, question, expected] of [
  ["review-alcohol-sp3", "Draw propan-2-ol with its OH-bearing carbon labelled sp3.", ["propan-2-ol"]],
  ["primary-alcohol-sp3", "Draw propan-1-ol with its OH-bearing carbon labelled sp3.", ["propan-1-ol"]],
  ["tertiary-alcohol-sp3", "Draw 2-methylpropan-2-ol with its OH-bearing carbon labelled sp3.", ["2-methylpropan-2-ol"]],
  ["alcohol-hybridisation-caption", "Draw butan-2-ol with its OH-bearing carbon labelled. Label its hybridisation sp3.", ["butan-2-ol"]],
  ["two-alcohol-hybridisation-captions", "Draw propan-1-ol and propan-2-ol with their OH-bearing carbon labelled sp3.", ["propan-1-ol", "propan-2-ol"]],
  ["three-alcohol-hybridisation-captions", "Draw butan-1-ol, butan-2-ol and 2-methylpropan-2-ol with their OH-bearing carbon labelled sp3.", ["butan-1-ol", "butan-2-ol", "2-methylpropan-2-ol"]],
] as const) check(`rendered-${name}`, () => {
  const raw = buildOrganicScene(question, [], false);
  const result = compileForLab(raw);
  assert(raw && result.ok && result.renderScene, "complete supported alcohol request must draw");
  for (const [index, member] of expected.entries()) {
    const labels = result.renderScene.primitives.filter(primitive => primitive.kind === "label" && primitive.groupId === `m${index}_group`).map(primitive => primitive.text ?? "");
    const text = normalized(labels.join(" "));
    assert(text.includes(normalized(member)), `complete source name missing from panel ${index}`);
    assert(text.includes("sp3"), `requested sp3 missing from owning alcohol panel ${index}`);
    assert(text.includes("ohbearingc"), `OH-bearing carbon identification missing from panel ${index}`);
  }
});
for (const hybridisation of ["sp", "sp2"]) check(`wrong-alcohol-hybridisation-${hybridisation}`, () => {
  assert.equal(buildOrganicScene(`Draw propan-2-ol with its OH-bearing carbon labelled ${hybridisation}.`, [], false), null);
});

/** Ordinal references bind properties to source-ordered members, not the whole panel. */
import "../../src/chemistry/families";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import ordinalCases from "./fixtures/organic-ordinal-owners.json";
for (const row of ordinalCases) for (const route of ["direct", "schematic", "ordinary", "lastResort"] as const) check(`ordinal-owner-${row.id}-${route}`, () => {
  const candidate = route === "direct" || route === "schematic" ? buildOrganicScene(row.question, [], route === "schematic")
    : route === "ordinary" ? synthesizeFamilyScene({ question: row.question }) : synthesizeLastResortScene({ question: row.question });
  assert.equal(!!candidate, row.draw, "whole-request ownership oracle");
  if (!candidate) return;
  const document = "document" in candidate ? candidate.document : candidate;
  const result = compileForLab(document);
  assert(result.ok && result.renderScene, "entire admitted figure must compile normally");
  const source = document.source.organicComparison as { models: Array<{ name: string; site: { classification: string } }> };
  assert.deepEqual(source.models.map(model => [model.name, model.site.classification]), row.panels, "original ordered graph/class gold");
  for (const [index, [member, classification]] of row.panels.entries()) {
    const labels = result.renderScene.primitives.filter(primitive => primitive.kind === "label" && primitive.groupId === `m${index}_group`).map(primitive => primitive.text ?? "");
    assert(normalized(labels.join(" ")).includes(normalized(member!)), `full source name missing in panel ${index}`);
    assert(normalized(labels.join(" ")).includes(normalized(classification!)), `computed class missing in panel ${index}`);
  }
});

if (output) writeFileSync(resolve(output, "summary.json"), JSON.stringify({ passed, failures, cases: cases.length, evidence }, null, 2) + "\n");
console.log(`verify-organic-neighbourhood-panels: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
