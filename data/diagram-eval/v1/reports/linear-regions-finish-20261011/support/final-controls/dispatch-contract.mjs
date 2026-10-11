/** Prospective fixed one-row financial partition; identical runtime arguments. */
import { resolve } from 'node:path';
export function validateDispatchLocation(args, identity, registration) {
  const { label, arm, cohort, block } = identity;
  const index = Number(block);
  const expectedLabel = `h3r8f-development-r2-candidate-b${String(index).padStart(2, '0')}`;
  const dispatch = registration.dispatchBlocks?.find(b => b.label === label);
  if (!Number.isInteger(index) || index < 1 || index > 40 || label !== expectedLabel || arm !== 'candidate' || cohort !== 'development' ||
      !dispatch || dispatch.arm !== arm || dispatch.cohort !== cohort || dispatch.rep !== 2 || dispatch.block !== index || dispatch.n !== 1)
    throw Error('Invalid prospective one-row block identity');
  const flag = key => args[args.indexOf(`--${key}`) + 1];
  for (const key of ['origin', 'out', 'eval', 'visual-need-replay', 'example-exclusions'])
    if (args.filter(a => a === `--${key}`).length !== 1) throw Error(`Invalid location control: ${key}`);
  const expectedOutput = resolve(registration.context, 'live-outputs', label);
  const expectedOrigin = `http://127.0.0.1:${registration.builds.candidate.port}`;
  if (dispatch.out !== expectedOutput || flag('origin') !== expectedOrigin || resolve(flag('out')) !== expectedOutput)
    throw Error('Wrong prospective local origin/output');
  const assets = { eval: `developmentRow${String(index).padStart(2, '0')}`, 'visual-need-replay': 'jevParked', 'example-exclusions': 'exclusions' };
  if (dispatch.evalAsset !== assets.eval) throw Error('Wrong fixed row partition');
  for (const [name, asset] of Object.entries(assets))
    if (resolve(flag(name)) !== registration.assets[asset].path) throw Error(`Wrong frozen asset: ${name}`);
  return { expectedOutput, expectedOrigin, cohort, block: index };
}

