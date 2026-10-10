import assert from "node:assert/strict";
import {
  normalizeBoardText,
  parseDrawCommandFromTag,
  parseDrawingCommands,
} from "../src/protocol/drawingProtocol";

for (const [source, expected] of [
  ["variance = 5 squared units", "variance = 5 squared units"],
  ["area = 9 squared units", "area = 9 squared units"],
  ["area = 2.5 squared units", "area = 2.5 squared units"],
  ["area = -5 squared units", "area = -5 squared units"],
  ["5 squared unit", "5 squared unit"],
  ["5 squared UNITS", "5 squared UNITS"],
  ["x squared = 5 squared units", "x^2 = 5 squared units"],
  ["5 squared", "5^2"],
  ["x squared", "x^2"],
  ["radius squared", "r^2"],
  ["5 squared plus 3", "5^2 + 3"],
  ["5 squared unitless", "5^2 unitless"],
]) {
  assert.equal(normalizeBoardText(source), expected, `${source}: unit qualifier must not exponentiate its numeric value`);
  assert.equal(parseDrawCommandFromTag("WRITE", `${source},90,211`, 0, "").text, expected,
    `${source}: actual WRITE parser must preserve the same meaning`);
  const parsed = parseDrawingCommands(`[WRITE:${source},90,211]`);
  assert.equal(parsed.commands[0]?.text, expected, `${source}: whole response consumer must agree`);
  assert.deepEqual(parsed.commands[0]?.params, [90, 211], "notation never changes the coordinate suffix");
}
assert.equal(normalizeBoardText("2 µC"), "2 µC", "micro-unit prefix is not rewritten to a Greek variable");
console.log("board text unit qualifiers: numeric squared-unit phrases retain values; actual prose powers still normalize through both WRITE parsers");
