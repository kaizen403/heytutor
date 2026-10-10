import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  compileSceneDocument, pruneUnverifiedSceneAnnotations, validateSceneDocument,
  validateSceneQuantityAgreement, validateTurnPlanV3, type TurnPlanV3,
} from "../../src/index";

const APIs = [{ name: "source", compileSceneDocument, pruneUnverifiedSceneAnnotations, validateSceneDocument, validateSceneQuantityAgreement, validateTurnPlanV3 }];
if (process.argv.includes("--compiled-boundary")) {
  const compiled = await import("../../dist/index.js");
  APIs.push({ name: "compiled", ...compiled });
}
const fixture = JSON.parse(readFileSync(new URL("../../../../data/diagram-eval/v1/exemplars/physics/projectile-motion--1.json", import.meta.url), "utf8")).sceneDocument;
// The existing vector fixture supplies only schema/geometry. These checks
// establish lexical classification, not symbolic truth or topic relevance.
const products = [
  { token: "mg", symbols: [{ symbol: "m", unit: "kg" }, { symbol: "g", unit: "m/s^2" }], result: "F", unit: "N" },
  { token: "ms", symbols: [{ symbol: "m", unit: "kg" }, { symbol: "s", unit: "s" }], result: "P", unit: "kg*s" },
  { token: "nm", symbols: [{ symbol: "n", unit: "1" }, { symbol: "m", unit: "kg" }], result: "M", unit: "kg" },
  { token: "µT", symbols: [{ symbol: "µ", unit: "1" }, { symbol: "T", unit: "N" }], result: "F", unit: "N" },
  { token: "uT", symbols: [{ symbol: "u", unit: "m/s" }, { symbol: "T", unit: "s" }], result: "L", unit: "m" },
  { token: "Mg", symbols: [{ symbol: "M", unit: "kg" }, { symbol: "g", unit: "m/s^2" }], result: "F", unit: "N" },
  { token: "mg", symbols: [{ symbol: "mg", unit: "N" }], result: "F", unit: "N" },
];
let checks = 0;
const ownedPlan = (row: typeof products[number], explicit = true): TurnPlanV3 => ({
  schemaVersion: "turn-plan/v3",
  question: `Let ${row.symbols.map(s => s.symbol).join(" and ")} denote variables, and θ an angle. ${explicit ? `The authored expression is ${row.result}=2*${row.symbols.map(s => s.symbol).join("*")}.` : "Label their products."}`,
  givens: [], unknowns: [...row.symbols.map((s, i) => ({ id: `parameter_${i}`, ...s })), { id: "result", symbol: row.result, unit: row.unit }, { id: "angle", symbol: "θ", unit: "deg" }],
  derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
});
for (const api of APIs) {
  const issues = (plan: TurnPlanV3, text: string, accepted: boolean) => {
    const found = api.validateSceneQuantityAgreement([], plan, [text]);
    if (accepted) assert.deepEqual(found, [], `${api.name}: preserve ${text}`);
    else assert.ok(found.some(i => i.code === "displayed_quantity_unverified"), `${api.name}: reject unsupported measurement ${text}`);
    checks++;
  };
  const scene = (plan: TurnPlanV3, text: string) => {
    const raw = structuredClone(fixture);
    raw.source = { question: plan.question, representationTier: "qualitative_verified", nonMetric: true };
    raw.quantities = [];
    raw.entities.find((e: {id:string}) => e.id === "angle").label = "θ";
    raw.entities.find((e: {id:string}) => e.id === "velocity").label = text;
    raw.annotations.push({ id: "owned_expression", kind: "label", text, targetIds: ["velocity"] });
    raw.teachingTimeline.push({ id: "reveal_expression", action: "annotate", targetId: "owned_expression", dependsOn: [], narrationIntent: "reveal source-owned expression" });
    const validated = api.validateSceneDocument(raw);
    assert(validated.document, JSON.stringify(validated.report.issues));
    return validated.document;
  };
  const preserved = (plan: TurnPlanV3, text: string) => {
    issues(plan, text, true);
    const before = scene(plan, text), after = api.pruneUnverifiedSceneAnnotations(before, plan);
    assert.deepEqual(after, before, `${api.name}: entity, annotation and timeline must preserve ${text}`); checks++;
    assert(api.compileSceneDocument(after).ok, `${api.name}: lexically preserved vector document compiles`); checks++;
  };
  const pruned = (plan: TurnPlanV3, text: string) => {
    issues(plan, text, false);
    const before = scene(plan, text), after = api.pruneUnverifiedSceneAnnotations(before, plan);
    assert.notEqual(after.entities.find(e => e.id === "velocity")?.label, text); checks++;
    assert(!after.annotations.some(a => a.id === "owned_expression")); checks++;
    assert(!after.teachingTimeline.some(a => a.targetId === "owned_expression")); checks++;
    assert.deepEqual(after.entities.map(({label, ...geometry}) => geometry), before.entities.map(({label, ...geometry}) => geometry)); checks++;
  };
  for (const row of products) {
    const plan = ownedPlan(row);
    preserved(plan, `2${row.token}`);
    preserved(plan, `2${row.token} sinθ`);
    preserved(plan, `${row.result}=2${row.token}`);
    // No expression/source certificate for bare tokens merely because their
    // letters also name variables. Full formulas still need owned arguments.
    pruned(ownedPlan(row, false), `2${row.token}`);
    pruned(plan, `2${row.token} sinφ`);
    pruned(plan, `2 ${row.token}`);
  }
  const partial = ownedPlan(products[0]); partial.unknowns = partial.unknowns.filter(q => q.symbol !== "g");
  pruned(partial, "2mg sinθ");
  pruned(ownedPlan(products[0]), "2Mg sinθ");
  const sourceOnly = ownedPlan(products[0], false);
  preserved(sourceOnly, "2mg sinθ");
  const gluedSource = { ...ownedPlan(products[0]), question: "Let m, g and θ denote variables. The expression is F=2mg." };
  preserved(gluedSource, "2mg");
  for (const unit of ["N", undefined]) {
    const separatedSource = ownedPlan(products[0]);
    separatedSource.question = "Let m, g and θ denote variables. The source states F = 2 mg.";
    separatedSource.unknowns = separatedSource.unknowns.map(q => q.symbol === "F" ? { ...q, unit } : q);
    pruned(separatedSource, "2mg");
  }
  const measuredSourceOnly = { ...sourceOnly, question: "The measured mass is 2mg. Let m and g denote variables and θ an angle." };
  pruned(measuredSourceOnly, "2mg");
  pruned({ ...measuredSourceOnly, question: "The measured mass m = 2mg. Let m and g denote variables and θ an angle." }, "m=2mg");
  // Numeric assignment/literal controls retain ordinary unit semantics even
  // when all colliding symbol names are declared in the same plan.
  for (const [unit, symbol, owner] of [["mg", "m", products[0]], ["ms", "t", products[1]], ["nm", "L", products[2]], ["µT", "B", products[3]]] as const) {
    const plan: TurnPlanV3 = { ...ownedPlan(owner, false), question: `The measured ${symbol}=2${unit}. Other declared symbols ${owner.symbols.map(s => s.symbol).join(", ")} and θ are parameters.`, givens: [{ id: "measured", symbol, value: 2, unit, provenance: "given", sourceText: `${symbol}=2${unit}` }] };
    preserved(plan, `2${unit}`); preserved(plan, `${symbol}=2${unit}`);
    pruned(plan, `6${unit}`); pruned(plan, `${symbol}=6${unit}`);
    pruned(plan, `${symbol}=6${unit} sinθ`);
    const claimPlan: TurnPlanV3 = { ...plan, unknowns: [], derived: plan.unknowns.filter(q => q.symbol !== symbol).map(q => ({ ...q, value: 1, provenance: "derived" })) };
    const wrongClaim = api.validateTurnPlanV3({ ...claimPlan, qualitativeClaims: [{ id: "wrong_measurement", claim: `${symbol}=6${unit}`, expected: true, relatedQuantityIds: ["measured"] }] }, plan.question);
    assert(wrongClaim.issues.some(i => i.code === "claim_quantity_mismatch")); checks++;
    const correctClaim = api.validateTurnPlanV3({ ...claimPlan, qualitativeClaims: [{ id: "correct_measurement", claim: `${symbol}=2${unit}`, expected: true, relatedQuantityIds: ["measured"] }] }, plan.question);
    assert(correctClaim.valid, JSON.stringify(correctClaim.issues)); checks++;
    if (unit === "µT") preserved(plan, `${symbol}=2μT`);
  }
}
console.log(`symbolic measurement tokens: ${checks} checks passed across ${APIs.map(a => a.name).join(" + ")}; source ownership, original formula context, real units, pruning and reveal preservation`);
