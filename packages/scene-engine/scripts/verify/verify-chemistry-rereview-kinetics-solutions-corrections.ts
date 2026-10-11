/** Additive source-first oracles for runtime-discovered caller/layout regressions; frozen before source edits. */
import assert from "node:assert/strict";
import { buildKineticsScene, kineticsFromStem, solveKinetics } from "../../src/chemistry/kinetics";
import { buildSolutionLessonScene } from "../../src/chemistry/solutionProperties";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import type { SceneDocument } from "../../src/types";
interface Case {id:string;question:string;family:string;refuse?:boolean;half?:number;askTime?:number;k?:number;labels?:string[];mass?:number;askUnit?:string;physicalValues?:Array<{value:string;unit:string}>}
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
    "k": 0.0231,
    "askUnit": "min"
  },
  {
    "id": "OWN-close-reference-tick-2",
    "question": "Find the half life of a first order reaction with rate constant k = 0.0231 min^-1, and find the remaining fraction at t = 60 min.",
    "family": "kinetics",
    "half": 30.006371452811486,
    "askTime": 60,
    "k": 0.0231,
    "askUnit": "min"
  },
  {
    "id": "OWN-close-reference-tick-3",
    "question": "For first order decay, k = 0.0231 min^-1. Draw the decay and mark the concentration after 60 min.",
    "family": "kinetics",
    "half": 30.006371452811486,
    "askTime": 60,
    "k": 0.0231,
    "askUnit": "min"
  },
  {
    "id": "OWN-close-reference-tick-4",
    "question": "For a first order reaction, the rate constant is 0.0462 min^-1. Draw [A]/[A]0 at t = 30 min.",
    "family": "kinetics",
    "half": 15.003185726405743,
    "askTime": 30,
    "k": 0.0462,
    "askUnit": "min"
  },
  {
    "id": "OWN-close-reference-tick-5",
    "question": "A first order reaction has k = 0.00693 s^-1. What fraction of [A]0 remains after 200 s?",
    "family": "kinetics",
    "half": 100.02123817603828,
    "askTime": 200,
    "k": 0.00693,
    "askUnit": "s"
  },
  {
    "id": "OWN-complete-mass-unit-1",
    "question": "A solute has true molar mass 1e+06 g/mol and dissociates into 2 particles with alpha = 0.5. Find the apparent molar mass.",
    "family": "solution",
    "labels": [
      "i=1.5"
    ],
    "mass": 666666.6666666666,
    "physicalValues": [
      {
        "value": "M'=666666.667",
        "unit": "g/mol"
      }
    ]
  },
  {
    "id": "OWN-complete-mass-unit-2",
    "question": "A solute has true molar mass 1e+07 g/mol and dissociates into 2 particles with alpha = 0.5. Find the apparent molar mass.",
    "family": "solution",
    "labels": [
      "i=1.5"
    ],
    "mass": 6666666.666666667,
    "physicalValues": [
      {
        "value": "M'=6666666.667",
        "unit": "g/mol"
      }
    ]
  },
  {
    "id": "OWN-complete-mass-unit-3",
    "question": "A solute has true molar mass 1e+08 g/mol and dissociates into 2 particles with alpha = 0.5. Find the apparent molar mass.",
    "family": "solution",
    "labels": [
      "i=1.5"
    ],
    "mass": 66666666.666666664,
    "physicalValues": [
      {
        "value": "M'=66666666.667",
        "unit": "g/mol"
      }
    ]
  },
  {
    "id": "OWN-complete-mass-unit-4",
    "question": "A solute has true molar mass 1e+09 g/mol and dissociates into 2 particles with alpha = 0.5. Find the apparent molar mass.",
    "family": "solution",
    "labels": [
      "i=1.5"
    ],
    "mass": 666666666.6666666,
    "physicalValues": [
      {
        "value": "M'=666666666.667",
        "unit": "g/mol"
      }
    ]
  },
  {
    "id": "OWN-complete-mass-unit-5",
    "question": "A solute has true molar mass 1e+10 g/mol and dissociates into 2 particles with alpha = 0.5. Find the apparent molar mass.",
    "family": "solution",
    "labels": [
      "i=1.5"
    ],
    "mass": 6666666666.666667,
    "physicalValues": [
      {
        "value": "M'=6.667e9",
        "unit": "g/mol"
      }
    ]
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
 if(c.askTime!==undefined) {
  const exactTime=new RegExp(`^t\\s*=\\s*${c.askTime}\\s+${c.askUnit}$`);
  assert.ok(displayed.some(s=>exactTime.test(s)),JSON.stringify(displayed));
 }
 for(const physical of c.physicalValues??[]) {
  const compact=displayed.map(s=>s.replace(/\s+/g,""));
  const value=physical.value.replace(/\s+/g,""),unit=physical.unit.replace(/\s+/g,"");
  assert.ok(compact.includes(value+unit) || (compact.includes(value) && compact.includes(unit)),JSON.stringify(displayed));
 }
 if(c.mass!==undefined)assert.ok(document.annotations.some(a=>a.id==="figure_caption" && typeof a.text==="string" && a.text.includes(String(c.mass))),JSON.stringify(document.annotations));
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

// BEGIN ADDITIVE HALF-LIFE REACTION-SUBJECT GATES
interface HalfSubjectCase { id:string; question:string; order?:0|1|2; half?:number; unit?:string; initial?:number; k?:number; interval?:number; labels?:string[]; requested?:boolean; refuse?:boolean }
const halfSubjectCases:HalfSubjectCase[] = [
  {
    "id": "legacy-zero-order-reaction-subject",
    "question": "Half life of a zero order reaction A -> product is 1 hour when the initial concentration of the reactant is 2.0 mol L^-1. Draw the plot of [A] vs t and find the time required to decrease the concentration of A from 0.50 to 0.25 mol L^-1.",
    "order": 0,
    "half": 1,
    "unit": "h",
    "initial": 2,
    "k": 1,
    "interval": 0.25,
    "labels": [
      "t_1/2 = 1 h",
      "[A]_0 = 2 M",
      "slope = -k",
      "t = 2 h"
    ]
  },
  {
    "id": "own-zero-order-subject-1",
    "question": "The half life of a zero order reaction X -> Y is 30 min. Initial concentration is 2 M. Draw [A] vs t.",
    "order": 0,
    "half": 30,
    "unit": "min",
    "initial": 2,
    "k": 0.03333333333333333
  },
  {
    "id": "own-zero-order-subject-2",
    "question": "Half-life for the zeroth order reaction R → S is 2 hours. Initial concentration is 4 mol/L. Draw the concentration against time.",
    "order": 0,
    "half": 2,
    "unit": "h",
    "initial": 4,
    "k": 1
  },
  {
    "id": "own-zero-order-subject-3",
    "question": "Half life of a zero order reaction 2 H2O2 -> 2 H2O + O2 is 60 s. Initial concentration is 0.6 M. Draw [A] versus time.",
    "order": 0,
    "half": 60,
    "unit": "s",
    "initial": 0.6,
    "k": 0.005
  },
  {
    "id": "own-zero-order-subject-4",
    "question": "The half life for a 0th order reaction 2 R -> S is 4 min. Initial concentration is 0.8 M. Draw [A] against t.",
    "order": 0,
    "half": 4,
    "unit": "min",
    "initial": 0.8,
    "k": 0.1
  },
  {
    "id": "own-zero-order-subject-5",
    "question": "Half life of the zero-order reaction X(aq) ⟶ Y(aq) at 310 K is 0.5 hour. Initial concentration is 1 M. Draw [A] vs t.",
    "order": 0,
    "half": 0.5,
    "unit": "h",
    "initial": 1,
    "k": 1
  },
  {
    "id": "own-first-order-subject",
    "question": "Half life of a first order reaction 2 N2O5 -> 4 NO2 + O2 is 20 min. Draw [A]/[A]0 against time.",
    "order": 1,
    "half": 20,
    "unit": "min",
    "k": 0.03465735902799726
  },
  {
    "id": "own-second-order-subject",
    "question": "Half life of a second order reaction X + Y -> Z is 10 min. Initial concentration is 2 M. Draw 1/[A] vs t.",
    "order": 2,
    "half": 10,
    "unit": "min",
    "initial": 2,
    "k": 0.05
  },
  {
    "id": "own-requested-half-rate-subject",
    "question": "For a first order reaction, rate constant k = 0.0231 min^-1. Find the half life of the reaction X -> Y. Draw [A]/[A]0 vs t.",
    "order": 1,
    "half": 30.006371452811486,
    "unit": "min",
    "k": 0.0231,
    "requested": true
  },
  {
    "id": "own-requested-half-completion-subject",
    "question": "Find the half life of a first order reaction X -> Y. Time for 75 % completion is 60 min. Draw [A]/[A]0 vs t.",
    "order": 1,
    "half": 30,
    "unit": "min",
    "k": 0.023104906018664842,
    "requested": true
  },
  {
    "id": "own-incomplete-or-damaged-subject-1",
    "question": "Half life of a first order reaction X -> is 20 min. Time for 75 % completion is 60 min. Draw [A] vs t.",
    "refuse": true
  },
  {
    "id": "own-incomplete-or-damaged-subject-2",
    "question": "Half life of a first order reaction -> Y is 20 min. Time for 75 % completion is 60 min. Draw [A] vs t.",
    "refuse": true
  },
  {
    "id": "own-incomplete-or-damaged-subject-3",
    "question": "Half life of a first order reaction X --> Y is 20 min. Time for 75 % completion is 60 min. Draw [A] vs t.",
    "refuse": true
  },
  {
    "id": "own-incomplete-or-damaged-subject-4",
    "question": "Half life of a first order reaction X -> unknown is 20 min. Time for 75 % completion is 60 min. Draw [A] vs t.",
    "refuse": true
  },
  {
    "id": "own-incomplete-or-damaged-subject-5",
    "question": "Half life of a first order reaction unreadable -> Y is 20 min. Time for 75 % completion is 60 min. Draw [A] vs t.",
    "refuse": true
  },
  {
    "id": "own-incomplete-or-damaged-subject-6",
    "question": "Half life of a first order reaction X -> Y(plasma) is 20 min. Time for 75 % completion is 60 min. Draw [A] vs t.",
    "refuse": true
  },
  {
    "id": "own-incomplete-or-damaged-subject-7",
    "question": "Half life of a first order reaction 0 X -> Y is 20 min. Time for 75 % completion is 60 min. Draw [A] vs t.",
    "refuse": true
  },
  {
    "id": "own-incomplete-or-damaged-subject-8",
    "question": "Half life of a first order reaction -1 X -> Y is 20 min. Time for 75 % completion is 60 min. Draw [A] vs t.",
    "refuse": true
  },
  {
    "id": "own-incomplete-or-damaged-subject-9",
    "question": "Half life of a first order reaction 1.5 X -> Y is 20 min. Time for 75 % completion is 60 min. Draw [A] vs t.",
    "refuse": true
  },
  {
    "id": "own-incomplete-or-damaged-subject-10",
    "question": "Half life of a first order reaction 1e2 X -> Y is 20 min. Time for 75 % completion is 60 min. Draw [A] vs t.",
    "refuse": true
  },
  {
    "id": "own-incomplete-or-damaged-subject-11",
    "question": "Half life of a first order reaction X -> Y[solid] is 20 min. Time for 75 % completion is 60 min. Draw [A] vs t.",
    "refuse": true
  },
  {
    "id": "own-unread-half-before-completion-1",
    "question": "Half life of a first order reaction X -> Y is unknown. Time for 75 % completion is 60 min. Draw [A] vs t.",
    "refuse": true
  },
  {
    "id": "own-unread-half-before-completion-2",
    "question": "Half life of a first order reaction X -> Y is unreadable. Time for 75 % completion is 60 min. Draw [A] vs t.",
    "refuse": true
  },
  {
    "id": "own-unread-half-before-completion-3",
    "question": "Half life of a first order reaction X -> Y is 1e- min. Time for 75 % completion is 60 min. Draw [A] vs t.",
    "refuse": true
  },
  {
    "id": "own-unread-half-before-completion-4",
    "question": "Half life of a first order reaction X -> Y is 20 kg. Time for 75 % completion is 60 min. Draw [A] vs t.",
    "refuse": true
  },
  {
    "id": "own-unread-half-before-completion-5",
    "question": "Half life of a first order reaction X -> Y is 0 min. Time for 75 % completion is 60 min. Draw [A] vs t.",
    "refuse": true
  },
  {
    "id": "own-unread-half-before-completion-6",
    "question": "Half life of a first order reaction X -> Y is -1 min. Time for 75 % completion is 60 min. Draw [A] vs t.",
    "refuse": true
  },
  {
    "id": "own-unread-half-before-valid-owner-1",
    "question": "Half life of a first order reaction X -> Y is unknown. Half life is 20 min. Draw [A] vs t.",
    "refuse": true
  },
  {
    "id": "own-unread-half-before-valid-owner-2",
    "question": "Half life of a first order reaction X -> Y is unreadable. Half life is 20 min. Draw [A] vs t.",
    "refuse": true
  },
  {
    "id": "own-unread-half-before-valid-owner-3",
    "question": "Half life of a first order reaction X -> Y is 1e- min. Half life is 20 min. Draw [A] vs t.",
    "refuse": true
  },
  {
    "id": "own-unread-half-before-valid-owner-4",
    "question": "Half life of a first order reaction X -> Y is 20 kg. Half life is 20 min. Draw [A] vs t.",
    "refuse": true
  },
  {
    "id": "own-conflicting-reaction-half-owners",
    "question": "Half life of a first order reaction X -> Y is 20 min. Half life is 30 min. Draw [A] vs t.",
    "refuse": true
  },
  {
    "id": "own-conflicting-plain-first-owner",
    "question": "Half life is 30 min. Half life of a first order reaction R -> S is 20 min. Draw [A] vs t.",
    "refuse": true
  },
  {
    "id": "own-unread-half-target-with-given-rate",
    "question": "For a first order reaction, rate constant k = 0.0231 min^-1. Find the half life of the reaction X -> Y is unknown. Draw [A] vs t.",
    "refuse": true
  }
];

// BEGIN ADDITIVE HALF-LIFE REQUEST-ROLE CONTROLS
const additionalHalfSubjectCases:HalfSubjectCase[] = [
  {
    "id": "review-request-condition-1",
    "question": "Find the half life of a first order reaction if the time for 75% completion is 60 min.",
    "order": 1,
    "half": 30,
    "unit": "min",
    "k": 0.023104906018664842,
    "requested": true
  },
  {
    "id": "review-request-condition-2",
    "question": "Determine the half life for a first order reaction X -> Y if the time for 87.5 % completion is 90 s. Draw the decay curve.",
    "order": 1,
    "half": 30,
    "unit": "s",
    "k": 0.023104906018664842,
    "requested": true
  },
  {
    "id": "review-request-condition-3",
    "question": "What is the half life of a first order reaction R -> S whose rate constant is 0.0231 min^-1? Draw [A]/[A]0 versus time.",
    "order": 1,
    "half": 30.006371452811486,
    "unit": "min",
    "k": 0.0231,
    "requested": true
  },
  {
    "id": "review-request-condition-4",
    "question": "Calculate the half life of a first order reaction with rate constant k = 0.0231 min^-1. Draw [A]/[A]0 vs t.",
    "order": 1,
    "half": 30.006371452811486,
    "unit": "min",
    "k": 0.0231,
    "requested": true
  },
  {
    "id": "review-request-condition-5",
    "question": "The half life of a first order reaction X -> Y when the time for 50% completion is 18 min is required. Draw the decay curve.",
    "order": 1,
    "half": 18,
    "unit": "min",
    "k": 0.03850817669777474,
    "requested": true
  },
  {
    "id": "review-request-predicate-1",
    "question": "For a first order reaction, rate constant k = 0.0231 min^-1. The half life is to be found. Draw [A]/[A]0 vs t.",
    "order": 1,
    "half": 30.006371452811486,
    "unit": "min",
    "k": 0.0231,
    "requested": true
  },
  {
    "id": "review-request-predicate-2",
    "question": "For a first order reaction, rate constant k = 0.0231 min^-1. The half life of the reaction X -> Y is required. Draw [A]/[A]0 vs t.",
    "order": 1,
    "half": 30.006371452811486,
    "unit": "min",
    "k": 0.0231,
    "requested": true
  },
  {
    "id": "review-strict-request-owner-1",
    "question": "Find the half life of a first order reaction X -> Y is unknown. Time for 75 % completion is 60 min. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "review-strict-request-owner-2",
    "question": "The half life of a first order reaction X -> Y is unreadable. Time for 75 % completion is 60 min. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "review-strict-request-owner-3",
    "question": "Find the half life of a first order reaction X -> Y = 20 kg. Time for 75 % completion is 60 min. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "review-strict-request-owner-4",
    "question": "For a first order reaction, rate constant k = 0.0231 min^-1. The half life is to be found but is given as unknown. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "review-strict-request-owner-5",
    "question": "Half life of a first order reaction X -> Y is unknown. Half life is 20 min. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "protected218-F7-75given",
    "question": "Find the half life of a first order reaction if the time for 75% completion is 60 min.",
    "order": 1,
    "half": 30,
    "unit": "min",
    "k": 0.023104906018664842,
    "requested": true
  },
  {
    "id": "protected218-F7-whoseK",
    "question": "What is the half life of a first order reaction whose rate constant is 1.155 × 10^-3 s^-1?",
    "order": 1,
    "half": 600.1274290562297,
    "unit": "s",
    "k": 0.001155,
    "requested": true
  },
  {
    "id": "protected218-X-hl-when-is",
    "question": "The half life of a first order reaction when the time for 75% completion is 60 min is to be found. Draw the decay curve.",
    "order": 1,
    "half": 30,
    "unit": "min",
    "k": 0.023104906018664842,
    "requested": true
  },
  {
    "id": "protected218-OWN-half-if-time",
    "question": "Find the half life of a first order reaction if the time for 93.75% completion is 80 min.",
    "order": 1,
    "half": 20,
    "unit": "min",
    "k": 0.03465735902799726,
    "requested": true
  },
  {
    "id": "protected218-OWN-half-for-time",
    "question": "Calculate the half life for a first order reaction if the time taken for 87.5 % completion is 90 s.",
    "order": 1,
    "half": 30,
    "unit": "s",
    "k": 0.023104906018664842,
    "requested": true
  },
  {
    "id": "protected218-OWN-half-when-time",
    "question": "The half life of this first order reaction when the time for 50% completion is 18 min is required.",
    "order": 1,
    "half": 18,
    "unit": "min",
    "k": 0.03850817669777474,
    "requested": true
  },
  {
    "id": "protected218-independent-half-life-no-cross-owner-1",
    "question": "Find the half life for a first order reaction whose time for 75% completion is 60 min.",
    "order": 1,
    "half": 30,
    "unit": "min",
    "k": 0.023104906018664842,
    "requested": true
  },
  {
    "id": "protected218-independent-half-life-no-cross-owner-3",
    "question": "Determine the half life of a first order reaction if 90 % completion takes 46.06 min.",
    "refuse": true
  },
  {
    "id": "own-request-condition-1",
    "question": "Find the half life of a first order reaction if the time for 50 % completion is 12 min. Draw [A]/[A]0 vs t.",
    "order": 1,
    "half": 12,
    "unit": "min",
    "k": 0.057762265046662105,
    "requested": true
  },
  {
    "id": "own-request-condition-2",
    "question": "Determine the half life for a first order reaction X -> Y when the time taken for 87.5 % completion is 90 min. Draw [A]/[A]0 vs t.",
    "order": 1,
    "half": 30,
    "unit": "min",
    "k": 0.023104906018664842,
    "requested": true
  },
  {
    "id": "own-request-condition-3",
    "question": "Calculate the half life of a first order reaction with rate constant k = 0.0231 min^-1. Draw the decay curve.",
    "order": 1,
    "half": 30.006371452811486,
    "unit": "min",
    "k": 0.0231,
    "requested": true
  },
  {
    "id": "own-request-condition-4",
    "question": "What is the half life of a first order reaction X → Y at 310 K whose rate constant is 0.0231 min^-1? Draw [A]/[A]0 vs t.",
    "order": 1,
    "half": 30.006371452811486,
    "unit": "min",
    "k": 0.0231,
    "requested": true
  },
  {
    "id": "own-request-condition-5",
    "question": "The half life of a first order reaction R -> S when the time for 75 % completion is 60 min is to be found. Draw the decay curve.",
    "order": 1,
    "half": 30,
    "unit": "min",
    "k": 0.023104906018664842,
    "requested": true
  },
  {
    "id": "own-request-condition-6",
    "question": "Find the half life for a first order reaction given the time for 75 % completion is 60 min. Draw [A]/[A]0 vs t.",
    "order": 1,
    "half": 30,
    "unit": "min",
    "k": 0.023104906018664842,
    "requested": true
  },
  {
    "id": "own-request-predicate-supplied-1",
    "question": "A first order reaction has rate constant k = 0.0231 min^-1. The half life is required 20 min. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "own-request-predicate-supplied-2",
    "question": "A first order reaction has rate constant k = 0.0231 min^-1. The half life is to be found unknown. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "own-request-predicate-supplied-3",
    "question": "A first order reaction has rate constant k = 0.0231 min^-1. The half life is required = unknown. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "own-request-predicate-supplied-4",
    "question": "A first order reaction has rate constant k = 0.0231 min^-1. The half life is to be found but is given as unreadable. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "own-complete-half-alias-1",
    "question": "A first order reaction has t1/2 = 20 min. Draw [A]/[A]0 vs t.",
    "order": 1,
    "half": 20,
    "unit": "min",
    "k": 0.03465735902799726
  },
  {
    "id": "own-unread-half-alias-1",
    "question": "A first order reaction has rate constant k = 0.0231 min^-1. t1/2 is unknown. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "own-repeated-unread-half-alias-1",
    "question": "A first order reaction has t1/2 is unreadable. Half life is 20 min. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "own-complete-half-alias-2",
    "question": "A first order reaction has t½ = 20 min. Draw [A]/[A]0 vs t.",
    "order": 1,
    "half": 20,
    "unit": "min",
    "k": 0.03465735902799726
  },
  {
    "id": "own-unread-half-alias-2",
    "question": "A first order reaction has rate constant k = 0.0231 min^-1. t½ is unknown. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "own-repeated-unread-half-alias-2",
    "question": "A first order reaction has t½ is unreadable. Half life is 20 min. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "own-complete-half-alias-3",
    "question": "A first order reaction has t_(1/2) = 20 min. Draw [A]/[A]0 vs t.",
    "order": 1,
    "half": 20,
    "unit": "min",
    "k": 0.03465735902799726
  },
  {
    "id": "own-unread-half-alias-3",
    "question": "A first order reaction has rate constant k = 0.0231 min^-1. t_(1/2) is unknown. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "own-repeated-unread-half-alias-3",
    "question": "A first order reaction has t_(1/2) is unreadable. Half life is 20 min. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "own-complete-half-alias-4",
    "question": "A first order reaction has t_half = 20 min. Draw [A]/[A]0 vs t.",
    "order": 1,
    "half": 20,
    "unit": "min",
    "k": 0.03465735902799726
  },
  {
    "id": "own-unread-half-alias-4",
    "question": "A first order reaction has rate constant k = 0.0231 min^-1. t_half is unknown. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "own-repeated-unread-half-alias-4",
    "question": "A first order reaction has t_half is unreadable. Half life is 20 min. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "own-original-half-input-marker-1",
    "question": "A first order reaction has rate constant k = 0.0231 min^-1. The half life has value unknown. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "own-original-half-input-marker-2",
    "question": "A first order reaction has rate constant k = 0.0231 min^-1. The half life takes the value unreadable. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "own-original-half-input-marker-3",
    "question": "A first order reaction has rate constant k = 0.0231 min^-1. The half life with value unknown. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "own-original-half-input-marker-4",
    "question": "A first order reaction has rate constant k = 0.0231 min^-1. The half life of unknown. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "own-original-half-input-marker-5",
    "question": "A first order reaction has rate constant k = 0.0231 min^-1. The half life approximately unreadable. Draw [A]/[A]0 vs t.",
    "refuse": true
  }
];
halfSubjectCases.push(...additionalHalfSubjectCases);
// END ADDITIVE HALF-LIFE REQUEST-ROLE CONTROLS


// BEGIN ADDITIVE FIRST-CONDITIONAL-OWNER CONTROLS
const firstConditionalOwnerCases:HalfSubjectCase[] = [
  {
    "id": "review-first-condition-completion-owner-1",
    "question": "Find the half life of a first order reaction if the time for 75% completion is unknown and the time for 50% completion is 20 min. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "review-first-condition-completion-owner-2",
    "question": "Calculate the half life of a first order reaction X -> Y when the time for 87.5% completion is unreadable and the time for 75% completion is 60 min. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "review-first-condition-completion-owner-3",
    "question": "Determine the half life of a first order reaction whose time for 75% completion is 1e- min and time for 50% completion is 20 min. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "review-first-condition-completion-owner-4",
    "question": "Find the half life for a first order reaction if the time for 75% completion is 60 kg and the time for 50% completion is 20 min. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "review-first-condition-completion-owner-5",
    "question": "The half life of a first order reaction when the time for 75% completion is unknown and time for 50% completion is 18 min is required. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "review-first-condition-rate-owner-1",
    "question": "Find the half life of a first order reaction whose rate constant is unknown and rate constant k = 0.0231 min^-1. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "review-first-condition-rate-owner-2",
    "question": "Calculate the half life of a first order reaction X -> Y with rate constant is unreadable and rate constant k = 0.0231 min^-1. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "review-first-condition-rate-owner-3",
    "question": "Determine the half life of a first order reaction if the rate constant is unavailable and rate constant k = 0.0231 min^-1. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "review-first-condition-rate-owner-4",
    "question": "What is the half life for a first order reaction given rate constant = unknown and rate constant k = 0.0231 min^-1? Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "review-first-condition-rate-owner-5",
    "question": "The half life of a first order reaction whose rate constant is unknown and rate constant k = 0.0231 min^-1 is to be found. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "own-first-completion-owner-1",
    "question": "Find the half life of a first order reaction if the time for 87.5 % completion is unknown and the time for 50 % completion is 20 min. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "own-first-completion-owner-2",
    "question": "Find the half life of a first order reaction if the time for 87.5 % completion is unreadable and the time for 50 % completion is 20 min. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "own-first-completion-owner-3",
    "question": "Find the half life of a first order reaction if the time for 87.5 % completion is 1e- min and the time for 50 % completion is 20 min. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "own-first-completion-owner-4",
    "question": "Find the half life of a first order reaction if the time for 87.5 % completion is 20 kg and the time for 50 % completion is 20 min. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "own-first-completion-owner-5",
    "question": "Find the half life of a first order reaction if the time for 87.5 % completion is  and the time for 50 % completion is 20 min. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "own-first-rate-owner-1",
    "question": "Determine the half life of a first order reaction X -> Y whose rate constant is unknown and rate constant k = 0.0231 min^-1. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "own-first-rate-owner-2",
    "question": "Determine the half life of a first order reaction X -> Y whose rate constant is unreadable and rate constant k = 0.0231 min^-1. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "own-first-rate-owner-3",
    "question": "Determine the half life of a first order reaction X -> Y whose rate constant is 1e- s^-1 and rate constant k = 0.0231 min^-1. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "own-first-rate-owner-4",
    "question": "Determine the half life of a first order reaction X -> Y whose rate constant is 20 kg and rate constant k = 0.0231 min^-1. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "own-first-rate-owner-5",
    "question": "Determine the half life of a first order reaction X -> Y whose rate constant is  and rate constant k = 0.0231 min^-1. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "own-first-original-input-supported-1",
    "question": "Determine the half life of a first order reaction whose RATE CONSTANT is 0.0231 min^-1. Draw [A]/[A]0 vs t.",
    "order": 1,
    "half": 30.006371452811486,
    "unit": "min",
    "k": 0.0231,
    "requested": true
  },
  {
    "id": "own-first-original-input-supported-2",
    "question": "Find the half life of a first order reaction X -> Y whose k = 0.0231 min^-1. Draw the decay curve.",
    "order": 1,
    "half": 30.006371452811486,
    "unit": "min",
    "k": 0.0231,
    "requested": true
  },
  {
    "id": "own-first-original-input-supported-3",
    "question": "Find the half life of a first order reaction if time for 50 % completion is 20 min. Draw [A]/[A]0 vs t.",
    "order": 1,
    "half": 20,
    "unit": "min",
    "k": 0.03465735902799726,
    "requested": true
  },
  {
    "id": "own-first-original-input-supported-4",
    "question": "What is the half life of a first order reaction X -> Y when a time for 75 % completion is 60 min? Draw [A]/[A]0 vs t.",
    "order": 1,
    "half": 30,
    "unit": "min",
    "k": 0.023104906018664842,
    "requested": true
  }
];
halfSubjectCases.push(...firstConditionalOwnerCases);
// END ADDITIVE FIRST-CONDITIONAL-OWNER CONTROLS

for(const c of halfSubjectCases)try {
 const spec=kineticsFromStem(c.question);
 const direct=buildKineticsScene(c.question,[],false);
 const schematic=buildKineticsScene(c.question,[],true);
 const ordinary=synthesizeFamilyScene({question:c.question});
 if(c.refuse){assert.equal(spec,null,"stated unread/conflicting half-life or incomplete reaction subject must refuse");assert.equal(direct,null);assert.equal(schematic,null);assert.equal(ordinary,null);}
 else {
  assert.ok(spec);assert.equal(spec.order,c.order);assert.equal(spec.timeUnit,c.unit);
  assert.equal(spec.tHalf,c.requested?null:c.half,"only the stated half-life owns its number");
  if(c.initial!==undefined)assert.equal(spec.a0,c.initial);
  const solved=solveKinetics(spec);assert.ok(solved.k!==null && solved.tHalf!==null);
  assert.ok(Math.abs(solved.k-c.k!)<=Math.abs(c.k!)*1e-12,"independent order-law k");
  assert.ok(Math.abs(solved.tHalf-c.half!)<=Math.abs(c.half!)*1e-12,"independent half-life, not a later completion time");
  if(c.interval!==undefined)assert.equal((0.50-0.25)/solved.k,c.interval,"independent zero-order concentration interval is0.25h (15min)");
  assert.ok(direct && schematic && ordinary,"complete original subject must reach all actual figure seams");
  for(const doc of [direct,schematic,ordinary.document]){
   assert.equal(doc.source.question,c.question,"complete original source identity retained");
   assert.equal(doc.quantities.find(q=>q.id==="t_half")?.value,Number(c.half!.toFixed(6)));
   assert.equal(doc.quantities.find(q=>q.id==="t_half")?.unit,c.unit);
   assert.equal(doc.quantities.find(q=>q.id==="k")?.value,Number(c.k!.toFixed(6)));
   const displayed=labels(doc);for(const text of c.labels??[])assert.ok(displayed.includes(text),JSON.stringify(displayed));
  }
 }
 results.push({id:c.id,passed:true});
}catch(error){results.push({id:c.id,passed:false,error:String(error)});console.error(`FAIL ${c.id}: ${error}`);}
// END ADDITIVE HALF-LIFE REACTION-SUBJECT GATES

// BEGIN ADDITIVE COMPOUND HALF-LIFE REQUEST GATES
interface CompoundHalfRequestCase extends HalfSubjectCase { askTime?:number; askUnit?:string; remaining?:number }
const compoundHalfRequestCases:CompoundHalfRequestCase[] = [
  {
    "id": "review-compound-request-1",
    "question": "Find the half life of a first order reaction with rate constant k = 0.0231 min^-1, and find the remaining fraction at t = 60 min.",
    "order": 1,
    "k": 0.0231,
    "half": 30.006371452811486,
    "unit": "min",
    "askTime": 60,
    "askUnit": "min",
    "remaining": 0.25007360111209415,
    "requested": true
  },
  {
    "id": "review-compound-request-2",
    "question": "Determine the half life of a first order reaction X -> Y whose rate constant is 0.0231 min^-1, and calculate the fraction remaining after 30 min. Draw the decay curve.",
    "order": 1,
    "k": 0.0231,
    "half": 30.006371452811486,
    "unit": "min",
    "askTime": 30,
    "askUnit": "min",
    "remaining": 0.5000735956957677,
    "requested": true
  },
  {
    "id": "review-compound-request-3",
    "question": "Find the half life for a first order reaction if the time for 75 % completion is 60 min, and find the remaining fraction at t = 30 min. Draw [A]/[A]0 vs t.",
    "order": 1,
    "k": 0.023104906018664842,
    "half": 30.0,
    "unit": "min",
    "askTime": 30,
    "askUnit": "min",
    "remaining": 0.5,
    "requested": true
  },
  {
    "id": "review-compound-request-4",
    "question": "Calculate the half life of a first order reaction with rate constant k = 0.0231 min^-1 and determine the fraction remaining at t = 120 min. Draw the decay curve.",
    "order": 1,
    "k": 0.0231,
    "half": 30.006371452811486,
    "unit": "min",
    "askTime": 120,
    "askUnit": "min",
    "remaining": 0.06253680597317077,
    "requested": true
  },
  {
    "id": "review-compound-request-5",
    "question": "What is the half life of a first order reaction given rate constant k = 0.0231 min^-1, and calculate the remaining fraction after 90 min? Draw [A]/[A]0 vs t.",
    "order": 1,
    "k": 0.0231,
    "half": 30.006371452811486,
    "unit": "min",
    "askTime": 90,
    "askUnit": "min",
    "remaining": 0.12505520489671404,
    "requested": true
  },
  {
    "id": "review-compound-request-damaged-1",
    "question": "Find the half life of a first order reaction with rate constant k = 0.0231 min^-1, and find the remaining fraction at t = unknown. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "review-compound-request-damaged-2",
    "question": "Determine the half life of a first order reaction X -> Y whose rate constant is 0.0231 min^-1, and calculate the fraction remaining after 1e- min. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "review-compound-request-damaged-3",
    "question": "Find the half life for a first order reaction if the time for 75 % completion is 60 min, and find the remaining fraction at t = 30 kg. Draw [A]/[A]0 vs t.",
    "refuse": true
  },
  {
    "id": "review-compound-request-damaged-4",
    "question": "Calculate the half life of a first order reaction with rate constant k = 0.0231 min^-1 and determine the fraction remaining at t = 120 min and rate constant is unknown. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "review-compound-request-damaged-5",
    "question": "Find the half life of a first order reaction with rate constant k = 0.0231 min^-1, and find the remaining fraction at t = unknown and t = 60 min. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "own-compound-request-supported-1",
    "question": "Calculate the half life of a first order reaction whose rate constant is 0.0462 min^-1 and determine the fraction remaining after 30 min. Draw the decay curve.",
    "order": 1,
    "k": 0.0462,
    "half": 15.003185726405743,
    "unit": "min",
    "askTime": 30,
    "askUnit": "min",
    "remaining": 0.25007360111209415,
    "requested": true
  },
  {
    "id": "own-compound-request-supported-2",
    "question": "Determine the half life of a first order reaction X -> Y given k = 0.00693 s^-1, and calculate the remaining fraction at the end of 200 s. Draw [A]/[A]0 vs t.",
    "order": 1,
    "k": 0.00693,
    "half": 100.02123817603828,
    "unit": "s",
    "askTime": 200,
    "askUnit": "s",
    "remaining": 0.2500736011120941,
    "requested": true
  },
  {
    "id": "own-compound-request-supported-3",
    "question": "Compute the half life of a first order reaction if time for 75 % completion is 60 min, and find the remaining concentration at t = 60 min. Draw the decay curve.",
    "order": 1,
    "k": 0.023104906018664842,
    "half": 30.0,
    "unit": "min",
    "askTime": 60,
    "askUnit": "min",
    "remaining": 0.25,
    "requested": true
  },
  {
    "id": "own-compound-request-supported-4",
    "question": "Find the half life of a first order reaction when rate constant k = 0.0231 min^-1 and evaluate the concentration remaining in the next 90 min. Draw [A]/[A]0 vs t.",
    "order": 1,
    "k": 0.0231,
    "half": 30.006371452811486,
    "unit": "min",
    "askTime": 90,
    "askUnit": "min",
    "remaining": 0.12505520489671404,
    "requested": true
  },
  {
    "id": "own-compound-request-supported-5",
    "question": "Obtain the half life of a first order reaction with rate constant k = 0.3465 h^-1, and compute the remaining fraction after 4 h. Draw the decay curve.",
    "order": 1,
    "k": 0.3465,
    "half": 2.000424763520766,
    "unit": "h",
    "askTime": 4,
    "askUnit": "h",
    "remaining": 0.25007360111209415,
    "requested": true
  },
  {
    "id": "own-compound-request-strict-1",
    "question": "Find the half life of a first order reaction with rate constant is unknown and rate constant k = 0.0231 min^-1, and find the remaining fraction at t = 60 min. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "own-compound-request-strict-2",
    "question": "Determine the half life of a first order reaction whose rate constant is unreadable and k = 0.0231 min^-1, and calculate the fraction remaining after 30 min. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "own-compound-request-strict-3",
    "question": "Find the half life of a first order reaction if time for 75 % completion is unknown and time for 50 % completion is 20 min, and find the remaining fraction at t = 60 min. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "own-compound-request-strict-4",
    "question": "Calculate the half life of a first order reaction when time for 75 % completion is 1e- min and time for 50 % completion is 20 min, and determine the fraction remaining after 30 min. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "own-compound-request-strict-5",
    "question": "Find the half life of a first order reaction with rate constant k = 0.0231 min^-1, and find the remaining fraction at t = 60 min and half life is unknown. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "own-compound-request-strict-6",
    "question": "Compute the half life of a first order reaction given k = 0.0231 min^-1, and find the remaining fraction at t = unreadable. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "own-compound-request-strict-7",
    "question": "Find the half life of a first order reaction with rate constant k = 0.0231 min^-1, and find the remaining fraction at t = 60 minfoo. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "own-compound-request-strict-8",
    "question": "Determine the half life of a first order reaction with rate constant k = 0.0231 min^-1, and calculate the fraction remaining at t = 0 min. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "own-compound-request-strict-9",
    "question": "Find the half life of a first order reaction with rate constant k = 0.0231 min^-1, and find the remaining fraction at t = -60 min. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "own-compound-request-strict-10",
    "question": "Calculate the half life of a first order reaction given k = 0.0231 min^-1, and determine the remaining fraction after 60 min, rate constant k = 0.0462 min^-1. Draw the decay curve.",
    "refuse": true
  }
];
for(const c of compoundHalfRequestCases)try {
 const spec=kineticsFromStem(c.question);
 const direct=buildKineticsScene(c.question,[],false);
 const schematic=buildKineticsScene(c.question,[],true);
 const ordinary=synthesizeFamilyScene({question:c.question});
 if(c.refuse){assert.equal(spec,null,"unread input or damaged requested time cannot be omitted");assert.equal(direct,null);assert.equal(schematic,null);assert.equal(ordinary,null);}
 else {
  assert.ok(spec);assert.equal(spec.order,c.order);assert.equal(spec.tHalf,null,"an asked half-life owns no supplied time");assert.equal(spec.timeUnit,c.unit);
  assert.deepEqual(spec.timesAsked,[c.askTime],"second request keeps its one exact source instant");
  const solved=solveKinetics(spec);assert.ok(solved.k!==null && solved.tHalf!==null);
  assert.ok(Math.abs(solved.k-c.k!)<=Math.abs(c.k!)*1e-12,"independent rate input or completion law");
  assert.ok(Math.abs(solved.tHalf-c.half!)<=Math.abs(c.half!)*1e-12,"independent first-order half-life");
  const remaining=solved.remainingAtTimes.find(entry=>entry.time===c.askTime);assert.ok(remaining);
  assert.ok(Math.abs(remaining.remaining-c.remaining!)<=1e-12,"independent exp(-kt) at the requested instant");
  assert.ok(direct && schematic && ordinary,"complete compound request must draw through every actual seam");
  for(const doc of [direct,schematic,ordinary.document]){
   assert.equal(doc.source.question,c.question);assert.equal(doc.quantities.find(q=>q.id==="t_half")?.value,Number(c.half!.toFixed(6)));
   assert.equal(doc.quantities.find(q=>q.id==="k")?.value,Number(c.k!.toFixed(6)));
   const displayed=labels(doc);const requestedLabel=new RegExp(`^t\\s*=\\s*${c.askTime}\\s+${c.askUnit}$`);
   assert.ok(displayed.some(text=>requestedLabel.test(text)),JSON.stringify(displayed));
  }
 }
 results.push({id:c.id,passed:true});
}catch(error){results.push({id:c.id,passed:false,error:String(error)});console.error(`FAIL ${c.id}: ${error}`);}
// END ADDITIVE COMPOUND HALF-LIFE REQUEST GATES

console.log(JSON.stringify({total:results.length,passed:results.filter(r=>r.passed).length,rows:results},null,2));
if(results.some(r=>!r.passed))process.exitCode=1;
