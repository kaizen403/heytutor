/**
 * Small, topic-independent grammar for verified figure cues. Technical noun
 * phrases, symbols and values stay in English; verbs and connectives use Hindi.
 * This is not a general translator. Unsupported clauses stay whole, including
 * their conditions and negation, rather than becoming a list of entity names.
 */
export function hinglishFigureNarration(source: string): string {
  const text = source.trim().replace(/\s+/g, " ");
  if (!text) return "अब figure का यह हिस्सा देखते हैं.";
  if (/\p{Script=Devanagari}/u.test(text)) return sentence(text);
  const parts: string[] = [];
  for (const part of text.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
    const previous = parts.at(-1);
    // These periods belong to a reagent/modifier/reference, not a sentence.
    // Joining first also protects several abbreviations in the same clause.
    const modifier = previous && /\b(?:dil|conc|aq|approx|e\.g|i\.e|vs|fig)\.$/i.test(previous);
    // "etc." can also finish a sentence. A following complete clause belongs
    // to the next sentence; fragments such as "Before heating" still belong
    // to the list/modifier and must remain whole. Sentence-start grammar is
    // independent of whether the translator supports the sentence's meaning.
    const continuedList = previous && /\betc\.$/i.test(previous)
      && !startsSentenceAfterEtc(part.replace(/[.!?]+$/, ""));
    if (modifier || continuedList) {
      parts[parts.length - 1] = `${previous} ${part}`;
    } else {
      parts.push(part);
    }
  }
  return parts.map((part) => {
    const clause = part.replace(/[.!?]+$/, "");
    const localized = localizeClause(clause);
    return localized ? sentence(localized) : `ध्यान दो: ${sentence(part)}`;
  }).join(" ");
}

function startsSentenceAfterEtc(text: string): boolean {
  return localizeClause(text) !== null
    || /^(?:the|this|that|these|those|it|they|we|you|he|she|an?)\s+/i.test(text)
    || /^(?:if|unless|when)\s+.+,\s*\S/i.test(text)
    || /\S\s+(?:is|are|was|were|has|have|had|does|do|did|will|would|can|could|must|should)\s+\S/i.test(text);
}

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function localizeClause(text: string): string | null {
  // Never partially translate a conditional if either complete clause is
  // outside this grammar: dropping the condition changes the physical claim.
  const condition = /^(if|unless|when)\s+(.+?),\s+(.+)$/i.exec(text);
  if (condition) {
    if (!balanced(condition[2]!)) return null;
    const premise = localizeClause(condition[2]!);
    const conclusion = localizeClause(condition[3]!);
    if (!premise || !conclusion) return null;
    const connective = condition[1]!.toLowerCase() === "unless" ? "अगर ऐसा नहीं है कि"
      : condition[1]!.toLowerCase() === "when" ? "जब" : "अगर";
    return `${connective} ${premise}, तो ${conclusion}`;
  }
  const clauses = text.split(/,\s+and\s+/i);
  if (clauses.length > 1) {
    const localized = clauses.map(localizeClause);
    return localized.every((clause) => clause !== null) ? localized.join(", और ") : null;
  }
  // The phrase grammar below has no subordinate-clause or contrast parser.
  // Decline those scope boundaries before moving any spatial preposition or
  // negation; otherwise two independent relations become a nested relation.
  if (/\b(?:if|unless|when|while|which|who|whose|that|where|because|although|though|but|except|until|provided|assuming)\b/i.test(text)) return null;
  if ((text.match(/\b(?:is|are|observes|appears|leaves|strikes)\b/gi)?.length ?? 0) > 1) return null;
  const spatialBoundary = "(?:above|below|towards?|along|from|to|at|in|on|behind|between|after|before|under|over)";
  // A coordinated target may begin with a modifier before its preposition.
  // This grammar cannot scope that continuation, even when it could also be
  // a shared noun list. Keep the whole clause instead of nesting relations.
  if (new RegExp(`\\b${spatialBoundary}\\b.*\\b(?:and|or)\\b`, "i").test(text)) return null;
  if (new RegExp(`(?:\\b(?:and|or)\\s+|,\\s*)${spatialBoundary}\\b`, "i").test(text)) return null;
  const at = /^at\s+(.+?),\s+(.+)$/i.exec(text);
  if (at) {
    if (!balanced(at[1]!)) return null;
    const rest = localizeClause(at[2]!);
    return rest ? `${phrase(at[1]!)} पर ${rest}` : null;
  }
  const directed = /^(follow|trace)\s+(.+?)\s+from\s+(.+?)\s+to\s+(.+)$/i.exec(text);
  if (directed) return /\b(?:and|or|then)\b/i.test(text) ? null
    : `${phrase(directed[2]!)} को ${phrase(directed[3]!)} से ${phrase(directed[4]!)} तक ${directed[1]!.toLowerCase()} करो`;
  // Only the complete directed imperative above owns a from/to range. The
  // phrase grammar cannot scope its endpoints or an infinitive after appears;
  // keep those claims whole instead of moving the origin onto the destination.
  if (/\bfrom\b.*\bto\b/i.test(text) || /\bappears\s+to\s+/i.test(text)) return null;
  const imperative = /^(show|draw|reveal|mark|notice|look at)\s+(.+)$/i.exec(text);
  if (imperative) {
    if (/\b(?:and|or|then)\b/i.test(text)) return null;
    const toward = /^(.+?)\s+towards?\s+(.+)$/i.exec(imperative[2]!);
    return toward ? `${phrase(toward[2]!)} की ओर ${phrase(toward[1]!)} देखो`
      : `${phrase(imperative[2]!)} को देखो`;
  }
  const copula = /^(.+?)\s+(is|are)\s+(.+)$/i.exec(text);
  if (copula) {
    // Correlative emphasis is affirmative: "not only X but also Y" must
    // never be turned into "X नहीं है" by ordinary copula negation.
    if (/^not\s+(?:only|just|merely|simply|so much)\b/i.test(copula[3]!)) return null;
    const negative = /^not\s+/i.test(copula[3]!);
    const predicate = negative ? copula[3]!.replace(/^not\s+/i, "") : copula[3]!;
    if (negative && !/^(?:the\s+)?[\p{L}\p{N}_]+$/iu.test(predicate)) return null;
    return `${phrase(copula[1]!)} ${phrase(predicate)}${negative ? " नहीं" : ""} ${copula[2]!.toLowerCase() === "are" ? "हैं" : "है"}`;
  }
  const observation = /^(.+?)\s+observes\s+(.+)$/i.exec(text);
  if (observation) return `${phrase(observation[1]!)} के observation में ${phrase(observation[2]!)} है`;
  const appearance = /^(.+?)\s+appears\s+(.+)$/i.exec(text);
  if (appearance) return `${phrase(appearance[1]!)} का apparent view ${phrase(appearance[2]!)} है`;
  const departure = /^(.+?)\s+leaves\s+([\p{L}\p{N}_]+)(?:\s+(.+))?$/iu.exec(text);
  if (departure) {
    // Do not mistake the first word of a multi-word origin for the whole
    // origin. Such prose stays intact until this grammar can express it.
    if (/^(?:the|a|an)$/i.test(departure[2]!) || departure[3] && !/^(?:[\p{L}]+ly|above|below|towards?|along|at|in|on)\b/iu.test(departure[3])) return null;
    return `${phrase(departure[1]!)} ${departure[2]} से${departure[3] ? ` ${phrase(departure[3])}` : ""} निकलता है`;
  }
  const impact = /^(.+?)\s+strikes\s+(.+)$/i.exec(text);
  if (impact) return `${phrase(impact[1]!)} का impact ${phrase(impact[2]!)} होता है`;
  return null;
}

/** Convert only explicit prepositional relationships; never infer geometry. */
function phrase(source: string): string {
  const text = source.trim().replace(/\bthe\s+/gi, "");
  const after = /^after\s+(.+?)(?:,\s+(.+))?$/i.exec(text);
  if (after) return `${phrase(after[1]!)} के बाद${after[2] ? `, ${phrase(after[2])}` : ""}`;
  const down = /^(.*?)\s*\bdown\s+(.+?)\s+from\s+(.+)$/i.exec(text);
  if (down) return `${phrase(down[3]!)} से ${phrase(down[2]!)} के along${down[1] ? ` ${phrase(down[1])}` : ""} नीचे`;
  const angle = /^(.*?)\s*\bat\s+(.+?(?:°|degrees?))\s+to\s+(.+)$/i.exec(text);
  if (angle) return `${angle[1] ? `${phrase(angle[1])} ` : ""}${phrase(angle[3]!)} से ${angle[2]} पर`;
  const fromAngle = /^(.+?(?:°|degrees?))\s+from\s+(.+)$/i.exec(text);
  if (fromAngle) return `${phrase(fromAngle[2]!)} से ${fromAngle[1]} पर`;
  const inFront = /^(.*?)\s*\bin front of\s+(.+)$/i.exec(text);
  if (inFront) return `${phrase(inFront[2]!)} के सामने${inFront[1] ? ` ${phrase(inFront[1])}` : ""}`;
  const spatial = /^(.*?)\s*\b(above|below|towards?|along)\s+(.+)$/i.exec(text);
  if (spatial) {
    const relation = spatial[2]!.toLowerCase();
    const postposition = relation === "above" ? "के ऊपर" : relation === "below" ? "के नीचे"
      : relation === "along" ? "के along" : "की ओर";
    return `${spatial[1] ? `${phrase(spatial[1])} ` : ""}${phrase(spatial[3]!)} ${postposition}`;
  }
  const from = /^(.+?)\s+from\s+(.+)$/i.exec(text);
  if (from) return `${phrase(from[2]!)} से ${phrase(from[1]!)}`;
  return text.replace(/\band\b/g, "और");
}

function balanced(text: string): boolean {
  let depth = 0;
  for (const char of text) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}
