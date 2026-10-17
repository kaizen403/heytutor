/** Source-bound two-body dynamics. Velocity chooses kinetic friction; acceleration never does. */
import { STEM_NUMBER, parseStemNumber, prepareStem } from "../archetypes/slots";
import type { TurnPlanV3, TurnPlanQuantityV3 } from "../contracts/contractsV3";
import type { ExpressionNodeIR, ProblemIR } from "../ir/problemIR";

export interface CoupledInclineState {
  inclineMass: number;
  hangingMass: number;
  angleDeg: number;
  mu: number;
  gravity: number;
  /** Positive means upslope velocity. Acceleration uses upslope/downward positive. */
  velocitySign: -1 | 1;
  normal: number;
  friction: number;
  acceleration: number;
  tension: number;
}
const unitEnd = String.raw`(?![\w]|\s*[/^])`;
const number = (match: RegExpExecArray | null) =>
  match ? parseStemNumber(match[1]!) : null;
export function readCoupledInclineSource(
  question: string,
): CoupledInclineState | null {
  const text = prepareStem(question);
  if (
    !/\b(?:incline|inclined plane|slope)\b/i.test(text) ||
    !/\bfrictionless pulley\b/i.test(text) ||
    !/\b(?:massless|light)\s+(?:rope|string)\b/i.test(text) ||
    !/\b(?:rope|string)\s+parallel\s+to\s+(?:the\s+)?(?:incline|slope)/i.test(
      text,
    ) ||
    /\b(?:spring|air resistance|drag|rotational inertia|moment of inertia|elastic|moving pulley|applied force|pushed|pushes|movable pulley|two pulleys|three masses|additional force|external force|not sliding|at rest|released from rest)\b/i.test(
      text,
    )
  )
    return null;
  // A third applied force is outside this two-force-along-the-rope model.
  if (
    /\b(?:pulls?|pushes?|pushing|pushed)\b|(?:\d|[½¼¾])\s*(?:N\b|newtons?\b)/i.test(
      text,
    )
  )
    return null;
  const masses = [
    ...text.matchAll(new RegExp(`${STEM_NUMBER}\\s*kg${unitEnd}`, "gi")),
  ];
  if (masses.length !== 2) return null;
  const hanging = masses.filter(
    (match) =>
      /\b(?:hanging|suspended)\s*$/.test(
        text.slice(Math.max(0, match.index! - 24), match.index!),
      ) ||
      /^\s+(?:hanging|suspended)\s+(?:mass|block|body)\b/i.test(
        text.slice(match.index! + match[0].length),
      ),
  );
  if (hanging.length !== 1) return null;
  const incline = masses.find((match) => match !== hanging[0])!;
  if (
    !/^\s+(?:block|body|mass)\s+(?:is\s+)?on\s+(?:a|the)\s+(?:rough\s+)?/i.test(
      text.slice(incline.index! + incline[0].length),
    )
  )
    return null;
  const inclineMass = parseStemNumber(incline[1]!);
  const hangingMass = parseStemNumber(hanging[0]![1]!);
  const inclineClause = text
    .slice(incline.index! + incline[0].length)
    .split(/\bconnected\b|\.(?=\s|$)|[!?;]/i)[0]!;
  const angleDeg = number(
    new RegExp(
      `${STEM_NUMBER}\\s*(?:degrees?|°)\\s*(?:incline|inclined plane|slope)\\b`,
      "i",
    ).exec(inclineClause),
  );
  const mu = number(
    new RegExp(
      `(?:kinetic\\s+(?:friction\\s+coefficient|coefficient\\s+of\\s+friction)|(?:mu_k|μ_k|μk))\\s*(?:is|=|of)?\\s*${STEM_NUMBER}`,
      "i",
    ).exec(text),
  );
  const gravity = number(
    new RegExp(
      `\\bg\\s*=\\s*${STEM_NUMBER}\\s*m\\s*\\/\\s*s\\^2${unitEnd}`,
      "i",
    ).exec(text),
  );
  const motion = [
    ...text.matchAll(
      /\b(?:incline\s+)?block\s+(?:is\s+)?(?:currently\s+)?(?:sliding|moving|slides|moves)\s+(up|down)(?:slope|\s+(?:the\s+)?(?:incline|slope))\b/gi,
    ),
  ];
  if (
    motion.length !== 1 ||
    inclineMass === null ||
    hangingMass === null ||
    angleDeg === null ||
    mu === null ||
    gravity === null ||
    inclineMass <= 0 ||
    hangingMass <= 0 ||
    angleDeg <= 0 ||
    angleDeg >= 90 ||
    mu < 0 ||
    gravity <= 0
  )
    return null;
  const velocitySign = motion[0]![1]!.toLowerCase() === "up" ? 1 : -1;
  const normal = inclineMass * gravity * Math.cos((angleDeg * Math.PI) / 180);
  const friction = mu * normal;
  const rawAcceleration =
    (hangingMass * gravity -
      inclineMass * gravity * Math.sin((angleDeg * Math.PI) / 180) -
      velocitySign * friction) /
    (inclineMass + hangingMass);
  const acceleration =
    Math.abs(rawAcceleration) <= 64 * Number.EPSILON * gravity
      ? 0
      : rawAcceleration;
  const tension = hangingMass * (gravity - acceleration);
  if (tension <= 0) return null; // The stated taut-string regime cannot carry compression.
  return {
    inclineMass,
    hangingMass,
    angleDeg,
    mu,
    gravity,
    velocitySign,
    normal,
    friction,
    acceleration,
    tension,
  };
}
function key(symbol: string): string {
  return symbol.replace(/[{}_\\\s]/g, "").toLowerCase();
}
function quantityRole(
  symbol: string,
  unit?: string,
): "acceleration" | "tension" | "normal" | "friction" | null {
  const name = key(symbol);
  const normalizedUnit = unit?.replace(/²/g, "^2").replace(/\s/g, "");
  if (["a", "acceleration"].includes(name) && normalizedUnit === "m/s^2")
    return "acceleration";
  if (normalizedUnit !== "N") return null;
  return ["t", "tension"].includes(name)
    ? "tension"
    : ["n", "normal"].includes(name)
      ? "normal"
      : ["fk", "f", "friction"].includes(name)
        ? "friction"
        : null;
}
export function applyCoupledInclineAuthority(
  question: string,
  plan: TurnPlanV3,
): TurnPlanV3 | null {
  const state = readCoupledInclineSource(question);
  if (!state) return null;
  const givenValues = [
    { id: "m1", symbol: "m1", value: state.inclineMass, unit: "kg" },
    { id: "m2", symbol: "m2", value: state.hangingMass, unit: "kg" },
    { id: "theta", symbol: "theta", value: state.angleDeg, unit: "degree" },
    { id: "mu", symbol: "mu_k", value: state.mu, unit: "1" },
    { id: "g", symbol: "g", value: state.gravity, unit: "m/s^2" },
  ];
  const givens = plan.givens.map((quantity) => {
    const given = givenValues.find(
      (value) => key(value.symbol) === key(quantity.symbol),
    );
    return given
      ? {
          ...quantity,
          value: given.value,
          unit: given.unit,
          sourceText: `${given.symbol} = ${given.value} ${given.unit}`,
        }
      : quantity;
  });
  for (const given of givenValues) {
    if (givens.some((quantity) => key(quantity.symbol) === key(given.symbol)))
      continue;
    let id = given.id;
    while ([...givens, ...plan.derived].some((quantity) => quantity.id === id))
      id = `source_${id}`;
    givens.push({
      ...given,
      id,
      provenance: "given",
      sourceText: `${given.symbol} = ${given.value} ${given.unit}`,
    });
  }
  const touched = new Set<string>();
  const derived = plan.derived.map((quantity): TurnPlanQuantityV3 => {
    const role = quantityRole(quantity.symbol, quantity.unit);
    if (!role) return quantity;
    touched.add(quantity.id);
    const value = state[role];
    return {
      ...quantity,
      value,
      sign: value < 0 ? "negative" : value > 0 ? "positive" : "zero",
      uncertainty: 0,
      sourceText: `Source force-balance ${quantity.symbol} = ${value} ${quantity.unit}`,
    };
  });
  // The source model also works when planning is unavailable: supply each
  // independently computed quantity once, with collision-free canonical ids.
  for (const [role, symbol, unit] of [
    ["acceleration", "a", "m/s^2"],
    ["tension", "T", "N"],
    ["normal", "N", "N"],
    ["friction", "f_k", "N"],
  ] as const) {
    if (
      derived.some(
        (quantity) => quantityRole(quantity.symbol, quantity.unit) === role,
      )
    )
      continue;
    let id: string = symbol;
    while ([...plan.givens, ...derived].some((quantity) => quantity.id === id))
      id = `source_${id}`;
    const value = state[role];
    derived.push({
      id,
      symbol,
      unit,
      value,
      provenance: "derived",
      sign: value < 0 ? "negative" : value > 0 ? "positive" : "zero",
      uncertainty: 0,
      sourceText: `Source force-balance ${symbol} = ${value} ${unit}`,
    });
    touched.add(id);
  }
  const frictionDirection = state.velocitySign < 0 ? "up" : "down";
  const sign = state.velocitySign < 0 ? "+" : "-";
  return {
    ...plan,
    givens,
    derived,
    // Prior natural-language formulae may encode the same incorrect model as the old numbers.
    qualitativeClaims: [
      ...plan.qualitativeClaims.filter(
        (claim) =>
          !/^source_(?:kinetic_friction|force_balance|acceleration_direction)$/.test(
            claim.id,
          ) &&
          !claim.relatedQuantityIds?.some((id) => touched.has(id)) &&
          !/\b(?:friction|acceleration|tension|equations?)\b/i.test(
            claim.claim,
          ),
      ),
      {
        id: "source_kinetic_friction",
        claim:
          state.friction === 0
            ? "The kinetic friction force is zero because its coefficient is zero."
            : `Kinetic friction acts ${frictionDirection} the incline, opposite the stated current sliding velocity.`,
        expected: true,
      },
      {
        id: "source_force_balance",
        claim: `Take incline upslope and hanging downward as positive. T ${sign} f_k - m1*g*sin(theta) = m1*a; m2*g - T = m2*a.`,
        expected: true,
      },
      {
        id: "source_acceleration_direction",
        claim:
          state.acceleration === 0
            ? "Both bodies have zero acceleration while the stated sliding continues."
            : state.acceleration > 0
              ? "The incline block accelerates upslope and the hanging mass downward."
              : "The incline block accelerates downslope and the hanging mass upward.",
        expected: true,
      },
    ],
    assumptions: [
      ...plan.assumptions.filter(
        (value) =>
          !/positive (?:direction|acceleration)|positive.*(?:incline|slope|hanging)/i.test(
            value,
          ),
      ),
      "Positive acceleration is upslope for the incline block and downward for the hanging mass; its sign does not set the kinetic friction direction.",
    ],
  };
}

const scalar = (value: number): ExpressionNodeIR => ({ kind: "number", value });
const binary = (
  operator: "+" | "-" | "*" | "/",
  left: ExpressionNodeIR,
  right: ExpressionNodeIR,
): ExpressionNodeIR => ({ kind: "binary", operator, left, right });
/** Replace supported output expressions with an independently formulated Newton model, before solving. */
export function groundCoupledInclineProblem(problem: ProblemIR): ProblemIR {
  const state = readCoupledInclineSource(problem.question);
  if (!state) return problem;
  const angle = binary(
    "/",
    binary("*", scalar(state.angleDeg), { kind: "constant", name: "pi" }),
    scalar(180),
  );
  const weight1 = binary("*", scalar(state.inclineMass), scalar(state.gravity));
  const weight2 = binary("*", scalar(state.hangingMass), scalar(state.gravity));
  const normal: ExpressionNodeIR = binary("*", weight1, {
    kind: "call",
    function: "cos",
    argument: angle,
  });
  const friction = binary("*", scalar(state.mu), normal);
  const acceleration = binary(
    "/",
    binary(
      "-",
      binary(
        "-",
        weight2,
        binary("*", weight1, {
          kind: "call",
          function: "sin",
          argument: angle,
        }),
      ),
      binary("*", scalar(state.velocitySign), friction),
    ),
    binary("+", scalar(state.inclineMass), scalar(state.hangingMass)),
  );
  const roots = {
    normal,
    friction,
    acceleration,
    tension: binary(
      "*",
      scalar(state.hangingMass),
      binary("-", scalar(state.gravity), acceleration),
    ),
  };
  const replacements = new Map<string, ExpressionNodeIR>();
  for (const request of problem.solveRequests) {
    if (request.kind !== "evaluate" || !request.resultBinding) continue;
    const role = quantityRole(
      request.resultBinding.symbol,
      request.resultBinding.unit,
    );
    if (role) replacements.set(request.expressionId, roots[role]);
  }
  if (replacements.size === 0) return problem;
  const compactRole = (label: string | undefined): string | undefined => {
    if (!label) return label;
    if (/block.*incline|incline.*block/i.test(label)) return "block";
    if (/hanging.*(?:mass|body)|(?:mass|body).*hanging/i.test(label))
      return "mass";
    if (/incline/i.test(label)) return "incline";
    if (/rope|string/i.test(label)) return "rope";
    if (/pulley/i.test(label)) return "pulley";
    return label;
  };
  return {
    ...problem,
    entities: problem.entities.map((entity) => ({
      ...entity,
      label: compactRole(entity.label),
    })),
    expressions: problem.expressions.map((expression) =>
      replacements.has(expression.id)
        ? { ...expression, root: replacements.get(expression.id)! }
        : expression,
    ),
  };
}

/** Recheck persisted source-model force vectors rather than trusting a source tag. */
export function coupledInclineSourceIssues(
  question: string,
  document: import("../types").SceneDocument,
): Array<{ code: string; message: string }> {
  if (
    document.source.sourceModel !== "coupled_incline" &&
    !document.constructions.some((row) => row.id === "block_fbd")
  )
    return [];
  const state = readCoupledInclineSource(question);
  if (!state)
    return [
      {
        code: "coupled_incline_source_unbound",
        message:
          "The current question does not establish this source force model.",
      },
    ];
  const c = Math.cos((state.angleDeg * Math.PI) / 180);
  const s = Math.sin((state.angleDeg * Math.PI) / 180);
  const expected = [
    {
      id: "block_fbd",
      forces: [
        [0, -state.inclineMass * state.gravity],
        [-state.normal * s, state.normal * c],
        [state.tension * c, state.tension * s],
        ...(state.friction > 0
          ? [
              [
                -state.velocitySign * state.friction * c,
                -state.velocitySign * state.friction * s,
              ],
            ]
          : []),
      ],
    },
    {
      id: "hanging_fbd",
      forces: [
        [0, -state.hangingMass * state.gravity],
        [0, state.tension],
      ],
    },
  ];
  const mismatch = expected.some((item) => {
    const construction = document.constructions.find(
      (row) => row.id === item.id,
    );
    if (
      construction?.operator !== "free_body" ||
      !Array.isArray(construction.inputs.forces) ||
      construction.inputs.forces.length !== item.forces.length
    )
      return true;
    const forces = construction.inputs.forces;
    return item.forces.some((force, index) => {
      const actual = forces[index] as { components?: unknown; role?: unknown };
      const role =
        item.id === "block_fbd"
          ? ["weight", "normal", "tension", "kinetic_friction"][index]
          : ["weight", "tension"][index];
      if (actual?.role !== role) return true;
      return (
        !Array.isArray(actual?.components) ||
        actual.components.length !== 2 ||
        actual.components.some(
          (value: unknown, axis: number) =>
            typeof value !== "number" || Math.abs(value - force[axis]!) > 1e-8,
        )
      );
    });
  });
  return mismatch
    ? [
        {
          code: "coupled_incline_force_source_mismatch",
          message:
            "Free-body force vectors disagree with the source masses, geometry or current sliding velocity.",
        },
      ]
    : [];
}
