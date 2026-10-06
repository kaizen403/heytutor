import { readFileSync } from "node:fs";
import type { ProblemIR, TurnPlanV3 } from "../../../../src/index";

type Entry = number | string;
export type Caller = { id: string; question: string; plan: TurnPlanV3; problemIR: ProblemIR; products: Entry[][][] };
type Fresh = { id: string; names: string[]; left: Entry[][]; right: Entry[][]; products: Entry[][][] };
const literal = (entries: Entry[][]) => JSON.stringify(entries).replaceAll('"', "");
const numeric = (entry: Entry) => typeof entry === "number" ? entry : entry.split("/").map(Number).reduce((n, d) => n / d);
const factor = (entry: Entry) => String(entry).startsWith("-") || String(entry).includes("/") ? `(${entry})` : String(entry);

export const actual = JSON.parse(readFileSync(new URL("actual1304.json", import.meta.url), "utf8")) as {
  question: string; plans: TurnPlanV3[]; problemIR: ProblemIR; rawProblemResponse: object;
};
const legacy = JSON.parse(readFileSync(new URL("../../../../fixtures/matrix-products-live-20261006/actual-runtime.json", import.meta.url), "utf8")) as { plan: TurnPlanV3 };

function freshCaller(fixture: Fresh): Caller {
  const { names, left, right, products } = fixture;
  const quotes = [`${names[0]}=${literal(left)}`, `${names[1]}=${literal(right)}`];
  const productNames = [names.join(""), [...names].reverse().join("")];
  const question = `Let ${quotes[0]} and ${quotes[1]}. Find ${productNames[0]} and ${productNames[1]}.`;
  const facts: ProblemIR["facts"] = [...names, ...productNames].map((name, index) => {
    const quote = quotes[index] ?? name;
    const start = question.indexOf(quote);
    return { id: `f${name}`, kind: index < 2 ? "given" : "requested", statement: index < 2 ? `Matrix ${name} is ${literal(index === 0 ? left : right)}` : name,
      evidence: { source: "question", start, end: start + quote.length, quote } };
  });
  const problemIR: ProblemIR = { schemaVersion: "problem-ir/v1", id: fixture.id.replaceAll("-", "_"), question, facts,
    entities: names.map(name => ({ id: `mat${name}`, kind: "other", label: name, evidenceFactIds: [`f${name}`] })),
    expressions: [], constraints: [], representationIntents: [], solveRequests: [] };
  const plan: TurnPlanV3 = { schemaVersion: "turn-plan/v3", question, givens: [], derived: [], unknowns: productNames.map(name => ({ id: name, symbol: name, unit: "1" })),
    qualitativeClaims: [], lawIds: ["matrix-multiplication"], assumptions: ["Standard row-by-column matrix multiplication over the real numbers"], teachingSequenceHints: [], visualRequirement: "optional" };
  [left, right].forEach((matrix, index) => matrix.forEach((row, i) => row.forEach((entry, j) => {
    const id = `${names[index]}${i + 1}${j + 1}`, value = numeric(entry);
    plan.givens.push({ id, symbol: id, value, unit: "1", sign: value > 0 ? "positive" : value < 0 ? "negative" : "zero", sourceText: quotes[index], provenance: "given", uncertainty: 0 });
  })));
  products.forEach((matrix, index) => matrix.forEach((row, i) => row.forEach((entry, j) => {
    const lhs = index === 0 ? left : right, rhs = index === 0 ? right : left;
    const ordered = index === 0 ? names : [...names].reverse();
    const id = `${productNames[index]}${i + 1}${j + 1}`, value = numeric(entry);
    const dependsOn = lhs[i]!.flatMap((_, k) => [`${ordered[0]}${i + 1}${k + 1}`, `${ordered[1]}${k + 1}${j + 1}`]);
    plan.derived.push({ id, symbol: id, value, unit: "dimensionless", sign: value > 0 ? "positive" : value < 0 ? "negative" : "zero", provenance: "derived", dependsOn, uncertainty: 0,
      sourceText: lhs[i]!.map((v, k) => `${factor(v)}*${factor(rhs[k]![j]!)}`).join("+") + `=${entry}` });
  })));
  productNames.forEach((name, index) => plan.qualitativeClaims.push({ id: `C${index}`, claim: `${name}=${literal(products[index]!)}`, expected: `${name}=${literal(products[index]!)}`,
    relatedQuantityIds: [name, ...plan.derived.filter(row => row.id.startsWith(name)).map(row => row.id)] }));
  const equal = JSON.stringify(products[0]) === JSON.stringify(products[1]);
  plan.qualitativeClaims.push({ id: "local", claim: `${productNames[0]} and ${productNames[1]} ${equal ? "are equal" : "differ"}, so matrix multiplication is ${equal ? "commutative" : "not commutative"} here`,
    expected: `${productNames[0]} ${equal ? "=" : "!="} ${productNames[1]}`, relatedQuantityIds: productNames });
  return { id: fixture.id, question, plan, problemIR, products };
}

export const callers: Caller[] = [
  ...actual.plans.map((plan, index) => ({ id: `actual1304-${index}`, question: actual.question, plan, problemIR: actual.problemIR, products: [[[4, 4], [10, 8]], [[2, 4], [7, 10]]] })),
  ...(JSON.parse(readFileSync(new URL("fresh.json", import.meta.url), "utf8")) as Fresh[]).map(freshCaller),
];

export const planMutations: Record<string, (plan: TurnPlanV3) => void> = {
  literalValue: p => { p.qualitativeClaims[0]!.claim = "AB=[[4,4],[10,9]]"; },
  literalExpected: p => { p.qualitativeClaims[0]!.expected = "AB=[[4,4],[10,9]]"; },
  literalOrder: p => { p.qualitativeClaims[0]!.claim = "BA=[[4,4],[10,8]]"; },
  literalPrefix: p => { p.qualitativeClaims[0]!.claim = "AB=[[4,4],[10,8]] because A is singular"; },
  literalSuffix: p => { p.qualitativeClaims[0]!.expected += "; AB is symmetric"; },
  hiddenAssignment: p => { p.qualitativeClaims[0]!.claim += "; Z=[[0]]"; },
  extraRequest: p => { p.qualitativeClaims[0]!.expected += ". Show A"; },
  coincidentValue: p => { p.qualitativeClaims[0]!.relatedQuantityIds = ["AB", "BA12"]; },
  missingProductJoin: p => { p.qualitativeClaims[0]!.relatedQuantityIds = ["AB11"]; },
  duplicateJoin: p => { p.qualitativeClaims[0]!.relatedQuantityIds!.push("AB"); },
  entityHint: p => { p.qualitativeClaims[0]!.relatedEntityHints = ["A"]; },
  compoundSuffix: p => { p.qualitativeClaims[2]!.claim += " and A is invertible"; },
  compoundFalseConclusion: p => { p.qualitativeClaims[2]!.claim = "AB and BA differ, so matrix multiplication is commutative here"; },
  compoundGlobal: p => { p.qualitativeClaims[2]!.claim = "AB and BA differ, so matrix multiplication is never commutative"; },
  compoundFalseRelation: p => { p.qualitativeClaims[2]!.expected = "AB = BA"; },
  compoundFalseAntecedent: p => { p.qualitativeClaims[2]!.claim = "AB and BA are equal, so matrix multiplication is not commutative here"; },
  compoundWrongJoin: p => { p.qualitativeClaims[2]!.relatedQuantityIds = ["AB11", "BA11"]; },
  extraClaim: p => { p.qualitativeClaims.push({ id: "hidden", claim: "A is invertible", expected: true, relatedQuantityIds: ["AB"] }); },
  lawSuffix: p => { p.lawIds = ["matrix-multiplication; AB=BA"]; },
  lawGlobal: p => { p.lawIds = ["matrix-multiplication-commutative"]; },
  lawExtra: p => { p.lawIds.push("determinant"); },
  assumption: p => { p.assumptions.push("A is invertible"); },
  hints: p => { p.teachingSequenceHints = ["A is invertible"]; },
  sign: p => { p.derived[0]!.sign = "negative"; },
  provenance: p => { p.givens[0]!.provenance = "assumed"; },
  units: p => { p.derived[0]!.unit = "m"; },
  givenSource: p => { p.givens[0]!.sourceText = "A=[[1,2],[3,99]]"; },
  cellSourceCoincidence: p => { p.derived[0]!.sourceText = "2*2=4"; },
  missingDependency: p => { delete p.derived[0]!.dependsOn; },
  wrongDependency: p => { p.derived[0]!.dependsOn![0] = "B11"; },
  duplicateDependency: p => { p.derived[0]!.dependsOn!.push("A11"); },
  givenValue: p => { p.givens[0]!.value = 2; },
  derivedValue: p => { p.derived[0]!.value = 5; },
  missingGiven: p => { p.givens.shift(); },
  missingCell: p => { p.derived.pop(); },
  missingUnknown: p => { p.unknowns.pop(); },
  unknownUnits: p => { p.unknowns[0]!.unit = "m"; },
  unknownSymbol: p => { p.unknowns[0]!.symbol = "BA"; },
  question: p => { p.question += " "; },
  hiddenField: p => { Object.assign(p, { extraAssertion: "A is symmetric" }); },
  cellHiddenField: p => { Object.assign(p.derived[0]!, { evidence: "invented" }); },
  placeholder: p => { p.givens = [{ id: "A", symbol: "A", value: 0, provenance: "given", sourceText: "A=[[1,2],[3,4]]" }]; },
  legacyCapturedPlaceholder: p => { Object.assign(p, structuredClone(legacy.plan)); },
};

export const irMutations: Record<string, (ir: ProblemIR) => void> = {
  missingFact: ir => { ir.facts.pop(); },
  falseStatement: ir => { ir.facts[0]!.statement = "Matrix A is [[1,2],[3,99]]"; },
  span: ir => { ir.facts[0]!.evidence.start++; },
  quote: ir => { ir.facts[0]!.evidence.quote = "A"; },
  source: ir => { Object.assign(ir.facts[0]!.evidence, { source: "assumed" }); },
  missingEntity: ir => { ir.entities.pop(); },
  evidenceJoin: ir => { ir.entities[0]!.evidenceFactIds = ["fB"]; },
  extraEntity: ir => { ir.entities.push({ id: "unknown", kind: "other", label: "Z", evidenceFactIds: ["fA"] }); },
  expression: ir => { ir.expressions.push({ id: "x", valueType: "scalar", root: { kind: "number", value: 4 }, evidenceFactIds: ["fA"] }); },
  constraint: ir => { ir.constraints.push({ id: "c", kind: "symmetric", entityIds: ["matA"], evidenceFactIds: ["fA"] }); },
  intent: ir => { ir.representationIntents.push({ id: "i", kind: "conceptual", entityIds: ["matA"], evidenceFactIds: ["fA"] }); },
  request: ir => { ir.solveRequests.push({ id: "r", kind: "evaluate", expressionId: "x" }); },
  hiddenField: ir => { Object.assign(ir, { extraRequest: "determinant A" }); },
};
