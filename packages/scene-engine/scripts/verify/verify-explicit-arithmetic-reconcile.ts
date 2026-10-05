/**
 * Explicit-arithmetic reconcile and claim attribution in TurnPlanV3.
 *
 * Hand-written cases (not the numeric-authority replay fixtures). Each case
 * states the rule it protects:
 * - a reconcile overwrites a value only when the written arithmetic computes
 *   that quantity in that quantity's declared unit;
 * - "=>", "≈", ">=" are read as what they are;
 * - a sign written in the expression beats an unsigned magnitude binding;
 * - a genuine arithmetic slip is still corrected or reported;
 * - inputs in mixed units are read by dimensional analysis; a literal
 *   reading of mixed units never rewrites a value;
 * - a claim number stated for a linked quantity must be its value at the
 *   claim's own precision (rounded, or truncated at three or more
 *   significant figures); a number
 *   the claim does not attribute but that carries a linked quantity's
 *   dimension must be explained by the plan or the question.
 */
import {
  reconcileTurnPlanV3ExplicitArithmetic,
  validateTurnPlanV3,
} from "../../src/index";

interface Quantity {
  id: string;
  symbol: string;
  value: number;
  unit?: string;
  sign?: "positive" | "negative" | "zero" | "unsigned";
  sourceText?: string;
  provenance: "given" | "derived";
}

interface Claim {
  id: string;
  claim: string;
  expected: boolean | string | number;
  relatedQuantityIds: string[];
}

const QUESTION = "Hand-written numeric authority case.";
const failures: string[] = [];
let checks = 0;

function given(id: string, value: number, unit?: string, extra: Partial<Quantity> = {}): Quantity {
  return { id, symbol: id, value, unit, provenance: "given", ...extra };
}

function derived(id: string, value: number, unit: string | undefined, sourceText: string, extra: Partial<Quantity> = {}): Quantity {
  return { id, symbol: id, value, unit, sourceText, provenance: "derived", ...extra };
}

function plan(givens: Quantity[], derivedValues: Quantity[], claims: Claim[] = []) {
  return {
    schemaVersion: "turn-plan/v3",
    question: QUESTION,
    givens,
    unknowns: [],
    derived: derivedValues,
    qualitativeClaims: claims,
    lawIds: [],
    assumptions: [],
    visualRequirement: "optional",
  };
}

function check(name: string, condition: boolean, detail: unknown = undefined): void {
  checks += 1;
  if (!condition) failures.push(`${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
}

function close(actual: unknown, expected: number, relative = 1e-6): boolean {
  return typeof actual === "number" &&
    Math.abs(actual - expected) <= relative * Math.max(1, Math.abs(expected));
}

function reconciled(input: ReturnType<typeof plan>, id: string): { value: unknown; sourceText: unknown } {
  const result = reconcileTurnPlanV3ExplicitArithmetic(input).plan as ReturnType<typeof plan>;
  const quantity = result.derived.find((entry) => entry.id === id);
  return { value: quantity?.value, sourceText: quantity?.sourceText };
}

function issueCodes(input: ReturnType<typeof plan>): string[] {
  return validateTurnPlanV3(input, QUESTION).issues.map((issue) => issue.code);
}

/** Reconcile, then validate the reconciled plan (the live order). */
function liveIssueCodes(input: ReturnType<typeof plan>): string[] {
  return issueCodes(reconcileTurnPlanV3ExplicitArithmetic(input).plan as ReturnType<typeof plan>);
}

// ---------------------------------------------------------------------------
// Units: never write a coherent SI number over a prefixed declared unit.
// ---------------------------------------------------------------------------

{
  // µ: the chain labels the SI result in T, then converts to µT.
  const input = plan(
    [given("n", 200), given("I", 5, "A"), given("r", 0.25, "m")],
    [derived("B", 2513, "µT", "B = μ0 n I/(2r) = (4π×10⁻⁷)(200)(5)/(2×0.25) = 2.513×10⁻³ T = 2513 µT")],
  );
  const result = reconciled(input, "B");
  check("µT result stays in µT", close(result.value, 2513.2741228718346), result);
  check("µT restated SI value is rewritten, not left stale",
    typeof result.sourceText === "string" && !result.sourceText.includes("2.513×10⁻³") &&
      result.sourceText.includes("µT"), result.sourceText);
  check("µT plan validates after reconcile", liveIssueCodes(input).length === 0, liveIssueCodes(input));
}

{
  // µ label on a number that only matches the coherent reading of the
  // expression: the label is a converted display, not the expression's unit.
  const input = plan(
    [],
    [derived("B", 3770, "µT", "B = (4π×10⁻⁷)(100)(3)/(2×0.05) = 3770 µT")],
  );
  const result = reconciled(input, "B");
  check("converted display label read in coherent unit", close(result.value, 3769.9111843077517), result);
}

{
  // m: a genuine arithmetic slip is corrected in the declared unit.
  const input = plan(
    [given("V", 12, "V"), given("R1", 100, "ohm"), given("R2", 300, "ohm")],
    [derived("I", 40, "mA", "I = V/(R1 + R2) = 12/(100+300) = 0.04 A = 40 mA")],
  );
  const result = reconciled(input, "I");
  check("mA slip corrected to 30 mA, not 0.03", close(result.value, 30), result);
  check("mA slip restatement in A rewritten",
    typeof result.sourceText === "string" && result.sourceText.includes("0.03 A") &&
      result.sourceText.includes("30 mA"), result.sourceText);
  check("mA slip is reported when not reconciled",
    issueCodes(input).includes("source_text_arithmetic_invalid"), issueCodes(input));
}

{
  // k: a same-dimension input written in km/s pins the result unit.
  const input = plan(
    [given("v0", 3, "km/s")],
    [derived("v", 4.24, "km/s", "v = v0*sqrt(2) = 4.24")],
  );
  check("km/s input keeps km/s result", close(reconciled(input, "v").value, 4.242640687119285), reconciled(input, "v"));
  const siInput = plan(
    [given("v0", 3000, "m/s")],
    [derived("v", 4.24, "km/s", "v = v0*sqrt(2) = 4.24")],
  );
  check("m/s input converted into km/s", close(reconciled(siInput, "v").value, 4.242640687119285), reconciled(siInput, "v"));
}

{
  // n: an intermediate in m, then nm.
  const input = plan(
    [given("h", 6.626e-34, "J s"), given("c", 3e8, "m/s"), given("E", 3.2e-19, "J")],
    [derived("lambda", 621, "nm", "lambda = h c/E = 6.626e-34*3e8/(3.2e-19) = 6.21e-7 m = 621 nm")],
  );
  check("nm result converted from m", close(reconciled(input, "lambda").value, 621.1875), reconciled(input, "lambda"));
}

{
  // c: no unit label anywhere; the stated value picks the SI reading.
  const input = plan(
    [],
    [derived("h", 20, "cm", "h = 0.5*9.8*0.2^2")],
  );
  check("cm unlabeled result read through the stated value", close(reconciled(input, "h").value, 19.6), reconciled(input, "h"));
  const wrong = plan([], [derived("h", 50, "cm", "h = 0.5*9.8*0.2^2")]);
  check("cm with no unit reading keeps the model value", reconciled(wrong, "h").value === 50, reconciled(wrong, "h"));
  check("cm with no unit reading is reported",
    issueCodes(wrong).includes("source_text_arithmetic_invalid"), issueCodes(wrong));
}

{
  // Label of a different dimension: decline rather than guess.
  const input = plan([], [derived("E", 6, "J", "E = 2*4 = 8 N")]);
  check("different-dimension label never overwrites", reconciled(input, "E").value === 6, reconciled(input, "E"));
}

// ---------------------------------------------------------------------------
// Relations: "=>" separates steps, ">=" is a comparison, "≈" chains.
// ---------------------------------------------------------------------------

{
  const input = plan(
    [given("v", 14.7, "m/s"), given("g", 9.8, "m/s^2")],
    [derived("t", 2.5, "s", "t = 2v/g => t = 2*14.7/9.8 = 2.5 s")],
  );
  check("=> chain step slip corrected", close(reconciled(input, "t").value, 3), reconciled(input, "t"));
  check("=> chain step slip reported unreconciled",
    issueCodes(input).includes("source_text_arithmetic_invalid"), issueCodes(input));
}

{
  const input = plan(
    [given("m", 4, "kg"), given("a", 2.5, "m/s^2")],
    [derived("F", 10, "N", "F = m*a => F = 4*2.5 ≈ 10 N")],
  );
  check("=> chain consistent value unchanged", reconciled(input, "F").value === 10, reconciled(input, "F"));
  check("=> chain consistent value valid", liveIssueCodes(input).length === 0, liveIssueCodes(input));
}

{
  const input = plan([], [derived("s", 20, "m", "s = 4*5 = 20 m >= 15 m")]);
  check(">= is not an equality", reconciled(input, "s").value === 20, reconciled(input, "s"));
  check(">= clause stays valid", liveIssueCodes(input).length === 0, liveIssueCodes(input));
}

{
  // An implication chain whose conclusion contradicts its derivation.
  const input = plan([], [derived("y", 4, undefined, "3y - 6 = 9 => y = 4")]);
  check("contradicting conclusion is not overwritten", reconciled(input, "y").value === 4, reconciled(input, "y"));
  check("contradicting conclusion reported",
    issueCodes(input).includes("source_text_arithmetic_conflict"), issueCodes(input));
  const consistent = plan([], [derived("y", 5, undefined, "3y - 6 = 9 => y = 5")]);
  check("consistent conclusion valid", liveIssueCodes(consistent).length === 0, liveIssueCodes(consistent));
}

{
  // Two separate clauses disagree.
  const input = plan([], [derived("W", 10, "J", "W = 5*2 = 10 J; W = 12 J")]);
  check("multi-clause disagreement keeps value", reconciled(input, "W").value === 10, reconciled(input, "W"));
  check("multi-clause disagreement reported",
    issueCodes(input).includes("source_text_arithmetic_conflict"), issueCodes(input));
}

{
  // A leading number of an expression is not a stated result.
  const input = plan(
    [given("x0", 3)],
    [derived("c", -7, undefined, "y = 5x0 + c; 8 = 5*3 + c; c = 8 - 15 = -7")],
  );
  check("expression member is not a stated value", liveIssueCodes(input).length === 0, liveIssueCodes(input));
}

// ---------------------------------------------------------------------------
// Signs and slips.
// ---------------------------------------------------------------------------

{
  // Unsigned focal length magnitude; the chain writes the sign.
  const input = plan(
    [given("f", 0.25, "m")],
    [
      derived("P", -4, "D", "P = 1/f = 1/(-0.25) = -4 D"),
      derived("P_total", 1, "D", "P_total = 5 + P = 5 - 4 = 1 D"),
    ],
  );
  check("written sign beats unsigned magnitude binding", reconciled(input, "P").value === -4, reconciled(input, "P"));
  check("downstream of signed value unchanged", reconciled(input, "P_total").value === 1, reconciled(input, "P_total"));
  // A signed binding is authoritative over a typed number that dropped it.
  const signed = plan(
    [given("f", -0.25, "m", { sign: "negative" })],
    [derived("P", 4, "D", "P = 1/f = 1/0.25 = 4 D")],
  );
  check("signed binding still corrects a dropped sign", close(reconciled(signed, "P").value, -4), reconciled(signed, "P"));
}

{
  const input = plan(
    [given("m", 2, "kg"), given("v", 3, "m/s")],
    [derived("E", 18, "J", "E = 0.5*m*v^2 = 0.5*2*3^2 = 18 J")],
  );
  check("arithmetic slip corrected", close(reconciled(input, "E").value, 9), reconciled(input, "E"));
  check("arithmetic slip reported unreconciled",
    issueCodes(input).includes("source_text_arithmetic_invalid"), issueCodes(input));
}

{
  // The chain never names the quantity but ends with its declared value.
  const input = plan([], [derived("D", 8, "m", "|2-0| + |7-2| = 2 + 5 = 8")]);
  check("anonymous chain anchored on the value is corrected", close(reconciled(input, "D").value, 7), reconciled(input, "D"));
  check("anonymous chain slip reported unreconciled",
    issueCodes(input).includes("source_text_arithmetic_invalid"), issueCodes(input));
}

{
  // A plan symbol that spells a unit (N) is a variable, not a label to strip.
  const input = plan(
    [given("F", 20, "N"), given("mu", 0.25), given("m", 5, "kg")],
    [
      derived("a", 2, "m/s^2", "a = (F - mu N)/m = (20 - 0.25*40)/5 = 2"),
      derived("N", 40, "N", "N = 40 N"),
    ],
  );
  check("symbol spelled like a unit is not stripped", reconciled(input, "a").value === 2, reconciled(input, "a"));
}

{
  // A bare restatement never overwrites, but validation still compares it.
  const input = plan([], [derived("x", 25, "cm", "x = 30")]);
  check("bare restatement never overwrites", reconciled(input, "x").value === 25, reconciled(input, "x"));
  check("bare restatement disagreeing with the value reported",
    issueCodes(input).includes("source_text_value_mismatch"), issueCodes(input));
}

{
  // Bare "e" is the elementary charge as often as Euler's number.
  const input = plan(
    [given("E", 5.2, "eV"), given("phi", 2.1, "eV", { symbol: "φ" })],
    [derived("V_s", 3.1, "V", "V_s = (E - φ)/e = (5.2 - 2.1) V = 3.1 V")],
  );
  check("bare e is not Euler's number", reconciled(input, "V_s").value === 3.1, reconciled(input, "V_s"));
  check("bare e chain stays valid", liveIssueCodes(input).length === 0, liveIssueCodes(input));
}

{
  // Dependencies are reconciled first, whatever order the plan lists them in.
  const input = plan(
    [given("E1", 18, "V"), given("R1", 4, "ohm"), given("R2", 2, "ohm")],
    [
      { ...derived("I", 3, "A", "I = V/R2 = 6/2 = 3 A"), dependsOn: ["V"] } as Quantity,
      derived("V", 6, "V", "use divider: V = E1*R2/(R1 + R2) = 18*2/(4+2) = 6 V"),
    ],
  );
  const corrected = plan(input.givens, [
    { ...derived("I", 4, "A", "I = V/R2 = 8/2 = 4 A"), dependsOn: ["V"] } as Quantity,
    derived("V", 8, "V", "use divider: V = E1*R2/(R1 + R2) = 18*2/(4+2) = 8 V"),
  ]);
  check("labelled head and listed-later dependency: consistent plan unchanged",
    reconciled(input, "I").value === 3 && reconciled(input, "V").value === 6,
    [reconciled(input, "I"), reconciled(input, "V")]);
  check("corrected dependency reaches the quantity computed from it",
    close(reconciled(corrected, "V").value, 6) && close(reconciled(corrected, "I").value, 3),
    [reconciled(corrected, "V"), reconciled(corrected, "I")]);
}

{
  // An unchecked upstream value never overrides a chain whose own numbers
  // agree with its stated result.
  const input = plan(
    [given("R", 4, "ohm")],
    [
      derived("V", 12, "V", "the source gives roughly twelve volts"),
      { ...derived("I", 2, "A", "I = V/R = 8/4 = 2.0 A"), dependsOn: ["V"] } as Quantity,
    ],
  );
  check("unchecked upstream value does not overwrite", reconciled(input, "I").value === 2, reconciled(input, "I"));
  // A given is authoritative over a typed number.
  const typo = plan(
    [given("m", 2, "kg"), given("v", 3, "m/s")],
    [derived("E", 16, "J", "E = 0.5*m*v^2 = 0.5*2*4^2 = 16 J")],
  );
  check("given binding still corrects a mistyped number", close(reconciled(typo, "E").value, 9), reconciled(typo, "E"));
}

{
  const input = plan([], [derived("R", 30, "m", "R = 10(√3 + 3) = 30 m")]);
  check("√ applied to a bare number", close(reconciled(input, "R").value, 47.32050807568877), reconciled(input, "R"));
}

// ---------------------------------------------------------------------------
// Claims: only numbers the claim attributes to a linked quantity.
// ---------------------------------------------------------------------------

const angleGiven = given("n", 1.5);
const criticalAngle = derived("theta_c", 41.81, "deg", "theta_c = asin(1/1.5) = 41.81°", { symbol: "θ_c" });

function claimPlan(claim: Claim, quantities: Quantity[] = [criticalAngle]) {
  return plan([angleGiven], quantities, [claim]);
}

{
  // A number the claim does not attribute but that carries the linked
  // quantity's dimension must be explained by the plan or the question.
  const grazing: Claim = {
    id: "c1",
    claim: "At the critical angle the refracted ray grazes the surface with refracted angle 90°.",
    expected: "θ_c = arcsin(1/n)",
    relatedQuantityIds: ["theta_c"],
  };
  const explained = issueCodes(plan([angleGiven, given("theta_r", 90, "deg")], [criticalAngle], [grazing]));
  check("unattributed number explained by a plan quantity", !explained.includes("claim_quantity_mismatch"), explained);
  const unexplained = issueCodes(claimPlan(grazing));
  check("unattributed number with the linked dimension and no explanation rejected",
    unexplained.includes("claim_quantity_mismatch"), unexplained);
  const fromQuestion = "Light leaves glass (n = 1.5); the refracted ray grazes the surface at 90°. Find the critical angle.";
  const asked = { ...claimPlan(grazing), question: fromQuestion };
  const askedCodes = validateTurnPlanV3(asked, fromQuestion).issues.map((issue) => issue.code);
  check("unattributed number explained by the question text", !askedCodes.includes("claim_quantity_mismatch"), askedCodes);
  const argument = issueCodes(claimPlan({
    id: "c1",
    claim: "Snell's law at the critical angle reads n sin(θ_c) = 1·sin(90°).",
    expected: true,
    relatedQuantityIds: ["theta_c"],
  }));
  check("function argument is not a stated value", !argument.includes("claim_quantity_mismatch"), argument);
}

{
  const codes = issueCodes(claimPlan({
    id: "c1",
    claim: "Snell's law at grazing emergence gives θ_c = arcsin(1/1.5) ≈ 45°.",
    expected: true,
    relatedQuantityIds: ["theta_c"],
  }));
  check("symbol-attributed contradiction rejected", codes.includes("claim_quantity_mismatch"), codes);
}

{
  const codes = issueCodes(claimPlan({
    id: "c2",
    claim: "Total internal reflection needs a large enough incidence angle.",
    expected: "θ_c = arcsin(1/1.5) ≈ 48.2°",
    relatedQuantityIds: ["theta_c"],
  }));
  check("contradiction stated in expected rejected", codes.includes("claim_quantity_mismatch"), codes);
}

{
  const image = derived("image_distance", 30, "cm", "image_distance = 30 cm", { symbol: "v" });
  const named = issueCodes(claimPlan({
    id: "c3",
    claim: "The image distance is 15 cm.",
    expected: true,
    relatedQuantityIds: ["image_distance"],
  }, [image]));
  check("descriptive subject naming the quantity is checked", named.includes("claim_quantity_mismatch"), named);
  const byClaimId = issueCodes(claimPlan({
    id: "object_distance",
    claim: "The object distance is 15 cm.",
    expected: true,
    relatedQuantityIds: ["image_distance"],
  }, [image]));
  check("descriptive subject naming the claim is checked", byClaimId.includes("claim_quantity_mismatch"), byClaimId);
  const placed: Claim = {
    id: "c4",
    claim: "Placed 15 cm from the mirror, the object forms a real image.",
    expected: true,
    relatedQuantityIds: ["image_distance"],
  };
  const other = issueCodes(plan([angleGiven, given("u", 15, "cm")], [image], [placed]));
  check("a distance in prose explained by another plan quantity passes", !other.includes("claim_quantity_mismatch"), other);
  const stray = issueCodes(claimPlan(placed, [image]));
  check("a stray distance in prose with no explanation rejected", stray.includes("claim_quantity_mismatch"), stray);
}

{
  const height = given("h", 20, "m");
  const time = derived("t", 2.02, "s", "t = sqrt(2*20/9.8) = 2.02 s");
  const codes = issueCodes(plan([height], [time], [{
    id: "c1",
    claim: "Taking up as positive, h = -20 m at the ground, and the stone falls freely.",
    expected: true,
    relatedQuantityIds: ["h", "t"],
  }]));
  check("signed coordinate of an unsigned magnitude accepted", !codes.includes("claim_quantity_mismatch"), codes);
  const signedImage = derived("v", -60, "cm", "v = -60 cm", { sign: "negative" });
  const signedCodes = issueCodes(claimPlan({
    id: "c1",
    claim: "With the mirror sign convention v = 60 cm.",
    expected: true,
    relatedQuantityIds: ["v"],
  }, [signedImage]));
  check("sign contradicting a signed quantity rejected", signedCodes.includes("claim_quantity_mismatch"), signedCodes);
}

{
  const normal = derived("N", 30, "N", "N = mg - F sin37 = 49 - 19 = 30 N");
  const codes = issueCodes(plan([given("m", 5, "kg"), given("F", 31.67, "N")], [normal], [{
    id: "c1",
    claim: "The pull lifts part of the weight, so N = 30 N < mg = 49 N.",
    expected: true,
    relatedQuantityIds: ["N"],
  }]));
  check("intermediate heads (mg) are not the linked quantity", !codes.includes("claim_quantity_mismatch"), codes);
  const wrong = issueCodes(plan([given("m", 5, "kg"), given("F", 31.67, "N")], [normal], [{
    id: "c1",
    claim: "The pull lifts part of the weight, so N = 49 N.",
    expected: true,
    relatedQuantityIds: ["N"],
  }]));
  check("claim contradicting the linked symbol rejected", wrong.includes("claim_quantity_mismatch"), wrong);
}

// ---------------------------------------------------------------------------
// Review probes: never overwrite what the chain's own result supports; never
// let a contradicting claim pass silently.
// ---------------------------------------------------------------------------

{
  // The expression converts units itself; the input unit must not pin it.
  const cases: Array<[string, Quantity, Quantity, number]> = [
    ["km/h converted in the expression", given("v0", 72, "km/h"), derived("v", 20, "m/s", "v = v0*1000/3600 = 20"), 20],
    ["cm converted in the expression", given("L", 150, "cm"), derived("Lm", 1.5, "m", "Lm = L/100 = 1.5"), 1.5],
    ["nm converted in the expression", given("lam", 500, "nm"), derived("lam_m", 5e-7, "m", "lam_m = lam*1e-9 = 5e-7"), 5e-7],
  ];
  for (const [name, input, output, expected] of cases) {
    const converted = plan([input], [output]);
    check(`${name}: not overwritten`, close(reconciled(converted, output.id).value, expected), reconciled(converted, output.id));
    check(`${name}: valid`, liveIssueCodes(converted).length === 0, liveIssueCodes(converted));
  }
  // A slip in a converting chain: no reading supports the value, so decline
  // and report rather than guess a unit.
  const slip = plan([given("v0", 72, "km/h")], [derived("v", 21, "m/s", "v = v0*1000/3600 = 21")]);
  check("converting chain slip never overwritten through a unit guess", reconciled(slip, "v").value === 21, reconciled(slip, "v"));
  check("converting chain slip reported", liveIssueCodes(slip).includes("source_text_arithmetic_invalid"), liveIssueCodes(slip));
  // The same-dimension pin still reads cm inputs into a value declared in m.
  const pinned = plan(
    [given("f", 10, "cm"), given("d_o", 30, "cm")],
    [derived("v", 0.15, "m", "v = f*d_o/(d_o - f) = 10*30/20")],
  );
  check("same-dimension input pins a cm chain into m", close(reconciled(pinned, "v").value, 0.15), reconciled(pinned, "v"));
  check("same-dimension pinned chain valid", liveIssueCodes(pinned).length === 0, liveIssueCodes(pinned));
}

{
  // A written sign that contradicts the chain's own result never wins.
  const forces = [given("F", 10, "N"), given("m", 2, "kg")];
  const stated = plan(forces, [derived("a", 5, "m/s^2", "a = F/m = -10/2 = 5")]);
  check("written sign against the stated result never overwrites", reconciled(stated, "a").value === 5, reconciled(stated, "a"));
  check("written sign against the stated result reported",
    liveIssueCodes(stated).includes("source_text_arithmetic_conflict"), liveIssueCodes(stated));
  const bare = plan(forces, [derived("a", 5, "m/s^2", "a = F/m = -10/2")]);
  check("written sign against the declared value never overwrites", reconciled(bare, "a").value === 5, reconciled(bare, "a"));
  check("written sign against the declared value reported",
    liveIssueCodes(bare).includes("source_text_arithmetic_conflict"), liveIssueCodes(bare));
  const agreeing = plan(forces, [derived("a", -5, "m/s^2", "a = F/m = -10/2 = -5")]);
  check("written sign agreeing with the stated result kept", reconciled(agreeing, "a").value === -5, reconciled(agreeing, "a"));
}

{
  // The chain computes the percentage itself.
  const input = plan([given("a", 40), given("b", 50)], [derived("p", 75, "%", "p = a/b*100 = 80")]);
  check("percent chain slip corrected", close(reconciled(input, "p").value, 80), reconciled(input, "p"));
  check("percent chain valid after reconcile", liveIssueCodes(input).length === 0, liveIssueCodes(input));
}

{
  const image = derived("v", 20, "cm", "v = 20 cm");
  const indirect: Array<[string, string, Quantity[], Quantity[], string[]]> = [
    ["result of a procedure", "Solving the lens equation gives an image distance of about 12 cm", [], [image], ["v"]],
    ["position phrase", "The image is located 12 cm behind the lens", [], [image], ["v"]],
    ["outcome verb", "so v comes out to 12 cm", [], [image], ["v"]],
    ["descriptive copula subject", "the current through R is 3 A", [given("I", 2, "A")], [], ["I"]],
    ["sign of a derived value with no declared sign", "v = -20 cm", [], [image], ["v"]],
  ];
  for (const [name, text, givens, derivedValues, ids] of indirect) {
    const codes = issueCodes(plan(givens, derivedValues, [{ id: "c1", claim: text, expected: true, relatedQuantityIds: ids }]));
    check(`indirect contradiction rejected: ${name}`, codes.includes("claim_quantity_mismatch"), codes);
  }
  const unsigned = derived("v", 20, "cm", "v = 20 cm", { sign: "unsigned" });
  const declared = issueCodes(plan([], [unsigned], [{ id: "c1", claim: "v = -20 cm", expected: true, relatedQuantityIds: ["v"] }]));
  check("sign convention on a declared magnitude accepted", !declared.includes("claim_quantity_mismatch"), declared);
  const restated = issueCodes(plan([given("E", 3, "V")], [derived("I", 2, "A", "I = 2 A")], [{
    id: "c1",
    claim: "I2 = (E - 4.5)/1 = -1.5 A (i.e. 1.5 A into the battery), and the load carries 2 A.",
    expected: true,
    relatedQuantityIds: ["I"],
  }]));
  check("a restatement of an attributed number is not a new value", !restated.includes("claim_quantity_mismatch"), restated);
  const bounds = issueCodes(plan([given("m1", 3, "kg")], [derived("T", 36.75, "N", "T = 36.75 N")], [{
    id: "c1",
    claim: "Tension lies between the weights: 29.4 N < T = 36.75 N < 49 N, and is less than the weight 49 N.",
    expected: true,
    relatedQuantityIds: ["T"],
  }]));
  check("comparison bounds are not stated values", !bounds.includes("claim_quantity_mismatch"), bounds);
  const headed = issueCodes(plan([given("mu", 0.2), given("N", 32, "N")], [derived("a", 3.52, "m/s^2", "a = 3.52")], [{
    id: "c1",
    claim: "Friction opposes the pull with magnitude f_k = μ_k N = 6.4 N, so N = 32 N holds the block.",
    expected: true,
    relatedQuantityIds: ["N", "a"],
  }]));
  check("an equation head naming another symbol is context", !headed.includes("claim_quantity_mismatch"), headed);
  const fraction = issueCodes(plan([], [derived("V", 8.1818, "V", "V = 90/11 = 8.1818")], [{
    id: "c1",
    claim: "The node sits at V = 90/11 V ≈ 8.18 V.",
    expected: true,
    relatedQuantityIds: ["V"],
  }]));
  check("the denominator of a fraction is not a measured value", !fraction.includes("claim_quantity_mismatch"), fraction);
}

{
  // A wrong value for the linked quantity is rejected even when the same
  // number is explained elsewhere (here it is the object distance).
  const question = "An object is placed 12 cm in front of a concave mirror of focal length 7.5 cm. Find the image distance.";
  const mirror = (claim: string) => {
    const input = {
      ...plan([given("u", 12, "cm"), given("f", 7.5, "cm")],
        [derived("image_distance", 20, "cm", "image_distance = 20 cm", { symbol: "v" })],
        [{ id: "c1", claim, expected: true, relatedQuantityIds: ["image_distance"] }]),
      question,
    };
    return validateTurnPlanV3(input, question).issues.map((issue) => issue.code);
  };
  const across = mirror("The image distance of the mirror is 12 cm.");
  check("subject read across 'of' rejects a wrong value", across.includes("claim_quantity_mismatch"), across);
  const wrapped = mirror("The magnitude of the image distance for this mirror is 12 cm.");
  check("subject read through a transparent head rejects a wrong value", wrapped.includes("claim_quantity_mismatch"), wrapped);
  const described = mirror("Solving the mirror equation gives an image distance of about 12 cm.");
  check("number right after the quantity's name rejects a wrong value", described.includes("claim_quantity_mismatch"), described);
  const correct = mirror("The image distance of the mirror is 20 cm, for an object at 12 cm.");
  check("subject read across 'of' accepts the right value", !correct.includes("claim_quantity_mismatch"), correct);
  const nearest = mirror("The image lies further out than the object distance of 12 cm; the image distance is 20 cm.");
  check("only the name right before a number attributes it", !nearest.includes("claim_quantity_mismatch"), nearest);
}

{
  // Every unit the plan's unit parser reads is checked, with prefixes
  // converted: 120 mA is not 85.7 mA; 0.0857 A is.
  const unitCases: Array<[string, Quantity, string, boolean]> = [
    ["mA", derived("I", 85.7, "mA", "I = 85.7 mA"), "The current I is 120 mA.", false],
    ["mA unattributed", derived("I", 85.7, "mA", "I = 85.7 mA"), "So the ammeter reads 120 mA.", false],
    ["kg", derived("m", 2, "kg", "m = 2 kg"), "m = 5 kg", false],
    ["µT", derived("B", 628.3, "µT", "B = 628.3 µT"), "The field B is 314 µT at the centre.", false],
    ["kPa against Pa", derived("P", 500, "Pa", "P = 500 Pa"), "P = 50 kPa", false],
    ["m/s", derived("v", 4, "m/s", "v = 4 m/s"), "v = 9 m/s", false],
    ["power of ten", derived("GM", 4.01408e14, "m^3/s^2", "GM = 4.01408e14"), "GM = 3.92 × 10^14 m^3/s^2", false],
    ["A against mA", derived("I", 85.7, "mA", "I = 85.7 mA"), "I = 0.0857 A", true],
    ["mT against µT", derived("B", 628.3, "µT", "B = 628.3 µT"), "B = 0.6283 mT", true],
    ["g against kg", derived("m", 2, "kg", "m = 2 kg"), "m = 2000 g", true],
  ];
  for (const [name, quantity, text, ok] of unitCases) {
    const codes = issueCodes(plan([given("k", 1)], [quantity], [{ id: "c1", claim: text, expected: true, relatedQuantityIds: [quantity.id] }]));
    check(`claim unit ${name} ${ok ? "accepted" : "rejected"}`, codes.includes("claim_quantity_mismatch") !== ok, codes);
  }
}

{
  // An operand of the chain's arithmetic is not the value it states.
  const operand = issueCodes(plan([given("k", 5)], [derived("U1", 10, "mJ", "U1 = 10 mJ", { symbol: "U₁" })], [{
    id: "c1", claim: "Energy falls by the dielectric constant.", expected: "U₁ = U₀/κ = 50 mJ / 5 = 10 mJ", relatedQuantityIds: ["U1"],
  }]));
  check("an operand of the arithmetic is not a stated value", !operand.includes("claim_quantity_mismatch"), operand);
  // A root the claim discards, beside the quantity's own value, is not taught.
  const roots = (text: string) => issueCodes(plan([given("h", 25, "m")], [derived("t", 5, "s", "t = 5 s")], [{
    id: "c1", claim: text, expected: true, relatedQuantityIds: ["t"],
  }]));
  const discarded = roots("The quadratic gives roots t = 5 s and t = -1 s; the negative root is rejected as non-physical.");
  check("a discarded root beside the value is not a contradiction", !discarded.includes("claim_quantity_mismatch"), discarded);
  const alone = roots("The quadratic gives t = 7 s; the negative root is rejected.");
  check("a discard word does not excuse a wrong value", alone.includes("claim_quantity_mismatch"), alone);
  // Only the number the discard wording is tied to is excused. The stated
  // answer must still be the value, even when the value appears elsewhere.
  const mustReject = [
    "The negative root t = -1 s is rejected, so the physical answer is t = 7 s; note t = 5 s appears in the working.",
    "Roots t = 5 s and t = -1 s; reject t = -1 s, so the time of flight is t = 7 s.",
    "With t = 5 s in the working, the negative root is rejected and the ball lands at t = 7 s.",
    "Discard the negative value -1 s; t = 5 s solves the quadratic but the answer is t = 7 s.",
    "-1 s is not physical, t = 5 s is a check, and the time is t = 7 s.",
    "Rejecting the negative root gives t = 7 s, unlike t = 5 s.",
    "The roots are t = 5 s and t = 7 s; the positive root is rejected.",
  ];
  for (const text of mustReject) {
    const codes = roots(text);
    check(`discard wording excuses only its own number: ${text}`, codes.includes("claim_quantity_mismatch"), codes);
  }
  const mustAccept = [
    "The quadratic gives two roots, t = 5 s and t = -1 s; the negative root is rejected as non-physical.",
    "The negative root t = -1 s is rejected, so the physical answer is t = 5 s.",
    "Solving gives t = 5 s (rejecting t = -1 s).",
    "The positive root t = 5 s is the physical answer (negative root t = -1 s rejected).",
    "Discard the negative value -1 s; the time is t = 5 s.",
    "The root t = -1 s is not physical, so t = 5 s.",
  ];
  for (const text of mustAccept) {
    const codes = roots(text);
    check(`a genuine discard with the right answer passes: ${text}`, !codes.includes("claim_quantity_mismatch"), codes);
  }
  // A discard named by its place in the list ("the latter", "the second
  // root", "the other root") excuses only the number it points at among the
  // candidates listed before it. Every other number must still be the value.
  const referentialAccept = [
    "The quadratic gives t = 5 s and t = -1 s; the latter is discarded.",
    "Roots t = 5 s and t = -1 s; the second root is rejected.",
    "Roots t = -1 s and t = 5 s; the former is not physical.",
    "Roots t = 5 s and t = -1 s; the other root is discarded.",
    "Roots t = -1 s and t = 5 s; the other value is rejected, so the time is t = 5 s.",
    "Roots t = -1 s and t = 5 s; the first root is rejected as unphysical.",
    "Solving gives t = 5 s or t = -1 s, and we discard the latter.",
  ];
  for (const text of referentialAccept) {
    const codes = roots(text);
    check(`a referential discard with the right answer passes: ${text}`, !codes.includes("claim_quantity_mismatch"), codes);
  }
  const referentialReject = [
    "Roots t = 5 s and t = -1 s; the former is discarded.",
    "Roots t = 7 s and t = -1 s; the latter is discarded.",
    "Roots t = 5 s and t = -1 s; the latter is discarded, so the time is t = 7 s.",
    "Roots t = 7 s and t = -1 s; the other root is discarded.",
    "Roots t = 5 s, t = 7 s and t = -1 s; the latter is discarded.",
    "Roots t = 5 s and t = -1 s; the first root is rejected.",
    "The time is t = -1 s; the latter is rejected.",
  ];
  for (const text of referentialReject) {
    const codes = roots(text);
    check(`a referential discard excuses only the number it names: ${text}`, codes.includes("claim_quantity_mismatch"), codes);
  }
}

// ---------------------------------------------------------------------------
// Rule pins: each case fails when its rule is disabled. (">=" protection is
// pinned by ">= clause stays valid" above.)
// ---------------------------------------------------------------------------

{
  // Unit letters strip only after a number ("6 N"). After an operator they
  // are a variable: an unbound N must stop the member, not vanish from it.
  const input = plan(
    [given("W", 500, "N"), given("m", 50, "kg")],
    [derived("a", 2, "m/s^2", "a = (N - W)/m = (600 - 500)/50 = 2")],
  );
  check("unit letters after an operator are a variable", reconciled(input, "a").value === 2, reconciled(input, "a"));
  check("unit letters after an operator: chain valid", liveIssueCodes(input).length === 0, liveIssueCodes(input));
}

{
  // A plain number next to an isolated target restates a value; "30 cm"
  // is not arithmetic that can replace the 0.3 m the chain states.
  const input = plan([given("r", 10, "cm")], [derived("x", 0.3, "m", "x = 30 cm = 0.3 m")]);
  check("isolated restatement is not arithmetic", reconciled(input, "x").value === 0.3, reconciled(input, "x"));
  check("isolated restatement valid", liveIssueCodes(input).length === 0, liveIssueCodes(input));
}

// ---------------------------------------------------------------------------
// Mixed units: a chain whose inputs carry different units for one dimension
// (km beside m, cm beside m, g beside kg, min beside s), or a prefixed unit
// beside a coherent target, is read by dimensional analysis. A value is never
// rewritten through a literal reading of mixed inputs; a bare-symbol chain
// that only agrees when read literally is reported; and the coherent result
// replaces a declared value only when the chain states that result itself.
// ---------------------------------------------------------------------------

{
  const cases: Array<{
    name: string;
    givens: Quantity[];
    unit: string;
    expression: string;
    correct: number;
    literal: number;
  }> = [
    { name: "km with m", givens: [given("a", 2, "km"), given("b", 500, "m")], unit: "m", expression: "a + b", correct: 2500, literal: 502 },
    { name: "cm with m", givens: [given("L1", 30, "cm"), given("L2", 1.2, "m")], unit: "m", expression: "L1 + L2", correct: 1.5, literal: 31.2 },
    { name: "g with kg", givens: [given("m1", 500, "g"), given("m2", 2, "kg")], unit: "kg", expression: "m1 + m2", correct: 2.5, literal: 502 },
    { name: "minutes with seconds", givens: [given("t1", 2, "min"), given("t2", 30, "s")], unit: "s", expression: "t1 + t2", correct: 150, literal: 32 },
    // The grav3 shape: a prefixed input in a product for a coherent target
    // (R in km inside g R^2), scaled down to stay in the evaluator's range.
    { name: "km in a product for an SI target", givens: [given("g", 9.8, "m/s^2"), given("R", 6.4, "km")], unit: "m^3/s^2", expression: "g R^2", correct: 401408000, literal: 401.408 },
    { name: "g/mol in an SI formula", givens: [given("Rg", 8.314, "J/(mol K)"), given("T", 300, "K"), given("M", 32, "g/mol")], unit: "m/s", expression: "sqrt(3 Rg T/M)", correct: 483.5610095944461, literal: 15.291541779689844 },
  ];
  for (const { name, givens, unit, expression, correct, literal } of cases) {
    // A correct declared value with an unevaluated chain is never rewritten
    // to the literal reading.
    const bare = plan(givens, [derived("q", correct, unit, `q = ${expression}`)]);
    check(`${name}: correct value kept beside a bare chain`, close(reconciled(bare, "q").value, correct), reconciled(bare, "q"));
    check(`${name}: correct value with a bare chain valid`, liveIssueCodes(bare).length === 0, liveIssueCodes(bare));
    // The chain states the correct result in the target's unit: kept, valid.
    const stated = plan(givens, [derived("q", correct, unit, `q = ${expression} = ${correct} ${unit}`)]);
    check(`${name}: stated correct value kept`, close(reconciled(stated, "q").value, correct), reconciled(stated, "q"));
    check(`${name}: stated correct value valid`, liveIssueCodes(stated).length === 0, liveIssueCodes(stated));
    // The literal reading as the declared value: a unit slip. Never
    // rewritten through a unit guess. A member of bare symbols is reported
    // invalid; one with a number in it ("3 Rg T") might convert units itself,
    // so the reconcile declines and lists it, and the value stays unverified.
    const slip = plan(givens, [derived("q", literal, unit, `q = ${expression}`)]);
    check(`${name}: literal slip never rewritten`, close(reconciled(slip, "q").value, literal), reconciled(slip, "q"));
    if (/(?<![\w.^])\d/.test(expression)) {
      const declined = reconcileTurnPlanV3ExplicitArithmetic(slip).declined;
      check(`${name}: literal slip declined and listed`, declined.some((item) => item.quantityId === "q"), declined);
    } else {
      check(`${name}: literal slip reported`, issueCodes(slip).includes("source_text_arithmetic_invalid"), issueCodes(slip));
    }
    // A stale declared value beside a chain that states the dimensionally
    // correct result is corrected to that result.
    const stale = correct * 1.1;
    const corrected = plan(givens, [derived("q", stale, unit, `q = ${expression} = ${correct} ${unit}`)]);
    check(`${name}: stated coherent result corrects a stale value`, close(reconciled(corrected, "q").value, correct), reconciled(corrected, "q"));
  }
  // The chain writes the literal reading as its result: no reading of the
  // inputs is both stated and dimensionally sound. Never rewrite either way.
  const writtenSlip = plan(
    [given("a", 2, "km"), given("b", 500, "m")],
    [derived("d", 2500, "m", "d = a + b = 502 m")],
  );
  check("mixed units: a chain stating the literal slip never rewrites a correct value",
    reconciled(writtenSlip, "d").value === 2500, reconciled(writtenSlip, "d"));
  // A literal in the member may be a conversion the chain writes itself:
  // declined as no evidence, never rewritten, and listed as declined.
  const converting = plan(
    [given("g", 9.8, "m/s^2"), given("R", 6.4, "km")],
    [derived("GM", 401408000, "m^3/s^2", "GM = g*(R*1000)^2 = 9.8*(6400)^2 = 401408000")],
  );
  check("mixed units: an explicit conversion keeps the value", reconciled(converting, "GM").value === 401408000, reconciled(converting, "GM"));
  check("mixed units: an explicit conversion valid", liveIssueCodes(converting).length === 0, liveIssueCodes(converting));
  const ambiguous = plan(
    [given("g", 9.8, "m/s^2"), given("R", 6.4, "km")],
    [derived("GM", 401.408, "m^3/s^2", "GM = 1*g*R^2")],
  );
  const ambiguousResult = reconcileTurnPlanV3ExplicitArithmetic(ambiguous);
  check("mixed units: a literal-only reading with a literal in the member is never rewritten",
    (ambiguousResult.plan as ReturnType<typeof plan>).derived[0]?.value === 401.408, ambiguousResult.plan);
  check("mixed units: the decline is reported",
    ambiguousResult.declined.some((item) => item.quantityId === "GM" && item.reason === "mixed_units"), ambiguousResult.declined);
}

// ---------------------------------------------------------------------------
// Formula operands: a number inside a formula is a coefficient, not a
// measurement, even when the letter after it spells a unit ("2C" in
// Q²/(2C) is two times the capacitance, not two coulombs). A number stated
// as a value with a space and no formula around it is still checked.
// ---------------------------------------------------------------------------

{
  const capacitance = given("C", 12, "µF");
  const current = given("I", 15, "mA");
  const time = given("t", 8, "ms");
  const charge = derived("Q", 0.00012, "C", "Q = I t = (0.015)(0.008) = 0.00012 C");
  const voltage = derived("V", 10, "V", "V = Q/C = 0.00012/0.000012 = 10 V");
  const energy = derived("W", 0.0006, "J", "W = ½QV = 0.5(0.00012)(10) = 0.0006 J");
  const claimCodes = (claim: string, expected: Claim["expected"] = true) => issueCodes(plan(
    [capacitance, current, time],
    [charge, voltage, energy],
    [{ id: "stored_energy", claim, expected, relatedQuantityIds: ["Q", "V", "W"] }],
  ));
  const formulas: Array<[string, string, Claim["expected"]]> = [
    ["a coefficient glued to a plan symbol in expected", "The stored energy follows from the charge.", "W = Q²/(2C) = ½CV² = ½QV"],
    ["a coefficient glued to a plan symbol in the claim", "W = Q²/(2C) = ½CV² = ½QV gives 0.6 mJ.", true],
    ["a number after a multiplication sign", "W = Q × 5 V = 0.6 mJ.", true],
    ["a number inside a bracketed operand group", "W = Q²/(2 C) with C the capacitance.", true],
    ["a number before a multiplication sign", "W = ½QV, and 1 C × 1 V = 1 J sets the unit.", true],
  ];
  for (const [name, claim, expected] of formulas) {
    const codes = claimCodes(claim, expected);
    check(`formula operand is not a measurement: ${name}`, !codes.includes("claim_quantity_mismatch"), codes);
  }
  const statements: Array<[string, string]> = [
    ["an equation with a spaced unit", "Q = 2 C"],
    ["a copula", "The charge is 2 C."],
    ["an approximation", "Q ≈ 2 C"],
    ["a spaced unit inside a plain parenthetical", "The capacitor holds a charge (2 C) after 8 ms."],
  ];
  for (const [name, claim] of statements) {
    const codes = claimCodes(claim);
    check(`stated measurement still checked: ${name}`, codes.includes("claim_quantity_mismatch"), codes);
  }
}

// ---------------------------------------------------------------------------
// Claim precision: a claim number matches its quantity rounded at the
// claim's own precision, or truncated there when written to at least three
// significant figures. Nothing looser.
// ---------------------------------------------------------------------------

{
  const speed = (value: number) => derived("v", value, "m/s", `v = ${value}`, { symbol: "v_rms" });
  const claimCodes = (value: number, claim: string) => issueCodes(plan([], [speed(value)], [{
    id: "c1", claim, expected: true, relatedQuantityIds: ["v"],
  }]));
  const accepts: Array<[string, number, string]> = [
    ["3 s.f. truncation with ≈", 483.67, "Using SI units gives v_rms ≈ 483 m/s."],
    ["1 d.p. truncation", 483.67, "The rms speed is v_rms = 483.6 m/s."],
    ["1 d.p. rounding", 483.67, "The rms speed is v_rms = 483.7 m/s."],
    ["3 s.f. rounding with ≈", 483.67, "Result v_rms ≈ 484 m/s at room temperature."],
    ["about, rounded", 483.67, "v_rms is about 484 m/s."],
    ["negative value truncated toward zero", -483.67, "The velocity is v_rms = -483 m/s."],
  ];
  for (const [name, value, claim] of accepts) {
    const codes = claimCodes(value, claim);
    check(`claim precision accepts ${name}`, !codes.includes("claim_quantity_mismatch"), codes);
  }
  const rejects: Array<[string, number, string]> = [
    ["a different number", 20, "The rms speed is v_rms = 12 m/s."],
    ["480.0 for 483.67", 483.67, "The rms speed is v_rms = 480.0 m/s."],
    ["480 for 483.67", 483.67, "The rms speed is v_rms = 480 m/s."],
    ["two figures never truncate", 12.9, "The rms speed is v_rms = 12 m/s."],
    ["two figures with ≈ never truncate", 12.9, "The rms speed is v_rms ≈ 12 m/s."],
    ["truncation only toward zero", 483.62, "The rms speed is v_rms = 483.7 m/s."],
    ["one past the truncation", 483.67, "The rms speed is v_rms = 482 m/s."],
    ["sign flip", 483.67, "The velocity is v_rms = -483 m/s."],
  ];
  for (const [name, value, claim] of rejects) {
    const codes = claimCodes(value, claim);
    check(`claim precision rejects ${name}`, codes.includes("claim_quantity_mismatch"), codes);
  }
}

if (failures.length > 0) {
  console.error(`explicit arithmetic reconcile: ${failures.length} of ${checks} checks failed`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`explicit arithmetic reconcile: ${checks} checks passed`);
