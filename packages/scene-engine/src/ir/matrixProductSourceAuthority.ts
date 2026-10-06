/** Bounded ordered-product authority. Caller IR is checked whole and never rewritten. */
import { buildMatrixSourceDocument, readMatrixLiteralSourceProgram, readMatrixProductSourceProgram, validateMatrixSourceBinding } from "../compile/matrixSourceBinding";
import { matrixEntryDouble } from "../compile/matrixArrayGeometry";
import { snapshotMathSourceData } from "../compile/mathSourceData";
import { validateTurnPlanV3, type TurnPlanV3, type TurnPlanQuantityV3 } from "../contracts/contractsV3";
import { validateProblemIR, type ProblemIR } from "./problemIR";
import type { SceneDocument, SceneIssue } from "../types";

type Program = NonNullable<ReturnType<typeof readMatrixProductSourceProgram>>;
type Product = Program["products"][number];
const issue = (code: string, message: string, path = "sourceAuthority"): SceneIssue => ({ code: `matrix_product_${code}`, severity: "fatal", message, path });
const keys = (value: object, allowed: string): boolean => Object.keys(value).every(key => allowed.split(" ").includes(key));
const compact = (text: string): string => text.replace(/\s+/g, "").replace(/[.]$/u, "");
const unitless = (unit: unknown): boolean => unit === undefined || unit === "" || unit === "1" || unit === "dimensionless";
const unique = (ids: readonly string[]): boolean => new Set(ids).size === ids.length;

function requestName(text: string, source: Program): string | null {
  const expression = text.trim().replace(/^(?:Find|Show|Calculate|Compute|Determine|Evaluate|Write)\s+(?:the\s+)?(?:product\s+)?/iu, "").replace(/[.]$/u, "");
  const matches = source.products.filter(product => compact(expression) === compact(product.name)
    || compact(expression) === `${product.left}*${product.right}`
    || expression === `product of ${product.left} and ${product.right}`);
  return matches.length === 1 ? matches[0]!.name : null;
}

/** Every original fact/entity/request channel remains an obligation, including
 * fact-only requests when there is no numerical graph. Graph expansion is not
 * in this initial contract: an AST or extra constraint declines, never vanishes.
 */
export function matrixProductFullIRIssues(question: string, rawProblem: unknown): SceneIssue[] {
  const source = readMatrixProductSourceProgram(question);
  if (!source) return [issue("source_unsupported", "A complete bounded literal source with ordered binary products is required")];
  try {
    const problem = snapshotMathSourceData(rawProblem);
    const checked = validateProblemIR(problem, question);
    if (!checked.valid || !checked.problem || checked.problem.question !== question) return [issue("ir_invalid", "The complete original IR must be structurally valid and retain the exact question")];
    const ir = checked.problem;
    if (!keys(ir, "schemaVersion id question facts entities expressions constraints representationIntents solveRequests")) return [issue("ir_extra_channel", "Unowned full-IR channels cannot be ignored")];
    for (const field of ["expressions", "constraints", "representationIntents", "solveRequests"] as const) {
      if (ir[field].length) return [issue("ir_graph_unsupported", "This fact-bound product contract cannot certify an additional numerical, topology or intent graph", field)];
    }
    const roles = new Map<string, string>();
    for (const [index, fact] of ir.facts.entries()) {
      if (!keys(fact, "id kind statement evidence") || !keys(fact.evidence, "source start end quote")
        || question.slice(fact.evidence.start, fact.evidence.end) !== fact.evidence.quote) return [issue("fact_evidence", "Facts require unchanged source quotes at their declared evidence spans and no unowned fields", `facts[${index}]`)];
      if (fact.kind === "given") {
        const owners = source.matrices.filter(matrix => compact(fact.evidence.quote) === compact(matrix.quote)
          && compact(fact.statement.replace(/^Matrix\s+/u, "").replace(/\s+is\s+/u, "=")) === compact(matrix.quote));
        if (owners.length !== 1) return [issue("given_fact", "Given statement and evidence must agree with one entire named source literal", `facts[${index}]`)];
        roles.set(fact.id, owners[0]!.name);
      } else if (fact.kind === "requested") {
        const name = requestName(fact.statement, source);
        if (!name || requestName(fact.evidence.quote, source) !== name) return [issue("requested_fact", "Every requested fact must bind the same ordered product in statement and quote", `facts[${index}]`)];
        roles.set(fact.id, name);
      } else return [issue("assumption_fact", "Additional IR assumptions are outside the literal product contract", `facts[${index}]`)];
    }
    const names = [...source.matrices.map(matrix => matrix.name), ...source.products.map(product => product.name)];
    if (!unique([...roles.values()]) || names.length !== roles.size || names.some(name => ![...roles.values()].includes(name))) return [issue("facts_incomplete", "All given literals and requested products need exactly one owned original fact")];
    const entityNames = new Set<string>();
    for (const [index, entity] of ir.entities.entries()) {
      if (!keys(entity, "id kind label evidenceFactIds") || entity.kind !== "other" || !entity.label || !names.includes(entity.label)
        || entityNames.has(entity.label) || !entity.evidenceFactIds.length || !unique(entity.evidenceFactIds)
        || entity.evidenceFactIds.some(id => roles.get(id) !== entity.label)) return [issue("entity_role", "Every original entity needs a unique literal/product identity and its matching fact evidence", `entities[${index}]`)];
      entityNames.add(entity.label);
    }
    if (source.matrices.some(matrix => !entityNames.has(matrix.name))) return [issue("entities_incomplete", "Every supplied matrix must remain in the full original IR")];
    return [];
  } catch { return [issue("ir_data", "Full IR must be bounded own data; accessors, inherited fields, cycles and counterfeit numerics decline")]; }
}

interface CellRole { product: Product; row: number; column: number }
function cellRole(source: Program, quantity: { id: string; symbol: string }): CellRole | null {
  const matches: CellRole[] = [];
  for (const product of source.products) for (let row = 0; row < product.geometry.matrixArray.rows; row++) for (let column = 0; column < product.geometry.matrixArray.columns; column++) {
    const id = `${product.name}${row + 1}${column + 1}`;
    if (quantity.id === id && [id, `(${product.name})${row + 1}${column + 1}`].includes(quantity.symbol)) matches.push({ product, row, column });
  }
  return matches.length === 1 ? matches[0]! : null;
}
function inputCells(source: Program, role: CellRole): string[] {
  const left = source.matrices.find(matrix => matrix.name === role.product.left)!;
  return left.entries[role.row]!.flatMap((_, k) => [`${role.product.left}${role.row + 1}${k + 1}`, `${role.product.right}${k + 1}${role.column + 1}`]);
}

function entryExplanationProved(source: Program, role: CellRole, row: TurnPlanQuantityV3): boolean {
  if (row.sourceText === undefined) return true;
  if (typeof row.sourceText !== "string") return false;
  const left = source.matrices.find(matrix => matrix.name === role.product.left)!;
  const right = source.matrices.find(matrix => matrix.name === role.product.right)!;
  const factor = (value: string): string => value.startsWith("-") || value.includes("/") ? `(${value})` : value;
  const dot = left.entries[role.row]!.map((value, k) => `${factor(value)}*${factor(right.entries[k]![role.column]!)}`).join("+");
  const entry = role.product.geometry.matrixArray.exactEntries[role.row]![role.column]!;
  const result = entry.denominator === "1" ? entry.numerator : `${entry.numerator}/${entry.denominator}`;
  return [ `${dot}=${result}`, `${dot}=${row.value}` ].includes(compact(row.sourceText));
}

/** Parse exactly one entire result literal with the existing matrix grammar.
 * The quote equality prevents residual prose, second assertions or extra asks
 * from being admitted just because a correct literal occurs within them.
 */
function productLiteralProved(product: Product, text: string): boolean {
  const literal = readMatrixLiteralSourceProgram(`Let ${text}. Show ${product.name}.`);
  const matrix = literal?.matrices[0];
  return literal?.matrices.length === 1 && literal.requestedCells.length === 0
    && matrix?.name === product.name && compact(matrix.quote) === compact(text)
    && JSON.stringify(matrix.geometry.matrixArray.exactEntries) === JSON.stringify(product.geometry.matrixArray.exactEntries);
}

function claimProved(source: Program, plan: TurnPlanV3, claim: TurnPlanV3["qualitativeClaims"][number]): boolean {
  if (!keys(claim, "id claim expected relatedQuantityIds relatedEntityHints") || !Array.isArray(claim.relatedQuantityIds) || !claim.relatedQuantityIds.length
    || !unique(claim.relatedQuantityIds) || claim.relatedEntityHints !== undefined && (!Array.isArray(claim.relatedEntityHints) || claim.relatedEntityHints.length)
    || typeof claim.expected !== "string") return false;
  const product = source.products.find(candidate => claim.claim === `${candidate.name} is the matrix product ${candidate.left} times ${candidate.right}`
    || productLiteralProved(candidate, claim.claim));
  if (product) {
    const ids = [product.name, ...plan.derived.filter(row => cellRole(source, row)?.product.name === product.name).map(row => row.id)];
    return productLiteralProved(product, claim.expected)
      && claim.relatedQuantityIds.includes(product.name) && claim.relatedQuantityIds.every(id => ids.includes(id));
  }
  // Prove both parts of a local compound: the reversed products differ/equal,
  // and consequently multiplication for these source operands does not/does
  // commute. Neither a global assertion nor an additional conjunct is owned.
  if (claim.relatedQuantityIds.length !== 2) return false;
  const [first, second] = claim.relatedQuantityIds.map(id => source.products.find(product => product.name === id));
  if (!first || !second || first.left !== second.right || first.right !== second.left) return false;
  const equal = JSON.stringify(first.geometry.matrixArray.exactEntries) === JSON.stringify(second.geometry.matrixArray.exactEntries);
  const statement = equal ? "commutative" : "not commutative";
  const claims = [
    `Matrix multiplication is ${statement} here`,
    `${first.name} and ${second.name} ${equal ? "are equal" : "differ"}, so matrix multiplication is ${statement} here`,
  ];
  return claims.includes(claim.claim)
    && compact(claim.expected) === `${first.name}${equal ? "=" : "!="}${second.name}`;
}

function checkedPlan(question: string, rawPlan: unknown): TurnPlanV3 | null {
  try {
    const data = snapshotMathSourceData(rawPlan);
    if (!data || typeof data !== "object" || !("question" in data) || data.question !== question) return null;
    const checked = validateTurnPlanV3(data, question);
    if (!checked.valid || !checked.plan
      || !keys(data as object, "schemaVersion question givens unknowns derived qualitativeClaims lawIds assumptions visualRequirement teachingSequenceHints")) return null;
    return checked.plan;
  } catch { return null; }
}

function planIssues(source: Program, question: string, plan: TurnPlanV3): SceneIssue[] {
  const errors: SceneIssue[] = [];
  const document = buildMatrixSourceDocument(question);
  if (!document) return [issue("source_unsupported", "The complete source document cannot be proved")];
  errors.push(...validateMatrixSourceBinding(document, question, plan));
  if (plan.assumptions.some(text => !["Standard row-by-column matrix multiplication over the real numbers", "Standard row-by-column matrix multiplication over the reals"].includes(text.replace(/[.]$/u, "")))) errors.push(issue("assumption", "Every plan assumption must be a complete proved product proposition", "assumptions"));
  if (plan.lawIds.some(text => !["matrix-multiplication-definition", "matrix-multiplication"].includes(text) && !source.products.some(product => text === `matrix multiplication definition: (${product.name})ij = sum_k ${product.left}_ik ${product.right}_kj`))) errors.push(issue("law", "Unowned law tags cannot join product authority", "lawIds"));
  if (plan.teachingSequenceHints !== undefined && (!Array.isArray(plan.teachingSequenceHints) || plan.teachingSequenceHints.length)) errors.push(issue("hints", "Unresolved teaching entity hints require parent integration", "teachingSequenceHints"));
  if (plan.unknowns.length !== source.products.length || !unique(plan.unknowns.map(row => row.id))
    || plan.unknowns.some(row => !keys(row, "id symbol unit") || row.id !== row.symbol || !unitless(row.unit) || !source.products.some(product => product.name === row.id))) errors.push(issue("unknown", "Unknowns must retain exactly every requested ordered product", "unknowns"));
  const sourceCellIds = source.matrices.flatMap(matrix => matrix.entries.flatMap((entries, row) => entries.map((_, column) => `${matrix.name}${row + 1}${column + 1}`)));
  const givenIds = new Set(plan.givens.map(row => row.id));
  if (plan.givens.length !== sourceCellIds.length || !unique(plan.givens.map(row => row.id))
    || sourceCellIds.some(id => !givenIds.has(id))) errors.push(issue("givens_incomplete", "Numeric givens must contain every exact source input cell exactly once", "givens"));
  for (const [index, row] of plan.givens.entries()) {
    const owners = source.matrices.flatMap(matrix => matrix.entries.flatMap((entries, i) => entries.flatMap((_, j) => row.id === `${matrix.name}${i + 1}${j + 1}` && row.symbol === row.id
      ? [{ matrix, row: i, column: j }]
      : [])));
    const owner = owners[0];
    const sourceValue = owner ? matrixEntryDouble(owner.matrix.geometry.matrixArray.exactEntries[owner.row]![owner.column]!) : undefined;
    if (owners.length !== 1 || !owner || !keys(row, "id symbol value unit sign sourceText provenance dependsOn uncertainty") || !unitless(row.unit)
      || row.provenance !== "given" || row.uncertainty !== undefined && row.uncertainty !== 0 || row.dependsOn?.length
      || row.sourceText !== owner.matrix.quote || row.value !== sourceValue) {
      errors.push(issue("given", "Numeric givens must be exact source cells; a scalar matrix placeholder is never authority", `givens[${index}]`));
    }
  }
  let cells = 0;
  for (const product of source.products) cells += product.geometry.matrixArray.rows * product.geometry.matrixArray.columns;
  if (plan.derived.length !== cells || !unique(plan.derived.map(row => row.id))) errors.push(issue("cells_incomplete", "Every requested product entry needs one exact derived role", "derived"));
  for (const [index, row] of plan.derived.entries()) {
    const role = cellRole(source, row);
    if (!role || !keys(row, "id symbol value unit sign sourceText provenance dependsOn uncertainty") || !unitless(row.unit)
      || row.provenance !== "derived" || row.uncertainty !== undefined && row.uncertainty !== 0
      || row.value !== matrixEntryDouble(role.product.geometry.matrixArray.exactEntries[role.row]![role.column]!)
      || !entryExplanationProved(source, role, row)
      || !Array.isArray(row.dependsOn) || !unique(row.dependsOn)
      || row.dependsOn.length !== new Set(inputCells(source, role)).size
      || [...new Set(inputCells(source, role))].some(id => !givenIds.has(id) || !row.dependsOn!.includes(id))) {
      errors.push(issue("cell", "Derived identity, value, unit, uncertainty and complete unique dependencies must bind one exact product cell", `derived[${index}]`));
    }
  }
  if (plan.qualitativeClaims.some(claim => !claimProved(source, plan, claim))) errors.push(issue("claim", "Every claim and its complete expected value must be recomputed from the ordered source products", "qualitativeClaims"));
  return errors;
}

/** Strict public seam: proves whole original plans; scalar matrix zeros decline. */
export function matrixProductSourcePlanIssues(question: string, rawPlan: unknown): SceneIssue[] {
  const source = readMatrixProductSourceProgram(question);
  if (!source) return [issue("source_unsupported", "The bounded ordered-product source contract does not apply")];
  const plan = checkedPlan(question, rawPlan);
  return plan ? planIssues(source, question, plan) : [issue("plan_invalid", "The complete actual plan must remain valid own data")];
}

export interface MatrixProductSourceAlias {
  kind: "matrix_source_alias";
  quantityId: string;
  name: string;
  quote: string;
  exactEntries: Product["geometry"]["matrixArray"]["exactEntries"];
  numericScalarAuthority: false;
}
export interface MatrixProductPlanCorrection {
  plan: TurnPlanV3;
  sourceAliases: MatrixProductSourceAlias[];
  audit: {
    originalIssues: SceneIssue[];
    withdrawn: TurnPlanQuantityV3[];
    dependencies: Array<{ quantityId: string; previous: string[]; corrected: string[] }>;
  };
}

/** Compatibility admission seam. No placeholder withdrawal, dependency rewrite
 * or surrogate plan is allowed: the entire original plan either proves or
 * declines. The empty correction audit explicitly records that nothing changed.
 */
export function correctMatrixProductSourcePlan(question: string, rawPlan: unknown): MatrixProductPlanCorrection | null {
  if (matrixProductSourcePlanIssues(question, rawPlan).length) return null;
  return {
    plan: rawPlan as TurnPlanV3,
    sourceAliases: [],
    audit: { originalIssues: [], withdrawn: [], dependencies: [] },
  };
}

/** All-seams sidecar for the parent. Missing/full contradictory IR declines;
 * successful admission returns the exact caller IR reference unchanged.
 */
export function prepareMatrixProductSourceAuthority(question: string, rawPlan: unknown, originalProblemIR: ProblemIR): {
  plan: TurnPlanV3; problemIR: ProblemIR; document: SceneDocument; correction: MatrixProductPlanCorrection;
} | null {
  if (matrixProductFullIRIssues(question, originalProblemIR).length) return null;
  const correction = correctMatrixProductSourcePlan(question, rawPlan);
  if (!correction) return null;
  const document = buildMatrixSourceDocument(question, correction.plan);
  return document && !matrixProductSourceDocumentIssues(document, question, originalProblemIR, correction.plan).length
    ? { plan: correction.plan, problemIR: originalProblemIR, document, correction } : null;
}

/** Parent central/compile/persistence hook: no graph-absence exemption. */
export function matrixProductSourceDocumentIssues(document: SceneDocument, question: string, originalProblemIR: unknown, rawPlan: unknown): SceneIssue[] {
  const errors = [...matrixProductFullIRIssues(question, originalProblemIR), ...matrixProductSourcePlanIssues(question, rawPlan)];
  if (errors.length) return errors;
  try {
    const captured = snapshotMathSourceData(document);
    errors.push(...validateMatrixSourceBinding(captured, question, rawPlan));
    if (captured.visualDecision.mode !== "scene" || captured.source.nonMetric !== true || captured.source.question !== question
      || !keys(captured.source, "question representationTier nonMetric")) errors.push(issue("document_tier", "Product documents retain the whole source question and a nonmetric table, with no hidden plan channels"));
    // Whole source binding independently recomputes every literal/product.
    // Bind presentation semantics to the complete deterministic source document
    // too: supplied roles/cues become FOCUS meanings and fixed intro narration.
    // Caller evidence never authorizes alternative prose or reveal sequencing.
    const expected = buildMatrixSourceDocument(question)!;
    if (captured.entities.length !== expected.entities.length || captured.quantities.length
      || captured.annotations.length || captured.relations.length || captured.assertions.length || captured.teachingTimeline.length) errors.push(issue("document_extra_channel", "The initial deterministic product document cannot carry unrelated entities, quantities or annotation/proof channels"));
    const entityIds = new Map<string, string>();
    for (const entity of expected.entities) {
      const matches = captured.entities.filter(row => row.kind === "matrix_array" && row.label === entity.label);
      if (matches.length !== 1 || !captured.requiredEntityIds.includes(matches[0]!.id)
        || !captured.revealGroups.some(group => group.entityIds.includes(matches[0]!.id))) {
        errors.push(issue("document_ownership", "Every given and requested product must retain its unique required and revealed matrix identity"));
        continue;
      }
      const supplied = matches[0]!;
      entityIds.set(entity.id, supplied.id);
      if (supplied.role !== entity.role || !keys(supplied, "id kind label role")) errors.push(issue("document_role", "Every matrix role must retain its independently proved source meaning without additional semantic channels", `entities[${captured.entities.indexOf(supplied)}]`));
    }
    const requiredIds = expected.requiredEntityIds.map(id => entityIds.get(id));
    if (!unique(captured.entities.map(entity => entity.id)) || !unique(captured.requiredEntityIds)
      || captured.requiredEntityIds.length !== requiredIds.length || requiredIds.some(id => id === undefined || !captured.requiredEntityIds.includes(id))) errors.push(issue("document_required", "Required membership must contain exactly the complete source-owned matrix identities", "requiredEntityIds"));
    // IDs are transport identities, not mathematical authority. A consistent
    // bijective renaming is allowed; membership and dependency order are not.
    const groupIds = new Map(expected.revealGroups.map((group, index) => [group.id, captured.revealGroups[index]?.id]));
    if (captured.revealGroups.length !== expected.revealGroups.length || !unique(captured.revealGroups.map(group => group.id))) errors.push(issue("document_reveal", "Reveal groups must retain every source-owned beat exactly once", "revealGroups"));
    for (const [index, group] of expected.revealGroups.entries()) {
      const supplied = captured.revealGroups[index];
      const members = group.entityIds.map(id => entityIds.get(id));
      const dependencies = group.dependsOn.map(id => groupIds.get(id));
      if (!supplied || !keys(supplied, "id entityIds dependsOn narrationCue")
        || supplied.narrationCue !== group.narrationCue
        || supplied.entityIds.length !== members.length || members.some((id, i) => id === undefined || supplied.entityIds[i] !== id)
        || supplied.dependsOn.length !== dependencies.length || dependencies.some((id, i) => id === undefined || supplied.dependsOn[i] !== id)) {
        errors.push(issue("document_reveal", "Reveal narration, membership, dependencies and order must match the independently proved complete product document", `revealGroups[${index}]`));
      }
    }
    return errors;
  } catch { return [issue("document_data", "The product document cannot be independently captured")]; }
}
