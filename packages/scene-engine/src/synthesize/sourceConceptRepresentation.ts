/**
 * Source-attached relational representations for qualitative explanations.
 *
 * The reference layer contains semantic facts, not pictures. A fact is usable
 * only when a requested source concept and a corroborating plan claim bind it.
 * The same graph compiler lays out every admitted relation. It never invents
 * an apparatus, a waveform, physical dimensions, or an anatomical outline.
 */
import { SCENE_DOCUMENT_VERSION, type SceneDocument, type SceneEntity, type SceneConstruction, type SceneAssertion } from "../types";

export const SOURCE_CONCEPT_REPRESENTATION_FAMILY = "source_concept_relation";
export const SOURCE_CONCEPT_MODEL_VERSION = "source-concept-model/v1";

interface ConceptNode { id: string; label: string; role: string }
interface ConceptRelation { id: string; from: string; to: string; label: string; role: string; referenceId: string; claimIds: string[] }
export interface SourceConceptModel {
  version: typeof SOURCE_CONCEPT_MODEL_VERSION;
  nodes: ConceptNode[];
  relations: ConceptRelation[];
  referenceIds: string[];
  limits: string[];
}

// Independently checked reference facts; none of these records contains layout.
export const SOURCE_CONCEPT_REFERENCES = {
  born_position_density: "https://ocw.mit.edu/courses/22-02-introduction-to-applied-nuclear-physics-spring-2012/0456d26b0767e6aab3bace1e6f86d78b_MIT22_02S12_lec_ch2.pdf",
  constructor_initialization: "https://docs.oracle.com/javase/tutorial/java/javaOO/constructors.html",
  adult_human_circulation: "https://openstax.org/books/anatomy-and-physiology-2e/pages/19-1-heart-anatomy",
  neuronal_action_potential: "https://openstax.org/books/anatomy-and-physiology-2e/pages/12-4-the-action-potential",
  faraday_induction: "https://openstax.org/books/university-physics-volume-2/pages/13-1-faradays-law",
} as const;

interface ClaimEvidence { id: string; text: string; claim: string; expected: string; rawClaim: string; rawExpected: string }
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function words(value: string): string {
  return value.normalize("NFKC").toLowerCase()
    .replace(/wave[- ]function/g, "wavefunction")
    .replace(/depolarisation/g, "depolarization").replace(/repolarisation/g, "repolarization")
    .replace(/hyperpolarisation/g, "hyperpolarization")
    .replace(/\brepolari(?:s|z)(?:es|e|ed|ing)\b/g, "repolarization")
    .replace(/\bdepolari(?:s|z)(?:es|e|ed|ing)\b/g, "depolarization")
    .replace(/\bhyperpolari(?:s|z)(?:es|e|ed|ing)\b/g, "hyperpolarization")
    .replace(/initialisation/g, "initialization").replace(/initialise/g, "initialize")
    .replace(/[^\p{L}\p{N}+]+/gu, " ").trim().replace(/\s+/g, " ");
}
function has(text: string, alternatives: readonly string[]): boolean {
  return alternatives.some((phrase) => ` ${text} `.includes(` ${words(phrase)} `));
}
function evidence(plan: Record<string, unknown>): ClaimEvidence[] {
  if (!Array.isArray(plan.qualitativeClaims)) return [];
  return plan.qualitativeClaims.flatMap((claim): ClaimEvidence[] => {
    if (!record(claim) || typeof claim.id !== "string" || typeof claim.claim !== "string" || claim.expected === false) return [];
    const expected = typeof claim.expected === "string" ? words(claim.expected) : "";
    const hints = Array.isArray(claim.relatedEntityHints) ? claim.relatedEntityHints.filter((hint): hint is string => typeof hint === "string") : [];
    return [{ id: claim.id, claim: words(claim.claim), expected, rawClaim: claim.claim,
      rawExpected: typeof claim.expected === "string" ? claim.expected : "", text: words([claim.claim, expected, ...hints].join(" ")) }];
  });
}
function contradicts(claims: ClaimEvidence[], concepts: readonly string[]): boolean {
  return claims.some((claim) => has(`${claim.claim} ${claim.expected}`, concepts)
    && has(`${claim.claim} ${claim.expected}`, ["not", "incorrect", "false", "never"]));
}

// Relation evidence must affirm the reference operation. Words describing a
// denied alternative do not establish it, and hints cannot override prose.
function assertedOperation(text: string): { affirmed: string; alternative: string } {
  const contrasts = [" rather than ", " instead of "];
  const positions = contrasts.map((contrast) => ({ contrast, index: ` ${text} `.indexOf(contrast) })).filter((entry) => entry.index >= 0);
  const first = positions.sort((a, b) => a.index - b.index)[0];
  return first ? { affirmed: ` ${text} `.slice(0, first.index).trim(), alternative: ` ${text} `.slice(first.index + first.contrast.length).trim() }
    : { affirmed: text, alternative: "" };
}
const BORN_OPERATION = ["modulus squared", "squared modulus", "magnitude squared", "squared magnitude", "absolute square", "modulus square"];
type BornBinding = "affirmed" | "unsupported" | "unbound";
const BORN_ABSOLUTE_SQUARE = "born_absolute_square";

/** Preserve expression scope: generic words() intentionally erases math signs. */
function bornClauses(raw: string): string[][] {
  const text = raw.normalize("NFKC").toLowerCase().replace(/wave[- ]function/g, "wavefunction")
    .replace(/\(born(?:'s)? rule\)/g, "")
    .replace(/\|\s*(?:\\?psi|ψ)(?:\(\s*(?:x|t)(?:\s*,\s*(?:x|t))?\s*\))?\s*\|\s*(?:\^\s*\{?2\}?|2)/g, BORN_ABSOLUTE_SQUARE);
  return assertedOperation(text).affirmed.split(/[.;:]+/g).flatMap((clause) => {
    const tokens = clause
    .replace(/√/g, " sqrt ")
    .replace(/([^\p{L}\p{N}_\s])/gu, " $1 ")
      .trim().split(/\s+/g).filter((token) => token !== "$");
    const parts: string[][] = [[]];
    let depth = 0;
    for (const token of tokens) {
      if (token === "(") depth += 1;
      if (token === ")") depth -= 1;
      if (token === "," && depth === 0) parts.push([]);
      else if (token !== ",") parts.at(-1)!.push(token);
    }
    return parts;
  });
}

function wavefunctionTerm(tokens: readonly string[]): boolean {
  let term = [...tokens];
  if (term[0] === "the") term = term.slice(1);
  if (!["wavefunction", "wavefunctions", "psi", "ψ"].includes(term[0] ?? "")) return false;
  const arguments_ = term.slice(1);
  return arguments_.length === 0 || (arguments_[0] === "(" && arguments_.at(-1) === ")" &&
    arguments_.slice(1, -1).length > 0 && arguments_.slice(1, -1).every((token) => token === "x" || token === "t"));
}

function bornRelativeAssertion(tokens: string[]): string[] {
  const whose = tokens.indexOf("whose");
  const copula = tokens.indexOf("is");
  if (whose < 0 || copula < 0 || copula > whose || !wavefunctionTerm(tokens.slice(0, copula))) return tokens;
  const type = tokens.slice(copula + 1, whose);
  const amplitudeDefinition = ["a", "the", "complex", "valued", "probability", "amplitude", "function", "-"];
  return type.some((token) => token === "amplitude" || token === "function") && type.every((token) => amplitudeDefinition.includes(token))
    ? ["its", ...tokens.slice(whose + 1)] : tokens;
}

function withoutOuterParentheses(tokens: readonly string[]): string[] {
  let result = [...tokens];
  for (let round = 0; round < 4 && result[0] === "(" && result.at(-1) === ")"; round += 1) {
    let depth = 0;
    if (!result.every((token, index) => {
      if (token === "(") depth += 1;
      if (token === ")") depth -= 1;
      return depth >= 0 && (depth !== 0 || index === result.length - 1);
    })) break;
    result = result.slice(1, -1);
  }
  return result;
}

function squaredWavefunction(tokens: readonly string[]): boolean {
  let expression = withoutOuterParentheses(tokens);
  if (["the", "its"].includes(expression[0] ?? "")) expression = expression.slice(1);
  if (expression.length === 1 && expression[0] === BORN_ABSOLUTE_SQUARE) return true;
  const operation = BORN_OPERATION.map((phrase) => phrase.split(" ")).find((phrase) =>
    phrase.every((token, index) => expression[index] === token));
  if (!operation) return false;
  let operand = expression.slice(operation.length);
  if (operand.length === 0) return true; // the source already names the wavefunction
  // A displayed |psi|^2 directly after its prose name is apposition. Taking
  // the squared modulus OF that result is a nested operation and declines.
  if (operand.length === 1 && operand[0] === BORN_ABSOLUTE_SQUARE) return true;
  if (operand[0] === "of") operand = operand.slice(1);
  if (["the", "its"].includes(operand[0] ?? "")) operand = operand.slice(1);
  return wavefunctionTerm(operand);
}

function densityTerm(tokens: readonly string[], allowPositionContext: boolean): boolean {
  let term = withoutOuterParentheses(tokens);
  if (term[0] === "the") term = term.slice(1);
  if (term[0] === "probability") term = term.slice(1);
  if (term[0] !== "density") return false;
  const suffix = term.slice(1);
  if (suffix.length === 0) return true;
  const contextWords = ["at", "for", "of", "finding", "a", "the", "particle", "particles", "given", "any", "position", "point", "x", "time", "t", "and", "in", "space"];
  return allowPositionContext && ["at", "for", "of"].includes(suffix[0]!) && suffix.every((token) => contextWords.includes(token));
}

/** Closed grammar for density = square(amplitude), in either reading order. */
function bornOperationBinding(raw: string): BornBinding {
  const connectors = [
    ["is", "equal", "to"], ["is", "given", "by"], ["is", "defined", "as"], ["is", "obtained", "from"],
    ["equals"], ["is"], ["="], ["gives"], ["give"], ["yields"], ["represents"], ["uses"],
  ];
  let affirmed = false;
  for (const clause of bornClauses(raw)) {
    const tokens = bornRelativeAssertion(clause);
    let clauseAffirmed = false;
    for (let index = 0; index < tokens.length; index += 1) {
      const connector = connectors.find((phrase) => phrase.every((token, offset) => tokens[index + offset] === token));
      if (!connector) continue;
      const left = tokens.slice(0, index); const right = tokens.slice(index + connector.length);
      const mentionsDensity = (part: string[]): boolean => part.includes("density");
      const mentionsAmplitude = (part: string[]): boolean => part.some((token) =>
        ["wavefunction", "wavefunctions", "psi", "ψ", "modulus", "magnitude", BORN_ABSOLUTE_SQUARE].includes(token));
      const forward = mentionsDensity(left) && mentionsAmplitude(right);
      const reverse = mentionsAmplitude(left) && mentionsDensity(right);
      if (!forward && !reverse) continue;
      if (connector[0] === "uses") return "unsupported";
      const bound = forward ? densityTerm(left, true) && squaredWavefunction(right)
        : squaredWavefunction(left) && densityTerm(right, true);
      if (!bound) return "unsupported";
      affirmed = true;
      clauseAffirmed = true;
      index += connector.length - 1;
    }
    // No alternative prose operator is silently accepted: a density/amplitude
    // relationship outside this affirmative grammar remains unverified.
    if (!clauseAffirmed && tokens.includes("density") && tokens.some((token) =>
      ["wavefunction", "wavefunctions", "psi", "ψ", "modulus", "magnitude", BORN_ABSOLUTE_SQUARE].includes(token))) return "unsupported";
  }
  return affirmed ? "affirmed" : "unbound";
}

function bornOperationsAgree(claims: ClaimEvidence[]): boolean {
  return claims.every((claim) => [claim.rawClaim, claim.rawExpected].every((text) => bornOperationBinding(text) !== "unsupported"));
}
function reversedCause(text: string, reverseFrom: string[], reverseTo: string[]): boolean {
  const tokens = assertedOperation(text).affirmed.split(" ");
  for (let index = 0; index < tokens.length; index += 1) {
    if (!["causes", "cause", "produces", "produce", "induces", "induce", "creates", "create", "generates", "generate", "triggers", "trigger"].includes(tokens[index]!)) continue;
    if (has(tokens.slice(Math.max(0, index - 8), index).join(" "), reverseFrom)
      && has(tokens.slice(index + 1, index + 10).join(" "), reverseTo)) return true;
  }
  return false;
}
function inductionRelationsAgree(claims: ClaimEvidence[]): boolean {
  return claims.every((claim) => [claim.claim, claim.expected].every((text) => {
    const affirmed = assertedOperation(text).affirmed;
    return !reversedCause(text, ["emf", "electromotive force"], ["flux", "magnetic flux"])
      && !(has(affirmed, ["constant flux", "constant magnetic flux", "unchanging flux", "unchanging magnetic flux"])
        && has(affirmed, ["induces", "produces", "generates"]) && has(affirmed, ["emf", "electromotive force"]));
  }));
}
function constructionRelationsAgree(claims: ClaimEvidence[]): boolean {
  return claims.every((claim) => [claim.claim, claim.expected].every((text) => {
    if (reversedCause(text, ["initialized object", "initialized instance", "fully initialized object", "fully initialized instance"], ["constructor", "constructors"])) return false;
    const affirmed = assertedOperation(text).affirmed;
    for (const order of ["after", "before"]) {
      const index = ` ${affirmed} `.indexOf(` ${order} `);
      if (index < 0) continue;
      const left = ` ${affirmed} `.slice(0, index); const right = ` ${affirmed} `.slice(index + order.length + 2);
      const invocation = (part: string): boolean => has(part, ["constructor", "constructors"]) && has(part, ["invoked", "runs", "called", "invocation"]);
      const initialized = (part: string): boolean => has(part, ["object", "instance"]) && has(part, ["fully initialized", "already initialized", "completed initialization"]);
      if (order === "after" ? invocation(left) && initialized(right) : initialized(left) && invocation(right)) return false;
    }
    return true;
  }));
}

/** A directly stated A -> B flow cannot contradict the reference topology. */
function explicitFlowAgrees(texts: string[], nodes: ConceptNode[], path: ConceptNode[]): boolean {
  const allowed = new Set(path.slice(1).map((node, index) => `${path[index]!.id}:${node.id}`));
  for (const text of texts) {
    const tokens = words(text).split(" ");
    const at = (index: number): ConceptNode | undefined => nodes.find((node) => {
      const label = words(node.id.replace(/_/g, " ")).split(" ");
      return label.every((token, offset) => tokens[index + offset] === token);
    });
    for (let index = 0; index < tokens.length; index += 1) {
      const from = at(index); if (!from) continue;
      const after = index + words(from.id.replace(/_/g, " ")).split(" ").length;
      for (let next = after; next < Math.min(tokens.length, after + 7); next += 1) {
        if (tokens[next] === "from") break;
        if (tokens[next] !== "to") continue;
        const to = at(next + (tokens[next + 1] === "the" ? 2 : 1));
        if (to && from.id !== to.id && !allowed.has(`${from.id}:${to.id}`)) return false;
        break;
      }
    }
  }
  return true;
}

/** Bind finite reference laws to the actual source request and claim structure. */
export function readSourceConceptModel(question: string, turnPlan: unknown): SourceConceptModel | null {
  if (!question.trim() || !record(turnPlan) || turnPlan.visualRequirement === "none") return null;
  // A nonmetric relation graph cannot stand in for unsatisfied numeric work.
  for (const field of ["givens", "derived", "unknowns"]) {
    if (Array.isArray(turnPlan[field]) && turnPlan[field].length > 0) return null;
  }
  if (typeof turnPlan.question === "string" && words(turnPlan.question) !== words(question)) return null;
  const source = words(question);
  const claims = evidence(turnPlan);
  if (claims.length === 0) return null;
  const nodes = new Map<string, ConceptNode>();
  const relations: ConceptRelation[] = [];
  const limits = new Set<string>();
  const add = (referenceId: keyof typeof SOURCE_CONCEPT_REFERENCES, claimIds: string[], path: ConceptNode[], labels: string[], role: string): void => {
    for (const node of path) nodes.set(node.id, node);
    for (let index = 0; index < path.length - 1; index += 1) {
      const from = path[index]!.id; const to = path[index + 1]!.id;
      const id = `${from}_to_${to}`;
      if (!relations.some((relation) => relation.id === id)) relations.push({ id, from, to, label: labels[index]!, role, referenceId, claimIds });
    }
  };

  // Born's position rule is an amplitude -> density transformation, not a
  // guessed sinusoid or probability distribution. The source names the state.
  if (has(source, ["wavefunction", "wavefunctions", "Born rule"])
    && !has(source, ["sound", "acoustic", "classical", "vibrating string", "water waves"])) {
    const bound = claims.filter((claim) => has(claim.text, ["wavefunction", "wavefunctions", "psi", "ψ"])
      && has(claim.text, ["probability density", "density"])
      && [claim.rawClaim, claim.rawExpected].some((text) => bornOperationBinding(text) === "affirmed"));
    if (bound.length && bornOperationsAgree(claims) && !contradicts(claims, ["wavefunction", "density"])) {
      add("born_position_density", bound.map((claim) => claim.id), [
        { id: "wavefunction", label: "psi(x)", role: "quantum position probability amplitude" },
        { id: "probability_density", label: "|psi(x)|^2", role: "position probability density" },
      ], ["modulus squared"], "Born position-density transformation");
      const integration = claims.filter((claim) => has(claim.text, ["probability", "probability density"])
        && has(claim.text, ["integrate", "integral", "integration"])
        && has(claim.text, ["region", "interval"]));
      if (integration.length) add("born_position_density", integration.map((claim) => claim.id), [
        nodes.get("probability_density")!, { id: "region_probability", label: "P(region)", role: "probability integrated over a requested region" },
      ], ["integrate"], "density integrated over a position region");
      limits.add("Symbolic Born-rule relation only; no particular state, potential, waveform, region bounds or numerical probability is asserted.");
    }
  }

  // A typed law request may supply a finite semantic relation for a broad
  // electromagnetism explanation, provided the claims also request induced
  // emf and a magnetic field. It does not supply a loop, a motor, or a sign.
  const laws = Array.isArray(turnPlan.lawIds) ? turnPlan.lawIds.filter((law): law is string => typeof law === "string").map(words) : [];
  if (has(source, ["electric", "electrical", "electricity", "electromagnetism", "induction", "Faraday"])
    && laws.some((law) => has(law, ["Faraday s law of induction", "Faraday law", "Faraday s law", "faraday_induction"]))) {
    const induction = claims.filter((claim) => has(claim.text, ["emf", "electromotive force"])
      && has(claim.text, ["induced", "induction"])
      && has(claim.text, ["magnetic", "magnetic field", "field"]));
    if (induction.length && inductionRelationsAgree(claims) && !contradicts(induction, ["induced", "induction", "emf"])) {
      add("faraday_induction", induction.map((claim) => claim.id), [
        { id: "magnetic_flux_change", label: "flux changes", role: "time-varying magnetic flux linked to the boundary in Faraday's law" },
        { id: "induced_emf", label: "induced emf", role: "electromotive force associated with the rate of magnetic flux change" },
      ], ["Faraday's law"], "Faraday flux-change and induced-emf relation");
      limits.add("Faraday-law relation only; no apparatus, magnetic-field direction, current, flux magnitude, loop area or induced-emf value is asserted.");
    }
  }

  // Object construction is a causal process. No model-specific class names,
  // hierarchy, or memory addresses are introduced by the reference fact.
  if (has(source, ["constructor", "constructors"])) {
    const invocation = claims.filter((claim) => has(claim.text, ["constructor", "constructors"])
      && has(claim.text, ["object", "objects", "instance", "instances"])
      && has(claim.text, ["created", "creation", "invoked", "automatically", "automatic"]));
    const initialization = claims.filter((claim) => has(claim.text, ["constructor", "constructors"])
      && has(claim.text, ["initialize", "initializes", "initialization", "initializing"]));
    if (invocation.length && initialization.length && constructionRelationsAgree(claims)
      && !contradicts(initialization, ["initialize", "initialization"])) {
      add("constructor_initialization", [...new Set([...invocation, ...initialization].map((claim) => claim.id))], [
        { id: "instance_creation", label: "create instance", role: "request to construct a new object instance" },
        { id: "constructor", label: "constructor", role: "constructor invocation during object construction" },
        { id: "initialized_object", label: "initialized obj.", role: "successfully constructed object with initialized state" },
      ], ["invokes", "initializes"], "successful object-construction process");
      limits.add("Successful construction only; no language-specific allocation, inheritance, failure or dispatch behavior is asserted.");
    }
  }

  // A complete directed circulation is admitted only with all chamber names
  // and both source-described circuits. A lone heart keyword is insufficient.
  if (has(source, ["heart", "circulation", "circulatory"])
    && !has(source, ["fetal", "foetal", "fish", "frog", "reptile", "shunt", "congenital", "defect", "coronary"])) {
    const flow = claims.filter((claim) => has(claim.text, ["blood", "circulation"]));
    const text = flow.map((claim) => claim.text).join(" ");
    const chambers = ["right atrium", "right ventricle", "left atrium", "left ventricle"];
    if (chambers.every((name) => has(text, [name])) && has(text, ["lungs", "lung"])
      && has(text, ["body", "systemic"]) && has(text, ["pulmonary"])
      && has(text, ["systemic"]) && !contradicts(flow, ["circulation", "blood flow"])) {
      const path = [
        { id: "right_atrium", label: "right atrium", role: "adult human right atrium receiving systemic venous blood" },
        { id: "right_ventricle", label: "right ventricle", role: "adult human right ventricle supplying pulmonary circulation" },
        { id: "lungs", label: "lungs", role: "pulmonary gas-exchange circulation" },
        { id: "left_atrium", label: "left atrium", role: "adult human left atrium receiving pulmonary venous blood" },
        { id: "left_ventricle", label: "left ventricle", role: "adult human left ventricle supplying systemic circulation" },
        { id: "body", label: "body tissues", role: "systemic tissue circulation" },
      ];
      if (explicitFlowAgrees([source, ...flow.flatMap((claim) => [claim.claim, claim.expected])], path, [...path, path[0]!])) {
        add("adult_human_circulation", flow.map((claim) => claim.id), [...path, path[0]!],
          ["blood", "pulmonary", "return", "blood", "systemic", "return"], "normal adult human blood-flow direction");
        limits.add("Normal adult human blood-flow topology only; boxes are compartments, not anatomical shapes, sizes, pressure traces or valve mechanics.");
      }
    }
  }

  // Stages, not a guessed voltage-time curve. Na influx and K efflux are
  // reference-bound causal transitions; no cell-specific voltage is inferred.
  if (has(source, ["action potential", "action potentials", "neuron", "neurons", "neuronal"])
    && !has(source, ["cardiac", "pacemaker", "cardiomyocyte", "skeletal muscle"])) {
    const stages = claims.filter((claim) => has(claim.text, ["action potential", "action potentials"]));
    const text = stages.map((claim) => claim.text).join(" ");
    const sodium = has(text, ["Na+", "sodium"]); const potassium = has(text, ["K+", "potassium"]);
    const phases = ["depolarization", "repolarization", "hyperpolarization"];
    const ionText = words([source, ...stages.flatMap((claim) => [claim.claim, claim.expected])].join(" ")).replace(/\bions?\b/g, "").replace(/\s+/g, " ");
    const reversedIons = has(ionText, ["sodium leaves", "Na+ leaves", "potassium enters", "K+ enters", "sodium exits", "potassium influx"]);
    if (phases.every((phase) => has(text, [phase])) && sodium && potassium
      && has(text, ["enters", "influx", "inward"]) && has(text, ["leaves", "efflux", "outward"])
      && has(text, ["resting", "rest"]) && !reversedIons && !contradicts(stages, phases)) {
      add("neuronal_action_potential", stages.map((claim) => claim.id), [
        { id: "resting_state", label: "at rest", role: "neuronal resting membrane state before the impulse" },
        { id: "depolarization", label: "voltage rises", role: "depolarization from sodium influx" },
        { id: "repolarization", label: "voltage falls", role: "repolarization from potassium efflux" },
        { id: "hyperpolarization", label: "undershoot", role: "afterhyperpolarization from continued potassium efflux" },
        { id: "restored_state", label: "restored rest", role: "restoration of the neuronal resting membrane state" },
      ], ["Na+ enters", "K+ leaves", "K+ continues", "return to rest"], "qualitative neuronal action-potential phase sequence");
      limits.add("Qualitative neuronal phase sequence only; no membrane voltage, time scale, channel count, ion concentration or numerical trace is asserted.");
    }
  }
  if (relations.length === 0 || nodes.size < 2) return null;
  // Mixing independent subject graphs would hide an unresolved source demand.
  const references = [...new Set(relations.map((relation) => relation.referenceId))];
  if (references.length !== 1) return null;
  return { version: SOURCE_CONCEPT_MODEL_VERSION, nodes: [...nodes.values()], relations, referenceIds: references, limits: [...limits] };
}

interface Position { x: number; y: number; width: number; height: number }
function graphPositions(model: SourceConceptModel): Map<string, Position> {
  const count = model.nodes.length;
  const indegree = new Map(model.nodes.map((node) => [node.id, 0]));
  for (const relation of model.relations) indegree.set(relation.to, indegree.get(relation.to)! + 1);
  const queue = model.nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!; order.push(id);
    for (const relation of model.relations.filter((edge) => edge.from === id)) {
      const next = indegree.get(relation.to)! - 1; indegree.set(relation.to, next);
      if (next === 0) queue.push(relation.to);
    }
  }
  const cyclic = order.length !== count;
  const ids = cyclic ? model.nodes.map((node) => node.id) : order;
  return new Map(ids.map((id, index) => {
    const node = model.nodes.find((entry) => entry.id === id)!;
    // Display units only. Width follows the label; cyclic graphs use a ring.
    const width = Math.max(1.65, node.label.length * 0.17 + 0.5);
    const angle = Math.PI / 2 - index * 2 * Math.PI / count;
    const columns = Math.min(3, count); const row = Math.floor(index / columns); const col = index % columns;
    const x = cyclic ? Math.cos(angle) * 4.1 : ((row % 2 === 0 ? col : columns - 1 - col) - (columns - 1) / 2) * 4.3;
    const y = cyclic ? Math.sin(angle) * 2.9 : -row * 2.2;
    return [id, { x, y, width, height: 0.8 }];
  }));
}
function edgeAttachment(box: Position, toward: Position): { x: number; y: number } {
  const dx = toward.x - box.x; const dy = toward.y - box.y;
  const scale = Math.min(dx === 0 ? Infinity : box.width / 2 / Math.abs(dx), dy === 0 ? Infinity : box.height / 2 / Math.abs(dy));
  return { x: box.x + dx * scale, y: box.y + dy * scale };
}

/** Compile only the admitted graph. Every directed edge touches its endpoints. */
export function buildSourceConceptRepresentation(question: string, turnPlan: unknown): SceneDocument | null {
  const model = readSourceConceptModel(question, turnPlan);
  if (!model) return null;
  const positions = graphPositions(model);
  const entities: SceneEntity[] = []; const constructions: SceneConstruction[] = []; const assertions: SceneAssertion[] = [];
  const point = (id: string, x: number, y: number): void => {
    entities.push({ id, kind: "point", role: "nonmetric relational-layout anchor" });
    constructions.push({ id: `make_${id}`, operator: "point", inputs: { x, y, coordinateSpace: "layout" }, outputs: [id] });
  };
  for (const node of model.nodes) {
    const p = positions.get(node.id)!; const center = `${node.id}_center`;
    point(center, p.x, p.y);
    entities.push({ ...node, kind: "rectangle", semantic: { sourceConceptNodeId: node.id }, provenance: { referenceIds: model.referenceIds } });
    constructions.push({ id: `make_${node.id}`, operator: "rectangle", inputs: { center, width: p.width, height: p.height }, outputs: [node.id] });
    assertions.push({ id: `${node.id}_label`, predicate: "label_attached", entities: [node.id], expected: true, severity: "fatal" });
  }
  for (const relation of model.relations) {
    const from = positions.get(relation.from)!; const to = positions.get(relation.to)!;
    const start = `${relation.id}_start`; const end = `${relation.id}_end`;
    const a = edgeAttachment(from, to); const b = edgeAttachment(to, from);
    point(start, a.x, a.y); point(end, b.x, b.y);
    entities.push({ id: relation.id, kind: "vector", role: relation.role, label: relation.label,
      semantic: { sourceConceptRelationId: relation.id, from: relation.from, to: relation.to },
      provenance: { referenceId: relation.referenceId, claimIds: relation.claimIds } });
    constructions.push({ id: `make_${relation.id}`, operator: "vector", inputs: { start, end }, outputs: [relation.id] });
    assertions.push(
      { id: `${relation.id}_from_attachment`, predicate: "incident", entities: [start, relation.from], expected: true, severity: "fatal" },
      { id: `${relation.id}_to_attachment`, predicate: "incident", entities: [end, relation.to], expected: true, severity: "fatal" },
      { id: `${relation.id}_start_proof`, predicate: "incident", entities: [start, relation.id], expected: true, severity: "fatal" },
      { id: `${relation.id}_end_proof`, predicate: "incident", entities: [end, relation.id], expected: true, severity: "fatal" },
      { id: `${relation.id}_label`, predicate: "label_attached", entities: [relation.id], expected: true, severity: "fatal" },
    );
  }
  const groups = model.relations.map((relation, index) => ({ id: `relation_${index + 1}`, entityIds: [relation.from, relation.to, relation.id].filter((id) =>
    id === relation.id || !model.relations.slice(0, index).some((previous) => previous.from === id || previous.to === id)),
    dependsOn: index ? [`relation_${index}`] : [], narrationCue: `${relation.from}: ${relation.label} -> ${relation.to}` }));
  return {
    schemaVersion: SCENE_DOCUMENT_VERSION,
    visualDecision: { mode: "scene", reason: "source-attached qualitative relations independently grounded in named reference laws" },
    source: { question, sourceConceptRepresentation: true, sourceConceptModel: model, representationScope: "reference_bound_component",
      conceptReferenceIds: model.referenceIds, conceptReferences: model.referenceIds.map((id) => SOURCE_CONCEPT_REFERENCES[id as keyof typeof SOURCE_CONCEPT_REFERENCES]),
      representationTier: "question_representation", synthesizedFamily: true, nonMetric: true, limits: model.limits },
    quantities: [], entities, constructions, relations: [], assertions, annotations: [],
    requiredEntityIds: [...model.nodes.map((node) => node.id), ...model.relations.map((relation) => relation.id)],
    revealGroups: groups,
    teachingTimeline: groups.map((group, index) => ({ id: `reveal_${group.id}`, action: "reveal", targetId: group.id,
      dependsOn: index ? [`reveal_${groups[index - 1]!.id}`] : [], narrationIntent: group.narrationCue })),
  };
}

/** Rebuild the source model independently; a valid foreign picture is not proof. */
export function sourceConceptRepresentationRejection(document: SceneDocument, question: string, turnPlan: unknown): string | null {
  const declared = "sourceConceptRepresentation" in document.source || "sourceConceptModel" in document.source
    || "conceptReferenceIds" in document.source || "conceptReferences" in document.source
    || document.entities.some((entity) => entity.semantic?.sourceConceptNodeId !== undefined
      || entity.semantic?.sourceConceptRelationId !== undefined
      || (typeof entity.provenance?.referenceId === "string" && entity.provenance.referenceId in SOURCE_CONCEPT_REFERENCES));
  if (!declared) return null;
  const expected = buildSourceConceptRepresentation(question, turnPlan);
  if (!expected) return "source_concept_binding_missing";
  for (const field of ["visualDecision", "source", "quantities", "entities", "constructions", "relations", "assertions", "annotations", "requiredEntityIds", "revealGroups", "teachingTimeline"] as const) {
    if (JSON.stringify(document[field]) !== JSON.stringify(expected[field])) return "source_concept_model_mismatch";
  }
  return null;
}
