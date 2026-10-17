import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { buildLinearSourceDocument, compileSceneDocument } from "../../src/index";
import { readLinearSourceSystemLabels, validateLinearSourceBinding } from "../../src/compile/linearRegionSource";
import { readLinearSourceReferencePoints } from "../../src/compile/linearSourcePoints";

import { unprovedSetSymbolCases, setSymbolCandidate } from "./fixtures/linear-unproved-set-symbols";

const preflightResource = process.argv.some(argument => argument.endsWith("preflight-resource-child"));
const resourceMode = preflightResource || process.argv.includes("--resource-child") || process.argv.includes("--compiled-resource-child");
function runOwnedResourceChild(mode: string): void {
  const child = spawnSync(process.execPath, [...process.execArgv, import.meta.filename, mode], { timeout: 15000, encoding: "utf8", maxBuffer: 1024 * 1024 });
  assert.equal(child.error, undefined, `Owned resource child must complete: ${child.error}`);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  process.stdout.write(child.stdout);
}
if (process.argv.includes("--preflight-resource")) runOwnedResourceChild("--compiled-preflight-resource-child");
else if (process.argv.includes("--full-render-resource")) runOwnedResourceChild("--compiled-resource-child");
else if (resourceMode) {
  const engine = process.argv.some(argument => argument.startsWith("--compiled-")) ? await import("@heytutor/scene-engine") : { buildLinearSourceDocument, compileSceneDocument };
  const inputs = {
    number_line_set: { variable: "x", expression: { inequality: "x<4" } },
    linear_half_plane: { variables: ["x", "y"], inequality: "x+y<4" },
    linear_feasible_region: { variables: ["x", "y"], constraints: ["x>=0", "y>=0", "x+y<4"] },
    linear_system: { variables: ["x", "y"], equations: ["x+y=6", "x-y=2"] },
  };
  const warm = setSymbolCandidate("Graph x<4 on a number line.", "number_line_set");
  engine.buildLinearSourceDocument(warm.source.question!);
  const warmQuestions: Record<keyof typeof inputs, string> = {
    number_line_set: "Graph x<4 on a number line.", linear_half_plane: "Shade x+y<4.",
    linear_feasible_region: "Draw the feasible region x>=0, y>=0, x+y<4.", linear_system: "Graph x+y=6 and x-y=2.",
  };
  for (const [operator, input] of Object.entries(inputs)) {
    const doc = structuredClone(warm); doc.source.question = warmQuestions[operator as keyof typeof inputs];
    doc.constructions[0]!.operator = operator; doc.constructions[0]!.inputs = input;
    if (preflightResource) doc.visualDecision = { mode: "text_only", reason: "Warm the source preflight without rendering." };
    for (let count = 0; count < 3; count++) engine.compileSceneDocument(doc);
  }
  const timings: Array<{ shape: string; length: number; path: string; ms: number; cpuMs: number }> = [];
  for (const length of [1999, 2000, 2001, 8000, 10000]) {
    const boundedQuestion = "Graph x<4 on a number line.".padEnd(length, " ");
    assert.equal(engine.buildLinearSourceDocument(boundedQuestion) === null, length > 2000, "The native reader guard is exactly2000 characters");
    const boundedDoc = setSymbolCandidate(boundedQuestion, "number_line_set"); boundedDoc.constructions[0]!.inputs = inputs.number_line_set;
    assert.equal(validateLinearSourceBinding(boundedDoc).some(issue => issue.code === "linear_source_mismatch"), length > 2000, "The binding independently enforces the same input guard");
    const prefix = "Solve 2x - 3 < 5 where ", suffix = " is real, and show it on a number line.";
    const pumps = {
      punctuation: ";".repeat(length - 1) + "\u0001",
      subjects: (prefix + "x,".repeat(Math.ceil(length / 2))).slice(0, length - suffix.length) + suffix,
      newlines: "Graph x<4 on a number line. \\mathbb{".padEnd(length - 4, "\n") + "end.",
      spaces: "Graph x<4 on a number line. \\mathbb{".padEnd(length - 4, " ") + "end.",
      roleQ: "Q:".repeat(length).slice(0, length),
      roleN: "N:".repeat(length).slice(0, length),
      roleQAssignment: "Q:x=1;".repeat(length).slice(0, length),
      roleQNewlines: "Q:\n".repeat(length).slice(0, length),
      roleNNewlines: "N:\n".repeat(length).slice(0, length),
      roleSixteenWithOtherNames: ("Q:".repeat(16) + "A:".repeat(length)).slice(0, length),
      roleSixteenPadded: "Q:".repeat(16).padEnd(length, ";"),
      roleSixteenArithmetic: ("Q:".repeat(16) + "x+".repeat(length)).slice(0, length - 1) + "x",
      roleSixteenWords: ("Q:".repeat(16) + "unrelated ".repeat(length)).slice(0, length),
      roleSixteenLongEquation: ("Q:".repeat(16) + "x=").padEnd(length, "1"),
      roleOnePadded: "Q:".padEnd(length, " "),
    };
    for (const [shape, question] of Object.entries(pumps)) {
      assert.equal(question.length, length);
      const measure = (path: string, action: () => unknown): unknown => {
        const start = performance.now(), cpuStart = process.cpuUsage();
        let result: unknown;
        try { result = action(); } catch (error) { result = error; }
        const ms = performance.now() - start, cpu = process.cpuUsage(cpuStart), cpuMs = (cpu.user + cpu.system) / 1000;
        timings.push({ shape, length, path, ms, cpuMs });
        assert(cpuMs < 100, `${shape}/${length}/${path}: ${cpuMs.toFixed(2)}msCPU exceeds100ms`);
        return result;
      };
      measure("reader", () => engine.buildLinearSourceDocument(question));
      const points = measure("points", () => readLinearSourceReferencePoints(question, ["x", "y"]));
      const labels = measure("system-labels", () => readLinearSourceSystemLabels(question, { kind: "linear_system", variables: ["x", "y"], equations: ["x+y=6", "x-y=2"] }));
      if (length > 2000) assert(points instanceof Error && labels instanceof Error, "Both exported source-name readers enforce their own input guards");
      for (const [operator, input] of Object.entries(inputs)) {
        const doc = setSymbolCandidate(question, "number_line_set"); doc.constructions[0]!.operator = operator; doc.constructions[0]!.inputs = input;
        if (preflightResource) doc.visualDecision = { mode: "text_only", reason: "Measure the compiler's source preflight independently of unrelated label search." };
        const before = structuredClone(doc);
        const binding = measure(`binding/${operator}`, () => validateLinearSourceBinding(doc));
        const compiled = measure(`${preflightResource ? "compile-source-preflight" : "compile"}/${operator}`, () => engine.compileSceneDocument(doc));
        if (length > 2000) {
          assert(Array.isArray(binding) && binding.some(issue => issue.code === "linear_source_mismatch"), "All four native binding paths independently enforce the guard");
          assert(compiled && typeof compiled === "object" && "ok" in compiled && !compiled.ok && "renderScene" in compiled && compiled.renderScene === null, "An over-budget linear document never reaches layout");
        }
        assert.deepEqual(doc, before);
      }
    }
  }
  console.log(JSON.stringify({ resourceMode: process.argv.at(-1), calls: timings.length, maxMs: Math.max(...timings.map(row => row.ms)), maxCpuMs: Math.max(...timings.map(row => row.cpuMs)), timings }));
} else if (process.argv.includes("--print-fixtures")) {
  console.log(JSON.stringify(unprovedSetSymbolCases));
} else {
  const failures: string[] = [];
  for (const row of unprovedSetSymbolCases) {
    const document = setSymbolCandidate(row.question, row.shape), before = structuredClone(document);
    try {
      assert.equal(buildLinearSourceDocument(row.question), null);
      assert(validateLinearSourceBinding(document).some(issue => issue.code === "linear_source_mismatch"), "independent binding must reject the unproved set symbol");
      const result = compileSceneDocument(document);
      assert(!result.ok && result.renderScene === null, "the actual compiler must refuse atomically");
      assert.deepEqual(document, before);
    } catch (error) { failures.push(`${row.id}: ${row.question}: ${String(error)}`); }
  }
  assert(unprovedSetSymbolCases.length >= 200);
  let controls = 0;
  for (const letter of ["N", "W", "Z", "I", "Q", "N_0", "N_k", "Q1"]) for (const question of [
    `Maximize ${letter}=x+y subject to x>=0,y>=0,x+y<=4. Draw the feasible region.`,
    `Shade x+y<4. Mark ${letter}=(1,1).`,
    `Graph ${letter}: x+y=4 and x-y=2.`,
    `Let ${letter}=[0,5]. Draw ${letter} on a number line.`,
    `The lines x+y=6 and x-y=2 meet at ${letter}. Graph both lines and label ${letter}.`,
  ]) {
    controls++;
    try { const doc = buildLinearSourceDocument(question); assert(doc && compileSceneDocument(doc).ok, `Proved alternate role must draw: ${question}`); }
    catch (error) { failures.push(String(error)); }
  }
  for (const prefix of ["Q1:", "Question 1a:"]) {
    const question = `${prefix} Graph x<4 on a number line.`;
    const doc = buildLinearSourceDocument(question);
    assert(doc && compileSceneDocument(doc).ok, "An original question ordinal is a proved presentation role"); controls++;
  }
  if (!process.argv.includes("--semantic-only") && !process.argv.includes("--semantics-only")) runOwnedResourceChild("--compiled-preflight-resource-child");
  console.log(`Unproved set symbols: ${unprovedSetSymbolCases.length} negative questions; ${controls} proved alternate-role controls; ${failures.length} failures; paid calls 0`);
  assert.equal(failures.length, 0, failures.join("\n"));
}
