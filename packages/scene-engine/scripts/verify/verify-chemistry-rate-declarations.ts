/** Every supplied original rate declaration is read or refused; public wording oracles only. */
import assert from "node:assert/strict";
import { buildKineticsScene, kineticsFromStem, solveKinetics } from "../../src/chemistry/kinetics";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import type { SceneDocument } from "../../src/types";
interface RateCase {id:string;question:string;refuse:boolean;order?:0|1|2;k?:number;half?:number;unit?:string;initial?:number;askTime?:number}
const cases:RateCase[] = [
  {
    "id": "GREPTILE-4244042430",
    "question": "A first order reaction has rate constant is unknown; rate constant is 0.0231 min^-1. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "RATE-REFUSE-1",
    "question": "A first order reaction has k = unknown and half life 30 min. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "RATE-REFUSE-2",
    "question": "A first order reaction has rate constant 0.0231 min^-1; its rate constant is unknown. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "RATE-REFUSE-3",
    "question": "The rate constant of a first order reaction is unreadable; k is 0.0231 min^-1. Plot concentration versus time.",
    "refuse": true
  },
  {
    "id": "RATE-REFUSE-4",
    "question": "A first order reaction has k = 2 kg and rate constant 0.0231 min^-1. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "RATE-REFUSE-5",
    "question": "A first order reaction has k = 0.0231 min^-1 and k = 0.04 min^-1. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "RATE-SUPPORT-1",
    "question": "A first order reaction has k = 0.0231 min^-1. Draw the decay curve.",
    "refuse": false,
    "order": 1,
    "unit": "min",
    "k": 0.0231
  },
  {
    "id": "RATE-SUPPORT-2",
    "question": "A first order reaction has rate constant 0.0231 min^-1 and k = 0.000385 s^-1. Draw the decay curve.",
    "refuse": false,
    "order": 1,
    "unit": "min",
    "k": 0.0231
  },
  {
    "id": "RATE-SUPPORT-3",
    "question": "A first order reaction has k = 0.0231 min^-1 and rate constant 2.31e-2 min^-1. Draw the decay curve.",
    "refuse": false,
    "order": 1,
    "unit": "min",
    "k": 0.0231
  },
  {
    "id": "RATE-SUPPORT-4",
    "question": "The rate constant for the reaction is 0.0231 min^-1 and the reaction is first order. Draw the decay curve.",
    "refuse": false,
    "order": 1,
    "unit": "min",
    "k": 0.0231
  },
  {
    "id": "RATE-SUPPORT-5",
    "question": "A first order reaction has half life 30 min. Find its rate constant and draw the decay curve.",
    "refuse": false,
    "order": 1,
    "unit": "min",
    "half": 30
  },
  {
    "id": "OWN-unread-first-named",
    "question": "A first order reaction has rate constant is unreadable; k = 0.0231 min^-1. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "OWN-unread-first-symbol",
    "question": "For a first order reaction, k equals unknown and rate constant is 0.0231 min^-1. Plot [A] versus time.",
    "refuse": true
  },
  {
    "id": "OWN-unread-long-subject",
    "question": "The rate constant for this reaction is unavailable; the rate constant is 0.0231 min^-1. The reaction is first order. Draw its decay curve.",
    "refuse": true
  },
  {
    "id": "OWN-unread-before-half",
    "question": "A first order reaction has k = unknown; its half life is 30 min. Find when one fourth remains.",
    "refuse": true
  },
  {
    "id": "OWN-unread-last",
    "question": "A first order reaction has k = 0.0231 min^-1. Its rate constant is unreadable. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "OWN-wrong-order-unit",
    "question": "A first order reaction has rate constant is 0.1 M s^-1 and half life 30 min. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "OWN-damaged-exponent",
    "question": "A first order reaction has k = 1e- min^-1; k = 0.0231 min^-1. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "OWN-missing-unit",
    "question": "A first order reaction has k = 0.0231; its rate constant is 0.0231 min^-1. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "OWN-comma-unread",
    "question": "A first order reaction has rate constant, unknown; k = 0.0231 min^-1. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "OWN-conflict-symbol",
    "question": "A first order reaction has k = 0.0231 min^-1; k is 0.0462 min^-1. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "OWN-conflict-named",
    "question": "The rate constant of a first order reaction is 0.0231 min^-1; the rate constant of the reaction is 0.03 min^-1. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "OWN-agree-named",
    "question": "A first order reaction has rate constant is 0.0231 min^-1; its rate constant is 0.0231 min^-1. Draw the decay curve.",
    "refuse": false,
    "order": 1,
    "k": 0.0231,
    "unit": "min"
  },
  {
    "id": "OWN-agree-canonical",
    "question": "A first order reaction has k = 0.000385 s^-1 and rate constant is 0.0231 min^-1. Draw the decay curve.",
    "refuse": false,
    "order": 1,
    "k": 0.000385,
    "unit": "s"
  },
  {
    "id": "OWN-agree-scientific",
    "question": "For a first order reaction, k equals 2.31 x 10^-2 min^-1 and k: 0.0231 min^-1. Plot [A] versus time.",
    "refuse": false,
    "order": 1,
    "k": 0.0231,
    "unit": "min"
  },
  {
    "id": "OWN-agree-case",
    "question": "A first order reaction has Rate Constant = 0.0231 min^-1 and k is 0.0231 min^-1. Draw the decay curve.",
    "refuse": false,
    "order": 1,
    "k": 0.0231,
    "unit": "min"
  },
  {
    "id": "OWN-bounded-named-symbol-alias",
    "question": "The rate constant of a first order reaction is k = 6.93 x 10^-3 s^-1. Find the half life of the reaction.",
    "refuse": false,
    "order": 1,
    "k": 0.00693,
    "unit": "s"
  },
  {
    "id": "OWN-asked-rate-omission",
    "question": "A first order reaction has half life 30 min. Calculate the rate constant and draw [A]/[A]0 versus time.",
    "refuse": false,
    "order": 1,
    "unit": "min",
    "half": 30
  },
  {
    "id": "PROTECTED-178-close-reference",
    "question": "Find the half life of a first order reaction with rate constant k = 0.0231 min^-1, and find the remaining fraction at t = 60 min.",
    "refuse": false,
    "order": 1,
    "k": 0.0231,
    "unit": "min",
    "askTime": 60
  },
  {
    "id": "PROTECTED-178-symbolic-condition",
    "question": "What is the half life of a first order reaction for which k is 0.0231 min^-1? What fraction remains after 60 min?",
    "refuse": false,
    "order": 1,
    "k": 0.0231,
    "unit": "min",
    "askTime": 60
  },
  {
    "id": "OWN-zero-order-source",
    "question": "A zero order reaction has rate constant 0.1 M s^-1 and initial concentration 1 M. Draw [A] versus time.",
    "refuse": false,
    "order": 0,
    "k": 0.1,
    "unit": "s",
    "initial": 1
  },
  {
    "id": "OWN-second-order-source",
    "question": "A second order reaction has rate constant 0.1 L mol^-1 s^-1 and initial concentration 1 M. Draw 1/[A] versus time.",
    "refuse": false,
    "order": 2,
    "k": 0.1,
    "unit": "s",
    "initial": 1
  }
];
function expected(c:RateCase):{k:number;half:number} {
 const order=c.order??1;
 const k=c.k??(Math.LN2/c.half!);
 const half=c.half??(order===0?c.initial!/(2*k):order===2?1/(k*c.initial!):Math.LN2/k);
 return {k,half};
}
function checkDocument(c:RateCase,document:SceneDocument):void {
 const valid=validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string,unknown>));
 assert.ok(valid.document,JSON.stringify(valid.report.issues));
 const compiled=compileSceneDocument(valid.document);assert.ok(compiled.ok&&compiled.renderScene,JSON.stringify(compiled.report.issues));
 const truth=expected(c),order=c.order??1;
 const k=document.quantities.find(q=>q.id==="k"),half=document.quantities.find(q=>q.id==="t_half");
 assert.ok(k&&half,"numeric source rate and half-life quantities are required");
 assert.equal(k.value,Number(truth.k.toFixed(6)));assert.equal(half.value,Number(truth.half.toFixed(6)));
 assert.equal(k.unit,order===0?`M/${c.unit}`:order===2?`1/(M ${c.unit})`:`1/${c.unit}`);assert.equal(half.unit,c.unit);
 const caption=document.annotations.find(a=>a.id==="figure_caption")?.text;
 assert.ok(typeof caption==="string"&&caption.includes(c.unit!),"caption must retain source time unit");
 const labels=compiled.renderScene.primitives.filter(p=>p.kind==="label").map(p=>p.text??"");
 assert.ok(!/NaN|Infinity|undefined/.test([caption,...labels].join(" ")));
 if(order===1)assert.ok(caption.includes(`per ${c.unit}`),"rate caption must use the source rate time unit");
}
const results:Array<{id:string;passed:boolean;error?:string}>=[];
for(const c of cases)try {
 const spec=kineticsFromStem(c.question),exact=buildKineticsScene(c.question,[],false),schematic=buildKineticsScene(c.question,[],true),ordinary=synthesizeFamilyScene({question:c.question});
 if(c.refuse){assert.equal(spec,null);assert.equal(exact,null);assert.equal(schematic,null);assert.equal(ordinary,null);}
 else {
  assert.ok(spec,"readable original rate must remain supported");const solved=solveKinetics(spec),truth=expected(c);
  assert.equal(spec.order,c.order??1);assert.equal(solved.timeUnit,c.unit);assert.ok(solved.k!==null&&solved.tHalf!==null);
  assert.ok(Math.abs(solved.k-truth.k)<=Math.abs(truth.k)*1e-12);assert.ok(Math.abs(solved.tHalf-truth.half)<=Math.abs(truth.half)*1e-12);
  if(c.askTime!==undefined){const point=solved.remainingAtTimes.find(x=>x.time===c.askTime);assert.ok(point);assert.ok(Math.abs(point.remaining-Math.exp(-truth.k*c.askTime))<=1e-12);}
  assert.ok(exact&&schematic&&ordinary,"direct, schematic and ordinary source figure must draw");
  for(const document of [exact,schematic,ordinary.document])checkDocument(c,document);
 }
 results.push({id:c.id,passed:true});
}catch(error){results.push({id:c.id,passed:false,error:String(error)});console.error(`FAIL ${c.id}: ${error}`);}

// BEGIN ADDITIVE RATE-OPAQUE AND INITIAL-CONCENTRATION OWNER GATES
const additionalRateCases:RateCase[] = [
  {
    "id": "RATE-OPAQUE-UNREAD-1",
    "question": "For a first order reaction, the rate constant remains unknown; the rate constant is 0.0231 min^-1. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "RATE-OPAQUE-UNREAD-2",
    "question": "A first order reaction has a rate constant which is unknown; k = 0.0231 min^-1. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "RATE-OPAQUE-UNREAD-3",
    "question": "The rate constant for a first order reaction when measured is unreadable; rate constant is 0.0231 min^-1. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "RATE-OPAQUE-UNREAD-4",
    "question": "A first order reaction has a rate constant in this experiment is unavailable; k = 0.0231 min^-1. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "RATE-OPAQUE-UNREAD-5",
    "question": "A first order reaction has a rate constant, previously reported unknown; k = 0.0231 min^-1. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "OWN-opaque-rate-remains",
    "question": "A first order reaction has k remains unknown; k = 0.0231 min^-1. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "OWN-opaque-rate-reported",
    "question": "A first order reaction has rate constant was reported as unknown and k = 0.0231 min^-1. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "OWN-opaque-rate-temperature",
    "question": "The rate constant of a first order reaction at this temperature is unavailable; k = 0.0231 min^-1. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "OWN-opaque-rate-numeric",
    "question": "A first order reaction has rate constant remains 2 kg; its half life is 30 min. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "OWN-opaque-rate-request",
    "question": "Find the rate constant which is unknown for a first order reaction whose half life is 30 min. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "OWN-asked-rate-and-plot",
    "question": "A first order reaction has half life 30 min. Find its rate constant and plot the decay curve.",
    "refuse": false,
    "order": 1,
    "half": 30,
    "unit": "min"
  }
];
for(const c of additionalRateCases)try {
 const spec=kineticsFromStem(c.question),exact=buildKineticsScene(c.question,[],false),schematic=buildKineticsScene(c.question,[],true),ordinary=synthesizeFamilyScene({question:c.question});
 if(c.refuse){assert.equal(spec,null);assert.equal(exact,null);assert.equal(schematic,null);assert.equal(ordinary,null);}
 else {
  assert.ok(spec);const solved=solveKinetics(spec),truth=expected(c);
  assert.ok(solved.k!==null&&solved.tHalf!==null);assert.equal(solved.timeUnit,c.unit);
  assert.ok(Math.abs(solved.k-truth.k)<=Math.abs(truth.k)*1e-12);assert.ok(Math.abs(solved.tHalf-truth.half)<=Math.abs(truth.half)*1e-12);
  assert.ok(exact&&schematic&&ordinary);for(const document of [exact,schematic,ordinary.document])checkDocument(c,document);
 }
 results.push({id:c.id,passed:true});
}catch(error){results.push({id:c.id,passed:false,error:String(error)});console.error(`FAIL ${c.id}: ${error}`);}
interface InitialCase {id:string;question:string;refuse:boolean;initial?:number|null;half?:number}
const initialCases:InitialCase[] = [
  {
    "id": "INITIAL-UNREAD-1",
    "question": "A first order reaction has initial concentration unknown; initial concentration is 2 M. Its rate constant is 0.0231 min^-1. Draw concentration versus time.",
    "refuse": true
  },
  {
    "id": "INITIAL-UNREAD-2",
    "question": "A first order reaction has initial concentration is 2 M; initial concentration is unreadable. Its rate constant is 0.0231 min^-1. Draw concentration versus time.",
    "refuse": true
  },
  {
    "id": "INITIAL-UNREAD-3",
    "question": "For a first order reaction, initial concentration = unknown, then initial concentration = 2 mol/L. k = 0.0231 min^-1. Plot the concentration against time.",
    "refuse": true
  },
  {
    "id": "INITIAL-UNREAD-4",
    "question": "The initial concentration is unreadable. The initial concentration is 2 M and the first order rate constant is 0.0231 min^-1. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "INITIAL-UNREAD-5",
    "question": "A first order reaction has initial concentration = 2 kg; initial concentration = 2 M; k = 0.0231 min^-1. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "OWN-initial-comma-unread",
    "question": "A first order reaction has initial concentration unknown, initial concentration is 2 M. Its rate constant is 0.0231 min^-1. Draw the decay curve.",
    "refuse": true,
    "initial": null
  },
  {
    "id": "OWN-initial-alias-unread",
    "question": "A first order reaction has [A]_0 = unknown; initial concentration is 2 M. Its rate constant is 0.0231 min^-1. Draw the decay curve.",
    "refuse": true,
    "initial": null
  },
  {
    "id": "OWN-initial-A0-unread",
    "question": "A first order reaction has A0 has value unreadable; starting concentration is 2 M. Its rate constant is 0.0231 min^-1. Draw the decay curve.",
    "refuse": true,
    "initial": null
  },
  {
    "id": "OWN-initial-later-unread",
    "question": "A first order reaction has initial concentration = 2 M; starting concentration remains unknown. Its rate constant is 0.0231 min^-1. Draw the decay curve.",
    "refuse": true,
    "initial": null
  },
  {
    "id": "OWN-initial-conflict",
    "question": "A first order reaction has initial concentration is 2 M; A0 = 3 M. Its rate constant is 0.0231 min^-1. Draw the decay curve.",
    "refuse": true,
    "initial": null
  },
  {
    "id": "OWN-initial-wrong-unit",
    "question": "A first order reaction has initial concentration is 2 kg; A0 = 2 M. Its rate constant is 0.0231 min^-1. Draw the decay curve.",
    "refuse": true,
    "initial": null
  },
  {
    "id": "OWN-initial-missing-unit",
    "question": "A first order reaction has initial concentration is 2; [A]_0 = 2 M. Its rate constant is 0.0231 min^-1. Draw the decay curve.",
    "refuse": true,
    "initial": null
  },
  {
    "id": "OWN-initial-damaged",
    "question": "A first order reaction has starting concentration = 1e- M; initial concentration is 2 M. Its rate constant is 0.0231 min^-1. Draw the decay curve.",
    "refuse": true,
    "initial": null
  },
  {
    "id": "OWN-initial-agree",
    "question": "A first order reaction has initial concentration is 2 M; initial concentration is 2 mol/L. Its rate constant is 0.0231 min^-1. Draw the decay curve.",
    "refuse": false,
    "initial": 2
  },
  {
    "id": "OWN-initial-alias-agree",
    "question": "A first order reaction has starting concentration = 2 M; [A]_0 = 2 mol L^-1. Its rate constant is 0.0231 min^-1. Draw the decay curve.",
    "refuse": false,
    "initial": 2
  },
  {
    "id": "OWN-initial-named-symbol",
    "question": "A first order reaction has initial concentration is A0 = 2 M. Its rate constant is 0.0231 min^-1. Draw the decay curve.",
    "refuse": false,
    "initial": 2
  },
  {
    "id": "OWN-initial-reactant-subject",
    "question": "A first order reaction has initial concentration of the reactant is 2 M. Its rate constant is 0.0231 min^-1. Draw the decay curve.",
    "refuse": false,
    "initial": 2
  },
  {
    "id": "OWN-initial-absent",
    "question": "A first order reaction has k = 0.0231 min^-1. Draw the decay curve.",
    "refuse": false,
    "initial": null
  },
  {
    "id": "OWN-initial-denominator-reference",
    "question": "A first order reaction has half life 20 min. Draw [A]/[A]_0 versus time and find when one fourth remains.",
    "refuse": false,
    "initial": null,
    "half": 20
  },
  {
    "id": "OWN-initial-numerator-reference",
    "question": "A first order reaction has k = 0.0231 min^-1. Draw log([A]_0/[A]) versus time.",
    "refuse": false,
    "initial": null
  }
];
for(const c of initialCases)try {
 const spec=kineticsFromStem(c.question),exact=buildKineticsScene(c.question,[],false),schematic=buildKineticsScene(c.question,[],true),ordinary=synthesizeFamilyScene({question:c.question});
 if(c.refuse){assert.equal(spec,null);assert.equal(exact,null);assert.equal(schematic,null);assert.equal(ordinary,null);}
 else {
  assert.ok(spec);assert.equal(spec.a0,c.initial??null);assert.equal(spec.concUnit,c.initial===null?null:"M");
  const solved=solveKinetics(spec),k=c.half===undefined?0.0231:Math.LN2/c.half;
  assert.ok(solved.k!==null&&solved.tHalf!==null);assert.ok(Math.abs(solved.k-k)<=Math.abs(k)*1e-12);assert.ok(Math.abs(solved.tHalf-Math.LN2/k)<=Math.abs(Math.LN2/k)*1e-12);
  assert.ok(exact&&schematic&&ordinary);
  for(const document of [exact,schematic,ordinary.document]) {
   const valid=validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string,unknown>));assert.ok(valid.document,JSON.stringify(valid.report.issues));
   const compiled=compileSceneDocument(valid.document);assert.ok(compiled.ok&&compiled.renderScene,JSON.stringify(compiled.report.issues));
   assert.ok(!/NaN|Infinity|undefined/.test(compiled.renderScene.primitives.filter(p=>p.kind==="label").map(p=>p.text??"").join(" ")));
  }
 }
 results.push({id:c.id,passed:true});
}catch(error){results.push({id:c.id,passed:false,error:String(error)});console.error(`FAIL ${c.id}: ${error}`);}
// END ADDITIVE RATE-OPAQUE AND INITIAL-CONCENTRATION OWNER GATES

// BEGIN ADDITIVE COMPLETE-PAYLOAD AND QUANTITY-REFERENCE OWNER GATES
interface OwnerControl {id:string;question:string;kind:"decline"|"reference-only"|"linear"|"decay"|"arrhenius";initial?:number;Ea?:number;T1?:number;T2?:number;ratio?:number;coefficient?:number}
const ownerControls:OwnerControl[] = [
  {
    "id": "RATE-QUALITATIVE-MATERIAL-1",
    "question": "A first order reaction has rate constant doubles to 0.04 min^-1; its half life is 30 min. Draw the decay curve.",
    "kind": "decline"
  },
  {
    "id": "RATE-QUALITATIVE-MATERIAL-2",
    "question": "A first order reaction has rate constant triples to 0.06 min^-1; its half life is 30 min. Draw the decay curve.",
    "kind": "decline"
  },
  {
    "id": "RATE-QUALITATIVE-MATERIAL-3",
    "question": "A first order reaction has rate constant quadruples to 0.08 min^-1; its half life is 30 min. Draw the decay curve.",
    "kind": "decline"
  },
  {
    "id": "RATE-QUALITATIVE-MATERIAL-4",
    "question": "A first order reaction has rate constant is halved to 0.01 min^-1; its half life is 30 min. Draw the decay curve.",
    "kind": "decline"
  },
  {
    "id": "INITIAL-MATH-REFERENCE-1",
    "question": "A first order reaction has k = 0.0231 min^-1. Draw log(A0/A) versus time.",
    "kind": "linear"
  },
  {
    "id": "INITIAL-MATH-REFERENCE-2",
    "question": "A first order reaction has k = 0.0231 min^-1. Draw log(A_0/A) versus time.",
    "kind": "linear"
  },
  {
    "id": "INITIAL-MATH-REFERENCE-3",
    "question": "A first order reaction has k = 0.0231 min^-1. Draw log([A]0/[A]) versus time.",
    "kind": "linear"
  },
  {
    "id": "INITIAL-MATH-REFERENCE-4",
    "question": "A first order reaction has k = 0.0231 min^-1. Draw log([A]_0/[A]) versus time.",
    "kind": "linear"
  },
  {
    "id": "INITIAL-MATH-REFERENCE-5",
    "question": "A first order reaction has k = 0.0231 min^-1. Draw ln(A0/A) versus time.",
    "kind": "reference-only"
  },
  {
    "id": "INITIAL-DECLARED-RATIO-UNREAD",
    "question": "A first order reaction has initial concentration A0/A is unknown; initial concentration is 2 M and k = 0.0231 min^-1. Draw the decay curve.",
    "kind": "decline"
  },
  {
    "id": "INITIAL-MATH-REFERENCE-5b",
    "question": "A first order reaction has k = 0.0231 min^-1. Plot log(A0/A) against time.",
    "kind": "linear"
  },
  {
    "id": "QA-PROTECTED-ARRHENIUS-UPPER",
    "question": "For an Arrhenius reaction, k = A e^(-2000/T). Draw its Arrhenius plot.",
    "kind": "arrhenius",
    "Ea": 16628,
    "coefficient": 2000
  },
  {
    "id": "QA-PROTECTED-ARRHENIUS-LOWER",
    "question": "For an Arrhenius reaction, k = A e^(-2000/t). Draw the Arrhenius plot.",
    "kind": "arrhenius",
    "Ea": 16628,
    "coefficient": 2000
  },
  {
    "id": "QA-UNKNOWN-K-BESIDE-FORMULA-FIRST",
    "question": "The rate constant is unknown. For an Arrhenius reaction, k = A e^(-2000/T). Draw its Arrhenius plot.",
    "kind": "decline"
  },
  {
    "id": "QA-UNKNOWN-K-BESIDE-FORMULA-LAST",
    "question": "For an Arrhenius reaction, k = A e^(-2000/T). Its rate constant remains unknown. Draw its Arrhenius plot.",
    "kind": "decline"
  },
  {
    "id": "QA-RATE-REFERENCE-USE",
    "question": "A first order reaction has k = 0.0231 min^-1. Use the rate constant to draw the decay curve.",
    "kind": "decay"
  },
  {
    "id": "QA-RATE-COEFFICIENT-COMMA",
    "question": "A first order reaction has k = 0.0231 min^-1. Its rate law is r = k[A], draw the decay curve.",
    "kind": "decay"
  },
  {
    "id": "QA-QUALITATIVE-DOUBLES-CONTROL",
    "question": "The rate constant doubles when the temperature rises from 300 K to 310 K. Draw the Arrhenius plot.",
    "kind": "arrhenius",
    "Ea": 53594.27863033097,
    "T1": 300,
    "T2": 310,
    "ratio": 2
  },
  {
    "id": "QA-QUALITATIVE-IS-DOUBLED",
    "question": "The rate constant is doubled when the temperature rises from 300 K to 310 K. Draw the Arrhenius plot.",
    "kind": "arrhenius",
    "Ea": 53594.27863033097,
    "T1": 300,
    "T2": 310,
    "ratio": 2
  },
  {
    "id": "QA-QUALITATIVE-BECOMES-TWICE",
    "question": "The rate constant becomes twice its value when the temperature rises from 300 K to 310 K. Draw the Arrhenius plot.",
    "kind": "arrhenius",
    "Ea": 53594.27863033097,
    "T1": 300,
    "T2": 310,
    "ratio": 2
  },
  {
    "id": "QA-INITIAL-REFERENCE-USE",
    "question": "A first order reaction has initial concentration = 2 M and k = 0.0231 min^-1. Use the initial concentration to draw the decay curve.",
    "kind": "decay",
    "initial": 2
  },
  {
    "id": "OWN-complete-equation-1",
    "question": "For an Arrhenius reaction, k = A e^(-1000/T). Draw its Arrhenius plot.",
    "kind": "arrhenius",
    "Ea": 8314.0,
    "coefficient": 1000
  },
  {
    "id": "OWN-complete-equation-2",
    "question": "The Arrhenius equation is k = A e^(-2500/T). Draw the Arrhenius plot.",
    "kind": "arrhenius",
    "Ea": 20785.0,
    "coefficient": 2500
  },
  {
    "id": "OWN-complete-equation-3",
    "question": "For an Arrhenius reaction, k = A e^(-1800/t). Draw the Arrhenius plot.",
    "kind": "arrhenius",
    "Ea": 14965.2,
    "coefficient": 1800
  },
  {
    "id": "OWN-equation-separate-unread-1",
    "question": "The rate constant is unreadable; k = A e^(-2000/T). Draw the Arrhenius plot.",
    "kind": "decline"
  },
  {
    "id": "OWN-equation-separate-unread-2",
    "question": "For an Arrhenius reaction, k = A e^(-2000/T). k = unknown. Draw its Arrhenius plot.",
    "kind": "decline"
  },
  {
    "id": "OWN-equation-separate-unread-3",
    "question": "For an Arrhenius reaction, k = A e^(-2000/T) kg. Draw its Arrhenius plot.",
    "kind": "decline"
  },
  {
    "id": "OWN-complete-thermal-1",
    "question": "The rate constant triples when the temperature rises from 300 K to 310 K. Draw the Arrhenius plot.",
    "kind": "arrhenius",
    "T1": 300,
    "T2": 310,
    "ratio": 3,
    "Ea": 84944.92188227581
  },
  {
    "id": "OWN-complete-thermal-2",
    "question": "The rate constant is quadrupled when the temperature rises from 300 K to 310 K. Draw the Arrhenius plot.",
    "kind": "arrhenius",
    "T1": 300,
    "T2": 310,
    "ratio": 4,
    "Ea": 107188.55726066194
  },
  {
    "id": "OWN-complete-thermal-3",
    "question": "The rate constant becomes twice its value when the temperature rises from 320 K to 330 K. Draw the Arrhenius plot.",
    "kind": "arrhenius",
    "T1": 320,
    "T2": 330,
    "ratio": 2,
    "Ea": 60855.43896089195
  },
  {
    "id": "OWN-qualitative-supplied-material-1",
    "question": "A first order reaction has rate constant doubles to unknown; its half life is 30 min. Draw the decay curve.",
    "kind": "decline"
  },
  {
    "id": "OWN-qualitative-supplied-material-2",
    "question": "A first order reaction has rate constant is doubled to 2 kg; its half life is 30 min. Draw the decay curve.",
    "kind": "decline"
  },
  {
    "id": "OWN-qualitative-supplied-material-3",
    "question": "A first order reaction has rate constant becomes twice its value to 0.04 min^-1; its half life is 30 min. Draw the decay curve.",
    "kind": "decline"
  },
  {
    "id": "OWN-qualitative-supplied-material-4",
    "question": "The rate constant doubles when the temperature rises from 300 K to 310 K but remains unreadable. Draw its Arrhenius plot.",
    "kind": "decline"
  },
  {
    "id": "OWN-rate-use-reference-1",
    "question": "A first order reaction has k = 0.0231 min^-1. Use its rate constant to plot the decay curve.",
    "kind": "decay"
  },
  {
    "id": "OWN-rate-use-reference-2",
    "question": "A first order reaction has k = 0.0231 min^-1. Use a rate constant to sketch the decay curve.",
    "kind": "decay"
  },
  {
    "id": "OWN-rate-use-reference-3",
    "question": "A first order reaction has k = 0.0231 min^-1. Use the rate constant to plot its decay curve.",
    "kind": "decay"
  },
  {
    "id": "OWN-rate-coefficient-reference-1",
    "question": "A first order reaction has k = 0.0231 min^-1. Its rate law is rate = k[A], draw the decay curve.",
    "kind": "decay"
  },
  {
    "id": "OWN-rate-coefficient-reference-2",
    "question": "A first order reaction has k = 0.0231 min^-1. Its rate law is r = k[A] and plot the decay curve.",
    "kind": "decay"
  },
  {
    "id": "OWN-rate-coefficient-reference-3",
    "question": "A first order reaction has k = 0.0231 min^-1. Its rate law is rate = k[A], and sketch its decay curve.",
    "kind": "decay"
  },
  {
    "id": "OWN-reference-supplied-material-1",
    "question": "A first order reaction has k = 0.0231 min^-1. Use the unreadable rate constant to draw the decay curve.",
    "kind": "decline"
  },
  {
    "id": "OWN-reference-supplied-material-2",
    "question": "A first order reaction has k = 0.0231 min^-1. Its rate law is r = k[A], given as unknown. Draw the decay curve.",
    "kind": "decline"
  },
  {
    "id": "OWN-reference-supplied-material-3",
    "question": "A first order reaction has k = 0.0231 min^-1. Use the rate constant to draw the curve with unknown value.",
    "kind": "decline"
  },
  {
    "id": "OWN-initial-use-reference-1",
    "question": "A first order reaction has initial concentration = 2 M and k = 0.0231 min^-1. Use its initial concentration to plot the decay curve.",
    "kind": "decay",
    "initial": 2
  },
  {
    "id": "OWN-initial-use-reference-2",
    "question": "A first order reaction has initial concentration = 2 M and k = 0.0231 min^-1. Use a starting concentration to sketch the decay curve.",
    "kind": "decay",
    "initial": 2
  },
  {
    "id": "OWN-initial-use-reference-3",
    "question": "A first order reaction has initial concentration = 2 M and k = 0.0231 min^-1. Use the initial concentration to plot its decay curve.",
    "kind": "decay",
    "initial": 2
  },
  {
    "id": "OWN-initial-reference-supplied-1",
    "question": "A first order reaction has initial concentration = 2 M and k = 0.0231 min^-1. Use the unknown initial concentration to draw the decay curve.",
    "kind": "decline"
  },
  {
    "id": "OWN-initial-reference-supplied-2",
    "question": "A first order reaction has starting concentration A_0/A is unreadable; initial concentration is 2 M and k = 0.0231 min^-1. Draw the decay curve.",
    "kind": "decline"
  },
  {
    "id": "OWN-initial-reference-supplied-3",
    "question": "A first order reaction has initial concentration [A]_0/[A] is unknown; A0 = 2 M and k = 0.0231 min^-1. Draw the decay curve.",
    "kind": "decline"
  },
  {
    "id": "OWN-initial-reference-supplied-4",
    "question": "A first order reaction has A0 = unknown; initial concentration is 2 M and k = 0.0231 min^-1. Draw log(A0/A) versus time.",
    "kind": "decline"
  },
  {
    "id": "OWN-math-ratio-unread-numerator",
    "question": "A first order reaction has A0/A is unknown; initial concentration is 2 M and k = 0.0231 min^-1. Draw the decay curve.",
    "kind": "decline"
  },
  {
    "id": "OWN-math-ratio-unread-denominator",
    "question": "A first order reaction has A/A0 is unknown; initial concentration is 2 M and k = 0.0231 min^-1. Draw the decay curve.",
    "kind": "decline"
  },
  {
    "id": "OWN-math-ratio-unread-bracket",
    "question": "A first order reaction has [A]/[A]_0 = unreadable; initial concentration is 2 M and k = 0.0231 min^-1. Draw the decay curve.",
    "kind": "decline"
  }
];
for(const c of ownerControls)try {
 const spec=kineticsFromStem(c.question);
 if(c.kind==="decline") {
  assert.equal(spec,null);assert.equal(buildKineticsScene(c.question,[],false),null);assert.equal(buildKineticsScene(c.question,[],true),null);assert.equal(synthesizeFamilyScene({question:c.question}),null);
 } else {
  assert.ok(spec,"complete original input/reference must remain readable");
  assert.equal(spec.a0,c.initial??null);
  const solved=solveKinetics(spec);
  if(c.kind==="arrhenius") {
   assert.equal(spec.plot,"arrhenius");assert.ok(spec.arrhenius&&solved.Ea!==null&&c.Ea!==undefined);
   assert.ok(Math.abs(solved.Ea-c.Ea)<=Math.abs(c.Ea)*1e-12);
   if(c.coefficient!==undefined){assert.equal(spec.arrhenius.statedSlope?.b,c.coefficient);assert.equal(spec.arrhenius.statedSlope?.natural,true);assert.equal(spec.k,null);}
   if(c.T1!==undefined){assert.equal(spec.arrhenius.T1,c.T1);assert.equal(solved.T2,c.T2);assert.equal(solved.ratio,c.ratio);}
  } else {
   assert.equal(spec.order,1);assert.equal(solved.timeUnit,"min");assert.ok(solved.k!==null&&solved.tHalf!==null);
   assert.ok(Math.abs(solved.k-0.0231)<=0.0231*1e-12);assert.ok(Math.abs(solved.tHalf-Math.LN2/0.0231)<=Math.LN2/0.0231*1e-12);
   if(c.kind==="linear"){assert.equal(spec.plot,"linear");assert.equal(spec.linear,"logA0A_t");}
  }
  // Frozen ln(A0/A) is an ownership-only control, not a supported plot claim.
  if(c.kind!=="reference-only") {
   const exact=buildKineticsScene(c.question,[],false),schematic=buildKineticsScene(c.question,[],true),ordinary=synthesizeFamilyScene({question:c.question});assert.ok(exact&&schematic&&ordinary);
   for(const document of [exact,schematic,ordinary.document]) {
    const valid=validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string,unknown>));assert.ok(valid.document,JSON.stringify(valid.report.issues));
    const compiled=compileSceneDocument(valid.document);assert.ok(compiled.ok&&compiled.renderScene,JSON.stringify(compiled.report.issues));
    const texts=compiled.renderScene.primitives.filter(p=>p.kind==="label").map(p=>p.text??"");assert.ok(!/NaN|Infinity|undefined/.test(texts.join(" ")));
    assert.ok(document.quantities.every(q=>Number.isFinite(q.value)));
    if(c.kind==="decay")checkDocument({id:c.id,question:c.question,refuse:false,order:1,k:0.0231,unit:"min",initial:c.initial},document);
    if(c.kind==="linear")assert.ok(texts.some(t=>t.includes("log([A]_0/[A])")),"the requested log-ratio axis must survive compilation");
    if(c.kind==="arrhenius") {
     const caption=document.annotations.find(a=>a.id==="figure_caption")?.text;assert.ok(typeof caption==="string"&&caption.includes(`${Number((c.Ea!/1000).toPrecision(3))} kJ/mol`));
     if(c.T1!==undefined){const ea=document.quantities.find(q=>q.id==="Ea");assert.ok(ea);assert.equal(ea.value,Number(c.Ea!.toFixed(6)));assert.equal(ea.unit,"J/mol");}
    }
   }
  }
 }
 results.push({id:c.id,passed:true});
}catch(error){results.push({id:c.id,passed:false,error:String(error)});console.error(`FAIL ${c.id}: ${error}`);}
// END ADDITIVE COMPLETE-PAYLOAD AND QUANTITY-REFERENCE OWNER GATES

// BEGIN ADDITIVE NAMED RATE-ALIAS ROLE GATES
const namedRateAliasCases:RateCase[] = [
  {
    "id": "OWN-declared-rate-coefficient-1",
    "question": "A first order reaction has rate constant = k[A]; its half life is 30 min. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "OWN-declared-rate-coefficient-2",
    "question": "A first order reaction has rate constant is k[A], draw the decay curve. Its half life is 30 min.",
    "refuse": true
  },
  {
    "id": "OWN-declared-rate-coefficient-3",
    "question": "The rate constant for a first order reaction is k[A]. Its half life is 30 min. Draw the decay curve.",
    "refuse": true
  },
  {
    "id": "OWN-declared-rate-numeric-alias-1",
    "question": "A first order reaction has rate constant: k = 0.0231 min^-1. Draw the decay curve.",
    "refuse": false,
    "order": 1,
    "k": 0.0231,
    "unit": "min"
  },
  {
    "id": "OWN-declared-rate-numeric-alias-2",
    "question": "The rate constant of a first order reaction equals k is 0.0231 min^-1. Draw the decay curve.",
    "refuse": false,
    "order": 1,
    "k": 0.0231,
    "unit": "min"
  },
  {
    "id": "OWN-declared-rate-numeric-alias-3",
    "question": "A first order reaction has rate constant = k = 0.000385 s^-1. Draw the decay curve.",
    "refuse": false,
    "order": 1,
    "k": 0.000385,
    "unit": "s"
  }
];
for(const c of namedRateAliasCases)try {
 const spec=kineticsFromStem(c.question),exact=buildKineticsScene(c.question,[],false),schematic=buildKineticsScene(c.question,[],true),ordinary=synthesizeFamilyScene({question:c.question});
 if(c.refuse){assert.equal(spec,null);assert.equal(exact,null);assert.equal(schematic,null);assert.equal(ordinary,null);}
 else {
  assert.ok(spec);const solved=solveKinetics(spec),truth=expected(c);assert.equal(spec.order,1);assert.equal(solved.timeUnit,c.unit);
  assert.ok(solved.k!==null&&solved.tHalf!==null);assert.ok(Math.abs(solved.k-truth.k)<=Math.abs(truth.k)*1e-12);assert.ok(Math.abs(solved.tHalf-truth.half)<=Math.abs(truth.half)*1e-12);
  assert.ok(exact&&schematic&&ordinary);for(const document of [exact,schematic,ordinary.document])checkDocument(c,document);
 }
 results.push({id:c.id,passed:true});
}catch(error){results.push({id:c.id,passed:false,error:String(error)});console.error(`FAIL ${c.id}: ${error}`);}
// END ADDITIVE NAMED RATE-ALIAS ROLE GATES

// BEGIN ADDITIVE CLOSED REQUESTED-QUANTITY PAYLOAD GATES
const closedRequestCases:RateCase[] = [
  {
    "id": "INDEPENDENT-KINETICS-CLOSED-REQUEST-1",
    "question": "A first order reaction has half life 30 min. Find the rate constant and draw the decay curve, taking its value as 0.04 min^-1.",
    "refuse": true
  },
  {
    "id": "INDEPENDENT-KINETICS-CLOSED-REQUEST-2",
    "question": "A first order reaction has half life 30 min. Calculate the rate constant and plot the decay curve, using a supplied value of 0.05 min^-1.",
    "refuse": true
  },
  {
    "id": "INDEPENDENT-KINETICS-CLOSED-REQUEST-3",
    "question": "A first order reaction has half life 30 min. Determine the rate constant and sketch the decay curve with its stated value of 0.02 min^-1.",
    "refuse": true
  },
  {
    "id": "INDEPENDENT-KINETICS-CLOSED-REQUEST-4",
    "question": "A first order reaction has half life 30 min. Find k and draw the decay curve, where its value is 0.04 min^-1.",
    "refuse": true
  },
  {
    "id": "INDEPENDENT-KINETICS-CLOSED-REQUEST-5",
    "question": "A first order reaction has half life 30 min. Evaluate the rate constant and draw the decay curve, taking its value as 3 M.",
    "refuse": true
  },
  {
    "id": "INDEPENDENT-KINETICS-CLOSED-REQUEST-6",
    "question": "A first order reaction has half life 30 min. Find the initial concentration and draw the decay curve, taking its value as 3 M.",
    "refuse": true
  },
  {
    "id": "INDEPENDENT-KINETICS-CLOSED-REQUEST-7",
    "question": "A first order reaction has half life 30 min. Calculate the initial concentration and plot the decay curve, using a supplied value of 4 M.",
    "refuse": true
  },
  {
    "id": "INDEPENDENT-KINETICS-CLOSED-REQUEST-8",
    "question": "A first order reaction has half life 30 min. Determine the starting concentration and sketch the decay curve with its stated value of 5 M.",
    "refuse": true
  },
  {
    "id": "INDEPENDENT-KINETICS-CLOSED-REQUEST-9",
    "question": "A first order reaction has half life 30 min. Find A0 and draw the decay curve, where its value is 3 M.",
    "refuse": true
  },
  {
    "id": "INDEPENDENT-KINETICS-CLOSED-REQUEST-10",
    "question": "A first order reaction has half life 30 min. Evaluate the initial concentration and draw the decay curve, taking its value as 2 kg.",
    "refuse": true
  },
  {
    "id": "INDEPENDENT-KINETICS-CLOSED-REQUEST-SUPPORT-1",
    "question": "A first order reaction has half life 30 min. Find the rate constant and draw the decay curve.",
    "refuse": false,
    "order": 1,
    "unit": "min",
    "half": 30
  },
  {
    "id": "INDEPENDENT-KINETICS-CLOSED-REQUEST-SUPPORT-2",
    "question": "A first order reaction has k = 0.0231 min^-1 and initial concentration is 2 M. Find the initial concentration and draw the decay curve.",
    "refuse": false,
    "order": 1,
    "unit": "min",
    "k": 0.0231,
    "initial": 2
  },
  {
    "id": "OWN-pure-rate-request-1",
    "question": "A first order reaction has half life 30 min. Calculate the rate constant and draw [A]/[A]0 versus time.",
    "refuse": false,
    "order": 1,
    "unit": "min",
    "half": 30
  },
  {
    "id": "OWN-pure-rate-request-2",
    "question": "A first order reaction has half life 30 min. Find k and sketch the decay curve.",
    "refuse": false,
    "order": 1,
    "unit": "min",
    "half": 30
  },
  {
    "id": "OWN-pure-rate-request-3",
    "question": "A first order reaction has half life 30 min. Determine its rate constant and plot the normalized decay curve.",
    "refuse": false,
    "order": 1,
    "unit": "min",
    "half": 30
  },
  {
    "id": "OWN-pure-rate-request-4",
    "question": "A first order reaction has half life 30 min. Obtain the rate constant and draw log([A]_0/[A]) against time.",
    "refuse": false,
    "order": 1,
    "unit": "min",
    "half": 30
  },
  {
    "id": "OWN-pure-initial-request-1",
    "question": "A first order reaction has initial concentration = 2 M and k = 0.0231 min^-1. Find its initial concentration and sketch the decay curve.",
    "refuse": false,
    "order": 1,
    "unit": "min",
    "k": 0.0231,
    "initial": 2
  },
  {
    "id": "OWN-pure-initial-request-2",
    "question": "A first order reaction has A0 = 2 M and k = 0.0231 min^-1. Calculate A0 and draw the normalized decay curve.",
    "refuse": false,
    "order": 1,
    "unit": "min",
    "k": 0.0231,
    "initial": 2
  },
  {
    "id": "OWN-pure-initial-request-3",
    "question": "A first order reaction has starting concentration = 2 M and k = 0.0231 min^-1. Determine the starting concentration and plot the decay curve.",
    "refuse": false,
    "order": 1,
    "unit": "min",
    "k": 0.0231,
    "initial": 2
  },
  {
    "id": "OWN-request-reference-supplied-1",
    "question": "A first order reaction has half life 30 min. Find the rate constant and draw the decay curve, taking its value as unknown.",
    "refuse": true
  },
  {
    "id": "OWN-request-reference-supplied-2",
    "question": "A first order reaction has half life 30 min. Find k and plot the decay curve assuming a value of 1e- min^-1.",
    "refuse": true
  },
  {
    "id": "OWN-request-reference-supplied-3",
    "question": "A first order reaction has half life 30 min. Calculate the rate constant and draw [A]/[A]0 versus time, using its value of 0.04 min^-1.",
    "refuse": true
  },
  {
    "id": "OWN-request-reference-supplied-4",
    "question": "A first order reaction has half life 30 min. Determine the initial concentration and draw the decay curve taking its amount as unknown.",
    "refuse": true
  },
  {
    "id": "OWN-request-reference-supplied-5",
    "question": "A first order reaction has initial concentration = 2 M and k = 0.0231 min^-1. Find the initial concentration and sketch its curve using a supplied value of 3 M.",
    "refuse": true
  },
  {
    "id": "OWN-request-reference-supplied-6",
    "question": "A first order reaction has A0 = 2 M and k = 0.0231 min^-1. Calculate A0 and draw the decay curve assuming 2 kg.",
    "refuse": true
  },
  {
    "id": "OWN-request-reference-supplied-7",
    "question": "A first order reaction has k = 0.0231 min^-1. Use the rate constant to draw the decay curve taking its value as 0.04 min^-1.",
    "refuse": true
  },
  {
    "id": "OWN-request-reference-supplied-8",
    "question": "A first order reaction has k = 0.0231 min^-1. Its rate law is r = k[A], draw the decay curve using its value as 0.04 min^-1.",
    "refuse": true
  }
];
for(const c of closedRequestCases)try {
 const spec=kineticsFromStem(c.question),exact=buildKineticsScene(c.question,[],false),schematic=buildKineticsScene(c.question,[],true),ordinary=synthesizeFamilyScene({question:c.question});
 if(c.refuse){assert.equal(spec,null);assert.equal(exact,null);assert.equal(schematic,null);assert.equal(ordinary,null);}
 else {
  assert.ok(spec);assert.equal(spec.a0,c.initial??null);const solved=solveKinetics(spec),truth=expected(c);assert.equal(spec.order,1);assert.equal(solved.timeUnit,c.unit);
  assert.ok(solved.k!==null&&solved.tHalf!==null);assert.ok(Math.abs(solved.k-truth.k)<=Math.abs(truth.k)*1e-12);assert.ok(Math.abs(solved.tHalf-truth.half)<=Math.abs(truth.half)*1e-12);
  assert.ok(exact&&schematic&&ordinary);for(const document of [exact,schematic,ordinary.document]) {
   if(spec.plot!=="linear")checkDocument(c,document);
   else {
    const valid=validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string,unknown>));assert.ok(valid.document,JSON.stringify(valid.report.issues));
    const compiled=compileSceneDocument(valid.document);assert.ok(compiled.ok&&compiled.renderScene,JSON.stringify(compiled.report.issues));
    const k=document.quantities.find(q=>q.id==="k"),half=document.quantities.find(q=>q.id==="t_half");assert.ok(k&&half);assert.equal(k.value,Number(truth.k.toFixed(6)));assert.equal(half.value,Number(truth.half.toFixed(6)));assert.equal(k.unit,`1/${c.unit}`);assert.equal(half.unit,c.unit);
    assert.ok(!/NaN|Infinity|undefined/.test(compiled.renderScene.primitives.filter(p=>p.kind==="label").map(p=>p.text??"").join(" ")));
    assert.equal(spec.linear,"logA0A_t");assert.ok(document.annotations.some(a=>a.id==="figure_caption"&&a.text?.includes(` ${c.unit}.`)));
   }
  }
 }
 results.push({id:c.id,passed:true});
}catch(error){results.push({id:c.id,passed:false,error:String(error)});console.error(`FAIL ${c.id}: ${error}`);}
// END ADDITIVE CLOSED REQUESTED-QUANTITY PAYLOAD GATES

const output={schema:"chemistry-rate-declarations-gate/v1",passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length,results};
console.log(JSON.stringify(output,null,2));assert.equal(output.failed,0);
