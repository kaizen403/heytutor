/**
 * Worked-example frames for a DSA turn, and the controller that walks them.
 *
 * A frame is a whole figure, compiled on its own into the full diagram zone.
 * Advancing wipes the zone and draws the next one, so the board behaves like
 * a teacher redrawing rather than a canvas that accumulates. The previous
 * builder stacked every frame into one document and fitted the stack, which
 * is why arrays overlapped their own pointer arrows and trees interpenetrated.
 *
 * Frames come from a real execution trace whenever the algorithm catalog
 * recognises the question, run on the example the committed program itself
 * uses. When the catalog does not recognise it, the planner's hint steps are
 * compiled one figure per frame instead — weaker, but still validated ink and
 * still a figure that moves. Only a hint that will not compile leaves the
 * board on a single static picture.
 */
import {
  compileTraceScenes,
  detectAlgorithm,
  familyTeachingFacts,
  synthesizeDsaHintFrames,
  type AlgorithmTrace,
  type DetectedAlgorithm,
  type DsaTraceScenes,
  type ExampleSource,
  type RenderScene,
  type RepresentationTier,
  type SceneDocument,
  type ValidationReport,
} from "@heytutor/scene-engine";
import type { CodeLessonPlanContext } from "@heytutor/tutor-core";
import type { VerifiedDiagramPresentation } from "@heytutor/drawing";
import { codeLessonSectionCode, type CodeLessonPlan } from "@heytutor/tutor-core";
import { DSA_DIAGRAM_ZONE } from "../../constants";
import { buildVerifiedDiagramPresentation } from "../scene/verifiedScenePresentation";

/**
 * A compiled walk-through, whichever builder produced it. A matched algorithm
 * family compiles a real execution trace; an unmatched question compiles the
 * planner's own hint steps. Both arrive here as one figure per frame.
 */
export interface DsaSourceFrame {
  frameId: string;
  caption: string;
  narrationIntent: string;
  document: SceneDocument;
  renderScene: RenderScene;
  validationReport: ValidationReport;
  focusEntityIds: string[];
}

export interface DsaSourceFrames {
  frames: DsaSourceFrame[];
}

export interface DsaFrame {
  id: string;
  /** Short line drawn under the figure. */
  caption: string;
  /** What the tutor should say while this frame is on the board. */
  narrationIntent: string;
  presentation: VerifiedDiagramPresentation;
  /** Entities worth spotlighting while this frame is up. */
  focusEntityIds: string[];
  /**
   * Where the marker goes while the tutor is talking about this frame. The
   * spotlight targets when it has them, otherwise whatever the frame drew:
   * an opening frame marks nothing, and the pen still has to stand somewhere
   * rather than wherever it happened to be left.
   */
  pointEntityIds: string[];
}

export interface DsaFrameSet {
  algorithmId: string;
  title: string;
  structure: string;
  tier: RepresentationTier;
  nonMetric: boolean;
  reason: string;
  /** Whether the example came from the question or the family default. */
  exampleSource: "question" | "default";
  /** Which builder produced the walk: a real simulator, or the hint steps. */
  frameSource: "trace" | "hint";
  frames: DsaFrame[];
  /** The compiled scenes, so the turn can persist frame 1 as its diagram. */
  scenes: DsaSourceFrames;
}

/** Most stops a marker walk gets. Beyond this it stops reading as pointing. */
const POINT_STOP_LIMIT = 6;

/**
 * Where the marker may stand while this frame is on the board.
 *
 * The spotlight targets come first, then a spread across the rest of the
 * figure. Taking the first two anchors put every stop in the same corner —
 * cell 0 and the bar above it — so the pen "moved" between two points a
 * centimetre apart and read as parked for the whole step.
 */
function pointStops(
  focusEntityIds: readonly string[],
  anchors: ReadonlyArray<{ id: string }>,
): string[] {
  const stops: string[] = [];
  const seen = new Set<string>();
  const push = (id: string): void => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    stops.push(id);
  };
  for (const id of focusEntityIds.slice(0, 3)) push(id);
  const rest = anchors.map((anchor) => anchor.id).filter((id) => !seen.has(id));
  const want = POINT_STOP_LIMIT - stops.length;
  if (want > 0 && rest.length > 0) {
    const step = Math.max(1, Math.floor(rest.length / want));
    for (let index = 0; index < rest.length && stops.length < POINT_STOP_LIMIT; index += step) {
      push(rest[index]!);
    }
  }
  return stops;
}

function toFrames(
  scenes: DsaSourceFrames,
  question: string,
  stamp: { tier: RepresentationTier; nonMetric: boolean },
): DsaFrame[] {
  return scenes.frames.map((frame) => {
    const presentation = buildVerifiedDiagramPresentation(
      {
        ...frame.document,
        source: {
          ...frame.document.source,
          question,
          nonMetric: stamp.nonMetric,
          representationTier: stamp.tier,
        },
      },
      frame.renderScene,
      { layout: "code_lesson" },
    );
    return {
      id: frame.frameId,
      caption: frame.caption,
      narrationIntent: frame.narrationIntent,
      focusEntityIds: frame.focusEntityIds,
      pointEntityIds: pointStops(frame.focusEntityIds, presentation.diagram.anchors),
      presentation,
    };
  });
}

/**
 * What the board will draw, resolved before the code is planned.
 *
 * The planner used to see only the question, so it wrote whichever correct
 * solution it liked while the simulator drew another one: Two Sum's figure
 * walked a one-pass map beside a two-pass build-then-scan, and the tutor
 * narrated both in the same lesson. Detecting the family first lets the code
 * be planned against the picture.
 */
export interface CodeLessonBoardContext {
  context: CodeLessonPlanContext;
  /** Facts the teaching prompt needs: terms to define, the answer, early exit. */
  facts: { terms: readonly string[]; resultText?: string; earlyExit?: boolean };
}

/**
 * The trace the board will actually draw, and the scenes it compiled to.
 *
 * The question's own example first, then the family's canonical one.
 * `compileTraceScenes` fails closed: a frame that would draw a value outside
 * its own cell takes the whole walk-through down rather than teaching one bad
 * picture among good ones. That is right, but it used to end the matter, and a
 * question whose own numbers are simply too many for the zone then got no
 * figure at all. Min Cost to Connect All Points states five points, which is
 * ten weighted edges, and the board went blank on a question the engine had
 * routed correctly and could draw perfectly well on four. A smaller correct
 * example of the right algorithm teaches; nothing does not.
 *
 * Both callers go through here so the planner is told the example the board
 * draws, not the one it was asked to draw. Telling it the other one is the
 * mismatch this whole layer exists to prevent.
 */
function pickCompilableTrace(
  detected: DetectedAlgorithm,
  question: string,
): { trace: AlgorithmTrace; exampleSource: ExampleSource; scenes: DsaTraceScenes } | null {
  const fallback = detected.exampleSource === "question" ? detected.family.run("") : null;
  const attempts: Array<{ trace: AlgorithmTrace; source: ExampleSource }> = [
    { trace: detected.trace, source: detected.exampleSource },
    ...(fallback && fallback.exampleSource === "default"
      ? [{ trace: fallback.trace, source: "default" as ExampleSource }]
      : []),
  ];
  for (const attempt of attempts) {
    const scenes = compileTraceScenes(attempt.trace, {
      question,
      compile: { viewport: DSA_DIAGRAM_ZONE },
    });
    if (scenes) return { trace: attempt.trace, exampleSource: attempt.source, scenes };
  }
  return null;
}

export function resolveCodeLessonBoardContext(question: string): CodeLessonBoardContext | null {
  const detected = detectAlgorithm(question);
  if (!detected) return null;
  const facts = familyTeachingFacts(detected.family.id);
  if (!facts) return null;
  // The trace the board settles on, not the one detection first proposed.
  const drawn = pickCompilableTrace(detected, question);
  const trace = drawn?.trace ?? detected.trace;
  return {
    context: {
      familyId: detected.family.id,
      familyTitle: trace.title,
      mechanism: facts.mechanism,
      input: trace.input,
      resultText: trace.resultText,
      frameCaptions: trace.frames.map((frame) => frame.caption),
      forbidTitles: facts.forbidTitles,
      codeShape: facts.codeShape,
    },
    facts: {
      terms: facts.terms,
      resultText: trace.resultText,
      earlyExit: trace.earlyExit,
    },
  };
}

/**
 * The lines of the committed program that state its example.
 *
 * The usage section is the driver — `nums = [2, 7, 11, 15]`, `target = 9` —
 * so it is searched first and on its own. Falling back to the whole program
 * would let an array declared inside the algorithm masquerade as the example.
 */
function codeLessonExampleText(plan: CodeLessonPlan): string | undefined {
  const sections = plan.sections;
  if (sections.length === 0) return undefined;
  const last = codeLessonSectionCode(sections[sections.length - 1]!).trim();
  return last.length > 0 ? last : undefined;
}

/**
 * Resolve a question to a walk-through.
 *
 * Two builders, in order of authority:
 *
 *   1. a matched algorithm family, whose simulator was actually run on a
 *      concrete example, so every frame is what the algorithm did;
 *   2. the planner's own diagram hint, compiled one figure per step.
 *
 * The second is weaker — the steps are model-authored — but it is compiled
 * and validated like any other scene, and it keeps the board moving. Without
 * it an unrecognised question drew one static figure and the tutor narrated
 * at a frozen board for the rest of the lesson.
 *
 * Null stays possible (a hint with no steps, or a frame that will not
 * compile) and still means the same thing: draw the single figure instead.
 */
export function resolveDsaFrames(
  question: string,
  diagramHint?: unknown,
  plan?: CodeLessonPlan | null,
): DsaFrameSet | null {
  // The committed program's own example is the second place to look for the
  // numbers to simulate. Without it a question that states no values walked
  // the family default on the board while the panel typed a different example
  // underneath — one lesson, two examples.
  const detected = detectAlgorithm(question, {
    exampleText: plan ? codeLessonExampleText(plan) : undefined,
  });
  if (detected) {
    const drawn = pickCompilableTrace(detected, question);
    if (drawn) {
      const { scenes } = drawn;
      return {
        algorithmId: scenes.algorithmId,
        title: scenes.title,
        structure: scenes.structure,
        tier: scenes.tier,
        nonMetric: scenes.nonMetric,
        reason: `${scenes.title}: ${scenes.frames.length} worked-example frames`,
        exampleSource: drawn.exampleSource,
        frameSource: "trace",
        frames: toFrames(scenes, question, { tier: scenes.tier, nonMetric: scenes.nonMetric }),
        scenes,
      };
    }
  }

  const hintFrames = diagramHint
    ? synthesizeDsaHintFrames(diagramHint, {
        question,
        compile: { viewport: DSA_DIAGRAM_ZONE },
      })
    : null;
  if (!hintFrames) return null;

  const stamp = { tier: "qualitative_verified" as RepresentationTier, nonMetric: true };
  return {
    algorithmId: `hint_${hintFrames.structure}`,
    title: "Worked example",
    structure: hintFrames.structure,
    tier: stamp.tier,
    nonMetric: stamp.nonMetric,
    reason: `hint walk-through: ${hintFrames.frames.length} frames`,
    // A hint is written from the question, but nothing was simulated, so the
    // example is never claimed as the question's own.
    exampleSource: "default",
    frameSource: "hint",
    frames: toFrames(hintFrames, question, stamp),
    scenes: hintFrames,
  };
}

/**
 * Restore a stored turn's walk-through onto a controller.
 *
 * `resolveDsaFrames` is pure, so the frames of a persisted lesson can be
 * rebuilt from the question and the plan that were saved with it. Without this
 * only the plan came back: replay and board restore committed the code panel
 * but left `frames` empty, so every persisted `[FRAME]` found nothing to
 * advance and the board sat on frame 1 while the narration walked the whole
 * example. That was survivable when a walk was four frames; an exchange sort
 * now draws one frame per comparison, so it would strand the entire figure.
 */
export function restoreDsaFrames(
  controller: { frames: DsaFrameController },
  turn: { question: string } | null | undefined,
  plan: CodeLessonPlan | null,
): void {
  if (!turn || !plan) {
    controller.frames.reset();
    return;
  }
  controller.frames.commit(resolveDsaFrames(turn.question, plan.diagramHint, plan));
}

/**
 * Holds the committed frames for a turn and tracks which one is on the board.
 * The runtime advances it; the teaching model never chooses a frame.
 */
export class DsaFrameController {
  private set: DsaFrameSet | null = null;
  private index = 0;

  commit(set: DsaFrameSet | null): void {
    this.set = set;
    this.index = 0;
  }

  reset(): void {
    this.set = null;
    this.index = 0;
  }

  getSet(): DsaFrameSet | null {
    return this.set;
  }

  /** The frame currently drawn on the board. */
  current(): DsaFrame | null {
    return this.set?.frames[this.index] ?? null;
  }

  currentIndex(): number {
    return this.index;
  }

  total(): number {
    return this.set?.frames.length ?? 0;
  }

  hasNext(): boolean {
    return this.set !== null && this.index + 1 < this.set.frames.length;
  }

  /** Step to the next frame and return it, or null when the walk is done. */
  advance(): DsaFrame | null {
    if (!this.hasNext()) return null;
    this.index += 1;
    return this.set!.frames[this.index]!;
  }

  /** Jump straight to the last frame, for replay seeks and board restores. */
  jumpToEnd(): DsaFrame | null {
    if (!this.set || this.set.frames.length === 0) return null;
    this.index = this.set.frames.length - 1;
    return this.set.frames[this.index]!;
  }
}
