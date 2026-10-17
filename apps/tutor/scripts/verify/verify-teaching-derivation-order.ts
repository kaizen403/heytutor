/** Offline ordering gate: actual compile/presentation and live/lab prompt builder. */
import assert from "node:assert/strict";
import { compileSceneDocument, type RenderScene, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { getSegmentCommands } from "@heytutor/drawing";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { buildResumeTeachingPrompt, buildTurnTeachingPrompt, figureAddonForDoubt } from "../../features/tutor-session/lib/turn/turnTeachingPrompt";
import { buildEarlyLessonOpeningSegment } from "../../features/tutor-session/lib/turn/earlyLessonOpening";

const failures: string[] = [];
let checks = 0;
function check(condition: unknown, message: string): void {
  checks++;
  if (!condition) failures.push(message);
}
const scene: SceneDocument = {
  schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "authored ordering control" },
  source: { question: "Show point A." }, quantities: [],
  entities: [{ id: "a", kind: "point", role: "point", label: "A" }],
  constructions: [{ id: "make_a", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["a"] }],
  relations: [], assertions: [{ id: "exists", predicate: "exists", entities: ["a"], expected: true, severity: "fatal" }],
  annotations: [], requiredEntityIds: ["a"],
  revealGroups: [{ id: "setup", entityIds: ["a"], dependsOn: [], narrationCue: "show point A" }],
  teachingTimeline: [{ id: "reveal", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "show point A" }],
};
const cues = [
  "The solved length is 5 metres, so the answer is already known.",
  "The solved length is five metres, so we have finished the calculation.",
  "The launch angle is forty-five degrees and the speed is thirty-seven metres per second.",
  "The minimum occurs when both directions are perpendicular.",
];
let canonicalCommands: string | undefined;
for (const surface of ["group", "timeline", "member"] as const) {
  for (const cue of cues) {
    const document = structuredClone(scene);
    if (surface === "group") document.revealGroups[0]!.narrationCue = cue;
    else {
      document.teachingTimeline[0]!.narrationIntent = cue;
      if (surface === "member") document.teachingTimeline[0]!.targetId = "a";
    }
    const compiled = compileSceneDocument(document);
    assert.ok(compiled.ok && compiled.renderScene, "authored setup must compile before presentation");
    const frozen = JSON.stringify({ document, render: compiled.renderScene });
    const presentation = buildVerifiedDiagramPresentation(document, compiled.renderScene);
    const narration = presentation.introSegments.map((segment) => segment.narration).join(" ");
    check(!narration.includes(cue.replace(/[.!?]$/, "")), `${surface}: result prose must wait for derivation`);
    check(!/\b(?:5|five|forty-five|thirty-seven|perpendicular|solved|answer)\b/i.test(narration), `${surface}: no numeric or qualitative answer in runtime tour`);
    check(JSON.stringify({ document, render: compiled.renderScene }) === frozen, `${surface}: presentation preserves verified input`);
    const ink = JSON.stringify(presentation.diagram.commands);
    canonicalCommands ??= ink;
    check(ink === canonicalCommands, `${surface}: cue changes cannot remove or invent verified ink`);
    for (const segment of presentation.introSegments) {
      check(getSegmentCommands(segment).length > 0, `${surface}: introduction stays paired with verified ink`);
      for (const command of getSegmentCommands(segment)) {
        check(Boolean(command.spokenCue?.token && segment.narration.includes(command.spokenCue.token)), `${surface}: every ink cue remains in its spoken sentence`);
      }
    }
    check(presentation.diagram.promptAddon?.includes("derived labels wait until the corresponding result has been derived"), `${surface}: figure addon must not demand an answer-label tour before calculation`);
  }
}

// Role text is model metadata too; a tour must not move result prose there.
for (const role of ["speed 37 metres per second", "speed thirty-seven metres per second",
  "solved length is five metres", "minimum occurs when directions are perpendicular"]) {
  const document = structuredClone(scene);
  document.entities[0]!.role = role;
  const compiled = compileSceneDocument(document);
  assert.ok(compiled.ok && compiled.renderScene, "authored role control must compile");
  const presentation = buildVerifiedDiagramPresentation(document, compiled.renderScene);
  check(!/37|thirty|seven|five|perpendicular|solved/.test(presentation.introSegments.map((entry) => entry.narration).join(" ")),
    "role-only result prose must not become introductory speech");
  check(presentation.diagram.commands.some((entry) => entry.type === "DRAW_POINT"), "unsafe role must not remove verified geometry");
}

// Transport seam: compiled point geometry plus authored verified value labels,
// like the dimension/reveal gate. This does not test numeric label admission.
const stagedDocument = structuredClone(scene);
stagedDocument.entities.push({ id: "v", kind: "point", role: "launch velocity", label: "v" });
stagedDocument.constructions.push({ id: "make_v", operator: "point", inputs: { x: 3, y: 4, coordinateSpace: "world" }, outputs: ["v"] });
stagedDocument.revealGroups[0]!.entityIds.push("v");
stagedDocument.requiredEntityIds.push("v");
stagedDocument.assertions.push({ id: "v_exists", predicate: "exists", entities: ["v"], expected: true, severity: "fatal" });
const stagedCompile = compileSceneDocument(stagedDocument);
assert.ok(stagedCompile.ok && stagedCompile.renderScene, "mixed setup geometry must compile");
const stagedRender: RenderScene = { ...stagedCompile.renderScene, primitives: [...stagedCompile.renderScene.primitives,
  { id: "given_value", entityId: "a", groupId: "setup", kind: "label", points: [{ x: 500, y: 230 }], text: "x = 5 m", labelPlacement: "absolute" },
  { id: "answer_value", entityId: "v", groupId: "setup", kind: "label", points: [{ x: 700, y: 330 }], text: "v = 5 m/s", labelPlacement: "absolute" },
] };
for (const unit of ["m", "m/s"]) for (const marked of [false, true]) {
  const document = structuredClone(stagedDocument);
  const render = structuredClone(stagedRender);
  render.primitives.find((entry) => entry.id === "answer_value")!.text = `v = 5 ${unit}`;
  if (marked) document.source = { ...document.source, answerLabelEntityIds: ["v"] };
  const presentation = buildVerifiedDiagramPresentation(document, render);
  const intro = presentation.introSegments.flatMap(getSegmentCommands);
  check(!intro.some((command) => /(?:x|v) = 5/.test(command.text ?? "")), "names-only tour cannot pull measured values into the intro");
  check(presentation.diagram.commands.some((command) => command.text === "x = 5 m") &&
    presentation.diagram.commands.some((command) => command.text === `v = 5 ${unit}`), "same-valued given and answer both survive as verified annotations");
  check(presentation.diagram.deferredAnnotations?.flatMap((entry) => entry.commands).some((command) => command.text === `v = 5 ${unit}`), "answer stays available for the teaching-stage reveal");
}
// Later groups keep their verified ink and draw order, without result prose.
const groupedDocument = structuredClone(stagedDocument);
groupedDocument.revealGroups = [
  { id: "setup", entityIds: ["a"], dependsOn: [], narrationCue: "Show point A." },
  { id: "later", entityIds: ["v"], dependsOn: ["setup"], narrationCue: cues[1]! },
];
groupedDocument.teachingTimeline = [];
const groupedRender = structuredClone(stagedRender);
groupedRender.revealGroups = groupedDocument.revealGroups;
groupedRender.timeline = [];
for (const primitive of groupedRender.primitives) primitive.groupId = primitive.entityId === "v" ? "later" : "setup";
const grouped = buildVerifiedDiagramPresentation(groupedDocument, groupedRender);
check(grouped.introSegments.length === 2 && grouped.diagram.reveals.map((entry) => entry.targetId).join(",") === "setup,later", `mixed groups retain verified reveal order (${grouped.introSegments.length}; ${grouped.diagram.reveals.map((entry) => entry.targetId).join(",")})`);
check(!grouped.introSegments.some((entry) => /five|solved|answer/.test(entry.narration)), "later group cannot announce a result either");
check(!grouped.introSegments.flatMap(getSegmentCommands).some((entry) => /= 5/.test(entry.text ?? "")), "value labels stay deferred across groups");
check(grouped.diagram.commands.length === buildVerifiedDiagramPresentation(stagedDocument, stagedRender).diagram.commands.length, "group changes cannot lose verified marks");

// Code lessons are worked-example frames: their values remain on the boxes.
const code = buildVerifiedDiagramPresentation(stagedDocument, stagedRender, { layout: "code_lesson" });
check(code.introSegments.length === 1 && /example we will work through/.test(code.introSegments[0]!.narration), "DSA keeps its single worked-example opening");
check(code.introSegments.flatMap(getSegmentCommands).some((entry) => entry.text === "v = 5 m/s"), "DSA value/indices are not withheld by the noncode tour policy");
const addon = buildVerifiedDiagramPresentation(stagedDocument, stagedRender).diagram.promptAddon;
check(!figureAddonForDoubt(addon).includes("Read the figure's setup before using it:"), "doubt must not restart the setup tour");
check(figureAddonForDoubt(addon).includes("FOCUS:"), "doubt retains actual verified focus references");

const question = "A right triangle has legs 3 m and 4 m. Find its hypotenuse.";
const plan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3", question,
  givens: [
    { id: "a", symbol: "a", value: 3, unit: "m", provenance: "given", sourceText: "3 m" },
    { id: "b", symbol: "b", value: 4, unit: "m", provenance: "given", sourceText: "4 m" },
  ],
  unknowns: [{ id: "c", symbol: "c", unit: "m" }],
  derived: [{ id: "c", symbol: "c", value: 5, unit: "m", provenance: "derived", sourceText: "c = sqrt(3^2 + 4^2) = 5 m", dependsOn: ["a", "b"] }],
  qualitativeClaims: [], lawIds: ["pythagoras"], assumptions: ["The triangle is a plane figure."], visualRequirement: "optional",
};
for (const solver of [false, true]) for (const early of [false, true]) {
  for (const language of ["english", "hinglish"] as const) for (const familiarity of ["revision", "normal", "new"] as const) {
    const prompt = buildTurnTeachingPrompt({ question, turnPlan: plan, solverProjection: solver ? { c: 5 } : null,
      diagramPromptAddon: null, codeLesson: null, isDsa: false, familiarity, fastMode: true,
      narrationLanguage: language, earlyOpeningAcknowledgement: early });
    for (const text of [prompt.systemPrompt, prompt.continuationPrompt]) {
      check(text.includes("derive each requested result before announcing its value"), "initial/continuation: derived values are destinations, not opening facts");
      check(text.includes("state each unstated modelling condition once"), "initial/continuation: one explicit condition scopes dependent work");
      check(!/same sentence as its value|under that assumption.*SAME STEP/.test(text), "initial/continuation: no forced hedge on every result");
      check(text.includes("saved notes"), "conditional scope must remain explicit in saved notes");
    }
    check(!/\b5\s*(?:m|met)/.test(prompt.openingSegment?.narration ?? ""), "deterministic opening has no derived answer");
    check(!prompt.givenSegments.some((segment) => /\bc\s*=\s*5\b/.test(segment.command?.text ?? "")), "derived answer never becomes a given");
    check(!/\b5\s*(?:m|met)/.test(buildEarlyLessonOpeningSegment(language).narration), "early acknowledgement remains answer-free");
  }
}
for (const reason of ["stop", "doubt"] as const) {
  const resume = buildResumeTeachingPrompt({ lessonQuestion: question, reason, boardRows: [{ workId: "w1", text: "c^2 = a^2 + b^2" }],
    rowsLeftOnPage: 5, nextRowY: 200, diagramPromptAddon: addon, codePanelShowing: false,
    turnPlan: plan, solverProjection: { c: 5 }, familiarity: "normal", fastMode: false });
  for (const text of [resume.systemPrompt, resume.continuationPrompt]) {
    check(text.includes("derive each requested result before announcing its value"), "resume and its continuation retain result order");
    check(text.includes("state each unstated modelling condition once"), "resume retains the existing condition scope");
  }
  check(resume.openingSegment === null && resume.givenSegments.length === 0, "resume cannot reopen or restate the givens");
}
const equalQuestion = "One length x is 5 m. Find the equal length c.";
const equalPlan: TurnPlanV3 = { ...plan, question: equalQuestion,
  givens: [{ id: "x", symbol: "x", value: 5, unit: "m", provenance: "given", sourceText: "x is 5 m" }],
  derived: [{ ...plan.derived[0]!, sourceText: "c = x = 5 m", dependsOn: ["x"] }],
  assumptions: [], lawIds: [],
};
const equal = buildTurnTeachingPrompt({ question: equalQuestion, turnPlan: equalPlan, solverProjection: { c: 5 },
  diagramPromptAddon: null, codeLesson: null, isDsa: false, familiarity: "normal", fastMode: false });
check(equal.givenSegments.some((entry) => /x = 5/.test(entry.command?.text ?? "")), "a given sharing the answer's value and unit remains a given");
check(!equal.givenSegments.some((entry) => /c = 5/.test(entry.command?.text ?? "")), "shared numeric value cannot promote the derived answer into givens");
if (failures.length) {
  console.error(`teaching derivation order RED: ${failures.length}/${checks} failed`);
  for (const failure of [...new Set(failures)]) console.error(failure);
  process.exitCode = 1;
} else console.log(`teaching derivation order GREEN: ${checks} checks; compiled tours, role/value/group/DSA controls and initial/continued/resumed prompts, no model or audio calls`);
