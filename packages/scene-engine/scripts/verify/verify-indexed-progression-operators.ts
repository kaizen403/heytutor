import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { evaluateIndexedProgressionConstruction, indexedProgressionPrimitives, validateIndexedProgressionConstruction, type ExactProgressionValue, type IndexedProgressionEvaluationContext, type IndexedProgressionGeometry } from "../../src/compile/indexedProgressionGeometry";
import type { RenderPrimitive, RenderScene, SceneDocument, SceneIssue } from "../../src/types";
import { renderSceneSvg } from "../lib/renderSceneSvg";

let checks = 0;
function check(condition: unknown, message: string): asserts condition { checks++; if (!condition) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string): void { check(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }
function rejects(run: () => unknown, message: string, contains?: string): void {
  let caught: unknown;
  try { run(); } catch (error) { caught = error; }
  check(caught instanceof Error && (!contains || caught.message.includes(contains)), message);
}
const quantities = new Map<string, unknown>([["quarter", { value: "1/4", unit: "1" }], ["cycle", { value: "cycle" }]]);
const context: IndexedProgressionEvaluationContext = { scalar(id) { if (!quantities.has(id)) throw new Error("missing quantity"); return quantities.get(id); } };
function run(operator: string, inputs: Record<string, unknown>): IndexedProgressionGeometry {
  const output = evaluateIndexedProgressionConstruction(operator, { origin: [0, 0], displayScale: 1, ...inputs }, context);
  check(output.length === 1 && output[0]!.kind === "indexed_progression", "one indexed progression geometry");
  const geometry = output[0]!;
  const primitives = indexedProgressionPrimitives(geometry, "series", "terms");
  check(primitives.every((primitive) => primitive.kind === "point" || primitive.kind === "label"), "no interpolating curve/line is introduced");
  check(primitives.every((primitive) => primitive.entityId === "series" && primitive.groupId === "terms" && primitive.provenance?.indexedDiscrete === true && primitive.provenance?.nonmetric === true), "all marks retain indexed nonmetric engine ownership");
  check(primitives.filter((primitive) => primitive.kind === "point").length === geometry.indexedProgression.solutions.reduce((sum, solution) => sum + solution.terms.length, 0), "all declared terms and branches have an indexed marker");
  return geometry;
}
function fraction(value: ExactProgressionValue): [bigint, bigint] { return [BigInt(value.numerator), BigInt(value.denominator)]; }
function equalFraction(value: ExactProgressionValue, numerator: bigint, denominator: bigint, message: string): void {
  const [n, d] = fraction(value);
  check(n * denominator === numerator * d, message);
}
function direct(kind: "arithmetic" | "geometric", first: unknown, parameter: unknown, indices: number[], extra: Record<string, unknown> = {}): IndexedProgressionGeometry {
  return run("indexed_progression", { kind, first, [kind === "arithmetic" ? "difference" : "ratio"]: parameter, indices, ...extra });
}
function recurrenceOracle(geometry: IndexedProgressionGeometry, first: [bigint, bigint], parameter: [bigint, bigint]): void {
  const solution = geometry.indexedProgression.solutions[0]!;
  let [n, d] = first;
  for (let index = 1; index <= Math.max(...solution.terms.map((term) => term.index)); index++) {
    const term = solution.terms.find((term) => term.index === index);
    if (term) equalFraction(term.exactValue, n, d, `independent recurrence at integer index${index}`);
    if (solution.kind === "arithmetic") { n = n * parameter[1] + parameter[0] * d; d *= parameter[1]; }
    else { n *= parameter[0]; d *= parameter[1]; }
  }
}

if (process.argv.includes("--holdout")) {
  let state = 0x15a84;
  const next = (): number => { state = (Math.imul(state, 1103515245) + 12345) >>> 0; return state; };
  for (let i = 0; i < 100; i++) {
    const a = (next() % 31) - 15;
    const step = (next() % 9) - 4;
    const displayed = Array.from({ length: 8 }, (_, index) => index + 1);
    const ap = direct("arithmetic", a, step, displayed);
    recurrenceOracle(ap, [BigInt(a), 1n], [BigInt(step), 1n]);
    const recovered = run("progression_recover", { kind: "arithmetic", observations: [{ index: 2, value: a + step }, { index: 7, value: a + 6 * step }], indices: displayed });
    equal(recovered.indexedProgression.solutions[0]!.terms, ap.indexedProgression.solutions[0]!.terms, `synthetic holdout AP recovery${i}`);
    const ratio = (next() % 7) - 3;
    recurrenceOracle(direct("geometric", a, ratio, displayed), [BigInt(a), 1n], [BigInt(ratio), 1n]);
    rejects(() => direct("arithmetic", a, step, [1, 1]), `synthetic holdout duplicate-index${i}`);
  }
  console.log(`indexed progression synthetic local holdout passed (100 cases, ${checks} checks); not a bank-question cohort`);
} else {
  for (const a of [-7, 0, 3]) for (const d of [-5, 0, 4]) for (let length = 1; length <= 16; length++) {
    const displayed = Array.from({ length }, (_, i) => i + 1);
    const geometry = direct("arithmetic", a, d, displayed, { origin: [-3, 8], displayScale: length / 4 });
    recurrenceOracle(geometry, [BigInt(a), 1n], [BigInt(d), 1n]);
    geometry.indexedProgression.solutions[0]!.terms.forEach((term) => equalFraction(term.exactValue, BigInt(a + (term.index - 1) * d), 1n, "AP closed-form oracle"));
  }
  for (const a of [-3, 0, 2]) for (const r of [-2, -1, 0, 1, 2]) for (let length = 1; length <= 16; length++) {
    const geometry = direct("geometric", a, r, Array.from({ length }, (_, i) => i + 1));
    recurrenceOracle(geometry, [BigInt(a), 1n], [BigInt(r), 1n]);
    geometry.indexedProgression.solutions[0]!.terms.forEach((term) => equalFraction(term.exactValue, BigInt(a) * BigInt(r) ** BigInt(term.index - 1), 1n, "GP independent closed-form oracle including0^0=1 for t1"));
  }
  recurrenceOracle(direct("arithmetic", "quarter", "1/3", [1, 2, 3, 4, 8, 16, 64]), [1n, 4n], [1n, 3n]);
  recurrenceOracle(direct("geometric", "3/2", "-1/3", [1, 2, 4, 8, 16]), [3n, 2n], [-1n, 3n]);
  recurrenceOracle(direct("arithmetic", 1e6, -1e6, [1, 32, 64]), [1000000n, 1n], [-1000000n, 1n]);
  equal(direct("geometric", 0, "1e-300", [1, 64]).indexedProgression.solutions[0]!.terms.map((term) => term.value), [0, 0], "zero first term does not need enormous irrelevant powers");
  equal(direct("geometric", 7, 0, [1, 2, 64]).indexedProgression.solutions[0]!.terms.map((term) => term.value), [7, 0, 0], "zero ratio preserves first term rather than dividing by zero");

  const apWitness = direct("arithmetic", 2, -3, [1, 2, 3, 4], { witnesses: [{ kind: "equidistant_sum", indices: [1, 4, 2, 3] }] });
  equalFraction(apWitness.indexedProgression.solutions[0]!.witnesses[0]!.exactValue, -5n, 1n, "AP equidistant sum independently calculated");
  for (const r of [-2, 0, 1, 2]) {
    const witness = direct("geometric", 2, r, [1, 2, 3, 4], { witnesses: [{ kind: "equidistant_product", indices: [1, 4, 2, 3] }] });
    equalFraction(witness.indexedProgression.solutions[0]!.witnesses[0]!.exactValue, 4n * BigInt(r) ** 3n, 1n, "GP equidistant product including zero terms");
  }
  const apRecovered = run("progression_recover", { kind: "arithmetic", observations: [{ index: 9, value: -13 }, { index: 2, value: 1 }, { index: 5, value: -5 }], indices: [1, 2, 5, 9] });
  equalFraction(apRecovered.indexedProgression.solutions[0]!.first, 3n, 1n, "missing AP first recovered from two non-first observations");
  equalFraction(apRecovered.indexedProgression.solutions[0]!.parameter, -2n, 1n, "missing AP difference independently recovered");
  const gpRecovered = run("progression_recover", { kind: "geometric", observations: [{ index: 1, value: 3 }, { index: 3, value: 12 }], branch: "all_real", indices: [1, 2, 3, 4] });
  equal(gpRecovered.indexedProgression.solutions.map((solution) => solution.parameter), [{ numerator: "2", denominator: "1" }, { numerator: "-2", denominator: "1" }], "all even-power GP recovery branches retained");
  const selected = run("progression_recover", { kind: "geometric", observations: [{ index: 1, value: 3 }, { index: 3, value: 12 }, { index: 2, value: -6 }], branch: "all_real", indices: [1, 2, 3] });
  equal(selected.indexedProgression.solutions[0]!.parameter, { numerator: "-2", denominator: "1" }, "additional source observation filters the incompatible branch");
  const zeroRecovered = run("progression_recover", { kind: "geometric", observations: [{ index: 1, value: 3 }, { index: 4, value: 0 }], branch: "all_real", indices: [1, 2, 4] });
  equal(zeroRecovered.indexedProgression.solutions[0]!.terms.map((term) => term.value), [3, 0, 0], "nonzero first and later zero recover declared admissible zero ratio");
  const nonFirstGp = run("progression_recover", { kind: "geometric", observations: [{ index: 2, value: 4 }, { index: 4, value: 16 }], branch: "all_real", indices: [1, 2, 3, 4] });
  equal(nonFirstGp.indexedProgression.solutions.map((solution) => solution.first), [{ numerator: "2", denominator: "1" }, { numerator: "-2", denominator: "1" }], "both unknown first-term signs recovered with the corresponding ratio");
  const largeDerived = run("progression_recover", { kind: "geometric", observations: [{ index: 2, value: "1e6" }, { index: 4, value: "1e-6" }], branch: "positive", indices: [1, 2, 4] });
  equalFraction(largeDerived.indexedProgression.solutions[0]!.first, 1000000000000n, 1n, "recovered parameter uses derived1e12 bound, not supplied1e6 bound");
  const wideInsertion = run("progression_insert", { kind: "arithmetic", first: -1e6, last: 1e6, insertions: 0 });
  equalFraction(wideInsertion.indexedProgression.solutions[0]!.parameter, 2000000n, 1n, "derived insertion difference is not incorrectly capped as a supplied coefficient");

  const meanExamples: IndexedProgressionGeometry[] = [];
  for (let inserted = 0; inserted <= 14; inserted++) {
    for (const [a, b] of [[1, 10], [10, 1], [-5, 5], [0, 0]]) {
      const means = run("progression_insert", { kind: "arithmetic", first: a, last: b, insertions: inserted });
      const solution = means.indexedProgression.solutions[0]!;
      check(solution.terms.length === inserted + 2 && solution.terms[0]!.value === a && solution.terms.at(-1)!.value === b, "arithmetic insertion retains exact endpoint count");
      solution.terms.forEach((term) => equalFraction(term.exactValue, BigInt(a * (inserted + 1) + (b - a) * (term.index - 1)), BigInt(inserted + 1), "arithmetic means independent endpoint interpolation on integer indices only"));
      if (inserted === 2 && a === 1) meanExamples.push(means);
    }
  }
  for (let degree = 1; degree <= 12; degree++) {
    const means = run("progression_insert", { kind: "geometric", first: 1, last: 2 ** degree, insertions: degree - 1, branch: "all_real" });
    check(means.indexedProgression.solutions.length === (degree % 2 === 0 ? 2 : 1), "geometric insertion enumerates every real rational sign branch");
    for (const solution of means.indexedProgression.solutions) {
      const r = Number(solution.parameter.numerator);
      solution.terms.forEach((term) => equalFraction(term.exactValue, BigInt(r) ** BigInt(term.index - 1), 1n, "geometric means independently substituted into every endpoint/intermediate term"));
    }
    if (degree === 4) meanExamples.push(means);
  }
  const rationalMeans = run("progression_insert", { kind: "geometric", first: 9, last: 4, insertions: 1, branch: "all_real" });
  equal(rationalMeans.indexedProgression.solutions.map((solution) => solution.terms[1]!.exactValue), [{ numerator: "6", denominator: "1" }, { numerator: "-6", denominator: "1" }], "reversed positive geometric endpoints retain positive/negative means");
  const negativeEndpoint = run("progression_insert", { kind: "geometric", first: 1, last: -8, insertions: 2, branch: "negative" });
  equal(negativeEndpoint.indexedProgression.solutions[0]!.terms.map((term) => term.value), [1, -2, 4, -8], "odd negative root branch has correct alternating signs");
  const omittedMean = structuredClone(meanExamples[0]!);
  omittedMean.indexedProgression.solutions[0]!.terms.splice(1, 1);
  rejects(() => indexedProgressionPrimitives(omittedMean, "p", "g"), "every inserted mean is required, not just the endpoints");

  const base = { kind: "arithmetic", first: 1, difference: 2, indices: [1, 2, 3], origin: [0, 0], displayScale: 1 };
  for (const mutation of [
    { indices: [] }, { indices: [0, 1] }, { indices: [1, 65] }, { indices: [1, 1] }, { indices: [2, 1] }, { indices: [1, 1.5] }, { indices: Array(2) }, { indices: Array.from({ length: 17 }, (_, i) => i + 1) },
    { first: Infinity }, { first: null }, { first: true }, { first: "cycle" }, { first: "1/0" }, { first: "1e-400" }, { first: 1e6 + 1 }, { first: { value: 1, unit: "m" } },
    { ratio: 2 }, { continuous: true }, { sums: true }, { origin: [0] }, { displayScale: 0 }, { displayScale: -1 },
    { witnesses: [{ kind: "equidistant_sum", indices: [1, 1, 2, 3] }] }, { witnesses: [{ kind: "equidistant_product", indices: [1, 2, 1, 2] }] },
  ]) rejects(() => evaluateIndexedProgressionConstruction("indexed_progression", { ...base, ...mutation }, context), `invalid/mutation-${JSON.stringify(mutation)}`);
  rejects(() => direct("geometric", 1, 10, [1, 64]), "out-of-model derived magnitude remains an explicit unsupported case");
  rejects(() => run("progression_recover", { kind: "arithmetic", observations: [{ index: 1, value: 1 }, { index: 3, value: 3 }, { index: 4, value: 99 }], indices: [1, 3, 4] }), "inconsistent AP observations reject");
  rejects(() => run("progression_recover", { kind: "arithmetic", observations: [{ index: 1, value: 1 }, { index: 3, value: 3 }], indices: [1, 2] }), "omitted given index rejects rather than partial source rendering");
  rejects(() => run("progression_recover", { kind: "geometric", observations: [{ index: 2, value: 0 }, { index: 3, value: 0 }], indices: [2, 3], branch: "all_real" }), "zero terms cannot infer a ratio", "unique GP ratio");
  rejects(() => run("progression_insert", { kind: "geometric", first: 1, last: 4, insertions: 1 }), "missing signed branch cannot be invented");
  rejects(() => run("progression_insert", { kind: "geometric", first: 1, last: -4, insertions: 1, branch: "all_real" }), "negative even-root input has no real solution");
  rejects(() => run("progression_insert", { kind: "geometric", first: 1, last: 2, insertions: 1, branch: "positive" }), "irrational positive mean remains unsupported, not fabricated", "nonrational");
  rejects(() => run("progression_insert", { kind: "geometric", first: 0, last: 0, insertions: 1, branch: "all_real" }), "zero endpoints do not invent a unique ratio");

  for (const mutate of [
    (g: IndexedProgressionGeometry) => { g.indexedProgression.solutions[0]!.terms[0]!.value = 999; },
    (g: IndexedProgressionGeometry) => { g.indexedProgression.solutions[0]!.terms[0]!.index = 0; },
    (g: IndexedProgressionGeometry) => { g.indexedProgression.nonmetric = false as true; },
    (g: IndexedProgressionGeometry) => { g.indexedProgression.solutions.pop(); },
    (g: IndexedProgressionGeometry) => { g.indexedProgression.solutions[0]!.parameter.numerator = "99"; },
    (g: IndexedProgressionGeometry) => { g.indexedProgression.observations[0]!.exactValue.numerator = "99"; },
  ]) { const candidate = structuredClone(gpRecovered); mutate(candidate); rejects(() => indexedProgressionPrimitives(candidate, "p", "g"), "corrupt/omitted source branches and metadata reject before rendering"); }

  for (const [a, d] of [[5, 0], [-2, 0], [0, 0]]) {
    const ap = direct("arithmetic", a, d, [1, 2, 3]);
    const gp = direct("geometric", a, 1, [1, 2, 3]);
    equal(ap.indexedProgression.solutions[0]!.terms, gp.indexedProgression.solutions[0]!.terms, "declared constant shared AP/GP candidate satisfies both recurrences");
  }
  const incompatibleMixed = direct("arithmetic", 1, 1, [1, 2, 3]);
  rejects(() => run("progression_recover", { kind: "geometric", observations: incompatibleMixed.indexedProgression.solutions[0]!.terms.map((term) => ({ index: term.index, value: term.value })), indices: [1, 2, 3], branch: "all_real" }), "known nonconstant AP candidate fails the GP recurrence");

  function document(inputs: Record<string, unknown>): SceneDocument {
    return { schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "explicit indexed terms" }, source: {}, quantities: [{ id: "quarter", value: "1/4", unit: "1" }],
      entities: [{ id: "p", kind: "indexed_progression", role: "finite indexed terms" }], constructions: [{ id: "make-p", operator: "indexed_progression", inputs, outputs: ["p"] }],
      relations: [], assertions: [], annotations: [], requiredEntityIds: ["p"], revealGroups: [{ id: "terms", entityIds: ["p"], dependsOn: [], narrationCue: "show only finite indexed terms" }], teachingTimeline: [], };
  }
  function structural(candidate: SceneDocument): SceneIssue[] { const issues: SceneIssue[] = []; candidate.constructions.forEach((construction, i) => validateIndexedProgressionConstruction(construction, i, candidate, issues)); return issues; }
  equal(structural(document({ ...base, first: "quarter" })), [], "source-aware progression validator retains rational quantity references");
  const numericId = document({ ...base, difference: "2" });
  numericId.quantities.push({ id: "2", value: 99, unit: "m" });
  check(structural(numericId).some((issue) => issue.message.includes("ambiguous")), "numeric-spelled quantity IDs cannot bypass source/units through literal parsing");
  for (const mutate of [
    (d: SceneDocument) => { d.entities[0]!.kind = "polyline"; },
    (d: SceneDocument) => { d.constructions[0]!.outputs.push("extra"); },
    (d: SceneDocument) => { d.quantities[0]!.unit = "m"; },
    (d: SceneDocument) => { d.quantities[0]!.value = "quarter"; },
    (d: SceneDocument) => { d.quantities.push({ id: "quarter", value: 1, unit: "1" }); },
    (d: SceneDocument) => { d.constructions.push(structuredClone(d.constructions[0]!)); },
  ]) { const candidate = document({ ...base, first: "quarter" }); mutate(candidate); check(structural(candidate).some((issue) => issue.severity === "fatal"), "structural source/kind/arity/units/reference mutation rejects"); }
  const unsupported = document({ ...base });
  unsupported.constructions[0] = { id: "means", operator: "progression_insert", inputs: { kind: "geometric", first: 1, last: 2, insertions: 1, branch: "positive", origin: [0, 0], displayScale: 1 }, outputs: ["p"] };
  check(structural(unsupported).some((issue) => issue.code.startsWith("unsupported_")), "valid unsupported root remains a coverage gap rather than source-quality invalidity");
  console.log(`indexed progression operators passed (${checks} exact recurrence/branch/source/edge/mutation checks); shared source/graph/lifecycle and full mixed solving pending`);

  const renderIndex = process.argv.indexOf("--render-dir");
  if (renderIndex >= 0) {
    const out = resolve(process.argv[renderIndex + 1]!);
    mkdirSync(out, { recursive: true });
    const galleries = [
      { id: "ap", geometry: direct("arithmetic", 10, -3, Array.from({ length: 16 }, (_, i) => i + 1)), title: "Finite AP: negative difference; discrete indexed values" },
      { id: "gp", geometry: direct("geometric", 3, -2, Array.from({ length: 16 }, (_, i) => i + 1)), title: "Finite GP: alternating signs; no interpolating curve" },
      { id: "zero-ratio", geometry: direct("geometric", 7, 0, [1, 2, 3, 64]), title: "GP ratio zero: t1=a and all later terms zero" },
      { id: "means", geometry: meanExamples.at(-1)!, title: "Geometric insertion: both declared real sign branches" },
      { id: "recovery", geometry: apRecovered, title: "AP parameter recovery preserves every source observation" },
      { id: "witness", geometry: apWitness, title: "Equidistant AP term sums checked by exact recurrence" },
    ];
    for (const gallery of galleries) {
      const raw = indexedProgressionPrimitives(gallery.geometry, "p", "terms");
      const xs = raw.flatMap((primitive) => primitive.points.map((point) => point.x));
      const ys = raw.flatMap((primitive) => primitive.points.map((point) => point.y));
      const minX = Math.min(...xs), minY = Math.min(...ys), width = Math.max(...xs) - minX, height = Math.max(...ys) - minY;
      const factor = Math.min(500 / Math.max(width, 1), 380 / Math.max(height, 1), 24);
      const primitives: RenderPrimitive[] = raw.map((primitive) => ({ ...primitive, points: primitive.points.map((point) => ({ x: 500 + (point.x - minX) * factor, y: 150 + (height - (point.y - minY)) * factor })) }));
      check(primitives.every((primitive) => primitive.points.every((point) => point.x >= 400 && point.x <= 1160 && point.y >= 55 && point.y <= 610)), "offline indexed table stays in-zone");
      const scene: RenderScene = { engineVersion: "scene-engine/2.0.0", primitives, revealGroups: [{ id: "terms", entityIds: ["p"], dependsOn: [], narrationCue: "show indexed values without a continuum" }], timeline: [], entityBounds: {}, caption: "Offline indexed-value representation; coordinate graph/source/lifecycle acceptance pending" };
      writeFileSync(join(out, gallery.id + ".svg"), renderSceneSvg(scene, { title: gallery.title, subtitle: "CH-15a bounded offline authority — no question coverage or live/replay acceptance" }));
      writeFileSync(join(out, gallery.id + ".json"), JSON.stringify({ geometry: gallery.geometry, scene }, null, 2));
    }
    console.log(`Rendered${galleries.length} offline indexed-value examples;${checks} total checks`);
  }
}
