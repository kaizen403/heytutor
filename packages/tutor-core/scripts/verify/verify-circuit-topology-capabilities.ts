import assert from 'node:assert/strict';
import {inferSceneCapabilities} from '../../src/planners/sceneCapabilities';
const entities=['battery','resistor A','resistor B','resistor C','ammeter','voltmeter'].map(label=>({kind:'component',label}));
const inventory={entities,representationIntents:[{kind:'network'}],constraints:[
  {kind:'connected',entityIds:['a','b']},{kind:'connected',entityIds:['a','b']},
]};
const guidance=(problemIR:Parameters<typeof inferSceneCapabilities>[1])=>inferSceneCapabilities('Draw the stated circuit.',problemIR).planningGuidance.join('\n');
const coarse=guidance({problemIR:inventory});
assert.ok(!coarse.includes('independent cycles')&&!coarse.includes('both sources'),'Series components plus meters must not manufacture multi-loop instructions');
const proven={...inventory,solveRequests:[{kind:'dc_network',network:{model:'ideal_dc',nodes:['a','b','c','d'],branches:[
  {id:'s',kind:'voltage_source',from:'a',to:'b'},
  {id:'r1',kind:'resistor',from:'b',to:'c'},
  {id:'r2',kind:'resistor',from:'c',to:'a'},
  {id:'r3',kind:'resistor',from:'b',to:'d'},
  {id:'r4',kind:'resistor',from:'d',to:'c'},
]}}]};
const explicit=guidance({problemIR:proven});
assert.ok(explicit.includes('multiple independent cycles'));
assert.ok(explicit.includes('1 declared source(s)'));
assert.ok(!explicit.includes('both sources'));
console.log('Circuit capability guidance verification passed (4 checks).');
