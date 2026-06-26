import {
  arrowPath,
  emphasisEllipsePath,
  highlightRectPath,
  parseDrawingCommands,
  scribblePath,
  underlinePath,
} from "@heytutor/drawing";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertPath(name: string, path: string, minLength = 8): void {
  assert(path.trim().length >= minLength, `${name}: path too short`);
  assert(path.startsWith("M "), `${name}: path must start with M`);
}

assertPath("underline", underlinePath(100, 200, 180, 200));
assertPath("emphasis ellipse", emphasisEllipsePath(90, 190, 120, 40));
assertPath("arrow", arrowPath(250, 220, 340, 220));
assertPath("highlight", highlightRectPath(88, 318, 120, 40));
assertPath("scribble bbox", scribblePath([100, 200, 180, 240]));
assertPath("scribble polyline", scribblePath([100, 200, 140, 210, 180, 195, 220, 205]));

const parsed = parseDrawingCommands(
  "here, x is the variable [UNDERLINE:118,248,138,252] notice [CIRCLE_AROUND:88,200,52,44]",
);
assert(parsed.commands.length === 2, "parser: expected two annotation commands");
assert(parsed.commands[0]?.type === "UNDERLINE", "parser: first command should be UNDERLINE");
assert(parsed.commands[1]?.type === "CIRCLE_AROUND", "parser: second command should be CIRCLE_AROUND");

console.log("verify-annotation-paths: all checks passed");
