/**
 * Lesson figures parity: live, server, restore (round 2 review F5).
 *
 * Figure k is planned live (`planLessonFigures`), admitted at save
 * (`canonicalizeTurnSceneMetadata` -> `admitLessonFigures`, also the page
 * figure loader's path) and rebuilt on every stored surface
 * (`restoreLessonFigureViews`). All three derive its question and plan with
 * `lessonFigureSceneInput`. For each fixture this gate asserts the three keep
 * the same figures and drop the same figures, that live presents figure k on
 * the plan the server and restore use, and that its anchors, ink and intro
 * are the same bytes everywhere.
 *
 * Fixtures: the recorded circle lesson saved through the real canonicalizer
 * (two later figures); the recorded incline plan (given labels); a section
 * formula lesson whose plan carries a stale derived value (the source
 * authority pass on the composed question would correct it on one side only).
 * Families are widened where needed so later figures draw: this gate checks
 * parity, the plan gate checks relevance.
 *
 * Mutations this gate catches:
 * (p) live re-runs applyDeterministicSourceAuthority on the composed question;
 * (q) restore presents figure k with no plan;
 * (r) the server validates the plan on the lesson question, not the composed one;
 * (s) restore keeps a figure with a part named like a cue.
 */
import assert from "node:assert/strict";
import { validateTurnPlanV3, type TurnPlanV3 } from "@heytutor/scene-engine";
import type { TutorSegment, VerifiedDiagram } from "@heytutor/drawing";
import circle from "./fixtures/replay/circle-s3-turn.json";
import incline from "./fixtures/lesson-figures-incline-plan.json";
import { canonicalizeTurnSceneMetadata, type SubmittedTurnSceneMetadata } from "../../lib/scene/turnScenePersistence";
import { admitLessonFigures, admitStoredScene } from "../../lib/scene/sceneAdmission";
import {
  LESSON_FIGURES_VERSION,
  lessonFigureSceneInput,
  lessonFiguresOf,
  type LessonFigureAsk,
  type LessonFigureId,
  type LessonFiguresArtifact,
} from "../../lib/boards/lessonFigures";
import { deriveSceneGate } from "../../features/tutor-session/lib/scene/productionSceneSelection";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { restoreLessonFigureViews, type LessonFigureTurn } from "../../features/tutor-session/lib/scene/restoreLessonFigures";
import { selectFastFigure } from "../../features/tutor-session/lib/turn/doubtFigurePlan";
import { lessonFiguresArtifact, planLessonFigures, type LessonFigurePlanResult } from "../../features/tutor-session/lib/turn/lessonFigurePlan";

let passed = 0;
async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

/** What a figure is on the board: its parts, its ink and its intro rows. */
function ink(diagram: VerifiedDiagram, intro?: readonly TutorSegment[]): unknown {
  return JSON.parse(JSON.stringify({
    anchors: diagram.anchors,
    commands: diagram.commands,
    ...(intro ? { intro } : {}),
  }));
}

const LINE_QUESTION = "Plot the line y = 2x + 1 and find where it crosses the y axis.";
const LINE_PLAN = {
  schemaVersion: "turn-plan/v3", question: LINE_QUESTION, givens: [], unknowns: [], derived: [],
  qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
} as unknown as TurnPlanV3;

/** A first figure the later figures differ from (a stand in for a planner drawn figure 1). */
function lineFigure(): VerifiedDiagram {
  const fast = selectFastFigure({ question: LINE_QUESTION, turnPlan: LINE_PLAN, authority: null, families: ["analytic_curve", "coordinate_figure"] });
  assert(fast, "the line draws");
  return buildVerifiedDiagramPresentation(fast.sceneDocument, fast.renderScene, { originalQuestion: LINE_QUESTION, turnPlan: LINE_PLAN }).diagram;
}

function familiesOf(question: string, plan: TurnPlanV3): string[] {
  return [...deriveSceneGate({ question, turnPlan: plan, problemIR: null, conversationContext: "" }).sceneCapabilities.families];
}

interface Fixture {
  name: string;
  lessonQuestion: string;
  /** The lesson's plan as stored (what live plans figure k from, reconciled). */
  lessonPlan: TurnPlanV3;
  first: VerifiedDiagram;
  families: string[];
  picks: LessonFigureAsk[];
  /** Admit through the full save path (a recorded lesson turn), or the server function alone. */
  save?: (artifact: LessonFiguresArtifact) => Promise<{ artifact: LessonFiguresArtifact | null; dropped: LessonFigureId[] }>;
}

const recorded = circle.turn as unknown as {
  question: string; sceneDocument: unknown; sceneArtifacts: Record<string, unknown> & { turnPlan: TurnPlanV3; representationTier: string };
  segments: Array<{ orderIndex: number; narration: string; spokenText?: string; command: unknown }>;
};

function circleFixture(): Fixture {
  const plan = validateTurnPlanV3(recorded.sceneArtifacts.turnPlan, recorded.question).plan!;
  const first = admitStoredScene({
    sceneDocument: recorded.sceneDocument, sceneQuestion: recorded.question, turnPlan: plan,
    submittedTier: recorded.sceneArtifacts.representationTier,
  });
  assert(first.ok, "the circle lesson's figure 1 admits");
  return {
    name: "circle",
    lessonQuestion: recorded.question,
    lessonPlan: plan,
    first: first.presentation.diagram,
    // vector_diagram is no kind this lesson reads (live refuses it, the plan
    // gate checks that); widened here so two later figures exist.
    families: [...familiesOf(recorded.question, plan), "vector_diagram"],
    picks: [{ id: "figure_2", view: "vector_diagram" }, { id: "figure_3", view: "coordinate_figure" }],
    save: async (artifact) => {
      const metadata: SubmittedTurnSceneMetadata = {
        question: recorded.question,
        sceneDocument: structuredClone(recorded.sceneDocument),
        visualStatus: "validated",
        sceneArtifacts: { ...structuredClone(recorded.sceneArtifacts), lessonFigures: JSON.parse(JSON.stringify(artifact)) },
        segments: recorded.segments.map((segment) => ({
          orderIndex: segment.orderIndex, narration: segment.narration, spokenText: segment.spokenText ?? segment.narration, command: segment.command,
        })),
      };
      const saved = await canonicalizeTurnSceneMetadata(metadata, { lessonFiguresEnabled: true });
      assert(saved.ok, `the lesson saves: ${saved.ok ? "" : saved.error}`);
      const raw = (saved.value.sceneArtifacts as { lessonFigures?: { droppedFigureIds?: LessonFigureId[] } } | null)?.lessonFigures;
      return { artifact: lessonFiguresOf(saved.value.sceneArtifacts), dropped: raw?.droppedFigureIds ?? [] };
    },
  };
}

function inclineFixture(first: VerifiedDiagram): Fixture {
  const plan = validateTurnPlanV3(incline.turnPlan, incline.turnPlan.question).plan!;
  return {
    name: "incline",
    lessonQuestion: plan.question,
    lessonPlan: plan,
    first,
    families: familiesOf(plan.question, plan),
    picks: [{ id: "figure_2", view: "contact_body" }],
  };
}

const SECTION_QUESTION = "Find the coordinates of the point P which divides the line segment joining A(1, 2) and B(7, 8) internally in the ratio 1:2.";

/** x_P is stale (5, the stem gives 3): the source authority pass would correct it on whichever side runs it. */
function sectionFixture(first: VerifiedDiagram): Fixture {
  const plan = validateTurnPlanV3({
    schemaVersion: "turn-plan/v3", question: SECTION_QUESTION, givens: [], unknowns: [],
    derived: [
      { id: "x_P", symbol: "x_P", value: 5, unit: "", provenance: "derived" },
      { id: "y_P", symbol: "y_P", value: 4, unit: "", provenance: "derived" },
    ],
    qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
  }, SECTION_QUESTION).plan!;
  assert(plan, "the section plan validates");
  return {
    name: "section",
    lessonQuestion: SECTION_QUESTION,
    lessonPlan: plan,
    first,
    families: familiesOf(SECTION_QUESTION, plan),
    picks: [{ id: "figure_2", view: "coordinate_figure" }],
  };
}

function storedTurn(fixture: Fixture, artifact: LessonFiguresArtifact | null): LessonFigureTurn {
  return {
    question: fixture.lessonQuestion,
    sceneDocument: null,
    segments: [],
    sceneArtifacts: { turnPlan: JSON.parse(JSON.stringify(fixture.lessonPlan)), ...(artifact ? { lessonFigures: JSON.parse(JSON.stringify(artifact)) } : {}) },
  } as unknown as LessonFigureTurn;
}

async function parity(fixture: Fixture): Promise<void> {
  const live: LessonFigurePlanResult = planLessonFigures({
    lessonQuestion: fixture.lessonQuestion, turnPlan: fixture.lessonPlan, authority: null, families: fixture.families,
    first: fixture.first, narrationLanguage: "english", deadlineAt: Date.now() + 60_000, asks: fixture.picks,
  });
  const liveIds = live.figures.map((figure) => figure.ask.id);
  await check(`${fixture.name}/live-draws`, () => {
    assert(liveIds.length > 0, `live draws a later figure: ${JSON.stringify(live.misses)}`);
  });
  const submitted = lessonFiguresArtifact(live.figures);
  const server = admitLessonFigures(JSON.parse(JSON.stringify(submitted)), {
    lessonQuestion: fixture.lessonQuestion, lessonPlan: JSON.parse(JSON.stringify(fixture.lessonPlan)), first: fixture.first,
  });
  const saved = fixture.save ? await fixture.save(submitted) : { artifact: server.artifact.figures.length > 0 ? server.artifact : null, dropped: server.droppedFigureIds };
  const views = restoreLessonFigureViews(storedTurn(fixture, saved.artifact));

  await check(`${fixture.name}/same-figures-kept`, () => {
    assert.deepEqual([...server.diagrams.keys()], liveIds, "the server admits every figure live drew");
    assert.deepEqual(saved.artifact?.figures.map((figure) => figure.id) ?? [], liveIds, "the stored artifact lists them");
    assert.deepEqual(views.map((view) => view.id), liveIds, "restore rebuilds every one");
  });
  await check(`${fixture.name}/same-figures-dropped`, () => {
    assert.deepEqual(server.droppedFigureIds, [], "the server drops none live drew");
    assert.deepEqual(saved.dropped, [], "the save drops none");
  });
  for (const figure of live.figures) {
    const id = figure.ask.id;
    await check(`${fixture.name}/${id}/live-plan-is-the-servers`, () => {
      const shared = lessonFigureSceneInput(fixture.lessonQuestion, JSON.parse(JSON.stringify(fixture.lessonPlan)), figure.ask.view);
      assert.equal(figure.question, shared.question);
      assert.deepEqual(JSON.parse(JSON.stringify(figure.turnPlan)), JSON.parse(JSON.stringify(shared.turnPlan)),
        "live plans and presents figure k on the plan the server admits and restore rebuilds it with");
    });
    await check(`${fixture.name}/${id}/same-ink-everywhere`, () => {
      const liveInk = ink(figure.presentation.diagram, figure.presentation.introSegments);
      const serverPresentation = server.presentations.get(id);
      assert(serverPresentation && server.diagrams.get(id) === serverPresentation.diagram, "the server's presentation");
      assert.deepEqual(ink(serverPresentation.diagram, serverPresentation.introSegments), liveInk, "live parts, ink and intro equal the server's");
      const view = views.find((candidate) => candidate.id === id);
      assert(view, "the restored view");
      assert.deepEqual(ink(view.diagram, view.introSegments), liveInk, "restore's parts, ink and intro equal live's");
      assert.equal(view.family, figure.representation.family);
    });
  }
}

/** The same tampered artifact, given to the server and to restore directly: both keep and drop the same figures. */
async function tamperedParity(fixture: Fixture): Promise<void> {
  const live = planLessonFigures({
    lessonQuestion: fixture.lessonQuestion, turnPlan: fixture.lessonPlan, authority: null, families: fixture.families,
    first: fixture.first, narrationLanguage: "english", deadlineAt: Date.now() + 60_000, asks: fixture.picks,
  });
  const good = lessonFiguresArtifact(live.figures);
  assert(good.figures.length >= 2, "two later figures to tamper with");
  const [second, third] = good.figures as [typeof good.figures[0], typeof good.figures[0]];
  const onLessonQuestion = (() => {
    const document = JSON.parse(JSON.stringify(third.sceneDocument)) as { source: { question: string } };
    document.source.question = fixture.lessonQuestion;
    return { ...third, sceneDocument: document };
  })();
  const anchorId = server1Anchor(second);
  const cueNamed = { ...second, sceneDocument: JSON.parse(JSON.stringify(second.sceneDocument).split(`"${anchorId}"`).join("\"figure_3\"")) };
  const cases: Array<{ name: string; artifact: LessonFiguresArtifact }> = [
    { name: "planned-on-the-lesson-question", artifact: { schemaVersion: LESSON_FIGURES_VERSION, figures: [second, onLessonQuestion] } },
    { name: "part-named-like-a-cue", artifact: { schemaVersion: LESSON_FIGURES_VERSION, figures: [cueNamed, third] } },
  ];
  for (const entry of cases) {
    await check(`${fixture.name}/tampered/${entry.name}`, () => {
      const server = admitLessonFigures(JSON.parse(JSON.stringify(entry.artifact)), {
        lessonQuestion: fixture.lessonQuestion, lessonPlan: fixture.lessonPlan, first: fixture.first,
      });
      const restored = restoreLessonFigureViews(storedTurn(fixture, entry.artifact)).map((view) => view.id);
      assert.equal(server.droppedFigureIds.length, 1, `the server drops one: ${JSON.stringify(server.droppedFigureIds)}`);
      assert.deepEqual(restored, [...server.diagrams.keys()], "restore keeps exactly what the server keeps");
    });
  }
}

/** A part of figure k as the server names it, renamed in the tampered copy. */
function server1Anchor(figure: LessonFiguresArtifact["figures"][number]): string {
  const document = figure.sceneDocument as { entities: Array<{ id: string }> };
  const id = document.entities.map((entity) => entity.id).find((candidate) => candidate.length > 1);
  assert(id, "an entity id to rename");
  return id;
}

async function main(): Promise<void> {
  const line = lineFigure();
  const fixtures = [circleFixture(), inclineFixture(line), sectionFixture(line)];
  for (const fixture of fixtures) await parity(fixture);
  await tamperedParity(fixtures[0]!);
  console.log(`verify-lesson-figures-parity: ${passed} checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
