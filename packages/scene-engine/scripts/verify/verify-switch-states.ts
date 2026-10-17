import assert from "node:assert/strict";
import { compileSceneDocument, validateSceneDocument, type SceneDocument } from "../../src/index";
import { selectConstructionInputContracts } from "../../../tutor-core/src/planners/scenePlannerV2Prompt";

function scene(state: unknown, end = { x: 4, y: 0 }, parallel = false): SceneDocument {
  const ids = ["a", "b", "s", ...(parallel ? ["s2"] : [])];
  return {
    schemaVersion: "scene-document/v2", visualDecision: { mode: "scene", reason: "Explicit switch contact state" },
    source: {}, quantities: [],
    entities: [{ id: "a", kind: "point", role: "terminal" }, { id: "b", kind: "point", role: "terminal" },
      ...ids.slice(2).map(id => ({ id, kind: "component", role: "switch", label: id.toUpperCase() }))],
    constructions: [{ id: "p1", operator: "point", inputs: { x: 0, y: 0 }, outputs: ["a"] },
      { id: "p2", operator: "point", inputs: end, outputs: ["b"] },
      ...ids.slice(2).map(id => ({ id: `make_${id}`, operator: "symbol", inputs: { symbol: "switch", start: "a", end: "b", ...(state === undefined ? {} : { state }) }, outputs: [id] }))],
    relations: [], assertions: [], annotations: [], requiredEntityIds: ids,
    revealGroups: [{ id: "g", entityIds: ids, dependsOn: [], narrationCue: "Show the switch." }],
    teachingTimeline: [{ id: "r", action: "reveal", targetId: "g", dependsOn: [], narrationIntent: "Show the switch." }],
  };
}
const failures: string[] = [];
let checks = 0;
function check(condition: unknown, message: string) { checks++; if (!condition) failures.push(message); }
for (const end of [{ x: 4, y: 0 }, { x: -4, y: 0 }, { x: 0, y: 4 }, { x: 3, y: -4 }]) {
  for (const parallel of [false, true]) {
    for (const state of [undefined, "open", "closed", " CLOSED "]) {
      const candidate = scene(state, end, parallel);
      const validated = validateSceneDocument(candidate);
      assert(validated.document, JSON.stringify(validated.report.issues));
      const compiled = compileSceneDocument(validated.document);
      assert(compiled.ok && compiled.renderScene, JSON.stringify(compiled.report.issues));
      for (const id of parallel ? ["s", "s2"] : ["s"]) {
        const paths = compiled.renderScene.primitives.filter(p => p.entityId === id && p.kind !== "label").map(p => p.points);
        const closed = state?.trim().toLowerCase() === "closed";
        check(paths.length === (closed ? 5 : 3) + (parallel ? 2 : 0), "Closed switches retain visible contact markers; open legacy glyphs remain unchanged.");
        const shift = parallel ? 1 : 0;
        const tip = paths[shift + 1]!.at(-1)!;
        const contact = paths[shift + 2]![0]!;
        const gap = Math.hypot(tip.x - contact.x, tip.y - contact.y);
        check(closed ? gap < 0.01 : gap > 1, `${String(state)} switch must have the requested contact state, including routed lanes.`);
        const terminalA = compiled.renderScene.primitives.find(p => p.entityId === "a" && p.kind === "point")!.points[0]!;
        const terminalB = compiled.renderScene.primitives.find(p => p.entityId === "b" && p.kind === "point")!.points[0]!;
        const final = parallel ? paths.at(-1)!.at(-1)! : paths[2]!.at(-1)!;
        check(Math.hypot(paths[0]![0]!.x - terminalA.x, paths[0]![0]!.y - terminalA.y) < 0.01, "First terminal preserved.");
        check(Math.hypot(final.x - terminalB.x, final.y - terminalB.y) < 0.01, "Second terminal preserved.");
      }
    }
  }
}
for (const state of ["on", "maybe", "", null, 1, false, {}, ["closed"], ["open"]]) {
  const result = compileSceneDocument(scene(state));
  check(!result.ok && result.renderScene === null && result.report.issues.some(i => i.severity === "fatal"), "Unknown state must reject atomically.");
}
const nonswitch = scene("closed");
nonswitch.entities[2]!.role = "resistor";
nonswitch.constructions[2]!.inputs.symbol = "resistor";
const badKind = compileSceneDocument(nonswitch);
check(!badKind.ok && badKind.renderScene === null, "Switch state cannot silently apply to a different component.");
for (const detailed of [[], ["symbol"]]) {
  const prompt = selectConstructionInputContracts(["symbol"], detailed);
  check(prompt.includes('state?:"open"|"closed"'), "Both compact and detailed planner contracts must expose switch state.");
}
assert.equal(failures.length, 0, failures.join("\n"));
console.log(`Switch state verification passed (${checks} checks).`);
