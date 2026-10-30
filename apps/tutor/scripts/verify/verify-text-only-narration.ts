/** Actual prompt consumers, not a rewrite or a grading of generated speech. */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { TurnPlanV3 } from "@heytutor/scene-engine";
import { getMockCodeLessonPlan } from "@heytutor/tutor-core";
import { verifiedDiagramHasDrawableInk } from "@heytutor/drawing";
import { buildDoubtTeachingPrompt, buildResumeTeachingPrompt, buildTurnTeachingPrompt } from "../../features/tutor-session/lib/turn/turnTeachingPrompt";

interface Fixture { question: string; turnPlan: TurnPlanV3; solverProjection?: unknown }
const question = "Explain a relation between a changing quantity and its rate, then calculate the requested value.";
const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [{ id: "result", symbol: "r" }],
  derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" };
const absence = "BOARD STATE: NO VERIFIED FIGURE";
function built(fixture: Fixture, diagramPromptAddon: string | null = null) {
  const common = { turnPlan: fixture.turnPlan, solverProjection: fixture.solverProjection ?? null, diagramPromptAddon,
    familiarity: "normal" as const, fastMode: true, boardRows: [{ workId: "w1", text: "r = a b" }],
    rowsLeftOnPage: 3, nextRowY: 211, codePanelShowing: false };
  return [buildTurnTeachingPrompt({ ...common, question: fixture.question, codeLesson: null, isDsa: false }),
    buildDoubtTeachingPrompt({ ...common, lessonQuestion: fixture.question }),
    ...(["stop", "doubt"] as const).map(reason => buildResumeTeachingPrompt({ ...common, lessonQuestion: fixture.question, reason }))];
}
function check(fixture: Fixture, diagramPromptAddon: string | null = null) {
  for (const output of built(fixture, diagramPromptAddon)) {
    for (const prompt of [output.systemPrompt, output.continuationPrompt]) {
      assert(prompt.includes(absence), "an absent verified figure must be an explicit fact in every actual prompt path");
      assert(prompt.includes("A diagram mentioned by the question or plan is not a picture on this board"));
      assert(prompt.includes('Never say "look at the figure"'), "forbid claims that absent objects are visible");
      assert(prompt.includes("You may discuss a graph, axis, curve or geometric object as mathematics"), "text-only teaching must retain mathematical content");
      assert(prompt.includes("Do not emit [FOCUS] or [ANNOTATE]"));
      assert(prompt.includes("Existing notebook rows may still be referenced with [EMPHASIZE]"), "visible work is still usable");
      assert(!prompt.includes("x below 360"), "text-only instruction must not reserve empty figure space");
      assert(prompt.includes("notebook uses the full available board width"), "no figure means no reserved narrow notebook column");
      assert(!prompt.includes("then revealed the figure"), "the base opening cannot assert a refused figure was drawn");
    }
    assert(!/The worked example on the right stays|right is the worked example, and both stay/.test(output.runtimeAddon),
      "an absent example cannot be described as visible by a secondary addon");
  }
  const fresh = built(fixture, diagramPromptAddon)[0]!;
  const length = fresh.runtimeAddon.indexOf("LESSON LENGTH FOR THIS QUESTION");
  assert(length > fresh.runtimeAddon.indexOf(absence), "keep the lesson length contract last");
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("text-only prompt gate forbids all providers/network"); };
try {
  const args = process.argv.slice(2);
  if (args.length) {
    assert.equal(args[0], "--recorded"); assert.equal(args.length, 2, "usage: --recorded <private round/runs directory>");
    let count = 0;
    for (const name of readdirSync(args[1]!).filter(name => name.endsWith(".json"))) {
      const file = path.join(args[1]!, name), before = readFileSync(file);
      const raw = JSON.parse(before.toString("utf8"));
      if (raw.diagram?.committed !== false) continue;
      const turnPlan = { ...raw.figureReplayInputs.selection.turnPlan, ...raw.plan, schemaVersion: "turn-plan/v3", question: raw.question } as TurnPlanV3;
      check({ question: raw.question, turnPlan, solverProjection: raw.solver?.projection ?? null });
      assert.deepEqual(readFileSync(file), before, "archived speech and source payload must remain unchanged");
      count++;
    }
    assert(count > 0, "recorded mode must execute real absent-figure consumers");
    console.log(`verify-text-only-narration: ${count} recorded no-figure lessons ×8 actual prompt paths; archived speech unchanged`);
  }
  for (const diagram of [null, "", "  \n "]) check({ question, turnPlan: plan }, diagram);
  const conceptual = "Explain what the axes and a curve mean in a mathematical relation.";
  check({ question: conceptual, turnPlan: { ...plan, question: conceptual, visualRequirement: "optional" } });
  const visible = "A complete metric diagram has already been compiled.\nParts the student can read, written as the drawn label then its tag: \"P\" = [FOCUS:p].\nVerified meaning of each focus target: p is the source point.";
  for (const output of built({ question, turnPlan: plan }, visible)) {
    assert(!output.runtimeAddon.includes(absence), "a real figure must keep its own prompt authority");
    assert(output.runtimeAddon.includes('"P" = [FOCUS:p]'));
  }
  const code = getMockCodeLessonPlan("Implement a small algorithm in Python.");
  const withoutFigure = buildTurnTeachingPrompt({ question: code.question, turnPlan: null, solverProjection: null,
    diagramPromptAddon: null, familiarity: "normal", fastMode: true, isDsa: true, codeLesson: code, codeLessonFrames: [] });
  assert(withoutFigure.runtimeAddon.includes(absence), "a code editor is not evidence of a right-hand figure");
  assert(withoutFigure.runtimeAddon.includes("[TYPE:blockId] only"), "absence cannot change code ownership into handwriting");
  assert(!withoutFigure.runtimeAddon.includes("notebook uses the full available board width"), "a code editor keeps its existing width policy");
  const withFrame = buildTurnTeachingPrompt({ question: code.question, turnPlan: null, solverProjection: null,
    diagramPromptAddon: null, familiarity: "normal", fastMode: true, isDsa: true, codeLesson: code,
    codeLessonFrames: [{ id: "verified_input", caption: "The verified input", narrationIntent: "The input before the first move." }] });
  assert(!withFrame.runtimeAddon.includes(absence), "a committed future frame keeps the conductor's reveal policy");
  const codeCommon = { lessonQuestion: code.question, turnPlan: null, solverProjection: null, diagramPromptAddon: null,
    familiarity: "normal" as const, fastMode: true, boardRows: [], rowsLeftOnPage: 0, nextRowY: null,
    codePanelShowing: true, codeLessonBoard: true, codePanelText: "return answer" };
  const codeDoubt = buildDoubtTeachingPrompt(codeCommon);
  assert(codeDoubt.runtimeAddon.includes(absence));
  assert(codeDoubt.runtimeAddon.includes("Never [WRITE], never [TYPE] and never [FOCUS]"));
  assert(!codeDoubt.runtimeAddon.includes("which part of the worked example"), "do not invite a doubt about an absent example");
  // A live DSA doubt deliberately receives no diagram prompt/FOCUS targets.
  // Visibility comes from the current page's actual ink, not those permissions.
  const ink = verifiedDiagramHasDrawableInk({ commands: [{ type: "DRAW_LINE", params: [450, 200, 550, 200] }] });
  assert(ink);
  const visibleCodeDoubt = buildDoubtTeachingPrompt({ ...codeCommon, codeFigureVisible: ink });
  assert(!visibleCodeDoubt.runtimeAddon.includes(absence), "visible DSA ink survives intentionally absent narration targets");
  assert(visibleCodeDoubt.runtimeAddon.includes("right is the worked example"));
  assert(visibleCodeDoubt.runtimeAddon.includes("Never [WRITE], never [TYPE] and never [FOCUS]"), "visibility must not grant drawing/pointing permission");
  const metadataOnly = verifiedDiagramHasDrawableInk({ commands: [] });
  assert(!metadataOnly);
  assert(buildDoubtTeachingPrompt({ ...codeCommon, codeFigureVisible: metadataOnly }).runtimeAddon.includes(absence));
  const handler = readFileSync(new URL("../../features/tutor-session/hooks/turn/useQuestionHandler.ts", import.meta.url), "utf8");
  assert(/const codeFigureVisible = Boolean\(codeLessonBoard && doubtPage\?\.figureOnPage &&\s*activeVerifiedDiagramRef\.current && verifiedDiagramHasDrawableInk\(activeVerifiedDiagramRef\.current\)\);/.test(handler) &&
    /buildDoubtTeachingPrompt\(\{[^}]*\bcodeFigureVisible,/.test(handler),
    "the actual caller must pass current-page drawable ink as visibility, separately from diagram prompt authority");
  for (const includeCode of [true, false]) {
    const resume = buildResumeTeachingPrompt({ ...codeCommon, reason: "stop", codeLesson: code,
      codeLessonIncludeCode: includeCode, codeLessonFrames: [] });
    assert(resume.runtimeAddon.includes(absence));
    assert(!/right is the worked example|Continue the worked example at its next frame/.test(resume.runtimeAddon));
  }

  console.log("verify-text-only-narration: structural absence/visible/code controls pass; no providers or speech rewrite");
} finally { globalThis.fetch = originalFetch; }
