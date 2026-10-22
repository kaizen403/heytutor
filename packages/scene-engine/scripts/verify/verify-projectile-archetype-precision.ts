import assert from 'node:assert/strict';
import { MECHANICS_GENERATORS } from '../../src/archetypes/generators/mechanics';
import { compileSceneDocument } from '../../src/compile/compiler';
import { validateSceneDocument } from '../../src/document/validation';

let checks = 0;
for (const [speed, angle, height] of [[20, 30, 0], [20.5, 30.5, 0], [20, 30, 1.234567]]) {
  const question = `A projectile is launched with speed ${speed} m/s at ${angle} degrees from a height of ${height} m.`;
  const raw = MECHANICS_GENERATORS.projectile!({
    question, slots: {u: speed, theta: angle, h0: height, g: 9.8},
    sources: {u: 'stem', theta: 'stem', h0: 'stem'}, quantities: [], schematic: false,
  });
  assert.ok(raw);
  const document = validateSceneDocument(raw).document;
  assert.ok(document);
  const compiled = compileSceneDocument(document);
  assert.ok(compiled.ok, `native ${speed}/${angle}/${height} must retain its analytic launch: ${JSON.stringify(compiled.report.issues)}`);
  checks++;
  const origin = document.constructions.find(c => c.id === 'make_O')!;
  const aim = document.constructions.find(c => c.id === 'make_aim')!;
  assert.equal(origin.inputs.y, height, 'launch origin retains the source height without display quantization'); checks++;
  const dx = Number(aim.inputs.x) - Number(origin.inputs.x);
  const dy = Number(aim.inputs.y) - Number(origin.inputs.y);
  const slope = Math.tan(angle * Math.PI / 180);
  assert.ok(Math.abs(dy - slope * dx) <= 1e-12 * Math.max(1, Math.abs(dy)), 'launch vector retains the native analytic tangent'); checks++;
  const changed = structuredClone(document);
  const wrongAim = changed.constructions.find(c => c.id === 'make_aim')!;
  wrongAim.inputs.y = Number(wrongAim.inputs.y) + Math.max(0.1, Math.abs(dy) * 0.05);
  assert.ok(compileSceneDocument(changed).report.issues.some(issue => issue.code === 'launch_velocity_contradiction'), 'wrong launch directions stay refused'); checks++;
  if (angle === 30 && height === 0) {
    const rounded = structuredClone(document);
    const roundedAim = rounded.constructions.find(c => c.id === 'make_aim')!;
    roundedAim.inputs.x = Number(Number(roundedAim.inputs.x).toFixed(4));
    roundedAim.inputs.y = Number(Number(roundedAim.inputs.y).toFixed(4));
    assert.ok(compileSceneDocument(rounded).report.issues.some(issue => issue.code === 'launch_velocity_contradiction'), 'legacy independent display rounding is not made acceptable by loosening truth tolerance'); checks++;
  }
}
console.log(`projectile archetype precision: ${checks} checks passed`);
