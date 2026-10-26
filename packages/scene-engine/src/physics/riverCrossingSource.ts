/**
 * Boat and current speeds for a river crossing, bound by role words.
 *
 * Each speed literal takes its role from the words around it: "in still
 * water" / "relative to the water" after it, or the nearest boat cue
 * (boat, swimmer, rows, swims) or river cue (river, current, stream, flows)
 * before it in the same stretch of text. Mention order never decides a role.
 * Unless exactly one boat speed and one current speed are bound, in one unit,
 * the source is unbound and no river figure is drawn.
 */
import { STEM_NUMBER, parseStemNumber, prepareStem } from "../archetypes/slots";
import { MOTION_TIME_DIFFERENCE_KEYS, motionPlanConflicts, motionQuantityAuthority, type MotionBindings, type MotionDimension, type MotionPlanConflict, type MotionQuantityAuthority, type MotionValues } from "./motionPlanAgreement";

export interface RiverCrossingSpeeds {
  readonly status: "bound";
  /** Boat speed relative to the water, in `unit`. */
  readonly vb: number;
  /** Current speed relative to the ground, in `unit`. */
  readonly vc: number;
  readonly unit: "m/s" | "km/h";
  /** River width in metres, when the stem states one. */
  readonly widthM: number | null;
}

/** "unstated": no speed in the question, so only a qualitative sketch with symbolic labels is possible. */
export type RiverCrossingBinding = RiverCrossingSpeeds | { readonly status: "unbound" | "unstated"; readonly reason: string };

const SPEED_UNIT = String.raw`(?:km\s*\/\s*h(?:r|our)?|kmph|km\s*h(?:\^?-1|⁻¹)|m\s*\/\s*s|m\s*s(?:\^?-1|⁻¹))`;
const UNIT_END = String.raw`(?![\w²³⁻]|\s*\^)`;
const SPEED = new RegExp(`(?:\\+\\s*)?${STEM_NUMBER}\\s*(${SPEED_UNIT})${UNIT_END}`, "gi");
// Also notice unsupported speed units/expressions so they cannot turn into
// a numberless sketch, or disappear beside two supported speed quantities.
const SPEED_MENTION = /(?<![a-z])(?:(?:km|m|cm|mm|ft|feet|miles?|met(?:er|re)s?)\s*(?:\/\s*[a-z]+|per\s+(?:second|hour)s?\b)|(?:kmph|mph)\b|(?:km|m)\s*[hs]\b)/gi;
const WIDTH = new RegExp(`(?:\\+\\s*)?${STEM_NUMBER}\\s*(km|m)\\s+wide\\b|\\bwidth\\s+(?:of\\s+)?(?:the\\s+river\\s+)?(?:is\\s+|=\\s*)?(?:\\+\\s*)?${STEM_NUMBER}\\s*(km|m)${UNIT_END}`, "gi");
const WIDTH_MENTION = /(?<![a-z])(?:km|m|cm|mm|ft|feet)(?:\s*\^[-+]?\d+)?\s+wide\b|\bwidth\s+(?:of\s+)?(?:the\s+river\s+)?(?:is\s+|=\s*)?(?=[^.!?]*\b(?:km|m)\b)/gi;
const BOAT_AFTER = /^\s*(?:in|relative\s+to|with\s+respect\s+to|w\.?r\.?t\.?)\s+(?:the\s+)?(?:still|stationary|calm)\s+water\b|^\s*relative\s+to\s+(?:the\s+)?water\b/i;
const BOAT_CUE = /\b(?:still\s+water|boat|boatman|swimmer|swims?|swimming|rows?|rowing|paddles?|steamer|launch|ferry|motorboat|man|woman|boy|girl|person)\b/gi;
const RIVER_CUE = /\b(?:river|current|stream|flows?|flowing|water\s+(?:moves|runs))\b/gi;

function lastIndex(pattern: RegExp, text: string): number {
  let last = -1;
  for (const match of text.matchAll(pattern)) last = match.index ?? last;
  return last;
}

/** A supported scalar cannot be only the last operand of an expression. */
function wholeScalar(text: string, start: number): boolean {
  const before = text.slice(0, start).trimEnd();
  if (text[start] === "+" && /[\w)\]}]/.test(text[start - 1] ?? "")) return false;
  if (/[\w)\]}]\+\s*$/.test(before)) return false;
  const prefix = before.replace(/\+\s*$/, "").trimEnd();
  const addedToVariable = (text[start] === "+" || /\+\s*$/.test(before)) && /(?:^|\s)[a-zα-ω]$/i.test(prefix);
  return !addedToVariable && !/[/^*×÷π√·+-]$|[\d½¼¾)\]}]$|[\w)]\s*\($/.test(prefix);
}

export function riverCrossingSpeeds(question: string): RiverCrossingBinding {
  const text = prepareStem(question);
  const speeds = [...text.matchAll(SPEED)];
  const mentions = [...text.matchAll(SPEED_MENTION)].filter((match) => !/\b(?:in|units?\s+of)\s*$/i.test(text.slice(0, match.index)));
  if (speeds.length === 0 && mentions.length === 0) return { status: "unstated", reason: "the question states no speeds" };
  if (mentions.length !== speeds.length || speeds.some((match) => !wholeScalar(text, match.index ?? 0))) {
    return { status: "unbound", reason: "a speed quantity or unit is not supported whole" };
  }
  if (speeds.length !== 2) return { status: "unbound", reason: `expected two speeds, found ${speeds.length}` };
  const values = speeds.map((match) => parseStemNumber(match[1]!));
  if (values.some((value) => value === null || !Number.isFinite(value))) return { status: "unbound", reason: "a speed quantity is unreadable" };
  const units = speeds.map((match) => (/km/i.test(match[2]!) ? "km/h" : "m/s"));
  if (units[0] !== units[1]) return { status: "unbound", reason: "boat and current speeds use different units" };
  const roles: Array<"boat" | "river" | null> = speeds.map((match, index) => {
    const end = (match.index ?? 0) + match[0].length;
    if (BOAT_AFTER.test(text.slice(end, end + 40))) return "boat";
    const previousEnd = index === 0 ? 0 : (speeds[index - 1]!.index ?? 0) + speeds[index - 1]![0].length;
    const before = text.slice(previousEnd, match.index ?? 0);
    const boat = lastIndex(BOAT_CUE, before); const river = lastIndex(RIVER_CUE, before);
    if (boat < 0 && river < 0) return null;
    return boat > river ? "boat" : "river";
  });
  if (roles.filter((role) => role === "boat").length !== 1 || roles.filter((role) => role === "river").length !== 1) {
    return { status: "unbound", reason: "boat and current speeds are not each named by their own role words" };
  }
  const value = (role: "boat" | "river") => values[roles.indexOf(role)]!;
  const vb = value("boat"); const vc = value("river");
  if (vb <= 0 || vc < 0) return { status: "unbound", reason: "boat speed must be positive and current speed nonnegative" };
  const widths = [...text.matchAll(WIDTH)];
  const unreadWidth = [...text.matchAll(WIDTH_MENTION)].some((mention) => !widths.some((width) => mention.index! < width.index! + width[0].length && mention.index! + mention[0].length > width.index!));
  if (widths.length > 1 || unreadWidth) return { status: "unbound", reason: "the stated river width is not supported whole or unique" };
  const width = widths[0];
  const rawWidth = width?.[1] ?? width?.[3];
  const parsedWidth = rawWidth === undefined ? null : parseStemNumber(rawWidth);
  if (width && (parsedWidth === null || parsedWidth <= 0 || !wholeScalar(text, width.index! + width[0].indexOf(rawWidth!)))) {
    return { status: "unbound", reason: "the stated river width is not a positive supported scalar" };
  }
  const widthM = parsedWidth === null ? null : parsedWidth * (/km/i.test(width![2] ?? width![4]!) ? 1000 : 1);
  if (widthM !== null && !Number.isFinite(widthM)) return { status: "unbound", reason: "the river width exceeds the supported numeric range" };
  return { status: "bound", vb, vc, unit: units[0] as "km/h" | "m/s", widthM };
}

/** Shortest path: head upstream so the boat lands directly opposite. */
const PATH_REQUEST = String.raw`\b(?:shortest (?:path|route|distance)|straight across|directly (?:opposite|across)|exactly opposite|(?:point|bank) directly opposite|zero drift|without drift|no drift)\b`;
const TIME_REQUEST = String.raw`\b(?:(?:shortest|minimum|least|minimal)\s+(?:possible\s+)?(?:crossing\s+)?time|as\s+(?:quickly|soon|fast)\s+as\s+possible|quickest)\b`;
export function riverShortestPathAsked(question: string): boolean {
  return new RegExp(PATH_REQUEST, "i").test(question);
}

/** Shortest time: head along the bank normal and drift downstream. */
export function riverShortestTimeAsked(question: string): boolean {
  const paths = [...question.matchAll(new RegExp(PATH_REQUEST, "gi"))];
  const times = question.matchAll(new RegExp(TIME_REQUEST, "gi"));
  const separate = (between: string) => /[.;:?!()[\]]/.test(between)
    || /\b(?:and|compar(?:e|ed|ing)|than|if|when|then|instead|versus|vs|or|but|while|also)\b/i.test(between);
  return [...times].some((time) => {
    const bridges = paths.map((path) => time.index! >= path.index!
      ? question.slice(path.index! + path[0].length, time.index)
      : question.slice(time.index! + time[0].length, path.index));
    // A nearby same-clause condition minimizes the constrained path, not a
    // second crossing. Separate requests keep their own time and drift.
    if (bridges.some(between => !separate(between) && (between.match(/\b[\p{L}\p{N}]+\b/gu)?.length ?? 0) <= 4)) return false;
    // Do not widen the old reader for a distant ambiguous same-clause phrase.
    return bridges.length === 0 || bridges.some(separate)
      || /\b(?:(?:shortest|minimum|least|minimal) time|as (?:quickly|soon) as possible|quickest)\b/i.test(time[0]);
  });
}

/**
 * Speeds, heading angles and (with a stated width) times and drift the
 * figure implies, SI. When the question asks only for the shortest path or
 * only for the shortest time, the other crossing's numbers are not allowed:
 * the shortest-time crossing time is the stale answer to a shortest-path
 * question, not a supporting value.
 */
export function riverCrossingValues(speeds: RiverCrossingSpeeds, question = ""): MotionValues {
  const path = riverShortestPathAsked(question); const quick = riverShortestTimeAsked(question);
  const both = path === quick;
  const k = speeds.unit === "km/h" ? 1000 / 3600 : 1;
  const vb = speeds.vb * k; const vc = speeds.vc * k;
  const deg = 180 / Math.PI;
  const velocity = [vb, vc, vb + vc, Math.abs(vb - vc)];
  const angle: number[] = [];
  const time: number[] = [];
  const w = speeds.widthM;
  const length: number[] = w === null ? [] : [w];
  if (both || quick) {
    const drift = Math.atan2(vc, vb) * deg;
    velocity.push(Math.hypot(vb, vc));
    angle.push(drift, 90 - drift, 90 + drift);
    if (w !== null) { time.push(w / vb); length.push((vc * w) / vb, Math.hypot(w, (vc * w) / vb)); }
  }
  if ((both || path) && vb > vc) {
    const heading = Math.asin(vc / vb) * deg;
    velocity.push(Math.sqrt(vb * vb - vc * vc));
    angle.push(heading, 90 - heading, 90 + heading);
    if (w !== null) time.push(w / Math.sqrt(vb * vb - vc * vc));
  }
  return { velocity, angle, ...(w === null ? {} : { time, length }) };
}

const HEADING_VERB = String.raw`\b(?:head(?:s|ed|ing)?|point(?:s|ed|ing)?|aim(?:s|ed|ing)?|steer(?:s|ed|ing)?|direct(?:s|ed|ing)?|orient(?:s|ed|ing|ated)?|fac(?:e|es|ed|ing)|rows?|rowed|rowing|swims?|swimming|swam|paddl(?:e|es|ed|ing)|keep(?:s|ing)?\s+(?:his|her|its|the|their)\s+(?:boat|body|bow|head)(?:\s+(?:pointed|pointing|aimed|directed|headed|heading|facing))?)\b`;
const ACROSS_TARGET = String.raw`(?:banks?|shore|current|stream|river|flow|water\s+flow|direction\s+of\s+(?:the\s+)?(?:current|flow|stream|river))`;
const PERPENDICULAR_TARGET = String.raw`(?:perpendicular(?:ly)?(?:\s+to\s+(?:the\s+)?${ACROSS_TARGET})?|normal(?:ly)?\s+to\s+(?:the\s+)?${ACROSS_TARGET}|at\s+right\s+angles?\s+to\s+(?:the\s+)?${ACROSS_TARGET}|(?:at\s+)?90\s*(?:°|degrees?)\s+to\s+(?:the\s+)?${ACROSS_TARGET}|straight\s+across|directly\s+across)\b`;
// The words between a heading verb and its direction may name the boat, never a goal.
const HEADING_GAP = String.raw`(?:(?!\b(?:to|so|order|reach(?:es)?|lands?|arrives?|cross(?:es)?|gets?|go(?:es)?|wants?|should|must)\b)[^.;?!]){0,25}?`;
const INTENT_BEFORE = /\b(?:wants?|wish(?:es)?|desires?|order|so\s+as|so\s+that|has|have|must|should|needs?|to|which\s+direction|what\s+direction|where)\s*$/i;

/**
 * The boat heading a river crossing stem states, read from positive evidence.
 *
 * "perpendicular": a heading verb ("heads", "pointed", "rows") is followed by
 * a perpendicular direction ("perpendicular to the banks", "straight across").
 * "upstream": a heading verb is followed by "upstream" or "against the
 * current". A goal ("wants to row straight across", "head to reach the point
 * directly opposite") is a request, not a heading. Anything else that names a
 * direction (a heading angle, a perpendicular the reader did not bind, a
 * downstream heading) is "unread": the figure cannot know the heading.
 * `pathAsked` and `timeAsked` read the stem without the heading phrases.
 */
export interface RiverCrossingHeading {
  readonly perpendicular: boolean;
  readonly upstream: boolean;
  readonly unread: string | null;
  readonly pathAsked: boolean;
  readonly timeAsked: boolean;
}

export function riverCrossingHeading(question: string): RiverCrossingHeading {
  let text = prepareStem(question);
  const take = (pattern: RegExp): boolean => {
    let found = false;
    text = text.replace(pattern, (match: string, ...rest: unknown[]) => {
      const offset = rest.find((item) => typeof item === "number") as number;
      if (INTENT_BEFORE.test(text.slice(Math.max(0, offset - 30), offset))) return match;
      found = true;
      return " ".repeat(match.length);
    });
    return found;
  };
  const perpendicular = take(new RegExp(`${HEADING_VERB}${HEADING_GAP}\\s*${PERPENDICULAR_TARGET}`, "gi"));
  const upstream = take(new RegExp(`${HEADING_VERB}${HEADING_GAP}\\s*\\b(?:upstream|up\\s+the\\s+(?:river|stream)|against\\s+the\\s+(?:current|stream|flow))\\b`, "gi"));
  const downstream = new RegExp(`${HEADING_VERB}${HEADING_GAP}\\s*\\b(?:downstream|down\\s+the\\s+(?:river|stream)|with\\s+the\\s+(?:current|stream|flow))\\b`, "i").test(text);
  const unread = new RegExp(`${STEM_NUMBER}\\s*(?:°|degrees?\\b|deg\\b|radians?\\b|rad\\b)`, "i").test(text) ? "the stem states an angle the river figure does not read"
    : /\b(?:perpendicular(?:ly)?|right\s+angles?|normal\s+to|oblique(?:ly)?)\b/i.test(text) ? "the stem names a perpendicular direction not bound to the heading"
      : downstream ? "the stem states a downstream heading"
        : null;
  return { perpendicular, upstream, unread, pathAsked: riverShortestPathAsked(text), timeAsked: riverShortestTimeAsked(text) };
}

/**
 * A heading angle the stem measures from the current ("at 150° to the
 * direction of river flow"), when it is the stem's only angle; otherwise null.
 */
export function riverHeadingFromFlow(question: string): number | null {
  const text = prepareStem(question);
  const angles = [...text.matchAll(new RegExp(`${STEM_NUMBER}\\s*(?:°|degrees?\\b|deg\\b)`, "gi"))];
  if (angles.length !== 1) return null;
  const angle = angles[0]!;
  const after = text.slice(angle.index! + angle[0].length);
  const fromFlow = /^\s*(?:to|with)\s+(?:the\s+)?(?:direction\s+of\s+(?:the\s+)?(?:river(?:\s+(?:flow|current))?|flow|current|stream)|(?:river\s+)?(?:flow|current|stream))\b/i;
  if (!fromFlow.test(after)) return null;
  return parseStemNumber(angle[1]!);
}

/**
 * The one crossing a single velocity triangle may draw for the stem, or null.
 * Upstream (resultant straight across) needs a path request or a stated
 * upstream heading with one, and a boat faster than the current. Perpendicular
 * needs a stated perpendicular heading or a shortest time request. A stem
 * with neither, with both, or with an unread direction draws no crossing.
 */
export function riverCrossingTriangle(question: string, vb: number, vc: number): "upstream" | "perpendicular" | null {
  const heading = riverCrossingHeading(question);
  if (heading.unread) return null;
  if (heading.perpendicular) return heading.upstream || heading.pathAsked ? null : "perpendicular";
  if (heading.upstream && !heading.pathAsked) return null;
  if (heading.pathAsked) return vb > vc ? "upstream" : null;
  return heading.timeAsked ? "perpendicular" : null;
}

const BOAT_SYMBOLS = new Set(["vb", "vboat", "boatspeed", "vbw", "vbinstillwater", "vswimmer"]);
const RIVER_SYMBOLS = new Set(["vc", "vriver", "vcurrent", "riverspeed", "vstream", "vw", "vwater"]);

/** New comparison roles need two requested times, not merely two mode words. */
function riverCrossingComparisonAsked(question: string): boolean {
  const paths = [...question.matchAll(new RegExp(PATH_REQUEST, "gi"))];
  const times = [...question.matchAll(new RegExp(TIME_REQUEST, "gi"))];
  const request = String.raw`\b(?:find|calculate|determine|compute|give|obtain)\s+(?:the\s+)?`;
  const timeObject = new RegExp(`${request}(?:(?:shortest|minimum|least|minimal)\\s+(?:possible\\s+)?(?:crossing\\s+)?)?time\\b`, "i");
  const clauseAt = (index: number) => {
    const before = question.slice(0, index).split(/[.;:?!()[\]]/).at(-1) ?? "";
    return before + question.slice(index).split(/[.;:?!()[\]]/)[0];
  };
  return paths.some(path => times.some(time => {
    const between = time.index! >= path.index!
      ? question.slice(path.index! + path[0].length, time.index)
      : question.slice(time.index! + time[0].length, path.index);
    if (/[.;:?!()[\]]/.test(between)) {
      // Each separate clause must request a time of its own. A comparison
      // about speeds elsewhere cannot authorize a second crossing time.
      return timeObject.test(clauseAt(path.index!)) && timeObject.test(clauseAt(time.index!));
    }
    return timeObject.test(between) || new RegExp(`${request}$`, "i").test(between)
      || /\band\s+(?:the\s+)?(?:crossing\s+)?time\b/i.test(between)
      || /\b(?:compare\s+(?:it|this|that)\s+(?:with|to)|compared\s+(?:with|to)|versus|vs|than)\s+(?:the\s+)?$/i.test(between);
  }));
}

/**
 * Plan values outside the figure's values, plus a plan that names the boat
 * or current speed by its symbol but gives the other role's value (a swap).
 */
export function riverCrossingPlanConflicts(speeds: RiverCrossingSpeeds, turnPlan: unknown, question: string): MotionPlanConflict[] {
  return motionPlanConflicts(turnPlan, riverCrossingValues(speeds, question), question, riverCrossingBindings(speeds, question));
}

/**
 * River crossing authority: corrects the boat and current speeds (bound by
 * symbol) and the crossing time when the question asks for exactly one
 * crossing and states the width. Angles and drift have several conventions
 * (bank, normal, current), so a conflicting angle or length is withdrawn,
 * never rewritten.
 */
function riverCrossingBindings(speeds: RiverCrossingSpeeds, question: string): MotionBindings {
  const k = speeds.unit === "km/h" ? 1000 / 3600 : 1;
  const vb = speeds.vb * k; const vc = speeds.vc * k;
  const bound = new Map<string, { dimension: MotionDimension; si: number; signed?: boolean }>();
  for (const name of BOAT_SYMBOLS) bound.set(name, { dimension: "velocity", si: vb });
  for (const name of RIVER_SYMBOLS) bound.set(name, { dimension: "velocity", si: vc });
  if (/\b(?:downstream|upstream)\b/i.test(question) && vb > vc) {
    for (const name of ["vdown", "vdownstream"]) bound.set(name, { dimension: "velocity", si: vb + vc });
    for (const name of ["vup", "vupstream"]) bound.set(name, { dimension: "velocity", si: vb - vc });
  }
  const path = riverShortestPathAsked(question); const quick = riverShortestTimeAsked(question);
  if (speeds.widthM !== null && path !== quick && (quick || vb > vc)) {
    const time = quick ? speeds.widthM / vb : speeds.widthM / Math.sqrt(vb * vb - vc * vc);
    // A stated oblique heading is a separate crossing the source does not
    // solve. Its generic time must not be rewritten to the comparison's minimum.
    const otherHeading = quick && new RegExp(`${STEM_NUMBER}\\s*(?:degrees?|deg\\b|°|radians?|rad\\b)`, "i").test(question);
    for (const name of otherHeading ? ["tmin", "tminimum"] : ["t", "tcross", "tcrossing", "tmin", "tminimum"]) {
      bound.set(name, { dimension: "time", si: time });
    }
  }
  if (speeds.widthM !== null && path && quick && vb > vc && riverCrossingComparisonAsked(question)) {
    const shortest = speeds.widthM / vb;
    const opposite = speeds.widthM / Math.sqrt(vb * vb - vc * vc);
    for (const name of ["tmin", "tminimum", "tshortest", "tfast"]) bound.set(name, { dimension: "time", si: shortest });
    for (const name of ["tstraight", "topposite", "tpath"]) bound.set(name, { dimension: "time", si: opposite });
    for (const name of MOTION_TIME_DIFFERENCE_KEYS) {
      bound.set(name, { dimension: "time", si: opposite - shortest, signed: true });
    }
  }
  return bound;
}

export function applyRiverCrossingAuthority(question: string, turnPlan: unknown): MotionQuantityAuthority | null {
  if (!/\b(?:boat|still water)\b/i.test(question) || !/\b(?:river|current|stream|downstream|upstream|still water)\b/i.test(question) || /\b(?:rain|umbrella)\b/i.test(question)) return null;
  const speeds = riverCrossingSpeeds(question);
  if (speeds.status !== "bound") return null;
  return motionQuantityAuthority(question, turnPlan, riverCrossingPlanConflicts(speeds, turnPlan, question), riverCrossingBindings(speeds, question));
}
