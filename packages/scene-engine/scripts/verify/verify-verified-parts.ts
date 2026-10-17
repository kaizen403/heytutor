import assert from "node:assert/strict";
import { compileSceneDocument } from "../../src/compile/compiler";
import { prepareVerifiedParts } from "../../src/compile/verifiedParts";
import type { SceneDocument } from "../../src/types";
function scene(label: string): SceneDocument {
  return {
    schemaVersion: "scene-document/v2",
    source: {
      question: "A body moves with velocity (3,4) m/s. Show its motion.",
    },
    visualDecision: { mode: "scene", reason: "motion" },
    quantities: [],
    entities: [
      { id: "path", kind: "curve", role: "trajectory", label: "path" },
      { id: "v", kind: "vector", role: "velocity", label },
    ],
    constructions: [
      {
        id: "motion",
        operator: "constant_acceleration_trajectory",
        inputs: {
          initialPosition: [0, 0],
          initialVelocity: [3, 4],
          acceleration: [0, 0],
          tMin: 0,
          tMax: 2,
          samples: 5,
          units: { length: "m", time: "s" },
        },
        outputs: ["path"],
      },
      {
        id: "velocity",
        operator: "trajectory_state",
        inputs: {
          trajectory: "path",
          time: 1,
          kind: "velocity",
          timeScale: 0.3,
        },
        outputs: ["v"],
      },
    ],
    requiredEntityIds: ["path", "v"],
    relations: [],
    assertions: [],
    annotations: [],
    revealGroups: [{ id: "setup", entityIds: ["path", "v"], dependsOn: [] }],
    teachingTimeline: [],
  };
}
const proof = scene("unknown=5 m/s");
assert.equal(compileSceneDocument(proof).ok, false);
assert.equal(prepareVerifiedParts(proof).document, proof, "off is identity");
const recovered = prepareVerifiedParts(proof, { enabled: true });
assert.equal(
  compileSceneDocument(recovered.document).ok,
  true,
  "proof label alone must not kill verified motion",
);
assert.deepEqual(
  recovered.document.constructions,
  proof.constructions,
  "all geometry retained",
);
assert.deepEqual(recovered.document.requiredEntityIds, proof.requiredEntityIds);
assert.equal(recovered.document.entities[1]!.label, undefined);
assert(
  recovered.issues.some(
    (i) =>
      i.code === "yield_label_omitted" &&
      i.expected === "invalid_derived_value_label",
  ),
);
assert.equal(proof.entities[1]!.label, "unknown=5 m/s", "input immutable");
for (const label of ["v=6 m/s", "v=5 m", "vx=4 m/s"]) {
  const bad = scene(label);
  const result = prepareVerifiedParts(bad, { enabled: true });
  assert.equal(
    compileSceneDocument(result.document).ok,
    false,
    `truth still blocks: ${label}`,
  );
  assert.equal(result.document.entities[1]!.label, label);
}
const answer = scene("v=5 m/s");
assert.equal(
  compileSceneDocument(prepareVerifiedParts(answer, { enabled: true }).document)
    .ok,
  true,
  "computed answer value allowed",
);
const wrongGeometry = scene("unknown=5 m/s");
wrongGeometry.assertions = [
  {
    id: "false_length",
    predicate: "distance",
    entities: ["v"],
    expected: 999,
    severity: "fatal",
  },
];
assert.equal(
  compileSceneDocument(
    prepareVerifiedParts(wrongGeometry, { enabled: true }).document,
  ).ok,
  false,
  "label recovery cannot skip geometry proof",
);
console.log(
  "verified-parts: proof recovery, truth/unit/geometry blockers, immutable geometry and default-off passed",
);

// Repair deletion is not a successful repair, even when its remaining ink compiles.
const { validateRepairSurvivorship } =
  await import("../../src/compile/repairSurvivorship");
const replacement = scene("v=5 m/s");
assert.deepEqual(
  validateRepairSurvivorship(
    proof as unknown as Record<string, unknown>,
    replacement as unknown as Record<string, unknown>,
  ),
  [],
);
replacement.entities = replacement.entities.filter((e) => e.id !== "path");
replacement.requiredEntityIds = ["v"];
assert(
  validateRepairSurvivorship(
    proof as unknown as Record<string, unknown>,
    replacement as unknown as Record<string, unknown>,
  ).some((i) => i.code === "repair_required_geometry_lost"),
);
const { deferVerifiedAnswerLabels } =
  await import("../../src/compile/answerLabels");
const { createFallbackTurnPlanV3 } =
  await import("../../../../packages/tutor-core/src/planners/turnPlannerV3");
const plan = createFallbackTurnPlanV3(answer.source.question as string);
plan.unknowns = [{ id: "speed", symbol: "v", unit: "m/s" }];
const staged = deferVerifiedAnswerLabels(answer, plan);
assert.deepEqual(staged.source.answerLabelEntityIds, ["v"]);
assert.equal(compileSceneDocument(staged).ok, true);
console.log(
  "verified-parts: required repair geometry and computed-answer staging passed",
);
const substituted = scene("v=5 m/s");
substituted.entities[0]!.role = "ground";
assert(
  validateRepairSurvivorship(
    proof as unknown as Record<string, unknown>,
    substituted as unknown as Record<string, unknown>,
  ).length > 0,
  "same ID cannot rename a trajectory to ground",
);
substituted.entities[0]!.role = "trajectory";
substituted.constructions[0]!.operator = "polyline";
assert(
  validateRepairSurvivorship(
    proof as unknown as Record<string, unknown>,
    substituted as unknown as Record<string, unknown>,
  ).length > 0,
  "same ID cannot replace analytic trajectory with arbitrary path",
);
const missingUnit = scene("t=1 s");
missingUnit.constructions[0]!.inputs.units = undefined;
assert.equal(compileSceneDocument(missingUnit).ok, false);
const missingUnitRecovered = prepareVerifiedParts(missingUnit, {
  enabled: true,
});
assert.equal(
  compileSceneDocument(missingUnitRecovered.document).ok,
  true,
  "missing unit authority is proof failure, declared incompatible units are truth failures",
);
const namedPoint = scene("H=9 m");
namedPoint.entities[1]!.kind = "point";
namedPoint.entities[1]!.role = "highest point";
namedPoint.constructions[1]!.inputs.kind = "position";
delete namedPoint.constructions[1]!.inputs.timeScale;
assert.equal(
  compileSceneDocument(
    prepareVerifiedParts(namedPoint, { enabled: true }).document,
  ).ok,
  false,
  "unsupported positional meaning is not cured by deleting its label",
);
const crowded = scene("a".repeat(24));
assert(
  compileSceneDocument(crowded).report.issues.some(
    (i) => i.code === "label_too_long",
  ),
);
const simplified = prepareVerifiedParts(crowded, { enabled: true });
assert.equal(
  compileSceneDocument(simplified.document).ok,
  true,
  "unplaceable entity label alone is omitted",
);
assert.deepEqual(simplified.document.constructions, crowded.constructions);
assert(simplified.issues.some((i) => i.expected === "label_too_long"));
const attached = structuredClone(crowded);
attached.assertions = [
  {
    id: "needed_name",
    predicate: "label_attached",
    entities: ["v"],
    expected: true,
    severity: "fatal",
  },
];
assert.equal(
  compileSceneDocument(
    prepareVerifiedParts(attached, { enabled: true }).document,
  ).ok,
  false,
  "an explicit label obligation is never dropped",
);

const tupleAnswer = structuredClone(answer);
tupleAnswer.entities[1]!.label = "(3,4) m/s";
assert.deepEqual(
  deferVerifiedAnswerLabels(tupleAnswer, plan).source.answerLabelEntityIds,
  ["v"],
  "coordinate answers cannot leak through alternate label syntax",
);
const numberedAnswer = structuredClone(answer);
numberedAnswer.entities[1]!.label = "v₀=5 m/s";
const numberedPlan = {
  ...plan,
  unknowns: [{ id: "initialSpeed", symbol: "v0", unit: "m/s" }],
};
assert.deepEqual(
  deferVerifiedAnswerLabels(numberedAnswer, numberedPlan).source
    .answerLabelEntityIds,
  ["v"],
  "subscripted symbols use the same answer identity",
);

const timedPoint = scene("t=1 s");
timedPoint.constructions[0]!.inputs.units = undefined;
timedPoint.entities[1]!.kind = "point";
timedPoint.constructions[1]!.inputs.kind = "position";
delete timedPoint.constructions[1]!.inputs.timeScale;
assert.equal(
  compileSceneDocument(
    prepareVerifiedParts(timedPoint, { enabled: true }).document,
  ).ok,
  true,
  "only the missing-unit text is removed from an independently computed point",
);
const wrongTime = structuredClone(timedPoint);
wrongTime.entities[1]!.label = "t=999 s";
assert.equal(
  compileSceneDocument(
    prepareVerifiedParts(wrongTime, { enabled: true }).document,
  ).ok,
  false,
  "missing units cannot mask a different numeric value",
);

for (const label of ['P=(3,999) m','P=(999,4) m']) {
  const tupleLie=structuredClone(timedPoint);tupleLie.entities[1]!.label=label;
  assert.equal(compileSceneDocument(prepareVerifiedParts(tupleLie,{enabled:true}).document).ok,false,'one matching tuple component cannot hide another false component');
}
const nestedUnits=structuredClone(timedPoint);delete nestedUnits.entities[1]!.label;
nestedUnits.quantities=[{id:'time',symbol:'t',value:{value:1,unit:'kg'},unit:'s'}];
nestedUnits.annotations=[{id:'time_label',kind:'label',targetIds:['v'],quantityId:'time',text:'t=1 s'}];
assert.equal(compileSceneDocument(prepareVerifiedParts(nestedUnits,{enabled:true}).document).ok,false,'missing target units cannot hide conflicting nested source units');

const untypedSource=scene('foo=999 m');untypedSource.quantities=[{id:'foo',symbol:'foo',value:3}];
assert.equal(compileSceneDocument(prepareVerifiedParts(untypedSource,{enabled:true}).document).ok,false,'source-unit proof failure cannot mask a known different scalar');

for (const label of ['5e0 m/s','500 cm/s','√25 m/s','−5 m/s']) {
  const formattedAnswer=structuredClone(answer);formattedAnswer.entities[1]!.label=label;
  assert.deepEqual(deferVerifiedAnswerLabels(formattedAnswer,plan).source.answerLabelEntityIds,['v'],'alternate numeric notation must not reveal an answer early');
}

for (const kind of ["label", "callout", "badge"] as const) {
  const optional = scene("v=5 m/s");
  optional.annotations = [{id: "unproved", kind, targetIds: ["v"], text: "unknown=5 m/s"}];
  optional.teachingTimeline = [{id: "show_unproved", action: "focus", targetId: "unproved", dependsOn: []}];
  const reduced = prepareVerifiedParts(optional, {enabled: true});
  assert.equal(compileSceneDocument(reduced.document).ok, true);
  assert.deepEqual(reduced.document.entities, optional.entities,
    "a failed optional annotation cannot demote a separately proved entity label");
  assert.deepEqual(reduced.document.constructions, optional.constructions);
  assert.deepEqual(reduced.document.requiredEntityIds, optional.requiredEntityIds);
  assert.deepEqual(reduced.document.annotations, []);
  assert.deepEqual(reduced.document.teachingTimeline, []);
  assert.equal(reduced.issues.length, 1, "record only the element actually omitted");
  assert.equal(reduced.issues[0]?.path, "annotations[0].text");
  const falseAnnotation = structuredClone(optional);
  falseAnnotation.annotations[0]!.text = "v=999 m/s";
  assert.equal(compileSceneDocument(prepareVerifiedParts(falseAnnotation, {enabled:true}).document).ok, false,
    "a false optional annotation remains a truth blocker");
}

// A sense mark needs a directed line. A circle is valid geometry, but this
// optional mark has no resolved line to decorate and must not discard it.
const unresolvedSense: SceneDocument = {
  ...scene("v=5 m/s"),
  source: { question: "Show a circle with centre O." },
  entities: [{ id: "o", kind: "point", role: "centre", label: "O" }, { id: "circle", kind: "circle", role: "circle", label: "C" }],
  constructions: [
    { id: "centre", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["o"] },
    { id: "circle_geometry", operator: "circle", inputs: { center: "o", radius: 2 }, outputs: ["circle"] },
  ],
  requiredEntityIds: ["o", "circle"],
  revealGroups: [{ id: "setup", entityIds: ["o", "circle"], dependsOn: [], narrationCue: "Here is the circle." }],
  annotations: [{ id: "optional_sense", kind: "sense", targetIds: ["circle"] }],
  teachingTimeline: [{ id: "show_sense", action: "focus", targetId: "optional_sense", dependsOn: [] }],
};
assert(compileSceneDocument(unresolvedSense).report.issues.some(issue => issue.code === "annotation_geometry_unresolved"));
const withoutSense = prepareVerifiedParts(unresolvedSense, { enabled: true });
assert.equal(compileSceneDocument(withoutSense.document).ok, true, "unresolved optional sense cannot discard the verified circle");
assert.deepEqual(withoutSense.document.entities, unresolvedSense.entities);
assert.deepEqual(withoutSense.document.constructions, unresolvedSense.constructions);
assert.deepEqual(withoutSense.document.requiredEntityIds, unresolvedSense.requiredEntityIds);
assert.deepEqual(withoutSense.document.annotations, []);
assert.deepEqual(withoutSense.document.teachingTimeline, []);
assert.equal(unresolvedSense.annotations.length, 1, "optional sense input remains immutable");
assert.equal(withoutSense.issues.length, 1);
assert.equal(withoutSense.issues[0]?.expected, "annotation_geometry_unresolved");

// Omitting optional annotation ink must not leave action dependencies dangling.
for (const chained of [false, true]) {
  const optional = scene("v=5 m/s");
  optional.annotations = [{ id: "unproved", kind: "label", targetIds: ["v"], text: "unknown=5 m/s" }];
  optional.teachingTimeline = chained ? [
    { id: "prior", action: "focus", targetId: "path", dependsOn: [] },
    { id: "other", action: "focus", targetId: "v", dependsOn: [] },
    { id: "removed_a", action: "focus", targetId: "unproved", dependsOn: ["prior"] },
    { id: "removed_b", action: "focus", targetId: "unproved", dependsOn: ["removed_a", "other"] },
    { id: "survivor", action: "focus", targetId: "v", dependsOn: ["removed_b", "prior"] },
  ] : [
    { id: "removed_a", action: "focus", targetId: "unproved", dependsOn: [] },
    { id: "survivor", action: "focus", targetId: "v", dependsOn: ["removed_a"] },
  ];
  const original = structuredClone(optional);
  const reduced = prepareVerifiedParts(optional, { enabled: true });
  assert.equal(compileSceneDocument(reduced.document).ok, true,
    "removing an optional annotation action must preserve a recoverable required scene");
  assert.deepEqual(reduced.document.teachingTimeline.at(-1)?.dependsOn, chained ? ["prior", "other"] : [],
    "dependencies traverse omitted actions to every surviving predecessor, once each");
  assert.deepEqual(reduced.document.teachingTimeline.map(a => a.id), chained ? ["prior", "other", "survivor"] : ["survivor"]);
  assert.deepEqual(reduced.document.entities, optional.entities);
  assert.deepEqual(reduced.document.constructions, optional.constructions);
  assert.deepEqual(reduced.document.requiredEntityIds, optional.requiredEntityIds);
  assert.deepEqual(optional, original, "timeline rewiring never mutates its input");
}
console.log("verified-parts: omitted annotation actions preserve transitive surviving timeline dependencies");
