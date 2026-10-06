// Topic readiness gate for maths|3|matrices-and-types (declared practical scope).
//
// Every expected value below is typed by hand from the definitions, not read
// back from the engine. Each representative case runs the same path a live turn
// takes when no planner candidate survives: source program admission, the
// engine-owned matrix source document, representation selection, canonical
// save, stored source read, restore and replay. Controls prove the honest
// declines: ragged rows, contradicted order, false type premises, out-of-range
// elements, inverse requests, stale plan scalars and swapped operand order.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseStoredSegmentCommands, serializeSegmentCommands, isStoredCommandTrustedGeometry } from "@heytutor/drawing";
import { inferSceneCapabilities } from "@heytutor/tutor-core";
import {
  buildMatrixSourceDocument, compileSceneDocument, displayedSceneQuantityTexts, hasMatrixSourceProgram, pruneUnverifiedSceneAnnotations,
  validateMatrixSourceBinding, validateSceneQuantityAgreement,
  type RenderPrimitive, type SceneDocument, type TurnPlanV3,
} from "@heytutor/scene-engine";
// The evaluator is not part of the package surface; read its type tuple from source.
import { evaluateMatrixArrayConstruction } from "../../../../packages/scene-engine/src/compile/matrixArrayGeometry";
import { normalizeSceneDocumentModelOutput } from "../../../../packages/tutor-core/src/planners/scenePlannerV2";
import { selectVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { sourceCheckedStoredTurn } from "../../lib/scene/storedSceneSource";
import { buildReplayTimeline } from "../../lib/replay/replayTimeline";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import { restoreVerifiedPresentationFromTurn } from "../../features/tutor-session/lib/scene/restoreVerifiedDiagram";

let checks = 0;
const check = (condition: unknown, message: string): void => { checks++; assert.ok(condition, message); };

type Grid = Array<Array<string>>;
interface ReadyCase { id: string; question: string; givens: Array<[string, number]>; tables: Array<{ label: string; cells: Grid }>; types?: Record<string, string[]> }

function plan(question: string, givens: Array<[string, number]>, claims: Array<{ claim: string; expected: boolean }> = []): TurnPlanV3 {
  return {
    schemaVersion: "turn-plan/v3", question,
    givens: givens.map(([id, value]) => ({ id, symbol: id, value, unit: "dimensionless", provenance: "given" as const, sourceText: question })),
    unknowns: [], derived: [], qualitativeClaims: claims as TurnPlanV3["qualitativeClaims"], lawIds: [], assumptions: [], visualRequirement: "required",
  };
}

// Read the board as a student does: group cell labels by entity, then order
// them top to bottom and left to right on the canvas.
function boardTables(primitives: RenderPrimitive[]): Map<string, Grid> {
  const result = new Map<string, Grid>();
  const byEntity = new Map<string, RenderPrimitive[]>();
  for (const primitive of primitives) {
    if (primitive.kind !== "label" || !primitive.provenance?.matrixCell) continue;
    byEntity.set(primitive.entityId, [...(byEntity.get(primitive.entityId) ?? []), primitive]);
  }
  for (const [entity, cells] of byEntity) {
    const ys = [...new Set(cells.map((cell) => Math.round(cell.points[0]!.y)))].sort((a, b) => a - b);
    const xs = [...new Set(cells.map((cell) => Math.round(cell.points[0]!.x)))].sort((a, b) => a - b);
    const grid: Grid = ys.map(() => xs.map(() => "?"));
    for (const cell of cells) grid[ys.indexOf(Math.round(cell.points[0]!.y))]![xs.indexOf(Math.round(cell.points[0]!.x))] = cell.text ?? "";
    result.set(entity, grid);
  }
  return result;
}

function entityByLabel(document: SceneDocument, label: string): string | undefined {
  return document.entities.find((entity) => entity.label === label)?.id;
}

const CASES: ReadyCase[] = [
  {
    // NCERT 3.1 Q1 shape with finite decimals in place of 5/2 and root 3.
    id: "order-and-elements",
    question: "A=[[2,5,19,-7],[35,-2,2.5,12],[1.5,1,-5,17]]. Find the order of A and the elements a13, a21, a33, a24 and a23.",
    givens: [["rowsA", 3], ["colsA", 4], ["a13", 19], ["a21", 35], ["a33", -5], ["a24", 12], ["a23", 2.5]],
    tables: [{ label: "A", cells: [["2", "5", "19", "-7"], ["35", "-2", "2.5", "12"], ["1.5", "1", "-5", "17"]] }],
    types: { A: ["rectangular"] },
  },
  {
    id: "scalar-with-repeated-cells",
    question: "A=[[3,0,0],[0,3,0],[0,0,3]]. Is A a scalar matrix?",
    givens: [["a11", 3], ["a22", 3], ["a33", 3]],
    tables: [{ label: "A", cells: [["3", "0", "0"], ["0", "3", "0"], ["0", "0", "3"]] }],
    types: { A: ["square", "diagonal", "symmetric", "scalar", "upper_triangular", "lower_triangular"] },
  },
  {
    id: "transpose-rectangular",
    question: "A=[[1,-2,3],[4,0.5,6]]. Find the transpose of A.",
    givens: [["rowsA", 2], ["colsA", 3]],
    tables: [
      { label: "A", cells: [["1", "-2", "3"], ["4", "0.5", "6"]] },
      { label: "A^T", cells: [["1", "4"], ["-2", "0.5"], ["3", "6"]] },
    ],
    types: { A: ["rectangular"] },
  },
  {
    id: "product-order",
    question: "A=[[1,2],[3,4]] and B=[[0,1],[1,0]]. Find AB and BA.",
    givens: [["a11", 1], ["a12", 2], ["b21", 1]],
    // AB swaps the columns of A; BA swaps its rows.
    tables: [
      { label: "AB", cells: [["2", "1"], ["4", "3"]] },
      { label: "BA", cells: [["3", "4"], ["1", "2"]] },
    ],
  },
  {
    id: "nested-transpose-and-precision",
    question: "A=[[0.1,0.25],[0.001,123456.75]] and B=[[0.2,0.5],[0.002,0.25]]. Find (A+B)^T.",
    givens: [["a11", 0.1], ["b11", 0.2]],
    tables: [
      { label: "A+B", cells: [["0.3", "0.75"], ["0.003", "123457"]] },
      { label: "(A+B)^T", cells: [["0.3", "0.003"], ["0.75", "123457"]] },
    ],
  },
  // Exact fractions. Hand arithmetic: 1/2+1/3=5/6, -3/4+1=1/4, 2-1/6=11/6;
  // AB row 1 = [1/6-3/2, 1/2+1/8] = [-4/3, 5/8], row 2 = [4, -1/3].
  {
    id: "fraction-sum-product",
    question: "A=[[1/2,-3/4],[0,2]] and B=[[1/3,1],[2,-1/6]]. Find A+B and AB.",
    givens: [["a11", 0.5], ["a12", -0.75], ["b11", 1 / 3], ["b22", -1 / 6]],
    tables: [
      { label: "A", cells: [["1/2", "-3/4"], ["0", "2"]] },
      { label: "B", cells: [["1/3", "1"], ["2", "-1/6"]] },
      { label: "A+B", cells: [["5/6", "1/4"], ["2", "11/6"]] },
      { label: "AB", cells: [["-4/3", "5/8"], ["4", "-1/3"]] },
    ],
    types: { A: ["square", "upper_triangular"] },
  },
  {
    id: "fraction-transpose",
    question: "A=[[1/7,2/7,-3/7],[1,0,5/2]]. Find the transpose of A.",
    givens: [["a11", 1 / 7], ["a23", 2.5]],
    tables: [
      { label: "A", cells: [["1/7", "2/7", "-3/7"], ["1", "0", "5/2"]] },
      { label: "A^T", cells: [["1/7", "1"], ["2/7", "0"], ["-3/7", "5/2"]] },
    ],
  },
  {
    id: "fraction-latex-and-reduction",
    question: "A=\\begin{pmatrix}\\frac{2}{4} & 0 \\\\ 0 & -\\frac{1}{2}\\end{pmatrix}. Is A a scalar matrix?",
    givens: [["a11", 0.5], ["a22", -0.5]],
    tables: [{ label: "A", cells: [["1/2", "0"], ["0", "-1/2"]] }],
    types: { A: ["square", "diagonal", "symmetric", "upper_triangular", "lower_triangular"] },
  },
  {
    id: "fraction-multiplier",
    question: "A=[[1,2],[3,4]], k=1/2. Find kA.",
    givens: [["k", 0.5]],
    tables: [{ label: "kA", cells: [["1/2", "1"], ["3/2", "2"]] }],
  },
];

async function lifecycle(id: string, question: string, turnPlan: TurnPlanV3, selected: ReturnType<typeof selectVerifiedRepresentation>, focus: string): Promise<void> {
  const payload = {
    question, sceneDocument: selected.sceneDocument, visualStatus: "validated" as const,
    sceneArtifacts: { schemaVersion: "scene-artifacts/v3", turnPlan, representationTier: selected.tier, nonMetric: selected.nonMetric, candidates: [], diagramResultStatus: "ready" },
    segments: [
      { orderIndex: 0, narration: "Write the order.", spokenText: "Write the order.", command: { type: "WRITE", params: [90, 145, 28], text: "order 3 x 4", charPosition: 0, narrationBefore: "Write the order." } },
      { orderIndex: 1, narration: "Look at the matrix.", spokenText: "Look at the matrix.", command: { type: "FOCUS", params: [], text: focus, charPosition: 0, narrationBefore: "Look at the matrix." } },
    ],
  };
  const canonical = await canonicalizeTurnSceneMetadata(payload);
  check(canonical.ok, `${id}: canonical save accepts the engine source document: ${canonical.ok ? "" : canonical.error}`);
  if (!canonical.ok) return;
  const turn: StoredTurn = { ...canonical.value, id, orderIndex: 0, question, rawResponse: "", speedMultiplier: 1, traceId: null,
    segments: canonical.value.segments.map((segment) => ({ id: `segment-${segment.orderIndex}`, orderIndex: segment.orderIndex, narration: segment.narration, spokenText: segment.spokenText, command: serializeSegmentCommands(parseStoredSegmentCommands(segment.command), { trustedDiagramGeometry: isStoredCommandTrustedGeometry(segment.command) }), audioUrl: null, durationMs: segment.durationMs ?? null, timings: null })),
  };
  check(sourceCheckedStoredTurn(turn) === turn, `${id}: stored source read admits the saved turn`);
  check(restoreVerifiedPresentationFromTurn(turn) !== null, `${id}: reopen restores the verified matrix presentation`);
  const cells = selected.renderScene.primitives.filter((primitive) => primitive.provenance?.matrixCell).length;
  const replayCells = buildReplayTimeline([turn]).cues.flatMap((cue) => cue.commands).filter((command) => command.type === "LABEL" && command.semanticRef?.primitiveId && /_\d+_\d+$/.test(command.semanticRef.primitiveId));
  check(replayCells.length === cells, `${id}: saved replay retains every matrix cell (${replayCells.length}/${cells})`);
  const stale = structuredClone(turn);
  const givens = (stale.sceneArtifacts as { turnPlan: TurnPlanV3 }).turnPlan.givens;
  if (givens.length > 0) {
    givens[0]!.value = Number(givens[0]!.value) + 7;
    check(sourceCheckedStoredTurn(stale).visualStatus === "retry_required" && restoreVerifiedPresentationFromTurn(stale) === null, `${id}: a stale stored plan scalar cannot reopen beside the correct matrix`);
  }
}

// Independent classifier straight from the textbook definitions.
function classify(m: number[][]): string[] {
  const r = m.length, c = m[0]!.length, sq = r === c;
  const t: string[] = [sq ? "square" : "rectangular"];
  if (r === 1) t.push("row");
  if (c === 1) t.push("column");
  const all = (f: (v: number, i: number, j: number) => boolean) => m.every((row, i) => row.every((v, j) => f(v, i, j)));
  if (all((v) => v === 0)) t.push("zero");
  if (!sq) return t;
  if (all((v, i, j) => v === (i === j ? 1 : 0))) t.push("identity");
  const diagonal = all((v, i, j) => i === j || v === 0);
  if (diagonal) t.push("diagonal");
  if (all((v, i, j) => v === m[j]![i])) t.push("symmetric");
  if (all((v, i, j) => v === -m[j]![i]! || v === 0 && m[j]![i] === 0)) t.push("skew_symmetric");
  if (diagonal && m.every((row, i) => row[i] === m[0]![0])) t.push("scalar");
  if (all((v, i, j) => j >= i || v === 0)) t.push("upper_triangular");
  if (all((v, i, j) => j <= i || v === 0)) t.push("lower_triangular");
  return t;
}

async function main(): Promise<void> {
  for (const sample of CASES) {
    const turnPlan = plan(sample.question, sample.givens);
    check(hasMatrixSourceProgram(sample.question), `${sample.id}: source program admitted`);
    const capabilities = inferSceneCapabilities(sample.question, { turnPlan });
    check(capabilities.hasSourceProgram && capabilities.constructionOperators.includes("matrix_array"), `${sample.id}: planner is told the matrix operators`);
    const selected = selectVerifiedRepresentation({ question: sample.question, turnPlan, families: capabilities.families, exact: null });
    check(selected.sceneDocument.entities.every((entity) => entity.kind === "matrix_array") && selected.sceneDocument.entities.length > 0, `${sample.id}: fallback draws the engine source program, not another family`);
    check(selected.tier !== "exact_verified" && selected.nonMetric, `${sample.id}: matrix tables stay nonmetric`);
    check(selected.validationReport.valid, `${sample.id}: compiled report valid`);
    const tables = boardTables(selected.renderScene.primitives);
    for (const table of sample.tables) {
      const entity = entityByLabel(selected.sceneDocument, table.label);
      check(entity, `${sample.id}: board names ${table.label}`);
      assert.deepEqual(tables.get(entity!), table.cells, `${sample.id}: ${table.label} cells read row by row on the board`); checks++;
      const name = selected.renderScene.primitives.find((primitive) => primitive.kind === "label" && primitive.entityId === entity && !primitive.provenance?.matrixCell);
      check(name?.text === table.label, `${sample.id}: ${table.label} carries its own name label`);
    }
    for (const primitive of selected.renderScene.primitives) for (const point of primitive.points) {
      check(point.x >= 400 && point.x <= 1160 && point.y >= 0 && point.y <= 700, `${sample.id}: ${primitive.id} inside the diagram zone`);
    }
    for (const [name, expected] of Object.entries(sample.types ?? {})) {
      const geometry = evaluateMatrixArrayConstruction("matrix_array", { entries: sample.tables.find((table) => table.label === name)!.cells, origin: [0, 0], displayScale: 1 }, { scalar: () => undefined, geometry: () => undefined })[0]!;
      assert.deepEqual(geometry.matrixArray.types, expected, `${sample.id}: ${name} types`); checks++;
    }
    await lifecycle(sample.id, sample.question, turnPlan, selected, sample.tables[0]!.label);
    // A stale planner scalar never pairs with the correct table.
    const stale = plan(sample.question, sample.givens.map(([id, value], index) => [id, index === 0 ? value + 1 : value]));
    check(buildMatrixSourceDocument(sample.question, stale) === null, `${sample.id}: stale plan scalar blocks the engine document`);
    const staleSelected = selectVerifiedRepresentation({ question: sample.question, turnPlan: stale, families: [], exact: null });
    check(!staleSelected.sceneDocument.entities.some((entity) => entity.kind === "matrix_array"), `${sample.id}: stale plan falls through without a matrix table`);
  }

  // Swapped operand order: a candidate drawing BA where only AB was asked is refused whole.
  {
    const question = "A=[[1,2],[3,4]] and B=[[0,1],[1,0]]. Find AB.";
    const document = buildMatrixSourceDocument(question)!;
    check(document !== null, "AB: engine document builds");
    const swapped = structuredClone(document);
    const product = swapped.constructions.find((construction) => construction.operator === "matrix_product")!;
    [product.inputs.left, product.inputs.right] = [product.inputs.right, product.inputs.left];
    swapped.entities.find((entity) => entity.id === product.outputs[0])!.label = "BA";
    const compiled = compileSceneDocument(swapped);
    check(!compiled.ok && compiled.renderScene === null, "AB: swapped BA candidate rejected atomically");
  }

  // Wrong claimed type on a scalar matrix is refused; the true claim passes.
  {
    const question = "A=[[3,0,0],[0,3,0],[0,0,3]]. Is A a scalar matrix?";
    const document = buildMatrixSourceDocument(question)!;
    for (const [claimedType, ok] of [["identity", false], ["zero", false], ["scalar", true], ["upper_triangular", true]] as const) {
      const claimed = structuredClone(document);
      claimed.constructions[0]!.inputs.claimedType = claimedType;
      check(compileSceneDocument(claimed).ok === ok, `scalar: claimedType ${claimedType} ${ok ? "holds" : "refused"}`);
    }
    for (const [claim, expected, ok] of [["A is a scalar matrix", true, true], ["A is a scalar matrix", false, false], ["A is an identity matrix", true, false], ["A is an upper triangular matrix", true, true]] as const) {
      const issues = validateMatrixSourceBinding(document, question, plan(question, [], [{ claim, expected }]));
      check(issues.every((issue) => issue.severity !== "fatal") === ok, `scalar: plan claim "${claim}"=${expected} ${ok ? "agrees" : "refused"}`);
    }
  }

  // 1x1 overlap of types, dense 6x6 and rounded display.
  {
    const expect = (entries: string[][], types: string[], label: string) => {
      const geometry = evaluateMatrixArrayConstruction("matrix_array", { entries, origin: [0, 0], displayScale: 1 }, { scalar: () => undefined, geometry: () => undefined })[0]!;
      assert.deepEqual(geometry.matrixArray.types, types, label); checks++;
    };
    expect([["5"]], ["square", "row", "column", "diagonal", "symmetric", "scalar", "upper_triangular", "lower_triangular"], "1x1 [5]");
    expect([["1"]], ["square", "row", "column", "identity", "diagonal", "symmetric", "scalar", "upper_triangular", "lower_triangular"], "1x1 [1]");
    expect([["0"]], ["square", "row", "column", "zero", "diagonal", "symmetric", "skew_symmetric", "scalar", "upper_triangular", "lower_triangular"], "1x1 [0]");
    let seed = 7;
    const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let n = 0; n < 400; n++) {
      const rows = 1 + Math.floor(random() * 4), columns = random() < 0.6 ? rows : 1 + Math.floor(random() * 4);
      const pool = random() < 0.5 ? [0] : [0, 0, 1, -1, 2];
      const m = Array.from({ length: rows }, () => Array.from({ length: columns }, () => pool[Math.floor(random() * pool.length)]!));
      if (rows === columns && random() < 0.3) for (let i = 0; i < rows; i++) for (let j = 0; j < i; j++) m[i]![j] = random() < 0.5 ? m[j]![i]! : -m[j]![i]!;
      const geometry = evaluateMatrixArrayConstruction("matrix_array", { entries: m, origin: [0, 0], displayScale: 1 }, { scalar: () => undefined, geometry: () => undefined })[0]!;
      assert.deepEqual(geometry.matrixArray.types, classify(m), `random ${JSON.stringify(m)}`); checks++;
    }
    const dense = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => (i === j ? "-12345.75" : String((i + 1) * 1000 + j))));
    const question = `A=${JSON.stringify(dense).replace(/"/g, "")}. Show A.`;
    const selected = selectVerifiedRepresentation({ question, turnPlan: plan(question, []), families: [], exact: null });
    const cells = selected.renderScene.primitives.filter((primitive) => primitive.provenance?.matrixCell);
    check(cells.length === 36, "6x6: all 36 cells drawn");
    check(selected.renderScene.primitives.every((primitive) => primitive.points.every((point) => point.x >= 400 && point.x <= 1160 && point.y >= 0 && point.y <= 700)), "6x6: dense table stays in the diagram zone");
    assert.deepEqual(boardTables(selected.renderScene.primitives).get("A"), dense, "6x6 cells read in order"); checks++;
    const xs = [...new Set(cells.map((cell) => Math.round(cell.points[0]!.x)))].sort((a, b) => a - b);
    check(xs.slice(1).every((x, index) => x - xs[index]! >= 40), "6x6: columns of nine-character entries keep at least 40 px apart");
  }

  // Honest declines: no matrix table may be drawn, the turn still teaches.
  for (const [question, why] of [
    ["A=[[1,2],[3,4,5]]. Show A.", "ragged rows"],
    ["A=[[1,2],[3,4]] has 3 rows and 2 columns. Show A.", "stated order contradicts cells"],
    ["A=[[1,2,0],[3,4,0]]. Find the inverse of A.", "rectangular inverse"],
    ["A=[[1,2],[3,4]]. Find the determinant of A.", "determinant not owned"],
    ["A=[[1,2],[3,4]]. A is a diagonal matrix. Show A.", "false type premise"],
    ["A=[[1,2],[3,4]]. Find a33.", "element outside the order"],
    ["A=[[1,2],[3,4]]. Find A^2.", "power not owned"],
    ["A=[[1,2],[3,4]], B=[[1,2,3]]. Find A+B.", "sum of unequal orders"],
    ["Construct a 2x2 matrix A whose elements are a_ij = i+j.", "constructed rule not owned"],
  ] as const) {
    check(buildMatrixSourceDocument(question) === null, `decline (${why}): no engine document`);
    const selected = selectVerifiedRepresentation({ question, turnPlan: plan(question, []), families: [], exact: null });
    check(!selected.sceneDocument.entities.some((entity) => entity.kind === "matrix_array"), `decline (${why}): no matrix table rendered`);
  }
  // Literal multipliers are drawn as 2·A so the label is never read as a
  // quantity with a unit (2A as two amperes) and the turn still saves.
  for (const [question, label, cells] of [
    ["A=[[1,2],[3,4]]. Find 2A.", "2·A", [["2", "4"], ["6", "8"]]],
    ["A=[[1,2],[3,4]]. Find 0.5A.", "0.5·A", [["0.5", "1"], ["1.5", "2"]]],
    ["A=[[1,2],[3,4]]. Find 3/4A.", "3/4·A", [["3/4", "3/2"], ["9/4", "3"]]],
  ] as const) {
    const turnPlan = plan(question, [["a11", 1]]);
    const selected = selectVerifiedRepresentation({ question, turnPlan, families: [], exact: null });
    const entity = entityByLabel(selected.sceneDocument, label);
    check(entity, `${label}: drawn with a product dot`);
    assert.deepEqual(boardTables(selected.renderScene.primitives).get(entity!), cells, `${label}: cells`); checks++;
    await lifecycle(`literal ${label}`, question, turnPlan, selected, "A");
  }

  // A planner candidate may label twice matrix A as "2A". Beside matrix tables
  // that is an expression, not two amperes: the label survives pruning, passes
  // quantity agreement and saves. Outside matrix tables "2A" stays a current.
  {
    const question = "A=[[1,2],[3,4]]. Find 2A.";
    const turnPlan = plan(question, [["a11", 1]]);
    const candidate = buildMatrixSourceDocument(question)!;
    const result = candidate.entities.find((entity) => entity.label === "2·A")!;
    result.label = "2A";
    check(validateMatrixSourceBinding(candidate, question, turnPlan).every((issue) => issue.severity !== "fatal"), "planner 2A: source binding certifies the label");
    check(pruneUnverifiedSceneAnnotations(candidate, turnPlan).entities.find((entity) => entity.id === result.id)?.label === "2A", "planner 2A: pruning keeps the matrix name");
    check(validateSceneQuantityAgreement(candidate.quantities, turnPlan, displayedSceneQuantityTexts(candidate)).length === 0, "planner 2A: not read as two amperes");
    const compiled = compileSceneDocument(candidate);
    const selected = selectVerifiedRepresentation({ question, turnPlan, exact: { sceneDocument: candidate, renderScene: compiled.renderScene!, validationReport: compiled.report } });
    check(selected.sceneDocument.entities.some((entity) => entity.label === "2A"), "planner 2A: the planner scene is the one selected");
    await lifecycle("planner 2A", question, turnPlan, selected, "A");
    // A false planner label stays refused by the source binding.
    const wrong = structuredClone(candidate);
    wrong.entities.find((entity) => entity.id === result.id)!.label = "3A";
    check(validateMatrixSourceBinding(wrong, question, turnPlan).some((issue) => issue.severity === "fatal"), "planner 3A for 2A: refused");
    // Without another matrix table named A, "2A" is a measured current again.
    const orphan = { entities: [{ id: "B", kind: "matrix_array", label: "B", role: "matrix" }, { id: "R", kind: "matrix_array", label: "2A", role: "result" }], annotations: [] } as unknown as SceneDocument;
    check(displayedSceneQuantityTexts(orphan).includes("2A"), "orphan 2A: no matrix named A, still read");
    const circuitPlan = plan("A 2 A current flows through R.", []);
    const circuit = { entities: [{ id: "R1", kind: "resistor", label: "I = 2A", role: "resistor" }, { id: "A", kind: "matrix_array", label: "A", role: "unrelated" }], annotations: [{ id: "n", text: "3 A" }] } as unknown as SceneDocument;
    const texts = displayedSceneQuantityTexts(circuit);
    check(texts.includes("I = 2A") && texts.includes("3 A"), "circuit: ampere labels and annotations are still read");
    check(validateSceneQuantityAgreement([], circuitPlan, texts).some((issue) => issue.code === "displayed_quantity_unverified"), "circuit: an unplanned 2 A current is still refused");
    const currentPlan = { ...circuitPlan, givens: [{ id: "I", symbol: "I", value: 2, unit: "A", provenance: "given" as const, sourceText: "2 A" }, { id: "I2", symbol: "I2", value: 3, unit: "A", provenance: "given" as const, sourceText: "3 A" }] };
    check(validateSceneQuantityAgreement([], currentPlan, texts).length === 0, "circuit: planned 2 A and 3 A currents pass");
    check(pruneUnverifiedSceneAnnotations({ ...candidate, entities: [...candidate.entities, { id: "wire", kind: "segment", label: "I = 2A", role: "wire" }] } as SceneDocument, circuitPlan).entities.find((entity) => entity.id === "wire")?.label !== "I = 2A", "circuit: an unplanned ampere label is still pruned even beside matrices");
  }

  // The missing-program guard is for matrix premises, named like matrices.
  // A lowercase program input (LeetCode points, grid, edges = [[...]]) is not
  // one. No document flag can exempt a scene from the guard: a planner or
  // client could set it (#9 forgery repro, reviews/probes/matrix-dsa-forgery.mts).
  {
    const leetcode = "Return the minimum cost to make all points connected.\nInput: points = [[0,0],[2,2],[3,10],[5,2],[7,0]]\nOutput: 20";
    const standIn = (question: string, synthesizedDsa: boolean) => ({
      schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "stand-in" },
      source: { question, ...(synthesizedDsa ? { synthesizedDsa: true } : {}) },
      quantities: [], entities: [{ id: "A", kind: "point", role: "point", label: "A" }],
      constructions: [{ id: "mA", operator: "point", inputs: { x: 9, y: 9 }, outputs: ["A"] }],
      relations: [], assertions: [], annotations: [], requiredEntityIds: ["A"],
      revealGroups: [{ id: "g", entityIds: ["A"], dependsOn: [], narrationCue: "m" }], teachingTimeline: [],
    }) as unknown as SceneDocument;
    for (const flag of [false, true]) {
      check(validateMatrixSourceBinding(standIn(leetcode, flag)).every((issue) => issue.severity !== "fatal"), `points=[[..]] is a program input, not a matrix premise (flag ${flag})`);
      for (const question of ["If A=[[1,2],[3,4]], find the transpose of A.", "A=[[1,2],[3,4]]. Find the transpose of A."]) {
        check(validateMatrixSourceBinding(standIn(question, flag)).some((issue) => issue.code === "matrix_source_missing_program"), `matrix-free stand-in for "${question}" refused (flag ${flag})`);
        check(!compileSceneDocument(standIn(question, flag)).ok, `matrix-free stand-in for "${question}" does not compile (flag ${flag})`);
      }
    }
    // An explicit matrix noun naming the identifier makes it a matrix premise
    // whatever its case; a bare lowercase program input stays unguarded.
    for (const flag of [false, true]) {
      for (const question of ["The matrix m = [[1,2],[3,4]]. Find the transpose of m.", "Let matrix b be [[1,0],[0,1]]. Is it an identity matrix?", "If matrix a = [[2,0],[0,2]], classify it.", "The matrices p = \\begin{pmatrix}1 & 2 \\\\ 3 & 4\\end{pmatrix} and q are given. Find p + q."]) {
        check(validateMatrixSourceBinding(standIn(question, flag)).some((issue) => issue.code === "matrix_source_missing_program"), `lowercase premise named by the matrix noun is guarded: "${question}" (flag ${flag})`);
      }
      for (const question of ["Given grid = [[1,1,0],[0,1,1]], return the number of islands.", "Input: edges = [[0,1],[1,2]], n = 3. Return true if the edges make a valid tree.", "nums = [[1,2],[3]]. Flatten the nested list.", "Given an n x n 2D matrix representing an image. Input: matrix = [[1,2],[3,4]]. Rotate it."]) {
        check(validateMatrixSourceBinding(standIn(question, flag)).every((issue) => issue.severity !== "fatal"), `bare program input stays unguarded: "${question.slice(0, 40)}" (flag ${flag})`);
      }
    }
    const normalized = normalizeSceneDocumentModelOutput({ ...standIn("A=[[1,2],[3,4]]. Show A.", true), source: { question: "A=[[1,2],[3,4]]. Show A.", synthesizedDsa: true, dsaFitBox: true, dsaTraceFrame: "f" } } as never, "A=[[1,2],[3,4]]. Show A.") as { source: Record<string, unknown> };
    check(!("synthesizedDsa" in normalized.source) && !("dsaFitBox" in normalized.source) && !("dsaTraceFrame" in normalized.source) && normalized.source.question === "A=[[1,2],[3,4]]. Show A.", "planner output cannot carry engine-only DSA markers");
  }

  // Native JEE Advanced 2023 P2 q5, full OCR stem: the indexed rule premise is
  // drawn as its source-proved component M only, as a question representation.
  {
    const profile = JSON.parse(readFileSync("../../docs/agent/coverage-handoff-20261003/artifacts/HEY-84/matrix-topic-sprint-20261003/source-profile-frozen-v3.json", "utf8")) as { nativeCases: Array<{ id: string; full_source_record: { text: string } }> };
    const question = profile.nativeCases.find((item) => item.id === "q_5bd968dfa0c26f4c016df0dce297d1360bdb665ef7ea10873fe4103c560e8193")!.full_source_record.text;
    // a_ij = 1 iff i divides j+1: row 1 all ones; row 2 j=1,3; row 3 j=2.
    const turnPlan = plan(question, [["a11", 1], ["a22", 0], ["a32", 1]]);
    const selected = selectVerifiedRepresentation({ question, turnPlan, families: [], exact: null });
    check(selected.tier === "question_representation" && selected.nonMetric, "native q5: component-only question representation");
    assert.deepEqual(boardTables(selected.renderScene.primitives).get("M"), [["1", "1", "1"], ["1", "0", "1"], ["0", "1", "0"]], "native q5: M cells"); checks++;
    check(selected.validationReport.issues.some((issue) => issue.code === "matrix_source_component_only"), "native q5: outside-component warning kept");
    await lifecycle("native q5", question, turnPlan, selected, "M");
    check(buildMatrixSourceDocument(question, plan(question, [["a22", 1]])) === null, "native q5: stale plan cell blocks the component");
  }

  // Fractions the source cannot hold exactly, or a plan that rounds them, draw nothing.
  for (const [question, why] of [
    ["A=[[√3,2],[3,4]]. Show A.", "root symbol"],
    ["A=[[sqrt(3),2],[3,4]]. Show A.", "sqrt text"],
    ["A=\\begin{pmatrix}\\sqrt{3} & 2 \\\\ 3 & 4\\end{pmatrix}. Show A.", "latex root"],
    ["A=[[1/0,2],[3,4]]. Show A.", "zero denominator"],
    ["A=[[1/2/3,2],[3,4]]. Show A.", "stacked fraction"],
    ["A=[[pi,2],[3,4]]. Show A.", "pi"],
  ] as const) {
    check(!hasMatrixSourceProgram(question) && buildMatrixSourceDocument(question) === null, `decline (${why}): irrational or malformed cell`);
  }
  {
    const question = "A=[[1/3,1],[2,-1/6]]. Show A.";
    check(buildMatrixSourceDocument(question, plan(question, [["a11", 1 / 3]])) !== null, "fraction plan: the correctly rounded double of 1/3 is accepted");
    check(buildMatrixSourceDocument(question, plan(question, [["a11", 0.33]])) === null, "fraction plan: a rounded 0.33 is refused");
    check(buildMatrixSourceDocument(question, plan(question, [["a11", 0.33333333333333337]])) === null, "fraction plan: a double one ulp away from 1/3 is refused");
    check(buildMatrixSourceDocument(question, plan(question, [["a22", -0.16666666666666666]])) !== null, "fraction plan: -1/6 double accepted");
  }
  // A planner candidate for a declined source cannot slip through either.
  {
    const question = "A=[[1,2,0],[3,4,0]]. Find the inverse of A.";
    const candidate = buildMatrixSourceDocument("A=[[1,2,0],[3,4,0]]. Show A.")!;
    candidate.source.question = question;
    check(!compileSceneDocument(candidate).ok, "rectangular inverse: partial table of A alone is refused");
  }
  // A planner that lists the requested elements under derived (live batch 4 case 1,
  // sourceText "row 1, column 3", no givens) restates source roles. The engine
  // recomputes each one exactly: an equal restatement draws the table, a differing
  // one blocks it for the value, never for the ownership.
  {
    const derivedPlan = (question: string, derived: Array<[string, number, string]>, givens: Array<[string, number]> = []): TurnPlanV3 => ({
      ...plan(question, givens),
      derived: derived.map(([id, value, sourceText]) => ({ id, symbol: id, value, provenance: "derived" as const, sourceText, dependsOn: [] })),
    });
    const fatal = (document: SceneDocument, question: string, turnPlan: TurnPlanV3) => validateMatrixSourceBinding(document, question, turnPlan).filter((issue) => issue.severity === "fatal");
    const contradicts = "Declared matrix cell, dimension or multiplier quantity contradicts its source role";
    const question = "A=[[2,5,19,-7],[35,-2,2.5,12],[1.5,1,-5,17]]. Show the matrix A, state its order and write the elements a13, a21, a33, a24 and a23.";
    const live: Array<[string, number, string]> = [["a13", 19, "row 1, column 3"], ["a21", 35, "row 2, column 1"], ["a33", -5, "row 3, column 3"], ["a24", 12, "row 2, column 4"], ["a23", 2.5, "row 2, column 3"]];
    const equal = derivedPlan(question, live);
    check(buildMatrixSourceDocument(question, equal) !== null, "derived equal: the live plan's correct restatements draw the engine document");
    const selected = selectVerifiedRepresentation({ question, turnPlan: equal, families: [], exact: null });
    check(selected.validationReport.valid && selected.nonMetric, "derived equal: selected table is valid and nonmetric");
    assert.deepEqual(boardTables(selected.renderScene.primitives).get(entityByLabel(selected.sceneDocument, "A")!), [["2", "5", "19", "-7"], ["35", "-2", "2.5", "12"], ["1.5", "1", "-5", "17"]], "derived equal: A cells read row by row on the board"); checks++;
    await lifecycle("derived equal", question, equal, selected, "A");
    const bare = buildMatrixSourceDocument(question)!;
    for (const [index, wrong] of [[0, 18], [2, 5], [4, 2.4], [3, 12.000001]] as const) {
      const differing = derivedPlan(question, live.map(([id, value, text], at) => [id, at === index ? wrong : value, text]));
      check(buildMatrixSourceDocument(question, differing) === null, `derived differing: ${live[index]![0]} = ${wrong} blocks the engine document`);
      check(fatal(bare, question, differing).some((issue) => issue.message === contradicts), `derived differing: ${live[index]![0]} = ${wrong} is refused for its value`);
      const fallthrough = selectVerifiedRepresentation({ question, turnPlan: differing, families: [], exact: null });
      check(!fallthrough.sceneDocument.entities.some((entity) => entity.kind === "matrix_array"), `derived differing: ${live[index]![0]} = ${wrong} falls through without a matrix table`);
    }
    // Dimensions and named expression results are source roles too.
    check(fatal(bare, question, derivedPlan(question, [["rowsA", 3, "3 rows"], ["colsA", 4, "4 columns"]])).length === 0, "derived equal: order 3 x 4 passes");
    check(fatal(bare, question, derivedPlan(question, [["rowsA", 3, "3 rows"], ["colsA", 3, "3 columns"]])).some((issue) => issue.message === contradicts), "derived differing: a 3 x 3 order is refused");
    const product = "A=[[1,2],[3,4]], B=[[0,1],[1,0]] and C=AB. Find C.";
    const productDocument = buildMatrixSourceDocument(product)!;
    check(productDocument !== null && fatal(productDocument, product, derivedPlan(product, [["c11", 2, "1*0 + 2*1"], ["c22", 3, "3*1 + 4*0"]])).length === 0, "derived equal: C = AB cells 2 and 3 pass");
    check(buildMatrixSourceDocument(product, derivedPlan(product, [["c11", 3, "1*0 + 2*1"]])) === null, "derived differing: C = AB cell c11 = 3 blocks");
    const fraction = "A=[[1/3,1],[2,-1/6]]. Show A.";
    check(buildMatrixSourceDocument(fraction, derivedPlan(fraction, [["a11", 1 / 3, "row 1, column 1"]])) !== null, "derived equal: the correctly rounded double of 1/3 passes");
    check(buildMatrixSourceDocument(fraction, derivedPlan(fraction, [["a11", 0.33, "row 1, column 1"]])) === null, "derived differing: a rounded 0.33 blocks");
    // Equal derived restatements cannot carry a stale given, and givens keep the quote rule.
    check(buildMatrixSourceDocument(question, derivedPlan(question, live, [["a11", 3]])) === null, "derived equal beside a stale given a11 = 3 still blocks");
    const unquotedGiven = plan(question, [["a13", 19]]);
    unquotedGiven.givens[0]!.sourceText = "row 1, column 3";
    check(buildMatrixSourceDocument(question, unquotedGiven) === null, "given restatement without a source quote still blocks");
    const mislabelled = derivedPlan(question, live);
    mislabelled.derived[0]!.provenance = "given";
    check(buildMatrixSourceDocument(question, mislabelled) === null, "a derived entry claiming given provenance still blocks");
  }
  console.log(`matrices-and-types READY gate passed (${checks} checks); declared practical scope only, not FULLY-CERTIFIED`);
}

main().catch((error) => { console.error(error); process.exit(1); });
