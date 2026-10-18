import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { buildLinearSourceDocument, compileSceneDocument } from "../../src/index";
import { validateLinearSourceBinding } from "../../src/compile/linearRegionSource";
import { incompleteConstraintCases, incompleteConstraintCandidate, uncertaintyControls, unprovedSignCases, unprovedMathTailCases, unprovedScopeCases, incompleteSourcePreservationCases, incompleteSourcePreservationCandidate } from "./fixtures/linear-incomplete-source-constraints";
if (process.argv.includes("--preflight-resource")) {
  const child = spawnSync(process.execPath, [...process.execArgv, import.meta.filename, "--preflight-resource-child"], { timeout: 20000, encoding: "utf8", maxBuffer: 1024 * 1024 });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  process.stdout.write(child.stdout);
} else if (process.argv.includes("--preflight-resource-child")) {
  const native = await import("@heytutor/scene-engine");
  const inputs = {
    number_line_set: { variable: "x", expression: { inequality: "x<4" } },
    linear_half_plane: { variables: ["x", "y"], inequality: "x+y<4" },
    linear_feasible_region: { variables: ["x", "y"], constraints: ["x>=0", "y>=0", "x+y<4"] },
    linear_system: { variables: ["x", "y"], equations: ["x+y=6", "x-y=2"] },
  };
  const seed = { id: "resource", question: "Graph x<4 on a number line. Explain patiently.", planar: false, source: ["x<4"] };
  for (let count = 0; count < 3; count++) {
    native.buildLinearSourceDocument(seed.question);
    const document = incompleteConstraintCandidate(seed);
    document.visualDecision = { mode: "text_only", reason: "Warm source preflight without layout." };
    native.compileSceneDocument(document); validateLinearSourceBinding(document);
  }
  const timings: Array<{ shape: string; length: number; path: string; cpuMs: number }> = [];
  for (const length of [1999, 2000, 2001, 8000]) {
    const prefix = "Graph x<4 on a number line. Explain patiently; ";
    const pumps = {
      nativeComparisons: (prefix + "x<4; ".repeat(Math.floor((length - prefix.length) / "x<4; ".length))).padEnd(length, " "),
      nativeComparisonNewlines: (prefix + "x<4;\n".repeat(Math.floor((length - prefix.length) / "x<4;\n".length))).padEnd(length, " "),
      nativeBareReferences: (prefix + "x and ".repeat(length)).slice(0, length),
      coefficientProperties: (prefix + "The coefficients of x are positive; ".repeat(length)).slice(0, length),
      longUnknownProse: (prefix + "A".repeat(length)).slice(0, length),
      scalarNameRoles: "Maximize Z=x+y subject to x>=0,y>=0,x+y<4. Explain patiently.".padEnd(length, " "),
    };
    for (const [shape, question] of Object.entries(pumps)) {
      assert.equal(question.length, length);
      const measure = (path: string, action: () => unknown): void => {
        const start = process.cpuUsage(); action(); const cpu = process.cpuUsage(start), cpuMs = (cpu.user + cpu.system) / 1000;
        timings.push({ shape, length, path, cpuMs });
        assert(cpuMs < 100, `${shape}/${length}/${path}: ${cpuMs.toFixed(2)}ms CPU exceeds100ms`);
      };
      measure("source-reader", () => buildLinearSourceDocument(question));
      measure("packaged-reader", () => native.buildLinearSourceDocument(question));
      for (const [operator, input] of Object.entries(inputs)) {
        const document = incompleteConstraintCandidate({ ...seed, question });
        document.constructions[0]!.operator = operator; document.constructions[0]!.inputs = input;
        document.visualDecision = { mode: "text_only", reason: "Measure actual compiler source preflight, not label/layout cost." };
        measure(`source-binding/${operator}`, () => validateLinearSourceBinding(document));
        measure(`packaged-compile-source-preflight/${operator}`, () => native.compileSceneDocument(document));
      }
    }
  }
  console.log(JSON.stringify({ calls: timings.length, maxCpuMs: Math.max(...timings.map(row => row.cpuMs)), timings }));
} else {
let checks = 0;
const failures: string[] = [];
function check(id: string, action: () => void): void { checks++; try { action(); } catch (error) { failures.push(`${id}: ${String(error)}`); } }
for (const row of incompleteConstraintCases) {
  check(`${row.id}/omitted`, () => {
    assert.equal(buildLinearSourceDocument(row.question), null, "this regression exercises the incomplete-reader path");
    const candidate = incompleteConstraintCandidate(row), snapshot = structuredClone(candidate);
    assert(validateLinearSourceBinding(candidate).some(issue => issue.code === "linear_source_mismatch"), "a planner cannot omit independently stated source predicates");
    assert(!compileSceneDocument(candidate).ok, "actual compiler must refuse the incomplete figure");
    assert.deepEqual(candidate, snapshot);
  });
  check(`${row.id}/complete`, () => {
    const candidate = incompleteConstraintCandidate(row, true);
    if (/\b(?:positive|negative|non[- ]?positive|non[- ]?negative)\b/i.test(row.question) && !row.completeHasIsolatedPostfix) {
      assert(validateLinearSourceBinding(candidate).some(issue => issue.code === "linear_source_mismatch"), "unknown sign scope must decline conservatively even when proposed constraints could be right");
    } else {
      assert.deepEqual(validateLinearSourceBinding(candidate), [], "all exact source comparisons are owned without granting full request authority");
      assert(compileSceneDocument(candidate).ok);
    }
  });
}
for (const row of [...unprovedSignCases, ...unprovedMathTailCases, ...unprovedScopeCases]) check(row.id, () => {
  assert.equal(buildLinearSourceDocument(row.question), null);
  const candidate = incompleteConstraintCandidate(row);
  assert(validateLinearSourceBinding(candidate).some(issue => issue.code === "linear_source_mismatch"), "an unproved sign property may not disappear with unknown prose");
  assert(!compileSceneDocument(candidate).ok);
});
for (const id of ["opposite-same-boundary", "strict-same-boundary"]) check(`${id}/only-one-domain-leaf`, () => {
  const row = incompleteConstraintCases.find(item => item.id === id)!;
  const candidate = incompleteConstraintCandidate({ ...row, source: row.source.slice(0, 2) }, true);
  assert(validateLinearSourceBinding(candidate).some(issue => issue.code === "linear_source_mismatch"), "one exact/complement leaf cannot stand for two different predicates on the same boundary");
});
check("multiple-components-collectively-own-source", () => {
  const row = incompleteConstraintCases.find(item => item.id === "review-5")!;
  const candidate = incompleteConstraintCandidate(row), other = incompleteConstraintCandidate({ ...row, source: ["x>0"] });
  other.entities[0]!.id = "domain";
  other.constructions[0]!.id = "construct_domain";
  other.constructions[0]!.outputs = ["domain"];
  candidate.entities.push(...other.entities);
  candidate.constructions.push(...other.constructions);
  candidate.requiredEntityIds.push("domain");
  candidate.revealGroups[0]!.entityIds.push("domain");
  assert.deepEqual(validateLinearSourceBinding(candidate), [], "inventory ownership is checked across the actual complete native document");
  // The source-binding seam admits collective ownership; the independent
  // composite-layout contract may still reject multiple number-line canvases.
});
for (const row of uncertaintyControls) check(row.id, () => {
  assert.equal(buildLinearSourceDocument(row.question), null);
  assert.deepEqual(validateLinearSourceBinding(incompleteConstraintCandidate(row)), []);
  assert(compileSceneDocument(incompleteConstraintCandidate(row)).ok, "unknown prose alone still cannot veto a complete planner");
});
for (const row of incompleteSourcePreservationCases) check(row.id, () => {
  const candidate = incompleteSourcePreservationCandidate(row), before = structuredClone(candidate);
  const input = structuredClone(candidate);
  const issues = validateLinearSourceBinding(candidate), compiled = compileSceneDocument(candidate);
  if (row.refuse) {
    assert(issues.some(issue => issue.code === "linear_source_mismatch"), "unproved or incomplete mathematical roles remain restrictive");
    assert(!compiled.ok && compiled.renderScene === null, "a role proof cannot authorize an incomplete program");
  } else {
    assert.deepEqual(issues, [], `the complete supplied program owns every proved source role: ${row.question}`);
    assert(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
  }
  assert.deepEqual(candidate, input, "source binding cannot change the candidate");
  assert.deepEqual(candidate.source, before.source, "source provenance remains the actual original question");
});
console.log(`Incomplete source constraint binding: ${checks - failures.length}/${checks}`);
assert.equal(failures.length, 0, failures.join("\n"));
}
