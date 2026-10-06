import {
  finiteBinomialPlanIssues,
  finiteProgressionSourceProgram,
  hasOnlyFiniteBinomialPlanFields,
  readFiniteBinomialProgram,
  uniformCircularCallerIssues,
  verifyMeasurementSourceAuthority,
  type ProblemIR,
  type SolverValue,
  type TurnPlanV3,
} from "@heytutor/scene-engine";

/** Additional obligations at the scene-less persistence boundary only. */
export type NumericSourceProfile =
  "measurement" | "polynomial" | "progression" | "circular";

const nonemptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const finiteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(nonemptyString);
const optional = (
  row: Record<string, unknown>,
  key: string,
  predicate: (value: unknown) => boolean,
) => !Object.hasOwn(row, key) || predicate(row[key]);

/** Inspect original own data, before generic validation can ignore an optional
 * type or normalize a field. Closure and bounded snapshots remain engine-owned.
 */
export function hasTypedNumericPlan(raw: unknown): raw is TurnPlanV3 {
  if (!hasOnlyFiniteBinomialPlanFields(raw)) return false;
  const plan = raw as Record<string, unknown>;
  const identity = (row: Record<string, unknown>) =>
    nonemptyString(row.id) &&
    nonemptyString(row.symbol) &&
    optional(row, "unit", nonemptyString);
  const quantity = (value: unknown, provenance: string) => {
    const row = value as Record<string, unknown>;
    return (
      identity(row) &&
      finiteNumber(row.value) &&
      row.provenance === provenance &&
      optional(row, "sourceText", nonemptyString) &&
      optional(
        row,
        "sign",
        (value) =>
          typeof value === "string" &&
          ["positive", "negative", "zero", "unsigned"].includes(value),
      ) &&
      optional(row, "dependsOn", strings) &&
      optional(row, "uncertainty", (value) => finiteNumber(value) && value >= 0)
    );
  };
  return (
    plan.schemaVersion === "turn-plan/v3" &&
    nonemptyString(plan.question) &&
    typeof plan.visualRequirement === "string" &&
    ["required", "optional", "none"].includes(plan.visualRequirement) &&
    (plan.givens as unknown[]).every((row) => quantity(row, "given")) &&
    (plan.derived as unknown[]).every((row) => quantity(row, "derived")) &&
    (plan.unknowns as Record<string, unknown>[]).every(identity) &&
    (plan.qualitativeClaims as Record<string, unknown>[]).every(
      (row) =>
        nonemptyString(row.id) &&
        nonemptyString(row.claim) &&
        (typeof row.expected === "boolean" ||
          nonemptyString(row.expected) ||
          finiteNumber(row.expected)) &&
        optional(row, "relatedQuantityIds", strings) &&
        optional(row, "relatedEntityHints", strings),
    ) &&
    strings(plan.lawIds) &&
    strings(plan.assumptions) &&
    optional(plan, "teachingSequenceHints", strings)
  );
}

function sameIds(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    expected.every((id) => actual.includes(id))
  );
}

/** Names are part of the proposition, not opaque caller IDs. The owning
 * readers prove every given's source role and every original request's AST,
 * premises and requested role. Only then may that role license an output
 * alias. No scalar comparison, sourceText echo or identifier syntax is proof.
 */
function sourceBoundQuantityNames(
  plan: TurnPlanV3,
  problem: ProblemIR,
  question: string,
  profile: NumericSourceProfile,
): boolean {
  // Join ALL supplied outputs to original requests before interpreting names.
  // Even a supported alias cannot authorize an orphan or another role's row.
  const outputs = [...plan.derived, ...plan.unknowns];
  if (
    outputs.some((row) => {
      const requests = problem.solveRequests.filter(
        (request) => request.resultBinding?.turnPlanQuantityId === row.id,
      );
      return (
        requests.length !== 1 ||
        requests[0]!.resultBinding!.symbol !== row.symbol ||
        requests[0]!.resultBinding!.unit !== row.unit
      );
    }) ||
    problem.solveRequests.some((request) => {
      const binding = request.resultBinding;
      return (
        !binding ||
        !plan.derived.some((row) => row.id === binding.turnPlanQuantityId) ||
        !plan.unknowns.some((row) => row.id === binding.turnPlanQuantityId)
      );
    })
  )
    return false;

  if (profile === "measurement") {
    const proof = verifyMeasurementSourceAuthority(problem, plan, question);
    if (
      proof.status !== "verified" ||
      proof.issues.length ||
      !proof.values.circular_reading ||
      !proof.numericalAuthority
    )
      return false;
    // The complete measurement proof owns the four given-name/role joins.
    // The sole requested role is a count of circular scale divisions, not a
    // physical force, length or an arbitrary caller-labelled proposition.
    const countNames = new Set([
      "N",
      "n",
      "C",
      "c",
      "count",
      "circular_reading",
      "circular_scale_reading",
    ]);
    return outputs.every(
      (row) =>
        row.id === proof.numericalAuthority!.quantityId &&
        countNames.has(row.symbol),
    );
  }
  if (profile === "progression") {
    const proof = finiteProgressionSourceProgram(question, problem, plan);
    if (proof.status !== "ok") return false;
    // The owning program proves every given name against its exact source
    // role. Each output is bound to a specific source ask, including its index
    // and branch. Result_i denotes that SOURCE ask's zero-based ordinal; caller
    // request order and equal-valued answers do not establish this association.
    return outputs.every((row) => {
      const binding = proof.bindings.find(
        (binding) => binding.quantityId === row.id,
      );
      if (!binding) return false;
      const ordinal = proof.source.asks.indexOf(binding.ask);
      if (ordinal < 0) return false;
      if (row.symbol === `Result_${ordinal}`) return true;
      const alias =
        binding.ask.kind === "term"
          ? binding.ask.symbol
          : `S_${binding.ask.index}`;
      const aliases = proof.source.asks.filter(
        (ask) =>
          (ask.kind === "term" ? ask.symbol : `S_${ask.index}`) === alias,
      );
      return aliases.length === 1 && row.symbol === alias;
    });
  }
  // These readers already prove every supplied symbol's owning quantity role:
  // coefficient/exponent names (including the source coefficient index), or
  // circular SI/unit names with exact source input/request roles and ASTs.
  return profile === "polynomial"
    ? finiteBinomialPlanIssues(question, problem, plan).length === 0
    : uniformCircularCallerIssues(question, problem, plan).length === 0;
}

/** Source-specific readers prove quantities/claims/assumptions and the whole IR.
 * This closes their remaining optional Plan obligations without widening any
 * diagram admission contract. No unresolved entity/view hint has a scene here.
 */
export function numericPlanObligationsProved(
  plan: TurnPlanV3,
  question: string,
  profile: NumericSourceProfile,
  problem: ProblemIR,
): boolean {
  if (!sourceBoundQuantityNames(plan, problem, question, profile)) return false;
  if (
    plan.teachingSequenceHints?.length ||
    plan.qualitativeClaims.some((row) => row.relatedEntityHints?.length) ||
    new Set(plan.lawIds).size !== plan.lawIds.length
  )
    return false;
  if (profile === "measurement") return true; // Whole count proof owns its exact dependency and text joins.
  if (profile === "circular") {
    if (plan.lawIds.some((law) => law !== "uniform_circular_motion"))
      return false;
    // The shared circular reader proves each complete assertion/assumption.
    // A true global proposition needs no extra semantic join. Independent
    // expected prose and quantity associations need a claim-specific proof
    // the current reader does not supply; decline the entire payload.
    if (
      plan.qualitativeClaims.some(
        (row) => row.expected !== true || row.relatedQuantityIds?.length,
      )
    )
      return false;
  } else if (plan.lawIds.length) return false; // No whole-source law-tag contract for these algebra profiles.
  if (plan.givens.some((row) => row.dependsOn?.length)) return false;
  const givenIds = plan.givens.map((row) => row.id);
  if (
    plan.derived.some(
      (row) => row.dependsOn !== undefined && !sameIds(row.dependsOn, givenIds),
    )
  )
    return false;
  if (profile === "polynomial") {
    const reading = readFiniteBinomialProgram(question);
    if (reading.status !== "ok") return false;
    // This given is the source exponent (the owning reader proves its value
    // and role). An optional quotation must consume exactly the parsed source
    // expression; extra prose/numbers are not licensed by that exponent.
    if (
      plan.givens.some(
        (row) =>
          row.sourceText !== undefined &&
          row.sourceText !== reading.source.expressionSource,
      )
    )
      return false;
  }
  return true;
}

/** A complete folded-result proposition bound to the exact admitted output.
 * This is intentionally narrower than arbitrary prose or arithmetic chains.
 * Source text for measurement/circular is proved by their owning readers.
 */
export function numericResultTextProved(
  row: TurnPlanV3["derived"][number],
  value: SolverValue,
  profile: NumericSourceProfile,
): boolean {
  if (
    profile === "measurement" ||
    profile === "circular" ||
    row.sourceText === undefined
  )
    return true;
  const exact =
    value.exact && !Array.isArray(value.exact) ? value.exact.value : undefined;
  const displays = new Set([
    String(value.approximate),
    ...(exact === undefined ? [] : [exact]),
  ]);
  return [...displays].some(
    (display) =>
      row.sourceText === `${row.symbol} = ${display}` ||
      row.sourceText === `Source-verified ${row.symbol} = ${display}`,
  );
}
