/** Independent external caller profiles from the review; no production reader,
 * fixture projection or document ever constructs the asserted IR/Plan/answers.
 * Run source with pnpm exec tsx; built public ESM with node --experimental-strip-types --esm.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { measureTextInkBounds } from "@heytutor/drawing";
import type { ExpressionNodeIR, ProblemIR, TurnPlanV3, SceneDocument, QuestionSourceEvidence } from "../../src/index";
const e = process.argv.includes("--esm") ? await import("../../dist/index.js") : await import("../../src/index.ts");
type Profile = { id: string; q: string; seq: string; roles: Array<{quote: string; symbol: string; value: number}>; asks: Array<{token: string; root: ExpressionNodeIR; value: number}> };
type Caller = {q: string; ir: ProblemIR; plan: TurnPlanV3};
let checks = 0;
function check(value: unknown, message: string): asserts value { checks++; assert(value, message); }
function equal(actual: unknown, expected: unknown, message: string): void { checks++; assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)), message); }
const N=(value: number): ExpressionNodeIR=>({kind:'number',value}),V=(name: string): ExpressionNodeIR=>({kind:'variable',name});
const B=(operator: "+"|"-"|"*"|"/"|"^",left: ExpressionNodeIR,right: ExpressionNodeIR): ExpressionNodeIR=>({kind:'binary',operator,left,right});
const term=(kind: string,a: ExpressionNodeIR,p: ExpressionNodeIR,n: number): ExpressionNodeIR=>kind==='arithmetic'?B('+',a,B('*',B('-',N(n),N(1)),p)):B('*',a,B('^',p,B('-',N(n),N(1))));
const sum=(kind: string,a: ExpressionNodeIR,p: ExpressionNodeIR,n: number): ExpressionNodeIR=>n===0?N(0):kind==='arithmetic'?B('/',B('*',N(n),B('+',B('*',N(2),a),B('*',B('-',N(n),N(1)),p))),N(2)):B('/',B('*',a,B('-',N(1),B('^',p,N(n)))),B('-',N(1),p));
function make(c: Profile): Caller {
 const q=c.q,span=(quote: string): QuestionSourceEvidence=>{const start=q.indexOf(quote);assert(start>=0);return {source:'question',start,end:start+quote.length,quote};};
 const prefix=q.slice(0,q.indexOf('Find ')).trim();
 const ir: ProblemIR={schemaVersion:'problem-ir/v1',id:'reviewProblem',question:q,facts:[{id:'model',kind:'given',statement:prefix,evidence:span(prefix)}],entities:[{id:'sequence',kind:'other',label:c.seq+'_n',evidenceFactIds:['model']}],expressions:[],constraints:[],representationIntents:[{id:'table',kind:'conceptual',entityIds:['sequence'],evidenceFactIds:['model']}],solveRequests:[]};
 const plan: TurnPlanV3={schemaVersion:'turn-plan/v3',question:q,givens:[],unknowns:[],derived:[],qualitativeClaims:[],lawIds:[],assumptions:[],visualRequirement:'required'};
 for(const [i,r] of c.roles.entries()){
  const fact='given'+i;ir.facts.push({id:fact,kind:'given',statement:r.quote,evidence:span(r.quote)});
  ir.expressions.push({id:'givenRoot'+i,valueType:'scalar',root:N(r.value),evidenceFactIds:[fact]},{id:'givenTarget'+i,valueType:'scalar',root:V(r.symbol),evidenceFactIds:[fact]});
  ir.constraints.push({id:'equation'+i,kind:'equation',leftExpressionId:'givenTarget'+i,rightExpressionId:'givenRoot'+i,evidenceFactIds:[fact]});
  plan.givens.push({id:'g'+i,symbol:r.symbol,value:r.value,unit:'1',provenance:'given',sourceText:r.quote});
 }
 for(const [i,a] of c.asks.entries()){
  const fact='ask'+i;const start=q.indexOf(a.token,q.indexOf('Find '));ir.facts.push({id:fact,kind:'requested',statement:'Compute '+a.token,evidence:{source:'question',start,end:start+a.token.length,quote:a.token}});
  ir.expressions.push({id:'expr'+i,valueType:'scalar',root:a.root,evidenceFactIds:[fact]});
  const quantity={id:'answer'+i,symbol:a.token,unit:'1'};
  plan.unknowns.push(quantity);plan.derived.push({...quantity,value:a.value,provenance:'derived'});
  ir.solveRequests.push({id:'request'+i,kind:'evaluate',expressionId:'expr'+i,resultBinding:{turnPlanQuantityId:quantity.id,symbol:quantity.symbol,unit:'1',evidenceFactIds:[fact]}});
 }
 return {q,ir,plan};
}
const role=(quote: string,symbol: string,value: number)=>({quote,symbol,value}),ask=(token: string,root: ExpressionNodeIR,value: number)=>({token,root,value});
const recoverP=B('/',B('-',N(9),N(0)),N(3)),recoverA=B('-',N(0),B('*',N(1),recoverP));
const insertionP=B('/',B('-',N(6),N(-6)),N(4));
const posP=B('^',B('/',N(32),N(2)),B('/',N(1),N(4))),negP: ExpressionNodeIR={kind:'unary',operator:'-',operand:posP};
const cases: Profile[]=[
 {id:'direct-ap-zero',q:'Let x_n be an arithmetic progression with x_1 = -4 and common difference 2. Find x_3, sum_{k=1}^4 x_k, sum_{k=1}^0 x_k.',seq:'x',roles:[role('x_1 = -4','x_1',-4),role('common difference 2','d',2)],asks:[ask('x_3',term('arithmetic',N(-4),N(2),3),0),ask('sum_{k=1}^4 x_k',sum('arithmetic',N(-4),N(2),4),-4),ask('sum_{k=1}^0 x_k',N(0),0)]},
 {id:'direct-gp-zero-ratio',q:'Let b_n be a geometric progression with b_1 = 6 and common ratio 0. Find b_1, b_4, sum_{k=1}^4 b_k.',seq:'b',roles:[role('b_1 = 6','b_1',6),role('common ratio 0','r',0)],asks:[ask('b_1',term('geometric',N(6),N(0),1),6),ask('b_4',term('geometric',N(6),N(0),4),0),ask('sum_{k=1}^4 b_k',sum('geometric',N(6),N(0),4),6)]},
 {id:'recover-ap-zero-observation',q:'Recover arithmetic progression c_n from c_2 = 0 and c_5 = 9. Find c_1, c_4, sum_{k=1}^4 c_k.',seq:'c',roles:[role('c_2 = 0','c_2',0),role('c_5 = 9','c_5',9)],asks:[ask('c_1',term('arithmetic',recoverA,recoverP,1),-3),ask('c_4',term('arithmetic',recoverA,recoverP,4),6),ask('sum_{k=1}^4 c_k',sum('arithmetic',recoverA,recoverP,4),6)]},
 {id:'insert-ap-zero-sum',q:'Insert 3 arithmetic means between -6 and 6. Find a_2, sum_{k=1}^5 a_k.',seq:'a',roles:[role('between -6','a_1',-6),role('and 6','a_5',6),role('Insert 3','m',3)],asks:[ask('a_2',term('arithmetic',N(-6),insertionP,2),-3),ask('sum_{k=1}^5 a_k',sum('arithmetic',N(-6),insertionP,5),0)]},
 {id:'insert-gp-both-branches',q:'Insert 3 geometric means between 2 and 32, using all_real ratio branches. Find a_2[positive], a_2[negative], sum_{k=1}^5 a_k[positive], sum_{k=1}^5 a_k[negative].',seq:'a',roles:[role('between 2','a_1',2),role('and 32','a_5',32),role('Insert 3','m',3)],asks:[ask('a_2[positive]',term('geometric',N(2),posP,2),4),ask('a_2[negative]',term('geometric',N(2),negP,2),-4),ask('sum_{k=1}^5 a_k[positive]',sum('geometric',N(2),posP,5),62),ask('sum_{k=1}^5 a_k[negative]',sum('geometric',N(2),negP,5),22)]},
];

function admitted(c: Caller) {
  const result = e.finiteProgressionSourceProgram(c.q, c.ir, c.plan);
  check(result.status === "ok", result.status === "declined" ? result.reason : "admission");
  equal(result.problem, c.ir, "retain whole actual IR");
  equal(result.plan, c.plan, "retain whole external Plan");
  return result;
}
function options(c: Caller) { return {sourceAuthority: {question: c.q, problemIR: c.ir, turnPlan: c.plan}}; }
function positive(c: Caller, expected: number[]) {
  const program = admitted(c);
  equal(program.bindings.map(binding => binding.ask.value), expected, "independent answers");
  const compiled = e.compileSceneDocument(program.document, options(c));
  check(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
  const labels = compiled.renderScene.primitives.filter(primitive => primitive.kind === "label");
  const ink = labels.map(label => {
    const bounds = label.provenance?.labelBounds as {x: number; y: number; width: number; height: number};
    const font = Number(label.provenance?.fontPx ?? 24);
    check(font >= 19 && bounds && bounds.x >= 400 && bounds.y >= 0 && bounds.x + bounds.width <= 1160 && bounds.y + bounds.height <= 700, "ordinary board font and viewport");
    return measureTextInkBounds(label.text!, bounds.x + 4, bounds.y + 4, font) ?? bounds;
  });
  for (let i = 0; i < ink.length; i++) for (let j = i + 1; j < ink.length; j++) {
    const a = ink[i]!, b = ink[j]!;
    check(a.x + a.width <= b.x + 1e-6 || b.x + b.width <= a.x + 1e-6 || a.y + a.height <= b.y + 1e-6 || b.y + b.height <= a.y + 1e-6, `independent ink clearance ${labels[i]!.id}/${labels[j]!.id}`);
  }
  check(e.synthesizeFamilyScene({question: c.q, problemIR: c.ir, turnPlan: c.plan})?.tier === "exact_verified", "normal family");
  equal(e.validateSceneSourceAuthority(program.document, c.q, c.ir, c.plan), [], "central source guard");
  const restored = JSON.parse(JSON.stringify(program.document)) as SceneDocument;
  equal(e.validateFiniteProgressionSourceDocument(restored, c.q, c.ir, c.plan), [], "read/restore source guard");
  equal(e.compileSceneDocument(restored, options(c)).renderScene, compiled.renderScene, "roundtrip ink");
  for (const binding of program.bindings) {
    check(compiled.renderScene.primitives.some(primitive => primitive.provenance?.quantityId === binding.quantityId && primitive.provenance?.requestId === binding.requestId && primitive.provenance?.symbol === binding.symbol && primitive.provenance?.sourceSymbol === binding.ask.symbol), "original request/quantity IDs and Plan/IR symbols survive");
  }
  return {program, compiled};
}
function rejects(c: Caller, mutate: (caller: Caller) => void, name: string): void {
  const original = admitted(c), bad = structuredClone(c); mutate(bad);
  check(e.validateProblemIR(bad.ir, bad.q).valid, `${name}: attack remains typed whole IR`);
  check(e.validateTurnPlanV3(bad.plan, bad.q).valid, `${name}: attack retains actual external Plan`);
  // Attempt NEW candidate generation from the changed actual caller, rather
  // than only comparing an old document to a changed authority profile.
  const regenerated = e.finiteProgressionSourceProgram(bad.q, bad.ir, bad.plan);
  check(regenerated.status === "declined", `${name}: regenerated candidate admitted`);
  check(e.synthesizeFamilyScene({question: bad.q, problemIR: bad.ir, turnPlan: bad.plan}) === null, `${name}: family admitted`);
  // Even a caller that stores the mutated profile cannot authorize stale ink.
  const candidate = structuredClone(original.document);
  candidate.source.problemIR = bad.ir; candidate.source.turnPlan = bad.plan;
  const compiled = e.compileSceneDocument(candidate, options(bad));
  check(!compiled.ok && compiled.renderScene === null && compiled.report.stats.primitiveCount === 0, `${name}: atomic compiler`);
  check(!e.validateSceneDocument(candidate, options(bad)).document, `${name}: document admission`);
  check(e.validateSceneSourceAuthority(candidate, bad.q, bad.ir, bad.plan).length > 0, `${name}: central source guard`);
  check(e.validateFiniteProgressionSourceDocument(JSON.parse(JSON.stringify(candidate)), bad.q, bad.ir, bad.plan).length > 0, `${name}: read/restore guard`);
  console.log(`${name}: declined; family null; compiler 0 ink; source/read guards reject`);
}

const callers = cases.map(make);
for (let i = 0; i < 4; i++) positive(callers[i]!, cases[i]!.asks.map(ask => ask.value));
const base = callers[0]!;
rejects(base, c => {c.ir.facts[0]!.statement = "The common difference is 99, not 2.";}, "R1 contradictory premise");
rejects(base, c => {c.ir.facts.find(fact => fact.id === "ask0")!.statement = "Find x_3 and prove convergence of the infinite series.";}, "R1 hidden infinite ask");
rejects(base, c => {c.ir.facts.push({id: "unmodeledPremise", kind: "given", statement: "All terms are strictly positive and the common difference is 99.", evidence: structuredClone(c.ir.facts[0]!.evidence)});}, "R1 unused false given");
rejects(base, c => {c.ir.facts.push({...structuredClone(c.ir.facts[0]!), id: "unusedTrueQuote"});}, "unused legitimate whole quote");
rejects(base, c => {c.ir.facts.push({...structuredClone(c.ir.facts[0]!), id: "intentOnly"}); c.ir.representationIntents[0]!.evidenceFactIds.push("intentOnly");}, "intent padding is not a proved dependency");
rejects(base, c => {const fact = c.ir.facts.find(fact => fact.id === "given1")!; fact.statement = "x_1 = -4"; fact.evidence = structuredClone(c.ir.facts[0]!.evidence);}, "broad quote cannot borrow another role");
rejects(base, c => {c.ir.expressions.find(expression => expression.id === "expr0")!.root = N(0);}, "same-answer constant cannot prove source AST");
rejects(base, c => {c.ir.constraints[0]!.evidenceFactIds.push("given1");}, "unrelated fact cannot pad equation dependency");
rejects(base, c => {c.ir.facts.find(fact => fact.id === "given1")!.statement = "common difference 2 and every term is positive";}, "valid clause cannot hide extra premise");
rejects(base, c => {c.ir.facts[0]!.statement = "Let x_n be a geometric progression with x_1 = -4 and common ratio 2.";}, "equal scalar cannot change model semantics");
rejects(base, c => {c.ir.facts.find(fact => fact.id === "ask0")!.statement = "Compute sum_{k=1}^0 x_k";}, "equal zero cannot change requested role");
rejects(base, c => {const fact = c.ir.facts.find(fact => fact.id === "given0")!; const quote = "x_1 = -4 and common"; const start = c.q.indexOf(quote); fact.statement = quote; fact.evidence = {source: "question", start, end: start + quote.length, quote};}, "clipped given quote is not a complete premise");
rejects(base, c => {const fact = c.ir.facts.find(fact => fact.id === "ask0")!; const quote = "x_3, sum_{k"; const start = c.q.indexOf(quote); fact.statement = quote; fact.evidence = {source: "question", start, end: start + quote.length, quote};}, "clipped requested quote is not a complete ask");

const paraphrase = structuredClone(base);
paraphrase.ir.facts[0]!.statement = "x_n is an arithmetic progression with x_1 = -4 and common difference 2.";
paraphrase.ir.facts.find(fact => fact.id === "given1")!.statement = "Given common difference 2.";
paraphrase.ir.facts.find(fact => fact.id === "ask0")!.statement = "Evaluate x_3.";
positive(paraphrase, [0, -4, 0]);
const broad = structuredClone(base), askStart = broad.q.indexOf("Find ");
for (const fact of broad.ir.facts.filter(fact => fact.kind === "requested")) {
  fact.evidence = {source: "question", start: askStart, end: broad.q.length, quote: broad.q.slice(askStart)};
}
positive(broad, [0, -4, 0]);
// One complete quoted requested sentence may cover all three actual requests.
const whole = structuredClone(broad), asked = whole.ir.facts.filter(fact => fact.kind === "requested");
asked[0]!.statement = asked[0]!.evidence.quote;
for (const expression of whole.ir.expressions) if (expression.id.startsWith("expr")) expression.evidenceFactIds = ["ask0"];
whole.ir.solveRequests.forEach(request => {request.resultBinding!.evidenceFactIds = ["ask0"];});
whole.ir.facts = whole.ir.facts.filter(fact => fact.kind === "given" || fact.id === "ask0");
positive(whole, [0, -4, 0]);
const broadBad = structuredClone(broad);
rejects(broadBad, c => {c.ir.facts.find(fact => fact.id === "ask0")!.statement = "Find x_3 and prove convergence of the infinite series.";}, "whole quote cannot hide unsupported request");

const sums = make({...cases[4]!, q: "Insert 3 geometric means between 2 and 32, using all_real ratio branches. Find sum_{k=1}^5 a_k[positive], sum_{k=1}^5 a_k[negative].", asks: cases[4]!.asks.slice(2)});
// Direct enumeration is independent of the source reader and GP sum AST.
equal([2, 4, 8, 16, 32].reduce((a, b) => a + b, 0), 62, "positive branch enumeration");
equal([2, -4, 8, -16, 32].reduce((a, b) => a + b, 0), 22, "negative branch enumeration");
const result = positive(sums, [62, 22]);
const labels = result.compiled.renderScene!.primitives.filter(primitive => primitive.entityId.startsWith("result_"));
equal(labels.map(label => label.text), ["S_5(a;r>0)=62", "S_5(a;r<0)=22"], "R2 visible ratio branch identity");
check(labels.every(label => label.text!.length <= 16 && Number(label.provenance?.fontPx ?? 24) >= 19), "R2 compact readable board labels at compiler's ordinary 24px font");
console.log(`R2 visible labels: ${labels.map(label => label.text).join("; ")}`);
rejects(sums, c => {c.ir.facts.find(fact => fact.id === "ask0")!.statement = "Compute sum_{k=1}^5 a_k[negative]";}, "statement cannot swap ratio branch");

// Preserve the independent positive profile as a visible layout gap. Stats
// count internal candidates; renderScene is the actual atomic ink boundary.
const layout = callers[4]!, layoutProgram = admitted(layout);
const layoutResult = e.compileSceneDocument(layoutProgram.document, options(layout));
check(!layoutResult.ok && layoutResult.renderScene === null, "positive GP layout failure still returns no scene");
equal(layoutProgram.bindings.map(binding => binding.ask.value), [4, -4, 62, 22], "layout gap retains correct actual results");
check(layoutResult.report.issues.some(issue => issue.code === "label_overlap_unresolved" && issue.entityIds?.includes("result_0")), "preserve independent pinned term overlap");
check(e.synthesizeFamilyScene({question: layout.q, problemIR: layout.ir, turnPlan: layout.plan}) === null, "layout failure remains a family gap");
console.log(`Independent positive GP layout gap unchanged: returnedInk=0; internalPrimitiveCount=${layoutResult.report.stats.primitiveCount}; issues=${JSON.stringify(layoutResult.report.issues)}`);

const native = JSON.parse(readFileSync(new URL("./fixtures/w3-progression-source/native-sources.json", import.meta.url), "utf8")) as {cases: Array<{question_options_and_source_answer_verbatim: string; verbatim_question_block_sha256: string}>};
for (const c of native.cases) {
  equal(createHash("sha256").update(c.question_options_and_source_answer_verbatim).digest("hex"), c.verbatim_question_block_sha256, "frozen native raw/hash");
  check(e.readFiniteProgressionSource(c.question_options_and_source_answer_verbatim).status === "declined", "raw OCR remains an explicit gap");
}
let a = 7, t = 3, running = 0;
for (let n = 1; n <= 30; n++) { running += t; if (n === 20) equal(t, 1504, "independent cumulative T20"); t += a; a += 8; }
equal(running, 35615, "independent cumulative sum30");
console.log(`W3 progression review fixes: ${checks} checks PASS; offline bounded evidence; integration pending`);
