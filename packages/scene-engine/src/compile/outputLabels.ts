import { chargedRingLabels } from "./chargedRingGeometry";
import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";
import { probabilityTreeOutputLabels } from "./probabilityGeometry";
import { fieldConstructionOutputLabels, validateEvaluatedFieldLabels } from "./fieldGeometry";
import { dipoleConstructionOutputLabels, validateEvaluatedDipoleLabels } from "./dipoleFieldGeometry";
import { analyticLineConstructionOutputLabels, validateEvaluatedAnalyticLineLabels } from "./analyticLineGeometry";
import { rigidMassConstructionOutputLabels, validateEvaluatedRigidMassLabels } from "./rigidMassGeometry";
import { acGeometryLabel, validateEvaluatedAcLabels } from "./acGeometry";
import { wavesConstructionOutputLabels, validateEvaluatedWavesLabels } from "./wavesGeometry";
import { geometricOpticsOutputLabels, validateEvaluatedGeometricOpticsLabels } from "./geometricOpticsGeometry";
import { thermodynamicsGeometryLabel, validateEvaluatedThermodynamicsLabels } from "./thermodynamicsGeometry";
import { validateEvaluatedDerivedValueLabels } from "./derivedValueLabels";

import { complexGeometryLabel, validateEvaluatedComplexLabels } from "./complexGeometry";
import { magneticConstructionOutputLabels, validateEvaluatedMagneticLabels } from "./magneticGeometry";
import { relativeMotionOutputLabels } from "./relativeMotionGeometry";
import { networkOutputLabels } from "./networkGeometry";
import { mechanicsOutputLabels } from "./mechanicsDiagramGeometry";
import { currentFieldOutputLabels } from "./currentFieldGeometry";
import { chapterRemainderOutputLabels } from "./chapterRemainderGeometry";
import { chapterInstrumentOutputLabels } from "./chapterInstrumentGeometry";
import { fluidGeometryLabel, validateEvaluatedFluidLabels } from "./fluidGeometry";

import { harmonicMotionGeometryLabel, validateEvaluatedHarmonicMotionLabels } from "./harmonicMotionGeometry";
import { gravityConstructionOutputLabels, validateEvaluatedGravityLabels } from "./gravityGeometry";

import { setGeometryLabel, validateEvaluatedSetLabels } from "./setGeometry";

import { inductionConstructionOutputLabels, validateEvaluatedInductionLabels } from "./inductionGeometry";
import { rotationGeometryLabel, validateEvaluatedRotationLabels } from "./rotationGeometry";

import { combinatoricsGeometryLabel, validateEvaluatedCombinatoricsLabels } from "./combinatoricsGeometry";
import { elasticityGeometryLabel, validateEvaluatedElasticityLabels } from "./elasticityGeometry";
import { distributedFieldsConstructionOutputLabels, validateEvaluatedDistributedFieldsLabels } from "./distributedFieldsGeometry";
import { isSymbolicRepresentative, representativeOutputLabel } from "./symbolicOutputLabels";

interface LabelEvaluationContext {
  number(value: unknown): number;
  point(value: unknown): RenderPoint;
}

/** Validate claims against evaluated math before replacing labels, without mutating the caller's document. */
export function withEvaluatedOutputLabels(
  construction: SceneConstruction,
  index: number,
  inputs: Record<string, unknown>,
  outputs: readonly unknown[],
  document: SceneDocument,
  context: LabelEvaluationContext,
  issues: SceneIssue[],
  checkedOutputIds: Set<string>,
): SceneDocument {
  const issueCount = issues.length;
  if (validateEvaluatedDerivedValueLabels(construction, index, document, outputs, issues)) {
    if (issues.length === issueCount) construction.outputs.forEach((id) => checkedOutputIds.add(id));
  }
  let labels: readonly (string | null)[];
  switch (construction.operator) {
    case "charged_ring_axial_field":
      labels = chargedRingLabels(construction, index, document, outputs, issues);
      break;
    case "permutation_cycles":
    case "subset_lattice":
      validateEvaluatedCombinatoricsLabels(construction, index, document, outputs, issues);
      labels = outputs.map((geometry, outputIndex) => combinatoricsGeometryLabel(geometry, document.entities.find((entity) => entity.id === construction.outputs[outputIndex])?.label));
      break;
    case "elastic_profile":
    case "elastic_state":
      validateEvaluatedElasticityLabels(construction, index, document, outputs, issues);
      labels = outputs.map((geometry, outputIndex) => elasticityGeometryLabel(geometry, document.entities.find((entity) => entity.id === construction.outputs[outputIndex])?.label));
      break;
    case "flux_process":
    case "induction_state":
      validateEvaluatedInductionLabels(construction, index, document, outputs, issues);
      labels = inductionConstructionOutputLabels(construction.operator, outputs, construction.outputs.map((id) => document.entities.find((entity) => entity.id === id)?.label));
      break;
    case "rotational_motion":
    case "rotational_state":
    case "planar_torque":
      validateEvaluatedRotationLabels(construction, index, document, outputs, issues);
      labels = outputs.map((geometry, outputIndex) => rotationGeometryLabel(geometry, document.entities.find((entity) => entity.id === construction.outputs[outputIndex])?.label));
      break;
    case "set_partition":
    case "set_select":
      validateEvaluatedSetLabels(construction, index, document, outputs, issues);
      labels = outputs.map((geometry, outputIndex) => setGeometryLabel(geometry, document.entities.find((entity) => entity.id === construction.outputs[outputIndex])?.label));
      break;
    case "harmonic_motion":
    case "harmonic_state":
      validateEvaluatedHarmonicMotionLabels(construction, index, document, outputs, issues);
      labels = outputs.map((geometry, outputIndex) => harmonicMotionGeometryLabel(geometry, document.entities.find((entity) => entity.id === construction.outputs[outputIndex])?.label));
      break;
    case "gravitational_field":
    case "gravitational_force":
      validateEvaluatedGravityLabels(construction, index, document, outputs, issues);
      labels = gravityConstructionOutputLabels(construction.operator, outputs, construction.outputs.map((id) => document.entities.find((entity) => entity.id === id)?.label));
      break;
    case "complex_point":
    case "complex_transform":
    case "complex_roots":
      validateEvaluatedComplexLabels(construction, index, document, outputs, issues);
      labels = outputs.map((geometry, outputIndex) => complexGeometryLabel(geometry, document.entities.find((entity) => entity.id === construction.outputs[outputIndex])?.label));
      break;
    case "magnetic_force":
    case "magnetic_components":
      validateEvaluatedMagneticLabels(construction, index, document, outputs, issues);
      labels = magneticConstructionOutputLabels(construction.operator, outputs, construction.outputs.map((id) => document.entities.find((entity) => entity.id === id)?.label));
      break;
    case "velocity_triangle":
    case "collinear_velocity_pair":
    case "crossing_strategies":
    case "parallel_guides":
      labels = relativeMotionOutputLabels(construction.operator, outputs, construction.outputs.map((id) => document.entities.find((entity) => entity.id === id)?.label));
      break;
    case "kirchhoff_network":
      labels = networkOutputLabels(outputs, construction.outputs.map((id) => document.entities.find((entity) => entity.id === id)?.label));
      break;
    case "free_body":
    case "coupled_bodies":
    case "vertical_circle":
    case "mechanical_energy_pair":
      labels = mechanicsOutputLabels(construction.operator, outputs, construction.outputs.map((id) => document.entities.find((entity) => entity.id === id)?.label));
      break;
    case "current_element_field":
    case "conductor_force":
    case "parallel_wire_force":
    case "magnetic_dipole_field":
    case "solenoid_field":
      labels = currentFieldOutputLabels(construction.operator, outputs, construction.outputs.map((id) => document.entities.find((entity) => entity.id === id)?.label));
      break;
    case "relative_velocity":
    case "motion_graph":
    case "uniform_circular_motion":
    case "projectile_trajectory":
    case "work_interval":
    case "spring_energy":
    case "potential_curve":
    case "collision":
    case "loop_torque":
    case "galvanometer":
    case "bar_magnet":
      labels = chapterRemainderOutputLabels(construction.operator, outputs, construction.outputs.map((id) => document.entities.find((entity) => entity.id === id)?.label));
      break;
    case "metre_bridge":
    case "potentiometer":
    case "incline_friction":
    case "cyclotron":
      labels = chapterInstrumentOutputLabels(construction.operator, outputs, construction.outputs.map((id) => document.entities.find((entity) => entity.id === id)?.label));
      break;
    case "hydrostatic_profile":
    case "hydrostatic_state":
    case "buoyancy":
      validateEvaluatedFluidLabels(construction, index, document, outputs, issues);
      labels = outputs.map((geometry, outputIndex) => fluidGeometryLabel(geometry, document.entities.find((entity) => entity.id === construction.outputs[outputIndex])?.label));
      break;
    case "probability_tree":
      labels = probabilityTreeOutputLabels(inputs, context);
      break;
    case "electric_field":
    case "field_components":
      validateEvaluatedFieldLabels(construction, index, document, outputs, issues);
      labels = fieldConstructionOutputLabels(construction.operator, outputs);
      break;
    case "coulomb_pair":
    case "point_charge_field":
    case "field_lines":
    case "dipole_field":
    case "dipole_torque":
    case "equipotential":
    case "dipole_energy":
      validateEvaluatedDipoleLabels(construction, index, document, outputs, issues);
      labels = dipoleConstructionOutputLabels(construction.operator, outputs);
      break;
    case "coordinate_distance":
    case "section_point":
    case "axis_translation":
    case "line_relation":
    case "line_intercepts":
    case "line_equation":
    case "line_intersection_angle":
    case "line_concurrence":
    case "point_line_distance":
      if (!["section_point", "point_line_distance"].includes(construction.operator)) validateEvaluatedAnalyticLineLabels(construction, index, document, outputs, issues);
      labels = analyticLineConstructionOutputLabels(construction.operator, outputs);
      if (construction.operator === "section_point") labels = labels.map((label) => {
        const sourceLabel = document.entities.find((entity) => construction.outputs.includes(entity.id))?.label?.trim();
        const identity = /^([\p{L}][\p{L}\p{N}_'′]*)(?:\s*[=≈:]|$)/u.exec(sourceLabel ?? "")?.[1];
        return `${identity ?? "section point"} (${label})`;
      });
      break;
    case "centre_of_mass":
    case "com_motion":
    case "point_mass_inertia":
    case "simple_body_inertia":
    case "axes_theorem":
      validateEvaluatedRigidMassLabels(construction, index, document, outputs, issues);
      labels = rigidMassConstructionOutputLabels(construction.operator, outputs);
      break;
    case "line_charge_field":
    case "gauss_flux":
    case "wire_field":
    case "loop_field":
    case "flux_sinusoid":
    case "sinusoid_state":
      validateEvaluatedDistributedFieldsLabels(construction, index, document, outputs, issues);
      labels = distributedFieldsConstructionOutputLabels(construction.operator, outputs, construction.outputs.map((id) => document.entities.find((entity) => entity.id === id)?.label));
      break;
    case "impedance":
    case "impedance_combine":
    case "phasor_response":
      validateEvaluatedAcLabels(construction, index, document, outputs, issues);
      labels = outputs.map(acGeometryLabel);
      break;
    case "harmonic_wave":
    case "wave_superposition":
    case "wave_sample":
      validateEvaluatedWavesLabels(construction, index, document, outputs, issues);
      labels = wavesConstructionOutputLabels(construction.operator, outputs);
      break;
    case "gaussian_image":
    case "optical_focus":
      validateEvaluatedGeometricOpticsLabels(construction, index, document, outputs, issues);
      labels = geometricOpticsOutputLabels(construction.operator, outputs);
      break;
    case "polytropic_process":
    case "isochoric_process":
    case "process_state":
      validateEvaluatedThermodynamicsLabels(construction, index, document, outputs, issues);
      labels = outputs.map((geometry, outputIndex) => thermodynamicsGeometryLabel(geometry,
        document.entities.find((entity) => entity.id === construction.outputs[outputIndex])?.label));
      break;
    default:
      return document;
  }
  if (issues.length > issueCount) return document;
  if (isSymbolicRepresentative(document)) {
    labels = labels.map((label, outputIndex) => representativeOutputLabel(label,
      document.entities.find((entity) => entity.id === construction.outputs[outputIndex])?.label, outputs[outputIndex]));
  }
  construction.outputs.forEach((id) => checkedOutputIds.add(id));
  if (labels.length !== construction.outputs.length) throw new Error("derived labels must match construction output arity");
  const byOutput = new Map(construction.outputs.map((id, outputIndex) => [id, labels[outputIndex]]));
  return {
    ...document,
    entities: document.entities.map((entity) => {
      const label = byOutput.get(entity.id);
      return label ? { ...entity, label } : entity;
    }),
  };
}
