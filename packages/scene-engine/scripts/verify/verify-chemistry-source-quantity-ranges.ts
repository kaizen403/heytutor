import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { readSourceQuantityRange, sourceQuantityRangeInventoryOwned } from "../../src/chemistry/sourceQuantityRange";
import { chemistryQuantityInventoryOwned, readChemistryQuantity, type ChemistryDimension, type ChemistryUnit } from "../../src/chemistry/quantityReader";
import fixtures from "./fixtures/chemistry-source-quantity-ranges.json";
const results:Array<{id:string;passed:boolean;error?:string}>=[];
for(const row of fixtures)try{
 const result=readSourceQuantityRange({question:row.question,dimension:row.dimension as ChemistryDimension,targetUnit:row.unit as ChemistryUnit});
 assert.equal(result.state,row.state,"whole source interval state");
 if(result.state==="valid"){
  for(const[index,value]of result.domain.entries())assert.ok(Math.abs(value-row.domain![index]!)<1e-10);
  for(const[index,reading]of result.readings.entries()){
   assert.equal(row.question.slice(reading.source.span.start,reading.source.span.end),reading.source.text);
   assert.ok(row.question.slice(result.unitSpans[index]!.start,result.unitSpans[index]!.end).trim().length>0,"explicit source unit span");
  }
 }
 results.push({id:row.id,passed:true});
}catch(error){results.push({id:row.id,passed:false,error:error instanceof Error?error.message:String(error)});}
const check=(id:string,run:()=>void)=>{try{run();results.push({id,passed:true});}catch(error){results.push({id,passed:false,error:error instanceof Error?error.message:String(error)});}};
const question="Use a temperature interval over 300-500 K. Delta H = 48 kJ/mol. Delta S = 160 J/(mol K).";
const input={question,dimension:"temperature" as const,targetUnit:"K" as const};
const interval=readSourceQuantityRange(input);
const enthalpy=readChemistryQuantity({question,after:/Delta H/,dimension:"molar_energy",targetUnit:"kJ/mol"});
if(interval.state!=="valid"||!enthalpy.ok)throw new Error("source-control operands must parse independently");
const consumed=[{reading:enthalpy.reading,owner:"enthalpy"}];
check("closed-range-owns-only-its-syntax",()=>assert.ok(sourceQuantityRangeInventoryOwned(input,interval,"molar_energy",consumed)));
check("ordinary-inventory-contract-unchanged",()=>assert.equal(chemistryQuantityInventoryOwned(question,"molar_energy",consumed),false));
check("unconsumed-outside-energy-refused",()=>{
 const extra={...input,question:question+" Another energy is 10 kJ/mol."};
 assert.equal(sourceQuantityRangeInventoryOwned(extra,readSourceQuantityRange(extra),"molar_energy",consumed),false);
});
check("agreeing-outside-repeat-needs-own-span",()=>{
 const extra={...input,question:question+" Delta H = 48 kJ/mol."};
 assert.equal(sourceQuantityRangeInventoryOwned(extra,readSourceQuantityRange(extra),"molar_energy",consumed),false);
});
check("forged-domain-refused",()=>assert.equal(sourceQuantityRangeInventoryOwned(input,{...interval,domain:[300,999]},"molar_energy",consumed),false));
check("forged-exclusion-span-refused",()=>assert.equal(sourceQuantityRangeInventoryOwned(input,{...interval,span:{start:0,end:question.length}},"molar_energy",consumed),false));
check("forged-consumed-value-refused",()=>assert.equal(sourceQuantityRangeInventoryOwned(input,interval,"molar_energy",[{reading:{...enthalpy.reading,value:49},owner:"enthalpy"}]),false));
check("absent-interval-cannot-exclude",()=>assert.equal(sourceQuantityRangeInventoryOwned(input,{state:"absent"},"molar_energy",consumed),false));
const report={passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results};const out=process.argv.indexOf("--out");if(out>=0)writeFileSync(process.argv[out+1]!,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));if(report.failed)process.exitCode=1;
