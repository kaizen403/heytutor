/** Tiny metadata-ownership controls, migrated from independently reviewed fixtures. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { renderFingerprint } from '../../lib/lecture-export/buildRenderFingerprint.mjs';

function fixture(run) {
  const root = mkdtempSync(path.join(tmpdir(), 'render-metadata-contract-'));
  const put = (file, value) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), value); };
  const pkg = (dir, name, version = '1', extra = {}) => {
    put(`${dir}/package.json`, JSON.stringify({ name, version, ...extra }));
    put(`${dir}/index.js`, 'throw Error("dependency code must never execute")');
  };
  const hash = () => renderFingerprint(root, ['src/render.ts']);
  put('src/render.ts', 'import "paint";');
  try { run({ root, put, pkg, hash }); } finally { rmSync(root, { recursive: true, force: true }); }
}

test('self-reference belongs to nearest package scope, not hoisted decoy', () => fixture(({ put, pkg, hash }) => {
  put('package.json', JSON.stringify({ name: 'paint', version: '1' })); pkg('node_modules/paint', 'paint', '99');
  const before = hash(); pkg('node_modules/paint', 'paint', '100'); assert.equal(hash(), before);
  put('package.json', JSON.stringify({ name: 'paint', version: '2' })); assert.notEqual(hash(), before);
}));
test('nonmatching nearest scope does not authorize ancestor self-reference', () => fixture(({ put, pkg, hash }) => {
  put('package.json', JSON.stringify({ name: 'paint', version: '1' })); put('src/package.json', JSON.stringify({ name: 'other', version: '1' }));
  assert.throws(hash, /Cannot resolve rendering dependency paint/); pkg('node_modules/paint', 'paint'); assert.match(hash(), /^[a-f0-9]{64}$/);
}));
test('pnpm physical owner wins over lexical hoisted dependency decoy', () => fixture(({ root, pkg, hash }) => {
  pkg('node_modules/.pnpm/paint@1/node_modules/paint', 'paint', '1', { dependencies: { tone: '*' } });
  pkg('node_modules/.pnpm/paint@1/node_modules/tone', 'tone', '2'); pkg('node_modules/tone', 'tone', '99');
  symlinkSync('.pnpm/paint@1/node_modules/paint', path.join(root, 'node_modules/paint'));
  const before = hash(); pkg('node_modules/tone', 'tone', '100'); assert.equal(hash(), before);
  pkg('node_modules/.pnpm/paint@1/node_modules/tone', 'tone', '3'); assert.notEqual(hash(), before);
}));
test('conditional browser/import metadata includes declared runtime dependency union', () => fixture(({ pkg, hash }) => {
  pkg('node_modules/paint', 'paint', '1', { exports: { '.': { browser: './browser.js', import: './esm.js', require: './index.js' } }, dependencies: { browserTone: '*', serverTone: '*' } });
  pkg('node_modules/browserTone', 'browserTone'); pkg('node_modules/serverTone', 'serverTone');
  const before = hash(); pkg('node_modules/browserTone', 'browserTone', '2'); assert.notEqual(hash(), before);
  const second = hash(); pkg('node_modules/serverTone', 'serverTone', '2'); assert.notEqual(hash(), second);
}));
test('valid import-only optional peer is present identity and version changes invalidate', () => fixture(({ pkg, hash }) => {
  pkg('node_modules/paint', 'paint', '1', { peerDependencies: { tone: '*' }, peerDependenciesMeta: { tone: { optional: true } } });
  const absent = hash(); pkg('node_modules/tone', 'tone', '1', { type: 'module', exports: { '.': { import: './index.js' } } });
  const present = hash(); assert.notEqual(present, absent);
  pkg('node_modules/tone', 'tone', '2', { type: 'module', exports: { '.': { import: './index.js' } } }); assert.notEqual(hash(), present);
}));
for (const [kind, contents] of [['JSON', '{'], ['name', JSON.stringify({ name: 'wrong', version: '1' })], ['version', JSON.stringify({ name: 'tone', version: 3 })]]) {
  test(`present optional malformed ${kind} fails closed before hoisted valid candidate`, () => fixture(({ put, pkg, hash }) => {
    pkg('node_modules/paint', 'paint', '1', { optionalDependencies: { tone: '*' } }); pkg('node_modules/tone', 'tone');
    put('node_modules/paint/node_modules/tone/package.json', contents); assert.throws(hash);
  }));
}
test('malformed importer scope fails closed', () => fixture(({ put, pkg, hash }) => {
  pkg('node_modules/paint', 'paint'); put('src/package.json', '{'); assert.throws(hash, SyntaxError);
}));
test('explicit optionalDependencies override required dependencies; installation invalidates', () => fixture(({ pkg, hash }) => {
  pkg('node_modules/paint', 'paint', '1', { dependencies: { tone: '*' }, optionalDependencies: { tone: '*' } });
  const before = hash(); pkg('node_modules/tone', 'tone'); assert.notEqual(hash(), before);
}));
test('nonoptional peer remains required', () => fixture(({ pkg, hash }) => {
  pkg('node_modules/paint', 'paint', '1', { peerDependencies: { tone: '*' } }); assert.throws(hash, /Cannot resolve rendering dependency tone/);
}));
test('optional metadata cannot waive dependency without peer declaration', () => fixture(({ pkg, hash }) => {
  pkg('node_modules/paint', 'paint', '1', { dependencies: { tone: '*' }, peerDependenciesMeta: { tone: { optional: true } } }); assert.throws(hash, /Cannot resolve rendering dependency tone/);
}));
test('present optional peer version changes invalidate identity', () => fixture(({ pkg, hash }) => {
  pkg('node_modules/paint', 'paint', '1', { peerDependencies: { tone: '*' }, peerDependenciesMeta: { tone: { optional: true } } }); pkg('node_modules/tone', 'tone');
  const before = hash(); pkg('node_modules/tone', 'tone', '2'); assert.notEqual(hash(), before);
}));
test('distinct same-version owners retain downstream edges', () => fixture(({ put, pkg, hash }) => {
  put('src/render.ts', 'import "paint"; import "shapes";');
  for (const owner of ['paint', 'shapes']) {
    pkg(`node_modules/${owner}`, owner, '1', { dependencies: { tone: '*' } });
    pkg(`node_modules/${owner}/node_modules/tone`, 'tone', '1', { dependencies: { ink: '*' } });
  }
  pkg('node_modules/paint/node_modules/ink', 'ink', '1'); pkg('node_modules/shapes/node_modules/ink', 'ink', '2');
  const before = hash();
  pkg('node_modules/paint/node_modules/ink', 'ink', '2'); pkg('node_modules/shapes/node_modules/ink', 'ink', '1'); assert.notEqual(hash(), before);
}));
test('cycles terminate, relocation stays stable, changed cyclic edge invalidates', () => fixture(({ root, pkg, hash }) => {
  pkg('node_modules/paint', 'paint', '1', { dependencies: { tone: '*' } }); pkg('node_modules/tone', 'tone', '1', { dependencies: { paint: '*' } });
  const before = hash(); assert.equal(hash(), before);
  const copy = `${root}-copy`;
  try { cpSync(root, copy, { recursive: true }); assert.equal(renderFingerprint(copy, ['src/render.ts']), before); }
  finally { rmSync(copy, { recursive: true, force: true }); }
  pkg('node_modules/tone', 'tone', '1'); assert.notEqual(hash(), before);
}));
test('manifest dependency key ordering is irrelevant', () => fixture(({ pkg, hash }) => {
  pkg('node_modules/paint', 'paint', '1', { dependencies: { tone: '*', ink: '*' } }); pkg('node_modules/tone', 'tone'); pkg('node_modules/ink', 'ink');
  const before = hash(); pkg('node_modules/paint', 'paint', '1', { dependencies: { ink: '*', tone: '*' } }); assert.equal(hash(), before);
}));
test('absent optional peer is allowed and installing it changes identity', () => fixture(({ pkg, hash }) => {
  pkg('node_modules/paint', 'paint', '1', { peerDependencies: { tone: '*' }, peerDependenciesMeta: { tone: { optional: true } } });
  const before = hash(); pkg('node_modules/tone', 'tone'); assert.notEqual(hash(), before);
}));
