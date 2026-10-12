/** Source-first semantic-role gates; unit agreement alone does not identify solute. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { buildSolutionLessonScene } from "../../src/chemistry/solutionProperties";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { SceneDocument } from "../../src/types";
interface Case {id:string;question:string;refuse:boolean;kind?:"molarity"|"molality";n?:number;denominator?:number;expected?:number}
const cases:Case[] = [
  {
    "id": "GREPTILE-4244042434",
    "question": "A solution contains 2 mol of solvent and has a solution volume of 1 L. Find its molarity.",
    "refuse": true
  },
  {
    "id": "SOLUTE-REFUSE-1",
    "question": "A solution contains 5 mol of solvent and 2 kg of solvent. Find its molality.",
    "refuse": true
  },
  {
    "id": "SOLUTE-REFUSE-2",
    "question": "The solute amount is unknown. The solvent amount is 2 mol, and the solution volume of 1 L is given. Find the molarity.",
    "refuse": true
  },
  {
    "id": "SOLUTE-REFUSE-3",
    "question": "A solution contains 2 mol of solute; the solute amount is unreadable. It has a solution volume of 1 L. Find its molarity.",
    "refuse": true
  },
  {
    "id": "SOLUTE-REFUSE-4",
    "question": "A solution contains 2 mol of solute and 3 mol of solute, with a solution volume of 1 L. Find its molarity.",
    "refuse": true
  },
  {
    "id": "SOLUTE-REFUSE-5",
    "question": "A solution contains 2 kg of solute and 2 mol of solvent, with a solution volume of 1 L. Find its molarity.",
    "refuse": true
  },
  {
    "id": "SOLUTE-SUPPORT-1",
    "question": "A solution contains 2 mol of solute and 55 mol of solvent, and has a solution volume of 1 L. Find its molarity.",
    "refuse": false,
    "kind": "molarity",
    "n": 2,
    "denominator": 1.0,
    "expected": 2
  },
  {
    "id": "SOLUTE-SUPPORT-2",
    "question": "A solution contains 0.5 mol of solute and has a solution volume of 250 mL. Find its molarity.",
    "refuse": false,
    "kind": "molarity",
    "n": 0.5,
    "denominator": 0.25,
    "expected": 2
  },
  {
    "id": "SOLUTE-SUPPORT-3",
    "question": "A solution contains 2 mol of solute and 0.5 kg of solvent. Find its molality.",
    "refuse": false,
    "kind": "molality",
    "n": 2,
    "denominator": 0.5,
    "expected": 4
  },
  {
    "id": "SOLUTE-SUPPORT-4",
    "question": "The solute amount is 2 mol. A solution volume of 1 L is given. Find its molarity.",
    "refuse": false,
    "kind": "molarity",
    "n": 2,
    "denominator": 1.0,
    "expected": 2
  },
  {
    "id": "SOLUTE-SUPPORT-5",
    "question": "A solution contains 0.2 mol of solute and has a solution volume of 100 mL. Find its molarity.",
    "refuse": false,
    "kind": "molarity",
    "n": 0.2,
    "denominator": 0.1,
    "expected": 2
  },
  {
    "id": "OWN-solvent-prefix",
    "question": "The amount of solvent is 2 mol. The solution volume of 1 L is stated. Calculate molarity.",
    "refuse": true
  },
  {
    "id": "OWN-solvent-suffix",
    "question": "There are 0.5 mol of the solvent in a solution with a solution volume of 250 mL. Determine the molarity.",
    "refuse": true
  },
  {
    "id": "OWN-solvent-molality",
    "question": "A solution contains 2 mol solvent and 500 g of solvent. Calculate its molality.",
    "refuse": true
  },
  {
    "id": "OWN-unowned-amount",
    "question": "A solution contains 2 mol of an unspecified component and has a solution volume of 1 L. Find its molarity.",
    "refuse": true
  },
  {
    "id": "OWN-unknown-then-good",
    "question": "The amount of solute is unknown; the solute amount is 2 mol. The solution volume of 1 L is given. Find molarity.",
    "refuse": true
  },
  {
    "id": "OWN-good-then-unknown",
    "question": "The solute amount is 2 mol; the amount of solute is unknown. The solution volume of 1 L is given. Find molarity.",
    "refuse": true
  },
  {
    "id": "OWN-wrong-unit-before-good",
    "question": "The amount of solute is 2 kg; solute amount is 2 mol. It has a solution volume of 1 L. Find molarity.",
    "refuse": true
  },
  {
    "id": "OWN-conflicting-prefixes",
    "question": "The amount of solute is 2 mol; the amount of solute is 3 mol. The solution volume of 1 L is given. Find molarity.",
    "refuse": true
  },
  {
    "id": "OWN-unknown-molality",
    "question": "The solute amount is unreadable. There are 2 mol of solvent and 1 kg of solvent. Find molality.",
    "refuse": true
  },
  {
    "id": "OWN-role-contradiction",
    "question": "A solution contains 2 mol of solute, but the solute is also the solvent. Its solution volume of 1 L is given. Find molarity.",
    "refuse": true
  },
  {
    "id": "OWN-named-role-conflict",
    "question": "NaCl is the solvent. There are 2 mol of NaCl dissolved in water. The solution volume of 1 L is given. Find molarity.",
    "refuse": true
  },
  {
    "id": "OWN-different-solutes",
    "question": "There are 2 mol of NaCl dissolved in water and 2 mol of KCl dissolved in water. The solution volume of 1 L is given. Find its molarity.",
    "refuse": true
  },
  {
    "id": "OWN-solvent-volume",
    "question": "A solution contains 2 mol of solute and has a solvent volume of 1 L. Find molarity.",
    "refuse": true
  },
  {
    "id": "OWN-solution-mass",
    "question": "A solution contains 2 mol of solute and 1 kg of solution. Find molality.",
    "refuse": true
  },
  {
    "id": "OWN-explicit-no-of",
    "question": "A solution contains 2 mol solute and has a solution volume of 1 L. Find molarity.",
    "refuse": false,
    "kind": "molarity",
    "n": 2,
    "denominator": 1,
    "expected": 2.0
  },
  {
    "id": "OWN-amount-prefix",
    "question": "The amount of solute is 0.5 mol. The solution volume of 250 mL is stated. Find molarity.",
    "refuse": false,
    "kind": "molarity",
    "n": 0.5,
    "denominator": 0.25,
    "expected": 2.0
  },
  {
    "id": "OWN-repeated-agreeing",
    "question": "The solute amount is 2 mol; the amount of solute is 2e0 mol. The solution volume of 1 L is given. Find molarity.",
    "refuse": false,
    "kind": "molarity",
    "n": 2,
    "denominator": 1,
    "expected": 2.0
  },
  {
    "id": "OWN-good-solute-unknown-solvent",
    "question": "The solute amount is 2 mol. The solvent amount is unknown. The solution volume of 1 L is given. Find molarity.",
    "refuse": false,
    "kind": "molarity",
    "n": 2,
    "denominator": 1,
    "expected": 2.0
  },
  {
    "id": "OWN-solvent-first-valid-solute",
    "question": "A solution contains 55 mol of solvent and 2 mol of solute. The solution volume of 1 L is given. Find molarity.",
    "refuse": false,
    "kind": "molarity",
    "n": 2,
    "denominator": 1,
    "expected": 2.0
  },
  {
    "id": "OWN-molality-with-solvent-moles",
    "question": "A solution contains 55 mol of solvent and 2 mol of solute, with 500 g of solvent. Calculate molality.",
    "refuse": false,
    "kind": "molality",
    "n": 2,
    "denominator": 0.5,
    "expected": 4.0
  },
  {
    "id": "OWN-molality-prefix",
    "question": "The amount of solute is 0.5 mol. There are 250 g of solvent. Find molality.",
    "refuse": false,
    "kind": "molality",
    "n": 0.5,
    "denominator": 0.25,
    "expected": 2.0
  },
  {
    "id": "OWN-named-dissolved",
    "question": "There are 2 mol of NaCl dissolved in water. The solution volume of 1 L is stated. Calculate molarity.",
    "refuse": false,
    "kind": "molarity",
    "n": 2,
    "denominator": 1,
    "expected": 2.0
  },
  {
    "id": "OWN-named-role-prefix",
    "question": "The amount of solute NaCl is 2 mol. The solution volume of 1 L is given. Find molarity.",
    "refuse": false,
    "kind": "molarity",
    "n": 2,
    "denominator": 1,
    "expected": 2.0
  },
  {
    "id": "OWN-named-role-declared",
    "question": "NaCl is the solute. A solution contains 2 mol of NaCl and has a solution volume of 1 L. Find molarity.",
    "refuse": false,
    "kind": "molarity",
    "n": 2,
    "denominator": 1,
    "expected": 2.0
  },
  {
    "id": "OWN-water-is-solute",
    "question": "There are 0.5 mol of water dissolved in ethanol. The solution volume of 250 mL is given. Find molarity.",
    "refuse": false,
    "kind": "molarity",
    "n": 0.5,
    "denominator": 0.25,
    "expected": 2.0
  },
  {
    "id": "OWN-role-alternative",
    "question": "A solution contains 2 mol of solute or solvent and has a solution volume of 1 L. Find molarity.",
    "refuse": true
  },
  {
    "id": "OWN-role-mixture",
    "question": "A solution contains 2 mol of solute and solvent and has a solution volume of 1 L. Find molarity.",
    "refuse": true
  },
  {
    "id": "OWN-role-prefix-suffix-conflict",
    "question": "The amount of solute is 2 mol of solvent. The solution volume of 1 L is given. Find molarity.",
    "refuse": true
  },
  {
    "id": "OWN-role-adjective",
    "question": "A solution contains 2 mol of solute-like material and has a solution volume of 1 L. Find molarity.",
    "refuse": true
  }
];
function physical(labels:string[],symbol:string,unit:string,expected:number):void {
 const found=labels.flatMap(text=>{const match=new RegExp(`^${symbol}\\s*=\\s*([+\\-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:e[+\\-]?\\d+)?)\\s+${unit.replace("/","\\/")}$`).exec(text);return match?[Number(match[1])]:[];});
 assert.equal(found.length,1,JSON.stringify({labels,symbol,unit}));assert.ok(Number.isFinite(found[0]));assert.ok(Math.abs(found[0]!-expected)<=Math.max(1,Math.abs(expected))*1e-12,JSON.stringify({found,expected}));
}
function inspect(c:Case,document:SceneDocument):void {
 assert.equal(document.source.question,c.question);
 const compiled=compileSceneDocument(document);assert.ok(compiled.ok && compiled.renderScene,JSON.stringify(compiled.report.issues));
 const raw=document.entities.filter(entity=>entity.kind==="label" && typeof entity.label==="string").map(entity=>entity.label!);
 const labels=compiled.renderScene.primitives.filter(mark=>mark.kind==="label" && typeof mark.text==="string").map(mark=>mark.text!);
 assert.ok(!/NaN|Infinity|undefined/.test(labels.join(" ")));
 assert.ok(c.n!==undefined && c.denominator!==undefined && c.expected!==undefined && c.kind);
 assert.equal(c.expected,c.n/c.denominator);
 for(const values of [raw,labels]){
  physical(values,"n","mol",c.n);physical(values,c.kind==="molarity"?"M":"m",c.kind==="molarity"?"mol/L":"mol/kg",c.expected);
  if(c.kind==="molarity")physical(values,"V","L",c.denominator);
  else assert.ok(values.includes(`solvent ${c.denominator} kg`),JSON.stringify(values));
 }
 const caption=document.annotations.find(annotation=>annotation.id==="figure_caption")?.text;
 assert.ok(typeof caption==="string" && caption.includes(`${c.n}/${c.denominator} = ${c.expected}`),JSON.stringify(caption));
}
const rows:Array<{id:string;question:string;questionSha256:string;seam:string;passed:boolean;error?:string}>=[];
for(const c of cases)for(const seam of ["direct-exact","direct-schematic","ordinary-synthesis-and-full-compile"]){
 try{
  const ordinary=seam==="ordinary-synthesis-and-full-compile"?synthesizeFamilyScene({question:c.question}):null;
  const document=seam==="ordinary-synthesis-and-full-compile"?ordinary?.document??null:buildSolutionLessonScene(c.question,[],seam==="direct-schematic");
  if(c.refuse)assert.equal(document,null,"wrong/unknown/conflicting solute role must refuse the entire figure");
  else {assert.ok(document,"readable source solute amount must compile");if(ordinary)assert.equal(ordinary.family,"chem_solutions");inspect(c,document);}
  rows.push({id:c.id,question:c.question,questionSha256:createHash("sha256").update(c.question).digest("hex"),seam,passed:true});
 }catch(error){rows.push({id:c.id,question:c.question,questionSha256:createHash("sha256").update(c.question).digest("hex"),seam,passed:false,error:error instanceof Error?`${error.name}: ${error.message}`:String(error)});}
}
const result={scope:"Original solute role and independent concentration/numerator/denominator full-unit oracles; no model/board proof",cases:cases.length,total:rows.length,passed:rows.filter(r=>r.passed).length,failed:rows.filter(r=>!r.passed).length,rows};
const outIndex=process.argv.indexOf("--out");if(outIndex>=0){const out=process.argv[outIndex+1];assert.ok(out);writeFileSync(out,JSON.stringify(result,null,2)+"\n");}
console.log(JSON.stringify(result));if(result.failed)process.exitCode=1;
