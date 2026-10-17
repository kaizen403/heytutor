import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkedGates, parseGates, requireBaseline, runGates } from './run-gates.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const baseline = JSON.parse(readFileSync(new URL('./gates-baseline.json', import.meta.url), 'utf8'));

test('every original tutor/preverify/engine command is retained in order and wired to the runner', () => {
  for (const [file, spec] of Object.entries(baseline.lists)) {
    const gates = checkedGates(resolve(root, file));
    const original = spec.command.split(' && ');
    requireBaseline(gates, original);
    requireBaseline([...gates, 'future extra gate'], original);
    const pkg = JSON.parse(readFileSync(resolve(root, spec.package), 'utf8'));
    const list = file.slice(file.indexOf('/scripts/') + 1);
    assert.equal(pkg.scripts[spec.script], `node ../../tools/verify/run-gates.mjs ${list}`);
    const calls = [];
    assert.equal(runGates(gates, command => { calls.push(command); return { status: 0 }; }), 0);
    assert.deepEqual(calls, gates, 'the real runner executes every listed gate exactly once');
    for (let index = 0; index < original.length; index++) {
      assert.throws(() => requireBaseline(original.filter((_, i) => i !== index), original));
    }
  }
});

test('extensions, comments and CRLF are supported; deletions, duplicates lost and reordering fail', () => {
  assert.deepEqual(parseGates('# note\r\n\r\n one \r\ntwo\r\n'), ['one', 'two']);
  requireBaseline(['new', 'one', 'two', 'later', 'one'], ['one', 'two', 'one']);
  assert.throws(() => requireBaseline(['one', 'two'], ['one', 'two', 'one']));
  assert.throws(() => requireBaseline(['two', 'one'], ['one', 'two']));
  assert.throws(() => parseGates('# empty\n'));
});

test('actual subprocesses run in order and failure prevents every later gate', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'heytutor-gates-'));
  const marker = resolve(dir, 'calls.txt');
  const fixture = resolve(dir, 'gate.mjs');
  writeFileSync(fixture, `import {appendFileSync} from 'node:fs';appendFileSync(process.argv[2],process.argv[3]+'\\n');process.exitCode=Number(process.argv[4]);`);
  const command = (name, code) => [process.execPath, fixture, marker, name, String(code)].map(s => `'${s.replaceAll("'", "'\\''")}'`).join(' ');
  try {
    assert.equal(runGates([command('first', 0), command('second', 7), command('never', 0)]), 7);
    assert.equal(readFileSync(marker, 'utf8'), 'first\nsecond\n');
    assert.equal(runGates([command('last', 0)]), 0);
    assert.equal(readFileSync(marker, 'utf8'), 'first\nsecond\nlast\n');
    assert.equal(runGates(['kill -TERM $$', command('never-after-signal', 0)]), 143);
    assert.equal(readFileSync(marker, 'utf8'), 'first\nsecond\nlast\n', 'a signaled gate stops later commands');
    const result = spawnSync(process.execPath, [resolve(root, 'tools/verify/run-gates.mjs'), 'missing.txt'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
