import assert from "node:assert/strict";
import { attemptArchetypeScene } from "../../src/archetypes";
import { applySourceQuantityAuthority } from "../../src/ir/sourceQuantityAuthority";
import {
  projectileLaunchHeight,
  projectileSourceIssues,
} from "../../src/physics/projectileLaunchSource";
import {
  applyCoupledInclineAuthority,
  readCoupledInclineSource,
  groundCoupledInclineProblem,
  coupledInclineSourceIssues,
} from "../../src/physics/coupledInclineSource";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { LocalDeterministicSolverProvider } from "../../src/ir/solver";
import {
  verifyTurnPlanAgainstSolver,
  reconcileTurnPlanWithSolver,
} from "../../src/ir/solverAuthority";
import { validateProblemIR, type ProblemIR } from "../../src/ir/problemIR";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";

const failures: string[] = [];
function test(name: string, run: () => void) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error}`);
  }
}
const projectile =
  "A projectile is launched from a 45 m high cliff at 20 m/s, at 30 degrees above horizontal. Ignore air resistance and use g = 10 m/s². Draw the trajectory and find the time to hit the ground, horizontal distance from the cliff foot, and horizontal and vertical impact velocity components.";
const incline =
  "A 2 kg block on a rough 30 degree incline is connected by a taut massless rope parallel to the incline, over a frictionless pulley, to a hanging 3 kg mass. The incline block is currently sliding downslope. Its kinetic friction coefficient is 0.20; use g = 10 m/s². Draw the free-body diagrams and calculate the acceleration direction and magnitude and the tension while it is still sliding downslope. Explain the direction of friction.";
const plan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3",
  question: incline,
  givens: [],
  unknowns: [
    { id: "a", symbol: "a", unit: "m/s^2" },
    { id: "T", symbol: "T", unit: "N" },
  ],
  derived: [
    { id: "a", symbol: "a", unit: "m/s^2", value: 3.31, provenance: "derived" },
    { id: "T", symbol: "T", unit: "N", value: 20.08, provenance: "derived" },
  ],
  qualitativeClaims: [],
  assumptions: [],
  lawIds: [],
  visualRequirement: "required",
};
test("source cliff height survives full archetype compilation", () => {
  const result = attemptArchetypeScene({ question: projectile });
  assert.ok(result.scene, JSON.stringify(result));
  assert.equal(
    result.scene.document.quantities.find((q) => q.id === "h0")?.value,
    45,
  );
  const landing = result.scene.document.constructions.find(
    (c) => c.id === "make_landing",
  );
  assert.ok(Math.abs(Number(landing?.inputs.x) - 72.09276383) < 0.001);
});
test("current downslope velocity determines friction sign before narration", () => {
  const corrected = applySourceQuantityAuthority(plan, null, incline).plan;
  assert.ok(
    Math.abs(corrected.derived.find((q) => q.id === "a")!.value - 4.692820323) <
      1e-8,
  );
  assert.ok(
    Math.abs(corrected.derived.find((q) => q.id === "T")!.value - 15.92153903) <
      1e-8,
  );
});
test("height reader keeps units and roles across reordered wording", () => {
  for (const [text, height] of [
    ["from a 45 m high cliff at 20 m/s", 45],
    ["from a cliff of height 75 m at 12 m/s", 75],
    ["from a height of 4500 cm at 20 m/s", 45],
    ["cliff at 20 m/s", null],
    ["45 m/s high cliff", null],
    ["45 m^2 high cliff", null],
    ["A projectile is launched at 20 m/s towards a 45 m high cliff.", null],
  ] as const)
    assert.equal(projectileLaunchHeight(text), height, text);
  const changed = attemptArchetypeScene({
    question: projectile.replace(
      "45 m high cliff at 20 m/s",
      "75 m high cliff at 12 m/s",
    ),
  }).scene;
  assert.ok(changed);
  assert.equal(
    changed.document.quantities.find((q) => q.id === "h0")?.value,
    75,
  );
});
test("cached wrong source height is rejected even without plan", () => {
  const scene = attemptArchetypeScene({ question: projectile }).scene!;
  assert.equal(projectileSourceIssues(projectile, scene.document).length, 0);
  const mutated = structuredClone(scene.document);
  mutated.quantities.find((q) => q.id === "h0")!.value = 20;
  assert.ok(projectileSourceIssues(projectile, mutated).length);
});
test("source force model responds to velocity, masses and additional forces", () => {
  const down = readCoupledInclineSource(incline)!;
  const up = readCoupledInclineSource(
    incline.replaceAll("downslope", "upslope"),
  )!;
  assert.ok(Math.abs(down.acceleration - 4.692820323) < 1e-8);
  assert.ok(Math.abs(up.acceleration - 3.307179677) < 1e-8);
  const variant = readCoupledInclineSource(
    incline
      .replace("2 kg", "4 kg")
      .replace("3 kg", "5 kg")
      .replace("0.20", "0.35"),
  )!;
  assert.ok(
    Math.abs(
      variant.acceleration - (50 - 20 + 14 * Math.cos(Math.PI / 6)) / 9,
    ) < 1e-8,
  );
  for (const extra of [
    " An additional 5 N force pulls the incline block upslope.",
    " A spring is attached to the block.",
    " The block experiences air resistance proportional to its velocity.",
  ])
    assert.equal(readCoupledInclineSource(incline + extra), null);
  assert.equal(
    readCoupledInclineSource(
      incline.replace("currently sliding downslope", "at rest"),
    ),
    null,
  );
  assert.equal(
    readCoupledInclineSource(
      incline.replace("30 degree incline", "incline") +
        " A separate slope makes a 30 degree incline.",
    ),
    null,
  );
  const balanced = incline.replace("3 kg", "1 kg").replace("0.20", "0");
  const output = applyCoupledInclineAuthority(balanced, {
    ...plan,
    question: balanced,
  })!;
  assert.equal(output.derived.find((q) => q.symbol === "a")!.value, 0);
  assert.ok(
    output.qualitativeClaims.some((claim) =>
      claim.claim.includes("zero acceleration"),
    ),
  );
  assert.ok(
    output.qualitativeClaims.some((claim) =>
      claim.claim.includes("friction force is zero"),
    ),
  );
});
test("empty planner still gets complete source values and FBDs", () => {
  const empty = { ...plan, derived: [], unknowns: [] };
  const corrected = applyCoupledInclineAuthority(incline, empty)!;
  assert.equal(corrected.derived.length, 4);
  const scene = synthesizeFamilyScene({
    question: incline,
    turnPlan: corrected,
  });
  assert.ok(scene, "supported FBD must compile via normal family path");
  assert.equal(coupledInclineSourceIssues(incline, scene.document).length, 0);
  assert.ok(scene.renderScene.primitives.length > 8);
  assert.equal(
    scene.renderScene.primitives.find(
      (primitive) =>
        primitive.entityId === "incline_friction" && primitive.kind === "label",
    )?.provenance?.usesLeader,
    true,
    "short friction arrow keeps its label tethered to the correct force",
  );
  const mutation = structuredClone(scene.document);
  const forces = mutation.constructions.find((c) => c.id === "block_fbd")!
    .inputs.forces as Array<{ components: number[] }>;
  forces[3]!.components = forces[3]!.components.map((x) => -x);
  assert.ok(
    coupledInclineSourceIssues(incline, mutation).length,
    "flipped friction must fail source check",
  );
});
test("source authority is idempotent and preserves fractional angles", () => {
  const once = applyCoupledInclineAuthority(incline, plan)!;
  assert.deepEqual(applyCoupledInclineAuthority(incline, once), once);
  const fractional = readCoupledInclineSource(
    incline.replace("30 degree", "30.5 degree"),
  );
  assert.ok(fractional);
  assert.equal(fractional.angleDeg, 30.5);
  assert.equal(
    new Set(once.givens.map((quantity) => quantity.id)).size,
    once.givens.length,
  );
});
test("stale speed and gravity cannot control source launch geometry", () => {
  const question = projectile.replace("20 m/s", "30 m/s");
  const stalePlan: TurnPlanV3 = {
    ...plan,
    question,
    unknowns: [],
    derived: [],
    givens: [
      { id: "u", symbol: "u", value: 20, unit: "m/s", provenance: "given" },
      { id: "g", symbol: "g", value: 9.8, unit: "m/s^2", provenance: "given" },
    ],
  };
  const corrected = applySourceQuantityAuthority(
    stalePlan,
    null,
    question,
  ).plan;
  assert.equal(
    corrected.givens.find((quantity) => quantity.id === "u")!.value,
    30,
  );
  assert.equal(
    corrected.givens.find((quantity) => quantity.id === "g")!.value,
    10,
  );
  const scene = attemptArchetypeScene({ question, turnPlan: corrected }).scene;
  assert.ok(scene);
  assert.deepEqual(projectileSourceIssues(question, scene.document), []);
  const oldScene = attemptArchetypeScene({ question: projectile }).scene!;
  assert.ok(
    projectileSourceIssues(question, oldScene.document).some(
      (issue) => issue.code === "projectile_launch_speed_source_mismatch",
    ),
  );
});
const wrongProblem: ProblemIR = {
  schemaVersion: "problem-ir/v1",
  id: "sliding_body",
  question: incline,
  facts: [
    {
      id: "premises",
      kind: "given",
      statement: incline,
      evidence: {
        source: "question",
        start: 0,
        end: incline.length,
        quote: incline,
      },
    },
    {
      id: "asked",
      kind: "requested",
      statement: "acceleration and tension",
      evidence: {
        source: "question",
        start: 0,
        end: incline.length,
        quote: incline,
      },
    },
  ],
  entities: [],
  expressions: [
    {
      id: "accel",
      valueType: "scalar",
      root: { kind: "number", value: 3.31 },
      evidenceFactIds: ["premises"],
    },
    {
      id: "tension",
      valueType: "scalar",
      root: { kind: "number", value: 20.08 },
      evidenceFactIds: ["premises"],
    },
  ],
  constraints: [],
  representationIntents: [],
  solveRequests: [
    {
      id: "solve_a",
      kind: "evaluate",
      expressionId: "accel",
      resultBinding: {
        turnPlanQuantityId: "a",
        symbol: "a",
        unit: "m/s^2",
        evidenceFactIds: ["asked"],
      },
    },
    {
      id: "solve_t",
      kind: "evaluate",
      expressionId: "tension",
      resultBinding: {
        turnPlanQuantityId: "T",
        symbol: "T",
        unit: "N",
        evidenceFactIds: ["asked"],
      },
    },
  ],
};
const grounded = groundCoupledInclineProblem(wrongProblem);
const solved = await new LocalDeterministicSolverProvider().solve(grounded);
test("source-compiled formulation survives solver reconciliation and final audit", () => {
  assert.ok(validateProblemIR(grounded, incline).valid);
  assert.equal(solved.status, "solved");
  const corrected = applySourceQuantityAuthority(
    reconcileTurnPlanWithSolver(plan, grounded, solved),
    grounded,
    incline,
  ).plan;
  assert.ok(
    Math.abs(corrected.derived.find((q) => q.id === "a")!.value - 4.692820323) <
      1e-8,
  );
  assert.equal(
    verifyTurnPlanAgainstSolver(grounded, solved, corrected, incline).status,
    "verified",
  );
  const stale = structuredClone(corrected);
  stale.derived.find((q) => q.id === "a")!.value = 3.31;
  assert.equal(
    verifyTurnPlanAgainstSolver(grounded, solved, stale, incline).status,
    "contradiction",
  );
});
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
