import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bindStatedCircuitProblem, checkStatedCircuitProblemBinding } from "../../src/ir/statedCircuitProblemBinding";
import { synthesizeFamilyScene } from "../../src/synthesize/familyScene";
import { checkVisualObligations, deriveVisualObligations } from "../../src/synthesize/visualObligations";
import { validateSceneSourceAuthority } from "../../src/ir/sceneSourceAuthority";
import { compileSceneDocument } from "../../src/compile/compiler";
import type { ProblemIR } from "../../src/ir/problemIR";
import type { TurnPlanV3 } from "../../src/contracts/contractsV3";

const load = <T>(path: string): T => JSON.parse(readFileSync(new URL(`./fixtures/${path}.json`, import.meta.url), "utf8"));
let checks = 0;
for (const name of ["meters", "tree"]) {
  const problem = load<ProblemIR>(`w2-ohm/w1-ohm-${name}-normalized-problem-ir`);
  const plan = load<TurnPlanV3>(`w2-ohm/w1-ohm-${name}-${name === "tree" ? "source-authority-plan" : "captured-plan"}`);
  const snapshot = structuredClone(problem), binding = bindStatedCircuitProblem(problem.question, problem);
  assert.ok(binding);
  const scene = synthesizeFamilyScene({ question: problem.question, turnPlan: plan, problemIR: problem });
  assert.ok(scene, `${name} actual full IR must survive normalization`);
  assert.equal(checkVisualObligations(deriveVisualObligations(problem), scene.document, problem).satisfied, true);
  assert.deepEqual(checkStatedCircuitProblemBinding(problem.question, problem, scene.document), []);
  assert.deepEqual(validateSceneSourceAuthority(scene.document, problem.question, problem), []);
  assert.equal(compileSceneDocument(scene.document, { sourceAuthority: { question: problem.question, problemIR: problem } }).ok, true);
  assert.deepEqual(problem, snapshot);
  if (name === "tree") {
    assert.equal(checkVisualObligations(deriveVisualObligations(problem), scene.document).satisfied, false, "compact group badges alone do not authorize the source join");
    const groups = scene.document.entities.filter(row => row.kind === "group");
    assert.equal(groups.length, 2);
    for (const group of groups) {
      const actual = problem.entities.find(row => `circuit_group_${row.id}` === group.id)!;
      assert.equal(group.role, actual.label);
      const members = binding.entityBindings.find(row => row.sceneEntityId === group.id)!.memberIds;
      assert.ok(members.every(id => scene.document.requiredEntityIds.includes(id)));
      assert.ok(scene.document.annotations.some(row => row.kind === "enclose" && row.targetIds.join(",") === members.join(",")));
      assert.ok(scene.document.revealGroups.some(row => row.entityIds.includes(group.id)));
      const forged = structuredClone(scene.document);
      forged.entities.find(row => row.id === group.id)!.role = "foreign combination";
      assert.equal(checkVisualObligations(deriveVisualObligations(problem), forged, problem).satisfied, false);
      assert.ok(checkStatedCircuitProblemBinding(problem.question, problem, forged).length);
    }
  }
  checks++;
}
const trains = load<{question: string; actualPlan: TurnPlanV3; normalizedIR: ProblemIR}>("w2-motion/w1-relative-trains");
for (const plain of [false, true]) {
  const problem = structuredClone(trains.normalizedIR);
  if (plain) problem.entities.forEach((row, i) => { row.label = i ? "B" : "A"; });
  const scene = synthesizeFamilyScene({question:trains.question,turnPlan:trains.actualPlan,problemIR:problem});
  assert.ok(scene);
  assert.deepEqual(validateSceneSourceAuthority(scene.document,trains.question,problem),[]);
  for (const kind of ["body", "line"] as const) {
    const extra = structuredClone(problem);
    extra.entities.push({...extra.entities[0]!,id:"hiddenC",kind,label:"C"});
    const snapshot = structuredClone(extra);
    assert.equal(synthesizeFamilyScene({question:trains.question,turnPlan:trains.actualPlan,problemIR:extra}),null);
    assert.ok(validateSceneSourceAuthority(scene.document,trains.question,extra).some(row=>row.code==="relative_source_identity"));
    assert.equal(compileSceneDocument(scene.document,{sourceAuthority:{question:trains.question,problemIR:extra}}).ok,false);
    assert.deepEqual(extra,snapshot);checks++;
  }
  checks++;
}
console.log(`PASS ${checks} whole-source identity joins; no student acceptance`);
