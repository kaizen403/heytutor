/**
 * Source admission for constant-velocity relative motion on one line.
 *
 * A finite clause grammar reads the whole question. Every clause must be a
 * supported frame, axis, line, epoch, position, velocity, observer or request
 * clause; any residue (acceleration, train length, delayed start, a mass unit
 * where a velocity belongs) rejects the source instead of drawing a stock
 * picture. Values keep their source literal and unit; SI values are exact
 * rationals, and the encounter outcome is computed here, never read from a
 * model answer.
 */

export interface MotionRational { readonly n: bigint; readonly d: bigint }

export type MotionDirection = "east" | "west" | "north" | "south" | "right" | "left";

export interface RelativeMotionBody {
  readonly name: string;
  /** Initial position on the declared axis, metres. */
  readonly x0: MotionRational;
  /** Signed velocity component on the declared axis, m/s. */
  readonly v: MotionRational;
  readonly x0Source: string;
  readonly vSource: string;
}

export type EncounterOutcome =
  | { readonly kind: "future"; readonly time: MotionRational; readonly position: MotionRational }
  | { readonly kind: "initial"; readonly time: MotionRational; readonly position: MotionRational }
  | { readonly kind: "past_root"; readonly algebraicTime: MotionRational }
  | { readonly kind: "never_parallel" }
  | { readonly kind: "coincident_all_times"; readonly position: MotionRational };

export interface RelativeMotionSource {
  readonly model: "constant_velocity_1d";
  readonly frame: "ground";
  /** A compass/screen direction, or `motion of X` when the source fixes signs only relative to the bodies. */
  readonly positiveDirection: MotionDirection | `motion of ${string}`;
  /** "stated": named frame and axis. "conventional": textbook ground speeds with a stated relative direction. */
  readonly frameEvidence: "stated" | "conventional";
  /** Body whose velocity is measured (A in vAB) and the reference body (B). */
  readonly subject: RelativeMotionBody;
  readonly reference: RelativeMotionBody;
  readonly observer: RelativeMotionBody | null;
  /** v_subject − v_reference, m/s. */
  readonly relativeVelocity: MotionRational;
  readonly encounter: EncounterOutcome;
  readonly requests: { readonly relativeVelocity: boolean; readonly encounter: boolean; readonly observer: boolean };
}

export type RelativeMotionAdmission =
  | { readonly status: "admitted"; readonly source: RelativeMotionSource }
  | {
      readonly status: "rejected";
      readonly reason: string;
      /**
       * "out_of_model": the question states something this figure cannot show
       * (acceleration, a delay, a length, a third body, an unreadable unit, a
       * condition in the question sentence). No two-body sketch may stand in
       * for it. "unread": the wording is outside the grammar but the motion
       * may still be two constant velocities on a line.
       */
      readonly kind: "out_of_model" | "unread";
    };

const NUM = String.raw`[+-]?(?:\d+(?:\.\d+)?|\.\d+)`;
const LEN = String.raw`(km|m)(?![\/\w])`;
const VEL = String.raw`(km\/hr|km\/h|kmph|m\/s)`;
const DIR = "(east|west|north|south|right|left)";
const BODY_NOUN = String.raw`(?:point\s+)?(?:(?:car|body|train|bus|cyclist|particle|object|runner)\s+)?`;
const NAME = "([A-Z])";

interface BodyDraft {
  name: string;
  x0?: MotionRational; x0Source?: string;
  vRaw?: { value: MotionRational; signed: boolean; direction?: MotionDirection; source: string };
  constant: boolean;
  atRest: boolean;
}

interface Draft {
  frame: boolean;
  axis?: MotionDirection;
  epoch: boolean;
  bodies: Map<string, BodyDraft>;
  order: string[];
  observer?: string;
  pendingDirected: string[];
  requests: { relativeVelocity: boolean; encounter: boolean; observer: boolean; pair?: [string, string] };
  engaged: number;
  /** Textbook wording: the bodies' relative sense of motion, unsigned speeds and a gap. */
  relation?: "same" | "towards" | "away";
  speeds: Map<string, { value: MotionRational; source: string }>;
  gap?: { distance: MotionRational; ahead?: string; behind?: string; source: string };
}

class Reject extends Error {}
function reject(reason: string): never { throw new Reject(reason); }

function gcd(a: bigint, b: bigint): bigint { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a || 1n; }
function rational(n: bigint, d = 1n): MotionRational {
  if (d === 0n) reject("division by zero");
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
const add = (a: MotionRational, b: MotionRational) => rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: MotionRational, b: MotionRational) => rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: MotionRational, b: MotionRational) => rational(a.n * b.n, a.d * b.d);
const div = (a: MotionRational, b: MotionRational) => rational(a.n * b.d, a.d * b.n);
const sign = (a: MotionRational) => (a.n > 0n ? 1 : a.n < 0n ? -1 : 0);
export function motionRationalNumber(value: MotionRational): number { return Number(value.n) / Number(value.d); }

function parseDecimal(text: string): MotionRational {
  const match = /^([+-]?)(\d*)(?:\.(\d+))?$/.exec(text);
  if (!match || (!match[2] && !match[3])) reject(`unreadable number ${text}`);
  const digits = `${match[2] ?? ""}${match[3] ?? ""}` || "0";
  const scale = 10n ** BigInt((match[3] ?? "").length);
  const value = rational(BigInt(digits), scale);
  return match[1] === "-" ? rational(-value.n, value.d) : value;
}
function lengthSI(literal: string, unit: string): MotionRational {
  return unit.toLowerCase() === "km" ? mul(parseDecimal(literal), rational(1000n)) : parseDecimal(literal);
}
function velocitySI(literal: string, unit: string): MotionRational {
  return /^km/i.test(unit) ? mul(parseDecimal(literal), rational(5n, 18n)) : parseDecimal(literal);
}

const OPPOSITE: Record<MotionDirection, MotionDirection> = { east: "west", west: "east", north: "south", south: "north", right: "left", left: "right" };

function body(draft: Draft, name: string): BodyDraft {
  if (!/^[A-Z]$/.test(name)) reject(`body name ${name} is not a single capital label`);
  let entry = draft.bodies.get(name);
  if (!entry) {
    entry = { name, constant: false, atRest: false };
    draft.bodies.set(name, entry);
    draft.order.push(name);
  }
  return entry;
}
function setPosition(draft: Draft, name: string, literal: string, unit: string, source: string): void {
  const entry = body(draft, name);
  if (entry.x0) reject(`two positions for ${name}`);
  entry.x0 = lengthSI(literal, unit);
  entry.x0Source = source;
  draft.engaged++;
}
function setVelocity(draft: Draft, name: string, literal: string, unit: string, source: string, options: { direction?: string; constant?: boolean } = {}): void {
  const entry = body(draft, name);
  if (entry.vRaw) reject(`two velocities for ${name}`);
  entry.vRaw = {
    value: velocitySI(literal, unit),
    signed: /^[+-]/.test(literal),
    direction: options.direction ? options.direction.toLowerCase() as MotionDirection : undefined,
    source,
  };
  if (options.constant) entry.constant = true;
  draft.engaged++;
}
function setRelation(draft: Draft, phrase: string): void {
  const relation = /same/i.test(phrase) ? "same" : /away/i.test(phrase) ? "away" : "towards";
  if (draft.relation && draft.relation !== relation) reject("contradictory directions of motion");
  draft.relation = relation;
  draft.engaged++;
}
function setSpeed(draft: Draft, name: string, literal: string, unit: string, source: string): void {
  body(draft, name);
  if (draft.speeds.has(name)) reject(`two speeds for ${name}`);
  if (/^[+-]/.test(literal)) reject("a signed speed needs a stated axis");
  draft.speeds.set(name, { value: velocitySI(literal, unit), source });
  draft.engaged++;
}
function setGap(draft: Draft, distance: MotionRational, source: string, ahead?: string, behind?: string): void {
  if (draft.gap) reject("two separations");
  if (sign(distance) <= 0) reject("separation must be positive");
  draft.gap = { distance, ahead, behind, source };
  draft.engaged++;
}
function pairNames(draft: Draft): [string, string] {
  const bodies = draft.order.filter((name) => name !== draft.observer);
  if (bodies.length !== 2) reject("ordered values need exactly one established pair of bodies");
  return [bodies[0]!, bodies[1]!];
}

type Production = { pattern: RegExp; apply: (match: RegExpExecArray, draft: Draft) => void };
const sticky = (source: string) => new RegExp(source, "iy");

const PRODUCTIONS: Production[] = [
  { pattern: sticky(String.raw`(?:in|use|using)\s+the\s+ground\s+frame`), apply: (_, draft) => { draft.frame = true; draft.engaged++; } },
  { pattern: sticky(String.raw`(?:on|along)\s+(?:one|a|the\s+same)\s+straight\s+(?:road|line|track)`), apply: () => {} },
  {
    pattern: sticky(String.raw`(?:(?:take|taking|using)\s+${DIR}\s+as\s+positive|with\s+${DIR}\s+positive|${DIR}\s+is\s+positive)`),
    apply: (match, draft) => {
      const direction = (match[1] ?? match[2] ?? match[3])!.toLowerCase() as MotionDirection;
      if (draft.axis && draft.axis !== direction) reject("contradictory positive directions");
      draft.axis = direction;
    },
  },
  { pattern: sticky(String.raw`(?:at|from)\s+t\s*=\s*0(?:\s+onwards?)?`), apply: (_, draft) => { draft.epoch = true; } },
  {
    pattern: sticky(String.raw`observer\s+${NAME}\s+starts\s+at\s+(?:x\s*=\s*)?(${NUM})\s*${LEN}\s+and\s+moves\s+(?:${DIR}\s+)?at\s+(${NUM})\s*${VEL}`),
    apply: (match, draft) => {
      const name = match[1]!;
      if (draft.observer && draft.observer !== name) reject("more than one observer");
      draft.observer = name;
      setPosition(draft, name, match[2]!, match[3]!, match[0]);
      setVelocity(draft, name, match[5]!, match[6]!, match[0], { direction: match[4], constant: false });
      draft.epoch = true;
    },
  },
  {
    pattern: sticky(String.raw`(?:two\s+)?(?:point\s+)?(?:(?:bodies|cars|trains|particles)\s+)?${NAME}\s+and\s+${NAME}\s+(?:are\s+both|both\s+start|both\s+are|both\s+begin)\s+at\s+(?:x\s*=\s*)?(${NUM})\s*${LEN}`),
    apply: (match, draft) => {
      setPosition(draft, match[1]!, match[3]!, match[4]!, match[0]);
      setPosition(draft, match[2]!, match[3]!, match[4]!, match[0]);
    },
  },
  {
    pattern: sticky(String.raw`${BODY_NOUN}${NAME}\s+(is\s+|starts\s+|begins\s+|stays\s+)?at\s+(?:x\s*=\s*)?(${NUM})\s*${LEN}`),
    apply: (match, draft) => {
      setPosition(draft, match[1]!, match[3]!, match[4]!, match[0]);
      const verb = (match[2] ?? "").trim().toLowerCase();
      if (verb === "starts" || verb === "begins") draft.epoch = true;
      if (verb === "stays") body(draft, match[1]!).atRest = true;
    },
  },
  {
    pattern: sticky(String.raw`(?:they\s+move\s+at\s+)?constant\s+velocities\s+v${NAME}\s*=\s*(${NUM})\s*${VEL}\s+and\s+v${NAME}\s*=\s*(${NUM})\s*${VEL}`),
    apply: (match, draft) => {
      setVelocity(draft, match[1]!, match[2]!, match[3]!, match[0], { constant: true });
      setVelocity(draft, match[4]!, match[5]!, match[6]!, match[0], { constant: true });
    },
  },
  {
    pattern: sticky(String.raw`(?:their|they\s+have)\s+constant\s+(?:(ground|eastward|westward)\s+)?velocities\s+(?:are\s+)?(${NUM})\s*${VEL}\s+and\s+(${NUM})\s*${VEL}(?:\s+respectively)?`),
    apply: (match, draft) => {
      const [first, second] = pairNames(draft);
      const modifier = (match[1] ?? "").toLowerCase();
      const direction = modifier === "eastward" ? "east" : modifier === "westward" ? "west" : undefined;
      setVelocity(draft, first, match[2]!, match[3]!, match[0], { constant: true, direction });
      setVelocity(draft, second, match[4]!, match[5]!, match[0], { constant: true, direction });
    },
  },
  {
    pattern: sticky(String.raw`both\s+(?:have\s+constant\s+velocity|move\s+at\s+constant)\s+(${NUM})\s*${VEL}`),
    apply: (match, draft) => {
      const [first, second] = pairNames(draft);
      setVelocity(draft, first, match[1]!, match[2]!, match[0], { constant: true });
      setVelocity(draft, second, match[1]!, match[2]!, match[0], { constant: true });
    },
  },
  {
    pattern: sticky(String.raw`${NAME}\s+(?:moves\s+)?${DIR}\s+at\s+(${NUM})\s*${VEL}`),
    apply: (match, draft) => {
      setVelocity(draft, match[1]!, match[3]!, match[4]!, match[0], { direction: match[2] });
      draft.pendingDirected.push(match[1]!);
    },
  },
  {
    pattern: sticky(String.raw`(?:both\s+constant|constantly)`),
    apply: (_, draft) => {
      if (draft.pendingDirected.length === 0) reject("constancy clause without a directed velocity");
      for (const name of draft.pendingDirected) body(draft, name).constant = true;
      draft.pendingDirected = [];
    },
  },
  {
    pattern: sticky(String.raw`moves\s+at\s+constant\s+(${NUM})\s*${VEL}`),
    apply: (match, draft) => {
      const last = draft.order.at(-1);
      if (!last) reject("velocity clause without a body");
      setVelocity(draft, last, match[1]!, match[2]!, match[0], { constant: true });
    },
  },
  {
    pattern: sticky(String.raw`with\s+velocity\s+(${NUM})\s*${VEL}`),
    apply: (match, draft) => {
      const last = draft.order.at(-1);
      if (!last) reject("velocity clause without a body");
      const entry = body(draft, last);
      setVelocity(draft, last, match[1]!, match[2]!, match[0]);
      if (entry.atRest && sign(entry.vRaw!.value) === 0) entry.constant = true;
    },
  },
  {
    pattern: sticky(String.raw`(?:two\s+)(?:cars|trains|buses|cyclists|bodies|particles|objects|runners|boys|men)(?:\s*,?\s*${NAME}\s+and\s+${NAME}\s*,?)?`),
    apply: (match, draft) => {
      const names = match[1] && match[2] ? [match[1], match[2]] : ["A", "B"];
      for (const name of names) body(draft, name);
      draft.engaged++;
    },
  },
  {
    pattern: sticky(String.raw`(?:they\s+)?(?:are\s+)?(?:mov(?:e|es|ing)|travel(?:s|l?ing)?|run(?:s|ning)?|go(?:es|ing)?)\s+(in\s+the\s+same\s+direction|towards\s+each\s+other|away\s+from\s+each\s+other)`),
    apply: (match, draft) => setRelation(draft, match[1]!),
  },
  {
    pattern: sticky(String.raw`(?:both\s+)?(in\s+the\s+same\s+direction|towards\s+each\s+other|away\s+from\s+each\s+other)`),
    apply: (match, draft) => setRelation(draft, match[1]!),
  },
  {
    pattern: sticky(String.raw`(?:they\s+)?(?:are\s+)?approach(?:es|ing)?\s+each\s+other`),
    apply: (_, draft) => setRelation(draft, "towards"),
  },
  {
    pattern: sticky(String.raw`(?:on\s+(?:parallel\s+tracks|the\s+same\s+(?:road|track|line))|along\s+(?:a\s+)?straight\s+(?:road|line|track))`),
    apply: () => {},
  },
  {
    pattern: sticky(String.raw`(?:with|at)\s+(?:(constant|uniform)\s+)?(?:(speeds|velocities)\s+(?:of\s+)?)?(${NUM})\s*${VEL}?\s*and\s+(${NUM})\s*${VEL}(?:\s*,?\s*respectively)?`),
    apply: (match, draft) => {
      const [first, second] = pairNames(draft);
      const firstUnit = match[4] ?? match[6]!;
      if (draft.frame && /velocities/i.test(match[2] ?? "")) {
        // Under a stated axis, ordered velocities are signed components.
        setVelocity(draft, first, match[3]!, firstUnit, match[0], { constant: Boolean(match[1]) });
        setVelocity(draft, second, match[5]!, match[6]!, match[0], { constant: Boolean(match[1]) });
        return;
      }
      setSpeed(draft, first, match[3]!, firstUnit, match[0]);
      setSpeed(draft, second, match[5]!, match[6]!, match[0]);
    },
  },
  {
    pattern: sticky(String.raw`${BODY_NOUN}${NAME}\s+(?:moves|travels|runs|is\s+moving|is\s+travelling|is\s+traveling)\s+(?:at\s+)?(?:(?:a\s+)?(?:constant|uniform)\s+)?(?:speed\s+(?:of\s+)?)?(${NUM})\s*${VEL}`),
    apply: (match, draft) => setSpeed(draft, match[1]!, match[2]!, match[3]!, match[0]),
  },
  {
    pattern: sticky(String.raw`${BODY_NOUN}${NAME}\s+at\s+(${NUM})\s*${VEL}`),
    apply: (match, draft) => setSpeed(draft, match[1]!, match[2]!, match[3]!, match[0]),
  },
  {
    pattern: sticky(String.raw`(?:initially\s+)?${BODY_NOUN}${NAME}\s+is\s+(?:initially\s+)?(${NUM})\s*${LEN}\s+(ahead\s+of|behind)\s+${BODY_NOUN}${NAME}`),
    apply: (match, draft) => {
      const first = match[1]!; const second = match[5]!;
      body(draft, first); body(draft, second);
      const ahead = /ahead/i.test(match[4]!) ? first : second;
      const behind = ahead === first ? second : first;
      setGap(draft, lengthSI(match[2]!, match[3]!), match[0], ahead, behind);
    },
  },
  {
    pattern: sticky(String.raw`(?:initially\s+)?they\s+are\s+(?:initially\s+)?(${NUM})\s*${LEN}\s+apart`),
    apply: (match, draft) => setGap(draft, lengthSI(match[1]!, match[2]!), match[0]),
  },
  { pattern: sticky(String.raw`initially`), apply: () => {} },
];

const CONNECTOR = /(?:\s+|,|;|\.|\band\b)+/iy;
const REQUEST_LEAD = /^(?:find|what\s+(?:are|is)|report|give|describe|determine|calculate|when|how\s+(?:long|much\s+time)|after\s+how\s+(?:long|much\s+time))\b/i;
const UNSUPPORTED = /(?:accelerat|decelerat|retard|m\/s\s*(?:\^?\s*2|²)|\blength\b|\b\d+(?:\.\d+)?\s*k?m\s+long\b|\bpass(?:es|ing)?\b|\bcross(?!\s+each\s+other)|\briver\b|\bboat\b|\brain\b|\bwind\b|\bplane\b|\bafter\s+\d|\blater\b|\bdelay|relativ(?:istic|ity)|speed of light)/i;

function scanSentence(sentence: string, draft: Draft): void {
  let index = 0;
  while (index < sentence.length) {
    CONNECTOR.lastIndex = index;
    const connector = CONNECTOR.exec(sentence);
    if (connector && connector[0].length > 0) { index += connector[0].length; continue; }
    let matched = false;
    for (const production of PRODUCTIONS) {
      production.pattern.lastIndex = index;
      const match = production.pattern.exec(sentence);
      if (!match || match[0].length === 0) continue;
      production.apply(match, draft);
      index += match[0].length;
      matched = true;
      break;
    }
    if (!matched) reject(`unsupported source clause: "${sentence.slice(index, index + 48)}"`);
  }
}

class OutOfModel extends Reject {}

function readRequest(sentence: string, draft: Draft): void {
  const text = sentence.replace(/≥/g, ">=");
  if (UNSUPPORTED.test(text)) throw new OutOfModel("request asks for an unsupported motion model");
  // The question sentence is read in full: a value or a condition inside it
  // ("if B moves at 36 km/h instead", "if A starts 200 m behind") is a
  // premise this reader does not parse, so the source is declined.
  const rest = text.replace(/\bt\s*(?:>=|=)\s*0\b/gi, "")
    .replace(/,?\s*if\s+(?:one|it|any|they|such\s+a\s+time)\s+(?:exists?|meet|do|does)\b/gi, "");
  if (/\d/.test(rest) || /\b(?:if|instead|now|suppose|supposing|assum\w*|given\s+that|unless|provided|had|were|later|doubl\w*|halv\w*|twice|thrice|half|times)\b/i.test(rest)) {
    throw new OutOfModel(`the question sentence carries a premise: "${sentence.slice(0, 60)}"`);
  }
  const named = /\bv([A-Z])([A-Z])\b/g;
  let match: RegExpExecArray | null;
  while ((match = named.exec(text))) {
    if (draft.observer && match[2] === draft.observer) draft.requests.observer = true;
    else {
      draft.requests.relativeVelocity = true;
      draft.requests.pair ??= [match[1]!, match[2]!];
    }
  }
  const prose = /velocity\s+of\s+(?:\w+\s+)?([A-Z])\s+(?:relative\s+to|with\s+respect\s+to|w\.r\.t\.?)\s+(?:\w+\s+)?([A-Z])\b/.exec(text);
  const chase = /\b([A-Z])\s+(?:(?:take|takes|took|need|needs)\s+)?(?:to\s+)?(?:catch(?:es)?\s+up\s+with|overtakes?|reach(?:es)?)\s+(?:\w+\s+)?([A-Z])\b/.exec(text);
  if (chase) {
    draft.requests.encounter = true;
    draft.requests.pair ??= [chase[1]!, chase[2]!];
  }
  if (prose) {
    draft.requests.relativeVelocity = true;
    draft.requests.pair ??= [prose[1]!, prose[2]!];
  }
  if (/\b(?:encounters?|meet(?:ing|s)?|catch(?:es)?\s+up|overtakes?|cross\s+each\s+other)\b/i.test(text)) draft.requests.encounter = true;
  if (/\brelative\s+(?:velocity|speed)\b/i.test(text)) draft.requests.relativeVelocity = true;
}

function resolveVelocity(entry: BodyDraft, axis: MotionDirection): MotionRational {
  const raw = entry.vRaw!;
  if (!raw.direction) return raw.value;
  if (raw.direction !== axis && raw.direction !== OPPOSITE[axis]) reject(`direction ${raw.direction} is not on the declared ${axis} axis`);
  // "moves east at +15 m/s" is consistent; a negative literal with a stated
  // direction is ambiguous and is not guessed.
  if (sign(raw.value) < 0) reject("a signed value contradicts its stated direction");
  return raw.direction === axis ? raw.value : rational(-raw.value.n, raw.value.d);
}

function finalBody(entry: BodyDraft | undefined, axis: MotionDirection, requireConstant: boolean): RelativeMotionBody {
  if (!entry) reject("missing body");
  if (!entry.x0 || !entry.x0Source) reject(`body ${entry.name} has no source position`);
  if (!entry.vRaw) reject(`body ${entry.name} has no source velocity`);
  if (requireConstant && !entry.constant) reject(`body ${entry.name} is not stated to move at constant velocity`);
  return { name: entry.name, x0: entry.x0, v: resolveVelocity(entry, axis), x0Source: entry.x0Source, vSource: entry.vRaw.source };
}

function encounterOutcome(subject: RelativeMotionBody, reference: RelativeMotionBody): EncounterOutcome {
  const relative = sub(subject.v, reference.v);
  const gap = sub(reference.x0, subject.x0);
  if (sign(relative) === 0) {
    return sign(gap) === 0 ? { kind: "coincident_all_times", position: subject.x0 } : { kind: "never_parallel" };
  }
  const time = div(gap, relative);
  if (sign(time) < 0) return { kind: "past_root", algebraicTime: time };
  const position = add(subject.x0, mul(subject.v, time));
  return sign(time) === 0 ? { kind: "initial", time, position } : { kind: "future", time, position };
}

/**
 * null: the question does not engage this source class at all.
 * rejected: it engages the class (ground frame or a body/velocity clause)
 * but a clause is unsupported, missing or contradictory.
 */
export function relativeMotionSource(question: unknown): RelativeMotionAdmission | null {
  if (typeof question !== "string" || question.length > 1200) return null;
  const text = question.replace(/\s+/g, " ").replace(/≥/g, ">=").trim();
  if (!text) return null;
  const draft: Draft = {
    frame: false, epoch: false, bodies: new Map(), order: [], pendingDirected: [],
    requests: { relativeVelocity: false, encounter: false, observer: false }, engaged: 0, speeds: new Map(),
  };
  if (UNSUPPORTED.test(text)) {
    // Acceleration, finite lengths, rivers, rain and delayed starts are other models.
    return relativeMotionCue(text) || /ground\s+frame/i.test(text) ? { status: "rejected", kind: outsideTwoBodyModel(text) ? "out_of_model" : "unread", reason: "the question states a motion model outside constant point velocities on one line" } : null;
  }
  const sentences = text.split(/(?<=[.?!])\s+(?=[A-Z])/);
  try {
    for (const sentence of sentences) {
      if (REQUEST_LEAD.test(sentence)) readRequest(sentence, draft);
      else scanSentence(sentence, draft);
      if (draft.pendingDirected.length > 0) {
        // A directed velocity without its own constancy clause stays non-constant.
        draft.pendingDirected = [];
      }
    }
  } catch (error) {
    if (!(error instanceof Reject)) throw error;
    return engagedRejection(text, draft, error.message, error instanceof OutOfModel);
  }
  try {
    if (draft.engaged < 2 && !draft.frame) return null;
    if (!draft.frame && draft.relation) return conventional(draft);
    if (!draft.frame) reject("no named reference frame");
    if (draft.speeds.size > 0 || draft.gap) reject("unsigned speeds or a bare gap need a stated direction of motion");
    if (!draft.axis) reject("no positive direction for the line");
    if (!draft.requests.relativeVelocity && !draft.requests.encounter) reject("no supported request");
    const bodies = draft.order.filter((name) => name !== draft.observer);
    if (bodies.length !== 2) reject(`expected exactly two bodies, found ${bodies.length}`);
    if (!draft.epoch) reject("no initial instant for the stated positions");
    const pair = draft.requests.pair && bodies.includes(draft.requests.pair[0]) && bodies.includes(draft.requests.pair[1])
      ? draft.requests.pair
      : draft.requests.pair ? reject(`requested relative velocity names an unknown body`) : [bodies[0]!, bodies[1]!] as [string, string];
    const subject = finalBody(draft.bodies.get(pair[0]), draft.axis, true);
    const reference = finalBody(draft.bodies.get(pair[1]), draft.axis, true);
    const observer = draft.observer ? finalBody(draft.bodies.get(draft.observer), draft.axis, false) : null;
    if (draft.requests.observer && !observer) reject("observer velocity requested without an observer");
    return {
      status: "admitted",
      source: {
        model: "constant_velocity_1d",
        frame: "ground",
        positiveDirection: draft.axis,
        frameEvidence: "stated",
        subject,
        reference,
        observer,
        relativeVelocity: sub(subject.v, reference.v),
        encounter: encounterOutcome(subject, reference),
        requests: { relativeVelocity: draft.requests.relativeVelocity, encounter: draft.requests.encounter, observer: draft.requests.observer },
      },
    };
  } catch (error) {
    if (!(error instanceof Reject)) throw error;
    return engagedRejection(text, draft, error.message, error instanceof OutOfModel);
  }
}

/**
 * Textbook wording: speeds measured on the ground, one stated sense of
 * motion (same direction, towards or away from each other) and a gap. The
 * axis is the subject's motion; positions are fixed by the stated order
 * (ahead/behind) or, for towards/away, by the gap alone.
 */
function conventional(draft: Draft): RelativeMotionAdmission {
  if (draft.axis || draft.observer) reject("mixed stated and conventional frames");
  const bodies = draft.order;
  if (bodies.length !== 2) reject(`expected exactly two bodies, found ${bodies.length}`);
  for (const name of bodies) if (!draft.speeds.has(name)) reject(`body ${name} has no stated speed`);
  if (draft.bodies.size !== draft.speeds.size || [...draft.bodies.values()].some((entry) => entry.x0 || entry.vRaw)) reject("mixed stated and conventional values");
  if (!draft.gap) reject("no stated separation");
  if (!draft.requests.relativeVelocity && !draft.requests.encounter) reject("no supported request");
  const pair = draft.requests.pair ?? [bodies[0]!, bodies[1]!];
  if (!pair.every((name) => bodies.includes(name)) || pair[0] === pair[1]) reject("requested bodies are not the stated pair");
  const [subjectName, referenceName] = pair;
  const gap = draft.gap;
  const speed = (name: string) => draft.speeds.get(name)!.value;
  const zero = rational(0n);
  let x: Record<string, MotionRational>;
  let v: Record<string, MotionRational>;
  if (draft.relation === "same") {
    if (!gap.ahead || !gap.behind) reject("same-direction motion needs which body is ahead");
    x = { [gap.behind]: zero, [gap.ahead]: gap.distance };
    v = { [subjectName]: speed(subjectName), [referenceName]: speed(referenceName) };
  } else {
    if (gap.ahead) reject("ahead/behind does not fix positions for bodies moving towards or away from each other");
    const sense = draft.relation === "towards" ? 1n : -1n;
    x = { [subjectName]: zero, [referenceName]: gap.distance };
    v = {
      [subjectName]: rational(sense * speed(subjectName).n, speed(subjectName).d),
      [referenceName]: rational(-sense * speed(referenceName).n, speed(referenceName).d),
    };
  }
  const make = (name: string): RelativeMotionBody => ({ name, x0: x[name]!, v: v[name]!, x0Source: gap.source, vSource: draft.speeds.get(name)!.source });
  const subject = make(subjectName);
  const reference = make(referenceName);
  if (sign(subject.v) === 0 && sign(reference.v) === 0) reject("both bodies at rest");
  // Signs are fixed relative to the bodies: positive is the subject's motion
  // (or the reference's, when the subject is at rest).
  const along = sign(subject.v) !== 0 ? subject.name : reference.name;
  const flip = sign((along === subject.name ? subject : reference).v) < 0;
  const oriented = (entry: RelativeMotionBody): RelativeMotionBody => flip
    ? { ...entry, x0: rational(-entry.x0.n, entry.x0.d), v: rational(-entry.v.n, entry.v.d) }
    : entry;
  const a = oriented(subject); const b = oriented(reference);
  return {
    status: "admitted",
    source: {
      model: "constant_velocity_1d",
      frame: "ground",
      positiveDirection: `motion of ${along}`,
      frameEvidence: "conventional",
      subject: a,
      reference: b,
      observer: null,
      relativeVelocity: sub(a.v, b.v),
      encounter: encounterOutcome(a, b),
      requests: { relativeVelocity: draft.requests.relativeVelocity, encounter: draft.requests.encounter, observer: false },
    },
  };
}

function engagedRejection(text: string, draft: Draft, reason: string, outOfModel = false): RelativeMotionAdmission | null {
  // A rejection only speaks for questions that engaged this source class:
  // a named ground frame, or at least two body position/velocity clauses.
  if (draft.frame || draft.engaged >= 2 || relativeMotionCue(text)) {
    return { status: "rejected", reason, kind: outOfModel || outsideTwoBodyModel(text) ? "out_of_model" : "unread" };
  }
  return null;
}

/**
 * Wording a two-body constant-velocity sketch would silently drop: a third
 * body, a delayed start, an unreadable speed unit, or "opposite directions"
 * without saying towards or away from each other.
 */
function outsideTwoBodyModel(text: string): boolean {
  const bodies = new Set((text.match(/\b(?:car|train|bus|body|particle|point|cyclist|runner)s?\s+([A-Z])\b/gi) ?? []).map((match) => match.slice(-1)));
  return bodies.size > 2
    || /\b(?:three|four|3|4)\s+(?:cars|trains|buses|bodies|particles|cyclists|runners)\b|\b[A-Z],\s*[A-Z],?\s+and\s+[A-Z]\b/.test(text)
    || /\b(?:later|earlier|after|delay\w*|starts?\s+\d)\b/i.test(text)
    || /\d\s*(?:mph|km\s*h(?:\^?-1|⁻¹)|ft\s*\/\s*s|cm\s*\/\s*s|miles?)/i.test(text)
    || /\bopposite\s+directions?\b/i.test(text) && !/\b(?:towards?|away\s+from)\s+each\s+other\b/i.test(text);
}

/** Two named bodies in relative motion: used only to keep a rejected source from a stock picture. */
export function relativeMotionCue(question: string): boolean {
  const relative = /\b(?:relative\s+(?:velocity|speed|to)|with\s+respect\s+to|catch(?:es)?\s+up|overtak\w*|towards?\s+each\s+other|approach\w*\s+each\s+other|away\s+from\s+each\s+other|same\s+direction|opposite\s+directions?)\b/i.test(question);
  const pair = /\btwo\s+(?:cars|trains|buses|cyclists|bodies|particles|objects|runners)\b/i.test(question)
    || /\b(?:[Cc]ar|[Tt]rain|[Bb]us|[Bb]ody|[Pp]article|[Pp]oint)s?\s+[A-Z]\b/.test(question)
    || /\b[A-Z]\s+and\s+[A-Z]\b/.test(question);
  return relative && pair;
}
