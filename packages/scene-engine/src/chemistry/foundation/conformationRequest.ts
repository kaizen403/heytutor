const STYLE_WORDS = "newman|sawhorse|anti|gauche|eclipsed|staggered";
const STYLE = new RegExp(`\\b(?:${STYLE_WORDS})\\b`, "g");
const NAMED_PROJECTION = /^(?:newman|sawhorse)$/;
const PROJECTION_OBJECT = /\bprojections?\b/;
const CONFORMATION_OBJECT = /\bconform(?:ations?|ers?)\b/;
const STYLE_OBJECT = /\b(?:projections?|conform(?:ations?|ers?))\b/;
const COPULA = /^\s+(?:is|are|was|were)\b/;
const DRAW_VERBS = new Set(["draw", "sketch", "show", "depict", "illustrate", "construct", "represent", "give", "provide"]);
const FIGURE_VERBS = new Set([...DRAW_VERBS, "compare", "identify", "select", "which", "what"]);
const EXPLANATION_VERBS = new Set(["explain", "discuss", "describe"]);
const OTHER_FIGURE_OBJECT = /\b(?:skeletal|skeleton|structures?|diagrams?|geometry|orbitals?)\b/;
const TITLE_PREFIX = /^\s*(?:(?:the|a|an)\s+)?$/;
const PREDICATE_WORDS = "draw|sketch|show|depict|illustrate|construct|represent|compare|give|provide|identify|select|which|what|explain|discuss|describe";
const PREDICATE = new RegExp(`\\b(?:${PREDICATE_WORDS})\\b`, "g");
const EXCLUSION = /\b(?:no|not|never|neither|without|excluding|excluded|ignore|omit|exclude|rather than|instead of)\b|\bdon['’]t\b/;
const NEGATED_STYLE = new RegExp(
  `(?:${EXCLUSION.source})\\s+(?:(?:a|an|the|any)\\s+)*(?:(?:${STYLE_WORDS})\\s*(?:,|\\band\\b|\\bor\\b|\\bnor\\b)\\s*)*$`,
);
const ATTACHED_NEGATION = /\b(?:do\s+not|don['’]t|not|never|neither|without|rather than|instead of)\s+(?:also\s+)?$/;
const DESCRIPTION = /\b(?:is|are|was|were|background|outside|unnecessary|irrelevant)\b/;
const CLAUSE_BOUNDARY = new RegExp(
  `[.;!?]|\\b(?:but|however|because|whereas)\\b|(?:,|\\b(?:and|or)\\b)\\s*(?=(?:also\\s+)?(?:${PREDICATE_WORDS}|do\\s+not|don['’]t|not|no|never|ignore|omit|exclude)\\b)|\\s+(?=(?:rather than|instead of|without|excluding)\\b)`,
);
const PREPOSED_PROJECTION = new RegExp(
  `(^|[.;!?]|\\b(?:but|however|because|whereas)\\b)(\\s*(?:using|with|in|via)\\s+(?:(?:a|an|the)\\s+)?(?:newman|sawhorse)\\s+projections?)\\s*,\\s*(?=(?:${PREDICATE_WORDS})\\b)`,
  "g",
);
const PROJECTION_MODIFIER = /^\s*(?:using|with|in|via)\s+(?:(?:a|an|the)\s+)?(?:newman|sawhorse)\s+projections?\s*$/;

/** Keep adjective lists with their object, but scope parenthetical predicates. */
function requestClauses(text: string): string[] {
  const parentheticals: string[] = [];
  let outside = text;
  while (/\([^()]*\)/.test(outside)) {
    outside = outside.replace(/\(([^()]*)\)/g, (_, content: string) => {
      // "(anti, gauche) projections" modifies the surrounding request.
      // A separate description or request has its own predicate and polarity.
      if (new RegExp(`\\b(?:${PREDICATE_WORDS})\\b`).test(content)
        || DESCRIPTION.test(content) || EXCLUSION.test(content)) {
        parentheticals.push(content);
        return " ";
      }
      return ` ${content} `;
    });
  }
  // A leading "Using Newman projections, show ..." is one drawing request.
  // Keep that explicit convention with its first predicate; background phrases,
  // excluded styles and sentence-separated requests keep their own boundaries.
  return [outside, ...parentheticals].flatMap((part) =>
    part.replace(PREPOSED_PROJECTION, "$1$2 ").split(CLAUSE_BOUNDARY));
}

function hasProjectionObject(object: string, allowConformation: boolean, requireObject = false): boolean {
  return [...object.matchAll(STYLE)].some((style) => {
    // A negated style does not cancel an earlier positive style or an
    // unrelated condition such as "with no eclipsed interactions".
    if (NEGATED_STYLE.test(object.slice(0, style.index))) return false;
    const target = object.slice(style.index);
    const noun = STYLE_OBJECT.exec(target);
    if (requireObject && !noun) return false;
    // "Newman projections are used ..." is a descriptive subject, even
    // when punctuation leaves it beside a different drawing request.
    if (noun && COPULA.test(target.slice(noun.index + noun[0].length))) return false;
    return NAMED_PROJECTION.test(style[0])
      || PROJECTION_OBJECT.test(object)
      || (allowConformation && CONFORMATION_OBJECT.test(object));
  });
}

type ClauseIntent = { projection: boolean; explanation: boolean; otherFigure: boolean };
function clauseIntent(clause: string): ClauseIntent {
  const intent: ClauseIntent = { projection: false, explanation: false, otherFigure: false };
  const predicates = [...clause.matchAll(PREDICATE)];
  for (const [index, predicate] of predicates.entries()) {
    const verb = predicate[0];
    const start = predicate.index!;
    if (ATTACHED_NEGATION.test(clause.slice(0, start))) continue;
    const object = clause.slice(start + verb.length, predicates[index + 1]?.index);
    const preposedProjection = index === 0 && PROJECTION_MODIFIER.test(clause.slice(0, start));
    if (FIGURE_VERBS.has(verb)) {
      const projection = preposedProjection || hasProjectionObject(object, DRAW_VERBS.has(verb));
      intent.projection ||= projection;
      intent.otherFigure ||= DRAW_VERBS.has(verb) && !projection && OTHER_FIGURE_OBJECT.test(object);
    } else if (EXPLANATION_VERBS.has(verb)) {
      intent.explanation ||= hasProjectionObject(object, false, true);
    }
  }
  // A figure title supplies its requested object without an imperative verb.
  // It must begin with the style, rather than merely mention it in background.
  if (predicates.length === 0) {
    const style = [...clause.matchAll(STYLE)][0];
    intent.explanation = !!style && TITLE_PREFIX.test(clause.slice(0, style.index))
      && hasProjectionObject(clause, false, true);
  }
  return intent;
}

/**
 * A positively requested conformation projection cannot be supplied by an MO
 * ladder or a 2D skeleton. Resolve local request/object intent before declining
 * those substitutes; descriptions and excluded alternatives remain eligible.
 */
export function requiresConformationProjection(question: string): boolean {
  const text = question.toLowerCase()
    .replace(/\bnot\s+only\b/g, "")
    // These coordinated verbs share one drawn object.
    .replace(/\b(draw|show|sketch|depict|illustrate|construct|represent)\s+and\s+(?:explain|describe)\b/g, "$1");
  const intents = requestClauses(text).map(clauseIntent);
  // "Explain the Newman projection" or its title identifies a needed figure
  // on its own. Beside an explicit different figure request, verbal discussion
  // does not replace that requested figure. An explicit projection request
  // always remains unsatisfied until its own builder exists.
  return intents.some((intent) => intent.projection)
    || (!intents.some((intent) => intent.otherFigure) && intents.some((intent) => intent.explanation));
}
