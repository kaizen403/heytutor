/**
 * The first thing the student hears.
 *
 * Every lesson used to begin in the middle of itself. On a numbered problem
 * the runtime's "Given: ..." row spoke first, so the opening words of an
 * answer were a value list: "Given... u equals twenty meters per second."
 * On an explain question the teaching model's first step led, and the prompt
 * tells it to open on the beginner meaning, so the answer began "a force is a
 * push or a pull" with nothing before it. Either way the student heard a
 * detail before they heard what the lesson was going to be about, and the
 * actual introduction, when it came at all, came second.
 *
 * So the runtime owns one spoken beat that leads every turn: what this
 * question is, and what we are about to do with it. It writes nothing. The
 * board opening it introduces follows immediately after, so the pen is idle
 * for exactly one sentence on an empty board, which is what a teacher does
 * before picking up the marker.
 *
 * It is built from the question text rather than asked of a model, so it costs
 * no tokens and no latency and cannot describe a lesson other than this one.
 * The cost of that choice is a fixed skeleton, and the lead word rotates on a
 * hash of the question so the same three words do not open every answer of a
 * session.
 */
import type { TutorSegment } from "@heytutor/drawing";

export type LessonOpeningKind = "problem" | "concept" | "code";

export interface LessonOpeningInput {
  question: string;
  /**
   * Which opening the runtime is about to write. The caller already knows,
   * from whether a code lesson compiled and how the question classified, and
   * reclassifying here could disagree with it.
   */
  kind: LessonOpeningKind;
  /**
   * True when the runtime writes rows straight after this line: "Given: ..."
   * on a problem, the title and example on a code lesson. It decides whether
   * the line hands over to those rows or to the setup.
   */
  hasBoardOpening: boolean;
}

/**
 * Lead words, rotated by question so a session does not hear the same syllable
 * open every answer. The ellipsis is a short breath in ElevenLabs, which is
 * what makes this land as a teacher starting rather than a recording playing.
 */
const LEADS = ["okay...", "right...", "alright..."] as const;

/** Verbs that ask for a quantity: what follows them is the thing wanted. */
const NOUN_ASK =
  /\b(?:find|calculate|determine|compute|evaluate|obtain|work\s+out|what\s+is|what\s+are|what\s+will\s+be)\b/gi;

/** Verbs that ask for a magnitude in place: the verb stays in the sentence. */
const DEGREE_ASK = /\b(?:how\s+(?:far|much|many|long|fast|high|deep|wide|often))\b/gi;

/** Verbs that ask for an argument rather than a number. */
const PROOF_ASK = /\b(?:show\s+that|prove\s+that|prove|derive|verify|justify)\b/gi;

/**
 * Verbs that ask for a piece of work rather than a quantity. "express one
 * newton in SI base units" wants a conversion done, and reading it as a
 * quantity gives "asks for one newton in SI base units", which is not what
 * the question asked for.
 */
const ACTION_ASK =
  /\b(?:convert|express|rewrite|re-?write|state|identify|classify|compare|estimate|list|name|sketch|plot|draw|check\s+whether|check|test\s+whether)\b/gi;

/** Openers on an explain question. What follows them is the topic. */
const CONCEPT_LEAD =
  /^\s*(?:please\s+)?(?:can\s+you\s+)?(?:explain|describe|tell\s+me\s+about|walk\s+me\s+through|introduce|teach\s+me|give\s+me\s+an?\s+overview\s+of|overview\s+of|what\s+is|what\s+are|what\s+do\s+you\s+mean\s+by|the\s+basics\s+of|basics\s+of)\b\s*(?:me\s+|to\s+me\s+|about\s+)?/i;

/** A question whose own words are the topic: "why does ice float". */
const OPEN_QUESTION_LEAD = /^\s*(?:why|how\s+(?:does|do|is|are|can|would))\b/i;

/** A request for a figure rather than an idea. */
const DIAGRAM_LEAD = /^\s*(?:draw|sketch|illustrate|show\s+me)\b\s*/i;

/**
 * Trailing riders that are instructions to the tutor, not part of the topic.
 * "explain diffraction with an example" is a lesson about diffraction.
 */
const TOPIC_TAIL =
  /\s*(?:,\s*)?\b(?:with\s+(?:an?\s+)?(?:examples?|diagrams?|figures?)|using\s+(?:an?\s+)?(?:examples?|diagrams?)|in\s+(?:simple|plain|easy)\s+(?:terms|words|english)|for\s+(?:a\s+)?beginners?|step\s+by\s+step|briefly|in\s+detail|please)\b.*$/i;

/**
 * Conditions hanging off the ask. "find the distance travelled if the brakes
 * are applied at four seconds" is a lesson about the distance; the condition
 * belongs to the working, not to the sentence that introduces it.
 */
const ASK_CONDITION =
  /\s+\b(?:if|when|given|assuming|provided|where|after|before|using|taking)\b\s.*$/i;

/**
 * End of a sentence, which a decimal point is not.
 *
 * Splitting on a bare "." cut "convert 4.2 ly into metres" down to "4", which
 * then failed the length test, so a question with a decimal in its ask opened
 * generically. Physics questions are mostly decimals.
 */
const SENTENCE_END = /[.?!;](?=\s|$)/;

/**
 * Longest ask this line will read aloud. Past this the sentence stops being an
 * introduction and becomes the question read back, which is the thing the
 * teaching prompt already forbids the model to do.
 */
const MAX_ASK_CHARS = 72;

/** Longest topic worth naming before "let's build it up". */
const MAX_TOPIC_CHARS = 80;

/** A lone symbol standing in for the quantity wanted: "find N", "find x_2". */
const BARE_SYMBOL = /^[A-Za-z](?:_?[A-Za-z0-9])?$/;

/**
 * A yes/no or multiple-choice ask, which carries no ask verb at all:
 * "Are these measurements precise, accurate, both, or neither?"
 */
const YES_NO_ASK = /(?:^|(?<=[.?!]\s))(?:are|is|do|does|can|will|would|should|which)\b[^.?!]*\?/gi;

/** Starts with an article, so it already reads as a thing to be drawn. */
const DETERMINER_LEAD = /^(?:a|an|the)\s/i;

/**
 * What a syllabus stem tells the tutor to put on the figure, which is not part
 * of the topic being taught: "Draw X and label the named quantities."
 */
const DIAGRAM_BOILERPLATE =
  /^(?:a|an|the)\s+(?:labell?ed\s+)?(?:diagram|figure|sketch|drawing|standard\s+setup|setup)\s+(?:for|of)\s+/i;

const DIAGRAM_INSTRUCTION_TAIL =
  /\s*(?:,\s*)?\band\s+(?:label|mark|show|sketch|indicate|name)\b.*$/i;

export function lessonOpeningLine(input: LessonOpeningInput): string {
  const question = input.question.replace(/\s+/g, " ").trim();
  if (!question) return "";
  const lead = LEADS[leadIndex(question)] ?? LEADS[0];

  if (input.kind === "code") {
    // The title row speaks the ask a beat later, in the problem's own words.
    // Saying it here too would be the same sentence twice.
    return `${lead} let's take this one from the top.`;
  }

  if (input.kind === "concept") {
    const drawing = drawingTopic(question);
    if (drawing) {
      // "a ray diagram for a concave mirror" is already a thing you can draw.
      // "restoring force and force constant for spring oscillations" is a
      // topic, and drawing a topic is not a sentence.
      const object = DETERMINER_LEAD.test(drawing) ? drawing : `the figure for ${drawing}`;
      return `${lead} we're drawing ${object}. let's set it up.`;
    }
    if (OPEN_QUESTION_LEAD.test(question)) {
      const asked = trimQuestion(question);
      if (asked) {
        return `${lead} the question is, ${asked}. let's build it up from the beginning.`;
      }
    }
    const topic = conceptTopic(question);
    if (topic) {
      return `${lead} this one is about ${topic}. let's build it up from the beginning.`;
    }
    return `${lead} let's take this one from the beginning.`;
  }

  const ask = problemAskPhrase(question);
  if (ask) {
    return input.hasBoardOpening
      ? `${lead} this one ${ask}. let's start from what we know.`
      : `${lead} this one ${ask}. let's set it up.`;
  }
  return input.hasBoardOpening
    ? `${lead} let's work through this one. here's what the question gives us.`
    : `${lead} let's work through this one, and set it up as we go.`;
}

/**
 * The opening beat as a segment the turn can enqueue ahead of everything else.
 * It carries no command on purpose: the sentence introduces the board, and ink
 * arriving under it would be the row introducing itself.
 */
export function buildLessonOpeningSegment(
  input: LessonOpeningInput,
): TutorSegment | null {
  const narration = lessonOpeningLine(input);
  if (!narration) return null;
  return { narration, command: null, delivery: "opening" };
}

/**
 * What the model is told about the beat that has already been spoken, so it
 * does not open a second time. Without this the answer greets twice: the
 * runtime says what the question asks for and the first step says it again.
 */
export const LESSON_OPENING_PROMPT_ADDON = `THE LESSON HAS ALREADY BEEN OPENED
The runtime has already spoken one opening line naming what this question is and what the lesson is about to do. Do not greet, do not open with "let's", do not say what the question asks for again, and do not read the question back. Start your first step on the teaching itself.`;

function leadIndex(question: string): number {
  let hash = 2166136261;
  for (let index = 0; index < question.length; index++) {
    hash ^= question.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % LEADS.length;
}

/** "asks for the distance travelled", "asks, how far does it travel". */
function problemAskPhrase(question: string): string | null {
  // The last ask in the stem wins, whichever kind it is, because a multi-part
  // question ends on the thing it actually wants: "express 1 newton in SI base
  // units, then convert it into dyne" is a lesson about the conversion.
  // Ranking the kinds instead picked whichever category happened to be
  // checked first and opened the lesson on a part that was not the ask.
  const candidates = [
    ...allAsks(question, PROOF_ASK, "proof"),
    ...allAsks(question, DEGREE_ASK, "degree"),
    ...allAsks(question, ACTION_ASK, "action"),
    ...allAsks(question, NOUN_ASK, "noun"),
  ].sort((a, b) => (b.index - a.index) || (b.verb.length - a.verb.length));

  for (const candidate of candidates) {
    const rest = askRemainder(candidate.rest);
    if (!rest) continue;
    const verb = normalizeVerb(candidate.verb);
    switch (candidate.kind) {
      case "proof":
      case "action":
        return `asks you to ${verb} ${rest}`;
      // "asks how far does it travel" is not English. The comma turns the
      // inverted question back into a question being quoted, which it is.
      case "degree":
        return `asks, ${verb} ${rest}`;
      default:
        return `asks for ${rest}`;
    }
  }
  return yesNoAskPhrase(question);
}

/** "asks, are these measurements precise, accurate, both, or neither." */
function yesNoAskPhrase(question: string): string | null {
  const matcher = new RegExp(YES_NO_ASK.source, YES_NO_ASK.flags);
  let last: string | null = null;
  for (let match = matcher.exec(question); match; match = matcher.exec(question)) {
    last = match[0];
  }
  if (!last) return null;
  const clause = last.replace(/\s+/g, " ").replace(/[\s?]+$/, "").trim();
  if (clause.length < 8 || clause.length > MAX_ASK_CHARS) return null;
  return `asks, ${clause.toLowerCase()}`;
}

interface AskCandidate {
  kind: "proof" | "degree" | "action" | "noun";
  verb: string;
  rest: string;
  index: number;
}

/**
 * Every ask of one kind in the stem, so the caller can take the last.
 *
 * A problem states its setup before it states its question, and the setup
 * often contains one of these words in passing ("a body is found to move..."),
 * so reading the first match hands the opening line a fragment of the setup.
 */
function allAsks(
  question: string,
  pattern: RegExp,
  kind: AskCandidate["kind"],
): AskCandidate[] {
  const matcher = new RegExp(pattern.source, pattern.flags);
  const found: AskCandidate[] = [];
  for (let match = matcher.exec(question); match; match = matcher.exec(question)) {
    found.push({
      kind,
      verb: match[0],
      index: match.index,
      rest: question.slice(match.index + match[0].length),
    });
  }
  return found;
}

/** The wanted quantity, cut back to the clause that names it. */
function askRemainder(rest: string): string | null {
  const clause = (rest.split(SENTENCE_END)[0] ?? "")
    .replace(ASK_CONDITION, "")
    .replace(/^\s*(?:the\s+value\s+of|out)\s+/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,:]+/, "")
    .replace(/[\s,:]+$/, "")
    .trim();
  if (clause.length > MAX_ASK_CHARS) return null;
  // "Find N." is a real ask, and the shortest one there is. Rejecting it for
  // being under three characters sent the whole question back to the generic
  // opening, or worse, to an earlier "find" belonging to the setup.
  if (BARE_SYMBOL.test(clause)) return `the value of ${clause.toLowerCase()}`;
  if (clause.length < 3) return null;
  if (!/[a-z]{3}/i.test(clause)) return null;
  return clause.toLowerCase();
}

function normalizeVerb(verb: string): string {
  return verb.replace(/\s+/g, " ").trim().toLowerCase();
}

/** "a ray diagram for a concave mirror", from "draw a ray diagram for ...". */
function drawingTopic(question: string): string | null {
  if (!DIAGRAM_LEAD.test(question)) return null;
  // A syllabus stem wraps its topic in a fixed phrase, and the wrapper is the
  // half that pushes the sentence past the length this line will read. Drop
  // it and measure the topic itself, so "the standard setup for the
  // superposition of two simple harmonic motions along a straight line" is a
  // lesson about superposition rather than a lesson with no name.
  const stripped = question
    .replace(DIAGRAM_LEAD, "")
    .replace(DIAGRAM_BOILERPLATE, "");
  return cleanTopic(stripped);
}

function conceptTopic(question: string): string | null {
  if (!CONCEPT_LEAD.test(question)) return null;
  return cleanTopic(question.replace(CONCEPT_LEAD, ""));
}

function cleanTopic(raw: string): string | null {
  // One sentence. A syllabus stem is a topic followed by instructions to the
  // tutor ("Draw X. Show the named charges. Sketch the wave.") and reading the
  // whole stem back was long enough to fail the length test, which is why
  // every one of those questions opened on the same six generic words.
  const topic = (raw.split(/(?<=[.?!])\s+/)[0] ?? raw)
    .replace(DIAGRAM_INSTRUCTION_TAIL, "")
    .replace(TOPIC_TAIL, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,:]+/, "")
    .replace(/[\s,.:;?!]+$/, "")
    .trim();
  if (topic.length < 3 || topic.length > MAX_TOPIC_CHARS) return null;
  if (!/[a-z]{3}/i.test(topic)) return null;
  return topic.toLowerCase();
}

/** "why does ice float?" read back as a clause, with its question mark gone. */
function trimQuestion(question: string): string | null {
  const clause = (question.split(SENTENCE_END)[0] ?? "")
    .replace(TOPIC_TAIL, "")
    .replace(/\s+/g, " ")
    .replace(/[\s,.:;?!]+$/, "")
    .trim();
  if (clause.length < 5 || clause.length > MAX_ASK_CHARS) return null;
  return clause.toLowerCase();
}
