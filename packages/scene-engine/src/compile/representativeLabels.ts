import type { SceneConstruction, SceneDocument, SceneIssue } from "../types";

/**
 * A normalized representative draws one textbook configuration from chosen
 * inputs (a unit charge, a lens with f=1, emfs 2 and 1). Its proofs certify
 * the shape, not physical measurements, so any value an operator computes
 * from those inputs describes the arbitrary choice and not the question.
 * Such a document keeps role or symbol labels on physical operator ink.
 */
export function declaresNormalizedRepresentative(document: Pick<SceneDocument, "source">): boolean {
  const source = document.source as Record<string, unknown> | undefined;
  return source?.nonMetric === true || source?.representationTier === "qualitative_verified";
}

/** Operators whose result labels can state a value computed from physical inputs. */
export const PHYSICAL_VALUE_LABEL_OPERATORS: ReadonlySet<string> = new Set([
  "magnetic_force", "magnetic_components",
  "gaussian_image", "optical_focus",
  "metre_bridge", "potentiometer", "incline_friction", "cyclotron",
  "relative_velocity", "motion_graph", "uniform_circular_motion", "projectile_trajectory", "work_interval",
  "spring_energy", "potential_curve", "collision", "loop_torque", "galvanometer", "bar_magnet",
  "current_element_field", "conductor_force", "parallel_wire_force", "magnetic_dipole_field", "solenoid_field",
  "free_body", "coupled_bodies", "vertical_circle", "mechanical_energy_pair",
  "velocity_triangle", "collinear_velocity_pair", "crossing_strategies", "parallel_guides",
  "kirchhoff_network",
  "line_charge_field", "gauss_flux", "wire_field", "loop_field", "flux_sinusoid", "sinusoid_state",
  "electric_field", "field_components",
  "coulomb_pair", "point_charge_field", "field_lines", "dipole_field", "dipole_torque", "equipotential", "dipole_energy",
]);

/**
 * These print their computed value by default. In a normalized
 * representative the engine keeps the symbol before "=" instead.
 */
const VALUE_BY_DEFAULT_OPERATORS: ReadonlySet<string> = new Set([
  "gaussian_image", "optical_focus",
  "electric_field", "field_components",
  "coulomb_pair", "point_charge_field", "field_lines", "dipole_field", "dipole_torque", "equipotential", "dipole_energy",
]);

export const NONMETRIC_VALUE_LABEL_CODE = "nonmetric_physical_value_label";

const NUMBER = /(?<![\p{L}\p{N}_'′^.])[+\-−]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:[eE][+\-−]?\d+)?/gu;

/**
 * True when the text states a nonzero number. Digits glued to a symbol
 * (F1, I2, R_1) are names. Zero is kept: it is a structural fact (no
 * enclosed charge, a force along B) that no normalized choice can change.
 */
export function statesPhysicalValue(text: string): boolean {
  for (const match of text.matchAll(NUMBER)) {
    const value = Number(match[0].replaceAll("−", "-").replace(",", "."));
    if (value !== 0) return true;
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Refuses value text on the outputs of a physical operator in a normalized
 * representative: an entity label, a targeted annotation text, any
 * annotation bound to a quantity, or a label construction placed on it.
 * Documents without the declaration are untouched.
 */
export function validateRepresentativeValueLabels(construction: SceneConstruction, index: number, document: SceneDocument, issues: SceneIssue[]): void {
  if (!declaresNormalizedRepresentative(document) || !PHYSICAL_VALUE_LABEL_OPERATORS.has(construction.operator)) return;
  const outputs = new Set((Array.isArray(construction.outputs) ? construction.outputs : []).filter((id): id is string => typeof id === "string"));
  if (outputs.size === 0) return;
  const refuse = (message: string, entityIds: string[]): void => {
    issues.push({
      code: NONMETRIC_VALUE_LABEL_CODE,
      severity: "fatal",
      message: `${construction.operator}: ${message}; a nonmetric representative uses role or symbol labels because its numbers describe the chosen inputs, not the question`,
      path: `constructions[${index}].outputs`,
      entityIds,
    });
  };
  for (const entity of document.entities) {
    if (outputs.has(entity.id) && typeof entity.label === "string" && statesPhysicalValue(entity.label)) refuse(`label "${entity.label}" states a computed value`, [entity.id]);
  }
  for (const annotation of document.annotations) {
    const targets = (Array.isArray(annotation.targetIds) ? annotation.targetIds : []).filter((id) => outputs.has(id));
    if (targets.length === 0) continue;
    if (annotation.quantityId !== undefined) refuse(`annotation ${annotation.id} binds quantity ${annotation.quantityId} to normalized ink`, targets);
    else if (typeof annotation.text === "string" && statesPhysicalValue(annotation.text)) refuse(`annotation "${annotation.text}" states a computed value`, targets);
  }
  for (const other of document.constructions) {
    if (other.operator !== "label" || !isRecord(other.inputs)) continue;
    const target = other.inputs.target ?? other.inputs.at ?? other.inputs.point;
    if (typeof target === "string" && outputs.has(target) && typeof other.inputs.text === "string" && statesPhysicalValue(other.inputs.text)) {
      refuse(`label construction "${other.inputs.text}" states a computed value`, [target]);
    }
  }
}

/**
 * Engine-derived labels for a normalized representative: operators that
 * print values by default keep their symbol, and any value that still
 * remains is reported so the construction fails closed.
 */
export function representativeOutputLabels(operator: string, labels: readonly (string | null)[]): { labels: (string | null)[]; leaked?: string } {
  const next = labels.map((label) => {
    if (typeof label !== "string" || !VALUE_BY_DEFAULT_OPERATORS.has(operator) || !statesPhysicalValue(label)) return label;
    return label.split("=")[0]!.trim();
  });
  const leaked = next.find((label): label is string => typeof label === "string" && statesPhysicalValue(label));
  return leaked === undefined ? { labels: next } : { labels: next, leaked };
}
