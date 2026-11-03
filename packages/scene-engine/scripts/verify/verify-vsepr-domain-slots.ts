/**
 * A VSEPR figure puts every electron domain where its geometry puts it, and
 * an arc's page sector reads as the value written at it.
 *
 *   slots   in a steric number 5 or 6 figure every bond and lone pair sits on
 *           its own slot of the parent geometry as drawn (the 5-0 and 6-0
 *           perspectives, or their mirror), within 25°. Trigonal bipyramid
 *           lone pairs are equatorial; octahedral lone pairs keep apart (two
 *           trans, three meridional, one trans to the apex). Main drew XeF4
 *           flat with its lone pairs 45° from two F, XeF2's lone pairs 30°
 *           from the axial F, and AX3E3's two lone pairs at 30° to each other.
 *   arcs    an arc's swept sector is its value within a degree, below a "<"
 *           value and above a ">" value, for single molecules and rows. Main
 *           wrote BrF5's <90° on a right angle.
 *   pairs   two lone pairs never read as one chain of dots: the nearest dots
 *           of two pairs are at least 1.8 times as far apart as the two dots
 *           of one pair. Main's ClF3, XeF2 and AX3E3 pairs were 1.1 to 1.4.
 *   mutation  main's 5-3, 6-2 and 6-3 layouts turn their slot rows red; an arc
 *           drawn on any pair turns the BrF5 arc rows red.
 */
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildVseprFigure, vseprSpecies } from "../../src/chemistry/vsepr";
import type { SceneDocument } from "../../src/types";

type Build = typeof buildVseprFigure;
type P = { x: number; y: number };

const TOLERANCE = 25;
const TBP = { axial: [90, 270], equatorial: [180, 330, 30] };
const OCT = [90, 270, 180, 0, 225, 45];
const mirror = (deg: number) => (540 - deg) % 360;
const gap = (a: number, b: number) => { const d = Math.abs((((a - b) % 360) + 360) % 360); return Math.min(d, 360 - d); };

function at(document: SceneDocument, id: string): P | null {
  const point = document.constructions.find((item) => item.outputs.includes(id));
  if (!point) return null;
  const x = Number(point.inputs.x), y = Number(point.inputs.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}
function anchorOf(document: SceneDocument, labelId: string): P | null {
  const label = document.constructions.find((item) => item.outputs.includes(labelId) && item.operator === "label");
  return label ? at(document, String(label.inputs.target)) : null;
}
const direction = (from: P, to: P) => ((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI + 360) % 360;

/** Page directions of species m<n>'s bonds and lone pairs, from the built document. */
function domains(document: SceneDocument, tag: string): { bonds: number[]; lonePairs: number[] } | null {
  const centre = anchorOf(document, `${tag}_A`);
  if (!centre) return null;
  const bonds: number[] = [];
  for (let index = 1; ; index++) {
    const ligand = anchorOf(document, `${tag}_L${index}`);
    if (!ligand) break;
    bonds.push(direction(centre, ligand));
  }
  const lonePairs: number[] = [];
  for (let index = 1; ; index++) {
    const a = at(document, `${tag}_lp${index}_1`), b = at(document, `${tag}_lp${index}_2`);
    if (!a || !b) break;
    lonePairs.push(direction(centre, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }));
  }
  return { bonds, lonePairs };
}

/** Each domain on its own nearest slot, in the drawn orientation or its mirror; null when none fits. */
function seat(directions: number[], slots: number[]): number[] | null {
  for (const turn of [(deg: number) => deg, mirror]) {
    const used: number[] = [];
    for (const deg of directions) {
      const nearest = slots.map((slot) => ({ slot: turn(slot), off: gap(deg, turn(slot)) })).sort((a, b) => a.off - b.off)[0]!;
      if (nearest.off > TOLERANCE || used.includes(nearest.slot)) break;
      used.push(nearest.slot);
    }
    if (used.length === directions.length) return used;
  }
  return null;
}

function slotProblem(stericNumber: number, bonds: number[], lonePairs: number[]): string | null {
  if (stericNumber === 5) {
    const all = [...TBP.axial, ...TBP.equatorial];
    if (!seat([...bonds, ...lonePairs], all)) return "domains off the trigonal bipyramid's slots";
    const equatorial = (deg: number) => [TBP.equatorial, TBP.equatorial.map(mirror)].some((set) => set.some((slot) => gap(deg, slot) <= TOLERANCE));
    if (!lonePairs.every(equatorial)) return "a lone pair off the equator";
    return null;
  }
  if (stericNumber === 6) {
    const seated = seat([...bonds, ...lonePairs], OCT);
    if (!seated) return "domains off the octahedron's slots";
    const pairs = seated.slice(bonds.length);
    const transPairs = pairs.flatMap((a, i) => pairs.slice(i + 1).filter((b) => gap(a, b) === 180)).length;
    if (pairs.length === 2 && transPairs !== 1) return "two lone pairs not trans";
    if (pairs.length === 3 && transPairs !== 1) return "three lone pairs not meridional";
    if (pairs.length === 1 && !seated.slice(0, bonds.length).some((bond) => gap(bond, pairs[0]!) === 180)) return "the lone pair not trans to a bond";
    return null;
  }
  return null;
}

const SLOT_SPECIES = ["PCl5", "SF4", "ClF3", "BrF3", "XeF2", "I3-", "SF6", "BrF5", "IF5", "XeOF4", "XeF4", "ICl4-", "BrF4-", "XeF3-", "ICl3^2-"];
const SLOT_STEMS = [
  ...SLOT_SPECIES.flatMap((formula) => [`What is the shape of ${formula}?`, `What is the bond angle in ${formula}?`]),
  "Compare the shapes of XeF2, XeF4 and XeF6",
  "Shapes of SF6, BrF5, XeF4 and PF5",
  "Compare the bond angles of PCl5, ClF3, BrF5 and XeF4",
];

function slotsRed(build: Build): string[] {
  const red: string[] = [];
  for (const question of SLOT_STEMS) {
    const figure = build(question, [], false);
    if (!figure) continue;
    vseprSpecies(question).forEach((result, index) => {
      if (result.stericNumber !== 5 && result.stericNumber !== 6) return;
      const drawn = domains(figure.document, `m${index + 1}`);
      if (!drawn) { red.push(`slots/${question}: ${result.formula} not found`); return; }
      if (drawn.bonds.length !== result.bondPairs || drawn.lonePairs.length !== result.lonePairs) {
        red.push(`slots/${question}: ${result.formula} draws ${drawn.bonds.length} bonds and ${drawn.lonePairs.length} lone pairs`);
        return;
      }
      const problem = slotProblem(result.stericNumber, drawn.bonds, drawn.lonePairs);
      if (problem) red.push(`slots/${question}: ${result.formula} ${problem}`);
    });
  }
  return red;
}

const PAIR_RATIO = 1.8;

/** Lone pairs whose dots run into another pair's dots, as "formula ratio". */
function pairsRed(build: Build): string[] {
  const red: string[] = [];
  for (const question of SLOT_STEMS) {
    const figure = build(question, [], false);
    if (!figure) continue;
    vseprSpecies(question).forEach((_, index) => {
      const tag = `m${index + 1}`;
      const pairs: P[][] = [];
      for (let lp = 1; ; lp++) {
        const a = at(figure.document, `${tag}_lp${lp}_1`), b = at(figure.document, `${tag}_lp${lp}_2`);
        if (!a || !b) break;
        pairs.push([a, b]);
      }
      const dist = (p: P, q: P) => Math.hypot(p.x - q.x, p.y - q.y);
      for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
        const within = Math.max(dist(pairs[i]![0]!, pairs[i]![1]!), dist(pairs[j]![0]!, pairs[j]![1]!));
        const between = Math.min(...pairs[i]!.flatMap((p) => pairs[j]!.map((q) => dist(p, q))));
        if (between < PAIR_RATIO * within) red.push(`pairs/${question}: ${tag} pairs ${i + 1},${j + 1} ratio ${(between / within).toFixed(2)}`);
      }
    });
  }
  return [...new Set(red)];
}

const ARC_SPECIES = ["NH3", "H2O", "CH4", "BF3", "CO2", "SO2", "SF4", "ClF3", "XeF4", "SF6", "PCl5", "PF5", "BrF5", "IF5", "XeOF4", "ICl4-", "NH4+", "SCl4"];
const ARC_STEMS = [
  ...ARC_SPECIES.map((formula) => `What is the bond angle in ${formula}?`),
  "Compare the bond angles of CH4, NH3 and H2O",
  "Compare the bond angles of PCl5, ClF3, BrF5 and XeF4",
  "Compare the bond angles of SF4 and XeF4",
  "Compare the bond angles of SF6, BrF5 and XeF4",
  "bond angles of IF5 and ClF3",
];

/** Arcs whose swept sector does not read as their value; `arcs` counts the arcs measured. */
function arcsRed(build: Build): { red: string[]; arcs: number } {
  const red: string[] = [];
  let arcs = 0;
  for (const question of ARC_STEMS) {
    const figure = build(question, [], false);
    if (!figure) continue;
    for (const arc of figure.document.constructions.filter((item) => item.operator === "arc" && /^m\d+_ang$/.test(item.outputs[0] ?? ""))) {
      const id = arc.outputs[0]!;
      const sweep = Number(arc.inputs.endAngle) - Number(arc.inputs.startAngle);
      const label = figure.document.entities.find((entity) => entity.id === `${id}_val`)?.label
        ?? figure.document.entities.find((entity) => entity.id === id)?.label;
      const written = label ? /^([<>]?)(\d+(?:\.\d+)?)°$/.exec(label) : null;
      arcs++;
      if (!written) { red.push(`arcs/${question}: ${id} value ${label ?? "none"}`); continue; }
      const target = Number(written[2]);
      const reads = written[1] === "<" ? sweep < target : written[1] === ">" ? sweep > target : Math.abs(sweep - target) <= 1;
      if (!reads) red.push(`arcs/${question}: ${id} writes ${label} on ${sweep.toFixed(1)}°`);
    }
  }
  return { red, arcs };
}

const failures: string[] = [];
let passed = 0;
async function check(id: string, run: () => void | Promise<void>): Promise<void> {
  try { await run(); passed++; }
  catch (error) { failures.push(id); console.log(`FAIL ${id}: ${error instanceof Error ? error.message : String(error)}`); }
}

const live = arcsRed(buildVseprFigure);
await check("slots", () => assert.deepEqual(slotsRed(buildVseprFigure), []));
await check("pairs", () => assert.deepEqual(pairsRed(buildVseprFigure), []));
await check("arcs", () => {
  assert.deepEqual(live.red, []);
  assert.ok(live.arcs >= 15, `arcs measured: ${live.arcs}`);
});
await check("slots/covered", () => {
  const seen = new Set(SLOT_STEMS.flatMap((question) => buildVseprFigure(question, [], false)
    ? vseprSpecies(question).map((result) => `${result.stericNumber}-${result.lonePairs}`) : []));
  for (const kind of ["5-0", "5-1", "5-2", "5-3", "6-0", "6-1", "6-2", "6-3"]) assert.ok(seen.has(kind), `${kind} drawn`);
});
await check("xef4-cis-caption", () => {
  const figure = buildVseprFigure("What is the bond angle in XeF4?", [], false);
  assert.ok(figure);
  assert.ok(!figure.document.entities.some((entity) => entity.id === "m1_ang"), "no arc on the perspective pair");
  assert.equal(figure.document.entities.find((entity) => entity.id === "m1_ang_txt")?.label, "cis F-Xe-F = 90°");
});

// Mutants: a copy of vsepr.ts beside it, so its relative imports resolve.
const source = fileURLToPath(new URL("../../src/chemistry/vsepr.ts", import.meta.url));
const original = readFileSync(source, "utf8");
async function mutant(name: string, edits: Array<[string, string]>): Promise<Build> {
  let text = original;
  for (const [from, to] of edits) {
    assert.ok(text.includes(from), `${name}: mutation anchor is missing: ${from.slice(0, 60)}`);
    text = text.replace(from, to);
  }
  const path = source.replace(/vsepr\.ts$/, `vsepr.mutant-${name}-${process.pid}.ts`);
  writeFileSync(path, text);
  try { return ((await import(path)) as { buildVseprFigure: Build }).buildVseprFigure; }
  finally { rmSync(path, { force: true }); }
}
await check("mutation/main-layouts", async () => {
  const build = await mutant("layouts", [
    ["lonePairs: [{ deg: 180, dist: 0.7 }, { deg: 330, dist: 0.7 }, { deg: 30, dist: 0.7 }],", "lonePairs: [{ deg: 180, dist: 0.5 }, { deg: 60, dist: 0.5 }, { deg: 300, dist: 0.5 }],"],
    ["        bonds: OCT_BASAL,\n        lonePairs: [{ deg: 90, dist: 0.45 }, { deg: 270, dist: 0.45 }],\n        angle: [0, 2],",
      "        bonds: [45, 135, 225, 315].map((deg) => ({ deg, len: 1, style: \"plain\" as const, seat: \"equatorial\" as const })),\n        lonePairs: [{ deg: 90, dist: 0.45 }, { deg: 270, dist: 0.45 }],\n        angle: [3, 0],"],
    ["lonePairs: [{ deg: 180, dist: 0.4 }, { deg: 225, dist: 0.8 }, { deg: 45, dist: 0.8 }],", "lonePairs: [{ deg: 150, dist: 0.42 }, { deg: 210, dist: 0.42 }, { deg: 180, dist: 0.72 }],"],
  ]);
  const red = slotsRed(build);
  console.log(`mutation/main-layouts: ${red.length} red rows`);
  const pairs = pairsRed(build);
  console.log(`mutation/main-layouts: ${pairs.length} red pair rows`);
  assert.ok(pairs.some((row) => row.startsWith("pairs/What is the shape of XeF3-?: ")), `AX3E3 pairs go red: ${pairs.join("; ")}`);
  for (const formula of ["XeF2", "I3-", "XeF4", "ICl4-", "BrF4-", "XeF3-", "ICl3^2-"]) {
    assert.ok(red.some((row) => row.startsWith(`slots/What is the shape of ${formula}?: `)), `${formula} goes red: ${red.join("; ")}`);
  }
});
await check("mutation/main-pair-spacing", async () => {
  const build = await mutant("spacing", [
    ["lonePairs: [{ deg: 150, dist: 0.7 }, { deg: 210, dist: 0.7 }],", "lonePairs: [{ deg: 150, dist: 0.45 }, { deg: 210, dist: 0.45 }],"],
    ["lonePairs: [{ deg: 180, dist: 0.7 }, { deg: 330, dist: 0.7 }, { deg: 30, dist: 0.7 }],", "lonePairs: [{ deg: 180, dist: 0.5 }, { deg: 330, dist: 0.5 }, { deg: 30, dist: 0.5 }],"],
  ]);
  const red = pairsRed(build);
  console.log(`mutation/main-pair-spacing: ${red.length} red rows`);
  for (const formula of ["ClF3", "BrF3", "XeF2", "I3-"]) {
    assert.ok(red.some((row) => row.startsWith(`pairs/What is the shape of ${formula}?: `)), `${formula} goes red: ${red.join("; ")}`);
  }
});
await check("mutation/arc-on-any-pair", async () => {
  const build = await mutant("arcs", [["function sectorReads(layout: Layout, value: string): boolean {\n", "function sectorReads(layout: Layout, value: string): boolean {\n  if (layout.angle) return true;\n"]]);
  const red = arcsRed(build).red;
  console.log(`mutation/arc-on-any-pair: ${red.length} red rows`);
  for (const question of ["What is the bond angle in BrF5?", "What is the bond angle in IF5?", "Compare the bond angles of SF6, BrF5 and XeF4"]) {
    assert.ok(red.some((row) => row.startsWith(`arcs/${question}: `)), `${question} goes red: ${red.join("; ")}`);
  }
});

console.log(`verify-vsepr-domain-slots: ${passed} passed, ${failures.length} failed (${live.arcs} arcs)`);
if (failures.length) process.exitCode = 1;
