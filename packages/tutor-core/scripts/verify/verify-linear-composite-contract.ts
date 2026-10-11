import assert from "node:assert/strict";
import { selectConstructionInputContracts } from "../../src/planners/scenePlannerV2Prompt";
import { planSceneDocumentWithRepair } from "../../src/planners/scenePlannerV2";

const operators = ["number_line_set", "linear_half_plane", "linear_feasible_region", "linear_system"];
function verifyContract(prompt: string): void {
  assert.match(prompt, /engine emits axes and every named source point/i, "contract must describe engine-owned original points, not merely forbid extras");
  assert.ok(prompt.includes("annotations:[]"), "membership narration must not become a protected scene annotation");
  assert.match(prompt, /membership.*teaching stream/i, "solved membership belongs in verified teaching, not authored figure claims");
  assert.match(prompt, /one comparison.*literal.*no quantity IDs or chains/i, "number-line leaves must be actual original comparisons");
}
for (const detailed of [undefined, [], operators]) verifyContract(selectConstructionInputContracts(operators, detailed));
const originalFetch = globalThis.fetch;
let requests = 0;
globalThis.fetch = async (_url, options) => {
  requests++;
  const messages=JSON.parse(String(options?.body)).messages as Array<{content?:string}>;
  verifyContract(messages.map(message=>message.content??"").join("\n"));
  assert.ok(messages.reduce((count,message)=>count+(message.content?.length??0),0)<=27_000, "existing transport budget preserved");
  return Response.json({choices:[{message:{content:JSON.stringify({repaired:requests>2,constructions:[{id:"build",operator:"linear_half_plane",inputs:{inequality:"x+2y<6"},outputs:["region"]}]})}}]});
};
try {
  const result = await planSceneDocumentWithRepair("Graph x+2y<6. Mark P=(1,1).", candidate => candidate.repaired===true ? {valid:true,errors:[]} : {valid:false,errors:[{code:"linear_source_mismatch",message:"Linear figure marks must all be emitted by verified linear operators",severity:"fatal"}]}, {proxyUrl:"http://mock.invalid",timeoutMs:1000,constructionOperators:operators});
  assert.ok(result?.validation.valid); assert.equal(requests,4);
  console.log("verify-linear-composite-contract: full/compact/all repair contracts retain automatic source points, single-comparison leaves, teaching-only membership; 0 model calls");
} finally {globalThis.fetch=originalFetch;}
