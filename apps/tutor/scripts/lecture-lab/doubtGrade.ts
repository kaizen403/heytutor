/**
 * Grades for the lecture lab doubt harness (`doubt-run.ts`).
 *
 * Pure over the stored evidence, so a finished round can be regraded after a
 * rubric change or a human judgment with no model call. The measurement set
 * (`data/doubt-probes/doubts-v1.jsonl`) is written from the subject: each row
 * says, in words, which figure part a teacher would point at, or what new
 * figure a teacher would draw, and `pointTerms` lists the marks a teacher
 * would write on that part. The automatic grade matches pointed parts against
 * those terms; anything it calls wrong goes to a human (`needsHuman`), and a
 * judgment in `judgments.jsonl` always wins over the rule.
 *
 * Grades (execution brief, section 5):
 * - pointing: right part / wrong part / no pointer;
 * - new figure: right / wrong / none when needed / drawn when not needed;
 * - saved equals live: every live FOCUS id survives the save round trip.
 */
import { LESSON_FIGURE_IDS, isLessonFigureView, type LessonFigureAsk, type LessonFigureId } from "../../lib/boards/lessonFigures";
import { normalizeDiagramLabel } from "./judging";

export const DOUBT_PROBE_LANES = [
  "physics_maths", "chemistry", "dsa", "reference_picture", "control",
  // doubts-v2 (round 2): a figure on an empty zone, over a picture, after a resume drew the lesson's, later lesson figures.
  "empty_zone", "picture_swap", "resume_drawn", "lesson_figures",
] as const;
export type DoubtProbeLane = (typeof DOUBT_PROBE_LANES)[number];
/** `lesson-figures`: the lesson runs with the planner's later-figures addon (DIAGRAM_LESSON_FIGURES), then the figures doubt. */
export const DOUBT_ARMS = ["today", "pointing", "figures", "lesson-figures"] as const;
export type DoubtArm = (typeof DOUBT_ARMS)[number];

/** Lanes whose rows are checked offline only ($0): the zone sequence and the precheck. */
export const OFFLINE_LANES: readonly DoubtProbeLane[] = ["resume_drawn"];

/** Whether a row runs in an arm: the lesson-figures arm is the lesson_figures lane's, every other arm the other lanes'. */
export function armAppliesTo(probe: Pick<DoubtProbe, "lane" | "offlineOnly">, arm: DoubtArm): boolean {
  if (probe.offlineOnly) return false;
  return arm === "lesson-figures" ? probe.lane === "lesson_figures" : probe.lane !== "lesson_figures";
}

/** What stands in the diagram zone, by whose figure it is. */
export type ZoneSide = "empty" | "lesson" | "doubt" | "picture" | "other";

export interface DoubtProbe {
  id: string;
  lane: DoubtProbeLane;
  /** The lesson asked first; the doubt is asked on its page after it finishes. */
  lessonQuestion: string;
  /** What the student types. May be empty only when the row carries a mark. */
  doubt: string;
  /** The student circled a figure part or a work row before asking. */
  mark: "figure_part" | "row" | null;
  /** What the circled thing says on the board, in a teacher's words. */
  markTerms: string[];
  /** DSA rows: which worked example frame is on the board (negative counts from the end). */
  dsaFrame: number | null;
  /** The lesson needs the reference picture tier (no verified figure is expected). */
  referencePicture: boolean;
  /** lesson_figures: the later views a teacher would pick (figure kind ids from the engine's closed list), injected as the plan's figures. */
  lessonFigureAsks: LessonFigureAsk[];
  /** Checked offline only ($0): never sent to a paid round. */
  offlineOnly: boolean;
  expect: {
    /** What the lesson's own figure should be, from the subject: drawn, none (text only), or a picture. Null: not stated. */
    lessonFigure: "drawn" | "none" | "picture" | null;
    /** What the zone holds after the lesson's resume, live and stored. Null: not checked. */
    zoneAfterResume: "empty" | "lesson" | "picture" | null;
    /** lesson_figures: what each later figure should show, one per ask. */
    figures: string[];
    /** The part to point at, in words, or null when no pointing is needed. */
    point: string | null;
    /** Marks a teacher would write on that part: labels, symbols, or names. */
    pointTerms: string[];
    /** What a new figure should show, or null when the doubt needs none. */
    newFigure: string | null;
    /** False when a new figure is wanted but out of scope, so none must be drawn. */
    newFigureInScope: boolean;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown, where: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new Error(`${where}: must be a list of non-empty strings`);
  }
  return (value as string[]).map((entry) => entry.trim());
}

function optionalText(value: unknown, where: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !value.trim()) throw new Error(`${where}: must be null or a non-empty string`);
  return value.trim();
}

/** Strict parse: one JSON object per line, `#` comments and blanks skipped. */
export function parseDoubtProbes(text: string): DoubtProbe[] {
  const probes: DoubtProbe[] = [];
  const ids = new Set<string>();
  text.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const where = `doubt probe line ${index + 1}`;
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      throw new Error(`${where}: not JSON`);
    }
    if (!isRecord(raw)) throw new Error(`${where}: not an object`);
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`${where}: id must be lowercase words joined by hyphens`);
    if (ids.has(id)) throw new Error(`${where}: duplicate id ${id}`);
    ids.add(id);
    const lane = raw.lane as DoubtProbeLane;
    if (!DOUBT_PROBE_LANES.includes(lane)) throw new Error(`${where}: unknown lane ${String(raw.lane)}`);
    const lessonQuestion = optionalText(raw.lessonQuestion, `${where} lessonQuestion`);
    if (!lessonQuestion) throw new Error(`${where}: lessonQuestion is required`);
    const doubt = typeof raw.doubt === "string" ? raw.doubt.trim() : "";
    const mark = raw.mark === undefined || raw.mark === null ? null : raw.mark;
    if (mark !== null && mark !== "figure_part" && mark !== "row") throw new Error(`${where}: mark must be figure_part, row or null`);
    const markTerms = stringList(raw.markTerms, `${where} markTerms`);
    if (mark !== null && markTerms.length === 0) throw new Error(`${where}: a mark needs markTerms`);
    if (mark === null && markTerms.length > 0) throw new Error(`${where}: markTerms without a mark`);
    if (!doubt && mark === null) throw new Error(`${where}: an unmarked doubt needs text`);
    if (raw.dsaFrame !== undefined && raw.dsaFrame !== null && !Number.isInteger(raw.dsaFrame)) {
      throw new Error(`${where}: dsaFrame must be an integer`);
    }
    if (raw.dsaFrame !== undefined && raw.dsaFrame !== null && lane !== "dsa") throw new Error(`${where}: dsaFrame on a non DSA row`);
    if (!isRecord(raw.expect)) throw new Error(`${where}: expect is required`);
    const point = optionalText(raw.expect.point, `${where} expect.point`);
    const pointTerms = stringList(raw.expect.pointTerms, `${where} expect.pointTerms`);
    if (point !== null && pointTerms.length === 0) throw new Error(`${where}: an expected point needs pointTerms`);
    if (point === null && pointTerms.length > 0) throw new Error(`${where}: pointTerms without a point`);
    const newFigure = optionalText(raw.expect.newFigure, `${where} expect.newFigure`);
    const inScope = raw.expect.newFigureInScope === undefined ? true : raw.expect.newFigureInScope;
    if (typeof inScope !== "boolean") throw new Error(`${where}: newFigureInScope must be boolean`);
    if (!inScope && newFigure === null) throw new Error(`${where}: newFigureInScope false needs a newFigure`);
    if (lane === "control" && (point !== null || newFigure !== null)) throw new Error(`${where}: a control expects neither`);
    const lessonFigure = raw.expect.lessonFigure ?? null;
    if (lessonFigure !== null && lessonFigure !== "drawn" && lessonFigure !== "none" && lessonFigure !== "picture") {
      throw new Error(`${where}: expect.lessonFigure must be drawn, none, picture or null`);
    }
    const zoneAfterResume = raw.expect.zoneAfterResume ?? null;
    if (zoneAfterResume !== null && zoneAfterResume !== "empty" && zoneAfterResume !== "lesson" && zoneAfterResume !== "picture") {
      throw new Error(`${where}: expect.zoneAfterResume must be empty, lesson, picture or null`);
    }
    const figures = stringList(raw.expect.figures, `${where} expect.figures`);
    const asksRaw = raw.lessonFigureAsks === undefined ? [] : raw.lessonFigureAsks;
    if (!Array.isArray(asksRaw)) throw new Error(`${where}: lessonFigureAsks must be a list`);
    const lessonFigureAsks = asksRaw.map((entry, at): LessonFigureAsk => {
      const id = LESSON_FIGURE_IDS[at];
      if (!id || !isRecord(entry) || entry.id !== id || !isLessonFigureView(entry.view) || Object.keys(entry).length !== 2) {
        throw new Error(`${where}: lessonFigureAsks[${at}] must be { id: "${id ?? "none"}", view: a figure kind id } and nothing else`);
      }
      return { id: id as LessonFigureId, view: entry.view };
    });
    if ((lane === "lesson_figures") !== (lessonFigureAsks.length > 0)) throw new Error(`${where}: lessonFigureAsks belong to the lesson_figures lane only, and it needs them`);
    if (figures.length !== lessonFigureAsks.length) throw new Error(`${where}: expect.figures needs one entry per ask`);
    if (raw.offlineOnly !== undefined && typeof raw.offlineOnly !== "boolean") throw new Error(`${where}: offlineOnly must be boolean`);
    probes.push({
      id,
      lane,
      lessonQuestion,
      doubt,
      mark,
      markTerms,
      dsaFrame: typeof raw.dsaFrame === "number" ? raw.dsaFrame : null,
      referencePicture: raw.referencePicture === true || lane === "reference_picture" || lane === "picture_swap",
      lessonFigureAsks,
      offlineOnly: raw.offlineOnly === true || OFFLINE_LANES.includes(lane),
      expect: { lessonFigure, zoneAfterResume, figures, point, pointTerms, newFigure, newFigureInScope: inScope },
    });
  });
  return probes;
}

/** A figure part the doubt's kept FOCUS or ANNOTATE resolved to on the board. */
export interface PointedPart {
  id: string;
  labels: string[];
  via: "FOCUS" | "ANNOTATE";
  /** `|keep`: the ring stays while the page is up. */
  kept: boolean;
}

/** What one doubt did, stored per row and arm; everything the grade reads. */
export interface DoubtEvidence {
  probeId: string;
  arm: DoubtArm;
  /** A figure (verified scene, reference picture or DSA frame) was in the zone. */
  figurePresent: boolean;
  pointed: PointedPart[];
  /** Target ids of FOCUS / ANNOTATE the live filter let through, in order spoken. */
  liveFocusIds: string[];
  liveAnnotateIds: string[];
  /** The same after the in-process save round trip. */
  savedFocusIds: string[];
  savedAnnotateIds: string[];
  saveOk: boolean;
  saveError: string | null;
  /** The server could not resolve `pointsAtFigure` (should never happen in the lab). */
  pointsAtFigureUnresolved: boolean;
  /** Phase 2: a figure the doubt drew. Null while the arm cannot draw one. */
  newFigure: { drawn: boolean; summary: string | null } | null;
  ttftMs: number | null;
  error: string | null;
  /** The zone across the page's turns, live against stored (`doubt-zone.ts`). Absent on older rounds. */
  zone?: ZoneEvidence | null;
  /** lesson-figures arm: the lesson's later figures and its advance cues. */
  lessonFigures?: LessonFiguresEvidence | null;
}

/** The zone after each turn of a page sequence such as [lesson, doubt, resume, plain doubt]. */
export interface ZoneEvidence {
  sequence: string;
  live: ZoneSide[];
  /** What `pageFigureAt` reads for each turn (replay, restore, export). */
  stored: ZoneSide[];
  /** What `syncStoredPageFigure` left in the zone, turn by turn on a fake whiteboard. */
  replay?: ZoneSide[];
  /** Per turn, the zone figure's fingerprint is the same live, stored and replayed. */
  storedEqualsLive: boolean;
  /** The zone once the lesson's resume ran (the last turn's view). */
  afterResume: { live: ZoneSide; stored: ZoneSide };
  /** A doubt figure was drawn where work ink already reached the zone. */
  drawnOverInk: boolean;
  error: string | null;
}

export type ZoneGrade = "ok" | "doubt_left_on_board" | "wrong_zone" | "stored_differs" | "drawn_over_ink" | "error" | "not_checked";

/** Zone after the resume: what the row expects, live and stored the same, never a doubt's figure left behind. */
export function gradeZone(probe: Pick<DoubtProbe, "expect">, zone: ZoneEvidence | null | undefined): { grade: ZoneGrade; reasons: string[] } {
  if (!zone) return { grade: "not_checked", reasons: [] };
  if (zone.error) return { grade: "error", reasons: [`zone check failed: ${zone.error}`] };
  if (zone.drawnOverInk) return { grade: "drawn_over_ink", reasons: ["the doubt's figure was drawn over work ink"] };
  if (!zone.storedEqualsLive) {
    return { grade: "stored_differs", reasons: [`zone live ${zone.live.join(">")} but stored ${zone.stored.join(">")} (${zone.sequence})`] };
  }
  const expected = probe.expect.zoneAfterResume;
  if (expected === null) return { grade: "ok", reasons: [] };
  const { live, stored } = zone.afterResume;
  if (live === "doubt" || stored === "doubt") {
    return { grade: "doubt_left_on_board", reasons: [`the resume left the doubt's figure in the zone (expected ${expected})`] };
  }
  if (live !== expected || stored !== expected) return { grade: "wrong_zone", reasons: [`zone after resume ${live}/${stored}, expected ${expected}`] };
  return { grade: "ok", reasons: [] };
}

/** The lesson's later figures as the lesson-figures arm saw them. */
export interface LessonFiguresEvidence {
  asks: LessonFigureAsk[];
  drawn: Array<{ id: LessonFigureId; family: string | null; tier: string | null; parts: string[] }>;
  misses: Array<{ id: LessonFigureId; reason: string }>;
  /** Advance cues the teaching spoke, in order. */
  advances: LessonFigureId[];
  /** FOCUS ids spoken while figure k stood in the zone that resolved on figure k, and those that did not. */
  pointedOn: Partial<Record<LessonFigureId, string[]>>;
  unresolvedOn: Partial<Record<LessonFigureId, string[]>>;
}

export type LessonFigureGrade =
  | "right" | "wrong"
  /** Drawn and advanced to with a pointer after it; waits for a judge. */
  | "drawn_unjudged"
  /** No figure for the ask: allowed (never wrong), counted. */
  | "none"
  /** Drawn but the teaching never advanced to it. */
  | "drawn_not_advanced"
  /** Advanced, then no FOCUS landed on figure k's parts (the preparation cursor missed). */
  | "advance_without_pointer";

export function gradeLessonFigures(
  probe: Pick<DoubtProbe, "lessonFigureAsks">,
  evidence: LessonFiguresEvidence | null | undefined,
  judged?: "right" | "wrong",
): Array<{ id: LessonFigureId; grade: LessonFigureGrade }> {
  if (!evidence) return [];
  return probe.lessonFigureAsks.map(({ id }) => {
    if (!evidence.drawn.some((figure) => figure.id === id)) return { id, grade: "none" as const };
    if (!evidence.advances.includes(id)) return { id, grade: "drawn_not_advanced" as const };
    if ((evidence.pointedOn[id] ?? []).length === 0) return { id, grade: "advance_without_pointer" as const };
    return { id, grade: judged ?? "drawn_unjudged" };
  });
}

export type PointingGrade =
  | "right_part"
  | "wrong_part"
  | "no_pointer"
  /** A point was expected but the lesson drew nothing to point at: a lesson miss, not a doubt miss. */
  | "no_figure"
  | "not_expected"
  /** No point was expected and the doubt pointed anyway: recorded, not wrong. */
  | "pointed_unasked";

export type NewFigureGrade =
  | "right"
  | "wrong"
  /** Drawn where one was wanted; waits for a judge. */
  | "drawn_unjudged"
  | "none_when_needed"
  | "drawn_when_not_needed"
  | "ok_none"
  | "ok_out_of_scope"
  | "drawn_out_of_scope";

export interface DoubtJudgment {
  id: string;
  arm: DoubtArm;
  pointing?: "right_part" | "wrong_part" | "no_pointer";
  newFigure?: "right" | "wrong";
  /** The lesson's later figures (lesson-figures arm), judged together. */
  extraFigures?: "right" | "wrong";
  /** "right": every kept ring the rule flagged is on a part the doubt is about. */
  pins?: "right" | "wrong";
  by: string;
  reason: string;
}

export interface DoubtGrade {
  probeId: string;
  arm: DoubtArm;
  lane: DoubtProbeLane;
  pointing: PointingGrade;
  newFigure: NewFigureGrade;
  /** Ids ringed with `|keep` that are not the expected part (or any ring on a row expecting none). */
  wrongPins: string[];
  savedEqualsLive: boolean;
  lostFocusIds: string[];
  /** ANNOTATE the server dropped; reported, not part of the bar (a withheld answer is dropped by design). */
  lostAnnotateIds: string[];
  zone: ZoneGrade;
  lessonFigures: Array<{ id: LessonFigureId; grade: LessonFigureGrade }>;
  needsHuman: boolean;
  judgedBy: string | null;
  reasons: string[];
}

function norm(value: string): string {
  return normalizeDiagramLabel(value).toLowerCase().replace(/[_\-.,'’`]/g, "");
}

/**
 * True when a part carries one of the terms. A term of one or two characters
 * (`N`, `T`, `PC`) must equal a label or the id; a longer one may sit inside
 * either (`normal` in `normal_force`, `left ventricle` in `Left ventricle`).
 */
export function partMatchesTerms(part: Pick<PointedPart, "id" | "labels">, terms: readonly string[]): boolean {
  const names = [part.id, ...part.labels].map(norm).filter(Boolean);
  for (const raw of terms) {
    const term = norm(raw);
    if (!term) continue;
    if (names.some((name) => name === term)) return true;
    if (term.length >= 3 && names.some((name) => name.includes(term))) return true;
  }
  return false;
}

function lowerSet(values: readonly string[]): Set<string> {
  return new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean));
}

export function judgmentKey(id: string, arm: DoubtArm): string {
  return `${id}|${arm}`;
}

export function gradeDoubt(probe: DoubtProbe, evidence: DoubtEvidence, judgment?: DoubtJudgment | null): DoubtGrade {
  const reasons: string[] = [];
  let needsHuman = false;
  const { expect } = probe;

  let pointing: PointingGrade;
  if (expect.point === null) {
    pointing = evidence.pointed.length > 0 ? "pointed_unasked" : "not_expected";
  } else if (!evidence.figurePresent) {
    pointing = "no_figure";
    reasons.push("the lesson drew no figure, so the doubt had nothing to point at");
  } else if (evidence.pointed.length === 0) {
    pointing = "no_pointer";
  } else if (evidence.pointed.some((part) => partMatchesTerms(part, expect.pointTerms))) {
    pointing = "right_part";
  } else {
    pointing = "wrong_part";
    needsHuman = true;
    reasons.push(`pointed at ${evidence.pointed.map((part) => part.id).join(", ")}; expected ${expect.point}`);
  }

  let wrongPins = evidence.pointed
    .filter((part) => part.kept && (expect.point === null || !partMatchesTerms(part, expect.pointTerms)))
    .map((part) => part.id);
  if (wrongPins.length > 0) {
    needsHuman = true;
    reasons.push(`kept ring on ${wrongPins.join(", ")}`);
  }

  let newFigure: NewFigureGrade;
  const drawn = evidence.newFigure?.drawn === true;
  if (expect.newFigure !== null && !expect.newFigureInScope) {
    newFigure = drawn ? "drawn_out_of_scope" : "ok_out_of_scope";
  } else if (expect.newFigure !== null) {
    newFigure = drawn ? "drawn_unjudged" : "none_when_needed";
  } else {
    newFigure = drawn ? "drawn_when_not_needed" : "ok_none";
  }
  if (newFigure === "drawn_unjudged" || newFigure === "drawn_when_not_needed" || newFigure === "drawn_out_of_scope") {
    needsHuman = true;
  }

  let judgedBy: string | null = null;
  if (judgment) {
    judgedBy = judgment.by;
    if (judgment.pointing && expect.point !== null && evidence.figurePresent) pointing = judgment.pointing;
    // Drawn when not needed, or out of scope, stays what it is whatever the figure looks like.
    if (judgment.newFigure && drawn && expect.newFigure !== null && expect.newFigureInScope) newFigure = judgment.newFigure;
    if (judgment.pins === "right") wrongPins = [];
    if (judgment.reason) reasons.push(`judge: ${judgment.reason}`);
    // Someone has looked at this row; its verdicts are final.
    needsHuman = false;
  }

  const saved = lowerSet(evidence.savedFocusIds);
  const lostFocusIds = evidence.liveFocusIds.filter((id) => !saved.has(id.trim().toLowerCase()));
  const savedAnnotate = lowerSet(evidence.savedAnnotateIds);
  const lostAnnotateIds = evidence.liveAnnotateIds.filter((id) => !savedAnnotate.has(id.trim().toLowerCase()));
  const savedEqualsLive = evidence.saveOk && lostFocusIds.length === 0;
  if (!evidence.saveOk) reasons.push(`save failed: ${evidence.saveError ?? "unknown"}`);
  if (lostFocusIds.length > 0) reasons.push(`save dropped FOCUS ${lostFocusIds.join(", ")}`);
  if (evidence.pointsAtFigureUnresolved) reasons.push("the server could not resolve pointsAtFigure");

  const zone = gradeZone(probe, evidence.zone);
  reasons.push(...zone.reasons);
  const lessonFigures = gradeLessonFigures(probe, evidence.lessonFigures, judgment?.extraFigures);
  if (!judgment && lessonFigures.some((entry) => entry.grade === "drawn_unjudged")) needsHuman = true;
  for (const entry of lessonFigures) if (entry.grade !== "drawn_unjudged" && entry.grade !== "right") reasons.push(`${entry.id}: ${entry.grade}`);

  return {
    probeId: probe.id,
    arm: evidence.arm,
    lane: probe.lane,
    pointing,
    newFigure,
    wrongPins,
    savedEqualsLive,
    lostFocusIds,
    lostAnnotateIds,
    zone: zone.grade,
    lessonFigures,
    needsHuman,
    judgedBy,
    reasons,
  };
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

function countBy<T extends string>(values: readonly T[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

export interface DoubtArmSummary {
  arm: DoubtArm;
  rows: number;
  errors: number;
  pointing: Record<string, number>;
  newFigure: Record<string, number>;
  byLane: Record<string, { rows: number; rightPart: number; wrongPart: number; noPointer: number }>;
  wrongFigures: number;
  wrongParts: number;
  wrongPins: number;
  savedEqualsLive: { rows: number; equal: number; rate: number | null };
  zone: Record<string, number>;
  lessonFigures: Record<string, number>;
  /** p50 time to first word, doubts that drew no figure. */
  ttftP50Ms: number | null;
  needsHuman: number;
  bar: {
    noWrongFigures: boolean;
    noWrongPins: boolean;
    savedEqualsLiveAll: boolean;
    /** Every checked row: the zone stored equals live, and no doubt figure left behind or drawn over ink. */
    zoneAll: boolean | null;
    /** Null when there is no baseline arm in the round. */
    ttftWithinHalfSecond: boolean | null;
  };
}

/** Per arm totals and the bar. `baselineArm` is the arm the p50 is compared with. */
export function summarizeDoubtGrades(
  grades: readonly DoubtGrade[],
  evidence: readonly DoubtEvidence[],
  baselineArm: DoubtArm = "today",
): DoubtArmSummary[] {
  const arms = [...new Set(grades.map((grade) => grade.arm))];
  const evidenceByKey = new Map(evidence.map((row) => [judgmentKey(row.probeId, row.arm), row]));
  const ttftFor = (arm: DoubtArm) => median(grades
    .filter((grade) => grade.arm === arm)
    .map((grade) => evidenceByKey.get(judgmentKey(grade.probeId, arm)))
    .filter((row): row is DoubtEvidence => Boolean(row) && row!.error === null && row!.newFigure?.drawn !== true && row!.ttftMs !== null)
    .map((row) => row.ttftMs!));
  const baseline = arms.includes(baselineArm) ? ttftFor(baselineArm) : null;
  return arms.map((arm) => {
    const armGrades = grades.filter((grade) => grade.arm === arm);
    const ok = armGrades.filter((grade) => evidenceByKey.get(judgmentKey(grade.probeId, arm))?.error === null);
    const byLane: DoubtArmSummary["byLane"] = {};
    for (const grade of ok) {
      const lane = byLane[grade.lane] ?? { rows: 0, rightPart: 0, wrongPart: 0, noPointer: 0 };
      lane.rows += 1;
      if (grade.pointing === "right_part") lane.rightPart += 1;
      if (grade.pointing === "wrong_part") lane.wrongPart += 1;
      if (grade.pointing === "no_pointer") lane.noPointer += 1;
      byLane[grade.lane] = lane;
    }
    const wrongFigures = ok.filter((grade) => grade.newFigure === "wrong" || grade.newFigure === "drawn_out_of_scope").length +
      ok.reduce((sum, grade) => sum + (grade.lessonFigures ?? []).filter((entry) => entry.grade === "wrong").length, 0);
    const zoneChecked = ok.filter((grade) => grade.zone !== undefined && grade.zone !== "not_checked");
    const wrongPins = ok.reduce((sum, grade) => sum + grade.wrongPins.length, 0);
    const equal = ok.filter((grade) => grade.savedEqualsLive).length;
    const ttftP50Ms = ttftFor(arm);
    return {
      arm,
      rows: armGrades.length,
      errors: armGrades.length - ok.length,
      pointing: countBy(ok.map((grade) => grade.pointing)),
      newFigure: countBy(ok.map((grade) => grade.newFigure)),
      byLane,
      wrongFigures,
      wrongParts: ok.filter((grade) => grade.pointing === "wrong_part").length,
      wrongPins,
      savedEqualsLive: { rows: ok.length, equal, rate: ok.length > 0 ? equal / ok.length : null },
      zone: countBy(zoneChecked.map((grade) => grade.zone)),
      lessonFigures: countBy(ok.flatMap((grade) => (grade.lessonFigures ?? []).map((entry) => entry.grade))),
      ttftP50Ms,
      needsHuman: ok.filter((grade) => grade.needsHuman).length,
      bar: {
        noWrongFigures: wrongFigures === 0,
        noWrongPins: wrongPins === 0,
        savedEqualsLiveAll: ok.length > 0 && equal === ok.length,
        zoneAll: zoneChecked.length === 0 ? null : zoneChecked.every((grade) => grade.zone === "ok"),
        ttftWithinHalfSecond: arm === baselineArm || baseline === null || ttftP50Ms === null
          ? null
          : ttftP50Ms - baseline <= 500,
      },
    };
  });
}

/** Strict parse of `judgments.jsonl`; later lines win. */
export function parseDoubtJudgments(text: string): Map<string, DoubtJudgment> {
  const out = new Map<string, DoubtJudgment>();
  text.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const raw = JSON.parse(trimmed) as Partial<DoubtJudgment>;
    const where = `judgment line ${index + 1}`;
    if (typeof raw.id !== "string" || !DOUBT_ARMS.includes(raw.arm as DoubtArm)) throw new Error(`${where}: id and arm are required`);
    if (raw.pointing !== undefined && !["right_part", "wrong_part", "no_pointer"].includes(raw.pointing)) throw new Error(`${where}: bad pointing verdict`);
    if (raw.newFigure !== undefined && !["right", "wrong"].includes(raw.newFigure)) throw new Error(`${where}: bad newFigure verdict`);
    if (raw.pins !== undefined && !["right", "wrong"].includes(raw.pins)) throw new Error(`${where}: bad pins verdict`);
    if (raw.extraFigures !== undefined && !["right", "wrong"].includes(raw.extraFigures)) throw new Error(`${where}: bad extraFigures verdict`);
    if (typeof raw.by !== "string" || !raw.by.trim()) throw new Error(`${where}: by is required`);
    out.set(judgmentKey(raw.id, raw.arm as DoubtArm), {
      id: raw.id, arm: raw.arm as DoubtArm, pointing: raw.pointing, newFigure: raw.newFigure, pins: raw.pins, extraFigures: raw.extraFigures,
      by: raw.by, reason: typeof raw.reason === "string" ? raw.reason : "",
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Synthetic checks (run with `doubt-run.ts --check`). No model, no server.
// ---------------------------------------------------------------------------

export function doubtGradeSelfCheck(): { checks: number; failures: string[] } {
  const failures: string[] = [];
  let checks = 0;
  const check = (condition: unknown, message: string) => {
    checks += 1;
    if (!condition) failures.push(message);
  };
  const probe = (overrides: Omit<Partial<DoubtProbe>, "expect"> & { expect?: Partial<DoubtProbe["expect"]> } = {}): DoubtProbe => ({
    id: "incline-normal",
    lane: "physics_maths",
    lessonQuestion: "A block rests on a 30 degree incline.",
    doubt: "why is the normal force not mg?",
    mark: null,
    markTerms: [],
    dsaFrame: null,
    referencePicture: false,
    lessonFigureAsks: [],
    offlineOnly: false,
    ...overrides,
    expect: {
      lessonFigure: null, zoneAfterResume: null, figures: [],
      point: "the normal reaction", pointTerms: ["N", "normal"], newFigure: null, newFigureInScope: true, ...overrides.expect,
    },
  });
  const evidence = (overrides: Partial<DoubtEvidence> = {}): DoubtEvidence => ({
    probeId: "incline-normal",
    arm: "pointing",
    figurePresent: true,
    pointed: [],
    liveFocusIds: [],
    liveAnnotateIds: [],
    savedFocusIds: [],
    savedAnnotateIds: [],
    saveOk: true,
    saveError: null,
    pointsAtFigureUnresolved: false,
    newFigure: null,
    ttftMs: 900,
    error: null,
    ...overrides,
  });
  const normal: PointedPart = { id: "normal_force", labels: ["N"], via: "FOCUS", kept: false };
  const weight: PointedPart = { id: "weight", labels: ["mg"], via: "FOCUS", kept: false };

  // Term matching.
  check(partMatchesTerms({ id: "force_3", labels: ["N"] }, ["N"]), "a one letter term matches an equal label");
  check(!partMatchesTerms({ id: "incline_node", labels: ["θ"] }, ["N"]), "a one letter term never matches inside an id");
  check(partMatchesTerms({ id: "normal_force", labels: [] }, ["normal"]), "a long term matches inside an id");
  check(partMatchesTerms({ id: "part_4", labels: ["Left ventricle"] }, ["left ventricle"]), "a two word term matches a label, case and space free");
  check(partMatchesTerms({ id: "r2", labels: ["3 Ω"] }, ["3 ohm"]), "ohm spellings normalise");
  check(!partMatchesTerms({ id: "r1", labels: ["2 Ω"] }, ["3 Ω", "6 Ω"]), "a different resistor does not match");

  // Pointing.
  const right = gradeDoubt(probe(), evidence({ pointed: [weight, normal], liveFocusIds: ["weight", "normal_force"], savedFocusIds: ["weight", "normal_force"] }));
  check(right.pointing === "right_part", "the expected part among those pointed is right");
  check(right.savedEqualsLive && !right.needsHuman, "a clean round trip needs no human");
  const wrong = gradeDoubt(probe(), evidence({ pointed: [weight] }));
  check(wrong.pointing === "wrong_part" && wrong.needsHuman, "only another part is wrong and goes to a human");
  check(gradeDoubt(probe(), evidence()).pointing === "no_pointer", "nothing pointed is no pointer");
  check(gradeDoubt(probe(), evidence({ figurePresent: false })).pointing === "no_figure", "no lesson figure is its own grade");
  const control = probe({ lane: "control", expect: { point: null, pointTerms: [] } });
  check(gradeDoubt(control, evidence()).pointing === "not_expected", "a control that points at nothing");
  check(gradeDoubt(control, evidence({ pointed: [weight] })).pointing === "pointed_unasked", "a control that points is recorded, not wrong");

  // Pins.
  const pinnedWrong = gradeDoubt(probe(), evidence({ pointed: [normal, { ...weight, kept: true }] }));
  check(pinnedWrong.pointing === "right_part" && pinnedWrong.wrongPins.join() === "weight", "a ring on the wrong part is a wrong pin even when pointing is right");
  check(gradeDoubt(probe(), evidence({ pointed: [{ ...normal, kept: true }] })).wrongPins.length === 0, "a ring on the right part is fine");
  check(gradeDoubt(control, evidence({ pointed: [{ ...weight, kept: true }] })).wrongPins.length === 1, "any ring on a row expecting no point is a wrong pin");

  // New figure.
  const wantsFigure = probe({ expect: { point: null, pointTerms: [], newFigure: "the block's free body diagram" } });
  check(gradeDoubt(wantsFigure, evidence()).newFigure === "none_when_needed", "phase 1 draws nothing: none when needed");
  check(gradeDoubt(wantsFigure, evidence({ newFigure: { drawn: true, summary: "fbd" } })).newFigure === "drawn_unjudged", "a drawn figure waits for a judge");
  check(gradeDoubt(probe(), evidence({ newFigure: { drawn: true, summary: "x" } })).newFigure === "drawn_when_not_needed", "drawn when not needed");
  check(gradeDoubt(probe(), evidence()).newFigure === "ok_none", "none when none is wanted");
  const outOfScope = probe({ lane: "dsa", expect: { point: null, pointTerms: [], newFigure: "a BST", newFigureInScope: false } });
  check(gradeDoubt(outOfScope, evidence()).newFigure === "ok_out_of_scope", "out of scope and not drawn is right");
  check(gradeDoubt(outOfScope, evidence({ newFigure: { drawn: true, summary: "bst" } })).newFigure === "drawn_out_of_scope", "out of scope and drawn is wrong");

  // Save round trip.
  const lost = gradeDoubt(probe(), evidence({ pointed: [normal], liveFocusIds: ["normal_force", "weight"], savedFocusIds: ["Normal_Force"] }));
  check(!lost.savedEqualsLive && lost.lostFocusIds.join() === "weight", "a FOCUS id lost in the save fails saved equals live; case is ignored");
  check(!gradeDoubt(probe(), evidence({ saveOk: false, saveError: "400" })).savedEqualsLive, "a failed save is never equal");
  const annotate = gradeDoubt(probe(), evidence({ liveAnnotateIds: ["answer"], savedAnnotateIds: [] }));
  check(annotate.savedEqualsLive && annotate.lostAnnotateIds.join() === "answer", "a dropped ANNOTATE is reported but not part of the bar");

  // Judgments win.
  const judged = gradeDoubt(probe(), evidence({ pointed: [weight] }), { id: "incline-normal", arm: "pointing", pointing: "right_part", by: "human", reason: "mg cos is drawn on the weight" });
  check(judged.pointing === "right_part" && !judged.needsHuman && judged.judgedBy === "human", "a judgment overrides the rule");
  const judgedFigure = gradeDoubt(wantsFigure, evidence({ newFigure: { drawn: true, summary: "fbd" } }), { id: "incline-normal", arm: "pointing", newFigure: "wrong", by: "human", reason: "" });
  check(judgedFigure.newFigure === "wrong", "a judged wrong figure");
  const pinJudged = (pins: "right" | "wrong") => gradeDoubt(probe(), evidence({ pointed: [normal, { ...weight, kept: true }] }),
    { id: "incline-normal", arm: "pointing", pins, by: "human", reason: "" });
  check(pinJudged("right").wrongPins.length === 0, "a judge can clear a ring the rule flagged");
  check(pinJudged("wrong").wrongPins.join() === "weight", "a judge can confirm a wrong ring");

  // Summary and bar.
  const rows: DoubtEvidence[] = [
    evidence({ probeId: "a", arm: "today", ttftMs: 1000 }),
    evidence({ probeId: "b", arm: "today", ttftMs: 1200 }),
    evidence({ probeId: "a", arm: "pointing", ttftMs: 1300, pointed: [normal], liveFocusIds: ["normal_force"], savedFocusIds: ["normal_force"] }),
    evidence({ probeId: "b", arm: "pointing", ttftMs: 1900, pointed: [{ ...weight, kept: true }] }),
  ];
  const grades = rows.map((row) => gradeDoubt({ ...probe(), id: row.probeId }, row));
  const summary = summarizeDoubtGrades(grades, rows);
  const today = summary.find((arm) => arm.arm === "today")!;
  const pointing = summary.find((arm) => arm.arm === "pointing")!;
  check(today.ttftP50Ms === 1100 && pointing.ttftP50Ms === 1600, "p50 per arm");
  check(pointing.bar.ttftWithinHalfSecond === true, "500 ms slower is within the bar");
  check(today.bar.ttftWithinHalfSecond === null, "the baseline arm is not compared with itself");
  check(pointing.wrongPins === 1 && !pointing.bar.noWrongPins, "a wrong pin fails the bar");
  check(pointing.byLane.physics_maths?.rightPart === 1 && pointing.byLane.physics_maths?.wrongPart === 1, "lane counts");
  const slow = summarizeDoubtGrades(grades, rows.map((row) => row.arm === "pointing" ? { ...row, ttftMs: 2000 } : row));
  check(slow.find((arm) => arm.arm === "pointing")!.bar.ttftWithinHalfSecond === false, "900 ms slower fails the bar");

  // Zone after the resume (doubts-v2 empty_zone, picture_swap, resume_drawn).
  const emptyZoneRow = probe({ lane: "empty_zone", expect: { point: null, pointTerms: [], newFigure: "the block's forces", zoneAfterResume: "empty" } });
  const zone = (afterLive: ZoneSide, afterStored: ZoneSide, overrides: Partial<ZoneEvidence> = {}): ZoneEvidence => ({
    sequence: "L text, D fig, R", live: ["empty", "doubt", afterLive], stored: ["empty", "doubt", afterStored],
    storedEqualsLive: afterLive === afterStored, afterResume: { live: afterLive, stored: afterStored }, drawnOverInk: false, error: null,
    ...overrides,
  });
  check(gradeZone(emptyZoneRow, zone("empty", "empty")).grade === "ok", "an empty zone back to empty after the resume is ok");
  // The lane 7 mutation: a doubt figure the resume left on an empty-zone board must never grade ok.
  check(gradeZone(emptyZoneRow, zone("doubt", "doubt")).grade === "doubt_left_on_board", "a doubt figure the resume left on an empty zone is not ok");
  check(gradeDoubt(emptyZoneRow, evidence({ zone: zone("doubt", "doubt") })).zone === "doubt_left_on_board", "gradeDoubt carries the zone grade");
  check(gradeZone(emptyZoneRow, zone("empty", "doubt")).grade === "stored_differs", "stored not equal to live fails first");
  check(gradeZone(emptyZoneRow, zone("empty", "empty", { drawnOverInk: true })).grade === "drawn_over_ink", "a figure over ink fails");
  check(gradeZone(probe({ expect: { zoneAfterResume: "lesson" } }), zone("empty", "empty")).grade === "wrong_zone", "a lesson figure that never came back is the wrong zone");
  check(gradeZone(emptyZoneRow, null).grade === "not_checked", "no zone evidence is not checked");
  const zoneRows: DoubtEvidence[] = [
    evidence({ probeId: "z1", arm: "figures", zone: zone("empty", "empty") }),
    evidence({ probeId: "z2", arm: "figures", zone: zone("doubt", "doubt") }),
  ];
  const zoneSummary = summarizeDoubtGrades(zoneRows.map((row) => gradeDoubt({ ...emptyZoneRow, id: row.probeId }, row)), zoneRows)[0]!;
  check(zoneSummary.bar.zoneAll === false && zoneSummary.zone.doubt_left_on_board === 1, "a doubt left on the board fails the zone bar");

  // Later lesson figures (lesson-figures arm).
  const figuresRow = probe({ lane: "lesson_figures", lessonFigureAsks: [{ id: "figure_2", view: "state_plot" }],
    expect: { point: null, pointTerms: [], figures: ["the velocity time graph"] } });
  const extra = (overrides: Partial<LessonFiguresEvidence> = {}): LessonFiguresEvidence => ({
    asks: figuresRow.lessonFigureAsks, drawn: [{ id: "figure_2", family: "graph", tier: "exact_verified", parts: ["curve"] }],
    misses: [], advances: ["figure_2"], pointedOn: { figure_2: ["curve"] }, unresolvedOn: {}, ...overrides,
  });
  check(gradeLessonFigures(figuresRow, extra())[0]?.grade === "drawn_unjudged", "a drawn, advanced, pointed figure waits for a judge");
  check(gradeLessonFigures(figuresRow, extra({ drawn: [], advances: [] }))[0]?.grade === "none", "no extra figure is none, never wrong");
  check(gradeLessonFigures(figuresRow, extra({ advances: [] }))[0]?.grade === "drawn_not_advanced", "drawn but never advanced to");
  check(gradeLessonFigures(figuresRow, extra({ pointedOn: {} }))[0]?.grade === "advance_without_pointer", "an advance with no pointer after it");
  const extraEvidence = evidence({ arm: "lesson-figures", lessonFigures: extra() });
  const judgedExtra = gradeDoubt(figuresRow, extraEvidence, { id: "incline-normal", arm: "lesson-figures", extraFigures: "wrong", by: "human", reason: "" });
  check(judgedExtra.lessonFigures[0]?.grade === "wrong" && summarizeDoubtGrades([judgedExtra], [extraEvidence])[0]!.wrongFigures === 1,
  "a judged wrong extra figure counts as a wrong figure");
  check(armAppliesTo(figuresRow, "lesson-figures") && !armAppliesTo(figuresRow, "figures") && !armAppliesTo(emptyZoneRow, "lesson-figures"),
    "the lesson-figures arm runs the lesson_figures lane only");
  check(!armAppliesTo({ lane: "resume_drawn", offlineOnly: true }, "figures"), "an offline row runs in no paid arm");

  // Probe parsing.
  const line = (value: unknown) => JSON.stringify(value);
  const base = { id: "a-b", lane: "physics_maths", lessonQuestion: "q", doubt: "d", expect: { point: null, newFigure: null } };
  check(parseDoubtProbes(`# comment\n\n${line(base)}\n`).length === 1, "a valid row parses");
  const rejects = (value: unknown, message: string) => {
    try {
      parseDoubtProbes(line(value));
      failures.push(`parse should reject: ${message}`);
    } catch {
      // expected
    }
    checks += 1;
  };
  rejects({ ...base, id: "A B" }, "a bad id");
  rejects({ ...base, lane: "biology" }, "an unknown lane");
  rejects({ ...base, expect: { point: "x", newFigure: null } }, "a point without terms");
  rejects({ ...base, mark: "figure_part" }, "a mark without terms");
  rejects({ ...base, lane: "control", expect: { point: null, newFigure: "x" } }, "a control expecting a figure");
  rejects({ ...base, doubt: "" }, "an empty unmarked doubt");
  rejects({ ...base, dsaFrame: 2 }, "a DSA frame on a non DSA row");
  const figuresBase = { ...base, lane: "lesson_figures", lessonFigureAsks: [{ id: "figure_2", view: "contact_body" }],
    expect: { point: null, newFigure: null, figures: ["the forces on the block"], lessonFigure: "drawn" } };
  const parsedFigures = parseDoubtProbes(line(figuresBase))[0]!;
  check(parsedFigures.lessonFigureAsks[0]?.view === "contact_body" && parsedFigures.expect.lessonFigure === "drawn",
    "a lesson_figures row parses its asks");
  check(parseDoubtProbes(line({ ...base, lane: "resume_drawn" }))[0]!.offlineOnly, "a resume_drawn row is offline only");
  check(parseDoubtProbes(line({ ...base, lane: "picture_swap" }))[0]!.referencePicture, "a picture_swap row runs the picture tier");
  rejects({ ...figuresBase, lessonFigureAsks: [{ id: "figure_2", ask: "free body diagram of the block" }] }, "an ask in words");
  rejects({ ...figuresBase, lessonFigureAsks: [{ id: "figure_2", view: "contact_body", ask: "on a smooth incline" }] }, "words beside a view");
  rejects({ ...figuresBase, lessonFigureAsks: [{ id: "figure_2", view: "free body diagram" }] }, "a view outside the closed list");
  rejects({ ...figuresBase, lessonFigureAsks: [{ id: "figure_3", view: "contact_body" }] }, "asks out of id order");
  rejects({ ...figuresBase, expect: { ...figuresBase.expect, figures: [] } }, "an ask without its expected figure");
  rejects({ ...base, lessonFigureAsks: figuresBase.lessonFigureAsks, expect: { ...base.expect, figures: ["x"] } }, "asks outside the lesson_figures lane");
  rejects({ ...base, expect: { ...base.expect, zoneAfterResume: "doubt" } }, "a zone that leaves the doubt's figure");
  try {
    parseDoubtProbes(`${line(base)}\n${line(base)}`);
    failures.push("parse should reject a duplicate id");
  } catch {
    // expected
  }
  checks += 1;

  return { checks, failures };
}
