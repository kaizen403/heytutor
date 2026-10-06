import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applySourceQuantityAuthority,
  compileSceneDocument,
  LocalDeterministicSolverProvider,
  relativeMotionCallerIssues,
  synthesizeFamilyScene,
  validateSceneQuantityAgreement,
  verifyTurnPlanAgainstSolver,
  type ExpressionNodeIR,
  type ProblemIR,
  type TurnPlanV3,
} from "@heytutor/scene-engine";
import {
  selectFastVerifiedRepresentation,
  selectVerifiedRepresentation,
} from "../../features/tutor-session/lib/scene/representationFallback";
type Input = { question: string; turnPlan: TurnPlanV3; problemIR: ProblemIR };
const read = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  );
const originals = read("w2-relative-whole-callers.json") as Input[];
const frozenNegatives = read("w2-relative-second-review-negatives.json") as {
  name: string;
  input: Input;
}[];
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
let passed = 0,
  failed = 0;
async function check(
  name: string,
  run: () => void | Promise<void>,
): Promise<void> {
  try {
    await run();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}`, error);
  }
}
const labels = (
  scene: NonNullable<ReturnType<typeof compileSceneDocument>["renderScene"]>,
) =>
  scene.primitives.flatMap((p) =>
    "text" in p && typeof p.text === "string" ? [p.text] : [],
  );
async function accept(
  name: string,
  input: Input,
  time: number,
  travel: number,
  marks?: number,
): Promise<void> {
  await check(name, async () => {
    const before = JSON.stringify(input);
    freeze(input);
    assert.deepEqual(
      relativeMotionCallerIssues(
        input.question,
        input.problemIR,
        input.turnPlan,
      ),
      [],
    );
    const authority = applySourceQuantityAuthority(
      input.turnPlan,
      input.problemIR,
      input.question,
    );
    assert.equal(authority.plan, input.turnPlan);
    assert.ok(
      authority.outcomes.some(
        (o) =>
          o.topic === "physics|2|relative-velocity" &&
          !o.declineFigure &&
          !o.corrections.length,
      ),
    );
    const fast = selectFastVerifiedRepresentation(input),
      normal = selectVerifiedRepresentation(input);
    assert.ok(fast, normal.reason);
    assert.equal(fast.tier, "exact_verified");
    assert.deepEqual(fast.sceneDocument, normal.sceneDocument);
    assert.deepEqual(fast.renderScene, normal.renderScene);
    if (marks !== undefined)
      assert.equal(fast.renderScene.primitives.length, marks);
    assert.ok(labels(fast.renderScene).includes(`t=${time} s`));
    assert.ok(labels(fast.renderScene).includes(`dA=${travel} m`));
    assert.ok(
      compileSceneDocument(fast.sceneDocument, { sourceAuthority: input }).ok,
    );
    assert.deepEqual(
      validateSceneQuantityAgreement(
        fast.sceneDocument.quantities,
        input.turnPlan,
        labels(fast.renderScene),
        {
          question: input.question,
          problemIR: input.problemIR,
          document: fast.sceneDocument,
        },
      ),
      [],
    );
    const solver = await new LocalDeterministicSolverProvider().solve(
      input.problemIR,
    );
    assert.equal(
      verifyTurnPlanAgainstSolver(
        input.problemIR,
        solver,
        input.turnPlan,
        input.question,
      ).status,
      "verified",
    );
    assert.equal(JSON.stringify(input), before);
  });
}
async function reject(
  name: string,
  input: Input,
  baseline = originals[0]!,
): Promise<void> {
  await check(name, async () => {
    const before = JSON.stringify(input);
    freeze(input);
    const candidate = synthesizeFamilyScene(baseline)!;
    const good = compileSceneDocument(candidate.document, {
      sourceAuthority: baseline,
    });
    assert.ok(good.ok && good.renderScene);
    const issues = relativeMotionCallerIssues(
      input.question,
      input.problemIR,
      input.turnPlan,
    );
    assert.ok(
      issues.some(
        (i) => i.code === "relative_source_declined" && i.severity === "fatal",
      ),
    );
    assert.equal(selectFastVerifiedRepresentation(input), null);
    const normal = selectVerifiedRepresentation(input);
    assert.equal(normal.renderScene.primitives.length, 0);
    assert.match(normal.reason, /source_declined/);
    const authority = applySourceQuantityAuthority(
      input.turnPlan,
      input.problemIR,
      input.question,
    );
    assert.equal(authority.plan, input.turnPlan);
    assert.ok(
      authority.outcomes.some(
        (o) =>
          o.topic === "physics|2|relative-velocity" &&
          o.declineFigure &&
          !o.corrections.length,
      ),
    );
    const compiled = compileSceneDocument(candidate.document, {
      sourceAuthority: input,
    });
    assert.equal(compiled.ok, false);
    assert.ok(!compiled.renderScene);
    assert.ok(
      validateSceneQuantityAgreement(
        candidate.document.quantities,
        input.turnPlan,
        labels(good.renderScene),
        {
          question: input.question,
          problemIR: input.problemIR,
          document: candidate.document,
        },
      ).length,
    );
    // The solver is still run on the complete negative original; its audit is
    // independent evidence and may verify numerically coincident false prose.
    const solver = await new LocalDeterministicSolverProvider().solve(
      input.problemIR,
    );
    const audit = verifyTurnPlanAgainstSolver(
      input.problemIR,
      solver,
      input.turnPlan,
      input.question,
    );
    console.log(
      `AUDIT ${name}: ${audit.status} ${audit.issues.map((i) => i.code).join(",")}`,
    );
    assert.equal(JSON.stringify(input), before);
  });
}
// Fresh complete callers, with independently fixed (time, travel) oracles.
// The first deliberately shares t=vA; the second has 4*vB=3*vA.
function fullCase(
  id: string,
  va: number,
  vb: number,
  xa: number,
  xb: number,
  time: number,
  travel: number,
): Input {
  const question = `In the ground frame, east is positive. At t=0 point A is at ${xa} m and B at ${xb} m; their constant ground velocities are ${va >= 0 ? "+" : ""}${va} m/s and ${vb >= 0 ? "+" : ""}${vb} m/s. Find the time for A to catch B and the distance travelled by A.`;
  const givens: TurnPlanV3["givens"] = [
    { id: "a", symbol: "v_A", value: va, unit: "m/s", provenance: "given" },
    { id: "b", symbol: "v_B", value: vb, unit: "m/s", provenance: "given" },
    { id: "xa", symbol: "x_A", value: xa, unit: "m", provenance: "given" },
    { id: "xb", symbol: "x_B", value: xb, unit: "m", provenance: "given" },
  ];
  const derived: TurnPlanV3["derived"] = [
    { id: "time", symbol: "t", value: time, unit: "s", provenance: "derived" },
    {
      id: "travel",
      symbol: "d_A",
      value: travel,
      unit: "m",
      provenance: "derived",
    },
  ];
  const turnPlan: TurnPlanV3 = {
    schemaVersion: "turn-plan/v3",
    question,
    givens,
    derived,
    unknowns: derived.map(({ id, symbol, unit }) => ({ id, symbol, unit })),
    qualitativeClaims: [],
    lawIds: ["uniform_motion"],
    assumptions: ["Motion is at constant velocity on one straight line"],
    visualRequirement: "required",
  };
  const facts: ProblemIR["facts"] = ["given", "requested"].map(
    (kind, index) => ({
      id: index ? "ask" : "setup",
      kind: kind as "given" | "requested",
      statement: question,
      evidence: {
        source: "question",
        start: 0,
        end: question.length,
        quote: question,
      },
    }),
  );
  const node = (value: number): ExpressionNodeIR => ({ kind: "number", value });
  const binary = (
    operator: "+" | "-" | "*" | "/",
    left: ExpressionNodeIR,
    right: ExpressionNodeIR,
  ): ExpressionNodeIR => ({ kind: "binary", operator, left, right });
  const timeRoot = binary(
    "/",
    binary("-", node(xb), node(xa)),
    binary("-", node(va), node(vb)),
  );
  const expressions: ProblemIR["expressions"] = [
    {
      id: "timeExpr",
      valueType: "scalar",
      root: timeRoot,
      evidenceFactIds: ["setup", "ask"],
    },
    {
      id: "travelExpr",
      valueType: "scalar",
      root: binary("*", node(Math.abs(va)), structuredClone(timeRoot)),
      evidenceFactIds: ["setup", "ask"],
    },
  ];
  const problemIR: ProblemIR = {
    schemaVersion: "problem-ir/v1",
    id,
    question,
    facts,
    entities: ["A", "B"].map((id) => ({
      id,
      kind: "point",
      label: id,
      evidenceFactIds: ["setup"],
    })),
    expressions,
    constraints: [],
    representationIntents: [
      {
        id: "motion",
        kind: "conceptual",
        entityIds: ["A", "B"],
        evidenceFactIds: ["setup"],
      },
    ],
    solveRequests: derived.map((q, index) => ({
      id: `request${index}`,
      kind: "evaluate",
      expressionId: expressions[index]!.id,
      resultBinding: {
        turnPlanQuantityId: q.id,
        symbol: q.symbol,
        unit: q.unit,
        evidenceFactIds: ["ask"],
      },
    })),
  };
  return { question, turnPlan, problemIR };
}
async function main(): Promise<void> {
  const expected = [
    [20, 400, 37],
    [12, 144, 35],
    [5, 90, 35],
    [7, 210, 36],
    [5, 120, 42],
  ] as const;
  for (const [index, input] of originals.entries()) {
    const [time, travel, marks] = expected[index]!;
    await accept(`whole original ${index}`, input, time, travel, marks);
  }
  for (const [id, va, vb, xa, xb, time, travel] of [
    ["freshHeadonCoincidence", 13, -7, -60, 200, 13, 169],
    ["freshRatioCoincidence", 16, 12, 0, 64, 16, 256],
    ["freshWest", -9, -3, 80, 20, 10, 90],
  ] as const) {
    const input = fullCase(id, va, vb, xa, xb, time, travel);
    await accept(`independent full ${id}`, input, time, travel);
    const falseDimension = structuredClone(input);
    falseDimension.turnPlan.qualitativeClaims.push({
      id: "dimension",
      claim: "t = v_A+(v_B-v_B)",
      expected: true,
    });
    await reject(
      `full role/dimension counterexample ${id}`,
      falseDimension,
      input,
    );
    if (id === "freshRatioCoincidence") {
      const falseFormula = structuredClone(input);
      falseFormula.turnPlan.teachingSequenceHints = ["t = gap/(v_B-v_AB-v_AB)"];
      await reject(
        "full distinct numeric role coincidence",
        falseFormula,
        input,
      );
    }
  }
  for (const { name, input } of frozenNegatives)
    await reject(
      `frozen R1-R4 ${name}`,
      input,
      name.includes("negative-velocity") ? originals[1]! : originals[0]!,
    );
  const claim = (input: Input, text: string) =>
    input.turnPlan.qualitativeClaims.push({
      id: "independent",
      claim: text,
      expected: true,
    });
  for (const text of [
    "t = gap / (v_B - v_AB - v_AB)",
    "t = v_A + (v_B - v_B)",
  ]) {
    for (const location of [
      "claim",
      "expected",
      "sourceText",
      "hint",
      "assumption",
      "entityHint",
    ] as const) {
      const input = structuredClone(originals[0]!);
      if (location === "claim") claim(input, text);
      if (location === "expected")
        input.turnPlan.qualitativeClaims[0]!.expected = text;
      if (location === "sourceText")
        input.turnPlan.derived.find((q) => q.id === "u1")!.sourceText = text;
      if (location === "hint") input.turnPlan.teachingSequenceHints = [text];
      if (location === "assumption") input.turnPlan.assumptions.push(text);
      if (location === "entityHint")
        input.turnPlan.qualitativeClaims[0]!.relatedEntityHints = [text];
      await reject(`independent compound ${location}: ${text}`, input);
    }
  }
  for (const text of [
    "t = gap/(v_A-v_B)",
    "t = gap/((v_A-v_B)+(v_B-v_B))",
    "s_A = v_A*gap/(v_A-v_B)",
    "v_AB = v_A-v_B",
    "s_A = s_B+gap",
  ]) {
    const input = structuredClone(originals[0]!);
    claim(input, text);
    await accept(`formal identity ${text}`, input, 20, 400, 37);
  }
  for (const [text, positive] of [
    ["B has speed 8 m/s", true],
    ["B speed is 8 m/s", true],
    ["B velocity is -8 m/s in the ground frame", true],
    ["B has speed -8 m/s", false],
    ["B speed is -8 m/s", false],
    ["B velocity is 8 m/s in the ground frame", false],
  ] as const) {
    const input = structuredClone(originals[1]!);
    claim(input, text);
    if (positive) await accept(`magnitude/sign ${text}`, input, 12, 144, 35);
    else await reject(`magnitude/sign ${text}`, input, originals[1]!);
  }
  const n = (value: number): ExpressionNodeIR => ({ kind: "number", value });
  const op = (
    operator: "+" | "-" | "*" | "/",
    left: ExpressionNodeIR,
    right: ExpressionNodeIR,
  ): ExpressionNodeIR => ({ kind: "binary", operator, left, right });
  const conversion = structuredClone(originals[0]!);
  conversion.problemIR.expressions.push({
    id: "conversion",
    valueType: "scalar",
    root: op("/", op("*", n(72), n(1000)), n(3600)),
    evidenceFactIds: ["fSpeedA", "fTime"],
  });
  conversion.problemIR.solveRequests.push({
    id: "convertRequest",
    kind: "evaluate",
    expressionId: "conversion",
    resultBinding: {
      turnPlanQuantityId: "d1",
      symbol: "v_A",
      unit: "m/s",
      evidenceFactIds: ["fTime"],
    },
  });
  await accept(
    "formal conversion intermediate whole caller",
    conversion,
    20,
    400,
    37,
  );
  function nodes(node: ExpressionNodeIR): ExpressionNodeIR[] {
    return [
      node,
      ...(node.kind === "binary"
        ? [...nodes(node.left), ...nodes(node.right)]
        : node.kind === "unary"
          ? nodes(node.operand)
          : []),
    ];
  }
  for (const [index] of nodes(
    conversion.problemIR.expressions.at(-1)!.root,
  ).entries()) {
    const input = structuredClone(conversion);
    Object.assign(nodes(input.problemIR.expressions.at(-1)!.root)[index]!, {
      extra: n(999),
    });
    await reject(`every original conversion AST node ${index}`, input);
  }
  for (const location of [
    "Plan",
    "given",
    "derived",
    "unknown",
    "claim",
    "IR",
    "fact",
    "evidence",
    "entity",
    "intent",
    "expression",
    "request",
    "binding",
  ] as const) {
    const input = structuredClone(originals[0]!);
    const targets = {
      Plan: input.turnPlan,
      given: input.turnPlan.givens[0]!,
      derived: input.turnPlan.derived[0]!,
      unknown: input.turnPlan.unknowns[0]!,
      claim: input.turnPlan.qualitativeClaims[0]!,
      IR: input.problemIR,
      fact: input.problemIR.facts[0]!,
      evidence: input.problemIR.facts[0]!.evidence,
      entity: input.problemIR.entities[0]!,
      intent: input.problemIR.representationIntents[0]!,
      expression: input.problemIR.expressions[0]!,
      request: input.problemIR.solveRequests[0]!,
      binding: input.problemIR.solveRequests[0]!.resultBinding!,
    };
    Object.assign(targets[location], { extra: { value: 999, unit: "m/s" } });
    await reject(`closed original ${location}`, input);
  }
  for (const [name, mutate] of [
    [
      "unasked unknown with valid conversion request",
      (i: Input) =>
        i.turnPlan.unknowns.push({ id: "d1", symbol: "v_A", unit: "m/s" }),
    ],
    [
      "unknown loses request",
      (i: Input) => {
        i.problemIR.solveRequests = i.problemIR.solveRequests.filter(
          (r) => r.resultBinding?.turnPlanQuantityId !== "u1",
        );
        i.problemIR.expressions = i.problemIR.expressions.filter(
          (e) => e.id !== "eTime",
        );
      },
    ],
    [
      "unknown derived identity missing",
      (i: Input) => {
        i.turnPlan.derived = i.turnPlan.derived.filter((q) => q.id !== "u1");
      },
    ],
  ] as const) {
    const input = structuredClone(conversion);
    mutate(input);
    await reject(name, input);
  }
  console.log(`relative second review: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
