export interface InputRole {
  readonly role: string;
  readonly unit: string;
  /** Categorical values must be proved by one of these affirmative source
   * phrases instead of a fabricated numeric flag literal. */
  readonly sourcePhrases?: Readonly<Record<string, readonly string[]>>;
  /** Some closed models use a source-declared selector to choose the physical
   * dimension of another input (for example spectrum bounds in Hz or m). */
  readonly unitByInput?: {
    readonly key: string;
    readonly cases: Readonly<Record<string, string>>;
  };
}

export interface ModelAdmissionRule {
  readonly when: {
    readonly presentAny?: readonly string[];
    readonly absentAll?: readonly string[];
    readonly equals?: Readonly<Record<string, number>>;
  };
  readonly requiredKeys?: readonly string[];
  readonly forbiddenKeys?: readonly string[];
  readonly requiredAnyGroup?: readonly (readonly string[])[];
  readonly assumptions?: readonly string[];
  readonly roleOverrides?: Readonly<Record<string, Partial<InputRole>>>;
}

export interface InputSequenceAdmission {
  readonly indexStart: number;
  readonly minItems: number;
  readonly maxItems: number;
  /** Field names are key prefixes; role may contain an {index} placeholder. */
  readonly fields: Readonly<Record<string, InputRole>>;
}

export interface ModelAdmission {
  readonly name: string;
  readonly roles: Readonly<Record<string, InputRole>>;
  readonly optionalRoles?: Readonly<Record<string, InputRole>>;
  /** If any member is supplied, every member of that group is required. */
  readonly optionalGroups?: readonly (readonly string[])[];
  /** Source-visible cross-group dependencies and conditional premises. */
  readonly conditionalRules?: readonly ModelAdmissionRule[];
  readonly sequences?: readonly InputSequenceAdmission[];
  readonly assumptions: readonly string[];
  /** Representation models validate source inputs but deliberately prove no scalar. */
  readonly resultKind?: "scalar" | "representation";
  readonly scalar: (inputs: Readonly<Record<string, number>>) => Readonly<Record<string, number>>;
}

export interface ModelAdmissionCatalogEntry {
  readonly name: string;
  readonly roles: Readonly<Record<string, InputRole>>;
  readonly optionalRoles: Readonly<Record<string, InputRole>>;
  readonly optionalGroups: readonly (readonly string[])[];
  readonly conditionalRules: readonly ModelAdmissionRule[];
  readonly sequences: readonly InputSequenceAdmission[];
  readonly assumptions: readonly string[];
  readonly resultKind: "scalar" | "representation";
}

export interface AdmissionIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export type GroundResult =
  | { readonly ok: true; readonly model: string; readonly inputs: Readonly<Record<string, number>> }
  | { readonly ok: false; readonly reason: string };

const admissions = new Map<string, ModelAdmission>();

export function registerModelAdmission(admission: ModelAdmission): void {
  admissions.set(admission.name, admission);
}

export function modelAdmission(name: string): ModelAdmission | undefined {
  return admissions.get(name);
}

/** Source-formulation contract only. This catalog neither classifies a topic
 * nor selects a model: the caller may emit a named request only when the
 * submitted question itself contains every listed role, value, unit and
 * assumption. */
export function modelAdmissionCatalog(): readonly ModelAdmissionCatalogEntry[] {
  return [...admissions.values()]
    .map((admission) => ({
      name: admission.name,
      roles: admission.roles,
      optionalRoles: admission.optionalRoles ?? {},
      optionalGroups: admission.optionalGroups ?? [],
      conditionalRules: admission.conditionalRules ?? [],
      sequences: admission.sequences ?? [],
      assumptions: admission.assumptions,
      resultKind: admission.resultKind ?? "scalar",
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function sequenceRole(admission: ModelAdmission, key: string): { role: InputRole; sequence: InputSequenceAdmission; field: string; index: number } | null {
  for (const sequence of admission.sequences ?? []) {
    for (const [field, template] of Object.entries(sequence.fields)) {
      if (!key.startsWith(field)) continue;
      const suffix = key.slice(field.length);
      if (!/^(0|[1-9][0-9]*)$/.test(suffix)) continue;
      const index = Number(suffix);
      if (index < sequence.indexStart || index >= sequence.indexStart + sequence.maxItems) continue;
      return {
        role: { ...template, role: template.role.replaceAll("{index}", String(index)) },
        sequence,
        field,
        index,
      };
    }
  }
  return null;
}

function ruleIsActive(rule: ModelAdmissionRule, inputs: Readonly<Record<string, number>>): boolean {
  const keys = new Set(Object.keys(inputs));
  if (rule.when.presentAny && !rule.when.presentAny.some((key) => keys.has(key))) return false;
  if (rule.when.absentAll && rule.when.absentAll.some((key) => keys.has(key))) return false;
  if (rule.when.equals && Object.entries(rule.when.equals).some(([key, value]) => inputs[key] !== value)) return false;
  return true;
}

function resolvedRole(admission: ModelAdmission, key: string, inputs: Readonly<Record<string, number>>): InputRole | undefined {
  const base = admission.roles[key] ?? admission.optionalRoles?.[key] ?? sequenceRole(admission, key)?.role;
  if (!base) return undefined;
  let role: InputRole = base;
  for (const rule of admission.conditionalRules ?? []) {
    if (!ruleIsActive(rule, inputs)) continue;
    const override = rule.roleOverrides?.[key];
    if (override) role = { ...role, ...override };
  }
  if (role.unitByInput) {
    const selector = inputs[role.unitByInput.key];
    const unit = selector === undefined ? undefined : role.unitByInput.cases[String(selector)];
    if (unit) role = { ...role, unit };
  }
  return role;
}

export function modelAdmissionRole(name: string, key: string, inputs: Readonly<Record<string, number>> = {}): InputRole | undefined {
  const admission = admissions.get(name);
  if (!admission) return undefined;
  return resolvedRole(admission, key, inputs);
}

export function modelAdmissionEvidenceText(name: string, key: string, value: number, inputs: Readonly<Record<string, number>> = {}): string | undefined {
  const inputRole = modelAdmissionRole(name, key, inputs);
  if (!inputRole) return undefined;
  const phrase = inputRole.sourcePhrases?.[String(value)]?.[0];
  return phrase ? `The source states ${phrase}.` : `The ${inputRole.role} is ${value} ${inputRole.unit}.`;
}

export function modelAdmissionRequiredAssumptions(name: string, inputs: Readonly<Record<string, number>> = {}): readonly string[] {
  const admission = admissions.get(name);
  if (!admission) return [];
  return [...new Set([
    ...admission.assumptions,
    ...(admission.conditionalRules ?? []).filter((rule) => ruleIsActive(rule, inputs)).flatMap((rule) => rule.assumptions ?? []),
  ])];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phrasePattern(phrase: string, flags = "i"): RegExp {
  const body = phrase
    .trim()
    .split(/[\s-]+/)
    .map(escapePattern)
    .join("[\\s-]+");
  return new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, flags);
}

function hasPhrase(text: string, phrase: string): boolean {
  return phrase.trim().length > 0 && phrasePattern(phrase).test(text);
}

function exactQuestionEvidence(question: string, evidence: Record<string, unknown>): string | null {
  if (
    evidence.source !== "question"
    || !Number.isInteger(evidence.start)
    || !Number.isInteger(evidence.end)
    || typeof evidence.start !== "number"
    || typeof evidence.end !== "number"
    || typeof evidence.quote !== "string"
    || evidence.start < 0
    || evidence.end < evidence.start
    || evidence.end > question.length
    || question.slice(evidence.start, evidence.end) !== evidence.quote
  ) return null;
  return evidence.quote;
}

/** The nearest prose clause is the source-owned role/value association. */
function evidenceClause(question: string, start: number, end: number): string {
  const left = Math.max(
    question.lastIndexOf(".", Math.max(0, start - 1)),
    question.lastIndexOf("!", Math.max(0, start - 1)),
    question.lastIndexOf("?", Math.max(0, start - 1)),
    question.lastIndexOf(";", Math.max(0, start - 1)),
    question.lastIndexOf(",", Math.max(0, start - 1)),
  );
  const candidates = [".", "!", "?", ";", ","]
    .map((delimiter) => question.indexOf(delimiter, end))
    .filter((index) => index >= 0);
  const right = candidates.length > 0 ? Math.min(...candidates) : question.length;
  return question.slice(left + 1, right);
}

const assumptionConflicts: Readonly<Record<string, readonly string[]>> = {
  balanced: ["unbalanced", "not balanced"],
  uniform: ["nonuniform", "non-uniform", "not uniform"],
  "conventional current": ["not conventional current"],
  steady: ["unsteady", "not steady", "time-varying"],
  constant: ["nonconstant", "non-constant", "not constant", "time-varying"],
  isotropic: ["anisotropic", "not isotropic"],
  linear: ["nonlinear", "non-linear", "not linear"],
  discharging: ["charging", "not discharging"],
  ohmic: ["nonohmic", "non-ohmic", "not ohmic"],
};

function contradictsAssumption(question: string, phrase: string): boolean {
  if ((assumptionConflicts[phrase.toLowerCase()] ?? []).some((conflict) => hasPhrase(question, conflict))) return true;
  const phraseSource = phrasePattern(phrase).source
    .replace(/^\(\?<!\[A-Za-z0-9\]\)/, "")
    .replace(/\(\?!\[A-Za-z0-9\]\)$/, "");
  // An assumption phrase occurring inside a negated source clause is not
  // affirmative evidence. Keep the window bounded so an unrelated earlier
  // "not" cannot poison a later sentence.
  const genericNegation = new RegExp(`(?:\\bnot\\b|\\bno\\b|\\bwithout\\b)[^.!?;,]{0,48}${phraseSource}`, "i");
  const nonPrefix = new RegExp(`\\bnon[-\\s]+${phraseSource}`, "i");
  return genericNegation.test(question) || nonPrefix.test(question);
}

function phraseIsNegated(text: string, phrase: string): boolean {
  const phraseSource = phrasePattern(phrase).source
    .replace(/^\(\?<!\[A-Za-z0-9\]\)/, "")
    .replace(/\(\?!\[A-Za-z0-9\]\)$/, "");
  return new RegExp(`(?:\\bnot\\b|\\bno\\b|\\bwithout\\b)[^.!?;,]{0,48}${phraseSource}`, "i").test(text)
    || new RegExp(`\\bnon[-\\s]+${phraseSource}`, "i").test(text);
}

function numberToken(value: number): boolean {
  return Number.isFinite(value);
}

function quoteHasNumber(quote: string, value: number): boolean {
  const token = String(value);
  const escaped = escapePattern(token);
  // Unit exponents such as the 2 in m^2 are syntax, not a source quantity.
  // Without excluding '^', changing a quoted Coulomb coefficient from 1 to 2
  // could be falsely "proved" by the square in N*m^2/C^2.
  return new RegExp(`(?<![0-9.+\\-^])${escaped}(?![0-9])`).test(quote);
}

function factById(facts: readonly unknown[], id: string): Record<string, unknown> | null {
  const fact = facts.find((entry) => isRecord(entry) && entry.id === id);
  return isRecord(fact) ? fact : null;
}

function expressionValue(expressions: readonly unknown[], id: string, evidenceFactId?: string): number | null {
  const expression = expressions.find((entry) => isRecord(entry) && entry.id === id);
  if (!isRecord(expression) || !isRecord(expression.root) || expression.root.kind !== "number") return null;
  if (evidenceFactId !== undefined && (!Array.isArray(expression.evidenceFactIds) || !expression.evidenceFactIds.includes(evidenceFactId))) return null;
  const value = expression.root.value;
  return typeof value === "number" && numberToken(value) ? value : null;
}

function readRequest(problem: unknown, requestId?: string): Record<string, unknown> | null {
  if (!isRecord(problem) || !Array.isArray(problem.solveRequests)) return null;
  const requests = problem.solveRequests.filter((entry) => isRecord(entry) && entry.kind === "explicit_physical_model");
  const request = requestId === undefined
    ? requests.length === 1 ? requests[0] : undefined
    : requests.find((entry) => entry.id === requestId);
  return isRecord(request) ? request : null;
}

export function explicitModelAdmissionIssues(args: {
  readonly request: unknown;
  readonly question: string;
  readonly facts: readonly unknown[];
  readonly expressions: readonly unknown[];
  readonly path: string;
}): readonly AdmissionIssue[] {
  const issues: AdmissionIssue[] = [];
  const request = args.request;
  if (!isRecord(request)) return issues;
  if (!Array.isArray(request.bindings) || request.bindings.length === 0) {
    issues.push({
      code: "ungrounded_physical_inputs",
      path: `${args.path}.bindings`,
      message: "physical model inputs require a source binding for every number",
    });
    return issues;
  }
  const model = typeof request.model === "string" ? request.model : "";
  const admission = admissions.get(model);
  if (!admission) {
    issues.push({
      code: "unadmitted_physical_model",
      path: `${args.path}.model`,
      message: "this physical model is not admitted until its inputs, roles, and assumptions are source-bound",
    });
    return issues;
  }
  const seen = new Set<string>();
  const boundValues: Record<string, number> = {};
  for (const binding of request.bindings) {
    if (!isRecord(binding) || typeof binding.key !== "string" || typeof binding.expressionId !== "string") continue;
    const value = expressionValue(args.expressions, binding.expressionId, typeof binding.evidenceFactId === "string" ? binding.evidenceFactId : undefined);
    if (value !== null) boundValues[binding.key] = value;
  }
  for (const [index, binding] of request.bindings.entries()) {
    const bindingPath = `${args.path}.bindings[${index}]`;
    if (!isRecord(binding) || typeof binding.key !== "string" || typeof binding.role !== "string" || typeof binding.expressionId !== "string" || typeof binding.unit !== "string" || typeof binding.evidenceFactId !== "string") {
      issues.push({ code: "ungrounded_physical_inputs", path: bindingPath, message: "a physical binding needs key, role, unit, expressionId, and evidenceFactId" });
      continue;
    }
    if (seen.has(binding.key)) {
      issues.push({ code: "ungrounded_physical_inputs", path: bindingPath, message: `${binding.key} has duplicate source bindings` });
      continue;
    }
    seen.add(binding.key);
    const role = resolvedRole(admission, binding.key, boundValues);
    if (!role || binding.role !== role.role || binding.unit !== role.unit) {
      issues.push({ code: "wrong_role_binding", path: bindingPath, message: `${binding.key} is not bound to its declared role and unit` });
      continue;
    }
    const value = expressionValue(args.expressions, binding.expressionId, binding.evidenceFactId);
    const fact = factById(args.facts, binding.evidenceFactId);
    const evidence = fact && isRecord(fact.evidence) ? fact.evidence : null;
    const quote = evidence ? exactQuestionEvidence(args.question, evidence) : null;
    const clause = quote && evidence && typeof evidence.start === "number" && typeof evidence.end === "number"
      ? evidenceClause(args.question, evidence.start, evidence.end)
      : "";
    const categoricalPhrases = role?.sourcePhrases?.[String(value)];
    const competingCategoricalPhrase = role?.sourcePhrases !== undefined
      && Object.entries(role.sourcePhrases).some(([candidateValue, phrases]) =>
        candidateValue !== String(value) && phrases.some((phrase) => hasPhrase(quote ?? "", phrase)));
    const categoricalGrounded = categoricalPhrases !== undefined
      && categoricalPhrases.length > 0
      && categoricalPhrases.some((phrase) => hasPhrase(quote ?? "", phrase) && !phraseIsNegated(quote ?? "", phrase))
      && !competingCategoricalPhrase;
    const numericGrounded = categoricalPhrases === undefined
      && quote !== null
      && quoteHasNumber(quote, value ?? Number.NaN)
      && phrasePattern(role?.unit ?? "", "").test(quote)
      && hasPhrase(clause, role?.role ?? "");
    if (
      fact?.kind !== "given"
      || value === null
      || quote === null
      || (!categoricalGrounded && !numericGrounded)
    ) {
      issues.push({ code: "ungrounded_physical_inputs", path: bindingPath, message: `${binding.key} is not grounded in a source fact for its role, unit, and value` });
    }
  }
  for (const key of Object.keys(admission.roles)) {
    if (!seen.has(key)) issues.push({ code: "ungrounded_physical_inputs", path: `${args.path}.bindings`, message: `${key} has no source binding` });
  }
  for (const group of admission.optionalGroups ?? []) {
    const supplied = group.filter((key) => seen.has(key));
    if (supplied.length > 0 && supplied.length !== group.length) {
      issues.push({ code: "ungrounded_physical_inputs", path: `${args.path}.bindings`, message: `optional source group must include ${group.join(", ")}` });
    }
  }
  const activeRules = (admission.conditionalRules ?? []).filter((rule) => ruleIsActive(rule, boundValues));
  for (const rule of activeRules) {
    for (const key of rule.requiredKeys ?? []) {
      if (!seen.has(key)) issues.push({ code: "ungrounded_physical_inputs", path: `${args.path}.bindings`, message: `conditional source variant requires ${key}` });
    }
    for (const key of rule.forbiddenKeys ?? []) {
      if (seen.has(key)) issues.push({ code: "ungrounded_physical_inputs", path: `${args.path}.bindings`, message: `conditional source variant forbids ${key}` });
    }
    if (rule.requiredAnyGroup && !rule.requiredAnyGroup.some((group) => group.every((key) => seen.has(key)))) {
      issues.push({ code: "ungrounded_physical_inputs", path: `${args.path}.bindings`, message: `conditional source variant requires one complete group: ${rule.requiredAnyGroup.map((group) => group.join(", ")).join(" or ")}` });
    }
  }
  for (const sequence of admission.sequences ?? []) {
    const indices = new Set<number>();
    for (const key of seen) {
      const resolved = sequenceRole({ ...admission, sequences: [sequence] }, key);
      if (resolved) indices.add(resolved.index);
    }
    const ordered = [...indices].sort((left, right) => left - right);
    if (ordered.length < sequence.minItems) {
      issues.push({ code: "ungrounded_physical_inputs", path: `${args.path}.bindings`, message: `source sequence needs at least ${sequence.minItems} complete item(s)` });
      continue;
    }
    const expected = Array.from({ length: ordered.length }, (_, offset) => sequence.indexStart + offset);
    if (ordered.some((index, offset) => index !== expected[offset])) {
      issues.push({ code: "ungrounded_physical_inputs", path: `${args.path}.bindings`, message: "source sequence indices must be contiguous" });
      continue;
    }
    for (const index of ordered) {
      for (const field of Object.keys(sequence.fields)) {
        if (!seen.has(`${field}${index}`)) {
          issues.push({ code: "ungrounded_physical_inputs", path: `${args.path}.bindings`, message: `source sequence item ${index} is missing ${field}` });
        }
      }
    }
  }
  const assumptionFacts = args.facts.filter((fact) => isRecord(fact) && fact.kind === "assumption");
  const requiredAssumptions = [...new Set([
    ...admission.assumptions,
    ...activeRules.flatMap((rule) => rule.assumptions ?? []),
  ])];
  for (const phrase of requiredAssumptions) {
    const quoted = assumptionFacts.some((fact) => {
      if (!isRecord(fact) || !isRecord(fact.evidence)) return false;
      const quote = exactQuestionEvidence(args.question, fact.evidence);
      return quote !== null && hasPhrase(quote, phrase);
    });
    if (!quoted || contradictsAssumption(args.question, phrase)) {
      issues.push({ code: "missing_assumption", path: `${args.path}.assumptions`, message: `assumption "${phrase}" is not unambiguously quoted from the question` });
    }
  }
  return issues;
}

export function groundExplicitModel(question: string, problem: unknown, requestId?: string): GroundResult {
  const request = readRequest(problem, requestId);
  if (!request || typeof request.model !== "string") return { ok: false, reason: "explicit physical model is incomplete" };
  if (!isRecord(problem)) return { ok: false, reason: "explicit physical model is incomplete" };
  const facts = Array.isArray(problem.facts) ? problem.facts : [];
  const expressions = Array.isArray(problem.expressions) ? problem.expressions : [];
  const issues = explicitModelAdmissionIssues({ request, question, facts, expressions, path: "solveRequests" });
  if (issues.length > 0) return { ok: false, reason: issues[0]?.message ?? "explicit physical model is not grounded" };
  const admission = admissions.get(request.model);
  if (!admission || !Array.isArray(request.bindings)) return { ok: false, reason: "explicit physical model is not admitted" };
  const inputs: Record<string, number> = {};
  for (const binding of request.bindings) {
    if (!isRecord(binding) || typeof binding.key !== "string" || typeof binding.expressionId !== "string") continue;
    const value = expressionValue(expressions, binding.expressionId);
    if (value === null) return { ok: false, reason: `${binding.key} is not a source number` };
    inputs[binding.key] = value;
  }
  return { ok: true, model: request.model, inputs };
}

export function explicitModelScalar(name: string, inputs: Readonly<Record<string, number>>): Readonly<Record<string, number>> | null {
  const admission = admissions.get(name);
  if (!admission) return null;
  return admission.scalar(inputs);
}

/** A representation request is complete without a numeric SolverValue only
 * when the exact source-grounded model deterministically proves no outputs.
 * Numeric models cannot opt into this path merely by omitting resultBinding. */
export function explicitModelIsRepresentation(question: string, problem: unknown, requestId: string): boolean {
  const grounded = groundExplicitModel(question, problem, requestId);
  if (!grounded.ok) return false;
  try {
    if (admissions.get(grounded.model)?.resultKind !== "representation") return false;
    const outputs = explicitModelScalar(grounded.model, grounded.inputs);
    return outputs !== null && Object.keys(outputs).length === 0;
  } catch {
    return false;
  }
}
