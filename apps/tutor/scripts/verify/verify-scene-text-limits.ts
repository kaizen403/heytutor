/**
 * Scene text has fixed sizes, and laying out a figure's labels has a fixed budget.
 * A document over a size is refused before anything reads it, with one closed code
 * and no document text in the issue. Figures inside the sizes draw exactly as they did.
 */
import {
  LABEL_MEASURE_CHAR_BUDGET,
  SCENE_TEXT_LIMITS as L,
  compileSceneDocument,
  placeLabels,
  sceneTextOverLimit,
  synthesizeFamilyScene,
  validateSceneDocument,
} from "@heytutor/scene-engine";
import { findSpokenToken } from "../../../../packages/tutor-core/src/sync/cueWindow";
import { inferSceneCapabilities } from "../../../../packages/tutor-core/src/planners/sceneCapabilities";
import { cpuMs } from "../../../../packages/scene-engine/scripts/verify/cpuTime";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";

const LIMIT_MS = 2_000;
const OVER = "scene_text_over_limit";
// The first failure ends the run, because a slow row is slow whichever row it is.
const fail = (name: string, detail: unknown): never => {
  console.error(`FAIL ${name}: ${JSON.stringify(detail).slice(0, 200)}`);
  process.exit(1);
};
const quiet = console.warn; console.warn = () => {};

// The sizes themselves, so raising one is a decision and not an accident.
const PINNED = {
  labelChars: 160, labelTotalChars: 4_000, labelCount: 256, roleChars: 256, nameChars: 128, textChars: 2_000,
  annotationTotalChars: 8_000, questionChars: 12_000, totalChars: 96_000, entries: 1_024, nodes: 16_000, depth: 32,
  whitespaceRun: 16, digitRun: 400,
};
if (JSON.stringify(L) !== JSON.stringify(PINNED)) fail("the scene sizes moved", L);
if (LABEL_MEASURE_CHAR_BUDGET !== 200_000) fail("the measure budget moved", LABEL_MEASURE_CHAR_BUDGET);

const STEMS = [
  "A block of mass 2 kg rests on a rough incline of angle 30 degrees. Draw the free body diagram.",
  "Draw the ray diagram for a convex lens of focal length 10 cm with an object at 30 cm.",
  "Draw a circuit with a 12 V battery and two resistors of 3 ohm and 6 ohm in series.",
  "Draw the Lewis structure of methane.",
];
const figures = STEMS.map((question) => {
  const made = synthesizeFamilyScene({ question, families: inferSceneCapabilities(question).families });
  if (!made || !compileSceneDocument(made.document).ok) return fail("a generator row no longer draws", question);
  if (sceneTextOverLimit(made.document) !== null) fail("a generator figure is over a size", question);
  return made.document as unknown as Record<string, any>;
});
const clone = (document: Record<string, any>) => structuredClone(document);
const fill = (part: string, chars: number) => part.repeat(Math.ceil(chars / part.length)).slice(0, chars);
const spaces = (count: number) => " ".repeat(count);
const save = async (document: Record<string, any>) => canonicalizeTurnSceneMetadata({
  question: document.source.question, rawResponse: "x", segments: [], visualStatus: "validated", sceneDocument: document,
  sceneArtifacts: { schemaVersion: "scene-artifacts/v3", diagramResultStatus: "ready", representationTier: "qualitative_verified", nonMetric: true },
} as never);
const base = figures[0]!;
const labelled = (document: Record<string, any>) => document.entities.find((entity: { label?: unknown }) => typeof entity.label === "string");

async function main() {
// Every text shape in every field that reads it, far over the sizes. Each is refused before anything reads it.
const withLabel = (text: string) => { const d = clone(base); labelled(d).label = text; return d; };
const withRole = (text: string) => { const d = clone(base); d.entities[0].role = text; return d; };
const withNote = (text: string) => { const d = clone(base); d.annotations = [{ id: "note", kind: "callout", text, entityIds: [d.entities[0].id] }]; return d; };
const farOver: Array<[string, Record<string, any>]> = [
  ["a wide gap in a label", withLabel(`1${spaces(1_600)}!`)],
  ["a mid sized gap in a label", withLabel(`1${spaces(398)}!`)],
  ["repeated words in a label", withLabel(fill("a ", 800))],
  ["a wide gap in a note", withNote(`5 m${spaces(8_000)}!`)],
  ["a long note", withNote(fill("x = 1 m ", 30_000))],
  ["long brackets in a role", withRole(fill("(", 60_000))],
  ["very long brackets in a role", withRole(fill("(", 240_000))],
  ["long brackets, medium role", withRole(fill("(", 15_000))],
];
for (const [name, document] of farOver) {
  let codes: string[] = [];
  const validateMs = cpuMs(() => { codes = validateSceneDocument(document).report.issues.map((issue) => issue.code); }, LIMIT_MS);
  let compiled: string[] = [];
  const compileMs = cpuMs(() => { compiled = compileSceneDocument(document as never).report.issues.map((issue) => issue.code); }, LIMIT_MS);
  if (validateMs > LIMIT_MS || compileMs > LIMIT_MS) fail(`${name}: time`, { validateMs, compileMs });
  if (codes.join() !== OVER || compiled.join() !== OVER) fail(`${name}: refused`, { codes, compiled });
  const started = process.cpuUsage();
  const saved = await save(document);
  const used = process.cpuUsage(started);
  if ((used.user + used.system) / 1000 > LIMIT_MS) fail(`${name}: save time`, used);
  if (saved.ok) fail(`${name}: saved`, null);
  const failed = saved as unknown as { code?: string; error?: string };
  if (!JSON.stringify(failed).includes("scene_document_invalid")) fail(`${name}: closed refusal`, failed);
}

// The slowest text the sizes still allow, across real figures.
const atTheSizes: Array<[string, (document: Record<string, any>) => void]> = [
  ["every label wide", (d) => { let index = 0; for (const entity of d.entities) if (typeof entity.label === "string") entity.label = `${index++}${fill("W", L.labelChars - 3)}`; }],
  ["every label at a medium size", (d) => { let index = 0; for (const entity of d.entities) if (typeof entity.label === "string") entity.label = `${index++}${fill("W", 45)}`; }],
  ["the whole label total", (d) => { let index = 0; for (const entity of d.entities) { if (index >= Math.floor(L.labelTotalChars / L.labelChars)) break; entity.label = `${index++}${fill("W", L.labelChars - 3)}`; } }],
  ["words in every label", (d) => { let index = 0; for (const entity of d.entities) if (typeof entity.label === "string") entity.label = `${index++} ${fill("a ", L.labelChars - 4)}`; }],
  ["notes at the total", (d) => { d.annotations = Array.from({ length: Math.floor(L.annotationTotalChars / L.textChars) }, (_, index) => ({ id: `note${index}`, kind: "callout", text: fill(`5 m${spaces(L.whitespaceRun)}!`, L.textChars), entityIds: [d.entities[0].id] })); }],
  ["brackets in every role", (d) => { for (const entity of d.entities) entity.role = fill("(", L.roleChars); }],
  ["the question at its size", (d) => { d.source.question = fill("x = 1 m ", L.questionChars).trim(); }],
  ["a question that is one wide gap", (d) => { d.source.question = `sin 1${spaces(L.questionChars - 6)}!`; }],
  ["a question of digits", (d) => { d.source.question = "1".repeat(L.questionChars); }],
];
for (const [name, mutate] of atTheSizes) {
  for (const figure of figures) {
    const document = clone(figure);
    mutate(document);
    if (sceneTextOverLimit(document)) fail(`${name}: within the sizes`, sceneTextOverLimit(document));
    let threw: unknown = null;
    const started = process.cpuUsage();
    try { await save(document); } catch (error) { threw = String(error).slice(0, 80); }
    const used = process.cpuUsage(started);
    const ms = (used.user + used.system) / 1000;
    if (threw) fail(`${name}: threw`, threw);
    if (ms > LIMIT_MS * 3) fail(`${name}: time`, ms);
  }
}

// A role at its size cannot break the spoken word search, whatever it holds.
for (const text of [fill("(", L.roleChars), fill("[", L.roleChars), fill("\\", L.roleChars), fill(")", L.roleChars)]) {
  if (findSpokenToken("the words of a sentence", text) !== -1) fail("a role at its size", text.slice(0, 4));
}

// Each size, right at it and one past it.
const entityList = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `e${index}`, kind: "point", role: "point" }));
const deep = (levels: number) => { let value: unknown = 1; for (let index = 0; index < levels; index += 1) value = { a: value }; return value; };
const shell = (over: Record<string, unknown> = {}) => ({ source: { question: "Q" }, entities: [], ...over });
const stringsTotal = (raw: unknown, top = true): number => {
  if (typeof raw === "string") return raw.length;
  if (Array.isArray(raw)) return raw.reduce((sum: number, entry) => sum + stringsTotal(entry, false), 0);
  if (raw && typeof raw === "object") return Object.entries(raw).reduce((sum, [key, entry]) => sum + key.length + (key === "question" ? 0 : stringsTotal(entry, false)), 0);
  return 0;
};
const nodeCount = (raw: unknown): number => {
  if (Array.isArray(raw)) return 1 + raw.reduce((sum: number, entry) => sum + nodeCount(entry), 0);
  if (raw && typeof raw === "object") return 1 + Object.values(raw).reduce((sum: number, entry) => sum + nodeCount(entry), 0);
  return 1;
};
const sizes: Array<[string, (over: number) => unknown]> = [
  ["entity label", (over) => shell({ entities: [{ id: "e", label: "a".repeat(L.labelChars + over) }] })],
  ["node label", (over) => shell({ constructions: [{ inputs: { nodes: [{ label: "a".repeat(L.labelChars + over) }] } }] })],
  ["axis title", (over) => shell({ constructions: [{ inputs: { xLabel: "a".repeat(L.labelChars + over) } }] })],
  ["construction text", (over) => shell({ constructions: [{ inputs: { text: "a".repeat(L.labelChars + over) } }] })],
  ["label count", (over) => shell({ entities: Array.from({ length: L.labelCount + over }, () => ({ label: "a" })) })],
  ["label total", (over) => {
    const whole = Math.floor((L.labelTotalChars + over) / L.labelChars);
    const left = L.labelTotalChars + over - whole * L.labelChars;
    return shell({ entities: [...Array.from({ length: whole }, () => ({ label: "a".repeat(L.labelChars) })), ...(left ? [{ label: "a".repeat(left) }] : [])] });
  }],
  ["role", (over) => shell({ entities: [{ role: "a".repeat(L.roleChars + over) }] })],
  ["id", (over) => shell({ entities: [{ id: "a".repeat(L.nameChars + over) }] })],
  ["key", (over) => shell({ extra: { ["k".repeat(L.nameChars + over)]: 1 } })],
  ["text value", (over) => shell({ visualDecision: { reason: "a".repeat(L.textChars + over) } })],
  ["annotation text", (over) => shell({ annotations: [{ text: "a".repeat(L.textChars + over) }] })],
  ["annotation total", (over) => {
    const whole = Math.floor((L.annotationTotalChars + over) / L.textChars);
    const left = L.annotationTotalChars + over - whole * L.textChars;
    return shell({ annotations: [...Array.from({ length: whole }, () => ({ text: "a".repeat(L.textChars) })), ...(left ? [{ text: "a".repeat(left) }] : [])] });
  }],
  ["question", (over) => shell({ source: { question: "a".repeat(L.questionChars + over) } })],
  ["total", (over) => {
    const used = stringsTotal(shell({ extra: [] }));
    const left = L.totalChars - used + over;
    const whole = Math.floor(left / L.textChars);
    return shell({ extra: [...Array.from({ length: whole }, () => "a".repeat(L.textChars)), "a".repeat(left - whole * L.textChars)] });
  }],
  ["total, with no key read after the text", (over) => {
    const left = L.totalChars - stringsTotal({ a: [] }) + over;
    const whole = Math.floor(left / L.textChars);
    return { a: [...Array.from({ length: whole }, () => "a".repeat(L.textChars)), "a".repeat(left - whole * L.textChars)] };
  }],
  ["list entries", (over) => shell({ entities: entityList(L.entries + over) })],
  ["object entries", (over) => shell({ extra: Object.fromEntries(Array.from({ length: L.entries + over }, (_, index) => [`k${index}`, 1])) })],
  ["nesting", (over) => shell({ extra: deep(L.depth - 1 + over) })],
  ["value count", (over) => {
    const used = nodeCount(shell({ extra: [] }));
    const left = L.nodes - used + over;
    const lists = Math.ceil(left / (L.entries + 1));
    return shell({ extra: Array.from({ length: lists }, (_, index) => Array.from({ length: index === lists - 1 ? left - (lists - 1) * (L.entries + 1) - 1 : L.entries }, () => 1)) });
  }],
  ["whitespace run", (over) => shell({ visualDecision: { reason: `a${spaces(L.whitespaceRun + over)}b` } })],
  ["other whitespace in a run", (over) => shell({ visualDecision: { reason: `a${" ".repeat(L.whitespaceRun + over)}b` } })],
  ["digit run", (over) => shell({ visualDecision: { reason: "7".repeat(L.digitRun + over) } })],
];
for (const [name, make] of sizes) {
  const at = sceneTextOverLimit(make(0));
  const past = sceneTextOverLimit(make(1));
  if (at !== null) fail(`${name}: at the size`, at);
  if (past === null || past.code !== OVER || past.path !== "$" || past.severity !== "fatal") fail(`${name}: one past`, past);
  if (past && past.message.length > 60) fail(`${name}: closed message`, past.message);
}

// A question is held to its length only: a real stem can hold wide gaps and long numbers.
for (const question of [`a${spaces(L.questionChars - 2)}b`, "1".repeat(L.questionChars)]) {
  if (sceneTextOverLimit(shell({ source: { question } })) !== null) fail("a question inside its length", question.slice(0, 8));
}

// Keys count toward the total, in whatever order the document lists them.
const manyKeys = Object.fromEntries(Array.from({ length: L.entries }, (_, index) => [String(index).padEnd(L.nameChars, "k"), 1]));
const keysLast = { a: Array.from({ length: 42 }, () => "a".repeat(L.textChars)), extra: manyKeys };
const keysFirst = { extra: manyKeys, a: keysLast.a };
if (stringsTotal(keysLast) <= L.totalChars) fail("the key rows need more text", stringsTotal(keysLast));
if (sceneTextOverLimit(keysLast)?.code !== OVER || sceneTextOverLimit(keysFirst)?.code !== OVER) fail("keys count toward the total", null);

// A refused document never carries its text in the issue.
const refusal = validateSceneDocument(withLabel(`secretword${spaces(40)}`)).report.issues[0];
if (!refusal || JSON.stringify(refusal).includes("secretword")) fail("the issue holds document text", refusal);

// Layout never measures a label over the size, and never spends more than its budget.
const owner = (entityId: string, text: string) => ({ entityId, text, anchor: { x: 500, y: 300 } });
let measuredChars = 0;
const counting = (text: string, x: number, y: number) => { measuredChars += text.length; return { x, y, width: 40, height: 16 }; };
const tooLong = placeLabels([owner("a", "a".repeat(L.labelChars + 1)), owner("b", "b")] as never, [], { measureTextInkBounds: counting });
if (measuredChars !== 0 || tooLong.ok || tooLong.issues.map((issue) => issue.code).join() !== "label_too_long" || tooLong.issues[0]?.entityId !== "a") fail("a label over the size is not measured", { measuredChars, issues: tooLong.issues });
measuredChars = 0;
const spent = placeLabels([owner("a", "abcdefgh"), owner("b", "ijklmnop")] as never, [], { measureTextInkBounds: counting, measureCharBudget: 20 });
if (spent.ok || spent.issues[0]?.code !== "label_measure_budget" || measuredChars > 20) fail("the budget stops the measure", { measuredChars, issues: spent.issues });
measuredChars = 0;
const within = placeLabels([owner("a", "abcdefgh"), owner("b", "ijklmnop")] as never, [], { measureTextInkBounds: counting });
if (measuredChars === 0 || measuredChars > LABEL_MEASURE_CHAR_BUDGET || within.issues.some((issue) => issue.code === "label_measure_budget")) fail("an ordinary layout stays inside the budget", { measuredChars });

console.warn = quiet;
console.log("scene text limits: all rows passed");
}

main().catch((error) => fail("the gate threw", String(error)));
