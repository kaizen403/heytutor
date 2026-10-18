import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileSceneDocument, type SceneDocument } from "@heytutor/scene-engine";
import { getSegmentCommands, type VerifiedDiagramCommand } from "@heytutor/drawing";
import { findSpokenToken, mathToSpeech, type NarrationLanguage } from "@heytutor/tutor-core";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";

const fixture: { sceneDocument: SceneDocument; expectedDiagramCommands: VerifiedDiagramCommand[] } =
  JSON.parse(readFileSync(resolve(process.cwd(), "scripts/verify/fixtures/launch-l02-primitive-tour.json"), "utf8"));
const failures: string[] = [];
let checks = 0;
function check(condition: unknown, message: string): void {
  checks += 1;
  if (!condition) failures.push(message);
}
function present(document: SceneDocument, language: NarrationLanguage) {
  const compiled = compileSceneDocument(document);
  assert(compiled.ok && compiled.renderScene, `whole fixture must compile: ${JSON.stringify(compiled.report)}`);
  return buildVerifiedDiagramPresentation(document, compiled.renderScene, { narrationLanguage: language });
}
function checkCues(presentation: ReturnType<typeof present>, name: string): void {
  for (const segment of presentation.introSegments) {
    check(Boolean(segment.narration.trim()), `${name}: every intro beat is narrated`);
    for (const command of getSegmentCommands(segment)) {
      const cue = command.spokenCue;
      check(Boolean(cue?.entityId && cue.token), `${name}: every mark keeps its owned cue`);
      check(Boolean(cue && findSpokenToken(mathToSpeech(segment.narration), mathToSpeech(cue.token)) >= 0), `${name}: every cue occurs in actual speech`);
    }
  }
}

for (const language of ["english", "hinglish"] as const) {
  const p = present(fixture.sceneDocument, language);
  const narration = p.introSegments.map(segment => segment.narration).join(" ");
  assert.equal(JSON.stringify(p.diagram.commands), JSON.stringify(fixture.expectedDiagramCommands), `${language}: preserve every captured verified mark in the actual JSON transport`);
  check(!/\b(?:polyline|helper point)\b/i.test(narration), `${language}: captured L02 must identify labelled parts without implementation roles: ${narration}`);
  for (const label of ["k", "eq"]) {
    check(narration.includes(language === "english" ? `part marked ${label}` : `${label} वाला part`), `${language}: identify the actual source label ${label}`);
  }
  check(/\brectangle\b/.test(narration), `${language}: the unlabelled rectangle keeps its honest geometric name`);
  check(!/\b(?:mass|spring|wall)\b/i.test(narration), `${language}: fallback must not infer physical names from question or IDs`);
  const ids = new Set(p.introSegments.flatMap(segment => getSegmentCommands(segment)).map(command => command.spokenCue?.entityId));
  for (const id of ["wall", "spring", "mass", "equilibrium"]) check(ids.has(id), `${language}: keep the ${id} part in the tour`);
  checkCues(p, language);
}

// Real geometric roles must remain useful, including a one-letter rectangle.
for (const rectangleLabel of ["R", "ABCD"]) {
  const ids = ["rectangle", "circle", "o", "a", "b", "radius", "secondRadius", "angle"];
  const geometry: SceneDocument = {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "geometry control" },
    source: { question: `Sketch rectangle ${rectangleLabel}, circle C with centre O, radii OA and OB, and angle AOB.`, nonMetric: true, representationTier: "qualitative_verified" },
    quantities: [], relations: [], assertions: [], annotations: [], teachingTimeline: [],
    entities: [
      { id: "rectangleCentre", kind: "point", role: "construction helper" },
      { id: "rectangle", kind: "rectangle", role: rectangleLabel === "ABCD" ? "rectangle ABCD" : "rectangle", label: rectangleLabel },
      { id: "circle", kind: "circle", role: "circle", label: "C" },
      { id: "o", kind: "point", role: "centre", label: "O" },
      { id: "a", kind: "point", role: "point", label: "A" },
      { id: "b", kind: "point", role: "point", label: "B" },
      { id: "radius", kind: "segment", role: "radius", label: "r" },
      { id: "secondRadius", kind: "segment", role: "second radius" },
      { id: "angle", kind: "angle_mark", role: "angle", label: "θ" },
    ],
    constructions: [
      { id: "rectO", operator: "point", inputs: { x: -5, y: 0, coordinateSpace: "world" }, outputs: ["rectangleCentre"] },
      { id: "rect", operator: "rectangle", inputs: { center: "rectangleCentre", width: 4, height: 2 }, outputs: ["rectangle"] },
      { id: "makeO", operator: "point", inputs: { x: 4, y: 0, coordinateSpace: "world" }, outputs: ["o"] },
      { id: "makeA", operator: "point", inputs: { x: 6, y: 0, coordinateSpace: "world" }, outputs: ["a"] },
      { id: "makeB", operator: "point", inputs: { x: 4, y: 2, coordinateSpace: "world" }, outputs: ["b"] },
      { id: "makeCircle", operator: "circle", inputs: { center: "o", radius: 2 }, outputs: ["circle"] },
      { id: "makeRadius", operator: "segment", inputs: { start: "o", end: "a" }, outputs: ["radius"] },
      { id: "makeSecondRadius", operator: "segment", inputs: { start: "o", end: "b" }, outputs: ["secondRadius"] },
      { id: "makeAngle", operator: "angle_mark", inputs: { vertex: "o", a: "a", b: "b", radius: 0.4 }, outputs: ["angle"] },
    ],
    requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "show scene" }],
  };
  for (const language of ["english", "hinglish"] as const) {
    const p = present(geometry, language), narration = p.introSegments.map(segment => segment.narration).join(" ");
    for (const role of ["rectangle", "radius", "angle"]) check(new RegExp(`\\b${role}\\b`).test(narration), `${language}: preserve actual ${role} role for rectangle ${rectangleLabel}`);
    check(narration.includes(rectangleLabel), `${language}: preserve rectangle ${rectangleLabel}'s source label`);
    checkCues(p, `geometry ${rectangleLabel} ${language}`);
  }
}

// Missing labels must never be filled using useful-looking entity IDs.
const unlabelled = structuredClone(fixture.sceneDocument);
delete unlabelled.entities.find(entity => entity.id === "spring")!.label;
for (const language of ["english", "hinglish"] as const) {
  const p = present(unlabelled, language), narration = p.introSegments.map(segment => segment.narration).join(" ");
  check(!/\b(?:part marked k|mass|spring|wall)\b/i.test(narration) && !narration.includes("k वाला part"), `${language}: no spring label means no invented label or physical name`);
  checkCues(p, `unlabelled ${language}`);
}
if (failures.length) throw new Error(`${failures.length}/${checks} primitive-tour checks failed:\n${failures.join("\n")}`);
console.log(`verify-primitive-tour: ${checks} checks passed; whole captured L02, unchanged verified marks, source labels, geometric roles and real spoken cues`);
