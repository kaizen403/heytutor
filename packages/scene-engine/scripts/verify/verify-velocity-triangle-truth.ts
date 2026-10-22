import assert from "node:assert/strict";
import { compileSceneDocument } from "../../src/compile/compiler";
import { prepareVerifiedParts } from "../../src/compile/verifiedParts";
import type { SceneDocument } from "../../src/types";

function triangle(horizontal = 3, scale = 1, offset = 0): SceneDocument {
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "A sum of two named velocities." },
    source: {
      question: "Velocities u and v have magnitudes 10 m/s and 6 m/s.",
      representationTier: "qualitative_verified",
      nonMetric: true,
    },
    quantities: [
      { id: "q_u", symbol: "u", value: 10, unit: "m/s" },
      { id: "q_v", symbol: "v", value: 6, unit: "m/s" },
    ],
    entities: [
      ...["A", "B", "C"].map((id) => ({
        id,
        kind: "point",
        role: "velocity endpoint",
      })),
      ...["u", "v", "sum"].map((id) => ({
        id,
        kind: "vector",
        role: "velocity",
        label: id,
      })),
    ],
    constructions: [
      ...[
        ["A", 0, 0],
        ["B", -horizontal, 4],
        ["C", 0, 4],
      ].map(([id, x, y]) => ({
        id: `point_${id}`,
        operator: "point",
        inputs: {
          x: Number(x) * scale + offset,
          y: Number(y) * scale + offset,
          coordinateSpace: "world",
        },
        outputs: [String(id)],
      })),
      ...[
        ["u", "A", "B"],
        ["v", "B", "C"],
        ["sum", "A", "C"],
      ].map(([id, start, end]) => ({
        id: `vector_${id}`,
        operator: "vector",
        inputs: { start, end },
        outputs: [id!],
      })),
    ],
    relations: [],
    assertions: [],
    annotations: [],
    requiredEntityIds: ["u", "v", "sum"],
    revealGroups: [
      { id: "sum_view", entityIds: ["u", "v", "sum"], dependsOn: [] },
    ],
    teachingTimeline: [],
  };
}
let checks = 0;
function passes(document: SceneDocument) {
  const result = compileSceneDocument(document);
  assert(result.ok, JSON.stringify(result.report.issues));
  checks++;
}
function refuses(
  document: SceneDocument,
  yieldPolicy: "off" | "verified_parts" = "off",
) {
  const result = compileSceneDocument(document, { yieldPolicy });
  assert.equal(result.ok, false);
  assert.equal(result.renderScene, null);
  assert(
    result.report.issues.some(
      (issue) =>
        issue.code === "velocity_triangle_scale_mismatch" &&
        (yieldPolicy === "off" || issue.failureKind === "truth"),
    ),
    JSON.stringify(result.report.issues),
  );
  checks += 3;
}
for (const scale of [0.1, 1, 10])
  for (const offset of [0, 100]) {
    passes(triangle(3, scale, offset));
    refuses(triangle(2.4, scale, offset));
    refuses(triangle(2.4, scale, offset), "verified_parts");
  }
const converted = triangle();
converted.quantities[1]!.value = 21.6;
converted.quantities[1]!.unit = "km/h";
passes(converted);
const namedSum = triangle();
namedSum.quantities.push({ id: "q_sum", symbol: "sum", value: 8, unit: "m/s" });
passes(namedSum);
namedSum.quantities[2]!.value = 7;
refuses(namedSum);
const otherView = triangle(3, 2, 30);
const independent = triangle();
independent.entities.push(
  ...otherView.entities.map((e) => ({ ...e, id: `other_${e.id}` })),
);
independent.constructions.push(
  ...otherView.constructions.map((c) => ({
    ...c,
    id: `other_${c.id}`,
    outputs: c.outputs.map((id) => `other_${id}`),
    inputs:
      c.operator === "vector"
        ? { start: `other_${c.inputs.start}`, end: `other_${c.inputs.end}` }
        : c.inputs,
  })),
);
independent.requiredEntityIds.push("other_u", "other_v", "other_sum");
independent.revealGroups.push({
  id: "other_view",
  entityIds: ["other_u", "other_v", "other_sum"],
  dependsOn: [],
});
passes(independent);
const directed = triangle();
directed.constructions.find((c) => c.outputs.includes("u"))!.inputs = {
  start: "A",
  direction: [-30, 40],
  length: 5,
};
passes(directed);
directed.constructions.find((c) => c.outputs.includes("u"))!.inputs.end = "B";
passes(directed);
directed.constructions.find((c) => c.outputs.includes("u"))!.inputs.length =
  4.5;
refuses(directed);
for (const horizontal of [3, 2.4]) {
  const transformed = triangle(horizontal);
  transformed.quantities.reverse();
  for (const c of transformed.constructions)
    if (c.operator === "point") {
      const x = Number(c.inputs.x),
        y = Number(c.inputs.y);
      c.inputs.x = -y;
      c.inputs.y = x;
    }
  transformed.entities = transformed.entities.map((e) => ({
    ...e,
    id: `renamed_${e.id}`,
  }));
  transformed.constructions = transformed.constructions.map((c) => ({
    ...c,
    outputs: c.outputs.map((id) => `renamed_${id}`),
    inputs:
      c.operator === "vector"
        ? { start: `renamed_${c.inputs.start}`, end: `renamed_${c.inputs.end}` }
        : c.inputs,
  }));
  transformed.requiredEntityIds = transformed.requiredEntityIds.map(
    (id) => `renamed_${id}`,
  );
  transformed.revealGroups[0]!.entityIds = transformed.requiredEntityIds;
  if (horizontal === 3) passes(transformed);
  else refuses(transformed);
}
const prepared = prepareVerifiedParts(triangle(2.4), { enabled: true });
assert.equal(prepared.compiledScene?.ok, false);
assert.deepEqual(prepared.issues, []);
assert.deepEqual(prepared.document.entities, triangle(2.4).entities);
checks += 3;
for (const [first, second] of [
  ["u", "u′"],
  ["u", "U"],
  ["α", "β"],
]) {
  const symbolic = triangle();
  symbolic.quantities.splice(1);
  symbolic.source.question =
    "One velocity has a known magnitude; the second velocity is symbolic.";
  symbolic.quantities[0]!.symbol = first;
  symbolic.entities.find((e) => e.id === "u")!.label = first;
  symbolic.entities.find((e) => e.id === "v")!.label = second;
  passes(symbolic);
}
for (const horizontal of [3, 2.4]) {
  const centimetres = triangle(horizontal);
  centimetres.quantities.forEach((q) => {
    q.value = Number(q.value) * 100;
    q.unit = "cm/s";
  });
  if (horizontal === 3) passes(centimetres);
  else refuses(centimetres);
  const numericLabels = triangle(horizontal);
  numericLabels.entities.find((e) => e.id === "u")!.label = "u = 10 m/s";
  numericLabels.entities.find((e) => e.id === "v")!.label = "v = 6 m/s";
  if (horizontal === 3) passes(numericLabels);
  else refuses(numericLabels);
  const annotated = triangle(horizontal);
  for (const id of ["u", "v"]) {
    delete annotated.entities.find((e) => e.id === id)!.label;
    annotated.annotations.push({
      id: `label_${id}`,
      kind: "label",
      quantityId: `q_${id}`,
      targetIds: [id],
    });
  }
  if (horizontal === 3) passes(annotated);
  else refuses(annotated);
}
const extraResultant = triangle();
extraResultant.entities.push({
  id: "other_sum",
  kind: "vector",
  role: "resultant velocity",
  label: "w",
});
extraResultant.quantities.push({
  id: "q_w",
  symbol: "w",
  value: 7,
  unit: "m/s",
});
extraResultant.constructions.push({
  id: "make_other_sum",
  operator: "vector",
  inputs: { start: "A", end: "C" },
  outputs: ["other_sum"],
});
extraResultant.requiredEntityIds.push("other_sum");
extraResultant.revealGroups[0]!.entityIds.push("other_sum");
refuses(extraResultant);
const conflictingAnnotation = triangle(2.4);
conflictingAnnotation.annotations.push({
  id: "conflicting_speed",
  kind: "label",
  quantityId: "q_v",
  targetIds: ["u"],
});
refuses(conflictingAnnotation);
console.log(`velocity triangle truth: ${checks} checks passed`);
