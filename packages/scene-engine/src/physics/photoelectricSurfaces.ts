/** A single-threshold figure must not borrow another illuminated material's value. */
import { elementByName, resolveElement } from "../chemistry/elements";
import { chemistryCanonicalValuesAgree, readChemistryQuantityDeclaration } from "../chemistry/quantityReader";
import { photonEnergyEvFromFrequencyHz, photonEnergyEvFromWavelengthMetres } from "./photonEnergy";

const SURFACE_NOUN = "metal|surface|plate|cathode|anode|emitter|electrode|target|sample|collector";
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

/** A nominal argument identifies a sample, not just its material class. */
interface CollectorReference {
  kind: "named" | "definite" | "indefinite" | "pronoun";
  identity?: string;
}
function collectorReference(argument: string): CollectorReference | null {
  const original = argument.trim();
  if (/^it$/i.test(original)) return {kind:"pronoun"};
  const article = /^(a|an|the)\s+/i.exec(original);
  const value = original.slice(article?.[0].length ?? 0);
  const noun = /\bcollector\b/i.exec(value);
  if (!noun) return null;
  const head = value.slice(0,noun.index).trim();
  const material = head ? resolveElement(head) : null;
  if (head && !material) return null;
  const label = value.slice(noun.index+noun[0].length).trim();
  if (label && !LABEL.test(label)) return null;
  if (label || material) return {kind:"named",identity:label ? `generic:${label}` : `element:${material!.symbol}`};
  return {kind:article && /^(?:a|an)$/i.test(article[1]!) ? "indefinite" : "definite"};
}

function completeQuantity(argument: string, dimension: "energy" | "frequency" | "length"): boolean {
  const read = readChemistryQuantityDeclaration({question:argument,after:/^/,
    owner:"collector role attribute",dimension});
  return read.state === "valid" && read.reading.value > 0
    && read.reading.source.span.end === argument.trimEnd().length;
}

type ParticleKind = "electron" | "photon";
function particleKind(argument: string): ParticleKind | null {
  const value = argument.trim().replace(/^(?:(?:only|the|a|an|emitted|ejected)\s+)*/i, "");
  if (/^(?:photo)?electrons?$/i.test(value)) return "electron";
  if (/^(?:photons?|light|radiation)$/i.test(value)) return "photon";
  const supplied = /^(?:photons?|light|radiation)\s+of\s+(?:photon\s+)?(energy|frequency|wavelength)\s+(.+)$/i.exec(value);
  if (!supplied) return null;
  const dimension = supplied[1]!.toLowerCase() === "energy" ? "energy"
    : supplied[1]!.toLowerCase() === "frequency" ? "frequency" : "length";
  return completeQuantity(supplied[2]!,dimension) ? "photon" : null;
}

interface CollectorRole { kind: "receiver" | "photon_target" | "threshold_owner"; identity: string }
interface CollectorPredicate { kind: CollectorRole["kind"]; reference: CollectorReference }

/** A coordinated predicate keeps its subject; particle noun lists do not. */
function collectorPredicates(reference: CollectorReference, predicate: string): CollectorPredicate[] | null {
  const parts = predicate.split(/\s+and\s+(?=(?:receives?|collects?|(?:is|are|was|were)\s|(?:has|have)\s))/i);
  const roles: CollectorPredicate[] = [];
  for (const part of parts) {
    const owns = /^(?:has|have)\s+(?:(?:a|the)\s+)?work functions?\s+(.+)$/i.exec(part);
    if (owns && completeQuantity(owns[1]!,"energy")) { roles.push({kind:"threshold_owner",reference}); continue; }
    const receiving = /^(?:receives?|collects?)\s+(.+)$/i.exec(part);
    const particles = receiving ? particleKind(receiving[1]!) : null;
    if (particles) { roles.push({kind:particles === "electron" ? "receiver" : "photon_target",reference}); continue; }
    const illuminated = /^(?:(?:is|are|was|were)(?:\s+being)?|(?:has|have)\s+been(?:\s+being)?)\s+(?:illuminated|irradiated)(?:\s+by\s+(.+))?$/i.exec(part);
    if (illuminated && (!illuminated[1] || particleKind(illuminated[1]) === "photon")) {
      roles.push({kind:"photon_target",reference}); continue;
    }
    return null;
  }
  return roles;
}
function collectorClauseRoles(clause: string): CollectorPredicate[] | null {
  const value = clause.trim();
  const reverseOwner = /^(?:the\s+)?work functions?\s+of\s+(.+?)\s+(?:is|are|=)\s*(.+)$/i.exec(value);
  if (reverseOwner) {
    const reference = collectorReference(reverseOwner[1]!);
    if (reference && completeQuantity(reverseOwner[2]!,"energy")) return [{kind:"threshold_owner",reference}];
  }
  const attributed = /^(.+?)\s+with\s+(?:(?:a|the)\s+)?work functions?\s+(.+?)\s+((?:is|are|was|were)\s+.+)$/i.exec(value);
  if (attributed) {
    const reference = collectorReference(attributed[1]!);
    const predicates = reference ? collectorPredicates(reference,attributed[3]!) : null;
    if (reference && predicates && completeQuantity(attributed[2]!,"energy")) return [{kind:"threshold_owner",reference},...predicates];
  }
  const subject = /^(.+?)\s+((?:has|have|receives?|collects?|is|are|was|were)\s+.+)$/i.exec(value);
  if (subject) {
    const reference = collectorReference(subject[1]!);
    if (reference) return collectorPredicates(reference,subject[2]!);
  }
  const transport = /^(.+?)\s+(?:reach(?:es)?|hits?|strikes?|arrives?\s+at|travels?\s+to|moves?\s+to|flows?\s+to|go(?:es)?\s+to|falls?\s+on|(?:is|are)\s+incident\s+on|(?:is|are)\s+(?:collected|received)\s+by)\s+(.+)$/i.exec(value);
  if (transport) {
    const particles = particleKind(transport[1]!);
    const reference = collectorReference(transport[2]!);
    if (reference && particles) return [{kind:particles === "electron" ? "receiver" : "photon_target",reference}];
  }
  return null;
}

/** Resolve only proved references. An indefinite collector introduces a sample;
 * a definite/pronominal reference needs one compatible existing collector. */
function collectorRoles(body: string, identities: Set<string>, labelBindings: Map<string,string>): CollectorRole[] | null {
  const roles: CollectorRole[] = [];
  const collectors = new Set<string>();
  const bound = (identity: string) => identity.startsWith("generic:")
    ? labelBindings.get(identity.slice("generic:".length)) ?? identity : identity;
  const resolved = new Map<CollectorReference,string>();
  for (const clause of body.split(/[;!?\n]|\.(?=\s|$)/)) {
    if (!/\bcollectors?\b|\bit\b/i.test(clause)) continue;
    const predicates = collectorClauseRoles(clause);
    if (!predicates) return null;
    for (const predicate of predicates) {
      const reference = predicate.reference;
      let identity = resolved.get(reference);
      if (!identity) {
        if (reference.kind === "named") identity = bound(reference.identity!);
        else if (reference.kind === "indefinite") identity = `collector:${collectors.size+1}`;
        else {
          if (collectors.size > 1 || reference.kind === "pronoun" && collectors.size !== 1) return null;
          identity = [...collectors][0] ?? "collector:1";
          if (reference.kind === "pronoun" && [...identities].some(sample => bound(sample) !== identity)) return null;
        }
        resolved.set(reference,identity);
        collectors.add(identity);
      }
      roles.push({kind:predicate.kind,identity});
    }
  }
  return roles;
}

interface SurfaceScope { multiple: boolean; restored: boolean }

function photoelectricSurfaceScope(question: string): SurfaceScope {
  let restored = false;
  const options = /\boptions?\s*:|\(a\)\s+[^()]{3,}\(b\)/i.exec(question);
  const body = question.slice(0, options?.index ?? question.length);
  const suppliedMaterial = /\b\d+(?:\.\d+)?\s*(?:eV|J|Hz|nm)\b|\b(?:unknown|unreadable|undefined)\b/i.test(body);
  for (const cue of body.matchAll(/\b(another|other|second|two|multiple|different|distinct|separate)\b/gi)) {
    // A general comparison between metal classes supplies no second sample.
    if (/^(?:different|distinct|separate)$/i.test(cue[1]!) && !suppliedMaterial) continue;
    if (surfaceArgument(body, cue.index! + cue[0].length).kind === "material") return {multiple:true,restored};
  }
  const passiveIllumination = /^\s+(?:(?:is|are|was|were)(?:\s+being)?|(?:has|have|had)\s+been(?:\s+being)?|(?:can|could|may|might|will|would|shall|should|must)\s+(?:be|have\s+been)(?:\s+being)?)\s+(?:illuminated|irradiated)\b/i;
  const identities = new Set<string>();
  const genericSpans: Array<{ start: number; end: number }> = [];
  const generic = new RegExp(`\\b(?:${SURFACE_NOUN})s?\\s+([A-Za-z0-9]+)(?:\\s*(?:,|and|or|aur)\\s*([A-Za-z0-9]+))?\\b`, "gi");
  const genericMatches = [...body.matchAll(generic)];
  const labelBindings = new Map<string,string>();
  for (const match of genericMatches) {
    // Only an immediately adjacent material head proves an alias. A remote
    // sodium mention cannot identify an otherwise anonymous plate A.
    const head = /\b([A-Za-z]+)\s+$/.exec(body.slice(0,match.index));
    const material = head ? resolveElement(head[1]!) : null;
    if (!material) continue;
    for (const label of match.slice(1)) {
      if (!label || !LABEL.test(label)) continue;
      const identity = `element:${material.symbol}`;
      const prior = labelBindings.get(label);
      if (prior && prior !== identity) return {multiple:true,restored};
      labelBindings.set(label,identity);
    }
  }
  // Labels identify samples, so A and B remain two samples even when both
  // samples consist of sodium. A material alias never coalesces these labels.
  if (labelBindings.size > 1) return {multiple:true,restored};
  for (const match of genericMatches) {
    for (const label of match.slice(1)) {
      if (!label || !LABEL.test(label)) continue;
      const binding = labelBindings.get(label);
      const element = resolveElement(label);
      const originalIdentity = element ? `element:${element.symbol}` : `generic:${label}`;
      identities.add(binding ?? originalIdentity);
      restored ||= binding !== undefined && binding !== originalIdentity;
      const at = match.index! + match[0].indexOf(label);
      genericSpans.push({ start: at, end: at + label.length });
    }
  }
  // An unresolved parallel work-function owner cannot inherit the first value.
  for (const match of body.matchAll(/\bthat of\s+(?:the\s+)?([A-Za-z]+)\b/gi)) {
    const sentence = body.slice(0, match.index!).split(/[.!?](?:\s|$)/).at(-1)!;
    if (!/\bwork functions?\b[\s\S]*(?:[;,]|\b(?:and|while|whereas|but))\s*$/i.test(sentence)) continue;
    if (!resolveElement(match[1]!)) return {multiple:true,restored};
  }
  const tokens = [...body.matchAll(/\b[A-Za-z]+\b/g)];
  const targets = new Set<string>();
  for (const cue of body.matchAll(/\b(?:(?:falls?|incident|shone)\s+(?:on|onto)|(?:directed|aimed)\s+at|strikes?|hits?|illuminates?)\s+/gi)) {
    const argument = surfaceArgument(body, cue.index! + cue[0].length);
    for (const identity of argument.elements) targets.add(identity);
  }
  for (const match of tokens) {
    if (!resolveElement(match[0])) continue;
    const argument = surfaceArgument(body, match.index!);
    if (passiveIllumination.test(body.slice(argument.end))) {
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
  if (/\bcollectors?\b/i.test(body)) {
    const roles = collectorRoles(body,identities,labelBindings);
    if (!roles) return {multiple:true,restored};
    // Electron sinks supply no second threshold. An illuminated collector
    // instead needs its own unique threshold, not another material's value.
    if (!roles.every(role => role.kind === "receiver")) {
      const owners = roles.filter(role => role.kind === "threshold_owner");
      const boundIdentity = (identity: string) => identity.startsWith("generic:")
        ? labelBindings.get(identity.slice("generic:".length)) ?? identity : identity;
      const ownerIds = new Set(owners.map(owner => boundIdentity(owner.identity)));
      const owner = [...ownerIds][0];
      const allThresholdsOwned = owners.length === [...body.matchAll(/\bwork functions?\b/gi)].length;
      if (!owner || ownerIds.size !== 1 || !allThresholdsOwned
        || !roles.some(role => role.kind === "photon_target")
        || /\bemitters?\b/i.test(body)
        || roles.some(role => boundIdentity(role.identity) !== owner)) return {multiple:true,restored};
      identities.add(owner);
    }
    restored = true;
  }
  return {multiple:identities.size > 1,restored};
}

export function multiplePhotoelectricSurfaces(question: string): boolean {
  return photoelectricSurfaceScope(question).multiple;
}

/** Newly identified samples may not expose a loose parser's borrowed value.
 * Existing single-surface behavior stays on its original numeric reader. */
export function restoredPhotoelectricInputsValid(question: string, actualPhi: number | null, actualPhoton: number | null): boolean {
  const scope = photoelectricSurfaceScope(question);
  if (scope.multiple) return false;
  if (!scope.restored) return true;
  const agrees = (value: number): boolean => actualPhi !== null && value > 0
    && chemistryCanonicalValuesAgree(value,actualPhi);
  const stated = readChemistryQuantityDeclaration({question,
    after:/\bwork functions?(?:\s+of\s+(?:(?:a|the)\s+)?[a-z]+)?/i,
    owner:"identified photoelectric sample work function",dimension:"energy",targetUnit:"eV",allowAgreeingRepeats:true});
  if (stated.state !== "valid" || !agrees(stated.reading.value)) return false;
  // A parallel same-material owner is another supplied threshold occurrence.
  // An unrelated 'that of an electron' comparison is not a work-function cue.
  for (const match of question.matchAll(/\bthat of\s+(?:the\s+)?([A-Za-z]+)\b/gi)) {
    const sentence = question.slice(0,match.index).split(/[.!?](?:\s|$)/).at(-1)!;
    if (!/\bwork functions?\b[\s\S]*(?:[;,]|\b(?:and|while|whereas|but))\s*$/i.test(sentence)) continue;
    const read = readChemistryQuantityDeclaration({question,after:/^/,
      within:{start:match.index!+match[0].length,end:question.length},
      owner:"parallel identified sample work function",dimension:"energy",targetUnit:"eV"});
    if (read.state !== "valid" || !agrees(read.reading.value)) return false;
  }
  // Every explicitly supplied photon channel must agree with the energy the
  // caller will draw. Absence cannot authorize the physics generator's default;
  // unread energy cannot disappear into a frequency/wavelength fallback.
  const energy = readChemistryQuantityDeclaration({question,
    after:/\b(?:photon energy|photons? of energy|energy of (?:the )?photons?)\b/i,
    owner:"incident photon energy",dimension:"energy",targetUnit:"eV",allowAgreeingRepeats:true});
  const frequency = readChemistryQuantityDeclaration({question,after:/\bfrequency\b/i,
    owner:"incident photon frequency",dimension:"frequency",targetUnit:"Hz",allowAgreeingRepeats:true});
  const wavelength = readChemistryQuantityDeclaration({question,after:/\bwavelength\b/i,
    owner:"incident photon wavelength",dimension:"length",targetUnit:"m",allowAgreeingRepeats:true});
  if ([energy,frequency,wavelength].some(read => read.state === "invalid")) return false;
  const candidates = [
    energy.state === "valid" ? energy.reading.value : null,
    frequency.state === "valid" ? photonEnergyEvFromFrequencyHz(frequency.reading.value) : null,
    wavelength.state === "valid" ? photonEnergyEvFromWavelengthMetres(wavelength.reading.value) : null,
  ].filter((value): value is number => value !== null);
  return actualPhoton !== null && candidates.length > 0 && candidates.every(value => value > 0
    && chemistryCanonicalValuesAgree(value,actualPhoton));
}
