import { strict as assert } from "node:assert";
import { normalizeVerifiedPartsInputs } from "../../src/document/verifiedPartsInputs";
import { validateSceneDocument } from "../../src/document/validation";
import { compileSceneDocument } from "../../src/compile/compiler";

function projectile(inputs: Record<string, unknown> = {}) {
  const constructionInputs: Record<string, unknown> = {
    speed: "u",
    gravity: "g",
    launchAngleDeg: 30,
    displayScale: 1,
    ...inputs,
  };
  return {
    schemaVersion: "scene-document/v2",
    source: {
      question:
        "A projectile is launched at 20 m/s and 30 degrees with gravity 10 m/s².",
    },
    visualDecision: { mode: "scene", reason: "A source-grounded projectile." },
    quantities: [
      { id: "u", value: 20, unit: "m/s" },
      { id: "g", value: 10, unit: "m/s²" },
    ],
    entities: [
      { id: "path", kind: "polyline", label: "trajectory" },
      { id: "launch", kind: "vector", label: "launch" },
    ],
    constructions: [
      {
        id: "flight",
        operator: "projectile_trajectory",
        inputs: constructionInputs,
        outputs: ["path", "launch"],
      },
    ],
    annotations: [],
    relations: [],
    assertions: [],
    requiredEntityIds: ["path", "launch"],
    revealGroups: [
      { id: "setup", entityIds: ["path", "launch"], dependsOn: [] },
    ],
    teachingTimeline: [],
  };
}
function compile(candidate: Record<string, unknown>) {
  const validated = validateSceneDocument(candidate);
  if (!validated.document)
    throw new Error(JSON.stringify(validated.report.issues));
  const compiled = compileSceneDocument(validated.document);
  assert.ok(
    compiled.ok && compiled.renderScene,
    JSON.stringify(compiled.report.issues),
  );
  return compiled.renderScene;
}
const canonical = projectile();
const redundant = projectile({
  units: { speed: "metres/second", gravity: "m/s²", length: "metres" },
});
const snapshot = JSON.stringify(redundant);
assert.equal(
  normalizeVerifiedPartsInputs(redundant).candidate,
  redundant,
  "flag off retains original identity",
);
assert.equal(
  validateSceneDocument(redundant).document,
  null,
  "old validator rejects redundant units field",
);
const normalized = normalizeVerifiedPartsInputs(redundant, true);
assert.equal(
  JSON.stringify(redundant),
  snapshot,
  "normalization must not mutate recorded input",
);
assert.equal(normalized.issues.length, 1);
assert.equal(
  normalized.issues[0]?.code,
  "invalid_projectile_trajectory_fields",
);
assert.equal(normalized.issues[0]?.path, "constructions[0].inputs.units");
assert.deepEqual(
  compile(normalized.candidate),
  compile(canonical),
  "redundant units preserve every rendered primitive",
);
assert.equal(
  normalizeVerifiedPartsInputs(normalized.candidate, true).candidate,
  normalized.candidate,
  "normalization is idempotent",
);

// Mutation controls: no dropping a contradictory, ambiguous or non-SI declaration.
for (const units of [
  { speed: "km/h", gravity: "m/s²", length: "m" },
  { speed: "m/s", gravity: "m/s", length: "m" },
  { speed: "m/s", gravity: "m/s²", length: "cm" },
  { speed: "m/s", gravity: "m/s²", length: "m", time: "s" },
  { speed: "m/s", gravity: "m/s²" },
]) {
  const candidate = projectile({ units });
  assert.equal(
    normalizeVerifiedPartsInputs(candidate, true).candidate,
    candidate,
  );
  assert.equal(validateSceneDocument(candidate).document, null);
}
for (const unit of ["km/h", "m", "m/ms"]) {
  const candidate = projectile({
    units: { speed: "m/s", gravity: "m/s²", length: "m" },
  });
  candidate.quantities[0]!.unit = unit;
  assert.equal(
    normalizeVerifiedPartsInputs(candidate, true).candidate,
    candidate,
    "quantity-unit contradiction must survive",
  );
}
const nestedConflict = projectile({
  speed: { value: "u", unit: "cm/s" },
  units: { speed: "m/s", gravity: "m/s²", length: "m" },
});
assert.equal(
  normalizeVerifiedPartsInputs(nestedConflict, true).candidate,
  nestedConflict,
);
const duplicateQuantity = structuredClone(redundant);
duplicateQuantity.quantities.push({ id: "u", value: 200, unit: "km/h" });
assert.equal(
  normalizeVerifiedPartsInputs(duplicateQuantity, true).candidate,
  duplicateQuantity,
);
const alias = projectile();
const { speed, ...rest } = alias.constructions[0]!.inputs;
alias.constructions[0]!.inputs = { ...rest, initialSpeed: speed };
assert.deepEqual(
  compile(normalizeVerifiedPartsInputs(alias, true).candidate),
  compile(canonical),
);
const conflict = projectile({ initialSpeed: 999 });
assert.equal(
  normalizeVerifiedPartsInputs(conflict, true).candidate,
  conflict,
  "canonical/alias conflict remains fatal",
);
assert.equal(validateSceneDocument(conflict).document, null);
const wrongGravity = projectile({
  gravity: -10,
  units: { speed: "m/s", gravity: "m/s²", length: "m" },
});
assert.equal(
  validateSceneDocument(
    normalizeVerifiedPartsInputs(wrongGravity, true).candidate,
  ).document,
  null,
  "physics constraints still reject normalized input",
);
const normalizedParameter = {
  constructions: [
    {
      operator: "curve_anchor",
      inputs: { curve: "trajectory", at: 0.5, normalizedAt: true },
      outputs: ["p"],
    },
  ],
};
assert.equal(
  normalizeVerifiedPartsInputs(normalizedParameter, true).candidate,
  normalizedParameter,
  "never guess fraction semantics",
);
const parameterConflict = {
  constructions: [
    {
      operator: "curve_anchor",
      inputs: { curve: "trajectory", at: 0.5, parameter: 19.2 },
      outputs: ["p"],
    },
  ],
};
assert.equal(
  normalizeVerifiedPartsInputs(parameterConflict, true).candidate,
  parameterConflict,
);
const missingUnits = {
  constructions: [
    {
      operator: "constant_acceleration_trajectory",
      inputs: {
        initialPosition: [0, 0],
        initialVelocity: [20, 0],
        acceleration: [0, -10],
        tMax: 2,
      },
      outputs: ["path"],
    },
  ],
};
assert.equal(
  normalizeVerifiedPartsInputs(missingUnits, true).candidate,
  missingUnits,
  "literal inputs do not establish units",
);
console.log(
  "verified-parts input normalization gates passed: default off, semantic equality, conflicts, scale, physics and ambiguous curve guards",
);

const evenSamples = {
  constructions: [
    {
      id: "curve",
      operator: "function_curve",
      inputs: { expression: "x^2", xMin: -3, xMax: 3, samples: 80 },
      outputs: ["path"],
    },
  ],
};
assert.equal(normalizeVerifiedPartsInputs(evenSamples).candidate, evenSamples);
const oddSamples = normalizeVerifiedPartsInputs(evenSamples, true);
assert.deepEqual(
  (oddSamples.candidate.constructions as typeof evenSamples.constructions)[0]!
    .inputs,
  { expression: "x^2", xMin: -3, xMax: 3, samples: 81 },
);
assert(
  oddSamples.issues.some((issue) => issue.code === "invalid_function_samples"),
);
for (const samples of [16, 162, 80.5, -2]) {
  const invalid = {
    constructions: [
      {
        ...evenSamples.constructions[0],
        inputs: { ...evenSamples.constructions[0]!.inputs, samples },
      },
    ],
  };
  assert.equal(
    normalizeVerifiedPartsInputs(invalid, true).candidate,
    invalid,
    "ambiguous/out-of-bounds sampling is not guessed",
  );
}
