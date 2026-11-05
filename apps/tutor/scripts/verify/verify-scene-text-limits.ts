/**
 * Scene text has fixed sizes, and laying out a figure's labels has a fixed budget.
 * A document over a size is refused before anything reads it, with one closed code
 * and no document text in the issue. Figures inside the sizes draw exactly as they did.
 */
import {
  LABEL_MEASURE_CHAR_BUDGET,
  EXPRESSION_STEP_BUDGET,
  FIGURE_POINT_BUDGET,
  LABEL_OVERLAP_WORK_BUDGET,
  SCENE_COUNT_LIMITS as N,
  SCENE_DOCUMENT_VERSION,
  SCENE_INPUT_LIMITS as I,
  SCENE_TEXT_LIMITS as L,
  boundsOverlap,
  canPlaceSingleLabel,
  compileSceneDocument,
  isLabelWorkSpent,
  placeLabels,
  sceneCountOverLimit,
  stackLabelRows,
  sceneTextOverLimit,
  synthesizeFamilyScene,
  validateSceneDocument,
  withSharedLabelWork,
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
if (LABEL_OVERLAP_WORK_BUDGET !== 48_000_000) fail("the overlap budget moved", LABEL_OVERLAP_WORK_BUDGET);
if (FIGURE_POINT_BUDGET !== 16_384) fail("the point budget moved", FIGURE_POINT_BUDGET);
if (EXPRESSION_STEP_BUDGET !== 16_000_000) fail("the expression budget moved", EXPRESSION_STEP_BUDGET);
const PINNED_COUNTS = {
  entities: 768, constructions: 768, annotations: 64, revealGroups: 32, assertions: 256, quantities: 128, relations: 32, teachingTimeline: 128, perKind: 32,
  kinds: { point: 768, segment: 256, rectangle: 256, vector: 128, label: 128, circle: 96, connect: 96, connector: 96, tick_mark: 64, space_point: 64, space_segment: 64, component: 48, curve_anchor: 48, polyline: 48, symbol: 48, dimension: 16, field_lines: 4, implicit_curve: 8, constraint_region: 4, centre_of_mass: 4, simple_body_inertia: 4, linear_feasible_region: 3, harmonic_wave: 8, wave_superposition: 4, function_region: 8 },
};
if (JSON.stringify(N) !== JSON.stringify(PINNED_COUNTS)) fail("the scene counts moved", N);
if (JSON.stringify(I) !== JSON.stringify({ fieldLineSteps: 1_600, waveHarmonicSamples: 16_384 })) fail("the input sizes moved", I);

interface FigureEntity { id: string; label?: string; role?: string }
interface Figure {
  source: { question: string };
  entities: FigureEntity[];
  constructions: Array<{ id: string; operator: string; inputs: Record<string, unknown>; outputs: string[] }>;
  requiredEntityIds?: string[];
  annotations?: unknown[];
  revealGroups?: unknown[];
}

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
  return made.document as unknown as Figure;
});
const clone = (document: Figure) => structuredClone(document);
const fill = (part: string, chars: number) => part.repeat(Math.ceil(chars / part.length)).slice(0, chars);
const spaces = (count: number) => " ".repeat(count);
const save = async (document: Figure) => canonicalizeTurnSceneMetadata({
  question: document.source.question, rawResponse: "x", segments: [], visualStatus: "validated", sceneDocument: document,
  sceneArtifacts: { schemaVersion: "scene-artifacts/v3", diagramResultStatus: "ready", representationTier: "qualitative_verified", nonMetric: true },
} as never);
const base = figures[0]!;
const labelled = (document: Figure) => document.entities.find((entity) => typeof entity.label === "string")!;

async function main() {
// Every text shape in every field that reads it, far over the sizes. Each is refused before anything reads it.
const withLabel = (text: string) => { const d = clone(base); labelled(d).label = text; return d; };
const withRole = (text: string) => { const d = clone(base); d.entities[0]!.role = text; return d; };
const withNote = (text: string) => { const d = clone(base); d.annotations = [{ id: "note", kind: "callout", text, targetIds: [d.entities[0]!.id] }]; return d; };
const farOver: Array<[string, Figure]> = [
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
const atTheSizes: Array<[string, (document: Figure) => void]> = [
  ["every label wide", (d) => { let index = 0; for (const entity of d.entities) if (typeof entity.label === "string") entity.label = `${index++}${fill("W", L.labelChars - 3)}`; }],
  ["every label at a medium size", (d) => { let index = 0; for (const entity of d.entities) if (typeof entity.label === "string") entity.label = `${index++}${fill("W", 45)}`; }],
  ["the whole label total", (d) => { let index = 0; for (const entity of d.entities) { if (index >= Math.floor(L.labelTotalChars / L.labelChars)) break; entity.label = `${index++}${fill("W", L.labelChars - 3)}`; } }],
  ["words in every label", (d) => { let index = 0; for (const entity of d.entities) if (typeof entity.label === "string") entity.label = `${index++} ${fill("a ", L.labelChars - 4)}`; }],
  ["notes at the total", (d) => { d.annotations = Array.from({ length: Math.floor(L.annotationTotalChars / L.textChars) }, (_, index) => ({ id: `note${index}`, kind: "callout", text: fill(`5 m${spaces(L.whitespaceRun)}!`, L.textChars), targetIds: [d.entities[0]!.id] })); }],
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
const stringsTotal = (raw: unknown): number => {
  if (typeof raw === "string") return raw.length;
  if (Array.isArray(raw)) return raw.reduce((sum: number, entry) => sum + stringsTotal(entry), 0);
  if (raw && typeof raw === "object") return Object.entries(raw).reduce((sum, [key, entry]) => sum + key.length + (key === "question" ? 0 : stringsTotal(entry)), 0);
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
  ["other axis title", (over) => shell({ constructions: [{ inputs: { yLabel: "a".repeat(L.labelChars + over) } }] })],
  ["symbol", (over) => shell({ quantities: [{ symbol: "a".repeat(L.nameChars + over) }] })],
  ["unit", (over) => shell({ quantities: [{ unit: "a".repeat(L.nameChars + over) }] })],
  ["operator", (over) => shell({ constructions: [{ operator: "a".repeat(L.nameChars + over) }] })],
  ["kind", (over) => shell({ entities: [{ kind: "a".repeat(L.nameChars + over) }] })],
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

// Only the document's own question is exempt. A copy of the stem counts like other text, and any other question is plain text.
const copies = (count: number, chars: number) => shell({ source: { question: "Q", extra: Array.from({ length: count }, () => ({ question: "a".repeat(chars) })) } });
if (sceneTextOverLimit(copies(1, L.questionChars)) !== null) fail("a stem copy at its size", null);
if (sceneTextOverLimit(copies(1, L.questionChars + 1))?.code !== OVER) fail("a stem copy one past its size", null);
if (sceneTextOverLimit(copies(Math.ceil(L.totalChars / L.questionChars) + 1, L.questionChars))?.code !== OVER) fail("stem copies count toward the total", null);
if (sceneTextOverLimit(shell({ source: { question: "Q", copy: { question: `a${spaces(L.whitespaceRun + 1)}b` } } }))?.code !== OVER) fail("a stem copy is held to the whitespace run", null);
if (sceneTextOverLimit(shell({ source: { question: "Q", copy: { question: "7".repeat(L.digitRun + 1) } } }))?.code !== OVER) fail("a stem copy is held to the digit run", null);
if (sceneTextOverLimit(shell({ extra: [{ question: "a".repeat(L.textChars) }] })) !== null) fail("a question outside source at the text size", null);
if (sceneTextOverLimit(shell({ extra: [{ question: "a".repeat(L.textChars + 1) }] }))?.code !== OVER) fail("a question outside source is plain text", null);
if (sceneTextOverLimit(shell({ extra: { question: `a${spaces(L.whitespaceRun + 1)}b` } }))?.code !== OVER) fail("a gap in a question outside source", null);

// Keys count toward the total, in whatever order the document lists them.
const manyKeys = Object.fromEntries(Array.from({ length: L.entries }, (_, index) => [String(index).padEnd(L.nameChars, "k"), 1]));
const keysLast = { a: Array.from({ length: 42 }, () => "a".repeat(L.textChars)), extra: manyKeys };
const keysFirst = { extra: manyKeys, a: keysLast.a };
if (stringsTotal(keysLast) <= L.totalChars) fail("the key rows need more text", stringsTotal(keysLast));
if (sceneTextOverLimit(keysLast)?.code !== OVER || sceneTextOverLimit(keysFirst)?.code !== OVER) fail("keys count toward the total", null);

// Each count, right at it and one past it, for lists and for kinds.
const COUNT = "scene_count_over_limit";
const many = (count: number, make: (index: number) => unknown) => Array.from({ length: count }, (_, index) => make(index));
for (const field of ["entities", "constructions", "annotations", "revealGroups", "assertions", "quantities", "relations", "teachingTimeline"] as const) {
  if (sceneCountOverLimit({ [field]: many(N[field], () => ({})) }) !== null) fail(`${field}: at the count`, null);
  const past = sceneCountOverLimit({ [field]: many(N[field] + 1, () => ({})) });
  if (past?.code !== COUNT || past.path !== "$" || past.severity !== "fatal" || past.message.length > 60) fail(`${field}: one past the count`, past);
}
for (const [kind, limit] of [...Object.entries(N.kinds), ["some_other_kind", N.perKind], ["constructor", N.perKind], ["__proto__", N.perKind]] as Array<[string, number]>) {
  for (const [field, key] of [["constructions", "operator"], ["entities", "kind"]] as const) {
    if (sceneCountOverLimit({ [field]: many(limit, () => ({ [key]: kind })) }) !== null) fail(`${kind} in ${field}: at the count`, limit);
    if (sceneCountOverLimit({ [field]: many(limit + 1, () => ({ [key]: kind })) })?.code !== COUNT) fail(`${kind} in ${field}: one past the count`, limit);
  }
}
if (validateSceneDocument({ ...clone(base), entities: many(N.entities + 1, (index) => ({ id: `e${index}`, kind: "point", role: "point" })) }).report.issues[0]?.code !== COUNT) fail("the validator checks counts", null);
if (compileSceneDocument({ ...clone(base), entities: many(N.entities + 1, (index) => ({ id: `e${index}`, kind: "point", role: "point" })) } as never).report.issues[0]?.code !== COUNT) fail("the compiler checks counts", null);

// Rows that add entities to a real figure, at each count, through compile and save.
const requireEntity = (d: Figure, id: string) => {
  d.requiredEntityIds?.push(id);
  (d.revealGroups?.[0] as { entityIds?: string[] } | undefined)?.entityIds?.push(id);
};
const point = (d: Figure, id: string, x: number, y: number, label?: string) => {
  d.constructions.push({ id: `c_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "layout" }, outputs: [id] });
  d.entities.push({ id, kind: "point", role: "point", ...(label ? { label } : {}) } as FigureEntity);
  requireEntity(d, id);
};
const between = (operator: string, kind: string, extra: Record<string, unknown> = {}) => (d: Figure, index: number, label?: string) => {
  const start = `s${index}`; const end = `t${index}`;
  point(d, start, 2 * Math.cos(index), 2 * Math.sin(index));
  point(d, end, 5 * Math.cos(1.7 * index), 5 * Math.sin(1.7 * index));
  const id = `k${index}`;
  d.constructions.push({ id: `c_${id}`, operator, inputs: { start, end, ...extra }, outputs: [id] });
  d.entities.push({ id, kind, role: kind, ...(label ? { label } : {}) } as FigureEntity);
  requireEntity(d, id);
};
const centred = (operator: string, kind: string, inputs: Record<string, unknown>) => (d: Figure, index: number, label?: string) => {
  const center = `s${index}`;
  point(d, center, 4 * Math.cos(index), 4 * Math.sin(index));
  const id = `k${index}`;
  d.constructions.push({ id: `c_${id}`, operator, inputs: { center, ...inputs }, outputs: [id] });
  d.entities.push({ id, kind, role: kind, ...(label ? { label } : {}) } as FigureEntity);
  requireEntity(d, id);
};
// Room left for one kind on the figure, under that kind's count and the whole document's.
const room = (kind: keyof typeof N.kinds, perAdded: number) => {
  const held = Math.max(base.constructions.filter((entry) => entry.operator === kind).length, base.entities.filter((entity) => (entity as unknown as { kind?: string }).kind === kind).length);
  return Math.min(N.kinds[kind] - held, Math.floor((N.entities - base.entities.length) / perAdded));
};
const added: Array<[string, number, (d: Figure, index: number, label?: string) => void]> = [
  ["points", room("point", 1), (d, index, label) => point(d, `s${index}`, 5 * Math.cos(1.7 * index), 5 * Math.sin(2.3 * index), label)],
  ["fewer points, so each can hold a label", L.labelCount - 16, (d, index, label) => point(d, `s${index}`, 5 * Math.cos(1.7 * index), 5 * Math.sin(2.3 * index), label)],
  ["segments", room("segment", 3), between("segment", "segment")],
  ["vectors", room("vector", 3), between("vector", "vector")],
  ["connectors", room("connector", 3), between("connect", "connector")],
  ["dimensions", room("dimension", 3), between("dimension", "dimension")],
  ["circles", room("circle", 2), centred("circle", "circle", { radius: 1 })],
  ["rectangles", room("rectangle", 2), centred("rectangle", "rectangle", { width: 2, height: 1 })],
];
let sawBudget = false;
for (const [name, count, add] of added) {
  for (const label of [undefined, "short", "wide"] as const) {
    const document = clone(base);
    for (let index = 0; index < count; index += 1) add(document, index, label === undefined ? undefined : label === "short" ? `L${index}` : `${index}${fill("i", 57)}`);
    if (document.entities.filter((entity) => entity.label).length > N.kinds.label * 2) continue;
    const textOver = sceneTextOverLimit(document);
    const countOver = sceneCountOverLimit(document);
    if (countOver) fail(`${name}, ${label}: inside the counts`, countOver);
    if (textOver && label === undefined) fail(`${name}: inside the sizes`, textOver);
    if (textOver) continue;
    let codes: string[] = [];
    const compileMs = cpuMs(() => { codes = compileSceneDocument(document as never).report.issues.map((issue) => issue.code); }, LIMIT_MS * 2);
    if (compileMs > LIMIT_MS * 2) fail(`${name}, ${label}: compile time`, compileMs);
    if (codes.includes("label_overlap_budget")) sawBudget = true;
    const started = process.cpuUsage();
    await save(document);
    const used = process.cpuUsage(started);
    if ((used.user + used.system) / 1000 > LIMIT_MS * 3) fail(`${name}, ${label}: save time`, used);
  }
}
if (!sawBudget) fail("no added row reached the overlap budget", null);
for (const [name, grow] of [
  ["notes", (d: Figure) => { d.annotations = many(N.annotations, (index) => ({ id: `n${index}`, kind: "callout", text: `Note ${index}`, targetIds: [d.entities[0]!.id] })); }],
  ["reveal groups", (d: Figure) => { d.revealGroups = many(N.revealGroups, (index) => ({ id: `g${index}`, entityIds: [d.entities[index % d.entities.length]!.id], narrationCue: `cue ${index}` })); }],
] as Array<[string, (d: Figure) => void]>) {
  const document = clone(base);
  grow(document);
  if (sceneCountOverLimit(document)) fail(`${name}: inside the counts`, null);
  const started = process.cpuUsage();
  await save(document);
  const used = process.cpuUsage(started);
  if ((used.user + used.system) / 1000 > LIMIT_MS * 3) fail(`${name}: save time`, used);
}

// A kind the normalizer renames is counted as what it becomes.
if (validateSceneDocument({ ...clone(base), entities: many(N.kinds.polyline, (index) => ({ id: `c${index}`, kind: "curve", role: "curve" })), constructions: [] }).report.issues.some((issue) => issue.code === COUNT)) fail("a renamed kind counts as what it becomes", null);

// Each input at its own largest value, through save.
const plain = () => ({
  schemaVersion: SCENE_DOCUMENT_VERSION, visualDecision: { mode: "scene", reason: "figure" },
  source: { question: "Draw the figure.", nonMetric: true, representationTier: "qualitative_verified" },
  entities: [] as unknown[], constructions: [] as unknown[], requiredEntityIds: [] as string[],
  revealGroups: [{ id: "g", dependsOn: [], entityIds: [] as string[], narrationCue: "the figure" }],
  assertions: [], annotations: [], quantities: [], relations: [], teachingTimeline: [],
});
const put = (d: ReturnType<typeof plain>, id: string, operator: string, kind: string, inputs: Record<string, unknown>) => {
  d.constructions.push({ id: `c_${id}`, operator, inputs, outputs: [id] });
  d.entities.push({ id, kind, role: kind });
  d.requiredEntityIds.push(id);
  d.revealGroups[0]!.entityIds.push(id);
};
const putBody = (d: ReturnType<typeof plain>, id: string, inputs: Record<string, unknown>) => {
  const outputs = many((inputs.parts as unknown[]).length + 1, (index) => `${id}_${index}`);
  d.constructions.push({ id: `c_${id}`, operator: "centre_of_mass", inputs, outputs });
  outputs.forEach((output, index) => {
    d.entities.push({ id: output, kind: index < outputs.length - 1 ? "circle" : "point", role: "body" });
    d.requiredEntityIds.push(output);
    d.revealGroups[0]!.entityIds.push(output);
  });
};
const ring = (count: number, radius: number, centre: number) => many(count, (index) => [centre + radius * Math.cos((2 * Math.PI * index) / count), radius * Math.sin((2 * Math.PI * index) / count)]);
const longY = (start: string) => { let text = start; while (text.length < 240 && (text.match(/[-+*/()]|\w+/g) ?? []).length < 118) text += "+sin(y)*0"; return text; };
const wave = { amplitude: 1, waveNumber: 1, angularFrequency: 1, phase: 0, phaseUnit: "rad", time: 0, xMin: 0, xMax: 6, origin: { x: 0, y: 0 } };
const fieldLines = (d: ReturnType<typeof plain>, index: number, starts: number, stepCount: number) => {
  put(d, `q${index}`, "point", "point", { x: 3 * index, y: 0, coordinateSpace: "layout" });
  put(d, `k${index}`, "field_lines", "polyline", { charges: [{ id: `c${index}`, position: `q${index}`, charge: 1 }], starts: ring(starts, 1.1, 3 * index), stepLength: 0.25, stepCount, k: 1, exclusionRadius: 1 });
};
const largest: Array<[string, (d: ReturnType<typeof plain>) => void]> = [
  ["field lines at their count and size", (d) => { for (let index = 0; index < N.kinds.field_lines; index += 1) fieldLines(d, index, 16, I.fieldLineSteps / 16); }],
  ["implicit curves at their count, long expressions", (d) => { for (let index = 0; index < N.kinds.implicit_curve; index += 1) put(d, `k${index}`, "implicit_curve", "polyline", { expression: longY(`(x-${index * 5})^2+y^2-1`), xMin: index * 5 - 2, xMax: index * 5 + 2, yMin: -2, yMax: 2, xSamples: 161, ySamples: 161 }); }],
  ["implicit curves at their count, many loops", (d) => { for (let index = 0; index < N.kinds.implicit_curve; index += 1) put(d, `k${index}`, "implicit_curve", "polyline", { expression: `sin(15*(x-${index * 5}))*sin(15*y)-0.3`, xMin: index * 5 - 2, xMax: index * 5 + 2, yMin: -2, yMax: 2, xSamples: 161, ySamples: 161 }); }],
  ["regions at their count and largest inputs", (d) => { for (let index = 0; index < N.kinds.constraint_region; index += 1) put(d, `k${index}`, "constraint_region", "polygon", { constraints: [...many(5, (part) => ({ expression: longY(`sin(7*y)+${index + part + 2}`), relation: "ge" })), { expression: "y-0.4", relation: "ge" }], xMin: index * 3 - 1, xMax: index * 3 + 1, yMin: 0, yMax: 6.28, samples: 161 }); }],
  ["bodies at their count and largest inputs", (d) => { for (let index = 0; index < N.kinds.centre_of_mass; index += 1) putBody(d, `k${index}`, { parts: many(16, (part) => ({ kind: "solid_sphere", mass: 1, radius: 1, center: { x: part * 3, y: index } })), axis: { origin: { x: 0, y: 0 } }, displayLength: 1, lengthUnit: "m" }); }],
  ["linear regions at their count, largest inputs", (d) => { for (let index = 0; index < N.kinds.linear_feasible_region; index += 1) put(d, `k${index}`, "linear_feasible_region", "linear_region", { variables: ["x", "y"], constraints: many(16, (part) => `${part + 1}*x + ${16 - part}*y = ${17 * (index + 1)}`) }); }],
  ["waves at their count and size", (d) => { const ids = many(N.kinds.harmonic_wave, (index) => `w${index}`); ids.forEach((id, index) => put(d, id, "harmonic_wave", "polyline", { ...wave, waveNumber: 1 + index * 0.25, samples: 2047 })); for (let index = 0; index < N.kinds.wave_superposition; index += 1) put(d, `k${index}`, "wave_superposition", "polyline", { waves: ids, samples: 2047 }); }],
  ["curve anchors at their count, on the largest wave", (d) => { const ids = many(N.kinds.harmonic_wave, (index) => `w${index}`); ids.forEach((id, index) => put(d, id, "harmonic_wave", "polyline", { ...wave, waveNumber: 1 + index * 0.25, samples: 2047 })); put(d, "sum", "wave_superposition", "polyline", { waves: ids, samples: 2047 }); for (let index = 0; index < N.kinds.curve_anchor; index += 1) put(d, `a${index}`, "curve_anchor", "point", { curve: "sum", at: 1 + index * 0.01 }); }],
  ["dimensions over the most points", (d) => { for (let index = 0; index < N.kinds.implicit_curve; index += 1) put(d, `k${index}`, "implicit_curve", "polyline", { expression: `sin(78.54*(x-${(4 + index * 0.25).toFixed(2)}))`, xMin: 4, xMax: 6, yMin: 4, yMax: 6, xSamples: 161, ySamples: 161 }); for (let index = 0; index < N.kinds.dimension; index += 1) { put(d, `s${index}`, "point", "point", { x: -3, y: 0.1 * index, coordinateSpace: "layout" }); put(d, `t${index}`, "point", "point", { x: 3, y: 0.1 * index, coordinateSpace: "layout" }); put(d, `b${index}`, "dimension", "dimension", { start: `s${index}`, end: `t${index}` }); } }],
];
// One document holding one row of each kind.
const tagged = (document: ReturnType<typeof plain>, tag: string): ReturnType<typeof plain> => {
  const ids = new Set([...document.entities, ...document.constructions].map((item) => (item as { id: string }).id));
  const walk = (value: unknown): unknown => {
    if (typeof value === "string") return ids.has(value) ? `${tag}${value}` : value;
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]));
    return value;
  };
  return walk(document) as ReturnType<typeof plain>;
};
const together = (d: ReturnType<typeof plain>) => {
  const kinds = ["field lines at their count and size", "implicit curves at their count, long expressions", "regions at their count and largest inputs", "bodies at their count and largest inputs", "linear regions at their count, largest inputs", "curve anchors at their count, on the largest wave"];
  kinds.forEach((name, index) => {
    const row = largest.find(([rowName]) => rowName === name);
    if (!row) { fail("a row for one kind", name); return; }
    const one = plain();
    row[1](one);
    const part = tagged(one, `p${index}_`);
    d.entities.push(...part.entities);
    d.constructions.push(...part.constructions);
    d.requiredEntityIds.push(...part.requiredEntityIds);
    d.revealGroups[0]!.entityIds.push(...part.revealGroups[0]!.entityIds);
  });
};
largest.push(["one of each kind at its limit", together]);
const LARGEST_LIMIT_MS = LIMIT_MS * 5;
for (const [name, build] of largest) {
  const document = plain();
  build(document);
  const over = sceneTextOverLimit(document) ?? sceneCountOverLimit(document);
  if (over) fail(`${name}: inside the limits`, over);
  const started = process.cpuUsage();
  let threw: unknown = null;
  try { await save(document as unknown as Figure); } catch (error) { threw = String(error).slice(0, 80); }
  const used = process.cpuUsage(started);
  if (threw) fail(`${name}: threw`, threw);
  if ((used.user + used.system) / 1000 > LARGEST_LIMIT_MS) fail(`${name}: save time`, (used.user + used.system) / 1000);
}
// One past a size is refused by the validator, not only by a compile.
const pastSize = plain(); fieldLines(pastSize, 0, 16, I.fieldLineSteps / 16 + 1);
if (!validateSceneDocument(pastSize).report.issues.some((issue) => issue.severity === "fatal" && issue.code.includes("field_lines"))) fail("field lines one past their size", null);
const atSize = plain(); fieldLines(atSize, 0, 16, I.fieldLineSteps / 16);
if (validateSceneDocument(atSize).report.issues.some((issue) => issue.severity === "fatal" && issue.code.includes("field_lines"))) fail("field lines at their size", null);
const waveDoc = (harmonics: number, samples: number) => { const d = plain(); const ids = many(harmonics, (index) => `w${index}`); ids.forEach((id, index) => put(d, id, "harmonic_wave", "polyline", { ...wave, waveNumber: 1 + index * 0.25, samples })); put(d, "sum", "wave_superposition", "polyline", { waves: ids, samples }); return d; };
const waveCodes = (d: ReturnType<typeof plain>) => validateSceneDocument(d).report.issues.filter((issue) => issue.severity === "fatal" && issue.code.includes("wave")).map((issue) => issue.code);
if (waveCodes(waveDoc(8, 2047)).length) fail("a wave at its size", waveCodes(waveDoc(8, 2047)));
if (!waveCodes(waveDoc(8, 2049)).length) fail("a wave one past its size", null);

// A figure past the point budget or the expression budget returns a refusal and never throws.
const pointsWork = withSharedLabelWork(() => compileSceneDocument(clone(base) as never), { points: FIGURE_POINT_BUDGET });
if (pointsWork.value.ok || pointsWork.work.spent !== "figure_point_budget" || !pointsWork.value.report.issues.some((issue) => issue.code === "figure_point_budget")) fail("a compile past the point budget refuses", pointsWork.work);
if (pointsWork.value.report.valid !== false) fail("a compile past a budget reports itself invalid", pointsWork.value.report.valid);
const curve = plain(); put(curve, "k", "implicit_curve", "polyline", { expression: "x^2+y^2-1", xMin: -2, xMax: 2, yMin: -2, yMax: 2, xSamples: 161, ySamples: 161 });
const stepsWork = withSharedLabelWork(() => compileSceneDocument(curve as never), { expressionSteps: EXPRESSION_STEP_BUDGET });
if (stepsWork.value.ok || stepsWork.work.spent !== "expression_step_budget") fail("a compile past the expression budget refuses", stepsWork.work);
const counted = withSharedLabelWork(() => compileSceneDocument(curve as never));
if (counted.work.expressionSteps === 0) fail("expression steps count", counted.work);
if (counted.work.points === 0) fail("points count", counted.work);
const laneWork = withSharedLabelWork(() => compileSceneDocument(((d) => { put(d, "c0", "implicit_curve", "polyline", { expression: "x^2+y^2-1", xMin: -2, xMax: 2, yMin: -2, yMax: 2, xSamples: 161, ySamples: 161 }); put(d, "s", "point", "point", { x: -3, y: 0, coordinateSpace: "layout" }); put(d, "t", "point", "point", { x: 3, y: 0, coordinateSpace: "layout" }); put(d, "b", "dimension", "dimension", { start: "s", end: "t" }); return d; })(plain()) as never));
if (laneWork.work.overlaps < 100) fail("the lane search counts as work", laneWork.work);

// One budget across a whole compile, whichever layout or lane check spends it.
const single = (entityId: string, text: string) => ({ entityId, text, anchor: { x: 500, y: 300 } });
let probes = 0;
const countingProbe = (text: string, x: number, y: number) => { probes += text.length; return { x, y, width: 40, height: 16 }; };
if (canPlaceSingleLabel(single("a", "a".repeat(17)) as never, [], { measureTextInkBounds: countingProbe }) || probes !== 0) fail("a lane check on a label over its size measures nothing", probes);
if (!canPlaceSingleLabel(single("a", "a".repeat(16)) as never, [], { measureTextInkBounds: countingProbe }) || probes === 0) fail("a lane check on a label at its size", probes);
const shared = withSharedLabelWork(() => {
  const budgeted = { measureTextInkBounds: countingProbe, measureCharBudget: 40 };
  const results = [placeLabels([single("a", "abcdefgh")] as never, [], budgeted)];
  for (let index = 0; index < 20 && results.at(-1)!.ok; index += 1) results.push(placeLabels([single(`b${index}`, "ijklmnop")] as never, [], budgeted));
  return results;
});
if (shared.value.at(-1)!.ok || shared.value.at(-1)!.issues[0]?.code !== "label_measure_budget" || shared.work.spent !== "label_measure_budget") fail("layouts share one measure budget", shared.work);
const laneAfterSpent = withSharedLabelWork(() => canPlaceSingleLabel(single("a", "abc") as never, [], { measureTextInkBounds: countingProbe, measureCharBudget: 0 }));
if (laneAfterSpent.value || laneAfterSpent.work.spent !== "label_measure_budget") fail("a lane check spends the same budget", laneAfterSpent.work);
// An obstacle's segments are charged too, because each one is a test.
const overlapsWith = (segmentCount: number) => withSharedLabelWork(() => placeLabels([single("a", "abc")] as never, [{
  id: "far", kind: "protected", bounds: { x: 0, y: 0, width: 1200, height: 700 },
  segments: many(segmentCount, () => [{ x: 1190, y: 690 }, { x: 1195, y: 695 }]),
}] as never, { measureTextInkBounds: countingProbe })).work.overlaps;
if (overlapsWith(400) < overlapsWith(1) * 50) fail("an obstacle's segments count as work", { many: overlapsWith(400), one: overlapsWith(1) });
// Every overlap test counts, wherever it runs, and so does the search over label pairs.
const direct = withSharedLabelWork(() => boundsOverlap({ x: 0, y: 0, width: 1, height: 1 }, { x: 9, y: 9, width: 1, height: 1 }));
if (direct.work.overlaps !== 1) fail("a direct overlap test counts", direct.work);
const crowd = (count: number) => many(count, (index) => single(`p${index}`, `P${index}`));
const pairs = withSharedLabelWork(() => placeLabels(crowd(10) as never, [], { measureTextInkBounds: countingProbe }));
if (pairs.work.overlaps < 1_000_000) fail("the search over label pairs counts", pairs.work);
// Row stacking spends the same two budgets, and past them it stops.
const rowOwners = [single("a", "row one"), single("b", "row two")];
const rowOrigin = [{ x: 600, y: 100, align: "left" as const }];
const rows = withSharedLabelWork(() => stackLabelRows(rowOwners as never, rowOrigin as never, undefined, [], { measureTextInkBounds: countingProbe }));
if (rows.work.measuredChars === 0) fail("row stacking spends the measure budget", rows.work);
let rowStop: unknown = null;
withSharedLabelWork(() => { try { stackLabelRows(rowOwners as never, rowOrigin as never, undefined, [{ id: "o", kind: "protected", bounds: { x: 0, y: 0, width: 10, height: 10 } }] as never, {}); } catch (error) { rowStop = error; } }, { overlaps: LABEL_OVERLAP_WORK_BUDGET });
if (!isLabelWorkSpent(rowStop)) fail("row stacking stops past the budget", String(rowStop));
// However the work runs out, a compile returns a refusal and never throws, and refusing reads nothing further.
for (const figure of figures) {
  let refused: ReturnType<typeof compileSceneDocument> | null = null;
  const refuseMs = cpuMs(() => { refused = withSharedLabelWork(() => compileSceneDocument(clone(figure) as never), { overlaps: LABEL_OVERLAP_WORK_BUDGET }).value; }, LIMIT_MS);
  const result = refused as unknown as ReturnType<typeof compileSceneDocument>;
  if (refuseMs > LIMIT_MS) fail("a spent compile refuses quickly", refuseMs);
  if (result.ok || result.renderScene !== null || !result.report.issues.some((issue) => issue.code === "label_overlap_budget")) fail("a compile past the budget refuses", result.report.issues.slice(0, 2));
}
// A summary row is stacked before its layout, so a stop can land outside every layout. The compile still returns a refusal.
for (const figure of figures) {
  const held = clone(figure);
  const target = labelled(held);
  held.annotations = [...(held.annotations ?? []), { id: "summary", kind: "callout", text: "F = 5 N", targetIds: [target.id] }];
  let stopped: ReturnType<typeof compileSceneDocument> | null = null;
  try {
    stopped = withSharedLabelWork(() => compileSceneDocument(held as never), { overlaps: LABEL_OVERLAP_WORK_BUDGET }).value;
  } catch (error) {
    fail("a stop outside a layout left the compile", String(error).slice(0, 80));
  }
  if (!stopped || stopped.ok || stopped.renderScene !== null) fail("a stop outside a layout refuses", stopped?.report.issues.slice(0, 2));
}
const atTheBudget = withSharedLabelWork(() => compileSceneDocument(clone(base) as never), { overlaps: LABEL_OVERLAP_WORK_BUDGET });
if (atTheBudget.value.ok || atTheBudget.work.spent !== "label_overlap_budget") fail("an overlap test past the budget stops the compile", atTheBudget.work);
const spentBefore = withSharedLabelWork(() => compileSceneDocument(clone(base) as never), { spent: "label_overlap_budget" });
if (spentBefore.value.ok || spentBefore.value.renderScene !== null || !spentBefore.value.report.issues.some((issue) => issue.code === "label_overlap_budget")) fail("a compile that spent its budget never draws", spentBefore.value.report.issues.slice(0, 2));

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
