import assert from "node:assert/strict";
import { compileSceneDocument, parseMathExpression, type TurnPlanV3 } from "@heytutor/scene-engine";
import {
  buildSourceGroundedRepresentation,
  selectVerifiedRepresentation,
  type SelectedRepresentation,
} from "../../features/tutor-session/lib/scene/representationFallback";

interface SourceEquation {
  sourceText: string;
  samples: readonly { x: number; y: number }[];
}
interface Fixture {
  id: string;
  question: string;
  mustDrawExplicitCurves: boolean;
  discreteDomain: boolean;
  equations: readonly SourceEquation[];
}

// These are source-equation oracles, not examples of a desired extraction algorithm.
// Implicit/unsupported equations may honestly decline. A displayed curve and its
// attached label must agree with the whole original equation, never a y= suffix.
// Discrete domains do not authorize a continuous solution-system diagram.
function sourceEquation(sourceText: string, samples: readonly (readonly [number, number])[]): SourceEquation {
  return { sourceText, samples: samples.map(([x, y]) => ({ x, y })) };
}

const fixtures: readonly Fixture[] = [
  {
    id: "reported-natural-system",
    question: "Solve x + y = 4 and x - y = 2 graphically, x, y ∈ N",
    mustDrawExplicitCurves: false,
    discreteDomain: true,
    equations: [
      sourceEquation("x + y = 4", [[-1.0, 5.0], [0.0, 4.0], [1.0, 3.0]]),
      sourceEquation("x - y = 2", [[-1.0, -3.0], [0.0, -2.0], [1.0, -1.0]]),
    ],
  },
  {
    id: "integer-membership",
    question: "Solve x + y = 4 and x - y = 2 graphically, x, y ∈ Z.",
    mustDrawExplicitCurves: false,
    discreteDomain: true,
    equations: [
      sourceEquation("x + y = 4", [[-1.0, 5.0], [0.0, 4.0], [1.0, 3.0]]),
      sourceEquation("x - y = 2", [[-1.0, -3.0], [0.0, -2.0], [1.0, -1.0]]),
    ],
  },
  {
    id: "blackboard-natural",
    question: "Solve x+y=4 and x−y=2 graphically. x,y ∈ ℕ.",
    mustDrawExplicitCurves: false,
    discreteDomain: true,
    equations: [
      sourceEquation("x+y=4", [[-1.0, 5.0], [0.0, 4.0], [1.0, 3.0]]),
      sourceEquation("x−y=2", [[-1.0, -3.0], [0.0, -2.0], [1.0, -1.0]]),
    ],
  },
  {
    id: "word-membership",
    question: "Solve x+y=4 and x-y=2 graphically. x and y IN N.",
    mustDrawExplicitCurves: false,
    discreteDomain: true,
    equations: [
      sourceEquation("x+y=4", [[-1.0, 5.0], [0.0, 4.0], [1.0, 3.0]]),
      sourceEquation("x-y=2", [[-1.0, -3.0], [0.0, -2.0], [1.0, -1.0]]),
    ],
  },
  {
    id: "latex-membership",
    question: "Solve x+y=4 and x-y=2 graphically. x,y \\in \\mathbb{N}.",
    mustDrawExplicitCurves: false,
    discreteDomain: true,
    equations: [
      sourceEquation("x+y=4", [[-1.0, 5.0], [0.0, 4.0], [1.0, 3.0]]),
      sourceEquation("x-y=2", [[-1.0, -3.0], [0.0, -2.0], [1.0, -1.0]]),
    ],
  },
  {
    id: "reordered-equations",
    question: "Solve x-y=2 and x+y=4 graphically, x,y ∈ N.",
    mustDrawExplicitCurves: false,
    discreteDomain: true,
    equations: [
      sourceEquation("x-y=2", [[-1.0, -3.0], [0.0, -2.0], [1.0, -1.0]]),
      sourceEquation("x+y=4", [[-1.0, 5.0], [0.0, 4.0], [1.0, 3.0]]),
    ],
  },
  {
    id: "equation-sides-swapped",
    question: "Solve 4=x+y and 2=x-y graphically, x,y ∈ N.",
    mustDrawExplicitCurves: false,
    discreteDomain: true,
    equations: [
      sourceEquation("4=x+y", [[-1.0, 5.0], [0.0, 4.0], [1.0, 3.0]]),
      sourceEquation("2=x-y", [[-1.0, -3.0], [0.0, -2.0], [1.0, -1.0]]),
    ],
  },
  {
    id: "nonunit-coefficients",
    question: "Solve 2x+3y=12 and x-2y=1 graphically, x,y ∈ N.",
    mustDrawExplicitCurves: false,
    discreteDomain: true,
    equations: [
      sourceEquation("2x+3y=12", [[-1.0, 4.666666666666667], [0.0, 4.0], [1.0, 3.3333333333333335]]),
      sourceEquation("x-2y=1", [[-1.0, -1.0], [0.0, -0.5], [1.0, 0.0]]),
    ],
  },
  {
    id: "negative-coefficients",
    question: "Solve -x+y=4 and 2x-3y=6 graphically, x,y ∈ Z.",
    mustDrawExplicitCurves: false,
    discreteDomain: true,
    equations: [
      sourceEquation("-x+y=4", [[-1.0, 3.0], [0.0, 4.0], [1.0, 5.0]]),
      sourceEquation("2x-3y=6", [[-1.0, -2.6666666666666665], [0.0, -2.0], [1.0, -1.3333333333333333]]),
    ],
  },
  {
    id: "unicode-multiplication-minus",
    question: "Solve 2×x + y = 6 and x − y = 2 graphically, x,y ∈ ℕ.",
    mustDrawExplicitCurves: false,
    discreteDomain: true,
    equations: [
      sourceEquation("2×x + y = 6", [[-1.0, 8.0], [0.0, 6.0], [1.0, 4.0]]),
      sourceEquation("x − y = 2", [[-1.0, -3.0], [0.0, -2.0], [1.0, -1.0]]),
    ],
  },
  {
    id: "fraction-coefficients",
    question: "Solve (1/2)x+y=4 and x-(1/2)y=2 graphically, x,y ∈ N.",
    mustDrawExplicitCurves: false,
    discreteDomain: true,
    equations: [
      sourceEquation("(1/2)x+y=4", [[-1.0, 4.5], [0.0, 4.0], [1.0, 3.5]]),
      sourceEquation("x-(1/2)y=2", [[-1.0, -6.0], [0.0, -4.0], [1.0, -2.0]]),
    ],
  },
  {
    id: "same-right-hand-values",
    question: "Solve x+y=4 and x-y=4 graphically, x,y ∈ N.",
    mustDrawExplicitCurves: false,
    discreteDomain: true,
    equations: [
      sourceEquation("x+y=4", [[-1.0, 5.0], [0.0, 4.0], [1.0, 3.0]]),
      sourceEquation("x-y=4", [[-1.0, -5.0], [0.0, -4.0], [1.0, -3.0]]),
    ],
  },
  {
    id: "multiplicative-left-side",
    question: "Graph 2*y=4 and 3*y=9. x,y ∈ N.",
    mustDrawExplicitCurves: false,
    discreteDomain: true,
    equations: [
      sourceEquation("2*y=4", [[-1.0, 2.0], [0.0, 2.0], [1.0, 2.0]]),
      sourceEquation("3*y=9", [[-1.0, 3.0], [0.0, 3.0], [1.0, 3.0]]),
    ],
  },
  {
    id: "parenthesized-left-side",
    question: "Solve (x+y)=4 and (x-y)=2 graphically, x,y ∈ N.",
    mustDrawExplicitCurves: false,
    discreteDomain: true,
    equations: [
      sourceEquation("(x+y)=4", [[-1.0, 5.0], [0.0, 4.0], [1.0, 3.0]]),
      sourceEquation("(x-y)=2", [[-1.0, -3.0], [0.0, -2.0], [1.0, -1.0]]),
    ],
  },
  {
    id: "nonlinear-implicit-left-side",
    question: "Graph x^2+y=4. x,y ∈ N.",
    mustDrawExplicitCurves: false,
    discreteDomain: true,
    equations: [
      sourceEquation("x^2+y=4", [[-1, 3], [0, 4], [1, 3], [2, 0]]),
    ],
  },
  {
    id: "unsupported-rhs-identifier",
    question: "Graph y=4z. x,y ∈ N.",
    mustDrawExplicitCurves: false,
    discreteDomain: true,
    equations: [
    ],
  },
  {
    id: "identifier-suffix",
    question: "Graph xy=4. x,y ∈ N.",
    mustDrawExplicitCurves: false,
    discreteDomain: true,
    equations: [
    ],
  },
  {
    id: "bare-constant-controls",
    question: "Graph y=4 and y=2. x,y ∈ N.",
    mustDrawExplicitCurves: true,
    discreteDomain: true,
    equations: [
      sourceEquation("y=4", [[-1.0, 4.0], [0.0, 4.0], [1.0, 4.0]]),
      sourceEquation("y=2", [[-1.0, 2.0], [0.0, 2.0], [1.0, 2.0]]),
    ],
  },
  {
    id: "bare-affine-controls",
    question: "Graph y=x+1 and y=2*x-3. x,y ∈ N.",
    mustDrawExplicitCurves: true,
    discreteDomain: true,
    equations: [
      sourceEquation("y=x+1", [[-1.0, 0.0], [0.0, 1.0], [1.0, 2.0]]),
      sourceEquation("y=2*x-3", [[-1.0, -5.0], [0.0, -3.0], [1.0, -1.0]]),
    ],
  },
  {
    id: "bare-fraction-controls",
    question: "Graph y=(4-x)/3 and y=(x-2)/2. x,y ∈ N.",
    mustDrawExplicitCurves: true,
    discreteDomain: true,
    equations: [
      sourceEquation("y=(4-x)/3", [[-1.0, 1.6666666666666667], [0.0, 1.3333333333333333], [1.0, 1.0]]),
      sourceEquation("y=(x-2)/2", [[-1.0, -1.5], [0.0, -1.0], [1.0, -0.5]]),
    ],
  },
  {
    id: "bare-unicode-controls",
    question: "Graph y=4−x and y=x−2. x,y ∈ ℕ.",
    mustDrawExplicitCurves: true,
    discreteDomain: true,
    equations: [
      sourceEquation("y=4−x", [[-1.0, 5.0], [0.0, 4.0], [1.0, 3.0]]),
      sourceEquation("y=x−2", [[-1.0, -3.0], [0.0, -2.0], [1.0, -1.0]]),
    ],
  },
  {
    id: "existing-calculus-positive",
    question: "A curve y=x^2 and the line y=4 enclose a region. Sketch the region, then find its area using integration.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=4", [[-1.0, 4.0], [0.0, 4.0], [1.0, 4.0]]),
    ],
  },
  {
    id: "bare-trig-positive",
    question: "Sketch y=sin(x) and y=cos(x).",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=sin(x)", [[0, 0.0], [0.5, 0.479425538604203], [1, 0.8414709848078965], [2, 0.9092974268256817]]),
      sourceEquation("y=cos(x)", [[0, 1.0], [0.5, 0.8775825618903728], [1, 0.5403023058681398], [2, -0.4161468365471424]]),
    ],
  },
  {
    id: "bare-spaced-controls",
    question: "Plot y = -x + 4 and y = x - 2. x,y ∈ N.",
    mustDrawExplicitCurves: true,
    discreteDomain: true,
    equations: [
      sourceEquation("y = -x + 4", [[-1.0, 5.0], [0.0, 4.0], [1.0, 3.0]]),
      sourceEquation("y = x - 2", [[-1.0, -3.0], [0.0, -2.0], [1.0, -1.0]]),
    ],
  },
];

// Unknown factors and mathematical continuations cannot be dropped as prose.
// These supplement the original24 fixtures without changing their oracles.
const sourceCompletenessFixtures: readonly Fixture[] = [
  {
    id: "unbound-rhs-multiletter-factor",
    question: "Graph y=4 theta.",
    mustDrawExplicitCurves: false,
    discreteDomain: false,
    equations: [],
  },
  {
    id: "unbound-rhs-variable-factor",
    question: "Graph y=x alpha.",
    mustDrawExplicitCurves: false,
    discreteDomain: false,
    equations: [],
  },
  {
    id: "unbound-lhs-multiletter-factor",
    question: "Graph theta y=4.",
    mustDrawExplicitCurves: false,
    discreteDomain: false,
    equations: [],
  },
  {
    id: "unbound-lhs-affine-factor",
    question: "Graph beta y=x+1.",
    mustDrawExplicitCurves: false,
    discreteDomain: false,
    equations: [],
  },
  {
    id: "unsupported-rhs-thousands-comma",
    question: "Graph y=1,000.",
    mustDrawExplicitCurves: false,
    discreteDomain: false,
    equations: [],
  },
  {
    id: "unsupported-rhs-ratio-colon",
    question: "Graph y=2:1.",
    mustDrawExplicitCurves: false,
    discreteDomain: false,
    equations: [],
  },
  {
    id: "unsupported-rhs-factorial",
    question: "Graph y=4!.",
    mustDrawExplicitCurves: false,
    discreteDomain: false,
    equations: [],
  },
];
// Preserve supported source functions under introductory prose and comma clauses.
const retentionFixtures: readonly Fixture[] = [
  {
    id: "retention-solve-graphically-prefix",
    question: "Solve graphically: y=4-x and y=x-2.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=4-x", [[-1, 5], [0, 4], [1, 3]]),
      sourceEquation("y=x-2", [[-1, -3], [0, -2], [1, -1]]),
    ],
  },
  {
    id: "retention-represent-graphically-prefix",
    question: "Represent graphically: y=4-x and y=x-2.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=4-x", [[-1, 5], [0, 4], [1, 3]]),
      sourceEquation("y=x-2", [[-1, -3], [0, -2], [1, -1]]),
    ],
  },
  {
    id: "retention-equations-introduction",
    question: "Solve graphically the equations y=4-x and y=x-2.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=4-x", [[-1, 5], [0, 4], [1, 3]]),
      sourceEquation("y=x-2", [[-1, -3], [0, -2], [1, -1]]),
    ],
  },
  {
    id: "retention-explicit-real-domain-comma",
    question: "Graph y=4-x and y=x-2, x, y ∈ R.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=4-x", [[-1, 5], [0, 4], [1, 3]]),
      sourceEquation("y=x-2", [[-1, -3], [0, -2], [1, -1]]),
    ],
  },
  {
    id: "retention-real-variable-comma",
    question: "Graph y=4-x, for real x.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=4-x", [[-1, 5], [0, 4], [1, 3]]),
    ],
  },
  {
    id: "retention-quadratic-comma",
    question: "Plot y=x^2, where x is real.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
    ],
  },
];
const gateFixtures: readonly Fixture[] = [...fixtures, ...sourceCompletenessFixtures, ...retentionFixtures];

function normalizeEquation(value: string): string {
  return value.replace(/[−–—]/g, "-").replace(/×/g, "*").replace(/÷/g, "/")
    .replace(/²/g, "^2").replace(/³/g, "^3").replace(/\s+/g, "");
}

function agreesWithSamples(expression: string, equation: SourceEquation): boolean {
  try {
    const parsed = parseMathExpression(expression);
    return equation.samples.every(({ x, y }) => {
      const actual = parsed.evaluate(x);
      return Number.isFinite(actual) && Math.abs(actual - y) <= 1e-9 * Math.max(1, Math.abs(y));
    });
  } catch {
    return false;
  }
}

function labelOwnsEquation(label: string, equation: SourceEquation): boolean {
  const normalized = normalizeEquation(label);
  if (normalized === normalizeEquation(equation.sourceText)) return true;
  return normalized.startsWith("y=") && agreesWithSamples(normalized.slice(2), equation);
}

function verifyOwnership(fixture: Fixture, representation: SelectedRepresentation): void {
  assert.equal(representation.sceneDocument.source.question, fixture.question, "preserve the original question");
  if (fixture.discreteDomain) {
    assert.notEqual(representation.figureSource, "linear_source", "a discrete domain cannot become a continuous native solution");
    assert(!representation.sceneDocument.constructions.some(({ operator }) =>
      ["linear_system", "linear_feasible_region", "linear_half_plane"].includes(operator)),
    "source copying cannot upgrade a discrete-domain request to a continuous solution system");
  }
  if (representation.figureSource !== "source_grounded") return;
  assert.equal(representation.nonMetric, true);
  assert.equal(representation.tier, "question_representation");
  assert.equal(representation.validationReport.valid, true);
  const compiled = compileSceneDocument(representation.sceneDocument);
  assert(compiled.ok && compiled.renderScene, "a returned source figure must pass the real compiler");
  const curves = representation.sceneDocument.constructions.filter(({ operator }) => operator === "function_curve");
  if (fixture.mustDrawExplicitCurves) assert.equal(curves.length, fixture.equations.length, "retain genuine explicit source functions");
  const owners = new Set<number>();
  for (const curve of curves) {
    const expression = curve.inputs.expression;
    assert.equal(typeof expression, "string", "every plotted function has an expression");
    assert(typeof expression === "string");
    const equationIndex = fixture.equations.findIndex((equation) => agreesWithSamples(expression, equation));
    assert(equationIndex >= 0,
      `${fixture.id}: plotted ${expression} is not any whole source equation (${fixture.equations.map(({ sourceText }) => sourceText).join("; ")})`);
    assert(!owners.has(equationIndex), "distinct source equations must not collapse into duplicated curve ownership");
    owners.add(equationIndex);
    const equation = fixture.equations[equationIndex]!;
    for (const entityId of curve.outputs) {
      const entity = representation.sceneDocument.entities.find(({ id }) => id === entityId);
      assert(entity && typeof entity.label === "string", "every copied equation has an attached label");
      assert(labelOwnsEquation(entity.label, equation), `${entity.label} does not label its own source equation ${equation.sourceText}`);
      const labels = compiled.renderScene.primitives.filter((primitive) => primitive.entityId === entityId && primitive.kind === "label");
      assert(labels.length > 0, "the source-equation label must actually render on its curve");
      assert(labels.every(({ text }) => typeof text === "string" && labelOwnsEquation(text, equation)), "rendered labels must keep whole-equation ownership");
    }
  }
  if (fixture.mustDrawExplicitCurves) assert.equal(owners.size, fixture.equations.length);
  assert(!representation.sceneDocument.constructions.some(({ operator }) =>
    operator === "function_region" || operator === "intersection"),
  "a source-only sketch must not acquire a solved region or intersection");
}

let checks = 0;
let failed = 0;
function check(name: string, run: () => void): void {
  checks++;
  try { run(); }
  catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const caseIndex = process.argv.indexOf("--case");
const caseId = caseIndex < 0 ? undefined : process.argv[caseIndex + 1];
const selectedFixtures = caseId ? gateFixtures.filter(({ id }) => id === caseId) : gateFixtures;
assert(selectedFixtures.length > 0, `unknown fixture ${caseId}`);
for (const fixture of selectedFixtures) {
  const plan: TurnPlanV3 = {
    schemaVersion: "turn-plan/v3", question: fixture.question, givens: [], unknowns: [],
    derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
  };
  const originalPlan = structuredClone(plan);
  check(`${fixture.id}: direct source fallback`, () => {
    let representation: SelectedRepresentation;
    try { representation = buildSourceGroundedRepresentation(fixture.question, plan); }
    catch (error) {
      assert(!fixture.mustDrawExplicitCurves, "genuine explicit y-functions must remain drawable");
      assert.match(error instanceof Error ? error.message : String(error), /required visual representation unavailable/,
        "unsupported equations may explicitly decline, not fail for an unrelated reason");
      return;
    }
    if (fixture.mustDrawExplicitCurves) assert.equal(representation.figureSource, "source_grounded");
    verifyOwnership(fixture, representation);
  });
  check(`${fixture.id}: verified selection`, () => {
    const representation = selectVerifiedRepresentation({ question: fixture.question, turnPlan: plan });
    verifyOwnership(fixture, representation);
    assert.deepEqual(plan, originalPlan, "fallback selection must not rewrite its input plan");
  });
}
console.log(`source-function equation ownership: ${checks - failed}/${checks} checks passed (${selectedFixtures.length} wordings)`);
if (failed > 0) process.exitCode = 1;
