import assert from "node:assert/strict";
import { compileSceneDocument, synthesizeFamilyScene, validateSceneDocument } from "@heytutor/scene-engine";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { selectVerifiedRepresentation } from "../../features/tutor-session/lib/scene/representationFallback";
import { verifiedDiagramHasDrawableInk } from "@heytutor/drawing";
import { buildSceneDocumentPlannerPrompt, inferSceneCapabilities, questionRequiresVisual } from "@heytutor/tutor-core";

const question = "A solid consists of a cylinder of radius 3 cm and height 8 cm, topped by a cone of height 4 cm. Find its volume and total exposed surface area, including the bottom.";
const figure = synthesizeFamilyScene({ question, families: ["solid_figure"] });
assert(figure);
const raw = {
  ...figure.document,
  entities: figure.document.entities.map((entity) => {
    const unlabelled = { ...entity };
    delete unlabelled.label;
    return unlabelled;
  }),
  assertions: figure.document.assertions.filter((assertion) => assertion.predicate !== "label_attached"),
  annotations: [],
};
const normalized = validateSceneDocument(raw);
assert(normalized.document);
const compiled = compileSceneDocument(normalized.document);
assert(compiled.ok && compiled.renderScene);
assert(!compiled.renderScene.primitives.some((p) => p.text), "fixture must represent the real unlabeled-planner failure");
const selected = selectVerifiedRepresentation({
  question, families: ["solid_figure"],
  exact: { sceneDocument: normalized.document, renderScene: compiled.renderScene, validationReport: compiled.report },
});
assert(selected.renderScene.primitives.some((p) => (p.kind === "label" || p.kind === "dimension") && p.text?.trim()), "an unreadable planner scene must fall through to a readable composite");
assert.equal(selected.sceneDocument.constructions.filter((c) => c.operator === "solid_projection").length, 2);
const presentation = buildVerifiedDiagramPresentation(selected.sceneDocument, selected.renderScene, { figureFamily: "solid_figure" });
assert(presentation && verifiedDiagramHasDrawableInk(presentation.diagram), "the selected figure must produce actual board ink");
assert(presentation.diagram.anchors.some((anchor) => anchor.id === "cylinder"));
assert(presentation.diagram.anchors.some((anchor) => anchor.id === "cone"));
const foreign = validateSceneDocument({ ...figure.document, annotations: [] });
assert(foreign.document);
const foreignCompile = compileSceneDocument(foreign.document);
assert(foreignCompile.ok && foreignCompile.renderScene);
const grounded = selectVerifiedRepresentation({
  question, families: ["solid_figure"],
  exact: { sceneDocument: foreign.document, renderScene: foreignCompile.renderScene, validationReport: foreignCompile.report },
});
assert.equal(grounded.family, "solid_figure", "a source-built solid must win over an unproven planner sketch");
assert.deepEqual(grounded.renderScene, figure.renderScene);
const metric = validateSceneDocument({
  ...foreign.document,
  assertions: [...foreign.document.assertions, {
    id: "height_radius_ratio", predicate: "distance_ratio", severity: "fatal",
    entities: ["cylinder_height_start", "cylinder_height_end", "cylinder_center", "cylinder_rim"], expected: 8 / 3,
  }],
});
assert(metric.document);
const metricCompile = compileSceneDocument(metric.document);
assert(metricCompile.ok && metricCompile.renderScene);
const exact = selectVerifiedRepresentation({
  question, families: ["solid_figure"],
  exact: { sceneDocument: metric.document, renderScene: metricCompile.renderScene, validationReport: metricCompile.report },
});
assert.equal(exact.tier, "exact_verified", "a scene with a real metric proof keeps its priority");
assert.deepEqual(exact.renderScene, metricCompile.renderScene);
for (const stem of [
  "A cube has edge 5 cm. Find its volume and surface area.",
  "A cuboid has length 8 cm, width 5 cm and height 3 cm. Find its surface area.",
  "A square pyramid has base side 6 cm and height 4 cm. Find its volume.",
  "A regular hexagonal prism has base side 4 cm and height 10 cm. Find its volume.",
  "A hollow cylinder has outer radius 5 cm, inner radius 3 cm and height 8 cm. Find its volume.",
]) {
  const problemIR = { entities: [{ id: "body", kind: "solid" }] };
  const capabilities = inferSceneCapabilities(stem, { problemIR });
  assert(questionRequiresVisual(stem), "complete source geometry must require its diagram even before a model plan arrives");
  assert(capabilities.families.includes("solid_figure"), "source solid structure must select the solid path without new keyword routing");
  const prompt = buildSceneDocumentPlannerPrompt(stem, capabilities);
  assert(prompt.includes('kind:"polyhedron"') && prompt.includes("innerRadius"), "the compact planner must receive both projection overloads");
  const result = selectVerifiedRepresentation({ question: stem, problemIR });
  const board = buildVerifiedDiagramPresentation(result.sceneDocument, result.renderScene, { figureFamily: "solid_figure" });
  assert(board && verifiedDiagramHasDrawableInk(board.diagram), `${stem}: missing live board ink`);
  assert(board.diagram.anchors.some((anchor) => anchor.labels.some((label) => label.includes("cm"))), "dimensions must remain readable and focusable in the actual board representation");
}
const planar = inferSceneCapabilities("Find the area of the source region.", { problemIR: { entities: [{ kind: "region" }] } });
for (const operator of ["rectangle", "polygon", "circle", "arc", "dimension"]) assert(planar.constructionOperators.includes(operator), `planar area requires ${operator}`);
const gardenQuestion = "A rectangular garden is 12 m long and 8 m wide. A circular pond of radius 2 m is at its centre. Find the garden area excluding the pond.";
assert(questionRequiresVisual(gardenQuestion));
const garden = selectVerifiedRepresentation({ question: gardenQuestion });
const gardenBoard = buildVerifiedDiagramPresentation(garden.sceneDocument, garden.renderScene, { figureFamily: garden.family });
assert(gardenBoard && verifiedDiagramHasDrawableInk(gardenBoard.diagram));
assert(gardenBoard.diagram.anchors.some((a) => a.id === "circle"));
assert(gardenBoard.diagram.anchors.some((a) => a.id === "rectangle"));
const unlabelledDimensions = validateSceneDocument({
  ...garden.sceneDocument,
  entities: garden.sceneDocument.entities.map((entity) => {
    if (entity.kind !== "dimension") return entity;
    const unlabelled = { ...entity };
    delete unlabelled.label;
    return unlabelled;
  }),
  assertions: garden.sceneDocument.assertions.filter((a) => a.predicate !== "label_attached"),
});
assert(unlabelledDimensions.document);
const partialGarden = compileSceneDocument(unlabelledDimensions.document);
assert(partialGarden.ok && partialGarden.renderScene);
const readableGarden = selectVerifiedRepresentation({
  question: gardenQuestion,
  exact: { sceneDocument: unlabelledDimensions.document, renderScene: partialGarden.renderScene, validationReport: partialGarden.report },
});
assert.deepEqual(readableGarden.renderScene, garden.renderScene, "a partially labelled planner sketch must not displace complete source-bound mensuration dimensions");
console.log("mensuration fallback and board-presentation verification passed");
