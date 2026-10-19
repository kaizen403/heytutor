/** Apparatus kind, loop connectivity and component values are source facts. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { readApertureSource, readTwoLoopTopology } from "../../src/physics/apparatusSource";
import { generatorFor } from "../../src/archetypes/generators";
import { detectArchetype } from "../../src/archetypes/detect";
import { compileSceneDocument } from "../../src/compile/compiler";
import { synthesizeFamilyScene, synthesizeLastResortScene } from "../../src/synthesize/familyScene";
import type { SceneDocument } from "../../src/types";
import fixtures from "./fixtures/chemistry-f4-apparatus-source.json";

interface Gold { id: string; question: string; domain: string; expected: { draw?: boolean; slitCount?: number; noInventedSlitApparatus?: boolean }; scientificGold: { resistorsOhm?: Record<string, number>; sourcesV?: Record<string, number> } }
const results = (fixtures as Gold[]).map(gold => {
  const records: Array<{ route: string; document: SceneDocument | null; compiled: ReturnType<typeof compileSceneDocument> | null }> = [];
  try {
    const circuit = gold.domain === "circuit";
    const source = circuit ? readTwoLoopTopology(gold.question) : readApertureSource(gold.question);
    const id = circuit ? "two_loop_network" : "double_slit";
    const match = detectArchetype(gold.question, { plannerArchetype: id }); assert.ok(match);
    const direct = generatorFor(id)!({ question: gold.question, slots: { ...match.slots, resistors: [91, 92, 93], emfs: [94, 95] }, sources: match.sources, quantities: [], schematic: true });
    const ordinary = synthesizeFamilyScene({ question: gold.question });
    const last = synthesizeLastResortScene({ question: gold.question });
    const shouldDraw = gold.expected.draw ?? !gold.expected.noInventedSlitApparatus;
    assert.equal(!!source, shouldDraw);
    for (const [route, document] of [["direct", direct], ["ordinary", ordinary?.document ?? null], ["lastResort", last?.document ?? null]] as const) {
      const compiled = document ? compileSceneDocument(document) : null; records.push({ route, document, compiled });
      const supportedDirect = route !== "direct" || circuit || gold.expected.slitCount !== 1;
      assert.equal(!!document, shouldDraw && supportedDirect);
      if (!document) continue;
      assert.ok(compiled?.ok && compiled.renderScene); assert.equal(document.source.question, gold.question);
      const text = compiled.renderScene.primitives.flatMap(primitive => primitive.text ? [primitive.text] : []).join(" ");
      if (circuit) {
        assert.ok(source && "shared" in source);
        assert.equal(document.constructions.filter(step => step.operator === "symbol" && step.inputs.symbol === "resistor").length, 3);
        assert.equal(document.constructions.filter(step => step.operator === "symbol" && step.inputs.symbol === "battery").length, 2);
        for (const member of [source.left, source.right, source.shared, source.leftSource, source.rightSource]) {
          assert.ok(text.includes(member.symbol));
          if (member.value === null) assert.equal(document.quantities.find(quantity => quantity.symbol === member.symbol), undefined);
          else assert.equal(document.quantities.find(quantity => quantity.symbol === member.symbol)?.value, member.value);
        }
        for (const [symbol, value] of Object.entries({ ...gold.scientificGold.resistorsOhm, ...gold.scientificGold.sourcesV })) {
          assert.equal(document.quantities.find(quantity => quantity.symbol === symbol)?.value, value);
        }
        const v1 = document.constructions.find(step => step.outputs.includes("v1"))!;
        assert.equal(v1.inputs.start, source.positiveTerminal === "top" ? "n_tl" : "n_bl");
        assert.equal(v1.inputs.end, source.positiveTerminal === "top" ? "n_bl" : "n_tl");
        for (const entityId of ["v1", "v2"]) {
          const plates = compiled.renderScene.primitives.filter(primitive => primitive.entityId === entityId && primitive.points.length === 2)
            .map(primitive => ({ width: Math.abs(primitive.points[1]!.x - primitive.points[0]!.x),
              dy: Math.abs(primitive.points[1]!.y - primitive.points[0]!.y), y: (primitive.points[0]!.y + primitive.points[1]!.y) / 2 }))
            .filter(line => line.width > 1 && line.dy < 1e-6).sort((a, b) => b.width - a.width);
          assert.equal(plates.length, 2, "actual native battery has long/short horizontal plates");
          assert.ok(plates[0]!.width > plates[1]!.width * 1.1);
          // Native canvas y points down, so a top positive terminal has its
          // actual LONG plate above the short negative plate.
          assert.ok(source.positiveTerminal === "top" ? plates[0]!.y < plates[1]!.y : plates[0]!.y > plates[1]!.y);
        }
      } else {
        assert.ok(source && "slitCount" in source);
        assert.ok(document.constructions.some(step => step.operator === "aperture" && step.inputs.slitCount === source.slitCount));
        assert.ok(document.constructions.some(step => step.operator === "screen_pattern" && step.inputs.pattern === (source.slitCount === 1 ? "diffraction" : "interference")));
      }
    }
    return { id: gold.id, passed: true, source, records };
  } catch (error) { return { id: gold.id, passed: false, error: String(error), records }; }
});
const report = { passed: results.filter(result => result.passed).length, failed: results.filter(result => !result.passed).length, results };
if (process.argv.includes("--out")) writeFileSync(process.argv[process.argv.indexOf("--out") + 1]!, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ passed: report.passed, failed: report.failed, failures: results.filter(result => !result.passed).map(({ id, error }) => ({ id, error })) }));
process.exitCode = report.failed ? 1 : 0;
