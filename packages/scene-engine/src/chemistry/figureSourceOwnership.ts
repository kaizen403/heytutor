import { resolveElement } from "./elements";
import { normalizeChemistryText, parseFormula } from "./formula";
import { CHEMISTRY_SCALAR_PATTERN, parseChemistryScalar } from "./quantityReader";
import { readSourceDrawingRequests, sourceUnquotedText } from "../document/sourceRequestScope";

export type SourceFigureModel = "semiclassical_orbit" | "rest_energy_balance" | "conserved_particle_inventory";
export interface SourceFigureModelRequest {
  model: SourceFigureModel;
  source: { start: number; end: number; text: string };
}
/** A missing physical parameter permits a symbolic setup attempt only. This
 * witness never supplies a carrier, scalar, geometry, or numerical model. */
export interface SourceParametricFigureSetup extends SourceFigureModelRequest {
  model: "semiclassical_orbit";
  unresolvedParameters: readonly ["central_charge"];
  principalLevels: readonly number[];
}
interface Request { start: number; end: number; body: string; prefix: string; context: string[]; explanation: boolean }

const VISUAL_ACTION = /\b(?:draw|sketch|plot|depict|illustrate|show)\b/gi;
const NEGATED_ACTION = /\b(?:do\s+not|does\s+not|don['’]t|doesn['’]t|never|must\s+not|should\s+not|cannot|can['’]t|no\s+need\s+to)\b|\bnot\s+to\b/gi;
const POSITIVE_RESTART = /\b(?:but|instead|rather|however)\b/gi;
const BACKGROUND = /(?:^\s*(?:background\b|for\s+(?:reference|context|comparison)\b|in\s+(?:the\s+)?sentence\b))|\b(?:unrelated|irrelevant|quoted\s+(?:instruction|context|text)|mentioned\s+only|(?:as|for)\s+(?:a\s+)?reference|(?:book|text|example|student|teacher|author)\s+(?:quotes?|cites?|mentions?|says?|repeats?|writes?|wrote))\b/i;
const CHEMICAL_REPRESENTATION = /\b(?:molecular\s+(?:structure|shape|geometry|orbital|diagram)|molecules?|chemical\s+(?:structure|reaction|diagram|arrangement)|lewis\s+(?:structure|diagram)|vsepr|\d+[spdfgh]\s+orbitals?|orbitals?\b(?![- ](?:radius|radii|speeds?|velocit(?:y|ies)|periods?|frequenc(?:y|ies)|angular\s+momentum)\b)|electron(?:ic)?\s+configuration|wave\s*function|probability\s+(?:density|cloud)|electron[- ]density\s+cloud|radial\s+probability|radial\s+nodes?|angular\s+nodes?|nodal\s+planes?|coordination\s+(?:structure|geometry|complex)|crystal\s+(?:field|structure)|unit\s+cell|reaction\s+coordinate|energy\s+profile|potential\s+energy\s+(?:diagram|profile|curve|graph)|enthalpy[- ](?:diagram|profile|graph|plot|chart|levels?)|(?:diagram|profile|graph|plot|chart|levels?)\s+of\s+(?:the\s+)?enthalpy|hess\s+cycle|photoelectric|gibbs\s+(?:graph|diagram))\b|ψ|\bpsi\b/gi;
const ORBIT_REPRESENTATION = /\b(?:circular|classical|semiclassical)[- ]+(?:bohr[- ]+)?orbits?\b|\bbohr[- ]+orbits?\b/gi;
const REST_REPRESENTATION = /\brest[- ](?:mass[- ])?energ(?:y|ies)\b/gi;
const EXPLICIT_ORBIT_ELECTRON = /\b(?:(?:an?|one|single|1)\s+electron|electron['’]s|electron\s+(?:in|on|around))\b/i;

function lastMatchAt(text: string, pattern: RegExp): number {
  const matches = [...text.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"))];
  return matches.at(-1)?.index ?? -1;
}

/** A modifier controls the object after it, not an already requested object.
 * Thus “without circular orbits” excludes paths, while “orbits without
 * numerical radii” still requests paths and grants no numerical authority. */
function objectExcluded(prefix: string): boolean {
  const excluded = lastMatchAt(prefix, /\b(?:without|excluding|except|omit(?:ting)?|excludes?|no|not\s+including|(?:do(?:es)?\s+not|don['’]t|doesn['’]t)\s+(?:include|contain|show|draw|depict)|leave\s+out)\b/gi);
  const resumed = Math.max(lastMatchAt(prefix, POSITIVE_RESTART), lastMatchAt(prefix, /\bwith\b/gi));
  return excluded > resumed;
}

function affirmedMatches(body: string, pattern: RegExp): RegExpMatchArray[] {
  return [...body.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"))]
    .filter(match => !objectExcluded(body.slice(0, match.index)));
}

function clauses(question: string): Array<{ start: number; end: number; text: string }> {
  const result = [];
  let start = 0;
  for (let index = 0; index < question.length; index++) {
    if (!/[.;!?\n]/.test(question[index]!)) continue;
    if (question[index] === "." && /\d/.test(question[index + 1] ?? "") &&
      !/[A-Za-z]/.test(question[index - 1] ?? "")) continue;
    result.push({ start, end: index, text: question.slice(start, index) });
    start = index + 1;
  }
  result.push({ start, end: question.length, text: question.slice(start) });
  return result;
}

function requests(question: string): Request[] {
  const result: Request[] = [];
  const unquoted = sourceUnquotedText(question);
  const sourceClauses = clauses(question);
  for (const clause of sourceClauses) {
    const actions = [...clause.text.matchAll(new RegExp(VISUAL_ACTION.source, "gi"))];
    for (const [index, action] of actions.entries()) {
      const start = clause.start + action.index!;
      if (unquoted.slice(start, start + action[0].length) !== action[0]) continue;
      const prefix = clause.text.slice(0, action.index);
      if (BACKGROUND.test(prefix) || lastMatchAt(prefix, NEGATED_ACTION) > lastMatchAt(prefix, POSITIVE_RESTART)) continue;
      if (/\b(?:explain|describe|discuss|justify|consider|asks?|wonders?)\b[\s\S]*\b(?:how|why|whether|if)\b/i.test(prefix) &&
        lastMatchAt(prefix, POSITIVE_RESTART) < 0) continue;
      const end = clause.start + (actions[index + 1]?.index ?? clause.text.length);
      const body = question.slice(start + action[0].length, end);
      if (/^\s*(?:no|none|neither)\b/i.test(body) || /\b(?:is|was|are|were)\s+not\s+(?:requested|required|asked|wanted|needed)\b/i.test(body) ||
        /\b(?:is|was|are|were)\s+(?:just\s+|only\s+)?(?:background|(?:a\s+)?(?:quotation|reference))\b/i.test(body)) continue;
      const context = sourceClauses.filter(source => source !== clause && !BACKGROUND.test(source.text) &&
        lastMatchAt(source.text, NEGATED_ACTION) < 0).map(source => source.text);
      result.push({ start, end, body, prefix, context, explanation: action[0].toLowerCase() === "show" && /^\s*(?:that|why|whether|how|if)\b/i.test(body) });
    }
  }
  return result;
}

/** Molecular topology, quantum orbitals and reaction-coordinate models keep
 * their existing source producer even when a separate physical view is named. */
export function hasProtectedChemistryFigureRequest(question: string): boolean {
  return requests(question).some(request => !request.explanation && affirmedMatches(request.body, CHEMICAL_REPRESENTATION).length > 0);
}

function hasNuclideIdentity(text: string): boolean {
  for (const match of text.matchAll(/\b([A-Z][a-z]?|[A-Za-z]{3,})[- ](\d{1,3})\b/g)) {
    const element = resolveElement(match[1]!);
    const A = Number(match[2]);
    if (element && Number.isInteger(A) && A >= element.z) return true;
  }
  return false;
}

function activeContext(question: string): string {
  return clauses(question).filter(clause => !BACKGROUND.test(clause.text) &&
    lastMatchAt(clause.text, NEGATED_ACTION) < 0).map(clause => clause.text).join("; ");
}

/** Foreground declarations only; used by source truth, never to establish
 * geometry or borrow a numerical parameter from reported/background text. */
export function sourceFigureForegroundContext(question: string): string {
  return activeContext(sourceUnquotedText(question));
}

function validPrincipalLevels(body: string): boolean {
  for (const assignment of body.matchAll(/\bn\s*=\s*/g)) {
    let cursor = assignment.index! + assignment[0].length;
    for (;;) {
      const scalar = new RegExp("^(?:" + CHEMISTRY_SCALAR_PATTERN + ")").exec(body.slice(cursor));
      if (!scalar) return false;
      const end = cursor + scalar[0].length;
      const read = parseChemistryScalar(body, { start: cursor, end });
      if (!read.ok || !Number.isSafeInteger(read.reading) || read.reading < 1) return false;
      const separator = /^\s*(?:,\s*(?:and\s+)?|and\s+)/i.exec(body.slice(end));
      if (!separator) break;
      cursor = end + separator[0].length;
      if (/^n\s*=/.test(body.slice(cursor))) break; // The outer inventory validates that declaration.
      if (!new RegExp("^(?:" + CHEMISTRY_SCALAR_PATTERN + ")").test(body.slice(cursor))) {
        // A new object or qualifier ends a list; a declared unknown level does not.
        if (/^(?:an?|the|for|of|with|on|at|in|draw|show|sketch|mark|label|state|separate)\b/i.test(body.slice(cursor))) break;
        return false;
      }
    }
  }
  return true;
}

interface OrbitTarget { symbol: string; z: number; at: number; charge?: number; neutral: boolean; ion: boolean }
interface OrbitInventory { targets: OrbitTarget[]; counts: number[]; generic: boolean; declared: boolean }
const ELECTRON_WORDS: Readonly<Record<string, number>> = { one: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function sourceScalarDeclarations(text: string, cue: RegExp): Array<{ at: number; end: number; value: number }> | null {
  const result: Array<{ at: number; end: number; value: number }> = [];
  for (const match of text.matchAll(cue)) {
    const start = match.index! + match[0].length;
    const scalar = new RegExp("^(?:" + CHEMISTRY_SCALAR_PATTERN + ")").exec(text.slice(start));
    if (!scalar) return null;
    const end = start + scalar[0].length;
    const read = parseChemistryScalar(text, { start, end });
    if (!read.ok || !Number.isSafeInteger(read.reading)) return null;
    result.push({ at: match.index!, end, value: read.reading });
  }
  return result;
}

/** The actual locally named monatomic carrier owns a Bohr request. A model
 * adjective cannot override its explicit charge or electron inventory, and
 * a hydrogen reference outside the action cannot supply another atom. */
function readOrbitInventory(body: string): OrbitInventory | undefined {
  const text = normalizeChemistryText(body);
  const targets: OrbitTarget[] = [];
  const counts = [...text.matchAll(/\b(one|single|two|three|four|five|six|seven|eight|nine|ten|\d+)\s*[- ]\s*electrons?\b/gi)]
    .map(match => ELECTRON_WORDS[match[1]!.toLowerCase()] ?? Number(match[1]));
  const declarations = sourceScalarDeclarations(text, /\b(?:electron(?:Count|\s+count)|(?:number|count)\s+of\s+electrons|N_e)\s*(?:=|is|of)\s*/gi);
  const chargeDeclarations = sourceScalarDeclarations(text, /\b(?:net\s+|ionic\s+)?charge\s*(?:=\s*|is\s*|(?:of\s*)?(?=[+\-\d.]))/gi);
  if (!declarations || !chargeDeclarations) return undefined;
  if (/\b(?:with|having|has|bearing|carrying)\s+(?:an?\s+|net\s+|ionic\s+)?charge\s+(?:of\s+)?(?![+\-\d.])/i.test(text) && chargeDeclarations.length === 0) return undefined;
  counts.push(...declarations.map(declaration => declaration.value));
  const generic = /\b(?:one|single|1)[- ]electron\s+(?:atoms?|ions?|species|systems?)\b|\bhydrogen(?:ic|[- ]like)\b/i.test(text);
  if (/\bnot\s+(?:an?\s+)?(?:one|single|1)[- ]electron\s+(?:atoms?|ions?|species|systems?)\b/i.test(text)) return undefined;
  for (const match of text.matchAll(/\b([A-Za-z]+)(?=[\d\s^()+\-,]|$)/g)) {
    const token = match[1]!;
    if (objectExcluded(text.slice(0, match.index))) continue;
    if (/^hydrogen$/i.test(token) && /^[- ]like\b/i.test(text.slice(match.index! + token.length))) continue;
    const element = resolveElement(token);
    if (!element) {
      // A molecular or unknown symbol is not an unnamed one-electron atom.
      if (/^[A-Z]{1,3}$/.test(token) && (parseFormula(token)?.totalAtoms ?? 0) !== 1 &&
        !/\s*=/.test(text.slice(match.index! + token.length, match.index! + token.length + 3))) return undefined;
      continue;
    }
    const tail = text.slice(match.index! + token.length);
    const charge = /^\s*(?:\^\s*)?\(?\s*(?:(\d+)\s*([+-])|([+-])\s*(\d*))\s*\)?/.exec(tail);
    if (charge && /^[+\-\d^]/.test(tail.slice(charge[0].length))) return undefined;
    if (!charge && /^\s*(?:\^|\(\s*[+\-\d]|\d+[+-])/.test(tail)) return undefined;
    const localPrefix = text.slice(0, match.index).split(/\b(?:and|or|plus|alongside)\b|,/i).at(-1) ?? "";
    const neutral = /\bneutral\b/i.test(localPrefix) || /^\s*\(\s*neutral\s*\)/i.test(tail);
    const ion = /^\s*ions?\b/i.test(tail);
    targets.push({ symbol: element.symbol, z: element.z, at: match.index!, neutral, ion,
      ...(charge ? { charge: Number(charge[1] || charge[4] || "1") * ((charge[2] ?? charge[3]) === "-" ? -1 : 1) } : {}) });
  }
  for (const declaration of chargeDeclarations) {
    const owner = targets.filter(target => target.at < declaration.at).at(-1);
    if (!owner) return undefined;
    const suffix = /^\s*([+-])/.exec(text.slice(declaration.end));
    if (suffix && /^[+\-\d]/.test(text.slice(declaration.end + suffix[0].length))) return undefined;
    const charge = suffix ? Math.abs(declaration.value) * (suffix[1] === "-" ? -1 : 1) : declaration.value;
    if (owner.charge !== undefined && owner.charge !== charge) return undefined;
    owner.charge = charge;
  }
  return { targets, counts, generic, declared: counts.length > 0 || chargeDeclarations.length > 0 ||
    targets.some(target => target.charge !== undefined) || /\bn\s*=/.test(text) };
}

function sourceElementSymbols(text: string): Set<string> {
  return new Set([...normalizeChemistryText(text).matchAll(/\b[A-Za-z]+\b/g)].flatMap(match => {
    const element = resolveElement(match[0]);
    return element ? [element.symbol] : [];
  }));
}

/** Source givens before or after an action belong to the requested carrier only. A differently
 * charged source species and a distant element reference cannot lend it
 * parameters. An ambiguous multi-owner declaration supplies no model. */
function oneElectronTarget(request: Request): boolean {
  const local = readOrbitInventory(request.body);
  if (!local || local.counts.some(count => count !== 1) || !validPrincipalLevels(request.prefix)) return false;
  let targets = local.targets;
  if (targets.length === 0 && /^\s*for\b/i.test(request.prefix)) {
    const prefix = readOrbitInventory(request.prefix);
    if (!prefix || prefix.counts.some(count => count !== 1)) return false;
    targets = prefix.targets;
  }
  if (targets.length === 0) return local.generic;
  for (const symbol of new Set(targets.map(target => target.symbol))) {
    const owners = [...targets.filter(target => target.symbol === symbol)];
    const counts = [...local.counts];
    const localCharge = owners.find(target => target.charge !== undefined)?.charge ?? (owners.some(target => target.neutral) ? 0 : undefined);
    for (const text of [...request.context, request.prefix]) {
      const symbols = sourceElementSymbols(text);
      if (!symbols.has(symbol)) continue;
      const source = readOrbitInventory(text);
      if (!source) return false;
      if (!source.declared) continue;
      if (symbols.size !== 1) return false;
      const sourceOwners = source.targets.filter(target => target.symbol === symbol);
      const sourceCharge = sourceOwners.find(target => target.charge !== undefined)?.charge ??
        (sourceOwners.some(target => target.neutral) ? 0 : source.counts.length > 0 && new Set(source.counts).size === 1 ?
          sourceOwners[0]!.z - source.counts[0]! : undefined);
      const requestedStateReference = /\b(?:requested|same)\b|\b(?:this|that|the)\s+(?:atom|ion|species)\b/i.test(text);
      if (!requestedStateReference && localCharge !== undefined && sourceCharge !== undefined && localCharge !== sourceCharge) continue;
      if (!validPrincipalLevels(text)) return false;
      owners.push(...sourceOwners);
      counts.push(...source.counts);
    }
    if (counts.some(count => count !== 1)) return false;
    const charges = new Set(owners.flatMap(target => target.charge === undefined ? [] : [target.charge]));
    const neutral = owners.some(target => target.neutral);
    if (charges.size > 1 || neutral && charges.size > 0 && !charges.has(0)) return false;
    const charge = [...charges][0];
    const electrons = charge !== undefined ? owners[0]!.z - charge : neutral ? owners[0]!.z :
      counts.length > 0 || local.generic ? 1 : owners.some(target => target.ion) ? null : owners[0]!.z;
    if (electrons !== 1) return false;
  }
  return true;
}

function orbitModelOwned(request: Request): boolean {
  const spatial = affirmedMatches(request.body, ORBIT_REPRESENTATION);
  if (request.explanation || spatial.length === 0 || !validPrincipalLevels(request.body)) return false;
  if (affirmedMatches(request.body, /\bbohr\b/gi).length === 0) return /\b(?:classical|semiclassical)\b/i.test(spatial[0]![0]);
  return oneElectronTarget(request);
}

/** A source that explicitly requests an inapplicable named model does not
 * gain a different producer merely because its existing builder declines. */
export function hasUnresolvedSourceFigureModelRequest(question: string): boolean {
  return requests(question).some(request => !request.explanation &&
    affirmedMatches(request.body, ORBIT_REPRESENTATION).length > 0 &&
    affirmedMatches(request.body, /\bbohr\b/gi).length > 0 && !orbitModelOwned(request));
}

/** Read foreground requested observables/models, not an account subject or
 * a chapter cue. This grants no values, geometry, source validity or proof.
 * Incomplete/ambiguous requests and protected mixed structures stay closed. */
export function readSourceFigureModelRequests(question: string): SourceFigureModelRequest[] {
  if (!question.trim() || question.length > 16_384 || hasProtectedChemistryFigureRequest(question) || hasUnresolvedSourceFigureModelRequest(question)) return [];
  const context = activeContext(question);
  const nuclear = /\b(?:nuclides?|nucleons?|nuclear|mass\s+numbers?)\b/i.test(context) || hasNuclideIdentity(context);
  const nuclearEvent = clauses(context).some(clause => hasNuclideIdentity(clause.text) &&
    !/\b(?:not|never)\s+(?:absorb(?:s|ed)?|captur(?:e|es|ed)|undergo)\b/i.test(clause.text) && (/->|→|⇒/.test(clause.text) ||
      /\bneutrons?\s+(?:(?:is|was|gets?)\s+)?(?:absorbed|captured)\s+by\b|\b(?:absorbs?|captures?)\s+(?:an?\s+)?neutrons?\b/i.test(clause.text))) ||
    /\b(?:mass|nucleon)\s+numbers?\b/i.test(context) && /\b(?:charge|atomic\s+numbers?)\b/i.test(context);
  const restMassRelation = /\bmass(?:es)?\b/i.test(context) && /\bc\s*(?:\^\s*2|²)\b|\bc²/i.test(context);
  const result: SourceFigureModelRequest[] = [];
  for (const request of requests(question)) {
    const body = request.body;
    const source = { start: request.start, end: request.end, text: question.slice(request.start, request.end) };
    if (orbitModelOwned(request)) result.push({ model: "semiclassical_orbit", source });
    const rest = !request.explanation && (affirmedMatches(body, REST_REPRESENTATION).length > 0 ||
      restMassRelation && affirmedMatches(body, /\bmass\s*(?:\/|and|[- ])\s*energy\s+(?:balance|ordering|diagram|view)\b/gi).length > 0);
    if (rest)
      result.push({ model: "rest_energy_balance", source });
    const inventory = !request.explanation && affirmedMatches(body, /\b(?:nuclide|nucleon|nuclear)[- ]inventory\b|\binventory\s+of\s+(?:the\s+)?(?:protons?\s+and\s+neutrons?|nucleons?)\b/gi).length > 0;
    const event = !request.explanation && !/\b(?:unknown|unspecified|unidentified)\s+(?:participants?|[A-Z])\b/i.test(body) &&
      affirmedMatches(body, /\b(?:balanced\s+)?(?:event|channel|reaction)\b/gi).length > 0 && (nuclearEvent || /\bnuclear\b/i.test(body));
    // A verbal “show why” is not a new plot. A requested distinction between
    // actual source-transition participants is a conserved inventory view.
    const participantComparison = request.explanation && nuclearEvent &&
      /\bdistinguish\b/i.test(body) && affirmedMatches(body, /\b(?:compound\s+)?nucle(?:us|i)\b/gi).length > 0;
    if (inventory || participantComparison || !request.explanation && !rest && nuclear &&
      (affirmedMatches(body, /\b(?:compound\s+)?nucle(?:us|i)\b/gi).length > 0 || event))
      result.push({ model: "conserved_particle_inventory", source });
  }
  return result;
}

function principalLevels(text: string): number[] {
  const levels: number[] = [];
  for (const assignment of text.matchAll(/\bn\s*=\s*/gi)) {
    let cursor = assignment.index! + assignment[0].length;
    for (;;) {
      const scalar = new RegExp("^(?:" + CHEMISTRY_SCALAR_PATTERN + ")").exec(text.slice(cursor));
      if (!scalar) break;
      const end = cursor + scalar[0].length;
      const read = parseChemistryScalar(text, { start: cursor, end });
      if (read.ok && Number.isSafeInteger(read.reading) && read.reading >= 1) levels.push(read.reading);
      const separator = /^\s*(?:,\s*(?:and\s+)?|and\s+)/i.exec(text.slice(end));
      if (!separator) break;
      cursor = end + separator[0].length;
      if (/^n\s*=/i.test(text.slice(cursor))) break;
    }
  }
  return [...new Set(levels)];
}

/** A foreground electron-orbit setup may keep the central charge symbolic.
 * An unspecified parameter is different from an explicitly incompatible
 * atom, charge, inventory, or quantum/molecular model. Keep the original
 * reader's applicability and numerical contract unchanged. */
export function readSourceParametricFigureSetups(question: string): SourceParametricFigureSetup[] {
  if (!question.trim() || question.length > 16_384 || hasProtectedChemistryFigureRequest(question)) return [];
  const unquoted = sourceUnquotedText(question);
  const source = activeContext(unquoted);
  if (!validPrincipalLevels(source)) return [];
  // +Ze is an unresolved positive central charge, not a scalar assignment.
  const inventoryText = source.replace(/\b(?:nuclear|central|nucleus)\s+(?:positive\s+)?charge\s*(?:(?:of|is|=)\s*)?(?:\+?Z(?:\s*e)?|unknown|unspecified|unresolved)\b/g, "")
    .replace(/\bZ\s*(?:is|=)\s*(?:unknown|unspecified|unresolved|symbolic)\b/g, "").replace(/[;:]/g, ",");
  const inventory = readOrbitInventory(inventoryText);
  if (!inventory || inventory.targets.length > 0 || inventory.counts.some(count => count !== 1) ||
      /\b(?:multi|multiple|many)[- ]electrons?\b/i.test(source) ||
      /\b(?:atom|ion|element|species|carrier)\s+(?:named\s+|called\s+|is\s+)?[A-Z][a-z]?(?=\s|[+^()\d.,;]|$)/.test(source) ||
      /\bZ\s*(?:=|is)\s*[+\-\d.]/.test(source)) return [];
  const levels = principalLevels(source);
  const result: SourceParametricFigureSetup[] = [];
  for (const request of readSourceDrawingRequests(question)) {
    if (request.scope !== "current" || !["draw", "sketch", "plot", "graph", "show"].includes(request.action)) continue;
    const body = unquoted.slice(request.start + request.action.length, request.end);
    if (!affirmedMatches(body, ORBIT_REPRESENTATION).length || !affirmedMatches(body, /\bbohr\b/gi).length ||
        !EXPLICIT_ORBIT_ELECTRON.test(body)) continue;
    result.push({ model: "semiclassical_orbit", source: { start: request.start, end: request.end,
      text: question.slice(request.start, request.end) }, unresolvedParameters: ["central_charge"], principalLevels: levels });
  }
  return result;
}

/** Guard scope only: quoted, negated, or incompatible setup syntax cannot
 * supply authority to a candidate claiming the corresponding model. */
export function hasSourceParametricFigureSetupDemand(question: string): boolean {
  return question.length <= 16_384 && readSourceDrawingRequests(question).some(request => {
    const body = question.slice(request.start + request.action.length, request.end);
    return ["draw", "sketch", "plot", "graph", "show"].includes(request.action) && EXPLICIT_ORBIT_ELECTRON.test(body) &&
      new RegExp(ORBIT_REPRESENTATION.source, "i").test(body) && /\bbohr\b/i.test(body);
  });
}

/** An explicitly chosen, applicable species binds an illustrative label
 * only. It never fills an absent source parameter or authorizes a number. */
export function declaredParametricFigureCarriers(conditions: readonly string[]): Array<{ symbol: string; z: number }> {
  const result = new Map<string, { symbol: string; z: number }>();
  for (const original of conditions) {
    const text = sourceUnquotedText(original);
    if (!/\b(?:assum(?:e|ing|ption)|illustrative|example|use\b[\s\S]*\bmodel)\b/i.test(text)) continue;
    const declaration = text.replace(/:/g, ",");
    const inventory = readOrbitInventory(declaration);
    if (!inventory || !inventory.targets.length || new Set(inventory.targets.map(target => target.symbol)).size !== 1 ||
        !oneElectronTarget({ body: declaration, prefix: "", context: [], explanation: false, start: 0, end: declaration.length })) continue;
    const target = inventory.targets[0]!;
    result.set(target.symbol, { symbol: target.symbol, z: target.z });
  }
  return [...result.values()];
}
