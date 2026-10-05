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
 * - a claim number stated for a linked quantity must be its value; a number
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

if (failures.length > 0) {
  console.error(`explicit arithmetic reconcile: ${failures.length} of ${checks} checks failed`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`explicit arithmetic reconcile: ${checks} checks passed`);
