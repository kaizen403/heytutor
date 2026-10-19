import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { constants } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function parseGates(text) {
  const gates = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  if (!gates.length) throw new Error('The gate list is empty');
  return gates;
}

/** New gates may be inserted; the frozen original sequence cannot disappear or reorder. */
export function requireBaseline(gates, original) {
  let next = 0;
  for (const gate of gates) if (gate === original[next]) next++;
  if (next !== original.length) throw new Error(`Missing or reordered original gate: ${original[next]}`);
}

export function runGates(gates, execute = command => spawnSync(command, {
  shell: process.env.npm_config_script_shell || true, stdio: 'inherit',
})) {
  for (const [index, command] of gates.entries()) {
    console.log(`Gate ${index + 1}/${gates.length}: ${command}`);
    const result = execute(command);
    if (result.error) throw result.error;
    if (result.signal) return constants.signals[result.signal] ? 128 + constants.signals[result.signal] : 1;
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

/** Feature PRs own small files, so independent additions never share a line. */
export function gatesWithExtensions(filename) {
  const gates = parseGates(readFileSync(filename, 'utf8'));
  const directory = filename.replace(/\.txt$/, '.d');
  if (directory === filename) throw new Error('Gate lists must use the .txt extension');
  if (existsSync(directory)) {
    const files = readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.txt')).map(entry => entry.name).sort();
    for (const file of files) gates.push(...parseGates(readFileSync(resolve(directory, file), 'utf8')));
  }
  return gates;
}

export function checkedGates(filename) {
  const baseline = JSON.parse(readFileSync(resolve(root, 'tools/verify/gates-baseline.json'), 'utf8'));
  const name = relative(root, resolve(filename)).split('\\').join('/');
  const original = baseline.lists[name];
  if (!original) throw new Error(`Unregistered gate list: ${name}`);
  const gates = parseGates(readFileSync(filename, 'utf8'));
  requireBaseline(gates, original.command.split(' && '));
  return gatesWithExtensions(filename);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [filename, option] = process.argv.slice(2);
    if (!filename || (option && option !== '--list')) throw new Error('Usage: run-gates.mjs <list> [--list]');
    const gates = checkedGates(resolve(filename));
    if (option === '--list') console.log(gates.join('\n'));
    else process.exitCode = runGates(gates);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
