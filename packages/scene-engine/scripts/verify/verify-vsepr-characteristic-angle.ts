/**
 * A VSEPR shape writes its characteristic bond angle whether or not the stem
 * says "angle", and the angle stays source-certified.
 *
 *   table      the blind-judge rows (BF3 120°, PCl5 90°, CO2 180°, SF6 90°)
 *              and neighbours, on shape-only stems, carry the source angle
 *              and its claim kind; XeF2 (no in-plane pair) carries none
 *   sweep      every drawn species in VSEPR_PROBES with a single true angle
 *              carries exactly that label, and no other degree label appears
 *   authority  the drawn angle is certified from the regenerated graph with
 *              no planner scalar; a wrong planner angle still refuses
 *   mutation   a drawSpecies that writes no angle turns the table and sweep
 *              red, so these rows depend on the drawing, not on the stem
 */
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { TurnPlanQuantityV3, TurnPlanV3 } from "../../src/contracts/contractsV3";
import { certifyVseprSourceDocument } from "../../src/chemistry/sourceEvidence";
import { buildVseprFigure, characteristicAngle, VSEPR_PROBES, vseprSpecies } from "../../src/chemistry/vsepr";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import type { SceneDocument } from "../../src/types";

type Build = typeof buildVseprFigure;
interface Row { id: string; question: string; angle: string | null; claim?: "ideal" | "quoted" | "inequality" }

const TABLE: Row[] = [
  { id: "bf3-hybridisation", question: "hybridisation of BF3", angle: "120°", claim: "ideal" },
  { id: "pcl5-geometry", question: "geometry of PCl5", angle: "90°", claim: "ideal" },
  { id: "co2-linear", question: "why is CO2 linear", angle: "180°", claim: "ideal" },
  { id: "sf6-shape", question: "shape of SF6", angle: "90°", claim: "ideal" },
  { id: "ch4-shape", question: "What is the shape of CH4?", angle: "109.5°", claim: "ideal" },
  { id: "nh3-shape", question: "What is the shape of NH3?", angle: "107°", claim: "quoted" },
  { id: "h2o-shape", question: "What is the shape of H2O?", angle: "104.5°", claim: "quoted" },
  { id: "sf4-shape", question: "What is the shape of SF4?", angle: "<120°", claim: "inequality" },
  { id: "xef2-shape", question: "What is the shape of XeF2?", angle: null },
];

function labels(document: SceneDocument): string[] {
  return document.entities.flatMap((entity) => entity.label ? [entity.label] : []);
}
const degrees = (document: SceneDocument) => labels(document).filter((label) => /°/.test(label));

function tableRed(build: Build): string[] {
  return TABLE.filter((row) => {
    const figure = build(row.question, [], false);
    if (!figure) return true;
    const drawn = degrees(figure.document);
    const claims = labels(figure.document).filter((label) => /^(?:ideal|quoted|inequality)$/.test(label));
    return row.angle === null
      ? drawn.length > 0 || claims.length > 0
      : drawn.length !== 1 || drawn[0] !== row.angle || claims.length !== 1 || claims[0] !== row.claim;
  }).map((row) => `table/${row.id}`);
}

function sweepRed(build: Build): string[] {
  return VSEPR_PROBES.filter((probe) => probe.expect === "draw").filter((probe) => {
    const figure = build(probe.question, [], false);
    if (!figure) return false;
    const expected = vseprSpecies(probe.question).map(characteristicAngle).filter((angle): angle is string => angle !== null);
    return JSON.stringify([...degrees(figure.document)].sort()) !== JSON.stringify([...expected].sort());
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
    assert.ok(degrees(scene.document).includes(row.angle!), "the family scene keeps the angle");
    const certificate = certifyVseprSourceDocument(scene.document, row.question, plan(row.question));
    assert.equal(certificate.status, "certified");
    assert.ok(certificate.status === "certified" && certificate.texts.includes(row.angle!), "the drawn angle is a certified text");
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

// Mutant: a copy of vsepr.ts beside it, so its relative imports resolve.
const source = fileURLToPath(new URL("../../src/chemistry/vsepr.ts", import.meta.url));
const original = readFileSync(source, "utf8");
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

console.log(`verify-vsepr-characteristic-angle: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
