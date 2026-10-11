import assert from 'node:assert/strict';
import { validateDispatchLocation } from './dispatch-contract.mjs';
const context = '/tmp/h3r8-followup';
const registration = { context, builds: { candidate: { port: 3534 } }, dispatchBlocks: [], assets: {
  jevParked: { path: '/tmp/frozen/jev.jsonl' }, exclusions: { path: '/tmp/frozen/exclusions.jsonl' },
} };
for (let i = 1; i <= 40; i++) {
  const label = `h3r8f-development-r2-candidate-b${String(i).padStart(2, '0')}`;
  const evalAsset = `developmentRow${String(i).padStart(2, '0')}`;
  registration.assets[evalAsset] = { path: `/tmp/frozen/row-${i}.jsonl` };
  registration.dispatchBlocks.push({ label, block: i, cohort: 'development', rep: 2, arm: 'candidate', n: 1, evalAsset, out: `${context}/live-outputs/${label}` });
}
const identity = { label: registration.dispatchBlocks[0].label, arm: 'candidate', cohort: 'development', block: '1' };
const argsFor = index => {
  const b = registration.dispatchBlocks[index];
  return ['--origin', 'http://127.0.0.1:3534', '--out', b.out, '--eval', registration.assets[b.evalAsset].path,
    '--visual-need-replay', registration.assets.jevParked.path, '--example-exclusions', registration.assets.exclusions.path];
};
let checks = 0;
for (let i = 0; i < 40; i++) {
  const b = registration.dispatchBlocks[i];
  assert.equal(validateDispatchLocation(argsFor(i), { ...identity, label: b.label, block: String(i + 1) }, registration).block, i + 1); checks++;
}
for (const change of [{ arm: 'main' }, { cohort: 'heldout' }, { block: '41' }, { block: '0' }, { block: '1.5' }, { label: 'h3r8-development-r2-candidate-b1' }]) {
  assert.throws(() => validateDispatchLocation(argsFor(0), { ...identity, ...change }, registration)); checks++;
}
for (const [flag, value] of [['--origin', 'http://127.0.0.1:3530'], ['--origin', 'http://127.0.0.1:3600'], ['--out', `${context}/canonical-outputs/a`], ['--eval', '/tmp/frozen/row-2.jsonl'], ['--example-exclusions', '/tmp/foreign.jsonl'], ['--visual-need-replay', '/tmp/not-parked.jsonl']]) {
  const args = argsFor(0); args[args.indexOf(flag) + 1] = value;
  assert.throws(() => validateDispatchLocation(args, identity, registration)); checks++;
}
assert.throws(() => validateDispatchLocation([...argsFor(0), '--eval', '/tmp/frozen/row-1.jsonl'], identity, registration)); checks++;
for (const delta of [{ n: 20 }, { rep: 1 }, { out: '/tmp/accounting-elsewhere' }, { evalAsset: 'developmentRow02' }]) {
  const r = structuredClone(registration); Object.assign(r.dispatchBlocks[0], delta);
  assert.throws(() => validateDispatchLocation(argsFor(0), identity, r)); checks++;
}
console.log(JSON.stringify({ passed: checks, modelCalls: 0, networkCalls: 0 }));
