/**
 * A VSEPR figure writes a bond angle only when the stem asks for one (main's
 * rule: "angle", "°" or "degree" in the stem), and an asked angle keeps
 * main's value; only how it is drawn changed.
 *
 *   unasked    shape-only stems (BF3, CO2, SF6, PCl5, CH4, NH3, H2O, SF4 and
 *              the #287 review stems that read a neutral formula for an ion:
 *              NO2 ⊖, SO3 in sulfites, the conjugate acid of NH3) draw their
 *              shape with no degree label and no claim kind, as on main
 *   asked      asked stems show main's value and claim kind per species, in
 *              the drawn form: a bare value at an honest arc, or a caption
 *              naming its atoms where no honest arc exists (NH3 plain to
 *              wedge: "H-N-H = 107°")
 *   sweep      every VSEPR probe that draws shows exactly its species' source
 *              angles when its stem asks, and no degree label when it does not
 *   authority  an asked angle is certified from the regenerated graph with no
 *              planner scalar; a wrong planner angle still refuses
 *   pair       a steric number 5 or 6 caption names its pair (ax-eq, eq., cis);
 *              past the compact limit the atoms go and the pair words stay
 *              ("ax-eq 90°" for PCl5 in a four species row), so the asked
 *              value is never dropped; a bare value only sits at an arc that
 *              sweeps it
 *   mutation   an angle on every stem turns the unasked rows red; no angle
 *              turns the asked rows and the sweep red; a caption without its
 *              pair words turns the pair rows red; a long caption that drops
 *              its value turns the asked rows red; a build that draws nothing
 *              turns every sweep row red
 */
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { TurnPlanQuantityV3, TurnPlanV3 } from "../../src/contracts/contractsV3";
import { certifyVseprSourceDocument } from "../../src/chemistry/sourceEvidence";
import { chemStem } from "../../src/chemistry/sceneKit";
import { askedAngle, buildVseprFigure, VSEPR_PROBES, vseprSpecies } from "../../src/chemistry/vsepr";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import type { SceneDocument } from "../../src/types";

type Build = typeof buildVseprFigure;
type Claim = "ideal" | "quoted" | "inequality";

/** Main's rule, kept apart from the builder as the oracle. */
const asks = (question: string) => /\bangles?\b|°|\bdegrees?\b/i.test(chemStem(question));

const UNASKED = [
  "hybridisation of BF3", "geometry of PCl5", "why is CO2 linear", "shape of SF6", "What is the shape of CH4?",
  "What is the shape of NH3?", "What is the shape of H2O?", "What is the shape of SF4?", "What is the shape of XeF4?",
  "What is the shape of ClF3?", "Shapes of PCl5 and SF4", "Shapes of SF6, BrF5, XeF4 and PF5",
  // #287 round 3 review: a neutral formula read for an ion; main draws no angle.
  "shape of NO2 ⊖", "shape of NO2ˉ", "shape of NO2 ⊕", "shape of NO2 in nitrites", "shape of NO2 with one more electron",
  "shape of SO3 in sulfites", "shape of SO3 dianionic", "shape of SeO3 in selenites", "shape of the conjugate acid of NH3",
  "shape of NO2-", "shape of NH4+ ion", "shapes of NH3 and NH4+ ions",
];

/** Asked stems: main's value and claim per species, and the label the head draws for it. */
interface Asked { question: string; species: ReadonlyArray<readonly [string, Claim, string]> }
const ASKED: Asked[] = [
  { question: "What is the bond angle in NH3?", species: [["107°", "quoted", "H-N-H = 107°"]] },
  { question: "What is the bond angle in H2O?", species: [["104.5°", "quoted", "104.5°"]] },
  { question: "What is the bond angle in BF3?", species: [["120°", "ideal", "120°"]] },
  { question: "What is the bond angle in CO2?", species: [["180°", "ideal", "180°"]] },
  { question: "What is the bond angle in SF6?", species: [["90°", "ideal", "90°"]] },
  { question: "What is the bond angle in PCl5?", species: [["90°", "ideal", "90°"]] },
  { question: "What is the bond angle in CH4?", species: [["109.5°", "ideal", "109.5°"]] },
  { question: "What is the bond angle in SF4?", species: [["<120°", "inequality", "eq. F-S-F <120°"]] },
  { question: "What is the bond angle in SCl4?", species: [["<120°", "inequality", "eq. <120°"]] },
  { question: "What is the bond angle in ClF3?", species: [["87.5°", "quoted", "87.5°"]] },
  { question: "What is the bond angle in BrF5?", species: [["<90°", "inequality", "<90°"]] },
  { question: "bond angle in NH4+ ion", species: [["109.5°", "ideal", "109.5°"]] },
  { question: "Compare the bond angles of CH4, NH3 and H2O", species: [["109.5°", "ideal", "109.5°"], ["107°", "quoted", "H-N-H = 107°"], ["104.5°", "quoted", "H-O-H = 104.5°"]] },
  { question: "Compare the bond angles of PCl5, ClF3, BrF5 and XeF4", species: [["90°", "ideal", "ax-eq 90°"], ["87.5°", "quoted", "ax-eq 87.5°"], ["<90°", "inequality", "cis F-Br-F <90°"], ["90°", "ideal", "cis F-Xe-F = 90°"]] },
  { question: "Using VSEPR theory, predict the shape and the approximate bond angles of SF4, ClF3 and XeF2.", species: [["<120°", "inequality", "eq. F-S-F <120°"], ["87.5°", "quoted", "ax-eq 87.5°"]] },
  { question: "bond angles in SCl4, SeCl4 and TeCl4", species: [["<120°", "inequality", "eq. <120°"], ["<120°", "inequality", "eq. <120°"], ["<120°", "inequality", "eq. <120°"]] },
];

function labels(document: SceneDocument): string[] {
  return document.entities.flatMap((entity) => entity.label ? [entity.label] : []);
}
const isClaim = (label: string) => /^(?:ideal|quoted|inequality)$/.test(label);
const degrees = (document: SceneDocument) => labels(document).filter((label) => /°/.test(label));
/** The value a degree label shows: "107°" at an arc, the tail of "H-N-H = 107°". */
const valueOf = (label: string) => /(?:^|\s)([<>]?\d+(?:\.\d+)?°)$/.exec(label)?.[1] ?? label;
/** Degree labels and claim kinds of species m<n>. */
function speciesMarks(document: SceneDocument, index: number): { degrees: string[]; claims: string[] } {
  const own = document.entities.filter((entity) => entity.label && entity.id.startsWith(`m${index + 1}_`));
  return { degrees: own.filter((e) => /°/.test(e.label!)).map((e) => e.label!), claims: own.filter((e) => isClaim(e.label!)).map((e) => e.label!) };
}

function unaskedRed(build: Build): string[] {
  return UNASKED.filter((question) => {
    assert.ok(!asks(question), `${question} must not ask an angle`);
    const figure = build(question, [], false);
    if (!figure) return true;
    return degrees(figure.document).length > 0 || labels(figure.document).some(isClaim);
  }).map((question) => `unasked/${question}`);
}

function askedRed(build: Build): string[] {
  return ASKED.filter(({ question, species }) => {
    assert.ok(asks(question), `${question} must ask an angle`);
    const figure = build(question, [], false);
    if (!figure) return true;
    if (degrees(figure.document).length !== species.length) return true;
    return species.some(([value, claim, shown], index) => {
      const marks = speciesMarks(figure.document, index);
      return marks.degrees.length !== 1 || marks.degrees[0] !== shown || valueOf(shown) !== value
        || marks.claims.length !== 1 || marks.claims[0] !== claim;
    });
  }).map(({ question }) => `asked/${question}`);
}

function sweepRed(build: Build): string[] {
  return VSEPR_PROBES.filter((probe) => probe.expect === "draw").filter((probe) => {
    const figure = build(probe.question, [], false);
    // A probe that expects a drawing and draws nothing is a failure.
    if (!figure) return true;
    const expected = asks(probe.question)
      ? vseprSpecies(probe.question).map(askedAngle).filter((angle): angle is string => angle !== null)
      : [];
    return JSON.stringify(degrees(figure.document).map(valueOf).sort()) !== JSON.stringify([...expected].sort());
  }).map((probe) => `sweep/${probe.question}`);
}

const failures: string[] = [];
let passed = 0;
async function check(id: string, run: () => void | Promise<void>): Promise<void> {
  try { await run(); passed++; }
  catch (error) { failures.push(id); console.log(`FAIL ${id}: ${error instanceof Error ? error.message : String(error)}`); }
}

await check("unasked", () => assert.deepEqual(unaskedRed(buildVseprFigure), []));
await check("asked", () => assert.deepEqual(askedRed(buildVseprFigure), []));
await check("sweep", () => assert.deepEqual(sweepRed(buildVseprFigure), []));
await check("sweep-covers-both", () => {
  const draws = VSEPR_PROBES.filter((probe) => probe.expect === "draw");
  const askedWithAngle = draws.filter((probe) => asks(probe.question) && vseprSpecies(probe.question).some((result) => askedAngle(result) !== null));
  const unaskedWithAngle = draws.filter((probe) => !asks(probe.question) && vseprSpecies(probe.question).some((result) => askedAngle(result) !== null));
  assert.ok(askedWithAngle.length >= 3 && unaskedWithAngle.length >= 5, `asked ${askedWithAngle.length}, unasked ${unaskedWithAngle.length}`);
});

function plan(question: string, derived: TurnPlanQuantityV3[] = []): TurnPlanV3 {
  return { schemaVersion: "turn-plan/v3", question, visualRequirement: "required", givens: [], derived, unknowns: [],
    qualitativeClaims: [], lawIds: ["VSEPR theory"], assumptions: [] };
}
for (const { question, species } of ASKED) {
  await check(`authority/${question}`, () => {
    // The document the family loop hands to selection, as the tutor gate does.
    const scene = synthesizeFamilyScene({ question, turnPlan: plan(question) });
    assert.equal(scene?.family, "chem_vsepr");
    const certificate = certifyVseprSourceDocument(scene.document, question, plan(question));
    assert.equal(certificate.status, "certified");
    for (const [, , shown] of species) {
      assert.ok(certificate.status === "certified" && certificate.texts.includes(shown), `${shown} is a certified text`);
    }
  });
}
await check("authority/plan-angle-checked", () => {
  const question = "What is the bond angle in H2O?";
  const angle = (value: number): TurnPlanQuantityV3 => ({ id: "theta", symbol: "bond_angle_H2O", value, unit: "degree", sourceText: "bond angle in H2O", provenance: "derived" });
  for (const [value, status] of [[109.5, "rejected"], [104.5, "certified"]] as const) {
    const withAngle = plan(question, [angle(value)]);
    const scene = synthesizeFamilyScene({ question, turnPlan: withAngle });
    assert.ok(scene);
    assert.equal(certifyVseprSourceDocument(scene.document, question, withAngle).status, status, `planner angle ${value}`);
  }
});

/** Asked stems holding steric number 5 and 6 shapes, single and in rows small enough that the value falls back to a caption. */
const PAIR_STEMS = [
  "Compare the bond angles of PCl5, ClF3, BrF5 and XeF4", "Compare the bond angles of PCl5 and SF4",
  "Compare the bond angles of SF6, BrF5, XeF4 and PF5", "Compare the bond angles of ClF3, BrF3, SF4 and XeF2",
  "Compare the bond angles of PCl5 and PF5", "bond angles in SCl4, SeCl4 and TeCl4",
  ...["PCl5", "PF5", "SF4", "SCl4", "ClF3", "BrF3", "XeF2", "SF6", "BrF5", "IF5", "XeF4", "ICl4-"].map((formula) => `What is the bond angle in ${formula}?`),
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
        // A bare value is honest only at an arc that sweeps it on the page.
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
await check("pair", () => assert.deepEqual(pairRed(buildVseprFigure), []));
await check("pair/no-bare-pcl5-caption", () => {
  const figure = buildVseprFigure(PAIR_STEMS[0]!, [], false);
  assert.ok(figure);
  assert.ok(!labels(figure.document).some((label) => /^Cl-P-Cl\b/.test(label)), degrees(figure.document).join(", "));
});

// Mutants: a copy of vsepr.ts beside it, so its relative imports resolve.
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
await check("mutation/angle-on-every-stem", async () => {
  const build = await mutant("every", "  const withAngle = /\\bangles?\\b|°|\\bdegrees?\\b/i.test(stem);\n", "  const withAngle = true;\n");
  const red = unaskedRed(build);
  for (const question of ["hybridisation of BF3", "why is CO2 linear", "shape of SF6", "geometry of PCl5", "shape of NO2 ⊖", "shape of SO3 in sulfites", "shape of the conjugate acid of NH3"]) {
    assert.ok(red.includes(`unasked/${question}`), `${question} goes red: ${red.join("; ")}`);
  }
  assert.ok(sweepRed(build).length >= 5, "the sweep goes red");
  assert.deepEqual(askedRed(build), [], "asked rows stay green");
});
await check("mutation/no-angle", async () => {
  const build = await mutant("none", "  const characteristic = withAngle ? askedAngle(result) : null;\n", "  const characteristic: string | null = null;\n");
  assert.deepEqual(askedRed(build), ASKED.map(({ question }) => `asked/${question}`), "every asked row goes red");
  assert.ok(sweepRed(build).length >= 3, "the sweep goes red");
  assert.deepEqual(unaskedRed(build), [], "unasked rows stay green");
});
await check("mutation/caption-without-pair-words", async () => {
  const build = await mutant("pair", "  const prefix = anglePairQualifier(result.stericNumber, seated[a]!.slot.seat, seated[b]!.slot.seat);\n", "  const prefix = \"\";\n");
  const red = pairRed(build);
  for (const question of [PAIR_STEMS[0]!, "What is the bond angle in SF4?", "bond angles in SCl4, SeCl4 and TeCl4"]) {
    assert.ok(red.some((row) => row.startsWith(`pair/${question}:`)), `${question} goes red: ${red.join("; ")}`);
  }
});
await check("mutation/long-caption-drops-value", async () => {
  const build = await mutant("drop", "  return forms.find((form) => form.length <= 16) ?? `${prefix}${value}`;\n", "  return forms.find((form) => form.length <= 16) ?? null;\n");
  const red = askedRed(build);
  for (const question of ["What is the bond angle in SCl4?", "Compare the bond angles of PCl5, ClF3, BrF5 and XeF4", "bond angles in SCl4, SeCl4 and TeCl4"]) {
    assert.ok(red.includes(`asked/${question}`), `${question} goes red: ${red.join("; ")}`);
  }
});
// A build that draws nothing: a missing figure on a probe that expects a
// drawing must turn every sweep row red, never pass it.
await check("mutation/no-figure", () => {
  const draws = VSEPR_PROBES.filter((probe) => probe.expect === "draw");
  assert.ok(draws.length >= 5, `draw probes: ${draws.length}`);
  assert.deepEqual(sweepRed(() => null), draws.map((probe) => `sweep/${probe.question}`), "every draw probe goes red without its figure");
  assert.deepEqual(unaskedRed(() => null), UNASKED.map((question) => `unasked/${question}`), "every unasked row goes red without its figure");
});

console.log(`verify-vsepr-asked-angle: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
