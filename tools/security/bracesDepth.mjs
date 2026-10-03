import assert from "node:assert/strict";

function nestedAst(depth) {
  let node = { type: "text", value: "x" };
  for (let index = 0; index < depth; index++) node = { type: "paren", nodes: [node] };
  return { type: "root", nodes: [node] };
}

export function verifyBracesApi(braces) {
  assert.equal(typeof braces, "function");
  for (const method of ["create", "parse", "compile", "expand", "stringify"]) {
    assert.equal(typeof braces[method], "function", `missing public ${method} API`);
  }

  assert.deepEqual(braces("a/{b,c}/d"), ["a/(b|c)/d"]);
  assert.deepEqual(braces.expand("a/{b,c}/d"), ["a/b/d", "a/c/d"]);
  assert.deepEqual(braces.expand("x{1..3}"), ["x1", "x2", "x3"]);
  assert.equal(braces.compile("a/{b,c}/d"), "a/(b|c)/d");
  assert.equal(braces.stringify(braces.parse("a/{b,c}/d")), "a/{b,c}/d");
  assert.deepEqual(braces.expand("a/{b,c}/d", { nodupes: true }), ["a/b/d", "a/c/d"]);
  assert.deepEqual(braces.expand("{a,a,b}", { nodupes: true }), ["a", "b"]);

  const attacks = [
    "{".repeat(3500) + "a,b" + "}".repeat(3500),
    "(".repeat(3500) + "x" + ")".repeat(3500),
    "(".repeat(60) + "{".repeat(60) + "a,b" + "}".repeat(60) + ")".repeat(60),
  ];
  const rejectInput = (error) => error instanceof SyntaxError && /Input depth .*exceeds max depth/.test(error.message);
  const rejectAst = (error) => error instanceof RangeError && /AST depth .*exceeds max depth/.test(error.message);
  for (const input of attacks) {
    assert(input.length < 10_000, "the exploit must be below the existing character cap");
    for (const options of [{}, { maxDepth: 100_000 }, { maxDepth: Infinity }, { maxDepth: NaN }]) {
      assert.throws(() => braces(input, options), rejectInput);
      assert.throws(() => braces.create(input, options), rejectInput);
      for (const method of ["parse", "compile", "expand", "stringify"]) {
        assert.throws(() => braces[method](input, options), rejectInput, `${method} accepted deep input`);
      }
    }
  }

  const permitted = "{".repeat(100) + "x" + "}".repeat(100);
  for (const method of ["parse", "compile", "expand", "stringify"]) {
    assert.doesNotThrow(() => braces[method](permitted), `${method} rejected the safe boundary`);
    assert.throws(() => braces[method]("{" + permitted + "}"), rejectInput, `${method} accepted depth 101`);
    assert.doesNotThrow(() => braces[method]("{a,b}", { maxDepth: 1.5 }));
    assert.throws(() => braces[method]("{{a,b},c}", { maxDepth: 1.5 }), rejectInput);
    assert.throws(() => braces[method]("(a)", { maxDepth: 0 }), rejectInput);
    assert.throws(() => braces[method]("{a,b}", { maxDepth: -1 }), rejectInput);
  }
  for (const method of ["compile", "expand", "stringify"]) {
    assert.doesNotThrow(() => braces[method](nestedAst(100)));
    assert.throws(() => braces[method](nestedAst(101)), rejectAst, `${method} accepted a deep supplied AST`);
    assert.throws(() => braces[method](nestedAst(3500), { maxDepth: 100_000 }), rejectAst);
    assert.throws(() => braces[method](nestedAst(2), { maxDepth: 1.5 }), rejectAst);
    const cycle = { type: "root", nodes: [] };
    cycle.nodes.push(cycle);
    assert.throws(() => braces[method](cycle), rejectAst, `${method} accepted a cyclic supplied AST`);
  }

  const escaped = "\\{".repeat(120) + "x" + "\\}".repeat(120);
  const quoted = '"' + "{".repeat(120) + "x" + "}".repeat(120) + '"';
  for (const method of ["parse", "compile", "expand", "stringify"]) {
    assert.doesNotThrow(() => braces[method](escaped));
    assert.doesNotThrow(() => braces[method](quoted));
    assert.doesNotThrow(() => braces[method]("foo{bar"));
    assert.doesNotThrow(() => braces[method]("foo(bar"));
  }
  assert.throws(() => braces.expand("{1..1001}"), /range limit/);
}
