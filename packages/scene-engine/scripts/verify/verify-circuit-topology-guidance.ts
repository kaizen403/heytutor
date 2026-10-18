import assert from 'node:assert/strict';
import { circuitTopologyFromProblemStructure, sceneDemand } from '../../src/index';

const inventory = (sources:number, loads:number) => ({
  entities:[...Array.from({length:sources},(_,i)=>({kind:'component',label:`battery ${i}`})),
    ...Array.from({length:loads},(_,i)=>({kind:'component',label:`resistor ${i}`}))],
  representationIntents:[{kind:'network'}],
  constraints:[{kind:'connected',entityIds:['x','y']},{kind:'connected',entityIds:['x','y']}],
});
let checks=0;
for (const [sources,loads] of [[1,5],[1,12],[2,3],[0,5]]) {
  const coarse=inventory(sources!,loads!);
  assert.equal(circuitTopologyFromProblemStructure(coarse)?.twoLoop,false,'An inventory or repeated membership cannot prove multiple loops');
  assert.equal(sceneDemand('Draw the stated circuit.',coarse).forbids.includes('resistor_chain'),false,'Unknown topology cannot forbid a series circuit');
  checks+=2;
}
const explicit = (edges:Array<[string,string,string]>, copies=1) => ({...inventory(1,5),
  solveRequests:Array.from({length:copies},()=>({kind:'dc_network',network:{model:'ideal_dc',
    nodes:[...new Set(edges.flatMap(([a,b])=>[a,b]))],
    branches:edges.map(([from,to,kind],i)=>({id:`e${i}`,from,to,kind})),
  }})),
});
const series=explicit([['a','b','voltage_source'],['b','c','resistor'],['c','d','resistor'],['d','a','resistor']]);
assert.equal(circuitTopologyFromProblemStructure(series)?.twoLoop,false);
const twoSourceSeries=explicit([['a','b','voltage_source'],['b','c','voltage_source'],['c','d','resistor'],['d','a','resistor']]);
assert.equal(circuitTopologyFromProblemStructure(twoSourceSeries)?.twoLoop,false,'Two sources in a series ring are still one loop');
const twoLoop=explicit([['a','b','voltage_source'],['b','c','resistor'],['c','a','resistor'],['b','d','resistor'],['d','c','resistor']],3);
assert.equal(circuitTopologyFromProblemStructure(twoLoop)?.twoLoop,true,'Explicit connected cyclic graph proves multiple loops');
assert.equal(circuitTopologyFromProblemStructure(twoLoop)?.sources,1,'One source stays one source');
assert.equal(sceneDemand('Draw the stated circuit.',twoLoop).forbids.includes('resistor_chain'),true);
const disconnected=explicit([['a','b','voltage_source'],['b','c','resistor'],['c','a','resistor'],['d','e','voltage_source'],['e','f','resistor'],['f','d','resistor']]);
assert.equal(circuitTopologyFromProblemStructure(disconnected)?.twoLoop,false,'Two disconnected one-loop circuits do not prove one multi-loop network');
const malformed=structuredClone(twoLoop);malformed.solveRequests[0]!.network.branches[0]!.to='undeclared';
assert.equal(circuitTopologyFromProblemStructure(malformed)?.twoLoop,false,'Malformed or inconsistent explicit graphs cannot prove a topology');
checks+=7;
const seriesMeters={...inventory(1,5),entities:['battery','resistor A','resistor B','resistor C','ammeter','voltmeter'].map(label=>({kind:'component',label}))};
assert.equal(circuitTopologyFromProblemStructure(seriesMeters)?.twoLoop,false);
const circuitOnly={solveRequests:twoLoop.solveRequests};
assert.equal(circuitTopologyFromProblemStructure(circuitOnly)?.twoLoop,true,'Explicit branch graph works without inferred inventory labels');
const selfLoop=explicit([['a','a','resistor']]);
assert.equal(circuitTopologyFromProblemStructure(selfLoop)?.twoLoop,false);
const conflict={...twoLoop,solveRequests:[twoLoop.solveRequests[0]!,series.solveRequests[0]!]};
assert.equal(circuitTopologyFromProblemStructure(conflict)?.twoLoop,false);
const openBranch=structuredClone(twoLoop);
for(const request of openBranch.solveRequests)request.network.branches[4]!.kind='open';
assert.equal(circuitTopologyFromProblemStructure(openBranch)?.twoLoop,true,'This is displayed branch topology, never a claim of conducting cycles');
const rawInvalid:unknown[]=[
  {...inventory(1,5),solveRequests:'invalid'},
  {...inventory(1,5),solveRequests:[null]},
  {...inventory(1,5),solveRequests:[{kind:'dc_network',network:{model:'ideal_dc',nodes:'abc',branches:[null]}}]},
  {...inventory(1,5),solveRequests:[{kind:'dc_network',network:{model:'ideal_dc',nodes:['a','b'],branches:[null]}}]},
  {...inventory(1,5),solveRequests:[{kind:'dc_network',network:{model:'ideal_dc',nodes:['a','a'],branches:[{id:'r',kind:'resistor',from:'a',to:'b'}]}}]},
];
for(const input of rawInvalid)assert.equal(circuitTopologyFromProblemStructure(input as never)?.twoLoop,false);
checks+=10;
console.log(`Circuit topology guidance verification passed (${checks} checks).`);
