import type { DrawCommand, TutorSegment } from "../drawingProtocol";
import { measureTextWidth } from "../handwriting";
import type { DiagramTemplate } from "./types";

type CircuitKind = "series" | "parallel" | "combination" | "rc" | "wheatstone" | "generic";

const TOP_Y = 240;
const BOTTOM_Y = 390;
// The circuit lives in the right-hand half of the board so the running solution
// gets the whole left column. All builders below derive their x-coordinates from
// LEFT_X / RIGHT_X, so shifting these two constants moves the entire diagram.
const LEFT_X = 670;
const RIGHT_X = 1040;
const RESISTOR_AMP = 16;

function command(
  type: DrawCommand["type"],
  params: number[],
  text?: string,
): DrawCommand {
  return {
    type,
    params,
    text,
    charPosition: 0,
    narrationBefore: "",
    syncable: type === "LABEL" || type === "WRITE" || type === "DIMENSION",
    syncReason: type === "LABEL" ? "template-circuit-label" : undefined,
  };
}

function segment(narration: string, commands: DrawCommand[]): TutorSegment {
  return {
    narration,
    command: commands[0] ?? null,
    commands,
    templateIntro: true,
  };
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? `${value}` : `${Number(value.toFixed(2))}`;
}

function ohms(value: number): string {
  // A thin letter space between the number and the sign reads cleanly ("6 Ω").
  return `${formatValue(value)} \u03a9`;
}

function extractResistors(question: string): number[] {
  // Only scan the problem statement — trailing mentions like "power in the 8 Ω
  // resistor" must not become extra components on the diagram.
  const statement = question.split(/\b(?:find|calculate|determine|what is|how much)\b/i)[0] ?? question;
  const values: number[] = [];
  const pattern = /(\d+(?:\.\d+)?)\s*(?:\u03a9|ohms?)(?![a-z])/gi;
  for (const match of statement.matchAll(pattern)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) {
      values.push(value);
    }
  }
  return values.slice(0, 5);
}

function extractVoltage(question: string): number | null {
  const match = question.match(/(\d+(?:\.\d+)?)\s*(?:V|volt|volts)\b/i);
  const value = Number(match?.[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function classifyCircuit(question: string, resistors: number[]): CircuitKind {
  if (/\bwheatstone\b|meter bridge|bridge circuit/i.test(question)) {
    return "wheatstone";
  }
  if (/\bRC\b|capacitor|charging|discharging|time constant/i.test(question)) {
    return "rc";
  }
  const hasParallel = /parallel/i.test(question);
  const hasSeries = /series|in series/i.test(question);
  // A combination problem mentions both (e.g. "R1 in series with the parallel
  // combination of R2 and R3") and needs at least three resistors to be one.
  if (hasParallel && hasSeries && resistors.length >= 3) {
    return "combination";
  }
  if (hasParallel) {
    return "parallel";
  }
  if (hasSeries || resistors.length >= 2) {
    return "series";
  }
  return "generic";
}

function wire(x1: number, y1: number, x2: number, y2: number): DrawCommand {
  return command("DRAW_LINE", [x1, y1, x2, y2]);
}

function label(text: string, x: number, y: number): DrawCommand {
  return command("LABEL", [x, y], text);
}

/** Places label text horizontally centred over `midX` so it sits above its part. */
function centeredLabel(text: string, midX: number, y: number): DrawCommand {
  const width = measureTextWidth(text);
  return command("LABEL", [Math.round(midX - width / 2), y], text);
}

/** Horizontal zigzag resistor between (x1,y) and (x2,y). Endpoints sit on the wire. */
function resistorZigzag(x1: number, x2: number, y: number): DrawCommand {
  const step = (x2 - x1) / 6;
  return command("DRAW_LINE", [
    x1, y,
    x1 + step, y - RESISTOR_AMP,
    x1 + step * 2, y + RESISTOR_AMP,
    x1 + step * 3, y - RESISTOR_AMP,
    x1 + step * 4, y + RESISTOR_AMP,
    x1 + step * 5, y - RESISTOR_AMP,
    x2, y,
  ]);
}

/** Vertical zigzag resistor between (x,y1) and (x,y2). */
function verticalResistorZigzag(x: number, y1: number, y2: number): DrawCommand {
  const step = (y2 - y1) / 6;
  return command("DRAW_LINE", [
    x, y1,
    x - RESISTOR_AMP, y1 + step,
    x + RESISTOR_AMP, y1 + step * 2,
    x - RESISTOR_AMP, y1 + step * 3,
    x + RESISTOR_AMP, y1 + step * 4,
    x - RESISTOR_AMP, y1 + step * 5,
    x, y2,
  ]);
}

function batterySymbol(x: number, topY: number, bottomY: number, voltage: number | null): TutorSegment {
  const midY = (topY + bottomY) / 2;
  return segment(
    voltage
      ? `the battery is ${formatValue(voltage)} volts, so this is the source that drives the whole circuit.`
      : "the battery is the source that drives current around the circuit.",
    [
      wire(x, topY, x, midY - 8),
      command("DRAW_LINE", [x - 26, midY - 8, x + 26, midY - 8]),
      command("DRAW_LINE", [x - 14, midY + 12, x + 14, midY + 12]),
      wire(x, midY + 12, x, bottomY),
      label(voltage ? `${formatValue(voltage)} V` : "\u03b5", x - 78, midY - 6),
    ],
  );
}

/** Current-direction arrow, kept on the clear lower rail so it never covers a resistor. */
function currentArrow(text = "I", narration = "the current I is the same everywhere in a single series loop."): TutorSegment {
  const arrowMidX = (LEFT_X + RIGHT_X) / 2;
  return segment(narration, [
    command("ARROW", [arrowMidX + 40, BOTTOM_Y, arrowMidX - 40, BOTTOM_Y]),
    centeredLabel(text, arrowMidX, BOTTOM_Y + 12),
  ]);
}

function seriesPositions(count: number, width: number): Array<{ x1: number; x2: number }> {
  const leadIn = 46;
  const usableStart = LEFT_X + leadIn;
  const usableEnd = RIGHT_X - leadIn;
  const positions: Array<{ x1: number; x2: number }> = [];
  if (count <= 1) {
    const midX = (LEFT_X + RIGHT_X) / 2;
    positions.push({ x1: Math.round(midX - width / 2), x2: Math.round(midX + width / 2) });
    return positions;
  }
  const interGap = (usableEnd - usableStart - count * width) / (count - 1);
  for (let i = 0; i < count; i++) {
    const x1 = Math.round(usableStart + i * (width + interGap));
    positions.push({ x1, x2: x1 + width });
  }
  return positions;
}

function buildSeriesCircuit(resistors: number[], voltage: number | null): TutorSegment[] {
  const values = resistors.length > 0 ? resistors : [1];
  const count = Math.min(values.length, 4);
  const width = count >= 4 ? 44 : 58;
  const positions = seriesPositions(count, width);

  const segments: TutorSegment[] = [batterySymbol(LEFT_X, TOP_Y, BOTTOM_Y, voltage)];

  for (let i = 0; i < count; i++) {
    const { x1, x2 } = positions[i]!;
    const value = values[i]!;
    segments.push(
      segment(`R ${i + 1} is ${formatValue(value)} ohms, connected end to end in the same path.`, [
        resistorZigzag(x1, x2, TOP_Y),
        centeredLabel(`R${i + 1}=${ohms(value)}`, (x1 + x2) / 2, TOP_Y - 66),
      ]),
    );
  }

  const first = positions[0]!;
  const last = positions[count - 1]!;
  const wires: DrawCommand[] = [wire(LEFT_X, TOP_Y, first.x1, TOP_Y)];
  for (let i = 0; i < count - 1; i++) {
    wires.push(wire(positions[i]!.x2, TOP_Y, positions[i + 1]!.x1, TOP_Y));
  }
  wires.push(
    wire(last.x2, TOP_Y, RIGHT_X, TOP_Y),
    wire(RIGHT_X, TOP_Y, RIGHT_X, BOTTOM_Y),
    wire(RIGHT_X, BOTTOM_Y, LEFT_X, BOTTOM_Y),
  );

  segments.push(
    segment("the wires close the loop, so there is one continuous path through every resistor.", wires),
    currentArrow(),
  );

  return segments;
}

function buildParallelCircuit(resistors: number[], voltage: number | null): TutorSegment[] {
  const values = resistors.length > 0 ? resistors : [1, 1];
  const count = Math.min(values.length, 4);
  // Spread branches evenly across the rail, leaving margins from both corners.
  const railStart = LEFT_X + 90;
  const railEnd = RIGHT_X - 40;
  const span = railEnd - railStart;
  const branchXs = Array.from({ length: count }, (_, i) =>
    Math.round(count === 1 ? (railStart + railEnd) / 2 : railStart + (span * i) / (count - 1)),
  );
  const branchTopY = TOP_Y + 42;
  const branchBottomY = BOTTOM_Y - 42;

  const segments: TutorSegment[] = [
    batterySymbol(LEFT_X, TOP_Y, BOTTOM_Y, voltage),
    segment("the top and bottom rails are shared junctions, so every branch has the same voltage across it.", [
      wire(LEFT_X, TOP_Y, RIGHT_X, TOP_Y),
      wire(LEFT_X, BOTTOM_Y, RIGHT_X, BOTTOM_Y),
    ]),
  ];

  branchXs.forEach((x, i) => {
    const value = values[i]!;
    segments.push(
      segment(`branch ${i + 1} has R ${i + 1} equal to ${formatValue(value)} ohms.`, [
        wire(x, TOP_Y, x, branchTopY),
        verticalResistorZigzag(x, branchTopY, branchBottomY),
        wire(x, branchBottomY, x, BOTTOM_Y),
        label(`R${i + 1}=${ohms(value)}`, x + 22, (branchTopY + branchBottomY) / 2 - 12),
      ]),
    );
  });

  segments.push(
    currentArrow("I", "the total current splits between the branches, then recombines at the far junction."),
  );

  return segments;
}

/**
 * R1 in series with a parallel pair (R2 ∥ R3) — the most common JEE combination.
 * Any extra resistors beyond three are ignored for the drawing but still solvable.
 */
function buildCombinationCircuit(resistors: number[], voltage: number | null): TutorSegment[] {
  const values = resistors.length >= 3 ? resistors : [...resistors, 1, 1, 1].slice(0, 3);
  const [r1, r2, r3] = values as [number, number, number];

  // Series resistor R1 on the top rail, then a parallel block between nodes A and B.
  const r1x1 = LEFT_X + 60;
  const r1x2 = LEFT_X + 120;
  const nodeAx = LEFT_X + 156;
  const nodeBx = LEFT_X + 312;
  const parStart = LEFT_X + 186;
  const parEnd = LEFT_X + 266;
  const lowerY = TOP_Y + 80;
  const r3LabelY = lowerY + 26;

  return [
    batterySymbol(LEFT_X, TOP_Y, BOTTOM_Y, voltage),
    segment(`R 1 is ${formatValue(r1)} ohms in series — all the current passes through it first.`, [
      wire(LEFT_X, TOP_Y, r1x1, TOP_Y),
      resistorZigzag(r1x1, r1x2, TOP_Y),
      centeredLabel(`R1=${ohms(r1)}`, (r1x1 + r1x2) / 2, TOP_Y - 66),
      wire(r1x2, TOP_Y, nodeAx, TOP_Y),
    ]),
    segment(`R 2 is ${formatValue(r2)} ohms on the upper branch of the parallel pair.`, [
      wire(nodeAx, TOP_Y, parStart, TOP_Y),
      resistorZigzag(parStart, parEnd, TOP_Y),
      wire(parEnd, TOP_Y, nodeBx, TOP_Y),
      centeredLabel(`R2=${ohms(r2)}`, (parStart + parEnd) / 2, TOP_Y - 66),
    ]),
    segment(`R 3 is ${formatValue(r3)} ohms on the lower branch — same two junctions as R 2.`, [
      wire(nodeAx, TOP_Y, nodeAx, lowerY),
      wire(nodeAx, lowerY, parStart, lowerY),
      resistorZigzag(parStart, parEnd, lowerY),
      wire(parEnd, lowerY, nodeBx, lowerY),
      wire(nodeBx, lowerY, nodeBx, TOP_Y),
      centeredLabel(`R3=${ohms(r3)}`, (parStart + parEnd) / 2, r3LabelY),
    ]),
    segment("the wires close the loop back to the source through the whole network.", [
      wire(nodeBx, TOP_Y, RIGHT_X, TOP_Y),
      wire(RIGHT_X, TOP_Y, RIGHT_X, BOTTOM_Y),
      wire(RIGHT_X, BOTTOM_Y, LEFT_X, BOTTOM_Y),
    ]),
    currentArrow("I", "the current is the same through R 1, then splits across R 2 and R 3 before recombining."),
  ];
}

function buildRcCircuit(voltage: number | null): TutorSegment[] {
  return [
    batterySymbol(LEFT_X, TOP_Y, BOTTOM_Y, voltage),
    segment("the resistor controls how quickly charge flows.", [
      wire(LEFT_X, TOP_Y, LEFT_X + 106, TOP_Y),
      resistorZigzag(LEFT_X + 106, LEFT_X + 186, TOP_Y),
      centeredLabel("R", LEFT_X + 146, TOP_Y - 66),
    ]),
    segment("the capacitor stores charge on two plates.", [
      wire(LEFT_X + 186, TOP_Y, LEFT_X + 254, TOP_Y),
      command("DRAW_LINE", [LEFT_X + 260, TOP_Y - 30, LEFT_X + 260, TOP_Y + 30]),
      command("DRAW_LINE", [LEFT_X + 284, TOP_Y - 30, LEFT_X + 284, TOP_Y + 30]),
      wire(LEFT_X + 284, TOP_Y, RIGHT_X, TOP_Y),
      centeredLabel("C", LEFT_X + 272, TOP_Y - 66),
    ]),
    segment("the wires close the RC loop, so current changes as the capacitor charges.", [
      wire(RIGHT_X, TOP_Y, RIGHT_X, BOTTOM_Y),
      wire(RIGHT_X, BOTTOM_Y, LEFT_X, BOTTOM_Y),
    ]),
    currentArrow("I(t)", "the current changes with time as the capacitor charges through the resistor."),
  ];
}

function buildWheatstoneCircuit(resistors: number[], voltage: number | null): TutorSegment[] {
  const values = resistors.length >= 4 ? resistors : [1, 1, 1, 1, 1];
  return [
    batterySymbol(LEFT_X, 250, 390, voltage),
    segment("a Wheatstone bridge is a diamond network with two upper arms and two lower arms.", [
      resistorZigzag(LEFT_X + 70, LEFT_X + 150, 220),
      resistorZigzag(LEFT_X + 220, LEFT_X + 300, 220),
      resistorZigzag(LEFT_X + 70, LEFT_X + 150, 380),
      resistorZigzag(LEFT_X + 220, LEFT_X + 300, 380),
      wire(LEFT_X + 150, 220, LEFT_X + 220, 220),
      wire(LEFT_X + 150, 380, LEFT_X + 220, 380),
    ]),
    segment("the bridge branch connects the middle junctions; balance means no current through this branch.", [
      wire(LEFT_X + 185, 220, LEFT_X + 185, 380),
      label("G", LEFT_X + 196, 290),
    ]),
    segment("each arm gets its own resistance label so the ratio comparison is visible.", [
      centeredLabel(`R1=${ohms(values[0]!)}`, LEFT_X + 110, 168),
      centeredLabel(`R2=${ohms(values[1]!)}`, LEFT_X + 260, 168),
      centeredLabel(`R3=${ohms(values[2]!)}`, LEFT_X + 110, 404),
      centeredLabel(`R4=${ohms(values[3]!)}`, LEFT_X + 260, 404),
    ]),
  ];
}

function buildGenericCircuit(resistors: number[], voltage: number | null): TutorSegment[] {
  const value = resistors[0] ?? null;
  return [
    batterySymbol(LEFT_X, TOP_Y, BOTTOM_Y, voltage),
    segment("the resistor is the part that opposes current and causes a voltage drop.", [
      wire(LEFT_X, TOP_Y, LEFT_X + 136, TOP_Y),
      resistorZigzag(LEFT_X + 136, LEFT_X + 216, TOP_Y),
      centeredLabel(value ? `R=${ohms(value)}` : "R", LEFT_X + 176, TOP_Y - 66),
      wire(LEFT_X + 216, TOP_Y, RIGHT_X, TOP_Y),
    ]),
    segment("the wires close one complete loop from the source, through the resistor, and back.", [
      wire(RIGHT_X, TOP_Y, RIGHT_X, BOTTOM_Y),
      wire(RIGHT_X, BOTTOM_Y, LEFT_X, BOTTOM_Y),
    ]),
    currentArrow("I", "one loop means the same current flows through the source and the resistor."),
  ];
}

export function buildCircuitPrecisionSegments(
  template: DiagramTemplate,
  question: string | undefined,
): TutorSegment[] {
  if (template.id !== "circuit" || !question) {
    return [];
  }

  const resistors = extractResistors(question);
  const voltage = extractVoltage(question);
  const kind = classifyCircuit(question, resistors);

  switch (kind) {
    case "parallel":
      return buildParallelCircuit(resistors, voltage);
    case "combination":
      return buildCombinationCircuit(resistors, voltage);
    case "rc":
      return buildRcCircuit(voltage);
    case "wheatstone":
      return buildWheatstoneCircuit(resistors, voltage);
    case "series":
      return buildSeriesCircuit(resistors, voltage);
    case "generic":
    default:
      return buildGenericCircuit(resistors, voltage);
  }
}
