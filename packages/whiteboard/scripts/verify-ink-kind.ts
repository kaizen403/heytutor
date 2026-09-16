import assert from "node:assert/strict";
import { DIAGRAM_ZONE } from "@heytutor/drawing";
import { BOARD_INK_ATTR, boardInkKindAt } from "../src/inkKind";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

assert.equal(boardInkKindAt(90), "work");
assert.equal(boardInkKindAt(DIAGRAM_ZONE.x - 1), "work");
assert.equal(boardInkKindAt(DIAGRAM_ZONE.x), "scene");
assert.equal(boardInkKindAt(780), "scene");
assert.equal(BOARD_INK_ATTR, "htInk");

const here = dirname(fileURLToPath(import.meta.url));
const whiteboard = readFileSync(join(here, "../src/Whiteboard.tsx"), "utf8");
assert.match(whiteboard, /eraseWorkInk/, "the board must expose a work-ink wipe");
assert.match(whiteboard, /BOARD_INK_ATTR/, "drawn nodes must be tagged work vs scene");
assert.match(
  whiteboard,
  /boardInkKindAt\(x\)/,
  "writeText must tag from the row origin so overflow glyphs still count as work",
);

console.log("verify-ink-kind: ok");
