/**
 * Label ink is measured fast and cached, and neither changes a single byte.
 *
 * Label placement measures the handwritten ink of every candidate box, which
 * was most of every compile. Two things now make it cheap:
 *
 *   1. `measureTextInkBounds` reads each wobbled point as the number the
 *      written path would print, instead of printing and parsing it back.
 *      `measureWrittenTextInkBounds` is the old printed route, kept as the
 *      reference.
 *   2. The compiler measures through `labelInkBoundsCache`, a bounded exact
 *      argument memo shared by every compile in the process.
 *
 * Over the golden corpus, the math and physics evaluation probes, the
 * archetype probes and the typed maths corpus this gate asserts:
 *
 *   - an uncached compile, a first cached compile and an immediate recompile
 *     from the warm cache are deep equal (render scene, label positions, provenance, report), and
 *     place labels through the identical sequence of measurements;
 *   - the uncached compile equals one measured by the printed reference
 *     (golden and evaluation scenes always; every scene with `--full`), and
 *     the two measures agree bit for bit on a sample of the corpus's own
 *     boxes plus edge values;
 *   - the cache is bounded, keeps `-0` apart from `0`, and hands out copies,
 *     so nothing one compile does to its bounds reaches another compile.
 *
 * Run: pnpm exec tsx scripts/verify/verify-label-ink-cache.ts [--full]
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { measureTextInkBounds, measureWrittenTextInkBounds } from "@heytutor/drawing";
import { inferSceneCapabilities } from "../../../tutor-core/src/planners/sceneCapabilities.ts";
import { attemptArchetypeScene } from "../../src/archetypes";
import { compileSceneDocument, labelInkBoundsCache } from "../../src/compile/compiler";
import { validateSceneDocument } from "../../src/document/validation";
import {
  createTextInkBoundsCache,
  TEXT_INK_CACHE_CAPACITY,
  type LabelBounds,
  type TextInkBoundsMeasure,
} from "../../src/labels/labelEngine";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import type { CompileResult, SceneDocument } from "../../src/types";
import { ARCHETYPE_PROBES } from "../probes/archetypeProbes";
import { EVALUATION_COMPILE_PROBES } from "../probes/evaluationCompileProbes";
import { PHYSICS_EVALUATION_COMPILE_PROBES } from "../probes/evaluationPhysicsProbes";

const full = process.argv.includes("--full");
const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "../../fixtures");

interface CorpusScene {
  id: string;
  document: SceneDocument;
  /** Small enough to compile against the printed reference on every run. */
  reference: boolean;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(fixtures, path), "utf8")) as Record<string, unknown>;
}

function validated(raw: unknown, id: string): SceneDocument {
  const result = validateSceneDocument(raw);
  assert.ok(result.document, `${id}: corpus scene must validate`);
  return result.document;
}

function loadCorpus(): CorpusScene[] {
  const scenes: CorpusScene[] = [];
  const circuit = readJson("golden/circuit-series-parallel-12ohm.json");
  for (const [key, raw] of Object.entries(circuit.sceneDocuments as Record<string, unknown>)) {
    scenes.push({ id: `golden:circuit-${key}`, document: validated(raw, key), reference: true });
  }
  const mirror = readJson("golden/optics-concave-mirror-u20-f15.json");
  scenes.push({ id: "golden:mirror", document: validated(mirror.sceneDocument, "mirror"), reference: true });
  for (const [key, raw] of Object.entries({ ...EVALUATION_COMPILE_PROBES, ...PHYSICS_EVALUATION_COMPILE_PROBES })) {
    scenes.push({ id: `evaluation:${key}`, document: validated(raw, key), reference: true });
  }
  for (const probe of ARCHETYPE_PROBES) {
    const document = attemptArchetypeScene({ question: probe.question }).scene?.document;
    if (document) scenes.push({ id: `archetype:${probe.id}`, document: structuredClone(document), reference: false });
  }
  const typed = readJson("evaluation/typed-maths-v1.json").questions as Array<{ id: string; question: string }>;
  for (const entry of typed) {
    const families = inferSceneCapabilities(entry.question).families;
    const scene = synthesizeFamilyScene({ question: entry.question, families })
      ?? synthesizeLastResortScene({ question: entry.question, families });
    if (scene) scenes.push({ id: `typed:${entry.id}`, document: structuredClone(scene.document), reference: false });
  }
  return scenes;
}

type Call = [text: string, x: number, y: number, fontHeightPx: number];

function recording(measure: TextInkBoundsMeasure, calls: Call[]): TextInkBoundsMeasure {
  return (text, x, y, fontHeightPx) => {
    calls.push([text, x, y, fontHeightPx]);
    return measure(text, x, y, fontHeightPx);
  };
}

function sameBounds(a: LabelBounds | null, b: LabelBounds | null): boolean {
  if (a === null || b === null) return a === b;
  return Object.is(a.x, b.x) && Object.is(a.y, b.y) && Object.is(a.width, b.width) && Object.is(a.height, b.height);
}

function timed<T>(run: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = run();
  return { value, ms: performance.now() - start };
}

const corpus = loadCorpus();
assert.ok(corpus.length >= 150, `corpus shrank to ${corpus.length} scenes; the gate would pass on too little`);
const counts = new Map<string, number>();
for (const scene of corpus) {
  const family = scene.id.split(":")[0]!;
  counts.set(family, (counts.get(family) ?? 0) + 1);
}

// 1. Uncached, cold cached and warm cached compiles are the same compile.
labelInkBoundsCache.clear();
const uncached: CompileResult[] = [];
const uncachedCalls: Call[][] = [];
let uncachedMs = 0;
let coldMs = 0;
let warmMs = 0;
for (const scene of corpus) {
  const calls: Call[] = [];
  const plain = timed(() => compileSceneDocument(scene.document, { measureLabelInkBounds: recording(measureTextInkBounds, calls) }));
  uncachedMs += plain.ms;
  uncached.push(plain.value);
  uncachedCalls.push(calls);
}
// Each scene compiles twice in a row through the shared cache, the way the
// live turn recompiles the planner's document before committing it.
const coldStats = { calls: 0, hits: 0 };
const warmStats = { calls: 0, hits: 0 };
let peakSize = 0;
for (const [index, scene] of corpus.entries()) {
  const before = labelInkBoundsCache.stats();
  const cold = timed(() => compileSceneDocument(scene.document));
  coldMs += cold.ms;
  const between = labelInkBoundsCache.stats();
  coldStats.calls += between.calls - before.calls;
  coldStats.hits += between.hits - before.hits;
  assert.deepStrictEqual(cold.value, uncached[index], `${scene.id}: first cached compile differs from the uncached compile`);
  assert.equal(between.calls - before.calls, uncachedCalls[index]!.length, `${scene.id}: cached placement measured a different number of boxes`);

  const calls: Call[] = [];
  const warm = timed(() => compileSceneDocument(scene.document, { measureLabelInkBounds: recording(labelInkBoundsCache.measure, calls) }));
  warmMs += warm.ms;
  const after = labelInkBoundsCache.stats();
  warmStats.calls += after.calls - between.calls;
  warmStats.hits += after.hits - between.hits;
  assert.deepStrictEqual(warm.value, uncached[index], `${scene.id}: recompile from a warm cache differs from the uncached compile`);
  assert.deepStrictEqual(calls, uncachedCalls[index], `${scene.id}: warm cached placement took a different search path`);
  peakSize = Math.max(peakSize, after.size);
}
assert.ok(peakSize <= TEXT_INK_CACHE_CAPACITY, "the shared cache outgrew its capacity");

// 2. The fast measure is the printed measure.
let referenceScenes = 0;
let referenceMs = 0;
let fastMs = 0;
for (const [index, scene] of corpus.entries()) {
  if (!full && !scene.reference) continue;
  referenceScenes += 1;
  const reference = timed(() => compileSceneDocument(scene.document, { measureLabelInkBounds: measureWrittenTextInkBounds }));
  referenceMs += reference.ms;
  fastMs += timed(() => compileSceneDocument(scene.document, { measureLabelInkBounds: measureTextInkBounds })).ms;
  assert.deepStrictEqual(uncached[index], reference.value, `${scene.id}: compile with the printed ink reference differs`);
}

const distinct = new Map<string, Call>();
for (const calls of uncachedCalls) for (const call of calls) distinct.set(call.join("\u0000"), call);
const totalCalls = uncachedCalls.reduce((sum, calls) => sum + calls.length, 0);
const sampleStride = full ? 1 : 16;
const sampled: Call[] = [...distinct.values()].filter((_, index) => index % sampleStride === 0);
const texts = [...new Set([...distinct.values()].map(([text]) => text))];
const edgeTexts = ["", " ", "A_p", "x^(2)", "∫_0^1", "∑_(i=1)^n", "αβγ", "θ=30°", "☃", "{x}", "F_net=ma", "H₂O", "x\u0000y"];
const edgeValues = [0, -0, 0.005, 0.015, 0.125, -0.005, -0.001, 1e-9, -1e-9, 400.125, 1159.995, 1e15, -1e15, 1e21, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
for (const text of edgeTexts) {
  for (const value of edgeValues) {
    sampled.push([text, value, 300, 24], [text, 600, value, 24], [text, 600.375, 300.625, value]);
  }
}
// Deterministic positions on and near hundredth half steps, where the
// printed route and the arithmetic route are most likely to part.
let seed = 0x5eed;
const random = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
for (let index = 0; index < (full ? 200_000 : 20_000); index++) {
  const text = texts[Math.floor(random() * texts.length)]!;
  const step = (value: number) => Math.round(value * 200) / 200 + (random() < 0.5 ? 0 : (random() - 0.5) * 1e-9);
  sampled.push([text, step(400 + random() * 760), step(40 + random() * 620), [24, 20, 18, 14.88][index % 4]!]);
}
const outcome = (measure: TextInkBoundsMeasure, call: Call): LabelBounds | null | string => {
  try {
    return measure(...call);
  } catch (error) {
    return `threw ${error instanceof Error ? error.message : String(error)}`;
  }
};
let measureMismatches = 0;
for (const call of sampled) {
  const fast = outcome(measureTextInkBounds, call);
  const reference = outcome(measureWrittenTextInkBounds, call);
  const agree = typeof fast === "string" || typeof reference === "string" ? fast === reference : sameBounds(fast, reference);
  if (!agree) {
    const [text, x, y, fontHeightPx] = call;
    measureMismatches += 1;
    if (measureMismatches <= 5) console.error(`  mismatch ${JSON.stringify([text, x, y, fontHeightPx])}: ${JSON.stringify(fast)} vs ${JSON.stringify(reference)}`);
  }
}
assert.equal(measureMismatches, 0, "the fast ink measure disagrees with the printed reference");

// 3. The cache cannot carry anything between compiles but exact answers.
{
  const probe = createTextInkBoundsCache(measureTextInkBounds, 64);
  const first = probe.measure("A_p", 600.5, 300.25, 24)!;
  first.x = -1;
  first.width = 1e9;
  assert.ok(sameBounds(probe.measure("A_p", 600.5, 300.25, 24), measureTextInkBounds("A_p", 600.5, 300.25, 24)),
    "editing a returned box must not change the cached answer");
  probe.measure("A_p", -0, 300, 24);
  probe.measure("A_p", 0, 300, 24);
  assert.equal(probe.stats().size, 3, "-0 and 0 are different arguments and must not share an entry");
  assert.equal(probe.stats().hits, 1);

  const stream = sampled.slice(0, 2_000);
  for (const [text, x, y, fontHeightPx] of [...stream, ...stream.slice(0, 500).reverse(), ...stream]) {
    assert.ok(sameBounds(probe.measure(text, x, y, fontHeightPx), measureTextInkBounds(text, x, y, fontHeightPx)),
      "a small cache under eviction must still answer exactly");
    assert.ok(probe.stats().size <= 64, "the cache must stay within its capacity");
  }
  assert.ok(probe.stats().evictions > 0 && probe.stats().hits > 1, "the eviction test must both evict and hit");
  probe.clear();
  assert.deepStrictEqual(probe.stats(), { calls: 0, hits: 0, evictions: 0, size: 0, capacity: 64 });

  // A compile after another compile's entries equals a compile from empty.
  const target = corpus.find((scene) => scene.id === "golden:mirror")!;
  labelInkBoundsCache.clear();
  const fresh = compileSceneDocument(target.document);
  for (const scene of corpus.filter((candidate) => candidate.reference)) compileSceneDocument(scene.document);
  assert.deepStrictEqual(compileSceneDocument(target.document), fresh, "a warm shared cache changed a later compile");
}

const percent = (part: number, whole: number) => `${whole === 0 ? 0 : ((100 * part) / whole).toFixed(1)}%`;
console.log("verify-label-ink-cache: ok");
console.log(`  scenes=${corpus.length} (${[...counts].map(([family, count]) => `${family}=${count}`).join(" ")})`);
console.log(`  measurements=${totalCalls} distinct=${distinct.size} peak-cache-size=${peakSize}/${TEXT_INK_CACHE_CAPACITY}`);
console.log(`  first compile: hits=${coldStats.hits}/${coldStats.calls} (${percent(coldStats.hits, coldStats.calls)})`);
console.log(`  recompile: hits=${warmStats.hits}/${warmStats.calls} (${percent(warmStats.hits, warmStats.calls)})`);
console.log(`  compile ms: uncached=${uncachedMs.toFixed(0)} first-cached=${coldMs.toFixed(0)} recompile=${warmMs.toFixed(0)}`);
console.log(`  printed reference: scenes=${referenceScenes} reference-ms=${referenceMs.toFixed(0)} fast-ms=${fastMs.toFixed(0)}${full ? "" : " (pass --full for every scene)"}`);
console.log(`  measure agreement: ${sampled.length} boxes bit-identical`);
