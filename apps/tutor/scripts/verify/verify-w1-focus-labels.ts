import assert from "node:assert/strict";
import { buildMatrixSourceDocument, compileSceneDocument, type RenderScene, type SceneDocument } from "@heytutor/scene-engine";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";

let checks = 0;
const questions = [
  "A=[[1,2],[3,4]] and B=[[0,1],[1,0]]. Find AB and BA.",
  "A=[[2,5,19,-7],[35,-2,2.5,12],[1.5,1,-5,17]]. Find the order of A and the elements a13, a21, a33, a24 and a23.",
  "A=[[1,-2,3],[4,0.5,6]]. Find the transpose of A.",
];
for (const question of questions) {
  const document = buildMatrixSourceDocument(question);
  assert.ok(document);
  const result = compileSceneDocument(document);
  assert.ok(result.ok && result.renderScene);
  for (const primitives of [result.renderScene.primitives, [...result.renderScene.primitives].reverse()]) {
    const rendered = { ...result.renderScene, primitives };
    const prompt = buildVerifiedDiagramPresentation(document, rendered).diagram.promptAddon;
    for (const entity of document.entities) {
      if (!entity.label || !rendered.entityBounds[entity.id]) continue;
      assert.ok(prompt.includes(`"${entity.label}" = [FOCUS:${entity.id}]`), `${entity.id} must refer to its visible name, never its first cell`);
      assert.ok(prompt.includes(`[FOCUS:${entity.id}] means ${entity.role}`), `${entity.id} must retain its verified semantic role`);
      const firstCell = rendered.primitives.find(primitive => primitive.entityId === entity.id && primitive.provenance?.matrixCell)?.text;
      if (firstCell && firstCell !== entity.label) assert.ok(!prompt.includes(`"${firstCell}" = [FOCUS:${entity.id}]`));
      checks += 3;
    }
  }
}
// Generic composite anchors follow the same rule, with no family-specific cue.
const document: SceneDocument = {
  schemaVersion:"scene-document/v2", visualDecision:{mode:"scene",reason:"fixture"},source:{question:"fixture"},quantities:[],
  entities:[{id:"compound",kind:"point",label:"C",role:"stated compound object"},{id:"measure",kind:"segment",label:"metadata-only",role:"measured length"}],
  constructions:[],relations:[],assertions:[],annotations:[],requiredEntityIds:[],revealGroups:[],teachingTimeline:[],
};
const renderScene: RenderScene = {
  engineVersion:"scene-engine/2.0.0", revealGroups:[],timeline:[],
  entityBounds:{compound:{x:500,y:200,width:90,height:80},measure:{x:650,y:200,width:100,height:20}},
  primitives:[
    {id:"content",entityId:"compound",groupId:"g",kind:"label",points:[{x:510,y:210}],text:"17",labelPlacement:"absolute"},
    {id:"name",entityId:"compound",groupId:"g",kind:"label",points:[{x:510,y:260}],text:"C",labelPlacement:"absolute"},
    {id:"length",entityId:"measure",groupId:"g",kind:"dimension",points:[{x:650,y:200},{x:750,y:200}],text:"5 m"},
  ],
};
const prompt = buildVerifiedDiagramPresentation(document,renderScene).diagram.promptAddon;
assert.ok(prompt.includes('"C" = [FOCUS:compound]'));
assert.ok(!prompt.includes('"17" = [FOCUS:compound]'));
assert.ok(prompt.includes('"5 m" = [FOCUS:measure]'));
assert.ok(!prompt.includes('"metadata-only" = [FOCUS:measure]'), "never advertise a name absent from compiled ink");
checks += 4;
console.log(`verified focus labels: ${checks} checks passed`);
