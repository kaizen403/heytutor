import assert from "node:assert/strict";
import { compileSceneDocument, pruneDeadSceneEntities, validateSceneDocument } from "../../src/index";
import { bjtScene, clamperScene, deviceIssues, diodeClipperScene } from "../../src/devices/scenes";

let checks = 0;
const ok = (cond: unknown, msg: string) => { checks += 1; assert.ok(cond, msg); };

for (const [name, built] of [["clipper", diodeClipperScene("Explain a diode clipping circuit")], ["clamper", clamperScene("Explain a clamper circuit")]] as const) {
  ok(deviceIssues(built.device).length === 0, `${name}: device terminals pass connectivity and polarity`);
  const validated = validateSceneDocument(pruneDeadSceneEntities(structuredClone(built.document)));
  ok(!!validated.document, `${name}: document validates`);
  const compiled = compileSceneDocument(validated.document!);
  ok(compiled.ok && !!compiled.renderScene, `${name}: document compiles`);
  ok((compiled.renderScene?.primitives.length ?? 0) > 5, `${name}: compiled ink exists`);
  const symbols = built.document.constructions.filter((c) => c.operator === "symbol").map((c) => String(c.inputs.symbol));
  ok(!symbols.includes("battery") || name !== "clipper", `${name}: no stock battery network stands in`);
}
ok(bjtScene("Explain the voltage gain of an emitter follower") === null, "a BJT figure declines until a three terminal symbol is proven");
ok(bjtScene("Can you explain me about the transistor?") === null, "a transistor explanation draws no stock circuit");

console.log(`device scenes verification passed (${checks} checks)`);
