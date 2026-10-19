import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { buildLinearSourceDocument, compileSceneDocument } from "../../src/index";
import { validateLinearSourceBinding } from "../../src/compile/linearRegionSource";
import { coefficientPropertyCases, domainPropertyCandidate, signDomainCases, unsupportedRationalCases } from "./fixtures/linear-domain-property-roles";

if (process.argv.includes("--resource-child")) {
  const measurements: Array<{ shape: string; path: string; length: number; cpuMs: number }> = [];
  buildLinearSourceDocument("Graph x<4 on a number line.");
  for (const length of [1999, 2000, 2001, 8000]) for (const [shape, pump] of Object.entries({
    prefixType: "rational x and ", coefficientSubject: "coefficients of u and x are positive; ",
    coefficientNewlines: "coefficients of u and x are positive\n", boundedSubject: "rational u, v, w, a, b, c, d, e, x; ",
    rationalProperties: "coefficients of x are rational; ", rationalPropertyNewlines: "coefficients for x are rational\n",
    rationalJointSubject: "x and coefficients of u are rational; ", rationalQualification: "x must be rational; ",
    longPrefix: "A".repeat(1500) + ": are rational;".repeat(100),
    longPrefixSixteen: ("A".repeat(1500) + ": are rational;".repeat(16)).padEnd(length, " "),
    longPrefixIrrational: ("a".repeat(1500) + ": is irrational;\n".repeat(16)).padEnd(length, " "),
  })) {
    const question = pump.repeat(Math.ceil(length / pump.length)).slice(0, length);
    for (const [path, action] of Object.entries({ reader: () => buildLinearSourceDocument(question),
      binding: () => validateLinearSourceBinding(domainPropertyCandidate({ id: "resource", question, shape: "number_line_set" })),
    })) {
      const start = process.cpuUsage(); action(); const cpu = process.cpuUsage(start), cpuMs = (cpu.user + cpu.system) / 1000;
      measurements.push({ shape, path, length, cpuMs });
      assert(cpuMs < 100, `${shape}/${length}/${path}: ${cpuMs}ms CPU`);
    }
  }
  console.log(JSON.stringify({ measurements, maxCpuMs: Math.max(...measurements.map(row => row.cpuMs)) }));
} else {
let checks = 0;
const failures: string[] = [];
function check(id: string, action: () => void): void {
  checks++;
  try { action(); } catch (error) { failures.push(`${id}: ${String(error)}`); }
}
for (const row of unsupportedRationalCases) check(row.id, () => {
  const document = domainPropertyCandidate(row), before = structuredClone(document);
  assert.equal(buildLinearSourceDocument(row.question), null, "restricted variables do not define a continuous figure");
  assert(validateLinearSourceBinding(document).some(issue => issue.code === "linear_source_mismatch"), "independent source-domain proof must refuse continuous candidates");
  const result = compileSceneDocument(document);
  assert(!result.ok && result.renderScene === null, "actual compilation must fail atomically");
  assert.deepEqual(document, before);
});
for (const row of coefficientPropertyCases) check(row.id, () => {
  const document = domainPropertyCandidate(row), before = structuredClone(document);
  assert.deepEqual(validateLinearSourceBinding(document), [], "a coefficient property cannot restrict the source variable");
  const source = buildLinearSourceDocument(row.question);
  if (source) {
    assert(compileSceneDocument(source).ok);
    const changed = structuredClone(document);
    if (row.shape === "number_line_set") changed.constructions[0]!.inputs.expression = { inequality: "x<3" };
    else if (row.shape === "linear_half_plane") changed.constructions[0]!.inputs.inequality = "x+y<3";
    else changed.constructions[0]!.inputs.constraints = ["x>=0", "y>=0", "x+y<=7", "x+2y<=11"];
    assert(validateLinearSourceBinding(changed).some(issue => issue.code === "linear_source_mismatch"), "a complete source proof must retain numerical authority");
  }
  assert(compileSceneDocument(document).ok);
  assert.deepEqual(document, before);
});
for (const row of signDomainCases) check(row.id, () => {
  const correct = domainPropertyCandidate(row, row.inequality), omitted = domainPropertyCandidate(row);
  assert.deepEqual(validateLinearSourceBinding(correct), []);
  assert(compileSceneDocument(correct).ok);
  if (buildLinearSourceDocument(row.question)) {
    assert(validateLinearSourceBinding(omitted).some(issue => issue.code === "linear_source_mismatch"), "a proved actual variable domain must remain in the source program");
    assert(!compileSceneDocument(omitted).ok);
  }
  const plain = { ...row, question: `Graph x<4 and x is ${row.sign} on a number line.` };
  assert(buildLinearSourceDocument(plain.question), "the positive companion is independently supported by the original grammar");
  assert.deepEqual(validateLinearSourceBinding(domainPropertyCandidate(plain, row.inequality)), []);
  assert(validateLinearSourceBinding(domainPropertyCandidate(plain)).some(issue => issue.code === "linear_source_mismatch"), "the supported companion must retain every actual sign constraint");
});
for (const question of [
  "Graph x<4 and the coefficients of x are positive except at the origin on a number line.",
  "Graph x<4 and the coefficients of x are positive only for x>2 on a number line.",
  "Graph x<4 and the coefficients of x are positive under an unfamiliar qualification on a number line.",
]) check(`uncertain-property-${question}`, () => {
  assert.equal(buildLinearSourceDocument(question), null, "a property role proof must not consume an unknown qualification");
});
const resource = spawnSync(process.execPath, [...process.execArgv, import.meta.filename, "--resource-child"], { timeout: 15000, encoding: "utf8" });
assert.equal(resource.error, undefined);
assert.equal(resource.status, 0, resource.stdout + resource.stderr);
process.stdout.write(resource.stdout);
console.log(`Linear domain/property roles: ${checks - failures.length}/${checks}; ${unsupportedRationalCases.length} restricted, ${coefficientPropertyCases.length} coefficient properties, ${signDomainCases.length} sign collisions; paid calls 0`);
for (const failure of failures) console.error(failure);
assert.equal(failures.length, 0, `${failures.length} domain/property failures`);
}
