// Pure deterministic math gate. Independently worked cases; no frozen eval imports.
import assert from "node:assert/strict";
import {
  solveLinearFigure,
  verifyLinearFigureSolution,
  parseLinearConstraint,
  parseLinearAffine,
  linearConstraintSignature,
  verifyLinearObjectiveBound,
  verifyLinearRecessionCertificate,
  verifyLinearFeasibilityCertificate,
  verifyLinearCorners,
  type HalfPlaneSolution,
  type LinearFigureInput,
  type FeasibleRegionSolution,
} from "../../src/math/linearRegion";
import {
  exactRationalText,
  exactRationalToNumber,
  parseRational,
  serializeRational,
  negateRational,
} from "../../src/math/exactRational";
const figure = solveLinearFigure({
  kind: "linear_half_plane",
  inequality: "2*x+3*y <= 7",
}) as HalfPlaneSolution;
assert.equal(figure.state, "proper_half_plane");
assert.deepEqual(figure.constraints[0]?.rhs, {
  numerator: "7",
  denominator: "1",
});
assert.equal(figure.constraints[0]?.strict, false);
assert.deepEqual(
  verifyLinearFigureSolution(
    { kind: "linear_half_plane", inequality: "2*x+3*y <= 7" },
    figure,
  ),
  [],
);
console.log("passed first exact half-plane seam");
const numberLine = solveLinearFigure({
  kind: "number_line_set",
  expression: { union: [{ inequality: "x<1" }, { inequality: "x>1" }] },
});
assert.equal(numberLine.kind, "number_line_set");
if (numberLine.kind === "number_line_set")
  assert.deepEqual(numberLine.intervals, [
    {
      lower: null,
      upper: { value: { numerator: "1", denominator: "1" }, included: false },
    },
    {
      lower: { value: { numerator: "1", denominator: "1" }, included: false },
      upper: null,
    },
  ]);
const polygon = solveLinearFigure({
  kind: "linear_feasible_region",
  constraints: ["x>=0", "y>=0", "2x+3y<=7", "x+2y<=4"],
  objective: { expression: "3x+5y", sense: "max" },
});
assert.equal(polygon.kind, "linear_feasible_region");
if (polygon.kind === "linear_feasible_region") {
  assert.equal(polygon.dimension, 2);
  assert.equal(polygon.bounded, true);
  assert.equal(polygon.closureVertices.length, 4);
  assert.equal(polygon.objective?.extremum.status, "attained");
  assert.deepEqual(polygon.objective?.range?.upper, {
    value: { numerator: "11", denominator: "1" },
    included: true,
  });
}
let checks = 12;
const exact = (text: string) => serializeRational(parseRational(text));
const point = (x: string, y: string) => ({ x: exact(x), y: exact(y) });
const cases: Array<{
  name: string;
  constraints: string[];
  cost: string;
  status: string;
  max?: string;
  dim: number | null;
  bounded: boolean | null;
  vertices: number;
}> = [
  {
    name: "strict best corner excluded",
    constraints: ["x>=0", "y>=0", "2x+3y<=7", "x+2y<4"],
    cost: "3x+5y",
    status: "finite_limit",
    max: "11",
    dim: 2,
    bounded: true,
    vertices: 4,
  },
  {
    name: "attained edge without included corners",
    constraints: ["x>0", "y>0", "x+y<=1"],
    cost: "x+y",
    status: "attained",
    max: "1",
    dim: 2,
    bounded: true,
    vertices: 3,
  },
  {
    name: "vertex-free strip finite maximum",
    constraints: ["x>=0", "x<=1"],
    cost: "x",
    status: "attained",
    max: "1",
    dim: 2,
    bounded: false,
    vertices: 0,
  },
  {
    name: "vertex-free strip unbounded objective",
    constraints: ["x>=0", "x<=1"],
    cost: "y",
    status: "unbounded",
    dim: 2,
    bounded: false,
    vertices: 0,
  },
  {
    name: "affine line constant objective",
    constraints: ["x=2"],
    cost: "x",
    status: "attained",
    max: "2",
    dim: 1,
    bounded: false,
    vertices: 0,
  },
  {
    name: "open segment",
    constraints: ["x=0", "y>0", "y<1"],
    cost: "y",
    status: "finite_limit",
    max: "1",
    dim: 1,
    bounded: true,
    vertices: 2,
  },
  {
    name: "singleton",
    constraints: ["x=2", "y=3"],
    cost: "5x-y",
    status: "attained",
    max: "7",
    dim: 0,
    bounded: true,
    vertices: 1,
  },
  {
    name: "ray finite maximum",
    constraints: ["x=0", "y>=2"],
    cost: "-y",
    status: "attained",
    max: "-2",
    dim: 1,
    bounded: false,
    vertices: 1,
  },
  {
    name: "ray unbounded maximum",
    constraints: ["x=0", "y>=2"],
    cost: "y",
    status: "unbounded",
    dim: 1,
    bounded: false,
    vertices: 1,
  },
  {
    name: "whole plane",
    constraints: [],
    cost: "2x-3y+1",
    status: "unbounded",
    dim: 2,
    bounded: false,
    vertices: 0,
  },
  {
    name: "whole plane zero cost",
    constraints: [],
    cost: "9",
    status: "attained",
    max: "9",
    dim: 2,
    bounded: false,
    vertices: 0,
  },
  {
    name: "strict empty with nonempty weak relaxation",
    constraints: ["x+y<1", "x+y>=1"],
    cost: "x",
    status: "infeasible",
    dim: null,
    bounded: null,
    vertices: 0,
  },
  {
    name: "weak inconsistent",
    constraints: ["x+y<=0", "x+y>=1"],
    cost: "x",
    status: "infeasible",
    dim: null,
    bounded: null,
    vertices: 0,
  },
  {
    name: "constant false",
    constraints: ["0<0"],
    cost: "x",
    status: "infeasible",
    dim: null,
    bounded: null,
    vertices: 0,
  },
  {
    name: "exact decimal",
    constraints: ["0.1x+0.2y<=0.3"],
    cost: "0.1x+0.2y",
    status: "attained",
    max: "3/10",
    dim: 2,
    bounded: false,
    vertices: 0,
  },
];
for (const c of cases) {
  const input: LinearFigureInput = {
    kind: "linear_feasible_region",
    constraints: c.constraints,
    objective: { expression: c.cost, sense: "max" },
  };
  const s = solveLinearFigure(input) as FeasibleRegionSolution;
  assert.equal(s.dimension, c.dim, c.name);
  assert.equal(s.bounded, c.bounded, c.name);
  assert.equal(s.closureVertices.length, c.vertices, c.name);
  assert.equal(s.objective?.extremum.status, c.status, c.name);
  if (c.max)
    assert.equal(
      exactRationalText(s.objective!.range!.upper!.value),
      c.max,
      c.name,
    );
  assert.deepEqual(verifyLinearFigureSolution(input, s), [], c.name);
  checks += 6;
  if (s.feasibility.feasible) {
    assert(verifyLinearFeasibilityCertificate(s.constraints, s.feasibility));
    checks++;
    assert.deepEqual(verifyLinearCorners(s.constraints, s.closureVertices), []);
    checks++;
    if (s.objective?.upperBound) {
      assert(
        verifyLinearObjectiveBound(
          s.constraints,
          s.objective.coefficients,
          s.objective.upperBound,
          "max",
        ),
      );
      checks++;
    }
    if (s.closureVertices.length) {
      const broken = structuredClone(s);
      broken.closureVertices[0]!.point = point("987", "654");
      assert(verifyLinearFigureSolution(input, broken).length > 0);
      checks++;
      const omitted = structuredClone(s);
      omitted.closureVertices.pop();
      assert(verifyLinearFigureSolution(input, omitted).length > 0);
      checks++;
    }
    if (s.objective?.extremum.status === "attained") {
      const stale = structuredClone(s);
      if (stale.objective!.extremum.status === "attained")
        stale.objective!.extremum.value = exact("999");
      assert(verifyLinearFigureSolution(input, stale).length > 0);
      checks++;
    }
  } else {
    assert(verifyLinearFeasibilityCertificate(s.constraints, s.feasibility));
    const broken = structuredClone(s);
    if (!broken.feasibility.feasible)
      broken.feasibility.contradiction.weights[0] = exact("-1");
    assert(verifyLinearFigureSolution(input, broken).length > 0);
    checks += 2;
  }
  // Source order and duplicates must not change the feasible cost interval.
  const reordered = solveLinearFigure({
    ...input,
    constraints: [...c.constraints].reverse(),
  }) as FeasibleRegionSolution;
  assert.deepEqual(reordered.objective?.range, s.objective?.range, c.name);
  checks++;
  const minInput: LinearFigureInput = {
    ...input,
    objective: { expression: `-(${c.cost})`, sense: "min" },
  };
  const minimized = solveLinearFigure(minInput) as FeasibleRegionSolution;
  assert.equal(minimized.objective?.extremum.status, c.status, c.name);
  if (c.max)
    assert.deepEqual(minimized.objective?.range?.lower, {
      value: serializeRational(negateRational(parseRational(c.max))),
      included: s.objective!.range!.upper!.included,
    });
  assert.deepEqual(verifyLinearFigureSolution(minInput, minimized), [], c.name);
  checks += 3;
}
for (const [equations, relation] of [
  [["2x+3y=7", "x+2y=4"], "unique"],
  [["2x+3y=7", "4x+6y=15"], "parallel"],
  [["2x+3y=7", "4x+6y=14"], "coincident"],
  [["x+y=1", "x+(1+1e-20)*y=2"], "unique"],
] as const) {
  const input: LinearFigureInput = {
    kind: "linear_system",
    equations: [...equations],
  };
  const s = solveLinearFigure(input);
  assert.equal(s.kind, "linear_system");
  if (s.kind === "linear_system") assert.equal(s.relation, relation);
  assert.deepEqual(verifyLinearFigureSolution(input, s), []);
  checks += 3;
}
for (const [expression, expected] of [
  [
    { inequality: "-3x+2>=5" },
    [{ lower: null, upper: { value: exact("-1"), included: true } }],
  ],
  [
    { intersection: [{ inequality: "x>=1" }, { inequality: "x<=1" }] },
    [
      {
        lower: { value: exact("1"), included: true },
        upper: { value: exact("1"), included: true },
      },
    ],
  ],
  [{ intersection: [{ inequality: "x>1" }, { inequality: "x<=1" }] }, []],
  [
    { complement: { union: [{ inequality: "x<1" }, { inequality: "x>1" }] } },
    [
      {
        lower: { value: exact("1"), included: true },
        upper: { value: exact("1"), included: true },
      },
    ],
  ],
] as const) {
  const input: LinearFigureInput = {
    kind: "number_line_set",
    expression: structuredClone(expression),
  };
  const s = solveLinearFigure(input);
  if (s.kind !== "number_line_set") throw Error("wrong variant");
  assert.deepEqual(s.intervals, expected);
  assert.deepEqual(verifyLinearFigureSolution(input, s), []);
  checks += 2;
}
assert.equal(
  linearConstraintSignature(parseLinearConstraint("2*(x-y)<=-3")[0]!),
  linearConstraintSignature(parseLinearConstraint("-2*x+2*y>=3")[0]!),
);
checks++;
for (const expression of [
  "x*y<=2",
  "x/y<1",
  "sin(x)<0",
  "x<=1<=2",
  "1/0*x<=3",
  "z<1",
]) {
  assert.throws(() =>
    solveLinearFigure({ kind: "linear_half_plane", inequality: expression }),
  );
  checks++;
}
for (const value of ["1e400", "1e-400"]) {
  assert.throws(() => exactRationalToNumber(exact(value)));
  checks++;
}
assert.equal(exactRationalToNumber(exact("1/3")), 1 / 3);
checks++;
let getters = 0;
const malicious = Object.defineProperty(
  { kind: "linear_half_plane" },
  "inequality",
  {
    get() {
      getters++;
      return "x<1";
    },
  },
);
assert.throws(() => solveLinearFigure(malicious as LinearFigureInput));
assert.equal(getters, 0);
checks += 2;
assert.throws(() =>
  solveLinearFigure({
    ...{ kind: "linear_half_plane", inequality: "x<1" },
    vertices: [1, 2],
  } as LinearFigureInput),
);
checks++;
assert.throws(() => parseLinearConstraint("z<1", ["x", "y", "z"]));
checks++;
assert.equal(
  exactRationalToNumber(exact("9007199254740993/9007199254740992")),
  1,
);
checks++;
assert.equal(
  exactRationalToNumber(exact("9007199254740995/9007199254740992")),
  1 + 2 * Number.EPSILON,
);
checks++;
assert.equal(
  exactRationalToNumber(exact(Number.MIN_VALUE.toString())),
  Number.MIN_VALUE,
);
checks++;
assert.equal(
  exactRationalToNumber(exact(Number.MAX_VALUE.toString())),
  Number.MAX_VALUE,
);
checks++;
let seed = 314159;
for (let i = 0; i < 100; i++) {
  seed = (seed * 48271) % 2147483647;
  const n = seed;
  seed = (seed * 48271) % 2147483647;
  const d = seed;
  assert.equal(exactRationalToNumber(exact(`${n}/${d}`)), n / d);
  checks++;
}
const looseInput: LinearFigureInput = {
  kind: "linear_feasible_region",
  constraints: ["x<1", "x<2"],
  objective: { expression: "x", sense: "max" },
};
const loose = solveLinearFigure(looseInput) as FeasibleRegionSolution;
if (loose.objective?.extremum.status !== "finite_limit")
  throw Error("Expected strict upper bound");
loose.objective.extremum.bound = {
  weights: [exact("0"), exact("1")],
  value: exact("2"),
  strict: true,
};
assert(verifyLinearFigureSolution(looseInput, loose).length > 0);
checks++;
if (polygon.kind !== "linear_feasible_region" || !polygon.objective?.lowerBound)
  throw Error("Expected lower bound");
assert.equal(
  verifyLinearObjectiveBound(
    polygon.constraints,
    polygon.objective.coefficients,
    polygon.objective.lowerBound,
    "sideways" as "min",
  ),
  false,
);
checks++;
assert.equal(
  verifyLinearRecessionCertificate(
    parseLinearConstraint("x<=0"),
    point("-1", "0"),
    parseLinearAffine("x"),
    "sideways" as "min",
  ),
  false,
);
checks++;
console.log(`passed ${checks} pure linear solution/certificate checks`);
