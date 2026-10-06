import assert from "node:assert/strict";
import { checkTeachingArithmeticRow, admitTeachingArithmetic } from "@heytutor/tutor-core";
import { buildLessonSegments } from "@heytutor/drawing";
import { createTeachingArithmeticAdmission } from "../../features/tutor-session/lib/turn/teachingArithmeticAdmission";
import type { TurnPlanV3 } from "@heytutor/scene-engine";

const bad = "check: 2.5 + 31(0.005) - 0.02 = 2.675 mm";
const good = "check: 2.5 + 31(0.005) - (-0.02) = 2.675 mm";
const plan: TurnPlanV3 = { schemaVersion:"turn-plan/v3",question:"unit context",givens:[
  {id:"d",symbol:"d",value:2.675,unit:"mm",provenance:"given"},
  {id:"e",symbol:"e",value:-0.02,unit:"mm",provenance:"given"},
],derived:[],unknowns:[],assumptions:[],qualitativeClaims:[],lawIds:[],visualRequirement:"none" };
let checks=0;
const eq=(a:unknown,b:unknown)=>{assert.deepEqual(a,b);checks++;};
// Existing unbound unit and conversion rows keep their abstention contract.
eq(checkTeachingArithmeticRow(bad).verdict,"unsupported");
const arithmetic = createTeachingArithmeticAdmission({verifiedPlan:plan});
const falseBeat=buildLessonSegments(`[STEP]The check returns the diameter.[WRITE:${bad},90,200][/STEP]`)[0]!;
eq(arithmetic.offer(falseBeat),false);
eq(arithmetic.blocked(),true);
eq(arithmetic.admittedNarration(),"");
const proof=arithmetic.startAttempt();assert(proof?.includes("2.635"));checks++;
const trueBeat=buildLessonSegments(`[STEP]Subtract the signed zero error.[WRITE:${good},90,200][/STEP]`)[0]!;
eq(arithmetic.offer(trueBeat),true);
eq(arithmetic.blocked(),false);
assert(arithmetic.admittedNarration().includes("Subtract"));checks++;
for(const [text,expected] of [[bad,"false"],[good,"correct"],
  ["CHECK: 2.655 - 2.5 = 0.155 mm","correct"],
  ["check: 7(0.25) + 0.5 = 2.25 mm","correct"],
  ["check: 7(0.25) + 0.5 = 3.25 mm","false"],
  ["d = 1000*5 = 5 km","unsupported"],
  ["1 MeV = 10^6 eV","unsupported"],
  ["check: 2 m + 3 m = 5 mm","unsupported"],
  ["check: 2+3=5 mm; 6=7","unsupported"],
  [String.raw`check: 2 \frac{1}{2}=2.5 mm`,"unsupported"],
  ["check: 6/2(1+2)=9 mm","unsupported"],
  ["check: 2+3=5 cm","unsupported"],
  ["check: 2+3=5 unknown","unsupported"],
] as const) eq(checkTeachingArithmeticRow({text,displayUnit:"mm"}).verdict,expected);
eq(admitTeachingArithmetic([{text:bad,displayUnit:"mm"}]).admitted,false);
eq(checkTeachingArithmeticRow({text:"check: 2pi=2pi",displayUnit:"pi"}).verdict,"unsupported");
const mixed=createTeachingArithmeticAdmission({verifiedPlan:{...plan,givens:[plan.givens[0]!,{...plan.givens[1]!,unit:"cm"}]}});
eq(mixed.offer(falseBeat),true); // No inferred conversions from mixed units.
const unbound=createTeachingArithmeticAdmission();eq(unbound.offer(falseBeat),true);
console.log(`PASS ${checks} verified common-unit arithmetic and whole-beat controls`);
