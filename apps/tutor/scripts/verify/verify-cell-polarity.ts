/**
 * Cell polarity marks through production admission, strict selection, the save path and the family path.
 *
 * A planner figure wrote + beside a cell's short plate, while the engine draws the long, positive plate at the cell's
 * start terminal. That now refuses, while a true pair of cells in opposition and a true charging circuit keep drawing.
 * The rule runs only on planner candidates, so a saved board resumes and a family figure builds as before.
 *
 *   pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-cell-polarity.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { attemptArchetypeScene, compileSceneDocument, validateSceneDocument, type TurnPlanV3 } from "@heytutor/scene-engine";
import { selectProductionScene, validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { canonicalizeTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";

const STRICT = ["planner", "verified_recovery", "linear_source", "text_only"];
const MARK = "polarity_mark_against_plates";
let checks = 0;
const failures: string[] = [];
const check = async (name: string, run: () => void | Promise<void>) => {
  checks += 1;
  try { await run(); } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`); }
};

type Part = { entity: Record<string, unknown>; construction: Record<string, unknown> };
const point = (id: string, x: number, y: number): Part => ({ entity: { id, kind: "point", role: "node" }, construction: { id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "layout" }, outputs: [id] } });
const symbol = (id: string, kind: string, start: string, end: string, role: string, label: string): Part =>
  ({ entity: { id, kind: "component", role, label }, construction: { id: `make_${id}`, operator: "symbol", inputs: { symbol: kind, start, end }, outputs: [id] } });
const wire = (id: string, start: string, end: string): Part => ({ entity: { id, kind: "connector", role: "wire" }, construction: { id: `make_${id}`, operator: "connect", inputs: { start, end }, outputs: [id] } });
const badge = (id: string, target: string, sense: string, role: string, label: string): Part =>
  ({ entity: { id, kind: "sign_badge", role, label }, construction: { id: `make_${id}`, operator: "sign_badge", inputs: { target, at: 0.5, sense }, outputs: [id] } });
function document(question: string, parts: Part[], annotations: Record<string, unknown>[] = []): Record<string, unknown> {
  const ids = parts.map((part) => String(part.entity.id));
  return {
    schemaVersion: "scene-document/v2", source: { question, nonMetric: true, representationTier: "qualitative_verified" },
    visualDecision: { mode: "scene", reason: "a circuit with two cells" }, quantities: [],
    entities: parts.map((part) => part.entity), constructions: parts.map((part) => part.construction),
    relations: [], assertions: [], annotations, requiredEntityIds: ids,
    revealGroups: [{ id: "setup", entityIds: ids, dependsOn: [], narrationCue: "Draw the circuit." }],
    teachingTimeline: [{ id: "reveal", action: "reveal", targetId: "setup", dependsOn: [], narrationIntent: "Draw the circuit." }],
  };
}
const planFor = (question: string): TurnPlanV3 => ({ schemaVersion: "turn-plan/v3", subject: "physics", question, visualRequirement: "required", givens: [], unknowns: [], derived: [], qualitativeClaims: [], lawIds: ["Kirchhoff's laws"], assumptions: [] } as unknown as TurnPlanV3);

// Two cells in parallel, positive to positive, feeding a load: the stronger one delivers, the weaker one is charged.
const PARALLEL = "Two cells of unequal emf, each with internal resistance, are connected in parallel, positive terminal to positive terminal, and feed a load resistor. Show the current through each cell and the load.";
function charging(): Record<string, unknown> {
  // Points are drawn leftMid before leftBottom and rightMid before rightBottom, so each "+\u2212" pair puts its + at the
  // battery's start terminal, its long plate.
  return document(PARALLEL, [
    point("top", 0, 2), point("bottom", 0, -2), point("leftTop", -3, 2), point("leftMid", -3, 0), point("leftBottom", -3, -2),
    point("rightTop", 3, 2), point("rightMid", 3, 0), point("rightBottom", 3, -2),
    symbol("source1", "battery", "leftMid", "leftBottom", "source", "E1"), symbol("internal1", "resistor", "leftMid", "leftTop", "internal resistor", "r1"),
    symbol("source2", "battery", "rightMid", "rightBottom", "source", "E2"), symbol("internal2", "resistor", "rightMid", "rightTop", "internal resistor", "r2"),
    symbol("load", "resistor", "top", "bottom", "load resistor", "R"),
    wire("wireLT", "leftTop", "top"), wire("wireLB", "leftBottom", "bottom"), wire("wireRT", "rightTop", "top"), wire("wireRB", "rightBottom", "bottom"),
    // The stronger cell delivers: current leaves its positive plate, up through r1.
    badge("sense1", "internal1", "positive", "source current", "I1"),
    // The weaker cell is charged: current runs down through r2 into its positive plate.
    badge("sense2", "internal2", "negative", "source current", "I2"),
    badge("senseLoad", "load", "positive", "load current", "I_L"),
  ], [
    { id: "marks1", kind: "polarity", targetIds: ["leftMid", "leftBottom"], text: "+\u2212" },
    { id: "marks2", kind: "polarity", targetIds: ["rightMid", "rightBottom"], text: "+\u2212" },
  ]);
}

// Two cells in opposition in one loop: the 9 V cell drives the current into the 3 V cell's positive plate.
const OPPOSED = "Two ideal cells of emfs 9 V and 3 V are connected in opposition in one loop with a 4 ohm resistor. Show the current direction and each cell's terminals.";
function opposed(marksAtLongPlates: boolean): Record<string, unknown> {
  // Points are drawn tl, bl, tr, br, so each pair of marks lands on its first listed point in that order.
  return document(OPPOSED, [
    point("tl", 0, 3), point("bl", 0, 0), point("tr", 5, 3), point("br", 5, 0),
    marksAtLongPlates ? symbol("cell6", "cell", "tl", "bl", "cell", "E1") : symbol("cell6", "cell", "bl", "tl", "cell", "E1"),
    symbol("resistor", "resistor", "tl", "tr", "resistor", "R"),
    marksAtLongPlates ? symbol("cell4", "cell", "tr", "br", "cell", "E2") : symbol("cell4", "cell", "br", "tr", "cell", "E2"),
    wire("bottomWire", "br", "bl"),
    badge("current", "resistor", "positive", "current direction", "I"),
  ], [
    { id: "marks6", kind: "polarity", targetIds: ["tl", "bl"], text: "+-" },
    { id: "marks4", kind: "polarity", targetIds: ["tr", "br"], text: "+-" },
  ]);
}

const admit = (question: string, candidate: Record<string, unknown>) => validateProductionSceneCandidate({ candidate, question, turnPlan: planFor(question), yieldPolicy: "verified_parts" });
const fatal = (validation: ReturnType<typeof admit>) => validation.valid ? [] : validation.errors.filter((issue) => issue.severity === "fatal").map((issue) => issue.code);
const drawn = (question: string, candidate: Record<string, unknown>) => {
  const validation = admit(question, candidate);
  return selectProductionScene({ question, turnPlan: planFor(question), problemIR: null, candidateValidation: validation, policy: { preferPlanner: true, allowedFigureSources: STRICT }, requiredRetryEnabled: true } as Parameters<typeof selectProductionScene>[0]).representation;
};

async function main() {
  await check("a true charging circuit with + marks at both batteries' long plates is admitted and drawn under strict", () => {
    assert.deepEqual(fatal(admit(PARALLEL, charging())), []);
    assert.ok(drawn(PARALLEL, charging()), "drawn");
  });
  await check("a true pair of cells in opposition is admitted and drawn under strict", () => {
    assert.deepEqual(fatal(admit(OPPOSED, opposed(true))), []);
    assert.ok(drawn(OPPOSED, opposed(true)), "drawn");
  });
  await check("the same marks beside the short plates are refused", () => {
    assert.ok(fatal(admit(OPPOSED, opposed(false))).includes(MARK));
    assert.equal(drawn(OPPOSED, opposed(false)), null);
  });

  // Rule 3: the save path and the family path do not run these rules, so saved boards and family figures are as dev.
  await check("the save path never runs figure consistency", () => {
    const source = (path: string) => readFileSync(join(__dirname, "../..", path), "utf8");
    for (const path of ["lib/scene/turnScenePersistence.ts", "lib/scene/sceneSaveAdmission.ts", "lib/scene/sceneAdmission.ts"]) {
      assert.ok(!source(path).includes("figureConsistency"), path);
    }
  });
  for (const [name, question, candidate] of [["a true pair of cells in opposition", OPPOSED, opposed(true)], ["one with its + at a short plate, saved before this rule", OPPOSED, opposed(false)]] as const) {
    await check(`a saved board holding ${name} passes its resume save`, async () => {
      const sceneDocument = validateSceneDocument(structuredClone(candidate)).document;
      assert.ok(sceneDocument, "the fixture validates");
      const result = await canonicalizeTurnSceneMetadata({
        question, sceneDocument, visualStatus: "validated",
        sceneArtifacts: { schemaVersion: "scene-artifacts/v3", diagramResultStatus: "ready", representationTier: "qualitative_verified", nonMetric: true, figureSource: "planner", turnPlan: planFor(question), boardContinuation: { schemaVersion: "board-continuation/v1", lessonQuestion: question } },
        segments: [{ orderIndex: 0, narration: "Let us carry on.", command: null }],
      } as never, { kind: "resume" } as never);
      assert.ok(result.ok, result.ok ? "" : `${result.code}: ${result.error}`);
    });
  }
  await check("the two loop family builds its two cell figure, and it passes the rule even when it runs", () => {
    const question = "Use Kirchhoff's laws to find the branch currents. The left loop consists of a 12 V ideal battery, resistor R1 = 4 ohm, and shared resistor R3 = 8 ohm. The right loop consists of a 9 V ideal battery, resistor R2 = 6 ohm, and the same shared R3. Both battery positive terminals are at the top. Draw the two-loop network.";
    const attempt = attemptArchetypeScene({ question });
    assert.equal(attempt.match?.id, "two_loop_network");
    const sceneDocument = attempt.scene!.document as never;
    const codes = (figureConsistency: boolean) => compileSceneDocument(sceneDocument, { figureConsistency }).report.issues.filter((issue) => issue.severity === "fatal").map((issue) => issue.code);
    assert.ok(!codes(true).includes(MARK), codes(true).join(","));
    assert.deepEqual(codes(false), [], "the family path compiles as before");
  });

  if (failures.length) {
    for (const failure of failures) console.log(`FAIL ${failure}`);
    console.log(`${failures.length} failed of ${checks}`);
    process.exit(1);
  }
  console.log(`pass: ${checks} checks, a + at a short plate refuses, opposed and charging cells draw, saved boards and family figures are as dev`);
}

void main();
