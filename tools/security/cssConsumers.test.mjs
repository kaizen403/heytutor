import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";

const landing = createRequire(resolve("apps/landing/package.json"));
const tailwind3Entry = landing.resolve("tailwindcss");
const tailwind3 = createRequire(tailwind3Entry);
const tailwind3Plugin = tailwind3(tailwind3Entry);
const tailwind3PostcssEntry = tailwind3.resolve("postcss");
const tailwind3Postcss = createRequire(tailwind3PostcssEntry)(tailwind3PostcssEntry);
const nestedEntry = tailwind3.resolve("postcss-nested");
const nestedRequire = createRequire(nestedEntry);
const postcssNested = nestedRequire(nestedEntry);
const selectorParserEntry = tailwind3.resolve("postcss-selector-parser");
const selectorParser = createRequire(selectorParserEntry)(selectorParserEntry);

const tutor = createRequire(resolve("apps/tutor/package.json"));
const tailwind4PostcssEntry = tutor.resolve("@tailwindcss/postcss");
const tailwind4Postcss = createRequire(tailwind4PostcssEntry);
const tailwind4NodeEntry = tailwind4Postcss.resolve("@tailwindcss/node");
const tailwind4Node = createRequire(tailwind4NodeEntry);
const postcssEntry = tailwind4Postcss.resolve("postcss");
const postcssRequire = createRequire(postcssEntry);
const postcss = postcssRequire(postcssEntry);
const sourceMapEntry = tailwind4Node.resolve("source-map-js");
const sourceMap = createRequire(sourceMapEntry)(sourceMapEntry);

function packageRoot(entry, expectedName) {
  let directory = dirname(entry);
  while (directory !== dirname(directory)) {
    const manifest = resolve(directory, "package.json");
    try {
      if (JSON.parse(readFileSync(manifest, "utf8")).name === expectedName) return directory;
    } catch {}
    directory = dirname(directory);
  }
  throw new Error(`Could not find package root for ${expectedName} from ${entry}`);
}

function packageVersion(entry, expectedName) {
  const manifest = JSON.parse(readFileSync(resolve(packageRoot(entry, expectedName), "package.json"), "utf8"));
  return manifest.version;
}

function indexedMap(offset, map = { version: 3, sources: ["input.css"], names: [], mappings: "AAAA" }) {
  return { version: 3, sections: [{ offset, map }] };
}

test("Tailwind 3 and postcss-nested share selector-parser 7 with nested arbitrary selectors", async () => {
  const tailwindParser = realpathSync(packageRoot(selectorParserEntry, "postcss-selector-parser"));
  const nestedParserEntry = nestedRequire.resolve("postcss-selector-parser");
  assert.equal(realpathSync(packageRoot(nestedParserEntry, "postcss-selector-parser")), tailwindParser);
  assert.equal(
    realpathSync(packageRoot(nestedRequire.resolve("postcss"), "postcss")),
    realpathSync(packageRoot(tailwind3PostcssEntry, "postcss")),
  );
  assert.equal(packageVersion(selectorParserEntry, "postcss-selector-parser"), "7.1.6");
  assert.equal(packageVersion(nestedEntry, "postcss-nested"), "6.2.0");

  const selector = ".group:hover > .\\[\\&\\>\\*\\]\\:block:is(.peer, .peer\\:focus)";
  const parsed = selectorParser().astSync(selector);
  assert.equal(parsed.toString(), selector);
  assert.equal(parsed.nodes.length, 1);
  assert.equal(parsed.first.nodes.at(-1).value, ":is");

  const processor = tailwind3Postcss().use(postcssNested);
  const result = await processor.process(
    ".group, .peer { &:hover > .\\[\\&\\>\\*\\]\\:block { color: red } }",
    { from: undefined },
  );
  assert.equal(
    result.css,
    ".group:hover > .\\[\\&\\>\\*\\]\\:block, .peer:hover > .\\[\\&\\>\\*\\]\\:block { color: red }",
  );
  for (const flattened of result.root.first.selectors) {
    assert.equal(selectorParser().astSync(flattened).toString(), flattened);
  }
});

test("Tailwind 3 transforms group, peer and arbitrary variants on utilities and compound plugin selectors", async () => {
  const result = await tailwind3Postcss([tailwind3Plugin({
    content: [{
      raw: "group-hover:block peer-focus:underline [&>span]:font-bold group-hover:compound peer-focus:compound [&:focus]:compound",
      extension: "html",
    }],
    plugins: [({ addUtilities }) => {
      // Multiple nodes around the candidate class exercise finalizeSelector's
      // insertion during traversal, rather than its single-class replacement.
      addUtilities({ ".compound.extra:hover::before": { content: '"ok"', color: "red" } });
    }],
  })]).process("@tailwind utilities;", { from: undefined });

  const rules = result.root.nodes.map((rule) => ({
    selector: rule.selector,
    declarations: rule.nodes.map((declaration) => [declaration.prop, declaration.value]),
  }));
  assert.deepEqual(rules, [
    { selector: ".group:hover .group-hover\\:block", declarations: [["display", "block"]] },
    {
      selector: ".group:hover .group-hover\\:compound.extra:hover::before",
      declarations: [["content", '"ok"'], ["color", "red"]],
    },
    { selector: ".peer:focus ~ .peer-focus\\:underline", declarations: [["text-decoration-line", "underline"]] },
    {
      selector: ".peer:focus ~ .peer-focus\\:compound.extra:hover::before",
      declarations: [["content", '"ok"'], ["color", "red"]],
    },
    {
      selector: ".\\[\\&\\:focus\\]\\:compound:focus.extra:hover::before",
      declarations: [["content", '"ok"'], ["color", "red"]],
    },
    { selector: ".\\[\\&\\>span\\]\\:font-bold>span", declarations: [["font-weight", "700"]] },
  ]);
});

test("selector-parser handles one long flat class selector within a bounded child process", () => {
  const script = `
    const assert = require("node:assert/strict");
    const parser = require(${JSON.stringify(selectorParserEntry)});
    const selector = ".a".repeat(100_000);
    assert.equal(selector.length, 200_000);
    const root = parser().astSync(selector);
    assert.equal(root.nodes.length, 1);
    let classes = 0;
    root.walkClasses(() => { classes++; });
    assert.equal(classes, 100_000);
    assert.equal(root.toString(), selector);
  `;
  const result = spawnSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    timeout: 3_000,
    maxBuffer: 1_000_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("PostCSS 8 and Tailwind 4 share source-map-js 1.2.2 for source-map round trips", async () => {
  const tailwind4SourceMap = realpathSync(packageRoot(sourceMapEntry, "source-map-js"));
  const postcssSourceMapEntry = postcssRequire.resolve("source-map-js");
  assert.equal(realpathSync(packageRoot(postcssSourceMapEntry, "source-map-js")), tailwind4SourceMap);
  assert.equal(packageVersion(postcssEntry, "postcss"), "8.5.26");
  assert.equal(packageVersion(sourceMapEntry, "source-map-js"), "1.2.2");

  const result = await postcss([
    (root) => root.walkDecls((declaration) => { declaration.value = "blue"; }),
  ]).process("a {\n  color: red;\n}\n", {
    from: "input.css",
    to: "output.css",
    map: { inline: false, annotation: false, sourcesContent: true },
  });
  assert.equal(result.css, "a {\n  color: blue;\n}\n");

  const { SourceMapConsumer, SourceMapGenerator } = sourceMap;
  const firstConsumer = new SourceMapConsumer(result.map.toJSON());
  const firstPosition = firstConsumer.originalPositionFor({ line: 2, column: 2 });
  assert.deepEqual(firstPosition, { source: "input.css", line: 2, column: 2, name: null });
  const roundTripped = SourceMapGenerator.fromSourceMap(firstConsumer).toJSON();
  const secondConsumer = new SourceMapConsumer(roundTripped);
  assert.deepEqual(secondConsumer.originalPositionFor({ line: 2, column: 2 }), firstPosition);
  assert.equal(secondConsumer.sourceContentFor("input.css"), "a {\n  color: red;\n}\n");
});

test("indexed source-map offsets accept valid positions and reject malformed or amplified offsets", () => {
  const { SourceMapConsumer } = sourceMap;
  const valid = new SourceMapConsumer(indexedMap({ line: 10, column: 0 }));
  assert.deepEqual(valid.originalPositionFor({ line: 11, column: 1 }), {
    source: "input.css",
    line: 1,
    column: 0,
    name: null,
  });

  for (const offset of [
    { line: -1, column: 0 },
    { line: 0, column: 0.5 },
    { line: Number.NaN, column: 0 },
    { line: 0, column: Number.POSITIVE_INFINITY },
  ]) {
    assert.throws(() => new SourceMapConsumer(indexedMap(offset)), /non-negative integers/);
  }
  assert.throws(
    () => new SourceMapConsumer(indexedMap({ line: 10_000_001, column: 0 })),
    /must not exceed 10000000/,
  );

  const nestedOffsets = indexedMap({ line: 5_000_001, column: 0 }, indexedMap({ line: 5_000_000, column: 0 }));
  assert.throws(
    () => new SourceMapConsumer(nestedOffsets),
    /including offsets of nested sections/,
  );
});
