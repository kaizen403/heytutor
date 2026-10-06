/** F1/F4 only. Independent circle oracle; no caller-IR projection or repair. */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import type * as Engine from "../../src/index";
import type { ExpressionNodeIR, ProblemIR, SceneDocument, TurnPlanV3 } from "../../src/index";

export const question = "Find the centre and radius of circle K 3x^2+3y^2+12x-18y+12=0 and mark point J(1,3).";
const n = (value: number): ExpressionNodeIR => ({ kind: "number", value });
const v = (name: string): ExpressionNodeIR => ({ kind: "variable", name });
const b = (operator: "+" | "-" | "*" | "/" | "^", left: ExpressionNodeIR, right: ExpressionNodeIR): ExpressionNodeIR => ({ kind: "binary", operator, left, right });
const cx = b("/", { kind: "unary", operator: "-", operand: n(12) }, b("*", n(2), n(3)));
const cy = b("/", { kind: "unary", operator: "-", operand: n(-18) }, b("*", n(2), n(3)));
const rs = b("-", b("+", b("^", cx, n(2)), b("^", cy, n(2))), b("/", n(12), n(3)));
const polynomial = b("+", b("-", b("+", b("+", b("*", n(3), b("^", v("x"), n(2))), b("*", n(3), b("^", v("y"), n(2)))), b("*", n(12), v("x"))), b("*", n(18), v("y"))), n(12));
const span = (quote: string) => ({ source: "question" as const, start: question.indexOf(quote), end: question.indexOf(quote) + quote.length, quote });
export function independentProblem(): ProblemIR {
  const eq = "3x^2+3y^2+12x-18y+12=0";
  const p: ProblemIR = { schemaVersion: "problem-ir/v1", id: "independent_circle_domain", question,
    facts: [{ id: "eq", kind: "given", statement: eq, evidence: span(eq) },
      { id: "ask", kind: "requested", statement: "Find the centre and radius", evidence: span("Find the centre and radius") },
      { id: "point", kind: "given", statement: "J(1,3)", evidence: span("J(1,3)") }],
    entities: [{ id: "K", kind: "curve", label: "K", evidenceFactIds: ["eq"] }, { id: "J", kind: "point", label: "J", evidenceFactIds: ["point"] }],
    expressions: [], constraints: [{ id: "incident", kind: "incident", entityIds: ["J", "K"], evidenceFactIds: ["point"] }],
    solveRequests: [], representationIntents: [{ id: "graph", kind: "graph", entityIds: ["K", "J"], evidenceFactIds: ["eq", "point"] }] };
  for (const [id, root, symbol, unit] of [["hx", cx, "h", "coordinate"], ["ky", cy, "k", "coordinate"], ["rr", { kind: "call", function: "sqrt", argument: rs }, "r", "length"]] as const) {
    p.expressions.push({ id, root: structuredClone(root), valueType: "scalar", evidenceFactIds: ["eq"] });
    p.solveRequests.push({ id: `solve_${id}`, kind: "evaluate", expressionId: id, resultBinding: { turnPlanQuantityId: id, symbol, unit, evidenceFactIds: ["ask"] } });
  }
  return p;
}
export function independentPlan(): TurnPlanV3 {
  const derived: TurnPlanV3["derived"] = [
    { id: "hx", symbol: "h", value: -2, unit: "coordinate", provenance: "derived" },
    { id: "ky", symbol: "k", value: 3, unit: "coordinate", provenance: "derived" },
    { id: "rr", symbol: "r", value: 3, unit: "length", provenance: "derived" },
  ];
  return { schemaVersion: "turn-plan/v3", question, givens: [], derived, unknowns: derived.map(({ id, symbol, unit }) => ({ id, symbol, unit })), qualitativeClaims: [], assumptions: [], lawIds: [], visualRequirement: "required" };
}
export const divisionCases: Array<{ text: string; root: ExpressionNodeIR; valid: boolean }> = [
  { text: "0/0", root: b("/", n(0), n(0)), valid: false },
  { text: "(x-x)/0", root: b("/", b("-", v("x"), v("x")), n(0)), valid: false },
  { text: "0/(y-y)", root: b("/", n(0), b("-", v("y"), v("y"))), valid: false },
  { text: "(x-x)/(y-y)", root: b("/", b("-", v("x"), v("x")), b("-", v("y"), v("y"))), valid: false },
  { text: "0/x", root: b("/", n(0), v("x")), valid: false },
  { text: "0/(x-x+1-1)", root: b("/", n(0), b("-", b("+", b("-", v("x"), v("x")), n(1)), n(1))), valid: false },
  { text: "0*(1/(y-y))", root: b("*", n(0), b("/", n(1), b("-", v("y"), v("y")))), valid: false },
  { text: "x/x-1", root: b("-", b("/", v("x"), v("x")), n(1)), valid: false },
  { text: "0/7", root: b("/", n(0), n(7)), valid: true },
  { text: "(x-x)/(-2)", root: b("/", b("-", v("x"), v("x")), n(-2)), valid: true },
  { text: "0/(x-x+3)", root: b("/", n(0), b("+", b("-", v("x"), v("x")), n(3))), valid: true },
];
export function withDivision(root: ExpressionNodeIR): ProblemIR {
  const p = independentProblem();
  p.expressions.push({ id: "domain_expression", valueType: "function", root: b("+", structuredClone(polynomial), structuredClone(root)), evidenceFactIds: ["eq"] });
  return p;
}
export const suffixes = [" with radius 4.", " and mark point J(2,3).", " Also determine its tangent at J.", " Also find the area.", " and plot the line y=3.", " in metres."];

async function main() {
  const override = process.argv.indexOf("--api");
  const apis: Array<[string, typeof Engine]> = override >= 0
    ? [["base", await import(pathToFileURL(process.argv[override + 1]!).href)]]
    : [["TS", await import("../../src/index")], ["ESM", await import("../../dist/index.js")]];
  let checks = 0, failures = 0;
  const check = (name: string, actual: unknown, expected: unknown): void => {
    checks++;
    const pass = JSON.stringify(actual) === JSON.stringify(expected);
    if (!pass) failures++;
    console.log(JSON.stringify({ name, actual, expected, pass }));
  };
  const mathOverride = process.argv.indexOf("--math");
  const math = mathOverride >= 0 ? await import(pathToFileURL(process.argv[mathOverride + 1]!).href) : await import("../../src/ir/circleSourceMath");
  for (const c of divisionCases) {
    for (const [label, evaluate] of [["source math", () => math.polynomialOfSource(c.text)], ["IR math", () => math.polynomialOfIR(c.root)]] as const) {
      let accepted = false;
      try { accepted = evaluate().size === 0; } catch { /* refusal expected for invalid domains */ }
      check(`${label} ${c.text}`, accepted, c.valid);
    }
  }
  for (const [label, api] of apis) {
    const p = independentProblem(), before = JSON.stringify(p);
    const bound = api.bindCircleSourceProblem(question, p);
    check(`${label} independent full IR schema`, api.validateProblemIR(p, question).valid, true);
    check(`${label} original complete object retained`, bound?.problem === p, true);
    check(`${label} caller unchanged`, JSON.stringify(p), before);
    const reading = api.readCircleSourceProgram(question);
    check(`${label} independent oracle`, reading.status === "ok" ? [reading.source.center.x, reading.source.center.y, reading.source.radius, reading.source.points[0]?.position] : reading.status, [-2, 3, 3, "on"]);
    assert.ok(bound, "independent positive must exist to exercise negatives");
    const doc = bound.document;
    const compiled = api.compileSceneDocument(doc, { sourceAuthority: { question, problemIR: p } });
    check(`${label} positive compile`, compiled.ok, true);
    check(`${label} physical J`, compiled.renderScene?.primitives.some(mark => mark.entityId === "circle_point_0" && mark.kind !== "label"), true);
    check(`${label} J coordinates`, doc.constructions.find(c => c.outputs.includes("circle_point_0"))?.inputs, { x: 1, y: 3 });
    check(`${label} J caption`, compiled.renderScene?.primitives.some(mark => mark.kind === "label" && mark.text === "J(1,3)"), true);
    check(`${label} full IR normal`, !!api.synthesizeFamilyScene({ question, problemIR: p }), true);
    check(`${label} source absent IR direct`, !!api.circleSourceDocument(question), true);
    check(`${label} source absent IR normal`, !!api.synthesizeFamilyScene({ question }), true);
    for (const [q, center, radius] of [
      ["Draw the circle x^2+y^2=25.", [0, 0], 5],
      ["Draw the circle (x-3)^2+(y+2)^2=16.", [3, -2], 4],
      ["Draw the circle K with centre C(1/2,-2) and radius 3/2.", [.5, -2], 1.5],
      ["Draw the circle x^2+y^2=0.", [0, 0], 0],
    ] as const) {
      const r = api.readCircleSourceProgram(q), scene = api.synthesizeFamilyScene({ question: q });
      check(`${label} standard source ${q}`, r.status === "ok" ? [r.source.center.x, r.source.center.y, r.source.radius] : r.status, [...center, radius]);
      check(`${label} standard normal ${q}`, !!scene, true);
      check(`${label} standard compile ${q}`, scene ? api.compileSceneDocument(scene.document, { sourceAuthority: { question: q } }).ok : false, true);
    }
    for (const c of divisionCases) {
      const mutated = withDivision(c.root), original = JSON.stringify(mutated);
      check(`${label} domain schema ${c.text}`, api.validateProblemIR(mutated, question).valid, true);
      check(`${label} full IR bind ${c.text}`, !!api.bindCircleSourceProblem(question, mutated), c.valid);
      check(`${label} full IR normal ${c.text}`, !!api.synthesizeFamilyScene({ question, problemIR: mutated }), c.valid);
      check(`${label} full IR compile ${c.text}`, api.compileSceneDocument(doc, { sourceAuthority: { question, problemIR: mutated } }).ok, c.valid);
      check(`${label} original graph preserved ${c.text}`, JSON.stringify(mutated), original);
      const q = `Draw the circle x^2+y^2=25+(${c.text}).`;
      check(`${label} whole source domain ${c.text}`, api.readCircleSourceProgram(q).status, c.valid ? "ok" : "declined");
      if (!c.valid) {
        for (const implicit of [`x^2+y^2=25+(${c.text}).`, `x^2+y^2+(${c.text})=25.`]) {
          check(`${label} implicit undefined circle ${implicit}`, api.readCircleSourceProgram(implicit).status, "declined");
          check(`${label} implicit undefined source guard ${implicit}`, api.validateSceneSourceAuthority(doc, implicit).some(i => i.severity === "fatal"), true);
          check(`${label} implicit undefined compile ${implicit}`, api.compileSceneDocument(doc, { sourceAuthority: { question: implicit } }).ok, false);
        }
      }
    }
    for (const suffix of suffixes) {
      const q = question + suffix;
      check(`${label} reader terminal ${suffix}`, api.readCircleSourceProgram(q).status, "declined");
      check(`${label} normal terminal ${suffix}`, api.synthesizeFamilyScene({ question: q }), null);
      check(`${label} last resort terminal ${suffix}`, api.synthesizeLastResortScene({ question: q }), null);
      for (const raw of [undefined, { ...p, question: q }]) {
        // Actual question owns admission even when submitted source is stale or absent.
        for (const source of [{ question }, {}]) {
          const old: SceneDocument = structuredClone(doc); old.source = source;
          old.entities.find(e => e.id === "circle_point_0")!.label = "P(1,3)";
          check(`${label} old partial source guard ${suffix} IR=${!!raw} marker=${!!source.question}`, api.validateSceneSourceAuthority(old, q, raw).some(i => i.code === "circle_source_declined" && i.severity === "fatal"), true);
          check(`${label} old partial compile ${suffix} IR=${!!raw} marker=${!!source.question}`, api.compileSceneDocument(old, { sourceAuthority: { question: q, problemIR: raw } }).ok, false);
        }
      }
    }
    for (const q of [
      "A stone moves in a horizontal circle of radius 0.8 m with a period of 2 s. Find its speed.",
      "A particle moves in a circle through P(0,0) with speed v=2. Find its acceleration.",
      "Find the area of a circle with radius 3.",
      "Find the distance from P(0,0) to the line 3x+4y-25=0.",
      "Draw x^2/4+y^2/9=1.", "Draw x^2/4-y^2/9=1.",
      "Draw x^2/a^2+y^2/b^2=1.", "Find the centre of x^2/4+y^2/9=1.",
    ]) {
      check(`${label} unrelated source ${q}`, api.readCircleSourceProgram(q).status, "none");
      check(`${label} no circle decline for unrelated ${q}`, api.validateSceneSourceAuthority(doc, q).some(i => i.code === "circle_source_declined"), false);
    }
  }
  console.log(`circle-domain-decline: checks=${checks} failures=${failures}; READY=0 accepted=0`);
  if (failures) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error); process.exitCode = 1; });
