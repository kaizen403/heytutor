/** Additive per-declaration and named-species ownership controls; source first. */
import assert from "node:assert/strict";
import { buildSolutionsGraphScene } from "../../src/chemistry/solutionsGraphs";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { compileSceneDocument } from "../../src/compile/compiler";
import { pruneDeadSceneEntities, validateSceneDocument } from "../../src/document/validation";
import type { SceneDocument } from "../../src/types";
interface Case {id:string;question:string;refuse?:boolean;pK?:number}
const cases: Case[] = [
  {
    "id": "review-missing-Ka-before",
    "question": "50 mL of 0.1 M CH3COOH is titrated with 0.1 M NaOH. Ka = unknown; Ka = 1e-5. Draw the curve.",
    "refuse": true
  },
  {
    "id": "review-missing-Ka-after",
    "question": "50 mL of 0.1 M CH3COOH is titrated with 0.1 M NaOH. Ka = 1e-5; Ka = unknown. Draw the curve.",
    "refuse": true
  },
  {
    "id": "review-missing-pKa-before",
    "question": "50 mL of 0.1 M CH3COOH is titrated with 0.1 M NaOH. pKa = unknown; pKa = 5. Draw the curve.",
    "refuse": true
  },
  {
    "id": "review-missing-Kb-after",
    "question": "50 mL of 0.1 M NH3 is titrated with 0.1 M HCl. Kb = 1e-5; Kb = unknown. Draw the curve.",
    "refuse": true
  },
  {
    "id": "review-other-acid-of",
    "question": "50 mL of 0.1 M CH3COOH is titrated with 0.1 M NaOH. Ka of HF = 1e-5. Draw the curve.",
    "refuse": true
  },
  {
    "id": "review-other-acid-parens",
    "question": "50 mL of 0.1 M CH3COOH is titrated with 0.1 M NaOH. Ka(HCOOH) = 1e-5. Draw the curve.",
    "refuse": true
  },
  {
    "id": "OWN-unread-log-alias-after",
    "question": "50 mL of 0.1 M CH3COOH is titrated with 0.1 M NaOH. pKa = 5; pK_{a} is illegible. Plot the pH curve.",
    "refuse": true
  },
  {
    "id": "OWN-unread-Ka-alias-before",
    "question": "50 mL of 0.1 M CH3COOH is titrated with 0.1 M NaOH. K_{a} is not given; Ka = 2e-5. Show the titration graph.",
    "refuse": true
  },
  {
    "id": "OWN-unread-Kb-before",
    "question": "50 mL of 0.1 M NH3 is titrated with 0.1 M HCl. K_b = unavailable; Kb = 1e-5. Draw its curve.",
    "refuse": true
  },
  {
    "id": "OWN-unread-pKb-after",
    "question": "50 mL of 0.1 M NH3 is titrated with 0.1 M HCl. pK_b = 5; pKb is unknown. Show the curve.",
    "refuse": true
  },
  {
    "id": "OWN-unread-word-owner",
    "question": "50 mL of 0.1 M CH3COOH is titrated with 0.1 M NaOH. The acid dissociation constant is unreadable; Ka = 1e-5. Draw the curve.",
    "refuse": true
  },
  {
    "id": "OWN-other-acid-log",
    "question": "50 mL of 0.1 M CH3COOH is titrated with 0.1 M NaOH. pKa of formic acid = 5. Draw the curve.",
    "refuse": true
  },
  {
    "id": "OWN-other-acid-matching-kind",
    "question": "25 mL of 0.1 M HCOOH is titrated with 0.1 M NaOH. Ka(acetic acid) = 1e-5. Draw the curve.",
    "refuse": true
  },
  {
    "id": "OWN-other-base",
    "question": "50 mL of 0.1 M NH3 is titrated with 0.1 M HCl. Kb of weak base = 1e-5. Draw the curve.",
    "refuse": true
  },
  {
    "id": "OWN-other-species-parentheses",
    "question": "50 mL of 0.1 M CH3COOH is titrated with 0.1 M NaOH. Ka(NH3) = 1e-5. Plot the titration curve.",
    "refuse": true
  },
  {
    "id": "OWN-damaged-named-owner",
    "question": "50 mL of 0.1 M CH3COOH is titrated with 0.1 M NaOH. pKa(CH3COOH unknown) = 5. Draw the curve.",
    "refuse": true
  },
  {
    "id": "positive-same-formula",
    "question": "50 mL of 0.1 M CH3COOH is titrated with 0.1 M NaOH. Ka(CH3COOH) = 1e-5. Draw the curve.",
    "pK": 5
  },
  {
    "id": "positive-same-alias",
    "question": "50 mL of 0.1 M CH3COOH is titrated with 0.1 M NaOH. pKa of ethanoic acid = 5. Draw the curve.",
    "pK": 5
  },
  {
    "id": "positive-base-alias",
    "question": "25 mL of 0.1 M NH4OH is titrated with 0.1 M HCl. Kb(NH3) = 1e-5. Draw the curve.",
    "pK": 5
  },
  {
    "id": "positive-independent-agree",
    "question": "50 mL of 0.1 M CH3COOH is titrated with 0.1 M NaOH. Ka = 1e-5; pKa(CH3COOH) = 5. Draw the curve.",
    "pK": 5
  },
  {
    "id": "refuse-independent-conflict",
    "question": "50 mL of 0.1 M CH3COOH is titrated with 0.1 M NaOH. Ka = 1e-5; pKa(CH3COOH) = 4. Draw the curve.",
    "refuse": true
  },
  {
    "id": "refuse-two-complete-owners",
    "question": "50 mL of 0.1 M CH3COOH is titrated with 0.1 M NaOH. Ka = 1e-5; Ka = 1e-5. Draw the curve.",
    "refuse": true
  },
  {
    "id": "review-other-acid-pKa-parentheses",
    "question": "50 mL of 0.1 M CH3COOH is titrated with 0.1 M NaOH. pKa(HF) = 5. Draw the curve.",
    "refuse": true
  },
  {
    "id": "review-other-acid-for",
    "question": "50 mL of 0.1 M CH3COOH is titrated with 0.1 M NaOH. Ka for methanoic acid = 2e-5. Draw the curve.",
    "refuse": true
  },
  {
    "id": "review-other-base-symbol",
    "question": "25 mL of 0.1 M NH3 is titrated with 0.1 M HCl. Kb(B) = 2e-5. Draw the curve.",
    "refuse": true
  },
  {
    "id": "positive-ammonia-alias",
    "question": "25 mL of 0.1 M NH3 is titrated with 0.1 M HCl. pKb of ammonia = 5. Draw the curve.",
    "pK": 5
  }
];
function compiled(document:SceneDocument) {
  const valid=validateSceneDocument(pruneDeadSceneEntities(document as unknown as Record<string,unknown>));
  assert.ok(valid.document,JSON.stringify(valid.report.issues));
  const out=compileSceneDocument(valid.document);assert.ok(out.ok && out.renderScene,JSON.stringify(out.report.issues));
  return out.renderScene.primitives.filter(p=>p.kind==="label").map(p=>p.text);
}
const rows:Array<{id:string;passed:boolean;error?:string}>=[];
for(const c of cases) {
  try {
    const direct=buildSolutionsGraphScene(c.question,[],false),ordinary=synthesizeFamilyScene({question:c.question});
    if(c.refuse) {
      assert.equal(direct,null,"direct figure borrowed another or incomplete constant owner");
      assert.equal(buildSolutionsGraphScene(c.question,[],true),null,"schematic fallback borrowed a constant owner");
      assert.equal(ordinary,null,"ordinary route borrowed a constant or drew the wrong ask");
    } else {
      assert.ok(direct);assert.ok(ordinary);
      for(const d of [direct,ordinary.document]) {
        compiled(d);
        const caption=d.annotations.find(a=>a.id==="figure_caption")?.text??"";
        const value=/(?:pKa|pKb) = ([0-9.]+)/.exec(caption);assert.ok(value,caption);
        assert.equal(Number(value[1]),c.pK);
        assert.ok(!caption.includes("4.76"),caption);
      }
    }
    rows.push({id:c.id,passed:true});
  } catch(error) {rows.push({id:c.id,passed:false,error:String(error)});console.error(`FAIL ${c.id}: ${error}`);}
}
console.log(JSON.stringify({total:rows.length,passed:rows.filter(r=>r.passed).length,rows},null,2));
if(rows.some(r=>!r.passed))process.exitCode=1;
