/**
 * A mirror image of a point in a plane is not an optics stem (Harness 4, 17 Oct 2026).
 *
 * Round p5 (maths, image of a point in a plane, strict): seven valid planner
 * figures of a point, its mirror image and the plane were dropped at final
 * selection with planner_optics_on_archetype_stem, because the stems say
 * "mirror image" and the spherical_mirror archetype took them for a mirror
 * stem. Blind judging of the dropped figures: 5 right, 2 partial, 0 wrong.
 *
 * Replays the recorded candidates (fixtures/mirror-image-planner-figures.json,
 * copied from the run files, none held out) through the live parse step,
 * candidate validation and selectProductionScene under the strict policy:
 * every p5 figure is drawn from the planner with no dropped candidate and no
 * mirror archetype on the gate. Two recorded physics rows that name a concave
 * mirror and a lens keep their drop, so the optics rule still holds where the
 * stem names the element.
 *
 *   pnpm --filter @heytutor/tutor exec tsx scripts/verify/verify-mirror-image-planner-figure.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FIGURE_SOURCES, type TurnPlanV3 } from "@heytutor/scene-engine";
import { normalizeSceneDocumentModelOutput, type DiagramSubject } from "@heytutor/tutor-core";
import { selectProductionScene, validateProductionSceneCandidate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { diagramStrategyAllowsFigureSource, liveDiagramStrategyDecision, type DiagramStrategy } from "../../features/tutor-session/lib/scene/diagramStrategy";

interface FixtureRow {
  run: string;
  strategy: DiagramStrategy;
  subject: DiagramSubject;
  solverContradiction: boolean;
  expect: "planner_drawn" | "planner_optics_on_archetype_stem";
  question: string;
  plan: TurnPlanV3;
  candidate: Record<string, unknown>;
}

const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, "fixtures/mirror-image-planner-figures.json"), "utf8")) as { rows: FixtureRow[] };
const failures: string[] = [];
let passed = 0;
function check(name: string, run: () => string | null): void {
  let problem: string | null;
  try { problem = run(); } catch (error) { problem = `threw: ${error instanceof Error ? error.message : String(error)}`; }
  if (problem) { failures.push(`${name}: ${problem}`); console.log(`FAIL ${name}: ${problem}`); }
  else { passed += 1; console.log(`pass ${name}`); }
}

function select(row: FixtureRow) {
  const normalized = normalizeSceneDocumentModelOutput(structuredClone(row.candidate), row.question) as Record<string, unknown>;
  const validation = validateProductionSceneCandidate({ candidate: normalized, question: row.question, turnPlan: row.plan });
  const decision = liveDiagramStrategyDecision({ assignedStrategy: row.strategy, subject: row.subject,
    strictSubjects: row.strategy === "strict" ? ["maths", "physics"] : [], chemistryLane: false, codeLesson: false, dsa: false, doubt: false });
  const selection = selectProductionScene({
    question: row.question, turnPlan: row.plan, problemIR: null, candidateValidation: validation,
    fastRepresentation: null, exactFigureSource: "planner", solverAuthorityBlocked: row.solverContradiction,
    requiredRetryEnabled: true,
    policy: { preferPlanner: decision.strategy === "strict",
      allowedFigureSources: FIGURE_SOURCES.filter((source) => diagramStrategyAllowsFigureSource(decision, source)) },
  });
  return { validation, decision, selection };
}

const drawnRows = fixture.rows.filter((row) => row.expect === "planner_drawn");
const opticsRows = fixture.rows.filter((row) => row.expect === "planner_optics_on_archetype_stem");
check("fixture holds the seven p5 rows and two optics rows", () =>
  drawnRows.length === 7 && opticsRows.length === 2 && drawnRows.every((row) => row.run.startsWith("p5-lab/") && row.strategy === "strict")
    ? null : `${drawnRows.length} p5 rows, ${opticsRows.length} optics rows`);

for (const row of drawnRows) {
  check(`${row.run} is drawn from the planner under strict`, () => {
    const { validation, decision, selection } = select(row);
    if (decision.strategy !== "strict") return `strategy ${decision.strategy}`;
    if (!validation.valid || validation.value?.document.visualDecision.mode !== "scene") return "the recorded candidate no longer validates as a scene";
    if (selection.gate.archetypeId === "spherical_mirror" || selection.gate.archetypeId === "thin_lens") {
      return `the gate still names the ${selection.gate.archetypeId} archetype`;
    }
    if (selection.droppedCandidate) return `dropped with ${selection.droppedCandidate.code}`;
    if (selection.visualStatus !== "validated" || selection.representation?.figureSource !== "planner") {
      return `selection ${selection.visualStatus} from ${selection.representation?.figureSource ?? "nothing"}: ${selection.reason}`;
    }
    return null;
  });
}

for (const row of opticsRows) {
  check(`${row.run} keeps the optics drop`, () => {
    const { validation, selection } = select(row);
    if (!validation.valid || validation.value?.document.visualDecision.mode !== "scene") return "the recorded candidate no longer validates as a scene";
    if (selection.droppedCandidate?.code !== "planner_optics_on_archetype_stem") {
      return `dropped with ${selection.droppedCandidate?.code ?? "nothing"}, status ${selection.visualStatus}`;
    }
    return null;
  });
}

if (failures.length) {
  console.error(`verify-mirror-image-planner-figure: ${failures.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`verify-mirror-image-planner-figure: ${passed} checks passed`);
