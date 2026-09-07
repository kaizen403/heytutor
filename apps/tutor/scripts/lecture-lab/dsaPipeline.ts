/**
 * Runs one DSA (code lesson) turn without a browser.
 *
 * `lecturePipeline.ts` replays the physics/maths path. A LeetCode question
 * takes a different lane entirely — `classifyDsaQuestion`, `planCodeLessonV1`,
 * `resolveDsaFrames`, the code-lesson teaching addon, and the conductor that
 * turns [FOCUS]/[TYPE] tags into frame advances and block reveals — and none
 * of it was reachable offline. This module replays that lane against the dev
 * server with the same functions the live hook calls, and records what the
 * student would actually see and hear: every frame drawn on the board (as
 * SVG), every block typed, every sentence spoken, in the order the conductor
 * would run them.
 *
 * What is dropped is presentation only: Konva, TTS, persistence, cancellation.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import {
  IncrementalTagParser,
  getSegmentCommands,
  lessonNarrationText,
  prepareVerifiedLessonSegments,
  type DrawCommand,
  type TutorSegment,
  type VerifiedDiagram,
} from "@heytutor/drawing";
import {
  CODE_LESSON_STEP_MS,
  FRAME_SWAP_MS,
  classifyDsaQuestion,
  codeLessonSectionCode,
  codeLessonStepCount,
  createFallbackTurnPlanV3,
  normalizeTutorQuestion,
  planCodeLessonV1,
  streamLLMResponse,
  type CodeLessonPlan,
  type SubjectFamiliarity,
} from "@heytutor/tutor-core";
import {
  detectAlgorithm,
  rankAlgorithms,
  synthesizeDsaScene,
  traceRenderMismatches,
  type RenderScene,
} from "@heytutor/scene-engine";
import { renderSceneSvg } from "../../../../packages/scene-engine/scripts/lib/renderSceneSvg";
import { DSA_DIAGRAM_ZONE, MAX_LLM_CONTINUATIONS } from "@/features/tutor-session/constants";
import { SCENE_PLANNER_DEADLINE_MS } from "@/features/tutor-session/lib/scene/diagramGeneration";
import { buildTurnTeachingPrompt } from "@/features/tutor-session/lib/turn/turnTeachingPrompt";
import { isTeachingResponseIncomplete } from "@/features/tutor-session/lib/turn/segmentPlanning";
import {
  codeLessonResumeNote,
  createCodeLessonConductor,
} from "@/features/tutor-session/lib/code-lesson/codeLessonSegments";
import {
  resolveCodeLessonBoardContext,
  resolveDsaFrames,
  type CodeLessonBoardContext,
  type DsaFrameSet,
} from "@/features/tutor-session/lib/code-lesson/dsaFrames";
import { codeTypingCharOffsetsMs } from "@/features/tutor-session/lib/code-lesson/codeLessonController";
import { prettierSyntaxCheck } from "@/features/tutor-session/lib/code-lesson/prettierSyntaxCheck";
import { buildVerifiedDiagramPresentation } from "@/features/tutor-session/lib/scene/verifiedScenePresentation";

/** Spoken pace the audio clock assumes before real timings arrive. */
const SPEECH_CHARS_PER_SECOND = 15;

export interface DsaFrameRecord {
  id: string;
  caption: string;
  narrationIntent: string;
  /** Text the compiler put on the figure, in draw order. */
  renderedLabels: string[];
  /** Entity ids the spotlight lands on while this frame is up. */
  focusEntityIds: string[];
  primitiveCount: number;
  /** Trace value vs drawn text disagreements at any address. */
  mismatches: { entityId: string; expected: string; actual: string | null }[];
  svgFile: string | null;
}

/** One beat the student experiences, in conductor order. */
export interface DsaBeat {
  index: number;
  /** Spoken text with tags removed. */
  speech: string;
  /** What the board did on this beat. */
  actions: DsaBeatAction[];
  /** Estimated wall time of the beat: speech, typing, and frame swaps. */
  estimatedMs: number;
}

export type DsaBeatAction =
  | { kind: "frame"; frameIndex: number; frameId: string; caption: string }
  | { kind: "type"; blockId: string; lines: number; chars: number; typingMs: number }
  | { kind: "focus"; targets: string[] }
  /** The marker moved onto the figure for a spoken step that draws nothing. */
  | { kind: "point"; targets: string[] }
  | { kind: "pause" }
  | { kind: "blocked"; tag: string };

export interface DsaLectureRun {
  probeId: string;
  title: string;
  difficulty: string;
  /** The family the corpus expects the canonical solution to use. */
  expectedPattern: string;
  expectedInCatalog: boolean;
  question: string;
  familiarity: SubjectFamiliarity;
  startedAt: string;
  timings: { planMs: number; teachMs: number; totalMs: number };
  error: string | null;
  classification: {
    isDsa: boolean;
    confidence: string;
    language: string;
    algorithmId: string | null;
  };
  /** Top-ranked families with scores, so a wrong route or a decline is explainable. */
  ranking: { family: string; score: number; margin: number }[];
  /** The catalog family the router settled on, or null when it declined. */
  routedFamily: string | null;
  /** No LLM calls were made: only routing and figures are meaningful. */
  offline: boolean;
  codeLesson: {
    accepted: boolean;
    title: string | null;
    language: string | null;
    sectionCount: number;
    blockCount: number;
    totalLines: number;
    sections: { id: string; title: string; explanation: string; lines: number; blocks: { id: string; code: string }[]; typeAlongRanges: { startLine: number; endLine: number }[] }[];
    diagramHint: unknown;
    plannerElapsedMs: number | null;
    /** Why the planner refused, when it did. */
    rejections: Array<{ phase: string; codes: string[]; messages: string[] }>;
  };
  figure: {
    /** "trace" = real simulator frames, "hint" = planner steps compiled, "static" = one hint figure, "none". */
    source: "trace" | "hint" | "static" | "none";
    algorithmId: string | null;
    structure: string | null;
    tier: string | null;
    exampleSource: "question" | "default" | null;
    reason: string | null;
    frameCount: number;
    frames: DsaFrameRecord[];
    contactSheetFile: string | null;
  };
  teaching: {
    rawText: string;
    steps: number;
    beats: DsaBeat[];
    /** Conductor accounting over the whole response. */
    blockedCommandCount: number;
    unknownBlockIds: string[];
    duplicateBlockIds: string[];
    missingBlockIds: string[];
    unshownFrameCount: number;
    insertedFrameCount: number;
    figureBeats: number;
    codeBeats: number;
    /** Tags the teaching stream is never allowed to emit on a DSA turn. */
    forbiddenTags: string[];
    continuations: number;
    incomplete: boolean;
    contentChars: number;
    reasoningChars: number;
    ttftMs: number | null;
    /** Sum of estimated beat durations. */
    estimatedLessonMs: number;
    /** What the prompt asked for. */
    expectedStepCount: number;
    targetStepMs: number;
  };
  promptChars: number;
  /** The code-lesson addon the tutor was given, for reviewers. */
  promptAddon: string;
}

export interface RunDsaLectureOptions {
  origin: string;
  familiarity?: SubjectFamiliarity;
  fastMode?: boolean;
  probeId?: string;
  title?: string;
  difficulty?: string;
  expectedPattern?: string;
  expectedInCatalog?: boolean;
  /** Directory for per-frame SVGs; omitted means no files are written. */
  framesDir?: string;
  /** Skip every LLM call: classify, route, compile and render only. */
  offline?: boolean;
}

/** Structural ink the teaching stream is never allowed to emit on a DSA turn. */
const DSA_ALLOWED_TAGS = new Set(["TYPE", "FOCUS", "PAUSE", "FRAME", "POINT"]);

function renderedLabelsOf(scene: RenderScene): string[] {
  const out: string[] = [];
  for (const primitive of scene.primitives) {
    if (primitive.kind !== "label" && primitive.kind !== "dimension") continue;
    const text = (primitive as { text?: string }).text?.trim();
    if (text) out.push(text);
  }
  return out;
}

function speechMs(text: string): number {
  return Math.round((text.trim().length / SPEECH_CHARS_PER_SECOND) * 1000);
}

function typingMs(code: string, spokenMs: number): number {
  const offsets = codeTypingCharOffsetsMs(code, spokenMs);
  return offsets.length > 0 ? offsets[offsets.length - 1]! : 0;
}

/** Parse a complete response the way the live parser does, segment by segment. */
function segmentsOf(text: string): TutorSegment[] {
  const segments: TutorSegment[] = [];
  const parser = new IncrementalTagParser({ onSegmentReady: (segment) => segments.push(segment) });
  parser.push(text);
  parser.flush();
  return segments;
}

function focusTargets(command: DrawCommand): string[] {
  const text = command.text ?? "";
  return text
    .split("|")[0]!
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export async function runDsaLecture(
  rawQuestion: string,
  options: RunDsaLectureOptions,
): Promise<DsaLectureRun> {
  const question = normalizeTutorQuestion(rawQuestion);
  const familiarity = options.familiarity ?? "normal";
  const fastMode = options.fastMode ?? true;
  const plannerUrl = `${options.origin}/api/chat`;
  const startedAt = Date.now();

  const classification = classifyDsaQuestion(question);
  const ranking = rankAlgorithms(question)
    .slice(0, 4)
    .map((entry) => ({ family: entry.family.id, score: entry.score, margin: entry.margin }));
  const routedFamily = detectAlgorithm(question)?.family.id ?? null;

  const run: DsaLectureRun = {
    probeId: options.probeId ?? "",
    title: options.title ?? "",
    difficulty: options.difficulty ?? "",
    expectedPattern: options.expectedPattern ?? "",
    expectedInCatalog: options.expectedInCatalog ?? false,
    question,
    familiarity,
    startedAt: new Date(startedAt).toISOString(),
    timings: { planMs: 0, teachMs: 0, totalMs: 0 },
    error: null,
    classification: {
      isDsa: classification.isDsa,
      confidence: classification.confidence,
      language: classification.language,
      algorithmId: classification.algorithmId ?? null,
    },
    ranking,
    routedFamily,
    offline: Boolean(options.offline),
    codeLesson: {
      accepted: false,
      title: null,
      language: null,
      sectionCount: 0,
      blockCount: 0,
      totalLines: 0,
      sections: [],
      diagramHint: null,
      plannerElapsedMs: null,
      rejections: [],
    },
    figure: {
      source: "none",
      algorithmId: null,
      structure: null,
      tier: null,
      exampleSource: null,
      reason: null,
      frameCount: 0,
      frames: [],
      contactSheetFile: null,
    },
    teaching: {
      rawText: "",
      steps: 0,
      beats: [],
      blockedCommandCount: 0,
      unknownBlockIds: [],
      duplicateBlockIds: [],
      missingBlockIds: [],
      unshownFrameCount: 0,
      insertedFrameCount: 0,
      figureBeats: 0,
      codeBeats: 0,
      forbiddenTags: [],
      continuations: 0,
      incomplete: false,
      contentChars: 0,
      reasoningChars: 0,
      ttftMs: null,
      estimatedLessonMs: 0,
      expectedStepCount: 0,
      targetStepMs: CODE_LESSON_STEP_MS[familiarity],
    },
    promptChars: 0,
    promptAddon: "",
  };

  try {
    const plannerStartedAt = Date.now();
    let codeLesson: CodeLessonPlan | null = null;

    const boardContext: CodeLessonBoardContext | null = classification.isDsa
      ? resolveCodeLessonBoardContext(question)
      : null;
    if (classification.isDsa && !options.offline) {
      const response = await planCodeLessonV1(question, {
        proxyUrl: plannerUrl,
        timeoutMs: SCENE_PLANNER_DEADLINE_MS,
        fastMode,
        syntaxCheck: prettierSyntaxCheck,
        ...(boardContext ? { context: boardContext.context } : {}),
        onRejected: (phase, issues) => {
          run.codeLesson.rejections.push({
            phase,
            codes: issues.map((issue) => issue.code),
            messages: issues.slice(0, 4).map((issue) => issue.message),
          });
        },
      }).catch(() => null);
      codeLesson = response?.plan ?? null;
      run.codeLesson.plannerElapsedMs = response?.elapsedMs ?? null;
    }

    if (codeLesson) {
      run.codeLesson.accepted = true;
      run.codeLesson.title = codeLesson.title;
      run.codeLesson.language = codeLesson.language;
      run.codeLesson.sectionCount = codeLesson.sections.length;
      run.codeLesson.blockCount = codeLesson.sections.reduce((sum, section) => sum + section.blocks.length, 0);
      run.codeLesson.sections = codeLesson.sections.map((section) => ({
        id: section.id,
        title: section.title,
        explanation: section.explanation,
        lines: codeLessonSectionCode(section).split("\n").length,
        blocks: section.blocks.map((block) => ({ id: block.id, code: block.code })),
        typeAlongRanges: section.typeAlongRanges,
      }));
      run.codeLesson.totalLines = run.codeLesson.sections.reduce((sum, section) => sum + section.lines, 0);
      run.codeLesson.diagramHint = codeLesson.diagramHint;
    }

    // The figure. Offline mode has no plan, so only a real trace can draw;
    // that is exactly the question offline mode asks ("does the catalog
    // recognise this statement and draw it truthfully?").
    const frameSet: DsaFrameSet | null = classification.isDsa
      ? resolveDsaFrames(question, codeLesson?.diagramHint, codeLesson)
      : null;
    let activeDiagram: VerifiedDiagram | null = null;

    if (frameSet && frameSet.frames.length > 0) {
      run.figure.source = frameSet.frameSource;
      run.figure.algorithmId = frameSet.algorithmId;
      run.figure.structure = frameSet.structure;
      run.figure.tier = frameSet.tier;
      run.figure.exampleSource = frameSet.exampleSource;
      run.figure.reason = frameSet.reason;
      run.figure.frameCount = frameSet.frames.length;

      const mismatchesByFrame = new Map<string, DsaFrameRecord["mismatches"]>();
      if (frameSet.frameSource === "trace") {
        const scenes = frameSet.scenes as Parameters<typeof traceRenderMismatches>[0];
        if ("algorithmId" in scenes) {
          for (const mismatch of traceRenderMismatches(scenes)) {
            const list = mismatchesByFrame.get(mismatch.frameId) ?? [];
            list.push({ entityId: mismatch.entityId, expected: mismatch.expected, actual: mismatch.actual });
            mismatchesByFrame.set(mismatch.frameId, list);
          }
        }
      }

      const slug = (options.probeId ?? "run").replace(/[^a-z0-9]+/gi, "_");
      const frameDir = options.framesDir ? `${options.framesDir}/${slug}` : null;
      if (frameDir) mkdirSync(frameDir, { recursive: true });

      frameSet.frames.forEach((frame, index) => {
        const source = frameSet.scenes.frames[index]!;
        const record: DsaFrameRecord = {
          id: frame.id,
          caption: frame.caption,
          narrationIntent: frame.narrationIntent,
          renderedLabels: renderedLabelsOf(source.renderScene),
          focusEntityIds: frame.focusEntityIds,
          primitiveCount: source.renderScene.primitives.length,
          mismatches: mismatchesByFrame.get(frame.id) ?? [],
          svgFile: null,
        };
        if (frameDir) {
          const file = `${frameDir}/${String(index + 1).padStart(2, "0")}_${frame.id.replace(/[^a-z0-9]+/gi, "_")}.svg`;
          writeFileSync(
            file,
            renderSceneSvg(source.renderScene, {
              title: `${options.title ?? question.slice(0, 60)} — frame ${index + 1}/${frameSet.frames.length}: ${frame.caption}`,
              subtitle: `${frameSet.algorithmId} | ${frameSet.frameSource} | example ${frameSet.exampleSource} | focus ${frame.focusEntityIds.join(",") || "none"}`,
              guides: false,
            }),
          );
          record.svgFile = file;
        }
        run.figure.frames.push(record);
      });
      activeDiagram = frameSet.frames[0]!.presentation.diagram;
    } else if (codeLesson) {
      const scene = synthesizeDsaScene(codeLesson.diagramHint, {
        question,
        compile: { viewport: DSA_DIAGRAM_ZONE },
      });
      if (scene) {
        run.figure.source = "static";
        run.figure.structure = scene.structure;
        run.figure.tier = scene.tier;
        run.figure.reason = scene.reason;
        run.figure.frameCount = 1;
        const presentation = buildVerifiedDiagramPresentation(
          {
            ...scene.document,
            source: { ...scene.document.source, nonMetric: true, representationTier: scene.tier },
          },
          scene.renderScene,
          { layout: "code_lesson" },
        );
        activeDiagram = presentation.diagram;
        const slug = (options.probeId ?? "run").replace(/[^a-z0-9]+/gi, "_");
        let svgFile: string | null = null;
        if (options.framesDir) {
          mkdirSync(`${options.framesDir}/${slug}`, { recursive: true });
          svgFile = `${options.framesDir}/${slug}/01_static.svg`;
          writeFileSync(
            svgFile,
            renderSceneSvg(scene.renderScene, {
              title: `${options.title ?? question.slice(0, 60)} — static hint figure`,
              subtitle: `hint ${scene.structure} | ${scene.reason}`,
              guides: false,
            }),
          );
        }
        run.figure.frames.push({
          id: "static",
          caption: (codeLesson.diagramHint as { caption?: string }).caption ?? "",
          narrationIntent: "",
          renderedLabels: renderedLabelsOf(scene.renderScene),
          focusEntityIds: [],
          primitiveCount: scene.renderScene.primitives.length,
          mismatches: [],
          svgFile,
        });
      } else {
        run.figure.reason = "dsa_hint_unsupported";
      }
    }

    run.timings.planMs = Date.now() - plannerStartedAt;
    if (options.offline || !classification.isDsa) {
      run.timings.totalMs = Date.now() - startedAt;
      return run;
    }

    const teachingPrompt = buildTurnTeachingPrompt({
      question,
      diagramPromptAddon: activeDiagram?.promptAddon ?? null,
      turnPlan: codeLesson ? createFallbackTurnPlanV3(question) : null,
      solverProjection: null,
      codeLesson,
      codeLessonFrames: frameSet?.frames.map((frame) => ({
        id: frame.id,
        caption: frame.caption,
        narrationIntent: frame.narrationIntent,
      })),
      ...(boardContext ? { codeLessonFacts: boardContext.facts } : {}),
      isDsa: classification.isDsa,
      familiarity,
      fastMode,
    });
    run.promptChars = teachingPrompt.systemPrompt.length;
    run.promptAddon = teachingPrompt.runtimeAddon;
    run.teaching.expectedStepCount = codeLesson
      ? codeLessonStepCount(frameSet?.frames.length ?? 0, run.codeLesson.blockCount)
      : 0;

    // Mirrors the app: with no walk-through, the static figure's own anchors
    // are what the marker walks, so a spoken step is never a still board.
    const staticPointIds = frameSet
      ? []
      : (activeDiagram?.anchors ?? []).slice(0, 6).map((anchor) => anchor.id);
    const conductor = codeLesson
      ? createCodeLessonConductor(codeLesson, {
          frameCount: frameSet?.frames.length ?? 0,
          frameIds: frameSet?.frames.map((frame) => frame.id) ?? [],
          frameFocusIds: frameSet?.frames.map((frame) => frame.focusEntityIds) ?? [],
          framePointIds: frameSet?.frames.map((frame) => frame.pointEntityIds) ?? [],
          ...(staticPointIds.length > 0 ? { fallbackPointIds: staticPointIds } : {}),
        })
      : null;

    const teachStartedAt = Date.now();
    let fullResponse = "";
    let continueCount = 0;
    let previousChunk = "";
    let reasoningOnlyRetry = false;
    let incomplete = false;
    let beatsLeftBefore = Number.POSITIVE_INFINITY;
    // Beats in order, resolved chunk by chunk exactly as the live turn does.
    const beats: DsaBeat[] = [];
    const forbidden: string[] = [];
    let blockedCommandCount = 0;
    const unknownBlockIds: string[] = [];
    const duplicateBlockIds: string[] = [];
    let insertedFrameCount = 0;
    let framesShown = frameSet && frameSet.frames.length > 0 ? 1 : 0;

    const consumeChunk = (chunk: string) => {
      const segments = segmentsOf(chunk);
      for (const segment of segments) {
        for (const command of getSegmentCommands(segment)) {
          if (!DSA_ALLOWED_TAGS.has(command.type)) forbidden.push(command.type);
        }
      }
      const prepared = prepareVerifiedLessonSegments(segments, activeDiagram);
      const resolved = conductor ? conductor.resolve(prepared.segments) : null;
      if (resolved) {
        blockedCommandCount += resolved.blockedCommandCount;
        unknownBlockIds.push(...resolved.unknownBlockIds);
        duplicateBlockIds.push(...resolved.duplicateBlockIds);
        insertedFrameCount = resolved.insertedFrameCount;
      }
      for (const segment of resolved?.segments ?? prepared.segments) {
        const actions: DsaBeatAction[] = [];
        let beatMs = speechMs(segment.narration);
        for (const command of getSegmentCommands(segment)) {
          if (command.type === "FRAME") {
            const frame = frameSet?.frames[framesShown] ?? null;
            actions.push({
              kind: "frame",
              frameIndex: framesShown,
              frameId: frame?.id ?? "?",
              caption: frame?.caption ?? "",
            });
            framesShown += 1;
            beatMs += FRAME_SWAP_MS;
          } else if (command.type === "TYPE") {
            const code = command.text ?? "";
            const ms = typingMs(code, speechMs(segment.narration));
            actions.push({
              kind: "type",
              blockId: command.semanticRef?.entityId ?? "?",
              lines: code.split("\n").length,
              chars: code.length,
              typingMs: ms,
            });
            beatMs = Math.max(beatMs, ms);
          } else if (command.type === "FOCUS") {
            actions.push({ kind: "focus", targets: focusTargets(command) });
          } else if (command.type === "POINT") {
            actions.push({ kind: "point", targets: focusTargets(command) });
          } else if (command.type === "PAUSE") {
            actions.push({ kind: "pause" });
          } else {
            actions.push({ kind: "blocked", tag: command.type });
          }
        }
        if (!segment.narration.trim() && actions.length === 0) continue;
        beats.push({ index: beats.length + 1, speech: segment.narration.trim(), actions, estimatedMs: beatMs });
      }
    };

    while (continueCount <= MAX_LLM_CONTINUATIONS) {
      const isContinuation = continueCount > 0 && !reasoningOnlyRetry;
      const streamResult = await streamLLMResponse({
        systemPrompt: isContinuation ? teachingPrompt.continuationPrompt : teachingPrompt.systemPrompt,
        userPrompt: isContinuation
          ? ["continue", conductor && codeLesson ? codeLessonResumeNote(conductor.status(), codeLesson) : ""]
              .filter(Boolean)
              .join("\n\n")
          : question,
        conversationHistory: isContinuation
          ? [{ user: question, assistant: lessonNarrationText(fullResponse) }]
          : [],
        proxyUrl: plannerUrl,
        hasAuthoritativePlan: Boolean(codeLesson),
        fastMode,
        codeLesson: Boolean(codeLesson),
      });
      fullResponse += streamResult.text;
      run.teaching.contentChars += streamResult.streamStats?.contentChars ?? 0;
      run.teaching.reasoningChars += streamResult.streamStats?.reasoningChars ?? 0;
      if (run.teaching.ttftMs === null) {
        run.teaching.ttftMs = streamResult.streamStats?.ttftContentMs ?? null;
      }

      const reasoningOnlyChunk =
        streamResult.text.trim().length === 0 && (streamResult.streamStats?.reasoningChars ?? 0) > 0;
      if (reasoningOnlyChunk && !reasoningOnlyRetry && continueCount < MAX_LLM_CONTINUATIONS) {
        reasoningOnlyRetry = true;
        continueCount += 1;
        continue;
      }
      reasoningOnlyRetry = false;

      consumeChunk(streamResult.text);

      const progress = conductor?.status() ?? null;
      const beatsLeft = progress ? progress.missingBlockIds.length + progress.unshownFrameCount : 0;
      const codeLessonUnfinished = beatsLeft > 0 && beatsLeft < beatsLeftBefore;
      beatsLeftBefore = beatsLeft;

      if (!codeLessonUnfinished && !isTeachingResponseIncomplete(streamResult.text, fullResponse, previousChunk)) {
        break;
      }
      previousChunk = streamResult.text;
      continueCount += 1;
      incomplete = continueCount > MAX_LLM_CONTINUATIONS;
    }

    // Anything the conductor is still holding (a tag with no words after it)
    // belongs to the lesson, so the bench records it too.
    if (conductor) {
      for (const segment of conductor.finish().segments) {
        const actions: DsaBeatAction[] = [];
        for (const command of getSegmentCommands(segment)) {
          if (command.type === "FRAME") {
            const frame = frameSet?.frames[framesShown] ?? null;
            actions.push({ kind: "frame", frameIndex: framesShown, frameId: frame?.id ?? "?", caption: frame?.caption ?? "" });
            framesShown += 1;
          } else if (command.type === "TYPE") {
            const code = command.text ?? "";
            actions.push({
              kind: "type",
              blockId: command.semanticRef?.entityId ?? "?",
              lines: code.split("\n").length,
              chars: code.length,
              typingMs: typingMs(code, 0),
            });
          }
        }
        if (actions.length > 0) {
          beats.push({ index: beats.length + 1, speech: "", actions, estimatedMs: FRAME_SWAP_MS });
        }
      }
    }

    run.teaching.continuations = continueCount;
    run.teaching.incomplete = incomplete;
    run.teaching.rawText = fullResponse;
    run.timings.teachMs = Date.now() - teachStartedAt;
    run.teaching.steps = (fullResponse.match(/\[STEP\]/g) ?? []).length;
    run.teaching.beats = beats;
    run.teaching.blockedCommandCount = blockedCommandCount;
    run.teaching.unknownBlockIds = unknownBlockIds;
    run.teaching.duplicateBlockIds = duplicateBlockIds;
    run.teaching.insertedFrameCount = insertedFrameCount;
    run.teaching.forbiddenTags = forbidden;
    const finalProgress = conductor?.status();
    run.teaching.missingBlockIds = finalProgress?.missingBlockIds ?? [];
    run.teaching.unshownFrameCount = finalProgress?.unshownFrameCount ?? 0;
    run.teaching.figureBeats = beats.filter((beat) => beat.actions.some((action) => action.kind === "frame" || action.kind === "focus")).length;
    run.teaching.codeBeats = beats.filter((beat) => beat.actions.some((action) => action.kind === "type")).length;
    run.teaching.estimatedLessonMs = beats.reduce((sum, beat) => sum + beat.estimatedMs, 0);
  } catch (error) {
    run.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }

  run.timings.totalMs = Date.now() - startedAt;
  return run;
}
