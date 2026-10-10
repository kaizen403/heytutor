/** Deterministic prompt/offer/transport gate; model adherence is measured separately. */
import assert from "node:assert/strict";
import { inferSceneCapabilities } from "../../src/planners/sceneCapabilities";
import { buildSceneDocumentPlannerPrompt, SCENE_DOCUMENT_PLANNER_PROMPT } from "../../src/planners/scenePlannerV2Prompt";
import { planSceneDocument, repairSceneDocument } from "../../src/planners/scenePlannerV2";

let checks = 0;
const failures: string[] = [];
function check(condition: unknown, message: string): void { checks++; if (!condition) failures.push(message); }
const cases = [
 { question: "Draw a hinged rod in its initial and rotated poses, with the support and each applied force.", family: "contact_body", guidance: ["all named bodies", "every requested pose, equilibrium reference and endpoint", "physical application point"], operators: ["rotate", "vector_components"] },
 { question: "Plot y=sin(x) and y=2*sin(x) to compare the two amplitudes.", family: "analytic_curve", guidance: ["every requested trace, mode and comparison state", "own amplitude/endpoints"], operators: ["function_curve"] },
 { question: "Explain the transformer circuit and its primary and secondary coils.", family: "circuit_network", guidance: ["every source, load, instrument and terminal connection", "open/closed states"], operators: ["circle", "rectangle", "polygon", "symbol", "connect"] },
 { question: "Draw the Kirchhoff two-loop circuit with both cells and the shared resistor.", family: "circuit_network", guidance: ["every source, load, instrument and terminal connection", "must not be redrawn as a series chain"], operators: ["kirchhoff_network", "circle", "rectangle", "polygon"] },
 { question: "Explain electric dipole field and superposition at an observation point.", family: "point_field", guidance: ["every named source, observation point and comparison orientation", "each contribution at the observation point, then derive the resultant"], operators: ["rectangle", "polygon", "vector_sum", "vector_scale", "vector_projection"] },
] as const;
const capabilities = cases.map(item => inferSceneCapabilities(item.question, {turnPlan:{visualRequirement:"required",givens:[{value:1}]}}));
const forbidden = ["Choose an unstated charge/current sense once", "Show a reference current sense on every relevant branch", "Show propagation and displacement directions", "E cross B follows propagation"];
for (const [index, item] of cases.entries()) {
 const caps = capabilities[index]!;
 const prompt = buildSceneDocumentPlannerPrompt(item.question, caps);
 check(caps.families.includes(item.family), item.question+": expected family");
 for (const rule of item.guidance) check(prompt.includes(rule), item.question+": "+rule);
 for (const operator of item.operators) {
  check(caps.constructionOperators.includes(operator), item.question+": offer "+operator);
  check(new RegExp(`^- [a-z_/]*${operator}[a-z_/]*: \{`, "m").test(prompt), item.question+": contract "+operator);
 }
 check(prompt.length+800<=24_500, item.question+": initial reserve");
 for (const rule of forbidden) check(!prompt.includes(rule), item.question+": direction treatment is absent: "+rule);
}
for (const rule of ["every requested state, member and view", "one representative per requested state", "Narration cannot replace required geometry"]) check(SCENE_DOCUMENT_PLANNER_PROMPT.includes(rule), "global geometry obligation: "+rule);
check(!SCENE_DOCUMENT_PLANNER_PROMPT.includes("Narration cannot replace required direction"), "global direction treatment is absent");
const em=inferSceneCapabilities("Explain electromagnetic waves and their characteristics.",{turnPlan:{visualRequirement:"required",givens:[{value:1}]}});
check(!em.constructionOperators.includes("space_cross"), "geometry layer alone does not add the transverse direction offer");
for (const rule of [
 "Question/AUTHORITATIVE TURN PLAN are fixed evidence. Copy exact quantity id/value/unit.",
 "Invent no measurements,signs,components,topology or assumptions beyond one symbolic representative.",
 "Display lengths never establish physical values.",
 "source:{question,representationTier:\"qualitative_verified\",nonMetric:true},quantities:[]. Preserve givens.",
 "Invariants/examples are advice; source wins.",
]) check(SCENE_DOCUMENT_PLANNER_PROMPT.includes(rule), "unchanged authority: "+rule);

// Actual request capture proves these obligations survive both transport paths.
// The mocked response is text_only; this gate never treats a mock as adherence evidence.
const candidate={schemaVersion:"scene-document/v2",source:{},visualDecision:{mode:"text_only",reason:"offline transport control"},quantities:[],entities:[],constructions:[],relations:[],assertions:[],annotations:[],requiredEntityIds:[],revealGroups:[],teachingTimeline:[]};
const originalFetch=globalThis.fetch;
const requests:Array<{messages:Array<{content:string}>}>=[];
globalThis.fetch=async (_input,init)=>{requests.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(candidate)}}]}),{status:200});};
try {
 for (const [index,item] of cases.entries()) {
  const offset=requests.length;
  const options={...capabilities[index]!,proxyUrl:"http://planner.test",timeoutMs:2000};
  await planSceneDocument(item.question,options);
  await repairSceneDocument(item.question,candidate,[{code:"incomplete_scene",message:"Retain every named physical member and state.",severity:"fatal"}],options);
  check(requests.length===offset+2,item.question+": initial and repair captured");
  for(const [phase,request] of requests.slice(offset).entries()) {
   const prompt=request.messages.map(message=>message.content).join("\n");
   check(prompt.length<=(phase===0?24_500:27_000),item.question+": transport fixed budget");
   for(const rule of item.guidance) check(prompt.includes(rule),item.question+": obligation survives "+phase+": "+rule);
   for(const rule of forbidden) check(!prompt.includes(rule),item.question+": no direction contamination at "+phase);
  }
 }
} finally {globalThis.fetch=originalFetch;}
assert.equal(failures.length,0,failures.join("\n"));
console.log(`physics geometry contract: ${checks} checks passed (independent offers, authority, positive/negative transport)`);
