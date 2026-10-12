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
const output={schema:"chemistry-rate-declarations-gate/v1",passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length,results};
console.log(JSON.stringify(output,null,2));assert.equal(output.failed,0);
