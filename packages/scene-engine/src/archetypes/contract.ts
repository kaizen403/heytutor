/**
 * Picture contracts — completeness, not just consistency.
 *
 * The validator proves a document is internally coherent. A contract asks
 * the other question: does this document contain what the figure needs to
 * be *this* figure? An incline FBD without a normal, a mirror diagram with
 * no image, a v–t graph with fewer phases than the stem names all compile;
 * none of them should reach the board under this archetype's name.
 *
 * Contracts are checked on generated documents and can be checked on
 * planner-authored ones; the issues read like repair instructions.
 */
import type { SceneDocument, SceneIssue } from "../types";
import { ARCHETYPES, type ArchetypeId, type PictureContract } from "./catalog";

function roleText(document: SceneDocument): string[] {
  return document.entities.map((entity) => `${entity.role} ${entity.label ?? ""}`.toLowerCase());
}

function countRole(roles: readonly string[], role: string): number {
  const needle = role.toLowerCase();
  return roles.filter((text) => text.includes(needle)).length;
}

export function checkPictureContract(document: SceneDocument, archetype: ArchetypeId): SceneIssue[] {
  const contract: PictureContract = ARCHETYPES[archetype].contract;
  const roles = roleText(document);
  const operators = new Set(document.constructions.map((construction) => construction.operator));
  const symbols = new Set(
    document.constructions
      .filter((construction) => construction.operator === "symbol")
      .map((construction) => String(construction.inputs.symbol ?? "")),
  );
  const issues: SceneIssue[] = [];
  const fatal = (code: string, message: string): void => {
    issues.push({ code, message, severity: "fatal", path: `$.archetype.${archetype}` });
  };

  for (const role of contract.roles) {
    if (countRole(roles, role) === 0) fatal("picture_missing_role", `${archetype} needs an entity with role "${role}"`);
  }
  for (const [role, minimum] of Object.entries(contract.minRoleCount ?? {})) {
    const count = countRole(roles, role);
    if (count < minimum) fatal("picture_missing_role", `${archetype} needs ${minimum} entities with role "${role}", found ${count}`);
  }
  for (const operator of contract.operators ?? []) {
    if (!operators.has(operator)) fatal("picture_missing_operator", `${archetype} needs a ${operator} construction`);
  }
  for (const symbol of contract.symbols ?? []) {
    if (!symbols.has(symbol)) fatal("picture_missing_symbol", `${archetype} needs a ${symbol} symbol`);
  }
  for (const symbol of contract.forbidSymbols ?? []) {
    if (symbols.has(symbol)) fatal("picture_contradiction", `${archetype} must not contain a ${symbol} symbol`);
  }
  for (const operator of contract.forbidOperators ?? []) {
    if (operators.has(operator)) fatal("picture_contradiction", `${archetype} must not use ${operator}`);
  }
  for (const role of contract.forbidRoles ?? []) {
    if (countRole(roles, role) > 0) fatal("picture_contradiction", `${archetype} must not contain an entity with role "${role}"`);
  }
  return issues;
}

/**
 * Fatal metric assertions present in the document from the archetype's own
 * metric list, or from the engine-wide metric set. Topology and existence
 * predicates never count.
 */
export const METRIC_PROOF_PREDICATES: ReadonlySet<string> = new Set([
  "snells_law",
  "equal_angle",
  "distance_ratio",
  "function_value",
  "angle_between",
  "vector_sum",
  "root",
]);

export function metricAssertions(document: SceneDocument, archetype?: ArchetypeId): string[] {
  const contractMetric = new Set<string>(archetype ? ARCHETYPES[archetype].contract.metric : []);
  return document.assertions
    .filter((assertion) => {
      if (assertion.severity !== "fatal" || assertion.expected === undefined) return false;
      // Engine-wide metric predicates carry a value; existence-style `true` never counts.
      if (METRIC_PROOF_PREDICATES.has(assertion.predicate)) return typeof assertion.expected !== "boolean";
      // An archetype may name a relation as its metric proof (e.g. converges for a ray diagram).
      return contractMetric.has(assertion.predicate) && !["exists", "label_attached", "connected", "path", "sameTerminalPair"].includes(assertion.predicate);
    })
    .map((assertion) => assertion.predicate);
}
