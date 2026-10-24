/**
 * A VSEPR shape writes its characteristic bond angle whether or not the stem
 * says "angle", and the angle stays source-certified.
 *
 *   table      the blind-judge rows (BF3 120°, PCl5 90°, CO2 180°, SF6 90°)
 *              and neighbours, on shape-only stems, carry the source angle
 *              and its claim kind; XeF2 (no in-plane pair) carries none.
 *              An honest arc carries the bare value; NH3 (plain to wedge,
 *              sector holding the dashed H) and SF4 (wedge to dash) write it
 *              as a caption naming the atoms instead (C5, 24 Oct)
 *   sweep      every drawn species in VSEPR_PROBES with a single true angle
 *              carries exactly that label, and no other degree label appears
 *   authority  the drawn angle is certified from the regenerated graph with
 *              no planner scalar; a wrong planner angle still refuses
 *   charge     a charge written apart from the formula (SO3 2-, NO2 -,
 *              SO3 -2, a Unicode minus, "the SO3 ion") that the reader does
 *              not carry declines the whole figure, never the neutral shape
 *              with its false angle (sulfite 120°, nitrite 134°; T5, 24 Oct);
 *              attached forms still draw their true angle; hyphen controls
 *              (C-H bond, sp3-hybridised, pH 3-4, 2-methylpropane) are no charge
 *   pair       a steric number 5 or 6 angle names its pair: an arc sweeps the
 *              value on the page, a caption says ax-eq, eq. or cis; a pair it
 *              cannot name in the compact limit writes none (PCl5 in a
 *              compare stem wrote "Cl-P-Cl = 90°", which reads as THE angle)
 *   mutation   a drawSpecies that writes no angle turns the table and sweep
 *              red, so these rows depend on the drawing, not on the stem; a
 *              build that draws nothing turns every sweep row red; a reader
 *              that ignores the charge, or a caption without its pair words,
 *              turns the charge and pair rows red
 */
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { TurnPlanQuantityV3, TurnPlanV3 } from "../../src/contracts/contractsV3";
import { certifyVseprSourceDocument } from "../../src/chemistry/sourceEvidence";
import { readChargeMarkers } from "../../src/chemistry/chargeMarker";
import { buildVseprFigure, characteristicAngle, VSEPR_PROBES, vseprSpecies } from "../../src/chemistry/vsepr";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import type { SceneDocument } from "../../src/types";

type Build = typeof buildVseprFigure;
interface Row { id: string; question: string; angle: string | null; text?: string; claim?: "ideal" | "quoted" | "inequality" }

const TABLE: Row[] = [
  { id: "bf3-hybridisation", question: "hybridisation of BF3", angle: "120°", claim: "ideal" },
  { id: "pcl5-geometry", question: "geometry of PCl5", angle: "90°", claim: "ideal" },
  { id: "co2-linear", question: "why is CO2 linear", angle: "180°", claim: "ideal" },
  { id: "sf6-shape", question: "shape of SF6", angle: "90°", claim: "ideal" },
  { id: "ch4-shape", question: "What is the shape of CH4?", angle: "109.5°", claim: "ideal" },
  { id: "nh3-shape", question: "What is the shape of NH3?", angle: "107°", text: "H-N-H = 107°", claim: "quoted" },
  { id: "h2o-shape", question: "What is the shape of H2O?", angle: "104.5°", claim: "quoted" },
  { id: "sf4-shape", question: "What is the shape of SF4?", angle: "<120°", text: "eq. F-S-F <120°", claim: "inequality" },
  { id: "xef2-shape", question: "What is the shape of XeF2?", angle: null },
];

function labels(document: SceneDocument): string[] {
  return document.entities.flatMap((entity) => entity.label ? [entity.label] : []);
}
const degrees = (document: SceneDocument) => labels(document).filter((label) => /°/.test(label));
/** The value a degree label shows: "107°" on an arc, the tail of "H-N-H = 107°". */
const valueOf = (label: string) => /(?:^|\s)([<>]?\d+(?:\.\d+)?°)$/.exec(label)?.[1] ?? label;
const shown = (row: Row) => row.text ?? row.angle!;

function tableRed(build: Build): string[] {
  return TABLE.filter((row) => {
    const figure = build(row.question, [], false);
    if (!figure) return true;
    const drawn = degrees(figure.document);
    const claims = labels(figure.document).filter((label) => /^(?:ideal|quoted|inequality)$/.test(label));
    return row.angle === null
      ? drawn.length > 0 || claims.length > 0
      : drawn.length !== 1 || drawn[0] !== shown(row) || claims.length !== 1 || claims[0] !== row.claim;
  }).map((row) => `table/${row.id}`);
}

function sweepRed(build: Build): string[] {
  return VSEPR_PROBES.filter((probe) => probe.expect === "draw").filter((probe) => {
    const figure = build(probe.question, [], false);
    // A probe that expects a drawing and draws nothing is a failure.
    if (!figure) return true;
    const expected = vseprSpecies(probe.question).map(characteristicAngle).filter((angle): angle is string => angle !== null);
    return JSON.stringify(degrees(figure.document).map(valueOf).sort()) !== JSON.stringify([...expected].sort());
  }).map((probe) => `sweep/${probe.question}`);
}

const failures: string[] = [];
let passed = 0;
async function check(id: string, run: () => void | Promise<void>): Promise<void> {
  try { await run(); passed++; }
  catch (error) { failures.push(id); console.log(`FAIL ${id}: ${error instanceof Error ? error.message : String(error)}`); }
}

await check("table", () => assert.deepEqual(tableRed(buildVseprFigure), []));
await check("sweep", () => assert.deepEqual(sweepRed(buildVseprFigure), []));
await check("sweep-has-angles", () => {
  const drawn = VSEPR_PROBES.filter((probe) => probe.expect === "draw" && !/\bangles?\b|°|\bdegrees?\b/i.test(probe.question))
    .filter((probe) => vseprSpecies(probe.question).some((result) => characteristicAngle(result) !== null));
  assert.ok(drawn.length >= 5, `shape-only probes with a characteristic angle: ${drawn.length}`);
});

function plan(question: string, derived: TurnPlanQuantityV3[] = []): TurnPlanV3 {
  return { schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [], derived, unknowns: [],
    qualitativeClaims: [], lawIds: ["VSEPR theory"], assumptions: [] };
}
for (const row of TABLE.filter((entry) => entry.angle !== null)) {
  await check(`authority/${row.id}`, () => {
    // The document the family loop hands to selection, as the tutor gate does.
    const scene = synthesizeFamilyScene({ question: row.question, turnPlan: plan(row.question) });
    assert.equal(scene?.family, "chem_vsepr");
    assert.ok(degrees(scene.document).includes(shown(row)), "the family scene keeps the angle");
    const certificate = certifyVseprSourceDocument(scene.document, row.question, plan(row.question));
    assert.equal(certificate.status, "certified");
    assert.ok(certificate.status === "certified" && certificate.texts.includes(shown(row)), "the drawn angle is a certified text");
  });
}
await check("authority/plan-angle-checked", () => {
  const question = "What is the shape of H2O?";
  const angle = (value: number): TurnPlanQuantityV3 => ({ id: "theta", symbol: "bond_angle_H2O", value, unit: "degree", sourceText: "bond angle in H2O", provenance: "derived" });
  for (const [value, status] of [[109.5, "rejected"], [104.5, "certified"]] as const) {
    const withAngle = plan(question, [angle(value)]);
    const scene = synthesizeFamilyScene({ question, turnPlan: withAngle });
    assert.ok(scene);
    assert.equal(certifyVseprSourceDocument(scene.document, question, withAngle).status, status, `planner angle ${value}`);
  }
});

/** A charge written apart from the formula, or as a word, that no read species carries. */
const SPACED_CHARGE = ["shape of NO2 -", "shape of SO3 2-", "shape of the SO3 2- ion", "shape of SeO3 2-", "shape of SO3 -2", "shape of SO3 2\u2212", "What is the shape of the SO3 ion?"];
/** Attached charges the reader carries, with the true angle (null: the shape has none in the table). */
const ATTACHED_CHARGE: ReadonlyArray<readonly [string, string | null]> = [
  ["shape of NO2-", "115°"], ["shape of NH4\u207a", "109.5°"], ["shape of ClO4-", "109.5°"], ["shape of NO2+", "180°"],
  ["shape of SO3^2-", null], ["shape of SO\u2083\u00b2\u207b", null], ["The shape of I3- ion is:", null],
];
const HYPHEN_CONTROLS: ReadonlyArray<readonly [string, string]> = [
  ["shape of C-H bond in CH4", "C-H bond"], ["shape of sp3-hybridised CH4", "sp3-hybridised"], ["shape of CH4 at pH 3-4", "pH 3-4"],
];

function chargeRed(build: Build): string[] {
  const red: string[] = [];
  for (const question of SPACED_CHARGE) if (build(question, [], false)) red.push(`charge/declines/${question}`);
  for (const [question, angle] of ATTACHED_CHARGE) {
    const figure = build(question, [], false);
    if (!figure || JSON.stringify(degrees(figure.document)) !== JSON.stringify(angle ? [angle] : [])) red.push(`charge/attached/${question}`);
  }
  for (const [question] of HYPHEN_CONTROLS) {
    const figure = build(question, [], false);
    if (!figure || JSON.stringify(degrees(figure.document)) !== JSON.stringify(["109.5°"])) red.push(`charge/hyphen/${question}`);
  }
  return red;
}

/**
 * Stems whose figures hold steric number 5 and 6 shapes, single and in rows
 * small enough that the value falls back to a caption. The first two are the
 * #287 review rows.
 */
const PAIR_STEMS = [
  "Compare the bond angles of PCl5, ClF3, BrF5 and XeF4", "Shapes of PCl5 and SF4",
  "Shapes of SF6, BrF5, XeF4 and PF5", "Shapes of ClF3, BrF3, SF4 and XeF2", "Compare the bond angles of PCl5 and PF5",
  ...["PCl5", "PF5", "SF4", "ClF3", "BrF3", "XeF2", "SF6", "BrF5", "IF5", "XeF4", "ICl4-"].map((formula) => `What is the shape of ${formula}?`),
];
/** The words that name the marked pair, by steric number and lone pairs (an oracle apart from the layout's seats). */
const PAIR_WORDS: Record<string, string> = { "5-0": "ax-eq ", "5-1": "eq. ", "5-2": "ax-eq ", "6-0": "cis ", "6-1": "cis ", "6-2": "cis " };

function pairRed(build: Build): string[] {
  const red: string[] = [];
  for (const question of PAIR_STEMS) {
    const figure = build(question, [], false);
    if (!figure) { red.push(`pair/${question}: no figure`); continue; }
    const species = vseprSpecies(question);
    const arcs = new Map(figure.document.constructions.filter((item) => item.operator === "arc")
      .map((item) => [item.outputs[0]!, Number(item.inputs.endAngle) - Number(item.inputs.startAngle)] as const));
    for (const entity of figure.document.entities) {
      if (!entity.label || !/°/.test(entity.label)) continue;
      const tag = /^(m\d+)_ang_(val|txt)$/.exec(entity.id);
      const result = tag ? species[Number(tag[1]!.slice(1)) - 1] : undefined;
      if (!tag || !result) { red.push(`pair/${question}: stray degree label ${entity.id} ${entity.label}`); continue; }
      if (result.stericNumber < 5) continue;
      if (tag[2] === "val") {
        // A bare value is honest only on an arc that sweeps it on the page.
        const sweep = arcs.get(`${tag[1]}_ang`);
        const value = Number(/\d+(?:\.\d+)?/.exec(entity.label)?.[0]);
        if (sweep === undefined || Math.abs(sweep - value) > 5) red.push(`pair/${question}: ${result.formula} value ${entity.label} sweeps ${sweep}`);
      } else {
        const words = PAIR_WORDS[`${result.stericNumber}-${result.lonePairs}`];
        if (!words || !entity.label.startsWith(words)) red.push(`pair/${question}: ${result.formula} caption "${entity.label}" does not name its pair`);
      }
    }
  }
  return red;
}

await check("charge", () => {
  assert.deepEqual(chargeRed(buildVseprFigure), []);
  for (const question of SPACED_CHARGE) {
    assert.deepEqual(vseprSpecies(question), [], `${question}: the reader declines the species`);
    assert.notEqual(synthesizeFamilyScene({ question, turnPlan: plan(question) })?.family, "chem_vsepr", `${question}: no VSEPR family scene`);
  }
});
await check("charge/hyphen-markers", () => {
  for (const [, phrase] of [...HYPHEN_CONTROLS, ["", "2-methylpropane"] as const]) assert.deepEqual(readChargeMarkers(phrase), [], `${phrase} is not a charge`);
});
await check("pair", () => assert.deepEqual(pairRed(buildVseprFigure), []));
await check("pair/review-rows-have-no-unqualified-pcl5", () => {
  for (const question of PAIR_STEMS.slice(0, 2)) {
    const figure = buildVseprFigure(question, [], false);
    assert.ok(figure, question);
    assert.ok(!labels(figure.document).some((label) => /^Cl-P-Cl\b/.test(label)), `${question}: ${degrees(figure.document).join(", ")}`);
  }
});

// Mutant: a copy of vsepr.ts beside it, so its relative imports resolve.
const source = fileURLToPath(new URL("../../src/chemistry/vsepr.ts", import.meta.url));
const original = readFileSync(source, "utf8");
async function mutant(name: string, from: string, to: string): Promise<Build> {
  assert.ok(original.includes(from), `mutation anchor is missing: ${name}`);
  const text = original.replace(from, to);
  assert.notEqual(text, original);
  const path = source.replace(/vsepr\.ts$/, `vsepr.mutant-${name}-${process.pid}.ts`);
  writeFileSync(path, text);
  try { return ((await import(path)) as { buildVseprFigure: Build }).buildVseprFigure; }
  finally { rmSync(path, { force: true }); }
}
await check("mutation/charge-ignored", async () => {
  const build = await mutant("charge", "  if (!chargeMarkersCarried(text, species.map((result) => result.formula))) return [];\n", "");
  assert.deepEqual(chargeRed(build), SPACED_CHARGE.map((question) => `charge/declines/${question}`), "every spaced charge row goes red, the controls stay green");
});
await check("mutation/caption-without-pair-words", async () => {
  const build = await mutant("pair", "  const prefix = anglePairQualifier(result.stericNumber, seated[a]!.slot.seat, seated[b]!.slot.seat);\n", "  const prefix = \"\";\n");
  const red = pairRed(build);
  for (const question of PAIR_STEMS.slice(0, 2)) assert.ok(red.some((row) => row.startsWith(`pair/${question}:`)), `${question} goes red: ${red.join("; ")}`);
});
await check("mutation/no-angle", async () => {
  const from = "  const characteristic = characteristicAngle(result);\n";
  assert.ok(original.includes(from), "mutation anchor is missing");
  const text = original.replace(from, "  const characteristic: string | null = null;\n");
  assert.notEqual(text, original);
  const path = source.replace(/vsepr\.ts$/, `vsepr.mutant-no-angle-${process.pid}.ts`);
  writeFileSync(path, text);
  let build: Build;
  try { build = ((await import(path)) as { buildVseprFigure: Build }).buildVseprFigure; }
  finally { rmSync(path, { force: true }); }
  const table = tableRed(build);
  assert.deepEqual(table, TABLE.filter((row) => row.angle !== null).map((row) => `table/${row.id}`), "every angle row goes red, XeF2 stays green");
  assert.ok(sweepRed(build).length >= 5, "the sweep goes red");
});

// Mutant: a build that draws nothing. A missing figure on a probe that
// expects a drawing must turn every sweep row red, never pass it.
await check("mutation/no-figure", () => {
  const draws = VSEPR_PROBES.filter((probe) => probe.expect === "draw");
  assert.ok(draws.length >= 5, `draw probes: ${draws.length}`);
  assert.deepEqual(sweepRed(() => null), draws.map((probe) => `sweep/${probe.question}`), "every draw probe goes red without its figure");
});

console.log(`verify-vsepr-characteristic-angle: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
