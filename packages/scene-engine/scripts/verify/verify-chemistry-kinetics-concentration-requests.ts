/** Original concentration requests own each endpoint and the requested interval. Fixtures are oracles only. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { buildKineticsScene, kineticsFromStem, solveKinetics } from "../../src/chemistry/kinetics";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import type { SceneDocument } from "../../src/types";

interface Row { id: string; question: string; questionSha256: string; kind: "interval" | "decline" | "temperature" | "initial"; a0?: number; k?: number; timeUnit?: string }
const ROWS: readonly Row[] = [
  {
    "id": "legacy-zero-order-reaction-subject",
    "question": "Half life of a zero order reaction A -> product is 1 hour when the initial concentration of the reactant is 2.0 mol L^-1. Draw the plot of [A] vs t and find the time required to decrease the concentration of A from 0.50 to 0.25 mol L^-1.",
    "kind": "interval",
    "questionSha256": "65d9ff63ec638f876ed1bc3e6cf91e03c7505ea517f7eda713a8bc2020b64c1a"
  },
  {
    "id": "OWN-SHARED-M",
    "question": "The half life of a zero order reaction A -> product is 1 hour. The initial concentration is 2 M. Draw [A] vs t. Find the time needed for the concentration to fall from 0.50 to 0.25 M.",
    "kind": "interval",
    "questionSha256": "2f690b7629dfe352dbbb367bde85425f2071f3179b705ed995743bd911e992f0"
  },
  {
    "id": "OWN-SHARED-MOL-L",
    "question": "The half life of a zero order reaction A -> product is 1 hour. The initial concentration is 2 M. Draw [A] vs t. Calculate the interval as [A] decreases from 0.50 to 0.25 mol/L.",
    "kind": "interval",
    "questionSha256": "72f46119715b6311c009c49aaac8730c7ba28cc365d1e450759bc1605922bcec"
  },
  {
    "id": "OWN-SHARED-MOL-L-EXPONENT",
    "question": "The half life of a zero order reaction A -> product is 1 hour. The initial concentration is 2 M. Draw [A] vs t. Determine how long the concentration takes to drop from 0.50 to 0.25 mol L^-1.",
    "kind": "interval",
    "questionSha256": "e85bea09f92130b439ad1b46af3291ede603129ded9ef77e7f24d834d795d8ef"
  },
  {
    "id": "OWN-SHARED-MOL-DM-EXPONENT",
    "question": "The half life of a zero order reaction A -> product is 1 hour. The initial concentration is 2 M. Draw [A] vs t. Find the duration of the decrease in [A] from 0.50 to 0.25 mol dm^-3.",
    "kind": "interval",
    "questionSha256": "9244fc69c2dd9c0592b51759f7069aefd4d72a6aca0acc732d88bd223a2034d4"
  },
  {
    "id": "OWN-SHARED-MOL-DM-DIVISION",
    "question": "The half life of a zero order reaction A -> product is 1 hour. The initial concentration is 2 M. Draw [A] vs t. Calculate the time required for concentration to decrease from 0.50 to 0.25 mol/dm^3.",
    "kind": "interval",
    "questionSha256": "fe5f421b8d5cda954b76145eaa70ed5fd16d4d79b35d87176beead942f47d2fd"
  },
  {
    "id": "OWN-BOTH-M",
    "question": "The half life of a zero order reaction A -> product is 1 hour. The initial concentration is 2 M. Draw [A] vs t. Find the interval for the concentration to decrease from 0.50 M to 0.25 M.",
    "kind": "interval",
    "questionSha256": "56a9fe6c7f90f584a86c13de7b2f9e7e8db1e49ae278b2c1d777c8565c9e1437"
  },
  {
    "id": "OWN-BOTH-MOL-L",
    "question": "The half life of a zero order reaction A -> product is 1 hour. The initial concentration is 2 M. Draw [A] vs t. Find the time for [A] to decrease from 0.50 mol/L to 0.25 mol/L.",
    "kind": "interval",
    "questionSha256": "15f3ac8328cc4487520ddb10d3836c063908b4d0818847d6d185b490d8c928de"
  },
  {
    "id": "OWN-BOTH-CANONICAL-ALIASES",
    "question": "The half life of a zero order reaction A -> product is 1 hour. The initial concentration is 2 M. Draw [A] vs t. Calculate the interval while concentration falls from 0.50 mol L^-1 to 0.25 mol dm^-3.",
    "kind": "interval",
    "questionSha256": "18040bf9eafff8b372401e241674009f2627b87407ae887ac3fc0f440db53c13"
  },
  {
    "id": "REFUSE-NO-REQUEST-UNIT",
    "question": "The half life of a zero order reaction A -> product is 1 hour. The initial concentration is 2 M. Draw [A] vs t. Find the time for the concentration to decrease from 0.50 to 0.25.",
    "kind": "decline",
    "questionSha256": "9221d8834b3c2c10aa963feb77d6f447dfe40ad73cef20c4b1ada9c07c8e56b5"
  },
  {
    "id": "REFUSE-FIRST-TEMPERATURE",
    "question": "The half life of a zero order reaction A -> product is 1 hour. The initial concentration is 2 M. Draw [A] vs t. Find the time for the concentration to decrease from 0.50 K to 0.25 M.",
    "kind": "decline",
    "questionSha256": "fd5c715d5ff8c9dedb2af8ff402cbe54f02ee2b07061f0d39802e83f6eea7d07"
  },
  {
    "id": "REFUSE-SECOND-TEMPERATURE",
    "question": "The half life of a zero order reaction A -> product is 1 hour. The initial concentration is 2 M. Draw [A] vs t. Find the time for the concentration to decrease from 0.50 M to 0.25 K.",
    "kind": "decline",
    "questionSha256": "3e25b5576e0f9954d9e5722b2af73198ac228f14fdca180135ec614c5ed61ade"
  },
  {
    "id": "REFUSE-FIRST-RATE",
    "question": "The half life of a zero order reaction A -> product is 1 hour. The initial concentration is 2 M. Draw [A] vs t. Find the time for the concentration to decrease from 0.50 M/h to 0.25 M.",
    "kind": "decline",
    "questionSha256": "233aa5ca776b7299df2b2395bb3f710203db32bbc70a2ade6bdcfc7ad77ca731"
  },
  {
    "id": "REFUSE-SECOND-RATE",
    "question": "The half life of a zero order reaction A -> product is 1 hour. The initial concentration is 2 M. Draw [A] vs t. Find the time for the concentration to decrease from 0.50 M to 0.25 M/h.",
    "kind": "decline",
    "questionSha256": "dd0f58a153a31c7460cce963533ec00a221fd1388e77939254ae358275fabf68"
  },
  {
    "id": "REFUSE-FIRST-EXPONENT",
    "question": "The half life of a zero order reaction A -> product is 1 hour. The initial concentration is 2 M. Draw [A] vs t. Find the time for the concentration to decrease from 0.50 mol L^-2 to 0.25 M.",
    "kind": "decline",
    "questionSha256": "0488fb0c922b0d3942e8ed36cfef95dc7195c7f2f03e7cc9d27c23daa7c069c4"
  },
  {
    "id": "REFUSE-SECOND-EXPONENT",
    "question": "The half life of a zero order reaction A -> product is 1 hour. The initial concentration is 2 M. Draw [A] vs t. Find the time for the concentration to decrease from 0.50 to 0.25 mol dm^-2.",
    "kind": "decline",
    "questionSha256": "37b99d640e010f21195d4f145571318ab504777c8dc9decd179e285e1d20dd9a"
  },
  {
    "id": "REFUSE-FIRST-SCIENTIFIC",
    "question": "The half life of a zero order reaction A -> product is 1 hour. The initial concentration is 2 M. Draw [A] vs t. Find the time for the concentration to decrease from 1e- to 0.25 M.",
    "kind": "decline",
    "questionSha256": "81337b8d890324c0bc99dffdc458dd454e416ac4ab50fece4f79f6758d787939"
  },
  {
    "id": "REFUSE-SECOND-SCIENTIFIC",
    "question": "The half life of a zero order reaction A -> product is 1 hour. The initial concentration is 2 M. Draw [A] vs t. Find the time for the concentration to decrease from 0.50 to 1e- M.",
    "kind": "decline",
    "questionSha256": "f6fc32c9110a5fe8e9f69bdbd1a6f467006d70443beec5bb39711799a232421c"
  },
  {
    "id": "REFUSE-FIRST-UNKNOWN",
    "question": "The half life of a zero order reaction A -> product is 1 hour. The initial concentration is 2 M. Draw [A] vs t. Find the time for the concentration to decrease from unknown to 0.25 M.",
    "kind": "decline",
    "questionSha256": "36b5a3db50994e711588230da99153411018cb6cf1a796cf9c0ce113a2927a7f"
  },
  {
    "id": "REFUSE-SECOND-UNKNOWN",
    "question": "The half life of a zero order reaction A -> product is 1 hour. The initial concentration is 2 M. Draw [A] vs t. Find the time for the concentration to decrease from 0.50 to unknown M.",
    "kind": "decline",
    "questionSha256": "b53083687b5dfe7931c1d85e4f9659651fc2acf415ae20907aac0ff3826b18bb"
  },
  {
    "id": "REFUSE-UNIT-SUFFIX",
    "question": "The half life of a zero order reaction A -> product is 1 hour. The initial concentration is 2 M. Draw [A] vs t. Find the time for the concentration to decrease from 0.50 to 0.25 Mfoo.",
    "kind": "decline",
    "questionSha256": "b98e9452d16c7ebfd7bc4ee6ac079f51e1126330c2278ce541676c42574452ef"
  },
  {
    "id": "CONTROL-TEMPERATURE-RISE",
    "question": "The rate of a reaction doubles when temperature is raised from 300 K to 310 K. Calculate activation energy and draw the Arrhenius plot.",
    "kind": "temperature",
    "questionSha256": "603595df2adb13c4f835bd18cef8201cabb815f082e72e79c5f11d03235e02f1"
  },
  {
    "id": "CONTROL-TEMPERATURE-CHANGE",
    "question": "The rate constant doubles as temperature increases from 300 K to 310 K. Draw ln k vs 1/T and find Ea.",
    "kind": "temperature",
    "questionSha256": "1a4dfdd0e49e2143b5434820ccb1e0b9efcd4e6f2f679224a8dc09ff09f8d077"
  },
  // Public #137 P1 plus fresh source-owned named-reactant declarations.
  {
    "id": "P1-NAMED-INITIAL-EXACT",
    "question": "A first order reaction has initial concentration of A is 2 M. Its rate constant is 0.0231 min^-1. Draw the decay curve.",
    "kind": "initial", "a0": 2, "k": 0.0231, "timeUnit": "min",
    "questionSha256": "64165739c33235c00223216d0bf202a44ec9102df8d8f0e2518eceec1d42d5e0"
  },
  {
    "id": "P1-NAMED-INITIAL-A",
    "question": "For a first order reaction, the initial concentration of A is 3 M and k = 0.015 min^-1. Plot [A] against time.",
    "kind": "initial", "a0": 3, "k": 0.015, "timeUnit": "min",
    "questionSha256": "f7f0801c415f76e32202a2eb5f5941b3ec4b91befd55c1d1de4e6e871b81b111"
  },
  {
    "id": "P1-NAMED-INITIAL-BRACKET-A",
    "question": "A first order reaction has initial concentration of [A] = 0.8 mol/L. The rate constant is 0.02 s^-1. Draw the concentration-time curve.",
    "kind": "initial", "a0": 0.8, "k": 0.02, "timeUnit": "s",
    "questionSha256": "f91dfc18fe1ceb27cbb78294e2c1ba3526fb8d79c6f059aa5e54a2f467b0c05d"
  },
  {
    "id": "P1-NAMED-INITIAL-REACTANT-A",
    "question": "A first order reaction has initial concentration of reactant A = 4 M and k = 0.04 h^-1. Draw [A] versus t.",
    "kind": "initial", "a0": 4, "k": 0.04, "timeUnit": "h",
    "questionSha256": "f442942701814168aec35cbdae3d27f82826ec87a425db6686ced5e58a2726cc"
  },
  {
    "id": "P1-NAMED-INITIAL-UNREAD-CONTROL",
    "question": "A first order reaction has initial concentration of A is unknown. Its rate constant is 0.0231 min^-1. Draw the decay curve.",
    "kind": "decline",
    "questionSha256": "b697faa5cd36bb3e6d6ac5f679fbae774cab93e9eb8d41d84de421734f8f83ad"
  }
];

interface Evidence { id: string; questionSha256: string; seam: string; passed: boolean; error?: string }
const evidence: Evidence[] = [];
const nearRaw = (actual: number | null, expected: number): void => {
  assert.ok(actual !== null && Number.isFinite(actual), `Missing/nonfinite raw value: ${actual}`);
  assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-12, `${actual} != ${expected}`);
};
const compact = (text: string): string => text.replace(/\s+/g, "").replace(/−|–/g, "-");

function stored(scene: SceneDocument, value: number, units: readonly string[]): void {
  assert.ok(scene.quantities.some(q => typeof q.value === "number" && Number.isFinite(q.value)
    && Math.abs(q.value - value) <= 0.500001e-6 && typeof q.unit === "string" && units.includes(q.unit)),
  `Requested value ${value} ${units.join(" or ")} must be stored with its complete physical unit: ${JSON.stringify(scene.quantities)}`);
}

function checkedScene(scene: SceneDocument, question: string) {
  assert.equal(scene.source.question, question, "Original question identity must survive");
  assert.equal(scene.source.chemistryFamily, "chem_kinetics");
  const validated = validateSceneDocument(pruneDeadSceneEntities(scene as unknown as Record<string, unknown>));
  assert.ok(validated.document, JSON.stringify(validated.report.issues));
  const compiled = compileSceneDocument(validated.document);
  assert.ok(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
  const labels = compiled.renderScene.primitives.filter(p => p.kind === "label").map(p => {
    assert.ok(typeof p.text === "string", "Compiled label text required");
    return p.text;
  });
  assert.ok(labels.every(text => !/NaN|Infinity/.test(text)));
  return { labels: labels.map(compact), caption: compiled.renderScene.caption };
}

for (const row of ROWS) {
  assert.equal(createHash("sha256").update(row.question).digest("hex"), row.questionSha256);
  for (const seam of ["direct", "schematic", "ordinary"] as const) {
    const record: Evidence = { id: row.id, questionSha256: row.questionSha256, seam, passed: false };
    try {
      const spec = kineticsFromStem(row.question);
      const scene = seam === "ordinary"
        ? synthesizeFamilyScene({ question: row.question })?.document ?? null
        : buildKineticsScene(row.question, [], seam === "schematic");
      if (row.kind === "decline") {
        assert.equal(spec, null, "Unread/wrong-unit concentration request must refuse, rather than disappear");
        assert.equal(scene, null, "Partial concentration request cannot render a generic curve");
      } else if (row.kind === "temperature") {
        assert.ok(spec && scene, "Unrelated temperature-change figure remains supported");
        assert.deepEqual(spec.concentrationsAsked, [], "Kelvin endpoints are not concentration requests");
        assert.ok(spec.arrhenius);
        nearRaw(spec.arrhenius.T1, 300);
        nearRaw(spec.arrhenius.T2, 310);
        nearRaw(spec.arrhenius.ratio, 2);
        const solution = solveKinetics(spec);
        assert.deepEqual(solution.timesForConcentrations, []);
        const independentEa = 8.314 * Math.log(2) / (1 / 300 - 1 / 310);
        nearRaw(solution.Ea, independentEa);
        stored(scene, independentEa, ["J/mol"]);
        checkedScene(scene, row.question);
      } else if (row.kind === "initial") {
        assert.ok(spec && scene, "Complete named-reactant initial concentration must reach the decay figure");
        assert.ok(row.a0 !== undefined && row.k !== undefined && row.timeUnit !== undefined);
        assert.equal(spec.order, 1);
        nearRaw(spec.a0, row.a0);
        assert.equal(spec.concUnit, "M", "mol/L and M declarations normalize to molarity");
        nearRaw(spec.k, row.k);
        assert.equal(spec.timeUnit, row.timeUnit);
        const solution = solveKinetics(spec);
        // Independent first-order law: A(t) = A0*exp(-k*t), so tHalf = ln(2)/k.
        const halfLife = Math.LN2 / row.k;
        nearRaw(solution.k, row.k);
        nearRaw(solution.tHalf, halfLife);
        stored(scene, row.k, [`1/${row.timeUnit}`]);
        stored(scene, halfLife, [row.timeUnit]);
        const rendered = checkedScene(scene, row.question);
        assert.ok(rendered.labels.includes("[A]/[A]_0"), "Compiled normalized concentration axis missing");
        assert.ok(rendered.labels.some(text => text.startsWith("t_1/2=") && text.endsWith(row.timeUnit!)),
          "Compiled half-life mark must carry the source time unit");
      } else {
        assert.ok(spec && scene, "Complete source-owned concentration request must reach the figure");
        assert.equal(spec.order, 0);
        assert.equal(spec.timeUnit, "h");
        nearRaw(spec.a0, 2);
        nearRaw(spec.tHalf, 1);
        assert.deepEqual(spec.concentrationsAsked, [0.50, 0.25], "Both original concentration operands are mandatory");
        const solution = solveKinetics(spec);
        // Independent zero-order law: k = A0/(2*tHalf) = 1 M/h;
        // t(A) = (A0-A)/k gives1.5h,1.75h and requested interval0.25h.
        nearRaw(solution.k, 1);
        assert.equal(solution.timesForConcentrations.length, 2);
        const first = solution.timesForConcentrations[0];
        const second = solution.timesForConcentrations[1];
        assert.ok(first && second);
        nearRaw(first.concentration, 0.50);
        nearRaw(second.concentration, 0.25);
        nearRaw(first.time, 1.5);
        nearRaw(second.time, 1.75);
        nearRaw(second.time - first.time, 0.25);
        stored(scene, 0.50, ["M", "mol/L"]);
        stored(scene, 0.25, ["M", "mol/L"]);
        stored(scene, 1.5, ["h"]);
        stored(scene, 1.75, ["h"]);
        stored(scene, 0.25, ["h"]);
        const rendered = checkedScene(scene, row.question);
        assert.ok(rendered.labels.includes("0.5M,1.5h"), JSON.stringify(rendered.labels));
        assert.ok(rendered.labels.includes("0.25M,1.75h"), JSON.stringify(rendered.labels));
        assert.ok(rendered.labels.some(text => /^(?:Δt|dt)=0\.25h$/.test(text)), "Requested interval label with complete h unit missing");
        assert.ok(typeof rendered.caption === "string", "Compiled requested-interval caption missing");
        assert.ok(/From0\.5Mto0\.25Mtakes0\.25h\./.test(compact(rendered.caption)), rendered.caption);
      }
      record.passed = true;
      console.log(`PASS ${row.id}/${seam}`);
    } catch (error) {
      record.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      console.error(`FAIL ${row.id}/${seam}: ${record.error}`);
    }
    evidence.push(record);
  }
}
const result = { schema: "chemistry-kinetics-concentration-requests/v1", questions: ROWS.length,
  checks: evidence.length, passed: evidence.filter(row => row.passed).length,
  failed: evidence.filter(row => !row.passed).length, rows: evidence };
const outIndex = process.argv.indexOf("--out");
if (outIndex !== -1) {
  const out = process.argv[outIndex + 1];
  assert.ok(out, "--out path required");
  writeFileSync(out, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
}
console.log(JSON.stringify(result));
if (result.failed) process.exitCode = 1;
