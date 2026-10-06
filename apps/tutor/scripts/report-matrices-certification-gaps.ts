// Report (not a gate): current behaviour of every FULLY-CERTIFIED obligation of
// maths|3|matrices-and-types. Prints one markdown row per item.
//
//   cd apps/tutor && npx tsx scripts/report-matrices-certification-gaps.ts
//
// Expected values are typed by hand. "pass" means the live fallback path draws
// exactly the expected table (or declines when a decline is required) and the
// stored contract case keeps its recorded verdict. "decline" means nothing is
// drawn where a figure is owed. "wrong" means a drawn value or verdict is false.
import { readFileSync } from "node:fs";
import { compileSceneDocument, hasMatrixSourceProgram, validateMatrixSourceBinding, type RenderPrimitive, type SceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { evaluateMatrixArrayConstruction } from "../../../packages/scene-engine/src/compile/matrixArrayGeometry";
import { selectVerifiedRepresentation } from "../features/tutor-session/lib/scene/representationFallback";

const CONTRACT = "../../docs/agent/coverage-handoff-20261003/artifacts/HEY-84/matrix-topic-sprint-20261003/matrix-topic-contract-source06.json";
const PROFILE = "../../docs/agent/coverage-handoff-20261003/artifacts/HEY-84/matrix-topic-sprint-20261003/source-profile-frozen-v3.json";

type Grid = string[][];
const rows: string[] = [];
const row = (item: string, verdict: string, detail: string) => rows.push(`| ${item} | ${verdict} | ${detail.replace(/\|/g, "/")} |`);

function plan(question: string): TurnPlanV3 {
  return { schemaVersion: "turn-plan/v3", question, givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required" };
}
function tables(primitives: RenderPrimitive[]): Map<string, Grid> {
  const out = new Map<string, Grid>();
  const by = new Map<string, RenderPrimitive[]>();
  for (const p of primitives) if (p.kind === "label" && p.provenance?.matrixCell) by.set(p.entityId, [...(by.get(p.entityId) ?? []), p]);
  for (const [id, cells] of by) {
    const ys = [...new Set(cells.map((c) => Math.round(c.points[0]!.y)))].sort((a, b) => a - b);
    const xs = [...new Set(cells.map((c) => Math.round(c.points[0]!.x)))].sort((a, b) => a - b);
    const grid: Grid = ys.map(() => xs.map(() => "?"));
    for (const c of cells) grid[ys.indexOf(Math.round(c.points[0]!.y))]![xs.indexOf(Math.round(c.points[0]!.x))] = c.text ?? "";
    out.set(id, grid);
  }
  return out;
}
function types(entries: unknown[][]): string[] {
  return evaluateMatrixArrayConstruction("matrix_array", { entries, origin: [0, 0], displayScale: 1 }, { scalar: () => undefined, geometry: () => undefined })[0]!.matrixArray.types;
}
function draw(question: string) {
  const selected = selectVerifiedRepresentation({ question, turnPlan: plan(question), families: [], exact: null });
  const matrices = selected.sceneDocument.entities.filter((e) => e.kind === "matrix_array");
  return { selected, matrices, tables: tables(selected.renderScene.primitives) };
}
function expectTable(item: string, question: string, expected: Record<string, Grid>, expectedTypes?: Record<string, string[]>): void {
  const { selected, matrices, tables: board } = draw(question);
  if (matrices.length === 0) { row(item, "decline", `nothing drawn for: ${question}`); return; }
  const problems: string[] = [];
  for (const [label, grid] of Object.entries(expected)) {
    const entity = selected.sceneDocument.entities.find((e) => e.label === label)?.id;
    if (!entity) problems.push(`no ${label}`);
    else if (JSON.stringify(board.get(entity)) !== JSON.stringify(grid)) problems.push(`${label} drew ${JSON.stringify(board.get(entity))}`);
  }
  for (const [label, want] of Object.entries(expectedTypes ?? {})) {
    const construction = selected.sceneDocument.constructions.find((c) => c.outputs[0] === label);
    const got = types(construction!.inputs.entries as unknown[][]);
    if (JSON.stringify(got) !== JSON.stringify(want)) problems.push(`${label} types ${JSON.stringify(got)}`);
  }
  row(item, problems.length ? "WRONG" : "pass", problems.length ? problems.join("; ") : `${selected.tier}; ${matrices.length} table(s) as expected`);
}
function expectDecline(item: string, question: string): void {
  const { matrices } = draw(question);
  row(item, matrices.length === 0 ? "pass" : "WRONG", matrices.length === 0 ? `declines: ${question}` : `drew ${matrices.length} table(s) for a source that must decline`);
}

// 1. The 17 required variants of the frozen profile v3.
const profile = JSON.parse(readFileSync(PROFILE, "utf8")) as { requiredVariants: Record<string, string[]> };
const required = profile.requiredVariants["maths|3|matrices-and-types"]!;
if (required.length !== 17) throw new Error(`profile lists ${required.length} variants, expected 17`);
expectTable("rectangular", "Let A=[[1,2,3],[4,5,6]]. Show A and state its type.", { A: [["1", "2", "3"], ["4", "5", "6"]] }, { A: ["rectangular"] });
expectTable("square", "Let A=[[1,2],[3,4]]. Show A and state its type.", { A: [["1", "2"], ["3", "4"]] }, { A: ["square"] });
expectTable("row", "Let A=[[1,2,3]]. Show A and state its type.", { A: [["1", "2", "3"]] }, { A: ["rectangular", "row"] });
expectTable("column", "Let A=[[1],[2],[3]]. Show A and state its type.", { A: [["1"], ["2"], ["3"]] }, { A: ["rectangular", "column"] });
expectTable("zero (rectangular)", "Let A=[[0,0,0],[0,0,0]]. Show A and state its type.", { A: [["0", "0", "0"], ["0", "0", "0"]] }, { A: ["rectangular", "zero"] });
expectTable("zero (square)", "Let A=[[0,0],[0,0]]. Show A and state its type.", { A: [["0", "0"], ["0", "0"]] }, { A: ["square", "zero", "diagonal", "symmetric", "skew_symmetric", "scalar", "upper_triangular", "lower_triangular"] });
expectTable("identity", "Let A=[[1,0,0],[0,1,0],[0,0,1]]. Show A and state its type.", { A: [["1", "0", "0"], ["0", "1", "0"], ["0", "0", "1"]] }, { A: ["square", "identity", "diagonal", "symmetric", "scalar", "upper_triangular", "lower_triangular"] });
expectTable("diagonal", "Let A=[[2,0,0],[0,3,0],[0,0,4]]. Show A and state its type.", { A: [["2", "0", "0"], ["0", "3", "0"], ["0", "0", "4"]] }, { A: ["square", "diagonal", "symmetric", "upper_triangular", "lower_triangular"] });
expectTable("explicit-source-shape-cells", "Let A=[[1,2,3],[4,5,6]]. A has 2 rows and 3 columns. Show A.", { A: [["1", "2", "3"], ["4", "5", "6"]] });
expectTable("real-entry-baseline", "Let A=[[-1.5,0.25],[3,-0.04]]. Show A.", { A: [["-1.5", "0.25"], ["3", "-0.04"]] }, { A: ["square"] });
expectTable("1x1-multi-type", "Let A=[[5]]. Show A and state its type.", { A: [["5"]] }, { A: ["square", "row", "column", "diagonal", "symmetric", "scalar", "upper_triangular", "lower_triangular"] });
expectDecline("mislabeled-diagonal-negative", "The diagonal matrix A=[[1,2],[3,4]]. Show A.");
expectDecline("rectangular-inverse-negative", "Let A=[[1,2,0],[3,4,0]]. Find the inverse of A.");
{
  const question = "Let A=[[0.1,0.2],[-0.3,1.234567890123456789]]. Show A.";
  const { selected, matrices, tables: board } = draw(question);
  type Cell = { row: number; column: number; exactValue: { numerator: string; denominator: string }; displayAccuracy: string };
  const cell = (p: RenderPrimitive) => p.provenance?.matrixCell as Cell | undefined;
  const long = selected.renderScene.primitives.find((p) => cell(p)?.row === 1 && cell(p)?.column === 1);
  const exact = long ? cell(long)?.exactValue : undefined;
  const ok = matrices.length === 1 && JSON.stringify(board.get("A")) === JSON.stringify([["0.1", "0.2"], ["-0.3", "≈1.23457e0"]]) && exact?.numerator === "1234567890123456789" && exact.denominator === "1000000000000000000" && (long ? cell(long)?.displayAccuracy : undefined) === "rounded";
  row("exact-long-precision-cells", ok ? "pass" : "WRONG", ok ? "exact 1234567890123456789/10^18 kept; label ≈1.23457e0 marked rounded" : `drew ${JSON.stringify(board.get("A"))} exact ${JSON.stringify(exact)}`);
}
expectTable("same-value-coordinate-reference-ownership", "Let A=[[0,0],[0,0]]. Let B=[[0,0],[0,0]]. Show A and B.", { A: [["0", "0"], ["0", "0"]], B: [["0", "0"], ["0", "0"]] });
row("source-wrapper-and-reference-positive", "pass (planner path)", "wrapper/reference cells are planner-candidate forms; covered by `npx tsx packages/scene-engine/scripts/verify/verify-matrix-source-binding-hey88.ts` ('literal/reference nested wrappers retain source decimal authority'); the engine fallback always uses literals");

// 2. Native sentinels: the full stems are kept verbatim from the frozen profile.
const fullProfile = JSON.parse(readFileSync(PROFILE, "utf8")) as { nativeCases: Array<{ id: string; full_source_record: { text: string } }> };
for (const native of fullProfile.nativeCases.filter((n) => ["q_5bd968dfa0c26f4c016df0dce297d1360bdb665ef7ea10873fe4103c560e8193", "q_99f68263f5889d70b6e5d44b685f6af2f2d21b59a5e5f9db0f0599bb562883a6"].includes(n.id))) {
  const question = native.full_source_record.text;
  const admitted = hasMatrixSourceProgram(question);
  const { selected, matrices, tables: board } = draw(question);
  const label = native.id.startsWith("q_5bd") ? "native-indexed-given (2023 P2 q5, M)" : "native-multiline-given (q_99f68, M=[[2,-1],[1,0]])";
  if (native.id.startsWith("q_5bd")) {
    const want = [["1", "1", "1"], ["1", "0", "1"], ["0", "1", "0"]];
    const verdict = matrices.length === 0 ? "decline" : JSON.stringify(board.get(matrices[0]!.id)) === JSON.stringify(want) && selected.tier === "question_representation" ? "pass" : "WRONG";
    row(label, verdict, `source admitted=${admitted}; fallback ${matrices.length ? `drew ${JSON.stringify(board.get(matrices[0]!.id))} tier ${selected.tier}` : "draws nothing"}; planner-candidate component path: see contract case native-indexed-question-representation below`);
  } else {
    row(label, matrices.length === 0 ? "decline" : "WRONG", `source admitted=${admitted}; multiline OCR bracket layout is not a supported literal; ${matrices.length ? "drew something" : "draws nothing"}`);
  }
}

// 3. Precision, dense 6x6, 1x1 overlap and capacity residuals.
{
  const long = "1.234567890123456789";
  const dense = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => long));
  const question = `Let A=${JSON.stringify(dense).replace(/"/g, "")}. Show A.`;
  const { selected, tables: board } = draw(question);
  const grid = board.get("A");
  const inZone = selected.renderScene.primitives.every((p) => p.points.every((pt) => pt.x >= 400 && pt.x <= 1160 && pt.y >= 0 && pt.y <= 700));
  const ok = grid?.length === 6 && grid.every((r) => r.length === 6 && r.every((c) => c === "≈1.23457e0")) && inZone;
  row("dense-six-by-six-repeated-precision", ok ? "pass" : "WRONG", ok ? "36 cells, each ≈1.23457e0 marked rounded, inside x 400..1160" : `drew ${JSON.stringify(grid)} inZone=${inZone}`);
}
expectTable("approximation-rollover", "Let A=[[999999.999999999999,0.000000999999999999999999]]. Show A.", { A: [["≈1e6", "≈1e-6"]] });
expectTable("1x1 overlap [1]", "Let A=[[1]]. Show A and state its type.", { A: [["1"]] }, { A: ["square", "row", "column", "identity", "diagonal", "symmetric", "scalar", "upper_triangular", "lower_triangular"] });
expectTable("1x1 overlap [0]", "Let A=[[0]]. Show A and state its type.", { A: [["0"]] }, { A: ["square", "row", "column", "zero", "diagonal", "symmetric", "skew_symmetric", "scalar", "upper_triangular", "lower_triangular"] });
expectDecline("rectangular inverse (2x3)", "Let A=[[1,2,3],[4,5,6]]. Find the inverse of A.");
expectDecline("square inverse (no inverse capability)", "Let A=[[1,2],[3,4]]. Find the inverse of A.");
expectDecline("residual: 7-row column (valid source, outside 6x6 kernel)", `Let A=[[1],[2],[3],[4],[5],[6],[7]]. Show A.`);
expectDecline("residual: entry 1000001 (outside 1e6 kernel)", "Let A=[[1000001,0],[0,1]]. Show A.");
expectDecline("residual: nonzero 1e-324 (underflow)", "Let A=[[1e-324,0],[0,1]]. Show A.");
expectTable("residual: rational 1/3 (now exact)", "Let A=[[1/3,0],[0,1]]. Show A.", { A: [["1/3", "0"], ["0", "1"]] }, { A: ["square", "diagonal", "symmetric", "upper_triangular", "lower_triangular"] });
expectDecline("residual: symbolic real x", "Let A=[[x,0],[0,1]]. Show A.");
expectDecline("residual: irrational root 3", "Let A=[[√3,0],[0,1]]. Show A.");

// 4. Every stored contract case that carries a document: recompile it now.
const contract = JSON.parse(readFileSync(CONTRACT, "utf8")) as { cases: Array<{ id: string; topic: string; state: string; document?: SceneDocument; expectedTypes?: Record<string, string[]> }> };
for (const item of contract.cases.filter((c) => c.topic === "maths|3|matrices-and-types" && c.document)) {
  const document = item.document!;
  const compiled = compileSceneDocument(structuredClone(document));
  const fatal = [...compiled.report.issues, ...validateMatrixSourceBinding(document, document.source.question)].filter((i) => i.severity === "fatal").map((i) => i.code);
  const positive = /positive/.test(item.state);
  const notes: string[] = [];
  let verdict = item.state === "open" ? (compiled.ok ? "WRONG" : "open (still refused, as recorded)")
    : positive === (compiled.ok && fatal.length === 0) ? "pass" : positive ? "decline" : "WRONG";
  for (const [id, frozen] of Object.entries(item.expectedTypes ?? {})) {
    const construction = document.constructions.find((c) => c.outputs[0] === id);
    if (!construction || construction.operator !== "matrix_array") continue;
    const quantity = (ref: string) => { const q = document.quantities.find((candidate) => candidate.id === ref); return q ? { value: q.value, unit: q.unit } : undefined; };
    const now = evaluateMatrixArrayConstruction("matrix_array", { entries: construction.inputs.entries, origin: [0, 0], displayScale: 1 }, { scalar: quantity, geometry: () => undefined })[0]!.matrixArray.types;
    if (JSON.stringify(now.slice(0, frozen.length)) !== JSON.stringify(frozen)) { verdict = "WRONG"; notes.push(`${id} types ${JSON.stringify(now)} lost frozen ${JSON.stringify(frozen)}`); }
    else if (now.length > frozen.length) notes.push(`${id} adds ${now.slice(frozen.length).join("+")} beyond frozen tuple (true by definition; oracle amendment needed)`);
  }
  row(`contract ${item.id}`, verdict, `${item.state}; compile ${compiled.ok ? "ok" : "refused"}${fatal.length ? ` [${[...new Set(fatal)].join(",")}]` : ""}${notes.length ? "; " + notes.join("; ") : ""}`);
}

console.log("| Item | Verdict | Current behaviour |\n|---|---|---|\n" + rows.join("\n"));
