/**
 * Deterministic rubric over one `DsaLectureRun`.
 *
 * Everything here is a property of the lesson a student would have received
 * on a LeetCode question: whether the code lane was taken at all, whether the
 * board drew a real worked example or a static picture or nothing, whether the
 * example drawn is the student's own, whether every block reached the panel
 * and every frame reached the board, and whether the narration read the code
 * aloud, leaked machinery, or repeated itself. Whether the algorithm is
 * explained *well* is a reviewer's job.
 */
import { CODE_LESSON_STEP_WORDS, CODE_LESSON_TARGET_BY_FAMILIARITY } from "@heytutor/tutor-core";
import type { DsaLectureRun } from "./dsaPipeline";

export type FindingSeverity = "fatal" | "major" | "minor";

export interface Finding {
  code: string;
  severity: FindingSeverity;
  detail: string;
}

export interface DsaLectureGrade {
  probeId: string;
  title: string;
  difficulty: string;
  expectedPattern: string;
  transportFailure: boolean;
  passed: boolean;
  score: number;
  findings: Finding[];
  metrics: {
    routed: string;
    figureSource: string;
    frames: number;
    blocks: number;
    beats: number;
    figureBeats: number;
    codeBeats: number;
    estimatedMinutes: number;
    planMs: number;
    teachMs: number;
  };
}

const TRANSPORT_FAILURE =
  /timed out|timeout|ECONNRESET|ECONNREFUSED|socket hang up|fetch failed|\b(?:429|500|502|503|504)\b/i;

const SEVERITY_WEIGHT: Record<FindingSeverity, number> = { fatal: 40, major: 12, minor: 3 };

/**
 * Words that reveal the machinery. A student must never hear any of them.
 *
 * "beat" on its own is an ordinary verb in this subject: "no later container
 * can beat forty", "that is the number to beat". Only the lesson's own sense
 * of the word counts.
 */
/**
 * Words that give away the machinery rather than teach the algorithm.
 *
 * "runtime" used to be on this list and had to come off: "O(log n) runtime
 * complexity" is quoted straight out of the LeetCode statement, and
 * "logarithmic runtime" is what a tutor says when it does the thing the
 * `no_complexity` rule below demands. The two rules were penalising each
 * other on the same sentence.
 */
const META_LEAK =
  /\b(?:turn plan|planner|scene engine|schema|validator|validation|compiler|verified diagram|authoritative plan|solver authority|fallback|block id|frame id)\b|\b(?:this|the|next|previous|each|every)\s+beat\b|\bbeats?\s+of\s+(?:this|the)\s+lesson\b/i;

const RECAP_LEAD =
  /\b(?:to recap|in summary|to summari[sz]e|let'?s recap|so to sum up|as a summary|any (?:other )?questions?|feel free to ask|let me know if)\b/i;

/**
 * Has the lesson said what this costs?
 *
 * The formal forms are not enough. A tutor explaining to a beginner says "the
 * time is linear in the number of nodes" and "the space is constant, just the
 * three markers", which is a better close than reciting O(n) and O(1), and the
 * first version of this rule marked both of those lessons as never stating
 * complexity at all.
 */
const COMPLEXITY_MENTION =
  /\b(?:o\s*\(|big[- ]o|time complexity|space complexity|n log n)\b|\b(?:linear|logarithmic|quadratic|constant)\s+(?:extra\s+)?(?:time|space|work|memory)\b|\b(?:time|space|memory|work)\s+(?:is|stays|remains|grows|becomes)\s+(?:\w+\s+){0,2}(?:linear|logarithmic|quadratic|constant)\b|\b(?:linear|logarithmic|quadratic|constant)\s+in\s+the\s+(?:number|length|size)\b/i;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim().toLowerCase())
    .filter((sentence) => sentence.length >= 40);
}

/** A code line spoken verbatim: identifiers and operators in speech. */
function verbatimCodeLines(run: DsaLectureRun): string[] {
  const spoken = run.teaching.beats.map((beat) => beat.speech.toLowerCase()).join("\n");
  const hits: string[] = [];
  for (const section of run.codeLesson.sections) {
    for (const block of section.blocks) {
      for (const line of block.code.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length < 12) continue;
        if (spoken.includes(trimmed.toLowerCase())) hits.push(trimmed);
      }
    }
  }
  return hits;
}

export function gradeDsaLecture(run: DsaLectureRun): DsaLectureGrade {
  const findings: Finding[] = [];
  const add = (code: string, severity: FindingSeverity, detail: string) =>
    findings.push({ code, severity, detail });

  const transportFailure = Boolean(run.error) && TRANSPORT_FAILURE.test(run.error ?? "");
  if (run.error) {
    add(transportFailure ? "transport_failure" : "turn_error", transportFailure ? "minor" : "fatal", run.error);
  }

  const base = {
    probeId: run.probeId,
    title: run.title,
    difficulty: run.difficulty,
    expectedPattern: run.expectedPattern,
    transportFailure,
  };
  const metrics = {
    routed: run.figure.algorithmId ?? run.classification.algorithmId ?? "none",
    figureSource: run.figure.source,
    frames: run.figure.frameCount,
    blocks: run.codeLesson.blockCount,
    beats: run.teaching.beats.length,
    figureBeats: run.teaching.figureBeats,
    codeBeats: run.teaching.codeBeats,
    estimatedMinutes: Math.round(run.teaching.estimatedLessonMs / 6000) / 10,
    planMs: run.timings.planMs,
    teachMs: run.timings.teachMs,
  };
  if (transportFailure) {
    return { ...base, passed: true, score: 0, findings, metrics };
  }

  // --- Routing ---
  if (!run.classification.isDsa) {
    add("not_routed_to_dsa", "fatal", "a LeetCode statement went to the physics/maths pipeline");
  }
  // The family the router chose, not the trace id it produced ("tree_traversal"
  // runs "tree_inorder"). Only a real trace counts as a route the board acted on.
  const routed = run.figure.source === "trace" ? run.routedFamily : null;
  if (run.expectedInCatalog) {
    if (routed && routed !== run.expectedPattern) {
      add("wrong_family", "fatal", `expected ${run.expectedPattern}, drew ${routed}`);
    } else if (!routed) {
      add(
        "declined_known_family",
        "major",
        `catalog has ${run.expectedPattern} but the question was not routed to it (top: ${run.ranking
          .slice(0, 2)
          .map((entry) => `${entry.family}=${entry.score}`)
          .join(", ") || "nothing scored"})`,
      );
    }
  } else if (routed) {
    // A confident picture of a different algorithm on a problem the catalog
    // does not cover is worse than a static figure.
    add("wrong_family", "fatal", `no catalog family fits ${run.expectedPattern}, yet ${routed} was drawn`);
  } else {
    add("uncovered_pattern", "minor", `no simulator for ${run.expectedPattern}; figure source ${run.figure.source}`);
  }

  // --- Figure ---
  // Offline there is no plan, so no hint frames and no static figure: only a
  // real trace can draw, and its absence is already the routing finding above.
  if (run.offline) {
    if (run.figure.source === "trace") {
      for (const frame of run.figure.frames) {
        if (!frame.caption) add("frame_without_caption", "minor", frame.id);
      }
      if (run.figure.exampleSource === "default" && /\b(?:input|example)\s*[:1]/i.test(run.question)) {
        add("example_not_students", "major", "the question states an example but the board walks the family default");
      }
      const offlineMismatches = run.figure.frames.flatMap((frame) => frame.mismatches.map((mismatch) => `${frame.id}:${mismatch.entityId}`));
      if (offlineMismatches.length > 0) add("trace_render_mismatch", "fatal", offlineMismatches.slice(0, 5).join(", "));
    }
    const offlinePenalty = findings.reduce((sum, finding) => sum + SEVERITY_WEIGHT[finding.severity], 0);
    return {
      ...base,
      passed: !findings.some((finding) => finding.severity === "fatal"),
      score: Math.max(0, 100 - offlinePenalty),
      findings,
      metrics,
    };
  }
  if (run.figure.source === "none" && run.classification.isDsa) {
    add("no_figure", "major", run.figure.reason ?? "no frames and no static figure");
  } else if (run.figure.source === "static") {
    add("static_figure", "major", `one picture for the whole lesson (${run.figure.structure})`);
  } else if (run.figure.source === "hint") {
    add("hint_frames", "minor", `${run.figure.frameCount} planner-authored frames, nothing simulated`);
  }
  if (run.figure.source === "trace" && run.figure.exampleSource === "default" && /\b(?:input|example)\s*[:1]/i.test(run.question)) {
    add("example_not_students", "major", "the question states an example but the board walks the family default");
  }
  const mismatches = run.figure.frames.flatMap((frame) => frame.mismatches.map((mismatch) => `${frame.id}:${mismatch.entityId}`));
  if (mismatches.length > 0) {
    add("trace_render_mismatch", "fatal", mismatches.slice(0, 5).join(", "));
  }
  for (const frame of run.figure.frames) {
    if (run.figure.source !== "trace") break;
    if (!frame.caption) add("frame_without_caption", "minor", frame.id);
  }
  if (run.figure.source === "trace" && run.figure.frameCount > 16) {
    add("too_many_frames", "minor", `${run.figure.frameCount} frames`);
  }

  // --- Code plan ---
  if (run.classification.isDsa && !run.codeLesson.accepted) {
    add("plan_rejected", "fatal", "the code planner returned no accepted plan; the student got no code panel");
  }
  if (run.codeLesson.accepted && run.codeLesson.blockCount < 3) {
    add("too_few_blocks", "minor", `${run.codeLesson.blockCount} blocks`);
  }

  // --- Conductor: did every beat reach the student? ---
  if (run.codeLesson.accepted) {
    if (run.teaching.missingBlockIds.length > 0) {
      add("blocks_never_typed", "major", run.teaching.missingBlockIds.join(", "));
    }
    if (run.teaching.unshownFrameCount > 0) {
      add("frames_never_shown", "major", `${run.teaching.unshownFrameCount} of ${run.figure.frameCount}`);
    }
    if (run.teaching.insertedFrameCount > 0 && run.figure.frameCount > 1) {
      const catchUp = run.teaching.insertedFrameCount - Math.max(0, run.teaching.figureBeats - 1);
      if (catchUp > 0) {
        add("frames_caught_up_during_code", "minor", `${catchUp} frame advances were inserted beside code because the figure walk was skipped`);
      }
    }
    if (run.teaching.unknownBlockIds.length > 0) {
      add("unknown_block_ids", "minor", run.teaching.unknownBlockIds.join(", "));
    }
    if (run.teaching.forbiddenTags.length > 0) {
      add("forbidden_tags", "major", Array.from(new Set(run.teaching.forbiddenTags)).join(", "));
    }
    // A beat the plan asked for that never arrived: the opening, the
    // trace-through and the close carry no tag, so only counting tags would
    // score a lesson that skipped them as complete.
    // A step whose only board action is the marker moving is a spoken step:
    // the opening, the approach, the trace-through and the close all draw
    // nothing by design, and the pen going to the figure is what keeps the
    // board alive through them.
    const spokenOnly = run.teaching.beats.filter(
      (beat) => beat.actions.every((action) => action.kind === "point"),
    ).length;
    if (spokenOnly === 0) {
      add("no_spoken_beats", "minor", "no untagged step, so the opening, the trace-through and the close were all skipped");
    }
    if (run.teaching.incomplete) {
      add("truncated", "major", "continuations exhausted with beats still owed");
    }
  }

  // --- Narration ---
  const speech = run.teaching.beats.map((beat) => beat.speech);
  const joined = speech.join(" ");
  if (joined.length > 0) {
    const leak = META_LEAK.exec(joined);
    if (leak) add("meta_leak", "major", `"${leak[0]}"`);
    const verbatim = verbatimCodeLines(run);
    if (verbatim.length > 0) add("code_read_verbatim", "major", verbatim.slice(0, 3).join(" | "));
    const seen = new Map<string, number>();
    for (const sentence of sentences(joined)) seen.set(sentence, (seen.get(sentence) ?? 0) + 1);
    const repeated = [...seen.entries()].filter(([, count]) => count > 1);
    if (repeated.length > 0) add("repeated_sentence", "major", `${repeated.length} sentence(s) spoken more than once`);
    if (RECAP_LEAD.test(speech[speech.length - 1] ?? "")) add("recap_close", "minor", "the last step recaps");
    if (run.codeLesson.accepted && !COMPLEXITY_MENTION.test(joined)) {
      add("no_complexity", "minor", "the lesson never states time or space complexity");
    }
    // Beats that are only a tag, no words: the board moves in silence.
    const silent = run.teaching.beats.filter((beat) => beat.actions.length > 0 && beat.speech.length < 20).length;
    if (silent > 0) add("silent_beats", "minor", `${silent} beat(s) with a tag and almost no speech`);
    // Pace: spoken words per beat against the floor the prompt states. Words
    // are the unit the prompt uses, because sentences varied from ten to
    // fourteen words and a sentence count bought half the intended time.
    if (run.codeLesson.accepted) {
      const words = joined.split(/\s+/).filter(Boolean).length / Math.max(1, run.teaching.beats.length);
      const floor = CODE_LESSON_STEP_WORDS[run.familiarity];
      if (words < floor * 0.7) {
        add("thin_beats", "major", `${Math.round(words)} words per beat against a floor of ${floor}`);
      }
    }
  }

  // --- Length, against the band for this familiarity ---
  if (run.codeLesson.accepted && run.teaching.estimatedLessonMs > 0) {
    const ms = run.teaching.estimatedLessonMs;
    const band = CODE_LESSON_TARGET_BY_FAMILIARITY[run.familiarity];
    if (ms < band.min * 0.6) add("lesson_too_short", "major", `${metrics.estimatedMinutes} min`);
    else if (ms < band.min) add("lesson_short", "minor", `${metrics.estimatedMinutes} min`);
    else if (ms > band.max * 1.3) add("lesson_too_long", "minor", `${metrics.estimatedMinutes} min`);
  }

  const penalty = findings.reduce((sum, finding) => sum + SEVERITY_WEIGHT[finding.severity], 0);
  const score = Math.max(0, 100 - penalty);
  const passed = !findings.some((finding) => finding.severity === "fatal");
  return { ...base, passed, score, findings, metrics };
}
