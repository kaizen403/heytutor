/** Bounded fixtures only: never import the real-root/webpack verification gate. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, utimesSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { renderFingerprint } from '../../lib/lecture-export/buildRenderFingerprint.mjs';

function fixture(run) {
  const root = mkdtempSync(path.join(tmpdir(), 'render-installed-'));
  const put = (file, value) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), value); };
  const pkg = (dir, name, version, dependencies = {}) => {
    put(`${dir}/package.json`, JSON.stringify({ name, version, exports: { '.': './index.js' }, dependencies }));
    put(`${dir}/index.js`, 'throw new Error("dependency code must never execute");');
  };
  const hash = () => renderFingerprint(root, ['src/render.ts']);
  put('src/render.ts', 'import { paint } from "paint"; export const render = paint;');
  pkg('node_modules/paint', 'paint', '1.0.0', { '@lezer/highlight': '*' });
  pkg('node_modules/@lezer/highlight', '@lezer/highlight', '1.0.0');
  try { run({ root, put, pkg, hash }); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('installed direct runtime version invalidates identity', () => fixture(({ pkg, hash }) => {
  const before = hash();
  pkg('node_modules/paint', 'paint', '2.0.0', { '@lezer/highlight': '*' });
  assert.notEqual(hash(), before);
}));
test('installed transitive runtime version invalidates identity', () => fixture(({ pkg, hash }) => {
  const before = hash();
  pkg('node_modules/@lezer/highlight', '@lezer/highlight', '2.0.0');
  assert.notEqual(hash(), before);
}));
test('paths, mtimes, git refs, unrelated sources/deps and type-only packages stay stable', () => fixture(({ root, put, pkg, hash }) => {
  put('src/render.ts', 'import "paint"; import type { T } from "types"; import { type U } from "other-types"; export type { V } from "third-types";');
  const before = hash();
  pkg('node_modules/types', 'types', '99.0.0');
  pkg('node_modules/unrelated', 'unrelated', '99.0.0');
  put('src/unrelated.ts', 'throw Error();'); put('.git/HEAD', 'different-ref');
  utimesSync(path.join(root, 'src/render.ts'), new Date(0), new Date(0));
  assert.equal(hash(), before);
  const copy = `${root}-copy`;
  try { cpSync(root, copy, { recursive: true }); assert.equal(renderFingerprint(copy, ['src/render.ts']), before); }
  finally { rmSync(copy, { recursive: true, force: true }); }
}));
test('exports-hidden JSON, pnpm symlinks and multiple installed versions use actual resolution', () => fixture(({ root, put, pkg, hash }) => {
  pkg('node_modules/.pnpm/paint@1/node_modules/paint', 'paint', '1.0.0', { '@lezer/highlight': '*' });
  pkg('node_modules/.pnpm/highlight@2/node_modules/@lezer/highlight', '@lezer/highlight', '2.0.0');
  rmSync(path.join(root, 'node_modules/paint'), { recursive: true });
  symlinkSync('.pnpm/paint@1/node_modules/paint', path.join(root, 'node_modules/paint'));
  mkdirSync(path.join(root, 'node_modules/.pnpm/paint@1/node_modules/@lezer'), { recursive: true });
  symlinkSync('../../../highlight@2/node_modules/@lezer/highlight', path.join(root, 'node_modules/.pnpm/paint@1/node_modules/@lezer/highlight'));
  put('src/render.ts', 'import "paint"; import "@lezer/highlight";');
  assert.throws(() => createRequire(path.join(root, 'src/render.ts')).resolve('paint/package.json'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
  const before = hash();
  pkg('node_modules/@lezer/highlight', '@lezer/highlight', '3.0.0');
  assert.notEqual(hash(), before, 'hoisted version tracked separately');
  const second = hash();
  pkg('node_modules/.pnpm/highlight@2/node_modules/@lezer/highlight', '@lezer/highlight', '4.0.0');
  assert.notEqual(hash(), second, 'nested symlink-resolved version tracked separately');
}));
test('dependency edge reassignment invalidates identity even with equal version set', () => fixture(({ put, pkg, hash }) => {
  put('src/render.ts', 'import "paint"; import "shapes";');
  pkg('node_modules/paint', 'paint', '1', { tone: '*' });
  pkg('node_modules/shapes', 'shapes', '1', { tone: '*' });
  pkg('node_modules/paint/node_modules/tone', 'tone', '1');
  pkg('node_modules/shapes/node_modules/tone', 'tone', '2');
  const before = hash();
  pkg('node_modules/paint/node_modules/tone', 'tone', '2');
  pkg('node_modules/shapes/node_modules/tone', 'tone', '1');
  assert.notEqual(hash(), before, 'each owner must retain its resolved dependency identity');
}));
test('required dependency is not made optional by optional peer metadata', () => fixture(({ put, hash }) => {
  put('src/render.ts', 'import "paint";');
  put('node_modules/paint/package.json', JSON.stringify({
    name: 'paint', version: '1', exports: { '.': './index.js' },
    dependencies: { tone: '*' }, peerDependencies: { tone: '*' },
    peerDependenciesMeta: { tone: { optional: true } },
  }));
  assert.throws(hash, /Cannot resolve rendering dependency tone/);
}));
test('valid import-only exported rendering package can be fingerprinted', () => fixture(({ put, pkg, hash }) => {
  put('src/render.ts', 'import { paint } from "paint";');
  pkg('node_modules/paint', 'paint', '1');
  put('node_modules/paint/package.json', JSON.stringify({ name: 'paint', version: '1', type: 'module', exports: { '.': { import: './index.js' } } }));
  assert.match(hash(), /^[a-f0-9]{64}$/);
}));
test('unresolved required installed runtime dependency fails closed', () => fixture(({ root, hash }) => {
  rmSync(path.join(root, 'node_modules/@lezer/highlight'), { recursive: true });
  assert.throws(hash, /resolve|dependency/i);
}));
