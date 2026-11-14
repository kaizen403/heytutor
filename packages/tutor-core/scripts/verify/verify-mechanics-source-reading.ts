/** Regression for a negated launch cue blocking an explicitly stated curve. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../../scene-engine/src/synthesize/familyScene.ts";
import { parseMathExpression } from "../../../scene-engine/src/math/expression.ts";
import { inferSceneCapabilities } from "../../src/planners/sceneCapabilities";

const probes = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../data/syllabus-probes/physics-unit-2.json", import.meta.url)), "utf8")) as {
  questions: Array<{ id: string; question: string }>;
};
const source = probes.questions.find(item => item.id === "physics|2|motion-in-a-plane|hard");
assert.ok(source, "the original source probe must remain present");

for (const negation of ["This is not projectile motion.", "This is not a projectile."]) {
  const question = source.question.replace("This is not projectile motion.", negation);
  const families = inferSceneCapabilities(question).families;
  for (const synthesize of [synthesizeFamilyScene, synthesizeLastResortScene]) {
    const scene = synthesize({ question, families });
    assert.ok(scene, `${negation}: the stated non-projectile curve must compile`);
    assert.equal(scene.nonMetric, true, "a source sketch must not claim a metric solution");
    assert.notEqual(scene.tier, "exact_verified");
    assert.ok(scene.renderScene.primitives.length > 0);
    assert.ok(!scene.validationReport.issues.some(issue => issue.severity === "fatal"));
    const curves = scene.document.constructions.filter(c => c.operator === "function_curve");
    assert.equal(curves.length, 1, "the source supplies exactly one trajectory curve");
    const expression = parseMathExpression(String(curves[0]!.inputs.expression));
    for (const x of [-1, 0, 1, 2]) {
      assert.equal(expression.evaluate(x), x * x / 2, `source y=x²/2 at x=${x}`);
    }
    assert.ok(!scene.document.constructions.some(c => c.operator === "projectile_trajectory"));
    assert.ok(!scene.document.entities.some(e => /projectile|launch angle/i.test(e.role ?? "")));
  }
}

for (const id of ["physics|2|projectile-motion|easy", "physics|2|projectile-motion|medium"]) {
  const probe = probes.questions.find(item => item.id === id);
  assert.ok(probe);
  const scene = synthesizeFamilyScene({ question: probe.question, families: inferSceneCapabilities(probe.question).families });
  assert.ok(scene, `${id}: a real supported launch still draws`);
}

// The other refused launches still need their complete physics. Reading a
// negation must not enable a level-ground stand-in for an incline or split.
for (const id of ["physics|2|projectile-motion|hard", "physics|2|projectile-on-incline|easy", "physics|2|projectile-on-incline|hard"]) {
  const probe = probes.questions.find(item => item.id === id);
  assert.ok(probe);
  const families = inferSceneCapabilities(probe.question).families;
  for (const synthesize of [synthesizeFamilyScene, synthesizeLastResortScene]) {
    assert.equal(synthesize({ question: probe.question, families }), null, `${id}: no unrelated or partial launch`);
  }
}
console.log("verify-mechanics-source-reading: ok (stated curve and launch controls)");
