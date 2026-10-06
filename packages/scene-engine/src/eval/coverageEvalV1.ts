/**
 * DCP-01 frozen evaluation contract: coverage-eval/v1.
 *
 * Independent oracle for diagram coverage. Every classifier in this module is
 * frozen under the v1 version tag: changing any rule, unit set, or regex
 * requires a new version, a deliberate re-freeze, and a baseline diff review.
 * Nothing here imports the live capability manifest, planner, or compiler, so
 * the denominator cannot drift with engine growth. The system under test is
 * exercised separately by the report script through the live family-synthesis
 * path (the same path lectures use after a scene-planner timeout).
 *
 * Result schema (one row per corpus question):
 * - exact_verified | qualitative_verified | question_representation: a scene
 *   committed (mode=scene, primitives>0, zero fatal issues) with the tier the
 *   engine itself certified. Primitive count is a non-emptiness guard only and
 *   is never a success metric.
 * - text_only: independently classified as not needing a diagram, with a
 *   recorded frozen reason. An explicit visual request can never be text-only.
 * - coverage_gap: a required-visual row with no committable scene, with a gap
 *   reason. Gaps stay in the denominator.
 * - source_exclusion: unreadable/OCR-corrupt/short source with a stable
 *   reason. Reported separately; never counted as a successful scene.
 *
 * Rows outside the frozen v1 scope (unclassified status, non physics/maths
 * subject, unit outside the frozen diagram-led set) are out_of_scope and are
 * excluded from every rate. v1 makes no claim about them.
 */

import type { SceneDocument } from "../types";

export const COVERAGE_EVAL_VERSION = "coverage-eval/v1" as const;

export const COVERAGE_OUTCOMES = [
  "exact_verified",
  "qualitative_verified",
  "question_representation",
  "text_only",
  "coverage_gap",
  "source_exclusion",
  "out_of_scope",
] as const;

export type CoverageOutcome = (typeof COVERAGE_OUTCOMES)[number];

export type CoverageCohort = "tuning" | "holdout";

/** Frozen v1 source-quality exclusion reasons. */
export const SOURCE_EXCLUSION_REASONS = [
  "garbled_ocr",
  "short_stem",
  "heavy_non_ascii",
] as const;

export type SourceExclusionReason = (typeof SOURCE_EXCLUSION_REASONS)[number];

/** Frozen v1 legitimate text-only reasons. The list is closed: the gate fails on any other reason. */
export const TEXT_ONLY_REASONS = [
  "figure_absent_without_apparatus",
  "qualitative_concept_no_scene",
  "definition_or_units",
] as const;

export type TextOnlyReason = (typeof TEXT_ONLY_REASONS)[number];

/** Frozen v1 gap reasons. */
export const GAP_REASONS = [
  "no_scene_synthesized",
  "mode_not_scene",
  "zero_primitives",
  "validation_fatal",
] as const;

export type GapReason = (typeof GAP_REASONS)[number];

/**
 * Frozen v1 diagram-led units. A required-visual row must be in this set AND
 * carry a diagram cue (or an explicit visual request). Units outside this set
 * are out_of_scope in v1 — that is a scope statement, not a claim that those
 * units need no diagrams.
 */
export const V1_DIAGRAM_LED_UNITS: ReadonlySet<string> = new Set([
  "maths|7", "maths|8", "maths|9", "maths|10", "maths|11", "maths|12", "maths|14",
  "physics|2", "physics|3", "physics|4", "physics|5",
  "physics|6", "physics|7", "physics|8", "physics|9", "physics|10",
  "physics|11", "physics|12", "physics|13", "physics|14",
  "physics|15", "physics|16", "physics|17", "physics|18", "physics|19", "physics|20",
]);

// eslint-disable-next-line no-control-regex -- intentional non-ASCII detector for the frozen OCR screen
const NON_ASCII = /[^\x00-\x7F]/g;

/** Frozen v1 diagram-need cue: a stem that names drawable picture content. */
const V1_DIAGRAM_CUE =
  /\b(figure|diagram|graph|curve|plot|shown|shown in|circuit|ray|lens|mirror|prism|incline|slope|tangent|normal to|parabola|ellipse|hyperbola|circle|triangle|vector|field|trajectory|projectile|pendulum|wave|interference|diffraction)\b/i;

/** Frozen v1 explicit visual request: forces required-visual, never text-only. */
const V1_EXPLICIT_VISUAL_REQUEST =
  /\b(?:draw|diagram|illustrat(?:e|ion)|sketch|construct|plot|graph|locate|mark|show)\b/i;

const V1_GARBLED_OCR =
  /(?:Ho\$|\{bE|·¤|ÅtkZ|AmnH\$mo|Xem©E|feat ser arafea|ItemCode:|Topic Name:Physics)/i;
const V1_GARBLED_RUN = /(?:[²¬¾µŸ¯®×•‹†´»]{4,})/;

const V1_FIGURE_ABSENT =
  /\b(?:shown in the figure|as shown in the figure|the figure shows|figure shows|shaded region of the circle given below|circle given below)\b/i;
const V1_FIGURE_ABSENT_EXTRA =
  /(?:given below|as shown below).{0,80}(?:shaded|figure)|(?:equivalent capacitance of the combination shown|effective capacitance of the network.{0,80}shown)|(?:\bin the given figure\b|\bas shown in (?:the )?(?:figure|diagram)\b|\bshown in (?:the )?(?:figure|diagram)\b|\bsee (?:the )?figures?\b|\bin the figure\b)/i;
const V1_NAMED_APPARATUS =
  /(?:microscope|telescope|met(?:er|re) bridge|wheatstone|metal sheets|conducting walls|horizontal metal plates|parallel[- ]plate|upper wire|lens|mirror|prism|incline|pendulum)/i;

/** Frozen v1 qualitative-concept screen (offline oracle copy, not the live planner function). */
const V1_QUALITATIVE_CONCEPT =
  /\b(?:assertion|reason\s*\(?r?|which\s+of\s+the\s+following|which\s+of\s+these|correct\s+statement|statement(?:s)?\s+(?:is|are)|not\s+true|does\s+not\s+occur|true\s+about|match the motions|match list|column i\b|column ii\b)\b/i;
const V1_QUALITATIVE_SETUP =
  /(?:leans against a wall|ladder of mass|conical pendulum|banked|inclined plane|free[- ]body|ray path|rolling without slipping|met(?:er|re) bridge|wheatstone|equipotential|energy band|depletion[- ]region|p-n junction|solar cell|light emitting)/i;

const V1_DEFINITION_OR_UNITS =
  /\b(?:dimensional formula|dimensions of|have different dimensions|what is the SI unit|define the term)\b/i;
const V1_DEFINITION_APPARATUS = /(?:lens|mirror|circuit|incline|pendulum|projectile|slit)/i;

export function v1SourceExclusion(text: string): SourceExclusionReason | null {
  if (text.length < 30) return "short_stem";
  const nonAscii = text.match(NON_ASCII)?.length ?? 0;
  if (nonAscii / text.length >= 0.25) return "heavy_non_ascii";
  if ((text.match(/\$/g) ?? []).length >= 6) return "garbled_ocr";
  if (V1_GARBLED_OCR.test(text) || V1_GARBLED_RUN.test(text)) return "garbled_ocr";
  return null;
}

export function v1ExplicitVisualRequest(text: string): boolean {
  return V1_EXPLICIT_VISUAL_REQUEST.test(text);
}

function v1FigureAbsentWithoutApparatus(text: string): boolean {
  const stem = text.replace(/\s+/g, " ");
  if (!V1_FIGURE_ABSENT.test(stem) && !V1_FIGURE_ABSENT_EXTRA.test(stem)) return false;
  return !V1_NAMED_APPARATUS.test(stem);
}

/**
 * Frozen v1 diagram-need decision for an in-scope, readable row.
 *
 * - "required_visual": positive drawable demand (diagram cue or explicit
 *   visual request).
 * - TextOnlyReason: positively audited text-only class.
 * - "need_unresolved": no cue, no explicit request, no audited text-only
 *   class. v1 refuses to guess need here; the caller reports these rows as
 *   out_of_scope, never as text-only successes and never as gaps.
 */
export function v1DiagramNeed(
  text: string,
  unit: string,
): "required_visual" | TextOnlyReason | "need_unresolved" {
  const inDiagramLedUnit = V1_DIAGRAM_LED_UNITS.has(unit);
  if (!inDiagramLedUnit) return "need_unresolved";
  const explicit = v1ExplicitVisualRequest(text);
  if (v1FigureAbsentWithoutApparatus(text) && !explicit) {
    return "figure_absent_without_apparatus";
  }
  if (V1_DIAGRAM_CUE.test(text) || explicit) {
    return "required_visual";
  }
  if (V1_QUALITATIVE_CONCEPT.test(text) && !V1_QUALITATIVE_SETUP.test(text)) {
    return "qualitative_concept_no_scene";
  }
  if (V1_DEFINITION_OR_UNITS.test(text) && !V1_DEFINITION_APPARATUS.test(text)) {
    return "definition_or_units";
  }
  return "need_unresolved";
}

/** FNV-1a 32-bit hash (dependency-free; stable across platforms for this input shape). */
function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministic holdout assignment. fnv1a32(question_id) mod 8 === 7 lands in
 * the holdout cohort (~12.5%). The holdout is measured and reported but never
 * part of the tuning denominator or the ratchet baselines.
 */
export function v1Cohort(questionId: string): CoverageCohort {
  return fnv1a32(questionId) % 8 === 7 ? "holdout" : "tuning";
}

/**
 * Frozen v1 picture-demand oracle. Each sample names stems whose drawable
 * demand is unambiguous plus a structural check on the committed document,
 * read off operators/entities only — never the stem. A committed scene that
 * fails its sample's check is a wrong-family false certification and fails
 * the gate. An uncommitted sampled row is an ordinary coverage gap.
 */
export interface V1PictureSample {
  id: string;
  match: (stem: string) => boolean;
  demandMet: (document: SceneDocument) => boolean;
  demandDescription: string;
}

function v1IndependentLoops(document: SceneDocument): number {
  const nodes = new Set<string>();
  let edges = 0;
  for (const construction of document.constructions) {
    if (construction.operator !== "symbol" && construction.operator !== "connect") continue;
    const pick = (names: string[]): string | null => {
      for (const name of names) {
        const value = (construction.inputs as Record<string, unknown>)[name];
        if (typeof value === "string" && value) return value;
      }
      return null;
    };
    const start = pick(["start", "from", "a"]);
    const end = pick(["end", "to", "b"]);
    if (!start || !end || start === end) continue;
    nodes.add(start);
    nodes.add(end);
    edges += 1;
  }
  if (nodes.size === 0) return 0;
  return edges - nodes.size + 1;
}

export const V1_PICTURE_SAMPLES: ReadonlyArray<V1PictureSample> = [
  {
    id: "kirchhoff_two_loop",
    match: (stem) => /kirchhoff/i.test(stem) && /(?:network|loops?|junctions?)/i.test(stem),
    demandMet: (document) => v1IndependentLoops(document) >= 2,
    demandDescription: "multi-loop network topology (>=2 independent symbol/connect loops)",
  },
  {
    id: "river_banks",
    match: (stem) =>
      !/(?:rain falls|umbrella)/i.test(stem)
      && /(?:\bboat\b|still water)/i.test(stem)
      && /(?:\briver\b|\bcurrent\b|downstream|upstream|still water)/i.test(stem),
    demandMet: (document) =>
      document.entities.some((entity) => /bank/i.test(`${entity.id} ${entity.role}`)),
    demandDescription: "river-bank entities present",
  },
  {
    id: "named_hyperbola",
    match: (stem) => /\bhyperbola\b/i.test(stem),
    demandMet: (document) =>
      document.constructions.some((construction) => construction.operator === "implicit_curve"),
    demandDescription: "implicit-curve conic construction present",
  },
];

export interface V1RowClassification {
  outcome: CoverageOutcome;
  cohort: CoverageCohort;
  /** Closed reason for text_only / source_exclusion / coverage_gap rows. */
  reason: string;
}

/**
 * Pre-compile classification: scope, source quality, and diagram need.
 * Required-visual rows are returned with outcome "coverage_gap" as a
 * placeholder reason of "pending_compile" — the report script replaces it
 * after running the live synthesis path. This keeps the frozen oracle (need)
 * separate from the measured system (compile).
 */
export function v1ClassifyPreCompile(args: {
  questionId: string;
  text: string;
  status: string;
  subject: string;
  unit: string;
}): V1RowClassification {
  const cohort = v1Cohort(args.questionId);
  if (args.status !== "classified") {
    return { outcome: "out_of_scope", cohort, reason: `status_${args.status || "missing"}` };
  }
  if (args.subject !== "physics" && args.subject !== "maths") {
    return { outcome: "out_of_scope", cohort, reason: "subject_out_of_scope" };
  }
  if (!V1_DIAGRAM_LED_UNITS.has(args.unit)) {
    return { outcome: "out_of_scope", cohort, reason: "unit_out_of_scope" };
  }
  const exclusion = v1SourceExclusion(args.text);
  if (exclusion) {
    return { outcome: "source_exclusion", cohort, reason: exclusion };
  }
  const need = v1DiagramNeed(args.text, args.unit);
  if (need === "required_visual") {
    return { outcome: "coverage_gap", cohort, reason: "pending_compile" };
  }
  if (need === "need_unresolved") {
    return { outcome: "out_of_scope", cohort, reason: "need_unresolved_no_cue" };
  }
  return { outcome: "text_only", cohort, reason: need };
}
