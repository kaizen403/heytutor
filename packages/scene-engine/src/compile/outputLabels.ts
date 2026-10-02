import type { RenderPoint, SceneConstruction, SceneDocument, SceneIssue } from "../types";
import { probabilityTreeOutputLabels } from "./probabilityGeometry";
import { fieldConstructionOutputLabels, validateEvaluatedFieldLabels } from "./fieldGeometry";
import { acGeometryLabel, validateEvaluatedAcLabels } from "./acGeometry";
import { wavesConstructionOutputLabels, validateEvaluatedWavesLabels } from "./wavesGeometry";
import { geometricOpticsOutputLabels, validateEvaluatedGeometricOpticsLabels } from "./geometricOpticsGeometry";
import { thermodynamicsGeometryLabel, validateEvaluatedThermodynamicsLabels } from "./thermodynamicsGeometry";
import { validateEvaluatedDerivedValueLabels } from "./derivedValueLabels";

import { complexGeometryLabel, validateEvaluatedComplexLabels } from "./complexGeometry";
import { magneticConstructionOutputLabels, validateEvaluatedMagneticLabels } from "./magneticGeometry";
import { fluidGeometryLabel, validateEvaluatedFluidLabels } from "./fluidGeometry";

import { harmonicMotionGeometryLabel, validateEvaluatedHarmonicMotionLabels } from "./harmonicMotionGeometry";
import { gravityConstructionOutputLabels, validateEvaluatedGravityLabels } from "./gravityGeometry";

import { setGeometryLabel, validateEvaluatedSetLabels } from "./setGeometry";

import { inductionConstructionOutputLabels, validateEvaluatedInductionLabels } from "./inductionGeometry";
import { rotationGeometryLabel, validateEvaluatedRotationLabels } from "./rotationGeometry";

import { combinatoricsGeometryLabel, validateEvaluatedCombinatoricsLabels } from "./combinatoricsGeometry";
import { elasticityGeometryLabel, validateEvaluatedElasticityLabels } from "./elasticityGeometry";

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
  if (validateEvaluatedDerivedValueLabels(construction, index, document, outputs, issues)) {
    construction.outputs.forEach((id) => checkedOutputIds.add(id));
  }
  let labels: readonly (string | null)[];
  switch (construction.operator) {
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
