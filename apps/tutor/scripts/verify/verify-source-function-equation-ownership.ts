import assert from "node:assert/strict";
import { inferSceneCapabilities } from "@heytutor/tutor-core";
import { compileSceneDocument, parseMathExpression, parseMathExpression2D, synthesizeFamilyScene, validateSceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import {
  buildSourceGroundedRepresentation,
  selectFastVerifiedRepresentation,
  selectVerifiedRepresentation,
  selectVerifiedRepresentationExplained,
  prepareFallbackFunctionInventory,
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
  mustDeclineSourceCurves?: boolean;
  mustRetainNative?: boolean;
  mustRetainFast?: boolean;
  exactCurveExpressions?: readonly string[];
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
// Public regressions frozen before execution: derivative and bare primes,
// plural introductions, and genuine quoted-equation controls. Original37
// oracles and ownership assertions remain unchanged.
const primeAndPluralRetentionFixtures: readonly Fixture[] = [
  {
    id: "retention-ascii-derivative-prime",
    question: "Find f'(x) for f(x)=x^2. Graph y=x^2 and y=2*x.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
  {
    id: "retention-unicode-derivative-prime",
    question: "Determine g′(x) when g(x)=x^3. Plot y=x^3 and y=3*x^2.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^3", [[-1, -1], [0, 0], [1, 1], [2, 8]]),
      sourceEquation("y=3*x^2", [[-1, 3], [0, 0], [1, 3], [2, 12]]),
    ],
  },
  {
    id: "retention-ascii-second-derivative",
    question: "Calculate f''(x) for f(x)=x^3-2*x. Sketch y=x^3-2*x and y=6*x.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^3-2*x", [[-1, 1], [0, 0], [1, -1], [2, 4]]),
      sourceEquation("y=6*x", [[-1, -6], [0, 0], [1, 6], [2, 12]]),
    ],
  },
  {
    id: "retention-unicode-second-derivative",
    question: "Find h″(x) for h(x)=x^3. Draw y=x^3 and y=6*x.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^3", [[-1, -1], [0, 0], [1, 1], [2, 8]]),
      sourceEquation("y=6*x", [[-1, -6], [0, 0], [1, 6], [2, 12]]),
    ],
  },
  {
    id: "retention-ascii-prime-trigonometric",
    question: "First evaluate h'(x) for h(x)=sin(x). Then plot y=sin(x) and y=cos(x).",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=sin(x)", [[0, 0], [0.5, 0.479425538604203], [1, 0.8414709848078965], [2, 0.9092974268256817]]),
      sourceEquation("y=cos(x)", [[0, 1], [0.5, 0.8775825618903728], [1, 0.5403023058681398], [2, -0.4161468365471424]]),
    ],
  },
  {
    id: "retention-plural-curves",
    question: "Graph the curves y=x^2 and y=2*x.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
  {
    id: "retention-plural-both-curves",
    question: "Sketch both curves y=x^2+1 and y=3*x.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2+1", [[-1, 2], [0, 1], [1, 2], [2, 5]]),
      sourceEquation("y=3*x", [[-1, -3], [0, 0], [1, 3], [2, 6]]),
    ],
  },
  {
    id: "retention-plural-lines",
    question: "Plot the lines y=4-x and y=x-2.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=4-x", [[-1, 5], [0, 4], [1, 3], [2, 2]]),
      sourceEquation("y=x-2", [[-1, -3], [0, -2], [1, -1], [2, 0]]),
    ],
  },
  {
    id: "retention-plural-functions",
    question: "Draw these functions y=sin(x) and y=cos(x).",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=sin(x)", [[0, 0], [0.5, 0.479425538604203], [1, 0.8414709848078965], [2, 0.9092974268256817]]),
      sourceEquation("y=cos(x)", [[0, 1], [0.5, 0.8775825618903728], [1, 0.5403023058681398], [2, -0.4161468365471424]]),
    ],
  },
  {
    id: "retention-plural-represent-functions",
    question: "Represent graphically the functions y=x^3 and y=2*x+1.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^3", [[-1, -1], [0, 0], [1, 1], [2, 8]]),
      sourceEquation("y=2*x+1", [[-1, -1], [0, 1], [1, 3], [2, 5]]),
    ],
  },
  {
    id: "quoted-ascii-single-equation-negative",
    question: "Explain why 'y=4' is only a quoted example.",
    mustDrawExplicitCurves: false,
    discreteDomain: false,
    equations: [
    ],
  },
  {
    id: "quoted-double-equation-negative",
    question: "Discuss the printed phrase \"y=x^2\" without drawing it.",
    mustDrawExplicitCurves: false,
    discreteDomain: false,
    equations: [
    ],
  },
  {
    id: "quoted-curly-single-equation-negative",
    question: "Is the text ‘y=2*x’ a graphing instruction?",
    mustDrawExplicitCurves: false,
    discreteDomain: false,
    equations: [
    ],
  },
  {
    id: "quoted-example-then-unquoted-functions",
    question: "The note says 'y=99'. Graph y=x^2 and y=2*x.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
  {
    id: "retention-bare-first-and-second-primes",
    question: "Find f' and f'' for f(x)=x^3. Graph y=x^3 and y=3*x^2.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^3", [[-1, -1], [0, 0], [1, 1], [2, 8]]),
      sourceEquation("y=3*x^2", [[-1, 3], [0, 0], [1, 3], [2, 12]]),
    ],
  },
  {
    id: "retention-bare-prime-comma",
    question: "Calculate f', then graph y=x^2 and y=2*x.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
  {
    id: "retention-bare-second-prime-comma",
    question: "Find f'', then graph y=x^3 and y=6*x.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^3", [[-1, -1], [0, 0], [1, 1], [2, 8]]),
      sourceEquation("y=6*x", [[-1, -6], [0, 0], [1, 6], [2, 12]]),
    ],
  },
  {
    id: "retention-bare-typographic-prime",
    question: "Determine f’ for f(x)=sin(x), then plot y=sin(x) and y=cos(x).",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=sin(x)", [[0, 0], [0.5, 0.479425538604203], [1, 0.8414709848078965], [2, 0.9092974268256817]]),
      sourceEquation("y=cos(x)", [[0, 1], [0.5, 0.8775825618903728], [1, 0.5403023058681398], [2, -0.4161468365471424]]),
    ],
  },
  {
    id: "quoted-prime-example-then-unquoted-functions",
    question: "The note reads 'plot y=99 after computing f’'. Graph y=x^2 and y=2*x.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
];
// Quoted derivative-prime ownership and mixed typography regressions,
// frozen before execution. The prior56 fixture and assertion bytes remain intact.
const quotedPrimeOwnershipFixtures: readonly Fixture[] = [
  {
    id: "quoted-ascii-prime-instruction-negative",
    question: "The note says 'Compute f'(x), then graph y=x^2 and y=2*x; do not draw it.' Explain the note.",
    mustDrawExplicitCurves: false,
    discreteDomain: false,
    equations: [
    ],
  },
  {
    id: "quoted-curly-prime-instruction-negative",
    question: "The note says ‘Compute f’(x), then graph y=x^2 and y=2*x; do not draw it.’ Explain the note.",
    mustDrawExplicitCurves: false,
    discreteDomain: false,
    equations: [
    ],
  },
  {
    id: "quoted-ascii-second-prime-instruction-negative",
    question: "The note says 'Compute f''(x), then graph y=x^2 and y=2*x; do not draw it.' Explain the note.",
    mustDrawExplicitCurves: false,
    discreteDomain: false,
    equations: [
    ],
  },
  {
    id: "quoted-ascii-prime-then-genuine-graphs",
    question: "The note says 'Compute f'(x), then graph y=99; do not draw it.' Graph y=x^2 and y=2*x.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
  {
    id: "quoted-curly-prime-then-genuine-graphs",
    question: "The note says ‘Compute f’(x), then graph y=99; do not draw it.’ Graph y=x^2 and y=2*x.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
  {
    id: "mixed-single-quote-later-genuine-graphs",
    question: "The note prints 'y=99’. Graph y=x^2 and y=2*x.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
  {
    id: "mixed-curly-single-quote-later-genuine-graphs",
    question: "The note prints ‘y=99'. Graph y=x^2 and y=2*x.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
  {
    id: "mixed-double-quote-later-genuine-graphs",
    question: "The note prints \"y=99”. Graph y=x^2 and y=2*x.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
];
// Real closing quotes followed by parenthesized prose are not derivative
// primes. These five public oracles were frozen before execution; all prior
// 64 fixture and128 assertion bytes remain unchanged.
const quotedCloseProseFixtures: readonly Fixture[] = [
  {
    id: "quoted-number-ascii-before-prose-parentheses",
    question: "The note says 'y=99' (ignore it). Graph y=x^2 and y=2*x.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
  {
    id: "quoted-number-curly-before-prose-parentheses",
    question: "The note says ‘y=99’ (ignore it). Graph y=x^2 and y=2*x.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
  {
    id: "quoted-number-mixed-before-prose-parentheses",
    question: "The note says 'y=99’ (ignore it). Graph y=x^2 and y=2*x.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
  {
    id: "quoted-variable-before-prose-parentheses",
    question: "The sheet prints 'y=x' (a quoted example). Graph y=x^2 and y=2*x.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
  {
    id: "quoted-word-before-prose-parentheses",
    question: "The note says 'example' (ignore this word). Graph y=x^2 and y=2*x.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
];
// Concrete single-word prose regressions and actual quoted symbolic-prime
// controls, frozen before execution. All prior69 fixtures/138 checks stay intact.
const quotedCloseSingleProseFixtures: readonly Fixture[] = [
  {
    id: "quoted-word-single-prose-token-parentheses",
    question: "The note says 'note' (ignored). Graph y=x^2 and y=2*x.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
  {
    id: "quoted-variable-single-prose-token-parentheses",
    question: "The note says 'y=x' (ignore). Graph y=x^2 and y=2*x.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
  {
    id: "quoted-derivative-t-instruction-negative",
    question: "The note says 'Compute f'(t), then graph y=x^2 and y=2*x; do not draw it.' Explain the note.",
    mustDrawExplicitCurves: false,
    discreteDomain: false,
    equations: [
    ],
  },
  {
    id: "quoted-derivative-theta-instruction-negative",
    question: "The note says 'Compute f'(theta), then graph y=x^2 and y=2*x; do not draw it.' Explain the note.",
    mustDrawExplicitCurves: false,
    discreteDomain: false,
    equations: [
    ],
  },
];
// Exact independently observed unknown-argument/prose-punctuation failures,
// plus a spaced unknown-parameter quote control. Inputs and whole-equation
// sample oracles were frozen before execution; all prior146 checks stay intact.
const quoteArgumentClassFixtures: readonly Fixture[] = [
  {
    id: "quote-argument-quoted-time-argument",
    question: "The note says 'Compute f'(time), then graph y=x^2 and y=2*x; do not draw it.' Explain the note.",
    mustDrawExplicitCurves: false,
    discreteDomain: false,
    equations: [
    ],
  },
  {
    id: "quote-argument-quoted-speed-argument",
    question: "The note says 'Compute f'(speed), then graph y=x^2 and y=2*x; do not draw it.' Explain the note.",
    mustDrawExplicitCurves: false,
    discreteDomain: false,
    equations: [
    ],
  },
  {
    id: "quote-argument-quoted-multiword-argument",
    question: "The note says 'Compute f'(flow rate), then graph y=x^2 and y=2*x; do not draw it.' Explain the note.",
    mustDrawExplicitCurves: false,
    discreteDomain: false,
    equations: [
    ],
  },
  {
    id: "quote-argument-closing-prose-period",
    question: "The note says 'y=x' (ignore it.). Graph y=x^2 and y=2*x.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
  {
    id: "quote-argument-closing-prose-exclamation",
    question: "The note says 'y=x' (ignore it!). Graph y=x^2 and y=2*x.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
  {
    id: "quote-argument-closing-prose-with-math",
    question: "The note says 'y=x' (at x=0). Graph y=x^2 and y=2*x.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
  {
    id: "quote-argument-spaced-unknown-parameter-negative",
    question: "The note says 'Compute f' (time), then graph y=x^2 and y=2*x; do not draw it.' Explain the note.",
    mustDrawExplicitCurves: false,
    discreteDomain: false,
    equations: [
    ],
  },
];
// Ordinary quoted words and phrases around genuine graph instructions, plus
// the trailing-s possessive ownership control. Frozen before runtime execution;
// all prior80 fixture and160 assertion bytes remain intact.
const ordinaryQuoteContextFixtures: readonly Fixture[] = [
  {
    id: "ordinary-quote-before-and-after-genuine-graphs",
    question: "The note says 'example'. Graph y=x^2 and y=2*x. Ignore 'example'.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
  {
    id: "curly-ordinary-quote-before-and-after-genuine-graphs",
    question: "The note says ‘example’. Graph y=x^2 and y=2*x. Ignore ‘example’.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
  {
    id: "mixed-ordinary-quote-before-and-after-genuine-graphs",
    question: "The note says 'example’. Graph y=x^2 and y=2*x. Ignore ‘example'.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
  {
    id: "phrase-quote-before-and-after-genuine-graphs",
    question: "The note says 'a plain example'. Graph y=x^2 and y=2*x. Ignore 'a plain example'.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
  {
    id: "different-word-quotes-before-and-after-genuine-graphs",
    question: "The note says 'overview'. Graph y=x^2 and y=2*x. Ignore 'caption'.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
  {
    id: "quoted-trailing-s-possessive-instruction-negative",
    question: "The note says 'The drawing is the students', so graph y=x^2 and y=2*x, then discuss it'. Explain the note.",
    mustDrawExplicitCurves: false,
    discreteDomain: false,
    equations: [
    ],
  },
];
// Combined ordinary-quote/prose contexts and Greek/subscript derivative
// ownership protections. Frozen before execution with the original160 checks
// and the preceding172-check snapshot preserved byte for byte.
const ordinaryQuoteCombinedFixtures: readonly Fixture[] = [
  {
    id: "word-quote-prose-and-later-quote-genuine-graphs",
    question: "The note says 'example' (ignore it). Graph y=x^2 and y=2*x. Ignore 'example'.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
  {
    id: "numeric-quote-prose-and-later-quote-genuine-graphs",
    question: "The note says 'y=99' (ignore it). Graph y=x^2 and y=2*x. Ignore 'y=99'.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
  {
    id: "quoted-greek-prime-instruction-negative",
    question: "The note says 'Compute φ'(time), then graph y=x^2 and y=2*x; do not draw it.' Explain the note.",
    mustDrawExplicitCurves: false,
    discreteDomain: false,
    equations: [
    ],
  },
  {
    id: "quoted-subscript-prime-instruction-negative",
    question: "The note says 'Compute f₁'(time), then graph y=x^2 and y=2*x; do not draw it.' Explain the note.",
    mustDrawExplicitCurves: false,
    discreteDomain: false,
    equations: [
    ],
  },
];
// Numeric measurement apostrophes/primes and quoted numeric instruction
// controls, frozen before execution. All prior90 fixture and180 assertion
// bytes remain intact; double-inch syntax is separate historical scope.
const numericMeasurementMarkFixtures: readonly Fixture[] = [
  {
    id: "reported-numeric-foot-mark-retains-genuine-graphs",
    question: "A ball starts at a height of 5'. Graph y=-x^2+5 and y=0.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=-x^2+5", [[-1, 4], [0, 5], [1, 4], [2, 1]]),
      sourceEquation("y=0", [[-1, 0], [0, 0], [1, 0], [2, 0]]),
    ],
  },
  {
    id: "decimal-foot-mark-retains-genuine-graphs",
    question: "The marker stands 5.5' above the floor. Graph y=-x^2+5.5 and y=0.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=-x^2+5.5", [[-1, 4.5], [0, 5.5], [1, 4.5], [2, 1.5]]),
      sourceEquation("y=0", [[-1, 0], [0, 0], [1, 0], [2, 0]]),
    ],
  },
  {
    id: "curly-numeric-measurement-retains-genuine-graphs",
    question: "A ball starts at a height of 5’. Graph y=-x^2+5 and y=0.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=-x^2+5", [[-1, 4], [0, 5], [1, 4], [2, 1]]),
      sourceEquation("y=0", [[-1, 0], [0, 0], [1, 0], [2, 0]]),
    ],
  },
  {
    id: "typographic-prime-measurement-retains-genuine-graphs",
    question: "A platform is 7′ high. Graph y=x^2 and y=2*x.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
  {
    id: "numeric-foot-mark-before-plural-curve-instruction",
    question: "The stated length is 12'. Graph the curves y=x^2 and y=2*x.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
  {
    id: "signed-numeric-mark-before-plot-instruction",
    question: "The survey records a signed offset of -2'. Plot y=x^2 and y=2*x.",
    mustDrawExplicitCurves: true,
    discreteDomain: false,
    equations: [
      sourceEquation("y=x^2", [[-1, 1], [0, 0], [1, 1], [2, 4]]),
      sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2], [2, 4]]),
    ],
  },
  {
    id: "quoted-ascii-numeric-mark-instruction-negative",
    question: "The note says 'The height is 5', then graph y=x^2 and y=2*x; do not draw it.' Explain the note.",
    mustDrawExplicitCurves: false,
    discreteDomain: false,
    equations: [
    ],
  },
  {
    id: "quoted-curly-decimal-mark-instruction-negative",
    question: "The note says ‘The height is 5.5’, then graph y=x^2 and y=2*x; do not draw it.’ Explain the note.",
    mustDrawExplicitCurves: false,
    discreteDomain: false,
    equations: [
    ],
  },
];
// Structural lexical ownership regressions, frozen and run RED before the
// reader repair. Original98 fixture oracles remain unchanged.
const lexicalOwnershipFixtures: Fixture[] = [];
const rootCurve = sourceEquation("y=sqrt(x)", [[0, 0], [1, 1], [4, 2]]);
const logCurve = sourceEquation("y=log(x)", [[1, 0], [2, Math.log(2)], [4, Math.log(4)]]);
const squareCurve = sourceEquation("y=x^2", [[0, 0], [1, 1], [2, 4]]);
const fallingCurve = sourceEquation("y=1-x", [[0, 1], [1, 0], [2, -1]]);
for (const [first, second] of [[rootCurve, squareCurve], [logCurve, fallingCurve]]) {
  for (const tail of ["on the same axes", "in one graph", "to compare the curves", "then discuss the result", "using one set of axes", "with both curves labelled", "near the origin", "between the stated bounds", "ka graph banao", "regarding their shapes"]) lexicalOwnershipFixtures.push({
    id: `lexical-pair-${first!.sourceText}-${tail}`, question: `Draw ${first!.sourceText} and ${second!.sourceText} ${tail}.`,
    mustDrawExplicitCurves: true, discreteDomain: false, equations: [first!, second!],
  });
}
for (const curve of [rootCurve, logCurve]) for (const question of [
  `Draw the graph of ${curve.sourceText}.`, `Given ${curve.sourceText}, sketch its graph.`,
  `If ${curve.sourceText}, draw the graph.`, `Plot $ ${curve.sourceText} $.`,
  String.raw`Plot \( ${curve.sourceText} \).`, `${curve.sourceText} ka graph banao.`,
  `Considering ${curve.sourceText}, draw its graph.`, `Draw (${curve.sourceText}).`,
]) lexicalOwnershipFixtures.push({ id: `lexical-single-${question}`, question, mustDrawExplicitCurves: true, discreteDomain: false, equations: [curve] });
for (const question of [
  "Draw y=sqrt(x) and x+y=4.", "Draw y=log(x) and x=2.", "Draw y=sqrt(x) and 2y=x.",
  "Draw y=sqrt(x) and y=4z.", "Draw y=sqrt(x) and y=3 z.", "Draw y=sqrt(x) and y=3 θ.",
  "Draw y=sqrt(x) and y=x alpha.", "Draw y=log(x) and y=sqrt(.", "Draw y=sqrt(x) and y=unknown(x).",
  "Draw y=sqrt(x), y=x, y=2*x, y=3*x and y=4*x.",
  "Draw x+(y=4) and y=sqrt(x).", "Draw x y=4 and y=sqrt(x).", "Draw φ y=4 and y=sqrt(x).",
  "Draw theta y=4 and y=sqrt(x).", "Draw (x)y=4 and y=sqrt(x).", "Draw *y=4 and y=sqrt(x).",
  "Draw 2y=4 and y=sqrt(x).", "Draw y=sqrt(x) and 4=x+y.", "Draw x=0 and y=sqrt(x).",
  "Draw y=sqrt(x) and y=x unknown(x).",
]) lexicalOwnershipFixtures.push({ id: `lexical-atomic-${question}`, question, mustDrawExplicitCurves: false, mustDeclineSourceCurves: true, discreteDomain: false, equations: [] });
for (const question of [
  "The note prints 'x+y=4'. Draw y=sqrt(x).", "The note prints \"x=0\". Draw y=log(x).",
]) lexicalOwnershipFixtures.push({ id: `lexical-quoted-${question}`, question, mustDrawExplicitCurves: true, discreteDomain: false, equations: [question.includes("sqrt") ? rootCurve : logCurve] });

lexicalOwnershipFixtures.push(
  { id: "lexical-auxiliary-quoted-evaluation", question: "The note prints 'y=99' (at x=1/2). Draw y=sqrt(x).", mustDrawExplicitCurves: true, discreteDomain: false, equations: [rootCurve] },
  { id: "lexical-auxiliary-parenthetical-evaluation", question: "(at x=0). Draw y=log(x).", mustDrawExplicitCurves: true, discreteDomain: false, equations: [logCurve] },
  { id: "lexical-auxiliary-function-definition", question: "Given f(x)=sqrt(x). Draw y=sqrt(x).", mustDrawExplicitCurves: true, discreteDomain: false, equations: [rootCurve] },
  { id: "lexical-auxiliary-wrapped-function-definition", question: "Given $f(x)=sqrt(x)$. Draw y=sqrt(x).", mustDrawExplicitCurves: true, discreteDomain: false, equations: [rootCurve] },
  { id: "lexical-known-constants", question: "Draw y=sin(x)+pi and y=e*x on the same axes.", mustDrawExplicitCurves: true, discreteDomain: false, equations: [
    sourceEquation("y=sin(x)+pi", [[0, Math.PI], [1, Math.sin(1) + Math.PI], [2, Math.sin(2) + Math.PI]]),
    sourceEquation("y=e*x", [[-1, -Math.E], [0, 0], [1, Math.E]]),
  ] },
);
for (const question of ["Draw x+(at x=0) and y=sqrt(x).", "(at x=4z). Draw y=sqrt(x).", "(x=0). Draw y=sqrt(x).",
  "The note prints 'y=99'. Draw x=0 and y=sqrt(x).", "Draw (y=sqrt(x)."])
  lexicalOwnershipFixtures.push({ id: `lexical-auxiliary-refusal-${question}`, question, mustDrawExplicitCurves: false, mustDeclineSourceCurves: true, discreteDomain: false, equations: [] });

for (const question of ["Draw foo(y=4) and y=sqrt(x).", "Draw (y=sqrt(x)) unknown(x).", "Draw (y=sqrt(x)) unknown (x).", "Draw y=sqrt(x) unknown (x).", "Plot $y=log(x)$unknown(x).", "Plot $y=log(x)$onpaper."])
  lexicalOwnershipFixtures.push({ id: `lexical-wrapper-refusal-${question}`, question, mustDrawExplicitCurves: false, mustDeclineSourceCurves: true, discreteDomain: false, equations: [] });
for (const [question, curve] of [["Draw ((y=sqrt(x))) on graph paper.", rootCurve], ["Plot $y=log(x)$ on graph paper.", logCurve]] as const)
  lexicalOwnershipFixtures.push({ id: `lexical-wrapper-retention-${question}`, question, mustDrawExplicitCurves: true, discreteDomain: false, equations: [curve] });

lexicalOwnershipFixtures.push(
  { id: "lexical-named-function-unmatched-f", question: "Draw f(x)=sqrt(x) and y=x^2 on the same axes.", mustDrawExplicitCurves: false, mustDeclineSourceCurves: true, discreteDomain: false, equations: [] },
  { id: "lexical-named-function-unmatched-y", question: "Draw y(x)=x^2 and y=2*x on the same axes.", mustDrawExplicitCurves: false, mustDeclineSourceCurves: true, discreteDomain: false, equations: [] },
  { id: "lexical-named-function-owned-alias", question: "Draw f(x)=sqrt(x) and y=sqrt(x) on the same axes.", mustDrawExplicitCurves: true, discreteDomain: false, equations: [rootCurve] },
  { id: "lexical-named-function-owned-y-alias", question: "Draw y(x)=x^2, y=x^2 and y=2*x on the same axes.", mustDrawExplicitCurves: true, discreteDomain: false, equations: [squareCurve, sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2]])] },
  { id: "lexical-named-function-normalized-alias", question: "Draw f(x)=2x and y=2*x on the same axes.", mustDrawExplicitCurves: true, discreteDomain: false, equations: [sourceEquation("y=2*x", [[-1, -2], [0, 0], [1, 2]])] },
  { id: "lexical-family-inventory-overflow", question: "Plot y=x, y=x^2, y=x^3, y=sqrt(x), and y=log(x) on one set of axes.", mustDrawExplicitCurves: false, mustDeclineSourceCurves: true, discreteDomain: false, equations: [] },
  { id: "lexical-family-wrapped-inventory", question: "Plot (y = log(x)) together with (y = x^2) on the same axes.", mustDrawExplicitCurves: true, discreteDomain: false, equations: [logCurve, squareCurve] },
  { id: "lexical-native-implicit-single", question: "Plot (y = x^2) on the same axes.", mustDrawExplicitCurves: true, mustRetainNative: true, discreteDomain: false, equations: [squareCurve] },
  { id: "lexical-separated-equation-wrapper", question: "For comparison display (y = log(x)) beside (y = sin(x)) on shared axes.", mustDrawExplicitCurves: true, discreteDomain: false, equations: [logCurve, sourceEquation("y=sin(x)", [[0, 0], [1, Math.sin(1)], [2, Math.sin(2)]])] },
  { id: "lexical-attached-evaluation", question: "Compare y=sqrt(x) (at x=2) with y=log(x) using a common frame.", mustDrawExplicitCurves: true, discreteDomain: false, equations: [rootCurve, logCurve] },
  { id: "lexical-wrapped-attached-evaluation", question: "Compare (y=sqrt(x)) (at x=2) with (y=log(x)) using a common frame.", mustDrawExplicitCurves: true, discreteDomain: false, equations: [rootCurve, logCurve] },
  { id: "lexical-zero-curve-native", question: "In a joint graph show y(x)=x^2 together with y=sin(x).", mustDrawExplicitCurves: false, mustDeclineSourceCurves: true, discreteDomain: false, equations: [] },
);
for (const slot of ["(at x=2z)", "(at x=1/0)", "(x=2)", "+(at x=2)"])
  lexicalOwnershipFixtures.push({ id: `lexical-attached-evaluation-refusal-${slot}`, question: `Compare y=sqrt(x) ${slot} with y=log(x) using a common frame.`, mustDrawExplicitCurves: false, mustDeclineSourceCurves: true, discreteDomain: false, equations: [] });

// Whole unary-body oracles: whitespace is required, and continuation is
// intentionally limited to an additive term or the end of the expression.
const bareUnaryOracles = [
  { name: "sin", evaluate: Math.sin, xs: [-0.5, 0, 0.5] },
  { name: "cos", evaluate: Math.cos, xs: [-0.5, 0, 0.5] },
  { name: "tan", evaluate: Math.tan, xs: [-0.5, 0, 0.5] },
  { name: "asin", evaluate: Math.asin, xs: [-0.5, 0, 0.5] },
  { name: "acos", evaluate: Math.acos, xs: [-0.5, 0, 0.5] },
  { name: "atan", evaluate: Math.atan, xs: [-0.5, 0, 0.5] },
  { name: "sqrt", evaluate: Math.sqrt, xs: [0, 1, 4] },
  { name: "abs", evaluate: Math.abs, xs: [-1, 0, 1] },
  { name: "exp", evaluate: Math.exp, xs: [-1, 0, 1] },
  { name: "log", evaluate: Math.log, xs: [1, 2, 4] },
  { name: "ln", evaluate: Math.log, xs: [1, 2, 4] },
];
for (const { name, evaluate, xs } of bareUnaryOracles) lexicalOwnershipFixtures.push({
  id: `bare-unary-${name}`, question: `Plot y=${name} x.`, mustDrawExplicitCurves: true, discreteDomain: false,
  mustRetainNative: name === "sin" || name === "cos", mustRetainFast: name === "sin" || name === "cos",
  exactCurveExpressions: [`${name}(x)`], equations: [sourceEquation(`y=${name}(x)`, xs.map(x => [x, evaluate(x)] as const))],
});
for (const [body, expected, evaluate] of [
  ["sin   x", "sin(x)", Math.sin], ["cos\tx", "cos(x)", Math.cos],
  ["sin x + 1", "sin(x)+1", (x: number) => Math.sin(x) + 1],
  ["cos x - 1", "cos(x)-1", (x: number) => Math.cos(x) - 1],
] as const) lexicalOwnershipFixtures.push({
  id: `bare-unary-spacing-additive-${body}`, question: `Plot y=${body}.`, mustDrawExplicitCurves: true, discreteDomain: false,
  exactCurveExpressions: [expected], equations: [sourceEquation(`y=${expected}`, [-0.5, 0, 0.5].map(x => [x, evaluate(x)] as const))],
});
for (const body of ["sinx", "cosx", "unknown x", "sin z", "cos t", "sin 2*x", "sin x^2", "sin x ^ 2", "cos x**2",
  "sin x/2", "sin x * 2", "sin x (x+1)", "cos x(x+1)", "sin x z", "cos x 2", "sin x alpha", "cos x pi",
  "sin x cos(x)", "sqrt x^2", "log x / 2", "atan x(x+1)", "asin x y", "pi x", "e x", "x x"])
  lexicalOwnershipFixtures.push({ id: `bare-unary-ambiguous-${body}`, question: `Plot y=${body}.`, mustDrawExplicitCurves: false,
    mustDeclineSourceCurves: true, discreteDomain: false, equations: [] });

const gateFixtures: readonly Fixture[] = [...fixtures, ...sourceCompletenessFixtures, ...retentionFixtures, ...primeAndPluralRetentionFixtures, ...quotedPrimeOwnershipFixtures, ...quotedCloseProseFixtures, ...quotedCloseSingleProseFixtures, ...quoteArgumentClassFixtures, ...ordinaryQuoteContextFixtures, ...ordinaryQuoteCombinedFixtures, ...numericMeasurementMarkFixtures, ...lexicalOwnershipFixtures];

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

function nativeDisplayLabelOwnsEquation(label: string, equation: SourceEquation, representation: SelectedRepresentation): boolean {
  if (representation.sceneDocument.source.functionDisplayTransform === undefined) return labelOwnsEquation(label, equation);
  // This native producer spells numeric multiplication without '*'. Compare
  // the entire normalized literal body; the source-equation oracle is unchanged.
  const canonical = (value: string) => normalizeEquation(value).replace(/(\d)(?=x\b)/g, "$1*");
  return canonical(label) === canonical(equation.sourceText);
}

function wholeEquationAgrees(equation: string, oracle: SourceEquation): boolean {
  const sides = normalizeEquation(equation).split("=");
  if (sides.length !== 2 || sides.some(side => !side)) return false;
  return oracle.samples.every(({ x, y }) => {
    try {
      const evaluate = (side: string) => parseMathExpression(side.replace(/(?<![A-Za-z_])y(?![A-Za-z0-9_])/g, `(${y})`)
        .replace(/(\d|\))(?=\()/g, "$1*").replace(/x(?=\()/g, "x*").replace(/\)(?=[\dx])/g, ")*")).evaluate(x);
      const left = evaluate(sides[0]!), right = evaluate(sides[1]!);
      return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right));
    } catch { return false; }
  });
}

function verifyNativeEquationOwnership(fixture: Fixture, representation: SelectedRepresentation): void {
  const compiled = compileSceneDocument(representation.sceneDocument);
  assert(compiled.ok && compiled.renderScene, "native source alternative must compile");
  const systems = representation.sceneDocument.constructions.filter(({ operator }) => ["linear_system"].includes(operator));
  assert.equal(systems.length, 1, "native alternative must own the full simultaneous system");
  const equations = systems[0]!.inputs.equations;
  assert(Array.isArray(equations) && equations.length === fixture.equations.length);
  const owners = new Set<number>();
  for (const equation of equations) {
    assert(typeof equation === "string");
    const owner = fixture.equations.findIndex(oracle => wholeEquationAgrees(equation, oracle));
    assert(owner >= 0 && !owners.has(owner), "native inputs retain every whole source equation exactly once");
    owners.add(owner);
  }
  const labelEquations = compiled.renderScene.primitives.flatMap(primitive => primitive.kind === "label" && typeof primitive.text === "string" ? primitive.text.split(/[;\n]/) : []);
  for (const equation of fixture.equations) assert(labelEquations.some(label => wholeEquationAgrees(label, equation)), "native rendered labels retain every complete source equation");
}

function verifyOwnership(fixture: Fixture, representation: SelectedRepresentation): void {
  assert.equal(representation.sceneDocument.source.question, fixture.question, "preserve the original question");
  if (fixture.discreteDomain) {
    assert.notEqual(representation.figureSource, "linear_source", "a discrete domain cannot become a continuous native solution");
    assert(!representation.sceneDocument.constructions.some(({ operator }) =>
      ["linear_system", "linear_feasible_region", "linear_half_plane"].includes(operator)),
    "source copying cannot upgrade a discrete-domain request to a continuous solution system");
  }
  const curves = representation.sceneDocument.constructions.filter(({ operator }) => ["function_curve", "implicit_curve"].includes(operator));
  const bareAxes = representation.sceneDocument.constructions.length > 0 && representation.sceneDocument.constructions.every(({ operator }) => operator === "axes");
  if (fixture.mustDeclineSourceCurves) assert(!bareAxes, "bare Cartesian axes cannot stand in for an unowned source program");
  if (fixture.mustDrawExplicitCurves && lexicalOwnershipFixtures.includes(fixture)) assert(curves.length > 0 || String(representation.figureSource) === "linear_source", "genuine explicit equations must retain a complete source figure");
  if (String(representation.figureSource) === "linear_source") {
    verifyNativeEquationOwnership(fixture, representation);
    return;
  }
  if (representation.figureSource !== "source_grounded" && curves.length === 0) return;
  assert(!fixture.mustDeclineSourceCurves, "an unowned equation must decline the entire source-function fallback");
  if (representation.figureSource === "source_grounded") {
    assert.equal(representation.nonMetric, true);
    assert.equal(representation.tier, "question_representation");
  }
  assert.equal(representation.validationReport.valid, true);
  const compiled = compileSceneDocument(representation.sceneDocument);
  assert(compiled.ok && compiled.renderScene, "a returned source figure must pass the real compiler");
  if (fixture.mustDrawExplicitCurves) assert.equal(curves.length, fixture.equations.length, "retain genuine explicit source functions");
  if (fixture.exactCurveExpressions) assert.deepEqual(curves.map(curve => unscaledCurveInput(curve.inputs.expression, representation)), fixture.exactCurveExpressions, "every complete unary body must retain its exact canonical expression");
  const owners = new Set<number>();
  for (const curve of curves) {
    const expression = unscaledCurveInput(curve.inputs.expression, representation);
    assert.equal(typeof expression, "string", "every plotted function has an expression");
    assert(typeof expression === "string");
    const equationIndex = fixture.equations.findIndex((equation) => curve.operator === "function_curve" ? agreesWithSamples(expression, equation) : equation.samples.every(({ x, y }) => {
      try { return Math.abs(parseMathExpression2D(expression).evaluate(x, y)) < 1e-9; }
      catch { return false; }
    }));
    assert(equationIndex >= 0,
      `${fixture.id}: plotted ${expression} is not any whole source equation (${fixture.equations.map(({ sourceText }) => sourceText).join("; ")})`);
    assert(!owners.has(equationIndex), "distinct source equations must not collapse into duplicated curve ownership");
    owners.add(equationIndex);
    const equation = fixture.equations[equationIndex]!;
    for (const entityId of curve.outputs) {
      const entity = representation.sceneDocument.entities.find(({ id }) => id === entityId);
      assert(entity && typeof entity.label === "string", "every copied equation has an attached label");
      assert(nativeDisplayLabelOwnsEquation(entity.label, equation, representation), `${entity.label} does not label its own source equation ${equation.sourceText}`);
      const labels = compiled.renderScene.primitives.filter((primitive) => primitive.entityId === entityId && primitive.kind === "label");
      assert(labels.length > 0, "the source-equation label must actually render on its curve");
      assert(labels.every(({ text }) => typeof text === "string" && nativeDisplayLabelOwnsEquation(text, equation, representation)), "rendered labels must keep whole-equation ownership");
    }
  }
  if (fixture.mustDrawExplicitCurves) assert.equal(owners.size, fixture.equations.length);
  if (representation.figureSource === "source_grounded") assert(!representation.sceneDocument.constructions.some(({ operator }) =>
    operator === "function_region" || operator === "intersection"),
  "a source-only sketch must not acquire a solved region or intersection");
}

// The existing equation oracles stay unscaled. A declared native display
// coordinate map is checked independently as an exact common literal wrapper.
function unscaledCurveInput(value: unknown, representation: SelectedRepresentation): unknown {
  const transform = representation.sceneDocument.source.functionDisplayTransform;
  if (transform === undefined) return value;
  assert(transform !== null && typeof transform === "object" && "yScale" in transform && "xScale" in transform && "schemaVersion" in transform);
  assert.deepEqual(Reflect.ownKeys(transform).sort(), ["schemaVersion", "xScale", "yScale"]);
  assert.equal(transform.schemaVersion, "function-display/v1"); assert.equal(transform.xScale, 1);
  assert(typeof transform.yScale === "number" && Number.isFinite(transform.yScale) && transform.yScale > 0);
  assert.equal(representation.tier, "qualitative_verified"); assert.equal(representation.nonMetric, true);
  assert(typeof value === "string" && value.startsWith(`(${transform.yScale})*(`) && value.endsWith(")"));
  return value.slice(`(${transform.yScale})*(`.length, -1);
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
    if (fixture.mustDrawExplicitCurves) assert(["source_grounded", "linear_source"].includes(representation.figureSource));
    verifyOwnership(fixture, representation);
  });
  check(`${fixture.id}: verified selection`, () => {
    const representation = selectVerifiedRepresentation({ question: fixture.question, turnPlan: plan });
    verifyOwnership(fixture, representation);
    if (fixture.mustRetainNative) assert.notEqual(representation.figureSource, "source_grounded", "a wholly proved native curve must retain its native route");
    assert.deepEqual(plan, originalPlan, "fallback selection must not rewrite its input plan");
  });
  if (lexicalOwnershipFixtures.includes(fixture)) check(`${fixture.id}: inferred-family selection`, () => {
    const representation = selectVerifiedRepresentation({ question: fixture.question, turnPlan: plan, families: inferSceneCapabilities(fixture.question).families });
    verifyOwnership(fixture, representation);
    if (fixture.mustRetainNative) assert.notEqual(representation.figureSource, "source_grounded");
    assert.deepEqual(plan, originalPlan);
  });
  if (lexicalOwnershipFixtures.includes(fixture)) check(`${fixture.id}: fast-family selection`, () => {
    const representation = selectFastVerifiedRepresentation({ question: fixture.question, turnPlan: plan, families: inferSceneCapabilities(fixture.question).families });
    if (fixture.mustRetainFast) assert(representation, "a whole native unary body must retain fast-family availability");
    if (representation) verifyOwnership(fixture, representation);
    assert.deepEqual(plan, originalPlan);
  });
}

// An uncertain fallback reader cannot displace a valid planner candidate.
// The planner is allowed five curves; the source-copy reader's four-curve
// bound must affect only fallback admission, including the early preference.
for (const preferPlanner of [false, true]) check(`planner priority with incomplete fallback (${preferPlanner})`, () => {
  const question = "Plot y=x, y=x^2, y=x^3, y=sqrt(x), and y=log(x) on one set of axes.";
  const scene = structuredClone(buildSourceGroundedRepresentation("Plot y=x, y=x^2, y=sqrt(x), and y=log(x) on one set of axes.").sceneDocument);
  scene.source.question = question;
  const entity = structuredClone(scene.entities.find(({ id }) => id === "source_function_1")!);
  entity.id = "planner_cube"; entity.label = "y=x^3"; entity.semantic = { expression: "x^3", sourceText: "y=x^3" };
  scene.entities.push(entity);
  const construction = structuredClone(scene.constructions.find(({ operator }) => operator === "function_curve")!);
  construction.id = "construct_planner_cube"; construction.inputs.expression = "x^3"; construction.outputs = [entity.id];
  scene.constructions.push(construction);
  Object.assign(scene.constructions.find(({ operator }) => operator === "axes")!.inputs, { xMin: 0.25, xMax: 1.5, yMin: -1.5, yMax: 4.5 });
  for (const curve of scene.constructions.filter(({ operator }) => operator === "function_curve")) Object.assign(curve.inputs, { xMin: 0.25, xMax: 1.5 });
  scene.requiredEntityIds.push(entity.id);
  scene.assertions.push({ id: "assert_planner_cube", predicate: "exists", entities: [entity.id], expected: true, severity: "fatal" });
  scene.revealGroups[0]!.entityIds.push(entity.id);
  const normalized = validateSceneDocument(scene).document;
  assert(normalized, "independent planner fixture must normalize through the native validator");
  const compiled = compileSceneDocument(normalized);
  assert(compiled.ok && compiled.renderScene, `independent complete five-curve planner fixture must compile: ${JSON.stringify(compiled.report.issues)}`);
  const exact = { sceneDocument: normalized, renderScene: compiled.renderScene, validationReport: compiled.report };
  const before = structuredClone(exact);
  const decision = selectVerifiedRepresentationExplained({ question, exact, preferPlanner });
  assert.equal(decision.selected.figureSource, "planner", `an incomplete family must never suppress an admitted planner candidate: ${JSON.stringify(decision.exactDecline)}`);
  assert.deepEqual(exact, before, "native fallback preparation must not mutate the planner input");
});

// These six whole-body examples retain MAIN's existing native producer
// contract; their legacy display inputs are frozen numeric oracles, rather
// than new evidence for derivative/answer authority or display scaling.
const namedNativeRetention = [
  { question: "Find the local maximum and local minimum values of f(x) = x^3 - 3x.", body: "x^3-3*x", native: "(0.11666666666666664)*(x^3-3*x)" },
  { question: "Show that f(x) = x^3 is increasing on the whole real line, even though f'(0) = 0.", body: "x^3", native: "(0.07777777777777777)*(x^3)" },
  { question: "Let f from the real numbers to the real numbers be f(x) = x^2. Is f one-one? Is f onto? Which numbers, if any, map to 4?", body: "x^2", native: "x^2." },
  { question: "Determine whether f(x) = x^3 - 3x is increasing or decreasing on the open interval (1, 2).", body: "x^3-3*x", native: "(0.11666666666666664)*(x^3-3*x)" },
  { question: "Show that f(x) = |x| is not differentiable at x = 0, and give the left-hand and right-hand derivatives there.", body: "abs(x)", native: "abs(x)" },
  { question: "Find the largest closed interval containing 0 on which f(x) = x^3 - 3x is decreasing.", body: "x^3-3*x", native: "(0.11666666666666664)*(x^3-3*x)" },
];
for (const fixture of namedNativeRetention) check(`named-only native retention: ${fixture.question}`, () => {
  const selected = selectVerifiedRepresentation({ question: fixture.question, families: ["analytic_curve"] });
  assert.notEqual(selected.figureSource, "source_grounded");
  const curves = selected.sceneDocument.constructions.filter(({ operator }) => operator === "function_curve");
  assert.equal(curves.length, 1, "retain the complete native function body");
  assert(typeof curves[0]!.inputs.expression === "string");
  assert.equal(normalizeEquation(curves[0]!.inputs.expression), normalizeEquation(fixture.native), "existing native display input must retain its entire literal body");
  const literalBody = (text: string) => normalizeEquation(text).replace(/^y=/, "").replace(/(\d)(?=x\b)/g, "$1*").replace(/(\d)\.$/, "$1");
  for (const id of curves[0]!.outputs) {
    const labels = selected.renderScene.primitives.filter(p => p.entityId === id && p.kind === "label");
    assert(labels.length > 0 && labels.every(p => typeof p.text === "string" && /^\s*y\s*=/.test(p.text) && literalBody(p.text) === literalBody(fixture.body)), "native labels retain the complete literal function body");
  }
});
for (const note of ["", ' The note "y=7" is quoted.', ' The note "f(x)=7" is quoted.']) check(`independently bound conic with quoted note: ${note}`, () => {
  const question = `Sketch the parabola x^2=4*y on Cartesian axes.${note}`;
  const selected = selectVerifiedRepresentation({ question, families: ["analytic_curve"] });
  if (note.includes('"y=7"') && selected.figureSource === "text_only") {
    assert.equal(selected.sceneDocument.constructions.length, 0, "a contaminated native program must decline whole");
    return;
  }
  const curves = selected.sceneDocument.constructions.filter(({ operator }) => operator === "implicit_curve");
  assert.equal(curves.length, 1);
  assert.equal(selected.sceneDocument.constructions.length, 2, "only the real conic and its axes may remain; a quoted segment is unowned");
  assert(!selected.sceneDocument.constructions.some(({ operator }) => ["segment", "line", "ray"].includes(operator)), "a quoted line may not hide behind a generic label");
  assert(typeof curves[0]!.inputs.expression === "string");
  for (const x of [-2, 0, 2]) assert(Math.abs(parseMathExpression2D(curves[0]!.inputs.expression).evaluate(x, x * x / 4)) < 1e-9);
  assert(!selected.renderScene.primitives.some(p => p.kind === "label" && typeof p.text === "string" && /(?:y|f\(x\))\s*=\s*7/.test(p.text)), "a quoted function is not an extra curve or label");
});
check("quoted function cannot borrow plan or IR authority", () => {
  const question = 'The note says "graph y=x^2 on coordinate axes". Explain the note.';
  const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, givens: [{ id: "quote_coefficient", symbol: "a", value: 2, sourceText: "y=x^2", provenance: "given" }], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" };
  const selected = selectVerifiedRepresentation({ question, turnPlan: plan, families: ["analytic_curve"], problemIR: { entities: [{ kind: "function", label: "y=x^2" }], representationIntents: [{ kind: "analytic_curve" }], facts: [{ kind: "equation", statement: "y=x^2" }] } });
  assert.equal(selected.sceneDocument.constructions.length, 0, "masked-stem proof must not inherit function hints from the original plan/IR/families");
});

type NativeDisplayCandidate = NonNullable<ReturnType<typeof synthesizeFamilyScene>>;
const inverseSourceQuestion = "Let f(x) = x^3, with domain the real numbers. Find f inverse of 8, and say whether reflecting the graph of f in the line y = x gives the graph of the inverse.";
function nativeDisplayCandidate(question = inverseSourceQuestion): NativeDisplayCandidate {
  const candidate = synthesizeFamilyScene({ question, families: ["analytic_curve"], turnPlan: null, problemIR: null });
  assert(candidate, "the actual source-bound native producer must build the display fixture");
  assert.equal(candidate.tier, "qualitative_verified"); assert.equal(candidate.nonMetric, true);
  const transform = candidate.document.source.functionDisplayTransform;
  assert(transform && typeof transform === "object" && "yScale" in transform && typeof transform.yScale === "number" && transform.yScale > 0);
  return candidate;
}
function nativeDisplayScale(candidate: NativeDisplayCandidate): number {
  const transform = candidate.document.source.functionDisplayTransform;
  assert(transform && typeof transform === "object" && "yScale" in transform && typeof transform.yScale === "number");
  return transform.yScale;
}
function recompiledNativeVariant(candidate: NativeDisplayCandidate, mutate: (copy: NativeDisplayCandidate) => void): NativeDisplayCandidate {
  const copy = structuredClone(candidate);
  mutate(copy);
  // Prove the altered display geometry honestly before asking whether its
  // whole bodies still belong to this source. Existence is not source proof.
  for (const assertion of copy.document.assertions) if (assertion.predicate === "function_value") {
    const construction = copy.document.constructions.find(c => c.outputs.includes(assertion.entities[0] ?? ""));
    const expected = assertion.expected;
    assert(construction && typeof construction.inputs.expression === "string" && expected && typeof expected === "object" && "x" in expected && typeof expected.x === "number");
    assertion.expected = { ...expected, y: parseMathExpression(construction.inputs.expression).evaluate(expected.x) };
  }
  const compiled = compileSceneDocument(copy.document);
  assert(compiled.ok && compiled.renderScene, "the negative control must have real, valid display geometry");
  return { ...copy, renderScene: compiled.renderScene, validationReport: compiled.report };
}
check("native display: whole mixed named+y source inventory", () => {
  const original = nativeDisplayCandidate(), before = structuredClone(original);
  const admitted = prepareFallbackFunctionInventory(inverseSourceQuestion, original);
  assert(admitted, "a complete declared native source display must remain available");
  const k = nativeDisplayScale(admitted);
  assert.deepEqual(admitted.document.constructions.filter(c => c.operator === "function_curve").map(c => c.inputs.expression).sort(), [`(${k})*(x)`, `(${k})*(x^3)`].sort());
  assert.deepEqual(admitted.renderScene.primitives.filter(p => p.kind === "label").map(p => p.text).sort(), ["y=x", "y=x^3"]);
  assert.deepEqual(original, before, "native admission must leave the producer candidate unchanged");
});
for (const route of ["normal", "inferred", "fast"] as const) check(`native display inverse-source retention: ${route}`, () => {
  const question = inverseSourceQuestion;
  const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" };
  const input = { question, turnPlan: plan, families: route === "normal" ? undefined : inferSceneCapabilities(question).families };
  const selected = route === "fast" ? selectFastVerifiedRepresentation(input) : selectVerifiedRepresentation(input);
  assert(selected && !["source_grounded", "text_only"].includes(selected.figureSource), "the complete native program must survive its real production route");
  assert.equal(selected.nonMetric, true); assert.equal(selected.tier, "qualitative_verified");
  assert.deepEqual(selected.sceneDocument.constructions.filter(c => c.operator === "function_curve").map(c => unscaledCurveInput(c.inputs.expression, selected)).sort(), ["x", "x^3"]);
});
const displayMetadataMutations: ReadonlyArray<readonly [string, unknown]> = [
  ["zero factor", { schemaVersion: "function-display/v1", xScale: 1, yScale: 0 }],
  ["negative factor", { schemaVersion: "function-display/v1", xScale: 1, yScale: -1 }],
  ["infinite factor", { schemaVersion: "function-display/v1", xScale: 1, yScale: Infinity }],
  ["NaN factor", { schemaVersion: "function-display/v1", xScale: 1, yScale: NaN }],
  ["string factor", { schemaVersion: "function-display/v1", xScale: 1, yScale: "0.5" }],
  ["x scaling", { schemaVersion: "function-display/v1", xScale: 2, yScale: 0.5 }],
  ["wrong schema", { schemaVersion: "function-display/v2", xScale: 1, yScale: 0.5 }],
  ["extra offset", { schemaVersion: "function-display/v1", xScale: 1, yScale: 0.5, yOffset: 1 }],
  ["per-curve field", { schemaVersion: "function-display/v1", xScale: 1, yScale: 0.5, curveFactors: [0.5, 1] }],
];
for (const [name, declaration] of displayMetadataMutations) check(`native display rejects ${name}`, () => {
  const copy = structuredClone(nativeDisplayCandidate()); copy.document.source.functionDisplayTransform = declaration;
  assert.equal(prepareFallbackFunctionInventory(inverseSourceQuestion, copy), null);
});
for (const question of [inverseSourceQuestion, namedNativeRetention[0]!.question]) {
  for (const mutation of ["different factor", "negative input factor", "per-curve factor", "offset", "wrong body", "wrong label", "metric authority"] as const) check(`native display source/label mutation ${mutation}: ${question}`, () => {
    const original = nativeDisplayCandidate(question), k = nativeDisplayScale(original);
    const copy = recompiledNativeVariant(original, candidate => {
      const curves = candidate.document.constructions.filter(c => c.operator === "function_curve");
      const curve = mutation === "per-curve factor" ? curves.at(-1)! : curves[0]!;
      const expression = curve.inputs.expression;
      assert(typeof expression === "string");
      if (mutation === "different factor" || mutation === "per-curve factor") curve.inputs.expression = expression.replace(`(${k})*(`, `(${k * 2})*(`);
      if (mutation === "negative input factor") curve.inputs.expression = expression.replace(`(${k})*(`, `(${-k})*(`);
      if (mutation === "offset") curve.inputs.expression = expression + "+1";
      if (mutation === "wrong body") curve.inputs.expression = `(${k})*(x^2)`;
      if (mutation === "wrong label") candidate.document.entities.find(e => e.id === curve.outputs[0])!.label = "y=x^2";
      if (mutation === "metric authority") { candidate.tier = "exact_verified"; candidate.nonMetric = false; candidate.document.source.nonMetric = false; candidate.document.source.representationTier = "exact_verified"; }
    });
    assert.equal(prepareFallbackFunctionInventory(question, copy), null, "a valid display proof cannot substitute for whole source-body and label ownership");
  });
}
for (const mutation of ["extra entity", "annotation", "render mark", "forged leader"] as const) check(`native display rejects ${mutation}`, () => {
  const candidate = structuredClone(nativeDisplayCandidate());
  if (mutation === "extra entity") candidate.document.entities.push({ id: "unowned", kind: "point", role: "extra point" });
  if (mutation === "annotation") candidate.document.annotations.push({ id: "unowned", kind: "label", targetIds: [candidate.document.entities[0]!.id], text: "unowned" });
  if (mutation === "render mark") candidate.renderScene.primitives.push({ id: "unowned", entityId: candidate.document.entities[0]!.id, groupId: candidate.renderScene.revealGroups[0]!.id, kind: "point", points: [{ x: 600, y: 300 }] });
  if (mutation === "forged leader") {
    const label = candidate.renderScene.primitives.find(p => p.kind === "label")!;
    label.provenance = { ...label.provenance, usesLeader: true };
    candidate.renderScene.primitives.push({ id: `${label.id}_leader`, entityId: label.entityId, groupId: label.groupId, kind: "line", points: [{ x: 600, y: 300 }, { x: 900, y: 600 }], provenance: { labelLeader: true } });
  }
  assert.equal(prepareFallbackFunctionInventory(inverseSourceQuestion, candidate), null);
});
check("native display rejects genuinely compacted long labels", () => {
  const question = "Plot y=x^3+2*x^2+3*x+4+5*x^4.";
  const candidate = nativeDisplayCandidate(question);
  assert(candidate.document.entities.some(entity => entity.label === "y=x^3+2x^2+3x+4+"), "the actual producer must genuinely compact this label");
  assert.equal(prepareFallbackFunctionInventory(question, candidate), null, "a compact label cannot own a longer whole expression by prefix");
});

// Independent named declarations own curves even when this producer does not
// recognize their names. Its labels cannot manufacture a complete inventory.
const namedInventoryFixtures: readonly { question: string; bodies: readonly string[]; mustRetain?: boolean; mustDecline?: boolean }[] = [
  { question: "Draw f(x)=x^3 and h(x)=x^2 on shared axes.", bodies: ["x^3", "x^2"] },
  { question: "Draw f(x)=x^3 and g(x)=x^2 on shared axes.", bodies: ["x^3", "x^2"], mustRetain: true },
  { question: "Compare f(x)=x and h(x)=x^2 on shared axes.", bodies: ["x", "x^2"] },
  { question: "Display f(x)=sin(x) and h(x)=cos(x) together.", bodies: ["sin(x)", "cos(x)"] },
  { question: "Draw f(x)=x^3, g(x)=x^2 and h(x)=x on shared axes.", bodies: ["x^3", "x^2", "x"] },
  { question: "Draw f(x)=x^3, h(x)=x^2 and curve_2(x)=x on shared axes.", bodies: ["x^3", "x^2", "x"] },
  { question: "Compare f(x)=x^3 and arbitraryName(x)=x^2.", bodies: ["x^3", "x^2"] },
  { question: "Compare f(x)=x^3 and φ(x)=x^2.", bodies: ["x^3", "x^2"] },
  { question: "Draw f(x)=x^3 and h(x)=x^3 on shared axes.", bodies: ["x^3"], mustRetain: true },
  { question: "Draw f(x)=x^2 on shared axes.", bodies: ["x^2"], mustRetain: true },
  { question: "Draw f(x)=x^3 and evaluate f(2)=8.", bodies: ["x^3"], mustRetain: true },
  { question: "Draw f(x)=x^3; its derivative at the origin satisfies f'(0)=0.", bodies: ["x^3"], mustRetain: true },
  { question: "Draw f(x)=x^3; its derivative at the origin satisfies f′(0)=0.", bodies: ["x^3"], mustRetain: true },
  { question: "Draw f(x)=x^3 and h(2)=4.", bodies: [], mustDecline: true },
  { question: "Draw f(x)=x^3 and f'(x)=3*x^2 on shared axes.", bodies: [], mustDecline: true },
  { question: "Draw f(x)=x^3 and x=1 on shared axes.", bodies: [], mustDecline: true },
  { question: "Draw f(x)=x^3 and x+y=2 on shared axes.", bodies: [], mustDecline: true },
  { question: "Draw f(x)=x^3 and x+(h(x)=x^2) on shared axes.", bodies: [], mustDecline: true },
  { question: "Draw f(x)=x^3 and h(x)=x^2 unknown(x) on shared axes.", bodies: [], mustDecline: true },
];
for (const fixture of namedInventoryFixtures) for (const route of ["normal", "inferred", "fast"] as const) check(`complete named source inventory ${route}: ${fixture.question}`, () => {
  const turnPlan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question: fixture.question, givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" };
  const input = { question: fixture.question, turnPlan, families: route === "normal" ? undefined : inferSceneCapabilities(fixture.question).families };
  const selected = route === "fast" ? selectFastVerifiedRepresentation(input) : selectVerifiedRepresentation(input);
  if (!selected || selected.figureSource === "text_only") {
    assert(!fixture.mustRetain, "a supported complete named function program must retain its native route");
    if (selected) assert.equal(selected.sceneDocument.constructions.length, 0);
    return;
  }
  assert(!fixture.mustDecline, "an unowned or non-function equality must decline the complete named program");
  const curves = selected.sceneDocument.constructions.filter(c => c.operator === "function_curve");
  assert.equal(selected.sceneDocument.constructions.length, curves.length + 1, "only owned whole curves and their axes are admitted");
  assert.equal(curves.length, fixture.bodies.length, "a producer cannot silently omit an arbitrary named declaration");
  const canonical = (value: string) => normalizeEquation(value).replace(/(\d)(?=x\b)/g, "$1*").replace(/(\d)\.$/, "$1");
  assert.deepEqual(curves.map(c => { const body = unscaledCurveInput(c.inputs.expression, selected); assert(typeof body === "string"); return canonical(body); }).sort(), fixture.bodies.map(canonical).sort());
  for (const curve of curves) for (const id of curve.outputs) {
    const labels = selected.renderScene.primitives.filter(p => p.entityId === id && p.kind === "label");
    assert(labels.length > 0 && labels.every(p => typeof p.text === "string" && /^y=/.test(canonical(p.text)) && fixture.bodies.map(canonical).includes(canonical(p.text).slice(2))), "every named source body keeps a complete unscaled owned label");
  }
});
console.log(`source-function equation ownership: ${checks - failed}/${checks} checks passed (${selectedFixtures.length} wordings)`);
if (failed > 0) process.exitCode = 1;
