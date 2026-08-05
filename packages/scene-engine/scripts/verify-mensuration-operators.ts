import { compileSceneDocument, validateSceneDocument } from "../src/index";

type SolidKind = "cylinder" | "cone" | "frustum" | "sphere" | "hemisphere";

const expectedContourCounts: Record<SolidKind, number> = {
  cylinder: 4,
  cone: 3,
  frustum: 4,
  sphere: 2,
  hemisphere: 2,
};

for (const kind of Object.keys(expectedContourCounts) as SolidKind[]) {
  const candidate = solidCandidate(kind, true);
  const validated = validateSceneDocument(candidate);
  const compiled = validated.document ? compileSceneDocument(validated.document) : null;
  if (!compiled?.ok || !compiled.renderScene) {
    throw new Error(`${kind} projection failed: ${JSON.stringify(compiled?.report.issues ?? validated.report.issues)}`);
  }
  const solidPrimitives = compiled.renderScene.primitives.filter((primitive) =>
    primitive.entityId === "solid" && primitive.kind !== "label",
  );
  const sectionPrimitives = compiled.renderScene.primitives.filter((primitive) =>
    primitive.entityId === "section" && primitive.kind !== "label",
  );
  if (solidPrimitives.length !== expectedContourCounts[kind]) {
    throw new Error(`${kind} projection produced ${solidPrimitives.length} contours instead of ${expectedContourCounts[kind]}`);
  }
  if (sectionPrimitives.length !== 1 || sectionPrimitives[0]?.kind !== "polyline") {
    throw new Error(`${kind} transverse section did not compile to one derived closed contour`);
  }
  for (const primitive of [...solidPrimitives, ...sectionPrimitives]) {
    if (primitive.points.length < 2 || primitive.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      throw new Error(`${kind} projection emitted non-finite or degenerate geometry`);
    }
  }
  const recompiled = compileSceneDocument(validated.document!);
  if (JSON.stringify(recompiled.renderScene?.primitives) !== JSON.stringify(compiled.renderScene.primitives)) {
    throw new Error(`${kind} projection is not deterministic`);
  }
}

const horizontalCone = solidCandidate("cone", false);
horizontalCone.constructions.find((construction: Record<string, any>) => construction.operator === "solid_projection").inputs.axis = "horizontal";
const horizontalValidated = validateSceneDocument(horizontalCone);
const horizontalCompiled = horizontalValidated.document ? compileSceneDocument(horizontalValidated.document) : null;
if (!horizontalCompiled?.ok || !horizontalCompiled.renderScene) {
  throw new Error(`horizontal solid axis failed: ${JSON.stringify(horizontalCompiled?.report.issues ?? horizontalValidated.report.issues)}`);
}

assertRejected("invalid kind", mutate("cylinder", (scene) => {
  solidConstruction(scene).inputs.kind = "pyramid";
}), "invalid_solid_projection_kind");

assertRejected("zero radius", mutate("cylinder", (scene) => {
  solidConstruction(scene).inputs.radius = 0;
}), "invalid_solid_projection_radius");

assertRejected("non-finite radius", mutate("cylinder", (scene) => {
  solidConstruction(scene).inputs.radius = Number.POSITIVE_INFINITY;
}), "invalid_solid_projection_radius");

assertRejected("missing cylinder height", mutate("cylinder", (scene) => {
  delete solidConstruction(scene).inputs.height;
}), "invalid_solid_projection_height");

assertRejected("negative cone height", mutate("cone", (scene) => {
  solidConstruction(scene).inputs.height = -1;
}), "invalid_solid_projection_height");

assertRejected("sphere with redundant height", mutate("sphere", (scene) => {
  solidConstruction(scene).inputs.height = 4;
}), "invalid_solid_projection_height");

assertRejected("equal frustum radii", mutate("frustum", (scene) => {
  solidConstruction(scene).inputs.topRadius = 2;
}), "invalid_solid_projection_top_radius");

assertRejected("numerically indistinguishable frustum radii", mutate("frustum", (scene) => {
  solidConstruction(scene).inputs.topRadius = 2 + 1e-8;
}), "invalid_solid_projection_top_radius");

assertRejected("negative frustum top radius", mutate("frustum", (scene) => {
  solidConstruction(scene).inputs.topRadius = -1;
}), "invalid_solid_projection_top_radius");

assertRejected("invalid solid center", mutate("cylinder", (scene) => {
  solidConstruction(scene).inputs.center = "solid";
}), "invalid_solid_projection_center");

assertRejected("section at boundary", mutate("cone", (scene) => {
  sectionConstruction(scene).inputs.at = 1;
}), "invalid_solid_cross_section_position");

assertRejected("section from non-solid", mutate("cone", (scene) => {
  sectionConstruction(scene).inputs.solid = "center";
}), "invalid_solid_cross_section_reference");

assertRejected("unsupported section plane", mutate("cone", (scene) => {
  sectionConstruction(scene).inputs.plane = "axial";
}), "invalid_solid_cross_section_plane");

assertRejected("wrong solid output kind", mutate("cylinder", (scene) => {
  scene.entities.find((entity: Record<string, any>) => entity.id === "solid").kind = "polygon";
}), "invalid_solid_projection_output_kind");

console.log("mensuration operator verification passed");

function solidCandidate(kind: SolidKind, includeSection: boolean): Record<string, any> {
  const solidInputs: Record<string, unknown> = {
    kind,
    center: "center",
    radius: 2,
    axis: "vertical",
  };
  if (kind === "cylinder" || kind === "cone" || kind === "frustum") solidInputs.height = 5;
  if (kind === "frustum") solidInputs.topRadius = 1;
  const entities: Array<Record<string, unknown>> = [
    { id: "center", kind: "point", role: "construction helper point" },
    { id: "solid", kind: "polyline", role: "solid projection", label: kind },
  ];
  const constructions: Array<Record<string, unknown>> = [
    { id: "make_center", operator: "point", inputs: { x: 0, y: 0, coordinateSpace: "world" }, outputs: ["center"] },
    { id: "make_solid", operator: "solid_projection", inputs: solidInputs, outputs: ["solid"] },
  ];
  const requiredEntityIds = ["solid"];
  if (includeSection) {
    entities.push({ id: "section", kind: "polyline", role: "solid cross section", label: "section" });
    constructions.push({
      id: "make_section",
      operator: "solid_cross_section",
      inputs: { solid: "solid", at: 0.65, plane: "transverse" },
      outputs: ["section"],
    });
    requiredEntityIds.push("section");
  }
  return {
    schemaVersion: "scene-document/v2",
    visualDecision: { mode: "scene", reason: "deterministic solid representation" },
    source: { question: `Show a ${kind} and a transverse cross section` },
    quantities: [],
    entities,
    constructions,
    relations: [],
    assertions: [],
    annotations: [],
    requiredEntityIds,
    revealGroups: [{
      id: "solid_setup",
      entityIds: requiredEntityIds,
      dependsOn: [],
      narrationCue: "show the solid, then its cross section",
    }],
    teachingTimeline: [{
      id: "show_solid",
      action: "reveal",
      targetId: "solid_setup",
      dependsOn: [],
      narrationIntent: "introduce the solid and its transverse section",
    }],
  };
}

function mutate(kind: SolidKind, mutateScene: (scene: Record<string, any>) => void): Record<string, any> {
  const scene = solidCandidate(kind, true);
  mutateScene(scene);
  return scene;
}

function solidConstruction(scene: Record<string, any>): Record<string, any> {
  return scene.constructions.find((construction: Record<string, any>) => construction.operator === "solid_projection");
}

function sectionConstruction(scene: Record<string, any>): Record<string, any> {
  return scene.constructions.find((construction: Record<string, any>) => construction.operator === "solid_cross_section");
}

function assertRejected(name: string, candidate: Record<string, any>, expectedCode: string): void {
  const result = validateSceneDocument(candidate);
  if (result.document || !result.report.issues.some((issue) => issue.code === expectedCode)) {
    throw new Error(`${name} was not rejected with ${expectedCode}: ${JSON.stringify(result.report.issues)}`);
  }
}
