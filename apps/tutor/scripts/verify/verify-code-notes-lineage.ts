/** Historical PDF collection must retain shown code across compatible resumes. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { getMockCodeLessonPlan, type CodeLessonPlan } from "@heytutor/tutor-core";
import { boardContinuationArtifacts } from "../../lib/boards/boardContinuation";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { notesPdfSectionsFromStoredTurns } from "../../features/tutor-session/lib/notes/notesPdf";
import { CODE_RENDER_METRICS } from "../../lib/code-render/renderCodeToCanvas";
import type { CodeLessonNotesReveal } from "../../lib/code-render/codeLessonNotesImages";

const app = path.resolve(import.meta.dirname, "../..");
const requireApp = createRequire(path.join(app, "package.json"));
const ref = (current: unknown) => ({ current });
const react = { useRef: ref, useCallback: (fn: unknown) => fn, useEffect() {} };
function load(relative: string, sourceOverride?: string, overrides: Record<string, unknown> = {}) {
  const filename = path.join(app, relative);
  const js = ts.transpileModule(readFileSync(sourceOverride ?? filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as Record<string, (...args: unknown[]) => unknown> };
  new Function("require", "module", "exports", js)((id: string) => id === "react" ? react
    : id in overrides ? overrides[id] : requireApp(id.startsWith(".") ? path.resolve(path.dirname(filename), id) : id), mod, mod.exports);
  return mod.exports;
}
// Load real tokenizer/controller dependencies before installing the canvas boundary.
const helper = load("lib/code-render/codeLessonNotesImages.ts", process.env.CODE_NOTES_LINEAGE_SOURCE);
const question = "Explain binary search on a sorted array.";
const plan = getMockCodeLessonPlan(question);
const [a, b, c] = plan.sections[0]!.blocks;
assert(a && b && c);
function turn(id: string, blockIds: string[], options: {
  continuation?: string; plan?: CodeLessonPlan; question?: string; unfinished?: boolean; untimed?: boolean; clear?: boolean;
} = {}): StoredTurn {
  const ownPlan = options.plan ?? plan;
  const segments: StoredTurn["segments"] = blockIds.map((blockId, orderIndex) => ({
    id: `${id}-${orderIndex}`, orderIndex, narration: "Recorded typing", spokenText: "Recorded typing",
    command: { type: "TYPE", params: [], text: ownPlan.sections.flatMap(section => section.blocks).find(block => block.id === blockId)!.code, charPosition: 0, narrationBefore: "", semanticRef: { entityId: blockId } },
    audioUrl: null, durationMs: options.untimed ? null : 1000, timings: null,
  }));
  if (options.clear) segments.unshift({ id: `${id}-clear`, orderIndex: -1, narration: "", spokenText: "", command: { type: "CLEAR", params: [], text: "", charPosition: 0, narrationBefore: "" }, audioUrl: null, durationMs: null, timings: null });
  return { id, orderIndex: 0, question: options.question ?? question, rawResponse: "Recorded lesson", speedMultiplier: 1,
    traceId: null, status: options.unfinished ? "stopped" : "complete", persistedStatus: options.unfinished ? "stopped" : "complete",
    sceneDocument: null, sceneEngineVersion: null, validationReport: null, visualStatus: "text_only",
    sceneArtifacts: { codeLesson: ownPlan, ...(options.continuation ? boardContinuationArtifacts(options.continuation) : {}) }, segments };
}
const originalDocument = globalThis.document;
Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => {
  const texts: string[] = [];
  const canvas = { width: 0, height: 0 };
  const ctx = new Proxy({ fillText: (text: string, x: number, y: number) => {
    if (x >= CODE_RENDER_METRICS.gutterWidth + CODE_RENDER_METRICS.codeLeftPadding && y > CODE_RENDER_METRICS.sectionBarHeight && y < canvas.height / 2 - CODE_RENDER_METRICS.statusBarHeight) texts.push(text);
  }, measureText: (text: string) => ({ width: text.length * 8 }) }, {
    get: (target, key) => key in target ? target[key as keyof typeof target] : () => {}, set: () => true,
  });
  return Object.assign(canvas, { getContext: () => ctx, toDataURL: () => texts.join("") });
} } });
function render(turns: StoredTurn[], captured?: CodeLessonNotesReveal) {
  const sections = notesPdfSectionsFromStoredTurns(turns, []);
  helper.appendCodeLessonNotesImages!(sections, turns, captured);
  return sections.map(section => section.images.join(""));
}
async function main() {
  const single = render([turn("single", [a!.id, b!.id])]);
  assert(single[0]!.includes("while lo <= hi:"), "actual renderer paints both recorded blocks when supplied together");
  console.log("control: one turn containing A and B renders B");
  const original = turn("original", [a!.id], { unfinished: true });
  const resume = turn("resume", [b!.id], { continuation: question, untimed: true });
  const historical = render([original, resume]);
  assert(historical[1]!.includes("while lo <= hi:"), "historical resumed PDF must include block B typed after block A");
  assert(historical[1]!.includes("def binary_search"), "resumed notes retain the earlier taught prefix");
  assert(!historical[0]!.includes("while lo <= hi:"), "later typing cannot leak into the original historical page");
  assert(!historical[1]!.includes("return mid"), "untaught future block C stays hidden");
  const resumedAgain = render([original, resume, turn("resume-again", [c!.id], { continuation: question })]);
  assert(resumedAgain[2]!.includes("return mid"), "successive resumes retain cumulative recorded code");
  assert(!resumedAgain[1]!.includes("return mid"), "future resume cannot enter an earlier notes page");
  const unfinished = turn("unfinished", [b!.id], { continuation: question, untimed: true, unfinished: true });
  assert(!render([original, unfinished])[1]!.includes("while lo <= hi:"), "unfinished untimed TYPE is not proof of the complete block");
  const prefix = b!.code.slice(0, 16);
  const receipt = { turnId: unfinished.id, plan, revealedChars: { [a!.id]: a!.code.length, [b!.id]: prefix.length } };
  const cut = render([original, unfinished], receipt);
  assert(cut[1]!.includes(prefix.trim()), "same-turn live receipt retains actual partial resumed typing");
  assert(!cut[1]!.includes("hi:"), "partial receipt does not expose remaining block characters");
  assert(!cut[0]!.includes(prefix.trim()), "current partial receipt cannot change the earlier lesson page");
  const changedPlan = { ...plan, title: "A separately planned lesson" };
  for (const [label, turns] of [
    ["new same-question lesson", [original, turn("fresh", [b!.id])]],
    ["explicit CLEAR", [original, turn("clear", [b!.id], { continuation: question, clear: true })]],
    ["changed plan", [original, turn("changed", [b!.id], { continuation: question, plan: changedPlan })]],
    ["wrong continuation question", [original, turn("wrong-marker", [b!.id], { continuation: "Different lesson" })]],
    ["different question with identical plan", [original, turn("wrong-question", [b!.id], { question: "Different lesson" })]],
  ] as const) {
    assert(!render([...turns])[1]!.includes("while lo <= hi:"), `${label} cannot borrow block A`);
  }
  const doubt = { ...turn("doubt", [], { question: "Why does it halve?", continuation: question }), sceneArtifacts: boardContinuationArtifacts(question) };
  assert(render([original, doubt, resume])[2]!.includes("while lo <= hi:"), "same-page doubt without a code plan preserves compatible lineage");
  const invalid = { ...doubt, sceneArtifacts: { ...boardContinuationArtifacts(question), codeLesson: { ...plan, schemaVersion: "unknown" } } };
  assert(!render([original, invalid, resume])[2]!.includes("while lo <= hi:"), "invalid intervening plan breaks code authority rather than borrowing earlier receipts");
  assert(!render([original, turn("changed", [], { continuation: question, plan: changedPlan }), resume])[2]!.includes("while lo <= hi:"), "returning to an older plan cannot recover receipts across a changed-plan boundary");
  assert(!render([original, unfinished], { ...receipt, plan: changedPlan })[1]!.includes("while lo <= hi:"), "different-plan live receipt cannot reveal unfinished code");
  // Actual replay notes collector after opening a different lesson: no live code
  // state can conceal the historical reconstruction error.
  const replay = load("features/tutor-session/hooks/useReplay.ts", process.env.CODE_NOTES_REPLAY_SOURCE, {
    "@/lib/code-render/codeLessonNotesImages": helper,
  });
  const collector = replay.useReplay!({ whiteboardRef: ref({ captureSnapshot: () => "new lesson board" }),
    notesEpochsRef: ref([]), narrationSinceEpochRef: ref("new lesson"), liveQuestionRef: ref("Different lesson"),
    storedTurnsRef: ref([original, resume, { ...turn("new", []), question: "Different lesson", sceneArtifacts: null }]),
    codeLessonControllerRef: ref(null), replayCueRef: ref(null), phaseRef: ref("idle"),
  }) as { collectNotesSlides: () => Promise<string[]> };
  const images = await collector.collectNotesSlides();
  assert(images.some(image => image.includes("while lo <= hi:")), "actual history PDF collector includes resumed block after another lesson opens");
  const { CodeLessonController } = requireApp("./features/tutor-session/lib/code-lesson/codeLessonController");
  const controller = new CodeLessonController();
  controller.commit(plan);
  Object.assign(controller.getState().revealedChars, receipt.revealedChars);
  const liveCollector = replay.useReplay!({ whiteboardRef: ref({ captureSnapshot: () => "current cut board" }),
    notesEpochsRef: ref([]), narrationSinceEpochRef: ref("resumed typing"), liveQuestionRef: ref(question),
    storedTurnsRef: ref([original, unfinished]), codeLessonControllerRef: ref(controller), replayCueRef: ref(null), phaseRef: ref("teaching"),
  }) as { collectNotesSlides: () => Promise<string[]> };
  const liveImages = await liveCollector.collectNotesSlides();
  const codeImages = liveImages.filter(image => image.includes("def binary_search"));
  assert.equal(codeImages.length, 2, "actual collector keeps each historical turn's code page");
  assert(!codeImages[0]!.includes(prefix.trim()), "actual collector assigns live receipt to current continuation, not its earlier opener");
  assert(codeImages[1]!.includes(prefix.trim()) && !codeImages[1]!.includes("hi:"), "actual collector renders the current partial continuation without future code");
  const laterCollector = replay.useReplay!({ whiteboardRef: ref({ captureSnapshot: () => "another lesson board" }),
    notesEpochsRef: ref([]), narrationSinceEpochRef: ref("other lesson"), liveQuestionRef: ref("Different lesson"),
    storedTurnsRef: ref([original, unfinished, { ...turn("later", []), question: "Different lesson", sceneArtifacts: null }]),
    codeLessonControllerRef: ref(controller), replayCueRef: ref(null), phaseRef: ref("idle"),
  }) as { collectNotesSlides: () => Promise<string[]> };
  assert(!(await laterCollector.collectNotesSlides()).some(image => image.includes(prefix.trim())), "stale controller cannot supply a receipt across a later page boundary");
  console.log("verify-code-notes-lineage: actual historical collector and renderer retain A then resumed B without future C");
}
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
});
