/** Source-grounded radical measurements must reach the real board whole. */
import assert from "node:assert/strict";
import {
  compileSceneDocument,
  pruneUnverifiedSceneAnnotations,
  validateSceneQuantityAgreement,
  type SceneDocument,
  type TurnPlanV3,
} from "../../../../packages/scene-engine/src/index";
import { textToStrokePaths } from "@heytutor/drawing";
import { buildVerifiedDiagramPresentation } from "../../features/tutor-session/lib/scene/verifiedScenePresentation";
import { mountTestWhiteboard, unmountTestWhiteboard } from "../../../../packages/whiteboard/scripts/whiteboardTestHarness";
import { createVirtualWhiteboardClock } from "../../../../packages/whiteboard/src/whiteboardClock";
import { runWhiteboardVerifier } from "../../../../packages/whiteboard/scripts/runWhiteboardVerifier";

const plan: TurnPlanV3 = {
  schemaVersion: "turn-plan/v3", question: "Label the given measurements and symbolic lengths.",
  givens: [
    { id: "range", symbol: "R", value: 34.64101615137754, unit: "m", provenance: "given" },
    { id: "wind", symbol: "v", value: 141.4213562373095, unit: "km/h", provenance: "given" },
  ],
  unknowns: [], derived: [], qualitativeClaims: [], lawIds: [], assumptions: [], visualRequirement: "required",
};
function scene(text: string): SceneDocument {
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "Source measurement" },
    source: { question: plan.question, nonMetric: true, representationTier: "qualitative_verified" },
    quantities: [], entities: [
      { id: "a", kind: "point", role: "start" }, { id: "b", kind: "point", role: "end" },
      { id: "length", kind: "dimension", role: "length", label: text },
    ],
    constructions: [
      { id: "make_a", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] },
      { id: "make_b", operator: "point", inputs: { x: 4, y: 0 }, outputs: ["b"] },
      { id: "make_length", operator: "dimension", inputs: { start: "a", end: "b" }, outputs: ["length"] },
    ],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ["a", "b", "length"],
    revealGroups: [{ id: "setup", entityIds: ["a", "b", "length"], dependsOn: [], narrationCue: "show the measured length" }], teachingTimeline: [],
  };
}

async function main() {
  const board = mountTestWhiteboard();
  const clock = createVirtualWhiteboardClock();
  board.setTimeSource(clock.source);
  const pump = setInterval(() => { clock.advance(100); clock.pump(); }, 1);
  try {
    for (const text of [
      "20√3 m", "100√2 km/h", "√(a²+b²)", "5√2",
      "(20√3 m)", "(100√2 km/h)", "((20√3 m))", "((100√2 km/h))",
    ]) {
      const pruned = pruneUnverifiedSceneAnnotations(scene(text), plan);
      assert.equal(pruned.entities.find(entity => entity.id === "length")?.label, text,
        `${text}: publication must retain the entire label, including radicand and unit`);
      assert.deepEqual(validateSceneQuantityAgreement([], plan, [text]), []);
      const compiled = compileSceneDocument(pruned);
      assert(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
      const presentation = buildVerifiedDiagramPresentation(pruned, compiled.renderScene);
      const label = presentation.diagram.commands.find(command => command.type === "LABEL" && command.text === text);
      assert(label, `${text}: compiled presentation must publish the whole label`);
      for (const duration of [0, 1200]) {
        await board.clearBoard(0);
        const [x, y, fontSize] = label.params;
        await board.writeText(label.text!, x!, y!, duration, undefined, fontSize);
        const nodes = board.getDrawLayer()!.getChildren().filter(node => node.getAttrs().htInk);
        const glyphs = await textToStrokePaths(text, x!, y!, fontSize!);
        assert.equal(nodes.filter(node => node.getClassName() === "Text").length, 0,
          `${text}: every glyph is handwritten`);
        assert.equal(nodes.length, glyphs.reduce((sum, glyph) => sum + glyph.strokes.length, 0),
          `${text}: immediate and animated board retain every stroke after the radical`);
      }
    }
    // Matching only a radical's final digit must never make a false measurement
    // authoritative. Remove an unsupported expression whole, never as a prefix.
    for (const text of ["20√2 m", "100√3 km/h", "3 m", "2 km/h", "99 m"]) {
      assert(validateSceneQuantityAgreement([], plan, [text]).some(issue => issue.code === "displayed_quantity_unverified"),
        `${text}: wrong values must still fail numeric authority`);
      assert.equal(pruneUnverifiedSceneAnnotations(scene(text), plan).entities.find(entity => entity.id === "length")?.label,
        undefined, `${text}: remove the unsupported measurement atomically`);
    }
    const partial = pruneUnverifiedSceneAnnotations(scene("20√3 m; 99 m"), plan);
    assert.equal(partial.entities.find(entity => entity.id === "length")?.label, "20√3 m;",
      "an unrelated unsupported suffix must not corrupt a supported radical");
    for (const [text, value, unit] of [
      ["20√3/2 m", 17.32050807568877, "m"],
      ["(20√3)/2 m", 17.32050807568877, "m"],
      ["((20√3)/2 m)", 17.32050807568877, "m"],
      ["(((20√3)/2) m)", 17.32050807568877, "m"],
      ["-(20√3 m)", -34.64101615137754, "m"],
      ["−(20√3 m)", -34.64101615137754, "m"],
      ["- ( 20√3 m )", -34.64101615137754, "m"],
      ["− ( 20√3 m )", -34.64101615137754, "m"],
      ["100+100√3 km/h", 273.2050807568877, "km/h"],
      ["-(100+100√3) km/h", -273.2050807568877, "km/h"],
      ["-(100+100√3 km/h)", -273.2050807568877, "km/h"],
      ["−(100+100√3 km/h)", -273.2050807568877, "km/h"],
      ["√(2+√3) m", 1.9318516525781366, "m"],
      ["-√3 m", -1.7320508075688772, "m"],
      ["−√3 m", -1.7320508075688772, "m"],
      ["+√3 m", 1.7320508075688772, "m"],
      ["2e1√3 m", 34.64101615137754, "m"],
      ["20√3 eV", 34.64101615137754, "eV"],
      ["√.25 m", 0.5, "m"],
      ["√2e2 m", 14.142135623730951, "m"],
    ] as const) {
      const measuredPlan: TurnPlanV3 = { ...plan, givens: [{ id: "given", symbol: "Q", value, unit, provenance: "given" }] };
      assert.deepEqual(validateSceneQuantityAgreement([], measuredPlan, [text]), [], `${text}: recompute the whole expression`);
      assert.equal(pruneUnverifiedSceneAnnotations(scene(text), measuredPlan).entities.find(entity => entity.id === "length")?.label,
        text, `${text}: preserve supported signs, fractions, sums and nested numeric roots whole`);
    }
    const positiveRootPlan: TurnPlanV3 = { ...plan, givens: [{ id: "given", symbol: "Q", value: 1.7320508075688772, unit: "m", provenance: "given" }] };
    const ungroupedSumPlan: TurnPlanV3 = { ...plan, givens: [{ id: "given", symbol: "v", value: 73.20508075688772, unit: "km/h", provenance: "given" }] };
    assert(validateSceneQuantityAgreement([], ungroupedSumPlan, ["-(100+100√3 km/h)"]).some(issue => issue.code === "displayed_quantity_unverified"),
      "removing a unit wrapper cannot change a signed sum into its ungrouped value");
    assert.equal(pruneUnverifiedSceneAnnotations(scene("-(100+100√3 km/h)"), ungroupedSumPlan).entities.find(entity => entity.id === "length")?.label,
      undefined, "numeric authority must reject the incorrectly ungrouped positive value");
    for (const text of ["-√3 m", "−√3 m", "1+√3 m", "√(2+√3) m", "√(2+) m", "20√ m", "√(-2) m", "2√3/4 m", "√(2 m)", "√(2+ m)"]) {
      assert(validateSceneQuantityAgreement([], positiveRootPlan, [text]).some(issue => issue.code === "displayed_quantity_unverified"),
        `${text}: suffix agreement cannot validate a different or malformed expression`);
      assert.equal(pruneUnverifiedSceneAnnotations(scene(text), positiveRootPlan).entities.find(entity => entity.id === "length")?.label,
        undefined, `${text}: remove a wrong or malformed expression whole`);
    }
    for (const text of ["(20√2 m)", "((20√2 m))", "(100√3 km/h)", "((100√3 km/h))", "-(20√3 m)", "−(20√3 m)", "- ( 20√3 m )", "− ( 20√3 m )"]) {
      assert(validateSceneQuantityAgreement([], plan, [text]).some(issue => issue.code === "displayed_quantity_unverified"),
        `${text}: surrounding punctuation cannot validate a wrong measurement`);
      assert.equal(pruneUnverifiedSceneAnnotations(scene(text), plan).entities.find(entity => entity.id === "length")?.label,
        undefined, `${text}: remove the unsupported measurement with its surrounding wrappers`);
    }
    console.log("surd publication: eight full labels reach immediate/animated Whiteboard; grouped expressions keep their values and unsupported measurements are removed whole");
  } finally { clearInterval(pump); unmountTestWhiteboard(board); }
}
runWhiteboardVerifier(main);
