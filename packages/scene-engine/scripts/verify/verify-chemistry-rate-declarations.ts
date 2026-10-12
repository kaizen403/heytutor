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

// BEGIN ADDITIVE STATED RATE/HALF-LIFE TIME PROJECTION GATES
import { readChemistryQuantity as readProjectionSourceQuantity } from "../../src/chemistry/quantityReader";
interface TimeProjectionCase extends RateCase {sourceK:number;sourceTimeUnit:"s"|"min"|"h";sourceRawUnit:string}
const timeProjectionCases:TimeProjectionCase[] = [
  {
    "id": "MIXED-TIME-s-to-min-1",
    "question": "A first order reaction has k = 0.000385 s^-1 and half life 30.006371452811486 min. Draw the decay curve.",
    "refuse": false,
    "order": 1,
    "k": 0.0231,
    "half": 30.006371452811486,
    "unit": "min",
    "sourceK": 0.000385,
    "sourceTimeUnit": "s",
    "sourceRawUnit": "s^-1"
  },
  {
    "id": "MIXED-TIME-s-to-min-2",
    "question": "A first order reaction has k = 0.002 s^-1 and half life 5.776226504666211 min. Draw the decay curve.",
    "refuse": false,
    "order": 1,
    "k": 0.12,
    "half": 5.776226504666211,
    "unit": "min",
    "sourceK": 0.002,
    "sourceTimeUnit": "s",
    "sourceRawUnit": "s^-1"
  },
  {
    "id": "MIXED-TIME-s-to-min-3",
    "question": "A first order reaction has k = 0.001 s^-1 and half life 11.552453009332423 min. Draw the decay curve.",
    "refuse": false,
    "order": 1,
    "k": 0.06,
    "half": 11.552453009332423,
    "unit": "min",
    "sourceK": 0.001,
    "sourceTimeUnit": "s",
    "sourceRawUnit": "s^-1"
  },
  {
    "id": "MIXED-TIME-min-to-s-1",
    "question": "A first order reaction has k = 0.0231 min^-1 and half life 1800.3822871686891 s. Draw the decay curve.",
    "refuse": false,
    "order": 1,
    "k": 0.000385,
    "half": 1800.3822871686891,
    "unit": "s",
    "sourceK": 0.0231,
    "sourceTimeUnit": "min",
    "sourceRawUnit": "min^-1"
  },
  {
    "id": "MIXED-TIME-min-to-s-2",
    "question": "A first order reaction has k = 0.12 min^-1 and half life 346.5735902799727 s. Draw the decay curve.",
    "refuse": false,
    "order": 1,
    "k": 0.002,
    "half": 346.5735902799727,
    "unit": "s",
    "sourceK": 0.12,
    "sourceTimeUnit": "min",
    "sourceRawUnit": "min^-1"
  },
  {
    "id": "MIXED-TIME-min-to-s-3",
    "question": "A first order reaction has k = 0.06 min^-1 and half life 693.1471805599452 s. Draw the decay curve.",
    "refuse": false,
    "order": 1,
    "k": 0.001,
    "half": 693.1471805599452,
    "unit": "s",
    "sourceK": 0.06,
    "sourceTimeUnit": "min",
    "sourceRawUnit": "min^-1"
  },
  {
    "id": "MIXED-TIME-h-to-min",
    "question": "A first order reaction has k = 0.6931471805599453 h^-1 and half life 60 min. Draw the decay curve.",
    "refuse": false,
    "order": 1,
    "k": 0.011552453009332421,
    "half": 60,
    "unit": "min",
    "sourceK": 0.6931471805599453,
    "sourceTimeUnit": "h",
    "sourceRawUnit": "h^-1"
  },
  {
    "id": "MIXED-TIME-min-to-h",
    "question": "A first order reaction has k = 0.011552453009332421 min^-1 and half life 1 h. Draw the decay curve.",
    "refuse": false,
    "order": 1,
    "k": 0.6931471805599453,
    "half": 1,
    "unit": "h",
    "sourceK": 0.011552453009332421,
    "sourceTimeUnit": "min",
    "sourceRawUnit": "min^-1"
  },
  {
    "id": "MIXED-TIME-same-min",
    "question": "A first order reaction has k = 0.0231 min^-1 and half life 30.006371452811486 min. Draw the decay curve.",
    "refuse": false,
    "order": 1,
    "k": 0.0231,
    "half": 30.006371452811486,
    "unit": "min",
    "sourceK": 0.0231,
    "sourceTimeUnit": "min",
    "sourceRawUnit": "min^-1"
  },
  {
    "id": "MIXED-TIME-same-s",
    "question": "A first order reaction has k = 0.000385 s^-1 and half life 1800.3822871686891 s. Draw the decay curve.",
    "refuse": false,
    "order": 1,
    "k": 0.000385,
    "half": 1800.3822871686891,
    "unit": "s",
    "sourceK": 0.000385,
    "sourceTimeUnit": "s",
    "sourceRawUnit": "s^-1"
  },
  {
    "id": "MIXED-TIME-same-h",
    "question": "A first order reaction has k = 0.6931471805599453 h^-1 and half life 1 h. Draw the decay curve.",
    "refuse": false,
    "order": 1,
    "k": 0.6931471805599453,
    "half": 1,
    "unit": "h",
    "sourceK": 0.6931471805599453,
    "sourceTimeUnit": "h",
    "sourceRawUnit": "h^-1"
  },
  {
    "id": "MIXED-TIME-zero-s-to-min",
    "question": "A zero order reaction has k = 0.0016666666666666668 M s^-1 and half life 10 min. The initial concentration is 2 M. Draw [A] versus time.",
    "refuse": false,
    "order": 0,
    "k": 0.1,
    "half": 10,
    "unit": "min",
    "sourceK": 0.0016666666666666668,
    "sourceTimeUnit": "s",
    "sourceRawUnit": "M s^-1",
    "initial": 2
  },
  {
    "id": "MIXED-TIME-second-s-to-min",
    "question": "A second order reaction has k = 0.0016666666666666668 L mol^-1 s^-1 and half life 5 min. The initial concentration is 2 M. Draw 1/[A] versus time.",
    "refuse": false,
    "order": 2,
    "k": 0.1,
    "half": 5,
    "unit": "min",
    "sourceK": 0.0016666666666666668,
    "sourceTimeUnit": "s",
    "sourceRawUnit": "L mol^-1 s^-1",
    "initial": 2
  }
];
for(const c of timeProjectionCases)try {
 const dimension=c.order===0?"rate_constant_zero":c.order===2?"rate_constant_second":"rate_constant_first";
 const raw=readProjectionSourceQuantity({question:c.question,after:/\bk\s*=/,dimension});assert.ok(raw.ok);assert.equal(raw.reading.rawValue,c.sourceK);assert.equal(raw.reading.rawUnit,c.sourceRawUnit);assert.ok(raw.reading.source.text.includes(String(c.sourceK)));
 const spec=kineticsFromStem(c.question);assert.ok(spec);assert.equal(spec.order,c.order);assert.equal(spec.timeUnit,c.unit);assert.equal(spec.kUnit,c.sourceTimeUnit);assert.equal(spec.a0,c.initial??null);
 const solved=solveKinetics(spec),truth=expected(c);assert.ok(spec.k!==null&&solved.k!==null&&solved.tHalf!==null);
 assert.ok(Math.abs(spec.k-truth.k)<=Math.abs(truth.k)*1e-12);assert.ok(Math.abs(solved.k-truth.k)<=Math.abs(truth.k)*1e-12);assert.equal(solved.tHalf,c.half);
 const law=c.order===0?c.initial!/(2*truth.k):c.order===2?1/(truth.k*c.initial!):Math.LN2/truth.k;assert.ok(Math.abs(solved.tHalf-law)<=Math.abs(law)*1e-12);assert.equal(solved.timeUnit,c.unit);
 const exact=buildKineticsScene(c.question,[],false),schematic=buildKineticsScene(c.question,[],true),ordinary=synthesizeFamilyScene({question:c.question});assert.ok(exact&&schematic&&ordinary);
 for(const document of [exact,schematic,ordinary.document])checkDocument(c,document);
 results.push({id:c.id,passed:true});
}catch(error){results.push({id:c.id,passed:false,error:String(error)});console.error(`FAIL ${c.id}: ${error}`);}
// END ADDITIVE STATED RATE/HALF-LIFE TIME PROJECTION GATES

// BEGIN ADDITIVE LINEAR RATE QUANTITY UNIT-ROLE GATES
const linearUnitCases:(RateCase&{axis:string})[] = [
  {
    "id": "LINEAR-RATE-UNIT-zero-min",
    "question": "A zero order reaction has k = 0.2 M min^-1 and initial concentration is 2 M. Draw [A] against time.",
    "refuse": false,
    "order": 0,
    "k": 0.2,
    "initial": 2,
    "half": 5,
    "unit": "min",
    "axis": "[A]"
  },
  {
    "id": "LINEAR-RATE-UNIT-zero-h",
    "question": "A zero order reaction has k = 0.01 M h^-1 and initial concentration is 1 M. Draw [A] versus time.",
    "refuse": false,
    "order": 0,
    "k": 0.01,
    "initial": 1,
    "half": 50,
    "unit": "h",
    "axis": "[A]"
  },
  {
    "id": "LINEAR-RATE-UNIT-second-min",
    "question": "A second order reaction has k = 0.05 L mol^-1 min^-1 and initial concentration is 1 M. Draw 1/[A] against time.",
    "refuse": false,
    "order": 2,
    "k": 0.05,
    "initial": 1,
    "half": 20,
    "unit": "min",
    "axis": "1/[A]"
  },
  {
    "id": "LINEAR-RATE-UNIT-second-h",
    "question": "A second order reaction has k = 0.25 L mol^-1 h^-1 and initial concentration is 2 M. Draw 1/[A] versus time.",
    "refuse": false,
    "order": 2,
    "k": 0.25,
    "initial": 2,
    "half": 2,
    "unit": "h",
    "axis": "1/[A]"
  }
];
for(const c of linearUnitCases)try {
 const spec=kineticsFromStem(c.question);assert.ok(spec);assert.equal(spec.order,c.order);assert.equal(spec.plot,"linear");assert.equal(spec.a0,c.initial);
 const solved=solveKinetics(spec),truth=expected(c);assert.ok(solved.k!==null&&solved.tHalf!==null);assert.ok(Math.abs(solved.k-truth.k)<=Math.abs(truth.k)*1e-12);assert.ok(Math.abs(solved.tHalf-truth.half)<=Math.abs(truth.half)*1e-12);assert.equal(solved.timeUnit,c.unit);
 const exact=buildKineticsScene(c.question,[],false),schematic=buildKineticsScene(c.question,[],true),ordinary=synthesizeFamilyScene({question:c.question});assert.ok(exact&&schematic&&ordinary);
 for(const document of [exact,schematic,ordinary.document]) {
  checkDocument(c,document);
  const valid=validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string,unknown>));assert.ok(valid.document);
  const compiled=compileSceneDocument(valid.document);assert.ok(compiled.ok&&compiled.renderScene);const texts=compiled.renderScene.primitives.filter(p=>p.kind==="label").map(p=>p.text??"");
  const expectedAxis=c.order===0?`${c.axis} (M)`:c.axis;
  const axisOwner=document.entities.find(e=>e.id===(c.order===0?"z_yl":"s_yl")&&e.kind==="label"&&(e.role==="axis label"||e.role==="direction marker")&&e.label===expectedAxis);assert.ok(axisOwner,"the source axis must include its physical concentration unit");
  assert.ok(compiled.renderScene.primitives.some(p=>p.kind==="label"&&p.entityId===axisOwner.id&&p.text===expectedAxis));assert.ok(texts.some(t=>t.includes("t_1/2")&&t.includes(c.unit!)),"compiled half-life mark must retain its source time unit");
 }
 results.push({id:c.id,passed:true});
}catch(error){results.push({id:c.id,passed:false,error:String(error)});console.error(`FAIL ${c.id}: ${error}`);}
// END ADDITIVE LINEAR RATE QUANTITY UNIT-ROLE GATES

// BEGIN ADDITIVE RATE-REPEAT AND USE-DELIMITER REPAIR GATES
const repairedRateCases:RateCase[] = [
  {
    "id": "REPAIR-agree-source-1",
    "question": "A first order reaction has rate constant is 0.0462 min^-1; its rate constant is 0.0462 min^-1. Draw the decay curve.",
    "refuse": false,
    "order": 1,
    "k": 0.0462,
    "unit": "min"
  },
  {
    "id": "REPAIR-agree-source-2",
    "question": "A first order reaction has k = 0.00077 s^-1 and rate constant is 0.0462 min^-1. Draw the decay curve.",
    "refuse": false,
    "order": 1,
    "k": 0.00077,
    "unit": "s"
  },
  {
    "id": "REPAIR-agree-source-3",
    "question": "At 298 K a first order reaction has Rate Constant = 0.0231 min^-1 and k is 2.31e-2 min^-1. Draw the decay curve.",
    "refuse": false,
    "order": 1,
    "k": 0.0231,
    "unit": "min"
  },
  {
    "id": "REPAIR-agree-source-4",
    "question": "A first order reaction has k = 0.0231 min^-1, rate constant is 0.000385 s^-1, and k = 2.31e-2 min^-1. Draw the decay curve.",
    "refuse": false,
    "order": 1,
    "k": 0.0231,
    "unit": "min"
  },
  {
    "id": "REPAIR-use-source-1",
    "question": "A first order reaction has k = 0.0231 min^-1. Use\tthe\trate constant\tto draw the decay curve.",
    "refuse": false,
    "order": 1,
    "k": 0.0231,
    "unit": "min"
  },
  {
    "id": "REPAIR-use-source-2",
    "question": "A first order reaction has k = 0.0231 min^-1. Use its rate constant to sketch the normalized decay curve.",
    "refuse": false,
    "order": 1,
    "k": 0.0231,
    "unit": "min"
  },
  {
    "id": "REPAIR-use-source-3",
    "question": "A first order reaction has k = 0.0231 min^-1. Use a rate constant to plot its decay curve. Then use the rate constant to sketch the decay curve.",
    "refuse": false,
    "order": 1,
    "k": 0.0231,
    "unit": "min"
  },
  {
    "id": "REPAIR-use-source-4",
    "question": "A first order reaction has k = 0.0231 min^-1. Use the rate constant to draw [A]/[A]0 versus time.",
    "refuse": false,
    "order": 1,
    "k": 0.0231,
    "unit": "min"
  },
  {
    "id": "REPAIR-strict-source-1",
    "question": "A first order reaction has k = 0.0231 min^-1. Use the rate constantto draw the decay curve.",
    "refuse": true,
    "order": 1,
    "k": 0.0231,
    "unit": "min"
  },
  {
    "id": "REPAIR-strict-source-2",
    "question": "A first order reaction has k = 0.0231 min^-1. Use the unreadable rate constant to draw the decay curve.",
    "refuse": true,
    "order": 1,
    "k": 0.0231,
    "unit": "min"
  },
  {
    "id": "REPAIR-strict-source-3",
    "question": "A first order reaction has k = unknown; rate constant is 0.0231 min^-1. Use the rate constant to draw the decay curve.",
    "refuse": true,
    "order": 1,
    "k": 0.0231,
    "unit": "min"
  },
  {
    "id": "REPAIR-strict-source-4",
    "question": "A first order reaction has k = 0.0231 min^-1; rate constant is 0.0462 min^-1. Use the rate constant to sketch the decay curve.",
    "refuse": true,
    "order": 1,
    "k": 0.0231,
    "unit": "min"
  },
  {
    "id": "REPAIR-strict-source-5",
    "question": "A first order reaction has rate constant is 0.0231 min^-1; rate constant is unknown. Draw the decay curve.",
    "refuse": true,
    "order": 1,
    "k": 0.0231,
    "unit": "min"
  },
  {
    "id": "REPAIR-strict-source-6",
    "question": "A first order reaction has k = 0.0231 min^-1. Use the rate constant to draw the decay curve taking its value as 0.04 min^-1.",
    "refuse": true,
    "order": 1,
    "k": 0.0231,
    "unit": "min"
  }
];
for(const c of repairedRateCases)try {
 const spec=kineticsFromStem(c.question),exact=buildKineticsScene(c.question,[],false),schematic=buildKineticsScene(c.question,[],true),ordinary=synthesizeFamilyScene({question:c.question});
 if(c.refuse){assert.equal(spec,null);assert.equal(exact,null);assert.equal(schematic,null);assert.equal(ordinary,null);}
 else {
  assert.ok(spec);assert.equal(spec.plot,"concentration");assert.equal(spec.arrhenius?.k2??null,null,"agreeing repeats are one singular rate, not a second temperature measurement");
  const solved=solveKinetics(spec),truth=expected(c);assert.equal(solved.timeUnit,c.unit);assert.ok(solved.k!==null&&solved.tHalf!==null);assert.ok(Math.abs(solved.k-truth.k)<=Math.abs(truth.k)*1e-12);assert.ok(Math.abs(solved.tHalf-truth.half)<=Math.abs(truth.half)*1e-12);
  assert.ok(exact&&schematic&&ordinary);for(const document of [exact,schematic,ordinary.document])checkDocument(c,document);
 }
 results.push({id:c.id,passed:true});
}catch(error){results.push({id:c.id,passed:false,error:String(error)});console.error(`FAIL ${c.id}: ${error}`);}
// END ADDITIVE RATE-REPEAT AND USE-DELIMITER REPAIR GATES

// BEGIN ADDITIVE PHYSICAL AXIS SOURCE/RENDER REPAIR GATES
const repairedAxisCases:(RateCase&{axis:string})[] = [
  {
    "id": "REPAIR-qualified-zero-axis",
    "question": "A zero order reaction has k = 0.3 M min^-1 and initial concentration is 1.8 M. Draw [A] against time.",
    "refuse": false,
    "order": 0,
    "k": 0.3,
    "half": 3,
    "initial": 1.8,
    "unit": "min",
    "axis": "[A] (M)"
  },
  {
    "id": "REPAIR-source-second-axis",
    "question": "A second order reaction has k = 0.1 L mol^-1 h^-1 and initial concentration is 5 M. Draw 1/[A] versus time.",
    "refuse": false,
    "order": 2,
    "k": 0.1,
    "half": 2,
    "initial": 5,
    "unit": "h",
    "axis": "1/[A]"
  }
];
for(const c of repairedAxisCases)try {
 const spec=kineticsFromStem(c.question);assert.ok(spec);assert.equal(spec.order,c.order);assert.equal(spec.a0,c.initial);const solved=solveKinetics(spec),truth=expected(c);assert.ok(solved.k!==null&&solved.tHalf!==null);assert.ok(Math.abs(solved.k-truth.k)<=Math.abs(truth.k)*1e-12);assert.ok(Math.abs(solved.tHalf-truth.half)<=Math.abs(truth.half)*1e-12);
 const exact=buildKineticsScene(c.question,[],false),schematic=buildKineticsScene(c.question,[],true),ordinary=synthesizeFamilyScene({question:c.question});assert.ok(exact&&schematic&&ordinary);
 for(const document of [exact,schematic,ordinary.document]) {
  checkDocument(c,document);const sourceAxis=document.entities.find(e=>e.id===(c.order===0?"z_yl":"s_yl")&&e.kind==="label"&&(e.role==="axis label"||e.role==="direction marker")&&e.label===c.axis);assert.ok(sourceAxis);
  const valid=validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string,unknown>));assert.ok(valid.document);const compiled=compileSceneDocument(valid.document);assert.ok(compiled.ok&&compiled.renderScene);
  assert.ok(compiled.renderScene.primitives.some(p=>p.kind==="label"&&p.entityId===sourceAxis.id&&p.text===c.axis));
 }
 results.push({id:c.id,passed:true});
}catch(error){results.push({id:c.id,passed:false,error:String(error)});console.error(`FAIL ${c.id}: ${error}`);}
// END ADDITIVE PHYSICAL AXIS SOURCE/RENDER REPAIR GATES

// BEGIN ADDITIVE ORIGINAL ARRHENIUS OWNER SUPPORT GATES
interface ArrheniusOwnerCase {id:string;question:string;refuse:boolean;T1?:number;T2?:number;ratio?:number;k1?:number;k2?:number}
const arrheniusOwnerCases:ArrheniusOwnerCase[] = [
  {
    "id": "PUBLIC-RESTORE-F5-Kis",
    "question": "The rate constant of a reaction at 300 K is 2.0 \u00d7 10^-2 s^-1 and at 310 K is 7.0 \u00d7 10^-2 s^-1. Calculate the activation energy.",
    "refuse": false,
    "T1": 300,
    "T2": 310,
    "ratio": 3.5,
    "k1": 0.02,
    "k2": 0.07
  },
  {
    "id": "PUBLIC-RESTORE-F6-change10",
    "question": "The rate constant of a reaction doubles for a temperature change of 10 K starting at 300 K. Calculate the activation energy.",
    "refuse": false,
    "T1": 300,
    "T2": 310,
    "ratio": 2
  },
  {
    "id": "PUBLIC-RESTORE-F6-delta",
    "question": "The rate constant of a reaction doubles when the temperature goes up 10 K from 300 K. Calculate the activation energy.",
    "refuse": false,
    "T1": 300,
    "T2": 310,
    "ratio": 2
  },
  {
    "id": "PUBLIC-RESTORE-P1-T1T2",
    "question": "The rate constant of a reaction doubles between T1 = 300 K and T2 = 310 K. Calculate the activation energy.",
    "refuse": false,
    "T1": 300,
    "T2": 310,
    "ratio": 2
  },
  {
    "id": "PUBLIC-RESTORE-P1-t1t2",
    "question": "The rate constant of a reaction doubles between t1 = 300 K and t2 = 310 K. Calculate the activation energy.",
    "refuse": false,
    "T1": 300,
    "T2": 310,
    "ratio": 2
  },
  {
    "id": "PUBLIC-RESTORE-F6b-increase-of",
    "question": "An increase of 10 K in temperature from 300 K doubles the rate constant of a reaction. Calculate the activation energy.",
    "refuse": false,
    "T1": 300,
    "T2": 310,
    "ratio": 2
  },
  {
    "id": "PUBLIC-RESTORE-F6b-10Kincrease-for",
    "question": "The rate constant of a reaction doubles for a 10 K increase from 300 K. Calculate the activation energy.",
    "refuse": false,
    "T1": 300,
    "T2": 310,
    "ratio": 2
  },
  {
    "id": "PUBLIC-RESTORE-F5b-Ae-nospace",
    "question": "Using k = Ae^(-Ea/RT), calculate the activation energy if the rate constant doubles when the temperature is raised from 300 K to 310 K.",
    "refuse": false,
    "T1": 300,
    "T2": 310,
    "ratio": 2
  },
  {
    "id": "PUBLIC-RESTORE-F5b-Aexp",
    "question": "Using k = A exp(-Ea/RT), calculate the activation energy if the rate constant doubles when the temperature is raised from 300 K to 310 K.",
    "refuse": false,
    "T1": 300,
    "T2": 310,
    "ratio": 2
  },
  {
    "id": "PUBLIC-RESTORE-M17c",
    "question": "The Rate constant of a reaction at 300 K is 2.0 \u00d7 10^-2 s^-1 and at 310 K is 7.0 \u00d7 10^-2 s^-1. Calculate the activation energy in kJ/mol.",
    "refuse": false,
    "T1": 300,
    "T2": 310,
    "ratio": 3.5,
    "k1": 0.02,
    "k2": 0.07
  },
  {
    "id": "OWN-temperature-rate-pair-1",
    "question": "The rate constant of a reaction at 295 K is 0.01 s^-1 and at 305 K is 0.04 s^-1. Calculate the activation energy.",
    "refuse": false,
    "T1": 295,
    "T2": 305,
    "ratio": 4.0,
    "k1": 0.01,
    "k2": 0.04
  },
  {
    "id": "OWN-temperature-rate-pair-2",
    "question": "The rate constant for the reaction at 290 K equals 0.02 s^-1 and at 300 K equals 0.06 s^-1. Calculate the activation energy.",
    "refuse": false,
    "T1": 290,
    "T2": 300,
    "ratio": 3.0,
    "k1": 0.02,
    "k2": 0.06
  },
  {
    "id": "OWN-temperature-rate-pair-3",
    "question": "The rate constant of a reaction at 40 Celsius is 0.02 s^-1 and at 50 Celsius is 0.08 s^-1. Calculate the activation energy.",
    "refuse": false,
    "T1": 313.15,
    "T2": 323.15,
    "ratio": 4.0,
    "k1": 0.02,
    "k2": 0.08
  },
  {
    "id": "OWN-temperature-rate-pair-4",
    "question": "The rate constant of a reaction at 300 K is 1.2 min^-1 and at 310 K is 0.06 s^-1. Calculate the activation energy.",
    "refuse": false,
    "T1": 300,
    "T2": 310,
    "ratio": 3.0,
    "k1": 0.02,
    "k2": 0.06
  },
  {
    "id": "OWN-temperature-rate-pair-5",
    "question": "The RATE CONSTANT of a reaction at 320 K: 0.03 s^-1 and at 330 K: 0.12 s^-1. Calculate the activation energy.",
    "refuse": false,
    "T1": 320,
    "T2": 330,
    "ratio": 4.0,
    "k1": 0.03,
    "k2": 0.12
  },
  {
    "id": "OWN-closed-thermal-change-1",
    "question": "The rate constant of a reaction triples for a temperature change of 20 K starting at 290 K. Calculate the activation energy.",
    "refuse": false,
    "T1": 290,
    "T2": 310,
    "ratio": 3
  },
  {
    "id": "OWN-closed-thermal-change-2",
    "question": "The rate constant doubles between T1 = 315 K and T2 = 325 K. Calculate the activation energy.",
    "refuse": false,
    "T1": 315,
    "T2": 325,
    "ratio": 2
  },
  {
    "id": "OWN-closed-thermal-change-3",
    "question": "An increase of 15 K in temperature from 300 K triples the rate constant of a reaction. Calculate the activation energy.",
    "refuse": false,
    "T1": 300,
    "T2": 315,
    "ratio": 3
  },
  {
    "id": "OWN-closed-thermal-change-4",
    "question": "The rate constant of a reaction doubles when the temperature goes up by 20 K from 280 K. Calculate the activation energy.",
    "refuse": false,
    "T1": 280,
    "T2": 300,
    "ratio": 2
  },
  {
    "id": "OWN-closed-thermal-change-5",
    "question": "The rate constant of a reaction is doubled for a 10 K increase from 305 K. Calculate the activation energy.",
    "refuse": false,
    "T1": 305,
    "T2": 315,
    "ratio": 2
  },
  {
    "id": "OWN-symbolic-identity-1",
    "question": "Using k = Ae^(-E_a/RT), calculate the activation energy when the rate constant triples when temperature rises from 290 K to 310 K.",
    "refuse": false,
    "T1": 290,
    "T2": 310,
    "ratio": 3
  },
  {
    "id": "OWN-symbolic-identity-2",
    "question": "Using k = A exp(-Ea/(RT)), calculate the activation energy if the rate constant doubles when temperature rises from 300 K to 320 K.",
    "refuse": false,
    "T1": 300,
    "T2": 320,
    "ratio": 2
  },
  {
    "id": "OWN-symbolic-identity-3",
    "question": "Using k = Ae^(-Ea/RT), find activation energy if the rate constant doubles when the temperature is raised from 310 K to 330 K.",
    "refuse": false,
    "T1": 310,
    "T2": 330,
    "ratio": 2
  },
  {
    "id": "OWN-symbolic-identity-4",
    "question": "Using k = A exp(-Ea/RT), determine the activation energy if the rate constant triples when temperature rises from 280 K to 300 K.",
    "refuse": false,
    "T1": 280,
    "T2": 300,
    "ratio": 3
  },
  {
    "id": "OWN-symbolic-identity-5",
    "question": "Using k = Ae^(-E_a/(R T)), compute the activation energy if the rate constant doubles when temperature rises from 290 K to 310 K.",
    "refuse": false,
    "T1": 290,
    "T2": 310,
    "ratio": 2
  },
  {
    "id": "OWN-arrhenius-owner-refuse-1",
    "question": "The rate constant of a reaction at 300 K is unknown and at 310 K is 0.07 s^-1. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "OWN-arrhenius-owner-refuse-2",
    "question": "The rate constant of a reaction at unknown K is 0.02 s^-1 and at 310 K is 0.07 s^-1. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "OWN-arrhenius-owner-refuse-3",
    "question": "The rate constant of a reaction at 300 K is 2 kg and at 310 K is 0.07 s^-1. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "OWN-arrhenius-owner-refuse-4",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is unknown. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "OWN-arrhenius-owner-refuse-5",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. Its k is unknown. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "OWN-arrhenius-owner-refuse-6",
    "question": "The rate constant doubles from 0.02 to 0.07 s^-1 when the temperature rises from 300 K to 310 K. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "OWN-arrhenius-owner-refuse-7",
    "question": "The rate constant doubles between T1 = unknown K and T2 = 310 K. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "OWN-arrhenius-owner-refuse-8",
    "question": "The rate constant doubles for a temperature change of unknown K starting at 300 K. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "OWN-arrhenius-owner-refuse-9",
    "question": "An increase of 10 K in temperature from 300 K doubles the rate constant of a reaction unknown. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "OWN-arrhenius-owner-refuse-10",
    "question": "The rate constant doubles for a 10 K increase from 300 K taking its value as unknown. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "OWN-arrhenius-owner-refuse-11",
    "question": "Using k = Ae^(-Ea/RT) unknown, calculate the activation energy if the rate constant doubles when temperature rises from 300 K to 310 K.",
    "refuse": true
  },
  {
    "id": "OWN-arrhenius-owner-refuse-12",
    "question": "Using k = A exp(-Ea/RT), the rate constant is unknown. Its rate constant doubles when temperature rises from 300 K to 310 K. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "OWN-arrhenius-owner-refuse-13",
    "question": "For a reaction, k is unknown. Using k = Ae^(-Ea/RT), calculate the activation energy if the rate constant doubles when temperature rises from 300 K to 310 K.",
    "refuse": true
  },
  {
    "id": "OWN-arrhenius-owner-refuse-14",
    "question": "Using k = Ae^(-Ea/RT, calculate the activation energy if the rate constant doubles when temperature rises from 300 K to 310 K.",
    "refuse": true
  },
  {
    "id": "OWN-arrhenius-owner-refuse-15",
    "question": "Using k = Ae^(-Ea/RT), calculate the activation energy if the rate constant doubles when temperature rises from 300 K to 310 K. Its k is 2 kg.",
    "refuse": true
  }
];
for(const c of arrheniusOwnerCases)try {
 const spec=kineticsFromStem(c.question),exact=buildKineticsScene(c.question,[],false),schematic=buildKineticsScene(c.question,[],true),ordinary=synthesizeFamilyScene({question:c.question});
 if(c.refuse){assert.equal(spec,null);assert.equal(exact,null);assert.equal(schematic,null);assert.equal(ordinary,null);}
 else {
  assert.ok(spec&&spec.arrhenius);assert.equal(spec.plot,"arrhenius");assert.equal(spec.arrhenius.T1,c.T1);assert.equal(spec.arrhenius.T2,c.T2);
  if(c.k1!==undefined)assert.ok(spec.arrhenius.k1!==null&&Math.abs(spec.arrhenius.k1-c.k1)<=Math.abs(c.k1)*1e-12);
  if(c.k2!==undefined)assert.ok(spec.arrhenius.k2!==null&&Math.abs(spec.arrhenius.k2-c.k2)<=Math.abs(c.k2)*1e-12);
  const solved=solveKinetics(spec),energy=8.314*Math.log(c.ratio!)/(1/c.T1!-1/c.T2!);
  assert.ok(solved.Ea!==null&&Math.abs(solved.Ea-energy)<=Math.abs(energy)*1e-12);assert.ok(solved.ratio!==null&&Math.abs(solved.ratio-c.ratio!)<=Math.abs(c.ratio!)*1e-12);
  assert.ok(exact&&schematic&&ordinary);
  for(const document of [exact,schematic,ordinary.document]) {
   assert.equal(document.source?.question,c.question);
   const validated=validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string,unknown>));assert.ok(validated.document&&validated.report.issues.length===0);
   const compiled=compileSceneDocument(validated.document);assert.ok(compiled.ok&&compiled.renderScene&&compiled.renderScene.primitives.length>0);
   if(document!==schematic) {
    for(const [id,value,unit] of [["Ea",energy,"J/mol"],["T1",c.T1!,"K"],["T2",c.T2!,"K"],["ratio",c.ratio!,""]] as const) {
     const q=document.quantities.find(q=>q.id===id);assert.ok(q);assert.equal(q.unit,unit);assert.ok(typeof q.value==="number");assert.equal(q.value,Number(value.toFixed(6)));
    }
    const energyLabel=document.entities.find(e=>e.id==="ea"&&e.kind==="label"&&(e.role==="result"||e.role==="direction marker")&&e.label?.includes("E_a"));assert.ok(energyLabel&&energyLabel.label?.includes("kJ/mol"));
    assert.ok(compiled.renderScene.primitives.some(p=>p.kind==="label"&&p.entityId===energyLabel.id&&p.text===energyLabel.label));
   }
  }
 }
 results.push({id:c.id,passed:true});
}catch(error){results.push({id:c.id,passed:false,error:String(error)});console.error(`FAIL ${c.id}: ${error}`);}
// END ADDITIVE ORIGINAL ARRHENIUS OWNER SUPPORT GATES

// BEGIN ADDITIVE FIRST-ORDER CONCENTRATION TARGET DISPATCH GATES
const concentrationDispatchCases:RateCase[] = [
  {
    "id": "DISPATCH-original-scientific",
    "question": "For a first order reaction, k equals 2.31 x 10^-2 min^-1 and k: 0.0231 min^-1. Plot [A] versus time.",
    "refuse": false,
    "order": 1,
    "k": 0.0231,
    "unit": "min"
  },
  {
    "id": "DISPATCH-concentration-target",
    "question": "A first order reaction has k = 0.02 min^-1. Plot concentration versus time.",
    "refuse": false,
    "order": 1,
    "k": 0.02,
    "unit": "min"
  },
  {
    "id": "DISPATCH-half-to-concentration",
    "question": "A first order reaction has half life 20 min. Plot [A] against time.",
    "refuse": false,
    "order": 1,
    "half": 20,
    "unit": "min"
  },
  {
    "id": "DISPATCH-seconds-target",
    "question": "A first order reaction has k = 0.01 s^-1. Draw concentration as a function of time.",
    "refuse": false,
    "order": 1,
    "k": 0.01,
    "unit": "s"
  },
  {
    "id": "DISPATCH-source-requested-time",
    "question": "A first order reaction has k = 0.012 min^-1. Plot [A] versus time and find the remaining fraction at t = 60 min.",
    "refuse": false,
    "order": 1,
    "k": 0.012,
    "unit": "min",
    "askTime": 60
  },
  {
    "id": "DISPATCH-unread-first-rate",
    "question": "A first order reaction has k = unknown; rate constant is 0.0231 min^-1. Plot [A] versus time.",
    "refuse": true
  },
  {
    "id": "DISPATCH-conflicting-rates",
    "question": "A first order reaction has k = 0.0231 min^-1; rate constant is 0.0462 min^-1. Plot concentration versus time.",
    "refuse": true
  },
  {
    "id": "DISPATCH-unread-initial",
    "question": "A first order reaction has initial concentration unknown; initial concentration is 2 M and k = 0.0231 min^-1. Plot [A] versus time.",
    "refuse": true
  },
  {
    "id": "DISPATCH-wrong-order-rate-unit",
    "question": "A first order reaction has k = 0.2 M min^-1. Plot [A] against time.",
    "refuse": true
  },
  {
    "id": "DISPATCH-damaged-source-rate",
    "question": "A first order reaction has k = 1e- min^-1; k = 0.0231 min^-1. Draw concentration as a function of time.",
    "refuse": true
  }
];
for(const c of concentrationDispatchCases)try {
 const spec=kineticsFromStem(c.question),exact=buildKineticsScene(c.question,[],false),schematic=buildKineticsScene(c.question,[],true),ordinary=synthesizeFamilyScene({question:c.question});
 if(c.refuse){assert.equal(spec,null);assert.equal(exact,null);assert.equal(schematic,null);assert.equal(ordinary,null);}
 else {
  assert.ok(spec);assert.equal(spec.order,1);assert.equal(spec.plot,"concentration");assert.equal(spec.linear,"A_t");assert.equal(spec.a0,null,"an absent original initial concentration stays absent");
  const solved=solveKinetics(spec),truth=expected(c);assert.equal(solved.timeUnit,c.unit);assert.ok(solved.k!==null&&solved.tHalf!==null);assert.ok(Math.abs(solved.k-truth.k)<=Math.abs(truth.k)*1e-12);assert.ok(Math.abs(solved.tHalf-truth.half)<=Math.abs(truth.half)*1e-12);
  if(c.askTime!==undefined){const point=solved.remainingAtTimes.find(x=>x.time===c.askTime);assert.ok(point);assert.ok(Math.abs(point.remaining-Math.exp(-truth.k*c.askTime))<=1e-12);}
  assert.ok(exact&&schematic&&ordinary);
  for(const document of [exact,schematic,ordinary.document]) {
   checkDocument(c,document);assert.ok(!document.quantities.some(q=>q.id==="a0"||q.id==="A0"||q.unit==="M"||q.unit==="mol/L"),"normalized decay must not fabricate an initial concentration quantity");const axis=document.entities.find(e=>e.id==="p_yl"&&e.kind==="label"&&e.label==="[A]/[A]_0");assert.ok(axis);
   const valid=validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string,unknown>));assert.ok(valid.document);const compiled=compileSceneDocument(valid.document);assert.ok(compiled.ok&&compiled.renderScene);
   assert.ok(compiled.renderScene.primitives.some(p=>p.kind==="label"&&p.entityId===axis.id&&p.text===axis.label));assert.ok(!compiled.renderScene.primitives.some(p=>p.kind==="label"&&/\bM\b|mol\s*\/\s*L/.test(p.text??"")),"normalized decay must not fabricate a molar intercept");
  }
 }
 results.push({id:c.id,passed:true});
}catch(error){results.push({id:c.id,passed:false,error:String(error)});console.error(`FAIL ${c.id}: ${error}`);}
// END ADDITIVE FIRST-ORDER CONCENTRATION TARGET DISPATCH GATES

// BEGIN ADDITIVE ARRHENIUS SOURCE-RATIO CONSENSUS GATES
const pairRatioConsensusCases:ArrheniusOwnerCase[] = [
  {
    "id": "PAIR-MISMATCH-doubles",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. The rate constant doubles. Calculate the activation energy.",
    "refuse": true,
    "T1": 300,
    "T2": 310,
    "k1": 0.02,
    "k2": 0.07,
    "ratio": 3.5000000000000004
  },
  {
    "id": "PAIR-MISMATCH-triples",
    "question": "The rate constant of a reaction at 295 K is 0.01 s^-1 and at 305 K is 0.04 s^-1. The rate constant triples. Calculate the activation energy.",
    "refuse": true,
    "T1": 295,
    "T2": 305,
    "k1": 0.01,
    "k2": 0.04,
    "ratio": 4.0
  },
  {
    "id": "PAIR-MISMATCH-quadruples",
    "question": "The rate constant of a reaction at 290 K is 0.02 s^-1 and at 300 K is 0.06 s^-1. The rate constant quadruples. Calculate the activation energy.",
    "refuse": true,
    "T1": 290,
    "T2": 300,
    "k1": 0.02,
    "k2": 0.06,
    "ratio": 3.0
  },
  {
    "id": "PAIR-MISMATCH-is-doubled",
    "question": "The rate constant of a reaction at 310 K is 0.03 s^-1 and at 320 K is 0.12 s^-1. The rate constant is doubled. Calculate the activation energy.",
    "refuse": true,
    "T1": 310,
    "T2": 320,
    "k1": 0.03,
    "k2": 0.12,
    "ratio": 4.0
  },
  {
    "id": "PAIR-MISMATCH-cooling-doubles",
    "question": "The rate constant of a reaction at 310 K is 0.04 s^-1 and at 300 K is 0.02 s^-1. The rate constant doubles. Calculate the activation energy.",
    "refuse": true,
    "T1": 310,
    "T2": 300,
    "k1": 0.04,
    "k2": 0.02,
    "ratio": 0.5
  },
  {
    "id": "PAIR-AGREE-doubles",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.04 s^-1. The rate constant doubles. Calculate the activation energy.",
    "refuse": false,
    "T1": 300,
    "T2": 310,
    "k1": 0.02,
    "k2": 0.04,
    "ratio": 2.0
  },
  {
    "id": "PAIR-AGREE-triples",
    "question": "The rate constant of a reaction at 295 K is 0.01 s^-1 and at 305 K is 0.03 s^-1. The rate constant triples. Calculate the activation energy.",
    "refuse": false,
    "T1": 295,
    "T2": 305,
    "k1": 0.01,
    "k2": 0.03,
    "ratio": 3.0
  },
  {
    "id": "PAIR-AGREE-quadruples",
    "question": "The rate constant of a reaction at 290 K is 0.02 s^-1 and at 300 K is 0.08 s^-1. The rate constant quadruples. Calculate the activation energy.",
    "refuse": false,
    "T1": 290,
    "T2": 300,
    "k1": 0.02,
    "k2": 0.08,
    "ratio": 4.0
  },
  {
    "id": "PAIR-AGREE-is-doubled",
    "question": "The rate constant of a reaction at 310 K is 0.03 s^-1 and at 320 K is 0.06 s^-1. The rate constant is doubled. Calculate the activation energy.",
    "refuse": false,
    "T1": 310,
    "T2": 320,
    "k1": 0.03,
    "k2": 0.06,
    "ratio": 2.0
  },
  {
    "id": "PAIR-AGREE-cooling-halved",
    "question": "The rate constant of a reaction at 310 K is 0.04 s^-1 and at 300 K is 0.02 s^-1. The rate constant is halved. Calculate the activation energy.",
    "refuse": false,
    "T1": 310,
    "T2": 300,
    "k1": 0.04,
    "k2": 0.02,
    "ratio": 0.5
  },
  {
    "id": "OWN-first-order-refusal-not-fallback",
    "question": "A first order reaction has rate constant at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. Its half life is 30 min. Its rate constant doubles. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "OWN-canonical-mixed-rate-consensus",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 2.4 min^-1. The rate constant doubles. Calculate the activation energy.",
    "refuse": false,
    "T1": 300,
    "T2": 310,
    "k1": 0.02,
    "k2": 0.04,
    "ratio": 2
  },
  {
    "id": "OWN-stated-ratio-cannot-be-overwritten",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. The ratio is 3.5. The rate constant doubles. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "OWN-repeated-relative-statements-consensus",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.04 s^-1. The rate constant doubles. The rate constant triples. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "OWN-indexed-role-consensus",
    "question": "For a first order reaction at T1 = 300 K and T2 = 310 K, k1 = 0.02 s^-1 and k2 = 0.07 s^-1. The ratio k2/k1 is 2. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "OWN-ratio-unread-first",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. The rate-constant ratio is unknown; the ratio is 3.5. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "OWN-ratio-unread-last",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. The ratio is 3.5. The rate-constant ratio is unknown. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "OWN-ratio-original-named-symbol-alias",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. The ratio k2/k1 is 3.5. Calculate the activation energy.",
    "refuse": false,
    "T1": 300,
    "T2": 310,
    "k1": 0.02,
    "k2": 0.07,
    "ratio": 3.5
  },
  {
    "id": "OWN-ratio-requested-not-supplied",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. Find the rate-constant ratio and calculate the activation energy.",
    "refuse": false,
    "T1": 300,
    "T2": 310,
    "k1": 0.02,
    "k2": 0.07,
    "ratio": 3.5
  },
  {
    "id": "OWN-ratio-known-reference",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. The ratio is 3.5. Use the known ratio to draw the Arrhenius plot.",
    "refuse": false,
    "T1": 300,
    "T2": 310,
    "k1": 0.02,
    "k2": 0.07,
    "ratio": 3.5
  }
];
for(const c of pairRatioConsensusCases)try {
 const spec=kineticsFromStem(c.question),exact=buildKineticsScene(c.question,[],false),schematic=buildKineticsScene(c.question,[],true),ordinary=synthesizeFamilyScene({question:c.question});
 if(c.refuse){assert.equal(spec,null,"inconsistent or unread original ratios must not select a replacement scene");assert.equal(exact,null);assert.equal(schematic,null);assert.equal(ordinary,null);}
 else {
  assert.ok(spec&&spec.arrhenius);assert.equal(spec.plot,"arrhenius");assert.equal(spec.arrhenius.T1,c.T1);assert.equal(spec.arrhenius.T2,c.T2);assert.ok(spec.arrhenius.k1!==null&&spec.arrhenius.k2!==null);
  assert.ok(Math.abs(spec.arrhenius.k1-c.k1!)<=Math.abs(c.k1!)*1e-12);assert.ok(Math.abs(spec.arrhenius.k2-c.k2!)<=Math.abs(c.k2!)*1e-12);
  const solved=solveKinetics(spec),energy=8.314*Math.log(c.k2!/c.k1!)/(1/c.T1!-1/c.T2!);assert.ok(solved.ratio!==null&&solved.Ea!==null);assert.ok(Math.abs(solved.ratio-c.ratio!)<=Math.abs(c.ratio!)*1e-12);assert.ok(Math.abs(solved.Ea-energy)<=Math.abs(energy)*1e-12);
  assert.ok(exact&&schematic&&ordinary);
  for(const document of [exact,schematic,ordinary.document]) {
   assert.equal(document.source?.question,c.question);const valid=validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string,unknown>));assert.ok(valid.document);const compiled=compileSceneDocument(valid.document);assert.ok(compiled.ok&&compiled.renderScene&&compiled.renderScene.primitives.length>0);
   for(const [id,value,unit] of [["Ea",energy,"J/mol"],["T1",c.T1!,"K"],["T2",c.T2!,"K"],["ratio",c.ratio!,""]] as const){const q=document.quantities.find(q=>q.id===id);assert.ok(q);assert.equal(q.unit,unit);assert.equal(q.value,Number(value.toFixed(6)));}
   const energyLabel=document.entities.find(e=>e.id==="ea"&&e.kind==="label"&&(e.role==="result"||e.role==="direction marker")&&e.label?.includes("E_a"));assert.ok(energyLabel&&energyLabel.label?.includes("kJ/mol"));assert.ok(compiled.renderScene.primitives.some(p=>p.kind==="label"&&p.entityId===energyLabel.id&&p.text===energyLabel.label));
  }
 }
 results.push({id:c.id,passed:true});
}catch(error){results.push({id:c.id,passed:false,error:String(error)});console.error(`FAIL ${c.id}: ${error}`);}
// END ADDITIVE ARRHENIUS SOURCE-RATIO CONSENSUS GATES

// BEGIN ADDITIVE ARRHENIUS RATIO ROLES AND COMPLETE SCALAR GATES
const ratioRoleCases:ArrheniusOwnerCase[] = [
  {
    "id": "DECLARED-rate-ratio-unread",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. The ratio is unknown. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "DECLARED-rate-ratio-cannot",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. The rate-constant ratio cannot be read. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "DECLARED-rate-ratio-later",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. The ratio is unknown; the ratio is 3.5. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "OWN-ratio-terminal-integer",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.04 s^-1. The rate-constant ratio is 2. Calculate the activation energy.",
    "refuse": false,
    "T1": 300,
    "T2": 310,
    "k1": 0.02,
    "k2": 0.04,
    "ratio": 2
  },
  {
    "id": "OWN-ratio-terminal-exponent",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.04 s^-1. The rate-constant ratio is 2e0. Calculate the activation energy.",
    "refuse": false,
    "T1": 300,
    "T2": 310,
    "k1": 0.02,
    "k2": 0.04,
    "ratio": 2
  },
  {
    "id": "OWN-ratio-continued-wrong-unit",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.04 s^-1. The rate-constant ratio is 2 kg. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "OWN-ratio-damaged-exponent",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.04 s^-1. The rate-constant ratio is 2e-. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "OWN-ratio-times-disagreement",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. The ratio is 3.5. The rate becomes 4 times its original value. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "OWN-ratio-times-agreement",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.08 s^-1. The ratio is 4. The rate becomes 4 times its original value. Calculate the activation energy.",
    "refuse": false,
    "T1": 300,
    "T2": 310,
    "k1": 0.02,
    "k2": 0.08,
    "ratio": 4
  },
  {
    "id": "OWN-ratio-fold-agreement",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.08 s^-1. The ratio is 4. The rate increases 4 fold. Calculate the activation energy.",
    "refuse": false,
    "T1": 300,
    "T2": 310,
    "k1": 0.02,
    "k2": 0.08,
    "ratio": 4
  }
];
for(const c of ratioRoleCases)try {
 const spec=kineticsFromStem(c.question),exact=buildKineticsScene(c.question,[],false),schematic=buildKineticsScene(c.question,[],true),ordinary=synthesizeFamilyScene({question:c.question});
 if(c.refuse){assert.equal(spec,null,"inconsistent or unread original ratios must not select a replacement scene");assert.equal(exact,null);assert.equal(schematic,null);assert.equal(ordinary,null);}
 else {
  assert.ok(spec&&spec.arrhenius);assert.equal(spec.plot,"arrhenius");assert.equal(spec.arrhenius.T1,c.T1);assert.equal(spec.arrhenius.T2,c.T2);assert.ok(spec.arrhenius.k1!==null&&spec.arrhenius.k2!==null);
  assert.ok(Math.abs(spec.arrhenius.k1-c.k1!)<=Math.abs(c.k1!)*1e-12);assert.ok(Math.abs(spec.arrhenius.k2-c.k2!)<=Math.abs(c.k2!)*1e-12);
  const solved=solveKinetics(spec),energy=8.314*Math.log(c.k2!/c.k1!)/(1/c.T1!-1/c.T2!);assert.ok(solved.ratio!==null&&solved.Ea!==null);assert.ok(Math.abs(solved.ratio-c.ratio!)<=Math.abs(c.ratio!)*1e-12);assert.ok(Math.abs(solved.Ea-energy)<=Math.abs(energy)*1e-12);
  assert.ok(exact&&schematic&&ordinary);
  for(const document of [exact,schematic,ordinary.document]) {
   assert.equal(document.source?.question,c.question);const valid=validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string,unknown>));assert.ok(valid.document);const compiled=compileSceneDocument(valid.document);assert.ok(compiled.ok&&compiled.renderScene&&compiled.renderScene.primitives.length>0);
   for(const [id,value,unit] of [["Ea",energy,"J/mol"],["T1",c.T1!,"K"],["T2",c.T2!,"K"],["ratio",c.ratio!,""]] as const){const q=document.quantities.find(q=>q.id===id);assert.ok(q);assert.equal(q.unit,unit);assert.equal(q.value,Number(value.toFixed(6)));}
   const energyLabel=document.entities.find(e=>e.id==="ea"&&e.kind==="label"&&(e.role==="result"||e.role==="direction marker")&&e.label?.includes("E_a"));assert.ok(energyLabel&&energyLabel.label?.includes("kJ/mol"));assert.ok(compiled.renderScene.primitives.some(p=>p.kind==="label"&&p.entityId===energyLabel.id&&p.text===energyLabel.label));
  }
 }
 results.push({id:c.id,passed:true});
}catch(error){results.push({id:c.id,passed:false,error:String(error)});console.error(`FAIL ${c.id}: ${error}`);}

const concentrationRatioRequestCases:RateCase[] = [
  {
    "id": "REQUEST-concentration-what",
    "question": "For a first order reaction, the rate constant k is 0.0231 min^-1. What is the ratio of [A] to [A]0 after 60 min? Draw the decay curve.",
    "refuse": false,
    "k": 0.0231,
    "unit": "min",
    "askTime": 60,
    "order": 1
  },
  {
    "id": "REQUEST-concentration-find",
    "question": "For a first order reaction, the rate constant k is 0.02 s^-1. Find the ratio [A]/[A]0 after 30 s and draw its decay curve.",
    "refuse": false,
    "k": 0.02,
    "unit": "s",
    "askTime": 30,
    "order": 1
  },
  {
    "id": "REQUEST-concentration-calculate",
    "question": "A first order reaction has rate constant k = 0.693 h^-1. Calculate the concentration ratio [A]/[A]0 after 2 h and draw the decay curve.",
    "refuse": false,
    "k": 0.693,
    "unit": "h",
    "askTime": 2,
    "order": 1
  },
  {
    "id": "REQUEST-concentration-temperature",
    "question": "For a first order reaction at 300 K, the rate constant k is 0.0231 min^-1. Determine the ratio of remaining concentration to initial concentration after 60 min. Draw concentration versus time.",
    "refuse": false,
    "k": 0.0231,
    "unit": "min",
    "askTime": 60,
    "order": 1
  },
  {
    "id": "REQUEST-concentration-remaining",
    "question": "The rate constant of a first order reaction is 0.01 min^-1. Find the remaining concentration ratio after 100 min and draw the concentration-time curve.",
    "refuse": false,
    "k": 0.01,
    "unit": "min",
    "askTime": 100,
    "order": 1
  }
];
for (const c of concentrationRatioRequestCases) try {
 const spec = kineticsFromStem(c.question), exact = buildKineticsScene(c.question, [], false), schematic = buildKineticsScene(c.question, [], true), ordinary = synthesizeFamilyScene({question: c.question});
 assert.ok(spec); assert.equal(spec.order, 1); assert.equal(spec.plot, "concentration"); assert.equal(spec.a0, null, "requested concentration operands must not supply initial molarity"); assert.equal(spec.concUnit, null);
 const solved = solveKinetics(spec), half = Math.LN2 / c.k!, remaining = Math.exp(-c.k! * c.askTime!);
 assert.equal(solved.timeUnit, c.unit); assert.ok(solved.k !== null && solved.tHalf !== null); assert.ok(Math.abs(solved.k - c.k!) <= Math.abs(c.k!) * 1e-12); assert.ok(Math.abs(solved.tHalf - half) <= Math.abs(half) * 1e-12);
 const point = solved.remainingAtTimes.find(p => p.time === c.askTime); assert.ok(point); assert.ok(Math.abs(point.remaining - remaining) <= Math.abs(remaining) * 1e-12);
 assert.ok(exact && schematic && ordinary);
 for (const document of [exact, schematic, ordinary.document]) {
  checkDocument(c, document); assert.equal(document.source?.question, c.question); assert.ok(!document.quantities.some(q => q.id === "a0" || q.id === "A0" || q.unit === "M" || q.unit === "mol/L"));
  const axis = document.entities.find(e => e.id === "p_yl" && e.kind === "label" && e.label === "[A]/[A]_0"); assert.ok(axis);
  const valid = validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string, unknown>)); assert.ok(valid.document); const compiled = compileSceneDocument(valid.document); assert.ok(compiled.ok && compiled.renderScene);
  assert.ok(compiled.renderScene.primitives.some(p => p.kind === "label" && p.entityId === axis.id && p.text === axis.label)); assert.ok(!compiled.renderScene.primitives.some(p => p.kind === "label" && /\bM\b|mol\s*\/\s*L/.test(p.text ?? "")));
 }
 results.push({id: c.id, passed: true});
} catch (error) { results.push({id: c.id, passed: false, error: String(error)}); console.error(`FAIL ${c.id}: ${error}`); }
// END ADDITIVE ARRHENIUS RATIO ROLES AND COMPLETE SCALAR GATES

// BEGIN ADDITIVE COMPLETE ORIGINAL TIMES-FOLD OWNER GATES
const timesFoldOwnerCases:ArrheniusOwnerCase[] = [
  {
    "id": "UNREAD-times",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. The rate becomes unknown times its original value. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "UNREAD-fold",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. The rate increases by an unreadable fold. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "DAMAGED-symbol",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. The rate becomes q times its original value. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "DAMAGED-exponent",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. The rate becomes 3.5e+ times its original value. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "WRONG-UNIT-times",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. The rate becomes 3.5 kg times its original value. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "KNOWN-becomes",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. The rate becomes 3.5 times its original value. Calculate the activation energy.",
    "refuse": false,
    "T1": 300,
    "T2": 310,
    "k1": 0.02,
    "k2": 0.07,
    "ratio": 3.5
  },
  {
    "id": "KNOWN-increases",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. The rate increases 3.5 times. Calculate the activation energy.",
    "refuse": false,
    "T1": 300,
    "T2": 310,
    "k1": 0.02,
    "k2": 0.07,
    "ratio": 3.5
  },
  {
    "id": "KNOWN-fold",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. The rate increases 3.5 fold. Calculate the activation energy.",
    "refuse": false,
    "T1": 300,
    "T2": 310,
    "k1": 0.02,
    "k2": 0.07,
    "ratio": 3.5
  },
  {
    "id": "KNOWN-equals",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. The rate is 3.5 times its original value. Calculate the activation energy.",
    "refuse": false,
    "T1": 300,
    "T2": 310,
    "k1": 0.02,
    "k2": 0.07,
    "ratio": 3.5
  },
  {
    "id": "KNOWN-change",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. The rate changes by 3.5 fold. Calculate the activation energy.",
    "refuse": false,
    "T1": 300,
    "T2": 310,
    "k1": 0.02,
    "k2": 0.07,
    "ratio": 3.5
  },
  {
    "id": "OWN-times-unread-before-later-change",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. The rate becomes unknown times its original value. The rate becomes 3.5 times its original value. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "OWN-fold-unread-after-good-change",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. The rate increases 3.5 fold. The rate increases unavailable fold. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "OWN-times-conflicting-repeats",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. The rate becomes 3.5 times its original value. The rate increases 4 fold. Calculate the activation energy.",
    "refuse": true
  },
  {
    "id": "OWN-times-requested-rate-ratio",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. The rate becomes 3.5 times its original value. Find the rate-constant ratio and calculate the activation energy.",
    "refuse": false,
    "T1": 300,
    "T2": 310,
    "k1": 0.02,
    "k2": 0.07,
    "ratio": 3.5
  },
  {
    "id": "OWN-fold-known-rate-ratio-reference",
    "question": "The rate constant of a reaction at 300 K is 0.02 s^-1 and at 310 K is 0.07 s^-1. The ratio is 3.5. The rate increases 3.5 fold. Use the known ratio to draw the Arrhenius plot.",
    "refuse": false,
    "T1": 300,
    "T2": 310,
    "k1": 0.02,
    "k2": 0.07,
    "ratio": 3.5
  }
];
for(const c of timesFoldOwnerCases)try {
 const spec=kineticsFromStem(c.question),exact=buildKineticsScene(c.question,[],false),schematic=buildKineticsScene(c.question,[],true),ordinary=synthesizeFamilyScene({question:c.question});
 if(c.refuse){assert.equal(spec,null,"inconsistent or unread original ratios must not select a replacement scene");assert.equal(exact,null);assert.equal(schematic,null);assert.equal(ordinary,null);}
 else {
  assert.ok(spec&&spec.arrhenius);assert.equal(spec.plot,"arrhenius");assert.equal(spec.arrhenius.T1,c.T1);assert.equal(spec.arrhenius.T2,c.T2);assert.ok(spec.arrhenius.k1!==null&&spec.arrhenius.k2!==null);
  assert.ok(Math.abs(spec.arrhenius.k1-c.k1!)<=Math.abs(c.k1!)*1e-12);assert.ok(Math.abs(spec.arrhenius.k2-c.k2!)<=Math.abs(c.k2!)*1e-12);
  const solved=solveKinetics(spec),energy=8.314*Math.log(c.k2!/c.k1!)/(1/c.T1!-1/c.T2!);assert.ok(solved.ratio!==null&&solved.Ea!==null);assert.ok(Math.abs(solved.ratio-c.ratio!)<=Math.abs(c.ratio!)*1e-12);assert.ok(Math.abs(solved.Ea-energy)<=Math.abs(energy)*1e-12);
  assert.ok(exact&&schematic&&ordinary);
  for(const document of [exact,schematic,ordinary.document]) {
   assert.equal(document.source?.question,c.question);const valid=validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string,unknown>));assert.ok(valid.document);const compiled=compileSceneDocument(valid.document);assert.ok(compiled.ok&&compiled.renderScene&&compiled.renderScene.primitives.length>0);
   for(const [id,value,unit] of [["Ea",energy,"J/mol"],["T1",c.T1!,"K"],["T2",c.T2!,"K"],["ratio",c.ratio!,""]] as const){const q=document.quantities.find(q=>q.id===id);assert.ok(q);assert.equal(q.unit,unit);assert.equal(q.value,Number(value.toFixed(6)));}
   const energyLabel=document.entities.find(e=>e.id==="ea"&&e.kind==="label"&&(e.role==="result"||e.role==="direction marker")&&e.label?.includes("E_a"));assert.ok(energyLabel&&energyLabel.label?.includes("kJ/mol"));assert.ok(compiled.renderScene.primitives.some(p=>p.kind==="label"&&p.entityId===energyLabel.id&&p.text===energyLabel.label));
  }
 }
 results.push({id:c.id,passed:true});
}catch(error){results.push({id:c.id,passed:false,error:String(error)});console.error(`FAIL ${c.id}: ${error}`);}
// END ADDITIVE COMPLETE ORIGINAL TIMES-FOLD OWNER GATES

const output={schema:"chemistry-rate-declarations-gate/v1",passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length,results};
console.log(JSON.stringify(output,null,2));assert.equal(output.failed,0);
