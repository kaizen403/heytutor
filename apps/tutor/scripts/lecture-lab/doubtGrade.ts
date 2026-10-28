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
import { normalizeDiagramLabel } from "./judging";

export const DOUBT_PROBE_LANES = ["physics_maths", "chemistry", "dsa", "reference_picture", "control"] as const;
export type DoubtProbeLane = (typeof DOUBT_PROBE_LANES)[number];
export const DOUBT_ARMS = ["today", "pointing", "figures"] as const;
export type DoubtArm = (typeof DOUBT_ARMS)[number];

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
  expect: {
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
    probes.push({
      id,
      lane,
      lessonQuestion,
      doubt,
      mark,
      markTerms,
      dsaFrame: typeof raw.dsaFrame === "number" ? raw.dsaFrame : null,
      referencePicture: raw.referencePicture === true || lane === "reference_picture",
      expect: { point, pointTerms, newFigure, newFigureInScope: inScope },
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
  /** p50 time to first word, doubts that drew no figure. */
  ttftP50Ms: number | null;
  needsHuman: number;
  bar: {
    noWrongFigures: boolean;
    noWrongPins: boolean;
    savedEqualsLiveAll: boolean;
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
    const wrongFigures = ok.filter((grade) => grade.newFigure === "wrong" || grade.newFigure === "drawn_out_of_scope").length;
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
      ttftP50Ms,
      needsHuman: ok.filter((grade) => grade.needsHuman).length,
      bar: {
        noWrongFigures: wrongFigures === 0,
        noWrongPins: wrongPins === 0,
        savedEqualsLiveAll: ok.length > 0 && equal === ok.length,
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
    if (typeof raw.by !== "string" || !raw.by.trim()) throw new Error(`${where}: by is required`);
    out.set(judgmentKey(raw.id, raw.arm as DoubtArm), {
      id: raw.id, arm: raw.arm as DoubtArm, pointing: raw.pointing, newFigure: raw.newFigure, pins: raw.pins,
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
    ...overrides,
    expect: { point: "the normal reaction", pointTerms: ["N", "normal"], newFigure: null, newFigureInScope: true, ...overrides.expect },
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
  try {
    parseDoubtProbes(`${line(base)}\n${line(base)}`);
    failures.push("parse should reject a duplicate id");
  } catch {
    // expected
  }
  checks += 1;

  return { checks, failures };
}
