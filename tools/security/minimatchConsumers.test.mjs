import assert from "node:assert/strict";
import { realpathSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "../..");
const STORE = resolve(ROOT, "node_modules/.pnpm");
const entries = readdirSync(STORE);

function requireFrom(storePrefix, packageName) {
  const entry = entries.find((name) => name.startsWith(storePrefix));
  assert(entry, `${storePrefix} is not installed`);
  return createRequire(resolve(STORE, entry, "node_modules", packageName, "package.json"));
}

const consumers = [
  ["eslint@", "eslint"],
  ["@eslint+config-array@", "@eslint/config-array"],
  ["@eslint+eslintrc@", "@eslint/eslintrc"],
  ["eslint-plugin-import@", "eslint-plugin-import"],
  ["eslint-plugin-jsx-a11y@", "eslint-plugin-jsx-a11y"],
  ["eslint-plugin-react@", "eslint-plugin-react"],
];

test("every minimatch consumer resolves the one patched release", () => {
  for (const [prefix, name] of consumers) {
    const resolved = realpathSync(requireFrom(prefix, name).resolve("minimatch"));
    assert.match(resolved, /minimatch@11\.0\.4/, `${name} resolved ${resolved}`);
    const manifest = JSON.parse(readFileSync(resolve(resolved, "../../../package.json"), "utf8"));
    assert.equal(manifest.version, "11.0.4");
  }
  const lockfile = readFileSync(resolve(ROOT, "pnpm-lock.yaml"), "utf8");
  assert.deepEqual([...new Set(lockfile.match(/^ {2}minimatch@[^:(\n]+(?=:$)/gm))], ["  minimatch@11.0.4"], "a second minimatch is locked");
});

test("every export shape ESLint and its plugins use keeps working", () => {
  const minimatch = requireFrom("eslint-plugin-react@", "eslint-plugin-react")("minimatch");
  assert.equal(typeof minimatch, "function", "eslint-plugin-react calls the module");
  assert.equal(minimatch("Foo", "F*"), true);
  assert.equal(minimatch("Bar", "F*"), false);
  assert.equal(minimatch.default, minimatch, "eslint-plugin-import calls the default export");
  assert.equal(minimatch.__esModule, true);
  assert.equal(minimatch.minimatch, minimatch, "named import");
  assert.equal(typeof minimatch.Minimatch, "function", "eslint and config-array use the class");
  assert.equal(typeof minimatch.GLOBSTAR, "symbol");
  // minimatch 11 has no makeRe; only import/no-internal-modules calls it, and no config here turns that rule on.
  for (const key of ["filter", "defaults", "braceExpand", "match", "escape", "unescape", "sep"]) {
    assert(key in minimatch, `${key} is missing`);
  }
});

test("the ESM default import @eslint/eslintrc uses keeps working", async () => {
  const entry = entries.find((name) => name.startsWith("@eslint+eslintrc@"));
  const directory = resolve(STORE, entry, "node_modules/@eslint/eslintrc/lib/config-array/override-tester.js");
  assert.match(readFileSync(directory, "utf8"), /import minimatch from "minimatch"/);
  const { OverrideTester } = await import(pathToFileURL(directory).href);
  const tester = OverrideTester.create(["*.js"], [], "/repo");
  assert.equal(tester.test("/repo/src/a.js"), true);
  assert.equal(tester.test("/repo/src/a.ts"), false);
});

test("ESLint's own patterns match as they did under minimatch 3", () => {
  const { Minimatch } = requireFrom("eslint@", "eslint")("minimatch");
  const options = { dot: true, matchBase: true };
  const cases = [
    ["*.js", "src/a.js", true],
    ["*.js", "src/a.ts", false],
    ["**/*.tsx", "apps/tutor/page.tsx", true],
    ["apps/*/dist/**", "apps/tutor/dist/a/b.js", true],
    ["apps/*/dist/**", "apps/tutor/src/a.js", false],
    [".next/**", ".next/server/a.js", true],
    ["!*.js", "a.js", false],
  ];
  for (const [pattern, path, expected] of cases) {
    assert.equal(new Minimatch(pattern, options).match(path), expected, `${pattern} on ${path}`);
  }
});

test("the plugins that load minimatch still load", () => {
  for (const [prefix, name] of consumers.slice(3)) {
    assert(requireFrom(prefix, name)(name).rules, `${name} did not load`);
  }
});

test("the Sentry bundler plugin's glob resolves the patched release and finds files", async () => {
  const entry = entries.find((name) => name.startsWith("@sentry+bundler-plugins@"));
  assert(entry, "@sentry/bundler-plugins is not installed");
  const load = createRequire(resolve(STORE, entry, "node_modules/@sentry/bundler-plugins/package.json"));
  assert.match(realpathSync(load.resolve("glob")), /glob@14\.0\.3/);
  const { glob } = load("glob");
  const found = await glob("tools/security/*.test.mjs", { cwd: ROOT, nodir: true, absolute: false });
  assert(found.some((path) => path.endsWith("minimatchConsumers.test.mjs")));
});
