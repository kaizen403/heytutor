/** A single-threshold figure must not borrow another illuminated material's value. */
import { elementByName, resolveElement } from "../chemistry/elements";

const SURFACE_NOUN = "metal|surface|plate|cathode|anode|emitter|electrode|target|sample";
const LABEL = /^(?:[A-Z][A-Z0-9]*|\d+)$/;

/** One nominal argument: a source/material head or predicate ends its scope. */
function surfaceArgument(body: string, start: number): { kind: "material" | "source" | "other"; elements: Set<string>; end: number } {
  const tail = body.slice(start);
  const elements = new Set<string>();
  let kind: "material" | "source" | "other" | null = null;
  let end = 0;
  for (const token of tail.matchAll(/\b[A-Za-z0-9]+\b/g)) {
    if (/[.;!?,\n]/.test(tail.slice(end, token.index))) break;
    const word = token[0];
    const element = resolveElement(word);
    if (element) { elements.add(`element:${element.symbol}`); end = token.index! + word.length; continue; }
    if (/^(?:lamps?|lights?|vapou?rs?|arcs?|lines?|spectr(?:um|a)|lasers?|beams?|photons?)$/i.test(word)) {
      kind ??= "source";
    } else if (new RegExp(`^(?:${SURFACE_NOUN})s?$`, "i").test(word)) {
      kind ??= "material";
    } else if (/^(?:readings?|measurements?|energies|energy|frequenc(?:y|ies)|wavelengths?|intensit(?:y|ies)|properties|electrons?|experiments?|methods?|calculations?)$/i.test(word)) {
      kind ??= "other";
      break;
    } else if (/^(?:and|or|but|while|whereas|although|with|of|for|to|on|at|from|in|into|by|under|over|as|where|when|then|is|are|was|were|has|have|had|can|could|may|might|will|would|shall|should|must|illuminates?|strikes?|hits?|falls?|emits?|needs?|requires?|remains?|draw|explain|find|calculate|compare|show)\b$/i.test(word)) {
      break;
    }
    end = token.index! + word.length;
  }
  return { kind: kind ?? (elements.size ? "material" : "other"), elements, end: start + end };
}

export function multiplePhotoelectricSurfaces(question: string): boolean {
  const options = /\boptions?\s*:|\(a\)\s+[^()]{3,}\(b\)/i.exec(question);
  const body = question.slice(0, options?.index ?? question.length);
  const suppliedMaterial = /\b\d+(?:\.\d+)?\s*(?:eV|J|Hz|nm)\b|\b(?:unknown|unreadable|undefined)\b/i.test(body);
  for (const cue of body.matchAll(/\b(another|other|second|two|multiple|different|distinct|separate)\b/gi)) {
    // A general comparison between metal classes supplies no second sample.
    if (/^(?:different|distinct|separate)$/i.test(cue[1]!) && !suppliedMaterial) continue;
    if (surfaceArgument(body, cue.index! + cue[0].length).kind === "material") return true;
  }
  if (/\bemitters?\b/i.test(body) && /\bcollectors?\b/i.test(body)) return true;
  const identities = new Set<string>();
  const genericSpans: Array<{ start: number; end: number }> = [];
  const generic = new RegExp(`\\b(?:${SURFACE_NOUN})s?\\s+([A-Za-z0-9]+)(?:\\s*(?:,|and|or|aur)\\s*([A-Za-z0-9]+))?\\b`, "gi");
  for (const match of body.matchAll(generic)) {
    for (const label of match.slice(1)) {
      if (!label || !LABEL.test(label)) continue;
      const element = resolveElement(label);
      identities.add(element ? `element:${element.symbol}` : `generic:${label}`);
      const at = match.index! + match[0].indexOf(label);
      genericSpans.push({ start: at, end: at + label.length });
    }
  }
  // An unresolved parallel work-function owner cannot inherit the first value.
  for (const match of body.matchAll(/\bthat of\s+(?:the\s+)?([A-Za-z]+)\b/gi)) {
    const sentence = body.slice(0, match.index!).split(/[.!?](?:\s|$)/).at(-1)!;
    if (!/\bwork functions?\b[\s\S]*(?:[;,]|\b(?:and|while|whereas|but))\s*$/i.test(sentence)) continue;
    if (!resolveElement(match[1]!)) return true;
  }
  const tokens = [...body.matchAll(/\b[A-Za-z]+\b/g)];
  const targets = new Set<string>();
  for (const cue of body.matchAll(/\b(?:(?:falls?|incident|shone)\s+(?:on|onto)|(?:directed|aimed)\s+at|strikes?|hits?|illuminates?)\s+/gi)) {
    for (const identity of surfaceArgument(body, cue.index! + cue[0].length).elements) targets.add(identity);
  }
  for (const match of tokens) {
    if (!resolveElement(match[0])) continue;
    const argument = surfaceArgument(body, match.index!);
    if (/^\s+(?:(?:is|are|was|were)(?:\s+being)?|(?:has|have|had)\s+been(?:\s+being)?|(?:can|could|may|might|will|would|shall|should|must)\s+(?:be|have\s+been)(?:\s+being)?)\s+(?:illuminated|irradiated)\b/i.test(body.slice(argument.end))) {
      for (const identity of argument.elements) targets.add(identity);
    }
  }
  const unresolvedTarget = /\b(?:latter|former)\b|\b(?:on|onto|at)\s+(?:it|this|that)\b/i.test(body);
  for (const match of tokens) {
    const at = match.index!;
    if (genericSpans.some(span => at >= span.start && at < span.end)) continue;
    const token = match[0];
    const element = resolveElement(token);
    if (!element) continue;
    const before = body.slice(0, at);
    const after = body.slice(at + token.length);
    // Lamps and spectral lines provide photons rather than the emitting sample.
    const photonSource = surfaceArgument(body, at).kind === "source";
    if (photonSource && !targets.has(`element:${element.symbol}`)) continue;
    if (/^lead$/i.test(token) && /\b(?:can|could|may|might|will|would|shall|should|must|to)\s+$/i.test(before)) continue;
    // A bare qualitative comparison does not introduce a second sample/value.
    if (/\b(?:lower|higher|less|greater|smaller|larger)\s+than\s+(?:that\s+of\s+)?$/i.test(before)
      && /^\s*(?:[.!?]|$)/.test(after) && !unresolvedTarget
      && targets.size === 1 && !targets.has(`element:${element.symbol}`)) continue;
    if (!elementByName(token)) {
      // A capitalised symbol must occupy a material role; 300 K and prose In do not.
      if (new RegExp(`\\b(?:${SURFACE_NOUN})\\s+$`, "i").test(before)) {
        identities.add(`element:${element.symbol}`);
        continue;
      }
      const owner = token.length > 1 && !/^(?:He|As|In|At|No|Be|Am)$/.test(token)
        || /\b(?:of|for|on|at)\s+(?:the\s+)?$/i.test(before)
        || /^\s+(?:(?:has|have)\s+(?:a\s+)?)?work functions?\b/i.test(after)
        || /^\s+[\d.]+\s*eV\b/.test(after)
        || /^(?:\s*(?:,|and|or)\s+[A-Z][a-z]?)+\s+(?:has|have)\s+work functions?\b/i.test(after)
        || /(?:\b(?:and|or)|,)\s*$/.test(before) && /^\s+(?:has|have)\s+work functions?\b/i.test(after);
      if (!owner) continue;
    }
    identities.add(`element:${element.symbol}`);
  }
  return identities.size > 1;
}
