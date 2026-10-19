import { strict as assert } from "node:assert";
import { compileSceneDocument } from "../../src/compile/compiler";
import { validateSceneDocument } from "../../src/document/validation";
import { pruneDeadSceneEntities } from "../../src/document/validation";
import {
  prepareVerifiedCircularParts,
  provesVerifiedCircularParts,
  VERIFIED_CIRCULAR_PARTS_POLICY,
} from "../../src/physics/verifiedCircularParts";
import { validateUniformCircularSourceInputs } from "../../src/physics/uniformCircularSourceBinding";
import type { SceneDocument } from "../../src/types";

function fixture(radius = 7, speed = 6, clockwise = false): SceneDocument {
  const sense = clockwise ? "clockwise" : "anticlockwise";
  const sign = clockwise ? -1 : 1;
  return {
    schemaVersion: "scene-document/v2",
    source: {
      question: `A particle moves ${sense} around a circle of radius ${radius} m at a constant speed of ${speed} m/s. Find its average velocity over one quarter of the way around the circle.`,
    },
    visualDecision: {
      mode: "scene",
      reason: "The stated circular interval and endpoint velocities.",
    },
    quantities: [
      { id: "r", value: radius, unit: "m" },
      { id: "v", value: speed, unit: "m/s" },
    ],
    entities: [
      { id: "o", kind: "point", role: "point", label: "O" },
      { id: "a", kind: "point", role: "point", label: "A" },
      { id: "b", kind: "point", role: "point", label: "B" },
      { id: "orbit", kind: "circle", role: "circular path" },
      { id: "arc", kind: "arc", role: "travelled arc" },
      { id: "radius", kind: "segment", role: "radius", label: `r=${radius} m` },
      { id: "chord", kind: "segment", role: "displacement" },
      { id: "va", kind: "vector", role: "velocity", label: `v=${speed} m/s` },
      { id: "vb", kind: "vector", role: "velocity" },
    ],
    constructions: [
      {
        id: "o_c",
        operator: "point",
        inputs: { x: 0, y: 0, coordinateSpace: "world" },
        outputs: ["o"],
      },
      {
        id: "a_c",
        operator: "point",
        inputs: { x: radius, y: 0, coordinateSpace: "world" },
        outputs: ["a"],
      },
      {
        id: "b_c",
        operator: "point",
        inputs: { x: 0, y: sign * radius, coordinateSpace: "world" },
        outputs: ["b"],
      },
      {
        id: "orbit_c",
        operator: "circle",
        inputs: { center: "o", radius: "r" },
        outputs: ["orbit"],
      },
      {
        id: "arc_c",
        operator: "arc",
        inputs: {
          center: "o",
          radius: "r",
          startAngle: 0,
          endAngle: sign * 90,
          angleUnit: "degrees",
        },
        outputs: ["arc"],
      },
      {
        id: "radius_c",
        operator: "segment",
        inputs: { start: "o", end: "a" },
        outputs: ["radius"],
      },
      {
        id: "chord_c",
        operator: "segment",
        inputs: { start: "a", end: "b" },
        outputs: ["chord"],
      },
      {
        id: "va_c",
        operator: "vector",
        inputs: { start: "a", direction: [0, sign], length: 2 },
        outputs: ["va"],
      },
      {
        id: "vb_c",
        operator: "vector",
        inputs: { start: "b", direction: [-1, 0], length: 2 },
        outputs: ["vb"],
      },
    ],
    relations: [],
    assertions: [],
    annotations: [
      { id: "displacement", kind: "label", targetIds: ["chord"], text: "Δr" },
    ],
    requiredEntityIds: ["orbit", "arc", "radius", "chord", "va", "vb"],
    revealGroups: [
      {
        id: "setup",
        narrationCue: "",
        entityIds: [
          "o",
          "a",
          "b",
          "orbit",
          "arc",
          "radius",
          "chord",
          "va",
          "vb",
        ],
        dependsOn: [],
      },
    ],
    teachingTimeline: [],
  };
}
function parsed(raw: Record<string, unknown> | SceneDocument): SceneDocument {
  const result = validateSceneDocument(raw);
  if (!result.document) throw new Error(JSON.stringify(result.report.issues));
  return result.document;
}
function prepared(doc: SceneDocument): SceneDocument {
  return parsed(
    prepareVerifiedCircularParts({ ...doc }, String(doc.source.question), true)
      .candidate,
  );
}
for (const [r, v, clockwise] of [
  [7, 6, false],
  [11, 13, false],
  [3, 4, true],
] as const) {
  const raw = fixture(r, v, clockwise);
  const snapshot = JSON.stringify(raw);
  const off = prepareVerifiedCircularParts(
    { ...raw },
    String(raw.source.question),
  );
  assert.equal(off.issues.length, 0);
  assert.equal(
    compileSceneDocument(parsed(raw)).ok,
    false,
    "flag off preserves original source identity gate",
  );
  const result = prepared(raw);
  assert.ok(provesVerifiedCircularParts(result, result.source.question));
  assert.ok(
    compileSceneDocument(result).ok,
    "source-proven original graph compiles",
  );
  assert.ok(
    compileSceneDocument(parsed(pruneDeadSceneEntities({ ...result }))).ok,
    "live pruning preserves certification",
  );
  assert.deepEqual(
    result.requiredEntityIds,
    parsed(raw).requiredEntityIds,
    "arc/chord/vector obligations survive",
  );
  assert.deepEqual(
    result.constructions,
    parsed(raw).constructions,
    "no candidate geometry replaced",
  );
  assert.equal(JSON.stringify(raw), snapshot);
  assert.equal(
    validateUniformCircularSourceInputs(
      result,
      String(result.source.question).replace(`${r} m`, `${r + 1} m`),
    )[0]?.severity,
    "fatal",
    "actual source mismatch cannot reuse marker",
  );
}
const good = prepared(fixture());
const mutations: Array<(doc: SceneDocument) => void> = [
  (d) => {
    d.requiredEntityIds = d.requiredEntityIds.filter((id) => id !== "chord");
  },
  (d) => {
    for (const group of d.revealGroups)
      group.entityIds = group.entityIds.filter((id) => id !== "orbit");
  },
  (d) => {
    d.entities.find((entity) => entity.id === "va")!.role = "net acceleration";
  },
  (d) => {
    d.revealGroups[0]!.narrationCue = "Acceleration is tangent to the circle.";
  },
  (d) => {
    d.teachingTimeline.push({
      id: "claim",
      action: "focus",
      targetId: "va",
      dependsOn: [],
      narrationIntent: "The net acceleration points outwards.",
    });
  },
  (d) => {
    d.constructions[2]!.inputs.y = -7;
  },
  (d) => {
    d.constructions[3]!.inputs.radius = 9;
  },
  (d) => {
    d.constructions[4]!.inputs.endAngle = 180;
  },
  (d) => {
    d.constructions[7]!.inputs.direction = [0, -1];
  },
  (d) => {
    d.constructions[8]!.inputs.length = 3;
  },
  (d) => {
    d.entities.find((e) => e.id === "va")!.label = "v=600 m/s";
  },
  (d) => {
    d.entities.find((e) => e.id === "radius")!.label = "r=7 m and R=999 m";
  },
  (d) => {
    d.quantities.push({ id: "t", value: ((7 * Math.PI) / 12) * 10, unit: "s" });
  },
  (d) => {
    d.source.question += " Its speed is increasing.";
  },
  (d) => {
    d.source.question =
      "A particle starts from rest and moves anticlockwise on a circle of radius 8 m, its speed increasing at a constant rate of 2 m/s². After how much time does its net acceleration make an angle of 45° with its velocity?";
  },
  (d) => {
    d.annotations.push({
      id: "sense",
      kind: "sense",
      targetIds: ["arc"],
      text: "clockwise",
    });
  },
  (d) => {
    d.entities.push({ id: "extra", kind: "point", role: "extra point" });
    d.constructions.push({
      id: "extra_c",
      operator: "point",
      inputs: { x: 100, y: 100, coordinateSpace: "world" },
      outputs: ["extra"],
    });
  },
  (d) => {
    d.constructions = d.constructions.filter((c) => c.outputs[0] !== "chord");
    d.entities = d.entities.filter((e) => e.id !== "chord");
  },
];
for (const mutate of mutations) {
  const bad = structuredClone(good);
  mutate(bad);
  bad.source.verifiedPartsPolicy = VERIFIED_CIRCULAR_PARTS_POLICY;
  assert.equal(
    provesVerifiedCircularParts(bad, bad.source.question),
    false,
    "forged marker never substitutes for proof",
  );
  assert.equal(
    validateUniformCircularSourceInputs(bad, bad.source.question)[0]?.severity,
    "fatal",
  );
  assert.equal(compileSceneDocument(bad).ok, false);
}
console.log(
  "verified circular parts gates passed: original graph retained; default off; varied radius/speed/sense; forged marker, wrong geometry, values, time, nonuniform source and missing chord rejected",
);

// A source proof must describe the exact arc the generic compiler draws. Its
// legacy angle reader recognizes only "degrees" and otherwise uses a magnitude
// heuristic; aliases at small angles and radians beyond 2π are ambiguous.
function rotatedFixture(start: number, angleUnit: string): SceneDocument {
  const d = fixture();
  const c = Math.cos(start), s = Math.sin(start);
  for (const construction of d.constructions) {
    if (construction.operator === "point") {
      const x = Number(construction.inputs.x), y = Number(construction.inputs.y);
      construction.inputs.x = x * c - y * s;
      construction.inputs.y = x * s + y * c;
    } else if (construction.operator === "vector") {
      const [x, y] = construction.inputs.direction as number[];
      construction.inputs.direction = [x! * c - y! * s, x! * s + y! * c];
    }
  }
  const arc = d.constructions.find((item) => item.operator === "arc")!;
  const scale = angleUnit.startsWith("deg") ? 180 / Math.PI : 1;
  arc.inputs.startAngle = start * scale;
  arc.inputs.endAngle = (start + Math.PI / 2) * scale;
  arc.inputs.angleUnit = angleUnit;
  return d;
}
for (const [start, unit] of [[Math.PI / 180, "deg"], [Math.PI / 180, "degree"], [2 * Math.PI + 0.1, "rad"]] as const) {
  const ambiguous = rotatedFixture(start, unit);
  assert.equal(provesVerifiedCircularParts(ambiguous, ambiguous.source.question), false,
    "proof cannot accept a different angle interpretation from the renderer");
  assert.equal(compileSceneDocument(prepared(ambiguous)).ok, false);
}
const explicitDegrees = prepared(rotatedFixture(Math.PI / 180, "degrees"));
assert.equal(compileSceneDocument(explicitDegrees).ok, true,
  "an explicitly interpreted rotated graph remains admissible");
for (const unit of ["kg", "cm", "m/s"]) {
  const contradictory = prepared(fixture());
  contradictory.quantities[0]!.value = {value: 7, unit};
  assert.equal(provesVerifiedCircularParts(contradictory, contradictory.source.question), false,
    "a nested unit contradiction cannot be erased by scalar extraction");
  assert.equal(compileSceneDocument(contradictory).ok, false);
}
const nestedSameUnit = fixture();
nestedSameUnit.quantities[0]!.value = {value: 7, unit: "m"};
assert.equal(compileSceneDocument(prepared(nestedSameUnit)).ok, true);
