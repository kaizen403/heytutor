/**
 * Deterministic code rendering + export typing track:
 * - the Lezer tokenizer preserves the exact source text line by line and
 *   colors language keywords,
 * - the MP4 export track schedules every character inside its cue window,
 *   monotonically, for every TYPE command,
 * - the per-frame spec mirrors the live panel: section follows typing,
 *   partial blocks show a caret, and the finished lesson shows full code.
 */
import { getMockCodeLessonPlan } from "@heytutor/tutor-core";
import { codeLessonSectionCode } from "@heytutor/tutor-core";
import { buildReplayTimeline } from "../../lib/replay/replayTimeline";
import {
  buildCodeLessonExportTrack,
  codeLessonFrameSpec,
} from "../../lib/lecture-export/codeLessonExportTrack";
import { codeTypingCharOffsetsMs } from "../../features/tutor-session/lib/code-lesson/codeLessonController";
import {
  CODE_RENDER_METRICS,
  codePanelContentHeight,
  tokenizeCodeLines,
} from "../../lib/code-render/renderCodeToCanvas";
import type { StoredTurn } from "../../lib/boards/boardsClient";
import {
  SOLARIZED_TOKEN_COLORS,
  codeLessonCaretLineCol,
  codeLessonTabLabel,
} from "../../features/tutor-session/lib/code-lesson/solarizedEditor";
import { DSA_EDITOR_METRICS } from "../../features/tutor-session/constants";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function main(): void {
  const shortWindow = codeTypingCharOffsetsMs("function kruskal(edges):\n    return mst", 400);
  const lastOffset = shortWindow.at(-1) ?? 0;
  assert(
    lastOffset >= 90 * 12,
    `a 400ms cue must not compress typing (last glyph at ${lastOffset}ms)`,
  );
  const pythonCode = "def middle(low, high):\n    return (low + high) // 2";
  const lines = tokenizeCodeLines(pythonCode, "python");
  assert(lines.length === 2, `python snippet must tokenize to 2 lines, got ${lines.length}`);
  const rebuilt = lines
    .map((line) => line.map((span) => span.text).join(""))
    .join("\n");
  assert(rebuilt === pythonCode, "tokenized spans must reproduce the source exactly");
  const defSpan = lines[0]!.find((span) => span.text.trim() === "def");
  // Compared against the shared Solarized token, not a literal: live
  // CodeMirror and this canvas renderer must paint keywords the same colour.
  assert(
    defSpan?.color === SOLARIZED_TOKEN_COLORS.kw,
    `the def keyword must take Solarized keyword green, got ${defSpan?.color}`,
  );
  assert(
    SOLARIZED_TOKEN_COLORS.kw === "#859900",
    "Solarized keyword green drifted from Ethan Schoonover's palette",
  );
  assert(
    codeLessonTabLabel("One-Pass Hash Map", "python") === "One-Pass Hash Map.py",
    "the tab must look like a Sublime file name",
  );
  assert(
    codeLessonCaretLineCol("def x():\n    return 1").line === 2,
    "status-bar line number must track the last revealed line",
  );
  assert(
    CODE_RENDER_METRICS.sectionBarHeight === DSA_EDITOR_METRICS.tabHeight,
    "canvas title bar and live editor title bar must share a height",
  );
  assert(
    CODE_RENDER_METRICS.gutterWidth === DSA_EDITOR_METRICS.gutterWidth,
    "canvas gutter and live editor gutter must share a width",
  );
  const again = tokenizeCodeLines(pythonCode, "python");
  assert(
    JSON.stringify(again) === JSON.stringify(lines),
    "tokenization must be deterministic",
  );
  for (const language of ["javascript", "typescript", "java", "cpp"] as const) {
    const roundTrip = tokenizeCodeLines("f(1);", language)
      .map((line) => line.map((span) => span.text).join(""))
      .join("\n");
    assert(roundTrip === "f(1);", `${language} tokenizer must reproduce the source`);
  }

  const question = "Explain binary search on a sorted array.";
  const plan = getMockCodeLessonPlan(question);
  const blockIds = plan.sections.flatMap((section) => section.blocks.map((b) => b.id));
  assert(blockIds.length >= 2, "the mock plan needs at least two blocks");

  const turn: StoredTurn = {
    id: "turn-1",
    orderIndex: 0,
    question,
    rawResponse: "raw",
    speedMultiplier: 1,
    traceId: null,
    sceneDocument: null,
    sceneEngineVersion: null,
    validationReport: null,
    visualStatus: "text_only",
    sceneArtifacts: {
      schemaVersion: "scene-artifacts/v3",
      turnPlan: null,
      candidates: [],
      diagramResultStatus: "text_only",
      codeLesson: plan,
    },
    segments: blockIds.map((blockId, index) => {
      const code = plan.sections
        .flatMap((section) => section.blocks)
        .find((block) => block.id === blockId)!.code;
      return {
        id: `seg-${index}`,
        orderIndex: index,
        narration: `Now we type part ${index + 1} of the algorithm.`,
        spokenText: `Now we type part ${index + 1} of the algorithm.`,
        command: {
          type: "TYPE",
          params: [],
          text: code,
          charPosition: 0,
          narrationBefore: `Now we type part ${index + 1} of the algorithm.`,
          semanticRef: { entityId: blockId },
        },
        audioUrl: null,
        durationMs: 30_000,
        timings: null,
      };
    }),
  };

  const timeline = buildReplayTimeline([turn]);
  const track = buildCodeLessonExportTrack(turn, timeline.cues);
  assert(track, "a turn with a persisted plan must produce an export track");
  assert(
    track.blocks.length === blockIds.length,
    `every TYPE command must schedule a block: ${track.blocks.length}/${blockIds.length}`,
  );

  track.blocks.forEach((block, index) => {
    const cue = timeline.cues[index]!;
    assert(
      block.charAppearMs.length === block.code.length,
      "every character needs an appear time",
    );
    let previous = -Infinity;
    for (const at of block.charAppearMs) {
      assert(at >= cue.startMs && at <= cue.endMs, "characters must appear inside their cue window");
      assert(at >= previous, "character schedule must be monotonic");
      previous = at;
    }
  });

  const beforeTyping = codeLessonFrameSpec(track, -1);
  assert(
    beforeTyping.chrome.sectionIndex === 0 && beforeTyping.revealedChars === 0,
    "before any typing the panel shows section 0, empty",
  );
  assert(!beforeTyping.showCaret, "no caret before typing starts");

  const firstBlock = track.blocks[0]!;
  const midTimeMs = firstBlock.charAppearMs[Math.floor(firstBlock.code.length / 2)]!;
  const midSpec = codeLessonFrameSpec(track, midTimeMs);
  assert(
    midSpec.revealedChars > 0 && midSpec.revealedChars < codeLessonSectionCode(plan.sections[0]!).length,
    "mid-block frames reveal a strict prefix",
  );
  assert(midSpec.showCaret, "the caret shows while a block is mid-typing");
  assert(
    midSpec.code.startsWith(firstBlock.code.slice(0, 4)),
    "the frame code is the active section source",
  );

  const lastBlock = track.blocks.at(-1)!;
  const endSpec = codeLessonFrameSpec(track, timeline.totalMs + 1);
  assert(
    endSpec.chrome.sectionIndex === lastBlock.sectionIndex,
    "the finished lesson shows the last typed section",
  );
  assert(
    endSpec.revealedChars === codeLessonSectionCode(plan.sections[lastBlock.sectionIndex]!).length,
    "the finished lesson reveals the full section",
  );
  assert(!endSpec.showCaret, "no caret after the lesson finishes");

  assert(
    codePanelContentHeight("a\nb\nc") > codePanelContentHeight("a"),
    "content height must grow with line count",
  );

  console.log("code render verification passed");
}

main();
