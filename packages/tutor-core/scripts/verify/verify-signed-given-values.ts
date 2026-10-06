import assert from "node:assert/strict";
import {questionStatesValue,collectQuestionGivens,buildGivenValueSegments} from "../../src/llm/givenValueIntro";
let checks=0;
const check=(actual:unknown,expected:unknown,label:string)=>{checks++;assert.deepEqual(actual,expected,label);};
const question="Least count corresponding to the main scale and circular scale of a screw gauge are 0.5 mm and 0.005 mm, respectively. A wire of diameter 2.675 mm is measured with the screw gauge. What would be the reading of divisions on circular scale of the screw gauge, if the zero error of the screw gauge is -0.02 mm?";
const plan={givens:[{id:"p",symbol:"p",value:.5,unit:"mm",provenance:"given"},{id:"LC",symbol:"LC",value:.005,unit:"mm",provenance:"given"},{id:"d",symbol:"d",value:2.675,unit:"mm",provenance:"given"},{id:"e0",symbol:"e0",value:-.02,unit:"mm",provenance:"given"}],unknowns:[{id:"circular_reading",symbol:"circular_reading",unit:"division"}]};
check(questionStatesValue(question,-.02),true,"captured zero error is explicitly supplied");
check(collectQuestionGivens(question,plan).map(x=>x.board),["p = 0.5 mm","LC = 0.005 mm","d = 2.675 mm","e0 = -0.02 mm"],"whole original given list includes signed zero error");
check(buildGivenValueSegments(question,plan,{maxWidth:1000}).some(x=>x.command?.text?.includes("e0 = -0.02 mm")&&x.narration.includes("minus 0.02")),true,"signed value is written and spoken together");
for(const sign of ["-","−","–","—"]){for(const token of ["0.02",".02","2e-2","2E-2"]){const q=`The stated signed offset is ${sign}${token} mm. Find the correction.`;check(questionStatesValue(q,-.02),true,`${sign}${token} negative`);check(questionStatesValue(q,.02),false,`${sign}${token} is not positive`);}}
for(const [q,v] of [["u = -30 cm",-.3],["u = −0.3 m",-30],["offset = -2.0 mm",-2],["offset = +.02 mm",.02],["offset = 0.02 mm",.02],["charge = -1.6e-19 C",-1.6e-19],["position = 0 m",0]] as const)check(questionStatesValue(q,v),true,`supported signed stated/rescaled ${q}`);
for(const [q,v] of [["offset = +.02 mm",-.02],["offset = 0.02 mm",-.02],["charge = -1.6e-19 C",1.6e-19],["charge = -1.6e-19 C",1.6],["Find a zero error without numbers",-.02],["offset = -0.021 mm",-.02],["offset = -0.02 mm",NaN],["offset = -0.02 mm",Infinity]] as const)check(questionStatesValue(q,v),false,`unsupported value ${q}/${v}`);
console.log(`signed given values: ${checks} checks passed`);
