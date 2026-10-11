/** Additive source-first oracles for runtime-discovered caller/layout regressions; frozen before source edits. */
import assert from "node:assert/strict";
import { buildKineticsScene, kineticsFromStem, solveKinetics } from "../../src/chemistry/kinetics";
import { buildSolutionLessonScene } from "../../src/chemistry/solutionProperties";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import type { SceneDocument } from "../../src/types";
interface Case {id:string;question:string;family:string;refuse?:boolean;half?:number;askTime?:number;k?:number;labels?:string[];mass?:number}
const cases: Case[] = [
  {
    "id": "OWN-sequential-rise-1",
    "question": "The rate constant doubles when temperature is raised from 300 K to 310 K and subsequently by 10 K more. Calculate activation energy.",
    "family": "kinetics",
    "refuse": true
  },
  {
    "id": "OWN-sequential-rise-2",
    "question": "A reaction rate doubles from 300 K to 310 K; temperature is then raised by another 10 K. Calculate the activation energy.",
    "family": "kinetics",
    "refuse": true
  },
  {
    "id": "OWN-sequential-rise-3",
    "question": "The rate constant doubles as temperature is increased from 300 K to 310 K, followed by a further 10 K rise. Calculate activation energy.",
    "family": "kinetics",
    "refuse": true
  },
  {
    "id": "OWN-sequential-rise-4",
    "question": "The reaction rate doubles on raising temperature from 300 K to 310 K and making an additional rise of 10 K. Calculate activation energy.",
    "family": "kinetics",
    "refuse": true
  },
  {
    "id": "OWN-sequential-rise-5",
    "question": "The rate constant doubles as temperature is raised from 300 K to 310 K, then a 10 K increase is applied. Calculate activation energy.",
    "family": "kinetics",
    "refuse": true
  },
  {
    "id": "OWN-close-reference-tick-1",
    "question": "A first order reaction has k = 0.0231 min^-1. What fraction remains after 60 min?",
    "family": "kinetics",
    "half": 30.006371452811486,
    "askTime": 60,
    "k": 0.0231
  },
  {
    "id": "OWN-close-reference-tick-2",
    "question": "Find the half life of a first order reaction with rate constant k = 0.0231 min^-1, and find the remaining fraction at t = 60 min.",
    "family": "kinetics",
    "half": 30.006371452811486,
    "askTime": 60,
    "k": 0.0231
  },
  {
    "id": "OWN-close-reference-tick-3",
    "question": "For first order decay, k = 0.0231 min^-1. Draw the decay and mark the concentration after 60 min.",
    "family": "kinetics",
    "half": 30.006371452811486,
    "askTime": 60,
    "k": 0.0231
  },
  {
    "id": "OWN-close-reference-tick-4",
    "question": "For a first order reaction, the rate constant is 0.0462 min^-1. Draw [A]/[A]0 at t = 30 min.",
    "family": "kinetics",
    "half": 15.003185726405743,
    "askTime": 30,
    "k": 0.0462
  },
  {
    "id": "OWN-close-reference-tick-5",
    "question": "A first order reaction has k = 0.00693 s^-1. What fraction of [A]0 remains after 200 s?",
    "family": "kinetics",
    "half": 100.02123817603828,
    "askTime": 200,
    "k": 0.00693
  },
  {
    "id": "OWN-complete-mass-unit-1",
    "question": "A solute has true molar mass 1e+06 g/mol and dissociates into 2 particles with alpha = 0.5. Find the apparent molar mass.",
    "family": "solution",
    "labels": [
      "i=1.5",
      "M'=666666.667",
      "g/mol"
    ],
    "mass": 666666.6666666666
  },
  {
    "id": "OWN-complete-mass-unit-2",
    "question": "A solute has true molar mass 1e+07 g/mol and dissociates into 2 particles with alpha = 0.5. Find the apparent molar mass.",
    "family": "solution",
    "labels": [
      "i=1.5",
      "M'=6666666.667",
      "g/mol"
    ],
    "mass": 6666666.666666667
  },
  {
    "id": "OWN-complete-mass-unit-3",
    "question": "A solute has true molar mass 1e+08 g/mol and dissociates into 2 particles with alpha = 0.5. Find the apparent molar mass.",
    "family": "solution",
    "labels": [
      "i=1.5",
      "M'=66666666.667",
      "g/mol"
    ],
    "mass": 66666666.666666664
  },
  {
    "id": "OWN-complete-mass-unit-4",
    "question": "A solute has true molar mass 1e+09 g/mol and dissociates into 2 particles with alpha = 0.5. Find the apparent molar mass.",
    "family": "solution",
    "labels": [
      "i=1.5",
      "M'=666666666.667",
      "g/mol"
    ],
    "mass": 666666666.6666666
  },
  {
    "id": "OWN-complete-mass-unit-5",
    "question": "A solute has true molar mass 1e+10 g/mol and dissociates into 2 particles with alpha = 0.5. Find the apparent molar mass.",
    "family": "solution",
    "labels": [
      "i=1.5",
      "M'=6.667e9",
      "g/mol"
    ],
    "mass": 6666666666.666667
  },
  {
    "id": "OWN-declared-Henry-intent-1",
    "question": "For dissolved oxygen use c = kH p, kH = 0.001 mol/(L atm). The partial pressure is 0.2 atm. Find c.",
    "family": "solution",
    "labels": [
      "c=2e-4 mol/L"
    ]
  },
  {
    "id": "OWN-declared-Henry-intent-2",
    "question": "A dissolved gas obeys c = k_H p with k_H = 0.03 mol/(L bar). Its partial pressure is 2 bar. Calculate c.",
    "family": "solution",
    "labels": [
      "c=0.06 mol/L"
    ]
  },
  {
    "id": "OWN-declared-Henry-intent-3",
    "question": "A gas solution satisfies p = kH x. kH = 200 kPa and the mole fraction is 0.02. Determine partial pressure.",
    "family": "solution",
    "labels": [
      "p=4 kPa",
      "x=0.02"
    ]
  },
  {
    "id": "OWN-declared-Henry-intent-4",
    "question": "Use p = k_H x for the dissolved gas. k_H = 100000 Pa and x = 0.00002. Find the gas partial pressure.",
    "family": "solution",
    "labels": [
      "p=2 Pa",
      "x=2e-5"
    ]
  },
  {
    "id": "OWN-declared-Henry-intent-5",
    "question": "Using c = kH p for dissolved carbon dioxide, kH = 0.004 mol/(L atm). The gas partial pressure is 0.05 atm. Find dissolved concentration.",
    "family": "solution",
    "labels": [
      "c=2e-4 mol/L"
    ]
  },
  {
    "id": "laneD-q-cgates-6",
    "question": "Use Henry's law p = k_H x. The mole fraction of the dissolved gas is 0.02 and k_H = 200 kPa at fixed temperature. Find the gas partial pressure.",
    "family": "solution",
    "labels": [
      "p=4 kPa",
      "x=0.02"
    ]
  },
  {
    "id": "laneD-q-cgates-7",
    "question": "Henry's law is p = k_H x with k_H = 200 kPa. The partial pressure is zero. Find the dissolved mole fraction at this fixed temperature.",
    "family": "solution",
    "labels": [
      "p=0 kPa",
      "x=0"
    ]
  },
  {
    "id": "laneD-q-cgates-8",
    "question": "Henry's law is written c = k_H p. k_H = 0.034 mol/(L kPa) and the gas partial pressure is 20 kPa. Find c.",
    "family": "solution",
    "refuse": true
  },
  {
    "id": "laneD-q-cgates-9",
    "question": "The true molar mass is 180 g/mol. The solute dissociates into 2 particles with alpha = 0.5. Find the van't Hoff factor and the apparent molar mass.",
    "family": "solution",
    "labels": [
      "M'=120 g/mol",
      "i=1.5"
    ]
  },
  {
    "id": "laneD-q-cgates-10",
    "question": "The true molar mass is 60 g/mol. The solute associates as 2 monomers with alpha = 0.8. Find the apparent molar mass.",
    "family": "solution",
    "labels": [
      "M'=100 g/mol",
      "i=0.6"
    ]
  },
  {
    "id": "me-confirm-3",
    "question": "The rate of a reaction becomes two times when temperature is raised from 300 K to 310 K. Calculate Ea.",
    "family": "kinetics",
    "refuse": true
  }
];
function labels(document:SceneDocument):string[] {
 const valid=validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string,unknown>));
 assert.ok(valid.document,JSON.stringify(valid.report.issues));
 const compiled=compileSceneDocument(valid.document);assert.ok(compiled.ok && compiled.renderScene,JSON.stringify(compiled.report.issues));
 const values=compiled.renderScene.primitives.filter(p=>p.kind==="label" && typeof p.text==="string").map(p=>p.text!);
 assert.ok(!/NaN|Infinity|undefined/.test(values.join(" ")));return values;
}
function check(c:Case,document:SceneDocument):void {
 const displayed=labels(document);
 for(const expected of c.labels??[])assert.ok(displayed.includes(expected),JSON.stringify(displayed));
 if(c.half!==undefined)assert.equal(document.quantities.find(q=>q.id==="t_half")?.value,Number(c.half.toFixed(6)));
 if(c.askTime!==undefined)assert.ok(displayed.some(s=>s.startsWith(`t=${c.askTime} `)),JSON.stringify(displayed));
 if(c.mass!==undefined)assert.ok(document.annotations.some(a=>a.id==="figure_caption" && a.text.includes(String(c.mass))),JSON.stringify(document.annotations));
}
const results:Array<{id:string;passed:boolean;error?:string}>=[];
for(const c of cases)try {
 const direct=c.family==="kinetics"?buildKineticsScene(c.question,[],false):buildSolutionLessonScene(c.question,[],false);
 const ordinary=synthesizeFamilyScene({question:c.question});
 if(c.refuse){assert.equal(direct,null);assert.equal(ordinary,null);}
 else {assert.ok(direct,"direct readable case must draw");assert.ok(ordinary,"ordinary readable case must draw");check(c,direct);check(c,ordinary.document);
  if(c.half!==undefined){const spec=kineticsFromStem(c.question);assert.ok(spec);const solved=solveKinetics(spec);assert.ok(solved.tHalf!==null);assert.ok(Math.abs(solved.tHalf-c.half)<=Math.abs(c.half)*1e-12);const entry=solved.remainingAtTimes.find(t=>t.time===c.askTime);assert.ok(entry);assert.ok(Math.abs(entry.remaining-Math.exp(-c.k!*c.askTime!))<=1e-12);}
 }
 results.push({id:c.id,passed:true});
}catch(error){results.push({id:c.id,passed:false,error:String(error)});console.error(`FAIL ${c.id}: ${error}`);}
console.log(JSON.stringify({total:results.length,passed:results.filter(r=>r.passed).length,rows:results},null,2));
if(results.some(r=>!r.passed))process.exitCode=1;
