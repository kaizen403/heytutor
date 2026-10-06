/**
 * Teaching output wraps math in LaTeX delimiters. A live circle lesson inked
 * "\(d = 5\)" and "Since \(d = r\), the point lies on the circle." on the work
 * column, and the voice was handed the same "\(" text. Neither the WRITE ink
 * nor the spoken text may carry a delimiter or a raw LaTeX command, through
 * the whole-response parser or the streaming parser. LABEL (diagram-owned)
 * text is left exactly as it was.
 */
import { strict as assert } from "node:assert";
import {
  IncrementalTagParser,
  parseDrawingCommands,
  unwrapMathMarkup,
  type DrawCommand,
  type TutorSegment,
} from "@heytutor/drawing";
import { mathToSpeech } from "../../src/tts/speechNotation";

let checks = 0;
const DELIMITER = /\\[()[\]]|\$|\\[A-Za-z]/;

// Real-shaped teaching output (circle S3 live run, plus the shapes the models emit).
const RESPONSE = String.raw`[STEP]
The circle is \((x-1)^2 + (y+2)^2 = 25\), so the centre is \((1, -2)\) and the radius is \(r = 5\). [WRITE:Center \((1, -2)\), radius \(r = 5\),90,145]
[/STEP]
[STEP]
The distance from the centre to P is \[d = \sqrt{(4-1)^2 + (2+2)^2}\]. [WRITE:\(d = \sqrt{(4-1)^2 + (2+2)^2}\),90,200]
That is \(\sqrt{9 + 16} = \sqrt{25}\), so \(d = 5\). [WRITE:\(d = 5\),90,255]
[/STEP]
[STEP]
Since \(d = r\), the point lies on the circle. [WRITE:Since \(d = r\), the point lies on the circle.,90,310]
[/STEP]
[STEP]
Kinetic energy is $\frac{1}{2} m v^2$, so with $m = 2$ and $v = 3$ it is $$KE = \frac{1}{2} \times 2 \times 3^2 = 9$$ joules. [WRITE:$KE = \frac{1}{2} \times 2 \times 3^2 = 9 \text{ J}$,90,365]
The angle is $\theta = 30^\circ$ and $\pi r^2$ is the area. [WRITE:\(\theta = 30^\circ\), \(A = \pi r^2\),90,420]
[/STEP]`;

/** What each WRITE row must ink, written by hand. */
const EXPECTED_ROWS = [
  "Center (1, -2), radius r = 5",
  "d = sqrt((4-1)^2 + (2+2)^2)",
  "d = 5",
  "Since d = r, the point lies on the circle.",
  "KE = (1/2) × 2 × 3^2 = 9 J",
  "θ = 30°, A = π r^2",
];

function writes(commands: readonly DrawCommand[]): DrawCommand[] {
  return commands.filter((command) => command.type === "WRITE");
}

// 1. The board's math path itself: the expected rows are what the pen gets
// for plain input, so the delimited input must end in the same ink.
const parsed = parseDrawingCommands(RESPONSE);
const rows = writes(parsed.commands);
checks++;
assert.equal(rows.length, EXPECTED_ROWS.length, `WRITE rows parsed: ${rows.length}`);
for (const [index, row] of rows.entries()) {
  const plain = parseDrawingCommands(`x [WRITE:${EXPECTED_ROWS[index]},90,${145 + 55 * index}]`).commands.find((command) => command.type === "WRITE")!;
  checks++;
  assert.ok(!DELIMITER.test(row.text ?? ""), `row ${index} still carries markup: ${JSON.stringify(row.text)}`);
  checks++;
  assert.equal(row.text, plain.text, `row ${index} ink differs from the plain-math row`);
  checks++;
  assert.deepEqual(row.params, [90, 145 + 55 * index], `row ${index} coordinates`);
}

// 2. The streaming parser (live path) gives the same ink.
const streamed: TutorSegment[] = [];
const stream = new IncrementalTagParser({ onSegmentReady: (segment) => streamed.push(segment) });
for (let index = 0; index < RESPONSE.length; index += 7) stream.push(RESPONSE.slice(index, index + 7));
stream.flush();
const streamedRows = streamed.flatMap((segment) => segment.commands ?? [segment.command])
  .filter((command): command is DrawCommand => command?.type === "WRITE");
checks++;
assert.deepEqual(streamedRows.map((command) => command.text), rows.map((command) => command.text), "streamed WRITE ink equals parsed ink");

// 3. Speech: every narration the voice is handed reads without delimiters.
const narrations = [parsed.narration, ...parsed.segments.map((segment) => segment.text), ...streamed.map((segment) => segment.narration)]
  .filter((text) => text.trim());
checks++;
assert.ok(narrations.some((text) => text.includes("\\(")), "fixture narration must carry delimiters, or this gate tests nothing");
for (const narration of narrations) {
  const spoken = mathToSpeech(narration);
  checks++;
  assert.ok(!/\\|\$/.test(spoken), `speech still carries markup: ${JSON.stringify(spoken)}`);
}
const SPOKEN: ReadonlyArray<readonly [string, RegExp]> = [
  [String.raw`Since \(d = r\), the point lies on the circle.`, /^Since d equals r, the point lies on the circle\.$/],
  [String.raw`so \(d = 5\).`, /^so d equals 5\.$/],
  [String.raw`That is \(\sqrt{25}\)`, /^That is square root of 25$/],
  [String.raw`the radius is $r = 5$`, /^the radius is r equals 5$/],
];
for (const [narration, expected] of SPOKEN) {
  checks++;
  assert.match(mathToSpeech(narration), expected, `spoken form of ${narration}`);
}

// 4. Text without markup is untouched; money stays money; LABEL is not ours.
for (const text of ["d = 5", "v = u + at", "costs $5 and $10", "x^2 + y^2 = 25", "1/f = 1/u + 1/v"]) {
  checks++;
  assert.equal(unwrapMathMarkup(text), text, `plain text changed: ${text}`);
}
const label = parseDrawingCommands(String.raw`x [LABEL:\(P\),500,300]`).commands.find((command) => command.type === "LABEL");
checks++;
assert.equal(label?.text, String.raw`\(P\)`, "LABEL text is diagram-owned and must not be rewritten here");

// 5. A delimiter split across two rows leaves no half behind.
for (const [input, expected] of [[String.raw`\[d = 5`, "d = 5"], [String.raw`r = 5\]`, "r = 5"], [String.raw`\(x\)\(y\)`, "xy"]] as const) {
  checks++;
  assert.equal(unwrapMathMarkup(input), expected, `split delimiter ${input}`);
}

console.log(`verify-latex-delimiters: ${checks} checks passed`);
