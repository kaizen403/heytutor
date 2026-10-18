/** Offline ordering gate: actual compile/presentation and live/lab prompt builder. */
import assert from "node:assert/strict";
import { compileSceneDocument, type RenderScene, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { getSegmentCommands } from "@heytutor/drawing";
import { findSpokenToken, mathToSpeech } from "@heytutor/tutor-core";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { buildDoubtTeachingPrompt, buildResumeTeachingPrompt, buildTurnTeachingPrompt, figureAddonForDoubt } from "../../features/tutor-session/lib/turn/turnTeachingPrompt";
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
  "The ball strikes after 3 s, 75 m down the slope from O.",
];
let canonicalCommands: string | undefined;
for (const language of ["english", "hinglish"] as const) for (const surface of ["group", "timeline", "member"] as const) {
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
    const presentation = buildVerifiedDiagramPresentation(document, compiled.renderScene, { narrationLanguage: language });
    const narration = presentation.introSegments.map((segment) => segment.narration).join(" ");
    check(!narration.includes(cue.replace(/[.!?]$/, "")), `${surface}: result prose must wait for derivation`);
    check(!/\b(?:3|5|75|five|forty-five|thirty-seven|perpendicular|solved|answer)\b/i.test(narration), `${language}/${surface}: no numeric or qualitative answer in runtime tour`);
    if (language === "hinglish") check(/\p{Script=Devanagari}/u.test(narration), `${surface}: Hinglish tour retains Hindi narration`);
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

// A bare mathematical symbol names a part even when it has a Greek letter or
// subscript. Only its computed value waits for the corresponding work step.
for (const language of ["english", "hinglish"] as const) for (const symbol of ["u", "v_i", "v_f", "θ", "α", "R1", "v₀"]) {
  const document = structuredClone(scene);
  document.source.question = `Show the part marked ${symbol}.`;
  document.entities[0]!.label = symbol;
  document.revealGroups[0]!.narrationCue = `Show point ${symbol}.`;
  document.teachingTimeline[0]!.narrationIntent = `Show point ${symbol}.`;
  const compiled = compileSceneDocument(document);
  assert.ok(compiled.ok && compiled.renderScene, "authored standard-symbol setup must compile");
  const resultText = `${symbol} = 5${symbol === "v_f" ? " m/s" : ""}`;
  const render: RenderScene = { ...compiled.renderScene, primitives: [...compiled.renderScene.primitives,
    { id: "computed_value", entityId: "a", groupId: "setup", kind: "label", points: [{ x: 600, y: 300 }], text: resultText, labelPlacement: "absolute" },
  ] };
  const presentation = buildVerifiedDiagramPresentation(document, render, { narrationLanguage: language });
  const intro = presentation.introSegments.flatMap(getSegmentCommands);
  check(intro.some((command) => command.type === "LABEL" && command.text === symbol), `${language}/${symbol}: a named standard symbol is visible in the intro`);
  check(!intro.some((command) => command.text === resultText), `${language}/${symbol}: computed value stays out of the symbol introduction`);
  check(presentation.diagram.deferredAnnotations?.flatMap((entry) => entry.commands).some((command) => command.text === resultText), `${language}/${symbol}: computed value remains available after derivation`);
  check(presentation.diagram.commands.some((command) => command.text === symbol) && presentation.diagram.commands.some((command) => command.text === resultText), `${language}/${symbol}: staging preserves both symbol and result ink`);
  const segment = presentation.introSegments[0]!;
  const spoken = mathToSpeech(segment.narration);
  const symbolAt = findSpokenToken(spoken, mathToSpeech(symbol));
  check(symbolAt >= 0, `${language}/${symbol}: the setup sentence actually names its standard symbol`);
  for (const type of ["DRAW_POINT", "LABEL"]) {
    const command = intro.find((entry) => entry.type === type && (type !== "LABEL" || entry.text === symbol));
    const at = command?.spokenCue?.token ? findSpokenToken(spoken, mathToSpeech(command.spokenCue.token)) : -1;
    check(at >= 0 && at === symbolAt, `${language}/${symbol}: the scheduler locates ${type} at that symbol's first spoken token`);
  }
}

// A long draw earns a spoken walkthrough. That second narration path must
// not append the answer-bearing planner cue after its neutral setup sentence.
const denseDocument: SceneDocument = {
  ...scene, source: { question: "A ball leaves O horizontally above a descending slope. Find its impact." },
  entities: [
    { id: "object", kind: "vector", role: "object", label: "O" },
    { id: "image", kind: "vector", role: "image", label: "I" },
    { id: "path", kind: "segment", role: "path" },
  ],
  constructions: [], assertions: [], requiredEntityIds: ["object", "image", "path"],
  revealGroups: [{ id: "setup", entityIds: ["object", "image", "path"], dependsOn: [], narrationCue: cues[4]! }],
  teachingTimeline: [],
};
const denseRender: RenderScene = {
  engineVersion: "scene-engine/2.0.0", revealGroups: denseDocument.revealGroups, timeline: [], entityBounds: {},
  primitives: [
    { id: "object_arrow", entityId: "object", groupId: "setup", kind: "vector", points: [{ x: 500, y: 400 }, { x: 500, y: 250 }] },
    { id: "image_arrow", entityId: "image", groupId: "setup", kind: "vector", points: [{ x: 950, y: 400 }, { x: 950, y: 450 }] },
    ...Array.from({ length: 12 }, (_, index) => ({
      id: `path_${index}`, entityId: "path", groupId: "setup", kind: "line" as const,
      points: [{ x: 500, y: 200 + index * 10 }, { x: 800, y: 200 + index * 10 }, { x: 950, y: 450 - index * 5 }],
    })),
  ],
};
const denseHinglish = buildVerifiedDiagramPresentation(denseDocument, denseRender, { narrationLanguage: "hinglish" });
check(denseHinglish.introSegments.some((segment) => segment.narration.includes("इतना setup तैयार है.")), "dense answer-cue fixture reaches the Hinglish spoken walkthrough");
for (const segment of denseHinglish.introSegments) {
  check(!/\b(?:3|75|impact|strikes)\b|नीचे होता है/.test(segment.narration), "dense Hinglish walkthrough cannot append the solved impact cue");
  for (const command of getSegmentCommands(segment)) {
    check(Boolean(command.spokenCue?.token && findSpokenToken(mathToSpeech(segment.narration), mathToSpeech(command.spokenCue.token)) >= 0), "dense Hinglish walkthrough retains schedulable cue tokens");
  }
}
check(JSON.stringify(denseHinglish.diagram.commands) === JSON.stringify(buildVerifiedDiagramPresentation(denseDocument, denseRender).diagram.commands), "Hinglish answer exclusion preserves all dense verified ink");

// The speech scheduler takes the first occurrence of each cue token. A later
// angle mark must therefore get a token outside the earlier right angle mark.
const marksDocument: SceneDocument = {
  ...scene,
  entities: [
    { id: "right", kind: "segment", role: "right angle mark" },
    { id: "angle", kind: "segment", role: "angle mark" },
  ],
  constructions: [], assertions: [], requiredEntityIds: ["right", "angle"],
  revealGroups: [{ id: "setup", entityIds: ["right", "angle"], dependsOn: [], narrationCue: "Show the right angle mark and the angle mark." }],
  teachingTimeline: [],
};
const marksRender: RenderScene = {
  engineVersion: "scene-engine/2.0.0", revealGroups: marksDocument.revealGroups, timeline: [], entityBounds: {},
  primitives: [
    { id: "right_ink", entityId: "right", groupId: "setup", kind: "line", points: [{ x: 500, y: 310 }, { x: 510, y: 310 }, { x: 510, y: 320 }] },
    { id: "angle_ink", entityId: "angle", groupId: "setup", kind: "line", points: [{ x: 600, y: 310 }, { x: 610, y: 305 }, { x: 615, y: 300 }] },
  ],
};
const marks = buildVerifiedDiagramPresentation(marksDocument, marksRender);
const markSegment = marks.introSegments[0]!;
const markSpeech = mathToSpeech(markSegment.narration);
const rightName = findSpokenToken(markSpeech, "right angle mark");
const angleName = findSpokenToken(markSpeech, "angle mark", rightName + "right angle mark".length);
check(rightName >= 0 && angleName > rightName, "overlapping-name fixture speaks both marks in order");
for (const entityId of ["right", "angle"]) {
  const commands = getSegmentCommands(markSegment).filter((command) => command.spokenCue?.entityId === entityId);
  check(commands.length > 0, `${entityId}: overlapping-name fixture retains its own verified mark`);
  for (const command of commands) {
    const token = mathToSpeech(command.spokenCue!.token);
    const at = findSpokenToken(markSpeech, token);
    const intendedName = entityId === "right" ? rightName : angleName;
    const intendedEnd = intendedName + (entityId === "right" ? "right angle mark" : "angle mark").length;
    check(at >= 0 && at <= intendedName && at + token.length === intendedEnd,
      `${entityId}: scheduler locates cue at that mark's own spoken name (${command.spokenCue!.token})`);
    if (entityId === "angle") check(at >= rightName + "right angle mark".length, "later angle cue must not schedule inside the earlier right angle mark");
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
stagedDocument.source.question = "The starting position is x = 5 m. Find v.";
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
const stagedPlan: Pick<TurnPlanV3, "givens" | "derived"> = {
  givens: [{ id: "x", symbol: "x", value: 5, unit: "m", provenance: "given", sourceText: "x = 5 m" }],
  derived: [{ id: "v", symbol: "v", value: 5, unit: "m/s", provenance: "derived", sourceText: "v = 5 m/s", dependsOn: ["x"] }],
};
for (const unit of ["m", "m/s"]) for (const marked of [false, true]) {
  const document = structuredClone(stagedDocument);
  const render = structuredClone(stagedRender);
  render.primitives.find((entry) => entry.id === "answer_value")!.text = `v = 5 ${unit}`;
  if (marked) document.source = { ...document.source, answerLabelEntityIds: ["v"] };
  const authority = { ...stagedPlan, derived: [{ ...stagedPlan.derived[0]!, unit }] };
  const presentation = buildVerifiedDiagramPresentation(document, render, { turnPlan: authority });
  const intro = presentation.introSegments.flatMap(getSegmentCommands);
  check(intro.some((command) => command.text === "x = 5 m"), "source-stated given value is visible in the introductory setup");
  check(!intro.some((command) => command.text === `v = 5 ${unit}`), "derived value waits for its derivation even when it equals a given");
  check(presentation.diagram.commands.some((command) => command.text === "x = 5 m") &&
    presentation.diagram.commands.some((command) => command.text === `v = 5 ${unit}`), "same-valued given and answer both survive as verified annotations");
  check(presentation.diagram.deferredAnnotations?.flatMap((entry) => entry.commands).some((command) => command.text === `v = 5 ${unit}`), "answer stays available for the teaching-stage reveal");
  check(!presentation.diagram.deferredAnnotations?.flatMap((entry) => entry.commands).some((command) => command.text === "x = 5 m"), "an introductory given cannot remain scheduled as a deferred answer");
}
// A number alone cannot establish which quantity it describes. A verified
// annotation binding can establish that identity, and a derived binding wins
// even when its printed text happens to equal a stated given.
for (const binding of ["unbound", "given", "derived"] as const) {
  const document = structuredClone(stagedDocument);
  const render = structuredClone(stagedRender);
  const primitive = render.primitives.find((entry) => entry.id === "given_value")!;
  primitive.text = "5 m";
  if (binding !== "unbound") {
    document.annotations.push({ id: "source_binding", kind: "label", targetIds: ["a"], text: "5 m", quantityId: binding === "given" ? "x" : "v" });
    primitive.provenance = { annotationId: "source_binding" };
  }
  const presentation = buildVerifiedDiagramPresentation(document, render, { turnPlan: {
    ...stagedPlan, derived: [{ ...stagedPlan.derived[0]!, unit: "m" }],
  } });
  check(presentation.introSegments.flatMap(getSegmentCommands).some((command) => command.text === "5 m") === (binding === "given"),
    `${binding}: only a source-given identity can expose an anonymous same-valued label`);
  check(presentation.diagram.commands.some((command) => command.text === "5 m"), `${binding}: staging retains the verified value mark`);
}
{
  const document = structuredClone(stagedDocument);
  document.annotations.push({ id: "given_value", kind: "label", targetIds: ["a"], text: "x = 5 m", quantityId: "v" });
  const presentation = buildVerifiedDiagramPresentation(document, stagedRender, { turnPlan: {
    ...stagedPlan, derived: [{ ...stagedPlan.derived[0]!, unit: "m" }],
  } });
  check(!presentation.introSegments.flatMap(getSegmentCommands).some((command) => command.text === "x = 5 m"), "explicit derived binding takes precedence over printed text matching a given");
}
{
  const document = structuredClone(stagedDocument);
  document.source.question = "The starting position is x = 103 m. Find v.";
  const authority: Pick<TurnPlanV3, "givens" | "derived"> = {
    ...stagedPlan,
    givens: [{ ...stagedPlan.givens[0]!, value: 103, sourceText: "x = 103 m" }],
  };
  for (const text of ["x = 103 m", "x = 10³ m"]) {
    const render = structuredClone(stagedRender);
    render.primitives.find((entry) => entry.id === "given_value")!.text = text;
    const presentation = buildVerifiedDiagramPresentation(document, render, { turnPlan: authority });
    check(presentation.introSegments.flatMap(getSegmentCommands).some((command) => command.text === text) === (text === "x = 103 m"),
      "given label identity preserves a value exponent instead of flattening 10³ into 103");
    check(presentation.diagram.commands.some((command) => command.text === text), "exponent identity staging preserves the verified label mark");
  }
}
// A measured span is one visible annotation: its label cannot precede its
// bar, witnesses, or callout leader merely because those marks have no text.
const measuredPlan: Pick<TurnPlanV3, "givens" | "derived"> = {
  givens: [{ id: "L", symbol: "L", value: 5, unit: "m", provenance: "given", sourceText: "L = 5 m" }],
  derived: [{ id: "R", symbol: "R", value: 5, unit: "m", provenance: "derived", sourceText: "R = L = 5 m", dependsOn: ["L"] }],
};
for (const identity of ["given", "derived", "derived_binding"] as const) for (const leader of [false, true]) {
  const document: SceneDocument = {
    ...scene, source: { question: "A rod has length L = 5 m. Find the equal length R." },
    entities: [{ id: "rod", kind: "segment", role: "rod" }, { id: "measure", kind: "dimension", role: "length", label: identity === "derived" ? "R" : "L" }],
    constructions: [], assertions: [], requiredEntityIds: ["rod", "measure"],
    annotations: identity === "derived_binding"
      ? [{ id: "result_binding", kind: "label", targetIds: ["measure"], text: "L = 5 m", quantityId: "R" }] : [],
    revealGroups: [{ id: "setup", entityIds: ["rod", "measure"], dependsOn: [], narrationCue: "Here is the rod and its length." }],
    teachingTimeline: [],
  };
  const render: RenderScene = {
    engineVersion: "scene-engine/2.0.0", revealGroups: document.revealGroups, timeline: [], entityBounds: {},
    primitives: [
      { id: "rod_ink", entityId: "rod", groupId: "setup", kind: "line", points: [{ x: 750, y: 180 }, { x: 750, y: 420 }] },
      { id: "measure_bar", entityId: "measure", groupId: "setup", kind: "dimension", points: [{ x: 800, y: 180 }, { x: 800, y: 420 }], provenance: { measurementRole: "bar" } },
      { id: "measure_witness_a", entityId: "measure", groupId: "setup", kind: "line", points: [{ x: 750, y: 180 }, { x: 805, y: 180 }], provenance: { measurementRole: "witness", dashed: true, strokeRole: "construction" } },
      { id: "measure_witness_b", entityId: "measure", groupId: "setup", kind: "line", points: [{ x: 750, y: 420 }, { x: 805, y: 420 }], provenance: { measurementRole: "witness", dashed: true, strokeRole: "construction" } },
      { id: "measure_label", entityId: "measure", groupId: "setup", kind: "label", points: [{ x: 835, y: 300 }],
        text: identity === "derived" ? "R = 5 m" : "L = 5 m", labelPlacement: "absolute",
        ...(identity === "derived_binding" ? { provenance: { annotationId: "result_binding" } } : {}) },
      ...(leader ? [{ id: "measure_leader", entityId: "measure", groupId: "setup", kind: "line" as const,
        points: [{ x: 800, y: 300 }, { x: 830, y: 300 }], provenance: { labelLeader: true, strokeRole: "construction" } }] : []),
    ],
  };
  const presentation = buildVerifiedDiagramPresentation(document, render, { turnPlan: measuredPlan });
  const expectedIds = ["measure_bar", "measure_witness_a", "measure_witness_b", "measure_label", ...(leader ? ["measure_leader"] : [])].sort().join(",");
  const intro = presentation.introSegments.flatMap(getSegmentCommands).filter((command) => command.semanticRef?.entityId === "measure");
  const deferred = presentation.diagram.deferredAnnotations?.flatMap((entry) => entry.commands).filter((command) => command.semanticRef?.entityId === "measure") ?? [];
  check(intro.map((command) => command.semanticRef?.primitiveId).sort().join(",") === (identity === "given" ? expectedIds : ""),
    `${identity}/${leader}: introductory dimension reveals its label, textless bar, witnesses and leader as one atom`);
  check(deferred.map((command) => command.semanticRef?.primitiveId).sort().join(",") === (identity === "given" ? "" : expectedIds),
    `${identity}/${leader}: derived dimension keeps its entire atom deferred, including when its label matches a given`);
  check(presentation.diagram.commands.filter((command) => command.semanticRef?.entityId === "measure").map((command) => command.semanticRef?.primitiveId).sort().join(",") === expectedIds,
    `${identity}/${leader}: staging preserves every verified measurement mark`);
  check(presentation.diagram.commands.find((command) => command.semanticRef?.primitiveId === "measure_witness_a")?.params.join(",") === "750,180,805,180",
    `${identity}/${leader}: presentation preserves the verified witness endpoints`);
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
const grouped = buildVerifiedDiagramPresentation(groupedDocument, groupedRender, { turnPlan: stagedPlan });
check(grouped.introSegments.length === 2 && grouped.diagram.reveals.map((entry) => entry.targetId).join(",") === "setup,later", `mixed groups retain verified reveal order (${grouped.introSegments.length}; ${grouped.diagram.reveals.map((entry) => entry.targetId).join(",")})`);
check(!grouped.introSegments.some((entry) => /five|solved|answer/.test(entry.narration)), "later group cannot announce a result either");
check(grouped.introSegments.flatMap(getSegmentCommands).some((entry) => entry.text === "x = 5 m"), "given value remains visible when the result belongs to a later reveal group");
check(!grouped.introSegments.flatMap(getSegmentCommands).some((entry) => entry.text === "v = 5 m/s"), "derived value stays deferred across groups");
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
for (const solver of [false, true]) for (const language of ["english", "hinglish"] as const) {
  const doubt = buildDoubtTeachingPrompt({ lessonQuestion: question,
    boardRows: [{ workId: "w1", text: "c^2 = a^2 + b^2" }], rowsLeftOnPage: 5, nextRowY: 200,
    diagramPromptAddon: addon, codePanelShowing: false, turnPlan: plan,
    solverProjection: solver ? { c: 5 } : null, familiarity: "normal", fastMode: false,
    narrationLanguage: language });
  for (const text of [doubt.systemPrompt, doubt.continuationPrompt]) {
    check(text.includes("derive each requested result before announcing its value"), "doubt and its continuation contain the actual derivation-order policy");
    check(text.includes("state each unstated modelling condition once"), "doubt and its continuation preserve the existing condition scope");
    check(text.includes("Results already established in the student's work may be referenced"), "doubt can reference completed working without restarting its derivation");
    check(text.includes("saved notes"), "doubt continuation retains conditional scope in the saved notes");
  }
  check(doubt.openingSegment === null && doubt.givenSegments.length === 0, "doubt cannot reopen the lesson or restate its givens");
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
} else console.log(`teaching derivation order GREEN: ${checks} checks; compiled tours, source givens, Hinglish, overlapping cues, role/value/group/DSA controls and initial/continued/doubt/resumed prompts, no model or audio calls`);
