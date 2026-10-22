/** Real catalyst requests: closed symbolic roles, every supplied magnitude still required. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { buildThermoGraphScene } from "../../src/chemistry/thermoGraphs";
import { compileSceneDocument } from "../../src/compile/compiler";
import { evaluateMathExpression } from "../../src/math/expression";
import fixtures from "./fixtures/chemistry-requested-energy-roles.json";
const results: Array<{id:string;passed:boolean;error?:string}> = [];
for (const row of fixtures) for (const schematic of [false,true]) {
  try {
    const document = buildThermoGraphScene(row.question,[],schematic);
    assert.equal(!!document,row.expectedDraw,"whole original question scientific oracle");
    if (document) {
      assert.equal(document.source.question,row.question);
      const compiled = compileSceneDocument(document); assert.ok(compiled.ok && compiled.renderScene,"ordinary complete compiler");
      const curves = document.constructions.filter(item=>item.operator==="function_curve");
      const plain = curves.find(item=>item.outputs.includes("profile"));
      const catalyst = curves.find(item=>item.outputs.includes("catalysed"));
      assert.ok(plain && catalyst,"both complete reaction paths");
      const p = plain.inputs.expression; const c = catalyst.inputs.expression;
      assert.ok(typeof p === "string" && typeof c === "string","actual curve expressions");
      for (const x of [1,9]) assert.ok(Math.abs(evaluateMathExpression(p,x)-evaluateMathExpression(c,x)) < .03,"shared R/P endpoints");
      assert.ok(evaluateMathExpression(c,5) < evaluateMathExpression(p,5),"lower catalysed transition state");
      assert.equal(Math.sign(evaluateMathExpression(p,9)-evaluateMathExpression(p,1)),row.expectedEnergySign,"source enthalpy direction");
      for (const id of ["ea_dim","ea_cat_dim","dh_dim"]) assert.ok(document.entities.some(entity=>entity.id===id),`required symbolic ${id}`);
      assert.equal(document.quantities.length,0,"qualitative display heights are not physical energy quantities");
    }
    results.push({id:`${row.id}/${schematic?"schematic":"direct"}`,passed:true});
  } catch(error) {results.push({id:`${row.id}/${schematic?"schematic":"direct"}`,passed:false,error:error instanceof Error ? error.message : String(error)});}
}
const report={scope:"Both symbolic catalyst paths and unchanged whole physical-value refusals. No native/stock-160 coverage assertion.",passed:results.filter(row=>row.passed).length,failed:results.filter(row=>!row.passed).length,results};
const out=process.argv.indexOf("--out");if(out>=0)writeFileSync(process.argv[out+1]!,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));if(report.failed)process.exitCode=1;
