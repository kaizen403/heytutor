/**
 * Deterministic rubric over one `LectureRun`.
 *
 * Everything here is a property of the lesson a student would have received:
 * the figure that was committed, the steps that were spoken, the rows that
 * reached the notebook. Nothing checks schema shape, because a schema-valid
 * lesson that teaches nothing is the failure mode this lab exists to catch.
 * Pedagogy that no rule can decide (is the physics right, is the explanation
 * clear) is left to the reviewer lane; these are the failures that can be
 * proved from the transcript alone.
 */
import { WORK_ZONE, fitBoardText, parseDrawingCommands, type DrawCommand } from "@heytutor/drawing";
import {
  getBestWriteCharScheduleMs,
  lastMeaningfulClause,
  mathToSpeech,
  normalizeForSpeechMatch,
} from "@heytutor/tutor-core";
import { checkBoardArithmetic } from "./boardArithmetic";
import type { LectureRun } from "./lecturePipeline";

export type FindingSeverity = "fatal" | "major" | "minor";

export interface Finding {
  code: string;
  severity: FindingSeverity;
  detail: string;
}

export interface LectureGrade {
  probeId: string;
  /**
   * The turn never reached the tutor: the dev server or the upstream model
   * timed out or refused. Running five lectures at once against one dev server
   * produces a few of these, and scoring them as teaching failures makes a
   * throughput problem look like a quality regression.
   */
  transportFailure: boolean;
  topicId: string;
  unitId: string;
  question: string;
  passed: boolean;
  score: number;
  findings: Finding[];
  metrics: {
    steps: number;
    writes: number;
    focusTags: number;
    speechOnlySteps: number;
    diagramTier: string;
    diagramPrimitives: number;
    planMs: number;
    teachMs: number;
  };
}

/** The turn died in transport, so there is no lesson to judge. */
const TRANSPORT_FAILURE =
  // `TypeError: terminated` is undici's wording when the response stream is cut
  // mid-turn. It was scoring as a fatal `turn_error`, which is the exact
  // mistake this classification exists to prevent: a dead socket read as a
  // lesson that taught nothing.
  /timed out|timeout|ECONNRESET|ECONNREFUSED|socket hang up|fetch failed|terminated|\b(?:429|500|502|503|504)\b/i;

const SEVERITY_WEIGHT: Record<FindingSeverity, number> = {
  fatal: 40,
  major: 12,
  minor: 3,
};

/** Words that reveal the machinery. A student must never hear any of them. */
const META_LEAK =
  /\b(?:turn plan|planner|scene engine|schema|validator|validation|compiler|runtime|prompt|verified diagram|authoritative plan|solver authority|json|fallback|token)\b/i;

/** Claiming authorship of ink the teaching stream never owns. */
const DREW_IT_CLAIM =
  /\b(?:I (?:have )?(?:drawn|drew|sketched|marked|labell?ed|circled|highlighted|added)|as I (?:draw|drew|mark|marked))\b/i;

/** A closing that repeats the lesson instead of ending it. */
const RECAP_LEAD =
  /\b(?:to recap|in summary|to summari[sz]e|let'?s recap|so to sum up|as a summary|that is the whole picture|that is (?:the )?\w+ in one picture|any (?:other )?questions?|feel free to ask|let me know if)\b/i;

/** The stem asks for a number, so the lesson owes a substitution and a result. */
const NUMERIC_ASK =
  /\b(?:find|calculate|compute|determine|evaluate|how (?:much|many|far|fast|long))\b/i;

/** Tokens that make a row mathematics rather than a sentence about one. */
const MATH_TOKEN =
  /[\d+\-*/^_√∫∑()·×÷%°]|[\u0391-\u03c9\u2113\u221e]|\b(?:sin|cos|tan|sec|csc|cot|log|ln|exp|sqrt|arcsin|arccos|arctan|sinh|cosh|tanh|abs|det|lim)\b/i;

/** Words of two letters or more, which is what makes a side read as English. */
function longWords(text: string): string[] {
  return text.replace(/[^A-Za-z ]/g, " ").split(/\s+/).filter((word) => word.length >= 2);
}

/**
 * A row that states no mathematics: no relation at all, or a relation whose
 * right-hand side is a description ("want R = horizontal range").
 */
function isDescriptionRow(text: string): boolean {
  const row = text.trim();
  if (!/[=<>\u2264\u2265\u2248\u2192]|->/.test(row)) {
    return !MATH_TOKEN.test(row) && longWords(row).length >= 2;
  }
  const sides = row.split("=");
  if (sides.length < 2) return false;
  const right = sides[sides.length - 1].trim();
  if (MATH_TOKEN.test(right)) return false;
  return longWords(right).length >= 2;
}

/**
 * One tag as the runtime will sync it.
 *
 * The board does not see steps; it sees the narration since the previous tag
 * and the tag that follows it (`parseStructuredLessonSteps`). A tag with no
 * words of its own merges into the segment before it and is scheduled against
 * that segment's narration. Measured over 364 lessons, 11% of FOCUS tags and
 * 24% of WRITE tags in multi-tag steps had an empty window, and the runtime
 * had no word to place them on.
 */
interface TagWindow {
  command: DrawCommand;
  /** Narration since the previous tag in the step, tags stripped. */
  window: string;
  /** What the runtime schedules against: the window, or the segment a glued tag merged into. */
  narration: string;
  /** Text commands already scheduled against that same narration. */
  textCommandIndex: number;
  /** Whole spoken text of the step. */
  stepSpeech: string;
}

const STEP_BLOCK = /\[STEP\]([\s\S]*?)(?:\[\/STEP\]|$)/g;

function tagWindows(rawText: string, usedStepMarkers: boolean): TagWindow[] {
  const blocks = usedStepMarkers
    ? [...rawText.matchAll(STEP_BLOCK)].map((match) => match[1])
    : [rawText];
  const out: TagWindow[] = [];
  for (const block of blocks) {
    const parsed = parseDrawingCommands(block);
    let narration = "";
    let textCommandIndex = 0;
    parsed.commands.forEach((command, index) => {
      const window = (
        parsed.segments.find((segment) => segment.commandIndex === index)?.text ?? ""
      ).trim();
      if (window.length > 0) {
        narration = window;
        textCommandIndex = 0;
      }
      out.push({ command, window, narration, textCommandIndex, stepSpeech: parsed.narration });
      if (command.type === "WRITE") textCommandIndex += 1;
    });
  }
  return out;
}

function focusIds(text: string | undefined): string[] {
  return (text ?? "")
    .split("|")[0]
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

/**
 * Whether the student heard this part named in `text`.
 *
 * Compared through the speech normaliser the matcher uses, so "θ" meets
 * "theta" and "V_s" meets "v s". A label of one to three letters is matched
 * whole word and case sensitive against the spoken form instead: "I" the
 * image is not "i" the pronoun, and "a" the point is not the article. Before
 * this the check was a raw substring test, and "O" matched inside "object".
 */
function partSpokenIn(text: string, id: string, label: string | undefined): boolean {
  const spoken = mathToSpeech(text);
  const normalized = ` ${normalizeForSpeechMatch(spoken)} `;
  const names = new Set<string>();
  if (label) {
    names.add(label.trim());
    // "u=20 m/s" and "H=10.2 m" are named by the symbol in front of the value.
    const head = label.split(/[=:]/)[0]?.trim() ?? "";
    if (head) names.add(head);
  }
  names.add(id.replace(/_/g, " "));
  for (const name of names) {
    if (/^[A-Za-z]{1,3}$/.test(name)) {
      if (new RegExp(`(?<![A-Za-z0-9])${name}(?![A-Za-z0-9])`).test(spoken)) return true;
      continue;
    }
    const key = normalizeForSpeechMatch(name);
    if (key.length >= 2 && normalized.includes(` ${key} `)) return true;
  }
  return false;
}

/**
 * Where in its window the row's first spoken token lands, as a fraction of
 * the normalised window. Mirrors the cursor matcher in `getWriteCharScheduleMs`
 * (each board token searched forward from the last match, through the same
 * normaliser); that matcher interpolates an unmatched leading token from the
 * window start, so its schedule cannot say which token was the first to be
 * found, and this one can. Measured over 6301 rows the first found token sat
 * past 35% of the window in 29%, always a two-sentence step with the row said
 * second, and the runtime then dragged the cue to the sentence start.
 */
function firstCueFraction(window: TagWindow): number | null {
  const narration = normalizeForSpeechMatch(mathToSpeech(window.narration.trim()));
  if (narration.length === 0) return null;
  const tokens = (window.command.text ?? "").split(/\s+/).filter(Boolean);
  let cursor = 0;
  let first: number | null = null;
  for (const token of tokens) {
    const phrase = normalizeForSpeechMatch(token);
    if (phrase.length === 0) continue;
    const index = narration.indexOf(phrase, cursor);
    if (index < 0) continue;
    if (first === null) first = index;
    cursor = index + phrase.length;
  }
  return first === null ? null : first / narration.length;
}

export function gradeLecture(run: LectureRun): LectureGrade {
  const findings: Finding[] = [];
  const add = (code: string, severity: FindingSeverity, detail: string) =>
    findings.push({ code, severity, detail });

  const steps = run.teaching.steps;
  const writes = run.teaching.writes;

  const transportFailure = Boolean(run.error) && TRANSPORT_FAILURE.test(run.error ?? "");
  if (run.error) {
    add(
      transportFailure ? "transport_failure" : "turn_error",
      transportFailure ? "minor" : "fatal",
      run.error,
    );
  }

  // A row with no text is not a row. The broken `[WRITE]text,x,y` form used to
  // compile to dozens of empty writes, which looked like a full notebook.
  const inkedWrites = writes.filter((write) => write.text.trim().length > 0);
  if (transportFailure) {
    // Nothing to grade. Every teaching check below would fire on an empty
    // lesson and bury the one fact that matters: the turn never happened.
    return {
      probeId: run.probeId,
      transportFailure,
      topicId: run.topicId,
      unitId: run.unitId,
      question: run.question,
      passed: true,
      score: 0,
      findings,
      metrics: {
        steps: 0,
        writes: 0,
        focusTags: 0,
        speechOnlySteps: 0,
        diagramTier: run.diagram.tier ?? "none",
        diagramPrimitives: run.diagram.primitiveCount,
        planMs: run.timings.planMs,
        teachMs: run.timings.teachMs,
      },
    };
  }

  if (steps.length === 0 && inkedWrites.length === 0) {
    add("no_lesson", "fatal", "the tutor produced no narrated board segments at all");
  } else if (steps.length === 0) {
    // Recorded before the runner rebuilt steps from the tag stream: rows
    // reached the board, so the lesson ran and only the markup was missing.
    add(
      "no_step_markers",
      "minor",
      `the response never wrapped its steps in [STEP] tags, though ${inkedWrites.length} rows still reached the board`,
    );
  } else {
    // [STEP] markers are the contract's format, but the live parser segments on
    // tags whether or not they are there. A lesson missing them still teaches,
    // so this is a format slip and not a dead turn.
    if (run.teaching.usedStepMarkers === false) {
      add("no_step_markers", "minor", "the response never wrapped its steps in [STEP] tags");
    }
    if (steps.length < run.lessonBudget.minSteps) {
      add(
        "under_budget",
        "major",
        `${steps.length} steps against a ${run.lessonBudget.scope} budget of ${run.lessonBudget.minSteps}-${run.lessonBudget.maxSteps}`,
      );
    }
    // One step over a soft ceiling is not a defect; the budget is a band, not a
    // quota, and flagging a 19-step lesson against an 18-step ceiling turns the
    // rubric into noise.
    if (steps.length > run.lessonBudget.maxSteps * 1.15) {
      add(
        "over_budget",
        "minor",
        `${steps.length} steps against a ceiling of ${run.lessonBudget.maxSteps}`,
      );
    }
  }

  const speechOnly = steps.filter((step) => step.tags.every((tag) => tag.type === "PAUSE"));
  if (speechOnly.length > 0) {
    add(
      "speech_only_steps",
      "major",
      `${speechOnly.length} of ${steps.length} steps move nothing on the board (steps ${speechOnly
        .map((step) => step.index)
        .slice(0, 8)
        .join(", ")})`,
    );
  }

  if (run.teaching.forbiddenTags.length > 0) {
    add(
      "teaching_owned_ink",
      "fatal",
      `teaching stream emitted ${Array.from(new Set(run.teaching.forbiddenTags)).join(", ")}`,
    );
  }

  // Figure.
  // A plan that asks for no figure and a stem filter that agrees is not a
  // coverage gap; the runtime now skips the fallback entirely in that case.
  const figureWanted =
    (run.plan?.visualRequirement === "required" ||
      run.plan?.visualRequirement === "preferred" ||
      run.plan?.requiresVisualByStem === true) &&
    !(run.plan?.visualRequirement === "none" && run.plan?.requiresVisualByStem === false);
  if (figureWanted && !run.diagram.committed) {
    // Refusing an unreadable figure is the guard working. The student still
    // gets no picture, which is a coverage gap worth seeing, but it is not the
    // same failure as producing nothing at all and it must not read as a
    // regression when the guard starts firing.
    // Older runs carry no flag, but a tier means a representation was chosen
    // and then dropped, which is the same thing.
    const declined = run.diagram.declinedUnreadable === true ||
      (run.diagram.declinedUnreadable === undefined && run.diagram.tier !== null);
    add(
      declined ? "figure_declined_unreadable" : "missing_figure",
      declined ? "minor" : run.plan?.visualRequirement === "required" ? "fatal" : "major",
      declined
        ? `a ${run.diagram.tier ?? "fallback"} figure was built and refused for carrying no readable label, so the lesson taught in words`
        : `visualRequirement=${run.plan?.visualRequirement ?? "?"} stemRequires=${run.plan?.requiresVisualByStem} but no scene was committed (${run.diagram.degradationReason ?? run.diagram.reason ?? "no reason"})`,
    );
  }
  if (run.diagram.committed && run.diagram.primitiveCount < 3) {
    add(
      "empty_figure",
      "fatal",
      `committed a figure with ${run.diagram.primitiveCount} primitives`,
    );
  }
  if (run.diagram.committed && run.diagram.renderedLabels.length === 0) {
    add(
      "unlabelled_figure",
      "major",
      "the committed figure puts no text on the board, so nothing in it can be named aloud",
    );
  }

  // A figure-relevance check lived here and was removed. It scored a figure by
  // how many of its drawn symbols appear in the question, and it flagged the
  // correct Atwood, resistor-network and wave figures alongside the genuinely
  // wrong ones: symbols like R1, S1 and q1 are naming conventions, not evidence
  // of subject. Whether a figure is about this question is a reviewer's call.
  // What survives here is the corpus-level duplicate-figure signature in
  // `regrade.ts`, which caught every wrong-figure pair a reviewer confirmed.

  // Marker.
  // Runs recorded before the resolver was wired in carry no unresolved list;
  // fall back to the advertised target set so old rounds stay comparable.
  const unknownFocus = run.teaching.unresolvedFocusIds
    ? Array.from(new Set(run.teaching.unresolvedFocusIds))
    : Array.from(new Set(run.teaching.focusIds)).filter(
        (id) => !new Set(run.diagram.focusableIds).has(id),
      );
  if (unknownFocus.length > 0) {
    add(
      "focus_unknown_entity",
      "major",
      `[FOCUS] named ${unknownFocus.slice(0, 6).join(", ")}, which the board cannot resolve, so the marker never moved`,
    );
  }
  // The board resolves FOCUS, so a resolved tag proves the marker moved. It
  // does not prove the student was told which part moved: lessons said "q1 is
  // the total field vector B" and "the pivot O is at the 50 centimetre mark"
  // while spotlighting a point charge and a circuit node. If the step names
  // nothing the figure has written on it, the voice and the marker are loose.
  // Runs recorded before the label map existed cannot answer this; scoring them
  // against an empty map would report every marker move as unspoken.
  const labelByEntity = run.diagram.labelByEntity;
  const focusSteps = labelByEntity
    ? steps.filter((step) => step.tags.some((tag) => tag.type === "FOCUS"))
    : [];
  const unspoken = focusSteps.filter((step) => {
    const ids = step.tags
      .filter((tag) => tag.type === "FOCUS")
      .flatMap((tag) => focusIds(tag.text));
    return ids.every((id) => {
      const label = labelByEntity?.[id];
      return !label || !partSpokenIn(step.speech, id, label);
    });
  });
  if (focusSteps.length >= 3 && unspoken.length * 2 > focusSteps.length) {
    add(
      "focus_label_unspoken",
      "major",
      `${unspoken.length} of ${focusSteps.length} marker moves never say the label written on the part they point at`,
    );
  }

  // The marker reaches the part when its name is spoken, or it does not reach
  // it at all. The runtime anchors a FOCUS on the clause in front of the tag,
  // and one tag is one gesture: a combined tag releases every label at once
  // and traces all of them inside one budget, and a tag glued behind another
  // has no clause of its own. Measured over 1277 tags: 26% combined, 98.7% at
  // the end of the step, the label inside the anchored clause in 28%, and the
  // name spoken a median 3.3 s before the marker moved.
  const windows = tagWindows(run.teaching.rawText, run.teaching.usedStepMarkers !== false);
  const focusWindows = windows.filter((window) => window.command.type === "FOCUS");
  if (focusWindows.length > 0) {
    let combined = 0;
    let glued = 0;
    let single = 0;
    let afterName = 0;
    for (const window of focusWindows) {
      const ids = focusIds(window.command.text);
      if (ids.length > 1) {
        combined += 1;
        continue;
      }
      if (window.window.length === 0) {
        glued += 1;
        continue;
      }
      single += 1;
      const id = ids[0] ?? "";
      if (partSpokenIn(lastMeaningfulClause(window.window), id, labelByEntity?.[id])) {
        afterName += 1;
      }
    }
    const placed = single >= 2 ? afterName / single : 1;
    if (combined > 0 || glued > 0 || placed < 0.9) {
      const reasons = [
        combined > 0 ? `${combined} tag(s) carry several ids` : "",
        glued > 0 ? `${glued} tag(s) follow another tag with no words of their own` : "",
        placed < 0.9 ? `${single - afterName} of ${single} single tags do not follow the spoken name` : "",
      ].filter(Boolean);
      add(
        "focus_after_name",
        "major",
        `${reasons.join("; ")}, so the marker moves after the sentence instead of on the name`,
      );
    }
  }

  // Only a figure with text on it can be walked part by part. The contract now
  // tells the tutor not to name a part that carries no label, so a silent
  // marker over an unlabelled figure is the rule working, not a failure.
  if (
    run.diagram.committed &&
    run.diagram.renderedLabels.length > 0 &&
    run.teaching.focusIds.length === 0 &&
    steps.length > 0
  ) {
    add(
      "figure_never_traced",
      "major",
      "a labelled figure was committed and the marker never moved to it",
    );
  }

  // Notebook.
  const numericAsk = NUMERIC_ASK.test(run.question);
  const expectedRows = numericAsk ? 6 : 4;
  if (inkedWrites.length < expectedRows) {
    add(
      "thin_notebook",
      "major",
      `${inkedWrites.length} work rows written, ${expectedRows} is the floor for this kind of question`,
    );
  }
  // The pen parked while the voice teaches.
  //
  // A [FOCUS]-only step moves the marker over the figure and writes nothing, so
  // the rubric's `speech_only_steps` (no tags at all) never saw it. Measured
  // over sixteen numerical asks: 41 of 228 steps wrote nothing and one lesson
  // ran nine of them back to back, narrating a whole figure while the notebook
  // stayed empty. One is a legitimate "look at this" beat; a run of them is the
  // tutor talking with the chalk down.
  const wrote = (step: (typeof steps)[number]) =>
    step.tags.some((tag) => tag.type === "WRITE" && (tag.text ?? "").trim().length > 0);
  let silentSteps = 0;
  let longestSilentRun = 0;
  let silentRun = 0;
  for (const step of steps) {
    if (wrote(step)) {
      silentRun = 0;
      continue;
    }
    silentSteps += 1;
    silentRun += 1;
    longestSilentRun = Math.max(longestSilentRun, silentRun);
  }
  if (longestSilentRun >= 3) {
    add(
      "silent_pen_run",
      "major",
      `${longestSilentRun} steps in a row write nothing (${silentSteps} of ${steps.length} steps write nothing at all)`,
    );
  } else if (steps.length >= 6 && silentSteps * 3 > steps.length) {
    add("silent_pen", "minor", `${silentSteps} of ${steps.length} steps write nothing`);
  }

  // A numerical ask wants working, not a commentary on it.
  //
  // The owner's complaint in one sentence: "when I ask for numerical, I don't
  // want a lot of words". A description row states no mathematics: either it
  // carries no relation at all ("use quadratic formula", "T same both sides"),
  // or its right-hand side is English ("want R = horizontal range"). The
  // second shape was the contract's own doing, since the row order opened on
  // "what the symbols mean and what is asked", and it appeared in 32 of 46
  // numeric lessons in one sweep. A row with a symbolic right-hand side is
  // mathematics however few digits it has, so `a = g sin θ` and `V = I R` are
  // left alone.
  if (numericAsk && inkedWrites.length >= 4) {
    const described = inkedWrites.filter((write) => isDescriptionRow(write.text));
    if (described.length >= 2) {
      add(
        "prose_rows_on_numeric",
        described.length >= 3 ? "major" : "minor",
        `${described.length} of ${inkedWrites.length} rows state no mathematics on a numerical ask (e.g. "${described[0].text.slice(0, 48)}")`,
      );
    }
  }

  // The pen can only follow the voice through the row's own tokens. The
  // runtime matches each board token against the narration in front of the
  // tag; a row it cannot place falls back to a spread across the sentence and
  // finishes a second before the voice does. Measured over 6301 rows: every
  // token spoken in 13.9%, the estimated schedule usable in 80.9%, and "=" the
  // largest miss (unmatched in 2822 of 4267 rows) because the step said "is".
  // The rate is taken from the real schedule builder with no TTS timings,
  // which is the path every first sentence of a segment runs live.
  const rowWindows = windows.filter(
    (window) => window.command.type === "WRITE" && (window.command.text ?? "").trim().length > 0,
  );
  if (rowWindows.length >= 4) {
    const usable = rowWindows.filter((window) => {
      if (window.narration.length === 0) return false;
      const schedule = getBestWriteCharScheduleMs(
        window.narration,
        window.command,
        null,
        undefined,
        window.textCommandIndex,
      );
      return Boolean(schedule?.matched);
    });
    // The unknown row "v = ?" is the one = with no spoken form: the sentence
    // says what we want, and "?" is never read aloud.
    const relationRows = rowWindows.filter((window) => {
      const text = window.command.text ?? "";
      return text.includes("=") && !/=\s*\?\s*$/.test(text.trim());
    });
    const saidEquals = relationRows.filter((window) =>
      /\bequals\b|\bequal to\b/i.test(window.stepSpeech),
    );
    const usableFraction = usable.length / rowWindows.length;
    const equalsFraction = relationRows.length >= 3 ? saidEquals.length / relationRows.length : 1;
    if (usableFraction < 0.85 || equalsFraction < 0.9) {
      add(
        "row_unspoken_cue",
        "major",
        `${usable.length} of ${rowWindows.length} rows have a spoken cue the pen can be scheduled on` +
          (relationRows.length >= 3
            ? `, and ${saidEquals.length} of ${relationRows.length} rows with = are spoken as equals`
            : ""),
      );
    }
    // A row said second in a two-sentence step has its first token late in the
    // window, and the runtime used to drag that cue to the sentence start, so
    // the pen wrote the row while the voice was still on the reason.
    const cued = rowWindows
      .map((window) => firstCueFraction(window))
      .filter((fraction): fraction is number => fraction !== null);
    const late = cued.filter((fraction) => fraction > 0.35);
    if (cued.length >= 4 && late.length / cued.length > 0.15) {
      add(
        "late_row_cue",
        "minor",
        `${late.length} of ${cued.length} rows are first spoken past 35% of their sentence, so the words that name the row are not last`,
      );
    }
  }

  // The runtime lays work rows out sequentially (`findWorkTextSlot`), so the y
  // the model sends is advisory and a "wrong" ladder value costs nothing. What
  // does cost the student: a row the parser dropped, a row wide enough to eat
  // three display lines, and the same line written twice.
  // Both spellings: `[WRITE:` is the contract, `[WRITE]` is the malformed form
  // the parser repairs. A bare header that carries no row compiles to nothing,
  // and counting only the contract spelling hid that.
  const writeTagCount = (run.teaching.rawText.match(/\[WRITE[:\]]/gi) ?? []).length;
  if (writeTagCount > inkedWrites.length) {
    add(
      "dropped_rows",
      "major",
      `${writeTagCount - inkedWrites.length} of ${writeTagCount} [WRITE] tags carried no row and never reached the board`,
    );
  }
  const columnWidth = run.diagram.committed
    ? WORK_ZONE.maxTextWidth
    : WORK_ZONE.fullWidthTextWidth;
  const overflowing = writes.filter(
    (write) =>
      fitBoardText(write.text, { role: "work", maxWidth: columnWidth }).lines.length >
      2,
  );
  if (overflowing.length > 0) {
    add(
      "rows_overflow_column",
      "minor",
      `${overflowing.length} rows wrap past two lines in a ${columnWidth}px column (e.g. "${overflowing[0].text.slice(0, 60)}")`,
    );
  }
  const rowCounts = new Map<string, number>();
  for (const write of writes) {
    const key = write.text.replace(/\s+/g, " ").trim().toLowerCase();
    if (!key) continue;
    rowCounts.set(key, (rowCounts.get(key) ?? 0) + 1);
  }
  const repeated = [...rowCounts.entries()].filter(([, count]) => count > 1);
  if (repeated.length > 0) {
    add(
      "repeated_rows",
      "major",
      `${repeated.length} lines were written more than once (e.g. "${repeated[0][0].slice(0, 60)}")`,
    );
  }

  // Does anything on the board stand out?
  //
  // This check used to demand that the [EMPHASIZE:last] sit in the same step as
  // a formula row, and reported 137 of 342 lectures as unemphasised. Measured
  // directly, 273 of 327 emphasise something and 264 emphasise in the closing
  // stretch where the answer lives: the tag simply lands in the step after the
  // row, which is where it belongs, since it boxes the row already written.
  // What is worth flagging is a lesson that boxes nothing at all, and one that
  // boxes only early rows and leaves the answer unmarked on a full page.
  const formulaSteps = steps.filter((step) =>
    step.tags.some(
      (tag) => tag.type === "WRITE" && /[=<>]|\b(?:sqrt|sum|int)\b/.test(tag.text ?? ""),
    ),
  );
  const emphasisedSteps = steps.filter((step) =>
    step.tags.some((tag) => tag.type === "EMPHASIZE"),
  );
  const lastEmphasis = emphasisedSteps.at(-1)?.index ?? 0;
  if (formulaSteps.length >= 3) {
    if (emphasisedSteps.length === 0) {
      add(
        "no_emphasis",
        "major",
        `${formulaSteps.length} steps wrote a relation or a result and nothing was boxed with [EMPHASIZE:last]`,
      );
    } else if (lastEmphasis < steps.length * 0.6) {
      add(
        "answer_not_boxed",
        "minor",
        `the last box is at step ${lastEmphasis} of ${steps.length}, so the closing result is unmarked`,
      );
    } else if (emphasisedSteps.length > steps.length * 0.6) {
      add(
        "emphasis_everywhere",
        "minor",
        `${emphasisedSteps.length} of ${steps.length} steps box a row, so the box no longer marks anything`,
      );
    }
  }

  // Recompute what the board claims. A review lane found an emphasised final
  // answer ten times too large ("3.596e10 * 5 = 1.8e10") that every automated
  // check had passed; rows of that shape never need a person again.
  const arithmetic = checkBoardArithmetic(inkedWrites.map((write) => write.text));
  if (arithmetic.length > 0) {
    const first = arithmetic[0];
    add(
      "board_arithmetic_wrong",
      "fatal",
      `${arithmetic.length} board row(s) do not compute: "${first.row}" claims ${first.claimed} where ${first.left} is ${first.actual}`,
    );
  }

  // `[EMPHASIZE:last] [WRITE:...]` in one step boxes the row before it and then
  // writes a new one, so the box lands on the wrong line and the intended row
  // is often rewritten on the next step.
  const boxedBeforeWriting = steps.filter((step) => {
    const emphasis = step.tags.findIndex((tag) => tag.type === "EMPHASIZE");
    const write = step.tags.findIndex((tag) => tag.type === "WRITE");
    return emphasis >= 0 && write > emphasis;
  });
  if (boxedBeforeWriting.length > 0) {
    add(
      "emphasis_before_write",
      "major",
      `${boxedBeforeWriting.length} step(s) box a row before writing one, so the box lands on the previous line (steps ${boxedBeforeWriting.map((step) => step.index).join(", ")})`,
    );
  }

  // A label the tutor puts in quotes is a claim about what the student can read.
  const drawnLabels = new Set(
    run.diagram.renderedLabels.map((label) => label.trim().toLowerCase()),
  );
  if (run.diagram.committed && drawnLabels.size > 0) {
    const quoted = new Set<string>();
    for (const step of steps) {
      for (const match of step.speech.matchAll(/[“"']([^“”"']{1,24})[”"']/g)) {
        const claim = match[1].trim().toLowerCase();
        if (claim && !drawnLabels.has(claim)) quoted.add(match[1].trim());
      }
    }
    if (quoted.size > 0) {
      add(
        "quoted_label_absent",
        "major",
        `the lesson quotes ${[...quoted].slice(0, 5).map((label) => `"${label}"`).join(", ")} as written on the figure, which draws ${[...drawnLabels].slice(0, 6).join(", ")}`,
      );
    }
  }

  // Voice.
  const spokenText = steps.map((step) => step.speech).join(" ");
  // Thinking out loud. The student hears the tutor correcting itself.
  const hesitationHit =
    /\b(?:so wait|let me recheck|let me redo|let me try again|actually,|hold on)\b/i.exec(spokenText);
  if (hesitationHit) {
    add("hesitation_leak", "major", `the tutor corrects itself aloud: "${hesitationHit[0]}"`);
  }
  if (META_LEAK.test(spokenText)) {
    add("meta_leak", "fatal", `narration names the machinery: "${META_LEAK.exec(spokenText)?.[0]}"`);
  }
  if (DREW_IT_CLAIM.test(spokenText)) {
    add(
      "claimed_authorship",
      "major",
      `narration claims it drew the figure: "${DREW_IT_CLAIM.exec(spokenText)?.[0]}"`,
    );
  }
  // The contract says: after the last result, stop. Eleven of twenty lectures
  // ended on a line that re-states the lesson instead, so the check cannot key
  // on "to recap" alone. A closing row that only names what was already
  // covered ("summary: entropy, slopes, speeds", "done: E = ...") is the same
  // failure wearing different words.
  const tail = steps.slice(-2).map((step) => step.speech).join(" ");
  const closingRow = writes.at(-1)?.text ?? "";
  // Reviewers found recap rows in ten of twenty four lectures where this check
  // saw eleven in three hundred and forty two. They open with a label and then
  // list what was already covered: "summary: entropy, slopes, speeds",
  // "read: source -> R1 -> R2 -> return", "figure: fragments, path, levels",
  // "done: fission and levels", "key: E = -grad V".
  const recapRow =
    /^\s*(?:summary|summari[sz]e|so\b|recap|done|result[s]?|key(?:s|\s+idea)?|read|figure|overall|in\s+short|final(?:ly)?|that'?s\s+it|that\s+is\s+it)\b\s*[:,-]?/i.test(
      closingRow,
    );
  if (RECAP_LEAD.test(tail) || recapRow) {
    add(
      "recap_tail",
      "minor",
      recapRow
        ? `the lesson closes on a recap row rather than its result: "${closingRow.slice(0, 60)}"`
        : `the lesson ends with a recap or an invitation: "${RECAP_LEAD.exec(tail)?.[0]}"`,
    );
  }

  // Only a real punctuation dash counts. An earlier version flagged the minus
  // sign in "K_max = E_photon - φ" and the polarity marks on a battery, so it
  // fired on six lectures that contained no punctuation dash at all. The board
  // is full of arithmetic; a spaced hyphen there is almost always subtraction.
  const dashCarrier = [spokenText, ...writes.map((write) => write.text)].find(
    (text) => /[\u2013\u2014]/.test(text) || /[A-Za-z]{2,}\s-\s[A-Za-z]{2,}/.test(text),
  );
  if (dashCarrier) {
    add(
      "dash_punctuation",
      "minor",
      `a dash is used as punctuation: "${dashCarrier.slice(0, 80)}"`,
    );
  }

  if (run.teaching.incomplete) {
    add("truncated", "major", "the lesson ran out of continuations before it finished");
  }
  if (
    run.teaching.usedStepMarkers !== false &&
    run.teaching.rawText.length > 0 &&
    !run.teaching.rawText.trimEnd().endsWith("[/STEP]")
  ) {
    add("unterminated_step", "minor", "the last step was never closed");
  }

  // The answer the question asked for.
  if (numericAsk && run.solver?.hasProjection) {
    const boardText = [...writes.map((write) => write.text), spokenText].join(" ");
    const missing = (run.plan?.derived ?? []).filter((quantity) => {
      if (typeof quantity.value !== "number" || !Number.isFinite(quantity.value)) return false;
      return !numberAppears(boardText, quantity.value);
    });
    if (missing.length > 0 && missing.length === (run.plan?.derived ?? []).length) {
      add(
        "verified_values_unused",
        "major",
        `none of the ${missing.length} solver-verified values reached the board or the voice`,
      );
    }
  }

  const score = Math.max(
    0,
    100 - findings.reduce((total, finding) => total + SEVERITY_WEIGHT[finding.severity], 0),
  );

  return {
    probeId: run.probeId,
    transportFailure,
    topicId: run.topicId,
    unitId: run.unitId,
    question: run.question,
    passed: findings.every((finding) => finding.severity !== "fatal"),
    score,
    findings,
    metrics: {
      steps: steps.length,
      writes: writes.length,
      focusTags: run.teaching.focusIds.length,
      speechOnlySteps: speechOnly.length,
      diagramTier: run.diagram.tier ?? "none",
      diagramPrimitives: run.diagram.primitiveCount,
      planMs: run.timings.planMs,
      teachMs: run.timings.teachMs,
    },
  };
}

/**
 * A value counts as stated when it appears at three or four significant
 * figures. Matching the raw double would miss "9.8" written for 9.80665.
 */
function numberAppears(haystack: string, value: number): boolean {
  const candidates = new Set<string>();
  for (const digits of [2, 3, 4]) {
    candidates.add(value.toPrecision(digits));
    candidates.add(String(Number(value.toPrecision(digits))));
  }
  candidates.add(String(value));
  for (const candidate of candidates) {
    if (candidate.includes("e") || candidate.includes("E")) continue;
    if (haystack.includes(candidate)) return true;
    const stripped = candidate.replace(/\.?0+$/, "");
    if (stripped.length > 0 && haystack.includes(stripped)) return true;
  }
  return false;
}
